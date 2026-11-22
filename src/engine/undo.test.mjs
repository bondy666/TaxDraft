import test from 'node:test'
import assert from 'node:assert/strict'
import { MAX_UNDO, pushUndo, reinsertListItem, removalLabel, restoreField, restoreProperty } from './undo.ts'

const base = {
  employments: [{ id: 'a', employer: 'Acme' }, { id: 'b', employer: 'Beta' }],
  properties: [{ id: 'p', name: 'Pearl Chambers', rentalIncome: 5000, rentalIncomeEvidence: [{ id: 'r' }] }],
  charitableDonationRecipients: ['Goshcc', 'Plan International'],
}

test('a removed card returns to its original position, keeping edits made since removal', () => {
  const removed = base.employments[0]
  const afterRemoval = { ...base, employments: [{ id: 'b', employer: 'Beta (edited)' }] }
  const restored = reinsertListItem('employments', removed, 0)(afterRemoval)
  assert.deepEqual(restored.employments.map((item) => item.employer), ['Acme', 'Beta (edited)'])
  assert.equal(reinsertListItem('employments', removed, 0)(restored), restored)
  assert.equal(removalLabel('employments', removed), 'Removed employment “Acme”')
  assert.equal(removalLabel('savings', { id: 'x', source: '' }), 'Removed interest entry')
})

test('removed receipts and recipient names can be restored', () => {
  const previous = base.properties[0]
  const changed = { ...base, properties: [{ ...previous, rentalIncome: 0, rentalIncomeEvidence: [] }] }
  assert.deepEqual(restoreProperty(previous)(changed).properties, [previous])
  const withoutName = { ...base, charitableDonationRecipients: ['Goshcc'] }
  assert.deepEqual(restoreField('charitableDonationRecipients', base.charitableDonationRecipients)(withoutName).charitableDonationRecipients,
    ['Goshcc', 'Plan International'])
})

test('undo history keeps the most recent changes only', () => {
  let stack = []
  for (let id = 1; id <= MAX_UNDO + 5; id += 1) stack = pushUndo(stack, { id, label: `change ${id}`, restore: (d) => d })
  assert.equal(stack.length, MAX_UNDO)
  assert.equal(stack[0].id, 6)
  assert.equal(stack.at(-1).id, MAX_UNDO + 5)
})
