import type { TaxReturnData, TaxYearRates, ComputationResult, ReliefFlag } from '../types'

export function checkReliefs(
  data: TaxReturnData,
  rates: TaxYearRates,
  result: ComputationResult
): ReliefFlag[] {
  const flags: ReliefFlag[] = []
  const push = (f: ReliefFlag) => flags.push(f)

  // ---- The £100k–£125,140 band: effectively a ~60% marginal rate --------------
  if (result.adjustedNetIncome > rates.taperThreshold && result.adjustedNetIncome < rates.taperFullyGoneAt) {
    push({
      id: 'pa-taper-band',
      severity: 'action',
      title: 'You\u2019re in the personal allowance taper band',
      detail:
        'Adjusted net income between £100,000 and £125,140 loses £1 of Personal Allowance for every £2 earned — an effective marginal rate around 60%. Extra pension contributions or Gift Aid here reduce adjusted net income directly, which restores allowance as well as saving tax at your marginal rate.',
    })
  } else if (result.personalAllowanceAvailable === 0) {
    push({
      id: 'pa-gone',
      severity: 'info',
      title: 'Personal Allowance fully withdrawn',
      detail:
        'Adjusted net income is at or above £125,140, so the Personal Allowance is nil. Pension contributions and Gift Aid still extend your rate bands and reduce adjusted net income for things like the Child Benefit charge, even though they can\u2019t restore an allowance that\u2019s already gone.',
    })
  }

  // ---- Marriage Allowance -------------------------------------------------------
  if (data.personal.maritalStatus === 'married' || data.personal.maritalStatus === 'civilPartnership') {
    push({
      id: 'marriage-allowance',
      severity: 'check',
      title: 'Check Marriage Allowance eligibility',
      detail:
        `This workbook doesn't know your spouse's income, so it hasn't applied this automatically. If your spouse or civil partner earns less than £${rates.personalAllowance.toLocaleString()} and you're not an additional-rate taxpayer, they may be able to transfer £${rates.marriageAllowanceTransferable.toLocaleString()} of unused allowance to you, worth up to £${Math.round(rates.marriageAllowanceTransferable * rates.rates.basic)} off your bill.`,
    })
  }

  // ---- Dividend and savings allowance headroom --------------------------------
  if (result.totalDividendIncome > 0 && result.totalDividendIncome <= rates.dividendAllowance) {
    push({
      id: 'dividend-under-allowance',
      severity: 'info',
      title: 'Dividends are within the tax-free allowance',
      detail: `Your £${result.totalDividendIncome.toLocaleString()} of dividends sits under the £${rates.dividendAllowance.toLocaleString()} dividend allowance for ${rates.label}, so none of it is taxed.`,
    })
  }
  if (result.totalSavingsIncome > 0 || result.totalDividendIncome > 0) {
    push({
      id: 'isa-headroom',
      severity: 'check',
      title: 'Consider ISA headroom for next year',
      detail:
        'Interest and dividends held outside an ISA are taxable once allowances are used up. Moving savings/investments into an ISA (£20,000 annual allowance) shelters future income and gains from this entirely — worth reviewing before 5 April.',
    })
  }

  // ---- Gift Aid reminder ---------------------------------------------------------
  if (data.reliefs.giftAidNet === 0) {
    push({
      id: 'gift-aid-check',
      severity: 'check',
      title: 'Any Gift Aid donations to declare?',
      detail:
        'None recorded. If you donated to a UK charity or CASC as a taxpayer and ticked (or could tick) Gift Aid, it\u2019s worth checking your records — for a higher/additional-rate taxpayer this extends the basic and higher rate bands and can generate a refund.',
    })
  }

  // ---- Pension contributions & annual allowance --------------------------------
  const grossPension = data.reliefs.personalPensionContributionsNet / 0.8
  if (grossPension > 0 && result.adjustedNetIncome + grossPension > 200000) {
    push({
      id: 'pension-taper-check',
      severity: 'check',
      title: 'Check the tapered Annual Allowance',
      detail:
        'Your income is high enough that the pension Annual Allowance may be tapered (down to a minimum of £10,000 once adjusted income exceeds £260,000). If contributions are near or above £60,000 gross, it\u2019s worth confirming you\u2019re not facing an Annual Allowance charge.',
    })
  } else if (grossPension === 0) {
    push({
      id: 'pension-none',
      severity: 'info',
      title: 'No pension contributions recorded',
      detail: `The Annual Allowance for ${rates.label} is £${rates.pensionAnnualAllowance.toLocaleString()}. Unused allowance from the last 3 years can sometimes be carried forward if you want to shelter a bonus or one-off income spike.`,
    })
  }

  // ---- High Income Child Benefit Charge -----------------------------------------
  if (data.personal.claimsChildBenefit) {
    if (result.highIncomeChildBenefitCharge > 0 && result.highIncomeChildBenefitCharge < data.personal.childBenefitAnnualAmount) {
      push({
        id: 'hicbc-partial',
        severity: 'info',
        title: 'Partial High Income Child Benefit Charge applies',
        detail: `At an adjusted net income of £${result.adjustedNetIncome.toLocaleString()}, the charge claws back £${result.highIncomeChildBenefitCharge.toLocaleString()} of the £${data.personal.childBenefitAnnualAmount.toLocaleString()} Child Benefit received.`,
      })
    } else if (result.highIncomeChildBenefitCharge >= data.personal.childBenefitAnnualAmount && data.personal.childBenefitAnnualAmount > 0) {
      push({
        id: 'hicbc-full',
        severity: 'check',
        title: 'Child Benefit charge claws back the full amount',
        detail:
          'Adjusted net income is £80,000 or more, so the charge equals all the Child Benefit received. Some people still choose to claim (rather than opt out) to protect National Insurance credits and their child\u2019s future NI number — worth checking this still suits you.',
      })
    }
  } else if (data.personal.numberOfChildren > 0) {
    push({
      id: 'hicbc-not-claiming',
      severity: 'check',
      title: 'Not claiming Child Benefit?',
      detail:
        'If a lower-earning partner isn\u2019t working, claiming Child Benefit (even if it\u2019s later clawed back through this charge) can protect their State Pension National Insurance record.',
    })
  }

  // ---- Jointly-owned property --------------------------------------------------------
  data.properties.filter((p) => !p.name.startsWith('Unallocated')).forEach((p) => {
    if (p.ownershipShare !== 1 && p.ownershipShare !== 0.5) {
      push({
        id: `property-split-${p.id}`,
        severity: 'check',
        title: `Confirm the ownership split on ${p.name || 'this property'}`,
        detail: `You've entered a ${(p.ownershipShare * 100).toFixed(0)}% share. Jointly-owned property is normally split 50/50 between spouses for tax by default — an unequal split needs the actual beneficial ownership to match (and for married couples/civil partners, a Form 17 election on file with HMRC), or HMRC can challenge it.`,
      })
    }
    if (p.ownershipShare === 0.5) {
      push({
        id: `property-joint-${p.id}`,
        severity: 'info',
        title: `${p.name || 'Property'} is being split 50/50`,
        detail: 'Make sure your co-owner\u2019s return reports the matching other half of income, expenses, and finance costs — HMRC can and does cross-check this.',
      })
    }
    const income = p.rentalIncome * p.ownershipShare
    if (income > 0 && income <= rates.propertyIncomeAllowance) {
      push({
        id: `property-allowance-${p.id}`,
        severity: 'check',
        title: `Small lettings allowance may beat itemising on ${p.name || 'this property'}`,
        detail: `Your share of rental income is under the £${rates.propertyIncomeAllowance.toLocaleString()} property income allowance. Claiming that flat allowance instead of actual expenses might leave you better off — worth a quick comparison (you can't claim finance cost relief on top of it though).`,
      })
    }
  })
  if (result.financeCostReducer < (data.properties.filter((p) => !p.name.startsWith('Unallocated'))
    .reduce((s, p) => s + p.mortgageInterest * p.ownershipShare, 0) * rates.propertyFinanceCostReducerRate) - 0.01) {
    push({
      id: 'finance-cost-capped',
      severity: 'check',
      title: 'Finance cost relief may be restricted',
      detail:
        'Your property profit is lower than your finance costs, so the 20% mortgage interest tax reducer has been capped in this computation. Any unused relief can normally be carried forward to a year when property profits are higher — worth keeping a note of the carried-forward amount.',
    })
  }

  // ---- Scottish taxpayer note ---------------------------------------------------
  if (data.personal.isScottishTaxpayer) {
    push({
      id: 'scottish-rates',
      severity: 'action',
      title: 'Scottish rates aren\u2019t modelled here yet',
      detail:
        'This workbook currently uses UK-wide (England/Wales/NI) bands for non-savings, non-dividend income. As a Scottish taxpayer your employment and pension income is taxed under separate Scottish bands (starter/basic/intermediate/higher/advanced/top) — savings and dividend income still use UK-wide rates. Treat the non-savings figures here as indicative only.',
    })
  }

  // ---- Student loan reminder ------------------------------------------------------
  if (data.personal.hasStudentLoan) {
    push({
      id: 'student-loan',
      severity: 'check',
      title: 'Student loan repayment not calculated here yet',
      detail: `Plan ${data.personal.studentLoanPlan} repayments are 9% of income above the relevant threshold (postgraduate loans: 6%). If you have both employment and property/self-employment income, remember HMRC calculates any shortfall on the non-PAYE income through Self Assessment on top of what your employer deducted.`,
    })
  }

  // ---- Evergreen reminders lifted straight from a typical accountant's checklist ----
  push({
    id: 'evergreen-disposals',
    severity: 'info',
    title: 'Disposed of any assets this year?',
    detail: 'Shares, a second property, crypto, or anything else sold at a gain may need reporting for Capital Gains Tax even if no tax is ultimately due — the annual exempt amount for ' + rates.label + ` is £${rates.cgtAnnualExemptAmount.toLocaleString()}.`,
  })
  push({
    id: 'evergreen-foreign',
    severity: 'info',
    title: 'Any foreign income?',
    detail: 'Foreign bank interest, dividends, or rental income is generally taxable in the UK too, though a Double Taxation Treaty may give credit for foreign tax already paid.',
  })
  push({
    id: 'evergreen-trusts',
    severity: 'info',
    title: 'Beneficiary of a trust?',
    detail: 'Income from a trust (form R185) is taxable in the year it\u2019s received, with tax already deducted at the trust rate in some cases — worth checking if you\u2019re due a refund of any excess.',
  })

  return flags
}
