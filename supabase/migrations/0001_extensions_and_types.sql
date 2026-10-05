-- =============================================================================
-- VozInbox Agent — 0001 Extensions, enums and shared helpers
-- =============================================================================
-- Run order: 0001 → 0006. Apply with `npm run db:migrate` or paste into the
-- Supabase SQL editor / `supabase db push`.
-- =============================================================================

create extension if not exists "pgcrypto";
create extension if not exists "citext";

-- -----------------------------------------------------------------------------
-- Enums (expandable: add values with ALTER TYPE ... ADD VALUE)
-- -----------------------------------------------------------------------------

-- Primary AI categories (§9)
do $$ begin
  create type public.email_category as enum (
    'ACTION_REQUIRED',
    'ASSIGNMENT',
    'DEADLINE',
    'MEETING',
    'EVENT',
    'PROJECT',
    'WORK',
    'COLLEGE',
    'PERSONAL',
    'FINANCE',
    'INFORMATION',
    'PROMOTIONAL',
    'SPAM',
    'OTHER'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.email_priority as enum (
    'CRITICAL',
    'HIGH',
    'MEDIUM',
    'LOW',
    'NONE'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.task_status as enum (
    'SUGGESTED',
    'TODO',
    'IN_PROGRESS',
    'COMPLETED',
    'DISMISSED'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.notification_type as enum (
    'IMPORTANT_EMAIL',
    'TASK_SUGGESTION',
    'DEADLINE_DETECTED',
    'DEADLINE_APPROACHING',
    'DEADLINE_CHANGED',
    'MEETING_REMINDER',
    'MEETING_CHANGED',
    'TASK_CREATED',
    'TASK_COMPLETED',
    'AI_PROCESSING_COMPLETED',
    'AI_NEEDS_REVIEW',
    'INFORMATION_CHANGED',
    'INTEGRATION_ISSUE',
    'INTEGRATION_CONNECTED',
    'AGENT_ERROR',
    'SYSTEM'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.agent_run_status as enum (
    'PENDING',
    'RUNNING',
    'COMPLETED',
    'FAILED',
    'SKIPPED',
    'NEEDS_REVIEW'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.agent_action_type as enum (
    'EMAIL_RECEIVED',
    'SOURCE_VALIDATED',
    'EMAIL_ANALYZED',
    'EMAIL_CLASSIFIED',
    'ACTION_EXTRACTED',
    'DEADLINE_DETECTED',
    'PRIORITY_DETECTED',
    'DUPLICATE_CHECKED',
    'TASK_SUGGESTED',
    'TASK_CREATED',
    'TASK_UPDATED',
    'TASK_DISMISSED',
    'NOTIFICATION_CREATED',
    'THREAD_UPDATED',
    'CHANGE_DETECTED',
    'ANALYSIS_FAILED',
    'GUARDRAIL_BLOCKED',
    'TOOL_CALLED',
    'TOOL_DENIED',
    'SYNC_STARTED',
    'SYNC_COMPLETED',
    'SYNC_FAILED'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.integration_provider as enum ('gmail', 'outlook');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.integration_status as enum (
    'CONNECTED',
    'DISCONNECTED',
    'ERROR',
    'REVOKED',
    'PENDING'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.analysis_source as enum (
    'AI_PROVIDER',
    'RULES_ENGINE',
    'MANUAL'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.integration_event_severity as enum ('info', 'warning', 'error');
exception when duplicate_object then null; end $$;

-- -----------------------------------------------------------------------------
-- Shared helper: keep updated_at accurate without application bookkeeping.
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'Trigger helper: stamps updated_at on row modification.';
