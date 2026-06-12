import { useEffect, useMemo, useRef, useState } from 'react'
import MonthGrid, { type CellUpdate, type GridRow } from '../../components/MonthGrid'
import { monthLabels } from '../../lib/months'
import { supabase } from '../../lib/supabase'
import { monthsOf, monthCols, type BudgetCtx } from '../../hooks/useBudget'
import type { Customer, Team } from '../../lib/types'

interface RevLine {
  id: number
  team_id: number | null
  customer_id: number | null
  months: number[]
}

export default function RevenueTab({ budget }: { budget: BudgetCtx }) {
  const { cycle, cc, accounts, canEdit, actuals, latestActualIdx } = budget
  const salesAccount = accounts.find((a) => a.input_type === 'revenue')
  const [teams, setTeams] = useState<Team[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [lines, setLines] = useState<RevLine[]>([])
  const [loaded, setLoaded] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [newTeam, setNewTeam] = useState('')
  const [newCustomer, setNewCustomer] = useState('')
  const [addTeamId, setAddTeamId] = useState('')
  const [addCustomerId, setAddCustomerId] = useState('')
  const [showManage, setShowManage] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef(new Map<number, number[]>())

  async function reload() {
    if (!cycle || !cc || !salesAccount) return
    const [t, c, l] = await Promise.all([
      supabase.from('budget_teams').select('*').eq('cost_centre_id', cc.id).eq('active', true).order('name'),
      supabase.from('budget_customers').select('*').eq('cost_centre_id', cc.id).eq('active', true).order('name'),
      supabase.from('budget_revenue_lines').select('*').eq('cycle_id', cycle.id).eq('cost_centre_id', cc.id),
    ])
    setTeams((t.data as Team[]) ?? [])
    setCustomers((c.data as Customer[]) ?? [])
    setLines(
      ((l.data ?? []) as Record<string, unknown>[]).map((r) => ({
        id: r.id as number,
        team_id: r.team_id as number | null,
        customer_id: r.customer_id as number | null,
        months: monthsOf(r),
      })),
    )
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

  function flush() {
    const batch = [...pending.current.entries()]
    pending.current.clear()
    for (const [id, months] of batch) {
      void supabase.from('budget_revenue_lines').update(monthCols(months)).eq('id', id)
        .then(({ error }) => error && setErr(error.message))
    }
  }

  function onChange(updates: CellUpdate[]) {
    setLines((prev) => {
      const next = prev.map((l) => ({ ...l }))
      for (const u of updates) {
        const line = next.find((l) => `r${l.id}` === u.rowKey)
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

  async function addLine() {
    setErr(null)
    const team_id = addTeamId ? Number(addTeamId) : null
    const customer_id = addCustomerId ? Number(addCustomerId) : null
    if (lines.some((l) => l.team_id === team_id && l.customer_id === customer_id)) {
      setErr('A line for that team & customer already exists.')
      return
    }
    const { error } = await supabase.from('budget_revenue_lines').insert({
      cycle_id: cycle!.id,
      cost_centre_id: cc!.id,
      account_id: salesAccount!.id,
      team_id,
      customer_id,
    })
    if (error) setErr(error.message)
    else await reload()
  }

  async function removeLine(id: number) {
    if (!window.confirm('Remove this revenue line?')) return
    const { error } = await supabase.from('budget_revenue_lines').delete().eq('id', id)
    if (error) setErr(error.message)
    else setLines((prev) => prev.filter((l) => l.id !== id))
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

  const sorted = [...lines].sort((a, b) => {
    const ta = teamName.get(a.team_id ?? -1) ?? '~'
    const tb = teamName.get(b.team_id ?? -1) ?? '~'
    if (ta !== tb) return ta.localeCompare(tb)
    return (customerName.get(a.customer_id ?? -1) ?? '~').localeCompare(customerName.get(b.customer_id ?? -1) ?? '~')
  })

  const totals = Array(12).fill(0) as number[]
  for (const l of lines) l.months.forEach((v, i) => (totals[i] += v))

  const rows: GridRow[] = [
    ...sorted.map((l) => ({
      key: `r${l.id}`,
      label: (
        <span className="inline-flex items-center gap-2">
          {canEdit && (
            <button onClick={() => void removeLine(l.id)} title="Remove line" className="text-red-400 hover:text-red-600">✕</button>
          )}
          <span className="font-medium">{teamName.get(l.team_id ?? -1) ?? 'Unassigned team'}</span>
          <span className="text-slate-400">·</span>
          <span>{customerName.get(l.customer_id ?? -1) ?? 'General / other'}</span>
        </span>
      ),
      values: l.months,
    })),
    {
      key: 'total',
      label: `Total Sales → statement line ${salesAccount.code}`,
      display: totals,
      kind: 'subtotal' as const,
      readOnly: true,
      context: [
        (actuals.get(2025)?.get(salesAccount.id) ?? []).reduce((s, v) => s + v, 0) || null,
        (actuals.get(2026)?.get(salesAccount.id) ?? []).reduce((s, v) => s + v, 0) || null,
      ],
    },
  ]

  return (
    <div>
      <p className="mb-2 text-sm text-slate-500">
        Budget revenue per <b>team</b> and <b>customer</b>. The total feeds the Sales line of the income statement.
        History context: FY26 Sales actuals total {`R${Math.round((actuals.get(2026)?.get(salesAccount.id) ?? []).reduce((s, v) => s + v, 0)).toLocaleString('en-ZA')}`}.
      </p>
      {err && <p className="mb-2 text-sm text-red-600">{err}</p>}
      {canEdit && (
        <div className="mb-3 flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-white p-3">
          <div>
            <label className="block text-xs font-medium text-slate-500">Team</label>
            <select value={addTeamId} onChange={(e) => setAddTeamId(e.target.value)} className="rounded border border-slate-300 px-2 py-1 text-sm">
              <option value="">Unassigned team</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500">Customer</label>
            <select value={addCustomerId} onChange={(e) => setAddCustomerId(e.target.value)} className="rounded border border-slate-300 px-2 py-1 text-sm">
              <option value="">General / other</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <button onClick={() => void addLine()} className="rounded-md bg-sky-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700">
            Add revenue line
          </button>
          <button onClick={() => setShowManage((s) => !s)} className="ml-auto rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50">
            {showManage ? 'Hide' : 'Manage'} teams &amp; customers
          </button>
        </div>
      )}
      {showManage && canEdit && (
        <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-2">
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
            <p className="mt-1 text-xs text-slate-400">Assign team members on the Salaries tab.</p>
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
      <MonthGrid
        rows={rows}
        monthHeaders={monthLabels(cycle.fy_year)}
        contextHeaders={['FY25 Act', 'FY26 Act']}
        labelHeader="Team · Customer"
        readOnly={!canEdit}
        latestActualIdx={latestActualIdx}
        onChange={onChange}
      />
    </div>
  )
}
