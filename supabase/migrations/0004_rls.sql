-- =============================================================================
-- VozInbox Agent — 0004 Row Level Security (§31, §5)
-- -----------------------------------------------------------------------------
-- Model:
--   • Every user-data table gets RLS.
--   • Policies are built on a single predicate: owner = auth.uid().
--   • `email_account_credentials` gets RLS with NO policies → deny-all for
--     anon/authenticated. Only the service role (server-side) may read it.
--   • Server-side code uses the service role and MUST scope every query by
--     user_id explicitly. RLS is the second line of defence, not the only one.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- profiles
-- -----------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.profiles force row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated using (id = (select auth.uid()));

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert to authenticated with check (id = (select auth.uid()));

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- user_preferences
-- -----------------------------------------------------------------------------
alter table public.user_preferences enable row level security;
alter table public.user_preferences force row level security;

drop policy if exists user_preferences_select_own on public.user_preferences;
create policy user_preferences_select_own on public.user_preferences
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists user_preferences_insert_own on public.user_preferences;
create policy user_preferences_insert_own on public.user_preferences
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists user_preferences_update_own on public.user_preferences;
create policy user_preferences_update_own on public.user_preferences
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- email_accounts
-- -----------------------------------------------------------------------------
alter table public.email_accounts enable row level security;
alter table public.email_accounts force row level security;

drop policy if exists email_accounts_select_own on public.email_accounts;
create policy email_accounts_select_own on public.email_accounts
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists email_accounts_update_own on public.email_accounts;
create policy email_accounts_update_own on public.email_accounts
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Connections are created/removed exclusively by the server (OAuth flow).
drop policy if exists email_accounts_delete_own on public.email_accounts;
create policy email_accounts_delete_own on public.email_accounts
  for delete to authenticated using (user_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- email_account_credentials — deny-all to clients (server/service role only)
-- -----------------------------------------------------------------------------
alter table public.email_account_credentials enable row level security;
alter table public.email_account_credentials force row level security;
-- Intentionally NO policies: anon and authenticated roles can never read tokens.

-- -----------------------------------------------------------------------------
-- Generic owner-only policy helper for the remaining tables
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'email_threads', 'emails', 'email_analysis', 'email_analysis_history',
    'email_actions', 'tasks', 'notifications', 'agent_runs', 'agent_actions',
    'integration_events'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);

    execute format('drop policy if exists %I on public.%I', t || '_select_own', t);
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (user_id = (select auth.uid()))', t || '_select_own', t);

    execute format('drop policy if exists %I on public.%I', t || '_insert_own', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated
         with check (user_id = (select auth.uid()))', t || '_insert_own', t);

    execute format('drop policy if exists %I on public.%I', t || '_update_own', t);
    execute format(
      'create policy %I on public.%I for update to authenticated
         using (user_id = (select auth.uid()))
         with check (user_id = (select auth.uid()))', t || '_update_own', t);

    execute format('drop policy if exists %I on public.%I', t || '_delete_own', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated
         using (user_id = (select auth.uid()))', t || '_delete_own', t);
  end loop;
end $$;

-- `email_analysis_history` is append-only: no update/delete for clients.
drop policy if exists email_analysis_history_update_own on public.email_analysis_history;
drop policy if exists email_analysis_history_delete_own on public.email_analysis_history;

-- `agent_runs` / `agent_actions` are written by the server only.
drop policy if exists agent_runs_insert_own on public.agent_runs;
drop policy if exists agent_runs_update_own on public.agent_runs;
drop policy if exists agent_runs_delete_own on public.agent_runs;
drop policy if exists agent_actions_insert_own on public.agent_actions;
drop policy if exists agent_actions_update_own on public.agent_actions;
drop policy if exists agent_actions_delete_own on public.agent_actions;

-- `integration_events` is server-written telemetry.
drop policy if exists integration_events_insert_own on public.integration_events;
drop policy if exists integration_events_update_own on public.integration_events;
drop policy if exists integration_events_delete_own on public.integration_events;

-- -----------------------------------------------------------------------------
-- rate_limit_buckets — server only
-- -----------------------------------------------------------------------------
alter table public.rate_limit_buckets enable row level security;
alter table public.rate_limit_buckets force row level security;

-- -----------------------------------------------------------------------------
-- Verification helper: run `select public.assert_rls_enabled();` after migrating.
-- -----------------------------------------------------------------------------
create or replace function public.assert_rls_enabled()
returns table (table_name text, rls_enabled boolean, policies integer)
language sql
security definer
set search_path = ''
as $$
  select c.relname::text,
         c.relrowsecurity,
         (select count(*)::int from pg_policies p
           where p.schemaname = 'public' and p.tablename = c.relname)
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and c.relname in (
      'profiles','user_preferences','email_accounts','email_account_credentials',
      'email_threads','emails','email_analysis','email_analysis_history',
      'email_actions','tasks','notifications','agent_runs','agent_actions',
      'integration_events','rate_limit_buckets'
    )
  order by c.relname;
$$;

revoke all on function public.assert_rls_enabled() from anon, authenticated;
