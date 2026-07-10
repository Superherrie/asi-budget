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

export default function VehiclesTab({ budget }: { budget: BudgetCtx }) {
  const { cycle, cc, accounts, canEdit, latestActualIdx } = budget
  const vehicleAccounts = useMemo(() => accounts.filter((a) => a.input_type === 'vehicle'), [accounts])
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [lines, setLines] = useState<VehLine[]>([])
  const [loaded, setLoaded] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [fReg, setFReg] = useState('')
  const [fDesc, setFDesc] = useState('')
  const [addVehicleId, setAddVehicleId] = useState('')
  const [addAccountId, setAddAccountId] = useState('')
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
    const { error } = await supabase.from('budget_vehicles')
      .insert({ cost_centre_id: cc!.id, registration: fReg.trim().toUpperCase(), description: fDesc.trim() })
    if (error) setErr(error.message)
    setFReg(''); setFDesc('')
    await reload()
  }

  async function addLine() {
    setErr(null)
    if (!addVehicleId || !addAccountId) { setErr('Choose a vehicle and an expense account.'); return }
    if (lines.some((l) => l.vehicle_id === Number(addVehicleId) && l.account_id === Number(addAccountId))) {
      setErr('That vehicle already has a line for this expense account.')
      return
    }
    const { error } = await supabase.from('budget_vehicle_lines').insert({
      cycle_id: cycle!.id, vehicle_id: Number(addVehicleId), account_id: Number(addAccountId),
    })
    if (error) setErr(error.message)
    else await reload()
  }

  async function removeLine(id: number) {
    if (!window.confirm('Remove this expense line?')) return
    const { error } = await supabase.from('budget_vehicle_lines').delete().eq('id', id)
    if (error) setErr(error.message)
    else setLines((prev) => prev.filter((l) => l.id !== id))
  }

  async function retireVehicle(veh: Vehicle) {
    if (!window.confirm(`Mark ${veh.registration} as inactive? Its budget lines stop counting.`)) return
    const { error } = await supabase.from('budget_vehicles').update({ active: false }).eq('id', veh.id!)
    if (error) setErr(error.message)
    else await reload()
  }

  const accName = new Map(vehicleAccounts.map((a) => [a.id, a.name]))
  const rows: GridRow[] = []
  const totals = Array(12).fill(0) as number[]
  for (const veh of vehicles) {
    const vehLines = lines.filter((l) => l.vehicle_id === veh.id)
    rows.push({
      key: `veh${veh.id}`,
      label: (
        <span className="inline-flex items-center gap-2">
          <span className="font-semibold">{veh.registration}</span>
          {veh.description && <span className="text-slate-400">{veh.description}</span>}
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
        label: (
          <span className="inline-flex items-center gap-2">
            {canEdit && (
              <button onClick={() => void removeLine(l.id)} title="Remove line" className="text-red-400 hover:text-red-600">✕</button>
            )}
            {accName.get(l.account_id) ?? `account ${l.account_id}`}
          </span>
        ),
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
        Vehicle running costs (fuel, maintenance, leases, tolls) are budgeted per vehicle and feed the M/V expense
        lines of the statement. Enter positive amounts — the system records them as costs.
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
            <input value={fDesc} onChange={(e) => setFDesc(e.target.value)} placeholder="Toyota Hilux — J Smith" className="w-52 rounded border border-slate-300 px-2 py-1 text-sm" />
          </div>
          <button onClick={() => void addVehicle()} className="rounded-md bg-sky-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700">
            Add vehicle
          </button>
          <span className="mx-3 h-8 w-px bg-slate-200" />
          <div>
            <label className="block text-xs font-medium text-slate-500">Vehicle</label>
            <select value={addVehicleId} onChange={(e) => setAddVehicleId(e.target.value)} className="rounded border border-slate-300 px-2 py-1 text-sm">
              <option value="">choose…</option>
              {vehicles.map((v) => <option key={v.id} value={v.id}>{v.registration}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500">Expense account</label>
            <select value={addAccountId} onChange={(e) => setAddAccountId(e.target.value)} className="rounded border border-slate-300 px-2 py-1 text-sm">
              <option value="">choose…</option>
              {vehicleAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <button onClick={() => void addLine()} className="rounded-md bg-sky-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700">
            Add expense line
          </button>
        </div>
      )}
      <MonthGrid
        rows={rows}
        monthHeaders={monthLabels(cycle.fy_year)}
        labelHeader="Vehicle / expense"
        readOnly={!canEdit}
        latestActualIdx={latestActualIdx}
        onChange={onChange}
      />
    </div>
  )
}
