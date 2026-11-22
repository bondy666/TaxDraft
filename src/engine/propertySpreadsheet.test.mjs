import test from 'node:test'
import assert from 'node:assert/strict'
import { extractPropertySpreadsheet } from './propertySpreadsheet.ts'

test('supplier ledger is expenses only, excludes totals, uncertain/capital costs and wrong-year rows', () => {
  const result = extractPropertySpreadsheet([
    ['Date', 'Supplier', 'Description', 'Reference', 'Amount (£)'],
    ['2025-04-06', 'Agent', 'Rent Now', 'invoice', 120],
    ['2025-05-01', 'Manager', 'Service Charge', 'invoice', 200],
    ['2025-05-02', 'Freeholder', 'Ground Rent', 'invoice', 80],
    ['2025-05-03', 'Contractor', 'Hot Water Tank Repair', '', 90],
    ['2025-05-04', 'Contractor', 'Capital improvement repair', '', 400],
    ['2025-05-05', 'Bank', 'Mortgage repayment', '', 600],
    ['2025-05-06', 'Bank', 'Mortgage interest', '', 25],
    ['2026-04-06', 'Manager', 'Service Charge', '', 1000],
    ['', '', '', 'Total', 2515],
  ], 'Example Flat', '2025-26')
  assert.equal(result.figures.length, 1)
  assert.equal(result.figures[0].propertyName, 'Example Flat')
  assert.equal(result.figures[0].rentalIncome, undefined)
  assert.equal(result.figures[0].allowableExpenses, 370)
  assert.equal(result.figures[0].mortgageInterest, 25)
  assert.equal(result.figures[0].ownershipShare, undefined)
  assert.match(result.warnings.join(' '), /3 costs were not classified/)
})

test('bank rent is unallocated; transfers, mortgage repayments, ambiguous receipts and balances are not income', () => {
  const result = extractPropertySpreadsheet([
    ['Date', 'Description', 'Money in', 'Money Out', 'Balance'],
    [new Date(2025, 3, 6), 'Rent from letting agent', 1200, '', 5000],
    ['05/04/2026', 'Rental receipt', 1200, '', 5000],
    ['06/04/2026', 'Rental receipt', 500, '', 5000],
    ['01/06/2025', 'FLAT12 receipt', 1000, '', 5000],
    ['02/06/2025', 'Mortgage transfer', 500, '', 5000],
    ['03/06/2025', 'Mortgage repayment', '', 500, 5000],
    ['04/06/2025', 'Mortgage interest', '', 100, 5000],
    ['05/06/2025', 'Service charge', '', 40, 5000],
    ['06/06/2025', 'Rent deposit', 300, '', 5000],
    ['31/02/2025', 'Rent', 300, '', 5000],
  ], 'Bank export', '2025-26')
  assert.equal(result.figures[0].rentalIncome, 2400)
  assert.equal(result.figures[0].allowableExpenses, undefined)
  assert.equal(result.figures[0].mortgageInterest, undefined)
  assert.match(result.figures[0].propertyName, /Unallocated/)
  const evidence = result.figures.flatMap((figure) => figure.bankEvidence ?? [])
  assert.equal(evidence.find((item) => item.kind === 'possibleRent').incoming, 1000)
  const mortgage = evidence.find((item) => item.kind === 'mortgage')
  assert.equal(mortgage.incoming, 500)
  assert.equal(mortgage.outgoing, 600)
  assert.match(result.warnings.join(' '), /invalid dates/)
})

test('signed bank amounts produce lender evidence without adding repayments to expenses or interest', () => {
  const result = extractPropertySpreadsheet([
    ['Date', 'Description', 'Amount'],
    ['2025-05-01', 'Rent', 1000],
    ['2025-05-02', 'Direct debit NatWest Bank', -500],
    ['2025-05-03', 'Direct debit Halifax', -600],
    ['2025-05-04', 'Direct debit Virgin Money', -700],
    ['2026-04-06', 'Direct debit Halifax', -900],
  ], 'Bank', '2025-26')
  assert.equal(result.figures[0].rentalIncome, 1000)
  assert.equal(result.figures[0].mortgageInterest, undefined)
  assert.equal(result.figures[0].allowableExpenses, undefined)
  assert.deepEqual(result.figures.flatMap((figure) => figure.bankEvidence ?? []).map((item) => item.outgoing), [500, 600, 700])
})

test('explicit property column groups receipts separately', () => {
  const result = extractPropertySpreadsheet([
    ['Date', 'Description', 'Paid in', 'Paid out', 'Property'],
    ['2025-05-01', 'Rent', 1000, '', 'Flat A'],
    ['2025-05-02', 'Rent', 2000, '', 'Flat B'],
  ], 'Receipts', '2025-26')
  assert.deepEqual(result.figures.map(({ propertyName, rentalIncome }) => ({ propertyName, rentalIncome })), [
    { propertyName: 'Flat A', rentalIncome: 1000 }, { propertyName: 'Flat B', rentalIncome: 2000 },
  ])
})

test('labelled annual summary extracts whole-property figures and percentage', () => {
  const rows = [
    ['Tax year', '2025/26'], ['Property', 'Flat A'],
    ['Gross rental income', '£12,000.00'],
    ['Allowable expenses excluding finance costs', 2000],
    ['Mortgage interest', 3000], ['Ownership share', '50%'],
  ]
  const result = extractPropertySpreadsheet(rows, 'Summary', '2025-26')
  assert.equal(result.figures[0].rentalIncome, 12000)
  assert.equal(result.figures[0].allowableExpenses, 2000)
  assert.equal(result.figures[0].mortgageInterest, 3000)
  assert.equal(result.figures[0].ownershipShare, 0.5)
  assert.equal(extractPropertySpreadsheet(rows, 'Summary', '2026-27').figures.length, 0)
})

test('mixed totals, multiple columns and repeated labels cannot become annual property figures', () => {
  assert.equal(extractPropertySpreadsheet([['Property', 'Total (£)'], ['Flat A', 1000], ['Combined Total', 1000]], 'Summary', '2025-26').figures.length, 0)
  assert.equal(extractPropertySpreadsheet([['Rental income', 1000, 2000]], 'Summary', '2025-26').figures.length, 0)
  assert.equal(extractPropertySpreadsheet([['Rental income', 1000], ['Rental income', 2000]], 'Summary', '2025-26').figures.length, 0)
  assert.equal(extractPropertySpreadsheet([['Allowable expenses', 2000]], 'Summary', '2025-26').figures.length, 0)
})

test('every dated supplier cost is retained; petrol, private/capital and unknown bills are highlighted but not claimed', () => {
  const result = extractPropertySpreadsheet([
    ['Date', 'Supplier', 'Description', 'Reference', 'Amount'],
    ['2025-05-01', 'Garage', 'Petrol', '', 100],
    ['2025-05-02', 'Contractor', 'Capital improvement', '', 500],
    ['2025-05-03', 'Shop', 'Private purchase', '', 60],
    ['2025-05-04', 'Supplier', 'Payment recorded', '', 80],
    ['2025-05-05', 'Contractor', 'Repair', '', 40],
    ['2025-05-06', 'Bank', 'Mortgage interest', '', 30],
    ['2025-05-07', 'Bank', 'Mortgage repayment', '', 300],
    ['', '', '', 'Total', 1110],
    ['2026-04-06', 'Garage', 'Petrol', '', 100],
  ], 'Flat A', '2025-26')
  const figure = result.figures[0]
  assert.equal(figure.expenseEvidence.length, 7)
  assert.equal(figure.allowableExpenses, 40)
  assert.equal(figure.mortgageInterest, 30)
  assert.match(figure.expenseEvidence[0].reason, /journey records/)
  assert.equal(figure.expenseEvidence[0].allowableAmount, 0)
  assert.equal(figure.expenseEvidence[4].allowableAmount, 40)
  assert.equal(figure.expenseEvidence[5].treatment, 'interest')
  assert.equal(figure.expenseEvidence[6].treatment, 'repayment')
  assert.deepEqual(figure.expenseEvidence.map((expense) => expense.row), [2, 3, 4, 5, 6, 7, 8])
})

test('unrelated bank outgoings are not rental expenses; lender evidence remains separate', () => {
  const result = extractPropertySpreadsheet([
    ['Date', 'Description', 'Money in', 'Money out'],
    ['2025-05-01', 'Petrol', '', 70],
    ['2025-05-02', 'TV subscription', '', 40],
    ['2025-05-03', 'Direct debit Halifax', '', 500],
  ], 'Bank', '2025-26')
  const evidence = result.figures.flatMap((figure) => figure.expenseEvidence ?? [])
  assert.equal(evidence.length, 0)
  assert.ok(evidence.every((expense) => expense.allowableAmount === 0))
  assert.ok(result.figures.every((figure) => figure.allowableExpenses === undefined))
  assert.ok(!evidence.some((expense) => /Petrol|TV subscription/.test(expense.description)))
})
