import test from 'node:test'
import assert from 'node:assert/strict'
import { buildDocumentChecklist } from './documentChecklist.ts'
import { emptyBusiness } from './business.ts'

const base = {
  taxYearId: '2025-26', employments: [], properties: [], pensions: [], other: [], savings: [], dividends: [],
  reliefs: { personalPensionContributionsNet: 0, giftAidNet: 0 },
  personal: { name: '', claimsChildBenefit: false, childBenefitAnnualAmount: 0 },
}
const need = (checklist, id) => checklist.items.find((item) => item.id === id)

test('documents become needed only when the return shows they apply, and are marked found from file names', () => {
  const employed = buildDocumentChecklist({ ...base, employments: [{ id: 'e', employer: 'A', p60Pay: 1, taxDeducted: 0, benefitsInKind: 0 }] }, [])
  assert.equal(need(employed, 'p60').need, 'needed')
  assert.equal(need(employed, 'p60').found, false)
  assert.equal(need(employed, 'lettings').need, 'optional')
  assert.equal(need(buildDocumentChecklist(base, ['Acme P60 2026.pdf']), 'p60').found, true)
  assert.equal(need(buildDocumentChecklist(base, ['Pension contributions.pdf']), 'other-pension').found, false)
})

test('invoices prompt the self-employment question, and are not needed when the user has no sole-trade business', () => {
  assert.equal(buildDocumentChecklist(base, ['Invoice 001.pdf']).askAboutBusiness, true)
  const none = buildDocumentChecklist({ ...base, business: { ...emptyBusiness(), status: 'none' } }, ['Invoice 001.pdf'])
  assert.equal(none.askAboutBusiness, false)
  assert.equal(need(none, 'business-records').need, 'notNeeded')
  const company = buildDocumentChecklist({ ...base, business: { ...emptyBusiness(), status: 'company' } }, ['Invoice 001.pdf'])
  assert.equal(need(company, 'business-records').need, 'notNeeded')
  const sole = buildDocumentChecklist({ ...base, business: { ...emptyBusiness(), status: 'soleTrader' } }, [])
  assert.equal(need(sole, 'business-records').need, 'needed')
})

test('company mode lists company records as needed and personal documents as not needed', () => {
  const checklist = buildDocumentChecklist({ ...base, business: { ...emptyBusiness(), status: 'company', taxMode: 'company' } },
    ['P60.pdf', 'Sales invoice 1.pdf'])
  assert.equal(checklist.companyMode, true)
  assert.equal(need(checklist, 'company-sales').found, true)
  assert.equal(need(checklist, 'company-costs').need, 'needed')
  assert.equal(need(checklist, 'p60').need, 'notNeeded')
  assert.equal(need(checklist, 'business-records'), undefined)
})
