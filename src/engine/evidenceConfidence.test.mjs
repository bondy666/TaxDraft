import test from 'node:test'
import assert from 'node:assert/strict'
import { evidenceTier, findSourceExcerpt } from './evidenceConfidence.ts'

test('OCR-derived figures always require confirmation; otherwise confidence sets the tier', () => {
  assert.equal(evidenceTier({ confidence: 'high', ocr: true }), 'confirm')
  assert.equal(evidenceTier({ confidence: 'high' }), 'recognised')
  assert.equal(evidenceTier({ confidence: 'medium' }), 'probable')
  assert.equal(evidenceTier({ confidence: 'low' }), 'confirm')
})

test('source excerpt finds formatted amounts but not partial numbers', () => {
  const text = 'Account 12345678\nGross interest paid 1,234.56 for the year\nTotal 31234.567'
  assert.match(findSourceExcerpt(text, [1234.56]), /Gross interest paid 1,234\.56 for the year/)
  assert.equal(findSourceExcerpt('Ref 91234.56', [1234.56]), undefined)
  assert.equal(findSourceExcerpt('Ref 1234.567', [1234.56]), undefined)
  assert.match(findSourceExcerpt('Dividends received £250 in total', [undefined, 250]), /£250 in total/)
  assert.equal(findSourceExcerpt('Nothing here', [0, undefined]), undefined)
})

test('long source text is trimmed around the match', () => {
  const excerpt = findSourceExcerpt(`${'a'.repeat(200)} Tax 500.00 ${'b'.repeat(200)}`, [500], 10)
  assert.equal(excerpt, '…aaaaa Tax 500.00 bbbbbbbbb…')
})
