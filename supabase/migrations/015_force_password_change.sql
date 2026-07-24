-- 015: Force a password change on first login for users whose password was set
-- for them (bulk import / admin reset).
--
-- budget_profiles is admin-update-only, so users clear their own flag through a
-- security-definer RPC that touches nothing else — no RLS loosening, no way to
-- grant yourself admin.

alter table budget_profiles
  add column if not exists must_change_password boolean not null default false;

-- everyone whose password came from the bulk import must change it
update budget_profiles set must_change_password = true
where email <> 'herman.devries@asiconnect.co.za';

create or replace function budget_password_changed()
returns void language sql security definer set search_path = public as
$$ update budget_profiles set must_change_password = false where user_id = auth.uid() $$;

revoke all on function budget_password_changed() from public;
grant execute on function budget_password_changed() to authenticated;
