import test from 'node:test'
import assert from 'node:assert/strict'
import { removeBankExpenses } from './bankExpenseCleanup.ts'

const row = (id, source, amount, treatment = 'runningCost') => ({
  id, source, amount, allowableAmount: treatment === 'runningCost' ? amount : 0,
  treatment, row: 2, date: '01/05/2025', description: 'Cost', reason: 'Evidence',
})
const property = {
  id: 'p', name: 'Flat A', ownershipShare: 0.5, rentalIncome: 7800,
  allowableExpenses: 250, mortgageInterest: 130,
  documentSources: ['bank', 'ledger'],
  documentNote: 'bank.xlsx: Sheet1: 5 explicitly labelled rent receipts, 1 possible running costs and 1 explicit interest payments in 2025-26.\ncosts.xlsx: Flat A: 0 explicitly labelled rent receipts, 1 possible running costs and 0 explicit interest payments in 2025-26. Supplier/amount rows are treated as costs, never rental income.',
  expenseEvidence: [
    row('bank-cost', 'bank.xlsx / Sheet1', 40),
    row('bank-interest', 'bank.xlsx / Sheet1', 30, 'interest'),
    row('ledger', 'costs.xlsx / Flat A', 200),
  ],
  bankEvidence: [{ label: 'HALIFAX', kind: 'mortgage', incoming: 0, outgoing: 600 }],
}
test('saved bank costs are removed, preserving spreadsheet costs, manual balance, rent and mortgage references', () => {
  const result = removeBankExpenses([property])[0]
  assert.equal(result.allowableExpenses, 210)
  assert.equal(result.mortgageInterest, 100)
  assert.equal(result.rentalIncome, 7800)
  assert.equal(result.bankEvidence[0].outgoing, 600)
  assert.deepEqual(result.expenseEvidence.map((expense) => expense.id), ['ledger'])
  assert.equal(removeBankExpenses([result])[0], result)
})
test('manually inconsistent and legacy totals are flagged rather than silently overwritten', () => {
  const result = removeBankExpenses([{ ...property, allowableExpenses: 10 }])[0]
  assert.equal(result.allowableExpenses, 10)
  assert.match(result.documentNote, /could not be reconciled safely/)
  const legacy = removeBankExpenses([{ ...property, expenseEvidence: undefined }])[0]
  assert.equal(legacy.allowableExpenses, 0)
  assert.equal(legacy.expenseReconciliation, 250)
  assert.match(legacy.documentNote, /Legacy bank totals need manual reconciliation/)
  assert.equal(removeBankExpenses([legacy])[0], legacy)
})
