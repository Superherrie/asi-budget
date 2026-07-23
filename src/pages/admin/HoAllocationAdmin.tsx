import { useEffect, useRef, useState } from 'react'
import MonthGrid, { type CellUpdate, type GridRow } from '../../components/MonthGrid'
import { monthLabels, monthLabel } from '../../lib/months'
import { monthsOf, monthCols } from '../../hooks/useBudget'
import { supabase } from '../../lib/supabase'
import type { CostCentre, Cycle } from '../../lib/types'

export default function HoAllocationAdmin() {
  const [cycle, setCycle] = useState<Cycle | null>(null)
  const [branches, setBranches] = useState<CostCentre[]>([])
  const [alloc, setAlloc] = useState<Map<number, number[]>>(new Map()) // cost_centre_id -> months
  const [actuals, setActuals] = useState<Map<number, number[]>>(new Map()) // Admin Fee FY2026 actuals
  const [lastIdx, setLastIdx] = useState(0) // index of the last actual month
  const [loaded, setLoaded] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const pending = useRef(new Map<number, number[]>())
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    void (async () => {
      const cyc = (await supabase.from('budget_cycles').select('*').eq('status', 'open')
        .order('fy_year', { ascending: false }).limit(1).maybeSingle()).data as Cycle | null
      if (!cyc) { setLoaded(true); return }
      setCycle(cyc)
      const feeAcc = (await supabase.from('budget_accounts').select('id').eq('code', '400000').maybeSingle()).data
      const [ccRes, allocRes, actRes] = await Promise.all([
        supabase.from('budget_cost_centres').select('*').eq('type', 'branch').eq('active', true).order('code'),
        supabase.from('budget_ho_allocations').select('*').eq('cycle_id', cyc.id),
        feeAcc
          ? supabase.from('budget_actuals').select('*').eq('fy_year', 2026).eq('account_id', feeAcc.id)
          : Promise.resolve({ data: [] as Record<string, unknown>[] }),
      ])
      setBranches((ccRes.data as CostCentre[]) ?? [])
      const m = new Map<number, number[]>()
      for (const r of allocRes.data ?? []) m.set(r.cost_centre_id as number, monthsOf(r))
      setAlloc(m)
      const am = new Map<number, number[]>()
      let idx = 0
      for (const r of actRes.data ?? []) {
        const months = monthsOf(r)
        am.set(r.cost_centre_id as number, months)
        for (let i = 11; i >= 0; i--) if (months[i] !== 0) { idx = Math.max(idx, i); break }
      }
      setActuals(am)
      setLastIdx(idx)
      setLoaded(true)
    })()
  }, [])

  if (!loaded) return <div className="text-slate-500">Loading allocation…</div>
  if (!cycle) return <div className="text-slate-500">No open budget cycle.</div>

  function flush() {
    if (!cycle) return
    const batch = [...pending.current.entries()]
    pending.current.clear()
    if (!batch.length) return
    setSaveState('saving')
    void supabase.from('budget_ho_allocations').upsert(
      batch.map(([ccId, months]) => ({ cycle_id: cycle.id, cost_centre_id: ccId, ...monthCols(months) })),
      { onConflict: 'cycle_id,cost_centre_id' },
    ).then(({ error }) => { if (error) setErr(error.message); setSaveState(error ? 'error' : 'saved') })
  }

  function onChange(updates: CellUpdate[]) {
    setAlloc((prev) => {
      const next = new Map(prev)
      for (const u of updates) {
        const ccId = Number(u.rowKey.slice(2)) // 'cc<id>'
        const months = [...(next.get(ccId) ?? Array(12).fill(0))]
        months[u.monthIdx] = u.value
        next.set(ccId, months)
        pending.current.set(ccId, months)
      }
      return next
    })
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(flush, 600)
  }

  const recovery = Array(12).fill(0) as number[]
  let actualTotal = 0
  const rows: GridRow[] = branches.map((b) => {
    const months = alloc.get(b.id) ?? Array(12).fill(0)
    months.forEach((v, i) => (recovery[i] += v))
    const act = actuals.get(b.id)?.[lastIdx] ?? 0 // stored negative
    if (act) actualTotal += -act
    return { key: `cc${b.id}`, label: `${b.code} — ${b.name}`, values: months, context: [act ? -act : null] }
  })
  rows.push({
    key: 'recovery',
    label: 'Head Office recovery → 000 (Admin Fees Received)',
    display: recovery,
    kind: 'subtotal',
    readOnly: true,
    context: [actualTotal || null],
  })
  const actualHeader = `${monthLabel(2026, lastIdx)} actual`

  return (
    <div>
      <p className="mb-2 text-sm text-slate-500">
        Enter the Head Office <b>Admin Fee</b> charged to each branch per month (positive amounts). Each amount
        becomes that branch’s Admin Fee — a cost below EBITDA — and the total for the month is recovered in cost
        centre <b>000</b> as Admin Fees Received. Charges and recovery net to zero across the company.
      </p>
      {err && <p className="mb-2 text-sm text-red-600">{err}</p>}
      <MonthGrid
        rows={rows}
        monthHeaders={monthLabels(cycle.fy_year)}
        contextHeaders={[actualHeader]}
        labelHeader="Branch"
        onChange={onChange}
        toolbarExtra={
          <span className={`text-xs ${saveState === 'error' ? 'text-red-600' : 'text-slate-400'}`}>
            {saveState === 'saving' && 'Saving…'}
            {saveState === 'saved' && 'All changes saved'}
            {saveState === 'error' && 'Save failed'}
          </span>
        }
      />
    </div>
  )
}
