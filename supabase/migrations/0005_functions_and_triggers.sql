-- =============================================================================
-- VozInbox Agent — 0005 Functions, triggers and realtime (§27, §56)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Auto-provision profile + preferences on signup
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url, timezone)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      split_part(coalesce(new.email, 'user'), '@', 1)
    ),
    new.raw_user_meta_data ->> 'avatar_url',
    coalesce(new.raw_user_meta_data ->> 'timezone', 'UTC')
  )
  on conflict (id) do nothing;

  insert into public.user_preferences (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- Backfill helper for users created before the trigger existed.
-- -----------------------------------------------------------------------------
create or replace function public.ensure_user_bootstrap(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  select u.id, u.email,
         coalesce(u.raw_user_meta_data ->> 'full_name', split_part(coalesce(u.email,'user'), '@', 1))
  from auth.users u where u.id = p_user_id
  on conflict (id) do nothing;

  insert into public.user_preferences (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;
end;
$$;

revoke all on function public.ensure_user_bootstrap(uuid) from anon, authenticated;

-- -----------------------------------------------------------------------------
-- Deadline helpers — "due within N days" used by dashboard + search (§6, §18)
-- -----------------------------------------------------------------------------
create or replace function public.emails_with_deadline_between(
  p_user_id uuid,
  p_from date,
  p_to date
)
returns setof public.emails
language sql
stable
security invoker
set search_path = ''
as $$
  select e.*
  from public.emails e
  join public.email_analysis ea on ea.email_id = e.id
  where e.user_id = p_user_id
    and ea.detected_deadline is not null
    and nullif(ea.detected_deadline ->> 'date', '') is not null
    and (ea.detected_deadline ->> 'date')::date between p_from and p_to
  order by (ea.detected_deadline ->> 'date')::date asc,
           nullif(ea.detected_deadline ->> 'time', '') asc nulls last;
$$;

revoke all on function public.emails_with_deadline_between(uuid, date, date) from anon;
grant execute on function public.emails_with_deadline_between(uuid, date, date) to service_role;

-- -----------------------------------------------------------------------------
-- Rate limiting — atomic bucket increment with a fixed window (§42)
-- Returns true when the request is allowed.
-- -----------------------------------------------------------------------------
create or replace function public.consume_rate_limit(
  p_bucket_key text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.rate_limit_buckets;
begin
  insert into public.rate_limit_buckets (bucket_key, window_start, hits)
  values (p_bucket_key, now(), 1)
  on conflict (bucket_key) do update
    set hits = case
                 when public.rate_limit_buckets.window_start < now() - make_interval(secs => p_window_seconds)
                   then 1
                 else public.rate_limit_buckets.hits + 1
               end,
        window_start = case
                 when public.rate_limit_buckets.window_start < now() - make_interval(secs => p_window_seconds)
                   then now()
                 else public.rate_limit_buckets.window_start
               end,
        updated_at = now()
  returning * into v_row;

  return v_row.hits <= p_limit;
end;
$$;

revoke all on function public.consume_rate_limit(text, integer, integer) from anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;

-- -----------------------------------------------------------------------------
-- Housekeeping: drop stale rate-limit buckets.
-- -----------------------------------------------------------------------------
create or replace function public.prune_rate_limit_buckets()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.rate_limit_buckets where window_start < now() - interval '1 day';
$$;

revoke all on function public.prune_rate_limit_buckets() from anon, authenticated;

-- -----------------------------------------------------------------------------
-- Analytics: processing latency + agent health (§56, §57)
-- -----------------------------------------------------------------------------
create or replace view public.agent_health_daily
with (security_invoker = true)
as
select
  user_id,
  date_trunc('day', started_at)::date                                  as day,
  count(*)                                                             as runs,
  count(*) filter (where status = 'COMPLETED')                         as successful_runs,
  count(*) filter (where status = 'FAILED')                            as failed_runs,
  count(*) filter (where status = 'NEEDS_REVIEW')                      as needs_review_runs,
  avg(duration_ms)                                                     as avg_duration_ms,
  avg(confidence)                                                      as avg_confidence,
  sum(tool_calls)                                                      as tool_calls
from public.agent_runs
group by user_id, date_trunc('day', started_at)::date;

comment on view public.agent_health_daily is
  'Agent performance rollup (processing success rate, latency, confidence).';

-- -----------------------------------------------------------------------------
-- Realtime (§27) — publish user-facing tables for live dashboards.
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['emails', 'email_analysis', 'tasks', 'notifications', 'email_accounts', 'agent_actions']
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      when undefined_object then
        raise notice 'Realtime publication not available; skipping %', t;
      when duplicate_object then
        null;
    end;
  end loop;
end $$;

-- Realtime requires the full row for RLS-filtered updates.
alter table public.emails replica identity full;
alter table public.tasks replica identity full;
alter table public.notifications replica identity full;
alter table public.email_analysis replica identity full;
