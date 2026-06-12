import type { Account, AccountSection } from './types'

// Builds the ASI income statement layout from the chart of accounts and a set
// of 12-month value arrays per account. Mirrors the workbook structure:
// Sales -> COS -> GP -> Selling (DOH) -> GOP -> IOH -> EBITDA -> HO fees ->
// EBITDA after HO Fees -> RTI/Depr -> EBIT -> Exceptional -> Finance -> PBT.

export type StmtKind = 'section' | 'account' | 'subtotal' | 'computed' | 'pct'

export interface StmtLine {
  key: string
  label: string
  kind: StmtKind
  account?: Account
  months: number[] // length 12; for pct rows these are ratios
  indent: number
}

const Z = () => Array(12).fill(0) as number[]

function add(a: number[], b: number[] | undefined): number[] {
  if (!b) return a
  return a.map((v, i) => v + (b[i] ?? 0))
}

const IOH_GROUPS: [AccountSection, string][] = [
  ['ioh_admin', 'Admin'],
  ['ioh_exec', 'Exec'],
  ['ioh_operating', 'Operating'],
  ['ioh_facilities_it', 'Facilities / IT'],
  ['ioh_facilities_premises', 'Facilities / Premises'],
  ['ioh_marketing', 'Adv & Marketing'],
  ['ioh_training', 'Training'],
  ['ioh_statutory', 'Statutory'],
  ['ioh_other', 'Other'],
]

export function computeStatement(
  accounts: Account[],
  values: Map<number, number[]>,
): StmtLine[] {
  const lines: StmtLine[] = []
  const bySection = new Map<AccountSection, Account[]>()
  for (const a of [...accounts].sort((x, y) => x.sort_order - y.sort_order)) {
    const arr = bySection.get(a.section) ?? []
    arr.push(a)
    bySection.set(a.section, arr)
  }

  const val = (a: Account) => values.get(a.id) ?? Z()

  function emitAccounts(section: AccountSection, indent: number): number[] {
    let total = Z()
    for (const a of bySection.get(section) ?? []) {
      const m = val(a)
      lines.push({ key: `a${a.id}`, label: a.name, kind: 'account', account: a, months: m, indent })
      total = add(total, m)
    }
    return total
  }

  function section(label: string, key: string) {
    lines.push({ key, label, kind: 'section', months: Z(), indent: 0 })
  }
  function subtotal(label: string, key: string, months: number[], indent = 0, kind: StmtKind = 'subtotal') {
    lines.push({ key, label, kind, months, indent })
    return months
  }
  function pct(label: string, key: string, num: number[], den: number[]) {
    const months = num.map((v, i) => (den[i] ? v / den[i] : 0))
    lines.push({ key, label, kind: 'pct', months, indent: 0 })
  }

  // Sales
  section('Sales', 's_sales')
  const totalSales = emitAccounts('sales', 1)
  subtotal('TOTAL SALES', 't_sales', totalSales)

  // COS
  section('Cost of Sales', 's_cos')
  lines.push({ key: 's_cos_mat', label: 'Material Cost', kind: 'section', months: Z(), indent: 1 })
  const mat = emitAccounts('cos_material', 2)
  subtotal('Total Material Cost', 't_mat', mat, 1)
  lines.push({ key: 's_cos_ops', label: 'Ops Cabling Cost', kind: 'section', months: Z(), indent: 1 })
  const ops = emitAccounts('cos_ops_cabling', 2)
  subtotal('Total Ops Cabling Cost', 't_ops', ops, 1)
  const totalCos = subtotal('Total COS', 't_cos', add([...mat], ops))

  // GP
  const gp = subtotal('Gross Profit', 't_gp', add([...totalSales], totalCos), 0, 'computed')
  pct('GP %', 'p_gp', gp, totalSales)

  // Selling expenses (DOH)
  section('Selling Expenses', 's_sell')
  const doh = emitAccounts('selling', 1)
  subtotal('Total DOH', 't_doh', doh)
  const gop = subtotal('Gross Operating Profit', 't_gop', add([...gp], doh), 0, 'computed')
  pct('GOP %', 'p_gop', gop, totalSales)

  // Indirect overheads
  section('Indirect Overheads', 's_ioh')
  let ioh = Z()
  for (const [sec, label] of IOH_GROUPS) {
    if (!(bySection.get(sec) ?? []).length) continue
    lines.push({ key: `s_${sec}`, label, kind: 'section', months: Z(), indent: 1 })
    const g = emitAccounts(sec, 2)
    subtotal(`Total ${label}`, `t_${sec}`, g, 1)
    ioh = add(ioh, g)
  }
  subtotal('Total IOH', 't_ioh', ioh)

  // EBITDA and below
  const ebitda = subtotal('EBITDA', 't_ebitda', add([...gop], ioh), 0, 'computed')
  pct('EBITDA %', 'p_ebitda', ebitda, totalSales)

  const hoFees = emitAccounts('ho_fees', 1)
  const ebitdaHo = subtotal('EBITDA after HO Fees', 't_ebitda_ho', add([...ebitda], hoFees), 0, 'computed')

  const rtiDep = emitAccounts('rti_depreciation', 1)
  const ebit = subtotal('EBIT', 't_ebit', add([...ebitdaHo], rtiDep), 0, 'computed')

  const exc = emitAccounts('exceptional', 1)
  subtotal('Exceptional Items', 't_exc', exc)

  const fin = emitAccounts('finance', 1)
  subtotal('Finance Cost', 't_fin', fin)

  const pbt = subtotal('PBT', 't_pbt', add(add([...ebit], exc), fin), 0, 'computed')
  pct('PBT %', 'p_pbt', pbt, totalSales)

  return lines
}

export function yearTotal(months: number[]): number {
  return months.reduce((s, v) => s + v, 0)
}
