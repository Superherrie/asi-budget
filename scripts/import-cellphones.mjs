// Import the Vodacom master billing list and match each cellphone to an
// employee. Amount = that month's "Total" column (excluding VAT). Anything that
// cannot be matched to an employee is parked in cost centre ZZZ.
//
//   node scripts/import-cellphones.mjs "<file.xlsx>" [MONTH]           # dry run
//   node scripts/import-cellphones.mjs "<file.xlsx>" [MONTH] --apply
//
// MONTH is the label in the workbook's month row, default JUN'26.
import * as XLSX from 'xlsx'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const envPath = join(here, '.env')
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)\s*=\s*(.+)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
}
const URL_ = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL_ || !KEY) { console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in scripts/.env'); process.exitCode = 1 }
else await main()

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== '--apply')
  const file = args[0]
  const monthLabel = (args[1] || "JUN'26").toUpperCase()
  const apply = process.argv.includes('--apply')
  if (!file) { console.error('Usage: node scripts/import-cellphones.mjs "<file.xlsx>" [MONTH] [--apply]'); process.exitCode = 1; return }

  // ---- parse the Master sheet -------------------------------------------
  const wb = XLSX.read(readFileSync(file))
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['Master'], { header: 1, blankrows: false })
  const monthRow = rows.find((r) => r.some((v) => String(v || '').toUpperCase().includes("JAN'"))) ?? []
  const col = monthRow.findIndex((v) => String(v || '').toUpperCase().includes(monthLabel))
  if (col < 0) { console.error(`Could not find a "${monthLabel}" column. Months found: ${monthRow.filter(Boolean).join(', ')}`); process.exitCode = 1; return }
  const mon = monthLabel.replace(/[^A-Z0-9]/g, '') // JUN26
  const MONTHS = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' }
  const period = `20${mon.slice(-2)}-${MONTHS[mon.slice(0, 3)]}-01`

  const data = rows.slice(4).filter((r) => r[0]).map((r) => ({
    cell: String(r[0]).trim(), package: String(r[1] ?? '').trim(), name: String(r[2] ?? '').trim(),
    gl: String(r[4] ?? '').trim(), branch: String(r[5] ?? '').toUpperCase().trim(), amount: Number(r[col]) || 0,
  }))

  // ---- match to employees ------------------------------------------------
  const { createClient } = await import('@supabase/supabase-js')
  const sb = createClient(URL_, KEY, { auth: { persistSession: false } })
  const { data: cyc } = await sb.from('budget_cycles').select('id').eq('status', 'open').order('fy_year', { ascending: false }).limit(1).maybeSingle()
  if (!cyc) { console.error('No open budget cycle'); process.exitCode = 1; return }
  const { data: ccs } = await sb.from('budget_cost_centres').select('id, code')
  const ccMap = new Map(ccs.map((c) => [String(c.code).toUpperCase(), c.id]))
  const zzz = ccMap.get('ZZZ')
  if (!zzz) { console.error('No ZZZ cost centre to park unmatched phones in'); process.exitCode = 1; return }
  const { data: empRows } = await sb.from('budget_employees').select('id, name, cost_centre_id').eq('cycle_id', cyc.id).eq('active', true)
  const ccCode = new Map(ccs.map((c) => [c.id, String(c.code).toUpperCase()]))

  const BR = new Set([...ccMap.keys(), 'HO', 'GPN', 'CP', 'PMO'])
  const norm = (s) => String(s || '').toUpperCase().replace(/\(.*?\)/g, ' ').replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim()
  const toks = (s) => norm(s).split(' ').filter((t) => t.length > 1 && !BR.has(t))
  const lev = (a, b) => {
    const m = a.length, n = b.length
    const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)])
    for (let j = 1; j <= n; j++) d[0][j] = j
    for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    return d[m][n]
  }
  const emps = empRows.map((e) => ({ ...e, tok: toks(e.name), branch: ccCode.get(e.cost_centre_id) }))
  const pick = (c, d) => { if (c.length === 1) return c[0]; const b = c.filter((x) => x.branch === d.branch); return b.length === 1 ? b[0] : null }

  // progressively fuzzier tiers; each must resolve to exactly one employee
  function match(d) {
    const t = toks(d.name); if (!t.length) return [null, '']
    const f = t[0], l = t[t.length - 1], j = t.join('')
    const tiers = [
      ['exact', (e) => e.tok.join(' ') === t.join(' ')],
      ['first+last', (e) => e.tok[0] === f && e.tok[e.tok.length - 1] === l],
      ['truncated', (e) => { const a = e.tok.join(''); return a.length >= 8 && j.length >= 8 && (a.startsWith(j) || j.startsWith(a)) }],
      ['surname~', (e) => e.tok[0] === f && lev(e.tok[e.tok.length - 1], l) <= 2],
      ['firstname~', (e) => e.tok[e.tok.length - 1] === l && lev(e.tok[0], f) <= 2],
      ['both~', (e) => lev(e.tok[0], f) <= 2 && lev(e.tok[e.tok.length - 1], l) <= 2],
    ]
    for (const [tier, test] of tiers) { const e = pick(emps.filter((x) => x.tok.length && test(x)), d); if (e) return [e, tier] }
    return [null, '']
  }

  const out = [], fuzzy = []
  let matched = 0, matchedVal = 0, parked = 0, parkedVal = 0
  for (const d of data) {
    const [e, tier] = match(d)
    if (e) { matched++; matchedVal += d.amount; if (tier !== 'exact') fuzzy.push(`${d.name}  ->  ${e.name}  (${tier})`) }
    else { parked++; parkedVal += d.amount }
    out.push({
      cost_centre_id: e ? e.cost_centre_id : zzz,
      employee_id: e ? e.id : null,
      cell_no: d.cell, package: d.package, billed_name: d.name, gl_code: d.gl,
      period, amount: Math.round(d.amount * 100) / 100,
    })
  }

  console.log(`${data.length} cellphones from ${file}`)
  console.log(`  period ${period} (${monthLabel}), total R${data.reduce((s, d) => s + d.amount, 0).toFixed(2)}`)
  console.log(`  matched to an employee : ${matched}  R${matchedVal.toFixed(2)}`)
  console.log(`  parked in ZZZ          : ${parked}  R${parkedVal.toFixed(2)}`)
  if (fuzzy.length) { console.log(`\n  ${fuzzy.length} fuzzy matches:`); fuzzy.forEach((f) => console.log('    ' + f)) }
  if (!apply) { console.log('\nDry run only. Re-run with --apply to import.'); return }

  for (let i = 0; i < out.length; i += 200) {
    const { error } = await sb.from('budget_cellphones').upsert(out.slice(i, i + 200), { onConflict: 'cell_no,period' })
    if (error) { console.error('FAILED:', error.message); process.exitCode = 1; return }
  }
  console.log(`\nImported ${out.length} cellphone records.`)
}
