import test from 'node:test'
import assert from 'node:assert/strict'
import { parseWeeklyPayslip } from './payslip.ts'

test('extracts supplied weekly headings without mixing cumulative figures', () => {
  assert.deepEqual(parseWeeklyPayslip(`
W/E 05/04/2026
Gross Pay this week 1,000.00
Tax this week 150.00
Hourly 25.00
NI this week 45.50
NEST Pension 40.00
Gross to Date 52,000.00
Tax to date 7,800.00
NI to date 2,366.00
`), {
    weekly: { grossPay: 1000, taxPaid: 150, niPaid: 45.5, pensionPaid: 40 },
    yearToDate: { grossPay: 52000, taxPaid: 7800, niPaid: 2366 },
  })
})

test('does not assign following column values to preceding headings', () => {
  const figures = parseWeeklyPayslip('Gross Pay this week Tax this week\nHourly NI this week\nNEST Pension Gross to Date Tax to date\nNI to date\n1000.00 150.00 25.00 45.50 40.00 52000.00 7800.00 2366.00')
  assert.equal(figures.weekly.grossPay, undefined)
  assert.equal(figures.weekly.taxPaid, undefined)
  assert.equal(figures.yearToDate.grossPay, undefined)
  assert.equal(figures.yearToDate.niPaid, undefined)
})

test('rejects unrelated documents, dates, missing amounts and supports tax refunds', () => {
  assert.equal(parseWeeklyPayslip('P60 Pay for income tax purposes 52000.00'), null)
  assert.deepEqual(parseWeeklyPayslip('Gross Pay this week\nTax this week -25.00\nNI this week 00.00'), {
    weekly: { taxPaid: -25, niPaid: 0 }, yearToDate: {},
  })
  assert.equal(parseWeeklyPayslip('Gross Pay this week 05/04/2026').weekly.grossPay, undefined)
})
