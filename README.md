# ASI Connect Budgeting App

Budget compilation per cost centre with approval workflow, rolling up to a consolidated income
statement. Frontend: Vite + React + TypeScript + Tailwind (GitHub Pages). Backend: Supabase
(Postgres + Auth + Edge Functions), all tables prefixed `budget_` in a shared project.

## Concepts

- **Financial year** runs July–June (FY2027 = Jul 2026 – Jun 2027). Month 1 = July.
- **Cost centres**: branches (GAU, CPT, …) and administrative units (Head Office). Users are
  assigned per cost centre as **compiler** (edits the budget) and/or **approver**.
- **History**: FY2025 + FY2026 monthly actuals imported from the ICS workbook are shown next to
  the budget input months and drive the fill tools.
- **Detail-driven lines**: Revenue (per team × customer), Salaries & Cell Phones (per employee),
  and M/V expenses (per vehicle) are budgeted in their own tabs; everything else is entered
  directly on the income statement.
- **Approval**: compiler submits → approver approves/rejects (with comment) → admin can reopen.
  Submitted/approved budgets are locked (enforced by RLS).

## Setup

### 1. Database (shared Supabase project)

Run `supabase/migrations/001_init.sql` in the Supabase SQL editor (or `supabase db push`).

### 2. Seed history from the workbook

```
node scripts/seed.mjs "path/to/ICS FY2025 & FY2026 Branches Per Month MAY26.xlsx"          # dry run + validation
node scripts/seed.mjs "path/to/workbook.xlsx" --apply                                      # push to Supabase
```

`--apply` needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (env vars or `scripts/.env`).
The dry run validates every imported row against the workbook's total columns.

### 3. Edge function (admin user management)

```
supabase functions deploy budget-admin-users
```

### 4. First admin user

Create a user in Supabase Auth (dashboard), then:

```sql
insert into budget_profiles (user_id, email, full_name, is_admin)
values ('<auth user id>', 'you@asiconnect.co.za', 'Your Name', true);
```

Further users are created in the app under Admin → Users & Access.

### 5. Frontend

```
cp .env.example .env.local   # fill in VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
npm install
npm run dev
```

### 6. Deploy

Push to `main`. The GitHub Actions workflow builds and publishes to GitHub Pages.
Set repository **Actions variables** `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`,
and enable Pages (Settings → Pages → Source: GitHub Actions).
