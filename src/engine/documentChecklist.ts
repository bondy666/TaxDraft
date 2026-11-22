import type { TaxReturnData } from '../types'
import { hasCompany, hasSoleTrade, isCompanyMode } from './business.ts'

export type DocumentNeed = 'needed' | 'optional' | 'notNeeded'

export interface DocumentChecklistItem {
  id: string
  label: string
  detail: string
  need: DocumentNeed
  found: boolean
}

export interface DocumentChecklist {
  companyMode: boolean
  items: DocumentChecklistItem[]
  /** Invoices are present but the user has not said whether they work for themselves. */
  askAboutBusiness: boolean
}

const matches = (names: string[], keywords: string[], exclude: string[] = []) =>
  names.some((name) => keywords.some((keyword) => name.includes(keyword)) && !exclude.some((word) => name.includes(word)))

const INVOICE_WORDS = ['invoice', 'sales']

/**
 * Works out, from what has been entered and the file names selected, which documents are needed, already present,
 * or not needed. Nothing is asked: a document is "needed" only when the return shows that situation applies.
 */
export function buildDocumentChecklist(data: TaxReturnData, fileNames: string[]): DocumentChecklist {
  const names = fileNames.map((name) => name.toLowerCase())
  const business = data.business
  const companyMode = isCompanyMode(data)
  const sole = hasSoleTrade(business)
  const company = hasCompany(business)
  const status = business?.status ?? 'unknown'
  const invoices = business?.invoices ?? []
  const candidates = data.bankReliefCandidates ?? []
  const namedProperties = data.properties.filter((property) => !property.name.startsWith('Unallocated'))
  const hasBankEvidence = [...data.savings, ...data.dividends, ...data.other].some((item) => item.bankSource) ||
    data.properties.some((property) => property.bankEvidence?.length || property.rentalIncomeEvidence?.length) ||
    candidates.length > 0
  const personalOnly = 'Only needed for your personal tax, not your company’s Corporation Tax.'

  const item = (id: string, label: string, applies: boolean | 'no', found: boolean, neededDetail: string, optionalDetail: string,
    notNeededDetail = ''): DocumentChecklistItem => ({
    id, label, found,
    need: companyMode ? 'notNeeded' : applies === 'no' ? 'notNeeded' : applies ? 'needed' : 'optional',
    detail: companyMode ? personalOnly : applies === 'no' ? notNeededDetail : applies ? neededDetail : optionalDetail,
  })

  const personalItems: DocumentChecklistItem[] = [
    item('p60', 'P60 from each employer', data.employments.length > 0,
      matches(names, ['p60', 'payslip']) || data.employments.some((employment) => employment.p60Source),
      company ? 'Including your own company, if it paid you a salary. A final payslip will do if the P60 is missing.'
        : 'A final payslip before 5 April will do if the P60 is missing.',
      company ? 'Only if you were employed, including by your own company.' : 'Only if you were employed.'),
    item('p11d', 'P11D (benefits from your employer)', data.employments.some((employment) => employment.benefitsInKind > 0),
      matches(names, ['p11d']), 'Shows the value of benefits such as a company car.',
      'Only if your employer gave you benefits, such as a company car or private medical insurance.'),
    item('business-records', 'Your business invoices and receipts',
      sole ? true : status === 'none' || company ? 'no' : false,
      matches(names, INVOICE_WORDS) || invoices.some((invoice) => invoice.business === 'soleTrader'),
      'Invoices you sent and receipts for business costs. Add them in Income.',
      'Only if you were self-employed.',
      company ? 'Your company’s invoices belong to its Corporation Tax, not your personal tax.'
        : 'You said you don’t work for yourself. If these are costs for a rental property, keep them with your property records.'),
    item('state-pension', 'State Pension amount', data.pensions.some((pension) => /state/i.test(pension.source)),
      matches(names, ['state pension', 'statepension', 'state_pension']),
      'The yearly amount from your DWP letter.', 'Only if you received the State Pension.'),
    item('other-pension', 'Pension P60 or statement', data.pensions.some((pension) => !/state/i.test(pension.source)),
      matches(names, ['pension'], ['contribution', 'state']),
      'From each private or workplace pension that paid you.', 'Only if a private or workplace pension paid you.'),
    item('lettings', 'Rental income and costs', namedProperties.length > 0,
      matches(names, ['letting', 'rental', 'property', 'tenancy']) || data.properties.some((property) => property.documentSources?.length),
      'Letting agent statements, or your own record of rent and costs.', 'Only if you rented out property.'),
    item('interest', 'Bank or building society interest', data.savings.length > 0,
      matches(names, ['interest', 'savings'], ['loan', 'mortgage']) || data.savings.some((entry) => entry.bankSource),
      'Interest statements or certificates.', 'Only if you earned interest outside an ISA.'),
    item('dividends', 'Dividend vouchers', data.dividends.length > 0,
      matches(names, ['dividend']) || data.dividends.some((entry) => entry.bankSource),
      company ? 'Including dividends from your own company.' : 'From each company you hold shares in.',
      company ? 'Only if you received dividends, including from your own company.' : 'Only if you received dividends from shares outside an ISA.'),
    item('gift-aid', 'Gift Aid donations',
      data.reliefs.giftAidNet > 0 || !!data.charitableDonationRecipients?.length || candidates.some((candidate) => candidate.kind === 'giftAid'),
      matches(names, ['gift aid', 'giftaid', 'charity', 'donation']) || candidates.some((candidate) => candidate.kind === 'giftAid'),
      'Receipts or bank records of donations where you made a Gift Aid declaration.', 'Only if you gave to charity with Gift Aid.'),
    item('pension-contributions', 'Personal pension contributions',
      data.reliefs.personalPensionContributionsNet > 0 || !!data.privatePensionRecipients?.length ||
        candidates.some((candidate) => candidate.kind === 'pensionContribution'),
      matches(names, ['pension contribution', 'contribution']) || candidates.some((candidate) => candidate.kind === 'pensionContribution'),
      'Statements showing what you paid in yourself (not through your employer’s payroll).',
      'Only if you paid into a personal pension yourself.'),
    item('bank', 'Bank statements', false, matches(names, ['bank', 'statement']) || hasBankEvidence, '',
      'Helpful for finding rent, interest, donations and pension payments.'),
    item('disposals', 'Records of things you sold', false, matches(names, ['disposal', 'capital gain', 'cgt']), '',
      'Only if you sold shares, crypto, a second property or other assets.'),
    item('chargeable-event', 'Chargeable event certificates', false, matches(names, ['chargeable']), '',
      'Only if you cashed in a life insurance bond or policy.'),
    item('r185', 'R185 trust income statement', false, matches(names, ['r185', 'trust']), '',
      'Only if you received income from a trust.'),
    item('loan-interest', 'Loan interest certificates', false, matches(names, ['loan interest', 'mortgage certificate']), '',
      'Only if you claim relief for interest on a qualifying loan.'),
    item('prior-computation', 'Last year’s tax computation', false, matches(names, ['computation', 'tax return', 'sa100']), '',
      'Useful for comparison, but not required.'),
  ]

  const companyItems: DocumentChecklistItem[] = companyMode ? [
    { id: 'company-sales', label: 'Sales invoices', need: 'needed',
      found: matches(names, INVOICE_WORDS) || invoices.some((invoice) => invoice.business === 'company' && invoice.kind === 'income'),
      detail: 'Every invoice your company sent in the accounting period. Add them in Income.' },
    { id: 'company-costs', label: 'Receipts and bills for business costs', need: 'needed',
      found: matches(names, ['receipt', 'expense', 'bill', 'purchase']) ||
        invoices.some((invoice) => invoice.business === 'company' && invoice.kind === 'expense'),
      detail: 'Costs your company paid in the accounting period. Add them in Income.' },
    { id: 'company-bank', label: 'Business bank statements', need: 'needed', found: matches(names, ['bank', 'statement']),
      detail: 'To check that every sale and cost has been recorded.' },
    { id: 'company-prior', label: 'Last year’s company accounts or CT600', need: 'optional',
      found: matches(names, ['ct600', 'accounts', 'corporation tax']), detail: 'Useful for comparison, but not required.' },
  ] : []

  // In company mode the company's own invoices and bank statements are covered by the company items above.
  const shownPersonal = companyMode ? personalItems.filter((entry) => !['business-records', 'bank'].includes(entry.id)) : personalItems
  return {
    companyMode,
    items: [...companyItems, ...shownPersonal],
    askAboutBusiness: status === 'unknown' && (matches(names, INVOICE_WORDS) || invoices.length > 0),
  }
}
