-- ASI Connect Budgeting App — initial schema
-- All objects are prefixed budget_ because they live in a shared Supabase project.
-- Financial year runs July (m1) .. June (m12). FY2027 = Jul 2026 - Jun 2027.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists budget_profiles (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  email      text not null,
  full_name  text not null default '',
  is_admin   boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists budget_cost_centres (
  id     bigint generated always as identity primary key,
  code   text not null unique,
  name   text not null,
  type   text not null default 'branch' check (type in ('branch', 'admin')),
  active boolean not null default true
);

create table if not exists budget_assignments (
  id             bigint generated always as identity primary key,
  user_id        uuid not null references budget_profiles (user_id) on delete cascade,
  cost_centre_id bigint not null references budget_cost_centres (id) on delete cascade,
  role           text not null check (role in ('compiler', 'approver')),
  unique (user_id, cost_centre_id, role)
);

create table if not exists budget_cycles (
  id      bigint generated always as identity primary key,
  name    text not null unique,
  fy_year int not null unique,
  status  text not null default 'open' check (status in ('open', 'closed'))
);

create table if not exists budget_accounts (
  id         bigint generated always as identity primary key,
  code       text not null unique,
  name       text not null,
  section    text not null check (section in (
    'sales', 'cos_material', 'cos_ops_cabling', 'selling',
    'ioh_admin', 'ioh_exec', 'ioh_operating', 'ioh_facilities_it',
    'ioh_facilities_premises', 'ioh_marketing', 'ioh_training',
    'ioh_statutory', 'ioh_other',
    'ho_fees', 'rti_depreciation', 'exceptional', 'finance')),
  sort_order int not null default 0,
  input_type text not null default 'direct'
    check (input_type in ('direct', 'revenue', 'salary', 'cellphone', 'vehicle'))
);

-- History (actuals) imported from the income statement workbook.
create table if not exists budget_actuals (
  id             bigint generated always as identity primary key,
  fy_year        int not null,
  cost_centre_id bigint not null references budget_cost_centres (id) on delete cascade,
  account_id     bigint not null references budget_accounts (id) on delete cascade,
  m1 numeric(14,2) not null default 0,  m2 numeric(14,2) not null default 0,
  m3 numeric(14,2) not null default 0,  m4 numeric(14,2) not null default 0,
  m5 numeric(14,2) not null default 0,  m6 numeric(14,2) not null default 0,
  m7 numeric(14,2) not null default 0,  m8 numeric(14,2) not null default 0,
  m9 numeric(14,2) not null default 0,  m10 numeric(14,2) not null default 0,
  m11 numeric(14,2) not null default 0, m12 numeric(14,2) not null default 0,
  unique (fy_year, cost_centre_id, account_id)
);

-- Direct budget inputs (everything except revenue/salary/cellphone/vehicle detail).
create table if not exists budget_lines (
  id             bigint generated always as identity primary key,
  cycle_id       bigint not null references budget_cycles (id) on delete cascade,
  cost_centre_id bigint not null references budget_cost_centres (id) on delete cascade,
  account_id     bigint not null references budget_accounts (id) on delete cascade,
  m1 numeric(14,2) not null default 0,  m2 numeric(14,2) not null default 0,
  m3 numeric(14,2) not null default 0,  m4 numeric(14,2) not null default 0,
  m5 numeric(14,2) not null default 0,  m6 numeric(14,2) not null default 0,
  m7 numeric(14,2) not null default 0,  m8 numeric(14,2) not null default 0,
  m9 numeric(14,2) not null default 0,  m10 numeric(14,2) not null default 0,
  m11 numeric(14,2) not null default 0, m12 numeric(14,2) not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (cycle_id, cost_centre_id, account_id)
);

-- Employees: salary + cellphone budgeted per individual, per cycle.
create table if not exists budget_employees (
  id             bigint generated always as identity primary key,
  cycle_id       bigint not null references budget_cycles (id) on delete cascade,
  cost_centre_id bigint not null references budget_cost_centres (id) on delete cascade,
  name           text not null,
  title          text not null default '',
  is_new         boolean not null default false,  -- planned new hire vs current headcount
  active         boolean not null default true
);

create table if not exists budget_employee_lines (
  id          bigint generated always as identity primary key,
  employee_id bigint not null references budget_employees (id) on delete cascade,
  kind        text not null check (kind in ('salary', 'cellphone')),
  account_id  bigint not null references budget_accounts (id) on delete cascade,
  m1 numeric(14,2) not null default 0,  m2 numeric(14,2) not null default 0,
  m3 numeric(14,2) not null default 0,  m4 numeric(14,2) not null default 0,
  m5 numeric(14,2) not null default 0,  m6 numeric(14,2) not null default 0,
  m7 numeric(14,2) not null default 0,  m8 numeric(14,2) not null default 0,
  m9 numeric(14,2) not null default 0,  m10 numeric(14,2) not null default 0,
  m11 numeric(14,2) not null default 0, m12 numeric(14,2) not null default 0,
  unique (employee_id, kind)
);

-- Vehicles: master list per cost centre; expenses budgeted per vehicle per account.
create table if not exists budget_vehicles (
  id             bigint generated always as identity primary key,
  cost_centre_id bigint not null references budget_cost_centres (id) on delete cascade,
  registration   text not null,
  description    text not null default '',
  active         boolean not null default true
);

create table if not exists budget_vehicle_lines (
  id         bigint generated always as identity primary key,
  cycle_id   bigint not null references budget_cycles (id) on delete cascade,
  vehicle_id bigint not null references budget_vehicles (id) on delete cascade,
  account_id bigint not null references budget_accounts (id) on delete cascade,
  m1 numeric(14,2) not null default 0,  m2 numeric(14,2) not null default 0,
  m3 numeric(14,2) not null default 0,  m4 numeric(14,2) not null default 0,
  m5 numeric(14,2) not null default 0,  m6 numeric(14,2) not null default 0,
  m7 numeric(14,2) not null default 0,  m8 numeric(14,2) not null default 0,
  m9 numeric(14,2) not null default 0,  m10 numeric(14,2) not null default 0,
  m11 numeric(14,2) not null default 0, m12 numeric(14,2) not null default 0,
  unique (cycle_id, vehicle_id, account_id)
);

-- Teams (team leader + assistants) and customers: the two revenue dimensions.
create table if not exists budget_teams (
  id             bigint generated always as identity primary key,
  cost_centre_id bigint not null references budget_cost_centres (id) on delete cascade,
  name           text not null,
  active         boolean not null default true
);

create table if not exists budget_team_members (
  id          bigint generated always as identity primary key,
  team_id     bigint not null references budget_teams (id) on delete cascade,
  employee_id bigint not null references budget_employees (id) on delete cascade,
  is_leader   boolean not null default false,
  unique (team_id, employee_id)
);

create table if not exists budget_customers (
  id             bigint generated always as identity primary key,
  cost_centre_id bigint not null references budget_cost_centres (id) on delete cascade,
  name           text not null,
  active         boolean not null default true
);

create table if not exists budget_revenue_lines (
  id             bigint generated always as identity primary key,
  cycle_id       bigint not null references budget_cycles (id) on delete cascade,
  cost_centre_id bigint not null references budget_cost_centres (id) on delete cascade,
  team_id        bigint references budget_teams (id) on delete set null,
  customer_id    bigint references budget_customers (id) on delete set null,
  account_id     bigint not null references budget_accounts (id) on delete cascade,
  m1 numeric(14,2) not null default 0,  m2 numeric(14,2) not null default 0,
  m3 numeric(14,2) not null default 0,  m4 numeric(14,2) not null default 0,
  m5 numeric(14,2) not null default 0,  m6 numeric(14,2) not null default 0,
  m7 numeric(14,2) not null default 0,  m8 numeric(14,2) not null default 0,
  m9 numeric(14,2) not null default 0,  m10 numeric(14,2) not null default 0,
  m11 numeric(14,2) not null default 0, m12 numeric(14,2) not null default 0,
  unique (cycle_id, cost_centre_id, team_id, customer_id, account_id)
);

create table if not exists budget_approvals (
  id             bigint generated always as identity primary key,
  cycle_id       bigint not null references budget_cycles (id) on delete cascade,
  cost_centre_id bigint not null references budget_cost_centres (id) on delete cascade,
  status         text not null default 'draft'
    check (status in ('draft', 'submitted', 'approved', 'rejected')),
  submitted_by uuid,
  submitted_at timestamptz,
  decided_by   uuid,
  decided_at   timestamptz,
  comment      text,
  unique (cycle_id, cost_centre_id)
);

create index if not exists budget_actuals_cc_idx on budget_actuals (cost_centre_id, fy_year);
create index if not exists budget_lines_cc_idx on budget_lines (cycle_id, cost_centre_id);
create index if not exists budget_employees_cc_idx on budget_employees (cycle_id, cost_centre_id);
create index if not exists budget_revenue_cc_idx on budget_revenue_lines (cycle_id, cost_centre_id);

-- ---------------------------------------------------------------------------
-- Statement view: direct lines + detail roll-ups, one row per account
-- ---------------------------------------------------------------------------

create or replace view budget_statement_lines
with (security_invoker = on) as
select
  cycle_id, cost_centre_id, account_id,
  sum(m1) as m1, sum(m2) as m2, sum(m3) as m3, sum(m4) as m4,
  sum(m5) as m5, sum(m6) as m6, sum(m7) as m7, sum(m8) as m8,
  sum(m9) as m9, sum(m10) as m10, sum(m11) as m11, sum(m12) as m12
from (
  select cycle_id, cost_centre_id, account_id,
         m1, m2, m3, m4, m5, m6, m7, m8, m9, m10, m11, m12
  from budget_lines
  union all
  select e.cycle_id, e.cost_centre_id, el.account_id,
         el.m1, el.m2, el.m3, el.m4, el.m5, el.m6, el.m7, el.m8, el.m9, el.m10, el.m11, el.m12
  from budget_employee_lines el
  join budget_employees e on e.id = el.employee_id
  where e.active
  union all
  select vl.cycle_id, v.cost_centre_id, vl.account_id,
         vl.m1, vl.m2, vl.m3, vl.m4, vl.m5, vl.m6, vl.m7, vl.m8, vl.m9, vl.m10, vl.m11, vl.m12
  from budget_vehicle_lines vl
  join budget_vehicles v on v.id = vl.vehicle_id
  where v.active
  union all
  select cycle_id, cost_centre_id, account_id,
         m1, m2, m3, m4, m5, m6, m7, m8, m9, m10, m11, m12
  from budget_revenue_lines
) u
group by cycle_id, cost_centre_id, account_id;

-- ---------------------------------------------------------------------------
-- Authorization helpers (security definer to avoid recursive RLS)
-- ---------------------------------------------------------------------------

create or replace function budget_is_admin()
returns boolean language sql stable security definer set search_path = public as
$$ select coalesce((select is_admin from budget_profiles where user_id = auth.uid()), false) $$;

create or replace function budget_has_cc(cc bigint)
returns boolean language sql stable security definer set search_path = public as
$$
  select budget_is_admin() or exists (
    select 1 from budget_assignments where user_id = auth.uid() and cost_centre_id = cc)
$$;

create or replace function budget_is_compiler(cc bigint)
returns boolean language sql stable security definer set search_path = public as
$$
  select budget_is_admin() or exists (
    select 1 from budget_assignments
    where user_id = auth.uid() and cost_centre_id = cc and role = 'compiler')
$$;

create or replace function budget_is_approver(cc bigint)
returns boolean language sql stable security definer set search_path = public as
$$
  select budget_is_admin() or exists (
    select 1 from budget_assignments
    where user_id = auth.uid() and cost_centre_id = cc and role = 'approver')
$$;

-- A cost centre's budget is locked for editing once submitted or approved.
create or replace function budget_cc_locked(cyc bigint, cc bigint)
returns boolean language sql stable security definer set search_path = public as
$$
  select exists (
    select 1 from budget_approvals
    where cycle_id = cyc and cost_centre_id = cc and status in ('submitted', 'approved'))
$$;

create or replace function budget_can_edit(cyc bigint, cc bigint)
returns boolean language sql stable security definer set search_path = public as
$$ select budget_is_compiler(cc) and not budget_cc_locked(cyc, cc) $$;

-- ---------------------------------------------------------------------------
-- Approval workflow RPCs (transitions enforced here, not via direct writes)
-- ---------------------------------------------------------------------------

create or replace function budget_submit(p_cycle bigint, p_cc bigint)
returns void language plpgsql security definer set search_path = public as
$$
declare cur text;
begin
  if not budget_is_compiler(p_cc) then
    raise exception 'Only a compiler for this cost centre can submit';
  end if;
  select status into cur from budget_approvals where cycle_id = p_cycle and cost_centre_id = p_cc;
  if cur in ('submitted', 'approved') then
    raise exception 'Budget is already %', cur;
  end if;
  insert into budget_approvals (cycle_id, cost_centre_id, status, submitted_by, submitted_at, decided_by, decided_at, comment)
  values (p_cycle, p_cc, 'submitted', auth.uid(), now(), null, null, null)
  on conflict (cycle_id, cost_centre_id) do update
    set status = 'submitted', submitted_by = auth.uid(), submitted_at = now(),
        decided_by = null, decided_at = null, comment = null;
end $$;

create or replace function budget_decide(p_cycle bigint, p_cc bigint, p_approve boolean, p_comment text default null)
returns void language plpgsql security definer set search_path = public as
$$
declare cur text;
begin
  if not budget_is_approver(p_cc) then
    raise exception 'Only an approver for this cost centre can approve or reject';
  end if;
  select status into cur from budget_approvals where cycle_id = p_cycle and cost_centre_id = p_cc;
  if cur is distinct from 'submitted' then
    raise exception 'Budget is not awaiting approval (status: %)', coalesce(cur, 'draft');
  end if;
  update budget_approvals
  set status = case when p_approve then 'approved' else 'rejected' end,
      decided_by = auth.uid(), decided_at = now(), comment = p_comment
  where cycle_id = p_cycle and cost_centre_id = p_cc;
end $$;

create or replace function budget_reopen(p_cycle bigint, p_cc bigint)
returns void language plpgsql security definer set search_path = public as
$$
begin
  if not budget_is_admin() then
    raise exception 'Only an administrator can reopen a budget';
  end if;
  update budget_approvals set status = 'draft'
  where cycle_id = p_cycle and cost_centre_id = p_cc;
end $$;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table budget_profiles enable row level security;
alter table budget_cost_centres enable row level security;
alter table budget_assignments enable row level security;
alter table budget_cycles enable row level security;
alter table budget_accounts enable row level security;
alter table budget_actuals enable row level security;
alter table budget_lines enable row level security;
alter table budget_employees enable row level security;
alter table budget_employee_lines enable row level security;
alter table budget_vehicles enable row level security;
alter table budget_vehicle_lines enable row level security;
alter table budget_teams enable row level security;
alter table budget_team_members enable row level security;
alter table budget_customers enable row level security;
alter table budget_revenue_lines enable row level security;
alter table budget_approvals enable row level security;

-- profiles: read own (or any if admin); writes via service role / admin only
create policy profiles_select on budget_profiles for select
  using (user_id = auth.uid() or budget_is_admin());
create policy profiles_update on budget_profiles for update
  using (budget_is_admin());

-- reference data: readable by all signed-in users, writable by admins
create policy cost_centres_select on budget_cost_centres for select using (auth.uid() is not null);
create policy cost_centres_write on budget_cost_centres for all
  using (budget_is_admin()) with check (budget_is_admin());

create policy assignments_select on budget_assignments for select
  using (user_id = auth.uid() or budget_is_admin());
create policy assignments_write on budget_assignments for all
  using (budget_is_admin()) with check (budget_is_admin());

create policy cycles_select on budget_cycles for select using (auth.uid() is not null);
create policy cycles_write on budget_cycles for all
  using (budget_is_admin()) with check (budget_is_admin());

create policy accounts_select on budget_accounts for select using (auth.uid() is not null);
create policy accounts_write on budget_accounts for all
  using (budget_is_admin()) with check (budget_is_admin());

-- history: visible for assigned cost centres
create policy actuals_select on budget_actuals for select using (budget_has_cc(cost_centre_id));
create policy actuals_write on budget_actuals for all
  using (budget_is_admin()) with check (budget_is_admin());

-- budget inputs: read if assigned; write if compiler and not locked
create policy lines_select on budget_lines for select using (budget_has_cc(cost_centre_id));
create policy lines_write on budget_lines for all
  using (budget_can_edit(cycle_id, cost_centre_id))
  with check (budget_can_edit(cycle_id, cost_centre_id));

create policy employees_select on budget_employees for select using (budget_has_cc(cost_centre_id));
create policy employees_write on budget_employees for all
  using (budget_can_edit(cycle_id, cost_centre_id))
  with check (budget_can_edit(cycle_id, cost_centre_id));

create policy employee_lines_select on budget_employee_lines for select
  using (exists (select 1 from budget_employees e
                 where e.id = employee_id and budget_has_cc(e.cost_centre_id)));
create policy employee_lines_write on budget_employee_lines for all
  using (exists (select 1 from budget_employees e
                 where e.id = employee_id and budget_can_edit(e.cycle_id, e.cost_centre_id)))
  with check (exists (select 1 from budget_employees e
                      where e.id = employee_id and budget_can_edit(e.cycle_id, e.cost_centre_id)));

create policy vehicles_select on budget_vehicles for select using (budget_has_cc(cost_centre_id));
create policy vehicles_write on budget_vehicles for all
  using (budget_is_compiler(cost_centre_id))
  with check (budget_is_compiler(cost_centre_id));

create policy vehicle_lines_select on budget_vehicle_lines for select
  using (exists (select 1 from budget_vehicles v
                 where v.id = vehicle_id and budget_has_cc(v.cost_centre_id)));
create policy vehicle_lines_write on budget_vehicle_lines for all
  using (exists (select 1 from budget_vehicles v
                 where v.id = vehicle_id and budget_can_edit(cycle_id, v.cost_centre_id)))
  with check (exists (select 1 from budget_vehicles v
                      where v.id = vehicle_id and budget_can_edit(cycle_id, v.cost_centre_id)));

create policy teams_select on budget_teams for select using (budget_has_cc(cost_centre_id));
create policy teams_write on budget_teams for all
  using (budget_is_compiler(cost_centre_id))
  with check (budget_is_compiler(cost_centre_id));

create policy team_members_select on budget_team_members for select
  using (exists (select 1 from budget_teams t
                 where t.id = team_id and budget_has_cc(t.cost_centre_id)));
create policy team_members_write on budget_team_members for all
  using (exists (select 1 from budget_teams t
                 where t.id = team_id and budget_is_compiler(t.cost_centre_id)))
  with check (exists (select 1 from budget_teams t
                      where t.id = team_id and budget_is_compiler(t.cost_centre_id)));

create policy customers_select on budget_customers for select using (budget_has_cc(cost_centre_id));
create policy customers_write on budget_customers for all
  using (budget_is_compiler(cost_centre_id))
  with check (budget_is_compiler(cost_centre_id));

create policy revenue_select on budget_revenue_lines for select using (budget_has_cc(cost_centre_id));
create policy revenue_write on budget_revenue_lines for all
  using (budget_can_edit(cycle_id, cost_centre_id))
  with check (budget_can_edit(cycle_id, cost_centre_id));

-- approvals: read if assigned; state changes via RPCs above, direct writes admin-only
create policy approvals_select on budget_approvals for select using (budget_has_cc(cost_centre_id));
create policy approvals_write on budget_approvals for all
  using (budget_is_admin()) with check (budget_is_admin());
