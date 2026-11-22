import test from 'node:test'
import assert from 'node:assert/strict'
import { consolidateProperties } from './propertyConsolidation.ts'
import { importProperty } from './propertyImport.ts'

const base = { id: 'a', name: 'Flat A', ownershipShare: 0.5, rentalIncome: 1000, allowableExpenses: 200, mortgageInterest: 0 }
const expense = { id: 'row', date: '01/05/2025', description: 'Repair', amount: 200, allowableAmount: 200,
  source: 'costs.xlsx / Flat A', row: 2, treatment: 'runningCost', reason: 'Check' }
test('same-name rental and expense cards consolidate while different properties stay separate', () => {
  const result = consolidateProperties([{ ...base, allowableExpenses: 0 },
    { ...base, id: 'b', name: ' flat a ', rentalIncome: 0, expenseEvidence: [expense] },
    { ...base, id: 'c', name: 'Flat B' }])
  assert.equal(result.length, 2)
  assert.equal(result[0].rentalIncome, 1000)
  assert.equal(result[0].allowableExpenses, 200)
  assert.equal(result[0].expenseEvidence.length, 1)
})
test('duplicate expense/source rows are not counted twice and rescans preserve one card', () => {
  const item = { ...base, expenseEvidence: [expense], documentSources: ['one'] }
  const result = consolidateProperties([item, { ...item, id: 'b' }])
  assert.equal(result[0].allowableExpenses, 200)
  assert.equal(result[0].expenseEvidence.length, 1)
  assert.equal(importProperty(result, { kind: 'property', propertySourceId: 'one', propertyTaxYearId: '2025-26',
    expenseEvidence: [expense] }, '2025-26', 'new'), result)
})
test('distinct documented rows combine but conflicting undocumented totals are flagged, not summed', () => {
  const result = consolidateProperties([{ ...base, expenseEvidence: [expense] },
    { ...base, id: 'b', allowableExpenses: 50, expenseEvidence: [{ ...expense, id: 'other', row: 3, amount: 50, allowableAmount: 50 }] }])
  assert.equal(result[0].allowableExpenses, 250)
  const conflict = consolidateProperties([base, { ...base, id: 'b', allowableExpenses: 300 }])[0]
  assert.equal(conflict.allowableExpenses, 300)
  assert.match(conflict.documentNote, /RECONCILE/)
})
