import type { TaxYearRates } from '../types'

// Figures below are England/Wales/NI, non-Scottish rates.
// Scottish taxpayers have different bands for non-savings, non-dividend income —
// see the note surfaced in the relief checker if isScottishTaxpayer is set.
//
// Sources: gov.uk/income-tax-rates, HMRC "Overview of Tax Legislation and Rates" (OOTLAR),
// House of Commons Library "Direct taxes: rates and allowances" briefings.
// Always re-check against gov.uk before relying on this for a real filing —
// rates are normally confirmed at the Budget before each 6 April.

export const TAX_YEARS: Record<string, TaxYearRates> = {
  '2024-25': {
    id: '2024-25',
    label: '2024/25 (year ended 5 April 2025)',
    personalAllowance: 12570,
    taperThreshold: 100000,
    taperFullyGoneAt: 125140,
    basicRateLimit: 37700,
    additionalRateThresholdNominal: 125140,
    rates: { basic: 0.20, higher: 0.40, additional: 0.45 },
    dividendAllowance: 500,
    dividendRates: { basic: 0.0875, higher: 0.3375, additional: 0.3935 },
    personalSavingsAllowance: { basic: 1000, higher: 500, additional: 0 },
    startingRateForSavingsBand: 5000,
    marriageAllowanceTransferable: 1260,
    propertyFinanceCostReducerRate: 0.20,
    pensionAnnualAllowance: 60000,
    cgtAnnualExemptAmount: 3000,
    propertyIncomeAllowance: 1000,
  },
  '2025-26': {
    id: '2025-26',
    label: '2025/26 (year ended 5 April 2026)',
    personalAllowance: 12570,
    taperThreshold: 100000,
    taperFullyGoneAt: 125140,
    basicRateLimit: 37700,
    additionalRateThresholdNominal: 125140,
    rates: { basic: 0.20, higher: 0.40, additional: 0.45 },
    dividendAllowance: 500,
    dividendRates: { basic: 0.0875, higher: 0.3375, additional: 0.3935 },
    personalSavingsAllowance: { basic: 1000, higher: 500, additional: 0 },
    startingRateForSavingsBand: 5000,
    marriageAllowanceTransferable: 1260,
    propertyFinanceCostReducerRate: 0.20,
    pensionAnnualAllowance: 60000,
    cgtAnnualExemptAmount: 3000,
    propertyIncomeAllowance: 1000,
  },
  '2026-27': {
    id: '2026-27',
    label: '2026/27 (year ended 5 April 2027) — current year',
    personalAllowance: 12570,
    taperThreshold: 100000,
    taperFullyGoneAt: 125140,
    basicRateLimit: 37700,
    additionalRateThresholdNominal: 125140,
    rates: { basic: 0.20, higher: 0.40, additional: 0.45 },
    dividendAllowance: 500,
    // Dividend rates rose from 6 April 2026 (Autumn Budget 2025): 8.75→10.75, 33.75→35.75, 39.35 unchanged
    dividendRates: { basic: 0.1075, higher: 0.3575, additional: 0.3935 },
    personalSavingsAllowance: { basic: 1000, higher: 500, additional: 0 },
    startingRateForSavingsBand: 5000,
    marriageAllowanceTransferable: 1260,
    propertyFinanceCostReducerRate: 0.20,
    pensionAnnualAllowance: 60000,
    cgtAnnualExemptAmount: 3000,
    propertyIncomeAllowance: 1000,
  },
}

export const DEFAULT_TAX_YEAR = '2026-27'

// High Income Child Benefit Charge — since April 2024 this is based on "adjusted net income"
// between £60,000 and £80,000, charged at 1% of Child Benefit per £200 of income over £60,000,
// reaching 100% (i.e. all of it clawed back) at £80,000.
export const HICBC_THRESHOLD_START = 60000
export const HICBC_THRESHOLD_FULL = 80000
