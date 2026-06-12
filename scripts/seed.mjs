// Seed script: parses the ICS income statement workbook and loads
// cost centres, chart of accounts and FY actuals into Supabase.
//
// Usage:
//   node scripts/seed.mjs <workbook.xlsx>            -> dry run: writes scripts/seed-data.json + validation report
//   node scripts/seed.mjs <workbook.xlsx> --apply    -> also pushes to Supabase
//
// --apply requires env vars (or scripts/.env file):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import * as XLSX from 'xlsx'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SKIP_SHEETS = new Set(['Summary', 'Facility', 'GROUP', '.'])
const PRIMARY_SHEET = 'GAU' // defines canonical account ordering/naming

const CC_META = {
  '000': { name: 'Head Office', type: 'admin' },
  ZZZ: { name: 'Other / Eliminations', type: 'admin' },
}

// Section transitions keyed by header text in column B (trimmed)
const SECTION_HEADERS = {
  Sales: 'sales',
  'Material Cost': 'cos_material',
  'Ops Cabling Cost': 'cos_ops_cabling',
  'Selling Expenses': 'selling',
  Admin: 'ioh_admin',
  Exec: 'ioh_exec',
  Operating: 'ioh_operating',
  'Facilities / IT': 'ioh_facilities_it',
  'Facilities / Premises': 'ioh_facilities_premises',
  'Adv & Marketing': 'ioh_marketing',
  Training: 'ioh_training',
  Statutory: 'ioh_statutory',
  Other: 'ioh_other',
  EBITDA: 'ho_fees',
  'EBITDA after HO Fees': 'rti_depreciation',
  EBIT: 'exceptional',
  'Exceptional Items': 'finance',
  'Finance Cost': null, // no more account rows after this
}
const STOP_HEADERS = new Set(['PBT', 'Key Metrics', 'Summary'])

function inputTypeFor(code, name) {
  if (code === '100000') return 'revenue'
  if (/^Salaries\b/i.test(name)) return 'salary'
  if (/^Cell ?Phones?\b/i.test(name)) return 'cellphone'
  if (/^M\/V Exp/i.test(name)) return 'vehicle'
  return 'direct'
}

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

const wbPath = process.argv[2]
if (!wbPath) {
  console.error('Usage: node scripts/seed.mjs <workbook.xlsx> [--apply]')
  process.exit(1)
}
const apply = process.argv.includes('--apply')

const wb = XLSX.read(readFileSync(wbPath), { cellDates: true })

const MAX_COL = 28 // scan A..AC (0-based 0..28)

function cellAt(ws, r, c) {
  return ws[XLSX.utils.encode_cell({ r, c })]
}

/** Map row 3 (idx 2) dates -> [{col, fyYear, monthIdx(1-12)}] plus total col per FY block */
function monthColumns(ws) {
  const cols = []
  for (let c = 0; c <= MAX_COL; c++) {
    const cell = cellAt(ws, 2, c)
    if (cell && cell.v instanceof Date && !isNaN(cell.v)) {
      const d = cell.v
      const m = d.getMonth() + 1
      const y = d.getFullYear()
      const fyYear = m >= 7 ? y + 1 : y
      const monthIdx = m >= 7 ? m - 6 : m + 6
      cols.push({ col: c, fyYear, monthIdx })
    }
  }
  // total column = first column after the last month column of each FY block
  const totals = {}
  for (const fy of new Set(cols.map((x) => x.fyYear))) {
    totals[fy] = Math.max(...cols.filter((x) => x.fyYear === fy).map((x) => x.col)) + 1
  }
  return { cols, totals }
}

function num(v) {
  return typeof v === 'number' && isFinite(v) ? v : 0
}

const accountsByCode = new Map() // code -> {names: Map(name->count), section, firstSeen}
let orderCounter = 0
const actuals = [] // {cc, code, fyYear, months: [12]}
const validation = []

const sheetNames = wb.SheetNames.filter((n) => !SKIP_SHEETS.has(n))
const ordered = [PRIMARY_SHEET, ...sheetNames.filter((n) => n !== PRIMARY_SHEET)]

for (const sheetName of ordered) {
  const ws = wb.Sheets[sheetName]
  if (!ws) continue
  const { cols, totals } = monthColumns(ws)
  if (cols.length === 0) {
    console.warn(`! ${sheetName}: no month date columns found, skipped`)
    continue
  }
  const range = XLSX.utils.decode_range(ws['!ref'])
  let section = null
  let stopped = false

  for (let r = 0; r <= range.e.r && !stopped; r++) {
    const aCell = cellAt(ws, r, 0)
    const bCell = cellAt(ws, r, 1)
    const aRaw = aCell ? String(aCell.v).trim() : ''
    const bRaw = bCell ? String(bCell.v).trim() : ''

    const isCode = /^\d{6}$/.test(aRaw)
    if (!isCode && bRaw) {
      if (STOP_HEADERS.has(bRaw)) { stopped = true; continue }
      if (Object.prototype.hasOwnProperty.call(SECTION_HEADERS, bRaw)) {
        section = SECTION_HEADERS[bRaw]
      }
      continue
    }
    if (!isCode || !section || !bRaw) continue

    // register account
    let acc = accountsByCode.get(aRaw)
    if (!acc) {
      acc = { names: new Map(), section, sort: ++orderCounter * 10 }
      accountsByCode.set(aRaw, acc)
    }
    acc.names.set(bRaw, (acc.names.get(bRaw) ?? 0) + 1)

    // collect amounts per FY
    const byFy = {}
    for (const { col, fyYear, monthIdx } of cols) {
      const v = num(cellAt(ws, r, col)?.v)
      ;(byFy[fyYear] ??= Array(12).fill(0))[monthIdx - 1] = v
    }
    for (const [fyYearStr, months] of Object.entries(byFy)) {
      const fyYear = Number(fyYearStr)
      const rowSum = months.reduce((s, v) => s + v, 0)
      const totalCell = num(cellAt(ws, r, totals[fyYear])?.v)
      if (Math.abs(rowSum - totalCell) > 1) {
        validation.push({ sheet: sheetName, row: r + 1, code: aRaw, fyYear, rowSum, totalCell })
      }
      if (months.some((v) => v !== 0)) {
        actuals.push({ cc: sheetName, code: aRaw, fyYear, months })
      }
    }
  }
}

// resolve account names by majority (ties: first registered, i.e. GAU first)
const accounts = [...accountsByCode.entries()].map(([code, a]) => {
  const name = [...a.names.entries()].sort((x, y) => y[1] - x[1])[0][0]
  return { code, name, section: a.section, sort_order: a.sort, input_type: inputTypeFor(code, name) }
})

const costCentres = sheetNames.map((code) => ({
  code,
  name: CC_META[code]?.name ?? code,
  type: CC_META[code]?.type ?? 'branch',
}))

const out = { costCentres, accounts, actualsCount: actuals.length, validationIssues: validation }
writeFileSync(join(__dirname, 'seed-data.json'), JSON.stringify({ ...out, actuals }, null, 1))

console.log(`Cost centres: ${costCentres.length}`)
console.log(`Accounts:     ${accounts.length}`)
console.log(`Actual rows:  ${actuals.length} (non-zero account/FY rows)`)
const fys = [...new Set(actuals.map((a) => a.fyYear))].sort()
console.log(`FY years:     ${fys.join(', ')}`)
if (validation.length) {
  console.log(`\nVALIDATION: ${validation.length} row-total mismatches (>R1):`)
  for (const v of validation.slice(0, 20)) {
    console.log(`  ${v.sheet} row ${v.row} acct ${v.code} FY${v.fyYear}: months sum ${v.rowSum.toFixed(2)} vs sheet total ${v.totalCell.toFixed(2)}`)
  }
  if (validation.length > 20) console.log(`  ... and ${validation.length - 20} more`)
} else {
  console.log('VALIDATION: all row totals match the sheet total columns ✔')
}

// ---------------------------------------------------------------------------
// Apply to Supabase
// ---------------------------------------------------------------------------

if (!apply) {
  console.log('\nDry run only. Re-run with --apply to push to Supabase.')
  process.exit(0)
}

// lightweight .env loader for scripts/.env
const envPath = join(__dirname, '.env')
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)\s*=\s*(.+)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
}

const SUPABASE_URL = process.env.SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (env or scripts/.env)')
  process.exit(1)
}

const { createClient } = await import('@supabase/supabase-js')
const sb = createClient(SUPABASE_URL, KEY, { auth: { persistSession: false } })

function fail(step, error) {
  if (error) {
    console.error(`FAILED at ${step}:`, error.message ?? error)
    process.exit(1)
  }
}

console.log('\nApplying to Supabase…')

// cost centres
{
  const { error } = await sb.from('budget_cost_centres').upsert(costCentres, { onConflict: 'code' })
  fail('cost centres', error)
}
// accounts
{
  const { error } = await sb.from('budget_accounts').upsert(accounts, { onConflict: 'code' })
  fail('accounts', error)
}
// FY2027 cycle
{
  const { error } = await sb.from('budget_cycles').upsert(
    [{ name: 'FY2027', fy_year: 2027, status: 'open' }], { onConflict: 'fy_year' })
  fail('cycle', error)
}

// id maps
const ccMap = new Map()
const accMap = new Map()
{
  const { data, error } = await sb.from('budget_cost_centres').select('id, code')
  fail('read cost centres', error)
  for (const c of data) ccMap.set(c.code, c.id)
  const a = await sb.from('budget_accounts').select('id, code')
  fail('read accounts', a.error)
  for (const x of a.data) accMap.set(x.code, x.id)
}

// actuals in batches
const rows = actuals.map(({ cc, code, fyYear, months }) => ({
  fy_year: fyYear,
  cost_centre_id: ccMap.get(cc),
  account_id: accMap.get(code),
  ...Object.fromEntries(months.map((v, i) => [`m${i + 1}`, Math.round(v * 100) / 100])),
}))
for (let i = 0; i < rows.length; i += 500) {
  const { error } = await sb
    .from('budget_actuals')
    .upsert(rows.slice(i, i + 500), { onConflict: 'fy_year,cost_centre_id,account_id' })
  fail(`actuals batch ${i}`, error)
  process.stdout.write(`  actuals ${Math.min(i + 500, rows.length)}/${rows.length}\r`)
}
console.log(`\nDone. Seeded ${rows.length} actual rows across ${ccMap.size} cost centres.`)
