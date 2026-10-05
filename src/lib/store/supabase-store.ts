import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError, toAppError } from '@/lib/errors';
import type {
  AgentAction,
  AgentRun,
  AppNotification,
  Email,
  EmailAccount,
  EmailActionRow,
  EmailAnalysis,
  EmailThread,
  IntegrationEvent,
  Profile,
  Task,
  UserPreferences,
} from '@/lib/types/database';
import type { DetectedDeadline, EmailCategory, EmailPriority } from '@/lib/types/domain';
import { getZonedParts } from '@/lib/analysis/dates';
import { PRIORITY_WEIGHT } from '@/lib/types/domain';
import type {
  AgentHealth,
  CredentialsInput,
  DailyAnalytics,
  DashboardCounters,
  DeadlineItem,
  DuplicateCandidateQuery,
  HistoryInput,
  InboxPage,
  InboxQuery,
  NewAccountInput,
  NewActionInput,
  NewAgentActionInput,
  NewAnalysisInput,
  NewEmailInput,
  NewIntegrationEventInput,
  NewNotificationInput,
  NewRunInput,
  NewTaskInput,
  NewThreadInput,
  PriorAnalysis,
  Store,
  StoredCredentials,
  TaskPage,
  TaskQuery,
} from './types';

/**
 * Postgres/Supabase implementation.
 *
 * Every method takes `userId` and applies it as a filter. When the caller passes
 * a user-scoped client, RLS enforces the same rule a second time (§31).
 */
export class SupabaseStore implements Store {
  readonly kind = 'supabase' as const;

  constructor(private readonly client: SupabaseClient) {}

  // ── helpers ────────────────────────────────────────────────────────────────

  private async run<T>(operation: string, promise: PromiseLike<{ data: T | null; error: unknown }>): Promise<T> {
    const { data, error } = await promise;
    if (error) {
      throw new AppError('DATABASE', {
        message: `${operation} failed: ${describe(error)}`,
        context: { operation },
        cause: error,
      });
    }
    return data as T;
  }

  private async maybeRun<T>(operation: string, promise: PromiseLike<{ data: T | null; error: unknown }>): Promise<T | null> {
    const { data, error } = await promise;
    if (error) {
      if (isNotFound(error)) return null;
      throw new AppError('DATABASE', {
        message: `${operation} failed: ${describe(error)}`,
        context: { operation },
        cause: error,
      });
    }
    return data;
  }

  // ── Profiles & preferences ────────────────────────────────────────────────

  async getProfile(userId: string): Promise<Profile | null> {
    return this.maybeRun<Profile>(
      'getProfile',
      this.client.from('profiles').select('*').eq('id', userId).maybeSingle(),
    );
  }

  async updateProfile(userId: string, values: Partial<Profile>): Promise<Profile> {
    return this.run<Profile>(
      'updateProfile',
      this.client.from('profiles').update(values).eq('id', userId).select('*').single(),
    );
  }

  async ensureBootstrap(input: {
    userId: string;
    email: string | null;
    fullName: string | null;
    timezone?: string;
  }): Promise<{ profile: Profile; preferences: UserPreferences }> {
    const existing = await this.getProfile(input.userId);
    if (!existing) {
      await this.run('insertProfile', this.client
        .from('profiles')
        .upsert(
          {
            id: input.userId,
            email: input.email,
            full_name: input.fullName,
            timezone: input.timezone ?? 'UTC',
          },
          { onConflict: 'id' },
        ));
    }
    const preferences = await this.ensurePreferences(input.userId);
    const profile = (await this.getProfile(input.userId)) ?? buildFallbackProfile(input);
    return { profile, preferences };
  }

  private async ensurePreferences(userId: string): Promise<UserPreferences> {
    const existing = await this.maybeRun<UserPreferences>(
      'getPreferences',
      this.client.from('user_preferences').select('*').eq('user_id', userId).maybeSingle(),
    );
    if (existing) return existing;
    return this.run<UserPreferences>(
      'insertPreferences',
      this.client
        .from('user_preferences')
        .upsert({ user_id: userId }, { onConflict: 'user_id' })
        .select('*')
        .single(),
    );
  }

  async getPreferences(userId: string): Promise<UserPreferences> {
    return this.ensurePreferences(userId);
  }

  async updatePreferences(userId: string, values: Partial<UserPreferences>): Promise<UserPreferences> {
    await this.ensurePreferences(userId);
    return this.run<UserPreferences>(
      'updatePreferences',
      this.client
        .from('user_preferences')
        .update(values)
        .eq('user_id', userId)
        .select('*')
        .single(),
    );
  }

  // ── Accounts & credentials ────────────────────────────────────────────────

  async listAccounts(userId: string): Promise<EmailAccount[]> {
    const data = await this.run<EmailAccount[]>(
      'listAccounts',
      this.client
        .from('email_accounts')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: true }),
    );
    return data ?? [];
  }

  async getAccount(userId: string, accountId: string): Promise<EmailAccount | null> {
    return this.maybeRun<EmailAccount>(
      'getAccount',
      this.client.from('email_accounts').select('*').eq('user_id', userId).eq('id', accountId).maybeSingle(),
    );
  }

  async getAccountByProvider(
    userId: string,
    provider: 'gmail' | 'outlook',
    providerAccountId: string,
  ): Promise<EmailAccount | null> {
    return this.maybeRun<EmailAccount>(
      'getAccountByProvider',
      this.client
        .from('email_accounts')
        .select('*')
        .eq('user_id', userId)
        .eq('provider', provider)
        .eq('provider_account_id', providerAccountId)
        .maybeSingle(),
    );
  }

  async createAccount(input: NewAccountInput): Promise<EmailAccount> {
    return this.run<EmailAccount>(
      'createAccount',
      this.client
        .from('email_accounts')
        .upsert(
          {
            ...input,
            status: input.status ?? 'CONNECTED',
            connected_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,provider,provider_account_id' },
        )
        .select('*')
        .single(),
    );
  }

  async updateAccount(userId: string, accountId: string, values: Partial<EmailAccount>): Promise<EmailAccount> {
    return this.run<EmailAccount>(
      'updateAccount',
      this.client.from('email_accounts').update(values).eq('user_id', userId).eq('id', accountId).select('*').single(),
    );
  }

  async deleteAccount(userId: string, accountId: string): Promise<void> {
    await this.run('deleteAccount', this.client.from('email_accounts').delete().eq('user_id', userId).eq('id', accountId));
  }

  async saveCredentials(input: CredentialsInput): Promise<void> {
    await this.run(
      'saveCredentials',
      this.client.from('email_account_credentials').upsert(
        {
          account_id: input.account_id,
          user_id: input.user_id,
          refresh_token_cipher: input.refresh_token_cipher,
          access_token_cipher: input.access_token_cipher,
          scope: input.scope,
          expires_at: input.expires_at,
          token_type: input.token_type,
          rotated_at: new Date().toISOString(),
        },
        { onConflict: 'account_id' },
      ),
    );
  }

  async getCredentials(userId: string, accountId: string): Promise<StoredCredentials | null> {
    return this.maybeRun<StoredCredentials>(
      'getCredentials',
      this.client
        .from('email_account_credentials')
        .select('account_id, user_id, refresh_token_cipher, access_token_cipher, scope, expires_at, token_type')
        .eq('user_id', userId)
        .eq('account_id', accountId)
        .maybeSingle(),
    );
  }

  async deleteCredentials(userId: string, accountId: string): Promise<void> {
    await this.run(
      'deleteCredentials',
      this.client.from('email_account_credentials').delete().eq('user_id', userId).eq('account_id', accountId),
    );
  }

  // ── Threads ───────────────────────────────────────────────────────────────

  async upsertThread(input: NewThreadInput): Promise<EmailThread> {
    const existing = await this.maybeRun<EmailThread>(
      'getThreadByProviderId',
      this.client
        .from('email_threads')
        .select('*')
        .eq('account_id', input.account_id)
        .eq('provider_thread_id', input.provider_thread_id)
        .maybeSingle(),
    );
    if (existing) {
      return this.run<EmailThread>(
        'updateThread',
        this.client
          .from('email_threads')
          .update({
            subject: input.subject ?? existing.subject,
            participants: input.participants.length > 0 ? input.participants : existing.participants,
            last_message_at: input.last_message_at ?? existing.last_message_at,
            message_count: Math.max(existing.message_count, input.message_count),
          })
          .eq('id', existing.id)
          .select('*')
          .single(),
      );
    }
    return this.run<EmailThread>(
      'insertThread',
      this.client.from('email_threads').insert(input).select('*').single(),
    );
  }

  async getThread(userId: string, threadId: string): Promise<EmailThread | null> {
    return this.maybeRun<EmailThread>(
      'getThread',
      this.client.from('email_threads').select('*').eq('user_id', userId).eq('id', threadId).maybeSingle(),
    );
  }

  async updateThread(
    userId: string,
    threadId: string,
    values: {
      thread_state: EmailThread['thread_state'];
      changes_detected: EmailThread['changes_detected'];
      authoritative_email_id: string | null;
      message_count?: number;
      last_message_at?: string | null;
    },
  ): Promise<void> {
    await this.run(
      'updateThreadState',
      this.client.from('email_threads').update(values).eq('user_id', userId).eq('id', threadId),
    );
  }

  async listThreadPriorAnalyses(userId: string, threadId: string, excludeEmailId: string): Promise<PriorAnalysis[]> {
    const rows = await this.run<Array<Record<string, unknown>>>(
      'listThreadPriorAnalyses',
      this.client
        .from('email_analysis')
        .select('email_id, category, priority, action_required, suggested_action, detected_deadline, created_at, emails!inner(received_at)')
        .eq('user_id', userId)
        .eq('thread_id', threadId)
        .neq('email_id', excludeEmailId),
    );

    return (rows ?? []).map((row) => {
      const email = row.emails as { received_at?: string } | Array<{ received_at?: string }> | null;
      const receivedAt = Array.isArray(email) ? email[0]?.received_at : email?.received_at;
      return {
        email_id: String(row.email_id),
        category: row.category as EmailCategory,
        priority: row.priority as EmailPriority,
        action_required: Boolean(row.action_required),
        suggested_action: (row.suggested_action as string | null) ?? null,
        deadline: (row.detected_deadline as DetectedDeadline | null) ?? null,
        received_at: receivedAt ?? String(row.created_at),
      };
    });
  }

  // ── Emails ────────────────────────────────────────────────────────────────

  async upsertEmail(input: NewEmailInput): Promise<Email> {
    return this.run<Email>(
      'upsertEmail',
      this.client
        .from('emails')
        .upsert(input, { onConflict: 'user_id,provider,provider_message_id' })
        .select('*')
        .single(),
    );
  }

  async getEmail(userId: string, emailId: string): Promise<Email | null> {
    return this.maybeRun<Email>(
      'getEmail',
      this.client.from('emails').select('*').eq('user_id', userId).eq('id', emailId).maybeSingle(),
    );
  }

  async updateEmail(userId: string, emailId: string, values: Partial<Email>): Promise<void> {
    await this.run('updateEmail', this.client.from('emails').update(values).eq('user_id', userId).eq('id', emailId));
  }

  async listInbox(query: InboxQuery): Promise<InboxPage> {
    const limit = clamp(query.limit ?? 25, 1, 100);
    const offset = Math.max(0, query.offset ?? 0);

    const rows = await this.run<Array<Record<string, unknown>>>(
      'inbox_query',
      this.client.rpc('inbox_query', {
        p_user_id: query.userId,
        p_filter: query.filter ?? 'ALL',
        p_sort: query.sort ?? 'NEWEST',
        p_search: query.search ?? null,
        p_limit: limit,
        p_offset: offset,
        p_account_id: query.accountId ?? null,
        p_thread_id: query.threadId ?? null,
        p_category: query.category ?? null,
        p_priority: query.priority ?? null,
        p_action_required: query.actionRequired ?? null,
        p_is_read: query.isRead ?? null,
        p_deadline_from: query.deadlineFrom ?? null,
        p_deadline_to: query.deadlineTo ?? null,
      }),
    );

    const list = rows ?? [];
    const total = list.length > 0 ? Number(list[0]?.total_count ?? list.length) : 0;
    return {
      items: list.map((row) => ({
        email: row.email as Email,
        analysis: (row.analysis as EmailAnalysis | null) ?? null,
        source_task: row.task
          ? {
              id: String((row.task as Task).id),
              title: String((row.task as Task).title),
              status: (row.task as Task).status,
            }
          : null,
      })),
      total,
      limit,
      offset,
      hasMore: offset + list.length < total,
    };
  }

  async countEmails(userId: string): Promise<number> {
    const result = await this.client
      .from('emails')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId);
    if (result.error) throw toAppError(result.error, 'DATABASE');
    return result.count ?? 0;
  }

  async getUpcomingDeadlines(userId: string, days: number, limit: number): Promise<DeadlineItem[]> {
    const rows = await this.run<Array<Record<string, unknown>>>(
      'upcoming_deadlines',
      this.client.rpc('upcoming_deadlines', { p_user_id: userId, p_days: days, p_limit: limit }),
    );
    return (rows ?? []).map((row) => ({
      email: row.email as Email,
      analysis: (row.analysis as EmailAnalysis | null) ?? null,
      dueDate: String(row.due_date),
      dueTime: (row.due_time as string | null) ?? null,
      daysRemaining: Number(row.days_remaining),
    }));
  }

  // ── Analysis ──────────────────────────────────────────────────────────────

  async getAnalysis(userId: string, emailId: string): Promise<EmailAnalysis | null> {
    return this.maybeRun<EmailAnalysis>(
      'getAnalysis',
      this.client.from('email_analysis').select('*').eq('user_id', userId).eq('email_id', emailId).maybeSingle(),
    );
  }

  async upsertAnalysis(input: NewAnalysisInput): Promise<EmailAnalysis> {
    const r = input.result;
    return this.run<EmailAnalysis>(
      'upsertAnalysis',
      this.client
        .from('email_analysis')
        .upsert(
          {
            user_id: input.user_id,
            email_id: input.email_id,
            thread_id: input.thread_id,
            category: r.category,
            secondary_categories: r.secondary_categories,
            summary: r.summary,
            action_required: r.action_required,
            priority: r.priority,
            priority_reason: r.priority_reason,
            priority_score: r.priority_score,
            detected_dates: r.detected_dates,
            detected_deadline: r.detected_deadline,
            detected_people: r.detected_people,
            detected_organizations: r.detected_organizations,
            detected_links: r.detected_links,
            detected_attachments: r.detected_attachments,
            suggested_action: r.suggested_action,
            suggested_task: r.suggested_task,
            category_confidence: r.confidence.category,
            action_confidence: r.confidence.action,
            deadline_confidence: r.confidence.deadline,
            priority_confidence: r.confidence.priority,
            overall_confidence: r.confidence.overall,
            needs_review: r.needs_review,
            review_reason: r.review_reason,
            model_name: r.model_name,
            analysis_source: r.analysis_source,
            analysis_version: r.analysis_version,
            grounding_report: r.grounding_report,
            injection_flagged: r.injection_flagged,
            injection_signals: r.injection_signals,
            raw_output: r.raw_output ?? null,
          },
          { onConflict: 'email_id' },
        )
        .select('*')
        .single(),
    );
  }

  async insertAnalysisHistory(input: HistoryInput): Promise<void> {
    await this.run('insertAnalysisHistory', this.client.from('email_analysis_history').insert({
      user_id: input.user_id,
      email_id: input.email_id,
      thread_id: input.thread_id,
      snapshot: input.snapshot as Record<string, unknown>,
      change_summary: input.change_summary,
      superseded_by: input.superseded_by ?? null,
      analysis_version: input.analysis_version,
    }));
  }

  async listAnalysisHistory(
    userId: string,
    emailId: string,
  ): Promise<Array<{ id: string; created_at: string; snapshot: unknown; change_summary: HistoryInput['change_summary'] }>> {
    const rows = await this.run<Array<{ id: string; created_at: string; snapshot: unknown; change_summary: HistoryInput['change_summary'] }>>(
      'listAnalysisHistory',
      this.client
        .from('email_analysis_history')
        .select('id, created_at, snapshot, change_summary')
        .eq('user_id', userId)
        .eq('email_id', emailId)
        .order('created_at', { ascending: false })
        .limit(20),
    );
    return rows ?? [];
  }

  // ── Extracted actions ─────────────────────────────────────────────────────

  async upsertEmailActions(inputs: NewActionInput[]): Promise<EmailActionRow[]> {
    if (inputs.length === 0) return [];
    return this.run<EmailActionRow[]>(
      'upsertEmailActions',
      this.client.from('email_actions').insert(inputs).select('*'),
    );
  }

  async listEmailActions(userId: string, emailId: string): Promise<EmailActionRow[]> {
    const rows = await this.run<EmailActionRow[]>(
      'listEmailActions',
      this.client
        .from('email_actions')
        .select('*')
        .eq('user_id', userId)
        .eq('email_id', emailId)
        .order('created_at', { ascending: true }),
    );
    return rows ?? [];
  }

  async updateEmailAction(userId: string, actionId: string, values: Partial<EmailActionRow>): Promise<void> {
    await this.run(
      'updateEmailAction',
      this.client.from('email_actions').update(values).eq('user_id', userId).eq('id', actionId),
    );
  }

  // ── Tasks ─────────────────────────────────────────────────────────────────

  async createTask(input: NewTaskInput): Promise<Task> {
    return this.run<Task>('createTask', this.client.from('tasks').insert(input).select('*').single());
  }

  async getTask(userId: string, taskId: string): Promise<Task | null> {
    return this.maybeRun<Task>(
      'getTask',
      this.client.from('tasks').select('*').eq('user_id', userId).eq('id', taskId).maybeSingle(),
    );
  }

  async updateTask(userId: string, taskId: string, values: Partial<Task>): Promise<Task> {
    return this.run<Task>(
      'updateTask',
      this.client.from('tasks').update(values).eq('user_id', userId).eq('id', taskId).select('*').single(),
    );
  }

  async deleteTask(userId: string, taskId: string): Promise<void> {
    await this.run('deleteTask', this.client.from('tasks').delete().eq('user_id', userId).eq('id', taskId));
  }

  async listTasks(query: TaskQuery): Promise<TaskPage> {
    const limit = clamp(query.limit ?? 50, 1, 200);
    const offset = Math.max(0, query.offset ?? 0);
    const rows = await this.run<Array<Record<string, unknown>>>(
      'tasks_query',
      this.client.rpc('tasks_query', {
        p_user_id: query.userId,
        p_status: query.status ?? 'ALL',
        p_priority: query.priority ?? null,
        p_search: query.search ?? null,
        p_due_from: query.dueFrom ?? null,
        p_due_to: query.dueTo ?? null,
        p_sort: query.sort ?? 'DUE_SOONEST',
        p_limit: limit,
        p_offset: offset,
      }),
    );
    const list = rows ?? [];
    const total = list.length > 0 ? Number(list[0]?.total_count ?? list.length) : 0;
    return {
      items: list.map((row) => ({
        task: row.task as Task,
        sourceEmail: (row.source_email as Email | null) ?? null,
      })),
      total,
      limit,
      offset,
      hasMore: offset + list.length < total,
    };
  }

  async findDuplicateCandidates(query: DuplicateCandidateQuery): Promise<
    Array<{
      id: string;
      title: string;
      source_email_id: string | null;
      source_thread_id: string | null;
      status: string;
      due_date: string | null;
      priority: EmailPriority;
    }>
  > {
    const filters: string[] = [];
    if (query.sourceThreadId) filters.push(`source_thread_id.eq.${query.sourceThreadId}`);
    filters.push(`source_email_id.eq.${query.sourceEmailId}`);

    let builder = this.client
      .from('tasks')
      .select('id, title, source_email_id, source_thread_id, status, due_date, priority')
      .eq('user_id', query.userId)
      .in('status', ['SUGGESTED', 'TODO', 'IN_PROGRESS'])
      .or(filters.join(','))
      .limit(25);

    if (query.excludeTaskId) builder = builder.neq('id', query.excludeTaskId);

    const rows = await this.run<Array<{
      id: string;
      title: string;
      source_email_id: string | null;
      source_thread_id: string | null;
      status: string;
      due_date: string | null;
      priority: EmailPriority;
    }>>('findDuplicateCandidates', builder);
    return rows ?? [];
  }

  // ── Notifications ─────────────────────────────────────────────────────────

  async createNotification(input: NewNotificationInput): Promise<AppNotification | null> {
    if (input.dedupe_key) {
      const existing = await this.maybeRun<AppNotification>(
        'findNotificationByDedupe',
        this.client
          .from('notifications')
          .select('*')
          .eq('user_id', input.user_id)
          .eq('dedupe_key', input.dedupe_key)
          .maybeSingle(),
      );
      if (existing) return existing;
    }
    return this.run<AppNotification>(
      'createNotification',
      this.client.from('notifications').insert(input).select('*').single(),
    );
  }

  async listNotifications(
    userId: string,
    options: { unreadOnly?: boolean; limit?: number },
  ): Promise<AppNotification[]> {
    const scoped = this.client.from('notifications').select('*').eq('user_id', userId);
    const filtered = options.unreadOnly ? scoped.eq('is_read', false) : scoped;
    const rows = await this.run<AppNotification[]>(
      'listNotifications',
      filtered.order('created_at', { ascending: false }).limit(clamp(options.limit ?? 50, 1, 200)),
    );
    return rows ?? [];
  }

  async setNotificationRead(userId: string, notificationId: string, read: boolean): Promise<void> {
    await this.run(
      'setNotificationRead',
      this.client
        .from('notifications')
        .update({ is_read: read, read_at: read ? new Date().toISOString() : null })
        .eq('user_id', userId)
        .eq('id', notificationId),
    );
  }

  async markAllNotificationsRead(userId: string): Promise<number> {
    const rows = await this.run<Array<{ id: string }>>(
      'markAllNotificationsRead',
      this.client
        .from('notifications')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('is_read', false)
        .select('id'),
    );
    return rows?.length ?? 0;
  }

  async deleteNotification(userId: string, notificationId: string): Promise<void> {
    await this.run(
      'deleteNotification',
      this.client.from('notifications').delete().eq('user_id', userId).eq('id', notificationId),
    );
  }

  // ── Agent telemetry ───────────────────────────────────────────────────────

  async createRun(input: NewRunInput): Promise<AgentRun> {
    return this.run<AgentRun>(
      'createRun',
      this.client
        .from('agent_runs')
        .insert({ ...input, status: 'RUNNING', started_at: new Date().toISOString() })
        .select('*')
        .single(),
    );
  }

  async updateRun(userId: string, runId: string, values: Partial<AgentRun>): Promise<void> {
    await this.run('updateRun', this.client.from('agent_runs').update(values).eq('user_id', userId).eq('id', runId));
  }

  async logAgentAction(input: NewAgentActionInput): Promise<void> {
    await this.run('logAgentAction', this.client.from('agent_actions').insert(input));
  }

  async listAgentActions(
    userId: string,
    options: { limit?: number; emailId?: string | null; runId?: string | null },
  ): Promise<AgentAction[]> {
    let builder = this.client
      .from('agent_actions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(clamp(options.limit ?? 60, 1, 300));
    if (options.emailId) builder = builder.eq('email_id', options.emailId);
    if (options.runId) builder = builder.eq('run_id', options.runId);
    const rows = await this.run<AgentAction[]>('listAgentActions', builder);
    return rows ?? [];
  }

  async listAgentRuns(userId: string, limit: number): Promise<AgentRun[]> {
    const rows = await this.run<AgentRun[]>(
      'listAgentRuns',
      this.client
        .from('agent_runs')
        .select('*')
        .eq('user_id', userId)
        .order('started_at', { ascending: false })
        .limit(clamp(limit, 1, 200)),
    );
    return rows ?? [];
  }

  // ── Integration telemetry ─────────────────────────────────────────────────

  async logIntegrationEvent(input: NewIntegrationEventInput): Promise<void> {
    await this.run('logIntegrationEvent', this.client.from('integration_events').insert(input));
  }

  async listIntegrationEvents(userId: string, limit: number): Promise<IntegrationEvent[]> {
    const rows = await this.run<IntegrationEvent[]>(
      'listIntegrationEvents',
      this.client
        .from('integration_events')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(clamp(limit, 1, 200)),
    );
    return rows ?? [];
  }

  async resolveIntegrationEvents(userId: string, accountId: string): Promise<void> {
    await this.run(
      'resolveIntegrationEvents',
      this.client
        .from('integration_events')
        .update({ resolved: true })
        .eq('user_id', userId)
        .eq('account_id', accountId)
        .eq('resolved', false),
    );
  }

  // ── Analytics ─────────────────────────────────────────────────────────────

  async dashboardCounters(userId: string): Promise<DashboardCounters> {
    const data = await this.run<Record<string, unknown>>(
      'dashboardCounters',
      this.client.rpc('get_dashboard_counters', { p_user_id: userId }),
    );
    return normaliseCounters(data);
  }

  async dailyAnalytics(userId: string, days: number): Promise<DailyAnalytics[]> {
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const rows = await this.run<Array<Record<string, unknown>>>(
      'dailyAnalytics',
      this.client
        .from('user_analytics_daily')
        .select('*')
        .eq('user_id', userId)
        .gte('day', since.slice(0, 10))
        .order('day', { ascending: true }),
    );
    return (rows ?? []).map((row) => ({
      day: String(row.day),
      emailsReceived: Number(row.emails_received ?? 0),
      emailsAnalyzed: Number(row.emails_analyzed ?? 0),
      actionableEmails: Number(row.actionable_emails ?? 0),
      highPriorityEmails: Number(row.high_priority_emails ?? 0),
      deadlinesDetected: Number(row.deadlines_detected ?? 0),
    }));
  }

  async agentHealth(userId: string, days: number): Promise<AgentHealth[]> {
    const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    const rows = await this.run<Array<Record<string, unknown>>>(
      'agentHealth',
      this.client
        .from('agent_health_daily')
        .select('*')
        .eq('user_id', userId)
        .gte('day', since)
        .order('day', { ascending: true }),
    );
    return (rows ?? []).map((row) => ({
      day: String(row.day),
      runs: Number(row.runs ?? 0),
      successful: Number(row.successful_runs ?? 0),
      failed: Number(row.failed_runs ?? 0),
      needsReview: Number(row.needs_review_runs ?? 0),
      avgDurationMs: row.avg_duration_ms === null || row.avg_duration_ms === undefined ? null : Number(row.avg_duration_ms),
      avgConfidence: row.avg_confidence === null || row.avg_confidence === undefined ? null : Number(row.avg_confidence),
      toolCalls: Number(row.tool_calls ?? 0),
    }));
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async deleteAllUserData(userId: string): Promise<Record<string, number>> {
    const data = await this.run<Record<string, number>>(
      'delete_vozinbox_data',
      this.client.rpc('delete_vozinbox_data', { p_user_id: userId }),
    );
    return data ?? {};
  }

  async listCronCandidates(limit: number): Promise<string[]> {
    const rows = await this.run<Array<{ user_id: string }>>(
      'listCronCandidates',
      this.client
        .from('email_accounts')
        .select('user_id')
        .eq('status', 'CONNECTED')
        .order('last_sync_at', { ascending: true, nullsFirst: true })
        .limit(clamp(limit * 4, 1, 400)),
    );
    const unique = new Set<string>();
    for (const row of rows ?? []) {
      unique.add(row.user_id);
      if (unique.size >= limit) break;
    }
    return [...unique];
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function describe(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    const message = record.message;
    const code = record.code;
    if (typeof message === 'string') return code ? `${code}: ${message}` : message;
  }
  return 'unknown database error';
}

function isNotFound(error: unknown): boolean {
  if (error && typeof error === 'object') {
    const code = (error as Record<string, unknown>).code;
    // PGRST116 = "JSON object requested, multiple (or no) rows returned"
    return code === 'PGRST116';
  }
  return false;
}

function normaliseCounters(data: Record<string, unknown> | null): DashboardCounters {
  const value = (key: string): number => Number(data?.[key] ?? 0);
  return {
    unread: value('unread'),
    actionRequired: value('actionRequired'),
    highPriority: value('highPriority'),
    pendingTasks: value('pendingTasks'),
    suggestedTasks: value('suggestedTasks'),
    unreadNotifications: value('unreadNotifications'),
    upcomingDeadlines: value('upcomingDeadlines'),
    needsReview: value('needsReview'),
    analyzedToday: value('analyzedToday'),
    totalEmails: value('totalEmails'),
  };
}

function buildFallbackProfile(input: { userId: string; email: string | null; fullName: string | null }): Profile {
  const now = new Date().toISOString();
  return {
    id: input.userId,
    email: input.email,
    full_name: input.fullName,
    avatar_url: null,
    timezone: 'UTC',
    onboarding_state: {},
    created_at: now,
    updated_at: now,
  };
}

/** Shared helper so both stores compute "today" identically. */
export function todayIn(timezone: string): string {
  const parts = getZonedParts(new Date(), timezone);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

export { PRIORITY_WEIGHT };
