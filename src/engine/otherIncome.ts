import type { OtherIncome, OtherIncomeReceipt, PropertyLet, TaxReturnData } from '../types'
import { payerKey, regularMonthlyAmount } from './bankTransactions.ts'

export interface OtherIncomePayer {
  payer: string
  label: string
  source: string
  receipts: OtherIncomeReceipt[]
  total: number
  /** Every receipt from this payer that isn't already counted as rent is ticked as taxable. */
  taxable: boolean
  /** Set when the payer's receipts have been matched as rent, so they can't be counted here as well. */
  rentProperty?: string
  regular?: { amount: number; months: number }
}

const round2 = (value: number) => Math.round(value * 100) / 100

function parseDate(value: string): Date | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value)
  return match ? new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1])) : null
}

/** Bank receipts already reconciled as rent, mapped to the property they were matched to. */
export function rentReceiptOwners(properties: PropertyLet[]): Map<string, string> {
  const owners = new Map<string, string>()
  for (const property of properties) {
    for (const evidence of property.rentalIncomeEvidence ?? []) owners.set(evidence.id, property.name || 'a property')
  }
  return owners
}

export function toOtherIncomeReceipt(transaction: { id: string; date: Date | null; description: string; amount: number; source: string }): OtherIncomeReceipt {
  return {
    id: transaction.id, payer: payerKey(transaction.description),
    date: transaction.date?.toLocaleDateString('en-GB') ?? '', description: transaction.description,
    amount: round2(Math.abs(transaction.amount)), source: transaction.source, taxable: false,
  }
}

/** Groups receipts by payer: regular payers first (longest same-amount monthly run), then by name. */
export function otherIncomePayers(entry: OtherIncome, rentOwners: Map<string, string>): OtherIncomePayer[] {
  const groups = new Map<string, OtherIncomeReceipt[]>()
  for (const receipt of entry.receipts ?? []) groups.set(receipt.payer, [...groups.get(receipt.payer) ?? [], receipt])
  return [...groups].map(([payer, receipts]) => {
    const sorted = [...receipts].sort((a, b) => (parseDate(a.date)?.getTime() ?? 0) - (parseDate(b.date)?.getTime() ?? 0))
    const countable = sorted.filter((receipt) => !rentOwners.has(receipt.id))
    const rentProperty = sorted.map((receipt) => rentOwners.get(receipt.id)).find(Boolean)
    const regular = regularMonthlyAmount(sorted.map((receipt) => ({ date: parseDate(receipt.date), amount: receipt.amount })))
    return {
      payer, label: sorted[0].description, receipts: sorted,
      source: [...new Set(sorted.map((receipt) => receipt.source))].join(' · '),
      total: round2(sorted.reduce((sum, receipt) => sum + receipt.amount, 0)),
      taxable: countable.length > 0 && countable.every((receipt) => receipt.taxable),
      ...(rentProperty ? { rentProperty } : {}),
      ...(regular ? { regular } : {}),
    }
  }).sort((a, b) => (b.receipts.length > 1 ? 1 : 0) - (a.receipts.length > 1 ? 1 : 0) ||
    (b.regular?.months ?? 0) - (a.regular?.months ?? 0) || a.label.localeCompare(b.label))
}

export function setPayerTaxable(entry: OtherIncome, payer: string, taxable: boolean): OtherIncomeReceipt[] {
  return (entry.receipts ?? []).map((receipt) => receipt.payer === payer ? { ...receipt, taxable } : receipt)
}

export function taxableOtherAmount(entry: OtherIncome, rentOwners: Map<string, string>): number {
  return round2((entry.receipts ?? []).filter((receipt) => receipt.taxable && !rentOwners.has(receipt.id))
    .reduce((sum, receipt) => sum + receipt.amount, 0))
}

/** Keeps each receipt-based entry's amount equal to its ticked, not-already-rent receipts. */
export function syncOtherIncome(data: TaxReturnData): TaxReturnData {
  if (!data.other.some((entry) => entry.receipts?.length)) return data
  const owners = rentReceiptOwners(data.properties)
  let changed = false
  const other = data.other.map((entry) => {
    if (!entry.receipts?.length) return entry
    const amount = taxableOtherAmount(entry, owners)
    if (amount === entry.amount) return entry
    changed = true
    return { ...entry, amount }
  })
  return changed ? { ...data, other } : data
}
