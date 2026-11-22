// ---- Personal details --------------------------------------------------

export type MaritalStatus = 'single' | 'married' | 'civilPartnership' | 'divorced' | 'widowed'

export interface PersonalDetails {
  name: string
  maritalStatus: MaritalStatus
  isScottishTaxpayer: boolean
  isBlind: boolean
  numberOfChildren: number
  claimsChildBenefit: boolean
  childBenefitAnnualAmount: number // total for all children, per year
  hasStudentLoan: boolean
  studentLoanPlan: 'plan1' | 'plan2' | 'plan4' | 'postgrad' | 'none'
}

// ---- Income entry --------------------------------------------------

export interface EmploymentIncome {
  id: string
  employer: string
  p60Pay: number
  taxDeducted: number
  benefitsInKind: number // from P11D
  p60Source?: { id: string; fileName: string; verified: boolean }
}

export interface PropertyExpenseEvidence {
  id: string
  source: string
  row: number
  date: string
  description: string
  amount: number
  allowableAmount: number
  treatment: 'runningCost' | 'review' | 'interest' | 'repayment'
  reason: string
}

export interface PropertyRentalIncomeEvidence {
  id: string
  source: string
  description: string
  date: string
  amount: number
  treatment: 'added' | 'alreadyIncluded'
  basis?: 'rentLabel' | 'flatDescription' | 'unclassifiedIncome'
}

export interface PropertyLet {
  id: string
  name: string
  ownershipShare: number // 0-1, e.g. 0.5 for a 50/50 joint let
  rentalIncome: number
  allowableExpenses: number // everything EXCEPT mortgage/finance interest
  mortgageInterest: number  // finance costs — relieved as a 20% tax reducer, not a deduction
  interestOnlyMortgage?: boolean // payments are all interest, so mortgageInterest follows the recorded mortgage payments
  documentSources?: string[]
  documentNote?: string
  documentVerified?: boolean
  bankEvidence?: { label: string; incoming: number; outgoing: number; kind: 'mortgage' | 'possibleRent'; includedInRent?: boolean }[]
  rentalIncomeEvidence?: PropertyRentalIncomeEvidence[]
  expenseEvidence?: PropertyExpenseEvidence[]
  expenseReconciliation?: number // unexplained difference, excluded from tax
}

export interface SavingsInterest {
  id: string
  source: string
  amount: number
  bankSource?: BankSource
}

export interface DividendIncome {
  id: string
  source: string
  amount: number
  bankSource?: BankSource
}

export interface PensionIncome {
  id: string
  source: string // "State pension", "Final salary scheme" etc
  amount: number
  taxDeducted: number
}

export interface OtherIncome {
  id: string
  description: string
  amount: number
  bankSource?: BankSource
}

export interface BankSource {
  id: string
  taxYearId: string
  fileName: string
  recordedAmount: number
  evidence: string
  verified: boolean
  groupKey?: string
}

export interface BankReliefCandidate {
  kind: 'pensionContribution' | 'giftAid'
  source: BankSource
  claimedAmount: number
}

export interface Reliefs {
  personalPensionContributionsNet: number // relief-at-source contributions, NET amount you actually paid
  giftAidNet: number // net amount you actually donated
}

export interface TaxReturnData {
  taxYearId: string
  personal: PersonalDetails
  employments: EmploymentIncome[]
  properties: PropertyLet[]
  savings: SavingsInterest[]
  dividends: DividendIncome[]
  pensions: PensionIncome[]
  other: OtherIncome[]
  reliefs: Reliefs
  personalSources?: Partial<Record<keyof PersonalDetails, string>>
  bankReliefCandidates?: BankReliefCandidate[]
  privatePensionRecipients?: string[]
  charitableDonationRecipients?: string[]
}

// ---- Tax year rules --------------------------------------------------

export interface TaxYearRates {
  id: string
  label: string
  personalAllowance: number
  taperThreshold: number // income above this starts to withdraw the PA
  taperFullyGoneAt: number // total income at which PA reaches zero (nominal)
  basicRateLimit: number // width of the basic rate band
  additionalRateThresholdNominal: number // e.g. 125,140 — nominal total-income point additional rate starts
  rates: { basic: number; higher: number; additional: number }
  dividendAllowance: number
  dividendRates: { basic: number; higher: number; additional: number }
  personalSavingsAllowance: { basic: number; higher: number; additional: number }
  startingRateForSavingsBand: number // £5,000 band at 0%, only usable if non-savings income is low
  marriageAllowanceTransferable: number
  propertyFinanceCostReducerRate: number // 20%
  pensionAnnualAllowance: number
  cgtAnnualExemptAmount: number
  propertyIncomeAllowance: number // £1,000 — alternative to itemised expenses for small lettings
}

// ---- Computation output --------------------------------------------------

export interface BandBreakdown {
  band: 'basic' | 'higher' | 'additional' | 'nil' | 'startingRate' | 'psa' | 'dividendAllowance'
  amount: number
  rate: number
  tax: number
}

export interface ComputationResult {
  totalNonSavingsIncome: number
  totalSavingsIncome: number
  totalDividendIncome: number
  totalIncome: number

  extension: number // grossed-up pension + gift aid, extends the bands
  adjustedNetIncome: number
  personalAllowanceTaper: number
  personalAllowanceAvailable: number

  nonSavingsTaxable: number
  savingsTaxable: number
  dividendsTaxable: number

  nonSavingsBands: BandBreakdown[]
  savingsBands: BandBreakdown[]
  dividendBands: BandBreakdown[]

  incomeTaxBeforeReducers: number
  financeCostReducer: number
  marriageAllowanceReducer: number
  incomeTaxDue: number

  taxDeductedAtSource: number
  balanceDueOrRefund: number // positive = owed to HMRC, negative = refund

  highIncomeChildBenefitCharge: number
}

export interface ReliefFlag {
  id: string
  severity: 'info' | 'check' | 'action'
  title: string
  detail: string
}
