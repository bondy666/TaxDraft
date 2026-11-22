import test from 'node:test'
import assert from 'node:assert/strict'
import { evidencedPropertyExpenses, reconcilePropertyExpenses, syncInterestOnlyMortgage } from './propertyExpenses.ts'

test('unexplained saved balances are excluded from property expenses idempotently', () => {
  const property = {
    id: 'p', name: 'Flat', allowableExpenses: 500,
    expenseEvidence: [
      { treatment: 'runningCost', allowableAmount: 200 },
      { treatment: 'review', allowableAmount: 40 },
      { treatment: 'interest', allowableAmount: 100 },
      { treatment: 'repayment', allowableAmount: 100 },
    ],
  }
  assert.equal(evidencedPropertyExpenses(property), 240)
  const corrected = reconcilePropertyExpenses(property)
  assert.equal(corrected.allowableExpenses, 240)
  assert.equal(corrected.expenseReconciliation, 260)
  assert.equal(reconcilePropertyExpenses(corrected), corrected)
})
test('explicit summary/manual-only entries without itemisation retain their expense amount', () => {
  const summary = { allowableExpenses: 200 }
  assert.equal(evidencedPropertyExpenses(summary), 200)
  assert.equal(reconcilePropertyExpenses(summary), summary)
})

test('an interest-only mortgage takes its annual interest from the mortgage payments, preferring ledger rows to bank references', () => {
  const property = {
    id: 'p', name: 'Flat', mortgageInterest: 0, interestOnlyMortgage: true,
    bankEvidence: [{ label: 'HALIFAX', kind: 'mortgage', incoming: 50, outgoing: 1200 }, { label: 'Flat 2', kind: 'possibleRent', incoming: 900, outgoing: 30 }],
  }
  assert.equal(syncInterestOnlyMortgage(property).mortgageInterest, 1200)
  const withLedger = { ...property, expenseEvidence: [
    { treatment: 'repayment', amount: 400.1 }, { treatment: 'interest', amount: 300.2 }, { treatment: 'runningCost', amount: 99 },
  ] }
  assert.equal(syncInterestOnlyMortgage(withLedger).mortgageInterest, 700.3)
  const synced = syncInterestOnlyMortgage(withLedger)
  assert.equal(syncInterestOnlyMortgage(synced), synced)
})

test('the interest figure is left alone when the mortgage is not interest-only or no payments are recorded', () => {
  const repayment = { mortgageInterest: 800, bankEvidence: [{ label: 'HALIFAX', kind: 'mortgage', incoming: 0, outgoing: 1200 }] }
  assert.equal(syncInterestOnlyMortgage(repayment), repayment)
  const noPayments = { mortgageInterest: 650, interestOnlyMortgage: true }
  assert.equal(syncInterestOnlyMortgage(noPayments), noPayments)
})
