import { useEffect, useMemo, useRef, useState } from 'react'
import MonthGrid, { type CellUpdate, type GridRow } from '../../components/MonthGrid'
import { monthLabels } from '../../lib/months'
import { supabase } from '../../lib/supabase'
import { monthsOf, monthCols, type BudgetCtx } from '../../hooks/useBudget'
import type { Vehicle } from '../../lib/types'

interface VehLine {
  id: number
  vehicle_id: number
  account_id: number
  months: number[]
}

const CAT_ORDER = ['Ops Cabling', 'Sales', 'Admin', 'Ops Admin', 'Exec']
// M/V account name is "M/V Exp - <cost type> - <category>"
const catSuffix = (name: string) => { const p = name.split(' - '); return p[p.length - 1] }
const costTypeOf = (name: string) => { const p = name.split(' - '); return p.length >= 3 ? p[1] : name }

export default function VehiclesTab({ budget }: { budget: BudgetCtx }) {
  const { cycle, cc, accounts, canEdit, latestActualIdx } = budget
  const vehicleAccounts = useMemo(() => accounts.filter((a) => a.input_type === 'vehicle'), [accounts])
  const accById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts])
  const categories = useMemo(() => {
    const set = new Set(vehicleAccounts.map((a) => catSuffix(a.name)))
    return [...set].sort((a, b) => {
      const ia = CAT_ORDER.indexOf(a), ib = CAT_ORDER.indexOf(b)
      return (ia < 0 ? 9 : ia) - (ib < 0 ? 9 : ib)
    })
  }, [vehicleAccounts])
  const accountsForCategory = (cat: string) =>
    vehicleAccounts.filter((a) => catSuffix(a.name) === cat).sort((a, b) => a.sort_order - b.sort_order)

  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [lines, setLines] = useState<VehLine[]>([])
  const [loaded, setLoaded] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [fReg, setFReg] = useState('')
  const [fDesc, setFDesc] = useState('')
  const pending = useRef(new Map<number, number[]>())
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  async function reload() {
    if (!cycle || !cc) return
    const { data: v } = await supabase
      .from('budget_vehicles').select('*')
      .eq('cost_centre_id', cc.id).eq('active', true).order('registration')
    const vehRows = (v as Vehicle[]) ?? []
    setVehicles(vehRows)
    const ids = vehRows.map((x) => x.id!)
    if (ids.length) {
      const { data: l } = await supabase
        .from('budget_vehicle_lines').select('*')
        .eq('cycle_id', cycle.id).in('vehicle_id', ids)
      setLines(((l ?? []) as Record<string, unknown>[]).map((r) => ({
        id: r.id as number,
        vehicle_id: r.vehicle_id as number,
        account_id: r.account_id as number,
        months: monthsOf(r),
      })))
    } else setLines([])
    setLoaded(true)
  }

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cycle?.id, cc?.id])

  if (!cycle || !cc) return null
  if (!loaded) return <div className="text-slate-500">Loading vehicles…</div>

  function flush() {
    const batch = [...pending.current.entries()]
    pending.current.clear()
    for (const [id, months] of batch) {
      void supabase.from('budget_vehicle_lines').update(monthCols(months)).eq('id', id)
        .then(({ error }) => error && setErr(error.message))
    }
  }

  function onChange(updates: CellUpdate[]) {
    setLines((prev) => {
      const next = prev.map((l) => ({ ...l }))
      for (const u of updates) {
        const line = next.find((l) => `v${l.id}` === u.rowKey)
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

  async function addVehicle() {
    setErr(null)
    if (!fReg.trim()) { setErr('Registration is required.'); return }
    const { data: veh, error } = await supabase.from('budget_vehicles')
      .insert({ cost_centre_id: cc!.id, registration: fReg.trim().toUpperCase(), description: fDesc.trim(), category: 'Ops Cabling' })
      .select().single()
    if (error || !veh) { setErr(error?.message ?? 'Insert failed'); return }
    const inserts = accountsForCategory('Ops Cabling').map((a) => ({ cycle_id: cycle!.id, vehicle_id: veh.id, account_id: a.id }))
    if (inserts.length) {
      const { error: e2 } = await supabase.from('budget_vehicle_lines').insert(inserts)
      if (e2) setErr(e2.message)
    }
    setFReg(''); setFDesc('')
    await reload()
  }

  async function setCategory(veh: Vehicle, newCat: string) {
    if (newCat === veh.category) return
    setErr(null)
    // carry existing amounts across the category change, keyed by cost type
    const byType = new Map<string, number[]>()
    for (const l of lines.filter((l) => l.vehicle_id === veh.id)) {
      const acc = accById.get(l.account_id)
      if (acc) byType.set(costTypeOf(acc.name), l.months)
    }
    await supabase.from('budget_vehicle_lines').delete().eq('cycle_id', cycle!.id).eq('vehicle_id', veh.id!)
    const inserts = accountsForCategory(newCat).map((a) => ({
      cycle_id: cycle!.id, vehicle_id: veh.id, account_id: a.id,
      ...monthCols(byType.get(costTypeOf(a.name)) ?? Array(12).fill(0)),
    }))
    if (inserts.length) {
      const { error } = await supabase.from('budget_vehicle_lines').insert(inserts)
      if (error) setErr(error.message)
    }
    await supabase.from('budget_vehicles').update({ category: newCat }).eq('id', veh.id!)
    await reload()
  }

  async function retireVehicle(veh: Vehicle) {
    if (!window.confirm(`Mark ${veh.registration} as inactive? Its budget lines stop counting.`)) return
    const { error } = await supabase.from('budget_vehicles').update({ active: false }).eq('id', veh.id!)
    if (error) setErr(error.message)
    else await reload()
  }

  const rows: GridRow[] = []
  const totals = Array(12).fill(0) as number[]
  for (const veh of vehicles) {
    const vehLines = lines.filter((l) => l.vehicle_id === veh.id)
      .sort((a, b) => (accById.get(a.account_id)?.sort_order ?? 0) - (accById.get(b.account_id)?.sort_order ?? 0))
    rows.push({
      key: `veh${veh.id}`,
      label: (
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="font-semibold">{veh.registration}</span>
          {veh.description && <span className="text-slate-400">{veh.description}</span>}
          <select
            value={veh.category}
            disabled={!canEdit}
            onChange={(e) => void setCategory(veh, e.target.value)}
            onMouseDown={(e) => e.stopPropagation()}
            className="rounded border border-slate-300 bg-white px-1 py-0.5 text-[11px] text-slate-600"
            title="Cost category — sets which M/V accounts these costs post to"
          >
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          {canEdit && (
            <button onClick={() => void retireVehicle(veh)} className="rounded border border-slate-300 px-1.5 text-[11px] text-slate-500 hover:bg-red-50">
              retire
            </button>
          )}
        </span>
      ),
      kind: 'section',
    })
    for (const l of vehLines) {
      l.months.forEach((v, i) => (totals[i] += v))
      rows.push({
        key: `v${l.id}`,
        label: <span className="text-slate-600">{costTypeOf(accById.get(l.account_id)?.name ?? '')}</span>,
        values: l.months,
        indent: 1,
        costRow: true,
      })
    }
  }
  rows.push({ key: 'tot', label: 'Total vehicle costs', display: totals, kind: 'subtotal', readOnly: true })

  return (
    <div>
      <p className="mb-2 text-sm text-slate-500">
        Each vehicle has its running-cost GL lines (fuel, maintenance, lease, tolls, surveillance) ready to budget —
        enter positive amounts. Set a vehicle’s <b>category</b> to post its costs to the matching M/V accounts.
      </p>
      {err && <p className="mb-2 text-sm text-red-600">{err}</p>}
      {canEdit && (
        <div className="mb-3 flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-white p-3">
          <div>
            <label className="block text-xs font-medium text-slate-500">Registration</label>
            <input value={fReg} onChange={(e) => setFReg(e.target.value)} className="w-32 rounded border border-slate-300 px-2 py-1 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500">Description</label>
            <input value={fDesc} onChange={(e) => setFDesc(e.target.value)} placeholder="2022 Toyota Hilux" className="w-52 rounded border border-slate-300 px-2 py-1 text-sm" />
          </div>
          <button onClick={() => void addVehicle()} className="rounded-md bg-sky-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700">
            Add vehicle
          </button>
          <span className="text-xs text-slate-400">New vehicles start in the Ops Cabling category with all cost lines ready.</span>
        </div>
      )}
      <MonthGrid
        rows={rows}
        monthHeaders={monthLabels(cycle.fy_year)}
        labelHeader="Vehicle / cost"
        labelWidth="17rem"
        readOnly={!canEdit}
        latestActualIdx={latestActualIdx}
        onChange={onChange}
      />
    </div>
  )
}
