import { docxImageTargets, docxText } from './expenseDocument.ts'

export interface SourceLocation {
  fileName: string
  /** Sheet, "text", "text (table)" or "image5.png (OCR)". */
  part: string
  /** Picture inside a Word document, when the item was read from one. */
  image?: string
}

/** Splits an evidence source such as "Expenses_DraytonPark.docx / image5.png (OCR)". */
export function parseSource(source: string): SourceLocation {
  const [fileName, ...rest] = source.split(' / ')
  const part = rest.join(' / ')
  const image = /^(.+?\.(?:png|jpe?g|gif|bmp|tiff?|emf|wmf))\s*\(OCR\)$/i.exec(part)?.[1]
  return { fileName: fileName.trim(), part, ...(image ? { image } : {}) }
}

/** The ways an amount may be written: 1,075.85 / 1075.85 / 57.6 / 25. */
export function amountForms(amount: number): string[] {
  const forms = new Set([
    amount.toFixed(2),
    amount.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    String(amount),
    amount.toLocaleString('en-GB', { maximumFractionDigits: 2 }),
  ])
  return [...forms].sort((a, b) => b.length - a.length)
}

const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const PAGE_STYLE = `<style>
  body { font: 15px/1.5 system-ui, sans-serif; margin: 24px auto; max-width: 900px; color: #183240; padding: 0 16px; }
  h1 { font-size: 18px; } p.note { color: #435960; font-size: 13px; }
  .block { white-space: pre-wrap; border-bottom: 1px solid #ddd; padding: 8px 0; }
  .picture { color: #435960; font-style: italic; }
  mark { background: #F6DFA6; padding: 0 2px; } mark#found { background: #E6B94F; outline: 2px solid #C38B25; }
  table { border-collapse: collapse; font-size: 13px; } td, th { border: 1px solid #ccc; padding: 4px 8px; vertical-align: top; }
  th { background: #eef2ef; } tr.found td { background: #F6DFA6; } tr.found th { background: #E6B94F; }
</style>`

/** Escapes text and marks the amount; the first match gets id="found" so the page opens scrolled to it. */
export function highlightAmount(text: string, amount?: number, mode: 'auto' | 'precise' | 'any' = 'auto'): { html: string; found: boolean } {
  if (amount === undefined || !Number.isFinite(amount)) return { html: escapeHtml(text), found: false }
  // Pence-precise forms first ("25.00"), so a bare "25" in a date like "25 Apr 25" is only used as a last resort.
  const forms = amountForms(amount)
  const precise = forms.filter((form) => /[.,]/.test(form))
  const passes = mode === 'precise' ? [precise] : mode === 'any' ? [forms] : [precise, forms]
  for (const candidates of passes) {
    if (!candidates.length) continue
    const pattern = new RegExp(`(?<![\\d.,])(${candidates.map(escapeRegExp).join('|')})(?![\\d]|[.,]\\d)(?!\\s+(?:${MONTH_WORDS}))`, 'gi')
    if (!pattern.test(text)) continue
    pattern.lastIndex = 0
    let found = false
    const html = text.split(pattern).map((part, index) => {
      if (index % 2 === 0) return escapeHtml(part)
      const id = found ? '' : ' id="found"'
      found = true
      return `<mark${id}>${escapeHtml(part)}</mark>`
    }).join('')
    return { html, found }
  }
  return { html: escapeHtml(text), found: false }
}

const MONTH_WORDS = 'jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec'

/** A readable copy of a Word document: paragraphs, ledger tables as rows, and picture placeholders. */
export function renderWordView(fileName: string, documentXml: string, relsXml: string, amount?: number): string {
  const targets = docxImageTargets(relsXml)
  const blocks = docxText(documentXml).split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean).map((block) => {
    const picture = /^\[\[image:([^\]]+)\]\]$/.exec(block)
    if (picture) return { picture: (targets.get(picture[1]) ?? picture[1]).split('/').pop() }
    return { text: block.replace(/\[\[ledger-row\]\]\s*/g, '').replace(/ ;; /g, '  |  ') }
  })
  const render = (mode: 'precise' | 'any') => {
    let found = false
    const html = blocks.map((block) => {
      if ('picture' in block) return `<div class="block picture">[Picture: ${escapeHtml(block.picture ?? '')}]</div>`
      const marked = highlightAmount(block.text ?? '', found ? undefined : amount, mode)
      found ||= marked.found
      return `<div class="block">${marked.html}</div>`
    }).join('\n')
    return { html, found }
  }
  // Look for the exact amount with pence across the whole document before accepting a bare number anywhere.
  const precise = render('precise')
  const { html: body, found } = precise.found ? precise : render('any')
  const note = amount === undefined ? '' : found
    ? `The amount £${amount.toFixed(2)} is highlighted.`
    : `£${amount.toFixed(2)} was not found in the document text; it may come from a picture.`
  return `<!doctype html><meta charset="utf-8"><title>${escapeHtml(fileName)}</title>${PAGE_STYLE}` +
    `<h1>${escapeHtml(fileName)}</h1><p class="note">Text view of the Word document. ${note}</p>${body}`
}

/** A worksheet as a table, with the given spreadsheet row (1-based, as Excel numbers it) highlighted. */
export function renderSheetView(fileName: string, sheetName: string, rows: unknown[][], row?: number): string {
  const cell = (value: unknown) => escapeHtml(value instanceof Date ? value.toLocaleDateString('en-GB') : String(value ?? ''))
  const body = rows.map((values, index) => {
    const number = index + 1
    const found = number === row
    return `<tr${found ? ' class="found" id="found"' : ''}><th>${number}</th>${values.map((value) => `<td>${cell(value)}</td>`).join('')}</tr>`
  }).join('\n')
  return `<!doctype html><meta charset="utf-8"><title>${escapeHtml(fileName)}</title>${PAGE_STYLE}` +
    `<h1>${escapeHtml(fileName)} — ${escapeHtml(sheetName)}</h1>` +
    `<p class="note">${row ? `Row ${row} is highlighted.` : 'Sheet view.'}</p><table>${body}</table>`
}

function show(target: Window | null, blob: Blob, anchor = '') {
  const url = URL.createObjectURL(blob)
  if (target) target.location.href = `${url}${anchor}`
  else window.open(`${url}${anchor}`, '_blank')
  // Keep the local URL alive long enough for the new tab to load it.
  window.setTimeout(() => URL.revokeObjectURL(url), 120_000)
}

/** Opens where an item came from: the picture, the highlighted text or row, or the file itself. Nothing leaves the browser. */
export async function openSource(file: File, source: string, options: { row?: number; amount?: number } = {}) {
  // Opened before any await so the browser treats it as part of the click and does not block it.
  const target = window.open('about:blank', '_blank')
  const location = parseSource(source)
  const extension = file.name.split('.').pop()?.toLowerCase()
  try {
    if (extension === 'docx') {
      const XLSX = await import('@e965/xlsx')
      const zip = XLSX.CFB.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' })
      const read = (path: string) => XLSX.CFB.find(zip, `/${path}`)?.content as Uint8Array | undefined
      if (location.image) {
        const picture = read(`word/media/${location.image}`)
        if (picture) {
          const type = /\.png$/i.test(location.image) ? 'image/png' : /\.jpe?g$/i.test(location.image) ? 'image/jpeg' : 'application/octet-stream'
          return show(target, new Blob([new Uint8Array(picture)], { type }))
        }
      }
      const decode = (bytes?: Uint8Array) => bytes ? new TextDecoder().decode(bytes) : ''
      const html = renderWordView(file.name, decode(read('word/document.xml')), decode(read('word/_rels/document.xml.rels')), options.amount)
      return show(target, new Blob([html], { type: 'text/html' }), '#found')
    }
    if (extension === 'xlsx' || extension === 'xlsm' || extension === 'csv') {
      const XLSX = await import('@e965/xlsx')
      const workbook = extension === 'csv'
        ? XLSX.read(await file.text(), { type: 'string', cellDates: true })
        : XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true })
      const sheetName = workbook.SheetNames.includes(location.part) ? location.part : workbook.SheetNames[0]
      const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, raw: true, defval: '' })
      return show(target, new Blob([renderSheetView(file.name, sheetName, rows, options.row)], { type: 'text/html' }), '#found')
    }
    return show(target, file)
  } catch (cause) {
    target?.close()
    throw cause
  }
}
