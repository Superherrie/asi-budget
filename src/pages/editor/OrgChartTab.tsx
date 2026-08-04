import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { BudgetCtx } from '../../hooks/useBudget'
import type { Employee, Team } from '../../lib/types'

interface Row extends Employee {
  category: string
  teamId: number | null
}

const T = (s?: string) => (s ?? '').toUpperCase().trim()
const catSuffix = (name: string) => { const p = name.split(' - '); return p[p.length - 1] }

// Titles come from the payroll export and are truncated to ~15 chars,
// so match on prefixes ("SNR ADMINISTRAT", "ADMIN MAN & STO").
const isBranchManager = (t?: string) => T(t).includes('BRANCH MANAGER')
const isOpsManager = (t?: string) => T(t).includes('OPS MANAGER') || T(t).includes('OPERATIONS MANAGER')
const isAdminManager = (t?: string) => T(t).startsWith('ADMIN MAN')
const isSeniorAdmin = (t?: string) => T(t).startsWith('SNR ADMIN') || T(t).startsWith('SENIOR ADMIN')
const isTeamLeader = (t?: string) => T(t).includes('TEAM LEADER')

function Card({ e, tone = 'plain' }: { e: Row; tone?: 'top' | 'head' | 'plain' | 'muted' }) {
  const tones: Record<string, string> = {
    top: 'border-sky-800 bg-sky-800 text-white',
    head: 'border-sky-300 bg-sky-50 text-sky-950',
    plain: 'border-slate-200 bg-white text-slate-700',
    muted: 'border-slate-200 bg-slate-50 text-slate-600',
  }
  return (
    <div className={`rounded-md border px-2 py-1 ${tones[tone]}`}>
      <div className="text-xs font-semibold leading-tight">{e.name}</div>
      {e.title && <div className={`text-[10px] leading-tight ${tone === 'top' ? 'text-sky-200' : 'text-slate-400'}`}>{e.title}</div>}
    </div>
  )
}

function Column({ title, children, count }: { title: string; children: React.ReactNode; count: number }) {
  return (
    <div className="min-w-56 flex-1">
      <div className="mb-2 border-b border-slate-200 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {title} <span className="text-slate-400">· {count}</span>
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  )
}

export default function OrgChartTab({ budget }: { budget: BudgetCtx }) {
  const { cycle, cc, accounts } = budget
  const accById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts])
  const [rows, setRows] = useState<Row[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!cycle || !cc) return
    void (async () => {
      const { data: emps } = await supabase.from('budget_employees').select('*')
        .eq('cycle_id', cycle.id).eq('cost_centre_id', cc.id).eq('active', true).order('name')
      const empRows = (emps as Employee[]) ?? []
      const ids = empRows.map((e) => e.id!)
      let lines: Record<string, unknown>[] = []
      let members: Record<string, unknown>[] = []
      if (ids.length) {
        const [l, m] = await Promise.all([
          supabase.from('budget_employee_lines').select('employee_id, account_id, kind').in('employee_id', ids),
          supabase.from('budget_team_members').select('employee_id, team_id').in('employee_id', ids),
        ])
        lines = (l.data ?? []) as Record<string, unknown>[]
        members = (m.data ?? []) as Record<string, unknown>[]
      }
      const catOf = new Map<number, string>()
      for (const l of lines) {
        if (l.kind !== 'salary') continue
        const acc = accById.get(l.account_id as number)
        if (acc) catOf.set(l.employee_id as number, catSuffix(acc.name))
      }
      const teamOf = new Map<number, number>()
      for (const m of members) teamOf.set(m.employee_id as number, m.team_id as number)
      setRows(empRows.map((e) => ({ ...e, category: catOf.get(e.id!) ?? 'Unassigned', teamId: teamOf.get(e.id!) ?? null })))
      const { data: t } = await supabase.from('budget_teams').select('*').eq('cost_centre_id', cc.id).eq('active', true).order('name')
      setTeams((t as Team[]) ?? [])
      setLoaded(true)
    })()
  }, [cycle, cc, accById])

  if (!cycle || !cc) return null
  if (!loaded) return <div className="text-slate-500">Building organogram…</div>
  if (!rows.length) return <div className="text-slate-500">No employees in this cost centre yet.</div>

  const teamName = new Map(teams.map((t) => [t.id!, t.name]))
  const inCat = (c: string) => rows.filter((r) => r.category === c)

  // --- pick the key roles -------------------------------------------------
  const bm = rows.find((r) => isBranchManager(r.title))
  const opsMgrs = rows.filter((r) => r.category === 'Ops Cabling' && isOpsManager(r.title))
  const adminMgr = rows.find((r) => r.category === 'Admin' && isAdminManager(r.title))
  const seniorAdmin = rows.find((r) => r.category === 'Admin' && isSeniorAdmin(r.title))
  const adminHead = adminMgr ?? seniorAdmin
  const execs = inCat('Exec')

  const used = new Set<number>()
  const take = (e?: Row) => { if (e) used.add(e.id!) }
  take(bm); take(adminHead)
  opsMgrs.forEach((m) => used.add(m.id!))
  execs.forEach((e) => used.add(e.id!))

  // --- operations: grouped by the team each person is allocated to --------
  const ops = inCat('Ops Cabling').filter((r) => !used.has(r.id!))
  const byTeam = new Map<number, Row[]>()
  const noTeamOps: Row[] = []
  for (const o of ops) {
    if (o.teamId != null) (byTeam.get(o.teamId) ?? byTeam.set(o.teamId, []).get(o.teamId)!).push(o)
    else noTeamOps.push(o)
  }
  // team leaders sort to the top of their team; teams sort by name
  const teamGroups = [...byTeam.entries()]
    .map(([tid, members]) => ({
      tid,
      name: teamName.get(tid) ?? 'Team',
      members: [...members].sort((a, b) =>
        (isTeamLeader(b.title) ? 1 : 0) - (isTeamLeader(a.title) ? 1 : 0) || a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
  // team leaders with no team report to the Ops Manager directly;
  // other unallocated ops staff (assistants etc.) go in the "no team" bucket
  const noTeamLeaders = noTeamOps.filter((r) => isTeamLeader(r.title))
  const looseOps = noTeamOps.filter((r) => !isTeamLeader(r.title))

  const adminStaff = inCat('Admin').filter((r) => !used.has(r.id!))
  const opsAdmin = inCat('Ops Admin').filter((r) => !used.has(r.id!))
  const salesStaff = inCat('Sales').filter((r) => !used.has(r.id!))
  const unplaced = rows.filter((r) => r.category === 'Unassigned' && !used.has(r.id!))

  const opsHead = opsMgrs.length > 0 || !!bm
  const opsCount = ops.length + opsAdmin.length + opsMgrs.length

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        Built automatically from each employee’s title, category and team. It updates as people are added,
        titles change, or team allocations move — nothing here is captured by hand.
      </p>

      {execs.length > 0 && (
        <div className="flex flex-wrap justify-center gap-2">
          {execs.map((e) => <Card key={e.id} e={e} tone="head" />)}
        </div>
      )}

      {/* branch manager */}
      <div className="flex justify-center">
        {bm ? <div className="min-w-52"><Card e={bm} tone="top" /></div>
          : <div className="rounded-md border border-dashed border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-800">
              No Branch Manager in this cost centre — everyone below reports directly to the branch.
            </div>}
      </div>
      <div className="mx-auto h-4 w-px bg-slate-300" />

      {/* three reporting lines */}
      <div className="flex flex-wrap gap-6 border-t border-slate-200 pt-4">
        <Column title="Admin" count={adminStaff.length + (adminHead ? 1 : 0)}>
          {adminHead
            ? <>
                <Card e={adminHead} tone="head" />
                {!adminMgr && <p className="text-[10px] italic text-amber-700">No Admin Manager — senior admin heads this line</p>}
                <div className="ml-3 space-y-1.5 border-l border-slate-200 pl-3">
                  {adminStaff.map((e) => <Card key={e.id} e={e} />)}
                  {!adminStaff.length && <p className="text-[11px] text-slate-400">No admin staff</p>}
                </div>
              </>
            : <>
                <p className="text-[11px] italic text-amber-700">No Admin Manager or senior admin — reporting to the Branch Manager</p>
                {adminStaff.map((e) => <Card key={e.id} e={e} />)}
                {!adminStaff.length && <p className="text-[11px] text-slate-400">No admin staff</p>}
              </>}
        </Column>

        <Column title="Operations" count={opsCount}>
          {opsMgrs.length === 1 && <Card e={opsMgrs[0]} tone="head" />}
          {opsMgrs.length > 1 && (
            <div className="rounded-md border border-sky-300 bg-sky-50 p-1.5">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-sky-800">
                Operations Managers <span className="text-slate-400">· {opsMgrs.length}</span>
              </p>
              <div className="flex flex-wrap gap-1">
                {opsMgrs.map((m) => <Card key={m.id} e={m} tone="head" />)}
              </div>
            </div>
          )}
          {opsMgrs.length === 0 && (
            <p className="text-[11px] italic text-amber-700">No Ops Manager — teams report to the Branch Manager</p>
          )}
          <div className={opsHead ? 'ml-3 space-y-1.5 border-l border-slate-200 pl-3' : 'space-y-1.5'}>
            {teamGroups.map((g) => (
              <div key={g.tid} className="rounded-md border border-slate-200 bg-slate-50 p-1.5">
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-sky-800">
                  {g.name} <span className="text-slate-400">· {g.members.length}</span>
                </p>
                <div className="space-y-1">
                  {g.members.map((m) => <Card key={m.id} e={m} tone={isTeamLeader(m.title) ? 'head' : 'muted'} />)}
                </div>
              </div>
            ))}
            {noTeamLeaders.map((l) => <Card key={l.id} e={l} />)}
            {opsAdmin.map((e) => <Card key={e.id} e={e} tone="muted" />)}
            {looseOps.length > 0 && (
              <div className="rounded-md border border-dashed border-amber-300 bg-amber-50 p-2">
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                  Not allocated to a team · {looseOps.length}
                </p>
                <div className="space-y-1">
                  {looseOps.map((a) => <Card key={a.id} e={a} tone="muted" />)}
                </div>
              </div>
            )}
          </div>
        </Column>

        <Column title="Sales" count={salesStaff.length}>
          {salesStaff.map((e) => <Card key={e.id} e={e} />)}
          {!salesStaff.length && <p className="text-[11px] text-slate-400">No sales staff</p>}
        </Column>
      </div>

      {unplaced.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <p className="mb-1 text-xs font-semibold text-slate-500">
            No salary account set — cannot place these {unplaced.length} yet
          </p>
          <div className="flex flex-wrap gap-1.5">{unplaced.map((e) => <Card key={e.id} e={e} tone="muted" />)}</div>
        </div>
      )}

      <p className="text-xs text-slate-400">
        Rules: Branch Manager at the top. Admin Manager (or senior admin), Ops Manager and Sales report to them.
        Admin staff and cleaners report to the Admin Manager. Under Operations, staff are grouped by the team they
        are allocated to on the Salaries tab (the team leader heads each team); team leaders with no team, and staff
        allocated to no team, are listed separately. Ops-admin staff are shown under Operations.
      </p>
    </div>
  )
}
