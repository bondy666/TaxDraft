import test from 'node:test'
import assert from 'node:assert/strict'
import { extractPersonalEvidence } from './personalEvidence.ts'

test('explicit documentation can propose every personal form field', () => {
  const results = extractPersonalEvidence(`Employee name: Example Person
Marital status: Civil partnership
Scottish taxpayer: Yes
Registered blind: No
Number of children: 2
Claiming Child Benefit: Yes
Annual Child Benefit received: £2,000.00
Has student loan: Yes
Student loan plan: Plan 2`)
  assert.deepEqual(Object.assign({}, ...results.map((item) => item.patch)), {
    name: 'Example Person', maritalStatus: 'civilPartnership', isScottishTaxpayer: true,
    isBlind: false, numberOfChildren: 2, claimsChildBenefit: true,
    childBenefitAnnualAmount: 2000, hasStudentLoan: true, studentLoanPlan: 'plan2',
  })
  assert.equal(results.length, 9)
  assert.ok(results.every((item) => item.evidence && item.label))
})

test('does not infer personal circumstances from mentions, address or absence', () => {
  assert.deepEqual(extractPersonalEvidence(`Employer: Scottish Business
Address: Edinburgh
Marriage Allowance guidance
Child Benefit leaflet
NI number: EXAMPLE
Student loan deduction 25.00`), [])
  assert.deepEqual(extractPersonalEvidence(''), [])
})

test('preserves conflicting explicit evidence for review instead of silently choosing', () => {
  const results = extractPersonalEvidence('Marital status: Single\nMarital status: Married')
  assert.equal(results.length, 2)
  assert.deepEqual(results.map((item) => item.patch.maritalStatus), ['single', 'married'])
})
