import { Fragment, useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { fmt, parseAmount } from '../../lib/format'
import type { BudgetCtx } from '../../hooks/useBudget'

const CATEGORIES = [
  'Furniture and Fittings',
  'Plant and Machinery',
  'Computer Equipment',
  'Software',
  'Leasehold Improvements',
  'Motor Vehicles',
  'Tools',
]

interface CapexLine {
  id: number
  description: string
  capex_date: string | null
  amount: number
  supplier: string
  category: string
}

export default function CapexTab({ budget }: { budget: BudgetCtx }) {
  const { cycle, cc, canEdit } = budget
  const [lines, setLines] = useState<CapexLine[]>([])
  const [loaded, setLoaded] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // add form
  const [fDesc, setFDesc] = useState('')
  const [fDate, setFDate] = useState('')
  const [fAmount, setFAmount] = useState('')
  const [fSupplier, setFSupplier] = useState('')
  const [fCat, setFCat] = useState(CATEGORIES[0])
  const pending = useRef(new Map<number, Partial<CapexLine>>())
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  async function reload() {
    if (!cycle || !cc) return
    const { data } = await supabase
      .from('budget_capex_lines')
      .select('*')
      .eq('cycle_id', cycle.id)
      .eq('cost_centre_id', cc.id)
      .order('category')
      .order('capex_date', { nullsFirst: true })
    setLines(((data ?? []) as Record<string, unknown>[]).map((r) => ({
      id: r.id as number,
      description: (r.description as string) ?? '',
      capex_date: (r.capex_date as string) ?? null,
      amount: Number(r.amount) || 0,
      supplier: (r.supplier as string) ?? '',
      category: (r.category as string) ?? '',
    })))
    setLoaded(true)
  }

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cycle?.id, cc?.id])

  if (!cycle || !cc) return null
  if (!loaded) return <div className="text-slate-500">Loading capex…</div>

  async function addLine() {
    setErr(null)
    if (!fDesc.trim()) { setErr('Enter a description.'); return }
    const amount = parseAmount(fAmount) ?? 0
    if (!amount) { setErr('Enter an amount.'); return }
    const { error } = await supabase.from('budget_capex_lines').insert({
      cycle_id: cycle!.id,
      cost_centre_id: cc!.id,
      description: fDesc.trim(),
      capex_date: fDate || null,
      amount,
      supplier: fSupplier.trim(),
      category: fCat,
    })
    if (error) { setErr(error.message); return }
    setFDesc(''); setFDate(''); setFAmount(''); setFSupplier('')
    await reload()
  }

  async function removeLine(id: number) {
    if (!window.confirm('Remove this capex item?')) return
    const { error } = await supabase.from('budget_capex_lines').delete().eq('id', id)
    if (error) { setErr(error.message); return }
    setLines((prev) => prev.filter((l) => l.id !== id))
  }

  function flush() {
    const batch = [...pending.current.entries()]
    pending.current.clear()
    for (const [id, patch] of batch) {
      void supabase.from('budget_capex_lines').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id)
        .then(({ error }) => error && setErr(error.message))
    }
  }

  function editField<K extends keyof CapexLine>(id: number, field: K, value: CapexLine[K]) {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, [field]: value } : l)))
    const cur = pending.current.get(id) ?? {}
    pending.current.set(id, { ...cur, [field]: value })
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(flush, 700)
  }

  const grand = lines.reduce((s, l) => s + l.amount, 0)
  const inputCls = 'w-full rounded border border-slate-300 px-2 py-1 text-sm disabled:border-transparent disabled:bg-transparent'

  return (
    <div>
      <p className="mb-3 text-sm text-slate-500">
        Budget capital purchases for this branch. Each item has a description, date, amount, supplier and category.
        Capex is tracked here separately and does not flow into the income statement.
      </p>
      {err && <p className="mb-2 text-sm text-red-600">{err}</p>}

      {canEdit && (
        <div className="mb-4 flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-white p-3">
          <div>
            <label className="block text-xs font-medium text-slate-500">Description</label>
            <input value={fDesc} onChange={(e) => setFDesc(e.target.value)} placeholder="e.g. 3 × office desks" className="w-52 rounded border border-slate-300 px-2 py-1 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500">Date</label>
            <input type="date" value={fDate} onChange={(e) => setFDate(e.target.value)} className="rounded border border-slate-300 px-2 py-1 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500">Amount (R)</label>
            <input value={fAmount} onChange={(e) => setFAmount(e.target.value)} placeholder="25 000" className="w-28 rounded border border-slate-300 px-2 py-1 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500">Supplier</label>
            <input value={fSupplier} onChange={(e) => setFSupplier(e.target.value)} placeholder="e.g. Makro" className="w-40 rounded border border-slate-300 px-2 py-1 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500">Category</label>
            <select value={fCat} onChange={(e) => setFCat(e.target.value)} className="rounded border border-slate-300 px-2 py-1 text-sm">
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <button onClick={() => void addLine()} className="rounded-md bg-sky-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700">
            Add capex item
          </button>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[52rem] text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-sky-50 text-sky-900">
              <th className="px-3 py-2 text-left font-semibold">Date</th>
              <th className="px-3 py-2 text-left font-semibold">Description</th>
              <th className="px-3 py-2 text-left font-semibold">Supplier</th>
              <th className="px-3 py-2 text-right font-semibold">Amount (R)</th>
              {canEdit && <th className="w-8" />}
            </tr>
          </thead>
          <tbody>
            {CATEGORIES.map((cat) => {
              const rows = lines.filter((l) => l.category === cat)
              if (!rows.length) return null
              const subtotal = rows.reduce((s, l) => s + l.amount, 0)
              return (
                <Fragment key={cat}>
                  <tr className="bg-sky-50/60">
                    <td colSpan={canEdit ? 5 : 4} className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-sky-900">
                      {cat} <span className="text-slate-400">· {rows.length}</span>
                    </td>
                  </tr>
                  {rows.map((l) => (
                    <tr key={l.id} className="border-b border-slate-100">
                      <td className="px-2 py-1">
                        <input type="date" value={l.capex_date ?? ''} disabled={!canEdit} onChange={(e) => editField(l.id, 'capex_date', e.target.value || null)} className={inputCls} />
                      </td>
                      <td className="px-2 py-1">
                        <input value={l.description} disabled={!canEdit} onChange={(e) => editField(l.id, 'description', e.target.value)} className={inputCls} />
                      </td>
                      <td className="px-2 py-1">
                        <input value={l.supplier} disabled={!canEdit} onChange={(e) => editField(l.id, 'supplier', e.target.value)} className={inputCls} />
                      </td>
                      <td className="px-2 py-1 text-right">
                        <input
                          value={l.amount ? String(l.amount) : ''}
                          disabled={!canEdit}
                          onChange={(e) => editField(l.id, 'amount', parseAmount(e.target.value) ?? 0)}
                          className={`${inputCls} text-right`}
                        />
                      </td>
                      {canEdit && (
                        <td className="px-1 py-1 text-center">
                          <button onClick={() => void removeLine(l.id)} title="Remove" className="text-red-400 hover:text-red-600">✕</button>
                        </td>
                      )}
                    </tr>
                  ))}
                  <tr className="border-b border-slate-200 bg-slate-50 font-medium">
                    <td colSpan={3} className="px-3 py-1.5 text-right text-slate-500">Total {cat}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmt(subtotal)}</td>
                    {canEdit && <td />}
                  </tr>
                </Fragment>
              )
            })}
            {!lines.length && (
              <tr><td colSpan={canEdit ? 5 : 4} className="px-3 py-6 text-center text-slate-400">No capex budgeted yet.</td></tr>
            )}
          </tbody>
          {lines.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-slate-300 bg-sky-50 font-semibold text-sky-950">
                <td colSpan={3} className="px-3 py-2 text-right">Total Capex</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt(grand)}</td>
                {canEdit && <td />}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}
