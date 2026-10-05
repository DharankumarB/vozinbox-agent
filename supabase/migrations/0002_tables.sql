-- =============================================================================
-- VozInbox Agent — 0002 Tables
-- =============================================================================

-- -----------------------------------------------------------------------------
-- profiles — 1:1 with auth.users
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id                 uuid primary key references auth.users (id) on delete cascade,
  email              citext,
  full_name          text,
  avatar_url         text,
  timezone           text not null default 'UTC',
  onboarding_state   jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- user_preferences — agent behaviour + notification preferences (§36)
-- -----------------------------------------------------------------------------
create table if not exists public.user_preferences (
  user_id                       uuid primary key references auth.users (id) on delete cascade,
  -- AI settings
  auto_analyze_new_emails       boolean not null default true,
  auto_suggest_tasks            boolean not null default true,
  deadline_detection_enabled    boolean not null default true,
  priority_detection_enabled    boolean not null default true,
  summary_length                text not null default 'NORMAL'
    check (summary_length in ('SHORT', 'NORMAL', 'DETAILED')),
  confidence_threshold          numeric(4, 3) not null default 0.900
    check (confidence_threshold >= 0 and confidence_threshold <= 1),
  -- Notification preferences
  notify_important_email        boolean not null default true,
  notify_deadline               boolean not null default true,
  notify_task_suggestion        boolean not null default true,
  notify_meeting                boolean not null default true,
  notify_project                boolean not null default true,
  notify_information            boolean not null default false,
  -- Sync
  sync_interval_minutes         integer not null default 15
    check (sync_interval_minutes between 5 and 1440),
  -- Prioritisation signals the user controls
  important_senders             text[] not null default '{}'::text[],
  ignored_senders               text[] not null default '{}'::text[],
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- email_accounts — OAuth-backed mailbox connections.
-- NEVER stores tokens (see email_account_credentials).
-- -----------------------------------------------------------------------------
create table if not exists public.email_accounts (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users (id) on delete cascade,
  provider              integration_provider not null default 'gmail',
  provider_account_id   text not null,                 -- Google account id / "sub"
  email_address         citext not null,
  display_name          text,
  status                integration_status not null default 'PENDING',
  scopes                text[] not null default '{}'::text[],
  -- Incremental sync state (§26)
  last_sync_at          timestamptz,
  last_sync_status      text,
  last_sync_error       text,
  last_history_id       text,                          -- Gmail historyId cursor
  sync_cursor           jsonb not null default '{}'::jsonb,
  watch_expiration      timestamptz,
  connected_at          timestamptz,
  disconnected_at       timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint email_accounts_user_provider_account_key
    unique (user_id, provider, provider_account_id)
);

-- -----------------------------------------------------------------------------
-- email_account_credentials — encrypted OAuth tokens.
-- RLS is enabled with NO policies: only the service role can ever touch this.
-- -----------------------------------------------------------------------------
create table if not exists public.email_account_credentials (
  account_id            uuid primary key references public.email_accounts (id) on delete cascade,
  user_id               uuid not null references auth.users (id) on delete cascade,
  access_token_cipher   text,
  refresh_token_cipher  text not null,
  token_type            text not null default 'Bearer',
  scope                 text,
  expires_at            timestamptz,
  key_version           integer not null default 1,
  rotated_at            timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- email_threads
-- -----------------------------------------------------------------------------
create table if not exists public.email_threads (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references auth.users (id) on delete cascade,
  account_id               uuid not null references public.email_accounts (id) on delete cascade,
  provider                 integration_provider not null default 'gmail',
  provider_thread_id       text not null,
  subject                  text,
  participants             jsonb not null default '[]'::jsonb,
  message_count            integer not null default 0,
  last_message_at          timestamptz,
  latest_message_id        uuid,
  -- Rolling "current best understanding" after applying thread precedence (§15)
  authoritative_email_id   uuid,
  thread_state             jsonb not null default '{}'::jsonb,
  changes_detected         jsonb not null default '[]'::jsonb,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint email_threads_account_provider_thread_key
    unique (account_id, provider_thread_id)
);

-- -----------------------------------------------------------------------------
-- emails (§29)
-- -----------------------------------------------------------------------------
create table if not exists public.emails (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references auth.users (id) on delete cascade,
  account_id             uuid not null references public.email_accounts (id) on delete cascade,
  thread_id              uuid references public.email_threads (id) on delete set null,
  provider               integration_provider not null default 'gmail',
  provider_message_id    text not null,
  provider_thread_id     text not null,
  sender_name            text,
  sender_email           citext,
  recipient              text,
  recipients             jsonb not null default '[]'::jsonb,
  subject                text,
  snippet                text,
  body_text              text,
  body_html              text,
  received_at            timestamptz not null default now(),
  is_read                boolean not null default false,
  is_archived            boolean not null default false,
  has_attachments        boolean not null default false,
  attachments            jsonb not null default '[]'::jsonb,
  labels                 text[] not null default '{}'::text[],
  headers                jsonb not null default '{}'::jsonb,
  size_estimate          integer,
  -- Denormalised analysis summary for fast list rendering (source of truth is
  -- email_analysis; kept in sync by the agent pipeline).
  analysis_state         text not null default 'PENDING'
    check (analysis_state in ('PENDING', 'ANALYZING', 'ANALYZED', 'FAILED', 'SKIPPED')),
  analyzed_at            timestamptz,
  search_vector          tsvector,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint emails_user_provider_message_key
    unique (user_id, provider, provider_message_id)
);

-- -----------------------------------------------------------------------------
-- email_analysis (§30) — latest authoritative analysis per email
-- -----------------------------------------------------------------------------
create table if not exists public.email_analysis (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references auth.users (id) on delete cascade,
  email_id               uuid not null references public.emails (id) on delete cascade,
  thread_id              uuid references public.email_threads (id) on delete set null,
  category               email_category not null default 'OTHER',
  secondary_categories   email_category[] not null default '{}',
  summary                text,
  action_required        boolean not null default false,
  priority               email_priority not null default 'NONE',
  priority_reason        text,
  priority_score         numeric(5, 2),
  detected_dates         jsonb not null default '[]'::jsonb,
  detected_deadline      jsonb,                        -- { date, time, timezone, type, source_sentence, confidence }
  detected_people        jsonb not null default '[]'::jsonb,
  detected_organizations jsonb not null default '[]'::jsonb,
  detected_links         jsonb not null default '[]'::jsonb,
  detected_attachments   jsonb not null default '[]'::jsonb,
  suggested_action       text,
  suggested_task         jsonb,                        -- { title, description, due_date, due_time }
  category_confidence    numeric(4, 3) not null default 0,
  action_confidence      numeric(4, 3) not null default 0,
  deadline_confidence    numeric(4, 3) not null default 0,
  priority_confidence    numeric(4, 3) not null default 0,
  overall_confidence     numeric(4, 3) not null default 0,
  needs_review           boolean not null default false,
  review_reason          text,
  -- Safety / grounding metadata
  model_name             text,
  analysis_source        analysis_source not null default 'AI_PROVIDER',
  analysis_version       text not null default '1.0.0',
  grounding_report       jsonb not null default '{}'::jsonb,
  injection_flagged      boolean not null default false,
  injection_signals      jsonb not null default '[]'::jsonb,
  raw_output             jsonb,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint email_analysis_email_key unique (email_id)
);

-- -----------------------------------------------------------------------------
-- email_analysis_history — immutable audit trail of prior interpretations (§15)
-- -----------------------------------------------------------------------------
create table if not exists public.email_analysis_history (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  email_id         uuid not null references public.emails (id) on delete cascade,
  thread_id        uuid references public.email_threads (id) on delete set null,
  snapshot         jsonb not null,
  change_summary   jsonb not null default '[]'::jsonb,
  superseded_by    uuid,
  analysis_version text,
  created_at       timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- email_actions (§11) — extracted actionable instructions
-- -----------------------------------------------------------------------------
create table if not exists public.email_actions (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  email_id           uuid not null references public.emails (id) on delete cascade,
  analysis_id        uuid references public.email_analysis (id) on delete set null,
  action_text        text not null,
  action_type        text not null default 'GENERAL',
  source_sentence    text,
  due_date           date,
  due_time           time,
  timezone           text,
  confidence         numeric(4, 3) not null default 0,
  requires_review    boolean not null default false,
  status             text not null default 'OPEN'
    check (status in ('OPEN', 'TASK_CREATED', 'DISMISSED', 'COMPLETED')),
  task_id            uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- tasks (§13)
-- -----------------------------------------------------------------------------
create table if not exists public.tasks (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  title              text not null,
  description        text,
  source_email_id    uuid references public.emails (id) on delete set null,
  source_thread_id   uuid references public.email_threads (id) on delete set null,
  source_action_id   uuid references public.email_actions (id) on delete set null,
  category           email_category not null default 'OTHER',
  priority           email_priority not null default 'MEDIUM',
  due_date           date,
  due_time           time,
  timezone           text,
  status             task_status not null default 'SUGGESTED',
  origin             text not null default 'AI_SUGGESTED'
    check (origin in ('AI_SUGGESTED', 'USER', 'IMPORTED')),
  -- Semantic duplicate detection (§14)
  dedupe_key         text,
  embedding          jsonb,                            -- optional vector-lite fingerprints
  reminder_at        timestamptz,
  reminder_sent_at   timestamptz,
  completed_at       timestamptz,
  dismissed_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

alter table public.email_actions
  drop constraint if exists email_actions_task_fk;
alter table public.email_actions
  add constraint email_actions_task_fk
  foreign key (task_id) references public.tasks (id) on delete set null;

-- -----------------------------------------------------------------------------
-- notifications (§17)
-- -----------------------------------------------------------------------------
create table if not exists public.notifications (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  type               notification_type not null,
  title              text not null,
  message            text,
  priority           email_priority not null default 'NONE',
  is_read            boolean not null default false,
  read_at            timestamptz,
  entity_type        text,                             -- 'email' | 'task' | 'thread' | 'integration'
  related_entity_id  uuid,
  action_url         text,
  metadata           jsonb not null default '{}'::jsonb,
  dedupe_key         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- agent_runs (§21, §38) — one row per agent execution
-- -----------------------------------------------------------------------------
create table if not exists public.agent_runs (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  trigger          text not null default 'MANUAL'
    check (trigger in ('SYNC', 'MANUAL', 'REPROCESS', 'CHAT', 'CRON', 'REALTIME')),
  email_id         uuid references public.emails (id) on delete set null,
  thread_id        uuid references public.email_threads (id) on delete set null,
  status           agent_run_status not null default 'PENDING',
  current_step     text,
  steps_completed  jsonb not null default '[]'::jsonb,
  tool_depth       integer not null default 0,
  max_tool_depth   integer not null default 4,
  tool_calls       integer not null default 0,
  analysis_source  analysis_source,
  model_name       text,
  confidence       numeric(4, 3),
  error_code       text,
  error_message    text,
  duration_ms      integer,
  started_at       timestamptz not null default now(),
  finished_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- agent_actions (§38) — activity timeline entries
-- -----------------------------------------------------------------------------
create table if not exists public.agent_actions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  run_id           uuid references public.agent_runs (id) on delete cascade,
  action_type      agent_action_type not null,
  title            text not null,
  detail           text,
  tool_name        text,
  email_id         uuid references public.emails (id) on delete set null,
  task_id          uuid references public.tasks (id) on delete set null,
  notification_id  uuid references public.notifications (id) on delete set null,
  severity         integration_event_severity not null default 'info',
  payload          jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- integration_events (§32, §45) — sync/OAuth/API telemetry
-- -----------------------------------------------------------------------------
create table if not exists public.integration_events (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  account_id   uuid references public.email_accounts (id) on delete cascade,
  provider     integration_provider not null default 'gmail',
  event_type   text not null,
  severity     integration_event_severity not null default 'info',
  message      text,
  context      jsonb not null default '{}'::jsonb,
  resolved     boolean not null default false,
  created_at   timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- rate_limit_buckets — durable fallback for multi-instance rate limiting (§42)
-- -----------------------------------------------------------------------------
create table if not exists public.rate_limit_buckets (
  bucket_key    text primary key,
  window_start  timestamptz not null default now(),
  hits          integer not null default 0,
  updated_at    timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- updated_at triggers
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'user_preferences', 'email_accounts', 'email_account_credentials',
    'email_threads', 'emails', 'email_analysis', 'email_actions', 'tasks',
    'notifications', 'agent_runs', 'rate_limit_buckets'
  ]
  loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format(
      'create trigger set_updated_at before update on public.%I
         for each row execute function public.set_updated_at()', t);
  end loop;
end $$;
