import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyBankTransaction } from './bankTransactions.ts'
import { importBankSuggestion, confirmBankRelief } from './bankImport.ts'

const empty = () => ({
  taxYearId: '2025-26', savings: [], dividends: [], other: [], reliefs: { giftAidNet: 10, personalPensionContributionsNet: 20 },
})
const suggestion = (kind) => ({
  kind, bankSource: { id: kind, taxYearId: '2025-26', fileName: 'bank.csv', recordedAmount: 100, evidence: 'dated receipts', verified: false },
})
test('classifies explicit receipts and outgoing relief candidates but excludes known non-other receipts', () => {
  const classify = (description, amount) => classifyBankTransaction({ description, amount, date: new Date(2025, 5, 1) })
  assert.equal(classify('Interest paid', 10), 'interest')
  assert.equal(classify('Dividend', 10), 'dividend')
  assert.equal(classify('Unknown payment received', 10), 'otherIncome')
  for (const label of ['Rent', 'FLAT12', 'Mortgage transfer', 'Salary', 'Payroll', 'Refund', 'Cashback']) assert.equal(classify(label, 10), null)
  assert.equal(classify('NEST Pension', -10), 'pensionContribution')
  assert.equal(classify('Charity donation', -10), 'giftAid')
  assert.equal(classify('Employer pension', -10), null)
  assert.equal(classify('Mortgage payment', -10), null)
})
test('interest/dividend autopopulate, other receipts remain untaxed; repeated sources preserve edits', () => {
  let data = empty()
  for (const kind of ['interest', 'dividend', 'otherIncome']) data = importBankSuggestion(data, suggestion(kind), kind)
  assert.equal(data.savings[0].amount, 100)
  assert.equal(data.dividends[0].amount, 100)
  assert.equal(data.other[0].amount, 0)
  assert.equal(data.other[0].bankSource.recordedAmount, 100)
  data.savings[0].amount = 90
  assert.equal(importBankSuggestion(data, suggestion('interest'), 'another'), data)
  assert.equal(importBankSuggestion({ ...data, taxYearId: '2026-27' }, suggestion('giftAid'), 'wrong').bankReliefCandidates, undefined)
})
test('relief candidates apply only confirmed amounts; difference updates preserve manual balances and exclusions', () => {
  let data = importBankSuggestion(empty(), suggestion('giftAid'), 'gift')
  data = importBankSuggestion(data, suggestion('pensionContribution'), 'pension')
  assert.equal(data.reliefs.giftAidNet, 10)
  assert.equal(data.reliefs.personalPensionContributionsNet, 20)
  data = confirmBankRelief(data, 'giftAid', 40)
  assert.equal(data.reliefs.giftAidNet, 50)
  data = confirmBankRelief(data, 'giftAid', 40)
  assert.equal(data.reliefs.giftAidNet, 50)
  assert.equal(importBankSuggestion(data, suggestion('giftAid'), 'dup'), data)
  data = confirmBankRelief(data, 'pensionContribution', 100)
  assert.equal(data.reliefs.personalPensionContributionsNet, 120)
  data = confirmBankRelief(data, 'giftAid', 0)
  assert.equal(data.reliefs.giftAidNet, 10)
  assert.throws(() => confirmBankRelief(data, 'giftAid', 101), /between zero/)
  assert.throws(() => confirmBankRelief(data, 'missing', 0), /no longer available/)
})

test('configured private pension recipient matches outgoing complete phrases only', () => {
  const recipients = ['Example Life']
  const classify = (description, amount) => classifyBankTransaction({ description, amount, date: null }, recipients)
  assert.equal(classify('DIRECT DEBIT TO EXAMPLE-LIFE REF 123', -80), 'pensionContribution')
  assert.equal(classify('EXAMPLE LIFETIME', -80), null)
  assert.equal(classify('Example Life refund', 80), null)
  assert.equal(classify('Example Life', -80), 'pensionContribution')
  assert.equal(classifyBankTransaction({ description: 'Example Life', amount: -80, date: null }), null)
})
test('recipient rematching enriches a pension group without duplicate candidates or increasing relief', () => {
  const original = { ...suggestion('pensionContribution'), bankSource: {
    ...suggestion('pensionContribution').bankSource, groupKey: 'file:sheet:pension', recordedAmount: 80,
  } }
  let data = importBankSuggestion(empty(), original, 'first')
  data = confirmBankRelief(data, 'pensionContribution', 80)
  const updated = { ...original, bankSource: { ...original.bankSource, id: 'expanded', recordedAmount: 160 } }
  const expanded = importBankSuggestion(data, updated, 'second')
  assert.equal(expanded.bankReliefCandidates.length, 1)
  assert.equal(expanded.bankReliefCandidates[0].source.recordedAmount, 160)
  assert.equal(expanded.bankReliefCandidates[0].claimedAmount, 80)
  assert.equal(expanded.reliefs.personalPensionContributionsNet, 100)
})

test('recognises charity payees and donation labels while rejecting purchases and non-donations', () => {
  const classify = (description, amount = -25) => classifyBankTransaction({ description, amount, date: null })
  for (const label of ['DD CANCER RESEARCH UK REF 123', 'Macmillan', 'RNLI', 'British-Red-Cross',
    'Charitable giving', 'Monthly donations', 'GiftAid', 'Gift-Aid']) {
    assert.equal(classify(label), 'giftAid', label)
  }
  for (const label of ['Oxfam shop', 'Cancer Research UK lottery', 'RNLI raffle ticket',
    'Charity goods purchase', 'Charity membership', 'Macmillan refund', 'RNLI reversal',
    'Ordinary supermarket', 'OXFAMERICA']) {
    assert.equal(classify(label), null, label)
  }
  assert.notEqual(classify('RNLI', 25), 'giftAid')
  assert.equal(classify('RNLI', 0), null)
})

test('custom charity names match complete phrases on outgoings only without claiming Gift Aid', () => {
  const transaction = { description: 'DD LOCAL-HELP FUND REF 123', amount: -30, date: null }
  assert.equal(classifyBankTransaction(transaction), null)
  assert.equal(classifyBankTransaction(transaction, [], ['Local Help Fund']), 'giftAid')
  assert.equal(classifyBankTransaction({ ...transaction, description: 'Local Help Funding' }, [], ['Local Help Fund']), null)
  assert.notEqual(classifyBankTransaction({ ...transaction, amount: 30 }, [], ['Local Help Fund']), 'giftAid')
  assert.equal(classifyBankTransaction({ ...transaction, description: 'Local Help Fund lottery' }, [], ['Local Help Fund']), null)
  const imported = importBankSuggestion(empty(), suggestion('giftAid'), 'donations')
  assert.equal(imported.bankReliefCandidates[0].source.recordedAmount, 100)
  assert.equal(imported.bankReliefCandidates[0].claimedAmount, 0)
  assert.equal(imported.reliefs.giftAidNet, 10)
})

test('charity rematching updates one Gift Aid review group and preserves only the confirmed claim', () => {
  const original = { ...suggestion('giftAid'), bankSource: {
    ...suggestion('giftAid').bankSource, groupKey: 'file:sheet:giftAid', recordedAmount: 25,
  } }
  let data = importBankSuggestion(empty(), original, 'first')
  data = confirmBankRelief(data, 'giftAid', 25)
  const updated = { ...original, bankSource: { ...original.bankSource, id: 'expanded-donations', recordedAmount: 55 } }
  data = importBankSuggestion(data, updated, 'second')
  assert.equal(data.bankReliefCandidates.length, 1)
  assert.equal(data.bankReliefCandidates[0].source.recordedAmount, 55)
  assert.equal(data.bankReliefCandidates[0].claimedAmount, 25)
  assert.equal(data.bankReliefCandidates[0].source.verified, false)
  assert.equal(data.reliefs.giftAidNet, 35)
  assert.equal(importBankSuggestion(data, updated, 'repeat'), data)
  data = confirmBankRelief(data, 'expanded-donations', 55)
  assert.equal(data.reliefs.giftAidNet, 65)
  data = confirmBankRelief(data, 'expanded-donations', 55)
  assert.equal(data.reliefs.giftAidNet, 65)
})
