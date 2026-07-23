// Populate budget_vehicles from the "Master - Running Cost on Fleet" sheet of
// the YTD fleet workbook. Registration deduped, so it's safe to re-run.
//   node scripts/import-fleet.mjs "<fleet.xls>"
import * as XLSX from 'xlsx'
import { readFileSync } from 'node:fs'
for (const l of readFileSync(new URL('./.env', import.meta.url), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].trim()
}
const Q = async (query) => {
  const r = await fetch('https://api.supabase.com/v1/projects/pniqwvyscmxfxbhtsace/database/query', {
    method: 'POST', headers: { Authorization: 'Bearer ' + process.env.SUPABASE_ACCESS_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const j = await r.json(); if (!r.ok) throw new Error(JSON.stringify(j)); return j
}

const BR = {
  'cape town': 'CPT', durban: 'DBN', 'head office': '000', kathu: 'KAT', 'east london': 'ESL',
  gauteng: 'GAU', 'rjr electrical': 'ZZZ', rustenburg: 'RST', secunda: 'SEC', mdb: 'MDB',
  vereeniging: 'VER', 'richards bay': 'RCH',
}

const path = process.argv[2]
if (!path) { console.error('Usage: node scripts/import-fleet.mjs "<fleet.xls>"'); process.exit(1) }
const wb = XLSX.read(readFileSync(path), { cellDates: true })
const rows = XLSX.utils.sheet_to_json(wb.Sheets['Master - Running Cost on Fleet'], { header: 1, raw: true })

const esc = (s) => String(s).replace(/'/g, "''")
const vals = []
const skips = []
const seenReg = new Set()
for (const r of rows.slice(1)) {
  const reg = String(r[3] || '').trim().toUpperCase()
  if (!/^[A-Z0-9]{4,}$/.test(reg)) continue
  if (seenReg.has(reg)) continue
  seenReg.add(reg)
  const code = BR[String(r[4] || '').trim().toLowerCase()]
  if (!code) { skips.push(`${reg}: unknown branch "${r[4]}"`); continue }
  const descr = [r[0], r[1], r[2]].filter((x) => x != null && String(x).trim()).join(' ').trim()
  vals.push(`('${code}','${esc(reg)}','${esc(descr)}')`)
}

console.log(`Prepared ${vals.length} vehicles, ${skips.length} skipped.`)
if (skips.length) console.log(skips.join('\n'))

const sql = `
insert into budget_vehicles (cost_centre_id, registration, description)
select cc.id, v.reg, v.descr
from (values ${vals.join(',')}) as v(code, reg, descr)
join budget_cost_centres cc on cc.code = v.code
where not exists (select 1 from budget_vehicles ex where ex.registration = v.reg);`
await Q(sql)
const [n] = await Q('select count(*)::int n from budget_vehicles')
console.log(`Done. budget_vehicles now has ${n.n} rows.`)
