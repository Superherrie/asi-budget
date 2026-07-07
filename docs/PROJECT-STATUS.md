# Project status & handoff — ASI Connect Budgeting App

_Last updated: 2026-07-07 (transferred from original build machine)._

## What this is

FY2027 (Jul 2026 – Jun 2027) budgeting app for ASI Connect: budget per cost centre with
compiler/approver workflow, rolling up to a consolidated income statement. See README.md
for architecture and setup. Built with Claude Code; original implementation plan summary below.

## Current state (all code committed, builds + lints clean)

**Done:**
- Full frontend: login, dashboard, budget editor (Income Statement / Revenue per team×customer /
  Salaries & Cell Phones per employee / Vehicles per vehicle), company roll-up, admin area
  (users, assignments, cost centres, CSV imports).
- Grid: fill tools (avg of actuals, latest month, copy actuals, % increase, set amount,
  spread annual), Excel copy/paste, keyboard nav.
- DB schema `supabase/migrations/001_init.sql` (budget_ tables, RLS, approval RPCs) — **not yet applied**.
- Seed script `scripts/seed.mjs` — parses the ICS workbook; dry run validated cleanly
  (19 cost centres, 142 accounts, 2 112 actual rows, zero total mismatches) — **not yet applied**.
- Edge function `supabase/functions/budget-admin-users` (admin creates users/passwords) — **not yet deployed**.
- GitHub Actions workflow for Pages deploy (`.github/workflows/deploy.yml`) — repo not yet on GitHub.

**Outstanding (in order):**
1. Apply `001_init.sql` to the shared Supabase project (`https://pniqwvyscmxfxbhtsace.supabase.co`,
   the same project ASI-Excellence uses; tables are namespaced `budget_`).
   Needs a Supabase **personal access token** (dashboard → account → access tokens) or run the SQL
   in the dashboard SQL editor.
2. Run the seed: `node scripts/seed.mjs "<path to ICS FY2025 & FY2026 Branches Per Month MAY26.xlsx>" --apply`
   with `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` in `scripts/.env` (git-ignored).
3. Deploy edge function: `npx supabase functions deploy budget-admin-users --project-ref pniqwvyscmxfxbhtsace`
   (needs `SUPABASE_ACCESS_TOKEN`).
4. Create first admin user (herman.devries@asiconnect.co.za) — Supabase Auth dashboard +
   `insert into budget_profiles (user_id, email, full_name, is_admin) values (…, true)`,
   or via the seed of the edge function once deployed.
5. Verify end-to-end (login as compiler, edit GAU, check subtotals vs workbook FY2026, submit → approve,
   company roll-up, RLS with a non-assigned user).
6. Publish: `gh auth login`, create public repo, push, enable Pages (Settings → Pages → GitHub Actions),
   set Actions **variables** `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`.

## Machine-local files NOT in git (recreate on a new machine)

- `.env.local` — `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` (anon key is in `.env.example` format;
  the ASI project's anon key is also visible in `ASI-Excellence/config.js` on the old machine).
- `scripts/.env` — service role key + access token (never committed; keep secret).
- The source workbook (originally `Downloads\ICS FY2025 & FY2026 Branches Per Month MAY26.xlsx`).

## Key conventions

- Financial year: m1 = July. FY2027 = Jul 2026 – Jun 2027.
- Costs are stored **negative** (matching the workbook); revenue positive.
- Detail-driven accounts (input_type revenue/salary/cellphone/vehicle) are summed from their
  detail tables via the `budget_statement_lines` view; only `direct` accounts are edited on the statement.
- Statement layout/subtotal logic: `src/lib/statement.ts` (mirrors the workbook: GP → GOP → EBITDA →
  EBITDA after HO Fees → EBIT → Exceptional → Finance → PBT).
