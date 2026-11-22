import type { ComputationResult, ReliefFlag, TaxReturnData } from '../types'
import type { DocumentExportSnapshot } from './spreadsheetExport'
import type { ReviewItem } from './reviewChecklist'

export type SearchTab = 'Documents' | 'Personal' | 'Income' | 'Review' | 'Computation' | 'Reliefs'

export interface SearchEntry {
  id: string
  tab: SearchTab
  section: string
  title: string
  detail: string
}

export interface SearchResult extends SearchEntry {
  score: number
}

const money = (amount: number) =>
  `£${amount.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const date = (value: Date | string | null | undefined) =>
  value instanceof Date ? value.toLocaleDateString('en-GB') : value ?? ''

/** Builds one searchable list from everything the app displays: the return, document analysis, checks and computation. */
export function buildSearchIndex(
  data: TaxReturnData,
  result: ComputationResult,
  flags: ReliefFlag[],
  reviewItems: ReviewItem[],
  documents?: DocumentExportSnapshot,
): SearchEntry[] {
  const entries: SearchEntry[] = []
  const add = (id: string, tab: SearchTab, section: string, title: string, detail = '') =>
    entries.push({ id, tab, section, title, detail })

  const personal = data.personal
  add('personal-name', 'Personal', 'Personal details', `Name: ${personal.name || 'not entered'}`)
  add('personal-marital', 'Personal', 'Personal details', `Marital status: ${personal.maritalStatus}`)
  add('personal-children', 'Personal', 'Personal details', `Children: ${personal.numberOfChildren}`,
    personal.claimsChildBenefit ? `Child Benefit ${money(personal.childBenefitAnnualAmount)}` : 'Not claiming Child Benefit')
  add('personal-student-loan', 'Personal', 'Personal details',
    `Student loan: ${personal.hasStudentLoan ? personal.studentLoanPlan : 'none'}`)
  add('personal-flags', 'Personal', 'Personal details',
    `Scottish taxpayer: ${personal.isScottishTaxpayer ? 'yes' : 'no'}; Blind Person’s Allowance: ${personal.isBlind ? 'yes' : 'no'}`)

  for (const item of data.employments) {
    add(`employment-${item.id}`, 'Income', 'Employment', item.employer || 'Employment',
      `P60 pay ${money(item.p60Pay)}; tax deducted ${money(item.taxDeducted)}; benefits ${money(item.benefitsInKind)}` +
      (item.p60Source ? `; from ${item.p60Source.fileName}` : ''))
  }

  for (const invoice of data.business?.invoices ?? []) {
    add(`business-invoice-${invoice.id}`, 'Income', 'Self-employment and company', invoice.source,
      `${invoice.business} ${invoice.kind} · ${invoice.date} · ${money(invoice.amount)} · ${invoice.confirmed ? 'confirmed' : 'unconfirmed'}`)
  }

  for (const property of data.properties) {
    const name = property.name || 'Property'
    add(`property-${property.id}`, 'Income', 'Land and property', name,
      `Rental income ${money(property.rentalIncome)}; allowable expenses ${money(property.allowableExpenses)}; ` +
      `mortgage interest ${money(property.mortgageInterest)}; ownership ${Math.round(property.ownershipShare * 100)}%`)
    for (const expense of property.expenseEvidence ?? []) {
      add(`expense-${property.id}-${expense.id}`, 'Income', `${name} — expenses`, expense.description,
        `${expense.date} · ${money(expense.amount)} recorded, ${money(expense.allowableAmount)} included · ${expense.source}`)
    }
    for (const receipt of property.rentalIncomeEvidence ?? []) {
      add(`rent-${property.id}-${receipt.id}`, 'Income', `${name} — rent receipts`, receipt.description,
        `${receipt.date} · ${money(receipt.amount)} · ${receipt.source}`)
    }
    property.bankEvidence?.forEach((evidence, index) => {
      add(`bank-ref-${property.id}-${index}`, 'Income', `${name} — bank references`, evidence.label,
        `In ${money(evidence.incoming)}; out ${money(evidence.outgoing)}`)
    })
  }

  const simple = [
    ...data.savings.map((item) => ({ item, section: 'Interest received', label: item.source })),
    ...data.dividends.map((item) => ({ item, section: 'Dividends', label: item.source })),
    ...data.other.map((item) => ({ item, section: 'Other income', label: item.description })),
  ]
  for (const { item, section, label } of simple) {
    add(`${section}-${item.id}`, 'Income', section, label || section,
      `${money(item.amount)}${item.bankSource ? ` · ${item.bankSource.fileName} · ${item.bankSource.evidence}` : ''}`)
  }
  for (const item of data.pensions) {
    add(`pension-income-${item.id}`, 'Income', 'Pensions received', item.source || 'Pension',
      `${money(item.amount)}; tax deducted ${money(item.taxDeducted)}`)
  }

  add('relief-pension', 'Income', 'Pension contributions & Gift Aid', 'Pension contributions paid (net)',
    money(data.reliefs.personalPensionContributionsNet))
  add('relief-gift-aid', 'Income', 'Pension contributions & Gift Aid', 'Gift Aid donations (net)',
    money(data.reliefs.giftAidNet))
  for (const candidate of data.bankReliefCandidates ?? []) {
    add(`relief-candidate-${candidate.source.id}`, 'Income', 'Pension contributions & Gift Aid',
      candidate.kind === 'giftAid' ? 'Gift Aid candidate payments' : 'Pension contribution candidate payments',
      `Recorded ${money(candidate.source.recordedAmount)}; claimed ${money(candidate.claimedAmount)} · ${candidate.source.evidence}`)
  }
  for (const name of data.privatePensionRecipients ?? []) {
    add(`pension-recipient-${name}`, 'Documents', 'Private pension recipients', name)
  }
  for (const name of data.charitableDonationRecipients ?? []) {
    add(`charity-recipient-${name}`, 'Documents', 'Charity recipients', name)
  }

  if (documents?.taxYearId === data.taxYearId) {
    for (const file of documents.files) {
      add(`file-${file.relativePath || file.name}`, 'Documents', 'Selected documents', file.name, file.relativePath)
    }
    for (const suggestion of documents.suggestions) {
      add(`suggestion-${suggestion.id}`, 'Documents', 'Review extracted figures', suggestion.title,
        `${suggestion.fileName}${suggestion.amount !== undefined ? ` · ${money(suggestion.amount)}` : ''} · ${suggestion.detail}`)
    }
    for (const candidate of documents.charityCandidates) {
      add(`charity-${candidate.id}`, 'Documents', 'Charity & Gift Aid suggestions', candidate.recipient,
        `${candidate.payments.length} payments · ${money(candidate.total)} · ${candidate.reason}`)
    }
    for (const transaction of documents.bankTransactions) {
      add(`transaction-${transaction.id}`, 'Documents', 'Bank transactions', transaction.description,
        `${date(transaction.date)} · ${money(transaction.amount)} · ${transaction.source}`)
    }
    documents.warnings.forEach((warning, index) => add(`warning-${index}`, 'Documents', 'Document warnings', warning))
  }

  for (const item of reviewItems) add(`review-${item.id}`, 'Review', 'Review', item.title, item.detail)
  for (const flag of flags) add(`flag-${flag.id}`, 'Reliefs', 'Reliefs & things to check', flag.title, flag.detail)

  const computation: [string, number][] = [
    ['Total income', result.totalIncome],
    ['Non-savings income', result.totalNonSavingsIncome],
    ['UK interest', result.totalSavingsIncome],
    ['Dividends', result.totalDividendIncome],
    ['Adjusted net income', result.adjustedNetIncome],
    ['Personal allowance available', result.personalAllowanceAvailable],
    ['Income tax before reducers', result.incomeTaxBeforeReducers],
    ['Relief for finance costs', result.financeCostReducer],
    ['Income tax due', result.incomeTaxDue],
    ['Tax deducted at source', result.taxDeductedAtSource],
    ['High Income Child Benefit Charge', result.highIncomeChildBenefitCharge],
    [result.balanceDueOrRefund >= 0 ? 'Balance due' : 'Refund due', Math.abs(result.balanceDueOrRefund)],
  ]
  for (const [label, amount] of computation) add(`computation-${label}`, 'Computation', 'Computation', label, money(amount))

  return entries
}

// Commas are dropped so "2,100" and "2100" both match "£2,100.00".
const normalize = (value: string) => value.toLowerCase().replace(/(\d),(?=\d{3})/g, '$1').replace(/\s+/g, ' ')

/** Every query word must appear; matches in the title rank above matches only in the detail. */
export function searchEntries(entries: SearchEntry[], query: string, limit = 50): { results: SearchResult[]; total: number } {
  const terms = normalize(query).trim().split(' ').filter(Boolean)
  if (!terms.length) return { results: [], total: 0 }
  const results: SearchResult[] = []
  for (const entry of entries) {
    const title = normalize(entry.title)
    const section = normalize(entry.section)
    const all = `${title} ${section} ${normalize(entry.detail)}`
    if (!terms.every((term) => all.includes(term))) continue
    const score = terms.reduce((sum, term) => sum +
      (title.startsWith(term) ? 4 : title.includes(term) ? 3 : section.includes(term) ? 2 : 1), 0)
    results.push({ ...entry, score })
  }
  results.sort((a, b) => b.score - a.score)
  return { results: results.slice(0, limit), total: results.length }
}
