import test from 'node:test'
import assert from 'node:assert/strict'
import { findCharityCandidates } from './bankTransactions.ts'

const payment = (description, month, amount = -20, suffix = '') => ({
  id: `${description}:${month}:${suffix}`, source: `bank-${month}.csv`,
  description, date: new Date(2025, month - 1, 10), amount,
})
const monthly = (name) => [5, 6, 7].map((month) => payment(name, month))

test('a fixed round monthly amount to a non-commercial payee is a likely donation, selected for review', () => {
  const payments = [5, 6, 7].map((month) => payment(`DD LOCAL HELP FUND REF ${month}123`, month))
  const [candidate] = findCharityCandidates(payments)
  assert.equal(candidate.recipient, 'Local Help Fund')
  assert.equal(candidate.confidence, 'likely')
  assert.equal(candidate.total, 60)
  assert.equal(candidate.payments.length, 3)
  assert.match(candidate.reason, /same £20\.00 was paid every month/)
})

test('companies, fees, varying or non-round monthly amounts remain unchecked review leads', () => {
  const candidates = findCharityCandidates([
    ...monthly('VWFS UK LIMITED').map((item) => ({ ...item, amount: -21.74 })),
    ...monthly('Maintaining the account monthly fee').map((item) => ({ ...item, amount: -4 })),
    ...[5, 6, 7].map((month) => payment('ALLWYN ENT', month, -50 - month)),
    ...monthly('Vision Fdn').map((item) => ({ ...item, amount: -6.5 })),
  ])
  assert.deepEqual(candidates.map((candidate) => [candidate.recipient, candidate.confidence]), [
    ['Allwyn Ent', 'monthlyReview'],
    ['Maintaining the account monthly fee', 'monthlyReview'],
    ['Vision Fdn', 'likely'],
    ['Vwfs Uk Limited', 'monthlyReview'],
  ])
})

test('the same payments read from a second file do not break monthly detection', () => {
  const statement = monthly('GOSHCC').map((item) => ({ ...item, amount: -10 }))
  const copy = statement.map((item) => ({ ...item, id: `report:${item.id}`, source: 'export.xlsx' }))
  const [candidate] = findCharityCandidates([...statement, ...copy])
  assert.equal(candidate.confidence, 'likely')
  assert.equal(candidate.payments.length, 3)
  assert.equal(candidate.total, 30)
})

test('ambiguous charity-adjacent words do not identify a charity', () => {
  const transactions = [
    payment('Community Foundation', 5),
    payment('Local Trust', 6),
    payment('Animal Rescue', 7),
    payment('Monthly appeal', 8),
  ]
  assert.deepEqual(findCharityCandidates(transactions), [])
})

test('built-in charity names match bank text without apostrophes or a leading "The"', () => {
  const candidates = findCharityCandidates([
    payment('DD CHILDRENS SOCIETY', 5, -150),
    payment('BARNARDOS', 6, -12),
    payment('SO ALZHEIMERS SOCIETY', 7, -250),
  ])
  assert.deepEqual(candidates.map((candidate) => [candidate.recipient, candidate.confidence]), [
    ['Alzheimer\'s Society', 'identified'],
    ['Barnardo\'s', 'identified'],
    ['The Children\'s Society', 'identified'],
  ])
})

test('known donations need not recur; monthly bills, pensions and other obvious expenses are excluded', () => {
  const expenses = ['Mortgage', 'NatWest', 'Rent', 'Council tax', 'Octopus Energy', 'Water bill',
    'British Gas', 'Mobile phone', 'Broadband', 'Insurance', 'Credit card payment', 'Savings transfer',
    'Netflix subscription', 'Oxfam shop', 'RNLI lottery', 'Gym membership', 'Petrol', 'Service charge',
    'Repairs maintenance', 'Example Life']
  const candidates = findCharityCandidates([
    payment('RNLI', 5), payment('Charity donation', 6),
    ...expenses.flatMap(monthly),
  ], ['Example Life'])
  assert.deepEqual(candidates.map((candidate) => candidate.recipient), ['Charity donation', 'RNLI'])
})

test('monthly review leads require three consecutive months with payments below £100', () => {
  const transactions = [
    payment('One off', 5), payment('Two payments', 5), payment('Two payments', 6),
    ...[5, 7, 9].map((month) => payment('Sporadic payment', month)),
    ...monthly('Credit').map((item) => ({ ...item, amount: 20 })),
    ...monthly('Undated').map((item) => ({ ...item, date: null })),
    ...monthly('At limit').map((item) => ({ ...item, amount: -100 })),
  ]
  assert.deepEqual(findCharityCandidates(transactions), [])
  const [candidate] = findCharityCandidates(monthly('Recurring payment').map((item) => ({ ...item, amount: -99.99 })))
  assert.equal(candidate.confidence, 'monthlyReview')
  assert.equal(candidate.total, 299.97)
})

test('identical source rows do not inflate totals; custom charities remain reviewable', () => {
  const payments = monthly('Cancer Research UK')
  const candidate = findCharityCandidates([...payments, ...payments])[0]
  assert.equal(candidate.total, 60)
  assert.equal(candidate.payments.length, 3)
  assert.equal(candidate.confidence, 'identified')
  const configured = findCharityCandidates([payment('Community Help', 5)], [], ['Community Help'])
  assert.equal(configured.length, 1)
  assert.match(configured[0].reason, /Recognised/)
})

test('explicit charity names and labels are still suggested without recurring', () => {
  const candidates = findCharityCandidates([
    payment('Cancer Research UK', 5),
    payment('Charity donation', 6),
    payment('Community Help', 7),
  ], [], ['Community Help'])
  assert.deepEqual(candidates.map((candidate) => candidate.recipient), [
    'Cancer Research UK', 'Charity donation', 'Community Help',
  ])
  assert.equal(findCharityCandidates(monthly('Zero').map((item) => ({ ...item, amount: 0 }))).length, 0)
})
