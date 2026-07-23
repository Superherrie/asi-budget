// Updates budget_actuals from scripts/seed-data.json (produced by a seed.mjs
// dry run) WITHOUT re-upserting account metadata — so detail-driven input_types
// (material_pct, training, ho_alloc, etc.) set by later migrations are preserved.
// Any genuinely new cost centre / account is inserted as-is; existing rows are
// left untouched except for their actuals.
//
//   node scripts/seed.mjs "<workbook.xlsx>"      # regenerate seed-data.json first
//   node scripts/update-actuals.mjs
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
const URL = process.env.SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) { console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in scripts/.env'); process.exit(1) }

const data = JSON.parse(readFileSync(join(here, 'seed-data.json'), 'utf8'))
const { createClient } = await import('@supabase/supabase-js')
const sb = createClient(URL, KEY, { auth: { persistSession: false } })
const fail = (step, error) => { if (error) { console.error(`FAILED at ${step}:`, error.message ?? error); process.exit(1) } }

// existing maps
const ccMap = new Map(), accMap = new Map()
{
  const { data: ccs, error } = await sb.from('budget_cost_centres').select('id, code'); fail('read cost centres', error)
  for (const c of ccs) ccMap.set(String(c.code).toUpperCase(), c.id)
  const { data: accs, error: e2 } = await sb.from('budget_accounts').select('id, code'); fail('read accounts', e2)
  for (const a of accs) accMap.set(String(a.code), a.id)
}

// insert genuinely-new cost centres / accounts (do NOT touch existing input_types)
const newCcs = data.costCentres.filter((c) => !ccMap.has(String(c.code).toUpperCase()))
if (newCcs.length) {
  const { error } = await sb.from('budget_cost_centres').insert(newCcs); fail('insert new cost centres', error)
  console.log('Inserted new cost centres:', newCcs.map((c) => c.code).join(', '))
}
const newAccs = data.accounts.filter((a) => !accMap.has(String(a.code)))
if (newAccs.length) {
  const { error } = await sb.from('budget_accounts').insert(newAccs); fail('insert new accounts', error)
  console.log('Inserted new accounts:', newAccs.map((a) => `${a.code} ${a.name}`).join(', '))
}
if (newCcs.length || newAccs.length) {
  const { data: ccs } = await sb.from('budget_cost_centres').select('id, code')
  for (const c of ccs) ccMap.set(String(c.code).toUpperCase(), c.id)
  const { data: accs } = await sb.from('budget_accounts').select('id, code')
  for (const a of accs) accMap.set(String(a.code), a.id)
}

// upsert actuals only
const rows = data.actuals.map(({ cc, code, fyYear, months }) => ({
  fy_year: fyYear,
  cost_centre_id: ccMap.get(String(cc).toUpperCase()),
  account_id: accMap.get(String(code)),
  ...Object.fromEntries(months.map((v, i) => [`m${i + 1}`, Math.round(v * 100) / 100])),
}))
const missing = rows.filter((r) => !r.cost_centre_id || !r.account_id)
if (missing.length) { console.error(`ERROR: ${missing.length} actual rows have unknown cc/account — aborting.`); process.exit(1) }

for (let i = 0; i < rows.length; i += 500) {
  const { error } = await sb.from('budget_actuals')
    .upsert(rows.slice(i, i + 500), { onConflict: 'fy_year,cost_centre_id,account_id' })
  fail(`actuals batch ${i}`, error)
  process.stdout.write(`  actuals ${Math.min(i + 500, rows.length)}/${rows.length}\r`)
}
console.log(`\nDone. Upserted ${rows.length} actual rows (accounts/input_types untouched).`)
