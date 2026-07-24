-- 013: Consulting Fees always come from the Salaries tab (they are fed by
-- employee lines for managed-services staff). Marking them input_type
-- 'salary' makes the statement render them read-only and greyed, showing
-- zero in branches that have no such staff — never manually editable.
--
-- No view change needed: the view already rolls employee lines up by
-- account_id regardless of input_type.

update budget_accounts set input_type = 'salary'
where name ilike 'Consulting Fees%';

-- nothing should be captured directly against them
delete from budget_lines
where account_id in (select id from budget_accounts where name ilike 'Consulting Fees%');
