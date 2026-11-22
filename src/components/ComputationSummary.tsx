import type { ReactNode } from 'react'
import type { ComputationResult, TaxReturnData, TaxYearRates } from '../types'
import { evidencedPropertyExpenses } from '../engine/propertyExpenses'
import { HICBC_THRESHOLD_FULL, HICBC_THRESHOLD_START } from '../data/taxYears'
import { FigureHelp } from './FigureHelp'
import { soleTraderTotals } from '../engine/business'

function fmt(n: number) {
  const sign = n < 0 ? '−' : ''
  return sign + Math.abs(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtRate(rate: number) {
  // Avoids toFixed(1) rounding 10.75% up to "10.8%" for the post-2026 dividend rates.
  const pct = rate * 100
  return pct % 1 === 0 ? String(pct) : String(Math.round(pct * 100) / 100)
}

function Row({ label, value, help, indent = false, strong = false, negative = false }: {
  label: string; value: string; help: ReactNode; indent?: boolean; strong?: boolean; negative?: boolean
}) {
  return (
    <div className={`ledger-row ${indent ? 'indent' : ''} ${strong ? 'strong' : ''}`}>
      <span className="ledger-label">{label}</span>
      <span className="ledger-leader" aria-hidden="true" />
      <span className="ledger-amount">
        <span className={`ledger-value figure ${negative ? 'negative' : ''}`}>{value}</span>
        <FigureHelp>{help}</FigureHelp>
      </span>
    </div>
  )
}

type FigurePart = { label: string; amount: number; detail?: string; evidence?: string }

function sumExplanation(parts: FigurePart[], total: number, title: string) {
  return (
    <div className="figure-breakdown">
      <strong>{title}</strong>
      {parts.length ? (
        <ul>
          {parts.map((part, index) => (
            <li key={`${part.label}-${index}`}>
              <span>{part.label}: <strong>£{fmt(part.amount)}</strong></span>
              {part.detail && <small>{part.detail}</small>}
              {part.evidence && <small>Source detail: {part.evidence}</small>}
            </li>
          ))}
        </ul>
      ) : <p>No amounts are currently entered.</p>}
      <p className="figure-breakdown-total">Total: £{fmt(total)}</p>
    </div>
  )
}

export function ComputationSummary({ result, rates, data }: {
  result: ComputationResult; rates: TaxYearRates; data: TaxReturnData
}) {
  const employmentParts = data.employments.flatMap((item) => [
    { label: `${item.employer || 'Employment'} — P60 pay`, amount: item.p60Pay,
      detail: item.p60Source ? `Auto-populated from ${item.p60Source.fileName}.` : 'Amount entered in Employment.' },
    { label: `${item.employer || 'Employment'} — P11D benefits`, amount: item.benefitsInKind,
      detail: 'Added to employment income.' },
  ])
  const propertyParts = data.properties.map((item) => {
    const expenses = evidencedPropertyExpenses(item)
    const share = (item.ownershipShare * 100).toLocaleString('en-GB')
    return {
      label: item.name || 'Property',
      amount: (item.rentalIncome - expenses) * item.ownershipShare,
      detail: `£${fmt(item.rentalIncome)} rent − £${fmt(expenses)} allowable running costs = £${fmt(item.rentalIncome - expenses)} profit before ownership; × ${share}% ownership = £${fmt((item.rentalIncome - expenses) * item.ownershipShare)}. Mortgage interest is not deducted here.`,
      evidence: item.documentNote,
    }
  })
  const pensionParts = data.pensions.map((item) => ({
    label: item.source || 'Pension', amount: item.amount, detail: 'Amount entered in Pensions received.',
  }))
  const otherParts = data.other.map((item) => ({
    label: item.description || 'Other income', amount: item.amount,
    detail: 'Amount entered in Other income.', evidence: item.bankSource?.evidence,
  }))
  const trading = soleTraderTotals(data.business, data.taxYearId)
  const tradingParts = data.business && ['soleTrader', 'both'].includes(data.business.status) ? [{
    label: 'Sole trader profit', amount: Math.max(0, trading.profit),
    detail: `Confirmed sales £${fmt(trading.income)} less allowable expenses £${fmt(trading.expenses)}. Loss relief is not applied automatically.`,
  }] : []
  const nonSavingsParts = [...employmentParts, ...tradingParts, ...propertyParts, ...pensionParts, ...otherParts]
  const savingsParts = data.savings.map((item) => ({
    label: item.source || 'Interest source', amount: item.amount,
    detail: item.bankSource ? `Imported from ${item.bankSource.fileName}.` : 'Amount entered in Interest received.',
    evidence: item.bankSource?.evidence,
  }))
  const dividendParts = data.dividends.map((item) => ({
    label: item.source || 'Dividend source', amount: item.amount,
    detail: item.bankSource ? `Imported from ${item.bankSource.fileName}.` : 'Amount entered in Dividends.',
    evidence: item.bankSource?.evidence,
  }))
  const totalFinanceCosts = data.properties.reduce((sum, item) => sum + item.mortgageInterest * item.ownershipShare, 0)
  const propertyProfits = propertyParts.reduce((sum, part) => sum + part.amount, 0)
  const financeCostBase = Math.min(totalFinanceCosts, Math.max(0, propertyProfits))
  const financeCostParts = data.properties.map((item) => ({
    label: item.name || 'Property',
    amount: item.mortgageInterest * item.ownershipShare,
    detail: `Annual interest £${fmt(item.mortgageInterest)} × ${(item.ownershipShare * 100).toLocaleString('en-GB')}% ownership.`,
  }))
  const childBenefitChargeProportion = Math.min(1, Math.max(0,
    (result.adjustedNetIncome - HICBC_THRESHOLD_START) / (HICBC_THRESHOLD_FULL - HICBC_THRESHOLD_START)))
  const allowanceAgainstNonSavings = result.totalNonSavingsIncome - result.nonSavingsTaxable
  const allowanceAgainstSavings = result.totalSavingsIncome - result.savingsTaxable
  const allowanceAgainstDividends = result.totalDividendIncome - result.dividendsTaxable
  const incomeTaxBeforeReducersFromBands = [
    ...result.nonSavingsBands, ...result.savingsBands, ...result.dividendBands,
  ].reduce((sum, band) => sum + band.tax, 0)
  const taxDeductedParts = [
    ...data.employments.map((item) => ({
      label: `${item.employer || 'Employment'} tax deducted`, amount: item.taxDeducted,
      detail: item.p60Source ? `P60 from ${item.p60Source.fileName}.` : 'Amount entered in Employment.',
    })),
    ...data.pensions.map((item) => ({
      label: `${item.source || 'Pension'} tax deducted`, amount: item.taxDeducted,
      detail: 'Amount entered in Pensions received.',
    })),
  ]
  const bandLabel: Record<string, string> = {
    basic: 'Basic rate', higher: 'Higher rate', additional: 'Additional rate',
    startingRate: 'Starting rate for savings', psa: 'Personal Savings Allowance', dividendAllowance: 'Dividend allowance',
  }
  const bandTaxParts = [
    ...result.nonSavingsBands.map((band) => ({ label: `Non-savings — ${bandLabel[band.band]} (${fmt(band.amount)} × ${fmtRate(band.rate)}%)`, amount: band.tax })),
    ...result.savingsBands.map((band) => ({ label: `Savings — ${bandLabel[band.band]} (${fmt(band.amount)} × ${fmtRate(band.rate)}%)`, amount: band.tax })),
    ...result.dividendBands.map((band) => ({ label: `Dividends — ${bandLabel[band.band]} (${fmt(band.amount)} × ${fmtRate(band.rate)}%)`, amount: band.tax })),
  ]
  const incomeParts = [
    { label: 'Non-savings income', amount: result.totalNonSavingsIncome },
    { label: 'UK interest', amount: result.totalSavingsIncome },
    { label: 'Dividends', amount: result.totalDividendIncome },
  ]

  return (
    <div className="card ledger">
      <h2>Computation — {rates.label}</h2>
      {tradingParts.length > 0 && <p className="hint error">This income-tax estimate excludes self-employed National Insurance, student loans and payments on account. Company tax is separate.</p>}

      <div className="ledger-section-title">Income</div>
      <Row label="Non-savings income (employment, trading, property, pensions, other)" value={fmt(result.totalNonSavingsIncome)}
        help={sumExplanation(nonSavingsParts, result.totalNonSavingsIncome, 'Included in non-savings income')} />
      <Row label="UK interest" value={fmt(result.totalSavingsIncome)}
        help={sumExplanation(savingsParts, result.totalSavingsIncome, 'Included interest sources')} />
      <Row label="Dividends" value={fmt(result.totalDividendIncome)}
        help={sumExplanation(dividendParts, result.totalDividendIncome, 'Included dividend sources')} />
      <Row label="Total income" value={fmt(result.totalIncome)}
        help={sumExplanation(incomeParts, result.totalIncome, 'The three income totals added together')}
        strong />

      <div className="ledger-section-title">Personal allowance</div>
      <Row label="Standard allowance" value={fmt(rates.personalAllowance)}
        help={`The standard personal allowance for ${rates.label} is £${fmt(rates.personalAllowance)}.`} />
      {result.personalAllowanceTaper > 0 && (
        <Row label={`Abatement (income over £${fmt(rates.taperThreshold)})`} value={`(${fmt(result.personalAllowanceTaper)})`}
          help={<div className="figure-breakdown">
            <p>Adjusted net income £{fmt(result.adjustedNetIncome)} − threshold £{fmt(rates.taperThreshold)} = £{fmt(Math.max(0, result.adjustedNetIncome - rates.taperThreshold))} over the threshold.</p>
            <p>Half the excess, rounded down and capped at the standard allowance, gives an abatement of £{fmt(result.personalAllowanceTaper)}.</p>
          </div>}
          negative />
      )}
      <Row label="Allowance available" value={fmt(result.personalAllowanceAvailable)}
        help={`Standard allowance £${fmt(rates.personalAllowance)} minus abatement £${fmt(result.personalAllowanceTaper)} = £${fmt(result.personalAllowanceAvailable)}.`}
        strong />

      <div className="ledger-section-title">
        Tax on non-savings income — taxable £{fmt(result.nonSavingsTaxable)}
        <FigureHelp><div className="figure-breakdown">
          <p>Non-savings income: £{fmt(result.totalNonSavingsIncome)}</p>
          <p>Personal allowance used here: −£{fmt(allowanceAgainstNonSavings)}</p>
          <p className="figure-breakdown-total">Taxable non-savings income: £{fmt(result.nonSavingsTaxable)}</p>
        </div></FigureHelp>
      </div>
      {result.nonSavingsBands.map((b, i) => (
        <Row key={i} label={`${bandLabel[b.band]} — £${fmt(b.amount)} @ ${fmtRate(b.rate)}%`} value={fmt(b.tax)}
          help={`This tax-band slice is £${fmt(b.amount)} × ${fmtRate(b.rate)}% = £${fmt(b.tax)} tax.`} indent />
      ))}

      {result.savingsBands.length > 0 && (
        <>
          <div className="ledger-section-title">
            Tax on savings income — taxable £{fmt(result.savingsTaxable)}
            <FigureHelp><div className="figure-breakdown">
              <p>UK savings interest: £{fmt(result.totalSavingsIncome)}</p>
              <p>Personal allowance used here after non-savings income: −£{fmt(allowanceAgainstSavings)}</p>
              <p className="figure-breakdown-total">Taxable savings income: £{fmt(result.savingsTaxable)}</p>
              <p>Any 0% starting-rate and Personal Savings Allowance slices are then shown in the band breakdown.</p>
            </div></FigureHelp>
          </div>
          {result.savingsBands.map((b, i) => (
            <Row key={i} label={`${bandLabel[b.band]} — £${fmt(b.amount)} @ ${fmtRate(b.rate)}%`} value={fmt(b.tax)}
              help={`This savings slice is £${fmt(b.amount)} × ${fmtRate(b.rate)}% = £${fmt(b.tax)} tax. A 0% slice uses the applicable starting-rate or Personal Savings Allowance.`}
              indent />
          ))}
        </>
      )}

      {result.dividendBands.length > 0 && (
        <>
          <div className="ledger-section-title">
            Tax on dividends — taxable £{fmt(result.dividendsTaxable)}
            <FigureHelp><div className="figure-breakdown">
              <p>Dividend income: £{fmt(result.totalDividendIncome)}</p>
              <p>Personal allowance left after earlier income: −£{fmt(allowanceAgainstDividends)}</p>
              <p className="figure-breakdown-total">Taxable dividends before the dividend allowance: £{fmt(result.dividendsTaxable)}</p>
              <p>The dividend allowance is then shown separately in the band breakdown.</p>
            </div></FigureHelp>
          </div>
          {result.dividendBands.map((b, i) => (
            <Row key={i} label={`${bandLabel[b.band]} — £${fmt(b.amount)} @ ${fmtRate(b.rate)}%`} value={fmt(b.tax)}
              help={`This dividend slice is £${fmt(b.amount)} × ${fmtRate(b.rate)}% = £${fmt(b.tax)} tax. The 0% dividend allowance slice does not add tax.`}
              indent />
          ))}
        </>
      )}

      <div className="ledger-section-title">Reducers</div>
      <Row label="Income tax before reducers" value={fmt(result.incomeTaxBeforeReducers)}
        help={sumExplanation(bandTaxParts, incomeTaxBeforeReducersFromBands, 'Tax from each band added together')} />
      {result.financeCostReducer > 0 && <Row label={`Relief for finance costs @ ${fmtRate(rates.propertyFinanceCostReducerRate)}%`}
        value={`(${fmt(result.financeCostReducer)})`}
        help={<div className="figure-breakdown">
          {sumExplanation(financeCostParts, totalFinanceCosts, 'Mortgage interest by property, after ownership share')}
          {sumExplanation(propertyParts, propertyProfits, 'Property profits before mortgage interest')}
          <p>Eligible finance costs are the lower of total ownership-adjusted interest £{fmt(totalFinanceCosts)} and positive property profits £{fmt(Math.max(0, propertyProfits))}. That gives £{fmt(financeCostBase)} × {fmtRate(rates.propertyFinanceCostReducerRate)}% = £{fmt(result.financeCostReducer)} tax reducer.</p>
        </div>}
        negative />}
      <Row label="Income tax due" value={fmt(result.incomeTaxDue)}
        help={<div className="figure-breakdown">
          <strong>Tax before reducers: £{fmt(result.incomeTaxBeforeReducers)}</strong>
          <p>− Finance-cost relief: £{fmt(result.financeCostReducer)}</p>
          <p>− Marriage Allowance reducer: £{fmt(result.marriageAllowanceReducer)}</p>
          <p className="figure-breakdown-total">Tax due, not below £0: £{fmt(result.incomeTaxDue)}</p>
        </div>}
        strong />

      {result.highIncomeChildBenefitCharge > 0 && (
        <Row label="High Income Child Benefit Charge" value={fmt(result.highIncomeChildBenefitCharge)}
          help={`Annual Child Benefit £${fmt(data.personal.childBenefitAnnualAmount)} × ${fmtRate(childBenefitChargeProportion)}% charge proportion = £${fmt(result.highIncomeChildBenefitCharge)}. The proportion is based on adjusted net income £${fmt(result.adjustedNetIncome)}: it rises between £${fmt(HICBC_THRESHOLD_START)} and £${fmt(HICBC_THRESHOLD_FULL)}, and is capped at the benefit received.`} />
      )}

      <div className="ledger-section-title">Balance</div>
      <Row label="Tax deducted at source (PAYE)" value={`(${fmt(result.taxDeductedAtSource)})`}
        help={sumExplanation(taxDeductedParts, result.taxDeductedAtSource, 'Tax already deducted')}
        negative />
      <Row
        label={tradingParts.length > 0
          ? (result.balanceDueOrRefund >= 0 ? 'Estimated income tax balance (NI excluded)' : 'Estimated income tax refund (NI excluded)')
          : (result.balanceDueOrRefund >= 0 ? 'Balance due to HMRC' : 'Refund due')}
        value={fmt(Math.abs(result.balanceDueOrRefund))}
        help={`Income tax due £${fmt(result.incomeTaxDue)} + High Income Child Benefit Charge £${fmt(result.highIncomeChildBenefitCharge)} − tax already deducted at source £${fmt(result.taxDeductedAtSource)} = ${result.balanceDueOrRefund < 0 ? 'refund' : 'balance due'} £${fmt(Math.abs(result.balanceDueOrRefund))}.`}
        strong
      />
    </div>
  )
}
