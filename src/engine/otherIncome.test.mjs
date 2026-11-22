import test from 'node:test'
import assert from 'node:assert/strict'
import { otherIncomePayers, rentReceiptOwners, setPayerTaxable, syncOtherIncome, toOtherIncomeReceipt } from './otherIncome.ts'
import { importBankSuggestion } from './bankImport.ts'

const receipt = (id, description, day, month, amount) =>
  toOtherIncomeReceipt({ id, description, date: new Date(2025, month, day), amount, source: 'bank.csv' })
const receipts = [
  receipt('a1', 'FP ACME DESIGN REF 10001', 3, 4, 500),
  receipt('a2', 'FP ACME DESIGN REF 10002', 3, 5, 500),
  receipt('b1', 'J SMITH', 9, 6, 120),
]
const base = {
  taxYearId: '2025-26', employments: [], pensions: [], savings: [], dividends: [],
  properties: [], other: [{ id: 'o', description: 'Money paid in: bank.csv', amount: 0, receipts }],
}

test('receipts are grouped by payer, regular payers first, and only ticked payers count as taxable', () => {
  const payers = otherIncomePayers(base.other[0], new Map())
  assert.deepEqual(payers.map((payer) => [payer.label, payer.receipts.length, payer.total]),
    [['FP ACME DESIGN REF 10001', 2, 1000], ['J SMITH', 1, 120]])
  assert.deepEqual(payers[0].regular, { amount: 500, months: 2 })
  const ticked = { ...base, other: [{ ...base.other[0], receipts: setPayerTaxable(base.other[0], payers[0].payer, true) }] }
  assert.equal(syncOtherIncome(ticked).other[0].amount, 1000)
  assert.equal(syncOtherIncome(base), base)
})

test('a receipt matched as rent is not also counted as other income', () => {
  const payer = otherIncomePayers(base.other[0], new Map())[0].payer
  const data = {
    ...base,
    properties: [{ id: 'p', name: 'Flat 1', rentalIncomeEvidence: [{ id: 'a2' }] }],
    other: [{ ...base.other[0], receipts: setPayerTaxable(base.other[0], payer, true) }],
  }
  assert.equal(syncOtherIncome(data).other[0].amount, 500)
  assert.equal(otherIncomePayers(data.other[0], rentReceiptOwners(data.properties))[0].rentProperty, 'Flat 1')
})

test('bank import stores receipts, and re-reading a file upgrades an older text-only entry once', () => {
  const source = { id: 'src', taxYearId: '2025-26', fileName: 'bank.csv', recordedAmount: 1120, evidence: 'receipts', verified: false }
  const suggestion = { kind: 'otherIncome', bankSource: source, otherReceipts: receipts }
  const empty = { taxYearId: '2025-26', savings: [], dividends: [], other: [] }
  assert.deepEqual(importBankSuggestion(empty, suggestion, 'new').other[0].receipts, receipts)
  const legacy = { ...empty, other: [{ id: 'old', description: 'Unclassified receipts: bank.csv', amount: 0, bankSource: source }] }
  const upgraded = importBankSuggestion(legacy, suggestion, 'ignored')
  assert.equal(upgraded.other.length, 1)
  assert.deepEqual(upgraded.other[0].receipts, receipts)
  const edited = { ...legacy, other: [{ ...legacy.other[0], amount: 300 }] }
  assert.equal(importBankSuggestion(edited, suggestion, 'ignored'), edited)
})
