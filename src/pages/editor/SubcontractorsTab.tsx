import { useEffect, useRef, useState } from 'react'
import MonthGrid, { type CellUpdate, type GridRow } from '../../components/MonthGrid'
import { monthLabels } from '../../lib/months'
import { supabase } from '../../lib/supabase'
import { monthsOf, monthCols, type BudgetCtx } from '../../hooks/useBudget'
import type { SubcontractorLine } from '../../lib/types'

interface SubLine {
  id: number
  name: string
  kind: 'electrical' | 'data' | 'civils'
  months: number[]
}

const KINDS: { kind: SubLine['kind']; label: string; account: string }[] = [
  { kind: 'electrical', label: 'Electrical → Cost of Subcontractors (Elec Only)', account: '200310' },
  { kind: 'data', label: 'Data → Cost of Subcontractors', account: '200300' },
  { kind: 'civils', label: 'Civils → Cost of Civils', account: '200400' },
]

export default function SubcontractorsTab({ budget }: { budget: BudgetCtx }) {
  const { cycle, cc, canEdit, latestActualIdx } = budget
  const [lines, setLines] = useState<SubLine[]>([])
  const [loaded, setLoaded] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [fName, setFName] = useState('')
  const [fKind, setFKind] = useState<SubLine['kind']>('electrical')
  const pending = useRef(new Map<number, number[]>())
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  async function reload() {
    if (!cycle || !cc) return
    const { data } = await supabase.from('budget_subcontractor_lines').select('*')
      .eq('cycle_id', cycle.id).eq('cost_centre_id', cc.id)
    setLines(((data ?? []) as Record<string, unknown>[]).map((r) => ({
      id: r.id as number,
      name: (r.name as string) ?? '',
      kind: r.kind as SubLine['kind'],
      months: monthsOf(r),
    })))
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

  async function addLine() {
    setErr(null)
    if (!fName.trim()) { setErr('Subcontractor name is required.'); return }
    const { error } = await supabase.from('budget_subcontractor_lines').insert({
      cycle_id: cycle!.id, cost_centre_id: cc!.id, name: fName.trim(), kind: fKind,
    } satisfies Partial<SubcontractorLine>)
    if (error) setErr(error.message)
    else { setFName(''); await reload() }
  }

  async function removeLine(id: number) {
    if (!window.confirm('Remove this subcontractor?')) return
    const { error } = await supabase.from('budget_subcontractor_lines').delete().eq('id', id)
    if (error) setErr(error.message)
    else setLines((prev) => prev.filter((l) => l.id !== id))
  }

  const rows: GridRow[] = []
  for (const { kind, label } of KINDS) {
    rows.push({ key: `h_${kind}`, label, kind: 'section' })
    const kindLines = lines.filter((l) => l.kind === kind).sort((a, b) => a.name.localeCompare(b.name))
    const totals = Array(12).fill(0) as number[]
    for (const l of kindLines) {
      l.months.forEach((v, i) => (totals[i] += v))
      rows.push({
        key: `s${l.id}`,
        label: (
          <span className="inline-flex items-center gap-2">
            {canEdit && (
              <button onClick={() => void removeLine(l.id)} title="Remove" className="text-red-400 hover:text-red-600">✕</button>
            )}
            <span>{l.name}</span>
          </span>
        ),
        values: l.months,
        indent: 1,
        costRow: true,
      })
    }
    if (!kindLines.length) rows.push({ key: `none_${kind}`, label: <span className="text-slate-400">No {kind} subcontractors yet</span>, display: null, readOnly: true, indent: 1 })
    rows.push({ key: `t_${kind}`, label: `Total ${kind}`, display: totals, kind: 'subtotal', readOnly: true, indent: 1 })
  }

  return (
    <div>
      <p className="mb-2 text-sm text-slate-500">
        Budget per subcontractor — enter positive amounts. <b>Electrical</b> posts to Cost of Subcontractors
        (Elec Only), <b>Data</b> to Cost of Subcontractors, and <b>Civils</b> to Cost of Civils.
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
            <select value={fKind} onChange={(e) => setFKind(e.target.value as SubLine['kind'])} className="rounded border border-slate-300 px-2 py-1 text-sm">
              <option value="electrical">Electrical</option>
              <option value="data">Data</option>
              <option value="civils">Civils</option>
            </select>
          </div>
          <button onClick={() => void addLine()} className="rounded-md bg-sky-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700">
            Add subcontractor
          </button>
        </div>
      )}
      <MonthGrid
        rows={rows}
        monthHeaders={monthLabels(cycle.fy_year)}
        labelHeader="Subcontractor"
        readOnly={!canEdit}
        latestActualIdx={latestActualIdx}
        onChange={onChange}
      />
    </div>
  )
}
