import 'server-only';

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppError } from '@/lib/errors';
import type {
  AgentAction,
  AgentRun,
  AppNotification,
  Email,
  EmailAccount,
  EmailActionRow,
  EmailAnalysis,
  EmailThread,
  InboxItem,
  IntegrationEvent,
  Profile,
  Task,
  UserPreferences,
} from '@/lib/types/database';
import type { EmailCategory, EmailPriority, InboxFilter, InboxSort } from '@/lib/types/domain';
import { PRIORITY_WEIGHT } from '@/lib/types/domain';
import { buildDedupeKey } from '@/lib/analysis/dedupe';
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
 * Local development store.
 *
 * Implements the same contract as `SupabaseStore` against a JSON file inside
 * `.vozinbox-dev/` so the whole product — auth, sync, agent pipeline, tasks,
 * notifications, chat — can be exercised without a Supabase project.
 *
 * This store is **never** used in production: `getStore()` only selects it when
 * Supabase is unconfigured and NODE_ENV !== 'production'.
 */

interface LocalDatabase {
  version: 1;
  users: LocalUser[];
  profiles: Profile[];
  preferences: UserPreferences[];
  accounts: EmailAccount[];
  credentials: StoredCredentials[];
  threads: EmailThread[];
  emails: Email[];
  analyses: EmailAnalysis[];
  history: Array<HistoryInput & { id: string; created_at: string }>;
  actions: EmailActionRow[];
  tasks: Task[];
  notifications: AppNotification[];
  runs: AgentRun[];
  agentActions: AgentAction[];
  integrationEvents: IntegrationEvent[];
}

export interface LocalUser {
  id: string;
  email: string;
  password_hash: string;
  full_name: string | null;
  timezone: string;
  created_at: string;
  updated_at: string;
  metadata: Record<string, unknown>;
}

const EMPTY_DB: LocalDatabase = {
  version: 1,
  users: [],
  profiles: [],
  preferences: [],
  accounts: [],
  credentials: [],
  threads: [],
  emails: [],
  analyses: [],
  history: [],
  actions: [],
  tasks: [],
  notifications: [],
  runs: [],
  agentActions: [],
  integrationEvents: [],
};

const DATA_DIR = process.env.VOZINBOX_LOCAL_DIR ?? path.join(process.cwd(), '.vozinbox-dev');
const DATA_FILE = path.join(DATA_DIR, 'data.json');

let cache: LocalDatabase | null = null;
let writeQueue: Promise<void> = Promise.resolve();

async function load(): Promise<LocalDatabase> {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw) as LocalDatabase;
    cache = { ...EMPTY_DB, ...parsed };
  } catch {
    cache = structuredClone(EMPTY_DB);
  }
  return cache;
}

function persist(): Promise<void> {
  const snapshot = cache;
  writeQueue = writeQueue.then(async () => {
    if (!snapshot) return;
    try {
      await fs.mkdir(DATA_DIR, { recursive: true });
      await fs.writeFile(DATA_FILE, JSON.stringify(snapshot, null, 2), 'utf8');
    } catch (error) {
      throw new AppError('DATABASE', {
        message: `Failed to persist local development store: ${String(error)}`,
        userMessage: 'The local development store could not be written to disk.',
      });
    }
  });
  return writeQueue;
}

const now = (): string => new Date().toISOString();

export class LocalStore implements Store {
  readonly kind = 'local' as const;

  // ── Users (auth support for local mode) ───────────────────────────────────

  async findUserByEmail(email: string): Promise<LocalUser | null> {
    const db = await load();
    return db.users.find((user) => user.email.toLowerCase() === email.toLowerCase()) ?? null;
  }

  async getUserById(id: string): Promise<LocalUser | null> {
    const db = await load();
    return db.users.find((user) => user.id === id) ?? null;
  }

  async createUser(input: { email: string; passwordHash: string; fullName: string | null; timezone: string }): Promise<LocalUser> {
    const db = await load();
    const existing = db.users.find((user) => user.email.toLowerCase() === input.email.toLowerCase());
    if (existing) {
      throw new AppError('CONFLICT', {
        message: 'A user with that email already exists',
        userMessage: 'An account with this email already exists. Try signing in instead.',
      });
    }
    const user: LocalUser = {
      id: randomUUID(),
      email: input.email,
      password_hash: input.passwordHash,
      full_name: input.fullName,
      timezone: input.timezone,
      created_at: now(),
      updated_at: now(),
      metadata: {},
    };
    db.users.push(user);
    await persist();
    return user;
  }

  async updateUserPassword(userId: string, passwordHash: string): Promise<void> {
    const db = await load();
    const user = db.users.find((entry) => entry.id === userId);
    if (!user) throw new AppError('NOT_FOUND', { message: 'User not found' });
    user.password_hash = passwordHash;
    user.updated_at = now();
    await persist();
  }

  // ── Profiles & preferences ────────────────────────────────────────────────

  async getProfile(userId: string): Promise<Profile | null> {
    const db = await load();
    return db.profiles.find((profile) => profile.id === userId) ?? null;
  }

  async updateProfile(userId: string, values: Partial<Profile>): Promise<Profile> {
    const db = await load();
    const existing = db.profiles.find((profile) => profile.id === userId);
    if (!existing) throw new AppError('NOT_FOUND', { message: 'Profile not found' });
    Object.assign(existing, values, { updated_at: now() });
    await persist();
    return existing;
  }

  async ensureBootstrap(input: {
    userId: string;
    email: string | null;
    fullName: string | null;
    timezone?: string;
  }): Promise<{ profile: Profile; preferences: UserPreferences }> {
    const db = await load();
    let profile = db.profiles.find((entry) => entry.id === input.userId);
    if (!profile) {
      profile = {
        id: input.userId,
        email: input.email,
        full_name: input.fullName,
        avatar_url: null,
        timezone: input.timezone ?? 'UTC',
        onboarding_state: {},
        created_at: now(),
        updated_at: now(),
      };
      db.profiles.push(profile);
    }
    let preferences = db.preferences.find((entry) => entry.user_id === input.userId);
    if (!preferences) {
      preferences = buildDefaultPreferences(input.userId);
      db.preferences.push(preferences);
    }
    await persist();
    return { profile, preferences };
  }

  async getPreferences(userId: string): Promise<UserPreferences> {
    const db = await load();
    let preferences = db.preferences.find((entry) => entry.user_id === userId);
    if (!preferences) {
      preferences = buildDefaultPreferences(userId);
      db.preferences.push(preferences);
      await persist();
    }
    return preferences;
  }

  async updatePreferences(userId: string, values: Partial<UserPreferences>): Promise<UserPreferences> {
    const db = await load();
    const preferences = await this.getPreferences(userId);
    Object.assign(preferences, values, { updated_at: now() });
    void db;
    await persist();
    return preferences;
  }

  // ── Accounts & credentials ────────────────────────────────────────────────

  async listAccounts(userId: string): Promise<EmailAccount[]> {
    const db = await load();
    return db.accounts.filter((account) => account.user_id === userId);
  }

  async getAccount(userId: string, accountId: string): Promise<EmailAccount | null> {
    const db = await load();
    return db.accounts.find((account) => account.user_id === userId && account.id === accountId) ?? null;
  }

  async getAccountByProvider(
    userId: string,
    provider: 'gmail' | 'outlook',
    providerAccountId: string,
  ): Promise<EmailAccount | null> {
    const db = await load();
    return (
      db.accounts.find(
        (account) =>
          account.user_id === userId &&
          account.provider === provider &&
          account.provider_account_id === providerAccountId,
      ) ?? null
    );
  }

  async createAccount(input: NewAccountInput): Promise<EmailAccount> {
    const db = await load();
    const existing = db.accounts.find(
      (account) =>
        account.user_id === input.user_id &&
        account.provider === input.provider &&
        account.provider_account_id === input.provider_account_id,
    );
    if (existing) {
      Object.assign(existing, input, { status: input.status ?? 'CONNECTED', updated_at: now() });
      await persist();
      return existing;
    }
    const account: EmailAccount = {
      id: randomUUID(),
      user_id: input.user_id,
      provider: input.provider,
      provider_account_id: input.provider_account_id,
      email_address: input.email_address,
      display_name: input.display_name,
      status: input.status ?? 'CONNECTED',
      scopes: input.scopes,
      last_sync_at: null,
      last_sync_status: null,
      last_sync_error: null,
      last_history_id: null,
      sync_cursor: {},
      watch_expiration: null,
      connected_at: now(),
      disconnected_at: null,
      created_at: now(),
      updated_at: now(),
    };
    db.accounts.push(account);
    await persist();
    return account;
  }

  async updateAccount(userId: string, accountId: string, values: Partial<EmailAccount>): Promise<EmailAccount> {
    const db = await load();
    const account = db.accounts.find((entry) => entry.user_id === userId && entry.id === accountId);
    if (!account) throw new AppError('NOT_FOUND', { message: 'Email account not found' });
    Object.assign(account, values, { updated_at: now() });
    await persist();
    return account;
  }

  async deleteAccount(userId: string, accountId: string): Promise<void> {
    const db = await load();
    db.accounts = db.accounts.filter((account) => !(account.user_id === userId && account.id === accountId));
    db.credentials = db.credentials.filter((credential) => credential.account_id !== accountId);
    const threadIds = db.threads.filter((thread) => thread.account_id === accountId).map((thread) => thread.id);
    db.threads = db.threads.filter((thread) => thread.account_id !== accountId);
    const emailIds = db.emails.filter((email) => email.account_id === accountId).map((email) => email.id);
    db.emails = db.emails.filter((email) => email.account_id !== accountId);
    db.analyses = db.analyses.filter((analysis) => !emailIds.includes(analysis.email_id));
    db.actions = db.actions.filter((action) => !emailIds.includes(action.email_id));
    db.tasks = db.tasks
      .filter((task) => !threadIds.includes(task.source_thread_id ?? ''))
      .map((task) => (emailIds.includes(task.source_email_id ?? '') ? { ...task, source_email_id: null } : task));
    await persist();
  }

  async saveCredentials(input: CredentialsInput): Promise<void> {
    const db = await load();
    const existing = db.credentials.find((credential) => credential.account_id === input.account_id);
    if (existing) {
      Object.assign(existing, input);
    } else {
      db.credentials.push({ ...input });
    }
    await persist();
  }

  async getCredentials(userId: string, accountId: string): Promise<StoredCredentials | null> {
    const db = await load();
    return (
      db.credentials.find((credential) => credential.user_id === userId && credential.account_id === accountId) ?? null
    );
  }

  async deleteCredentials(userId: string, accountId: string): Promise<void> {
    const db = await load();
    db.credentials = db.credentials.filter(
      (credential) => !(credential.user_id === userId && credential.account_id === accountId),
    );
    await persist();
  }

  // ── Threads ───────────────────────────────────────────────────────────────

  async upsertThread(input: NewThreadInput): Promise<EmailThread> {
    const db = await load();
    const existing = db.threads.find(
      (thread) => thread.account_id === input.account_id && thread.provider_thread_id === input.provider_thread_id,
    );
    if (existing) {
      Object.assign(existing, {
        subject: input.subject ?? existing.subject,
        participants: input.participants.length > 0 ? input.participants : existing.participants,
        last_message_at: input.last_message_at ?? existing.last_message_at,
        message_count: Math.max(existing.message_count, input.message_count),
        updated_at: now(),
      });
      await persist();
      return existing;
    }
    const thread: EmailThread = {
      id: randomUUID(),
      user_id: input.user_id,
      account_id: input.account_id,
      provider: input.provider,
      provider_thread_id: input.provider_thread_id,
      subject: input.subject,
      participants: input.participants,
      message_count: input.message_count,
      last_message_at: input.last_message_at,
      latest_message_id: null,
      authoritative_email_id: null,
      thread_state: {},
      changes_detected: [],
      created_at: now(),
      updated_at: now(),
    };
    db.threads.push(thread);
    await persist();
    return thread;
  }

  async getThread(userId: string, threadId: string): Promise<EmailThread | null> {
    const db = await load();
    return db.threads.find((thread) => thread.user_id === userId && thread.id === threadId) ?? null;
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
    const db = await load();
    const thread = db.threads.find((entry) => entry.user_id === userId && entry.id === threadId);
    if (!thread) return;
    Object.assign(thread, values, { updated_at: now() });
    await persist();
  }

  async listThreadPriorAnalyses(userId: string, threadId: string, excludeEmailId: string): Promise<PriorAnalysis[]> {
    const db = await load();
    return db.analyses
      .filter((analysis) => analysis.user_id === userId && analysis.thread_id === threadId && analysis.email_id !== excludeEmailId)
      .map((analysis) => {
        const email = db.emails.find((entry) => entry.id === analysis.email_id);
        return {
          email_id: analysis.email_id,
          category: analysis.category,
          priority: analysis.priority,
          action_required: analysis.action_required,
          suggested_action: analysis.suggested_action,
          deadline: analysis.detected_deadline,
          received_at: email?.received_at ?? analysis.created_at,
        };
      })
      .sort((a, b) => a.received_at.localeCompare(b.received_at));
  }

  // ── Emails ────────────────────────────────────────────────────────────────

  async upsertEmail(input: NewEmailInput): Promise<Email> {
    const db = await load();
    const existing = db.emails.find(
      (email) =>
        email.user_id === input.user_id &&
        email.provider === input.provider &&
        email.provider_message_id === input.provider_message_id,
    );
    if (existing) {
      // Preserve analysis bookkeeping on re-sync.
      Object.assign(existing, input, {
        analysis_state: existing.analysis_state,
        analyzed_at: existing.analyzed_at,
        is_read: existing.is_read || input.is_read,
        updated_at: now(),
      });
      await persist();
      return existing;
    }
    const email: Email = {
      id: randomUUID(),
      ...input,
      attachments: input.attachments.map((attachment) => ({
        filename: attachment.filename,
        mime_type: attachment.mime_type ?? null,
        size_bytes: attachment.size_bytes ?? null,
        attachment_id: attachment.attachment_id ?? null,
      })),
      is_archived: false,
      analysis_state: 'PENDING',
      analyzed_at: null,
      created_at: now(),
      updated_at: now(),
    };
    db.emails.push(email);
    await persist();
    return email;
  }

  async getEmail(userId: string, emailId: string): Promise<Email | null> {
    const db = await load();
    return db.emails.find((email) => email.user_id === userId && email.id === emailId) ?? null;
  }

  async updateEmail(userId: string, emailId: string, values: Partial<Email>): Promise<void> {
    const db = await load();
    const email = db.emails.find((entry) => entry.user_id === userId && entry.id === emailId);
    if (!email) return;
    Object.assign(email, values, { updated_at: now() });
    await persist();
  }

  async listInbox(query: InboxQuery): Promise<InboxPage> {
    const db = await load();
    const limit = Math.max(1, Math.min(query.limit ?? 25, 100));
    const offset = Math.max(0, query.offset ?? 0);

    let rows = db.emails.filter((email) => email.user_id === query.userId && !email.is_archived);

    const analysisFor = (emailId: string): EmailAnalysis | null =>
      db.analyses.find((analysis) => analysis.email_id === emailId) ?? null;

    if (query.accountId) rows = rows.filter((email) => email.account_id === query.accountId);
    if (query.threadId) rows = rows.filter((email) => email.thread_id === query.threadId);
    if (query.isRead !== null && query.isRead !== undefined) {
      rows = rows.filter((email) => email.is_read === query.isRead);
    }

    if (query.filter && query.filter !== 'ALL') {
      rows = rows.filter((email) => matchesFilter(email, analysisFor(email.id), query.filter as InboxFilter));
    }
    if (query.category) rows = rows.filter((email) => analysisFor(email.id)?.category === query.category);
    if (query.priority) rows = rows.filter((email) => analysisFor(email.id)?.priority === query.priority);
    if (query.actionRequired !== null && query.actionRequired !== undefined) {
      rows = rows.filter((email) => analysisFor(email.id)?.action_required === query.actionRequired);
    }
    if (query.deadlineFrom || query.deadlineTo) {
      rows = rows.filter((email) => {
        const date = analysisFor(email.id)?.detected_deadline?.date;
        if (!date) return false;
        if (query.deadlineFrom && date < query.deadlineFrom) return false;
        if (query.deadlineTo && date > query.deadlineTo) return false;
        return true;
      });
    }
    if (query.search && query.search.trim().length > 0) {
      const needle = query.search.trim().toLowerCase();
      rows = rows.filter((email) => {
        const analysis = analysisFor(email.id);
        return [
          email.subject,
          email.sender_name,
          email.sender_email,
          email.snippet,
          email.body_text?.slice(0, 4000),
          analysis?.summary,
          analysis?.suggested_action,
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(needle));
      });
    }

    const sort = query.sort ?? 'NEWEST';
    rows = [...rows].sort((a, b) => compareEmails(a, b, sort, analysisFor));

    const total = rows.length;
    const page = rows.slice(offset, offset + limit);

    const items: InboxItem[] = page.map((email) => {
      const task = db.tasks.find(
        (entry) =>
          entry.source_email_id === email.id && ['SUGGESTED', 'TODO', 'IN_PROGRESS'].includes(entry.status),
      );
      return {
        email,
        analysis: analysisFor(email.id),
        source_task: task ? { id: task.id, title: task.title, status: task.status } : null,
      };
    });

    return { items, total, limit, offset, hasMore: offset + page.length < total };
  }

  async countEmails(userId: string): Promise<number> {
    const db = await load();
    return db.emails.filter((email) => email.user_id === userId).length;
  }

  async getUpcomingDeadlines(userId: string, days: number, limit: number): Promise<DeadlineItem[]> {
    const db = await load();
    const today = new Date();
    const from = isoDate(new Date(today.getTime() - 86_400_000));
    const to = isoDate(new Date(today.getTime() + days * 86_400_000));

    return db.analyses
      .filter((analysis) => analysis.user_id === userId)
      .filter((analysis) => {
        const date = analysis.detected_deadline?.date;
        return Boolean(date && date >= from && date <= to);
      })
      .map((analysis) => {
        const email = db.emails.find((entry) => entry.id === analysis.email_id);
        return email ? { analysis, email } : null;
      })
      .filter((entry): entry is { analysis: EmailAnalysis; email: Email } => entry !== null)
      .map(({ analysis, email }) => {
        const date = String(analysis.detected_deadline?.date);
        return {
          email,
          analysis,
          dueDate: date,
          dueTime: analysis.detected_deadline?.time ?? null,
          daysRemaining: Math.round(
            (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${isoDate(today)}T00:00:00Z`)) / 86_400_000,
          ),
        };
      })
      .sort((a, b) => (a.dueDate === b.dueDate ? (a.dueTime ?? '').localeCompare(b.dueTime ?? '') : a.dueDate.localeCompare(b.dueDate)))
      .slice(0, limit);
  }

  // ── Analysis ──────────────────────────────────────────────────────────────

  async getAnalysis(userId: string, emailId: string): Promise<EmailAnalysis | null> {
    const db = await load();
    return db.analyses.find((analysis) => analysis.user_id === userId && analysis.email_id === emailId) ?? null;
  }

  async upsertAnalysis(input: NewAnalysisInput): Promise<EmailAnalysis> {
    const db = await load();
    const r = input.result;
    const existing = db.analyses.find((analysis) => analysis.email_id === input.email_id);
    const payload = {
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
      grounding_report: r.grounding_report as unknown as Record<string, unknown>,
      injection_flagged: r.injection_flagged,
      injection_signals: r.injection_signals,
      raw_output: (r.raw_output ?? null) as unknown,
      updated_at: now(),
    };

    if (existing) {
      Object.assign(existing, payload);
      await persist();
      return existing;
    }
    const analysis: EmailAnalysis = {
      id: randomUUID(),
      ...payload,
      created_at: now(),
    } as EmailAnalysis;
    db.analyses.push(analysis);
    await persist();
    return analysis;
  }

  async insertAnalysisHistory(input: HistoryInput): Promise<void> {
    const db = await load();
    db.history.push({ ...input, id: randomUUID(), created_at: now() });
    await persist();
  }

  async listAnalysisHistory(
    userId: string,
    emailId: string,
  ): Promise<Array<{ id: string; created_at: string; snapshot: unknown; change_summary: HistoryInput['change_summary'] }>> {
    const db = await load();
    return db.history
      .filter((entry) => entry.user_id === userId && entry.email_id === emailId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 20)
      .map((entry) => ({
        id: entry.id,
        created_at: entry.created_at,
        snapshot: entry.snapshot,
        change_summary: entry.change_summary,
      }));
  }

  // ── Extracted actions ─────────────────────────────────────────────────────

  async upsertEmailActions(inputs: NewActionInput[]): Promise<EmailActionRow[]> {
    if (inputs.length === 0) return [];
    const db = await load();
    const created: EmailActionRow[] = [];
    for (const input of inputs) {
      const existing = db.actions.find(
        (action) => action.email_id === input.email_id && action.action_text === input.action_text,
      );
      if (existing) {
        Object.assign(existing, input, { updated_at: now() });
        created.push(existing);
        continue;
      }
      const row: EmailActionRow = {
        id: randomUUID(),
        ...input,
        status: 'OPEN',
        task_id: null,
        created_at: now(),
        updated_at: now(),
      };
      db.actions.push(row);
      created.push(row);
    }
    await persist();
    return created;
  }

  async listEmailActions(userId: string, emailId: string): Promise<EmailActionRow[]> {
    const db = await load();
    return db.actions.filter((action) => action.user_id === userId && action.email_id === emailId);
  }

  async updateEmailAction(userId: string, actionId: string, values: Partial<EmailActionRow>): Promise<void> {
    const db = await load();
    const action = db.actions.find((entry) => entry.user_id === userId && entry.id === actionId);
    if (!action) return;
    Object.assign(action, values, { updated_at: now() });
    await persist();
  }

  // ── Tasks ─────────────────────────────────────────────────────────────────

  async createTask(input: NewTaskInput): Promise<Task> {
    const db = await load();

    // Mirrors the partial unique index on
    // (user_id, source_email_id, dedupe_key) in the Supabase schema (§14):
    // one email can never produce two tasks with the same key.
    if (input.dedupe_key && input.source_email_id) {
      const clash = db.tasks.find(
        (task) =>
          task.user_id === input.user_id &&
          task.source_email_id === input.source_email_id &&
          task.dedupe_key === input.dedupe_key,
      );
      if (clash) {
        throw new AppError('CONFLICT', {
          message: 'Duplicate task suppressed',
          userMessage: `This action is already tracked as “${clash.title}”.`,
        });
      }
    }

    const task: Task = {
      id: randomUUID(),
      ...input,
      reminder_at: input.reminder_at ?? null,
      reminder_sent_at: null,
      embedding: null,
      completed_at: null,
      dismissed_at: null,
      created_at: now(),
      updated_at: now(),
    };
    db.tasks.push(task);
    await persist();
    return task;
  }

  async getTask(userId: string, taskId: string): Promise<Task | null> {
    const db = await load();
    return db.tasks.find((task) => task.user_id === userId && task.id === taskId) ?? null;
  }

  async updateTask(userId: string, taskId: string, values: Partial<Task>): Promise<Task> {
    const db = await load();
    const task = db.tasks.find((entry) => entry.user_id === userId && entry.id === taskId);
    if (!task) throw new AppError('NOT_FOUND', { message: 'Task not found', userMessage: 'That task no longer exists.' });
    Object.assign(task, values, { updated_at: now() });
    await persist();
    return task;
  }

  async deleteTask(userId: string, taskId: string): Promise<void> {
    const db = await load();
    db.tasks = db.tasks.filter((task) => !(task.user_id === userId && task.id === taskId));
    await persist();
  }

  async listTasks(query: TaskQuery): Promise<TaskPage> {
    const db = await load();
    const limit = Math.max(1, Math.min(query.limit ?? 50, 200));
    const offset = Math.max(0, query.offset ?? 0);

    let rows = db.tasks.filter((task) => task.user_id === query.userId);
    if (query.status && query.status !== 'ALL') rows = rows.filter((task) => task.status === query.status);
    if (query.priority) rows = rows.filter((task) => task.priority === query.priority);
    if (query.dueFrom) rows = rows.filter((task) => task.due_date && task.due_date >= query.dueFrom!);
    if (query.dueTo) rows = rows.filter((task) => task.due_date && task.due_date <= query.dueTo!);
    if (query.search) {
      const needle = query.search.toLowerCase();
      rows = rows.filter(
        (task) =>
          task.title.toLowerCase().includes(needle) ||
          (task.description ?? '').toLowerCase().includes(needle),
      );
    }

    const sort = query.sort ?? 'DUE_SOONEST';
    rows = [...rows].sort((a, b) => {
      if (sort === 'PRIORITY') return PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority];
      if (sort === 'NEWEST') return b.created_at.localeCompare(a.created_at);
      if (sort === 'STATUS') return a.status.localeCompare(b.status);
      const aDate = a.due_date ?? '9999-12-31';
      const bDate = b.due_date ?? '9999-12-31';
      if (aDate !== bDate) return aDate.localeCompare(bDate);
      return (a.due_time ?? '00:00').localeCompare(b.due_time ?? '00:00');
    });

    const total = rows.length;
    const page = rows.slice(offset, offset + limit);

    return {
      items: page.map((task) => ({
        task,
        sourceEmail: task.source_email_id
          ? db.emails.find((email) => email.id === task.source_email_id) ?? null
          : null,
      })),
      total,
      limit,
      offset,
      hasMore: offset + page.length < total,
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
    const db = await load();
    return db.tasks
      .filter((task) => task.user_id === query.userId && ['SUGGESTED', 'TODO', 'IN_PROGRESS'].includes(task.status))
      .filter((task) => task.id !== query.excludeTaskId)
      .filter(
        (task) =>
          (query.sourceEmailId === null
            ? task.source_email_id === null
            : task.source_email_id === query.sourceEmailId) ||
          (query.sourceThreadId !== null && task.source_thread_id === query.sourceThreadId) ||
          (query.sourceEmailId !== null &&
            task.source_email_id !== null &&
            task.source_email_id !== query.sourceEmailId &&
            sharesTitleFamily(db, task, query.sourceEmailId)),
      )
      .slice(0, 25)
      .map((task) => ({
        id: task.id,
        title: task.title,
        source_email_id: task.source_email_id,
        source_thread_id: task.source_thread_id,
        status: task.status,
        due_date: task.due_date,
        priority: task.priority,
      }));
  }

  // ── Notifications ─────────────────────────────────────────────────────────

  async createNotification(input: NewNotificationInput): Promise<AppNotification | null> {
    const db = await load();
    if (input.dedupe_key) {
      const existing = db.notifications.find(
        (notification) => notification.user_id === input.user_id && notification.dedupe_key === input.dedupe_key,
      );
      if (existing) return existing;
    }
    const notification: AppNotification = {
      id: randomUUID(),
      user_id: input.user_id,
      type: input.type,
      title: input.title,
      message: input.message,
      priority: input.priority,
      is_read: false,
      read_at: null,
      entity_type: input.entity_type,
      related_entity_id: input.related_entity_id,
      action_url: input.action_url,
      metadata: input.metadata,
      dedupe_key: input.dedupe_key,
      created_at: now(),
      updated_at: now(),
    };
    db.notifications.push(notification);
    await persist();
    return notification;
  }

  async listNotifications(
    userId: string,
    options: { unreadOnly?: boolean; limit?: number },
  ): Promise<AppNotification[]> {
    const db = await load();
    return db.notifications
      .filter((notification) => notification.user_id === userId)
      .filter((notification) => (options.unreadOnly ? !notification.is_read : true))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, Math.max(1, Math.min(options.limit ?? 50, 200)));
  }

  async setNotificationRead(userId: string, notificationId: string, read: boolean): Promise<void> {
    const db = await load();
    const notification = db.notifications.find((entry) => entry.user_id === userId && entry.id === notificationId);
    if (!notification) return;
    notification.is_read = read;
    notification.read_at = read ? now() : null;
    notification.updated_at = now();
    await persist();
  }

  async markAllNotificationsRead(userId: string): Promise<number> {
    const db = await load();
    let count = 0;
    for (const notification of db.notifications) {
      if (notification.user_id === userId && !notification.is_read) {
        notification.is_read = true;
        notification.read_at = now();
        count += 1;
      }
    }
    await persist();
    return count;
  }

  async deleteNotification(userId: string, notificationId: string): Promise<void> {
    const db = await load();
    db.notifications = db.notifications.filter(
      (notification) => !(notification.user_id === userId && notification.id === notificationId),
    );
    await persist();
  }

  // ── Agent telemetry ───────────────────────────────────────────────────────

  async createRun(input: NewRunInput): Promise<AgentRun> {
    const db = await load();
    const run: AgentRun = {
      id: randomUUID(),
      user_id: input.user_id,
      trigger: input.trigger,
      email_id: input.email_id,
      thread_id: input.thread_id,
      status: 'RUNNING',
      current_step: null,
      steps_completed: [],
      tool_depth: 0,
      max_tool_depth: input.max_tool_depth,
      tool_calls: 0,
      analysis_source: null,
      model_name: null,
      confidence: null,
      error_code: null,
      error_message: null,
      duration_ms: null,
      started_at: now(),
      finished_at: null,
      created_at: now(),
      updated_at: now(),
    };
    db.runs.push(run);
    await persist();
    return run;
  }

  async updateRun(userId: string, runId: string, values: Partial<AgentRun>): Promise<void> {
    const db = await load();
    const run = db.runs.find((entry) => entry.user_id === userId && entry.id === runId);
    if (!run) return;
    Object.assign(run, values, { updated_at: now() });
    await persist();
  }

  async logAgentAction(input: NewAgentActionInput): Promise<void> {
    const db = await load();
    db.agentActions.push({
      id: randomUUID(),
      ...input,
      created_at: now(),
    });
    await persist();
  }

  async listAgentActions(
    userId: string,
    options: { limit?: number; emailId?: string | null; runId?: string | null },
  ): Promise<AgentAction[]> {
    const db = await load();
    return db.agentActions
      .filter((action) => action.user_id === userId)
      .filter((action) => (options.emailId ? action.email_id === options.emailId : true))
      .filter((action) => (options.runId ? action.run_id === options.runId : true))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, Math.max(1, Math.min(options.limit ?? 60, 300)));
  }

  async listAgentRuns(userId: string, limit: number): Promise<AgentRun[]> {
    const db = await load();
    return db.runs
      .filter((run) => run.user_id === userId)
      .sort((a, b) => b.started_at.localeCompare(a.started_at))
      .slice(0, Math.max(1, Math.min(limit, 200)));
  }

  // ── Integration telemetry ─────────────────────────────────────────────────

  async logIntegrationEvent(input: NewIntegrationEventInput): Promise<void> {
    const db = await load();
    db.integrationEvents.push({
      id: randomUUID(),
      ...input,
      resolved: false,
      created_at: now(),
    });
    await persist();
  }

  async listIntegrationEvents(userId: string, limit: number): Promise<IntegrationEvent[]> {
    const db = await load();
    return db.integrationEvents
      .filter((event) => event.user_id === userId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, Math.max(1, Math.min(limit, 200)));
  }

  async resolveIntegrationEvents(userId: string, accountId: string): Promise<void> {
    const db = await load();
    for (const event of db.integrationEvents) {
      if (event.user_id === userId && event.account_id === accountId) event.resolved = true;
    }
    await persist();
  }

  // ── Analytics ─────────────────────────────────────────────────────────────

  async dashboardCounters(userId: string): Promise<DashboardCounters> {
    const db = await load();
    const emails = db.emails.filter((email) => email.user_id === userId && !email.is_archived);
    const analysisFor = (emailId: string) => db.analyses.find((analysis) => analysis.email_id === emailId) ?? null;
    const today = isoDate(new Date());
    const soon = isoDate(new Date(Date.now() + 14 * 86_400_000));

    return {
      unread: emails.filter((email) => !email.is_read).length,
      actionRequired: emails.filter((email) => analysisFor(email.id)?.action_required).length,
      highPriority: emails.filter((email) => {
        const priority = analysisFor(email.id)?.priority;
        return priority === 'CRITICAL' || priority === 'HIGH';
      }).length,
      pendingTasks: db.tasks.filter(
        (task) => task.user_id === userId && ['SUGGESTED', 'TODO', 'IN_PROGRESS'].includes(task.status),
      ).length,
      suggestedTasks: db.tasks.filter((task) => task.user_id === userId && task.status === 'SUGGESTED').length,
      unreadNotifications: db.notifications.filter(
        (notification) => notification.user_id === userId && !notification.is_read,
      ).length,
      upcomingDeadlines: emails.filter((email) => {
        const date = analysisFor(email.id)?.detected_deadline?.date;
        return Boolean(date && date >= today && date <= soon);
      }).length,
      needsReview: emails.filter((email) => analysisFor(email.id)?.needs_review).length,
      analyzedToday: emails.filter((email) => email.received_at.slice(0, 10) === today).length,
      totalEmails: emails.length,
    };
  }

  async dailyAnalytics(userId: string, days: number): Promise<DailyAnalytics[]> {
    const db = await load();
    const buckets = new Map<string, DailyAnalytics>();
    for (let index = days - 1; index >= 0; index -= 1) {
      const day = isoDate(new Date(Date.now() - index * 86_400_000));
      buckets.set(day, {
        day,
        emailsReceived: 0,
        emailsAnalyzed: 0,
        actionableEmails: 0,
        highPriorityEmails: 0,
        deadlinesDetected: 0,
      });
    }
    for (const email of db.emails) {
      if (email.user_id !== userId) continue;
      const day = email.received_at.slice(0, 10);
      const bucket = buckets.get(day);
      if (!bucket) continue;
      bucket.emailsReceived += 1;
      const analysis = db.analyses.find((entry) => entry.email_id === email.id);
      if (!analysis) continue;
      bucket.emailsAnalyzed += 1;
      if (analysis.action_required) bucket.actionableEmails += 1;
      if (analysis.priority === 'CRITICAL' || analysis.priority === 'HIGH') bucket.highPriorityEmails += 1;
      if (analysis.detected_deadline?.date) bucket.deadlinesDetected += 1;
    }
    return Array.from(buckets.values());
  }

  async agentHealth(userId: string, days: number): Promise<AgentHealth[]> {
    const db = await load();
    const buckets = new Map<string, AgentHealth>();
    for (let index = days - 1; index >= 0; index -= 1) {
      const day = isoDate(new Date(Date.now() - index * 86_400_000));
      buckets.set(day, {
        day,
        runs: 0,
        successful: 0,
        failed: 0,
        needsReview: 0,
        avgDurationMs: null,
        avgConfidence: null,
        toolCalls: 0,
      });
    }
    const durations = new Map<string, number[]>();
    const confidences = new Map<string, number[]>();

    for (const run of db.runs) {
      if (run.user_id !== userId) continue;
      const day = run.started_at.slice(0, 10);
      const bucket = buckets.get(day);
      if (!bucket) continue;
      bucket.runs += 1;
      if (run.status === 'COMPLETED') bucket.successful += 1;
      if (run.status === 'FAILED') bucket.failed += 1;
      if (run.status === 'NEEDS_REVIEW') bucket.needsReview += 1;
      bucket.toolCalls += run.tool_calls;
      if (run.duration_ms !== null) {
        durations.set(day, [...(durations.get(day) ?? []), run.duration_ms]);
      }
      if (run.confidence !== null) {
        confidences.set(day, [...(confidences.get(day) ?? []), run.confidence]);
      }
    }

    for (const [day, bucket] of buckets) {
      const dayDurations = durations.get(day) ?? [];
      const dayConfidences = confidences.get(day) ?? [];
      bucket.avgDurationMs = dayDurations.length > 0 ? average(dayDurations) : null;
      bucket.avgConfidence = dayConfidences.length > 0 ? average(dayConfidences) : null;
    }
    return Array.from(buckets.values());
  }

  async listCronCandidates(limit: number): Promise<string[]> {
    const db = await load();
    const unique = new Set<string>();
    for (const account of db.accounts) {
      if (account.status !== 'CONNECTED') continue;
      unique.add(account.user_id);
      if (unique.size >= limit) break;
    }
    return [...unique];
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async deleteAllUserData(userId: string): Promise<Record<string, number>> {
    const db = await load();
    const emailIds = db.emails.filter((email) => email.user_id === userId).map((email) => email.id);
    const counts: Record<string, number> = {};
    const drop = <T extends { user_id?: string }>(rows: T[], key: string, predicate: (row: T) => boolean): T[] => {
      const kept = rows.filter((row) => !predicate(row));
      counts[key] = rows.length - kept.length;
      return kept;
    };

    db.tasks = drop(db.tasks, 'tasks', (row) => (row as Task).user_id === userId);
    db.notifications = drop(db.notifications, 'notifications', (row) => (row as AppNotification).user_id === userId);
    db.agentActions = drop(db.agentActions, 'agent_actions', (row) => (row as AgentAction).user_id === userId);
    db.runs = drop(db.runs, 'agent_runs', (row) => (row as AgentRun).user_id === userId);
    db.actions = drop(db.actions, 'email_actions', (row) => (row as EmailActionRow).user_id === userId);
    db.analyses = drop(db.analyses, 'email_analysis', (row) => (row as EmailAnalysis).user_id === userId);
    db.history = drop(db.history, 'email_analysis_history', (row) => row.user_id === userId);
    db.emails = drop(db.emails, 'emails', (row) => (row as Email).user_id === userId);
    db.threads = drop(db.threads, 'email_threads', (row) => (row as EmailThread).user_id === userId);
    db.integrationEvents = drop(db.integrationEvents, 'integration_events', (row) => (row as IntegrationEvent).user_id === userId);
    db.credentials = drop(db.credentials, 'email_account_credentials', (row) => row.user_id === userId);
    db.accounts = drop(db.accounts, 'email_accounts', (row) => (row as EmailAccount).user_id === userId);

    void emailIds;
    await persist();
    return counts;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildDefaultPreferences(userId: string): UserPreferences {
  const timestamp = now();
  return {
    user_id: userId,
    auto_analyze_new_emails: true,
    auto_suggest_tasks: true,
    deadline_detection_enabled: true,
    priority_detection_enabled: true,
    summary_length: 'NORMAL',
    confidence_threshold: 0.9,
    notify_important_email: true,
    notify_deadline: true,
    notify_task_suggestion: true,
    notify_meeting: true,
    notify_project: true,
    notify_information: false,
    sync_interval_minutes: 15,
    important_senders: [],
    ignored_senders: [],
    created_at: timestamp,
    updated_at: timestamp,
  };
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function average(values: number[]): number {
  return Number((values.reduce((total, value) => total + value, 0) / values.length).toFixed(3));
}

function matchesFilter(email: Email, analysis: EmailAnalysis | null, filter: InboxFilter): boolean {
  switch (filter) {
    case 'UNREAD':
      return !email.is_read;
    case 'ACTION_REQUIRED':
      return Boolean(analysis?.action_required);
    case 'HIGH_PRIORITY':
      return analysis?.priority === 'CRITICAL' || analysis?.priority === 'HIGH';
    case 'DEADLINES':
      return Boolean(analysis?.detected_deadline?.date);
    case 'ASSIGNMENT':
    case 'MEETING':
    case 'PROJECT':
    case 'PERSONAL':
    case 'INFORMATION':
    case 'PROMOTIONAL':
    case 'SPAM':
      return analysis?.category === (filter as EmailCategory);
    default:
      return true;
  }
}

function compareEmails(
  a: Email,
  b: Email,
  sort: InboxSort,
  analysisFor: (emailId: string) => EmailAnalysis | null,
): number {
  if (sort === 'NEWEST') return b.received_at.localeCompare(a.received_at);
  if (sort === 'OLDEST') return a.received_at.localeCompare(b.received_at);
  if (sort === 'HIGHEST_PRIORITY') {
    const diff = PRIORITY_WEIGHT[analysisFor(b.id)?.priority ?? 'NONE'] - PRIORITY_WEIGHT[analysisFor(a.id)?.priority ?? 'NONE'];
    return diff !== 0 ? diff : b.received_at.localeCompare(a.received_at);
  }
  if (sort === 'DEADLINE_SOONEST') {
    const aDate = analysisFor(a.id)?.detected_deadline?.date ?? '9999-12-31';
    const bDate = analysisFor(b.id)?.detected_deadline?.date ?? '9999-12-31';
    if (aDate !== bDate) return aDate.localeCompare(bDate);
    return b.received_at.localeCompare(a.received_at);
  }
  if (sort === 'UNREAD_FIRST') {
    if (a.is_read !== b.is_read) return a.is_read ? 1 : -1;
    return b.received_at.localeCompare(a.received_at);
  }
  if (sort === 'ACTION_REQUIRED_FIRST') {
    const aAction = analysisFor(a.id)?.action_required ? 1 : 0;
    const bAction = analysisFor(b.id)?.action_required ? 1 : 0;
    if (aAction !== bAction) return bAction - aAction;
    return b.received_at.localeCompare(a.received_at);
  }
  return b.received_at.localeCompare(a.received_at);
}

function sharesTitleFamily(db: LocalDatabase, task: Task, sourceEmailId: string): boolean {
  const email = db.emails.find((entry) => entry.id === sourceEmailId);
  if (!email) return false;
  const key = buildDedupeKey(sourceEmailId, task.title);
  return key.length > 0 && task.dedupe_key !== null && task.dedupe_key.split(':')[0] === sourceEmailId;
}

export { persist as __persistLocalStore, DATA_FILE as __localStorePath };
