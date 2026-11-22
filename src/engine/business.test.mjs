import test from 'node:test'
import assert from 'node:assert/strict'
import { corporationEstimate, corporationEstimateIssues, emptyBusiness, isCompanyMode, soleTraderTotals } from './business.ts'
import { calculateTax } from './calculateTax.ts'
import { buildReviewChecklist } from './reviewChecklist.ts'
import { TAX_YEARS } from '../data/taxYears.ts'

const invoice = (id, business, kind, date, amount, confirmed = true) =>
  ({ id, business, kind, date, amount, confirmed, source: id })

test('only confirmed sole trader entries in the selected tax year affect personal tax', () => {
  const business = { ...emptyBusiness(), status: 'both', invoices: [
    invoice('sale', 'soleTrader', 'income', '2025-04-06', 30000),
    invoice('expense', 'soleTrader', 'expense', '2026-04-05', 5000),
    invoice('pending', 'soleTrader', 'income', '2025-06-01', 9000, false),
    invoice('outside', 'soleTrader', 'income', '2026-04-06', 9000),
    invoice('company', 'company', 'income', '2025-06-01', 100000),
  ] }
  assert.deepEqual(soleTraderTotals(business, '2025-26'), { income: 30000, expenses: 5000, profit: 25000 })
  const data = { taxYearId: '2025-26', business, employments: [], properties: [], pensions: [], other: [],
    savings: [], dividends: [], reliefs: { personalPensionContributionsNet: 0, giftAidNet: 0 },
    personal: { claimsChildBenefit: false, childBenefitAnnualAmount: 0 } }
  const result = calculateTax(data, TAX_YEARS['2025-26'])
  assert.equal(result.totalIncome, 25000)
  assert.equal(result.incomeTaxDue, 2486)
  assert.equal(result.taxDeductedAtSource, 0)
  const loss = { ...business, invoices: [invoice('loss', 'soleTrader', 'expense', '2025-05-01', 5000)] }
  assert.equal(calculateTax({ ...data, business: loss }, TAX_YEARS['2025-26']).totalIncome, 0)
  assert.equal(calculateTax({ ...data, business: { ...business, status: 'company' } }, TAX_YEARS['2025-26']).totalIncome, 0)
})

test('company estimate uses small, marginal and main rates only for eligible full years', () => {
  const business = { ...emptyBusiness(), status: 'company', companyStart: '2025-04-01', companyEnd: '2026-03-31', companySimpleCase: true }
  for (const [profit, tax] of [[50000, 9500], [100000, 22750], [250000, 62500]]) {
    assert.equal(corporationEstimate({ ...business, invoices: [invoice('sale', 'company', 'income', '2025-04-01', profit)] }).tax, tax)
  }
  assert.equal(corporationEstimate({ ...business, companyEnd: '2025-12-31' }), null)
  assert.equal(corporationEstimate({ ...business, companySimpleCase: false }), null)
  assert.equal(corporationEstimate({ ...business, companyStart: '2027-04-01', companyEnd: '2028-03-31' }), null)
  assert.equal(corporationEstimate({ ...business, invoices: [invoice('loss', 'company', 'expense', '2026-03-31', 1000)] }).tax, 0)
  assert.equal(corporationEstimate({ ...business, invoices: [invoice('sale', 'company', 'income', '2025-04-01', 100000)] }).marginalRelief, 2250)
  assert.deepEqual(corporationEstimateIssues({ ...business, companyEnd: '2025-12-31', companySimpleCase: false }), [
    'The accounting period must be exactly 12 months.', 'Confirm that your company is a simple case.',
  ])
})

test('personal tax is the default; company mode only applies when a company exists and is chosen', () => {
  const company = { ...emptyBusiness(), status: 'company' }
  assert.equal(isCompanyMode({ business: company }), false)
  assert.equal(isCompanyMode({ business: { ...company, taxMode: 'company' } }), true)
  assert.equal(isCompanyMode({ business: { ...company, status: 'soleTrader', taxMode: 'company' } }), false)
  assert.equal(isCompanyMode({}), false)
})

test('review list asks only for records relevant to the tax being worked out', () => {
  const data = { taxYearId: '2025-26', employments: [], properties: [], pensions: [], other: [], savings: [], dividends: [],
    reliefs: { personalPensionContributionsNet: 0, giftAidNet: 0 },
    personal: { name: '', claimsChildBenefit: false, childBenefitAnnualAmount: 0 },
    business: { ...emptyBusiness(), status: 'company' } }
  const flags = [{ id: 'flag', severity: 'check', title: 'Personal relief', detail: '' }]
  const personal = buildReviewChecklist(data, flags).map((item) => item.id)
  assert.ok(personal.includes('personal-name'))
  assert.ok(!personal.some((id) => id.startsWith('business-records')))
  const company = buildReviewChecklist({ ...data, business: { ...data.business, taxMode: 'company' } }, flags).map((item) => item.id)
  assert.deepEqual(company, ['business-records-company', 'business-company-estimate', 'business-company-tax'])
})
