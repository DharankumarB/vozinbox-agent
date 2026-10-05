import type {
  AgentActionType,
  AgentRunStatus,
  AnalysisSource,
  DetectedChange,
  DetectedDate,
  DetectedDeadline,
  DetectedAttachment,
  DetectedLink,
  DetectedOrganization,
  DetectedPerson,
  EmailAnalysisState,
  EmailCategory,
  EmailPriority,
  IntegrationProvider,
  IntegrationStatus,
  NotificationType,
  ProposedTask,
  SummaryLength,
  TaskStatus,
} from './domain';

/** Plain row shapes for the Supabase tables in `supabase/migrations`. */

export interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  timezone: string;
  onboarding_state: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface UserPreferences {
  user_id: string;
  auto_analyze_new_emails: boolean;
  auto_suggest_tasks: boolean;
  deadline_detection_enabled: boolean;
  priority_detection_enabled: boolean;
  summary_length: SummaryLength;
  confidence_threshold: number;
  notify_important_email: boolean;
  notify_deadline: boolean;
  notify_task_suggestion: boolean;
  notify_meeting: boolean;
  notify_project: boolean;
  notify_information: boolean;
  sync_interval_minutes: number;
  important_senders: string[];
  ignored_senders: string[];
  created_at: string;
  updated_at: string;
}

export interface EmailAccount {
  id: string;
  user_id: string;
  provider: IntegrationProvider;
  provider_account_id: string;
  email_address: string;
  display_name: string | null;
  status: IntegrationStatus;
  scopes: string[];
  last_sync_at: string | null;
  last_sync_status: string | null;
  last_sync_error: string | null;
  last_history_id: string | null;
  sync_cursor: Record<string, unknown>;
  watch_expiration: string | null;
  connected_at: string | null;
  disconnected_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface EmailThread {
  id: string;
  user_id: string;
  account_id: string;
  provider: IntegrationProvider;
  provider_thread_id: string;
  subject: string | null;
  participants: Array<{ name: string | null; email: string | null }>;
  message_count: number;
  last_message_at: string | null;
  latest_message_id: string | null;
  authoritative_email_id: string | null;
  thread_state: ThreadState;
  changes_detected: DetectedChange[];
  created_at: string;
  updated_at: string;
}

export interface ThreadState {
  deadline?: DetectedDeadline | null;
  action_required?: boolean;
  suggested_action?: string | null;
  category?: EmailCategory;
  priority?: EmailPriority;
  meeting?: { date: string | null; time: string | null; location: string | null } | null;
  cancelled?: boolean;
  updated_from_email_id?: string;
  updated_at?: string;
}

export interface Email {
  id: string;
  user_id: string;
  account_id: string;
  thread_id: string | null;
  provider: IntegrationProvider;
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
  is_archived: boolean;
  has_attachments: boolean;
  attachments: DetectedAttachment[];
  labels: string[];
  headers: Record<string, string>;
  size_estimate: number | null;
  analysis_state: EmailAnalysisState;
  analyzed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface EmailAnalysis {
  id: string;
  user_id: string;
  email_id: string;
  thread_id: string | null;
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
  category_confidence: number;
  action_confidence: number;
  deadline_confidence: number;
  priority_confidence: number;
  overall_confidence: number;
  needs_review: boolean;
  review_reason: string | null;
  model_name: string | null;
  analysis_source: AnalysisSource;
  analysis_version: string;
  grounding_report: Record<string, unknown>;
  injection_flagged: boolean;
  injection_signals: string[];
  raw_output: unknown;
  created_at: string;
  updated_at: string;
}

export interface EmailActionRow {
  id: string;
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
  status: 'OPEN' | 'TASK_CREATED' | 'DISMISSED' | 'COMPLETED';
  task_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: string;
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
  origin: 'AI_SUGGESTED' | 'USER' | 'IMPORTED';
  dedupe_key: string | null;
  embedding: unknown;
  reminder_at: string | null;
  reminder_sent_at: string | null;
  completed_at: string | null;
  dismissed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AppNotification {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  message: string | null;
  priority: EmailPriority;
  is_read: boolean;
  read_at: string | null;
  entity_type: string | null;
  related_entity_id: string | null;
  action_url: string | null;
  metadata: Record<string, unknown>;
  dedupe_key: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgentRun {
  id: string;
  user_id: string;
  trigger: 'SYNC' | 'MANUAL' | 'REPROCESS' | 'CHAT' | 'CRON' | 'REALTIME';
  email_id: string | null;
  thread_id: string | null;
  status: AgentRunStatus;
  current_step: string | null;
  steps_completed: string[];
  tool_depth: number;
  max_tool_depth: number;
  tool_calls: number;
  analysis_source: AnalysisSource | null;
  model_name: string | null;
  confidence: number | null;
  error_code: string | null;
  error_message: string | null;
  duration_ms: number | null;
  started_at: string;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgentAction {
  id: string;
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
  created_at: string;
}

export interface IntegrationEvent {
  id: string;
  user_id: string;
  account_id: string | null;
  provider: IntegrationProvider;
  event_type: string;
  severity: 'info' | 'warning' | 'error';
  message: string | null;
  context: Record<string, unknown>;
  resolved: boolean;
  created_at: string;
}

/** Inbox row = email + its analysis, joined for list rendering (§7). */
export interface InboxItem {
  email: Email;
  analysis: EmailAnalysis | null;
  source_task: Pick<Task, 'id' | 'title' | 'status'> | null;
}

export type {
  EmailCategory,
  EmailPriority,
  TaskStatus,
  NotificationType,
  IntegrationProvider,
  IntegrationStatus,
  AgentRunStatus,
  AgentActionType,
};
