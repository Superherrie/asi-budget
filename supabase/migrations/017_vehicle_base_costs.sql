-- 017: Base running-cost per vehicle per M/V cost type, imported from the fleet
-- workbook. A budgeting reference only — shown as a column on the Vehicles tab,
-- never feeds the GL. Running costs are 12-month totals (÷12); lease is monthly.

create table if not exists budget_vehicle_base (
  id         bigint generated always as identity primary key,
  vehicle_id bigint not null references budget_vehicles (id) on delete cascade,
  cost_type  text not null,           -- Fuel/Oil, Maintenance, Toll Fees, Lease/Rental, Surveillance
  amount     numeric(14,2) not null default 0,  -- positive monthly magnitude
  unique (vehicle_id, cost_type)
);

alter table budget_vehicle_base enable row level security;
create policy vehicle_base_select on budget_vehicle_base for select
  using (exists (select 1 from budget_vehicles v where v.id = vehicle_id and budget_has_cc(v.cost_centre_id)));
create policy vehicle_base_write on budget_vehicle_base for all
  using (budget_is_admin()) with check (budget_is_admin());
