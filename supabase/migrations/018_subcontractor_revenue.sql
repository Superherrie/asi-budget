-- 018: Subcontractors become a shared entity (name + category) budgeted for
-- REVENUE on the Revenue tab and for COST on the Subcontractors tab.

create table if not exists budget_subcontractors (
  id             bigint generated always as identity primary key,
  cycle_id       bigint not null references budget_cycles (id) on delete cascade,
  cost_centre_id bigint not null references budget_cost_centres (id) on delete cascade,
  name           text not null default '',
  kind           text not null default 'electrical' check (kind in ('electrical', 'data', 'civils')),
  active         boolean not null default true,
  unique (cycle_id, cost_centre_id, name)
);
create index if not exists budget_subcontractors_cc_idx on budget_subcontractors (cycle_id, cost_centre_id);
alter table budget_subcontractors enable row level security;
create policy subcontractors_select on budget_subcontractors for select
  using (budget_has_cc(cost_centre_id));
create policy subcontractors_write on budget_subcontractors for all
  using (budget_can_edit(cycle_id, cost_centre_id))
  with check (budget_can_edit(cycle_id, cost_centre_id));

-- revenue per subcontractor lives in budget_revenue_lines (feeds Sales like team revenue)
alter table budget_revenue_lines
  add column if not exists subcontractor_id bigint references budget_subcontractors (id) on delete cascade;

-- cost lines now reference the entity (kind/name come from it)
alter table budget_subcontractor_lines
  add column if not exists subcontractor_id bigint references budget_subcontractors (id) on delete cascade;

-- recreate the view sourcing subcontractor kind from the entity (must precede the drop)
create or replace view budget_statement_lines with (security_invoker = on) as
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
          WHERE cu.internal_charge_pct <> 0::numeric) u
  GROUP BY cycle_id, cost_centre_id, account_id;;

alter table budget_subcontractor_lines drop column if exists name;
alter table budget_subcontractor_lines drop column if exists kind;
create unique index if not exists budget_subcontractor_lines_sub_idx on budget_subcontractor_lines (subcontractor_id);
