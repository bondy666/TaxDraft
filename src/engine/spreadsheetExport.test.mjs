import test from 'node:test'
import assert from 'node:assert/strict'
import * as XLSX from '@e965/xlsx'
import { createTaxWorkbook } from './spreadsheetExport.ts'
import { importTaxWorkbook } from './spreadsheetImport.ts'

const bankSource = { id: 'bank', fileName: 'bank.csv', taxYearId: '2025-26', recordedAmount: 60, evidence: '10/05/2025: Charity (GBP 60)', verified: false, groupKey: 'bank:giftAid' }
const expense = { id: 'cost', source: 'costs.xlsx / Flat', row: 2, date: '01/05/2025', description: 'Repair', amount: 200, allowableAmount: 100, treatment: 'runningCost', reason: 'Partial business amount' }
const data = {
  taxYearId: '2025-26',
  personal: { name: '=SUM(1,2)', maritalStatus: 'single', isScottishTaxpayer: false, isBlind: false, numberOfChildren: 0, claimsChildBenefit: false, childBenefitAnnualAmount: 0, hasStudentLoan: false, studentLoanPlan: 'none' },
  personalSources: { name: 'Document evidence' },
  employments: [{ id: 'job', employer: 'Example employer', p60Pay: 30000, benefitsInKind: 100, taxDeducted: 3500, p60Source: { id: 'p60', fileName: 'P60.pdf', verified: true } }],
  properties: [{ id: 'flat', name: 'Flat', ownershipShare: 0.5, rentalIncome: 1000, allowableExpenses: 500, mortgageInterest: 80, interestOnlyMortgage: true, expenseReconciliation: 400, documentSources: ['costs'], documentNote: 'Verify', documentVerified: false,
    rentalIncomeEvidence: [{ id: 'rent-row', source: 'bank.csv', description: 'Rent from tenant', date: '01/05/2025', amount: 1000, treatment: 'added', basis: 'unclassifiedIncome' }],
    expenseEvidence: [expense, { ...expense, id: 'interest', treatment: 'interest', allowableAmount: 80 }],
    bankEvidence: [{ label: 'Mortgage', incoming: 0, outgoing: 700, kind: 'mortgage', includedInRent: false }] }],
  savings: [{ id: 'savings', source: 'Bank', amount: 5, bankSource }],
  dividends: [{ id: 'dividend', source: 'Shares', amount: 30 }],
  pensions: [{ id: 'pension', source: 'Pension scheme', amount: 2000, taxDeducted: 100 }],
  other: [{ id: 'other', description: 'Unclassified receipt', amount: 0, bankSource }],
  reliefs: { personalPensionContributionsNet: 80, giftAidNet: 40 },
  bankReliefCandidates: [{ kind: 'giftAid', claimedAmount: 40, source: bankSource }],
  privatePensionRecipients: ['Example Life'], charitableDonationRecipients: ['Local Help'],
}
const computation = {
  totalNonSavingsIncome: 32550, totalSavingsIncome: 5, totalDividendIncome: 30, totalIncome: 32585,
  extension: 150, adjustedNetIncome: 32435, personalAllowanceTaper: 0, personalAllowanceAvailable: 12570,
  nonSavingsTaxable: 19980, savingsTaxable: 5, dividendsTaxable: 30,
  nonSavingsBands: [{ band: 'basic', amount: 19980, rate: 0.2, tax: 3996 }],
  savingsBands: [{ band: 'psa', amount: 5, rate: 0, tax: 0 }],
  dividendBands: [{ band: 'dividendAllowance', amount: 30, rate: 0, tax: 0 }],
  incomeTaxBeforeReducers: 3996, financeCostReducer: 8, marriageAllowanceReducer: 0, incomeTaxDue: 3988,
  taxDeductedAtSource: 3600, balanceDueOrRefund: 388, highIncomeChildBenefitCharge: 0,
}
const rates = { id: '2025-26', label: '2025/26', rates: { basic: 0.2, higher: 0.4, additional: 0.45 }, personalAllowance: 12570 }
const flags = [{ id: 'review', severity: 'check', title: 'Check donations', detail: 'Confirm a declaration' }]
const transaction = { id: 'payment', source: 'bank.csv', date: new Date(2025, 4, 10), description: 'Local Help', amount: -60 }
const documents = {
  taxYearId: '2025-26', files: [{ name: 'bank.csv', relativePath: 'Tax/bank.csv', size: 500 }],
  suggestions: [{ id: 'suggestion', kind: 'giftAid', fileName: 'donations.pdf', title: 'Review donations', amount: 25, selected: false, confidence: 'low', detail: 'Unconfirmed' }],
  charityCandidates: [{ id: 'local help', recipient: 'local help', confidence: 'monthlyReview', selected: false, reason: 'Monthly payments', total: 60, payments: [transaction] }],
  bankTransactions: [transaction], warnings: ['Check overlapping exports'], progress: 'Analysis complete', error: 'Example analysis error',
}
const rows = (workbook, name) => XLSX.utils.sheet_to_json(workbook.Sheets[name], { defval: '' })

test('exports all return sections, evidence, computation, checks and current document selections to valid XLSX', () => {
  const original = JSON.stringify({ data, computation, documents })
  const workbook = createTaxWorkbook(data, computation, rates, flags, documents, new Date('2026-11-07T00:00:00Z'))
  const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
  const restored = XLSX.read(bytes, { type: 'buffer' })
  assert.equal(restored.SheetNames.length, 26)
  assert.equal(rows(restored, 'Employment')[0]['P60 Pay'], 30000)
  assert.equal(rows(restored, 'Employment')[0]['P60 Source / Verified'], true)
  assert.equal(rows(restored, 'Properties')[0]['Allowable Expenses'], 500)
  assert.equal(rows(restored, 'Properties')[0]['Included Expenses'], 100)
  assert.equal(rows(restored, 'Properties')[0]['Your Profit'], 450)
  assert.equal(rows(restored, 'Properties')[0]['Expense Reconciliation'], 400)
  assert.equal(rows(restored, 'Property expenses')[1]['Included Running Expense'], 0)
  assert.equal(rows(restored, 'Property bank references')[0]['Outgoing'], 700)
  assert.equal(rows(restored, 'Rental income evidence')[0]['Treatment'], 'added')
  assert.equal(rows(restored, 'Rental income evidence')[0]['Basis'], 'unclassifiedIncome')
  assert.equal(rows(restored, 'Rental income evidence')[0]['Property'], 'Flat')
  assert.equal(rows(restored, 'Savings interest')[0]['Bank Source / Evidence'], bankSource.evidence)
  assert.equal(rows(restored, 'Other income')[0]['Amount'], 0)
  assert.equal(rows(restored, 'Other income')[0]['Bank Source / Recorded Amount'], 60)
  assert.equal(rows(restored, 'Dividends')[0]['Amount'], 30)
  assert.equal(rows(restored, 'Pension income')[0]['Tax Deducted'], 100)
  assert.equal(rows(restored, 'Pension and Gift Aid')[1]['Net Claimed'], 40)
  assert.equal(rows(restored, 'Pension and Gift Aid')[1]['Gross'], 50)
  assert.equal(rows(restored, 'Bank relief review')[0]['Source / Recorded Amount'], 60)
  assert.equal(rows(restored, 'Bank relief review')[0]['Claimed Amount'], 40)
  assert.equal(rows(restored, 'Recipient settings').length, 2)
  assert.equal(rows(restored, 'Computation').find((row) => row.Item === 'Balance Due Or Refund').Amount, 388)
  assert.equal(rows(restored, 'Tax bands')[0].Rate, 0.2)
  assert.equal(rows(restored, 'Tax year rates').find((row) => row.Item === 'Rates / Higher').Value, 0.4)
  assert.equal(rows(restored, 'Checks')[0].Detail, flags[0].detail)
  assert.equal(rows(restored, 'Selected documents')[0]['Relative Path'], 'Tax/bank.csv')
  assert.equal(rows(restored, 'Document suggestions')[0].Selected, false)
  assert.equal(rows(restored, 'Likely charities')[0].Selected, false)
  assert.equal(rows(restored, 'Charity payment evidence')[0]['Selected For Evaluation'], false)
  assert.equal(rows(restored, 'Statement transactions')[0].Date, '2025-05-10')
  assert.equal(rows(restored, 'Document warnings').length, 2)
  assert.equal(JSON.stringify({ data, computation, documents }), original)
})

test('business status and invoice review survive spreadsheet export and import', () => {
  const business = {
    status: 'both', taxMode: 'company', soleTraderBasis: 'traditional', companyStart: '2025-04-01', companyEnd: '2026-03-31',
    companySimpleCase: true, invoices: [
      { id: 'one', business: 'soleTrader', kind: 'income', source: 'invoice.pdf', sourceHash: 'abc', date: '2025-06-01', amount: 1200, confirmed: true },
      { id: 'two', business: 'company', kind: 'expense', source: 'Manual entry', date: '', amount: 0, confirmed: false },
    ],
  }
  assert.deepEqual(importTaxWorkbook(createTaxWorkbook({ ...data, business }, computation, rates, flags)).business, business)
  const old = createTaxWorkbook(data, computation, rates, flags)
  delete old.Sheets['Business settings']
  delete old.Sheets['Business invoices']
  assert.equal(importTaxWorkbook(old).business, undefined)
})

test('imports editable return sections and property evidence from an exported workbook', () => {
  const imported = importTaxWorkbook(createTaxWorkbook(data, computation, rates, flags, documents))
  assert.equal(imported.taxYearId, data.taxYearId)
  assert.deepEqual(imported.personal, data.personal)
  assert.deepEqual(imported.personalSources, data.personalSources)
  assert.equal(imported.employments[0].p60Pay, 30000)
  assert.deepEqual(imported.employments[0].p60Source, data.employments[0].p60Source)
  assert.equal(imported.properties[0].name, 'Flat')
  assert.equal(imported.properties[0].allowableExpenses, 500)
  assert.equal(imported.properties[0].expenseReconciliation, 400)
  assert.equal(imported.properties[0].interestOnlyMortgage, true)
  assert.deepEqual(imported.properties[0].expenseEvidence, data.properties[0].expenseEvidence)
  assert.deepEqual(imported.properties[0].bankEvidence, data.properties[0].bankEvidence)
  assert.deepEqual(imported.properties[0].rentalIncomeEvidence, data.properties[0].rentalIncomeEvidence)
  assert.deepEqual(imported.savings, data.savings)
  assert.deepEqual(imported.dividends, data.dividends)
  assert.deepEqual(imported.pensions, data.pensions)
  assert.deepEqual(imported.other, data.other)
  assert.deepEqual(imported.reliefs, data.reliefs)
  assert.deepEqual(imported.bankReliefCandidates, data.bankReliefCandidates)
  assert.deepEqual(imported.privatePensionRecipients, data.privatePensionRecipients)
  assert.deepEqual(imported.charitableDonationRecipients, data.charitableDonationRecipients)
})

test('imports edited workbook values and rejects incomplete workbooks', () => {
  const workbook = createTaxWorkbook(data, computation, rates, flags)
  workbook.Sheets.Employment.B2.v = 32000
  assert.equal(importTaxWorkbook(workbook).employments[0].p60Pay, 32000)

  delete workbook.Sheets.Personal
  assert.throws(() => importTaxWorkbook(workbook), /missing the "Personal" worksheet/)
})

test('user-supplied formula-like text stays plain text and long evidence is exported completely', () => {
  const longText = 'Evidence '.repeat(10000)
  const workbook = createTaxWorkbook({ ...data, properties: [{ ...data.properties[0], documentNote: longText }] }, computation, rates, flags)
  const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
  const restored = XLSX.read(bytes, { type: 'buffer' })
  assert.equal(restored.Sheets.Personal.B2.t, 's')
  assert.equal(restored.Sheets.Personal.B2.v, '=SUM(1,2)')
  assert.equal(restored.Sheets.Personal.B2.f, undefined)
  const property = rows(restored, 'Properties')[0]
  const reconstructed = Object.entries(property).filter(([key]) => key.startsWith('Document Note')).map(([, value]) => value).join('')
  assert.equal(reconstructed, longText)
})

test('no-document and wrong-year snapshots are explicitly omitted, with empty section headers intact', () => {
  const workbook = createTaxWorkbook({ ...data, employments: [] }, computation, rates, [], { ...documents, taxYearId: '2024-25' })
  assert.deepEqual(rows(workbook, 'Statement transactions'), [])
  assert.deepEqual(rows(workbook, 'Likely charities'), [])
  assert.equal(workbook.Sheets.Employment.A1.v, 'Employer')
  assert.match(rows(workbook, 'Read me').find((row) => row.Item === 'Documents').Value, /No current document analysis/)
})

test('invalid non-finite numeric input fails explicitly rather than producing a misleading export', () => {
  assert.throws(() => createTaxWorkbook({ ...data, savings: [{ id: 'bad', source: 'Bank', amount: NaN }] }, computation, rates, flags), /non-finite number/)
})
