import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import MonthGrid, { type CellUpdate, type GridRow } from '../../components/MonthGrid'
import { computeStatement } from '../../lib/statement'
import { monthLabels } from '../../lib/months'
import { supabase } from '../../lib/supabase'
import { monthsOf, monthCols, type BudgetCtx } from '../../hooks/useBudget'
import type { Account } from '../../lib/types'

/** Yearly figures per statement line, computed by running the statement over
 *  single-slot values so pct rows become total ratios. */
function totalsByLine(accounts: Account[], values: Map<number, number[]> | undefined) {
  const m = new Map<number, number[]>()
  for (const [id, months] of values ?? []) {
    m.set(id, [months.reduce((s, v) => s + v, 0), ...Array(11).fill(0)])
  }
  const out = new Map<string, number>()
  for (const line of computeStatement(accounts, m)) out.set(line.key, line.months[0])
  return out
}

const detailTab: Record<string, { path: string; label: string }> = {
  revenue: { path: 'revenue', label: 'Revenue' },
  salary: { path: 'salaries', label: 'Salaries' },
  cellphone: { path: 'salaries', label: 'Salaries & Cell Phones' },
  vehicle: { path: 'vehicles', label: 'Vehicles' },
  material_pct: { path: 'revenue', label: 'Revenue (% of sales)' },
  training: { path: 'training', label: 'Staff Training' },
  subcontractor: { path: 'subcontractors', label: 'Subcontractors' },
}

/** Accounts computed by the system — never entered by hand. */
const AUTO_NOTE: Record<string, string> = {
  ho_alloc: 'Head Office allocation',
  rti: 'auto — 3% of total revenue',
}

const Z12 = Array(12).fill(0) as number[]

export default function StatementTab({ budget }: { budget: BudgetCtx }) {
  const { cycle, cc, accounts, actuals, canEdit, latestActualIdx } = budget
  const [direct, setDirect] = useState<Map<number, number[]>>(new Map())
  // Per account: the part of the statement value contributed by detail tables
  // (salaries / vehicles / revenue / material %), i.e. view total minus the
  // directly-typed budget_lines. Lets a "direct" account (e.g. Consulting Fees)
  // still absorb per-employee detail and stay consistent with the company view.
  const [detailAdd, setDetailAdd] = useState<Map<number, number[]>>(new Map())
  const [loaded, setLoaded] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const pendingSaves = useRef(new Map<number, number[]>())
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!cycle || !cc) return
    void (async () => {
      const [linesRes, viewRes] = await Promise.all([
        supabase.from('budget_lines').select('*').eq('cycle_id', cycle.id).eq('cost_centre_id', cc.id),
        supabase.from('budget_statement_lines').select('*').eq('cycle_id', cycle.id).eq('cost_centre_id', cc.id),
      ])
      const d = new Map<number, number[]>()
      for (const row of linesRes.data ?? []) d.set(row.account_id as number, monthsOf(row))
      const add = new Map<number, number[]>()
      for (const row of viewRes.data ?? []) {
        const id = row.account_id as number
        const view = monthsOf(row)
        const dv = d.get(id) ?? Z12
        add.set(id, view.map((v, i) => v - (dv[i] ?? 0)))
      }
      setDirect(d)
      setDetailAdd(add)
      setLoaded(true)
    })()
  }, [cycle, cc])

  const merged = useMemo(() => {
    const ids = new Set<number>([...direct.keys(), ...detailAdd.keys()])
    const m = new Map<number, number[]>()
    for (const id of ids) {
      const dv = direct.get(id) ?? Z12
      const av = detailAdd.get(id) ?? Z12
      m.set(id, dv.map((v, i) => v + (av[i] ?? 0)))
    }
    return m
  }, [direct, detailAdd])
  const stmt = useMemo(() => computeStatement(accounts, merged), [accounts, merged])
  const ctx25 = useMemo(() => totalsByLine(accounts, actuals.get(2025)), [accounts, actuals])
  const ctx26 = useMemo(() => totalsByLine(accounts, actuals.get(2026)), [accounts, actuals])
  const fy26 = actuals.get(2026)

  function flushSaves() {
    if (!cycle || !cc) return
    const batch = [...pendingSaves.current.entries()]
    pendingSaves.current.clear()
    if (!batch.length) return
    setSaveState('saving')
    void supabase
      .from('budget_lines')
      .upsert(
        batch.map(([accountId, months]) => ({
          cycle_id: cycle.id,
          cost_centre_id: cc.id,
          account_id: accountId,
          ...monthCols(months),
        })),
        { onConflict: 'cycle_id,cost_centre_id,account_id' },
      )
      .then(({ error }) => setSaveState(error ? 'error' : 'saved'))
  }

  function onChange(updates: CellUpdate[]) {
    setDirect((prev) => {
      const next = new Map(prev)
      for (const u of updates) {
        const accountId = Number(u.rowKey.slice(1))
        const months = [...(next.get(accountId) ?? Array(12).fill(0))]
        months[u.monthIdx] = u.value
        next.set(accountId, months)
        pendingSaves.current.set(accountId, months)
      }
      return next
    })
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(flushSaves, 600)
  }

  if (!cycle || !cc) return null
  if (!loaded) return <div className="text-slate-500">Loading statement…</div>

  const rows: GridRow[] = stmt.map((line) => {
    const base = {
      key: line.key,
      indent: line.indent,
      kind: line.kind === 'account' ? ('input' as const) : line.kind,
      context: [ctx25.get(line.key) ?? null, ctx26.get(line.key) ?? null],
    }
    if (line.kind === 'account' && line.account) {
      const acc = line.account
      if (!acc.budgetable) {
        // shown with its history, but no budget may be captured against it
        return {
          ...base,
          label: <span>{acc.name} <span className="text-slate-400">(not budgeted)</span></span>,
          display: line.months,
          readOnly: true,
          kind: 'computed' as const,
        }
      }
      if (acc.input_type === 'direct') {
        const add = detailAdd.get(acc.id)
        const hasDetail = !!add && add.some((v) => Math.abs(v) > 0.005)
        if (!hasDetail) {
          return {
            ...base,
            label: acc.name,
            values: line.months,
            fillBasis: fy26?.get(acc.id) ?? Array(12).fill(0),
            costRow: acc.section !== 'sales',
          }
        }
        // direct account fed by per-employee detail (e.g. Consulting Fees) — read-only
        return {
          ...base,
          label: (
            <span>
              {acc.name}{' '}
              <Link to={`/cc/${cc.code}/salaries`} className="text-sky-600 underline decoration-dotted">
                incl. staff ↗
              </Link>
            </span>
          ),
          display: line.months,
          readOnly: true,
          kind: 'computed' as const,
        }
      }
      // auto-calculated accounts: no manual entry, shown read-only with a note
      const autoNote = AUTO_NOTE[acc.input_type]
      if (autoNote) {
        return {
          ...base,
          label: <span>{acc.name} <span className="text-slate-400">({autoNote})</span></span>,
          display: line.months,
          readOnly: true,
          kind: 'computed' as const,
        }
      }
      const tab = detailTab[acc.input_type]
      return {
        ...base,
        label: (
          <span>
            {acc.name}{' '}
            <Link to={`/cc/${cc.code}/${tab.path}`} className="text-sky-600 underline decoration-dotted">
              from {tab.label} ↗
            </Link>
          </span>
        ),
        display: line.months,
        readOnly: true,
        kind: 'computed' as const,
      }
    }
    return { ...base, label: line.label, display: line.months, readOnly: true }
  })

  return (
    <div>
      <MonthGrid
        rows={rows}
        monthHeaders={monthLabels(cycle.fy_year)}
        contextHeaders={['FY25 Act', 'FY26 Act']}
        labelHeader={`${cycle.name} Budget (R)`}
        readOnly={!canEdit}
        latestActualIdx={latestActualIdx}
        onChange={onChange}
        toolbarExtra={
          <span className={`text-xs ${saveState === 'error' ? 'text-red-600' : 'text-slate-400'}`}>
            {saveState === 'saving' && 'Saving…'}
            {saveState === 'saved' && 'All changes saved'}
            {saveState === 'error' && 'Save failed — check your access'}
          </span>
        }
      />
    </div>
  )
}
