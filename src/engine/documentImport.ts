import type { PDFDocumentProxy } from 'pdfjs-dist'
import { parseWeeklyPayslip, type PayslipFigures } from './payslip'
import { extractPersonalEvidence } from './personalEvidence'
import type { BankSource, OtherIncomeReceipt, PersonalDetails, PropertyLet } from '../types'
import { classifyBankTransaction, findCharityCandidates, type SourcedBankTransaction } from './bankTransactions'
import { toOtherIncomeReceipt } from './otherIncome'
import { extractP60 } from './p60'
import { isInTaxYear, parseDate, parseMoney } from './documentValues'
import { extractPropertySpreadsheet } from './propertySpreadsheet'
import { findSourceExcerpt } from './evidenceConfidence'
import { docxExpenseBlocks, embeddedAttachments, extractExpenseRows, propertyFromFileName } from './expenseDocument'
import { findPropertyMentions, propertyNameFromFileName, resolvePropertyNames, type PropertyMention } from './propertyDiscovery'

/** Mentions from incoming payment descriptions, where tenants and agents quote the property. */
function incomingMentions(transactions: { description: string; amount: number }[]): PropertyMention[] {
  return transactions.filter((transaction) => transaction.amount > 0)
    .flatMap((transaction) => findPropertyMentions(transaction.description))
}

export type SuggestionKind =
  | 'employment'
  | 'payslipReference'
  | 'personal'
  | 'otherIncome'
  | 'interest'
  | 'dividend'
  | 'pensionIncome'
  | 'pensionContribution'
  | 'giftAid'
  | 'property'

export interface DocumentSuggestion {
  id: string
  fileName: string
  kind: SuggestionKind
  title: string
  detail: string
  confidence: 'high' | 'medium' | 'low'
  selected: boolean
  amount?: number
  employer?: string
  taxDeducted?: number
  benefitsInKind?: number
  propertyName?: string
  ownershipShare?: number
  rentalIncome?: number
  allowableExpenses?: number
  mortgageInterest?: number
  payslip?: PayslipFigures
  personalPatch?: Partial<PersonalDetails>
  p60SourceId?: string
  p60TaxYearId?: string
  propertySourceId?: string
  propertyTaxYearId?: string
  bankEvidence?: PropertyLet['bankEvidence']
  expenseEvidence?: PropertyLet['expenseEvidence']
  bankSource?: BankSource
  /** Individual unidentified receipts, for review payer by payer in Other income. */
  otherReceipts?: OtherIncomeReceipt[]
  ocr?: boolean
  sourceExcerpt?: string
}

export interface DocumentAnalysis {
  suggestions: DocumentSuggestion[]
  warnings: string[]
  bankTransactions?: SourcedBankTransaction[]
  /** Properties named in this document (rent references, invoice addresses, file name), for automatic creation. */
  propertyMentions?: PropertyMention[]
}

interface Transaction {
  date: Date | null
  description: string
  amount: number
}

const MAX_FILE_SIZE = 25 * 1024 * 1024
const MAX_OCR_PAGES = 20
const SUPPORTED_EXTENSIONS = /\.(pdf|csv|xlsx|xlsm|docx|png|jpe?g|webp|bmp|tiff?)$/i
let suggestionSequence = 0

export function isSupportedDocument(file: File): boolean {
  return SUPPORTED_EXTENSIONS.test(file.name)
}

function makeSuggestion(
  file: File,
  kind: SuggestionKind,
  title: string,
  detail: string,
  values: Partial<Pick<DocumentSuggestion,
    | 'amount'
    | 'employer'
    | 'taxDeducted'
    | 'benefitsInKind'
    | 'propertyName'
    | 'ownershipShare'
    | 'rentalIncome'
    | 'allowableExpenses'
    | 'mortgageInterest'
  >>,
  confidence: DocumentSuggestion['confidence'],
): DocumentSuggestion {
  suggestionSequence += 1
  return {
    id: `${Date.now()}-${suggestionSequence}`,
    fileName: file.name,
    kind,
    title,
    detail,
    confidence,
    selected: false,
    ...values,
  }
}

function csvRows(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  const delimiter = [',', ';', '\t'].sort(
    (a, b) => firstLine.split(b).length - firstLine.split(a).length,
  )[0]
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"'
        i += 1
      } else {
        quoted = !quoted
      }
    } else if (char === delimiter && !quoted) {
      row.push(cell.trim())
      cell = ''
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[i + 1] === '\n') i += 1
      row.push(cell.trim())
      if (row.some((value) => value !== '')) rows.push(row)
      row = []
      cell = ''
    } else {
      cell += char
    }
  }
  row.push(cell.trim())
  if (row.some((value) => value !== '')) rows.push(row)
  return rows
}

function spreadsheetTransactions(
  rows: unknown[][],
  taxYearId: string,
): Transaction[] {
  const headerRowIndex = rows.findIndex((row) => {
    const header = row.map((cell) => String(cell ?? '').toLowerCase()).join(' ')
    return /date|transaction/.test(header) && /description|details|narrative|payee|reference/.test(header)
  })
  if (headerRowIndex < 0) return []

  const headers = rows[headerRowIndex].map((cell) => String(cell ?? '').toLowerCase().trim())
  const findColumn = (pattern: RegExp) => headers.findIndex((header) => pattern.test(header))
  const dateColumn = findColumn(/date/)
  const descriptionColumn = findColumn(/description|details|narrative|payee|reference/)
  const amountColumn = findColumn(/^amount\b|transaction amount/)
  const paidInColumn = findColumn(/paid in|money in|credit/)
  const paidOutColumn = findColumn(/paid out|money out|debit/)
  if (dateColumn < 0 || descriptionColumn < 0 || (amountColumn < 0 && paidInColumn < 0 && paidOutColumn < 0)) return []

  const transactions: Transaction[] = []
  for (const row of rows.slice(headerRowIndex + 1)) {
    const date = parseDate(row[dateColumn])
    if (!date || !isInTaxYear(date, taxYearId)) continue
    const description = String(row[descriptionColumn] ?? '').trim()
    if (!description) continue

    let amount: number | null = null
    if (paidInColumn >= 0 || paidOutColumn >= 0) {
      const paidIn = paidInColumn >= 0 ? Math.abs(parseMoney(row[paidInColumn]) ?? 0) : 0
      const paidOut = paidOutColumn >= 0 ? Math.abs(parseMoney(row[paidOutColumn]) ?? 0) : 0
      if (paidIn > 0 && paidOut > 0) throw new Error('A dated transaction has both incoming and outgoing amounts. Correct or split that row before importing bank figures.')
      if (paidIn > 0) amount = paidIn
      else if (paidOut > 0) amount = -paidOut
    } else if (amountColumn >= 0) {
      amount = parseMoney(row[amountColumn])
    }
    if (amount !== null && amount !== 0) transactions.push({ date, description, amount })
  }

  return transactions
}

function statementTextTransactions(text: string, taxYearId: string): Transaction[] {
  const transactions: Transaction[] = []
  for (const line of text.split(/\r?\n/)) {
    const dateMatch = line.match(/^\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})\s+/)
    if (!dateMatch) continue
    const date = parseDate(dateMatch[1])
    if (!date || !isInTaxYear(date, taxYearId)) continue
    const remainder = line.slice(dateMatch[0].length)
    const amounts = [...remainder.matchAll(/(-\s*£?\s*|\(\s*£?\s*|£\s*)(\d[\d,]*\.\d{2})(?:\s*(DR|CR))?/gi)]
    if (amounts.length !== 1) continue
    const match = amounts[0]
    const explicitSign = match[1]
    const direction = match[3]?.toUpperCase()
    const isDebit = /-|\(/.test(explicitSign) || direction === 'DR'
    const isCredit = /£/.test(explicitSign) && !isDebit || direction === 'CR'
    if (!isDebit && !isCredit) continue
    const description = remainder.slice(0, match.index).trim()
    if (!description) continue
    const amount = Number(match[2].replace(/,/g, '')) * (isDebit ? -1 : 1)
    if (Number.isFinite(amount) && amount !== 0) transactions.push({ date, description, amount })
  }
  return transactions
}

function suggestionsFromTransactions(
  file: File,
  transactions: SourcedBankTransaction[],
  taxYearId: string,
  pensionRecipients: string[],
  donationRecipients: string[],
): DocumentSuggestion[] {
  const grouped: Record<'interest' | 'dividend' | 'pensionContribution' | 'giftAid' | 'otherIncome', SourcedBankTransaction[]> = {
    interest: [],
    dividend: [],
    pensionContribution: [],
    giftAid: [],
    otherIncome: [],
  }
  // Regular round monthly payees (likely donations) count as donations without needing a saved charity name.
  const likelyDonations = findCharityCandidates(
    transactions.map((transaction, index) => ({ ...transaction, id: `${file.name}:${index}`, source: file.name })),
    pensionRecipients, donationRecipients,
  ).filter((candidate) => candidate.confidence === 'likely').map((candidate) => candidate.recipient)
  const donationNames = [...donationRecipients, ...likelyDonations]
  for (const transaction of transactions) {
    const kind = classifyBankTransaction(transaction, pensionRecipients, donationNames)
    if (kind) grouped[kind].push(transaction)
  }

  const suggestions: DocumentSuggestion[] = []
  for (const [kind, matches] of Object.entries(grouped) as [keyof typeof grouped, SourcedBankTransaction[]][]) {
    if (!matches.length) continue
    const amount = Math.round(matches.reduce((sum, item) => sum + Math.abs(item.amount), 0) * 100) / 100
    const descriptions = matches.map((item) =>
      `${item.date?.toLocaleDateString('en-GB')}: ${item.description} (£${Math.abs(item.amount).toFixed(2)})`).join('; ')
    const giftAidNote = kind === 'giftAid'
      ? 'Donation payments populate Gift Aid review in Income automatically. A bank payment does not prove Gift Aid eligibility; confirm the declaration and qualifying net amount there before claiming relief.' +
        (likelyDonations.length ? ` Includes likely donations identified from the same amount paid every month: ${likelyDonations.join(', ')}.` : '')
      : ''
    const detail = `${matches.length} matching transaction${matches.length === 1 ? '' : 's'} in ${taxYearId}. ${descriptions}.${giftAidNote ? ` ${giftAidNote}` : ''}`
    const titles = {
      interest: 'Possible bank interest',
      dividend: 'Possible dividend income',
      pensionContribution: 'Possible pension contributions',
      giftAid: 'Possible charitable donations (Gift Aid unconfirmed)',
      otherIncome: 'Unclassified bank receipts (taxability unconfirmed)',
    }
    const suggestion = makeSuggestion(file, kind, titles[kind], detail, { amount }, 'low')
    suggestions.push(kind === 'otherIncome' ? { ...suggestion, otherReceipts: matches.map(toOtherIncomeReceipt) } : suggestion)
  }
  return suggestions
}

function extractLabelAmount(text: string, labels: string[]): number | undefined {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = text.match(new RegExp(`(?:${escaped})[^\\d£]{0,50}£?\\s*(\\d[\\d,]*(?:\\.\\d{1,2})?)`, 'i'))
    if (match) {
      const amount = parseMoney(match[1])
      if (amount !== null) return Math.abs(amount)
    }
  }
  return undefined
}

function suggestionsFromText(file: File, text: string): DocumentSuggestion[] {
  const normalized = text.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ')
  const lower = normalized.toLowerCase()
  const suggestions: DocumentSuggestion[] = []
  const employer = normalized.match(/^(?:employer(?:'s)? name|employer)\s*:\s*(.+)$/im)?.[1]?.trim() ??
    file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ')
  const payslip = parseWeeklyPayslip(normalized)
  for (const item of extractPersonalEvidence(normalized)) {
    suggestions.push({
      ...makeSuggestion(file, 'personal', `Personal details: ${item.label}`,
        `Document evidence: "${item.evidence}". Confirm this applies to you and the selected tax year. Import replaces this field's current value; absence of evidence is never treated as no.`,
        {}, 'medium'),
      personalPatch: item.patch,
    })
  }

  if (payslip) {
    const suggestion = makeSuggestion(
      file, 'payslipReference', 'Weekly payslip (supporting evidence only)',
      'Use the P60 as the main source for annual employment pay and tax. These weekly and year-to-date figures are supporting evidence only and cannot be imported into the tax calculation. NI and NEST deductions do not automatically claim pension relief.',
      {
        employer: '',
        amount: payslip.weekly.grossPay,
        taxDeducted: payslip.weekly.taxPaid,
      }, 'low',
    )
    suggestions.push({
      ...suggestion, payslip,
    })
  }

  if (/p60|certificate of pay and tax/.test(lower)) {
    const pay = extractLabelAmount(normalized, [
      'total pay for income tax purposes',
      'pay for income tax purposes',
      'taxable pay',
      'pay in this employment',
    ])
    const tax = extractLabelAmount(normalized, ['income tax deducted', 'total tax deducted', 'tax deducted'])
    if (pay !== undefined || tax !== undefined) {
      suggestions.push(makeSuggestion(
        file,
        'employment',
        'P60 employment pay and tax',
        'Figures were read from a P60. Check the tax-year dates and compare the extracted values with the original document.',
        { employer, ...(pay === undefined ? {} : { amount: pay }), ...(tax === undefined ? {} : { taxDeducted: tax }) },
        pay !== undefined && tax !== undefined ? 'high' : 'medium',
      ))
    }
  }

  if (/p11d/.test(lower)) {
    const benefits = extractLabelAmount(normalized, [
      'total cash equivalent',
      'cash equivalent of all benefits',
      'total value of benefits',
    ])
    if (benefits !== undefined) {
      suggestions.push(makeSuggestion(
        file,
        'employment',
        'P11D benefits in kind',
        'Check this amount against the total taxable benefits on the P11D.',
        { employer, benefitsInKind: benefits },
        'medium',
      ))
    }
  }

  if (/interest certificate|gross interest|interest paid/.test(lower)) {
    const amount = extractLabelAmount(normalized, ['gross interest', 'total interest paid', 'interest paid'])
    if (amount !== undefined) {
      suggestions.push(makeSuggestion(
        file, 'interest', 'Possible savings interest',
        'Check that this is the total taxable interest for the selected tax year.',
        { amount }, 'medium',
      ))
    }
  }

  if (/dividend voucher|dividend statement|dividends paid/.test(lower)) {
    const amount = extractLabelAmount(normalized, ['total dividends', 'dividends paid', 'dividend income'])
    if (amount !== undefined) {
      suggestions.push(makeSuggestion(
        file, 'dividend', 'Possible dividend income',
        'Check the voucher or statement total and tax-year dates.',
        { amount }, 'medium',
      ))
    }
  }

  if (/state pension|pension payment statement/.test(lower)) {
    const amount = extractLabelAmount(normalized, ['total state pension', 'total pension paid', 'pension paid'])
    if (amount !== undefined) {
      suggestions.push(makeSuggestion(
        file, 'pensionIncome', 'Possible pension income',
        'Check that this is the taxable pension amount for the selected tax year.',
        { amount, taxDeducted: extractLabelAmount(normalized, ['income tax deducted', 'tax deducted']) }, 'low',
      ))
    }
  }

  if (/gift aid|charitable donation|charity donation/.test(lower)) {
    const amount = extractLabelAmount(normalized, ['total gift aid donations', 'gift aid donations', 'total donations'])
    if (amount !== undefined) {
      suggestions.push(makeSuggestion(
        file, 'giftAid', 'Possible Gift Aid donations',
        'Confirm the amount is the net amount you donated and that the donations were made under Gift Aid.',
        { amount }, 'medium',
      ))
    }
  }

  if (!payslip && /pension contribution|personal pension|sipp/.test(lower)) {
    const amount = extractLabelAmount(normalized, ['total contributions paid', 'total contributions', 'contributions paid'])
    if (amount !== undefined) {
      suggestions.push(makeSuggestion(
        file, 'pensionContribution', 'Possible personal pension contributions',
        'Check this is the net amount you personally paid into a relief-at-source pension, not an employer contribution.',
        { amount }, 'low',
      ))
    }
  }

  if (/letting statement|rental statement|rental income summary|property income statement/.test(lower)) {
    const rentalIncome = extractLabelAmount(normalized, ['gross rental income', 'total rent received', 'rental income'])
    if (rentalIncome !== undefined) {
      const allowableExpenses = extractLabelAmount(normalized, ['allowable expenses excluding finance costs', 'allowable expenses'])
      const mortgageInterest = extractLabelAmount(normalized, ['mortgage interest', 'finance costs', 'loan interest'])
      suggestions.push(makeSuggestion(
        file,
        'property',
        'Possible rental property figures',
        'Confirm the tax year, ownership share, and that allowable expenses exclude mortgage/finance interest before importing.',
        {
          propertyName: file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '),
          ownershipShare: 1,
          rentalIncome,
          ...(allowableExpenses === undefined ? {} : { allowableExpenses }),
          ...(mortgageInterest === undefined ? {} : { mortgageInterest }),
        },
        'low',
      ))
    }
  }

  if (/other taxable income statement|taxable income summary/.test(lower)) {
    const amount = extractLabelAmount(normalized, ['total other taxable income', 'other taxable income'])
    if (amount !== undefined) suggestions.push(makeSuggestion(
      file, 'otherIncome', 'Other taxable income (review required)',
      'Confirm this is an annual taxable income total, not gross receipts or income already entered elsewhere. Trust income and chargeable event gains need specialist treatment and are not computed here.',
      { amount }, 'low',
    ))
  }

  return suggestions
}

async function extractPdfText(file: File): Promise<{ text: string; scanned: boolean; p60: ReturnType<typeof extractP60> }> {
  const [{ getDocument, GlobalWorkerOptions }, { default: workerUrl }] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ])
  GlobalWorkerOptions.workerSrc = workerUrl
  const pdf = await getDocument({ data: await file.arrayBuffer() }).promise
  const pageTexts: string[] = []
  let p60: ReturnType<typeof extractP60> = null
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber)
    const content = await page.getTextContent()
    p60 ??= extractP60(content.items.filter((item) => 'str' in item))
    const text = content.items
      .map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : ''))
      .join('')
    pageTexts.push(text)
  }
  const text = pageTexts.join('\n')
  if (text.replace(/\s/g, '').length > 20) return { text, scanned: false, p60 }
  return { text: await ocrPdf(pdf, pdf.numPages), scanned: true, p60 }
}

/** Read an invoice as an unconfirmed proposal. The user must choose its purpose and accounting date. */
export async function readBusinessInvoice(file: File): Promise<{ amount?: number; hash: string; warning: string }> {
  if (file.size > MAX_FILE_SIZE) throw new Error('The invoice exceeds the 25 MB per-file limit.')
  const extension = file.name.split('.').pop()?.toLowerCase()
  let text: string
  let scanned = false
  if (extension === 'pdf') {
    const result = await extractPdfText(file)
    text = result.text
    scanned = result.scanned
  } else if (extension && /^(png|jpe?g|webp|bmp|tiff?)$/.test(extension)) {
    text = await extractImageText(file)
    scanned = true
  } else {
    throw new Error('Use a PDF or image invoice, or enter its figures manually.')
  }
  const matches = [...text.matchAll(/\b(?:invoice total|total due|amount due|grand total|total)\s*[:£]?\s*(?:£|GBP)?\s*([\d,]+(?:\.\d{2})?)/gi)]
    .map((match) => Number(match[1].replace(/,/g, ''))).filter((amount) => Number.isFinite(amount) && amount > 0)
  const unique = [...new Set(matches)]
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  return {
    ...(unique.length === 1 ? { amount: unique[0] } : {}),
    hash,
    warning: `${scanned ? 'OCR was used and scanned PDFs are limited to the first 20 pages. ' : ''}` +
      (unique.length === 1 ? 'Check the proposed total, including VAT treatment.' : 'No unambiguous total found; enter it from the invoice.'),
  }
}

async function ocrPdf(pdf: PDFDocumentProxy, pageCount: number): Promise<string> {
  const { createWorker } = await import('tesseract.js')
  const worker = await createWorker('eng')
  const recognized: string[] = []
  try {
    for (let pageNumber = 1; pageNumber <= Math.min(pageCount, MAX_OCR_PAGES); pageNumber += 1) {
      const page = await pdf.getPage(pageNumber)
      const viewport = page.getViewport({ scale: 1.5 })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Could not create a canvas to read this scanned PDF.')
      await page.render({ canvas, canvasContext: context, viewport }).promise
      const result = await worker.recognize(canvas)
      recognized.push(result.data.text)
      canvas.width = 0
      canvas.height = 0
    }
  } finally {
    await worker.terminate()
  }
  return recognized.join('\n')
}

/** This app's own spreadsheet exports contain copies of source transactions and must not be re-analysed. */
export function isTaxDraftExport(sheetNames: string[]): boolean {
  return ['Read me', 'Computation', 'Tax year rates'].every((name) => sheetNames.includes(name))
}

async function extractSpreadsheetRows(file: File): Promise<{ name: string; rows: unknown[][] }[]> {
  const XLSX = await import('@e965/xlsx')
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true })
  return workbook.SheetNames.map((name) => ({
    name, rows: XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, raw: true, defval: '' }),
  }))
}

async function addBankSources(file: File, suggestions: DocumentSuggestion[], taxYearId: string, source: string): Promise<DocumentSuggestion[]> {
  return Promise.all(suggestions.map(async (suggestion) => {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${source}:${suggestion.kind}:${suggestion.detail}`))
    const id = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
    return { ...suggestion, selected: true, bankSource: {
      id, fileName: file.name, taxYearId, recordedAmount: suggestion.amount ?? 0,
      evidence: suggestion.detail, verified: false,
      groupKey: `${source}:${suggestion.kind}:${taxYearId}`,
    } }
  }))
}

async function analyzeSpreadsheetSheets(file: File, sheets: { name: string; rows: unknown[][] }[], taxYearId: string, pensionRecipients: string[], donationRecipients: string[]): Promise<DocumentAnalysis> {
  const suggestions: DocumentSuggestion[] = []
  const warnings: string[] = []
  const bankTransactions: SourcedBankTransaction[] = []
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  const source = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  for (const sheet of sheets) {
    const supplierLedger = sheet.rows.some((row) => row.some((cell) => /^supplier$/i.test(String(cell).trim())))
    let bankTransactionsFound = false
    if (!supplierLedger) {
      const transactions = spreadsheetTransactions(sheet.rows, taxYearId)
      bankTransactionsFound = transactions.length > 0
      // A CSV has one "sheet" named after the file; don't repeat the name.
      const label = sheet.name === file.name ? file.name : `${file.name} / ${sheet.name}`
      const sourced = transactions.map((transaction, index) => ({
        ...transaction, id: `${source}:${sheet.name}:${index}`, source: label,
        sourceKey: `${source}:${sheet.name}`,
      }))
      bankTransactions.push(...sourced)
      suggestions.push(...await addBankSources(file, suggestionsFromTransactions(file, sourced, taxYearId, pensionRecipients, donationRecipients), taxYearId, `${source}:${sheet.name}`))
    }
    const property = extractPropertySpreadsheet(sheet.rows, sheet.name, taxYearId)
    warnings.push(...property.warnings.map((warning) => `${file.name}: ${warning}`))
    for (const { detail, ...values } of property.figures) {
      const propertyValues = bankTransactionsFound ? {
        ...values,
        rentalIncome: undefined,
        bankEvidence: values.bankEvidence?.filter((evidence) => evidence.kind !== 'possibleRent'),
      } : values
      if (bankTransactionsFound && !(propertyValues.allowableExpenses || propertyValues.mortgageInterest ||
        propertyValues.bankEvidence?.length || propertyValues.expenseEvidence?.length)) continue
      suggestions.push({
        ...makeSuggestion(file, 'property', `Property figures: ${propertyValues.propertyName}`, detail, propertyValues, 'low'),
        bankEvidence: propertyValues.bankEvidence,
        expenseEvidence: propertyValues.expenseEvidence?.map((expense) => ({
          ...expense, id: `${source}:${expense.id}`, source: `${file.name} / ${sheet.name}`,
        })),
        selected: true,
        propertySourceId: `${source}:${sheet.name}:${propertyValues.propertyName}:${taxYearId}`,
        propertyTaxYearId: taxYearId,
      })
    }
  }
  if (!suggestions.length && !bankTransactions.length) warnings.push(`${file.name}: no supported tax figures recognised across ${sheets.length} worksheet(s). Check labels, dates and transaction directions.`)
  return { suggestions, warnings, bankTransactions }
}

async function extractImageText(file: File): Promise<string> {
  const { createWorker } = await import('tesseract.js')
  const worker = await createWorker('eng')
  try {
    const result = await worker.recognize(file)
    return result.data.text
  } finally {
    await worker.terminate()
  }
}

async function sha256(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Word documents of receipts and invoices: reads the text and OCRs each embedded picture, then proposes one
 * expense row per invoice. Rows go to the property named in them, or to an unallocated entry, for confirmation.
 */
async function analyzeWordDocument(file: File, taxYearId: string, propertyNames: string[]): Promise<DocumentAnalysis> {
  const XLSX = await import('@e965/xlsx')
  const buffer = await file.arrayBuffer()
  const zip = XLSX.CFB.read(new Uint8Array(buffer), { type: 'array' })
  const read = (path: string) => XLSX.CFB.find(zip, `/${path}`)?.content as Uint8Array | undefined
  const documentXml = read('word/document.xml')
  if (!documentXml) return { suggestions: [], warnings: [`${file.name}: not a readable Word (.docx) document.`] }
  const decode = (bytes?: Uint8Array) => bytes ? new TextDecoder().decode(bytes) : ''

  let worker: Awaited<ReturnType<typeof import('tesseract.js')['createWorker']>> | undefined
  let extracted: Awaited<ReturnType<typeof docxExpenseBlocks>>
  try {
    extracted = await docxExpenseBlocks(decode(documentXml), decode(read('word/_rels/document.xml.rels')), file.name, read,
      async (image) => {
        if (!worker) worker = await (await import('tesseract.js')).createWorker('eng')
        return (await worker.recognize(new Blob([new Uint8Array(image)]))).data.text
      })
  } finally {
    await worker?.terminate()
  }

  const source = await sha256(buffer)
  const fileNameProperty = propertyNameFromFileName(file.name)
  const propertyMentions = [
    ...extracted.blocks.flatMap((block) => findPropertyMentions(block.text)),
    ...(fileNameProperty ? [{ name: fileNameProperty, typed: true }] : []),
  ]
  // Properties named in this document are matched (and created on import) even if no workbook listed them.
  const knownNames = [...propertyNames, ...resolvePropertyNames(propertyMentions, propertyNames)]
    .filter((name, index, all) => all.indexOf(name) === index)
  const { rows, outsideYear } = extractExpenseRows(extracted.blocks, taxYearId, knownNames, `${source}:docx`,
    propertyFromFileName(file.name, knownNames))
  const warnings: string[] = []
  if (extracted.imagesRead) warnings.push(`${file.name}: ${extracted.imagesRead} picture${extracted.imagesRead === 1 ? '' : 's'} read by OCR; check each amount and date against the original.`)
  if (extracted.imagesSkipped) warnings.push(`${file.name}: ${extracted.imagesSkipped} further picture(s) were not read (limit reached). Add those expenses manually.`)
  if (outsideYear) warnings.push(`${file.name}: ${outsideYear} expense${outsideYear === 1 ? '' : 's'} dated outside ${taxYearId} ignored.`)
  const attachments = embeddedAttachments(extracted.blocks)
  if (attachments.length) warnings.push(`${file.name}: contains embedded file${attachments.length === 1 ? '' : 's'} that cannot be read from inside Word (${attachments.join(', ')}). Save them into the folder separately if they hold expenses.`)
  if (!rows.length) {
    warnings.push(`${file.name}: no dated expense amounts recognised for ${taxYearId}. Enter its costs manually in Income.`)
    return { suggestions: [], warnings, propertyMentions }
  }

  const groups = new Map<string, typeof rows>()
  for (const row of rows) {
    const name = row.property ?? `Unallocated expenses: ${file.name}`
    groups.set(name, [...groups.get(name) ?? [], row])
  }
  const suggestions: DocumentSuggestion[] = [...groups].map(([propertyName, group]) => ({
    ...makeSuggestion(file, 'property', `Expenses from ${file.name}: ${propertyName}`,
      `${group.length} expense${group.length === 1 ? '' : 's'} found in ${file.name}${group.some((row) => row.ocr) ? ' (some read from pictures by OCR)' : ''}. ` +
      'Each is excluded until you confirm the allowable amount in Income.' +
      (propertyName.startsWith('Unallocated') ? ' No property was named for these; assign them to a property in Income.' : ''),
      { propertyName, allowableExpenses: 0 }, 'low'),
    ocr: group.some((row) => row.ocr),
    expenseEvidence: group.map((row) => row.evidence),
    selected: true,
    propertySourceId: `${source}:docx:${propertyName}:${taxYearId}`,
    propertyTaxYearId: taxYearId,
  }))
  warnings.push(`${file.name}: ${rows.length} expense${rows.length === 1 ? '' : 's'} added to Income → Land and property for review.`)
  return { suggestions, warnings, propertyMentions }
}

export async function analyzeDocument(file: File, taxYearId: string, pensionRecipients: string[] = [], donationRecipients: string[] = [], propertyNames: string[] = []): Promise<DocumentAnalysis> {
  if (!isSupportedDocument(file)) return { suggestions: [], warnings: [] }
  if (file.size > MAX_FILE_SIZE) {
    return { suggestions: [], warnings: [`${file.name} is larger than the 25 MB per-file limit and was skipped.`] }
  }

  try {
    const extension = file.name.split('.').pop()?.toLowerCase()
    const withMentions = (analysis: DocumentAnalysis): DocumentAnalysis =>
      ({ ...analysis, propertyMentions: incomingMentions(analysis.bankTransactions ?? []) })
    if (extension === 'csv') {
      return withMentions(await analyzeSpreadsheetSheets(file, [{ name: file.name, rows: csvRows(await file.text()) }], taxYearId, pensionRecipients, donationRecipients))
    }

    if (extension === 'docx') return await analyzeWordDocument(file, taxYearId, propertyNames)

    if (extension === 'xlsx' || extension === 'xlsm') {
      const sheets = await extractSpreadsheetRows(file)
      if (isTaxDraftExport(sheets.map((sheet) => sheet.name))) {
        return { suggestions: [], warnings: [`${file.name}: skipped because it is a TaxDraft export, not a source document. Reading it would count your bank transactions twice. Use Import spreadsheet to restore a saved return.`] }
      }
      return withMentions(await analyzeSpreadsheetSheets(file, sheets, taxYearId, pensionRecipients, donationRecipients))
    }

    let text: string
    let scanned = false
    let p60: ReturnType<typeof extractP60> = null
    if (extension === 'pdf') {
      const pdfResult = await extractPdfText(file)
      text = pdfResult.text
      scanned = pdfResult.scanned
      p60 = pdfResult.p60
    } else {
      text = await extractImageText(file)
      scanned = true
    }

    let suggestions = suggestionsFromText(file, text)
    const warnings: string[] = []
    if (/\bP60\b/i.test(text)) {
      suggestions = suggestions.filter((suggestion) => suggestion.title !== 'P60 employment pay and tax')
      if (!p60) {
        warnings.push(`${file.name}: P60 pay/tax columns could not be mapped safely. Enter figures manually from "In this employment", not "Total for year".`)
      } else if (p60.taxYearId !== taxYearId) {
        warnings.push(`${file.name}: P60 is for ${p60.taxYearId}, not selected ${taxYearId}. Select its tax year and reanalyze; no employment figures were imported.`)
      } else {
        const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
        const sourceId = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
        suggestions.push({
          ...makeSuggestion(file, 'employment', 'P60 automatically populated in Income',
            'Pay and tax from "In this employment" have been populated in Income, pending verification. Previous employment and Total for year were not added. Check the employer and figures.',
            { amount: p60.pay, taxDeducted: p60.tax, employer: p60.employer || file.name },
            'high'),
          selected: true, p60SourceId: sourceId, p60TaxYearId: p60.taxYearId,
        })
      }
    }
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
    const source = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
    const statementTransactions = statementTextTransactions(text, taxYearId).map((transaction, index) => ({
      ...transaction, id: `${source}:PDF:${index}`, source: file.name, sourceKey: `${source}:PDF`,
    }))
    const statementSuggestions = await addBankSources(file, suggestionsFromTransactions(file, statementTransactions, taxYearId, pensionRecipients, donationRecipients), taxYearId, 'PDF transactions')
    for (const suggestion of statementSuggestions) {
      suggestions = suggestions.filter((existing) => existing.kind !== suggestion.kind)
      suggestions.push(suggestion)
    }
    if (statementTransactions.length && !suggestions.some((suggestion) => suggestion.kind === 'property')) {
      const statement = await analyzeSpreadsheetSheets(file, [{
        name: 'Bank statement',
        rows: [['Date', 'Description', 'Money in', 'Money out'], ...statementTransactions.map((transaction) => [
          transaction.date, transaction.description, Math.max(0, transaction.amount), Math.max(0, -transaction.amount),
        ])],
      }], taxYearId, pensionRecipients, donationRecipients)
      suggestions.push(...statement.suggestions.filter((suggestion) => suggestion.kind === 'property'))
      warnings.push(...statement.warnings)
    }
    if (scanned && extension === 'pdf') {
      warnings.push(`${file.name}: OCR was used; scanned PDFs are limited to the first ${MAX_OCR_PAGES} pages and may be misread.`)
    } else if (scanned) {
      warnings.push(`${file.name}: OCR was used; verify all extracted figures against the image.`)
    }
    if (!suggestions.length) warnings.push(`${file.name}: text was read, but no supported tax figures could be confidently identified.`)
    suggestions = suggestions.map((suggestion) => ({
      ...suggestion,
      ocr: scanned,
      sourceExcerpt: suggestion.sourceExcerpt ?? findSourceExcerpt(text, [
        suggestion.amount, suggestion.taxDeducted, suggestion.rentalIncome,
        suggestion.allowableExpenses, suggestion.mortgageInterest, suggestion.benefitsInKind,
      ]),
    }))
    return { suggestions, warnings, propertyMentions: findPropertyMentions(text), bankTransactions: statementTransactions }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { suggestions: [], warnings: [`${file.name}: could not be analyzed — ${message}`] }
  }
}
