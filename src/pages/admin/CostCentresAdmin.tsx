import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import type { CostCentre } from '../../lib/types'

export default function CostCentresAdmin() {
  const { refresh } = useAuth()
  const [ccs, setCcs] = useState<CostCentre[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [fCode, setFCode] = useState('')
  const [fName, setFName] = useState('')
  const [fType, setFType] = useState<'branch' | 'admin'>('branch')

  async function reload() {
    const { data } = await supabase.from('budget_cost_centres').select('*').order('code')
    setCcs((data as CostCentre[]) ?? [])
  }

  useEffect(() => {
    void reload()
  }, [])

  async function save(cc: CostCentre, patch: Partial<CostCentre>) {
    setErr(null)
    const { error } = await supabase.from('budget_cost_centres').update(patch).eq('id', cc.id)
    if (error) setErr(error.message)
    else {
      await reload()
      await refresh()
    }
  }

  async function add() {
    setErr(null)
    if (!fCode.trim() || !fName.trim()) { setErr('Code and name are required'); return }
    const { error } = await supabase.from('budget_cost_centres')
      .insert({ code: fCode.trim().toUpperCase(), name: fName.trim(), type: fType })
    if (error) setErr(error.message)
    else {
      setFCode(''); setFName('')
      await reload()
      await refresh()
    }
  }

  return (
    <div className="space-y-4">
      {err && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-white p-3">
        <div>
          <label className="block text-xs font-medium text-slate-500">Code</label>
          <input value={fCode} onChange={(e) => setFCode(e.target.value)} className="w-24 rounded border border-slate-300 px-2 py-1 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500">Name</label>
          <input value={fName} onChange={(e) => setFName(e.target.value)} className="w-56 rounded border border-slate-300 px-2 py-1 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500">Type</label>
          <select value={fType} onChange={(e) => setFType(e.target.value as 'branch' | 'admin')} className="rounded border border-slate-300 px-2 py-1 text-sm">
            <option value="branch">Branch</option>
            <option value="admin">Administrative</option>
          </select>
        </div>
        <button onClick={() => void add()} className="rounded-md bg-sky-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700">
          Add cost centre
        </button>
      </div>
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2">Code</th>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Active</th>
            </tr>
          </thead>
          <tbody>
            {ccs.map((cc) => (
              <tr key={cc.id} className="border-t border-slate-100">
                <td className="px-3 py-1.5 font-semibold text-sky-950">{cc.code}</td>
                <td className="px-3 py-1.5">
                  <input
                    defaultValue={cc.name}
                    onBlur={(e) => e.target.value !== cc.name && void save(cc, { name: e.target.value })}
                    className="w-full rounded border border-transparent px-1 py-0.5 hover:border-slate-200 focus:border-sky-400 focus:outline-none"
                  />
                </td>
                <td className="px-3 py-1.5">
                  <select value={cc.type} onChange={(e) => void save(cc, { type: e.target.value as 'branch' | 'admin' })}
                    className="rounded border border-slate-200 px-1 py-0.5">
                    <option value="branch">Branch</option>
                    <option value="admin">Administrative</option>
                  </select>
                </td>
                <td className="px-3 py-1.5">
                  <input type="checkbox" checked={cc.active} onChange={(e) => void save(cc, { active: e.target.checked })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
