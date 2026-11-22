import test from 'node:test'
import assert from 'node:assert/strict'
import { unexpectedZeroAmounts } from './zeroAmounts.ts'

const base = {
  taxYearId: '2025-26', employments: [], properties: [], savings: [], dividends: [], pensions: [], other: [],
  reliefs: { personalPensionContributionsNet: 0, giftAidNet: 0 },
  personal: { name: 'Test', claimsChildBenefit: false, childBenefitAnnualAmount: 0 },
}
const ids = (data) => unexpectedZeroAmounts({ ...base, ...data }).map((item) => item.id)

test('zero amounts that look like mistakes are highlighted', () => {
  assert.deepEqual(ids({ employments: [{ id: 'e', employer: 'Acme', p60Pay: 0, taxDeducted: 500, benefitsInKind: 0 }] }), ['zero-employment-e'])
  assert.deepEqual(ids({ savings: [{ id: 's', source: 'Bank', amount: 0, bankSource: { recordedAmount: 12 } }] }), ['zero-interest-s'])
  assert.deepEqual(ids({ properties: [{
    id: 'p', name: 'Elm Court', rentalIncome: 0, allowableExpenses: 0, mortgageInterest: 0,
    expenseEvidence: [{ id: 'x', description: 'Repair', date: '01/05/2025', amount: 0, allowableAmount: 0, treatment: 'review' }],
    bankEvidence: [{ label: 'HALIFAX', incoming: 0, outgoing: 0, kind: 'mortgage' }],
  }] }), ['zero-expenses-p', 'zero-bank-p', 'zero-rent-p'])
})

test('expected zeros are not highlighted', () => {
  assert.deepEqual(ids({
    // Bank receipts start at £0 until payers are ticked; an excluded cost has a recorded amount; an empty unallocated entry is not a property.
    other: [{ id: 'o', description: 'Money paid in', amount: 0, bankSource: { recordedAmount: 500 }, receipts: [{ id: 'r' }] }],
    properties: [
      { id: 'p', name: 'Elm Court', rentalIncome: 9000, allowableExpenses: 0, mortgageInterest: 0,
        expenseEvidence: [{ id: 'x', description: 'Repair', amount: 200, allowableAmount: 0, treatment: 'review' }] },
      { id: 'u', name: 'Unallocated expenses: costs.docx', rentalIncome: 0, allowableExpenses: 0, mortgageInterest: 0,
        expenseEvidence: [{ id: 'y', description: 'Insurance', amount: 90, allowableAmount: 0, treatment: 'review' }] },
    ],
  }), [])
})
