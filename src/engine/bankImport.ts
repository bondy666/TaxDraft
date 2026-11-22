import type { TaxReturnData } from '../types'
import type { DocumentSuggestion } from './documentImport'

export function importBankSuggestion(data: TaxReturnData, suggestion: DocumentSuggestion, id: string): TaxReturnData {
  const source = suggestion.bankSource
  if (!source || source.taxYearId !== data.taxYearId) return data
  const group = data.bankReliefCandidates?.find((candidate) => {
    if (candidate.kind !== suggestion.kind) return false
    if (source.groupKey && candidate.source.groupKey === source.groupKey) return true
    const oldPayments = candidate.source.evidence.match(/\d{2}\/\d{2}\/\d{4}: .*?\(£[\d.]+\)/g)
    return !candidate.source.groupKey && candidate.source.fileName === source.fileName &&
      candidate.source.taxYearId === source.taxYearId && !!oldPayments?.length &&
      oldPayments.every((payment) => source.evidence.includes(payment))
  })
  if (group && group.source.id !== source.id) return {
    ...data, bankReliefCandidates: data.bankReliefCandidates?.map((candidate) => candidate === group
      ? { ...candidate, source: { ...source, verified: false } } : candidate),
  }
  // Older drafts stored unidentified receipts as text only; re-reading the file adds them as separate receipts.
  const legacyOther = suggestion.kind === 'otherIncome' && suggestion.otherReceipts?.length
    ? data.other.find((item) => item.bankSource?.id === source.id && !item.receipts?.length && item.amount === 0) : undefined
  if (legacyOther) return {
    ...data, other: data.other.map((item) => item === legacyOther
      ? { ...item, description: `Money paid in: ${source.fileName}`, receipts: suggestion.otherReceipts } : item),
  }
  if ([...data.savings, ...data.dividends, ...data.other].some((item) => item.bankSource?.id === source.id) ||
    data.bankReliefCandidates?.some((candidate) => candidate.source.id === source.id)) return data
  if (suggestion.kind === 'interest') return { ...data, savings: [...data.savings, { id, source: source.fileName, amount: source.recordedAmount, bankSource: source }] }
  if (suggestion.kind === 'dividend') return { ...data, dividends: [...data.dividends, { id, source: source.fileName, amount: source.recordedAmount, bankSource: source }] }
  if (suggestion.kind === 'otherIncome') return { ...data, other: [...data.other, {
    id, description: `Money paid in: ${source.fileName}`, amount: 0, bankSource: source,
    ...(suggestion.otherReceipts?.length ? { receipts: suggestion.otherReceipts } : {}),
  }] }
  if (suggestion.kind === 'pensionContribution' || suggestion.kind === 'giftAid') return {
    ...data, bankReliefCandidates: [...data.bankReliefCandidates ?? [], { kind: suggestion.kind, source, claimedAmount: 0 }],
  }
  throw new Error('Unsupported bank suggestion kind.')
}

export function confirmBankRelief<T extends Pick<TaxReturnData, 'reliefs' | 'bankReliefCandidates'>>(data: T, sourceId: string, amount: number): T {
  const candidate = data.bankReliefCandidates?.find((item) => item.source.id === sourceId)
  if (!candidate) throw new Error('Bank relief evidence is no longer available.')
  if (!Number.isFinite(amount) || amount < 0 || amount > candidate.source.recordedAmount) throw new Error('Enter a qualifying net amount between zero and the recorded payments.')
  const field = candidate.kind === 'giftAid' ? 'giftAidNet' : 'personalPensionContributionsNet'
  const total = Math.round((data.reliefs[field] - candidate.claimedAmount + amount) * 100) / 100
  if (total < 0) throw new Error('The relief total was changed manually. Reconcile it with previous claims before changing this candidate.')
  return { ...data, reliefs: { ...data.reliefs, [field]: total },
    bankReliefCandidates: data.bankReliefCandidates?.map((item) => item.source.id === sourceId
      ? { ...item, claimedAmount: amount, source: { ...item.source, verified: true } } : item) }
}
