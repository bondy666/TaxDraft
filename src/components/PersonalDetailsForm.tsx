import type { PersonalDetails } from '../types'

interface Props {
  personal: PersonalDetails
  onChange: (patch: Partial<PersonalDetails>) => void
  sources?: Partial<Record<keyof PersonalDetails, string>>
}

export function PersonalDetailsForm({ personal, onChange, sources }: Props) {
  return (
    <div className="card">
      <h2>Personal details</h2>
      <p className="hint">Documents can propose explicit answers for review on the Documents tab. Unchecked boxes, zero amounts and default selections are not proof of an answer; confirm every field not supported by documentation.</p>
      {sources && Object.keys(sources).length > 0 && (
        <details>
          <summary>Document sources for imported personal details</summary>
          <ul>{Object.entries(sources).map(([field, source]) => <li key={field}>{field}: {source}</li>)}</ul>
        </details>
      )}
      <div className="form-grid">
        <label className="field">
          <span>Name</span>
          <input
            type="text"
            value={personal.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="Your name"
          />
        </label>

        <label className="field">
          <span>Marital status</span>
          <select
            value={personal.maritalStatus}
            onChange={(e) => onChange({ maritalStatus: e.target.value as PersonalDetails['maritalStatus'] })}
          >
            <option value="single">Single</option>
            <option value="married">Married</option>
            <option value="civilPartnership">Civil partnership</option>
            <option value="divorced">Divorced</option>
            <option value="widowed">Widowed</option>
          </select>
        </label>

        <label className="field checkbox">
          <input
            type="checkbox"
            checked={personal.isScottishTaxpayer}
            onChange={(e) => onChange({ isScottishTaxpayer: e.target.checked })}
          />
          <span>Scottish taxpayer</span>
        </label>

        <label className="field checkbox">
          <input
            type="checkbox"
            checked={personal.isBlind}
            onChange={(e) => onChange({ isBlind: e.target.checked })}
          />
          <span>Registered blind (Blind Person's Allowance)</span>
        </label>

        <label className="field">
          <span>Number of children</span>
          <input
            type="number"
            min={0}
            value={personal.numberOfChildren}
            onChange={(e) => onChange({ numberOfChildren: Number(e.target.value) })}
          />
        </label>

        <label className="field checkbox">
          <input
            type="checkbox"
            checked={personal.claimsChildBenefit}
            onChange={(e) => onChange({ claimsChildBenefit: e.target.checked })}
          />
          <span>Claiming Child Benefit</span>
        </label>

        {personal.claimsChildBenefit && (
          <label className="field">
            <span>Child Benefit received this year (£)</span>
            <input
              type="number"
              value={personal.childBenefitAnnualAmount}
              onChange={(e) => onChange({ childBenefitAnnualAmount: Number(e.target.value) })}
            />
          </label>
        )}

        <label className="field checkbox">
          <input
            type="checkbox"
            checked={personal.hasStudentLoan}
            onChange={(e) => onChange({ hasStudentLoan: e.target.checked })}
          />
          <span>Have a student loan</span>
        </label>

        {personal.hasStudentLoan && (
          <label className="field">
            <span>Plan</span>
            <select
              value={personal.studentLoanPlan}
              onChange={(e) => onChange({ studentLoanPlan: e.target.value as PersonalDetails['studentLoanPlan'] })}
            >
              <option value="plan1">Plan 1</option>
              <option value="plan2">Plan 2</option>
              <option value="plan4">Plan 4 (Scotland)</option>
              <option value="postgrad">Postgraduate loan</option>
            </select>
          </label>
        )}
      </div>
    </div>
  )
}
