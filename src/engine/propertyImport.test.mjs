import test from 'node:test'
import assert from 'node:assert/strict'
import {
  importProperty, allocateProperty, moveBankReference, reviewPropertyExpense, reconcileRentalIncomeCandidate,
  removeRentalIncomeEvidence, allocateToNewProperty, suggestPropertyName, refreshWordDocumentRows,
  possibleDuplicateExpenses, removePropertyExpenses,
} from './propertyImport.ts'
import { findRentalIncomeCandidates, findSimilarRentalCandidates, similarNameKey } from './bankTransactions.ts'

const suggestion = {
  kind: 'property', selected: true, propertyName: 'Flat A', fileName: 'costs.xlsx',
  propertySourceId: 'source-a', propertyTaxYearId: '2025-26', allowableExpenses: 200,
  detail: 'Check costs', id: 'suggestion', title: 'Property', confidence: 'low',
}
test('automatic property import is idempotent, tax-year guarded and preserves manual changes', () => {
  const first = importProperty([], suggestion, '2025-26', 'a')
  assert.equal(first[0].allowableExpenses, 200)
  assert.equal(first[0].documentVerified, false)
  first[0].allowableExpenses = 250
  assert.equal(importProperty(first, suggestion, '2025-26', 'b'), first)
  assert.deepEqual(importProperty([], suggestion, '2026-27', 'c'), [])
})
test('allocating mortgage evidence carries reference totals but never claims repayments or transfers', () => {
  const first = importProperty([], suggestion, '2025-26', 'a')
  const withBank = importProperty(first, { ...suggestion, propertyName: 'Unallocated mortgage',
    propertySourceId: 'bank', allowableExpenses: undefined,
    bankEvidence: [{ label: 'HALIFAX', kind: 'mortgage', incoming: 100, outgoing: 500 }],
  }, '2025-26', 'b')
  const result = allocateProperty(withBank, 'b', 'a', false)
  assert.equal(result.length, 1)
  assert.equal(result[0].allowableExpenses, 200)
  assert.equal(result[0].mortgageInterest, 0)
  assert.equal(result[0].rentalIncome, 0)
  assert.equal(result[0].bankEvidence[0].outgoing, 500)
  assert.equal(importProperty(result, { ...suggestion, propertySourceId: 'bank' }, '2025-26', 'c'), result)
})
test('confirmed rent allocates once, complementary costs combine and overlapping totals are blocked', () => {
  const costs = importProperty([], suggestion, '2025-26', 'a')
  const bankSuggestion = { ...suggestion, propertyName: 'Unallocated rent', propertySourceId: 'rent', allowableExpenses: undefined,
    bankEvidence: [{ label: 'FLAT', kind: 'possibleRent', incoming: 1000, outgoing: 0 }],
  }
  const withRent = importProperty(costs, bankSuggestion, '2025-26', 'b')
  const merged = allocateProperty(withRent, 'b', 'a', true)
  assert.equal(merged[0].rentalIncome, 1000)
  assert.equal(merged[0].bankEvidence[0].includedInRent, true)
  const empty = { ...merged[0], id: 'c', rentalIncome: 0, allowableExpenses: 0, bankEvidence: [], documentSources: [] }
  const moved = allocateProperty([...merged, empty], 'a', 'c', true)
  assert.equal(moved[0].rentalIncome, 1000)
  assert.throws(() => allocateProperty([...merged, { ...merged[0], id: 'd' }], 'a', 'd', true), /share document sources/)
})

test('rental-income review can add a confirmed amount or link it without adding it twice', () => {
  const target = { ...suggestion, id: 'property', name: 'Flat A', rentalIncome: 1200, allowableExpenses: 0,
    documentSources: ['annual-summary'] }
  const source = { ...suggestion, id: 'bank-rent', name: 'Unallocated rental receipts / costs',
    rentalIncome: 500, allowableExpenses: 0, documentSources: ['bank-export'] }
  assert.throws(() => allocateProperty([target, source], source.id, target.id, false), /Confirm that the unallocated/)
  const added = allocateProperty([target, source], source.id, target.id, true, false, 'additional')
  assert.equal(added.length, 1)
  assert.equal(added[0].rentalIncome, 1700)

  const linked = allocateProperty([target, source], source.id, target.id, true, false, 'alreadyIncluded')
  assert.equal(linked.length, 1)
  assert.equal(linked[0].rentalIncome, 1200)
  assert.throws(() => allocateProperty([target, source], source.id, target.id, true), /Both entries contain rentalIncome/)
})

test('rental suggestions group receipts by payer and reconcile source evidence without double counting', () => {
  const transactions = [
    { id: 'alice-1', sourceKey: 'file:sheet', source: 'Rent.xlsx / Sheet1', date: new Date('2025-05-01'), description: 'Rent from Alice', amount: 800 },
    { id: 'alice-2', sourceKey: 'file-2:sheet', source: 'Rent2.xlsx / Sheet1', date: new Date('2025-06-01'), description: 'Rent from Alice', amount: 800 },
    { id: 'bob-1', sourceKey: 'file:sheet', source: 'Rent.xlsx / Sheet1', date: new Date('2025-05-03'), description: 'Flat21 Bob', amount: 650 },
    { id: 'tenant-1', sourceKey: 'file:sheet', source: 'Rent.xlsx / Sheet1', date: new Date('2025-05-05'), description: 'J SMITH', amount: 720 },
    { id: 'outgoing', sourceKey: 'file:sheet', source: 'Rent.xlsx / Sheet1', date: new Date('2025-05-04'), description: 'Rent refund', amount: -50 },
    { id: 'transfer', sourceKey: 'file:sheet', source: 'Rent.xlsx / Sheet1', date: new Date('2025-05-06'), description: 'Transfer from savings', amount: 1000 },
  ]
  const candidates = findRentalIncomeCandidates(transactions)
  assert.equal(candidates.length, 3)
  const alice = candidates.find((candidate) => candidate.description === 'Rent from Alice')
  assert.equal(alice.total, 1600)
  assert.equal(alice.payments.length, 2)
  assert.equal(alice.sourceKeys.length, 2)
  assert.equal(candidates.find((candidate) => candidate.description === 'Flat21 Bob').confidence, 'possible')
  const otherTenant = candidates.find((candidate) => candidate.description === 'J SMITH')
  assert.equal(otherTenant.basis, 'unclassifiedIncome')
  assert.equal(otherTenant.total, 720)

  const target = { id: 'property', name: 'Pearl Chambers', rentalIncome: 1000, ownershipShare: 1 }
  const legacy = [
    { id: 'legacy', name: 'Unallocated rent', rentalIncome: 7800,
      allowableExpenses: 0, mortgageInterest: 0, documentSources: ['file:sheet:Pearl Chambers:2025-26'] },
    { id: 'legacy-2', name: 'Unallocated rent 2', rentalIncome: 400,
      allowableExpenses: 0, mortgageInterest: 0, documentSources: ['file-2:sheet:Pearl Chambers:2025-26'] },
  ]
  assert.throws(() => reconcileRentalIncomeCandidate([target, ...legacy], target.id, alice, 'additional'), /Confirm/)
  const replaced = reconcileRentalIncomeCandidate([target, ...legacy], target.id, alice, 'additional', true)
  assert.equal(replaced.length, 1)
  assert.equal(replaced[0].rentalIncome, 2600)
  assert.equal(replaced[0].rentalIncomeEvidence.length, 2)
  assert.equal(reconcileRentalIncomeCandidate(replaced, target.id, alice, 'additional'), replaced)

  const linked = reconcileRentalIncomeCandidate([target], target.id, alice, 'alreadyIncluded')
  assert.equal(linked[0].rentalIncome, 1000)
  assert.equal(linked[0].rentalIncomeEvidence.every((evidence) => evidence.treatment === 'alreadyIncluded'), true)
  const addedOtherTenant = reconcileRentalIncomeCandidate([target], target.id, otherTenant, 'additional')
  assert.equal(addedOtherTenant[0].rentalIncome, 1720)
  assert.equal(addedOtherTenant[0].rentalIncomeEvidence[0].basis, 'unclassifiedIncome')
  const duplicate = { ...alice, payments: [{ ...alice.payments[0], id: 'another-export' }] }
  assert.throws(() => reconcileRentalIncomeCandidate(linked, target.id, duplicate, 'additional'), /already attached/)
})

test('rental receipts group by payer despite per-payment references, and regular monthly amounts are flagged', () => {
  const receipt = (id, date, description, amount) => ({ id, sourceKey: 'bank', source: 'Bank.csv', date: new Date(date), description, amount })
  const candidates = findRentalIncomeCandidates([
    receipt('j1', '2025-05-02', 'FP J SMITH REF 448812 02/05', 720),
    receipt('j2', '2025-06-02', 'FP J SMITH REF 559903 02/06', 720),
    receipt('j3', '2025-07-03', 'FASTER PAYMENT J SMITH 03JUL 7781234', 720),
    receipt('j4', '2025-09-02', 'FP J SMITH REF 661120', 720),
    receipt('f4', '2025-05-04', 'Flat4 rent', 650),
    receipt('f21', '2025-05-04', 'Flat21 rent', 650),
    receipt('k1', '2025-05-10', 'K JONES', 300),
    receipt('k2', '2025-06-10', 'K JONES', 310),
  ])
  const smith = candidates.find((candidate) => candidate.id === 'j smith')
  assert.equal(smith.payments.length, 4)
  assert.deepEqual(smith.regular, { amount: 720, months: 3 })
  assert.equal(candidates.filter((candidate) => /^flat/.test(candidate.id)).length, 2)
  const jones = candidates.find((candidate) => candidate.id === 'k jones')
  assert.equal(jones.payments.length, 2)
  assert.equal(jones.regular, undefined)
})

test('property and payer details after REF keep different tenants in separate groups', () => {
  const receipt = (id, month, description, amount) => ({ id, sourceKey: 'bank', source: 'Bank.csv', date: new Date(2025, month, 1), description, amount })
  const candidates = findRentalIncomeCandidates([
    receipt('d1', 4, 'FASTER PAYMENTS RECEIPT REF.FLAT21 71E DRAYTON FROM NG L K', 2100),
    receipt('d2', 5, 'FASTER PAYMENTS RECEIPT REF.FLAT21 71E DRAYTON FROM NG L K', 2100),
    receipt('p1', 4, 'FASTER PAYMENTS RECEIPT REF.4 PEARL CHAMBERS FROM NORTH PROPERTY', 1189.56),
    receipt('p2', 5, 'FASTER PAYMENTS RECEIPT REF.4 PEARL CHAMBERS FROM NORTH PROPERTY', 1189.56),
    receipt('o1', 4, 'FASTER PAYMENTS RECEIPT REF.OPENRENT P496702 FROM OPENRENT LTD SW', 1300),
    receipt('o2', 5, 'FASTER PAYMENTS RECEIPT REF.OPENRENT P512345 FROM OPENRENT LTD SW', 1300),
  ])
  assert.equal(candidates.length, 3)
  assert.ok(candidates.every((candidate) => candidate.payments.length === 2))
  assert.deepEqual(candidates.find((candidate) => candidate.id.includes('drayton')).regular, { amount: 2100, months: 2 })
})

test('payers with a similar name are offered together, ignoring payment words, references and months', () => {
  assert.equal(similarNameKey('GATEWAY MAYFAIR LTD REF 123456 FLAT 4'), 'gateway mayfair')
  assert.equal(similarNameKey('FP GATEWAY MAYFAIR RENT JUNE'), 'gateway mayfair')
  assert.equal(similarNameKey('RENT FLAT 4 PEARL'), 'flat 4')
  assert.equal(similarNameKey('FLAT4 RENT'), 'flat 4')
  assert.equal(similarNameKey('FASTER PAYMENTS RECEIPT REF.FLAT21 71E DRAYTON FROM NG L K'), 'flat 21')
  assert.equal(similarNameKey('RENT'), '')
  const receipt = (id, description) => ({ id, sourceKey: 'bank', source: 'Bank.csv', date: new Date(2025, 4, 1), description, amount: 500 })
  const candidates = findRentalIncomeCandidates([
    receipt('g1', 'GATEWAY MAYFAIR LTD REF 123456'), receipt('g2', 'FP GATEWAY MAYFAIR RENT JUNE'),
    receipt('g3', 'GATEWAY MAYFAIR PROPERTY MGMT'), receipt('s1', 'J SMITH'),
  ])
  const gateway = candidates.find((candidate) => candidate.payments[0].id === 'g1')
  assert.deepEqual(findSimilarRentalCandidates(gateway, candidates).map((candidate) => candidate.payments[0].id).sort(), ['g2', 'g3'])
  assert.deepEqual(findSimilarRentalCandidates(candidates.find((candidate) => candidate.id === 'j smith'), candidates), [])
})

test('removing matched receipts reverses only amounts they added', () => {
  const target = { id: 'pearl', name: 'Pearl Chambers', rentalIncome: 5000, ownershipShare: 1, allowableExpenses: 0, mortgageInterest: 0,
    rentalIncomeEvidence: [
      { id: 'a', date: '01/05/2025', description: 'Rent', amount: 2100, treatment: 'added', source: 'Bank' },
      { id: 'b', date: '01/06/2025', description: 'Rent', amount: 2100, treatment: 'added', source: 'Bank' },
      { id: 'c', date: '01/05/2025', description: 'Rent', amount: 800, treatment: 'alreadyIncluded', source: 'Bank' },
    ] }
  const other = { ...target, id: 'other', name: 'Drayton Park' }
  const [pearl, drayton] = removeRentalIncomeEvidence([target, other], 'pearl', ['a', 'c'])
  assert.equal(pearl.rentalIncome, 2900)
  assert.deepEqual(pearl.rentalIncomeEvidence.map((evidence) => evidence.id), ['b'])
  assert.equal(drayton, other)
})

test('separate documented expense lists combine; unknown or possibly duplicated expenses require confirmation', () => {
  const evidence = (id, amount, date) => ({
    ...petrol, id, description: 'Repair', amount, allowableAmount: amount, date,
  })
  const a = importProperty([], { ...suggestion, expenseEvidence: [evidence('a-row', 200, '01/05/2025')] }, '2025-26', 'a')[0]
  const b = importProperty([], { ...suggestion, propertySourceId: 'source-b', allowableExpenses: 100,
    expenseEvidence: [evidence('b-row', 100, '02/05/2025')] }, '2025-26', 'b')[0]
  const combined = allocateProperty([a, b], 'a', 'b', false)
  assert.equal(combined.length, 1)
  assert.equal(combined[0].allowableExpenses, 300)
  assert.equal(combined[0].expenseEvidence.length, 2)
  const manual = { ...b, allowableExpenses: 150, expenseEvidence: undefined }
  assert.throws(() => allocateProperty([a, manual], 'a', 'b', false), /confirm these are separate/)
  assert.equal(allocateProperty([a, manual], 'a', 'b', false, true)[0].allowableExpenses, 350)
  const duplicate = { ...b, allowableExpenses: 200, expenseEvidence: [evidence('different-id', 200, '01/05/2025')] }
  assert.throws(() => allocateProperty([a, duplicate], 'a', 'b', false), /possible overlap/)
  assert.throws(() => allocateProperty([a, { ...b, documentSources: a.documentSources }], 'a', 'b', false, true), /duplicate evidence/)
})

const petrol = {
  id: 'petrol-row', source: 'costs.xlsx / Flat A', row: 2, date: '01/05/2025',
  description: 'Petrol', amount: 100, allowableAmount: 0, treatment: 'review', reason: 'Check business journey',
}
test('partial petrol confirmation includes only evidenced costs, excludes unexplained balance and permits exclusion', () => {
  const first = importProperty([], { ...suggestion, expenseEvidence: [petrol] }, '2025-26', 'a')[0]
  const reviewed = reviewPropertyExpense({ ...first, allowableExpenses: 250 }, petrol.id, 40)
  assert.equal(reviewed.allowableExpenses, 40)
  assert.equal(reviewed.expenseReconciliation, 450)
  assert.equal(reviewed.expenseEvidence[0].allowableAmount, 40)
  assert.equal(reviewed.documentVerified, false)
  assert.equal(reviewPropertyExpense(reviewed, petrol.id, 40).allowableExpenses, 40)
  assert.equal(reviewPropertyExpense(reviewed, petrol.id, 0).allowableExpenses, 0)
  for (const invalid of [-1, 101, NaN, Infinity]) assert.throws(() => reviewPropertyExpense(first, petrol.id, invalid), /between zero/)
  assert.throws(() => reviewPropertyExpense(first, 'missing', 0), /no longer available/)
})
test('interest/repayments cannot become running expenses and contradictory totals are excluded for reconciliation', () => {
  const first = importProperty([], { ...suggestion, expenseEvidence: [petrol] }, '2025-26', 'a')[0]
  assert.throws(() => reviewPropertyExpense({ ...first, expenseEvidence: [{ ...petrol, treatment: 'repayment' }] }, petrol.id, 100), /cannot be included/)
  assert.throws(() => reviewPropertyExpense({ ...first, expenseEvidence: [{ ...petrol, treatment: 'interest' }] }, petrol.id, 100), /cannot be included/)
  const corrected = reviewPropertyExpense({
    ...first, allowableExpenses: 0, expenseEvidence: [{ ...petrol, allowableAmount: 40 }],
  }, petrol.id, 0)
  assert.equal(corrected.allowableExpenses, 0)
  assert.equal(corrected.expenseReconciliation, 160)
})
test('rescan enriches older allocated sources without changing totals or resetting reviewed expense amounts', () => {
  const original = importProperty([], suggestion, '2025-26', 'a')
  original[0].allowableExpenses = 250
  const enriched = importProperty(original, { ...suggestion, expenseEvidence: [petrol] }, '2025-26', 'b')
  assert.equal(enriched.length, 1)
  assert.equal(enriched[0].allowableExpenses, 0)
  assert.equal(enriched[0].expenseReconciliation, 250)
  const reviewed = [reviewPropertyExpense(enriched[0], petrol.id, 40)]
  assert.equal(importProperty(reviewed, { ...suggestion, expenseEvidence: [petrol] }, '2025-26', 'c'), reviewed)
  const target = { ...reviewed[0], id: 'target', allowableExpenses: 0, documentSources: [], expenseEvidence: [] }
  const allocated = allocateProperty([...reviewed, target], 'a', 'target', false)
  assert.equal(allocated[0].expenseEvidence[0].allowableAmount, 40)
  assert.equal(importProperty(allocated, { ...suggestion, expenseEvidence: [petrol] }, '2025-26', 'd'), allocated)
})

test('different named properties cannot be combined even with expense confirmation', () => {
  const a = importProperty([], suggestion, '2025-26', 'a')[0]
  const b = importProperty([], { ...suggestion, propertyName: 'Flat B', propertySourceId: 'source-b' }, '2025-26', 'b')[0]
  assert.throws(() => allocateProperty([a, b], 'a', 'b', false, true), /different properties/)
  assert.equal(a.allowableExpenses, 200)
  assert.equal(b.allowableExpenses, 200)
})

test('individual lender references move without moving expenses, sources or changing tax amounts', () => {
  const a = importProperty([], suggestion, '2025-26', 'a')[0]
  a.bankEvidence = [
    { label: 'HALIFAX', kind: 'mortgage', incoming: 0, outgoing: 500 },
    { label: 'NATWEST', kind: 'mortgage', incoming: 0, outgoing: 600 },
  ]
  const b = importProperty([], { ...suggestion, propertyName: 'Flat B', propertySourceId: 'source-b' }, '2025-26', 'b')[0]
  const moved = moveBankReference([a, b], 'a', 'b', 1)
  assert.deepEqual(moved[0].bankEvidence.map((entry) => entry.label), ['HALIFAX'])
  assert.equal(moved[1].bankEvidence[0].label, 'NATWEST')
  assert.equal(moved[0].allowableExpenses, 200)
  assert.equal(moved[1].allowableExpenses, 200)
  assert.equal(moved[1].mortgageInterest, 0)
  assert.deepEqual(moved[0].documentSources, a.documentSources)
  assert.throws(() => moveBankReference([a, b], 'a', 'b', 9), /Choose a different property/)
  assert.throws(() => moveBankReference([{ ...a, bankEvidence: [{
    label: 'rent', kind: 'possibleRent', incoming: 1000, outgoing: 0, includedInRent: true,
  }] }, b], 'a', 'b', 0), /Reconcile the income/)
})

test('unallocated expense files can create and fill a new property named from the file', () => {
  assert.equal(suggestPropertyName('Unallocated expenses: Expenses_DraytonPark.docx'), 'Drayton Park')
  assert.equal(suggestPropertyName('Unallocated expenses: pearl-chambers receipts.docx'), 'pearl chambers')
  assert.equal(suggestPropertyName('Unallocated bank evidence: HALIFAX'), '')
  const source = { id: 'u', name: 'Unallocated expenses: Expenses_DraytonPark.docx', ownershipShare: 1, rentalIncome: 0,
    allowableExpenses: 0, mortgageInterest: 0, documentSources: ['doc'],
    expenseEvidence: [{ id: 'e', source: 'Expenses_DraytonPark.docx / text', row: 1, date: '01/07/2025', description: 'Service charge',
      amount: 1075.85, allowableAmount: 0, treatment: 'review', reason: '' }] }
  const [created] = allocateToNewProperty([source], 'u', ' Drayton Park ', 'new', false)
  assert.equal(created.id, 'new')
  assert.equal(created.name, 'Drayton Park')
  assert.equal(created.expenseEvidence.length, 1)
  assert.deepEqual(created.documentSources, ['doc'])
  assert.throws(() => allocateToNewProperty([source, { ...created, id: 'x' }], 'u', 'drayton park', 'n2', false), /already exists/)
  assert.throws(() => allocateToNewProperty([source], 'u', '  ', 'n3', false), /name/)
})

test('re-reading a Word document replaces unreviewed rows, keeps reviewed ones and fills their missing details', () => {
  const row = (id, amount, allowableAmount = 0, extra = {}) => ({ id, source: 'Expenses_DraytonPark.docx / text', row: 1,
    date: '29/03/2026', description: 'x', amount, allowableAmount, treatment: 'review', reason: '', ...extra })
  const items = [
    { id: 'd', name: 'Drayton Park', ownershipShare: 1, rentalIncome: 0, allowableExpenses: 255, mortgageInterest: 0,
      expenseEvidence: [
        row('old-hash:docx:1:1', 396),
        row('old-hash:docx:2:1', 60, 60, { source: 'Expenses_DraytonPark.docx / image7.png (OCR)' }),
        row('old-hash:docx:3:1', 195, 195, { date: '', description: 'EICR :' }),
        { ...row('sheet:1', 5), source: 'Workbook.xlsx / Drayton Park' },
      ] },
    { id: 'u', name: 'Unallocated expenses: Expenses_DraytonPark.docx', ownershipShare: 1, rentalIncome: 0, allowableExpenses: 0,
      mortgageInterest: 0, expenseEvidence: [row('old-hash:docx:4:1', 99)] },
  ]
  const suggestion = { fileName: 'Expenses_DraytonPark.docx', propertySourceId: 'new-hash:docx:Drayton Park:2025-26', expenseEvidence: [
    row('new-hash:docx:a', 60, 0, { source: 'Expenses_DraytonPark.docx / image7.png (OCR)' }),
    row('new-hash:docx:b', 195, 0, { date: '01/03/2026', description: 'EICR :' }),
    row('new-hash:docx:c', 1486.97, 0, { date: '09/02/2026', description: 'Half year service charge :' }),
  ] }
  const { items: result, suggestions: [remaining] } = refreshWordDocumentRows(items, [suggestion])
  assert.equal(result.length, 1)
  assert.deepEqual(result[0].expenseEvidence.map((item) => [item.id, item.date, item.allowableAmount]), [
    ['old-hash:docx:2:1', '29/03/2026', 60],
    ['old-hash:docx:3:1', '01/03/2026', 195],
    ['sheet:1', '29/03/2026', 0],
  ])
  assert.deepEqual(remaining.expenseEvidence.map((item) => item.id), ['new-hash:docx:c'])
  const untouched = refreshWordDocumentRows(items, [{ fileName: 'Book.xlsx', propertySourceId: 'sheet:Pearl:2025-26' }])
  assert.equal(untouched.items, items)
})

test('expense rows can be deleted and likely duplicates are flagged', () => {
  const row = (id, amount, date, source = 'A.docx / text') => ({ id, source, row: 1, date, description: id, amount,
    allowableAmount: id === 'kept' ? amount : 0, treatment: 'review', reason: '' })
  const item = { id: 'p', name: 'Pearl Chambers', ownershipShare: 1, rentalIncome: 0, allowableExpenses: 394.49, mortgageInterest: 0,
    expenseEvidence: [row('kept', 394.49, '09/05/2025'), row('old', 394.49, '09/05/2025', 'Expenses.docx / image8.png'),
      row('undated', 18, ''), row('dated', 18, '02/09/2025'), row('other', 25, '28/04/2025')] }
  const duplicates = possibleDuplicateExpenses(item)
  assert.deepEqual([...duplicates.keys()], ['kept', 'old', 'undated', 'dated'])
  assert.equal(duplicates.get('old').id, 'kept')
  const removed = removePropertyExpenses(item, ['old', 'undated', 'kept'])
  assert.deepEqual(removed.expenseEvidence.map((expense) => expense.id), ['dated', 'other'])
  assert.equal(removed.allowableExpenses, 0)
  assert.equal(removePropertyExpenses(item, ['missing']), item)
})
