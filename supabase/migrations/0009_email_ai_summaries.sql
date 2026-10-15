create table if not exists public.email_ai_summaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  email_id uuid not null references public.emails (id) on delete cascade,
  content_hash text not null,
  summary jsonb not null,
  model_name text not null,
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint email_ai_summaries_email_key unique (email_id)
);

create index if not exists email_ai_summaries_user_email_idx
  on public.email_ai_summaries (user_id, email_id);

alter table public.email_ai_summaries enable row level security;
alter table public.email_ai_summaries force row level security;

drop policy if exists email_ai_summaries_select_own on public.email_ai_summaries;
create policy email_ai_summaries_select_own on public.email_ai_summaries
  for select to authenticated using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.emails e
      where e.id = email_ai_summaries.email_id and e.user_id = (select auth.uid())
    )
  );

drop policy if exists email_ai_summaries_insert_own on public.email_ai_summaries;
create policy email_ai_summaries_insert_own on public.email_ai_summaries
  for insert to authenticated with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.emails e
      where e.id = email_ai_summaries.email_id and e.user_id = (select auth.uid())
    )
  );

drop policy if exists email_ai_summaries_update_own on public.email_ai_summaries;
create policy email_ai_summaries_update_own on public.email_ai_summaries
  for update to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.emails e
      where e.id = email_ai_summaries.email_id and e.user_id = (select auth.uid())
    )
  )
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.emails e
      where e.id = email_ai_summaries.email_id and e.user_id = (select auth.uid())
    )
  );

drop policy if exists email_ai_summaries_delete_own on public.email_ai_summaries;
create policy email_ai_summaries_delete_own on public.email_ai_summaries
  for delete to authenticated using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.emails e
      where e.id = email_ai_summaries.email_id and e.user_id = (select auth.uid())
    )
  );
