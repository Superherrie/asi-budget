-- 011: Customers become a shared master list. cost_centre_id null = global
-- (available in every branch's dropdown); a cost centre id still allows
-- branch-specific customers. Seeds the group customer list.

alter table budget_customers alter column cost_centre_id drop not null;

drop policy if exists customers_select on budget_customers;
create policy customers_select on budget_customers for select
  using (cost_centre_id is null or budget_has_cc(cost_centre_id));

drop policy if exists customers_write on budget_customers;
create policy customers_write on budget_customers for all
  using ((cost_centre_id is null and budget_is_admin()) or (cost_centre_id is not null and budget_is_compiler(cost_centre_id)))
  with check ((cost_centre_id is null and budget_is_admin()) or (cost_centre_id is not null and budget_is_compiler(cost_centre_id)));

insert into budget_customers (cost_centre_id, name)
select null, v.name
from (values
  ('FNB a Division of FirstRand Bank Ltd'),
  ('Capitec Bank Ltd - Att:Cred'),
  ('ABSA Bank Ltd'),
  ('Sasol Synfuels (Pty) Ltd A Div. Of Sasol South Africa (Pty) Ltd'),
  ('Sasol Group Services A Div Of Sasol S.A'),
  ('BCX (Pty) Ltd - South 32'),
  ('Tronox Kzn Sands (Pty) Ltd'),
  ('Wbho Construction (Pty) Ltd'),
  ('Sasol Mining (Pty) Ltd C/O Sasol Shared Services'),
  ('Assmang Pty Ltd (Khumani Ironore)'),
  ('Gijima  Holdings (Pty) Ltd'),
  ('Hotazel Manganese Mines(Pty)Ltd'),
  ('Rustenburg Platinum Mines Ltd Valterra Platinum Ltd'),
  ('Old Mutual Finance (Pty) Ltd (Ups)'),
  ('K2018239548 (Sa) (Pty) Ltd T/A Proconics'),
  ('Richardsbay Bay Titanium (Pty) Ltd'),
  ('RJR Electrical & Plumbing (Pty) Ltd'),
  ('Air Liquide Large Industries South Africa (Pty)Ltd'),
  ('Cash Sale'),
  ('Hillside Aluminium (Pty) Ltd'),
  ('Megchem (Pty) Ltd'),
  ('Sefako Makgatho Health Sciences University'),
  ('SBV Services (Pty) Ltd'),
  ('Honeywell Automation Control Sol. Sa (Pty) Ltd - Hps'),
  ('Philco Systems (Pty) Ltd'),
  ('Sishen Iron Ore Comp.(Pty) Ltd -  X66952'),
  ('University Of Johannesburg'),
  ('Yantek Industries (Pty) Ltd'),
  ('IC Logistix (Pty) Ltd'),
  ('South African Mint Company (Pty) Ltd'),
  ('Sishen Iron Ore Company (Pty) Ltd -  X66952'),
  ('Nampak Products Pty Ltd'),
  ('Golden Energy (Pty) Ltd'),
  ('Assmang (Pty) Ltd'),
  ('Old Mutual Finance (Pty) Ltd (Maintenance)'),
  ('Datacentrix (Pty) Ltd - PE'),
  ('Natref - Att:  Creditors'),
  ('Volvo Group Southern Africa (Pty) Ltd'),
  ('Msc Depots (Pty) Ltd'),
  ('Richards Bay Coal Terminal (Pty) Ltd'),
  ('Q-KON (Pty) Ltd'),
  ('Invoke Solutions (Pty) Ltd'),
  ('Sasol Chemicals A Div. Of Sasol South Africa (Pty) Ltd'),
  ('JSE Limited'),
  ('Powerconnect Systems (Pty) Ltd'),
  ('Anglo Corporate Services South Africa (Pty) Ltd'),
  ('Tongaat Hulett Limited T/A Tongaat Hulett Sugar'),
  ('Whip Retail Project Management (Pty) Ltd'),
  ('Emerald Safari Resort (Pty) Ltd'),
  ('Blaauwberg Beach Hotel')
) as v(name)
where not exists (
  select 1 from budget_customers c where c.cost_centre_id is null and c.name = v.name
);
