-- 007: Mark accounts that must not be budgeted. They still appear on the
-- statement with their history, but their budget cells are read-only.

alter table budget_accounts
  add column if not exists budgetable boolean not null default true;

update budget_accounts set budgetable = false where code in (
  '200100',  -- Cost of Material Provision
  '200110',  -- Cost of Subcontractors Provision
  '230500',  -- Stock Adjustments
  '231000',  -- Stock Revaluation
  '232500',  -- Purchase Price Variance
  '301000',  -- Discounts Received
  '213000', '213100', '213200', '213300', '213400',  -- Leave Pay Provision (all)
  '403000',  -- Bad Debts
  '403500'   -- Bad Debts Provision
);

-- Drop any budget already captured against a non-budgetable account.
delete from budget_lines
where account_id in (select id from budget_accounts where not budgetable);
