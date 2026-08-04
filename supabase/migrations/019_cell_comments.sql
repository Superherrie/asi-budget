-- 019: Free-text notes a user can attach to any grid cell. Keyed by the grid
-- (scope) + row key + month, per cycle and cost centre.

create table if not exists budget_cell_comments (
  id             bigint generated always as identity primary key,
  cycle_id       bigint not null references budget_cycles (id) on delete cascade,
  cost_centre_id bigint not null references budget_cost_centres (id) on delete cascade,
  scope          text not null,           -- which grid, e.g. 'statement', 'salaries'
  row_key        text not null,           -- MonthGrid row key
  month          int not null check (month between 1 and 12),
  body           text not null default '',
  updated_at     timestamptz not null default now(),
  unique (cycle_id, cost_centre_id, scope, row_key, month)
);

create index if not exists budget_cell_comments_idx on budget_cell_comments (cycle_id, cost_centre_id, scope);

alter table budget_cell_comments enable row level security;
create policy cell_comments_select on budget_cell_comments for select
  using (budget_has_cc(cost_centre_id));
create policy cell_comments_write on budget_cell_comments for all
  using (budget_can_edit(cycle_id, cost_centre_id))
  with check (budget_can_edit(cycle_id, cost_centre_id));
