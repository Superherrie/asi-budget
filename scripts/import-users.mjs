// Bulk-import users from the completed "Bulk User Import" workbook.
//   node scripts/import-users.mjs "<file.xlsx>"           # dry run + validation
//   node scripts/import-users.mjs "<file.xlsx>" --apply    # create/update users
//
// Creates the auth user, its budget_profiles row, and its cost-centre
// assignments. Re-importing an existing email updates the profile and
// assignments and resets the password. Reads SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY from scripts/.env.
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

// Exits via process.exitCode + return (not process.exit) so Node can shut its
// handles down cleanly — process.exit() here aborts on Windows.
const fail = (msg) => { console.error(msg); process.exitCode = 1 }

const file = process.argv[2]
const apply = process.argv.includes('--apply')
if (!file) { fail('Usage: node scripts/import-users.mjs "<file.xlsx>" [--apply]') }
else await main()

async function main() {

const EXAMPLE_EMAIL = 'jane.smith@asiconnect.co.za'

// ---------------------------------------------------------------- parse sheet
const wb = XLSX.read(readFileSync(file))
const ws = wb.Sheets['Users'] ?? wb.Sheets[wb.SheetNames[0]]
const raw = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false })
const headerIdx = raw.findIndex((r) => String(r[0] ?? '').trim().toLowerCase() === 'email')
if (headerIdx < 0) { fail('Could not find a header row starting with "email".'); return }

const rows = []
const problems = []
for (let i = headerIdx + 1; i < raw.length; i++) {
  const r = raw[i]
  const email = String(r[0] ?? '').trim().toLowerCase()
  if (!email) continue
  if (email === EXAMPLE_EMAIL) continue // the template's example row
  const rowNo = i + 1
  const password = String(r[1] ?? '').trim()
  const fullName = String(r[2] ?? '').trim()
  const isAdmin = /^y/i.test(String(r[3] ?? '').trim())
  const split = (v) => String(v ?? '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
  const compiler = split(r[4])
  const approver = split(r[5])
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { problems.push(`Row ${rowNo}: invalid email "${email}"`); continue }
  if (password.length < 6) { problems.push(`Row ${rowNo}: ${email} — password must be at least 6 characters`); continue }
  rows.push({ rowNo, email, password, fullName, isAdmin, compiler, approver })
}

const dupes = rows.map((r) => r.email).filter((e, i, a) => a.indexOf(e) !== i)
for (const d of new Set(dupes)) problems.push(`Duplicate email in sheet: ${d}`)

// ------------------------------------------------------------------ validate
const URL = process.env.SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) { fail('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in scripts/.env'); return }
const { createClient } = await import('@supabase/supabase-js')
const sb = createClient(URL, KEY, { auth: { persistSession: false } })

const { data: ccs, error: ccErr } = await sb.from('budget_cost_centres').select('id, code')
if (ccErr) { fail('Could not read cost centres: '+ccErr.message); return }
const ccMap = new Map(ccs.map((c) => [String(c.code).toUpperCase(), c.id]))
for (const r of rows) {
  for (const code of [...r.compiler, ...r.approver]) {
    if (!ccMap.has(code)) problems.push(`Row ${r.rowNo}: ${r.email} — unknown cost centre "${code}"`)
  }
}

console.log(`Parsed ${rows.length} user row(s) from ${file}`)
for (const r of rows) {
  const access = r.isAdmin ? 'ADMIN (all cost centres)'
    : [r.compiler.length ? `compiler: ${r.compiler.join(',')}` : null,
       r.approver.length ? `approver: ${r.approver.join(',')}` : null].filter(Boolean).join('  |  ') || 'no cost centre access'
  console.log(`  ${r.email.padEnd(34)} ${r.fullName.padEnd(22)} ${access}`)
}
if (problems.length) {
  console.log(`\n${problems.length} problem(s):`)
  for (const p of problems) console.log('  ' + p)
  console.log('\nFix these and re-run. Nothing was written.')
  process.exitCode = 1
  return
}
if (!apply) { console.log('\nDry run only — all rows valid. Re-run with --apply to create the users.'); return }

// -------------------------------------------------------------------- apply
const { data: existing, error: luErr } = await sb.auth.admin.listUsers({ perPage: 1000 })
if (luErr) { fail('listUsers failed: '+luErr.message); return }
const byEmail = new Map(existing.users.map((u) => [u.email?.toLowerCase(), u.id]))

let created = 0, updated = 0
for (const r of rows) {
  try {
    let userId = byEmail.get(r.email)
    if (userId) {
      const { error } = await sb.auth.admin.updateUserById(userId, { password: r.password })
      if (error) throw error
      updated++
    } else {
      const { data, error } = await sb.auth.admin.createUser({ email: r.email, password: r.password, email_confirm: true })
      if (error) throw error
      userId = data.user.id
      created++
    }
    const { error: pErr } = await sb.from('budget_profiles').upsert(
      { user_id: userId, email: r.email, full_name: r.fullName, is_admin: r.isAdmin },
      { onConflict: 'user_id' },
    )
    if (pErr) throw pErr

    // replace this user's assignments
    const { error: dErr } = await sb.from('budget_assignments').delete().eq('user_id', userId)
    if (dErr) throw dErr
    const assignments = [
      ...r.compiler.map((c) => ({ user_id: userId, cost_centre_id: ccMap.get(c), role: 'compiler' })),
      ...r.approver.map((c) => ({ user_id: userId, cost_centre_id: ccMap.get(c), role: 'approver' })),
    ]
    if (assignments.length) {
      const { error: aErr } = await sb.from('budget_assignments').insert(assignments)
      if (aErr) throw aErr
    }
    console.log(`  ok  ${r.email}`)
  } catch (e) {
    console.error(`  FAILED ${r.email}: ${e.message ?? e}`)
  }
}
console.log(`\nDone. ${created} created, ${updated} updated.`)
}
