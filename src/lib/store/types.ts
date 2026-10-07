/**
 * Data-access contract.
 *
 * The application talks to a `Store`, never to a database driver directly. Two
 * implementations exist:
 *
 *  • SupabaseStore  — production. Postgres + RLS via `@supabase/supabase-js`.
 *  • LocalStore     — development fallback when Supabase is not configured, so
 *                     the product can be run and evaluated end to end without
 *                     external accounts. It is never used in production.
 *
 * Both must honour identical semantics: results are always scoped to one user.
 */

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
  InboxItem,
  Profile,
  Task,
  UserPreferences,
} from '@/lib/types/database';
import type {
  AgentActionType,
  DetectedChange,
  EmailAnalysisResult,
  EmailCategory,
  EmailPriority,
  InboxFilter,
  InboxSort,
  NotificationType,
  ProposedTask,
  TaskStatus,
} from '@/lib/types/domain';
import type { ThreadState } from '@/lib/types/database';

// ── Inputs ───────────────────────────────────────────────────────────────────

export interface NewAccountInput {
  user_id: string;
  provider: 'gmail' | 'outlook';
  provider_account_id: string;
  email_address: string;
  display_name: string | null;
  scopes: string[];
  status?: EmailAccount['status'];
}

export interface CredentialsInput {
  account_id: string;
  user_id: string;
  refresh_token_cipher: string;
  access_token_cipher: string | null;
  scope: string | null;
  expires_at: string | null;
  token_type: string;
}

export interface StoredCredentials {
  account_id: string;
  user_id: string;
  refresh_token_cipher: string;
  access_token_cipher: string | null;
  scope: string | null;
  expires_at: string | null;
  token_type: string;
}

export interface NewEmailInput {
  user_id: string;
  account_id: string;
  thread_id: string | null;
  provider: 'gmail' | 'outlook';
  provider_message_id: string;
  provider_thread_id: string;
  sender_name: string | null;
  sender_email: string | null;
  recipient: string | null;
  recipients: Array<{ name: string | null; email: string | null }>;
  subject: string | null;
  snippet: string | null;
  body_text: string | null;
  body_html: string | null;
  received_at: string;
  is_read: boolean;
  has_attachments: boolean;
  attachments: DetectedAttachmentLike[];
  labels: string[];
  headers: Record<string, string>;
  size_estimate: number | null;
}

export interface DetectedAttachmentLike {
  filename: string;
  mime_type?: string | null;
  size_bytes?: number | null;
  attachment_id?: string | null;
}

export interface NewThreadInput {
  user_id: string;
  account_id: string;
  provider: 'gmail' | 'outlook';
  provider_thread_id: string;
  subject: string | null;
  participants: Array<{ name: string | null; email: string | null }>;
  last_message_at: string | null;
  message_count: number;
}

export interface NewAnalysisInput {
  user_id: string;
  email_id: string;
  thread_id: string | null;
  result: EmailAnalysisResult;
}

export interface HistoryInput {
  user_id: string;
  email_id: string;
  thread_id: string | null;
  snapshot: unknown;
  change_summary: DetectedChange[];
  superseded_by?: string | null;
  analysis_version: string;
}

export interface NewActionInput {
  user_id: string;
  email_id: string;
  analysis_id: string | null;
  action_text: string;
  action_type: string;
  source_sentence: string | null;
  due_date: string | null;
  due_time: string | null;
  timezone: string | null;
  confidence: number;
  requires_review: boolean;
}

export interface NewTaskInput {
  user_id: string;
  title: string;
  description: string | null;
  source_email_id: string | null;
  source_thread_id: string | null;
  source_action_id: string | null;
  category: EmailCategory;
  priority: EmailPriority;
  due_date: string | null;
  due_time: string | null;
  timezone: string | null;
  status: TaskStatus;
  origin: Task['origin'];
  dedupe_key: string | null;
  reminder_at?: string | null;
}

export interface NewNotificationInput {
  user_id: string;
  type: NotificationType;
  title: string;
  message: string | null;
  priority: EmailPriority;
  entity_type: string | null;
  related_entity_id: string | null;
  action_url: string | null;
  metadata: Record<string, unknown>;
  dedupe_key: string | null;
}

export interface NewRunInput {
  user_id: string;
  trigger: AgentRun['trigger'];
  email_id: string | null;
  thread_id: string | null;
  max_tool_depth: number;
}

export interface NewAgentActionInput {
  user_id: string;
  run_id: string | null;
  action_type: AgentActionType;
  title: string;
  detail: string | null;
  tool_name: string | null;
  email_id: string | null;
  task_id: string | null;
  notification_id: string | null;
  severity: 'info' | 'warning' | 'error';
  payload: Record<string, unknown>;
}

export interface NewIntegrationEventInput {
  user_id: string;
  account_id: string | null;
  provider: 'gmail' | 'outlook';
  event_type: string;
  severity: 'info' | 'warning' | 'error';
  message: string | null;
  context: Record<string, unknown>;
}

// ── Queries ──────────────────────────────────────────────────────────────────

export interface InboxQuery {
  userId: string;
  filter?: InboxFilter;
  sort?: InboxSort;
  search?: string | null;
  limit?: number;
  offset?: number;
  accountId?: string | null;
  threadId?: string | null;
  category?: EmailCategory | null;
  priority?: EmailPriority | null;
  actionRequired?: boolean | null;
  isRead?: boolean | null;
  deadlineFrom?: string | null;
  deadlineTo?: string | null;
}

export interface InboxPage {
  items: InboxItem[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface TaskQuery {
  userId: string;
  status?: TaskStatus | 'ALL' | null;
  priority?: EmailPriority | null;
  search?: string | null;
  dueFrom?: string | null;
  dueTo?: string | null;
  sort?: 'DUE_SOONEST' | 'NEWEST' | 'PRIORITY' | 'STATUS';
  limit?: number;
  offset?: number;
}

export interface TaskPage {
  items: Array<{ task: Task; sourceEmail: Email | null }>;
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface DeadlineItem {
  email: Email;
  analysis: EmailAnalysis | null;
  dueDate: string;
  dueTime: string | null;
  daysRemaining: number;
}

export interface PriorAnalysis {
  email_id: string;
  category: EmailCategory;
  priority: EmailPriority;
  action_required: boolean;
  suggested_action: string | null;
  deadline: EmailAnalysisResult['detected_deadline'];
  received_at: string;
}

export interface DashboardCounters {
  unread: number;
  actionRequired: number;
  highPriority: number;
  pendingTasks: number;
  suggestedTasks: number;
  unreadNotifications: number;
  upcomingDeadlines: number;
  needsReview: number;
  analyzedToday: number;
  totalEmails: number;
}

export interface DailyAnalytics {
  day: string;
  emailsReceived: number;
  emailsAnalyzed: number;
  actionableEmails: number;
  highPriorityEmails: number;
  deadlinesDetected: number;
}

export interface AgentHealth {
  day: string;
  runs: number;
  successful: number;
  failed: number;
  needsReview: number;
  avgDurationMs: number | null;
  avgConfidence: number | null;
  toolCalls: number;
}

export interface DuplicateCandidateQuery {
  userId: string;
  sourceEmailId: string | null;
  sourceThreadId: string | null;
  excludeTaskId?: string | null;
}

// ── Store contract ───────────────────────────────────────────────────────────

export interface Store {
  readonly kind: 'supabase' | 'local';

  // Profiles & preferences
  getProfile(userId: string): Promise<Profile | null>;
  updateProfile(userId: string, values: Partial<Profile>): Promise<Profile>;
  ensureBootstrap(input: {
    userId: string;
    email: string | null;
    fullName: string | null;
    timezone?: string;
  }): Promise<{ profile: Profile; preferences: UserPreferences }>;
  getPreferences(userId: string): Promise<UserPreferences>;
  updatePreferences(userId: string, values: Partial<UserPreferences>): Promise<UserPreferences>;

  // Accounts & credentials
  listAccounts(userId: string): Promise<EmailAccount[]>;
  getAccount(userId: string, accountId: string): Promise<EmailAccount | null>;
  getAccountByProvider(userId: string, provider: 'gmail' | 'outlook', providerAccountId: string): Promise<EmailAccount | null>;
  createAccount(input: NewAccountInput): Promise<EmailAccount>;
  updateAccount(userId: string, accountId: string, values: Partial<EmailAccount>): Promise<EmailAccount>;
  deleteAccount(userId: string, accountId: string): Promise<void>;
  saveCredentials(input: CredentialsInput): Promise<void>;
  getCredentials(userId: string, accountId: string): Promise<StoredCredentials | null>;
  deleteCredentials(userId: string, accountId: string): Promise<void>;

  // Threads
  upsertThread(input: NewThreadInput): Promise<EmailThread>;
  getThread(userId: string, threadId: string): Promise<EmailThread | null>;
  updateThread(
    userId: string,
    threadId: string,
    values: { thread_state: ThreadState; changes_detected: DetectedChange[]; authoritative_email_id: string | null; message_count?: number; last_message_at?: string | null },
  ): Promise<void>;
  listThreadPriorAnalyses(userId: string, threadId: string, excludeEmailId: string): Promise<PriorAnalysis[]>;

  // Emails
  upsertEmail(input: NewEmailInput): Promise<Email>;
  getEmail(userId: string, emailId: string): Promise<Email | null>;
  updateEmail(userId: string, emailId: string, values: Partial<Email>): Promise<void>;
  listInbox(query: InboxQuery): Promise<InboxPage>;
  countEmails(userId: string): Promise<number>;
  getUpcomingDeadlines(userId: string, days: number, limit: number): Promise<DeadlineItem[]>;

  // Analysis
  getAnalysis(userId: string, emailId: string): Promise<EmailAnalysis | null>;
  upsertAnalysis(input: NewAnalysisInput): Promise<EmailAnalysis>;
  insertAnalysisHistory(input: HistoryInput): Promise<void>;
  listAnalysisHistory(userId: string, emailId: string): Promise<Array<{ id: string; created_at: string; snapshot: unknown; change_summary: DetectedChange[] }>>;

  // Extracted actions
  upsertEmailActions(inputs: NewActionInput[]): Promise<EmailActionRow[]>;
  listEmailActions(userId: string, emailId: string): Promise<EmailActionRow[]>;
  updateEmailAction(userId: string, actionId: string, values: Partial<EmailActionRow>): Promise<void>;

  // Tasks
  createTask(input: NewTaskInput): Promise<Task>;
  getTask(userId: string, taskId: string): Promise<Task | null>;
  updateTask(userId: string, taskId: string, values: Partial<Task>): Promise<Task>;
  deleteTask(userId: string, taskId: string): Promise<void>;
  listTasks(query: TaskQuery): Promise<TaskPage>;
  findDuplicateCandidates(query: DuplicateCandidateQuery): Promise<Array<{
    id: string;
    title: string;
    source_email_id: string | null;
    source_thread_id: string | null;
    status: string;
    due_date: string | null;
    priority: EmailPriority;
  }>>;

  // Notifications
  createNotification(input: NewNotificationInput): Promise<AppNotification | null>;
  listNotifications(userId: string, options: { unreadOnly?: boolean; limit?: number }): Promise<AppNotification[]>;
  setNotificationRead(userId: string, notificationId: string, read: boolean): Promise<void>;
  markAllNotificationsRead(userId: string): Promise<number>;
  deleteNotification(userId: string, notificationId: string): Promise<void>;

  // Agent telemetry
  createRun(input: NewRunInput): Promise<AgentRun>;
  updateRun(userId: string, runId: string, values: Partial<AgentRun>): Promise<void>;
  logAgentAction(input: NewAgentActionInput): Promise<void>;
  listAgentActions(userId: string, options: { limit?: number; emailId?: string | null; runId?: string | null }): Promise<AgentAction[]>;
  listAgentRuns(userId: string, limit: number): Promise<AgentRun[]>;

  // Integration telemetry
  logIntegrationEvent(input: NewIntegrationEventInput): Promise<void>;
  listIntegrationEvents(userId: string, limit: number): Promise<IntegrationEvent[]>;
  resolveIntegrationEvents(userId: string, accountId: string): Promise<void>;

  // Analytics
  dashboardCounters(userId: string): Promise<DashboardCounters>;
  dailyAnalytics(userId: string, days: number): Promise<DailyAnalytics[]>;
  agentHealth(userId: string, days: number): Promise<AgentHealth[]>;

  // Lifecycle
  deleteAllUserData(userId: string): Promise<Record<string, number>>;

  /**
   * User ids that have at least one connected mailbox, for scheduled sync.
   * Server/service-role only — never exposed through a user-scoped surface.
   */
  listCronCandidates(limit: number): Promise<string[]>;
}

/** Convenience: build the `ProposedTask` payload stored on an analysis row. */
export type { ProposedTask };
