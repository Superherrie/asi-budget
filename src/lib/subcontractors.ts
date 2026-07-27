import { supabase } from './supabase'

/**
 * Create a subcontractor entity plus its two budget lines: a revenue line
 * (in budget_revenue_lines, feeding Sales) and a cost line (in
 * budget_subcontractor_lines). Used from both the Revenue and Subcontractors
 * tabs so the same subcontractor appears on both. Returns an error message or null.
 */
export async function createSubcontractor(opts: {
  cycleId: number
  ccId: number
  salesAccountId: number
  name: string
  kind: 'electrical' | 'data' | 'civils'
}): Promise<string | null> {
  const { data: sc, error } = await supabase
    .from('budget_subcontractors')
    .insert({ cycle_id: opts.cycleId, cost_centre_id: opts.ccId, name: opts.name, kind: opts.kind })
    .select()
    .single()
  if (error || !sc) return error?.message ?? 'Could not create subcontractor'

  const [rev, cost] = await Promise.all([
    supabase.from('budget_revenue_lines').insert({
      cycle_id: opts.cycleId, cost_centre_id: opts.ccId, account_id: opts.salesAccountId, subcontractor_id: sc.id,
    }),
    supabase.from('budget_subcontractor_lines').insert({
      cycle_id: opts.cycleId, cost_centre_id: opts.ccId, subcontractor_id: sc.id,
    }),
  ])
  return rev.error?.message ?? cost.error?.message ?? null
}

/** Delete a subcontractor; its revenue and cost lines cascade away. */
export async function removeSubcontractor(id: number): Promise<string | null> {
  const { error } = await supabase.from('budget_subcontractors').delete().eq('id', id)
  return error?.message ?? null
}

export async function setSubcontractorKind(id: number, kind: 'electrical' | 'data' | 'civils'): Promise<string | null> {
  const { error } = await supabase.from('budget_subcontractors').update({ kind }).eq('id', id)
  return error?.message ?? null
}
