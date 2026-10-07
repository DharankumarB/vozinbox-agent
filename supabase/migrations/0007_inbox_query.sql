-- =============================================================================
-- VozInbox Agent — 0007 Inbox query surface (§18, §41, §47, §48)
-- -----------------------------------------------------------------------------
-- One function powers the inbox list, filters, sorting, search and pagination so
-- the client never downloads more than one page of data.
-- SECURITY INVOKER: when called with a user-scoped client, RLS still applies;
-- the service role calls it with an explicit p_user_id.
-- =============================================================================

create or replace function public.inbox_query(
  p_user_id uuid,
  p_filter text default 'ALL',
  p_sort text default 'NEWEST',
  p_search text default null,
  p_limit integer default 25,
  p_offset integer default 0,
  p_account_id uuid default null,
  p_thread_id uuid default null,
  p_category text default null,
  p_priority text default null,
  p_action_required boolean default null,
  p_is_read boolean default null,
  p_deadline_from date default null,
  p_deadline_to date default null
)
returns table (
  email public.emails,
  analysis public.email_analysis,
  task public.tasks,
  total_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with base as (
    select
      e as email,
      ea as analysis,
      t as task,
      count(*) over () as total_count,
      (ea.detected_deadline ->>'date') as deadline_date,
      e.is_read as _is_read,
      coalesce(ea.action_required, false) as _action_required,
      coalesce(ea.priority::text, 'NONE') as _priority,
      e.received_at as _received_at,
      e.id as _id
    from public.emails e
    left join public.email_analysis ea on ea.email_id = e.id
    left join public.tasks t
      on t.source_email_id = e.id
     and t.status in ('SUGGESTED', 'TODO', 'IN_PROGRESS')
    where e.user_id = p_user_id
      and e.is_archived = false
      and (p_account_id is null or e.account_id = p_account_id)
      and (p_thread_id is null or e.thread_id = p_thread_id)
      and (p_category is null or ea.category = p_category::public.email_category)
      and (p_priority is null or ea.priority = p_priority::public.email_priority)
      and (p_action_required is null or ea.action_required = p_action_required)
      and (p_is_read is null or e.is_read = p_is_read)
      and (p_deadline_from is null or ((ea.detected_deadline ->> 'date') is not null
            and (ea.detected_deadline ->> 'date')::date >= p_deadline_from))
      and (p_deadline_to is null or ((ea.detected_deadline ->> 'date') is not null
            and (ea.detected_deadline ->> 'date')::date <= p_deadline_to))
      and (
        p_search is null or btrim(p_search) = '' or
        coalesce(e.search_vector, ''::tsvector) @@ websearch_to_tsquery('english', p_search) or
        e.subject ilike '%' || p_search || '%' or
        e.sender_name ilike '%' || p_search || '%' or
        e.sender_email::text ilike '%' || p_search || '%' or
        e.snippet ilike '%' || p_search || '%' or
        ea.summary ilike '%' || p_search || '%' or
        ea.suggested_action ilike '%' || p_search || '%'
      )
      and (
        p_filter is null or btrim(p_filter) = '' or p_filter = 'ALL'
        or (p_filter = 'UNREAD' and e.is_read = false)
        or (p_filter = 'ACTION_REQUIRED' and ea.action_required = true)
        or (p_filter = 'HIGH_PRIORITY' and ea.priority in ('CRITICAL', 'HIGH'))
        or (p_filter = 'DEADLINES' and nullif(ea.detected_deadline ->> 'date', '') is not null)
        or (p_filter in ('ASSIGNMENT','MEETING','PROJECT','PERSONAL','INFORMATION','PROMOTIONAL','SPAM')
            and ea.category = p_filter::public.email_category)
      )
  )
  select b.email, b.analysis, b.task, b.total_count
  from base b
  order by
    case when p_sort = 'UNREAD_FIRST' then b._is_read::int end asc nulls last,
    case when p_sort = 'ACTION_REQUIRED_FIRST' then b._action_required::int end desc nulls last,
    case when p_sort in ('HIGHEST_PRIORITY')
         then case b._priority
                when 'CRITICAL' then 5 when 'HIGH' then 4 when 'MEDIUM' then 3
                when 'LOW' then 2 else 1 end end desc nulls last,
    case when p_sort = 'DEADLINE_SOONEST' then b.deadline_date end asc nulls last,
    case when p_sort = 'OLDEST' then b._received_at end asc nulls last,
    b._received_at desc,
    b._id desc
  limit greatest(1, least(coalesce(p_limit, 25), 100))
  offset greatest(0, coalesce(p_offset, 0));
$$;

revoke all on function public.inbox_query(
  uuid, text, text, text, integer, integer, uuid, uuid, text, text, boolean, boolean, date, date
) from anon;
grant execute on function public.inbox_query(
  uuid, text, text, text, integer, integer, uuid, uuid, text, text, boolean, boolean, date, date
) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Task list query with source-email context (§49)
-- -----------------------------------------------------------------------------
create or replace function public.tasks_query(
  p_user_id uuid,
  p_status text default null,
  p_priority text default null,
  p_search text default null,
  p_due_from date default null,
  p_due_to date default null,
  p_sort text default 'DUE_SOONEST',
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (task public.tasks, source_email public.emails, total_count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with base as (
    select t as task,
           e as source_email,
           count(*) over () as total_count,
           t.due_date as _due_date,
           t.due_time as _due_time,
           t.created_at as _created_at,
           coalesce(t.priority::text, 'NONE') as _priority,
           t.status::text as _status
    from public.tasks t
    left join public.emails e on e.id = t.source_email_id
    where t.user_id = p_user_id
      and (
        p_status is null or btrim(p_status) = '' or p_status = 'ALL'
        or t.status = p_status::public.task_status
      )
      and (p_priority is null or t.priority = p_priority::public.email_priority)
      and (p_due_from is null or t.due_date >= p_due_from)
      and (p_due_to is null or t.due_date <= p_due_to)
      and (
        p_search is null or btrim(p_search) = ''
        or t.title ilike '%' || p_search || '%'
        or t.description ilike '%' || p_search || '%'
        or e.subject ilike '%' || p_search || '%'
        or e.sender_name ilike '%' || p_search || '%'
      )
  )
  select b.task, b.source_email, b.total_count
  from base b
  order by
    case when p_sort = 'DUE_SOONEST' then b._due_date end asc nulls last,
    case when p_sort = 'DUE_SOONEST' then b._due_time end asc nulls last,
    case when p_sort = 'NEWEST' then b._created_at end desc nulls last,
    case when p_sort = 'PRIORITY'
         then case b._priority
                when 'CRITICAL' then 5 when 'HIGH' then 4 when 'MEDIUM' then 3
                when 'LOW' then 2 else 1 end end desc nulls last,
    case when p_sort = 'STATUS'
         then case b._status when 'SUGGESTED' then 1 when 'TODO' then 2 when 'IN_PROGRESS' then 3 else 4 end
         end asc nulls last,
    b._created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 200))
  offset greatest(0, coalesce(p_offset, 0));
$$;

revoke all on function public.tasks_query(
  uuid, text, text, text, date, date, text, integer, integer
) from anon;
grant execute on function public.tasks_query(
  uuid, text, text, text, date, date, text, integer, integer
) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Deadline buckets used by the dashboard, deadlines filter and "due this week"
-- -----------------------------------------------------------------------------
create or replace function public.upcoming_deadlines(
  p_user_id uuid,
  p_days integer default 7,
  p_limit integer default 10
)
returns table (
  email public.emails,
  analysis public.email_analysis,
  due_date date,
  due_time time,
  days_remaining integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select e as email,
         ea as analysis,
         (ea.detected_deadline ->> 'date')::date as due_date,
         nullif(ea.detected_deadline ->> 'time', '')::time as due_time,
         ((ea.detected_deadline ->> 'date')::date - current_date)::integer as days_remaining
  from public.emails e
  join public.email_analysis ea on ea.email_id = e.id
  where e.user_id = p_user_id
    and e.is_archived = false
    and nullif(ea.detected_deadline ->> 'date', '') is not null
    and (ea.detected_deadline ->> 'date')::date between current_date - 1 and current_date + p_days
  order by (ea.detected_deadline ->> 'date')::date asc,
           nullif(ea.detected_deadline ->> 'time', '') asc nulls last
  limit greatest(1, least(coalesce(p_limit, 10), 50));
$$;

revoke all on function public.upcoming_deadlines(uuid, integer, integer) from anon;
grant execute on function public.upcoming_deadlines(uuid, integer, integer) to authenticated, service_role;
