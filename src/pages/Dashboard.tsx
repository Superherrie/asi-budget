import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import type { Approval, Cycle } from '../lib/types'
import StatusBadge from '../components/StatusBadge'

export default function Dashboard() {
  const { profile, assignments, costCentres } = useAuth()
  const [cycle, setCycle] = useState<Cycle | null>(null)
  const [approvals, setApprovals] = useState<Approval[]>([])

  const myCcIds = profile?.is_admin
    ? costCentres.map((c) => c.id)
    : [...new Set(assignments.map((a) => a.cost_centre_id))]

  useEffect(() => {
    void (async () => {
      const { data: cyc } = await supabase
        .from('budget_cycles')
        .select('*')
        .eq('status', 'open')
        .order('fy_year', { ascending: false })
        .limit(1)
        .maybeSingle()
      setCycle((cyc as Cycle) ?? null)
      if (cyc) {
        const { data: app } = await supabase
          .from('budget_approvals')
          .select('*')
          .eq('cycle_id', (cyc as Cycle).id)
        setApprovals((app as Approval[]) ?? [])
      }
    })()
  }, [])

  const myCcs = costCentres.filter((c) => myCcIds.includes(c.id))

  function rolesFor(ccId: number): string {
    if (profile?.is_admin) return 'admin'
    return assignments
      .filter((a) => a.cost_centre_id === ccId)
      .map((a) => a.role)
      .join(', ')
  }

  return (
    <div>
      <div className="mb-4 flex items-baseline gap-3">
        <h1 className="text-xl font-semibold text-sky-950">My Cost Centres</h1>
        <span className="text-sm text-slate-500">{cycle ? `Budget cycle: ${cycle.name}` : 'No open budget cycle'}</span>
      </div>
      {myCcs.length === 0 && (
        <p className="text-slate-500">
          No cost centres are assigned to you yet. Ask an administrator to assign you as compiler or approver.
        </p>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {myCcs.map((cc) => {
          const appr = approvals.find((a) => a.cost_centre_id === cc.id)
          return (
            <Link
              key={cc.id}
              to={`/cc/${cc.code}`}
              className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm hover:border-sky-400"
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-sky-950">{cc.code}</span>
                <StatusBadge status={appr?.status ?? 'draft'} />
              </div>
              <div className="mt-1 text-sm text-slate-600">{cc.name}</div>
              <div className="mt-2 text-xs uppercase tracking-wide text-slate-400">
                {cc.type === 'branch' ? 'Branch' : 'Administrative'} · {rolesFor(cc.id)}
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
