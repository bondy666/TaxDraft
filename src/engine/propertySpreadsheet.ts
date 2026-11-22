import { isInTaxYear, parseDate, parseMoney } from './documentValues.ts'
import type { PropertyLet } from '../types'

export interface PropertySpreadsheetFigures {
  propertyName: string
  rentalIncome?: number
  allowableExpenses?: number
  mortgageInterest?: number
  ownershipShare?: number
  detail: string
  bankEvidence?: PropertyLet['bankEvidence']
  expenseEvidence?: PropertyLet['expenseEvidence']
}

const expensePattern = /\b(?:service charge|ground rent|repairs?|callout fee|electricity|water bill|gas bill|buildings? insurance|landlord insurance|letting fees?|management fees?|agent fees?|council tax)\b/i
const interestPattern = /\b(?:mortgage interest|loan interest|finance interest|finance costs)\b/i
const unsafeCostPattern = /\b(?:capital|improvement|purchase|deposit|repayment|mortgage|personal|private)\b/i

function label(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/[£():]/g, '').replace(/\s+/g, ' ').trim()
}

export function extractPropertySpreadsheet(
  rows: unknown[][],
  sheetName: string,
  taxYearId: string,
): { figures: PropertySpreadsheetFigures[]; warnings: string[] } {
  const warnings: string[] = []
  const figures: PropertySpreadsheetFigures[] = []
  const headerIndex = rows.findIndex((row) =>
    row.some((cell) => label(cell) === 'date') &&
    row.some((cell) => label(cell) === 'description'),
  )
  if (headerIndex >= 0) {
    const headers = rows[headerIndex].map(label)
    const column = (pattern: RegExp) => headers.findIndex((cell) => pattern.test(cell))
    const dateColumn = column(/^date$/)
    const descriptionColumn = column(/^description$/)
    const amountColumn = column(/^amount$/)
    const inColumn = column(/^(?:money in|paid in|credit)$/)
    const outColumn = column(/^(?:money out|paid out|debit)$/)
    const supplierColumn = column(/^supplier$/)
    const propertyColumn = column(/^(?:property|property name|property address)$/)
    const signedBank = inColumn < 0 && outColumn < 0 && amountColumn >= 0 && supplierColumn < 0
    const bank = inColumn >= 0 || outColumn >= 0 || signedBank
    const expenseLedger = !bank && supplierColumn >= 0 && amountColumn >= 0
    if (!bank && !expenseLedger) return { figures, warnings }
    const groups = new Map<string, { rent: number; expenses: number; interest: number; counts: number[]; evidence: NonNullable<PropertyLet['expenseEvidence']> }>()
    const unknownCosts: number[] = []
    const unmappedReceipts: number[] = []
    const invalidRows: number[] = []
    const references = new Map<string, {
      incoming: number; outgoing: number; kind: 'mortgage' | 'possibleRent'
    }>()
    for (const [index, row] of rows.slice(headerIndex + 1).entries()) {
      const rowNumber = headerIndex + index + 2
      if (!row.some((cell) => String(cell ?? '').trim())) continue
      if (row.some((cell) => /^(?:combined )?total(?: for year)?$/i.test(String(cell ?? '').trim()))) continue
      const date = parseDate(row[dateColumn])
      if (!date) { invalidRows.push(rowNumber); continue }
      if (!isInTaxYear(date, taxYearId)) continue
      const description = String(row[descriptionColumn] ?? '').trim()
      const property = propertyColumn >= 0 ? String(row[propertyColumn] ?? '').trim() : ''
      const name = property || (expenseLedger ? sheetName : 'Unallocated rental receipts / costs')
      const signedAmount = signedBank ? parseMoney(row[amountColumn]) : null
      const paidIn = signedBank ? (signedAmount === null ? null : Math.max(0, signedAmount))
        : inColumn >= 0 ? parseMoney(row[inColumn]) : null
      const paidOut = signedBank ? (signedAmount === null ? null : Math.max(0, -signedAmount))
        : outColumn >= 0 ? parseMoney(row[outColumn]) : null
      const amount = expenseLedger ? parseMoney(row[amountColumn]) : paidOut
      if (bank && ((paidIn === null && paidOut === null) ||
        (paidIn !== null && paidIn < 0) || (paidOut !== null && paidOut < 0))) {
        invalidRows.push(rowNumber)
        continue
      }
      if (bank && paidIn && paidOut) { invalidRows.push(rowNumber); continue }
      const lender = description.match(/\b(?:natwest(?: bank)?|halifax|virgin money)\b/i)?.[0].toUpperCase()
      const mortgage = /\bmortgage\b/i.test(description)
      const flatReceipt = bank && !mortgage && paidIn !== null && paidIn > 0 && /\bflat(?=\b|\d)/i.test(description)
      if (bank && (mortgage || (lender && paidOut !== null && paidOut > 0) || flatReceipt)) {
        const referenceLabel = flatReceipt ? description : lender || 'Mortgage-labelled transfers'
        const reference = references.get(referenceLabel) ?? {
          incoming: 0, outgoing: 0, kind: flatReceipt ? 'possibleRent' : 'mortgage',
        }
        reference.incoming += paidIn ?? 0
        reference.outgoing += paidOut ?? 0
        references.set(referenceLabel, reference)
        continue
      }
      let kind: 'rent' | 'expenses' | 'interest' | undefined
      let value: number | null = null
      if (bank && paidIn !== null && paidIn > 0) {
        if (/\brent(?:al)?\b/i.test(description) && !/\b(?:refund|deposit|mortgage|transfer)\b/i.test(description)) {
          kind = 'rent'
          value = paidIn
        } else if (/\bflat\b/i.test(description)) unmappedReceipts.push(rowNumber)
      } else if (expenseLedger && amount !== null && amount > 0) {
        if (interestPattern.test(description) && !/\b(?:repayment|capital|private|personal)\b/i.test(description)) kind = 'interest'
        else if (expensePattern.test(description) && !unsafeCostPattern.test(description)) kind = 'expenses'
        else if (expenseLedger || /\bmortgage\b/i.test(description)) unknownCosts.push(rowNumber)
        value = amount
      } else if (expenseLedger || (bank && paidOut !== null && paidOut < 0)) {
        invalidRows.push(rowNumber)
      }
      if (expenseLedger && amount !== null && amount > 0) {
        const treatment = kind === 'expenses' ? 'runningCost' : kind === 'interest' ? 'interest'
          : /\b(?:mortgage|repayment)\b/i.test(description) ? 'repayment' : 'review'
        const reason = treatment === 'runningCost'
          ? 'Possible running cost: confirm rental-business use, ownership and that this is not a capital improvement.'
          : treatment === 'interest'
            ? 'Recorded separately as mortgage/finance interest, not in allowable running expenses. Verify the loan relates to the letting business.'
            : treatment === 'repayment'
              ? 'Potentially non-allowable: a mortgage/loan repayment is not a running expense. Obtain the interest component separately.'
              : /\b(?:petrol|fuel|diesel|mileage|travel)\b/i.test(description)
                ? 'Travel review: confirm the rental-business purpose and business portion. Do not count petrol on top of a mileage claim for the same journeys; retain journey records.'
                : unsafeCostPattern.test(description)
                  ? 'Potentially non-allowable: may include capital, private costs, deposits or transfers. Check the invoice and tax treatment.'
                  : 'Allowability unclear: check the invoice, rental-business purpose and any private/capital element before including a business amount.'
        const group = groups.get(name) ?? { rent: 0, expenses: 0, interest: 0, counts: [0, 0, 0], evidence: [] }
        group.evidence.push({
          id: `${sheetName}:${rowNumber}`, source: sheetName, row: rowNumber,
          date: date.toLocaleDateString('en-GB'), description: description || '(No description)',
          amount, allowableAmount: kind === 'expenses' ? amount : 0, treatment, reason,
        })
        groups.set(name, group)
      }
      if (!kind || value === null) continue
      const group = groups.get(name) ?? { rent: 0, expenses: 0, interest: 0, counts: [0, 0, 0], evidence: [] }
      group[kind] += value
      group.counts[kind === 'rent' ? 0 : kind === 'expenses' ? 1 : 2] += 1
      groups.set(name, group)
    }
    for (const [propertyName, group] of groups) {
      const round = (value: number) => Math.round(value * 100) / 100
      figures.push({
        propertyName,
        ...(group.counts[0] ? { rentalIncome: round(group.rent) } : {}),
        ...(group.counts[1] ? { allowableExpenses: round(group.expenses) } : {}),
        ...(group.counts[2] ? { mortgageInterest: round(group.interest) } : {}),
        ...(group.evidence.length ? { expenseEvidence: group.evidence } : {}),
        detail: `${sheetName}: ${group.counts[0]} explicitly labelled rent receipts, ${group.counts[1]} possible running costs and ${group.counts[2]} explicit interest payments in ${taxYearId}. ${
          expenseLedger ? 'Supplier/amount rows are treated as costs, never rental income. ' : ''
        }${expenseLedger ? 'All dated costs explicitly recorded in this property worksheet are listed, including unclassified costs.'
          : 'Bank statements supply rent receipts only here; no bank outgoings are imported as property expenses or finance interest.'
        } Uncertain amounts are excluded until confirmed. Ownership is not established. Allocate unassigned receipts and costs; do not count the same payments from both a bank export and a property ledger.`,
      })
    }
    for (const [referenceLabel, reference] of references) {
      figures.push({
        propertyName: `Unallocated bank evidence: ${referenceLabel}`,
        bankEvidence: [{
          label: referenceLabel, kind: reference.kind,
          incoming: Math.round(reference.incoming * 100) / 100,
          outgoing: Math.round(reference.outgoing * 100) / 100,
        }],
        detail: `${sheetName}: bank evidence in ${taxYearId}. Allocate this to a property in Income. ${
          reference.kind === 'possibleRent' ? 'Confirm this receipt is rent before including it in rental income.'
            : 'Confirm the lender/property. Incoming mortgage-labelled transfers are not rental income; outgoing repayments are not an interest deduction. Obtain the annual interest statement.'
        }`,
      })
    }
    if (unknownCosts.length) warnings.push(`${sheetName}: ${unknownCosts.length} costs were not classified (rows ${unknownCosts.join(', ')}). They are highlighted in Income for review, not silently discarded; mortgage repayments and capital/private costs are not automatically allowable.`)
    if (unmappedReceipts.length) warnings.push(`${sheetName}: ${unmappedReceipts.length} receipts mention a flat but do not explicitly say rent; they were excluded (rows ${unmappedReceipts.join(', ')}). Confirm their purpose and property manually.`)
    if (invalidRows.length) warnings.push(`${sheetName}: ${invalidRows.length} rows have missing/invalid dates or ambiguous/non-positive amounts and were excluded (rows ${invalidRows.join(', ')}).`)
    return { figures, warnings }
  }

  // Annual labelled summaries, not mixed ledger totals or monthly columns.
  const yearRows = rows.filter((row) => /^(?:tax year|tax year ending)$/i.test(String(row[0] ?? '').trim()))
  if (yearRows.length) {
    const year = String(yearRows[0][1] ?? '').trim().replace('/', '-')
    if (year !== taxYearId && year !== `${taxYearId.slice(0, 4)}-${Number(taxYearId.slice(0, 4)) + 1}`) {
      warnings.push(`${sheetName}: summary tax year does not match ${taxYearId}; no property figures proposed.`)
      return { figures, warnings }
    }
  }
  const result: PropertySpreadsheetFigures = {
    propertyName: sheetName,
    detail: `${sheetName}: labelled property summary. Confirm the period is ${taxYearId}, ownership share, whether amounts are whole-property or already apportioned, and that expenses exclude finance interest. Missing fields require manual checking.`,
  }
  const seen = new Set<string>()
  let ambiguous = false
  for (const row of rows) {
    const key = label(row[0])
    if (/^(?:property|property name|property address)$/.test(key) && typeof row[1] === 'string') result.propertyName = row[1]
    const field = /^(?:gross rental income|total rent received|rental income)$/.test(key) ? 'rentalIncome'
      : /^(?:allowable expenses excluding finance costs|allowable expenses excluding interest)$/.test(key) ? 'allowableExpenses'
      : /^(?:mortgage interest|finance costs|loan interest)$/.test(key) ? 'mortgageInterest'
      : /^(?:ownership share|ownership percentage)$/.test(key) ? 'ownershipShare' : undefined
    if (!field) continue
    if (seen.has(field) || row.slice(2).some((cell) => parseMoney(cell) !== null)) ambiguous = true
    seen.add(field)
    const raw = String(row[1] ?? '').trim()
    const amount = parseMoney(field === 'ownershipShare' ? raw.replace(/%$/, '') : row[1])
    if (amount === null || amount < 0) { ambiguous = true; continue }
    const value = field === 'ownershipShare' && (/%$/.test(raw) || key === 'ownership percentage') ? amount / 100 : amount
    if (field === 'ownershipShare' && value > 1) { ambiguous = true; continue }
    result[field] = value
  }
  if (ambiguous) warnings.push(`${sheetName}: repeated labels or ambiguous amounts/columns prevented property summary extraction.`)
  else if (result.rentalIncome !== undefined || result.allowableExpenses !== undefined || result.mortgageInterest !== undefined) figures.push(result)
  return { figures, warnings }
}
