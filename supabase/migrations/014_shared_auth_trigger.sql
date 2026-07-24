-- 014: SHARED-PROJECT CHANGE (affects ASI-Excellence too).
--
-- This Supabase project is shared with ASI-Excellence, whose on_auth_user_created
-- trigger raised an exception for any auth user without a pending_invites row.
-- That blocked creating ASI Budget users entirely.
--
-- Now: a user with no invitation is still created, but gets NO ASI-Excellence
-- profile — so they have no access to that app. Invited users are handled
-- exactly as before (profile created, invite consumed).

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
    inv public.pending_invites%rowtype;
begin
    select * into inv from public.pending_invites where lower(email) = lower(new.email);

    -- No ASI-Excellence invitation (e.g. an ASI Budget user): allow the auth
    -- user, but create no profile, so they gain no access to ASI-Excellence.
    if not found then
        return new;
    end if;

    insert into public.profiles (id, email, name, app_role, job_role)
    values (new.id, inv.email, inv.name, inv.app_role, inv.job_role);

    delete from public.pending_invites where lower(email) = lower(new.email);
    return new;
end;
$function$;
