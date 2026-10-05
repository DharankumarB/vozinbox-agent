/**
 * Domain vocabulary for VozInbox Agent.
 *
 * These string unions mirror the Postgres enums in
 * `supabase/migrations/0001_extensions_and_types.sql` — keep them in sync.
 * Adding a new value is a two-step change: append here and `ALTER TYPE ... ADD VALUE`.
 */

// ── Categories (§9) ──────────────────────────────────────────────────────────
export const EMAIL_CATEGORIES = [
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
  'OTHER',
] as const;
export type EmailCategory = (typeof EMAIL_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<EmailCategory, string> = {
  ACTION_REQUIRED: 'Action Required',
  ASSIGNMENT: 'Assignment',
  DEADLINE: 'Deadline',
  MEETING: 'Meeting',
  EVENT: 'Event',
  PROJECT: 'Project',
  WORK: 'Work',
  COLLEGE: 'College',
  PERSONAL: 'Personal',
  FINANCE: 'Finance',
  INFORMATION: 'Information',
  PROMOTIONAL: 'Promotional',
  SPAM: 'Spam',
  OTHER: 'Other',
};

// ── Priority (§10) ───────────────────────────────────────────────────────────
export const EMAIL_PRIORITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'NONE'] as const;
export type EmailPriority = (typeof EMAIL_PRIORITIES)[number];

/** Ordering weight — higher means more urgent. */
export const PRIORITY_WEIGHT: Record<EmailPriority, number> = {
  CRITICAL: 5,
  HIGH: 4,
  MEDIUM: 3,
  LOW: 2,
  NONE: 1,
};

export const PRIORITY_LABELS: Record<EmailPriority, string> = {
  CRITICAL: 'Critical',
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
  NONE: 'None',
};

// ── Tasks (§13) ──────────────────────────────────────────────────────────────
export const TASK_STATUSES = ['SUGGESTED', 'TODO', 'IN_PROGRESS', 'COMPLETED', 'DISMISSED'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  SUGGESTED: 'Suggested',
  TODO: 'To do',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  DISMISSED: 'Dismissed',
};

export const OPEN_TASK_STATUSES: TaskStatus[] = ['SUGGESTED', 'TODO', 'IN_PROGRESS'];

// ── Notifications (§17) ──────────────────────────────────────────────────────
export const NOTIFICATION_TYPES = [
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
  'SYSTEM',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  IMPORTANT_EMAIL: 'Important email',
  TASK_SUGGESTION: 'Task suggestion',
  DEADLINE_DETECTED: 'Deadline detected',
  DEADLINE_APPROACHING: 'Deadline approaching',
  DEADLINE_CHANGED: 'Deadline changed',
  MEETING_REMINDER: 'Meeting reminder',
  MEETING_CHANGED: 'Meeting changed',
  TASK_CREATED: 'Task created',
  TASK_COMPLETED: 'Task completed',
  AI_PROCESSING_COMPLETED: 'AI processing',
  AI_NEEDS_REVIEW: 'Needs review',
  INFORMATION_CHANGED: 'Information changed',
  INTEGRATION_ISSUE: 'Integration issue',
  INTEGRATION_CONNECTED: 'Integration connected',
  AGENT_ERROR: 'Agent error',
  SYSTEM: 'System',
};

// ── Agent runs / actions (§21, §38) ──────────────────────────────────────────
export const AGENT_RUN_STATUSES = [
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'SKIPPED',
  'NEEDS_REVIEW',
] as const;
export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];

export const AGENT_ACTION_TYPES = [
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
  'SYNC_FAILED',
] as const;
export type AgentActionType = (typeof AGENT_ACTION_TYPES)[number];

// ── Integrations (§24, §25) ──────────────────────────────────────────────────
export const INTEGRATION_PROVIDERS = ['gmail', 'outlook'] as const;
export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number];

export const INTEGRATION_STATUSES = [
  'CONNECTED',
  'DISCONNECTED',
  'ERROR',
  'REVOKED',
  'PENDING',
] as const;
export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number];

export type AnalysisSource = 'AI_PROVIDER' | 'RULES_ENGINE' | 'MANUAL';

export const ANALYSIS_SOURCE_LABELS: Record<AnalysisSource, string> = {
  AI_PROVIDER: 'AI provider',
  RULES_ENGINE: 'Rules engine',
  MANUAL: 'Manual',
};

export type EmailAnalysisState = 'PENDING' | 'ANALYZING' | 'ANALYZED' | 'FAILED' | 'SKIPPED';

// ── Structured extraction shapes (§12, §33) ──────────────────────────────────
export type DeadlineType = 'EXPLICIT' | 'RELATIVE' | 'INFERRED' | 'UNKNOWN';

export interface DetectedDeadline {
  /** ISO date (YYYY-MM-DD) in the user's timezone. */
  date: string | null;
  /** 24h time (HH:mm). `null` when the email never states a time — never invented. */
  time: string | null;
  /** IANA timezone, only when explicitly stated in the message. */
  timezone: string | null;
  type: DeadlineType;
  /** Verbatim sentence the deadline was derived from. */
  source_sentence: string | null;
  confidence: number;
}

export interface DetectedDate extends DetectedDeadline {
  /** Free-form description of what the date refers to ("assignment due", "meeting"). */
  label: string | null;
}

export interface DetectedPerson {
  name: string;
  email: string | null;
  role: string | null;
}

export interface DetectedOrganization {
  name: string;
  confidence: number;
}

export interface DetectedLink {
  url: string;
  label: string | null;
}

export interface DetectedAttachment {
  filename: string;
  mime_type: string | null;
  size_bytes: number | null;
  attachment_id: string | null;
}

export interface ProposedTask {
  title: string;
  description: string | null;
  due_date: string | null;
  due_time: string | null;
  priority: EmailPriority;
  category: EmailCategory;
}

export interface ConfidenceScores {
  category: number;
  action: number;
  deadline: number;
  priority: number;
  overall: number;
}

/** Normalised analysis record produced by the pipeline. */
export interface EmailAnalysisResult {
  category: EmailCategory;
  secondary_categories: EmailCategory[];
  summary: string | null;
  action_required: boolean;
  priority: EmailPriority;
  priority_reason: string | null;
  priority_score: number | null;
  detected_dates: DetectedDate[];
  detected_deadline: DetectedDeadline | null;
  detected_people: DetectedPerson[];
  detected_organizations: DetectedOrganization[];
  detected_links: DetectedLink[];
  detected_attachments: DetectedAttachment[];
  suggested_action: string | null;
  suggested_task: ProposedTask | null;
  confidence: ConfidenceScores;
  needs_review: boolean;
  review_reason: string | null;
  model_name: string;
  analysis_source: AnalysisSource;
  analysis_version: string;
  grounding_report: GroundingReport;
  injection_flagged: boolean;
  injection_signals: string[];
  raw_output?: unknown;
}

/** Result of verifying that every extracted claim is traceable to source text (§2, §43). */
export interface GroundingReport {
  checked: boolean;
  unsupported: string[];
  dropped_count: number;
  notes: string[];
}

// ── Thread change detection (§16) ────────────────────────────────────────────
export const CHANGE_TYPES = [
  'DEADLINE_CHANGED',
  'MEETING_TIME_CHANGED',
  'MEETING_CANCELLED',
  'LOCATION_CHANGED',
  'INSTRUCTIONS_CHANGED',
  'SUBMISSION_METHOD_CHANGED',
  'EVENT_CANCELLED',
  'ATTACHMENT_ADDED',
  'ACTION_ADDED',
  'PRIORITY_INCREASED',
] as const;
export type ChangeType = (typeof CHANGE_TYPES)[number];

export interface DetectedChange {
  type: ChangeType;
  previous: string | null;
  current: string | null;
  description: string;
  detected_at: string;
  email_id: string;
}

// ── Inbox query surface (§18, §47, §48) ──────────────────────────────────────
export const INBOX_FILTERS = [
  'ALL',
  'UNREAD',
  'ACTION_REQUIRED',
  'HIGH_PRIORITY',
  'DEADLINES',
  'ASSIGNMENT',
  'MEETING',
  'PROJECT',
  'PERSONAL',
  'INFORMATION',
  'PROMOTIONAL',
  'SPAM',
] as const;
export type InboxFilter = (typeof INBOX_FILTERS)[number];

export const INBOX_SORTS = [
  'NEWEST',
  'OLDEST',
  'HIGHEST_PRIORITY',
  'DEADLINE_SOONEST',
  'UNREAD_FIRST',
  'ACTION_REQUIRED_FIRST',
] as const;
export type InboxSort = (typeof INBOX_SORTS)[number];

export const SORT_LABELS: Record<InboxSort, string> = {
  NEWEST: 'Newest',
  OLDEST: 'Oldest',
  HIGHEST_PRIORITY: 'Highest priority',
  DEADLINE_SOONEST: 'Deadline soonest',
  UNREAD_FIRST: 'Unread first',
  ACTION_REQUIRED_FIRST: 'Action required first',
};

export const SUMMARY_LENGTHS = ['SHORT', 'NORMAL', 'DETAILED'] as const;
export type SummaryLength = (typeof SUMMARY_LENGTHS)[number];
