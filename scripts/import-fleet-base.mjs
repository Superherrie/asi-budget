// Import base running costs per vehicle from the fleet workbook (Running + Lease
// sheets), matched to budget_vehicles by registration. Running-cost columns are
// 12-month totals (÷12); lease rental is already monthly.
//   node scripts/import-fleet-base.mjs "<fleet.xls>" [--apply]
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
  const file = process.argv[2]
  const apply = process.argv.includes('--apply')
  if (!file) { console.error('Usage: node scripts/import-fleet-base.mjs "<fleet.xls>" [--apply]'); process.exitCode = 1; return }

  const wb = XLSX.read(readFileSync(file))
  const run = XLSX.utils.sheet_to_json(wb.Sheets['Running'], { header: 1, blankrows: false })
  const H = run[0].map((h) => String(h).trim())
  const at = (name) => H.findIndex((h) => h === name)
  const num = (v) => Number(v) || 0
  const c = {
    fuel: at('Fuel Mth SUM'), oil: at('Oil Excl Vat'), rep: at('Repairs Excl Vat'), tyr: at('Tyres Excl  Vat'),
    acc: at('Accident Excl Vat'), mnt: at('Maint Excl Vat'), oth: at('Other Excl Vat'), toll: at('Toll Excl  Vat'),
  }
  const feeCols = H.map((h, i) => (/FEE/i.test(h) ? i : -1)).filter((i) => i >= 0)

  // reg -> { costType: monthlyAmount }
  const base = new Map()
  for (const r of run.slice(1).filter((r) => r[0])) {
    const reg = String(r[0]).trim().toUpperCase()
    base.set(reg, {
      'Fuel/Oil': (num(r[c.fuel]) + num(r[c.oil])) / 12,
      'Maintenance': (num(r[c.rep]) + num(r[c.tyr]) + num(r[c.acc]) + num(r[c.mnt]) + num(r[c.oth]) + feeCols.reduce((s, i) => s + num(r[i]), 0)) / 12,
      'Toll Fees': num(r[c.toll]) / 12,
    })
  }
  const lease = XLSX.utils.sheet_to_json(wb.Sheets['Lease'], { header: 1, blankrows: false })
  for (const r of lease.slice(1).filter((r) => r[0])) {
    const reg = String(r[0]).trim().toUpperCase()
    const b = base.get(reg) ?? {}; b['Lease/Rental'] = num(r[1]); base.set(reg, b)
  }

  const { createClient } = await import('@supabase/supabase-js')
  const sb = createClient(URL_, KEY, { auth: { persistSession: false } })
  const { data: veh } = await sb.from('budget_vehicles').select('id, registration')
  const byReg = new Map(veh.map((v) => [String(v.registration).toUpperCase(), v.id]))

  const rows = []
  let vehiclesWithBase = 0
  for (const [reg, costs] of base) {
    const vid = byReg.get(reg)
    if (!vid) continue
    let any = false
    for (const [cost_type, amount] of Object.entries(costs)) {
      const a = Math.round(amount * 100) / 100
      if (a === 0) continue
      rows.push({ vehicle_id: vid, cost_type, amount: a }); any = true
    }
    if (any) vehiclesWithBase++
  }

  console.log(`Fleet file: ${base.size} vehicles.  Matched to budget vehicles: ${vehiclesWithBase}.`)
  console.log(`Base rows to write: ${rows.length}`)
  const byType = {}
  for (const r of rows) byType[r.cost_type] = (byType[r.cost_type] || 0) + 1
  console.log('  by cost type:', JSON.stringify(byType))
  if (!apply) { console.log('\nDry run only. Re-run with --apply.'); return }

  // replace the full base set for a clean re-import
  await sb.from('budget_vehicle_base').delete().gt('id', 0)
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await sb.from('budget_vehicle_base').insert(rows.slice(i, i + 200))
    if (error) { console.error('FAILED:', error.message); process.exitCode = 1; return }
  }
  console.log(`\nImported ${rows.length} base cost rows.`)
}
