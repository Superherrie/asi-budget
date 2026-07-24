// Generates the bulk user import template.
//   node scripts/make-user-template.mjs "<output.xlsx>"
import ExcelJS from 'exceljs'

const COST_CENTRES = [
  ['000', 'Head Office', 'admin'], ['BLM', 'BLM', 'branch'], ['CAP', 'CAP', 'branch'],
  ['CPT', 'CPT', 'branch'], ['DBN', 'DBN', 'branch'], ['DCS', 'DCS', 'branch'],
  ['ESL', 'ESL', 'branch'], ['GAU', 'GAU', 'branch'], ['KAT', 'KAT', 'branch'],
  ['KLY', 'KLY', 'branch'], ['MDB', 'MDB', 'branch'], ['MED', 'MED', 'branch'],
  ['RCH', 'RCH', 'branch'], ['RST', 'RST', 'branch'], ['SEC', 'SEC', 'branch'],
  ['THA', 'THA', 'branch'], ['VEN', 'VEN', 'branch'], ['VER', 'VER', 'branch'],
  ['ZZZ', 'Other / Eliminations', 'admin'],
]

const NAVY = 'FF0C4A6E'
const YELLOW = 'FFFFF7CC'
const FONT = { name: 'Arial', size: 10 }

const out = process.argv[2] || 'ASI Budget - Bulk User Import.xlsx'
const wb = new ExcelJS.Workbook()
wb.creator = 'ASI Connect Budget'

// ---------------------------------------------------------------- Users sheet
const ws = wb.addWorksheet('Users', { views: [{ state: 'frozen', ySplit: 2 }] })

ws.mergeCells('A1:F1')
const title = ws.getCell('A1')
title.value = 'Bulk user import — fill in one row per user. Yellow cells are the ones you complete.'
title.font = { ...FONT, bold: true, color: { argb: 'FF334155' } }
ws.getRow(1).height = 20

const headers = [
  ['email', 22, 'Login email address. Must be unique.'],
  ['password', 16, 'Initial password (min 6 characters). The user can change it later.'],
  ['full_name', 24, 'Display name, e.g. Jane Smith.'],
  ['is_admin', 10, 'Y or N. Y gives full admin access (all cost centres + Admin area).'],
  ['compiler_cost_centres', 28, 'Cost centres this user CAPTURES budget for. Comma-separated codes, e.g. GAU,SEC. Leave blank if none.'],
  ['approver_cost_centres', 28, 'Cost centres this user APPROVES. Comma-separated codes. Leave blank if none.'],
]
headers.forEach(([name, width, note], i) => {
  const cell = ws.getCell(2, i + 1)
  cell.value = name
  cell.font = { ...FONT, bold: true, color: { argb: 'FFFFFFFF' } }
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
  cell.alignment = { vertical: 'middle' }
  cell.note = note
  ws.getColumn(i + 1).width = width
})
ws.getRow(2).height = 18

// one example row, clearly marked
const example = ['jane.smith@asiconnect.co.za', 'Welcome123!', 'Jane Smith', 'N', 'GAU,SEC', 'GAU']
example.forEach((v, i) => {
  const cell = ws.getCell(3, i + 1)
  cell.value = v
  cell.font = { ...FONT, italic: true, color: { argb: 'FF94A3B8' } }
})
ws.getCell('G3').value = '← EXAMPLE ROW — delete this row before importing'
ws.getCell('G3').font = { ...FONT, italic: true, bold: true, color: { argb: 'FFB45309' } }

// blank input rows, highlighted
for (let r = 4; r <= 60; r++) {
  for (let c = 1; c <= 6; c++) {
    const cell = ws.getCell(r, c)
    cell.font = FONT
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: YELLOW } }
    cell.border = { bottom: { style: 'hair', color: { argb: 'FFCBD5E1' } } }
  }
  // Y/N dropdown on is_admin
  ws.getCell(r, 4).dataValidation = {
    type: 'list', allowBlank: true, formulae: ['"Y,N"'],
    showErrorMessage: true, errorTitle: 'Invalid', error: 'Enter Y or N',
  }
}

// ------------------------------------------------------- Instructions sheet
const info = wb.addWorksheet('Instructions & Cost Centres')
info.getColumn(1).width = 26
info.getColumn(2).width = 30
info.getColumn(3).width = 62

const h = (row, text) => {
  const c = info.getCell(row, 1)
  c.value = text
  c.font = { ...FONT, bold: true, size: 11, color: { argb: 'FF0C4A6E' } }
}

h(1, 'How to use this sheet')
const steps = [
  ['1.', 'Complete one row per user on the "Users" tab (delete the grey example row).'],
  ['2.', 'email and password are required. Password must be at least 6 characters.'],
  ['3.', 'is_admin = Y gives full access to every cost centre and the Admin area. Leave the cost-centre columns blank for admins.'],
  ['4.', 'For normal users, list the cost centres they compile and/or approve, comma-separated (e.g. GAU,SEC). Use the codes below.'],
  ['5.', 'A user can be both: compiler of one branch and approver of another. Compilers capture the budget; approvers sign it off.'],
  ['6.', 'Save the file and send it back — it is imported with scripts/import-users.mjs.'],
  ['', ''],
  ['Note', 'Re-importing an existing email updates their name, admin flag and cost-centre access, and resets the password to the one in the sheet.'],
]
steps.forEach(([a, b], i) => {
  const r = i + 2
  info.getCell(r, 1).value = a
  info.getCell(r, 1).font = { ...FONT, bold: true }
  info.mergeCells(r, 2, r, 3)
  info.getCell(r, 2).value = b
  info.getCell(r, 2).font = FONT
  info.getCell(r, 2).alignment = { wrapText: true, vertical: 'top' }
  info.getRow(r).height = 26
})

const ccStart = steps.length + 3
h(ccStart, 'Valid cost centre codes')
;['Code', 'Name', 'Type'].forEach((t, i) => {
  const cell = info.getCell(ccStart + 1, i + 1)
  cell.value = t
  cell.font = { ...FONT, bold: true, color: { argb: 'FFFFFFFF' } }
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
})
COST_CENTRES.forEach(([code, name, type], i) => {
  const r = ccStart + 2 + i
  info.getCell(r, 1).value = code
  info.getCell(r, 2).value = name
  info.getCell(r, 3).value = type
  for (let c = 1; c <= 3; c++) info.getCell(r, c).font = FONT
})

await wb.xlsx.writeFile(out)
console.log(`Wrote ${out}`)
