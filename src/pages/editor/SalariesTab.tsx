import { useEffect, useMemo, useRef, useState } from 'react'
import MonthGrid, { type CellUpdate, type GridRow } from '../../components/MonthGrid'
import { monthLabels } from '../../lib/months'
import { supabase } from '../../lib/supabase'
import { monthsOf, monthCols, type BudgetCtx } from '../../hooks/useBudget'
import { parseAmount } from '../../lib/format'
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
  const [employees, setEmployees] = useState<Employee[]>([])
  const [lines, setLines] = useState<EmpLine[]>([])
  const [memberships, setMemberships] = useState<Map<number, number>>(new Map()) // employee -> team
  const [teams, setTeams] = useState<Team[]>([])
  const [loaded, setLoaded] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // add-employee form
  const [fName, setFName] = useState('')
  const [fTitle, setFTitle] = useState('')
  const [fSalAcc, setFSalAcc] = useState('')
  const [fSalary, setFSalary] = useState('')
  const [fCellAcc, setFCellAcc] = useState('')
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
    if (fCellAcc) {
      const cell = parseAmount(fCell) ?? 0
      inserts.push({
        employee_id: emp.id, kind: 'cellphone', account_id: Number(fCellAcc),
        ...monthCols(Array(12).fill(-Math.abs(cell))),
      })
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
    if (error) setErr(error.message)
    setLines((prev) => prev.map((l) => (l.id === lineId ? { ...l, account_id: accountId } : l)))
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
    if (!cellAccounts.length) return
    const { error } = await supabase.from('budget_employee_lines').insert({
      employee_id: emp.id, kind: 'cellphone', account_id: cellAccounts[0].id,
    })
    if (error) setErr(error.message)
    else await reload()
  }

  function accountSelect(line: EmpLine, options: typeof salaryAccounts) {
    return (
      <select
        value={line.account_id}
        disabled={!canEdit}
        onChange={(e) => void setLineAccount(line.id, Number(e.target.value))}
        onMouseDown={(e) => e.stopPropagation()}
        className="max-w-44 rounded border border-slate-200 px-1 py-0.5 text-[11px] text-slate-500"
      >
        {options.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
    )
  }

  function gridFor(kind: 'salary' | 'cellphone'): GridRow[] {
    const opts = kind === 'salary' ? salaryAccounts : cellAccounts
    const rows: GridRow[] = []
    const totals = Array(12).fill(0) as number[]
    for (const emp of employees) {
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
            display: null, readOnly: true, kind: 'input',
          })
        }
        continue
      }
      line.months.forEach((v, i) => (totals[i] += v))
      rows.push({
        key: `l${line.id}`,
        label: (
          <span className="inline-flex items-center gap-2">
            {canEdit && kind === 'salary' && (
              <button onClick={() => void removeEmployee(emp)} title="Remove employee" className="text-red-400 hover:text-red-600">✕</button>
            )}
            <span className="font-medium">{emp.name}</span>
            {emp.title && <span className="text-slate-400">{emp.title}</span>}
            {emp.is_new && <span className="rounded bg-green-100 px-1 text-[10px] font-semibold text-green-700">NEW</span>}
            {accountSelect(line, opts)}
            {kind === 'salary' && (
              <select
                value={memberships.get(emp.id!) ?? ''}
                disabled={!canEdit}
                onChange={(e) => void setTeam(emp.id!, e.target.value)}
                onMouseDown={(e) => e.stopPropagation()}
                className="max-w-28 rounded border border-slate-200 px-1 py-0.5 text-[11px] text-slate-500"
                title="Revenue team"
              >
                <option value="">no team</option>
                {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            )}
          </span>
        ),
        values: line.months,
      })
    }
    rows.push({ key: `tot_${kind}`, label: 'Total', display: totals, kind: 'subtotal', readOnly: true })
    return rows
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-500">
        Salaries and cell phone costs are budgeted per employee (amounts are costs — enter negatives, e.g. -35 000).
        Totals feed the matching statement lines per department account.
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
            <label className="block text-xs font-medium text-slate-500">Cell account (optional)</label>
            <select value={fCellAcc} onChange={(e) => setFCellAcc(e.target.value)} className="rounded border border-slate-300 px-2 py-1 text-sm">
              <option value="">none</option>
              {cellAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500">Cell / month</label>
            <input value={fCell} onChange={(e) => setFCell(e.target.value)} placeholder="600" className="w-20 rounded border border-slate-300 px-2 py-1 text-sm" />
          </div>
          <button onClick={() => void addEmployee()} className="rounded-md bg-sky-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700">
            Add employee
          </button>
        </div>
      )}
      <div>
        <h3 className="mb-1 text-sm font-semibold text-sky-950">Salaries</h3>
        <MonthGrid
          rows={gridFor('salary')}
          monthHeaders={monthLabels(cycle.fy_year)}
          labelHeader="Employee"
          readOnly={!canEdit}
          latestActualIdx={latestActualIdx}
          onChange={onChange}
        />
      </div>
      <div>
        <h3 className="mb-1 text-sm font-semibold text-sky-950">Cell Phones</h3>
        <MonthGrid
          rows={gridFor('cellphone')}
          monthHeaders={monthLabels(cycle.fy_year)}
          labelHeader="Employee"
          readOnly={!canEdit}
          latestActualIdx={latestActualIdx}
          onChange={onChange}
        />
      </div>
    </div>
  )
}
