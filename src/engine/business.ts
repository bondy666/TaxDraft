import type { BusinessDetails, BusinessInvoice } from '../types'

export const emptyBusiness = (): BusinessDetails => ({
  status: 'unknown', soleTraderBasis: 'cash', companyStart: '', companyEnd: '',
  companySimpleCase: false, invoices: [],
})

export function validBusinessDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function invoiceTotals(invoices: BusinessInvoice[], business: BusinessInvoice['business'], start: string, end: string) {
  const included = invoices.filter((invoice) => invoice.business === business && invoice.confirmed &&
    validBusinessDate(invoice.date) && invoice.date >= start && invoice.date <= end &&
    Number.isFinite(invoice.amount) && invoice.amount >= 0)
  const income = included.filter((invoice) => invoice.kind === 'income').reduce((sum, invoice) => sum + invoice.amount, 0)
  const expenses = included.filter((invoice) => invoice.kind === 'expense').reduce((sum, invoice) => sum + invoice.amount, 0)
  return { income, expenses, profit: income - expenses }
}

export function soleTraderTotals(business: BusinessDetails | undefined, taxYearId: string) {
  if (!business || !['soleTrader', 'both'].includes(business.status) || !/^\d{4}-\d{2}$/.test(taxYearId)) {
    return { income: 0, expenses: 0, profit: 0 }
  }
  const year = Number(taxYearId.slice(0, 4))
  return invoiceTotals(business.invoices, 'soleTrader', `${year}-04-06`, `${year + 1}-04-05`)
}

/** A deliberately limited estimate for a full-year, ordinary UK trading company. */
export function corporationEstimate(business: BusinessDetails | undefined) {
  if (!business || !['company', 'both'].includes(business.status) || !business.companySimpleCase ||
    !validBusinessDate(business.companyStart) || !validBusinessDate(business.companyEnd) ||
    business.companyStart < '2024-04-01' || business.companyEnd > '2027-03-31') return null
  const anniversary = new Date(`${business.companyStart}T00:00:00Z`)
  anniversary.setUTCFullYear(anniversary.getUTCFullYear() + 1)
  anniversary.setUTCDate(anniversary.getUTCDate() - 1)
  if (anniversary.toISOString().slice(0, 10) !== business.companyEnd) return null
  const totals = invoiceTotals(business.invoices, 'company', business.companyStart, business.companyEnd)
  const profit = Math.max(0, totals.profit)
  const tax = profit <= 50000 ? profit * 0.19
    : profit >= 250000 ? profit * 0.25
      : profit * 0.25 - (250000 - profit) * 3 / 200
  return { ...totals, tax: Math.round(tax * 100) / 100 }
}
