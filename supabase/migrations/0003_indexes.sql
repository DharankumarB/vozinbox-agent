-- =============================================================================
-- VozInbox Agent — 0003 Indexes and derived columns (§29, §41)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- emails
-- -----------------------------------------------------------------------------
-- Primary list query: newest first, per user.
create index if not exists emails_user_received_at_idx
  on public.emails (user_id, received_at desc);

create index if not exists emails_user_unread_idx
  on public.emails (user_id, received_at desc)
  where is_read = false;

create index if not exists emails_thread_idx
  on public.emails (thread_id, received_at);

create index if not exists emails_account_received_idx
  on public.emails (account_id, received_at desc);

create index if not exists emails_sender_idx
  on public.emails (user_id, sender_email);

create index if not exists emails_analysis_state_idx
  on public.emails (user_id, analysis_state);

-- Full-text search over subject + body + sender.
create index if not exists emails_search_vector_idx
  on public.emails using gin (search_vector);

create index if not exists emails_subject_trgm_idx
  on public.emails using gin (to_tsvector('simple', coalesce(subject, '')));

-- Keep the tsvector column derived from content (§18).
create or replace function public.emails_search_vector_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.search_vector :=
      setweight(to_tsvector('english', coalesce(new.subject, '')), 'A')
   || setweight(to_tsvector('english', coalesce(new.sender_name, '')), 'B')
   || setweight(to_tsvector('english', coalesce(new.sender_email::text, '')), 'B')
   || setweight(to_tsvector('english', coalesce(new.snippet, '')), 'C')
   || setweight(to_tsvector('english', left(coalesce(new.body_text, ''), 20000)), 'D');
  return new;
end;
$$;

drop trigger if exists emails_search_vector_trigger on public.emails;
create trigger emails_search_vector_trigger
  before insert or update of subject, sender_name, sender_email, snippet, body_text
  on public.emails
  for each row execute function public.emails_search_vector_update();

-- -----------------------------------------------------------------------------
-- email_analysis — the hot path for inbox/dashboard filtering (§7, §47, §48)
-- -----------------------------------------------------------------------------
create index if not exists email_analysis_user_category_idx
  on public.email_analysis (user_id, category);
create index if not exists email_analysis_user_priority_idx
  on public.email_analysis (user_id, priority);
create index if not exists email_analysis_action_required_idx
  on public.email_analysis (user_id, action_required)
  where action_required = true;
create index if not exists email_analysis_deadline_idx
  on public.email_analysis (user_id, ((detected_deadline ->> 'date')))
  where detected_deadline is not null;
create index if not exists email_analysis_needs_review_idx
  on public.email_analysis (user_id) where needs_review = true;
create index if not exists email_analysis_thread_idx
  on public.email_analysis (thread_id, created_at desc);

-- -----------------------------------------------------------------------------
-- email_analysis_history
-- -----------------------------------------------------------------------------
create index if not exists email_analysis_history_email_idx
  on public.email_analysis_history (email_id, created_at desc);
create index if not exists email_analysis_history_thread_idx
  on public.email_analysis_history (thread_id, created_at desc);

-- -----------------------------------------------------------------------------
-- email_actions
-- -----------------------------------------------------------------------------
create index if not exists email_actions_email_idx
  on public.email_actions (email_id);
create index if not exists email_actions_user_status_idx
  on public.email_actions (user_id, status);
create index if not exists email_actions_dedupe_idx
  on public.email_actions (user_id, email_id, action_text);

-- -----------------------------------------------------------------------------
-- tasks
-- -----------------------------------------------------------------------------
create index if not exists tasks_user_status_idx
  on public.tasks (user_id, status, created_at desc);
create index if not exists tasks_user_due_idx
  on public.tasks (user_id, due_date, due_time)
  where status in ('SUGGESTED', 'TODO', 'IN_PROGRESS');
create index if not exists tasks_source_email_idx
  on public.tasks (source_email_id);
create index if not exists tasks_user_priority_idx
  on public.tasks (user_id, priority);
-- Duplicate prevention (§14): one AI-suggested task per email + dedupe key.
create unique index if not exists tasks_source_dedupe_uidx
  on public.tasks (user_id, source_email_id, dedupe_key)
  where source_email_id is not null and dedupe_key is not null;
create index if not exists tasks_reminder_idx
  on public.tasks (reminder_at)
  where reminder_at is not null and reminder_sent_at is null;

-- -----------------------------------------------------------------------------
-- notifications
-- -----------------------------------------------------------------------------
create index if not exists notifications_user_created_idx
  on public.notifications (user_id, created_at desc);
create index if not exists notifications_user_unread_idx
  on public.notifications (user_id, created_at desc)
  where is_read = false;
create unique index if not exists notifications_dedupe_uidx
  on public.notifications (user_id, dedupe_key)
  where dedupe_key is not null;

-- -----------------------------------------------------------------------------
-- agent_runs / agent_actions / integration_events
-- -----------------------------------------------------------------------------
create index if not exists agent_runs_user_started_idx
  on public.agent_runs (user_id, started_at desc);
create index if not exists agent_runs_email_idx
  on public.agent_runs (email_id);
create index if not exists agent_runs_status_idx
  on public.agent_runs (status)
  where status in ('PENDING', 'RUNNING');

create index if not exists agent_actions_user_created_idx
  on public.agent_actions (user_id, created_at desc);
create index if not exists agent_actions_run_idx
  on public.agent_actions (run_id, created_at);
create index if not exists agent_actions_email_idx
  on public.agent_actions (email_id, created_at desc);

create index if not exists integration_events_user_created_idx
  on public.integration_events (user_id, created_at desc);
create index if not exists integration_events_unresolved_idx
  on public.integration_events (user_id)
  where resolved = false and severity <> 'info';

-- -----------------------------------------------------------------------------
-- email_accounts
-- -----------------------------------------------------------------------------
create index if not exists email_accounts_user_idx
  on public.email_accounts (user_id, status);

-- -----------------------------------------------------------------------------
-- Sync/dashboard analytics helper (§56): per-day rollup view
-- -----------------------------------------------------------------------------
create or replace view public.user_analytics_daily
with (security_invoker = true)
as
select
  e.user_id,
  date_trunc('day', e.received_at)::date as day,
  count(*)                                              as emails_received,
  count(*) filter (where ea.id is not null)             as emails_analyzed,
  count(*) filter (where ea.action_required)            as actionable_emails,
  count(*) filter (where ea.priority in ('CRITICAL', 'HIGH')) as high_priority_emails,
  count(*) filter (where ea.detected_deadline is not null)    as deadlines_detected
from public.emails e
left join public.email_analysis ea on ea.email_id = e.id
group by e.user_id, date_trunc('day', e.received_at)::date;

comment on view public.user_analytics_daily is
  'Per-user, per-day inbox rollup used by the dashboard analytics cards.';
