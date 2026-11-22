import type { PropertyExpenseEvidence } from '../types'
import { isInTaxYear } from './documentValues.ts'

export interface ExpenseTextBlock {
  text: string
  source: string
  ocr: boolean
}

export interface ExpenseDocumentRow {
  property?: string
  evidence: PropertyExpenseEvidence
  ocr: boolean
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const MONTH = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?'
const DATE_PATTERNS = [
  /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/gi,
  new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*${MONTH},?\\s*(\\d{4}|\\d{2})\\b`, 'gi'),
  new RegExp(`\\b${MONTH}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, 'gi'),
  /\b(\d{4})-(\d{2})-(\d{2})\b/g,
]
const LEDGER_ROW = '[[ledger-row]]'
const CELL = ' ;; '

/**
 * A Word table whose header has Date and Amount columns (e.g. a pasted expense ledger) becomes one line per row:
 * "[[ledger-row]] date ;; amount ;; description". Other tables (used to lay out pictures and notes) are left as they are.
 */
function ledgerTableText(tableXml: string): string | null {
  const cellText = (cell: string) => cell.replace(/<\/w:p>/g, ' ').replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
  const rows = (tableXml.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g) ?? [])
    .map((row) => (row.match(/<w:tc>[\s\S]*?<\/w:tc>/g) ?? []).map(cellText))
  const header = (rows[0] ?? []).map((cell) => cell.toLowerCase())
  const dateColumn = header.findIndex((cell) => /^date\b/.test(cell))
  const amountColumn = header.findIndex((cell) => /amount|total|cost|paid|£/.test(cell))
  // A header row holds column titles only; a row with figures (e.g. "Date, 19 Jan 26 | … | £318.38") is not a header.
  if (header.length < 3 || dateColumn < 0 || amountColumn < 0 || header.some((cell) => /\d/.test(cell))) return null
  const describeColumns = header.map((cell, index) => index)
    .filter((index) => index !== dateColumn && index !== amountColumn && !/\bref/.test(header[index]))
  const lines = rows.slice(1).filter((cells) => cells[dateColumn] && cells[amountColumn]).map((cells) =>
    `${LEDGER_ROW} ${cells[dateColumn]}${CELL}${cells[amountColumn]}${CELL}${describeColumns.map((index) => cells[index]).filter(Boolean).join(' – ')}`)
  return lines.length ? `\n\n${lines.join('\n')}\n\n` : null
}

/** Converts Word's document.xml into plain text, one paragraph per line, with [[image:rId]] markers where pictures sit. */
export function docxText(xml: string): string {
  return xml
    .replace(/<w:tbl>[\s\S]*?<\/w:tbl>/g, (table) => ledgerTableText(table) ?? table)
    .replace(/<(?:a:blip|v:imagedata)\b[^>]*\br:(?:embed|id)="([^"]+)"[^>]*>/g, '\n\n[[image:$1]]\n\n')
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:br\/>|<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, '\'').replace(/&amp;/g, '&')
}

/** Maps relationship ids (rId5) to media paths (word/media/image1.png) from document.xml.rels. */
export function docxImageTargets(relsXml: string): Map<string, string> {
  const targets = new Map<string, string>()
  for (const match of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(match[0])?.[1]
    const target = /\bTarget="([^"]+)"/.exec(match[0])?.[1]
    if (id && target && /\.(png|jpe?g|gif|bmp|tiff?)$/i.test(target)) targets.set(id, `word/${target.replace(/^\/?word\//, '')}`)
  }
  return targets
}

function makeDate(day: number, month: number, year: number): Date | null {
  const fullYear = year < 100 ? 2000 + year : year
  const date = new Date(fullYear, month, day)
  return date.getMonth() === month && date.getDate() === day ? date : null
}

function findDates(text: string): { date: Date; index: number }[] {
  const found: { date: Date; index: number }[] = []
  DATE_PATTERNS.forEach((pattern, kind) => {
    for (const match of text.matchAll(pattern)) {
      const date = kind === 0 ? makeDate(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
        : kind === 1 ? makeDate(Number(match[1]), MONTHS.indexOf(match[2].slice(0, 3).toLowerCase()), Number(match[3]))
        : kind === 2 ? makeDate(Number(match[2]), MONTHS.indexOf(match[1].slice(0, 3).toLowerCase()), Number(match[3]))
          : makeDate(Number(match[3]), Number(match[2]) - 1, Number(match[1]))
      if (date) found.push({ date, index: match.index ?? 0 })
    }
  })
  return found.sort((a, b) => a.index - b.index)
}

function pickDate(text: string, amountIndex: number, taxYearId: string): Date | null {
  const dates = findDates(text)
  if (!dates.length) return null
  // A date on the amount's own line ("12/05/2026 - £396") belongs to it, whatever headings sit above.
  const own = nearbyDate(text, amountIndex, false)
  if (own) return own
  for (const label of [/\bpaid\b/i, /\binvoice date\b/i, /\bissue date\b/i, /\bdate\b/i]) {
    const match = label.exec(text)
    if (!match) continue
    const after = dates.find((item) => item.index >= match.index && item.index - match.index <= 40)
    if (after) return after.date
  }
  // Unlabelled: the nearest date before the amount (e.g. the payment date after a transaction date), preferring one in
  // the tax year over a period end such as "1 January – 31 December 2026".
  const before = dates.filter((item) => item.index <= amountIndex).reverse()
  const candidates = before.length ? before : dates
  return (candidates.find((item) => isInTaxYear(item.date, taxYearId)) ?? candidates[0]).date
}

/** The date on the amount's own line, otherwise (if allowed) on the nearest non-empty line above. */
function nearbyDate(text: string, index: number, lookAbove = true): Date | null {
  const lines = text.split('\n')
  let offset = 0
  for (let line = 0; line < lines.length; line += 1) {
    if (index < offset + lines[line].length + 1) {
      const own = findDates(lines[line])[0]?.date
      if (own || !lookAbove) return own ?? null
      const above = lines.slice(0, line).reverse().find((value) => value.trim())
      return above ? findDates(above)[0]?.date ?? null : null
    }
    offset += lines[line].length + 1
  }
  return null
}

const AMOUNT = '(\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.(\\d{2}))?'
// Labelled totals in priority order; subtotals and VAT-only lines are never the cost.
const TOTAL_LABELS = [
  /\binvoice amount\b/i, /\binv(?:oice)? total\b/i, /\bamount due\b/i, /(?<!sub)\btotal\b(?!\s*(?:no\s*)?vat)/i,
  /\bbalance due\b/i, /\bmoney out\b/i, /\bamount\b/i,
]

function labelledAmount(text: string): { amount: number; index: number } | null {
  for (const label of TOTAL_LABELS) {
    for (const line of text.split('\n')) {
      const match = new RegExp(`${label.source}[^\\d\\n]{0,20}?(?:£|gbp)?[\\s,]*${AMOUNT}`, 'i').exec(line)
      if (!match) continue
      const amount = Number(`${match[1].replace(/,/g, '')}.${match[2] ?? '00'}`)
      if (amount > 0) return { amount, index: text.indexOf(line) }
    }
  }
  return null
}

function looseAmounts(text: string): { amount: number; index: number }[] {
  const amounts: { amount: number; index: number }[] = []
  let offset = 0
  for (const line of text.split('\n')) {
    const currency = new RegExp(`(?:£|gbp)\\s?${AMOUNT}`, 'i').exec(line)
    const bare = new RegExp(`^\\s*${AMOUNT.replace('(?:\\.(\\d{2}))?', '\\.(\\d{2})')}\\s*$`).exec(line)
    const match = currency ?? bare
    if (match) {
      const amount = Number(`${match[1].replace(/,/g, '')}.${match[2] ?? '00'}`)
      if (amount > 0) amounts.push({ amount, index: offset })
    }
    offset += line.length + 1
  }
  return amounts
}

/** When one amount equals the sum of the others (e.g. £25 + £75 = £100), only the total is a cost. */
function withoutPartsOfTotal(amounts: { amount: number; index: number }[]): { amount: number; index: number }[] {
  if (amounts.length < 3) return amounts
  const largest = amounts.reduce((max, item) => item.amount > max.amount ? item : max)
  const rest = amounts.filter((item) => item !== largest).reduce((sum, item) => sum + item.amount, 0)
  return Math.round(rest * 100) === Math.round(largest.amount * 100) ? [largest] : amounts
}

/** Matches a file name such as "Expenses_DraytonPark.docx" to an existing property name, ignoring spaces and case. */
export function propertyFromFileName(fileName: string, propertyNames: string[]): string | undefined {
  const compact = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '')
  const file = compact(fileName.replace(/\.[^.]+$/, ''))
  return propertyNames.find((name) => compact(name).length >= 4 && file.includes(compact(name)))
}

const ATTACHMENT = /^<<(.+)>>$/

function shortHash(value: string): string {
  let hash = 5381
  for (let index = 0; index < value.length; index += 1) hash = ((hash << 5) + hash + value.charCodeAt(index)) >>> 0
  return hash.toString(36)
}

/** Files embedded in a Word document ("<<Property_Ledger_Template.xlsx>>"), which are not read. */
export function embeddedAttachments(blocks: ExpenseTextBlock[]): string[] {
  const names = blocks.filter((block) => !block.ocr).flatMap((block) => block.text.split('\n'))
    .map((line) => ATTACHMENT.exec(line.trim())?.[1]).filter((name): name is string => !!name)
  return [...new Set(names)]
}

const NOISE_LINE = /^(?:private\s*&\s*confidential|(?:tax\s*)?invoice|thank you.*|hello.*|.*@.*|<<.*>>|[\d\s,./:£-]+)$/i

function describe(text: string, source: string): string {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean)
  const clean = (value: string) => value.replace(/£\s?[\d,.]+|\.{2,}|…/g, ' ').replace(/(?:\s+(?:\d+[.,]\d+|\d+%))+\s*$/, '')
    .replace(/\s+/g, ' ').trim().slice(0, 90)
  const re = lines.find((line) => /^re:/i.test(line))
  if (re) return clean(re.replace(/^re:\s*/i, ''))
  const index = lines.findIndex((line) => /^description\b/i.test(line))
  if (index >= 0) {
    const value = lines[index].replace(/^description[\s:,]*/i, '')
    const candidate = /quantity|unit price|value\]?$/i.test(value) || !value ? lines[index + 1] : value
    if (candidate && clean(candidate)) return clean(candidate)
  }
  const named = lines.find((line) => /[a-z]{3}/i.test(line) && !NOISE_LINE.test(line) && !findDates(line).length)
  return named ? clean(named) : `Expense from ${source}`
}

function expenseReason(description: string, ocr: boolean): string {
  const text = description.toLowerCase()
  const guidance = /mileage|\bmiles?\b|travel|petrol|fuel/.test(text)
    ? 'Travel: claim either HMRC mileage rates or actual vehicle costs, not both, and keep a record of each journey’s rental-business purpose.'
    : /legal|solicitor|professional|negligence|claim|construction/.test(text)
    ? 'Legal costs are allowable only for the letting business, not for buying or improving the property or capital disputes.'
    : /service charge|ground rent/.test(text)
      ? 'Service charges and ground rent are normally allowable for a let property; confirm the period and your share.'
      : /council|electric|gas|energy|water|utility|top-?up/.test(text)
        ? 'Council tax and utilities are allowable only when you paid them as landlord (e.g. empty periods), not when the tenant was liable.'
        : /clean|repair|key|maintenance|replace/.test(text)
          ? 'Repairs, cleaning and like-for-like replacements are normally allowable; confirm it is not an improvement.'
          : /openrent|advertis|referenc|letting|agent|rent now/.test(text)
            ? 'Letting, advertising and referencing fees are normally allowable.'
            : 'Confirm this is a rental-business cost, not private or capital, before including it.'
  return `${guidance}${ocr ? ' Read from an image by OCR: check the amount and date against the original.' : ''}`
}

/**
 * Splits a Word document into text and picture blocks in reading order, OCR-ing each picture where it appears
 * so a caption or heading stays next to its invoice. Tiny pictures (icons, lines) are skipped.
 */
export async function docxExpenseBlocks(
  documentXml: string, relsXml: string, fileName: string,
  readImage: (path: string) => Uint8Array | undefined,
  ocr: (image: Uint8Array) => Promise<string>,
  maxImages = 40,
): Promise<{ blocks: ExpenseTextBlock[]; imagesRead: number; imagesSkipped: number }> {
  const targets = docxImageTargets(relsXml)
  const blocks: ExpenseTextBlock[] = []
  let imagesRead = 0
  let imagesSkipped = 0
  for (const chunk of docxText(documentXml).split(/\n\s*\n/)) {
    const text = chunk.trim()
    if (!text) continue
    const marker = /^\[\[image:([^\]]+)\]\]$/.exec(text)
    if (!marker) { blocks.push({ text, source: `${fileName} / text`, ocr: false }); continue }
    const path = targets.get(marker[1])
    const image = path ? readImage(path) : undefined
    if (!path || !image || image.length < 5000) continue
    if (imagesRead >= maxImages) { imagesSkipped += 1; continue }
    imagesRead += 1
    blocks.push({ text: await ocr(image), source: `${fileName} / ${path.split('/').pop()} (OCR)`, ocr: true })
  }
  return { blocks, imagesRead, imagesSkipped }
}

/**
 * Finds one cost per block (an invoice picture, or a paragraph group of document text). A short heading with no
 * amount is joined to the next text block ("Council Tax" above its statement row); pictures keep only their own text.
 */
export function extractExpenseRows(
  blocks: ExpenseTextBlock[], taxYearId: string, propertyNames: string[], idPrefix: string, defaultProperty?: string,
): { rows: ExpenseDocumentRow[]; outsideYear: number } {
  const merged: (ExpenseTextBlock & { key: string })[] = []
  let pending = ''
  for (const block of blocks) {
    // Embedded attachments (<<Ledger.xlsx>>) cannot be read and say nothing about neighbouring costs.
    const own = block.text.split('\n').filter((line) => !ATTACHMENT.test(line.trim())).join('\n').trim()
    if (!own) continue
    if (block.ocr) { merged.push({ ...block, text: own, key: block.source }); continue }
    if (own.startsWith(LEDGER_ROW)) { merged.push({ ...block, text: own, key: block.source }); pending = ''; continue }
    const text = `${pending}${own}`
    if (!labelledAmount(own) && !looseAmounts(own).length && own.split('\n').length <= 2 && own.length <= 60) {
      pending = `${text}\n`
      continue
    }
    pending = ''
    merged.push({ ...block, text, key: `${block.source}|${own.replace(/\s+/g, ' ')}` })
  }

  const rows: ExpenseDocumentRow[] = []
  let outsideYear = 0
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const propertyFor = (text: string) =>
    propertyNames.find((name) => normalize(name) && normalize(text).includes(normalize(name))) ?? defaultProperty

  // A ledger table is the most reliable list, so its rows come first and other mentions of the same cost are skipped.
  const ledger: ExpenseDocumentRow[] = []
  merged.forEach((block, blockIndex) => {
    if (!block.text.startsWith(LEDGER_ROW)) return
    for (const line of block.text.split('\n')) {
      const [dateCell, amountCell, description = ''] = line.slice(LEDGER_ROW.length).split(CELL).map((cell) => cell.trim())
      const amount = Number((amountCell ?? '').replace(/[£,\s]/g, ''))
      if (!Number.isFinite(amount) || amount <= 0) continue
      const date = findDates(dateCell ?? '')[0]?.date ?? null
      if (date && !isInTaxYear(date, taxYearId)) { outsideYear += 1; continue }
      ledger.push({
        property: propertyFor(`${description} ${block.text}`), ocr: false,
        evidence: {
          id: `${idPrefix}:${shortHash(`ledger|${line}`)}`, source: `${block.source} (table)`, row: blockIndex + 1,
          date: date?.toLocaleDateString('en-GB') ?? '', description: description || 'Ledger entry',
          amount, allowableAmount: 0, treatment: 'review',
          reason: `${date ? '' : 'No date found: check the tax year. '}${expenseReason(description, false)}`,
        },
      })
    }
  })
  const ledgerDates = new Map<string, number>()
  for (const row of ledger) ledgerDates.set(row.evidence.date, (ledgerDates.get(row.evidence.date) ?? 0) + row.evidence.amount)
  const coveredByLedger = (amount: number, date: string) => ledger.some((row) => row.evidence.amount === amount &&
    (!date || row.evidence.date === date)) ||
    [...ledgerDates.values()].some((total) => Math.round(total * 100) === Math.round(amount * 100))
  rows.push(...ledger)

  merged.forEach((block, blockIndex) => {
    if (block.text.startsWith(LEDGER_ROW)) return
    const labelled = labelledAmount(block.text)
    const amounts = labelled ? [labelled] : withoutPartsOfTotal(looseAmounts(block.text))
    const description = describe(block.text, block.source)
    const property = propertyFor(block.text)
    amounts.forEach((found, amountIndex) => {
      const date = amounts.length > 1 ? nearbyDate(block.text, found.index) : pickDate(block.text, found.index, taxYearId)
      if (date && !isInTaxYear(date, taxYearId)) { outsideYear += 1; return }
      const dateText = date?.toLocaleDateString('en-GB') ?? ''
      if (coveredByLedger(found.amount, dateText)) return
      if (rows.some((row) => row.evidence.amount === found.amount && row.evidence.date === dateText)) return
      rows.push({
        property, ocr: block.ocr,
        evidence: {
          // Content-based, so re-reading the same document gives the same id even if other blocks change.
          id: `${idPrefix}:${shortHash(`${block.key}|${found.amount}|${amountIndex}`)}`,
          source: block.source, row: blockIndex + 1,
          date: dateText,
          description, amount: found.amount, allowableAmount: 0, treatment: 'review',
          reason: `${date ? '' : 'No date found: check the tax year. '}${expenseReason(`${description} ${block.text}`, block.ocr)}`,
        },
      })
    })
  })
  return { rows, outsideYear }
}
