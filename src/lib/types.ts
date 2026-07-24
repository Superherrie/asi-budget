import type { MonthValues } from './months'

export interface Profile {
  user_id: string
  email: string
  full_name: string
  is_admin: boolean
  /** true when the password was set for them and must be changed before continuing. */
  must_change_password: boolean
}

export type CcRole = 'compiler' | 'approver'

export interface CostCentre {
  id: number
  code: string
  name: string
  type: 'branch' | 'admin'
  active: boolean
}

export interface Assignment {
  id: number
  user_id: string
  cost_centre_id: number
  role: CcRole
}

export interface Cycle {
  id: number
  name: string
  fy_year: number
  status: 'open' | 'closed'
}

export type AccountSection =
  | 'sales'
  | 'cos_material'
  | 'cos_ops_cabling'
  | 'selling'
  | 'ioh_admin'
  | 'ioh_exec'
  | 'ioh_operating'
  | 'ioh_facilities_it'
  | 'ioh_facilities_premises'
  | 'ioh_marketing'
  | 'ioh_training'
  | 'ioh_statutory'
  | 'ioh_other'
  | 'ho_fees'
  | 'rti_depreciation'
  | 'exceptional'
  | 'finance'

export type InputType = 'direct' | 'revenue' | 'salary' | 'cellphone' | 'vehicle' | 'material_pct' | 'training' | 'ho_alloc' | 'subcontractor' | 'rti' | 'internal_sales'

export interface Account {
  id: number
  code: string
  name: string
  section: AccountSection
  sort_order: number
  input_type: InputType
  /** false = shown on the statement (with history) but cannot be budgeted. */
  budgetable: boolean
}

export interface BudgetLine extends Partial<MonthValues> {
  id?: number
  cycle_id: number
  cost_centre_id: number
  account_id: number
}

export interface ActualLine extends Partial<MonthValues> {
  id?: number
  fy_year: number
  cost_centre_id: number
  account_id: number
}

export interface Employee {
  id?: number
  cycle_id: number
  cost_centre_id: number
  name: string
  title: string
  is_new: boolean
  active: boolean
}

export interface EmployeeLine extends Partial<MonthValues> {
  id?: number
  employee_id: number
  kind: 'salary' | 'cellphone'
  account_id: number
}

export interface Vehicle {
  id?: number
  cost_centre_id: number
  registration: string
  description: string
  active: boolean
  /** Cost category (Ops Cabling / Sales / Admin / Ops Admin / Exec) — picks the M/V accounts. */
  category: string
}

export interface VehicleLine extends Partial<MonthValues> {
  id?: number
  cycle_id: number
  vehicle_id: number
  account_id: number
}

export interface Team {
  id?: number
  cost_centre_id: number
  name: string
}

export interface Customer {
  id?: number
  cost_centre_id: number
  name: string
}

export interface RevenueLine extends Partial<MonthValues> {
  id?: number
  cycle_id: number
  cost_centre_id: number
  team_id: number | null
  customer_id: number | null
  account_id: number
  /** Annual material-cost rate for this line, as a percentage of its revenue. */
  material_pct: number
}

export interface TrainingLine {
  id?: number
  cycle_id: number
  cost_centre_id: number
  employee_id: number | null
  kind: 'normal' | 'health_safety'
  provider: string
  month: number // 1 = July
  amount: number // positive cost
}

/** Allocation of the team-budgeted revenue total to customers (does not feed the GL). */
export interface RevenueCustomerLine extends Partial<MonthValues> {
  id?: number
  cycle_id: number
  cost_centre_id: number
  customer_id: number
}

export interface SubcontractorLine extends Partial<MonthValues> {
  id?: number
  cycle_id: number
  cost_centre_id: number
  name: string
  kind: 'electrical' | 'data' | 'civils'
}

export type ApprovalStatus = 'draft' | 'submitted' | 'approved' | 'rejected'

export interface Approval {
  id?: number
  cycle_id: number
  cost_centre_id: number
  status: ApprovalStatus
  submitted_by: string | null
  submitted_at: string | null
  decided_by: string | null
  decided_at: string | null
  comment: string | null
}
