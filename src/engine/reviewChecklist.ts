import type { ReliefFlag, TaxReturnData } from '../types'
import type { DocumentExportSnapshot } from './spreadsheetExport'
import { corporationEstimateIssues, hasSoleTrade, isCompanyMode } from './business.ts'

export type ReviewTab = 'Documents' | 'Personal' | 'Income' | 'Computation' | 'Reliefs'

export interface ReviewItem {
  id: string
  severity: 'action' | 'check' | 'info'
  title: string
  detail: string
  tab: ReviewTab
}

export function buildReviewChecklist(
  data: TaxReturnData,
  flags: ReliefFlag[],
  documents?: DocumentExportSnapshot,
): ReviewItem[] {
  const items: ReviewItem[] = []

  const action = (
    id: string,
    title: string,
    detail: string,
    tab: ReviewTab,
  ) => items.push({ id, severity: 'action', title, detail, tab })

  const check = (
    id: string,
    title: string,
    detail: string,
    tab: ReviewTab,
  ) => items.push({ id, severity: 'check', title, detail, tab })

  if (!data.personal.name.trim()) {
    action('personal-name', 'Add your name', 'The personal details section has no name recorded.', 'Personal')
  }

  const companyMode = isCompanyMode(data)
  if (!data.business || data.business.status === 'unknown') {
    action('business-status', 'Tell us whether you worked for yourself',
      'Answer “Did you work for yourself in this tax year?” in Income, even if the answer is No.', 'Income')
  } else if (data.business.status !== 'none') {
    // Personal tax only needs sole-trader records; company records matter only when working out Corporation Tax.
    const active: string[] = companyMode ? ['company'] : hasSoleTrade(data.business) ? ['soleTrader'] : []
    for (const owner of active) {
      if (!data.business.invoices.some((invoice) => invoice.business === owner)) {
        action(`business-records-${owner}`, `Add your ${owner === 'company' ? 'company’s' : 'business'} invoices and receipts`,
          'Add each sale and business cost in Income, or check that there was no business activity in the period.', 'Income')
      }
    }
    const pending = data.business.invoices.filter((invoice) => active.includes(invoice.business) && !invoice.confirmed).length
    if (pending) action('business-invoices', `Confirm ${pending} business entr${pending === 1 ? 'y' : 'ies'}`,
      'Unconfirmed entries aren’t counted. Check each date and amount, and look out for duplicates.', 'Income')
    if (active.includes('soleTrader')) check('business-sole-trader-tax', 'Self-employed extras aren’t calculated',
      'National Insurance, payments on account, student loan repayments, the trading allowance and loss relief are not included.', 'Income')
    if (companyMode) {
      const issues = corporationEstimateIssues(data.business)
      if (issues.length) action('business-company-estimate', 'Finish the company details', issues.join(' '), 'Income')
      check('business-company-tax', 'Corporation Tax is an estimate',
        'It covers simple cases only. Check capital allowances, losses, VAT and filing deadlines with an accountant.', 'Computation')
    }
  }

  data.employments.forEach((employment) => {
    if (employment.p60Source && !employment.p60Source.verified) {
      action(
        `p60-${employment.p60Source.id}`,
        `Verify P60 — ${employment.employer || 'Employment'}`,
        `Check pay and tax against ${employment.p60Source.fileName} before relying on the computation.`,
        'Income',
      )
    }
  })

  data.savings.forEach((entry) => {
    if (entry.bankSource && !entry.bankSource.verified) {
      action(`savings-${entry.bankSource.id}`, `Verify interest — ${entry.source || 'Bank interest'}`,
        `Check £${entry.bankSource.recordedAmount.toFixed(2)} from ${entry.bankSource.fileName} for duplicates and tax treatment.`,
        'Income')
    }
  })

  data.dividends.forEach((entry) => {
    if (entry.bankSource && !entry.bankSource.verified) {
      action(`dividend-${entry.bankSource.id}`, `Verify dividend — ${entry.source || 'Dividend'}`,
        `Check £${entry.bankSource.recordedAmount.toFixed(2)} from ${entry.bankSource.fileName} for duplicates and tax treatment.`,
        'Income')
    }
  })

  data.other.forEach((entry) => {
    if (entry.bankSource) {
      if (!entry.bankSource.verified || entry.amount === 0) {
        action(`other-${entry.bankSource.id}`, `Confirm other income — ${entry.description || 'Bank receipt'}`,
          `Recorded receipts are £${entry.bankSource.recordedAmount.toFixed(2)}. Confirm the purpose and enter only the taxable amount.`,
          'Income')
      }
    }
  })

  data.properties.forEach((property) => {
    if (property.name.startsWith('Unallocated')) {
      action(`unallocated-property-${property.id}`, 'Reconcile unallocated property evidence',
        'Evidence has not been assigned to a named property. It does not affect the computation until reconciled.',
        'Income')
    } else {
      if (!property.documentVerified &&
        (property.documentSources?.length || property.bankEvidence?.length || property.expenseEvidence?.length)) {
        check(`property-${property.id}`, `Verify property figures — ${property.name || 'Property'}`,
          'Check ownership, rental income, allowable costs and mortgage interest against the source evidence.',
          'Income')
      }
      property.expenseEvidence?.forEach((expense) => {
        if (expense.treatment === 'review') {
          check(`expense-${expense.id}`, `Review property cost — ${expense.description || property.name}`,
            `£${expense.amount.toFixed(2)} needs an allowable or excluded treatment before it is included.`,
            'Income')
        }
      })
    }
  })

  // Mortgage payments name only the lender, so they cannot create properties; use them to spot a property that is missing.
  const lenders = data.properties.filter((property) => property.name.startsWith('Unallocated bank evidence:') &&
    property.bankEvidence?.some((evidence) => evidence.kind === 'mortgage') && !/mortgage-labelled/i.test(property.name))
    .map((property) => property.name.replace(/^Unallocated bank evidence:\s*/, ''))
  const named = data.properties.filter((property) => !property.name.startsWith('Unallocated'))
  if (lenders.length > named.length) {
    check('mortgage-lenders-vs-properties', `${lenders.length} mortgage lenders but ${named.length} propert${named.length === 1 ? 'y' : 'ies'}`,
      `Payments go to ${lenders.join(', ')}. One may be a remortgage of the same property, or a property is missing: add it in Income and assign each lender’s evidence.`,
      'Income')
  }

  data.bankReliefCandidates?.forEach((candidate) => {
    if (candidate.claimedAmount === 0) {
      action(`bank-relief-${candidate.source.id}`,
        candidate.kind === 'giftAid' ? 'Confirm Gift Aid eligibility' : 'Confirm pension contribution relief',
        `£${candidate.source.recordedAmount.toFixed(2)} from ${candidate.source.fileName} is recorded as a candidate, not claimed relief.`,
        'Income')
    }
  })

  if (documents?.taxYearId === data.taxYearId) {
    const pending = documents.suggestions.filter((suggestion) => !suggestion.selected).length
    if (pending > 0) {
      check('pending-document-suggestions', `${pending} document suggestion${pending === 1 ? '' : 's'} pending`,
        'Review unchecked document proposals before importing them. Suggestions have not automatically been included.',
        'Documents')
    }
    const ocr = documents.suggestions.filter((suggestion) => suggestion.ocr).length
    if (ocr > 0) {
      action('ocr-document-suggestions', `${ocr} figure${ocr === 1 ? '' : 's'} read by OCR`,
        'Scanned documents can be misread. Compare each OCR figure digit by digit with the original before relying on it.',
        'Documents')
    }
    if (documents.warnings.length > 0) {
      action('document-warnings', 'Check document analysis warnings',
        `${documents.warnings.length} warning${documents.warnings.length === 1 ? '' : 's'} may require checking the original documents.`,
        'Documents')
    }
  }

  flags.forEach((flag) => {
    if (flag.severity === 'action' || flag.severity === 'check') {
      items.push({
        id: `relief-${flag.id}`,
        severity: flag.severity,
        title: flag.title,
        detail: flag.detail,
        tab: 'Reliefs',
      })
    }
  })

  // Personal-tax checks are hidden while working out the company's Corporation Tax.
  return companyMode ? items.filter((item) => item.id.startsWith('business-')) : items
}
