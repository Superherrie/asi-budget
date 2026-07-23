-- 005: Give each vehicle a category (Ops Cabling / Sales / Admin / Ops Admin /
-- Exec) and auto-create its M/V expense GL lines so costs can be budgeted per
-- vehicle. The category maps to the matching M/V accounts (the suffix after the
-- last " - " in the account name).

alter table budget_vehicles
  add column if not exists category text not null default 'Ops Cabling';

-- Backfill: for each vehicle, create a (zero) budget line for every M/V account
-- whose category matches the vehicle's category, in the open cycle.
insert into budget_vehicle_lines (cycle_id, vehicle_id, account_id)
select cyc.id, v.id, a.id
from budget_vehicles v
cross join (select id from budget_cycles where status = 'open' order by fy_year desc limit 1) cyc
join budget_accounts a
  on a.input_type = 'vehicle'
  and split_part(a.name, ' - ', 3) = v.category
where not exists (
  select 1 from budget_vehicle_lines vl
  where vl.cycle_id = cyc.id and vl.vehicle_id = v.id and vl.account_id = a.id
);
