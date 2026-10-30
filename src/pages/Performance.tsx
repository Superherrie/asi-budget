import { Fragment, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { computeStatement } from '../lib/statement'
import { fmt, fmtPct } from '../lib/format'
import { groupByVertical } from '../lib/verticals'
import { useAuth } from '../context/AuthContext'
import type { Account } from '../lib/types'

type Row = Record<string, unknown>
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// PostgREST caps a response at 1000 rows — page through budget_actuals (~3k rows).
async function fetchAllRows(page: (from: number, to: number) => PromiseLike<{ data: Row[] | null }>): Promise<Row[]> {
  const SIZE = 1000; const all: Row[] = []
  for (let from = 0; ; from += SIZE) {
    const { data } = await page(from, from + SIZE - 1)
    const rows = data ?? []; all.push(...rows)
    if (rows.length < SIZE) break
  }
  return all
}

// FY month k (1=Jul of fy-1 … 12=Jun of fy) -> global calendar index (year*12 + month0)
const calIdx = (fy: number, k: number) => {
  const cy = k <= 6 ? fy - 1 : fy
  const cm = k <= 6 ? k + 6 : k - 6
  return cy * 12 + (cm - 1)
}
const giLabel = (gi: number) => `${MON[gi % 12]} ${String(Math.floor(gi / 12)).slice(2)}`

export default function Performance() {
  const { costCentres, profile } = useAuth()
  const [accounts, setAccounts] = useState<Account[]>([])
  // ccId -> accountId -> (global month index -> value)
  const [byCc, setByCc] = useState<Map<number, Map<number, Map<number, number>>>>(new Map())
  const [loaded, setLoaded] = useState(false)
  const [period, setPeriod] = useState<'r12' | 'cm'>('r12')

  useEffect(() => {
    void (async () => {
      const [accRes, demoRes, actRows] = await Promise.all([
        supabase.from('budget_accounts').select('*').order('sort_order'),
        supabase.from('budget_cost_centres').select('id').eq('code', 'DEMO'),
        fetchAllRows((f, t) => supabase.from('budget_actuals').select('*').range(f, t)),
      ])
      setAccounts((accRes.data as Account[]) ?? [])
      const demo = new Set<number>(((demoRes.data ?? []) as { id: number }[]).map((r) => r.id))
      const m = new Map<number, Map<number, Map<number, number>>>()
      for (const r of actRows) {
        const cc = r.cost_centre_id as number
        if (demo.has(cc)) continue
        const fy = r.fy_year as number
        const accId = r.account_id as number
        let accMap = m.get(cc); if (!accMap) { accMap = new Map(); m.set(cc, accMap) }
        let giMap = accMap.get(accId); if (!giMap) { giMap = new Map(); accMap.set(accId, giMap) }
        for (let k = 1; k <= 12; k++) {
          const v = Number(r[`m${k}`]) || 0
          if (v) giMap.set(calIdx(fy, k), (giMap.get(calIdx(fy, k)) || 0) + v)
        }
      }
      setByCc(m)
      setLoaded(true)
    })()
  }, [])

  const salesAccIds = useMemo(() => new Set(accounts.filter((a) => a.section === 'sales').map((a) => a.id)), [accounts])
  const ccs = useMemo(() => costCentres.filter((c) => c.code !== 'DEMO'), [costCentres])

  // sum a set of cost centres over a set of months -> accountId -> total
  const sumPeriod = (ccIds: number[], gis: number[]) => {
    const out = new Map<number, number>()
    for (const cc of ccIds) {
      const accMap = byCc.get(cc); if (!accMap) continue
      for (const [accId, giMap] of accMap) {
        let s = 0; for (const gi of gis) s += giMap.get(gi) || 0
        if (s) out.set(accId, (out.get(accId) || 0) + s)
      }
    }
    return out
  }
  // run the statement over a period total -> key -> value
  const stmtOf = (accSums: Map<number, number>) => {
    const values = new Map<number, number[]>()
    for (const [accId, v] of accSums) values.set(accId, [v, ...Array(11).fill(0)])
    const out = new Map<string, number>()
    for (const line of computeStatement(accounts, values)) out.set(line.key, line.months[0])
    return out
  }

  if (!loaded) return <div className="text-slate-500">Loading performance…</div>
  if (!profile?.is_admin) return <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Company performance reporting is available to administrators.</div>

  const allCc = ccs.map((c) => c.id)
  // latest posted month = newest month with company sales
  let latest = -1
  {
    const salesByGi = new Map<number, number>()
    for (const cc of allCc) {
      const accMap = byCc.get(cc); if (!accMap) continue
      for (const [accId, giMap] of accMap) {
        if (!salesAccIds.has(accId)) continue
        for (const [gi, v] of giMap) salesByGi.set(gi, (salesByGi.get(gi) || 0) + v)
      }
    }
    for (const [gi, v] of salesByGi) if (v !== 0 && gi > latest) latest = gi
  }
  if (latest < 0) return <div className="text-slate-500">No actuals posted yet.</div>

  const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i)
  const r12 = range(latest - 11, latest), p12 = range(latest - 23, latest - 12)
  const cm = [latest], pm = [latest - 12]
  const gis = period === 'r12' ? r12 : cm
  const compGis = period === 'r12' ? p12 : pm
  const periodLabel = period === 'r12' ? `Rolling 12 months · ${giLabel(latest - 11)} – ${giLabel(latest)}` : `${giLabel(latest)} (month)`
  const compLabel = period === 'r12' ? `prior 12 (${giLabel(latest - 23)} – ${giLabel(latest - 12)})` : `${giLabel(latest - 12)}`

  // metrics helpers
  const M = (keys: Map<string, number>) => {
    const g = (k: string) => keys.get(k) ?? 0
    const s = g('t_sales')
    return { sales: s, gp: g('t_gp'), ebitda: g('t_ebitda'), ebitdaHo: g('t_ebitda_ho'), pbt: g('t_pbt'),
      gpPct: s ? g('t_gp') / s : 0, ebHoPct: s ? g('t_ebitda_ho') / s : 0 }
  }
  const metricsFor = (ccIds: number[], g: number[]) => M(stmtOf(sumPeriod(ccIds, g)))

  const group = metricsFor(allCc, gis)
  const groupComp = metricsFor(allCc, compGis)
  const pctChange = (cur: number, prior: number) => (prior ? (cur - prior) / Math.abs(prior) : null)
  const deltaTone = (d: number | null) => d == null ? 'text-slate-400' : d > 0.0005 ? 'text-green-700' : d < -0.0005 ? 'text-red-600' : 'text-slate-400'
  const deltaStr = (d: number | null) => d == null ? 'n/m' : `${d >= 0 ? '+' : ''}${(d * 100).toFixed(0)}%`

  const kpis = [
    { label: 'Revenue', val: fmt(group.sales), d: pctChange(group.sales, groupComp.sales), sub: null as string | null },
    { label: 'Gross profit', val: fmt(group.gp), d: pctChange(group.gp, groupComp.gp), sub: `GP ${fmtPct(group.gpPct)}` },
    { label: 'EBITDA after HO', val: fmt(group.ebitdaHo), d: pctChange(group.ebitdaHo, groupComp.ebitdaHo), sub: `${fmtPct(group.ebHoPct)} of rev` },
    { label: 'Profit before tax', val: fmt(group.pbt), d: pctChange(group.pbt, groupComp.pbt), sub: null },
  ]

  // by-vertical / branch table
  const groups = groupByVertical(ccs)
  const ccName = new Map(ccs.map((c) => [c.id, `${c.code} — ${c.name}`]))

  // trend: last 14 months, company sales + EBITDA after HO
  const trendGis = range(Math.max(latest - 13, 0), latest)
  const trend = trendGis.map((gi) => { const m = M(stmtOf(sumPeriod(allCc, [gi]))); return { gi, sales: m.sales, ebitdaHo: m.ebitdaHo } })
  const trendMax = Math.max(1, ...trend.map((t) => Math.max(t.sales, t.ebitdaHo)))

  const MetricRow = ({ label, m, comp, head, indent }: { label: string; m: ReturnType<typeof M>; comp: ReturnType<typeof M>; head?: 'sub' | 'tot'; indent?: boolean }) => {
    const d = pctChange(m.sales, comp.sales)
    const de = pctChange(m.ebitdaHo, comp.ebitdaHo)
    const cls = head === 'tot' ? 'bg-brand-navy text-white font-semibold' : head === 'sub' ? 'bg-slate-100 font-semibold' : 'border-t border-slate-100'
    return (
      <tr className={cls}>
        <td className={`px-2 py-1 ${indent ? 'pl-4' : ''}`}>{label}</td>
        <td className="num-cell px-2 py-1">{fmt(m.sales)}</td>
        <td className={`num-cell px-2 py-1 ${head === 'tot' ? 'text-sky-200' : deltaTone(d)}`}>{deltaStr(d)}</td>
        <td className="num-cell px-2 py-1">{fmtPct(m.gpPct)}</td>
        <td className="num-cell px-2 py-1">{fmt(m.ebitdaHo)}</td>
        <td className={`num-cell px-2 py-1 ${head === 'tot' ? 'text-sky-200' : deltaTone(de)}`}>{deltaStr(de)}</td>
        <td className="num-cell px-2 py-1">{fmtPct(m.ebHoPct)}</td>
        <td className="num-cell px-2 py-1">{fmt(m.pbt)}</td>
      </tr>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold text-sky-950">Performance — Actuals</h1>
        <div className="inline-flex overflow-hidden rounded-md border border-slate-300 text-sm">
          <button onClick={() => setPeriod('r12')} className={`px-3 py-1 ${period === 'r12' ? 'bg-sky-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>Rolling 12 months</button>
          <button onClick={() => setPeriod('cm')} className={`px-3 py-1 ${period === 'cm' ? 'bg-sky-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>Current month</button>
        </div>
        <span className="text-sm text-slate-500">{periodLabel} · vs {compLabel}</span>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{k.label}</div>
            <div className="mt-1 text-lg font-semibold tabular-nums text-sky-950">{k.val}</div>
            <div className="mt-0.5 flex items-center gap-2 text-xs">
              <span className={deltaTone(k.d)}>{deltaStr(k.d)}</span>
              {k.sub && <span className="text-slate-400">{k.sub}</span>}
            </div>
          </div>
        ))}
      </div>

      {/* trend */}
      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-sky-950">Monthly trend — Revenue &amp; EBITDA after HO</h3>
          <div className="flex items-center gap-3 text-[11px] text-slate-500">
            <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm bg-sky-800" /> Revenue</span>
            <span className="inline-flex items-center gap-1"><span className="inline-block h-0.5 w-3 bg-brand-pink" /> EBITDA aHO</span>
          </div>
        </div>
        <svg viewBox={`0 0 ${trend.length * 60} 180`} className="h-44 w-full" preserveAspectRatio="none">
          {trend.map((t, i) => {
            const x = i * 60, bh = (t.sales / trendMax) * 140
            return <rect key={t.gi} x={x + 14} y={160 - bh} width={32} height={Math.max(bh, 0)} className="fill-sky-800/85" />
          })}
          <polyline
            points={trend.map((t, i) => `${i * 60 + 30},${160 - (t.ebitdaHo / trendMax) * 140}`).join(' ')}
            className="fill-none stroke-brand-pink" strokeWidth={2}
          />
          {trend.map((t, i) => <circle key={t.gi} cx={i * 60 + 30} cy={160 - (t.ebitdaHo / trendMax) * 140} r={2.5} className="fill-brand-pink" />)}
          {trend.map((t, i) => <text key={t.gi} x={i * 60 + 30} y={174} textAnchor="middle" className="fill-slate-400 text-[9px]">{giLabel(t.gi)}</text>)}
        </svg>
      </div>

      {/* by vertical / branch */}
      <div className="overflow-auto rounded-lg border border-slate-300 bg-white">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-brand-navy text-white">
              <th className="px-2 py-1.5 text-left font-medium">Division / branch</th>
              <th className="px-2 py-1.5 text-right font-medium">Revenue</th>
              <th className="px-2 py-1.5 text-right font-medium">Δ vs prior</th>
              <th className="px-2 py-1.5 text-right font-medium">GP %</th>
              <th className="px-2 py-1.5 text-right font-medium">EBITDA aHO</th>
              <th className="px-2 py-1.5 text-right font-medium">Δ aHO</th>
              <th className="px-2 py-1.5 text-right font-medium">aHO %</th>
              <th className="px-2 py-1.5 text-right font-medium">PBT</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <Fragment key={g.label}>
                <tr className="bg-sky-100/70 text-sky-900"><td colSpan={8} className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide">{g.label}</td></tr>
                {g.ccs.map((cc) => <MetricRow key={cc.id} label={ccName.get(cc.id) ?? cc.code} indent m={metricsFor([cc.id], gis)} comp={metricsFor([cc.id], compGis)} />)}
                <MetricRow label={`Total ${g.label}`} head="sub" m={metricsFor(g.ccs.map((c) => c.id), gis)} comp={metricsFor(g.ccs.map((c) => c.id), compGis)} />
              </Fragment>
            ))}
            <MetricRow label="Group — ASI Connect ICS" head="tot" m={group} comp={groupComp} />
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-400">
        Actuals from the budget system. Rolling 12 compares the last 12 posted months against the 12 before; current
        month compares against the same month a year earlier. Δ columns are % change on revenue / EBITDA after HO.
      </p>
    </div>
  )
}
