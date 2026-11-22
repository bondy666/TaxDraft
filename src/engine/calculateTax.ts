import type {
  TaxReturnData,
  TaxYearRates,
  ComputationResult,
  BandBreakdown,
} from '../types'
import { HICBC_THRESHOLD_START, HICBC_THRESHOLD_FULL } from '../data/taxYears.ts'
import { evidencedPropertyExpenses } from './propertyExpenses.ts'
import { soleTraderTotals } from './business.ts'

const round2 = (n: number) => Math.round(n * 100) / 100

/** Gross up a net relief-at-source payment (pension contribution or Gift Aid donation). */
function grossUp(net: number): number {
  return net / 0.8 // basic rate relief of 20% is added at source
}

/**
 * Walk a flat amount through a set of cumulative rate bands, starting at `startPoint`
 * along the shared income scale. Returns the per-band breakdown and the new cumulative point.
 */
function allocate(
  startPoint: number,
  amount: number,
  thresholds: number[], // cumulative upper edge of each band except the last (open-ended)
  rates: number[],
  labels: BandBreakdown['band'][]
): { bands: BandBreakdown[]; endPoint: number } {
  const bands: BandBreakdown[] = []
  let remaining = amount
  let cursor = startPoint

  for (let i = 0; i < rates.length && remaining > 0.0000001; i++) {
    const bandCeiling = i < thresholds.length ? thresholds[i] : Infinity
    const spaceInBand = Math.max(0, bandCeiling - cursor)
    const slice = Math.min(remaining, spaceInBand)
    if (slice > 0) {
      bands.push({ band: labels[i], amount: round2(slice), rate: rates[i], tax: round2(slice * rates[i]) })
      cursor += slice
      remaining -= slice
    }
  }
  return { bands, endPoint: cursor }
}

export function calculateTax(data: TaxReturnData, rates: TaxYearRates): ComputationResult {
  // ---- 1. Aggregate income ----------------------------------------------
  const employmentTotal = data.employments.reduce((s, e) => s + e.p60Pay + e.benefitsInKind, 0)
  const taxDeductedFromEmployment = data.employments.reduce((s, e) => s + e.taxDeducted, 0)

  const propertyProfits = data.properties.filter((p) => !p.name.startsWith('Unallocated')).map((p) => {
    const income = p.rentalIncome * p.ownershipShare
    const expenses = evidencedPropertyExpenses(p) * p.ownershipShare
    const finance = p.mortgageInterest * p.ownershipShare
    const profit = income - expenses // finance costs are NOT deducted here — restricted below
    return { profit, finance }
  })
  const propertyTotal = propertyProfits.reduce((s, p) => s + p.profit, 0)
  const totalFinanceCosts = propertyProfits.reduce((s, p) => s + p.finance, 0)

  const pensionTotal = data.pensions.reduce((s, p) => s + p.amount, 0)
  const taxDeductedFromPensions = data.pensions.reduce((s, p) => s + p.taxDeducted, 0)
  const otherTotal = data.other.reduce((s, o) => s + o.amount, 0)

  // Trading losses need a separate relief election; do not offset them automatically.
  const tradingProfit = Math.max(0, soleTraderTotals(data.business, data.taxYearId).profit)
  const totalNonSavingsIncome = employmentTotal + tradingProfit + propertyTotal + pensionTotal + otherTotal
  const totalSavingsIncome = data.savings.reduce((s, i) => s + i.amount, 0)
  const totalDividendIncome = data.dividends.reduce((s, d) => s + d.amount, 0)
  const totalIncome = totalNonSavingsIncome + totalSavingsIncome + totalDividendIncome

  // ---- 2. Extension of the rate bands (Gift Aid + relief-at-source pension) ----
  const grossPension = grossUp(data.reliefs.personalPensionContributionsNet)
  const grossGiftAid = grossUp(data.reliefs.giftAidNet)
  const extension = grossPension + grossGiftAid

  // ---- 3. Personal allowance taper ----------------------------------------------
  const adjustedNetIncome = totalIncome - extension
  const taperOver = Math.max(0, adjustedNetIncome - rates.taperThreshold)
  const personalAllowanceTaper = Math.min(rates.personalAllowance, Math.floor(taperOver / 2))
  const personalAllowanceAvailable = rates.personalAllowance - personalAllowanceTaper

  // ---- 4. Extended band thresholds (taxable-income terms) ----------------------
  const basicRateLimitExtended = rates.basicRateLimit + extension
  const additionalRateThresholdTaxable =
    rates.additionalRateThresholdNominal - personalAllowanceAvailable + extension

  const thresholds = [basicRateLimitExtended, additionalRateThresholdTaxable]
  const bandRates = [rates.rates.basic, rates.rates.higher, rates.rates.additional]

  // ---- 5. Allocate PA, then non-savings / savings / dividends in that order ----
  const nonSavingsTaxable = Math.max(0, totalNonSavingsIncome - personalAllowanceAvailable)
  // any PA left over after non-savings income spills onto savings, then dividends
  const paLeftAfterNonSavings = Math.max(0, personalAllowanceAvailable - totalNonSavingsIncome)
  const savingsTaxable = Math.max(0, totalSavingsIncome - paLeftAfterNonSavings)
  const paLeftAfterSavings = Math.max(0, paLeftAfterNonSavings - totalSavingsIncome)
  const dividendsTaxable = Math.max(0, totalDividendIncome - paLeftAfterSavings)

  const nonSavingsAlloc = allocate(0, nonSavingsTaxable, thresholds, bandRates, ['basic', 'higher', 'additional'])

  // ---- Savings: starting rate band (simplified — only when non-savings income is nil)
  // then Personal Savings Allowance at 0%, occupying band space, then normal rates.
  let savingsBands: BandBreakdown[] = []
  let cursor = nonSavingsAlloc.endPoint
  let remainingSavings = savingsTaxable

  if (nonSavingsTaxable === 0 && remainingSavings > 0) {
    const startingSlice = Math.min(remainingSavings, rates.startingRateForSavingsBand)
    if (startingSlice > 0) {
      savingsBands.push({ band: 'startingRate', amount: round2(startingSlice), rate: 0, tax: 0 })
      cursor += startingSlice
      remainingSavings -= startingSlice
    }
  }

  const marginalBandForSavings: 'basic' | 'higher' | 'additional' =
    cursor < thresholds[0] ? 'basic' : cursor < thresholds[1] ? 'higher' : 'additional'
  const psaAmount = rates.personalSavingsAllowance[marginalBandForSavings]

  if (remainingSavings > 0 && psaAmount > 0) {
    const psaSlice = Math.min(remainingSavings, psaAmount)
    savingsBands.push({ band: 'psa', amount: round2(psaSlice), rate: 0, tax: 0 })
    cursor += psaSlice
    remainingSavings -= psaSlice
  }

  const savingsRestAlloc = allocate(cursor, remainingSavings, thresholds, bandRates, ['basic', 'higher', 'additional'])
  savingsBands = savingsBands.concat(savingsRestAlloc.bands)
  cursor = savingsRestAlloc.endPoint

  // ---- Dividends: dividend allowance at 0%, then dividend rate bands ----
  let dividendBands: BandBreakdown[] = []
  let remainingDividends = dividendsTaxable

  if (remainingDividends > 0 && rates.dividendAllowance > 0) {
    const daSlice = Math.min(remainingDividends, rates.dividendAllowance)
    dividendBands.push({ band: 'dividendAllowance', amount: round2(daSlice), rate: 0, tax: 0 })
    cursor += daSlice
    remainingDividends -= daSlice
  }
  const dividendRateList = [rates.dividendRates.basic, rates.dividendRates.higher, rates.dividendRates.additional]
  const dividendRestAlloc = allocate(cursor, remainingDividends, thresholds, dividendRateList, ['basic', 'higher', 'additional'])
  dividendBands = dividendBands.concat(dividendRestAlloc.bands)

  // ---- 6. Total tax before reducers ----------------------------------------------
  const sumTax = (bands: BandBreakdown[]) => bands.reduce((s, b) => s + b.tax, 0)
  const incomeTaxBeforeReducers = round2(
    sumTax(nonSavingsAlloc.bands) + sumTax(savingsBands) + sumTax(dividendBands)
  )

  // ---- 7. Finance cost reducer (residential mortgage interest, restricted to 20%) ----
  // Capped at the lower of: total finance costs, and property profits before finance costs
  // were added back (a simplification of the real "adjusted total income" cap — flagged
  // separately if property income is close to nil or negative).
  const financeCostBase = Math.min(totalFinanceCosts, Math.max(0, propertyTotal))
  const financeCostReducer = round2(financeCostBase * rates.propertyFinanceCostReducerRate)

  // Marriage Allowance is not auto-calculated here since it depends on a spouse's
  // unused personal allowance, which this workbook doesn't currently capture.
  const marriageAllowanceReducer = 0

  const incomeTaxDue = round2(Math.max(0, incomeTaxBeforeReducers - financeCostReducer - marriageAllowanceReducer))

  // ---- 8. High Income Child Benefit Charge ----------------------------------------------
  let highIncomeChildBenefitCharge = 0
  if (data.personal.claimsChildBenefit && adjustedNetIncome > HICBC_THRESHOLD_START) {
    const proportion = Math.min(1, (adjustedNetIncome - HICBC_THRESHOLD_START) / (HICBC_THRESHOLD_FULL - HICBC_THRESHOLD_START))
    highIncomeChildBenefitCharge = round2(data.personal.childBenefitAnnualAmount * proportion)
  }

  // ---- 9. Tax deducted at source / balance ----------------------------------------------
  const taxDeductedAtSource = round2(taxDeductedFromEmployment + taxDeductedFromPensions)
  const balanceDueOrRefund = round2(incomeTaxDue + highIncomeChildBenefitCharge - taxDeductedAtSource)

  return {
    totalNonSavingsIncome: round2(totalNonSavingsIncome),
    totalSavingsIncome: round2(totalSavingsIncome),
    totalDividendIncome: round2(totalDividendIncome),
    totalIncome: round2(totalIncome),
    extension: round2(extension),
    adjustedNetIncome: round2(adjustedNetIncome),
    personalAllowanceTaper: round2(personalAllowanceTaper),
    personalAllowanceAvailable: round2(personalAllowanceAvailable),
    nonSavingsTaxable: round2(nonSavingsTaxable),
    savingsTaxable: round2(savingsTaxable),
    dividendsTaxable: round2(dividendsTaxable),
    nonSavingsBands: nonSavingsAlloc.bands,
    savingsBands,
    dividendBands,
    incomeTaxBeforeReducers,
    financeCostReducer,
    marriageAllowanceReducer,
    incomeTaxDue,
    taxDeductedAtSource,
    balanceDueOrRefund,
    highIncomeChildBenefitCharge,
  }
}
