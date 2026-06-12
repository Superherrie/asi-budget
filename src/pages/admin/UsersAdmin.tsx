import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import type { Assignment, CcRole, Profile } from '../../lib/types'

export default function UsersAdmin() {
  const { costCentres } = useAuth()
  const [users, setUsers] = useState<Profile[]>([])
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [fEmail, setFEmail] = useState('')
  const [fName, setFName] = useState('')
  const [fPassword, setFPassword] = useState('')
  const [fAdmin, setFAdmin] = useState(false)

  async function reload() {
    const [p, a] = await Promise.all([
      supabase.from('budget_profiles').select('*').order('full_name'),
      supabase.from('budget_assignments').select('*'),
    ])
    setUsers((p.data as Profile[]) ?? [])
    setAssignments((a.data as Assignment[]) ?? [])
  }

  useEffect(() => {
    void reload()
  }, [])

  async function callAdminFn(body: Record<string, unknown>): Promise<boolean> {
    setBusy(true)
    setErr(null)
    setMsg(null)
    const { data, error } = await supabase.functions.invoke('budget-admin-users', { body })
    setBusy(false)
    const errMsg = error?.message ?? (data as { error?: string } | null)?.error
    if (errMsg) {
      setErr(errMsg)
      return false
    }
    return true
  }

  async function createUser() {
    if (!fEmail || !fPassword) {
      setErr('Email and password are required')
      return
    }
    if (await callAdminFn({ action: 'create', email: fEmail, password: fPassword, full_name: fName, is_admin: fAdmin })) {
      setMsg(`User ${fEmail} created`)
      setFEmail(''); setFName(''); setFPassword(''); setFAdmin(false)
      await reload()
    }
  }

  async function resetPassword(u: Profile) {
    const pw = window.prompt(`New password for ${u.email}:`)
    if (!pw) return
    if (await callAdminFn({ action: 'reset_password', user_id: u.user_id, password: pw })) {
      setMsg(`Password updated for ${u.email}`)
    }
  }

  async function toggleAdmin(u: Profile) {
    if (await callAdminFn({ action: 'set_admin', user_id: u.user_id, is_admin: !u.is_admin })) await reload()
  }

  async function deleteUser(u: Profile) {
    if (!window.confirm(`Delete user ${u.email}? This cannot be undone.`)) return
    if (await callAdminFn({ action: 'delete', user_id: u.user_id })) await reload()
  }

  async function addAssignment(u: Profile, ccId: number, role: CcRole) {
    setErr(null)
    const { error } = await supabase.from('budget_assignments')
      .insert({ user_id: u.user_id, cost_centre_id: ccId, role })
    if (error) setErr(error.message)
    else await reload()
  }

  async function removeAssignment(id: number) {
    const { error } = await supabase.from('budget_assignments').delete().eq('id', id)
    if (error) setErr(error.message)
    else await reload()
  }

  return (
    <div className="space-y-4">
      {err && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
      {msg && <p className="rounded bg-green-50 px-3 py-2 text-sm text-green-700">{msg}</p>}

      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-white p-3">
        <div>
          <label className="block text-xs font-medium text-slate-500">Email</label>
          <input value={fEmail} onChange={(e) => setFEmail(e.target.value)} type="email"
            className="w-56 rounded border border-slate-300 px-2 py-1 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500">Full name</label>
          <input value={fName} onChange={(e) => setFName(e.target.value)}
            className="w-44 rounded border border-slate-300 px-2 py-1 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500">Password</label>
          <input value={fPassword} onChange={(e) => setFPassword(e.target.value)} type="text"
            className="w-40 rounded border border-slate-300 px-2 py-1 text-sm" />
        </div>
        <label className="flex items-center gap-1 text-sm">
          <input type="checkbox" checked={fAdmin} onChange={(e) => setFAdmin(e.target.checked)} /> Admin
        </label>
        <button onClick={() => void createUser()} disabled={busy}
          className="rounded-md bg-sky-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50">
          Create user
        </button>
      </div>

      <div className="space-y-3">
        {users.map((u) => {
          const ua = assignments.filter((a) => a.user_id === u.user_id)
          return (
            <div key={u.user_id} className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-sky-950">{u.full_name || u.email}</span>
                <span className="text-sm text-slate-400">{u.email}</span>
                {u.is_admin && (
                  <span className="rounded bg-purple-100 px-1.5 text-[11px] font-semibold text-purple-700">ADMIN</span>
                )}
                <span className="ml-auto flex gap-2 text-xs">
                  <button onClick={() => void resetPassword(u)} className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50">
                    Reset password
                  </button>
                  <button onClick={() => void toggleAdmin(u)} className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50">
                    {u.is_admin ? 'Revoke admin' : 'Make admin'}
                  </button>
                  <button onClick={() => void deleteUser(u)} className="rounded border border-red-200 px-2 py-1 text-red-600 hover:bg-red-50">
                    Delete
                  </button>
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {ua.map((a) => {
                  const cc = costCentres.find((c) => c.id === a.cost_centre_id)
                  return (
                    <span key={a.id} className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-xs text-sky-900">
                      {cc?.code ?? a.cost_centre_id} · {a.role}
                      <button onClick={() => void removeAssignment(a.id)} className="text-sky-400 hover:text-red-600">✕</button>
                    </span>
                  )
                })}
                <AssignmentAdder onAdd={(ccId, role) => void addAssignment(u, ccId, role)} />
              </div>
            </div>
          )
        })}
        {!users.length && <p className="text-slate-500">No users yet — create the first one above.</p>}
      </div>
    </div>
  )
}

function AssignmentAdder({ onAdd }: { onAdd: (ccId: number, role: CcRole) => void }) {
  const { costCentres } = useAuth()
  const [cc, setCc] = useState('')
  const [role, setRole] = useState<CcRole>('compiler')
  return (
    <span className="inline-flex items-center gap-1 text-xs">
      <select value={cc} onChange={(e) => setCc(e.target.value)} className="rounded border border-slate-200 px-1 py-0.5">
        <option value="">+ assign cost centre…</option>
        {costCentres.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
      </select>
      {cc && (
        <>
          <select value={role} onChange={(e) => setRole(e.target.value as CcRole)} className="rounded border border-slate-200 px-1 py-0.5">
            <option value="compiler">compiler</option>
            <option value="approver">approver</option>
          </select>
          <button
            onClick={() => { onAdd(Number(cc), role); setCc('') }}
            className="rounded bg-sky-800 px-2 py-0.5 text-white"
          >
            Add
          </button>
        </>
      )}
    </span>
  )
}
