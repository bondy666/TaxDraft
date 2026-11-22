import test from 'node:test'
import assert from 'node:assert/strict'
import { findPropertyMentions, propertyNameFromFileName, resolvePropertyNames, sameProperty } from './propertyDiscovery.ts'

const names = (text, existing) => resolvePropertyNames(findPropertyMentions(text), existing)

test('properties are named from flat numbers, Re/Property/Ref labels and invoice lines', () => {
  assert.deepEqual(names('Re: Flat 4, Pearl Chambers, Leeds - Professional Negligence'), ['Pearl Chambers'])
  assert.deepEqual(names('ISSUE DATE: 09 May 2025 PROPERTY: Pearl Chambers'), ['Pearl Chambers'])
  assert.deepEqual(names('FASTER PAYMENTS RECEIPT REF.4 PEARL CHAMBERS FROM NORTH PROPERTY'), ['Pearl Chambers'])
  assert.deepEqual(names('Flt 4 Pearl Chambers. New Post Box Key 100 soo'), ['Pearl Chambers'])
  assert.deepEqual(names('RENT - Flat 21, 71E Drayton Park & Car Space'), ['Drayton Park'])
})

test('home addresses, lenders, agents and cities are not properties', () => {
  assert.deepEqual(names('Mr Simon James Bond & Mrs Josephina Bond\n8 Birkbeck Road\nLondon W5 4ES'), [])
  assert.deepEqual(names('FASTER PAYMENTS RECEIPT REF.OPENRENT P496702 FROM OPENRENT LTD SW'), [])
  assert.deepEqual(names('Property Ref: 2648363 (22 East Parade, 22, Flat 4, Leeds, LS1 2BH)'), [])
  assert.deepEqual(names('NATWEST BANK MORTGAGE\nHALIFAX MORTGAGE'), [])
})

test('a repeated partial name from bank references merges into the full name from invoices', () => {
  const rent = 'FASTER PAYMENTS RECEIPT REF.FLAT21 71E DRAYTON FROM NG L K\n'
  assert.deepEqual(names(rent), [])
  assert.deepEqual(names(rent.repeat(3)), ['Drayton'])
  assert.deepEqual(names(`${rent.repeat(12)}Flat 21, 71E Drayton Park`), ['Drayton Park'])
  assert.deepEqual(names(rent.repeat(12), ['Drayton Park', 'Pearl Chambers']), ['Drayton Park'])
  assert.ok(sameProperty('Drayton', 'Drayton Park'))
  assert.ok(sameProperty('PearlChambers', 'Pearl Chambers'))
  assert.ok(!sameProperty('Pearl Chambers', 'Drayton Park'))
})

test('file names can name a property', () => {
  assert.equal(propertyNameFromFileName('Expenses_DraytonPark.docx'), 'Drayton Park')
  assert.equal(propertyNameFromFileName('Expenses_PearlChambers.docx'), 'Pearl Chambers')
  assert.equal(propertyNameFromFileName('Expenses.docx'), undefined)
  assert.equal(propertyNameFromFileName('Personal_Bank_25-26.csv'), undefined)
})
