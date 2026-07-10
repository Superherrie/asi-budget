import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { monthLabels } from '../../lib/months'
import { fmt, parseAmount } from '../../lib/format'
import type { BudgetCtx } from '../../hooks/useBudget'
import type { Employee, TrainingLine } from '../../lib/types'

const KIND_LABEL: Record<TrainingLine['kind'], string> = {
  normal: 'Staff Training',
  health_safety: 'Staff Training - Health & Safety',
}

export default function TrainingTab({ budget }: { budget: BudgetCtx }) {
  const { cycle, cc, canEdit } = budget
  const [employees, setEmployees] = useState<Employee[]>([])
  const [lines, setLines] = useState<TrainingLine[]>([])
  const [loaded, setLoaded] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [fEmp, setFEmp] = useState('')
  const [fKind, setFKind] = useState<TrainingLine['kind']>('normal')
  const [fProvider, setFProvider] = useState('')
  const [fMonth, setFMonth] = useState('1')
  const [fCost, setFCost] = useState('')

  async function reload() {
    if (!cycle || !cc) return
    const [e, l] = await Promise.all([
      supabase.from('budget_employees').select('*')
        .eq('cycle_id', cycle.id).eq('cost_centre_id', cc.id).eq('active', true).order('name'),
      supabase.from('budget_training_lines').select('*')
        .eq('cycle_id', cycle.id).eq('cost_centre_id', cc.id),
    ])
    setEmployees((e.data as Employee[]) ?? [])
    setLines((l.data as TrainingLine[]) ?? [])
    setLoaded(true)
  }

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cycle?.id, cc?.id])

  if (!cycle || !cc) return null
  if (!loaded) return <div className="text-slate-500">Loading training…</div>

  const months = monthLabels(cycle.fy_year) // index 0..11 -> month i+1
  const empName = new Map(employees.map((e) => [e.id!, e.name]))

  async function addLine() {
    setErr(null)
    if (!fEmp) { setErr('Select an employee.'); return }
    const amount = Math.abs(parseAmount(fCost) ?? 0)
    if (!amount) { setErr('Enter a cost.'); return }
    const { error } = await supabase.from('budget_training_lines').insert({
      cycle_id: cycle!.id,
      cost_centre_id: cc!.id,
      employee_id: Number(fEmp),
      kind: fKind,
      provider: fProvider.trim(),
      month: Number(fMonth),
      amount,
    })
    if (error) setErr(error.message)
    else { setFProvider(''); setFCost(''); await reload() }
  }

  async function removeLine(id: number) {
    const { error } = await supabase.from('budget_training_lines').delete().eq('id', id)
    if (error) setErr(error.message)
    else setLines((prev) => prev.filter((l) => l.id !== id))
  }

  const sorted = [...lines].sort((a, b) => a.kind.localeCompare(b.kind) || a.month - b.month)
  const totalFor = (kind: TrainingLine['kind']) =>
    lines.filter((l) => l.kind === kind).reduce((s, l) => s + l.amount, 0)

  return (
    <div>
      <p className="mb-2 text-sm text-slate-500">
        Budget staff training per employee. Each entry (normal or health &amp; safety) feeds the matching
        statement line — <b>Staff Training</b> or <b>Staff Training - Health &amp; Safety</b> — in its month.
      </p>
      {err && <p className="mb-2 text-sm text-red-600">{err}</p>}

      {canEdit && (
        <div className="mb-3 flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-white p-3">
          <div>
            <label className="block text-xs font-medium text-slate-500">Employee</label>
            <select value={fEmp} onChange={(e) => setFEmp(e.target.value)} className="w-44 rounded border border-slate-300 px-2 py-1 text-sm">
              <option value="">choose…</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500">Type</label>
            <select value={fKind} onChange={(e) => setFKind(e.target.value as TrainingLine['kind'])} className="rounded border border-slate-300 px-2 py-1 text-sm">
              <option value="normal">Normal</option>
              <option value="health_safety">Health &amp; Safety</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500">Service provider</label>
            <input value={fProvider} onChange={(e) => setFProvider(e.target.value)} placeholder="e.g. SkillsCo" className="w-40 rounded border border-slate-300 px-2 py-1 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500">Month</label>
            <select value={fMonth} onChange={(e) => setFMonth(e.target.value)} className="rounded border border-slate-300 px-2 py-1 text-sm">
              {months.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500">Cost</label>
            <input value={fCost} onChange={(e) => setFCost(e.target.value)} placeholder="5000" className="w-24 rounded border border-slate-300 px-2 py-1 text-sm" />
          </div>
          <button onClick={() => void addLine()} className="rounded-md bg-sky-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700">
            Add training
          </button>
        </div>
      )}

      <div className="overflow-auto rounded-lg border border-slate-300 bg-white">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-sky-950 text-white">
              <th className="px-2 py-1.5 text-left font-medium">Employee</th>
              <th className="px-2 py-1.5 text-left font-medium">Type</th>
              <th className="px-2 py-1.5 text-left font-medium">Service provider</th>
              <th className="px-2 py-1.5 text-left font-medium">Month</th>
              <th className="px-2 py-1.5 text-right font-medium">Cost</th>
              {canEdit && <th className="px-2 py-1.5" />}
            </tr>
          </thead>
          <tbody>
            {sorted.map((l) => (
              <tr key={l.id} className="border-t border-slate-100">
                <td className="px-2 py-1">{l.employee_id ? empName.get(l.employee_id) ?? '—' : '—'}</td>
                <td className="px-2 py-1">
                  {l.kind === 'health_safety'
                    ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">H&amp;S</span>
                    : <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">Normal</span>}
                </td>
                <td className="px-2 py-1">{l.provider || <span className="text-slate-400">—</span>}</td>
                <td className="px-2 py-1">{months[l.month - 1]}</td>
                <td className="num-cell px-2 py-1">{fmt(l.amount)}</td>
                {canEdit && (
                  <td className="px-2 py-1 text-right">
                    <button onClick={() => void removeLine(l.id!)} title="Remove" className="text-red-400 hover:text-red-600">✕</button>
                  </td>
                )}
              </tr>
            ))}
            {!sorted.length && (
              <tr><td colSpan={canEdit ? 6 : 5} className="px-2 py-2 text-slate-400">No training entries yet.</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-300 bg-slate-100 font-semibold">
              <td className="px-2 py-1" colSpan={4}>Total → {KIND_LABEL.normal}</td>
              <td className="num-cell px-2 py-1">{fmt(totalFor('normal'))}</td>
              {canEdit && <td />}
            </tr>
            <tr className="bg-slate-100 font-semibold">
              <td className="px-2 py-1" colSpan={4}>Total → {KIND_LABEL.health_safety}</td>
              <td className="num-cell px-2 py-1">{fmt(totalFor('health_safety'))}</td>
              {canEdit && <td />}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
