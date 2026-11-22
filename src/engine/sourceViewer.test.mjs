import test from 'node:test'
import assert from 'node:assert/strict'
import { amountForms, highlightAmount, parseSource, renderSheetView, renderWordView } from './sourceViewer.ts'

test('sources are split into file, part and embedded picture', () => {
  assert.deepEqual(parseSource('Expenses_DraytonPark.docx / image5.png (OCR)'),
    { fileName: 'Expenses_DraytonPark.docx', part: 'image5.png (OCR)', image: 'image5.png' })
  assert.deepEqual(parseSource('Workbook.xlsx / Pearl Chambers'), { fileName: 'Workbook.xlsx', part: 'Pearl Chambers' })
  assert.deepEqual(parseSource('Expenses.docx / text (table)'), { fileName: 'Expenses.docx', part: 'text (table)' })
})

test('the amount is highlighted in any common format, first match anchored, without partial-number matches', () => {
  assert.deepEqual(amountForms(1075.85).sort(), ['1,075.85', '1075.85'])
  assert.ok(amountForms(57.6).includes('57.6') && amountForms(57.6).includes('57.60'))
  const { html, found } = highlightAmount('Ref 21075.85 then <b> £1,075.85 and 1075.85', 1075.85)
  assert.equal(found, true)
  assert.equal(html, 'Ref 21075.85 then &lt;b&gt; £<mark id="found">1,075.85</mark> and <mark>1075.85</mark>')
  assert.equal(highlightAmount('nothing', 5).found, false)
  assert.equal(highlightAmount('25 Apr 25 | OPENRENT | 28 Apr 25 | 25.00', 25).html,
    '25 Apr 25 | OPENRENT | 28 Apr 25 | <mark id="found">25.00</mark>')
  assert.equal(highlightAmount('Paid 25 Apr then £25', 25).html, 'Paid 25 Apr then £<mark id="found">25</mark>')
})

test('Word and sheet views show the matching text or row', () => {
  const xml = '<w:p><w:r><w:t>EICR : £195</w:t></w:r></w:p><w:p><a:blip r:embed="rId4"/></w:p>'
  const html = renderWordView('Expenses.docx', xml, '<Relationship Id="rId4" Target="media/image7.png"/>', 195)
  assert.match(html, /EICR : £<mark id="found">195<\/mark>/)
  assert.match(html, /\[Picture: image7\.png\]/)
  assert.match(renderWordView('Expenses.docx', xml, '', 60), /was not found in the document text/)
  const sheet = renderSheetView('Book.xlsx', 'Pearl Chambers', [['Date', 'Amount'], ['01/05/2025', 25]], 2)
  assert.match(sheet, /<tr class="found" id="found"><th>2<\/th><td>01\/05\/2025<\/td><td>25<\/td><\/tr>/)
})
