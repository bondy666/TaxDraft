import test from 'node:test'
import assert from 'node:assert/strict'
import { docxExpenseBlocks, docxImageTargets, docxText, embeddedAttachments, extractExpenseRows, propertyFromFileName } from './expenseDocument.ts'

const text = (value, source = 'Expenses.docx / text') => ({ text: value, source, ocr: false })
const image = (value, name) => ({ text: value, source: `Expenses.docx / ${name} (OCR)`, ocr: true })
const rows = (blocks) => extractExpenseRows(blocks, '2025-26', ['Pearl Chambers', 'Drayton Park'], 'doc')

test('invoice totals win over subtotals and VAT lines, and the invoice is linked to the property it names', () => {
  const { rows: [legal, keys] } = rows([
    image('INVOICE\nInvoice Date: 31July 2025\nRe: Flat 4, Pearl Chambers, Leeds - Professional Negligence\nSubtotal £304.00 £60.80\nBalance Due £364.80', 'image2.png'),
    image('Issue date Sep 2, 2025\nFlat 4 Pearl Chambers New Post Box Key 1.00 15.00 20% 15.00\nSubtotal 15.00\nTotal VAT 20% 3.00\nAmount due GBP 18.00', 'image5.png'),
  ])
  assert.equal(legal.evidence.amount, 364.8)
  assert.equal(legal.evidence.date, '31/07/2025')
  assert.equal(legal.evidence.description, 'Flat 4, Pearl Chambers, Leeds - Professional Negligence')
  assert.equal(legal.property, 'Pearl Chambers')
  assert.match(legal.evidence.reason, /Legal costs.*OCR/)
  assert.equal(keys.evidence.amount, 18)
  assert.equal(keys.evidence.date, '02/09/2025')
  assert.ok([legal, keys].every((row) => row.evidence.treatment === 'review' && row.evidence.allowableAmount === 0))
})

test('statement-style text uses the payment date, and a heading joins the next text block but not a picture', () => {
  const { rows: result } = rows([
    text('05 Apr 25\nOPENRENT RENT NOW\n70400000010078358\n07 Apr 25\n69.00'),
    text('Council Tax'),
    image('Your payment\nElectricity = £80 22/05/2025', 'image1.png'),
    text('Date, 19 Jan 26\nPearl Chambers\nDescription, LEEDS CITY COUNCIL\nMoney Out, £, 318.38'),
  ])
  assert.deepEqual(result.map((row) => [row.evidence.date, row.evidence.amount, row.property ?? null]), [
    ['07/04/2025', 69, null],
    ['22/05/2025', 80, null],
    ['19/01/2026', 318.38, 'Pearl Chambers'],
  ])
  assert.match(result[2].evidence.reason, /Council tax and utilities/)
})

test('costs outside the tax year are excluded; a rent period end date does not push a cost out of the year', () => {
  const { rows: result, outsideYear } = rows([
    image('19th March 2025\nElectricity: £50', 'old.png'),
    image('Pearl Chambers\nRent of £242.00 on 01 January 2026\nGround Rent for the period 1st January 2026 - 31st December 2026\nInvoice Amount £242.00', 'rent.png'),
  ])
  assert.equal(outsideYear, 1)
  assert.deepEqual(result.map((row) => [row.evidence.date, row.evidence.amount]), [['01/01/2026', 242]])
})

test('Word pictures are read in document order and small images are skipped', async () => {
  const xml = '<w:p><w:r><w:t>Council Tax</w:t></w:r></w:p><w:p><a:blip r:embed="rId4"/></w:p>' +
    '<w:p><w:r><w:t>Amount: GBP 99.00 &amp; more</w:t></w:r></w:p><w:p><a:blip r:embed="rId5"/></w:p>'
  const rels = '<Relationship Id="rId4" Target="media/image1.png"/><Relationship Id="rId5" Target="media/icon.png"/>' +
    '<Relationship Id="rId9" Target="styles.xml"/>'
  assert.deepEqual([...docxImageTargets(rels)], [['rId4', 'word/media/image1.png'], ['rId5', 'word/media/icon.png']])
  assert.match(docxText(xml), /\[\[image:rId4\]\][\s\S]*GBP 99\.00 & more/)
  const files = { 'word/media/image1.png': new Uint8Array(6000), 'word/media/icon.png': new Uint8Array(100) }
  const { blocks, imagesRead } = await docxExpenseBlocks(xml, rels, 'Expenses.docx', (path) => files[path], async () => 'OCR TEXT')
  assert.equal(imagesRead, 1)
  assert.deepEqual(blocks.map((block) => [block.text, block.ocr]), [
    ['Council Tax', false], ['OCR TEXT', true], ['Amount: GBP 99.00 & more', false],
  ])
})

test('a file name can name the property, totals replace their parts, and embedded file names are not descriptions', () => {
  assert.equal(propertyFromFileName('Expenses_DraytonPark.docx', ['Pearl Chambers', 'Drayton Park']), 'Drayton Park')
  assert.equal(propertyFromFileName('Expenses.docx', ['Pearl Chambers', 'Drayton Park']), undefined)
  const { rows: result } = extractExpenseRows([
    image('RENT - Flat 21\n01/01/2026\nGround rent £25.00\nInsurance £75.00\n£100.00', 'image5.png'),
    text('<<Property_Ledger_Template.xlsx>>\nEICR\n01/03/2026\n£195.00'),
  ], '2025-26', ['Pearl Chambers', 'Drayton Park'], 'doc', 'Drayton Park')
  assert.deepEqual(result.map((row) => [row.evidence.amount, row.evidence.description, row.property]), [
    [100, 'RENT - Flat 21', 'Drayton Park'],
    [195, 'EICR', 'Drayton Park'],
  ])
})

test('the date on the amount line wins over a stray caption, and embedded attachments are skipped and listed', () => {
  const blocks = [
    text('29/03/26'),
    image('Electrical Safety Booking For Flat 21\nDate: 29/03/2026\nTotal: £60.00', 'image7.png'),
    text('<<Property_Ledger_Template.xlsx>>'),
    text('12/05/2026 - £396'),
    text('<<Gateway Tenant Invoice.pdf>>'),
  ]
  const { rows: result, outsideYear } = rows(blocks)
  assert.deepEqual(result.map((row) => [row.evidence.date, row.evidence.amount]), [['29/03/2026', 60]])
  assert.equal(outsideYear, 1)
  const nextYear = extractExpenseRows(blocks, '2026-27', [], 'doc').rows.find((row) => row.evidence.amount === 396)
  assert.equal(nextYear.evidence.date, '12/05/2026')
  assert.doesNotMatch(nextYear.evidence.description, /<<|Ledger/)
  assert.deepEqual(embeddedAttachments(blocks), ['Property_Ledger_Template.xlsx', 'Gateway Tenant Invoice.pdf'])
})

test('a Word ledger table gives one dated row per line and replaces repeats elsewhere in the document', () => {
  const cell = (value) => `<w:tc><w:p><w:r><w:t>${value}</w:t></w:r></w:p></w:tc>`
  const row = (...values) => `<w:tr>${values.map(cell).join('')}</w:tr>`
  const xml = '<w:p><w:r><w:t>RENT - Flat 21 26/11/2025</w:t></w:r></w:p><w:p><w:r><w:t>£100.00</w:t></w:r></w:p>' +
    `<w:tbl>${row('Date', 'Supplier', 'Description', 'Reference', 'Amount (£)')}${row('2026-01-01', 'Gateway', 'Parking Bay Rent', 'GR/21', '25')}` +
    `${row('2026-01-01', 'Gateway', 'Ground Rent', 'GR/21', '75')}${row('2026-03-31', 'Mileage Claim', '4 x 32 mile visits', 'HMRC', '57.6')}` +
    `${row('2026-05-12', 'Agent', 'Fee', 'X', '396')}</w:tbl>` +
    `<w:tbl>${row('Date, 19 Jan 26', 'LEEDS CITY COUNCIL', 'Money Out, £, 318.38')}</w:tbl>`
  const blocks = docxText(xml).split(/\n\s*\n/).map((value) => value.trim()).filter(Boolean).map((value) => text(value))
  const { rows: result, outsideYear } = rows(blocks)
  assert.deepEqual(result.map((item) => [item.evidence.date, item.evidence.amount]), [
    ['01/01/2026', 25], ['01/01/2026', 75], ['31/03/2026', 57.6], ['19/01/2026', 318.38],
  ])
  assert.deepEqual(result.slice(0, 3).map((item) => item.evidence.description),
    ['Gateway – Parking Bay Rent', 'Gateway – Ground Rent', 'Mileage Claim – 4 x 32 mile visits'])
  assert.equal(outsideYear, 1)
  assert.match(result[2].evidence.reason, /mileage rates or actual vehicle costs/)
})
