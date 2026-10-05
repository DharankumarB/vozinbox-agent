-- =============================================================================
-- VozInbox Agent — 0006 Data deletion, retention and account teardown (§37)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- delete_vozinbox_data — removes all VozInbox-owned data for a user.
-- Deliberately does NOT claim to delete anything at the email provider.
-- -----------------------------------------------------------------------------
create or replace function public.delete_vozinbox_data(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_counts jsonb := '{}'::jsonb;
  v_n integer;
begin
  -- Order matters: children before parents where FKs are not cascading.
  delete from public.email_actions where user_id = p_user_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('email_actions', v_n);

  delete from public.email_analysis_history where user_id = p_user_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('email_analysis_history', v_n);

  delete from public.email_analysis where user_id = p_user_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('email_analysis', v_n);

  delete from public.tasks where user_id = p_user_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('tasks', v_n);

  delete from public.notifications where user_id = p_user_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('notifications', v_n);

  delete from public.agent_actions where user_id = p_user_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('agent_actions', v_n);

  delete from public.agent_runs where user_id = p_user_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('agent_runs', v_n);

  delete from public.emails where user_id = p_user_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('emails', v_n);

  delete from public.email_threads where user_id = p_user_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('email_threads', v_n);

  delete from public.integration_events where user_id = p_user_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('integration_events', v_n);

  delete from public.email_account_credentials where user_id = p_user_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('email_account_credentials', v_n);

  delete from public.email_accounts where user_id = p_user_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('email_accounts', v_n);

  return v_counts;
end;
$$;

revoke all on function public.delete_vozinbox_data(uuid) from anon, authenticated;
grant execute on function public.delete_vozinbox_data(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- Retention: purge old, low-value records to keep queries fast (§41).
-- -----------------------------------------------------------------------------
create or replace function public.prune_old_records(p_keep_days integer default 180)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_counts jsonb := '{}'::jsonb;
  v_n integer;
begin
  delete from public.agent_actions where created_at < now() - make_interval(days => p_keep_days);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('agent_actions', v_n);

  delete from public.agent_runs
   where created_at < now() - make_interval(days => p_keep_days)
     and status in ('COMPLETED', 'FAILED', 'SKIPPED');
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('agent_runs', v_n);

  delete from public.integration_events
   where created_at < now() - make_interval(days => p_keep_days) and severity = 'info';
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('integration_events', v_n);

  delete from public.notifications
   where is_read = true and created_at < now() - make_interval(days => p_keep_days);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('notifications', v_n);

  perform public.prune_rate_limit_buckets();
  return v_counts;
end;
$$;

revoke all on function public.prune_old_records(integer) from anon, authenticated;
grant execute on function public.prune_old_records(integer) to service_role;

-- -----------------------------------------------------------------------------
-- Dashboard counters in a single round trip (§6, §41)
-- -----------------------------------------------------------------------------
create or replace function public.get_dashboard_counters(p_user_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with mine as (
    select e.id, e.is_read, e.received_at, ea.category, ea.priority,
           ea.action_required, ea.detected_deadline, ea.needs_review
    from public.emails e
    left join public.email_analysis ea on ea.email_id = e.id
    where e.user_id = p_user_id and e.is_archived = false
  )
  select jsonb_build_object(
    'unread',            (select count(*) from mine where is_read = false),
    'actionRequired',    (select count(*) from mine where action_required = true),
    'highPriority',      (select count(*) from mine where priority in ('CRITICAL','HIGH')),
    'pendingTasks',      (select count(*) from public.tasks t
                            where t.user_id = p_user_id and t.status in ('SUGGESTED','TODO','IN_PROGRESS')),
    'suggestedTasks',    (select count(*) from public.tasks t
                            where t.user_id = p_user_id and t.status = 'SUGGESTED'),
    'unreadNotifications', (select count(*) from public.notifications n
                            where n.user_id = p_user_id and n.is_read = false),
    'upcomingDeadlines', (select count(*) from mine
                            where detected_deadline is not null
                              and nullif(detected_deadline ->> 'date','') is not null
                              and (detected_deadline ->> 'date')::date
                                  between current_date and current_date + 14),
    'needsReview',       (select count(*) from mine where needs_review = true),
    'analyzedToday',     (select count(*) from mine
                            where received_at >= date_trunc('day', now())),
    'totalEmails',       (select count(*) from mine)
  );
$$;

revoke all on function public.get_dashboard_counters(uuid) from anon, authenticated;
grant execute on function public.get_dashboard_counters(uuid) to service_role;
