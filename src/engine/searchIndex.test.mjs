import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSearchIndex, searchEntries } from './searchIndex.ts'

const data = {
  taxYearId: '2025-26',
  personal: { name: 'Simon', maritalStatus: 'married', isScottishTaxpayer: false, isBlind: false, numberOfChildren: 0,
    claimsChildBenefit: false, childBenefitAnnualAmount: 0, hasStudentLoan: false, studentLoanPlan: 'none' },
  employments: [{ id: 'e', employer: 'Acme', p60Pay: 50000, taxDeducted: 7486, benefitsInKind: 0 }],
  properties: [{ id: 'd', name: 'Drayton Park', ownershipShare: 0.5, rentalIncome: 25200, allowableExpenses: 0, mortgageInterest: 0,
    rentalIncomeEvidence: [{ id: 'r', date: '01/05/2025', description: 'FLAT21 DRAYTON FROM NG L K', amount: 2100, treatment: 'added', source: 'Bank.csv' }] }],
  savings: [], dividends: [], pensions: [], other: [],
  reliefs: { personalPensionContributionsNet: 0, giftAidNet: 0 },
  charitableDonationRecipients: ['Goshcc'],
}
const result = {
  totalIncome: 62600, totalNonSavingsIncome: 62600, totalSavingsIncome: 0, totalDividendIncome: 0, adjustedNetIncome: 62600,
  personalAllowanceAvailable: 12570, incomeTaxBeforeReducers: 12000, financeCostReducer: 0, incomeTaxDue: 12000,
  taxDeductedAtSource: 7486, highIncomeChildBenefitCharge: 0, balanceDueOrRefund: 4514,
}
const documents = {
  taxYearId: '2025-26', files: [{ name: 'Personal_Bank.csv', relativePath: 'Simon/Personal_Bank.csv', size: 1 }],
  suggestions: [], warnings: [], progress: '', error: '',
  charityCandidates: [{ id: 'c', recipient: 'Plan International', reason: 'Same £10.00 every month', confidence: 'likely', total: 120, payments: [] }],
  bankTransactions: [{ id: 't', date: new Date(2025, 4, 12), description: 'PLAN INTERNATIONAL DD', amount: -10, source: 'Personal_Bank.csv' }],
}
const index = buildSearchIndex(data, result, [{ id: 'f', severity: 'check', title: 'Check Marriage Allowance', detail: 'Spouse income' }], [], documents)

test('search covers return data, document analysis, checks and computation, linking each to its tab', () => {
  const tabs = (query) => searchEntries(index, query).results.map((item) => item.tab)
  assert.ok(tabs('drayton').includes('Income'))
  assert.ok(tabs('plan international').includes('Documents'))
  assert.ok(tabs('marriage').includes('Reliefs'))
  assert.ok(tabs('balance due').includes('Computation'))
  assert.ok(tabs('goshcc').includes('Documents'))
})

test('amounts match with or without thousands separators, and all words must match', () => {
  assert.ok(searchEntries(index, '25,200').results.some((item) => item.title === 'Drayton Park'))
  assert.ok(searchEntries(index, '25200').results.some((item) => item.title === 'Drayton Park'))
  assert.equal(searchEntries(index, 'drayton goshcc').total, 0)
  assert.equal(searchEntries(index, '   ').total, 0)
})

test('title matches rank above detail-only matches; analysis from another tax year is excluded', () => {
  const [first] = searchEntries(index, 'drayton').results
  assert.equal(first.title, 'Drayton Park')
  const otherYear = buildSearchIndex(data, result, [], [], { ...documents, taxYearId: '2024-25' })
  assert.equal(searchEntries(otherYear, 'plan international').total, 0)
})
