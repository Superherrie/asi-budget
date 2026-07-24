-- 008: RTI Charges (400100) are auto-calculated as 3% of total company revenue
-- and budgeted in Head Office (cost centre 000). No manual entry anywhere.
-- To change the rate, edit the 0.03 factor in the RTI branch of the view below.

alter table budget_accounts drop constraint if exists budget_accounts_input_type_check;
alter table budget_accounts add constraint budget_accounts_input_type_check
  check (input_type in ('direct', 'revenue', 'salary', 'cellphone', 'vehicle', 'material_pct', 'training', 'ho_alloc', 'subcontractor', 'rti'));

update budget_accounts set input_type = 'rti' where code = '400100';
delete from budget_lines
where account_id in (select id from budget_accounts where code = '400100');

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
  union all
  select r.cycle_id, r.cost_centre_id,
         (select id from budget_accounts where code = '200000') as account_id,
         round(-r.m1  * r.material_pct / 100.0, 2), round(-r.m2  * r.material_pct / 100.0, 2),
         round(-r.m3  * r.material_pct / 100.0, 2), round(-r.m4  * r.material_pct / 100.0, 2),
         round(-r.m5  * r.material_pct / 100.0, 2), round(-r.m6  * r.material_pct / 100.0, 2),
         round(-r.m7  * r.material_pct / 100.0, 2), round(-r.m8  * r.material_pct / 100.0, 2),
         round(-r.m9  * r.material_pct / 100.0, 2), round(-r.m10 * r.material_pct / 100.0, 2),
         round(-r.m11 * r.material_pct / 100.0, 2), round(-r.m12 * r.material_pct / 100.0, 2)
  from budget_revenue_lines r
  where r.material_pct <> 0
  union all
  select t.cycle_id, t.cost_centre_id, a.id as account_id,
         case when t.month = 1  then -t.amount else 0 end, case when t.month = 2  then -t.amount else 0 end,
         case when t.month = 3  then -t.amount else 0 end, case when t.month = 4  then -t.amount else 0 end,
         case when t.month = 5  then -t.amount else 0 end, case when t.month = 6  then -t.amount else 0 end,
         case when t.month = 7  then -t.amount else 0 end, case when t.month = 8  then -t.amount else 0 end,
         case when t.month = 9  then -t.amount else 0 end, case when t.month = 10 then -t.amount else 0 end,
         case when t.month = 11 then -t.amount else 0 end, case when t.month = 12 then -t.amount else 0 end
  from budget_training_lines t
  join budget_accounts a on a.code = case when t.kind = 'health_safety' then '432500' else '432000' end
  union all
  select h.cycle_id, h.cost_centre_id,
         (select id from budget_accounts where code = '400000') as account_id,
         -h.m1, -h.m2, -h.m3, -h.m4, -h.m5, -h.m6, -h.m7, -h.m8, -h.m9, -h.m10, -h.m11, -h.m12
  from budget_ho_allocations h
  union all
  select h.cycle_id,
         (select id from budget_cost_centres where code = '000') as cost_centre_id,
         (select id from budget_accounts where code = '309000') as account_id,
         h.m1, h.m2, h.m3, h.m4, h.m5, h.m6, h.m7, h.m8, h.m9, h.m10, h.m11, h.m12
  from budget_ho_allocations h
  union all
  select s.cycle_id, s.cost_centre_id, a.id as account_id,
         s.m1, s.m2, s.m3, s.m4, s.m5, s.m6, s.m7, s.m8, s.m9, s.m10, s.m11, s.m12
  from budget_subcontractor_lines s
  join budget_accounts a on a.code = case when s.kind = 'electrical' then '200310' else '200300' end
  union all
  -- RTI: 3% of total company revenue, charged in Head Office (000)
  select r.cycle_id,
         (select id from budget_cost_centres where code = '000') as cost_centre_id,
         (select id from budget_accounts where code = '400100') as account_id,
         -r.m1 * 0.03, -r.m2 * 0.03, -r.m3 * 0.03, -r.m4  * 0.03, -r.m5  * 0.03, -r.m6  * 0.03,
         -r.m7 * 0.03, -r.m8 * 0.03, -r.m9 * 0.03, -r.m10 * 0.03, -r.m11 * 0.03, -r.m12 * 0.03
  from budget_revenue_lines r
) u
group by cycle_id, cost_centre_id, account_id;
