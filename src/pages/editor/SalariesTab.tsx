import { useEffect, useMemo, useRef, useState } from 'react'
import MonthGrid, { type CellUpdate, type GridRow } from '../../components/MonthGrid'
import { monthLabels } from '../../lib/months'
import { supabase } from '../../lib/supabase'
import { monthsOf, monthCols, type BudgetCtx } from '../../hooks/useBudget'
import { fmt, parseAmount } from '../../lib/format'
import type { Employee, Team } from '../../lib/types'

interface EmpLine {
  id: number
  employee_id: number
  kind: 'salary' | 'cellphone'
  account_id: number
  months: number[]
}

export default function SalariesTab({ budget }: { budget: BudgetCtx }) {
  const { cycle, cc, accounts, canEdit, latestActualIdx } = budget
  const salaryAccounts = useMemo(() => accounts.filter((a) => a.input_type === 'salary'), [accounts])
  const cellAccounts = useMemo(() => accounts.filter((a) => a.input_type === 'cellphone'), [accounts])
  const accById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [lines, setLines] = useState<EmpLine[]>([])
  const [memberships, setMemberships] = useState<Map<number, number>>(new Map()) // employee -> team
  const [teams, setTeams] = useState<Team[]>([])
  const [loaded, setLoaded] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // imported cellphone billing — a reference only, never part of the budget
  const [cellBill, setCellBill] = useState<Map<number, number>>(new Map())
  const [unbilled, setUnbilled] = useState<{ cell_no: string; billed_name: string; amount: number }[]>([])
  const [billPeriod, setBillPeriod] = useState<string | null>(null)
  // add-employee form
  const [fName, setFName] = useState('')
  const [fTitle, setFTitle] = useState('')
  const [fSalAcc, setFSalAcc] = useState('')
  const [fSalary, setFSalary] = useState('')
  const [fCell, setFCell] = useState('')
  const pending = useRef(new Map<number, number[]>())
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  async function reload() {
    if (!cycle || !cc) return
    const { data: emps } = await supabase
      .from('budget_employees').select('*')
      .eq('cycle_id', cycle.id).eq('cost_centre_id', cc.id).eq('active', true).order('name')
    const empRows = (emps as Employee[]) ?? []
    setEmployees(empRows)
    const ids = empRows.map((e) => e.id!)
    if (ids.length) {
      const [l, tm] = await Promise.all([
        supabase.from('budget_employee_lines').select('*').in('employee_id', ids),
        supabase.from('budget_team_members').select('*').in('employee_id', ids),
      ])
      setLines(((l.data ?? []) as Record<string, unknown>[]).map((r) => ({
        id: r.id as number,
        employee_id: r.employee_id as number,
        kind: r.kind as 'salary' | 'cellphone',
        account_id: r.account_id as number,
        months: monthsOf(r),
      })))
      setMemberships(new Map((tm.data ?? []).map((m) => [m.employee_id as number, m.team_id as number])))
    } else {
      setLines([])
      setMemberships(new Map())
    }
    const { data: t } = await supabase
      .from('budget_teams').select('*').eq('cost_centre_id', cc.id).eq('active', true).order('name')
    setTeams((t as Team[]) ?? [])

    // latest imported cellphone billing for this cost centre
    const { data: bill } = await supabase
      .from('budget_cellphones').select('employee_id, cell_no, billed_name, amount, period')
      .eq('cost_centre_id', cc.id).order('period', { ascending: false })
    const rowsBill = (bill ?? []) as Record<string, unknown>[]
    const latest = rowsBill.length ? (rowsBill[0].period as string) : null
    setBillPeriod(latest)
    const byEmp = new Map<number, number>()
    const loose: { cell_no: string; billed_name: string; amount: number }[] = []
    for (const r of rowsBill.filter((r) => r.period === latest)) {
      const amt = Number(r.amount) || 0
      if (r.employee_id) byEmp.set(r.employee_id as number, (byEmp.get(r.employee_id as number) ?? 0) + amt)
      else loose.push({ cell_no: r.cell_no as string, billed_name: r.billed_name as string, amount: amt })
    }
    setCellBill(byEmp)
    setUnbilled(loose.sort((a, b) => b.amount - a.amount))
    setLoaded(true)
  }

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cycle?.id, cc?.id])

  if (!cycle || !cc) return null
  if (!loaded) return <div className="text-slate-500">Loading employees…</div>

  function flush() {
    const batch = [...pending.current.entries()]
    pending.current.clear()
    for (const [id, months] of batch) {
      void supabase.from('budget_employee_lines').update(monthCols(months)).eq('id', id)
        .then(({ error }) => error && setErr(error.message))
    }
  }

  function onChange(updates: CellUpdate[]) {
    setLines((prev) => {
      const next = prev.map((l) => ({ ...l }))
      for (const u of updates) {
        const line = next.find((l) => `l${l.id}` === u.rowKey)
        if (!line) continue
        line.months = [...line.months]
        line.months[u.monthIdx] = u.value
        pending.current.set(line.id, line.months)
      }
      return next
    })
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(flush, 600)
  }

  async function addEmployee() {
    setErr(null)
    if (!fName.trim() || !fSalAcc) {
      setErr('Employee name and salary account are required.')
      return
    }
    const { data: emp, error } = await supabase
      .from('budget_employees')
      .insert({ cycle_id: cycle!.id, cost_centre_id: cc!.id, name: fName.trim(), title: fTitle.trim(), is_new: true })
      .select()
      .single()
    if (error || !emp) { setErr(error?.message ?? 'Insert failed'); return }
    const salary = parseAmount(fSalary) ?? 0
    const inserts = [{
      employee_id: emp.id, kind: 'salary', account_id: Number(fSalAcc),
      ...monthCols(Array(12).fill(-Math.abs(salary))),
    }] as Record<string, unknown>[]
    if (fCell.trim()) {
      const cell = parseAmount(fCell) ?? 0
      const cellAcc = cellAccountForCategory(catSuffix(accById.get(Number(fSalAcc))?.name ?? ''))
      if (cellAcc) {
        inserts.push({
          employee_id: emp.id, kind: 'cellphone', account_id: cellAcc,
          ...monthCols(Array(12).fill(-Math.abs(cell))),
        })
      }
    }
    const { error: e2 } = await supabase.from('budget_employee_lines').insert(inserts)
    if (e2) setErr(e2.message)
    setFName(''); setFTitle(''); setFSalary(''); setFCell('')
    await reload()
  }

  async function removeEmployee(emp: Employee) {
    if (!window.confirm(`Remove ${emp.name} from this budget?`)) return
    const { error } = await supabase.from('budget_employees').delete().eq('id', emp.id!)
    if (error) setErr(error.message)
    else await reload()
  }

  async function setLineAccount(lineId: number, accountId: number) {
    const { error } = await supabase.from('budget_employee_lines').update({ account_id: accountId }).eq('id', lineId)
    if (error) { setErr(error.message); return }
    setLines((prev) => prev.map((l) => (l.id === lineId ? { ...l, account_id: accountId } : l)))
    // when a salary account changes, re-link that employee's cell phone to the matching category
    const salLine = lines.find((l) => l.id === lineId && l.kind === 'salary')
    if (!salLine) return
    const cellId = cellAccountForCategory(catSuffix(accById.get(accountId)?.name ?? ''))
    const cellLine = lines.find((l) => l.employee_id === salLine.employee_id && l.kind === 'cellphone')
    if (cellLine && cellId && cellId !== cellLine.account_id) {
      await supabase.from('budget_employee_lines').update({ account_id: cellId }).eq('id', cellLine.id)
      setLines((prev) => prev.map((l) => (l.id === cellLine.id ? { ...l, account_id: cellId } : l)))
    }
  }

  async function setTeam(employeeId: number, teamIdStr: string) {
    setErr(null)
    await supabase.from('budget_team_members').delete().eq('employee_id', employeeId)
    if (teamIdStr) {
      const { error } = await supabase.from('budget_team_members')
        .insert({ team_id: Number(teamIdStr), employee_id: employeeId })
      if (error) setErr(error.message)
    }
    setMemberships((prev) => {
      const next = new Map(prev)
      if (teamIdStr) next.set(employeeId, Number(teamIdStr))
      else next.delete(employeeId)
      return next
    })
  }

  async function addCellLine(emp: Employee) {
    const accId = cellAccountFor(emp)
    if (!accId) return
    const { error } = await supabase.from('budget_employee_lines').insert({
      employee_id: emp.id, kind: 'cellphone', account_id: accId,
    })
    if (error) setErr(error.message)
    else await reload()
  }

  function accountSelect(line: EmpLine, options: typeof salaryAccounts) {
    // include the line's current account even if it isn't a salary/cell account
    // (e.g. managed-services staff posted to Consulting Fees) so it displays.
    const current = accounts.find((a) => a.id === line.account_id)
    const opts = current && !options.some((a) => a.id === current.id) ? [...options, current] : options
    return (
      <select
        value={line.account_id}
        disabled={!canEdit}
        onChange={(e) => void setLineAccount(line.id, Number(e.target.value))}
        onMouseDown={(e) => e.stopPropagation()}
        className="max-w-36 rounded border border-slate-200 px-1 py-0.5 text-[11px] text-slate-500"
      >
        {opts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
    )
  }

  // Category = suffix of an account name, e.g. "Salaries VIP - Ops Cabling" ->
  // "Ops Cabling", "Consulting Fees - Admin" -> "Admin".
  const catSuffix = (name: string) => {
    const i = name.lastIndexOf(' - ')
    return i >= 0 ? name.slice(i + 3) : name
  }
  const categoryOf = (emp: Employee): string => {
    const line = lines.find((l) => l.kind === 'salary' && l.employee_id === emp.id)
    const acc = line ? accById.get(line.account_id) : undefined
    return acc ? catSuffix(acc.name) : 'Unassigned'
  }
  // Cell phone GL account is auto-linked to the employee's category (e.g. Ops
  // Cabling -> Cell Phones - Ops Cabling), matched by account-name suffix.
  const cellAccountForCategory = (cat: string) =>
    cellAccounts.find((a) => catSuffix(a.name) === cat)?.id ?? cellAccounts[0]?.id
  const cellAccountFor = (emp: Employee) => cellAccountForCategory(categoryOf(emp))
  // "2026-06-01" -> "Jun 26"
  const billLabel = billPeriod
    ? `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(billPeriod.slice(5, 7)) - 1]} ${billPeriod.slice(2, 4)}`
    : ''
  const CATEGORY_ORDER = ['Ops Cabling', 'Sales', 'Admin', 'Ops Admin', 'Exec']
  const salaryGroups = (() => {
    const g = new Map<string, Employee[]>()
    for (const emp of employees) {
      const c = categoryOf(emp)
      ;(g.get(c) ?? g.set(c, []).get(c)!).push(emp)
    }
    return [...g.entries()].sort(([a], [b]) => {
      const ia = CATEGORY_ORDER.indexOf(a), ib = CATEGORY_ORDER.indexOf(b)
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b)
    })
  })()

  function gridFor(kind: 'salary' | 'cellphone', emps: Employee[] = employees, totalLabel = 'Total'): GridRow[] {
    const opts = kind === 'salary' ? salaryAccounts : cellAccounts
    const rows: GridRow[] = []
    const totals = Array(12).fill(0) as number[]
    // billed cellphone cost shown as a cost, like the other actuals columns
    let billTotal = 0
    const billed = (emp: Employee) => {
      if (kind !== 'cellphone') return undefined
      const v = cellBill.get(emp.id!)
      if (!v) return [null]
      billTotal += v
      return [-v]
    }
    for (const emp of emps) {
      const line = lines.find((l) => l.employee_id === emp.id && l.kind === kind)
      if (!line) {
        if (kind === 'cellphone' && canEdit) {
          rows.push({
            key: `nocell${emp.id}`,
            label: (
              <span className="inline-flex items-center gap-2 text-slate-400">
                {emp.name}
                <button onClick={() => void addCellLine(emp)} className="rounded border border-slate-300 px-1.5 text-[11px] hover:bg-sky-50">
                  + add cell phone
                </button>
              </span>
            ),
            display: null, readOnly: true, kind: 'input', context: billed(emp),
          })
        }
        continue
      }
      line.months.forEach((v, i) => (totals[i] += v))
      rows.push({
        key: `l${line.id}`,
        label: (
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            {canEdit && kind === 'salary' && (
              <button onClick={() => void removeEmployee(emp)} title="Remove employee" className="text-red-400 hover:text-red-600">✕</button>
            )}
            <span className="font-medium">{emp.name}</span>
            {emp.title && <span className="text-slate-400">{emp.title}</span>}
            {emp.is_new && <span className="rounded bg-green-100 px-1 text-[10px] font-semibold text-green-700">NEW</span>}
            {kind === 'salary' ? (
              accountSelect(line, opts)
            ) : (
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500" title="Auto-linked to the employee’s category">
                {accById.get(line.account_id)?.name ?? '—'}
              </span>
            )}
            {kind === 'salary' && (
              <select
                value={memberships.get(emp.id!) ?? ''}
                disabled={!canEdit}
                onChange={(e) => void setTeam(emp.id!, e.target.value)}
                onMouseDown={(e) => e.stopPropagation()}
                className="max-w-24 rounded border border-slate-200 px-1 py-0.5 text-[11px] text-slate-500"
                title="Revenue team"
              >
                <option value="">no team</option>
                {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            )}
          </span>
        ),
        values: line.months,
        costRow: true,
        context: billed(emp),
      })
    }
    rows.push({
      key: `tot_${kind}`, label: totalLabel, display: totals, kind: 'subtotal', readOnly: true,
      context: kind === 'cellphone' ? [billTotal ? -billTotal : null] : undefined,
    })
    return rows
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-500">
        Salaries and cell phone costs are budgeted per employee. Enter positive amounts (e.g. 35 000) — the system
        records them as costs. Totals feed the matching statement lines per department account.
      </p>
      {err && <p className="text-sm text-red-600">{err}</p>}
      {canEdit && (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-white p-3">
          <div>
            <label className="block text-xs font-medium text-slate-500">Name</label>
            <input value={fName} onChange={(e) => setFName(e.target.value)} className="w-40 rounded border border-slate-300 px-2 py-1 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500">Title</label>
            <input value={fTitle} onChange={(e) => setFTitle(e.target.value)} className="w-36 rounded border border-slate-300 px-2 py-1 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500">Salary account</label>
            <select value={fSalAcc} onChange={(e) => setFSalAcc(e.target.value)} className="rounded border border-slate-300 px-2 py-1 text-sm">
              <option value="">choose…</option>
              {salaryAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500">Salary / month</label>
            <input value={fSalary} onChange={(e) => setFSalary(e.target.value)} placeholder="35000" className="w-24 rounded border border-slate-300 px-2 py-1 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500">Cell / month</label>
            <input value={fCell} onChange={(e) => setFCell(e.target.value)} placeholder="600" className="w-20 rounded border border-slate-300 px-2 py-1 text-sm" />
            <p className="mt-0.5 text-[10px] text-slate-400">account auto-set by category</p>
          </div>
          <button onClick={() => void addEmployee()} className="rounded-md bg-sky-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700">
            Add employee
          </button>
        </div>
      )}
      <div className="space-y-5">
        <h3 className="text-sm font-semibold text-sky-950">Salaries by category</h3>
        {salaryGroups.map(([cat, emps]) => (
          <div key={cat}>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              {cat} <span className="text-slate-400">· {emps.length}</span>
            </h4>
            <MonthGrid
              rows={gridFor('salary', emps, `Total ${cat}`)}
              monthHeaders={monthLabels(cycle.fy_year)}
              labelHeader="Employee"
              labelWidth="17rem"
              readOnly={!canEdit}
              latestActualIdx={latestActualIdx}
              onChange={onChange}
            />
          </div>
        ))}
        {!employees.length && <p className="text-sm text-slate-400">No employees yet.</p>}
      </div>
      <div>
        <h3 className="mb-1 text-sm font-semibold text-sky-950">Cell Phones</h3>
        {billPeriod && (
          <p className="mb-1 text-xs text-slate-500">
            The <b>{billLabel}</b> column is the actual Vodacom cost (excl. VAT) for that month, matched to each
            employee — for reference while budgeting.
          </p>
        )}
        <MonthGrid
          rows={gridFor('cellphone')}
          monthHeaders={monthLabels(cycle.fy_year)}
          contextHeaders={billPeriod ? [billLabel] : []}
          labelHeader="Employee"
          labelWidth="17rem"
          readOnly={!canEdit}
          latestActualIdx={latestActualIdx}
          onChange={onChange}
        />
        {unbilled.length > 0 && (
          <div className="mt-2 rounded-lg border border-slate-200 bg-white p-3">
            <p className="mb-1 text-xs font-semibold text-slate-600">
              Cellphones not matched to an employee · {unbilled.length} ·{' '}
              {fmt(unbilled.reduce((s, u) => s + u.amount, 0))}
            </p>
            <div className="max-h-52 overflow-auto">
              <table className="w-full text-xs">
                <tbody>
                  {unbilled.map((u) => (
                    <tr key={u.cell_no} className="border-b border-slate-100">
                      <td className="py-0.5 pr-2 text-slate-400">{u.cell_no}</td>
                      <td className="py-0.5 pr-2">{u.billed_name}</td>
                      <td className="num-cell py-0.5">{fmt(u.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
