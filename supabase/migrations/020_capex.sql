-- Capex register per branch: standalone capital-spend line items (not part of
-- the income-statement view). One row per planned purchase.
create table if not exists budget_capex_lines (
  id bigint generated always as identity primary key,
  cycle_id bigint not null references budget_cycles (id) on delete cascade,
  cost_centre_id bigint not null references budget_cost_centres (id) on delete cascade,
  description text not null default '',
  capex_date date,
  amount numeric not null default 0,
  supplier text not null default '',
  category text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists budget_capex_lines_idx on budget_capex_lines (cycle_id, cost_centre_id);

alter table budget_capex_lines enable row level security;

create policy capex_select on budget_capex_lines
  for select using (budget_has_cc(cost_centre_id));
create policy capex_write on budget_capex_lines
  for all using (budget_can_edit(cycle_id, cost_centre_id))
  with check (budget_can_edit(cycle_id, cost_centre_id));
