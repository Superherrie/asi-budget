-- 010: Revenue is budgeted by TEAM (which sets the total that feeds Sales),
-- then allocated to CUSTOMERS in a second table. The customer table is an
-- allocation view only — it never feeds the GL, so nothing double-counts.
-- The unallocated balance ("Other") is derived: team total - customer total.

-- Team lines live in budget_revenue_lines with customer_id null.
update budget_revenue_lines set customer_id = null where customer_id is not null;

create table if not exists budget_revenue_customer_lines (
  id             bigint generated always as identity primary key,
  cycle_id       bigint not null references budget_cycles (id) on delete cascade,
  cost_centre_id bigint not null references budget_cost_centres (id) on delete cascade,
  customer_id    bigint not null references budget_customers (id) on delete cascade,
  m1 numeric(14,2) not null default 0,  m2 numeric(14,2) not null default 0,
  m3 numeric(14,2) not null default 0,  m4 numeric(14,2) not null default 0,
  m5 numeric(14,2) not null default 0,  m6 numeric(14,2) not null default 0,
  m7 numeric(14,2) not null default 0,  m8 numeric(14,2) not null default 0,
  m9 numeric(14,2) not null default 0,  m10 numeric(14,2) not null default 0,
  m11 numeric(14,2) not null default 0, m12 numeric(14,2) not null default 0,
  unique (cycle_id, cost_centre_id, customer_id)
);

create index if not exists budget_revenue_customer_cc_idx
  on budget_revenue_customer_lines (cycle_id, cost_centre_id);

alter table budget_revenue_customer_lines enable row level security;
create policy revenue_customer_select on budget_revenue_customer_lines for select
  using (budget_has_cc(cost_centre_id));
create policy revenue_customer_write on budget_revenue_customer_lines for all
  using (budget_can_edit(cycle_id, cost_centre_id))
  with check (budget_can_edit(cycle_id, cost_centre_id));
