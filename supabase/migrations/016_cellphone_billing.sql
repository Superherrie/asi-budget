-- 016: Imported Vodacom cellphone billing, matched to employees. Used as a
-- reference column on the Salaries > Cell Phones grid — it never feeds the GL.
-- Anything that cannot be matched to an employee is parked in ZZZ.

create table if not exists budget_cellphones (
  id             bigint generated always as identity primary key,
  cost_centre_id bigint not null references budget_cost_centres (id) on delete cascade,
  employee_id    bigint references budget_employees (id) on delete set null,
  cell_no        text not null,
  package        text not null default '',
  billed_name    text not null default '',
  gl_code        text not null default '',
  period         date not null,                    -- first of the billing month
  amount         numeric(14,2) not null default 0, -- total excluding VAT
  unique (cell_no, period)
);

create index if not exists budget_cellphones_cc_idx on budget_cellphones (cost_centre_id, period);
create index if not exists budget_cellphones_emp_idx on budget_cellphones (employee_id, period);

alter table budget_cellphones enable row level security;
create policy cellphones_select on budget_cellphones for select
  using (budget_has_cc(cost_centre_id));
create policy cellphones_write on budget_cellphones for all
  using (budget_is_admin()) with check (budget_is_admin());
