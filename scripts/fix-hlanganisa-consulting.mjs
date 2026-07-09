// One-off: repoint the 8 Hlanganisa Managed Services staff from their salary
// accounts to Consulting Fees accounts (by category). Company isn't stored on
// the employee, so they're identified by (name, branch) from the payroll file.
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

// name, branch, consulting-fees account code (by category)
const STAFF = [
  ['CORNEL AHMAD', '000', '407000'],           // Admin
  ['EDWIN FRANCIS', '000', '407100'],          // Sales
  ['AMBER MOHUBA', '000', '407000'],           // Admin
  ['PIETER MULDER', '000', '407000'],          // Admin
  ['RUTH POWELL', '000', '407000'],            // Admin
  ['CHANTELL VAN SCHALKWYK', '000', '407000'], // Admin
  ['GERRIT BARNARD', 'DCS', '407300'],         // Executive
  ['PATIENCE MATOLO', 'GAU', '407000'],        // Admin
]
const values = STAFF.map(([n, b, a]) => `('${n.replace(/'/g, "''")}','${b}','${a}')`).join(',')

const sql = `
update budget_employee_lines el
set account_id = tgt.id
from budget_employees e
join budget_cost_centres cc on cc.id = e.cost_centre_id
join (values ${values}) as h(name, branch, acode) on h.name = e.name and h.branch = cc.code
join budget_accounts tgt on tgt.code = h.acode
where el.employee_id = e.id and el.kind = 'salary';`

await Q(sql)
console.log('Repointed. Verifying:')
for (const r of await Q(`select e.name, cc.code branch, a.code, a.name acctname, el.m1
  from budget_employees e
  join budget_cost_centres cc on cc.id=e.cost_centre_id
  join budget_employee_lines el on el.employee_id=e.id
  join budget_accounts a on a.id=el.account_id
  where e.name in (${STAFF.map(([n]) => `'${n.replace(/'/g, "''")}'`).join(',')}) order by e.name`))
  console.log(`  ${r.name} @${r.branch} → ${r.code} ${r.acctname} (m1=${r.m1})`)
