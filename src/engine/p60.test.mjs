import test from 'node:test'
import assert from 'node:assert/strict'
import { extractP60 } from './p60.ts'

const word = (str, x, y) => ({ str, transform: [1, 0, 0, 1, x, y] })
const fixture = [
  word('P60 End of Year Certificate', 44, 797),
  word('Tax year to 5 April', 43, 776), word('2026', 188, 776),
  word('Pay', 350, 684), word('Tax deducted', 450, 684),
  word('In previous', 262, 654), word('1000', 377, 649), word('00', 422, 649),
  word('200', 489, 649), word('00', 528, 649),
  word('In this', 262, 619), word('employment', 262, 611),
  word('50000', 377, 613), word('25', 422, 613),
  word('8000', 489, 613), word('50', 528, 613),
  word('Total for year', 262, 579), word('51000', 377, 578), word('25', 422, 578),
  word('8200', 489, 578), word('50', 528, 578),
]
test('P60 uses current employment pounds/pence rather than previous or total rows', () => {
  assert.deepEqual(extractP60(fixture), { pay: 50000.25, tax: 8000.5, taxYearId: '2025-26' })
})
test('missing or ambiguous columns do not produce automatic figures', () => {
  assert.equal(extractP60(fixture.filter((item) => item.str !== 'Tax deducted')), null)
  assert.equal(extractP60([...fixture, word('123', 390, 613)]), null)
  assert.equal(extractP60(fixture.filter((item) => item.str !== '2026')), null)
})
