import { useEffect, useMemo, useState } from 'react'
import { computeStatement } from '../../lib/statement'
import { fmt, fmtPct } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import { monthsOf, type BudgetCtx } from '../../hooks/useBudget'
import type { Account } from '../../lib/types'

/** Collapse 12-month values to a single yearly slot, run the statement, and
 *  return each statement line's yearly figure keyed by line key. Mirrors the
 *  approach used by StatementTab / CompanyView so numbers tie out exactly. */
function yearlyByLine(accounts: Account[], values: Map<number, number[]> | undefined) {
  const single = new Map<number, number[]>()
  for (const [id, months] of values ?? []) {
    single.set(id, [months.reduce((s, v) => s + v, 0), ...Array(11).fill(0)])
  }
  const out = new Map<string, number>()
  for (const line of computeStatement(accounts, single)) out.set(line.key, line.months[0])
  return out
}

type MetricKind = 'money' | 'pct'

interface Metric {
  key: string // statement line key
  label: string
  kind: MetricKind
  emphasis?: boolean // headline profit lines — bold, ruled above
}

const METRICS: Metric[] = [
  { key: 't_sales', label: 'Revenue', kind: 'money', emphasis: true },
  { key: 't_mat', label: 'Material Cost', kind: 'money' },
  { key: 't_ops', label: 'Ops Cabling Cost', kind: 'money' },
  { key: 't_cos', label: 'Total Cost of Sales', kind: 'money' },
  { key: 't_gp', label: 'Gross Profit', kind: 'money', emphasis: true },
  { key: 'p_gp', label: 'GP %', kind: 'pct' },
  { key: 't_doh', label: 'Selling Expenses (DOH)', kind: 'money' },
  { key: 't_gop', label: 'Gross Operating Profit', kind: 'money', emphasis: true },
  { key: 'p_gop', label: 'GOP %', kind: 'pct' },
  { key: 't_ioh', label: 'Indirect Overheads', kind: 'money' },
  { key: 't_ebitda', label: 'EBITDA', kind: 'money', emphasis: true },
  { key: 'p_ebitda', label: 'EBITDA %', kind: 'pct' },
  { key: 't_ebitda_ho', label: 'EBITDA after HO Fees', kind: 'money' },
  { key: 't_ebit', label: 'EBIT', kind: 'money' },
  { key: 't_pbt', label: 'PBT', kind: 'money', emphasis: true },
  { key: 'p_pbt', label: 'PBT %', kind: 'pct' },
]

export default function SummaryTab({ budget }: { budget: BudgetCtx }) {
  const { cycle, cc, accounts, actuals } = budget
  const [budgetVals, setBudgetVals] = useState<Map<number, number[]>>(new Map())
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!cycle || !cc) return
    let cancelled = false
    void (async () => {
      const { data } = await supabase
        .from('budget_statement_lines')
        .select('*')
        .eq('cycle_id', cycle.id)
        .eq('cost_centre_id', cc.id)
      if (cancelled) return
      const m = new Map<number, number[]>()
      for (const row of data ?? []) m.set(row.account_id as number, monthsOf(row))
      setBudgetVals(m)
      setLoaded(true)
    })()
    return () => { cancelled = true }
  }, [cycle, cc])

  const prevFy = (cycle?.fy_year ?? 2027) - 1
  const actual = useMemo(() => yearlyByLine(accounts, actuals.get(prevFy)), [accounts, actuals, prevFy])
  const budgeted = useMemo(() => yearlyByLine(accounts, budgetVals), [accounts, budgetVals])

  if (!cycle || !cc) return null
  if (!loaded) return <div className="text-slate-500">Loading summary…</div>

  return (
    <div>
      <p className="mb-3 text-sm text-slate-500">
        High-level performance for <b>{cc.name}</b> — {prevFy - 1}/{String(prevFy).slice(2)} actual vs {' '}
        {cycle.name} budget. A positive change is favourable (more revenue / profit or lower cost).
      </p>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[36rem] text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-sky-50 text-sky-900">
              <th className="px-3 py-2 text-left font-semibold">Metric</th>
              <th className="px-3 py-2 text-right font-semibold">FY{prevFy} Actual</th>
              <th className="px-3 py-2 text-right font-semibold">{cycle.name} Budget</th>
              <th className="px-3 py-2 text-right font-semibold">Change</th>
              <th className="px-3 py-2 text-right font-semibold">Change %</th>
            </tr>
          </thead>
          <tbody>
            {METRICS.map((mtr) => {
              const a = actual.get(mtr.key) ?? 0
              const b = budgeted.get(mtr.key) ?? 0
              const delta = b - a
              const isPct = mtr.kind === 'pct'
              // Signed values: revenue/profit positive, costs negative, so a
              // positive change is always favourable — colour uniformly.
              const tone = delta > 0.0005 ? 'text-green-700' : delta < -0.0005 ? 'text-red-600' : 'text-slate-400'
              // pct rows show the point change in the Change column, so leave
              // Change % blank; money rows show a percentage move vs actual.
              const pctChange = isPct
                ? ''
                : a === 0
                  ? '-'
                  : `${delta >= 0 ? '+' : ''}${((delta / Math.abs(a)) * 100).toFixed(0)}%`
              return (
                <tr
                  key={mtr.key}
                  className={`border-b border-slate-100 ${
                    mtr.emphasis ? 'border-t border-slate-300 font-semibold text-sky-950' : ''
                  } ${isPct ? 'text-slate-500' : ''}`}
                >
                  <td className="px-3 py-2 text-left">{mtr.label}</td>
                  <td className="num-cell px-3 py-2 text-right">{isPct ? fmtPct(a) : fmt(a)}</td>
                  <td className="num-cell px-3 py-2 text-right">{isPct ? fmtPct(b) : fmt(b)}</td>
                  <td className={`num-cell px-3 py-2 text-right ${tone}`}>{isPct ? `${delta >= 0 ? '+' : '−'}${(Math.abs(delta) * 100).toFixed(1)} pp` : fmt(delta)}</td>
                  <td className={`num-cell px-3 py-2 text-right ${tone}`}>{pctChange}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
