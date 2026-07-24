import { useEffect, useMemo, useRef, useState } from 'react'
import MonthGrid, { type CellUpdate, type GridRow } from '../../components/MonthGrid'
import { monthLabels } from '../../lib/months'
import { fmt } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import { monthsOf, monthCols, type BudgetCtx } from '../../hooks/useBudget'
import type { Customer, Team } from '../../lib/types'

interface TeamLine {
  id: number
  team_id: number | null
  months: number[]
  material_pct: number
}

interface CustLine {
  id: number
  customer_id: number
  months: number[]
}

const Z = () => Array(12).fill(0) as number[]

export default function RevenueTab({ budget }: { budget: BudgetCtx }) {
  const { cycle, cc, accounts, canEdit, latestActualIdx } = budget
  const salesAccount = accounts.find((a) => a.input_type === 'revenue')
  const materialAccount = accounts.find((a) => a.input_type === 'material_pct')
  const [teams, setTeams] = useState<Team[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [teamLines, setTeamLines] = useState<TeamLine[]>([])
  const [custLines, setCustLines] = useState<CustLine[]>([])
  const [loaded, setLoaded] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [newTeam, setNewTeam] = useState('')
  const [newCustomer, setNewCustomer] = useState('')
  const [addTeamId, setAddTeamId] = useState('')
  const [addCustomerId, setAddCustomerId] = useState('')
  const [showManage, setShowManage] = useState(false)
  const pendingTeam = useRef(new Map<number, number[]>())
  const pendingCust = useRef(new Map<number, number[]>())
  const teamTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const custTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  async function reload() {
    if (!cycle || !cc || !salesAccount) return
    const [t, c, tl, cl] = await Promise.all([
      supabase.from('budget_teams').select('*').eq('cost_centre_id', cc.id).eq('active', true).order('name'),
      // shared (cost_centre_id null) + this branch's own customers
      supabase.from('budget_customers').select('*')
        .or(`cost_centre_id.is.null,cost_centre_id.eq.${cc.id}`).eq('active', true).order('name'),
      supabase.from('budget_revenue_lines').select('*').eq('cycle_id', cycle.id).eq('cost_centre_id', cc.id),
      supabase.from('budget_revenue_customer_lines').select('*').eq('cycle_id', cycle.id).eq('cost_centre_id', cc.id),
    ])
    setTeams((t.data as Team[]) ?? [])
    setCustomers((c.data as Customer[]) ?? [])
    setTeamLines(((tl.data ?? []) as Record<string, unknown>[]).map((r) => ({
      id: r.id as number,
      team_id: r.team_id as number | null,
      months: monthsOf(r),
      material_pct: Number(r.material_pct) || 0,
    })))
    setCustLines(((cl.data ?? []) as Record<string, unknown>[]).map((r) => ({
      id: r.id as number,
      customer_id: r.customer_id as number,
      months: monthsOf(r),
    })))
    setLoaded(true)
  }

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cycle?.id, cc?.id])

  const teamName = useMemo(() => new Map(teams.map((t) => [t.id!, t.name])), [teams])
  const customerName = useMemo(() => new Map(customers.map((c) => [c.id!, c.name])), [customers])

  if (!cycle || !cc) return null
  if (!salesAccount) return <div className="text-red-600">No revenue account configured.</div>
  if (!loaded) return <div className="text-slate-500">Loading revenue…</div>

  function flushTeam() {
    const batch = [...pendingTeam.current.entries()]
    pendingTeam.current.clear()
    for (const [id, months] of batch) {
      void supabase.from('budget_revenue_lines').update(monthCols(months)).eq('id', id)
        .then(({ error }) => error && setErr(error.message))
    }
  }

  function flushCust() {
    const batch = [...pendingCust.current.entries()]
    pendingCust.current.clear()
    for (const [id, months] of batch) {
      void supabase.from('budget_revenue_customer_lines').update(monthCols(months)).eq('id', id)
        .then(({ error }) => error && setErr(error.message))
    }
  }

  function onChangeTeam(updates: CellUpdate[]) {
    setTeamLines((prev) => {
      const next = prev.map((l) => ({ ...l }))
      for (const u of updates) {
        const line = next.find((l) => `t${l.id}` === u.rowKey)
        if (!line) continue
        line.months = [...line.months]
        line.months[u.monthIdx] = u.value
        pendingTeam.current.set(line.id, line.months)
      }
      return next
    })
    if (teamTimer.current) clearTimeout(teamTimer.current)
    teamTimer.current = setTimeout(flushTeam, 600)
  }

  function onChangeCust(updates: CellUpdate[]) {
    setCustLines((prev) => {
      const next = prev.map((l) => ({ ...l }))
      for (const u of updates) {
        const line = next.find((l) => `c${l.id}` === u.rowKey)
        if (!line) continue
        line.months = [...line.months]
        line.months[u.monthIdx] = u.value
        pendingCust.current.set(line.id, line.months)
      }
      return next
    })
    if (custTimer.current) clearTimeout(custTimer.current)
    custTimer.current = setTimeout(flushCust, 600)
  }

  function setMatPct(id: number, pct: number) {
    setTeamLines((prev) => prev.map((l) => (l.id === id ? { ...l, material_pct: pct } : l)))
  }

  async function persistMatPct(id: number, pct: number) {
    const { error } = await supabase.from('budget_revenue_lines').update({ material_pct: pct }).eq('id', id)
    if (error) setErr(error.message)
  }

  async function addTeamLine() {
    setErr(null)
    const team_id = addTeamId ? Number(addTeamId) : null
    if (teamLines.some((l) => l.team_id === team_id)) {
      setErr('That team already has a revenue line.')
      return
    }
    const { error } = await supabase.from('budget_revenue_lines').insert({
      cycle_id: cycle!.id, cost_centre_id: cc!.id, account_id: salesAccount!.id, team_id, customer_id: null,
    })
    if (error) setErr(error.message)
    else await reload()
  }

  async function addCustomerLine() {
    setErr(null)
    if (!addCustomerId) { setErr('Choose a customer.'); return }
    const customer_id = Number(addCustomerId)
    if (custLines.some((l) => l.customer_id === customer_id)) {
      setErr('That customer already has an allocation line.')
      return
    }
    const { error } = await supabase.from('budget_revenue_customer_lines').insert({
      cycle_id: cycle!.id, cost_centre_id: cc!.id, customer_id,
    })
    if (error) setErr(error.message)
    else await reload()
  }

  async function removeTeamLine(id: number) {
    if (!window.confirm('Remove this team revenue line?')) return
    const { error } = await supabase.from('budget_revenue_lines').delete().eq('id', id)
    if (error) setErr(error.message)
    else setTeamLines((prev) => prev.filter((l) => l.id !== id))
  }

  async function removeCustomerLine(id: number) {
    if (!window.confirm('Remove this customer allocation?')) return
    const { error } = await supabase.from('budget_revenue_customer_lines').delete().eq('id', id)
    if (error) setErr(error.message)
    else setCustLines((prev) => prev.filter((l) => l.id !== id))
  }

  async function addTeam() {
    if (!newTeam.trim()) return
    const { error } = await supabase.from('budget_teams').insert({ cost_centre_id: cc!.id, name: newTeam.trim() })
    if (error) setErr(error.message)
    setNewTeam('')
    await reload()
  }

  async function addCustomer() {
    if (!newCustomer.trim()) return
    const { error } = await supabase.from('budget_customers').insert({ cost_centre_id: cc!.id, name: newCustomer.trim() })
    if (error) setErr(error.message)
    setNewCustomer('')
    await reload()
  }

  // ---- totals -------------------------------------------------------------
  const sortedTeams = [...teamLines].sort((a, b) =>
    (teamName.get(a.team_id ?? -1) ?? '~').localeCompare(teamName.get(b.team_id ?? -1) ?? '~'))
  const sortedCusts = [...custLines].sort((a, b) =>
    (customerName.get(a.customer_id) ?? '~').localeCompare(customerName.get(b.customer_id) ?? '~'))

  const teamTotals = Z()
  for (const l of teamLines) l.months.forEach((v, i) => (teamTotals[i] += v))
  const allocated = Z()
  for (const l of custLines) l.months.forEach((v, i) => (allocated[i] += v))
  const other = teamTotals.map((v, i) => v - allocated[i])
  const overAllocated = other.some((v) => v < -0.005)

  // ---- table 1: by team ---------------------------------------------------
  const teamRows: GridRow[] = [
    ...sortedTeams.map((l) => ({
      key: `t${l.id}`,
      label: (
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          {canEdit && (
            <button onClick={() => void removeTeamLine(l.id)} title="Remove line" className="text-red-400 hover:text-red-600">✕</button>
          )}
          <span className="font-medium">{teamName.get(l.team_id ?? -1) ?? 'Unassigned team'}</span>
        </span>
      ),
      values: l.months,
    })),
    {
      key: 'team_total',
      label: `TOTAL revenue → ${salesAccount.name}`,
      display: teamTotals,
      kind: 'subtotal' as const,
      readOnly: true,
    },
  ]

  // ---- table 2: allocation by customer ------------------------------------
  const custRows: GridRow[] = [
    ...sortedCusts.map((l) => ({
      key: `c${l.id}`,
      label: (
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          {canEdit && (
            <button onClick={() => void removeCustomerLine(l.id)} title="Remove allocation" className="text-red-400 hover:text-red-600">✕</button>
          )}
          <span>{customerName.get(l.customer_id) ?? 'Unknown customer'}</span>
        </span>
      ),
      values: l.months,
    })),
    {
      key: 'other',
      label: 'Other (not yet allocated)',
      display: other,
      kind: 'computed' as const,
      readOnly: true,
    },
    {
      key: 'cust_total',
      label: 'TOTAL (must equal team total)',
      display: teamTotals,
      kind: 'subtotal' as const,
      readOnly: true,
    },
  ]

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-500">
        Budget revenue <b>by team</b> first — that sets the total that feeds the Sales line. Then allocate that
        total <b>to customers</b> below; whatever is not yet allocated shows as <b>Other</b>.
      </p>
      {err && <p className="text-sm text-red-600">{err}</p>}

      {canEdit && (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-white p-3">
          <div>
            <label className="block text-xs font-medium text-slate-500">Team</label>
            <select value={addTeamId} onChange={(e) => setAddTeamId(e.target.value)} className="rounded border border-slate-300 px-2 py-1 text-sm">
              <option value="">Unassigned team</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <button onClick={() => void addTeamLine()} className="rounded-md bg-sky-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700">
            Add team line
          </button>
          <span className="mx-2 h-8 w-px bg-slate-200" />
          <div>
            <label className="block text-xs font-medium text-slate-500">Customer</label>
            <select value={addCustomerId} onChange={(e) => setAddCustomerId(e.target.value)} className="rounded border border-slate-300 px-2 py-1 text-sm">
              <option value="">choose…</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <button onClick={() => void addCustomerLine()} className="rounded-md bg-sky-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700">
            Add customer allocation
          </button>
          <button onClick={() => setShowManage((s) => !s)} className="ml-auto rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50">
            {showManage ? 'Hide' : 'Manage'} teams &amp; customers
          </button>
        </div>
      )}

      {showManage && canEdit && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <h3 className="mb-2 text-sm font-semibold text-sky-950">Teams</h3>
            <ul className="mb-2 max-h-40 overflow-auto text-sm">
              {teams.map((t) => <li key={t.id} className="border-b border-slate-100 py-1">{t.name}</li>)}
              {!teams.length && <li className="py-1 text-slate-400">No teams yet</li>}
            </ul>
            <div className="flex gap-2">
              <input value={newTeam} onChange={(e) => setNewTeam(e.target.value)} placeholder="New team name"
                className="flex-1 rounded border border-slate-300 px-2 py-1 text-sm" />
              <button onClick={() => void addTeam()} className="rounded bg-sky-800 px-3 py-1 text-sm text-white">Add</button>
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <h3 className="mb-2 text-sm font-semibold text-sky-950">Customers</h3>
            <ul className="mb-2 max-h-40 overflow-auto text-sm">
              {customers.map((c) => <li key={c.id} className="border-b border-slate-100 py-1">{c.name}</li>)}
              {!customers.length && <li className="py-1 text-slate-400">No customers yet</li>}
            </ul>
            <div className="flex gap-2">
              <input value={newCustomer} onChange={(e) => setNewCustomer(e.target.value)} placeholder="New customer name"
                className="flex-1 rounded border border-slate-300 px-2 py-1 text-sm" />
              <button onClick={() => void addCustomer()} className="rounded bg-sky-800 px-3 py-1 text-sm text-white">Add</button>
            </div>
          </div>
        </div>
      )}

      <div>
        <h3 className="mb-1 text-sm font-semibold text-sky-950">1 · Revenue by team</h3>
        <MonthGrid
          rows={teamRows}
          monthHeaders={monthLabels(cycle.fy_year)}
          labelHeader="Team"
          readOnly={!canEdit}
          latestActualIdx={latestActualIdx}
          onChange={onChangeTeam}
        />
      </div>

      <div>
        <h3 className="mb-1 text-sm font-semibold text-sky-950">2 · Allocate to customers</h3>
        {overAllocated && (
          <p className="mb-1 text-xs text-red-600">
            Allocated to customers exceeds the team total in at least one month — “Other” has gone negative.
          </p>
        )}
        <MonthGrid
          rows={custRows}
          monthHeaders={monthLabels(cycle.fy_year)}
          labelHeader="Customer"
          readOnly={!canEdit}
          latestActualIdx={latestActualIdx}
          onChange={onChangeCust}
        />
      </div>

      {materialAccount && (
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <h3 className="text-sm font-semibold text-sky-950">Material cost (% of revenue)</h3>
          <p className="mb-2 text-sm text-slate-500">
            Set a material-cost rate per team. Each team’s material cost = its revenue × the rate, and the total
            posts to the statement’s <b>{materialAccount.name}</b> line ({materialAccount.code}).
          </p>
          <div className="overflow-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="bg-sky-950 text-white">
                  <th className="px-2 py-1.5 text-left font-medium">Team</th>
                  <th className="px-2 py-1.5 text-right font-medium">Annual Revenue</th>
                  <th className="px-2 py-1.5 text-right font-medium">Material %</th>
                  <th className="px-2 py-1.5 text-right font-medium">Material Cost</th>
                </tr>
              </thead>
              <tbody>
                {sortedTeams.map((l) => {
                  const annual = l.months.reduce((s, v) => s + v, 0)
                  return (
                    <tr key={`m${l.id}`} className="border-t border-slate-100">
                      <td className="whitespace-nowrap px-2 py-1 font-medium">
                        {teamName.get(l.team_id ?? -1) ?? 'Unassigned team'}
                      </td>
                      <td className="num-cell px-2 py-1">{fmt(annual)}</td>
                      <td className="num-cell px-2 py-1">
                        <input
                          type="number" min="0" step="0.1" disabled={!canEdit}
                          value={l.material_pct || ''} placeholder="0"
                          onChange={(e) => setMatPct(l.id, Number(e.target.value) || 0)}
                          onBlur={(e) => void persistMatPct(l.id, Number(e.target.value) || 0)}
                          className="w-20 rounded border border-slate-300 px-2 py-1 text-right disabled:bg-slate-50 disabled:text-slate-400"
                        />
                        <span className="ml-1 text-slate-400">%</span>
                      </td>
                      <td className="num-cell px-2 py-1 font-medium">{fmt((annual * l.material_pct) / 100)}</td>
                    </tr>
                  )
                })}
                {!sortedTeams.length && (
                  <tr><td colSpan={4} className="px-2 py-2 text-slate-400">Add team revenue lines above to set material-cost rates.</td></tr>
                )}
              </tbody>
              {sortedTeams.length > 0 && (
                <tfoot>
                  <tr className="border-t border-slate-300 bg-slate-100 font-semibold">
                    <td className="px-2 py-1">Total → {materialAccount.name}</td>
                    <td className="num-cell px-2 py-1">{fmt(teamTotals.reduce((s, v) => s + v, 0))}</td>
                    <td className="px-2 py-1" />
                    <td className="num-cell px-2 py-1">
                      {fmt(sortedTeams.reduce((s, l) => s + (l.months.reduce((a, v) => a + v, 0) * l.material_pct) / 100, 0))}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
