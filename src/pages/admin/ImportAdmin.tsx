import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { monthCols } from '../../hooks/useBudget'
import { parseAmount } from '../../lib/format'

type Kind = 'employees' | 'vehicles' | 'customers' | 'teams'

const TEMPLATES: Record<Kind, { header: string; hint: string }> = {
  employees: {
    header: 'cc_code,name,title,salary_account_code,monthly_salary,cellphone_account_code,monthly_cell',
    hint: 'e.g. GAU,John Smith,Technician,212600,28500,210100,650 — accounts by code; amounts positive (stored as costs). cellphone columns optional.',
  },
  vehicles: { header: 'cc_code,registration,description', hint: 'e.g. GAU,ABC123GP,Toyota Hilux — J Smith' },
  customers: { header: 'cc_code,name', hint: 'e.g. GAU,Capitec Bank' },
  teams: { header: 'cc_code,name', hint: 'e.g. GAU,Team Sipho' },
}

/** Minimal CSV line parser with quote support. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  for (const line of text.replace(/\r/g, '').split('\n')) {
    if (!line.trim()) continue
    const cells: string[] = []
    let cur = ''
    let inQ = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (inQ) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++ }
        else if (ch === '"') inQ = false
        else cur += ch
      } else if (ch === '"') inQ = true
      else if (ch === ',') { cells.push(cur.trim()); cur = '' }
      else cur += ch
    }
    cells.push(cur.trim())
    rows.push(cells)
  }
  return rows
}

export default function ImportAdmin() {
  const [kind, setKind] = useState<Kind>('employees')
  const [text, setText] = useState('')
  const [log, setLog] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  async function run() {
    setBusy(true)
    const out: string[] = []
    try {
      let rows = parseCsv(text)
      if (!rows.length) throw new Error('Nothing to import')
      // drop header row if present
      if (rows[0][0].toLowerCase() === 'cc_code') rows = rows.slice(1)

      const { data: ccs } = await supabase.from('budget_cost_centres').select('id, code')
      const ccMap = new Map((ccs ?? []).map((c) => [String(c.code).toUpperCase(), c.id as number]))
      const { data: accs } = await supabase.from('budget_accounts').select('id, code')
      const accMap = new Map((accs ?? []).map((a) => [String(a.code), a.id as number]))
      const { data: cyc } = await supabase.from('budget_cycles').select('*').eq('status', 'open')
        .order('fy_year', { ascending: false }).limit(1).maybeSingle()
      if (kind === 'employees' && !cyc) throw new Error('No open budget cycle')

      let ok = 0
      for (const [i, row] of rows.entries()) {
        const ccId = ccMap.get(row[0]?.toUpperCase())
        if (!ccId) { out.push(`Row ${i + 1}: unknown cost centre "${row[0]}" — skipped`); continue }
        try {
          if (kind === 'employees') {
            const [, name, title, salAccCode, salary, cellAccCode, cell] = row
            const salAcc = accMap.get(salAccCode)
            if (!name || !salAcc) { out.push(`Row ${i + 1}: missing name or unknown salary account "${salAccCode}" — skipped`); continue }
            const { data: emp, error } = await supabase.from('budget_employees')
              .insert({ cycle_id: cyc!.id, cost_centre_id: ccId, name, title: title ?? '', is_new: false })
              .select().single()
            if (error) throw error
            const sal = Math.abs(parseAmount(salary ?? '') ?? 0)
            const inserts: Record<string, unknown>[] = [
              { employee_id: emp.id, kind: 'salary', account_id: salAcc, ...monthCols(Array(12).fill(-sal)) },
            ]
            const cellAcc = cellAccCode ? accMap.get(cellAccCode) : undefined
            if (cellAcc) {
              const cl = Math.abs(parseAmount(cell ?? '') ?? 0)
              inserts.push({ employee_id: emp.id, kind: 'cellphone', account_id: cellAcc, ...monthCols(Array(12).fill(-cl)) })
            }
            const { error: e2 } = await supabase.from('budget_employee_lines').insert(inserts)
            if (e2) throw e2
          } else if (kind === 'vehicles') {
            const { error } = await supabase.from('budget_vehicles')
              .insert({ cost_centre_id: ccId, registration: (row[1] ?? '').toUpperCase(), description: row[2] ?? '' })
            if (error) throw error
          } else {
            const table = kind === 'customers' ? 'budget_customers' : 'budget_teams'
            const { error } = await supabase.from(table).insert({ cost_centre_id: ccId, name: row[1] ?? '' })
            if (error) throw error
          }
          ok++
        } catch (e) {
          out.push(`Row ${i + 1}: ${(e as Error).message}`)
        }
      }
      out.unshift(`Imported ${ok} of ${rows.length} rows.`)
    } catch (e) {
      out.push(`Import failed: ${(e as Error).message}`)
    }
    setLog(out)
    setBusy(false)
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500">
        Pre-populate budget detail by pasting CSV data (straight from Excel: select columns, copy, paste here —
        then replace tabs with commas, or export as CSV).
      </p>
      <div className="flex items-center gap-2">
        <select value={kind} onChange={(e) => { setKind(e.target.value as Kind); setLog([]) }}
          className="rounded border border-slate-300 bg-white px-2 py-1 text-sm">
          <option value="employees">Employees (salaries &amp; cell phones)</option>
          <option value="vehicles">Vehicles</option>
          <option value="customers">Customers</option>
          <option value="teams">Teams</option>
        </select>
        <code className="rounded bg-slate-100 px-2 py-1 text-xs">{TEMPLATES[kind].header}</code>
      </div>
      <p className="text-xs text-slate-400">{TEMPLATES[kind].hint}</p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={12}
        placeholder={TEMPLATES[kind].header + '\n…'}
        className="w-full rounded-lg border border-slate-300 p-3 font-mono text-xs"
      />
      <button onClick={() => void run()} disabled={busy || !text.trim()}
        className="rounded-md bg-sky-800 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50">
        {busy ? 'Importing…' : 'Import'}
      </button>
      {log.length > 0 && (
        <pre className="max-h-60 overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">{log.join('\n')}</pre>
      )}
    </div>
  )
}
