// One-off: populate budget_employees + salary lines from a payroll CSV via the
// Management API. Mirrors the admin "Payroll file" importer.
//   node scripts/import-payroll.mjs "<path to payroll.csv>"
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
const REF = 'pniqwvyscmxfxbhtsace'
const token = process.env.SUPABASE_ACCESS_TOKEN?.trim()
if (!token) { console.error('SUPABASE_ACCESS_TOKEN missing in scripts/.env'); process.exit(1) }

const Q = async (query) => {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const j = await res.json()
  if (!res.ok) throw new Error(JSON.stringify(j))
  return j
}

// ICS staff -> salary accounts; other companies (e.g. Hlanganisa) -> Consulting Fees.
const CAT = { executive: '410000', sales: '212800', admin: '212500', operations: '212600', 'operations admin': '212700' }
const CONSULT = { executive: '407300', sales: '407100', admin: '407000', operations: '407200', 'operations admin': '407000' }
const isIcs = (c) => (c || '').trim().toLowerCase() === 'asi connect ics'

const csvPath = process.argv[2]
if (!csvPath) { console.error('Usage: node scripts/import-payroll.mjs "<payroll.csv>"'); process.exit(1) }

const [cyc] = await Q('select id from budget_cycles where fy_year=2027')
const ccs = await Q('select id, code from budget_cost_centres')
const ccMap = new Map(ccs.map((c) => [String(c.code).toUpperCase(), c.id]))
const accs = await Q('select id, code from budget_accounts')
const accMap = new Map(accs.map((a) => [String(a.code), a.id]))

let rows = readFileSync(csvPath, 'utf8').replace(/\r/g, '').split('\n').filter((l) => l.trim()).map((l) => l.split(','))
if (rows[0][0].toLowerCase() === 'emp_no') rows = rows.slice(1)

const esc = (s) => String(s).replace(/'/g, "''")
const vals = []
const seen = new Set()
const skips = []
for (const [i, r] of rows.entries()) {
  const cc = ccMap.get((r[4] || '').toUpperCase())
  const name = `${r[1] || ''} ${r[2] || ''}`.trim().replace(/\s+/g, ' ')
  const catMap = isIcs(r[3]) ? CAT : CONSULT
  const acc = accMap.get(catMap[(r[5] || '').trim().toLowerCase()])
  if (!cc) { skips.push(`row ${i + 1}: unknown branch ${r[4]}`); continue }
  if (!name) { skips.push(`row ${i + 1}: no name`); continue }
  if (!acc) { skips.push(`row ${i + 1}: unknown category ${r[5]}`); continue }
  const key = `${cc}|${name.toLowerCase()}`
  if (seen.has(key)) { skips.push(`row ${i + 1}: dup ${name}`); continue }
  seen.add(key)
  const monthly = Math.abs(parseFloat(r[8]) || 0)
  vals.push(`(${cc},'${esc(name)}','${esc(r[6] || '')}',${acc},${monthly})`)
}

const c = cyc.id
const neg = Array(12).fill('-d.monthly').join(',')
const sql = `
with data(cost_centre_id,name,title,sal_acc,monthly) as (values ${vals.join(',')}),
ins as (
  insert into budget_employees (cycle_id,cost_centre_id,name,title,is_new,active)
  select ${c}, d.cost_centre_id, d.name, d.title, false, true
  from data d
  where not exists (
    select 1 from budget_employees e
    where e.cycle_id=${c} and e.cost_centre_id=d.cost_centre_id and lower(e.name)=lower(d.name))
  returning id,cost_centre_id,name
)
insert into budget_employee_lines (employee_id,kind,account_id,m1,m2,m3,m4,m5,m6,m7,m8,m9,m10,m11,m12)
select ins.id, 'salary', d.sal_acc, ${neg}
from ins join data d on d.cost_centre_id=ins.cost_centre_id and lower(d.name)=lower(ins.name);`

console.log(`Prepared ${vals.length} employees, ${skips.length} skipped.`)
if (skips.length) console.log(skips.join('\n'))
await Q(sql)
console.log('Inserted.')
