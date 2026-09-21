-- Remove the 2.5% branch -> Head Office internal charge on the key customers
-- (Capitec, Old Mutual Finance). The charge is data-driven via
-- budget_customers.ho_charge_pct, so setting it to 0 makes the Internal Sales -
-- Head Office (310200) postings compute to zero on every branch and on HO.
-- The 310200 account and the view logic stay in place so the charge can be
-- reinstated later by setting ho_charge_pct again. The 5% CAP charge
-- (internal_charge_pct / 310100) is unaffected.
update budget_customers set ho_charge_pct = 0 where ho_charge_pct <> 0;
