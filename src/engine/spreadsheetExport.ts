import * as XLSX from '@e965/xlsx'
import type { ComputationResult, ReliefFlag, TaxReturnData, TaxYearRates } from '../types'
import type { DocumentSuggestion } from './documentImport'
import type { CharityCandidate, SourcedBankTransaction } from './bankTransactions'
import { evidencedPropertyExpenses } from './propertyExpenses.ts'
import { emptyBusiness } from './business.ts'

export interface DocumentExportSnapshot {
  taxYearId: string
  files: { name: string; relativePath: string; size: number }[]
  suggestions: DocumentSuggestion[]
  charityCandidates: (CharityCandidate & { selected: boolean })[]
  bankTransactions: SourcedBankTransaction[]
  warnings: string[]
  progress: string
  error: string
}

type Cell = string | number | boolean
type RecordRow = Record<string, unknown>

function label(key: string): string {
  return key.replace(/\./g, ' / ').replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/(^| \/ )([a-z])/g, (_, prefix: string, character: string) => prefix + character.toUpperCase())
}

function flatten(record: RecordRow, prefix = ''): Record<string, Cell> {
  const row: Record<string, Cell> = {}
  for (const [key, value] of Object.entries(record)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (value === undefined || value === null) row[path] = ''
    else if (value instanceof Date) {
      if (!Number.isFinite(value.getTime())) throw new Error(`Cannot export an invalid date in ${path}.`)
      row[path] = `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
    }
    else if (Array.isArray(value)) row[path] = JSON.stringify(value)
    else if (typeof value === 'object') Object.assign(row, flatten(value as RecordRow, path))
    else if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
      if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`Cannot export a non-finite number in ${path}.`)
      row[path] = value
    } else throw new Error(`Cannot export unsupported value in ${path}.`)
  }
  return row
}

function table(records: RecordRow[], fallbackHeaders: string[]): XLSX.WorkSheet {
  const rows = records.map((record) => {
    const row: Record<string, Cell> = {}
    for (const [key, value] of Object.entries(flatten(record))) {
      if (typeof value !== 'string' || value.length <= 32000) row[key] = value
      else {
        for (let offset = 0; offset < value.length; offset += 32000) {
          row[offset ? `${key} (continued ${offset / 32000 + 1})` : key] = value.slice(offset, offset + 32000)
        }
      }
    }
    return row
  })
  const headers = [...new Set([...fallbackHeaders, ...rows.flatMap((row) => Object.keys(row))])]
  if (rows.length >= 1048576 || headers.length > 16384) throw new Error('The export exceeds Excel worksheet limits. Export a smaller document selection.')
  const sheet = XLSX.utils.aoa_to_sheet([headers.map(label), ...rows.map((row) => headers.map((key) => row[key] ?? ''))])
  sheet['!cols'] = headers.map((key) => ({ wch: /description|evidence|note|detail|reason/i.test(key) ? 60 : 24 }))
  if (rows.length) sheet['!autofilter'] = { ref: sheet['!ref']! }
  return sheet
}

export function createTaxWorkbook(
  data: TaxReturnData, result: ComputationResult, rates: TaxYearRates, flags: ReliefFlag[],
  documents?: DocumentExportSnapshot, exportedAt = new Date(),
): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new()
  const add = (name: string, records: RecordRow[], headers: string[]) =>
    XLSX.utils.book_append_sheet(workbook, table(records, headers), name)
  const doc = documents?.taxYearId === data.taxYearId ? documents : undefined
  add('Read me', [
    { item: 'Tax year', value: rates.label },
    { item: 'Exported at', value: exportedAt.toISOString() },
    { item: 'Currency', value: 'GBP. Numeric amounts are pounds; ownership shares and tax rates are fractions (0.5 = 50%).' },
    { item: 'Scope', value: 'Current return, imported evidence, calculation, tax rates and checks. Active document analysis is included when available; original document files are not embedded.' },
    { item: 'Review status', value: 'Unallocated property entries and unconfirmed other-income or relief candidates are excluded until reconciled. Check recorded versus included/claimed amounts.' },
    { item: 'Property expenses', value: 'Itemised property deductions use included running-cost evidence only. Unexplained balances and bank/mortgage references are not running-expense deductions.' },
    { item: 'Long text', value: 'Text over 32,000 characters is split into continued columns without truncation. Join those columns to reconstruct the original.' },
    { item: 'Documents', value: doc ? doc.progress || 'Files selected; analysis may be incomplete.' : 'No current document analysis. Reselect files in Documents to export pending suggestions and likely-charity selections.' },
    { item: 'Privacy', value: 'This workbook contains personal financial information. Store and share it securely. It is a working paper, not an HMRC submission.' },
  ], ['item', 'value'])
  add('Personal', Object.entries(data.personal).map(([field, value]) => ({
    field: label(field), value, evidence: data.personalSources?.[field as keyof typeof data.personal] ?? '',
  })), ['field', 'value', 'evidence'])
  add('Employment', data.employments.map((item) => ({ ...item })), ['employer', 'p60Pay', 'benefitsInKind', 'taxDeducted'])
  const { invoices, ...business } = data.business ?? emptyBusiness()
  add('Business settings', [{ ...business }], ['status', 'taxMode', 'soleTraderBasis', 'companyStart', 'companyEnd', 'companySimpleCase'])
  add('Business invoices', invoices.map((invoice) => ({ ...invoice })), ['id', 'business', 'kind', 'source', 'sourceHash', 'date', 'amount', 'confirmed'])
  add('Properties', data.properties.map(({ expenseEvidence, bankEvidence, rentalIncomeEvidence, ...property }) => {
    const includedExpenses = evidencedPropertyExpenses({ ...property, expenseEvidence })
    return {
      ...property, includedExpenses,
      yourRentalIncome: property.rentalIncome * property.ownershipShare,
      yourIncludedExpenses: includedExpenses * property.ownershipShare,
      yourProfit: (property.rentalIncome - includedExpenses) * property.ownershipShare,
      yourFinanceCosts: property.mortgageInterest * property.ownershipShare,
    }
  }), ['name', 'ownershipShare', 'rentalIncome', 'allowableExpenses', 'includedExpenses', 'mortgageInterest', 'interestOnlyMortgage', 'expenseReconciliation'])
  add('Property expenses', data.properties.flatMap((property) => (property.expenseEvidence ?? []).map((expense) => ({
    property: property.name, propertyId: property.id, ...expense,
    includedRunningExpense: expense.treatment === 'interest' || expense.treatment === 'repayment' ? 0 : expense.allowableAmount,
  }))), ['property', 'date', 'description', 'amount', 'allowableAmount', 'includedRunningExpense', 'treatment', 'reason', 'source', 'row'])
  add('Property bank references', data.properties.flatMap((property) => (property.bankEvidence ?? []).map((evidence) => ({
    property: property.name, propertyId: property.id, ...evidence,
  }))), ['property', 'label', 'kind', 'incoming', 'outgoing', 'includedInRent'])
  add('Rental income evidence', data.properties.flatMap((property) => (property.rentalIncomeEvidence ?? []).map((evidence) => ({
    property: property.name, propertyId: property.id, ...evidence,
  }))), ['property', 'propertyId', 'date', 'description', 'amount', 'treatment', 'source'])
  add('Savings interest', data.savings.map((item) => ({ ...item })), ['source', 'amount'])
  add('Dividends', data.dividends.map((item) => ({ ...item })), ['source', 'amount'])
  add('Pension income', data.pensions.map((item) => ({ ...item })), ['source', 'amount', 'taxDeducted'])
  add('Other income', data.other.map((item) => ({ ...item })), ['description', 'amount'])
  add('Pension and Gift Aid', [
    { relief: 'Personal relief-at-source pension contributions', netClaimed: data.reliefs.personalPensionContributionsNet, gross: data.reliefs.personalPensionContributionsNet / 0.8 },
    { relief: 'Gift Aid donations', netClaimed: data.reliefs.giftAidNet, gross: data.reliefs.giftAidNet / 0.8 },
  ], ['relief', 'netClaimed', 'gross'])
  add('Bank relief review', (data.bankReliefCandidates ?? []).map((candidate) => ({ ...candidate })), ['kind', 'claimedAmount', 'source.recordedAmount', 'source.fileName', 'source.evidence', 'source.verified'])
  add('Recipient settings', [
    ...(data.privatePensionRecipients ?? []).map((recipient) => ({ kind: 'Private pension', recipient })),
    ...(data.charitableDonationRecipients ?? []).map((recipient) => ({ kind: 'Charitable donation', recipient })),
  ], ['kind', 'recipient'])
  const { nonSavingsBands, savingsBands, dividendBands, ...computation } = result
  add('Computation', Object.entries(computation).map(([field, value]) => ({ item: label(field), amount: value })), ['item', 'amount'])
  add('Tax bands', [
    ...nonSavingsBands.map((band) => ({ income: 'Non-savings', ...band })),
    ...savingsBands.map((band) => ({ income: 'Savings', ...band })),
    ...dividendBands.map((band) => ({ income: 'Dividends', ...band })),
  ], ['income', 'band', 'amount', 'rate', 'tax'])
  add('Tax year rates', Object.entries(flatten({ ...rates })).map(([field, value]) => ({ item: label(field), value })), ['item', 'value'])
  add('Checks', flags.map((flag) => ({ ...flag })), ['severity', 'title', 'detail', 'id'])
  add('Selected documents', doc?.files.map((file) => ({ ...file })) ?? [], ['name', 'relativePath', 'size'])
  add('Document suggestions', doc?.suggestions.map((suggestion) => ({ ...suggestion })) ?? [], ['fileName', 'kind', 'title', 'selected', 'amount', 'detail'])
  add('Likely charities', doc?.charityCandidates.map(({ payments, ...candidate }) => ({
    ...candidate, paymentCount: payments.length,
  })) ?? [], ['recipient', 'selected', 'reason', 'paymentCount', 'total'])
  add('Charity payment evidence', doc?.charityCandidates.flatMap((candidate) => candidate.payments.map((payment) => ({
    recipient: candidate.recipient, selectedForEvaluation: candidate.selected, ...payment,
  }))) ?? [], ['recipient', 'selectedForEvaluation', 'date', 'description', 'amount', 'source'])
  add('Statement transactions', doc?.bankTransactions.map((transaction) => ({ ...transaction })) ?? [], ['date', 'description', 'amount', 'source', 'id'])
  add('Document warnings', [
    ...(doc?.warnings ?? []).map((message) => ({ kind: 'Warning', message })),
    ...(doc?.error ? [{ kind: 'Error', message: doc.error }] : []),
  ], ['kind', 'message'])
  return workbook
}

export function downloadTaxSpreadsheet(
  data: TaxReturnData, result: ComputationResult, rates: TaxYearRates, flags: ReliefFlag[], documents?: DocumentExportSnapshot,
): void {
  const workbook = createTaxWorkbook(data, result, rates, flags, documents)
  const bytes: ArrayBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array', compression: true })
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const link = document.createElement('a')
  try {
    link.href = url
    link.download = `taxdraft-${data.taxYearId}.xlsx`
    document.body.appendChild(link)
    link.click()
  } finally {
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 60000)
  }
}
