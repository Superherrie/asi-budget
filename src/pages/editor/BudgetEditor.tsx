import { useState } from 'react'
import { NavLink, Route, Routes, useParams } from 'react-router-dom'
import { useBudget } from '../../hooks/useBudget'
import { supabase } from '../../lib/supabase'
import StatusBadge from '../../components/StatusBadge'
import StatementTab from './StatementTab'
import RevenueTab from './RevenueTab'
import SalariesTab from './SalariesTab'
import VehiclesTab from './VehiclesTab'

const tabClass = ({ isActive }: { isActive: boolean }) =>
  `border-b-2 px-3 py-2 text-sm font-medium ${
    isActive ? 'border-sky-700 text-sky-900' : 'border-transparent text-slate-500 hover:text-slate-700'
  }`

export default function BudgetEditor() {
  const { code } = useParams()
  const budget = useBudget(code)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  if (budget.loading) return <div className="text-slate-500">Loading budget…</div>
  if (budget.error) return <div className="text-red-600">{budget.error}</div>
  const { cc, cycle, approval } = budget
  if (!cc || !cycle) return null

  const status = approval?.status ?? 'draft'

  async function runAction(fn: () => PromiseLike<{ error: { message: string } | null }>) {
    setBusy(true)
    setActionError(null)
    const { error } = await fn()
    if (error) setActionError(error.message)
    else await budget.reloadApproval()
    setBusy(false)
  }

  const submit = () =>
    runAction(() => supabase.rpc('budget_submit', { p_cycle: cycle.id, p_cc: cc.id }))
  const decide = (approve: boolean) => {
    const comment = window.prompt(approve ? 'Approval comment (optional):' : 'Reason for rejection:')
    if (!approve && comment === null) return
    void runAction(() =>
      supabase.rpc('budget_decide', { p_cycle: cycle.id, p_cc: cc.id, p_approve: approve, p_comment: comment || null }))
  }
  const reopen = () =>
    runAction(() => supabase.rpc('budget_reopen', { p_cycle: cycle.id, p_cc: cc.id }))

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold text-sky-950">
          {cc.code} — {cc.name}
        </h1>
        <span className="text-sm text-slate-500">{cycle.name} budget</span>
        <StatusBadge status={status} />
        {approval?.comment && (
          <span className="text-sm italic text-slate-500">“{approval.comment}”</span>
        )}
        <span className="ml-auto flex gap-2">
          {budget.isCompiler && (status === 'draft' || status === 'rejected') && (
            <button
              onClick={() => void submit()}
              disabled={busy}
              className="rounded-md bg-sky-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
            >
              Submit for approval
            </button>
          )}
          {budget.isApprover && status === 'submitted' && (
            <>
              <button
                onClick={() => decide(true)}
                disabled={busy}
                className="rounded-md bg-green-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-600 disabled:opacity-50"
              >
                Approve
              </button>
              <button
                onClick={() => decide(false)}
                disabled={busy}
                className="rounded-md bg-red-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-50"
              >
                Reject
              </button>
            </>
          )}
          {status === 'approved' && budget.isApprover && (
            <button
              onClick={() => void reopen()}
              disabled={busy}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50"
            >
              Reopen
            </button>
          )}
        </span>
      </div>
      {actionError && <p className="mb-2 text-sm text-red-600">{actionError}</p>}
      {!budget.canEdit && budget.isCompiler && (status === 'submitted' || status === 'approved') && (
        <p className="mb-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          This budget is {status} and locked for editing.
        </p>
      )}

      <nav className="mb-3 flex gap-1 border-b border-slate-200">
        <NavLink to="" end className={tabClass}>Income Statement</NavLink>
        <NavLink to="revenue" className={tabClass}>Revenue</NavLink>
        <NavLink to="salaries" className={tabClass}>Salaries &amp; Cell Phones</NavLink>
        <NavLink to="vehicles" className={tabClass}>Vehicles</NavLink>
      </nav>

      <Routes>
        <Route index element={<StatementTab budget={budget} />} />
        <Route path="revenue" element={<RevenueTab budget={budget} />} />
        <Route path="salaries" element={<SalariesTab budget={budget} />} />
        <Route path="vehicles" element={<VehiclesTab budget={budget} />} />
      </Routes>
    </div>
  )
}
