import type { PersonalDetails } from '../types'

export interface PersonalEvidence {
  patch: Partial<PersonalDetails>
  label: string
  evidence: string
}

export function extractPersonalEvidence(text: string): PersonalEvidence[] {
  const results: PersonalEvidence[] = []
  const add = (patch: Partial<PersonalDetails>, label: string, evidence: string) =>
    results.push({ patch, label, evidence })
  const lines = text.replace(/\u00a0/g, ' ').split(/\r?\n/).map((line) => line.trim())
  for (const line of lines) {
    const name = line.match(/^(?:employee(?:'s)? name|full name|taxpayer name|your name)\s*:\s*(.{2,100})$/i)
    if (name) add({ name: name[1].trim() }, 'Name', line)
    const marital = line.match(/^marital status\s*:\s*(single|married|civil partnership|divorced|widowed)$/i)
    if (marital) {
      const values: Record<string, PersonalDetails['maritalStatus']> = {
        single: 'single', married: 'married', 'civil partnership': 'civilPartnership',
        divorced: 'divorced', widowed: 'widowed',
      }
      add({ maritalStatus: values[marital[1].toLowerCase()] }, 'Marital status', line)
    }
    const booleanLabels: { pattern: RegExp; field: 'isScottishTaxpayer' | 'isBlind' | 'claimsChildBenefit' | 'hasStudentLoan'; label: string }[] = [
      { pattern: /^scottish taxpayer\s*:\s*(yes|no)$/i, field: 'isScottishTaxpayer', label: 'Scottish taxpayer' },
      { pattern: /^(?:registered blind|blind person's allowance eligible)\s*:\s*(yes|no)$/i, field: 'isBlind', label: 'Registered blind' },
      { pattern: /^(?:claiming|claims) child benefit\s*:\s*(yes|no)$/i, field: 'claimsChildBenefit', label: 'Claiming Child Benefit' },
      { pattern: /^(?:has|have a) student loan\s*:\s*(yes|no)$/i, field: 'hasStudentLoan', label: 'Student loan' },
    ]
    for (const rule of booleanLabels) {
      const match = line.match(rule.pattern)
      if (match) add({ [rule.field]: match[1].toLowerCase() === 'yes' }, rule.label, line)
    }
    const children = line.match(/^number of children\s*:\s*(\d{1,2})$/i)
    if (children) add({ numberOfChildren: Number(children[1]) }, 'Number of children', line)
    const benefit = line.match(/^(?:total child benefit received (?:this|for the) (?:tax )?year|annual child benefit received)\s*:\s*£?\s*(\d[\d,]*\.\d{2})$/i)
    if (benefit) add({ childBenefitAnnualAmount: Number(benefit[1].replace(/,/g, '')) }, 'Annual Child Benefit received', line)
    const plan = line.match(/^student loan plan\s*:\s*(?:plan\s*)?(1|2|4|postgraduate|none)$/i)
    if (plan) {
      const plans: Record<string, PersonalDetails['studentLoanPlan']> = {
        '1': 'plan1', '2': 'plan2', '4': 'plan4', postgraduate: 'postgrad', none: 'none',
      }
      add({ studentLoanPlan: plans[plan[1].toLowerCase()] }, 'Student loan plan', line)
    }
  }
  return results
}
