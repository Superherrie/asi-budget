import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { MONTH_KEYS } from '../lib/months'
import type { Account, Approval, CostCentre, Cycle } from '../lib/types'

export function monthsOf(row: Record<string, unknown>): number[] {
  return MONTH_KEYS.map((k) => Number(row[k]) || 0)
}

export function monthCols(months: number[]): Record<string, number> {
  return Object.fromEntries(months.map((v, i) => [`m${i + 1}`, v]))
}

export interface BudgetCtx {
  loading: boolean
  error: string | null
  cycle: Cycle | null
  cc: CostCentre | null
  accounts: Account[]
  /** account_id -> 12 months, per FY (2025/2026 history) */
  actuals: Map<number, Map<number, number[]>>
  approval: Approval | null
  isCompiler: boolean
  isApprover: boolean
  /** true when current user may edit this CC's budget right now */
  canEdit: boolean
  latestActualIdx: number
  reloadApproval: () => Promise<void>
}

export function useBudget(ccCode: string | undefined): BudgetCtx {
  const { profile, assignments } = useAuth()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cycle, setCycle] = useState<Cycle | null>(null)
  const [cc, setCc] = useState<CostCentre | null>(null)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [actuals, setActuals] = useState<Map<number, Map<number, number[]>>>(new Map())
  const [approval, setApproval] = useState<Approval | null>(null)

  const reloadApproval = useCallback(async () => {
    if (!cycle || !cc) return
    const { data } = await supabase
      .from('budget_approvals')
      .select('*')
      .eq('cycle_id', cycle.id)
      .eq('cost_centre_id', cc.id)
      .maybeSingle()
    setApproval((data as Approval) ?? null)
  }, [cycle, cc])

  useEffect(() => {
    if (!ccCode) return
    let cancelled = false
    void (async () => {
      setLoading(true)
      setError(null)
      try {
        const [cycRes, ccRes, accRes] = await Promise.all([
          supabase.from('budget_cycles').select('*').eq('status', 'open')
            .order('fy_year', { ascending: false }).limit(1).maybeSingle(),
          supabase.from('budget_cost_centres').select('*').eq('code', ccCode).maybeSingle(),
          supabase.from('budget_accounts').select('*').order('sort_order'),
        ])
        if (cancelled) return
        if (!cycRes.data) throw new Error('No open budget cycle found')
        if (!ccRes.data) throw new Error(`Cost centre ${ccCode} not found or not accessible`)
        const ccRow = ccRes.data as CostCentre
        setCycle(cycRes.data as Cycle)
        setCc(ccRow)
        setAccounts((accRes.data as Account[]) ?? [])

        const [actRes, apprRes] = await Promise.all([
          supabase.from('budget_actuals').select('*').eq('cost_centre_id', ccRow.id),
          supabase.from('budget_approvals').select('*')
            .eq('cycle_id', (cycRes.data as Cycle).id).eq('cost_centre_id', ccRow.id).maybeSingle(),
        ])
        if (cancelled) return
        const map = new Map<number, Map<number, number[]>>()
        for (const row of actRes.data ?? []) {
          const fy = row.fy_year as number
          if (!map.has(fy)) map.set(fy, new Map())
          map.get(fy)!.set(row.account_id as number, monthsOf(row))
        }
        setActuals(map)
        setApproval((apprRes.data as Approval) ?? null)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [ccCode])

  const isCompiler = !!cc && (profile?.is_admin ||
    assignments.some((a) => a.cost_centre_id === cc.id && a.role === 'compiler'))
  const isApprover = !!cc && (profile?.is_admin ||
    assignments.some((a) => a.cost_centre_id === cc.id && a.role === 'approver'))
  const locked = approval?.status === 'submitted' || approval?.status === 'approved'
  const canEdit = isCompiler && !locked && cycle?.status === 'open'

  // last month of the most recent history FY that has any non-zero value
  const latestActualIdx = useMemo(() => {
    const fys = [...actuals.keys()]
    if (!fys.length) return 11
    const latest = actuals.get(Math.max(...fys))!
    for (let i = 11; i >= 0; i--) {
      for (const months of latest.values()) if (months[i] !== 0) return i
    }
    return 11
  }, [actuals])

  return {
    loading, error, cycle, cc, accounts, actuals, approval,
    isCompiler, isApprover, canEdit, latestActualIdx, reloadApproval,
  }
}
