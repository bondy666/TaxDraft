import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateTax } from './calculateTax.ts'
import { TAX_YEARS } from '../data/taxYears.ts'

const emptyData = {
  employments: [], properties: [], pensions: [], other: [], savings: [], dividends: [],
  reliefs: { personalPensionContributionsNet: 0, giftAidNet: 0 },
  personal: { claimsChildBenefit: false, childBenefitAnnualAmount: 0 },
}

test('unallocated rental aggregates do not affect tax until reconciled to a named property', () => {
  const rates = TAX_YEARS['2025-26']
  const pending = {
    id: 'legacy-rent', name: 'Unallocated rental income', ownershipShare: 1,
    rentalIncome: 7800, allowableExpenses: 0, mortgageInterest: 2000,
  }
  assert.deepEqual(calculateTax({ ...emptyData, properties: [pending] }, rates), calculateTax(emptyData, rates))
})
