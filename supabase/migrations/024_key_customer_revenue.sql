-- Service Desk (CAP) view of key-customer revenue budgeted across all branches.
-- Duan compiles CAP only, so RLS would hide other branches' lines. This
-- security-definer function returns per-branch revenue for the flagged key
-- customers (Capitec, Old Mutual Finance, Yantek), but only to a CAP-holder or
-- an admin — everyone else gets no rows.

alter table budget_customers add column if not exists key_customer boolean not null default false;
update budget_customers set key_customer = true
  where name ilike '%capitec%' or name ilike '%old mutual finance%' or name ilike '%yantek%';

create or replace function budget_key_customer_revenue(p_cycle bigint)
returns table (
  customer_id bigint, customer_name text,
  cost_centre_id bigint, branch_code text, branch_name text,
  m1 numeric, m2 numeric, m3 numeric, m4 numeric, m5 numeric, m6 numeric,
  m7 numeric, m8 numeric, m9 numeric, m10 numeric, m11 numeric, m12 numeric
)
language sql
security definer
stable
set search_path = public
as $$
  select cu.id, cu.name, cc.id, cc.code, cc.name,
    rc.m1, rc.m2, rc.m3, rc.m4, rc.m5, rc.m6, rc.m7, rc.m8, rc.m9, rc.m10, rc.m11, rc.m12
  from budget_revenue_customer_lines rc
  join budget_customers cu on cu.id = rc.customer_id
  join budget_cost_centres cc on cc.id = rc.cost_centre_id
  where rc.cycle_id = p_cycle
    and cu.key_customer
    and (budget_is_admin() or budget_has_cc((select id from budget_cost_centres where code = 'CAP')))
  order by cu.name, cc.code;
$$;

grant execute on function budget_key_customer_revenue(bigint) to authenticated;
