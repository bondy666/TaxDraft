import type { PropertyExpenseEvidence, PropertyLet, PropertyRentalIncomeEvidence } from '../types'
import type { DocumentSuggestion } from './documentImport'
import type { RentalIncomeCandidate } from './bankTransactions'
import { consolidateProperties } from './propertyConsolidation.ts'
import { reconcilePropertyExpenses, evidencedPropertyExpenses } from './propertyExpenses.ts'

export type RentalIncomeResolution = 'additional' | 'alreadyIncluded'

export function reconcileRentalIncomeCandidate(
  items: PropertyLet[],
  propertyId: string,
  candidate: RentalIncomeCandidate,
  resolution: RentalIncomeResolution,
  replaceLegacyAggregate = false,
): PropertyLet[] {
  const target = items.find((item) => item.id === propertyId)
  if (!target || target.name.startsWith('Unallocated')) throw new Error('Choose an existing named property for these receipts.')
  if (resolution === 'alreadyIncluded' && target.rentalIncome <= 0) {
    throw new Error('There is no existing rental-income total to reconcile these receipts against.')
  }
  const existingEvidence = items.flatMap((item) => item.rentalIncomeEvidence ?? [])
  const knownIds = new Set(existingEvidence.map((item) => item.id))
  const payments = candidate.payments.filter((payment) => !knownIds.has(payment.id))
  if (!payments.length) return items
  for (const payment of payments) {
    const duplicate = existingEvidence.find((item) =>
      item.date === payment.date!.toLocaleDateString('en-GB') &&
      item.amount === payment.amount &&
      item.description.trim().toLowerCase() === payment.description.trim().toLowerCase(),
    )
    if (duplicate) throw new Error('A matching rent receipt is already attached from another bank export. Reconcile the duplicate manually.')
  }

  const legacy = items.filter((item) => item.name.startsWith('Unallocated') &&
    item.rentalIncome > 0 && item.documentSources?.some((source) =>
      candidate.sourceKeys.some((sourceKey) => source.startsWith(`${sourceKey}:`))))
  if (legacy.length && !replaceLegacyAggregate) {
    throw new Error('Confirm that the old unallocated total should be replaced by individual receipt sources.')
  }

  const legacyTotal = legacy.reduce((sum, item) => sum + item.rentalIncome, 0)
  const amount = payments.reduce((sum, payment) => sum + payment.amount, 0)
  const evidence: PropertyRentalIncomeEvidence[] = payments.map((payment) => ({
    id: payment.id,
    source: payment.source,
    description: payment.description,
    date: payment.date!.toLocaleDateString('en-GB'),
    amount: payment.amount,
    treatment: resolution === 'additional' ? 'added' : 'alreadyIncluded',
    basis: candidate.basis,
  }))
  const legacyIds = new Set(legacy.map((item) => item.id))
  const next = items.flatMap((item) => {
    if (!legacyIds.has(item.id)) return [item]
    const otherSource = item.documentSources?.some((source) =>
      !candidate.sourceKeys.some((sourceKey) => source.startsWith(`${sourceKey}:`)))
    if (!otherSource && !item.bankEvidence?.length && !item.expenseEvidence?.length &&
      item.allowableExpenses === 0 && item.mortgageInterest === 0) return []
    return [{
      ...item,
      rentalIncome: 0,
      documentNote: [item.documentNote, 'The previous bank rental aggregate was replaced by transaction-level review.'].filter(Boolean).join('\n'),
    }]
  })
  return next.map((item) => item.id === propertyId ? {
    ...item,
    rentalIncome: resolution === 'additional'
      ? Math.round((item.rentalIncome + amount) * 100) / 100
      : item.rentalIncome,
    rentalIncomeEvidence: [...item.rentalIncomeEvidence ?? [], ...evidence],
    ...(legacyTotal > 0 ? {
      documentNote: [item.documentNote,
        `Replaced £${legacyTotal.toFixed(2)} in unallocated bank rent from ${candidate.source} with receipt-level evidence.`]
        .filter(Boolean).join('\n'),
    } : {}),
    documentVerified: false,
  } : item)
}

/** Detaches matched rent receipts, reversing any amount they added so they can be matched again. */
export function removeRentalIncomeEvidence(items: PropertyLet[], propertyId: string, evidenceIds: string[]): PropertyLet[] {
  const ids = new Set(evidenceIds)
  return items.map((item) => {
    if (item.id !== propertyId) return item
    const removed = (item.rentalIncomeEvidence ?? []).filter((evidence) => ids.has(evidence.id))
    if (!removed.length) return item
    const added = removed.filter((evidence) => evidence.treatment === 'added')
      .reduce((sum, evidence) => sum + evidence.amount, 0)
    return {
      ...item,
      rentalIncome: Math.max(0, Math.round((item.rentalIncome - added) * 100) / 100),
      rentalIncomeEvidence: item.rentalIncomeEvidence!.filter((evidence) => !ids.has(evidence.id)),
      documentVerified: false,
    }
  })
}

/**
 * Word documents are re-read from scratch. Before their rows are imported, unreviewed rows previously read from the same
 * file (by name, so an edited document still counts) are removed wherever they were assigned, and unallocated entries left
 * empty are removed. Rows you gave an allowable amount are kept; a re-read row matching one of them (same amount and
 * picture, description or date) updates it, e.g. filling in a missing date, instead of being added twice.
 */
export function refreshWordDocumentRows(items: PropertyLet[], suggestions: DocumentSuggestion[]):
  { items: PropertyLet[]; suggestions: DocumentSuggestion[] } {
  const wordSuggestions = suggestions.filter((suggestion) => suggestion.propertySourceId?.includes(':docx:'))
  if (!wordSuggestions.length) return { items, suggestions }
  const files = new Set(wordSuggestions.map((suggestion) => suggestion.fileName))
  const fileOf = (row: PropertyExpenseEvidence) => row.source.split(' / ')[0]
  const fromFiles = (row: PropertyExpenseEvidence) => files.has(fileOf(row))
  const fresh = wordSuggestions.flatMap((suggestion) => suggestion.expenseEvidence ?? [])
  const matches = (kept: PropertyExpenseEvidence, row: PropertyExpenseEvidence) => fileOf(kept) === fileOf(row) &&
    kept.amount === row.amount && (kept.id === row.id || kept.source === row.source || kept.description === row.description ||
      (!!kept.date && kept.date === row.date))
  const absorbed = new Set<string>()

  const nextItems = items.flatMap((item) => {
    if (!item.expenseEvidence?.some(fromFiles)) return [item]
    const expenseEvidence = item.expenseEvidence.flatMap((row) => {
      if (!fromFiles(row)) return [row]
      if (row.allowableAmount === 0) return []
      const update = fresh.find((candidate) => !absorbed.has(candidate.id) && matches(row, candidate))
      if (!update) return [row]
      absorbed.add(update.id)
      return [{ ...row, date: row.date || update.date, source: update.source, description: update.description }]
    })
    const empty = item.name.startsWith('Unallocated') && !expenseEvidence.length && !item.bankEvidence?.length &&
      !item.rentalIncomeEvidence?.length && !item.rentalIncome && !item.mortgageInterest
    return empty ? [] : [{ ...reconcilePropertyExpenses({ ...item, expenseEvidence }), documentVerified: false }]
  })
  const nextSuggestions = suggestions.map((suggestion) => wordSuggestions.includes(suggestion)
    ? { ...suggestion, expenseEvidence: suggestion.expenseEvidence?.filter((row) => !absorbed.has(row.id)) }
    : suggestion)
  return { items: nextItems, suggestions: nextSuggestions }
}

/** Deletes expense rows (e.g. duplicates, or rows from a renamed file) and recalculates the property's allowable total. */
export function removePropertyExpenses(item: PropertyLet, expenseIds: string[]): PropertyLet {
  const ids = new Set(expenseIds)
  const expenseEvidence = (item.expenseEvidence ?? []).filter((expense) => !ids.has(expense.id))
  if (expenseEvidence.length === (item.expenseEvidence ?? []).length) return item
  return { ...item, expenseEvidence, allowableExpenses: evidencedPropertyExpenses({ ...item, expenseEvidence }), documentVerified: false }
}

/** Rows that look like the same cost recorded twice: same amount, and the same date or one of them undated. */
export function possibleDuplicateExpenses(item: PropertyLet): Map<string, PropertyExpenseEvidence> {
  const duplicates = new Map<string, PropertyExpenseEvidence>()
  const rows = item.expenseEvidence ?? []
  rows.forEach((row, index) => {
    const other = rows.find((candidate, position) => position !== index && candidate.amount === row.amount &&
      (candidate.date === row.date || !candidate.date || !row.date))
    if (other) duplicates.set(row.id, other)
  })
  return duplicates
}

export function importProperty(items: PropertyLet[], suggestion: DocumentSuggestion, taxYearId: string, id: string): PropertyLet[] {
  const sourceId = suggestion.propertySourceId
  if (sourceId && suggestion.propertyTaxYearId !== taxYearId) return items
  const existing = sourceId ? items.find((item) => item.documentSources?.includes(sourceId)) : undefined
  if (existing) {
    const missing = (suggestion.expenseEvidence ?? []).filter((expense) =>
      !existing.expenseEvidence?.some((current) => current.id === expense.id))
    if (!missing.length) return items
    return items.map((item) => item === existing ? {
      ...reconcilePropertyExpenses({ ...item, expenseEvidence: [...item.expenseEvidence ?? [], ...missing] }), documentVerified: false,
    } : item)
  }
  return consolidateProperties([...items, {
    id, name: suggestion.propertyName || suggestion.fileName,
    ownershipShare: suggestion.ownershipShare ?? 1,
    rentalIncome: suggestion.rentalIncome ?? 0,
    allowableExpenses: suggestion.allowableExpenses ?? 0,
    mortgageInterest: suggestion.mortgageInterest ?? 0,
    bankEvidence: suggestion.bankEvidence,
    expenseEvidence: suggestion.expenseEvidence,
    ...(suggestion.propertySourceId ? {
      documentSources: [suggestion.propertySourceId],
      documentVerified: false,
      documentNote: `${suggestion.fileName}: ${suggestion.detail}`,
    } : {}),
  }])
}

export function allocateProperty(
  items: PropertyLet[],
  sourceId: string,
  targetId: string,
  receiptIsRent: boolean,
  confirmSeparateExpenses = false,
  rentalIncomeResolution?: RentalIncomeResolution,
): PropertyLet[] {
  const source = items.find((item) => item.id === sourceId)
  const target = items.find((item) => item.id === targetId)
  if (!source || !target || source === target) throw new Error('Choose a different existing property for this evidence.')
  if (source.name.startsWith('Unallocated') && source.rentalIncome > 0 && !receiptIsRent) {
    throw new Error('Confirm that the unallocated rental-income figure belongs to this property before assigning it.')
  }
  if (rentalIncomeResolution === 'alreadyIncluded' && target.rentalIncome <= 0) {
    throw new Error('There is no existing rental-income total to reconcile this evidence against.')
  }
  if (!source.name.startsWith('Unallocated') &&
    source.name.trim().toLowerCase() !== target.name.trim().toLowerCase()) {
    throw new Error('These entries already belong to different properties. Keep their income and expenses separate; only unallocated evidence should be assigned to a property.')
  }
  if (source.documentSources?.some((id) => target.documentSources?.includes(id)) ||
    source.expenseEvidence?.some((expense) => target.expenseEvidence?.some((other) => other.id === expense.id))) {
    throw new Error('These entries share document sources or expense rows. Do not combine duplicate evidence; remove or reconcile the duplicate entry.')
  }
  const sourceExpenses = source.expenseEvidence?.filter((expense) => expense.allowableAmount > 0) ?? []
  const targetExpenses = target.expenseEvidence?.filter((expense) => expense.allowableAmount > 0) ?? []
  const fullyDocumented = (item: PropertyLet) => !!item.expenseEvidence?.length &&
    Math.round(item.expenseEvidence.reduce((sum, expense) => sum + expense.allowableAmount, 0) * 100) === Math.round(item.allowableExpenses * 100)
  const possibleDuplicate = sourceExpenses.some((expense) => targetExpenses.some((other) =>
    expense.date === other.date && expense.amount === other.amount &&
    expense.description.trim().toLowerCase() === other.description.trim().toLowerCase()))
  const separateExpenses = fullyDocumented(source) && fullyDocumented(target) && !possibleDuplicate
  const rentalIncome = (source.name.startsWith('Unallocated') && !receiptIsRent ? 0 : source.rentalIncome) +
    (receiptIsRent ? (source.bankEvidence ?? [])
      .filter((evidence) => evidence.kind === 'possibleRent' && !evidence.includedInRent)
      .reduce((sum, evidence) => sum + evidence.incoming, 0) : 0)
  const amounts = { rentalIncome, allowableExpenses: source.allowableExpenses, mortgageInterest: source.mortgageInterest }
  for (const field of ['rentalIncome', 'allowableExpenses', 'mortgageInterest'] as const) {
    if (amounts[field] > 0 && target[field] > 0) {
      if (field === 'rentalIncome' && rentalIncomeResolution) continue
      if (field === 'allowableExpenses' && (separateExpenses || confirmSeparateExpenses)) continue
      if (field === 'allowableExpenses') {
        throw new Error('Both entries contain expenses with possible overlap or incomplete evidence. Check them, then confirm these are separate, non-duplicated expenses to combine their totals.')
      }
      throw new Error(`Both entries contain ${field}. Reconcile them manually before allocating to avoid counting overlapping statements twice.`)
    }
  }
  const merged: PropertyLet = {
    ...target,
    rentalIncome: rentalIncomeResolution === 'alreadyIncluded'
      ? target.rentalIncome : target.rentalIncome + rentalIncome,
    allowableExpenses: Math.round((target.allowableExpenses + source.allowableExpenses) * 100) / 100,
    mortgageInterest: target.mortgageInterest + source.mortgageInterest,
    bankEvidence: [...target.bankEvidence ?? [], ...(source.bankEvidence ?? []).map((evidence) =>
      receiptIsRent && evidence.kind === 'possibleRent' ? { ...evidence, includedInRent: true } : evidence)],
    expenseEvidence: [...target.expenseEvidence ?? [], ...source.expenseEvidence ?? []],
    documentSources: [...target.documentSources ?? [], ...source.documentSources ?? []],
    documentNote: [target.documentNote, source.documentNote].filter(Boolean).join('\n'),
    documentVerified: false,
  }

  return items.filter((item) => item.id !== sourceId).map((item) => item.id === targetId ? merged : item)
}

/** Proposes a property name from an unallocated expense file, e.g. "Expenses_DraytonPark.docx" → "Drayton Park". */
export function suggestPropertyName(entryName: string): string {
  const file = /^Unallocated expenses:\s*(.+)$/i.exec(entryName)?.[1]
  if (!file) return ''
  return file.replace(/\.[^.]+$/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_\-.]+/g, ' ')
    .replace(/\b(?:expenses?|costs?|receipts?|invoices?|bills?)\b/gi, ' ')
    .replace(/\s+/g, ' ').trim()
}

/** Creates a named property and moves the unallocated evidence into it in one step. */
export function allocateToNewProperty(
  items: PropertyLet[], sourceId: string, name: string, newId: string,
  receiptIsRent: boolean, confirmSeparateExpenses = false,
): PropertyLet[] {
  const trimmed = name.trim()
  if (!trimmed || /^unallocated/i.test(trimmed)) throw new Error('Enter the property’s name.')
  if (items.some((item) => item.name.trim().toLowerCase() === trimmed.toLowerCase())) {
    throw new Error(`“${trimmed}” already exists. Choose it from the list instead.`)
  }
  const created: PropertyLet = { id: newId, name: trimmed, ownershipShare: 1, rentalIncome: 0, allowableExpenses: 0, mortgageInterest: 0 }
  return allocateProperty([...items, created], sourceId, newId, receiptIsRent, confirmSeparateExpenses)
}

export function reviewPropertyExpense(item: PropertyLet, expenseId: string, allowableAmount: number): PropertyLet {
  const expense = item.expenseEvidence?.find((entry) => entry.id === expenseId)
  if (!expense) throw new Error('This expense is no longer available. Reopen its property entry.')
  if (expense.treatment === 'interest' || expense.treatment === 'repayment') {
    throw new Error('Interest and repayments cannot be included as running expenses. Use the separate interest field with supporting evidence.')
  }

  if (!Number.isFinite(allowableAmount) || allowableAmount < 0 || allowableAmount > expense.amount) {
    throw new Error('Enter an allowable business amount between zero and the recorded expense.')
  }
  const rounded = Math.round(allowableAmount * 100) / 100
  const reconciled = reconcilePropertyExpenses(item)
  const expenseEvidence = item.expenseEvidence?.map((entry) => entry.id === expenseId ? { ...entry, allowableAmount: rounded } : entry)
  return {
    ...reconciled, allowableExpenses: evidencedPropertyExpenses({ ...reconciled, expenseEvidence }), documentVerified: false,
    expenseEvidence,
  }
}

export function moveBankReference(items: PropertyLet[], sourceId: string, targetId: string, index: number): PropertyLet[] {
  const source = items.find((item) => item.id === sourceId)
  const target = items.find((item) => item.id === targetId)
  const evidence = source?.bankEvidence?.[index]
  if (!source || !target || source === target || !evidence) throw new Error('Choose a different property for this bank reference.')
  if (evidence.includedInRent) throw new Error('This reference is already included in rental income. Reconcile the income amounts before moving it.')
  return items.map((item) => item === source ? {
    ...item, bankEvidence: item.bankEvidence?.filter((_, position) => position !== index), documentVerified: false,
  } : item === target ? {
    ...item, bankEvidence: [...item.bankEvidence ?? [], evidence], documentVerified: false,
  } : item)
}
