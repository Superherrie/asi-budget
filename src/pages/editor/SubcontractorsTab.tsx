import { useEffect, useRef, useState } from 'react'
import MonthGrid, { type CellUpdate, type GridRow } from '../../components/MonthGrid'
import { monthLabels } from '../../lib/months'
import { supabase } from '../../lib/supabase'
import { monthsOf, monthCols, type BudgetCtx } from '../../hooks/useBudget'
import { createSubcontractor, removeSubcontractor } from '../../lib/subcontractors'
import type { Subcontractor } from '../../lib/types'

interface CostLine {
  id: number
  subcontractor_id: number
  months: number[]
}

const KINDS: { kind: Subcontractor['kind']; label: string }[] = [
  { kind: 'electrical', label: 'Electrical → Cost of Subcontractors (Elec Only)' },
  { kind: 'data', label: 'Data → Cost of Subcontractors' },
  { kind: 'civils', label: 'Civils → Cost of Civils' },
]

export default function SubcontractorsTab({ budget }: { budget: BudgetCtx }) {
  const { cycle, cc, accounts, canEdit, latestActualIdx } = budget
  const salesAccount = accounts.find((a) => a.input_type === 'revenue')
  const [subs, setSubs] = useState<Subcontractor[]>([])
  const [lines, setLines] = useState<CostLine[]>([])
  // revenue budgeted per subcontractor on the Revenue tab (read-only here)
  const [revBySub, setRevBySub] = useState<Map<number, number[]>>(new Map())
  const [loaded, setLoaded] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [fName, setFName] = useState('')
  const [fKind, setFKind] = useState<Subcontractor['kind']>('electrical')
  const pending = useRef(new Map<number, number[]>())
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  async function reload() {
    if (!cycle || !cc) return
    const [s, l, rev] = await Promise.all([
      supabase.from('budget_subcontractors').select('*').eq('cycle_id', cycle.id).eq('cost_centre_id', cc.id).eq('active', true).order('name'),
      supabase.from('budget_subcontractor_lines').select('*').eq('cycle_id', cycle.id).eq('cost_centre_id', cc.id),
      supabase.from('budget_revenue_lines').select('*').eq('cycle_id', cycle.id).eq('cost_centre_id', cc.id).not('subcontractor_id', 'is', null),
    ])
    setSubs((s.data as Subcontractor[]) ?? [])
    setLines(((l.data ?? []) as Record<string, unknown>[]).map((r) => ({
      id: r.id as number,
      subcontractor_id: r.subcontractor_id as number,
      months: monthsOf(r),
    })))
    const rm = new Map<number, number[]>()
    for (const r of (rev.data ?? []) as Record<string, unknown>[]) rm.set(r.subcontractor_id as number, monthsOf(r))
    setRevBySub(rm)
    setLoaded(true)
  }

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cycle?.id, cc?.id])

  if (!cycle || !cc) return null
  if (!loaded) return <div className="text-slate-500">Loading subcontractors…</div>

  function flush() {
    const batch = [...pending.current.entries()]
    pending.current.clear()
    for (const [id, months] of batch) {
      void supabase.from('budget_subcontractor_lines').update(monthCols(months)).eq('id', id)
        .then(({ error }) => error && setErr(error.message))
    }
  }

  function onChange(updates: CellUpdate[]) {
    setLines((prev) => {
      const next = prev.map((l) => ({ ...l }))
      for (const u of updates) {
        const line = next.find((l) => `s${l.id}` === u.rowKey)
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

  async function addSub() {
    setErr(null)
    if (!fName.trim()) { setErr('Subcontractor name is required.'); return }
    if (!salesAccount) { setErr('No revenue account configured.'); return }
    if (subs.some((s) => s.name.toLowerCase() === fName.trim().toLowerCase())) {
      setErr('A subcontractor with that name already exists.'); return
    }
    const e = await createSubcontractor({ cycleId: cycle!.id, ccId: cc!.id, salesAccountId: salesAccount.id, name: fName.trim(), kind: fKind })
    if (e) setErr(e)
    else { setFName(''); await reload() }
  }

  async function removeSub(subId: number) {
    if (!window.confirm('Remove this subcontractor? Its revenue and cost lines are deleted.')) return
    const e = await removeSubcontractor(subId)
    if (e) setErr(e)
    else await reload()
  }

  // read-only revenue table (budgeted on the Revenue tab)
  const revRows: GridRow[] = []
  let anyRev = false
  for (const { kind } of KINDS) {
    const kindSubs = subs.filter((s) => s.kind === kind).sort((a, b) => a.name.localeCompare(b.name))
    const kindWithRev = kindSubs.filter((s) => (revBySub.get(s.id!) ?? []).some((v) => v !== 0))
    if (!kindWithRev.length) continue
    anyRev = true
    revRows.push({ key: `rh_${kind}`, label: KINDS.find((k) => k.kind === kind)!.label.split(' → ')[0], kind: 'section' })
    const totals = Array(12).fill(0) as number[]
    for (const s of kindWithRev) {
      const m = revBySub.get(s.id!) ?? Array(12).fill(0)
      m.forEach((v, i) => (totals[i] += v))
      revRows.push({ key: `rs${s.id}`, label: <span className="text-slate-600">{s.name}</span>, display: m, readOnly: true, indent: 1 })
    }
    revRows.push({ key: `rt_${kind}`, label: `Total ${kind} revenue`, display: totals, kind: 'subtotal', readOnly: true, indent: 1 })
  }

  const lineBySub = new Map(lines.map((l) => [l.subcontractor_id, l]))
  const rows: GridRow[] = []
  for (const { kind, label } of KINDS) {
    rows.push({ key: `h_${kind}`, label, kind: 'section' })
    const kindSubs = subs.filter((s) => s.kind === kind).sort((a, b) => a.name.localeCompare(b.name))
    const totals = Array(12).fill(0) as number[]
    for (const s of kindSubs) {
      const line = lineBySub.get(s.id!)
      if (!line) continue
      line.months.forEach((v, i) => (totals[i] += v))
      rows.push({
        key: `s${line.id}`,
        label: (
          <span className="inline-flex items-center gap-2">
            {canEdit && (
              <button onClick={() => void removeSub(s.id!)} title="Remove" className="text-red-400 hover:text-red-600">✕</button>
            )}
            <span>{s.name}</span>
          </span>
        ),
        values: line.months,
        indent: 1,
        costRow: true,
      })
    }
    if (!kindSubs.length) rows.push({ key: `none_${kind}`, label: <span className="text-slate-400">No {kind} subcontractors yet</span>, display: null, readOnly: true, indent: 1 })
    rows.push({ key: `t_${kind}`, label: `Total ${kind}`, display: totals, kind: 'subtotal', readOnly: true, indent: 1 })
  }

  return (
    <div>
      <p className="mb-2 text-sm text-slate-500">
        Budget each subcontractor’s <b>cost</b> — enter positive amounts. <b>Electrical</b> posts to Cost of
        Subcontractors (Elec Only), <b>Data</b> to Cost of Subcontractors, and <b>Civils</b> to Cost of Civils.
        Subcontractors are shared with the Revenue tab, where their <b>revenue</b> is budgeted.
      </p>
      {err && <p className="mb-2 text-sm text-red-600">{err}</p>}
      {canEdit && (
        <div className="mb-3 flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-white p-3">
          <div>
            <label className="block text-xs font-medium text-slate-500">Subcontractor name</label>
            <input value={fName} onChange={(e) => setFName(e.target.value)} placeholder="e.g. ABC Electrical" className="w-48 rounded border border-slate-300 px-2 py-1 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500">Type</label>
            <select value={fKind} onChange={(e) => setFKind(e.target.value as Subcontractor['kind'])} className="rounded border border-slate-300 px-2 py-1 text-sm">
              <option value="electrical">Electrical</option>
              <option value="data">Data</option>
              <option value="civils">Civils</option>
            </select>
          </div>
          <button onClick={() => void addSub()} className="rounded-md bg-sky-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700">
            Add subcontractor
          </button>
        </div>
      )}
      {anyRev && (
        <div className="mb-5">
          <h3 className="mb-1 text-sm font-semibold text-sky-950">Revenue budgeted per subcontractor</h3>
          <p className="mb-1 text-xs text-slate-500">From the Revenue tab — read-only here, for comparison with the cost below.</p>
          <MonthGrid
            rows={revRows}
            monthHeaders={monthLabels(cycle.fy_year)}
            labelHeader="Subcontractor"
            readOnly
          />
        </div>
      )}

      <h3 className="mb-1 text-sm font-semibold text-sky-950">Cost per subcontractor</h3>
      <MonthGrid
        rows={rows}
        monthHeaders={monthLabels(cycle.fy_year)}
        labelHeader="Subcontractor"
        comments={{ cycleId: cycle.id, ccId: cc.id, scope: 'subcontractors' }}
        readOnly={!canEdit}
        latestActualIdx={latestActualIdx}
        onChange={onChange}
      />
    </div>
  )
}
