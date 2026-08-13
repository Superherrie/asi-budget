-- Auto-calculated depreciation (account 409000).
-- Opening = prior June (FY-1 m12) carried across the year; plus straight-line
-- depreciation on budgeted capex from the month each item is bought.
-- Useful lives: F&F 5y, Plant 5y, Computer 3y, Software 3y, Leasehold 3y,
-- Motor Vehicles 4y, Tools 2y.

alter table budget_accounts drop constraint if exists budget_accounts_input_type_check;
alter table budget_accounts add constraint budget_accounts_input_type_check check (
  input_type = any (array['direct','revenue','salary','cellphone','vehicle','material_pct','training','ho_alloc','subcontractor','rti','internal_sales','depreciation'])
);

update budget_accounts set input_type = 'depreciation' where code = '409000';

create or replace view budget_statement_lines as
 SELECT cycle_id,
    cost_centre_id,
    account_id,
    sum(m1) AS m1,
    sum(m2) AS m2,
    sum(m3) AS m3,
    sum(m4) AS m4,
    sum(m5) AS m5,
    sum(m6) AS m6,
    sum(m7) AS m7,
    sum(m8) AS m8,
    sum(m9) AS m9,
    sum(m10) AS m10,
    sum(m11) AS m11,
    sum(m12) AS m12
   FROM ( SELECT budget_lines.cycle_id,
            budget_lines.cost_centre_id,
            budget_lines.account_id,
            budget_lines.m1,
            budget_lines.m2,
            budget_lines.m3,
            budget_lines.m4,
            budget_lines.m5,
            budget_lines.m6,
            budget_lines.m7,
            budget_lines.m8,
            budget_lines.m9,
            budget_lines.m10,
            budget_lines.m11,
            budget_lines.m12
           FROM budget_lines
          WHERE budget_lines.account_id <> ( SELECT budget_accounts.id FROM budget_accounts WHERE budget_accounts.code = '409000'::text)
        UNION ALL
         SELECT e.cycle_id,
            e.cost_centre_id,
            el.account_id,
            el.m1,
            el.m2,
            el.m3,
            el.m4,
            el.m5,
            el.m6,
            el.m7,
            el.m8,
            el.m9,
            el.m10,
            el.m11,
            el.m12
           FROM budget_employee_lines el
             JOIN budget_employees e ON e.id = el.employee_id
          WHERE e.active
        UNION ALL
         SELECT vl.cycle_id,
            v.cost_centre_id,
            vl.account_id,
            vl.m1,
            vl.m2,
            vl.m3,
            vl.m4,
            vl.m5,
            vl.m6,
            vl.m7,
            vl.m8,
            vl.m9,
            vl.m10,
            vl.m11,
            vl.m12
           FROM budget_vehicle_lines vl
             JOIN budget_vehicles v ON v.id = vl.vehicle_id
          WHERE v.active
        UNION ALL
         SELECT budget_revenue_lines.cycle_id,
            budget_revenue_lines.cost_centre_id,
            budget_revenue_lines.account_id,
            budget_revenue_lines.m1,
            budget_revenue_lines.m2,
            budget_revenue_lines.m3,
            budget_revenue_lines.m4,
            budget_revenue_lines.m5,
            budget_revenue_lines.m6,
            budget_revenue_lines.m7,
            budget_revenue_lines.m8,
            budget_revenue_lines.m9,
            budget_revenue_lines.m10,
            budget_revenue_lines.m11,
            budget_revenue_lines.m12
           FROM budget_revenue_lines
        UNION ALL
         SELECT r.cycle_id,
            r.cost_centre_id,
            ( SELECT budget_accounts.id
                   FROM budget_accounts
                  WHERE budget_accounts.code = '200000'::text) AS account_id,
            round((- r.m1) * r.material_pct / 100.0, 2) AS round,
            round((- r.m2) * r.material_pct / 100.0, 2) AS round,
            round((- r.m3) * r.material_pct / 100.0, 2) AS round,
            round((- r.m4) * r.material_pct / 100.0, 2) AS round,
            round((- r.m5) * r.material_pct / 100.0, 2) AS round,
            round((- r.m6) * r.material_pct / 100.0, 2) AS round,
            round((- r.m7) * r.material_pct / 100.0, 2) AS round,
            round((- r.m8) * r.material_pct / 100.0, 2) AS round,
            round((- r.m9) * r.material_pct / 100.0, 2) AS round,
            round((- r.m10) * r.material_pct / 100.0, 2) AS round,
            round((- r.m11) * r.material_pct / 100.0, 2) AS round,
            round((- r.m12) * r.material_pct / 100.0, 2) AS round
           FROM budget_revenue_lines r
          WHERE r.material_pct <> 0::numeric
        UNION ALL
         SELECT t.cycle_id,
            t.cost_centre_id,
            a.id AS account_id,
                CASE
                    WHEN t.month = 1 THEN - t.amount
                    ELSE 0::numeric
                END AS "case",
                CASE
                    WHEN t.month = 2 THEN - t.amount
                    ELSE 0::numeric
                END AS "case",
                CASE
                    WHEN t.month = 3 THEN - t.amount
                    ELSE 0::numeric
                END AS "case",
                CASE
                    WHEN t.month = 4 THEN - t.amount
                    ELSE 0::numeric
                END AS "case",
                CASE
                    WHEN t.month = 5 THEN - t.amount
                    ELSE 0::numeric
                END AS "case",
                CASE
                    WHEN t.month = 6 THEN - t.amount
                    ELSE 0::numeric
                END AS "case",
                CASE
                    WHEN t.month = 7 THEN - t.amount
                    ELSE 0::numeric
                END AS "case",
                CASE
                    WHEN t.month = 8 THEN - t.amount
                    ELSE 0::numeric
                END AS "case",
                CASE
                    WHEN t.month = 9 THEN - t.amount
                    ELSE 0::numeric
                END AS "case",
                CASE
                    WHEN t.month = 10 THEN - t.amount
                    ELSE 0::numeric
                END AS "case",
                CASE
                    WHEN t.month = 11 THEN - t.amount
                    ELSE 0::numeric
                END AS "case",
                CASE
                    WHEN t.month = 12 THEN - t.amount
                    ELSE 0::numeric
                END AS "case"
           FROM budget_training_lines t
             JOIN budget_accounts a ON a.code =
                CASE
                    WHEN t.kind = 'health_safety'::text THEN '432500'::text
                    ELSE '432000'::text
                END
        UNION ALL
         SELECT h.cycle_id,
            h.cost_centre_id,
            ( SELECT budget_accounts.id
                   FROM budget_accounts
                  WHERE budget_accounts.code = '400000'::text) AS account_id,
            - h.m1,
            - h.m2,
            - h.m3,
            - h.m4,
            - h.m5,
            - h.m6,
            - h.m7,
            - h.m8,
            - h.m9,
            - h.m10,
            - h.m11,
            - h.m12
           FROM budget_ho_allocations h
        UNION ALL
         SELECT h.cycle_id,
            ( SELECT budget_cost_centres.id
                   FROM budget_cost_centres
                  WHERE budget_cost_centres.code = '000'::text) AS cost_centre_id,
            ( SELECT budget_accounts.id
                   FROM budget_accounts
                  WHERE budget_accounts.code = '309000'::text) AS account_id,
            h.m1,
            h.m2,
            h.m3,
            h.m4,
            h.m5,
            h.m6,
            h.m7,
            h.m8,
            h.m9,
            h.m10,
            h.m11,
            h.m12
           FROM budget_ho_allocations h
        UNION ALL
         SELECT s.cycle_id,
            s.cost_centre_id,
            a.id AS account_id,
            s.m1,
            s.m2,
            s.m3,
            s.m4,
            s.m5,
            s.m6,
            s.m7,
            s.m8,
            s.m9,
            s.m10,
            s.m11,
            s.m12
           FROM budget_subcontractor_lines s
             JOIN budget_subcontractors sc ON sc.id = s.subcontractor_id
             JOIN budget_accounts a ON a.code =
                CASE sc.kind
                    WHEN 'electrical'::text THEN '200310'::text
                    WHEN 'civils'::text THEN '200400'::text
                    ELSE '200300'::text
                END
        UNION ALL
         SELECT r.cycle_id,
            ( SELECT budget_cost_centres.id
                   FROM budget_cost_centres
                  WHERE budget_cost_centres.code = '000'::text) AS cost_centre_id,
            ( SELECT budget_accounts.id
                   FROM budget_accounts
                  WHERE budget_accounts.code = '400100'::text) AS account_id,
            (- r.m1) * 0.03,
            (- r.m2) * 0.03,
            (- r.m3) * 0.03,
            (- r.m4) * 0.03,
            (- r.m5) * 0.03,
            (- r.m6) * 0.03,
            (- r.m7) * 0.03,
            (- r.m8) * 0.03,
            (- r.m9) * 0.03,
            (- r.m10) * 0.03,
            (- r.m11) * 0.03,
            (- r.m12) * 0.03
           FROM budget_revenue_lines r
        UNION ALL
         SELECT rc.cycle_id,
            rc.cost_centre_id,
            ( SELECT budget_accounts.id
                   FROM budget_accounts
                  WHERE budget_accounts.code = '310100'::text) AS account_id,
            (- rc.m1) * cu.internal_charge_pct / 100.0,
            (- rc.m2) * cu.internal_charge_pct / 100.0,
            (- rc.m3) * cu.internal_charge_pct / 100.0,
            (- rc.m4) * cu.internal_charge_pct / 100.0,
            (- rc.m5) * cu.internal_charge_pct / 100.0,
            (- rc.m6) * cu.internal_charge_pct / 100.0,
            (- rc.m7) * cu.internal_charge_pct / 100.0,
            (- rc.m8) * cu.internal_charge_pct / 100.0,
            (- rc.m9) * cu.internal_charge_pct / 100.0,
            (- rc.m10) * cu.internal_charge_pct / 100.0,
            (- rc.m11) * cu.internal_charge_pct / 100.0,
            (- rc.m12) * cu.internal_charge_pct / 100.0
           FROM budget_revenue_customer_lines rc
             JOIN budget_customers cu ON cu.id = rc.customer_id
          WHERE cu.internal_charge_pct <> 0::numeric
        UNION ALL
         SELECT rc.cycle_id,
            ( SELECT budget_cost_centres.id
                   FROM budget_cost_centres
                  WHERE budget_cost_centres.code = 'CAP'::text) AS cost_centre_id,
            ( SELECT budget_accounts.id
                   FROM budget_accounts
                  WHERE budget_accounts.code = '310100'::text) AS account_id,
            rc.m1 * cu.internal_charge_pct / 100.0,
            rc.m2 * cu.internal_charge_pct / 100.0,
            rc.m3 * cu.internal_charge_pct / 100.0,
            rc.m4 * cu.internal_charge_pct / 100.0,
            rc.m5 * cu.internal_charge_pct / 100.0,
            rc.m6 * cu.internal_charge_pct / 100.0,
            rc.m7 * cu.internal_charge_pct / 100.0,
            rc.m8 * cu.internal_charge_pct / 100.0,
            rc.m9 * cu.internal_charge_pct / 100.0,
            rc.m10 * cu.internal_charge_pct / 100.0,
            rc.m11 * cu.internal_charge_pct / 100.0,
            rc.m12 * cu.internal_charge_pct / 100.0
           FROM budget_revenue_customer_lines rc
             JOIN budget_customers cu ON cu.id = rc.customer_id
          WHERE cu.internal_charge_pct <> 0::numeric
        UNION ALL
         SELECT c.id AS cycle_id,
            a.cost_centre_id,
            a.account_id,
            a.m12, a.m12, a.m12, a.m12, a.m12, a.m12,
            a.m12, a.m12, a.m12, a.m12, a.m12, a.m12
           FROM budget_actuals a
             JOIN budget_cycles c ON a.fy_year = (c.fy_year - 1)
          WHERE a.account_id = ( SELECT budget_accounts.id FROM budget_accounts WHERE budget_accounts.code = '409000'::text)
        UNION ALL
         SELECT cx.cycle_id,
            cx.cost_centre_id,
            ( SELECT budget_accounts.id FROM budget_accounts WHERE budget_accounts.code = '409000'::text) AS account_id,
            CASE WHEN cx.idx <= 1 THEN cx.mo ELSE 0::numeric END,
            CASE WHEN cx.idx <= 2 THEN cx.mo ELSE 0::numeric END,
            CASE WHEN cx.idx <= 3 THEN cx.mo ELSE 0::numeric END,
            CASE WHEN cx.idx <= 4 THEN cx.mo ELSE 0::numeric END,
            CASE WHEN cx.idx <= 5 THEN cx.mo ELSE 0::numeric END,
            CASE WHEN cx.idx <= 6 THEN cx.mo ELSE 0::numeric END,
            CASE WHEN cx.idx <= 7 THEN cx.mo ELSE 0::numeric END,
            CASE WHEN cx.idx <= 8 THEN cx.mo ELSE 0::numeric END,
            CASE WHEN cx.idx <= 9 THEN cx.mo ELSE 0::numeric END,
            CASE WHEN cx.idx <= 10 THEN cx.mo ELSE 0::numeric END,
            CASE WHEN cx.idx <= 11 THEN cx.mo ELSE 0::numeric END,
            CASE WHEN cx.idx <= 12 THEN cx.mo ELSE 0::numeric END
           FROM ( SELECT cl.cycle_id,
                    cl.cost_centre_id,
                    (((EXTRACT(year FROM cl.capex_date)::integer - (cy.fy_year - 1)) * 12) + EXTRACT(month FROM cl.capex_date)::integer) - 6 AS idx,
                    (- abs(cl.amount)) / ((
                      CASE cl.category
                        WHEN 'Furniture and Fittings' THEN 5
                        WHEN 'Plant and Machinery' THEN 5
                        WHEN 'Computer Equipment' THEN 3
                        WHEN 'Software' THEN 3
                        WHEN 'Leasehold Improvements' THEN 3
                        WHEN 'Motor Vehicles' THEN 4
                        WHEN 'Tools' THEN 2
                        ELSE 5
                      END) * 12)::numeric AS mo
                   FROM budget_capex_lines cl
                     JOIN budget_cycles cy ON cy.id = cl.cycle_id
                  WHERE cl.capex_date IS NOT NULL AND cl.amount <> 0::numeric) cx
          WHERE cx.idx >= 1 AND cx.idx <= 12
) u
  GROUP BY cycle_id, cost_centre_id, account_id;
