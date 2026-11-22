import type { BusinessDetails, BusinessInvoice } from '../types'

export const emptyBusiness = (): BusinessDetails => ({
  status: 'unknown', taxMode: 'personal', soleTraderBasis: 'cash', companyStart: '', companyEnd: '',
  companySimpleCase: false, invoices: [],
})

export const hasSoleTrade = (business?: BusinessDetails) => business?.status === 'soleTrader' || business?.status === 'both'
export const hasCompany = (business?: BusinessDetails) => business?.status === 'company' || business?.status === 'both'

/** Corporation tax is only worked out when the user has a company and has chosen it; personal tax is the default. */
export const isCompanyMode = (data: { business?: BusinessDetails }) =>
  hasCompany(data.business) && data.business?.taxMode === 'company'

export function validBusinessDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function taxYearBounds(taxYearId: string): { start: string; end: string } | null {
  if (!/^\d{4}-\d{2}$/.test(taxYearId)) return null
  const year = Number(taxYearId.slice(0, 4))
  return { start: `${year}-04-06`, end: `${year + 1}-04-05` }
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
  const bounds = taxYearBounds(taxYearId)
  if (!business || !hasSoleTrade(business) || !bounds) return { income: 0, expenses: 0, profit: 0 }
  return invoiceTotals(business.invoices, 'soleTrader', bounds.start, bounds.end)
}

/** Plain-language reasons the corporation tax estimate cannot be produced yet; empty when it can. */
export function corporationEstimateIssues(business: BusinessDetails | undefined): string[] {
  if (!business || !hasCompany(business)) return ['Tell us you have a limited company.']
  const issues: string[] = []
  const { companyStart: start, companyEnd: end } = business
  if (!validBusinessDate(start) || !validBusinessDate(end)) {
    issues.push('Enter the start and end dates of the company’s accounting period.')
  } else {
    const anniversary = new Date(`${start}T00:00:00Z`)
    anniversary.setUTCFullYear(anniversary.getUTCFullYear() + 1)
    anniversary.setUTCDate(anniversary.getUTCDate() - 1)
    if (anniversary.toISOString().slice(0, 10) !== end) issues.push('The accounting period must be exactly 12 months.')
    if (start < '2024-04-01' || end > '2027-03-31') issues.push('The accounting period must fall between 1 April 2024 and 31 March 2027.')
  }
  if (!business.companySimpleCase) issues.push('Confirm that your company is a simple case.')
  return issues
}

/** A deliberately limited estimate for a full-year, ordinary UK trading company. */
export function corporationEstimate(business: BusinessDetails | undefined) {
  if (!business || corporationEstimateIssues(business).length) return null
  const totals = invoiceTotals(business.invoices, 'company', business.companyStart, business.companyEnd)
  const taxableProfit = Math.max(0, totals.profit)
  const band = taxableProfit <= 50000 ? 'small' : taxableProfit >= 250000 ? 'main' : 'marginal'
  const marginalRelief = band === 'marginal' ? (250000 - taxableProfit) * 3 / 200 : 0
  const tax = band === 'small' ? taxableProfit * 0.19 : taxableProfit * 0.25 - marginalRelief
  return {
    ...totals, taxableProfit, band,
    marginalRelief: Math.round(marginalRelief * 100) / 100,
    tax: Math.round(tax * 100) / 100,
  } as const
}
