import 'server-only';

import { z } from 'zod';
import { AppError, toAppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import type { Store } from '@/lib/store/types';
import type { Email, EmailAnalysis, Task } from '@/lib/types/database';
import type { EmailPriority, TaskStatus } from '@/lib/types/domain';
import { buildDedupeKey, checkDuplicate } from '@/lib/analysis/dedupe';
import type { ToolDefinition } from './provider';
import { wrapUntrusted } from './guardrails';

/**
 * Controlled tool surface for the assistant (§20).
 *
 * Every tool is:
 *  • scoped to the calling user — the handlers receive `userId` and pass it to
 *    every store call, so cross-user access is structurally impossible;
 *  • side-effect limited — write tools are enumerated and produce reversible,
 *    in-app changes only. Nothing sends, deletes or forwards email (§23, §43);
 *  • bounded — results are capped so a single call cannot stream a whole mailbox
 *    into the model context.
 */

export interface ToolContext {
  store: Store;
  userId: string;
  timezone: string;
  /** Rounds of tool calling already consumed in this conversation. */
  depth: number;
  maxDepth: number;
}

export interface ToolExecution {
  ok: boolean;
  /** JSON-serialisable payload handed back to the model. */
  result: unknown;
  /** Human-facing summary used in the activity log. */
  summary: string;
}

interface ToolSpec {
  definition: ToolDefinition;
  schema: z.ZodTypeAny;
  mutating: boolean;
  handler: (args: unknown, context: ToolContext) => Promise<ToolExecution>;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function requireStore(context: ToolContext): Store {
  return context.store;
}

function shortEmail(email: Email): Record<string, unknown> {
  return {
    id: email.id,
    subject: email.subject,
    from: email.sender_name ?? email.sender_email,
    received_at: email.received_at,
    is_read: email.is_read,
    snippet: (email.snippet ?? '').slice(0, 240),
  };
}

function analysedEmail(email: Email, analysis: EmailAnalysis | null): Record<string, unknown> {
  return {
    ...shortEmail(email),
    analysis: analysis
      ? {
          category: analysis.category,
          priority: analysis.priority,
          action_required: analysis.action_required,
          summary: analysis.summary,
          suggested_action: analysis.suggested_action,
          deadline: analysis.detected_deadline,
          needs_review: analysis.needs_review,
          confidence: analysis.overall_confidence,
        }
      : null,
  };
}

function taskView(task: Task): Record<string, unknown> {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    category: task.category,
    due_date: task.due_date,
    due_time: task.due_time,
    source_email_id: task.source_email_id,
  };
}

async function loadEmail(store: Store, userId: string, emailId: string): Promise<Email> {
  const email = await store.getEmail(userId, emailId);
  if (!email) {
    throw new AppError('NOT_FOUND', {
      message: 'Email not found for this user',
      userMessage: 'That email could not be found in your inbox.',
    });
  }
  return email;
}

// ── Tool implementations ─────────────────────────────────────────────────────

const getEmailsArgs = z.object({
  filter: z
    .enum(['ALL', 'UNREAD', 'ACTION_REQUIRED', 'HIGH_PRIORITY', 'DEADLINES'])
    .default('ALL'),
  limit: z.number().int().min(1).max(25).default(10),
  since_days: z.number().int().min(1).max(90).optional(),
});

const searchArgs = z.object({
  query: z.string().min(1).max(200),
  limit: z.number().int().min(1).max(25).default(10),
});

const emailIdArgs = z.object({ email_id: z.string().min(1).max(64) });
const threadArgs = z.object({ thread_id: z.string().min(1).max(64) });

const createTaskArgs = z.object({
  title: z.string().min(3).max(200),
  description: z.string().max(1000).optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  due_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
  priority: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'NONE']).default('MEDIUM'),
  source_email_id: z.string().max(64).nullable().optional(),
});

const updateTaskArgs = z.object({
  task_id: z.string().min(1).max(64),
  title: z.string().min(3).max(200).optional(),
  status: z.enum(['SUGGESTED', 'TODO', 'IN_PROGRESS', 'COMPLETED', 'DISMISSED']).optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  due_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
  priority: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'NONE']).optional(),
});

const taskIdArgs = z.object({ task_id: z.string().min(1).max(64) });

const listTasksArgs = z.object({
  status: z.enum(['ALL', 'SUGGESTED', 'TODO', 'IN_PROGRESS', 'COMPLETED', 'DISMISSED']).default('ALL'),
  limit: z.number().int().min(1).max(25).default(10),
});

const createNotificationArgs = z.object({
  title: z.string().min(3).max(140),
  message: z.string().max(400).optional(),
  related_email_id: z.string().max(64).nullable().optional(),
});

const markReadArgs = z.object({
  email_id: z.string().min(1).max(64),
  read: z.boolean().default(true),
});

const listNotificationsArgs = z.object({
  unread_only: z.boolean().default(false),
  limit: z.number().int().min(1).max(25).default(10),
});

const updatePreferencesArgs = z.object({
  auto_analyze_new_emails: z.boolean().optional(),
  auto_suggest_tasks: z.boolean().optional(),
  deadline_detection_enabled: z.boolean().optional(),
  priority_detection_enabled: z.boolean().optional(),
  summary_length: z.enum(['SHORT', 'NORMAL', 'DETAILED']).optional(),
  confidence_threshold: z.number().min(0).max(1).optional(),
  notify_important_email: z.boolean().optional(),
  notify_deadline: z.boolean().optional(),
  notify_task_suggestion: z.boolean().optional(),
  notify_meeting: z.boolean().optional(),
  notify_project: z.boolean().optional(),
  notify_information: z.boolean().optional(),
});

const TOOLS: Record<string, ToolSpec> = {
  get_emails: {
    mutating: false,
    schema: getEmailsArgs,
    definition: {
      type: 'function',
      function: {
        name: 'get_emails',
        description:
          'List the most recent emails in the user\'s inbox with their AI analysis. Use for questions like "what needs my attention" or "summarise today".',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            filter: {
              type: 'string',
              enum: ['ALL', 'UNREAD', 'ACTION_REQUIRED', 'HIGH_PRIORITY', 'DEADLINES'],
              description: 'Which slice of the inbox to return.',
            },
            limit: { type: 'integer', minimum: 1, maximum: 25 },
            since_days: { type: 'integer', minimum: 1, maximum: 90, description: 'Only emails received in the last N days.' },
          },
          required: ['filter', 'limit'],
        },
      },
    },
    handler: async (args, context) => {
      const parsed = getEmailsArgs.parse(args);
      const page = await requireStore(context).listInbox({
        userId: context.userId,
        filter: parsed.filter,
        limit: parsed.limit,
        sort: parsed.filter === 'HIGH_PRIORITY' ? 'HIGHEST_PRIORITY' : 'NEWEST',
      });
      const items = page.items
        .filter((item) =>
          parsed.since_days
            ? Date.parse(item.email.received_at) >= Date.now() - parsed.since_days * 86_400_000
            : true,
        )
        .map((item) => analysedEmail(item.email, item.analysis));
      return {
        ok: true,
        result: { count: items.length, total_matching: page.total, emails: items },
        summary: `Returned ${items.length} email(s) (${parsed.filter}).`,
      };
    },
  },

  get_email: {
    mutating: false,
    schema: emailIdArgs,
    definition: {
      type: 'function',
      function: {
        name: 'get_email',
        description: 'Fetch one email by id, including its full body and AI analysis.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: { email_id: { type: 'string' } },
          required: ['email_id'],
        },
      },
    },
    handler: async (args, context) => {
      const parsed = emailIdArgs.parse(args);
      const email = await loadEmail(context.store, context.userId, parsed.email_id);
      const analysis = await context.store.getAnalysis(context.userId, email.id);
      return {
        ok: true,
        result: {
          ...analysedEmail(email, analysis),
          body: wrapUntrusted('email_body', (email.body_text ?? '').slice(0, 6000)),
        },
        summary: `Fetched email "${email.subject ?? '(no subject)'}".`,
      };
    },
  },

  search_emails: {
    mutating: false,
    schema: searchArgs,
    definition: {
      type: 'function',
      function: {
        name: 'search_emails',
        description:
          'Search the inbox by keyword across subject, sender, body and analysis. Use for sender names, topics, or phrases.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 25 } },
          required: ['query', 'limit'],
        },
      },
    },
    handler: async (args, context) => {
      const parsed = searchArgs.parse(args);
      const page = await requireStore(context).listInbox({
        userId: context.userId,
        search: parsed.query,
        limit: parsed.limit,
        sort: 'NEWEST',
      });
      const items = page.items.map((item) => analysedEmail(item.email, item.analysis));
      return {
        ok: true,
        result: { query: parsed.query, count: items.length, total_matching: page.total, emails: items },
        summary: `Search "${parsed.query}" returned ${items.length} result(s).`,
      };
    },
  },

  get_email_thread: {
    mutating: false,
    schema: threadArgs,
    definition: {
      type: 'function',
      function: {
        name: 'get_email_thread',
        description: 'Fetch every message in a thread, oldest first, plus the thread\'s current understanding.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: { thread_id: { type: 'string' } },
          required: ['thread_id'],
        },
      },
    },
    handler: async (args, context) => {
      const parsed = threadArgs.parse(args);
      const thread = await context.store.getThread(context.userId, parsed.thread_id);
      if (!thread) {
        throw new AppError('NOT_FOUND', {
          message: 'Thread not found',
          userMessage: 'That email thread could not be found.',
        });
      }
      const page = await context.store.listInbox({
        userId: context.userId,
        threadId: thread.id,
        limit: 25,
        sort: 'OLDEST',
      });
      return {
        ok: true,
        result: {
          thread: {
            id: thread.id,
            subject: thread.subject,
            message_count: thread.message_count,
            state: thread.thread_state,
            changes_detected: thread.changes_detected,
          },
          messages: page.items.map((item) => analysedEmail(item.email, item.analysis)),
        },
        summary: `Returned ${page.items.length} message(s) from the thread.`,
      };
    },
  },

  classify_email: {
    mutating: false,
    schema: emailIdArgs,
    definition: {
      type: 'function',
      function: {
        name: 'classify_email',
        description: 'Return the classification already computed for an email (category, secondary labels, confidence).',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: { email_id: { type: 'string' } },
          required: ['email_id'],
        },
      },
    },
    handler: async (args, context) => {
      const parsed = emailIdArgs.parse(args);
      const email = await loadEmail(context.store, context.userId, parsed.email_id);
      const analysis = await context.store.getAnalysis(context.userId, email.id);
      return {
        ok: true,
        result: analysis
          ? {
              email_id: email.id,
              category: analysis.category,
              secondary_categories: analysis.secondary_categories,
              confidence: analysis.category_confidence,
              priority: analysis.priority,
            }
          : { email_id: email.id, category: null, note: 'This email has not been analysed yet.' },
        summary: `Classification returned for "${email.subject ?? '(no subject)'}".`,
      };
    },
  },

  extract_actions: {
    mutating: false,
    schema: emailIdArgs,
    definition: {
      type: 'function',
      function: {
        name: 'extract_actions',
        description: 'Return the actions extracted from an email, with source sentences and confidence.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: { email_id: { type: 'string' } },
          required: ['email_id'],
        },
      },
    },
    handler: async (args, context) => {
      const parsed = emailIdArgs.parse(args);
      await loadEmail(context.store, context.userId, parsed.email_id);
      const actions = await context.store.listEmailActions(context.userId, parsed.email_id);
      return {
        ok: true,
        result: {
          actions: actions.map((action) => ({
            text: action.action_text,
            type: action.action_type,
            source_sentence: action.source_sentence,
            due_date: action.due_date,
            due_time: action.due_time,
            confidence: action.confidence,
            status: action.status,
          })),
        },
        summary: `Returned ${actions.length} extracted action(s).`,
      };
    },
  },

  extract_deadlines: {
    mutating: false,
    schema: z.object({ within_days: z.number().int().min(1).max(120).default(14) }),
    definition: {
      type: 'function',
      function: {
        name: 'extract_deadlines',
        description: 'List every detected deadline within the next N days, soonest first.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: { within_days: { type: 'integer', minimum: 1, maximum: 120 } },
          required: ['within_days'],
        },
      },
    },
    handler: async (args, context) => {
      const parsed = z.object({ within_days: z.number().int().min(1).max(120).default(14) }).parse(args);
      const deadlines = await context.store.getUpcomingDeadlines(context.userId, parsed.within_days, 25);
      return {
        ok: true,
        result: {
          deadlines: deadlines.map((entry) => ({
            email_id: entry.email.id,
            subject: entry.email.subject,
            from: entry.email.sender_name ?? entry.email.sender_email,
            due_date: entry.dueDate,
            due_time: entry.dueTime,
            days_remaining: entry.daysRemaining,
            confidence: entry.analysis?.deadline_confidence ?? null,
          })),
        },
        summary: `Found ${deadlines.length} deadline(s) in the next ${parsed.within_days} days.`,
      };
    },
  },

  create_task: {
    mutating: true,
    schema: createTaskArgs,
    definition: {
      type: 'function',
      function: {
        name: 'create_task',
        description:
          'Create a task for the user. Only call when the user explicitly asks for a task to be created. Never invent a due date: omit it when the source email does not state one.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            title: { type: 'string' },
            description: { type: 'string' },
            due_date: { type: ['string', 'null'], description: 'YYYY-MM-DD, or null' },
            due_time: { type: ['string', 'null'], description: 'HH:mm (24h), or null' },
            priority: { type: 'string', enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'NONE'] },
            source_email_id: { type: ['string', 'null'] },
          },
          required: ['title', 'priority'],
        },
      },
    },
    handler: async (args, context) => {
      const parsed = createTaskArgs.parse(args);
      const email = parsed.source_email_id
        ? await context.store.getEmail(context.userId, parsed.source_email_id)
        : null;

      // Duplicate prevention applies to assistant-created tasks too (§14).
      const candidates = await context.store.findDuplicateCandidates({
        userId: context.userId,
        sourceEmailId: email?.id ?? null,
        sourceThreadId: email?.thread_id ?? null,
      });
      const decision = checkDuplicate({
        candidateTitle: parsed.title,
        candidateDueDate: parsed.due_date ?? null,
        candidateDueTime: parsed.due_time ?? null,
        candidatePriority: parsed.priority as EmailPriority,
        sourceEmailId: email?.id ?? null,
        sourceThreadId: email?.thread_id ?? null,
        existingTasks: candidates,
      });
      if (decision.duplicate && decision.existingTaskId) {
        return {
          ok: true,
          result: { created: false, existing_task_id: decision.existingTaskId, reason: decision.reason },
          summary: `Task not created — ${decision.reason}`,
        };
      }

      const task = await context.store.createTask({
        user_id: context.userId,
        title: parsed.title,
        description: parsed.description ?? null,
        source_email_id: email?.id ?? null,
        source_thread_id: email?.thread_id ?? null,
        source_action_id: null,
        category: 'OTHER',
        priority: parsed.priority as EmailPriority,
        due_date: parsed.due_date ?? null,
        due_time: parsed.due_time ?? null,
        timezone: context.timezone,
        status: 'TODO',
        origin: 'AI_SUGGESTED',
        dedupe_key: email ? buildDedupeKey(email.id, parsed.title) : null,
      });
      return {
        ok: true,
        result: { created: true, task: taskView(task) },
        summary: `Task created: ${task.title}`,
      };
    },
  },

  update_task: {
    mutating: true,
    schema: updateTaskArgs,
    definition: {
      type: 'function',
      function: {
        name: 'update_task',
        description: 'Update an existing task (title, status, due date/time, priority).',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            task_id: { type: 'string' },
            title: { type: 'string' },
            status: { type: 'string', enum: ['SUGGESTED', 'TODO', 'IN_PROGRESS', 'COMPLETED', 'DISMISSED'] },
            due_date: { type: ['string', 'null'] },
            due_time: { type: ['string', 'null'] },
            priority: { type: 'string', enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'NONE'] },
          },
          required: ['task_id'],
        },
      },
    },
    handler: async (args, context) => {
      const parsed = updateTaskArgs.parse(args);
      const existing = await context.store.getTask(context.userId, parsed.task_id);
      if (!existing) {
        throw new AppError('NOT_FOUND', { message: 'Task not found', userMessage: 'That task no longer exists.' });
      }
      const patch: Partial<Task> = {};
      if (parsed.title) patch.title = parsed.title;
      if (parsed.status) {
        patch.status = parsed.status as TaskStatus;
        if (parsed.status === 'COMPLETED') patch.completed_at = new Date().toISOString();
        if (parsed.status === 'DISMISSED') patch.dismissed_at = new Date().toISOString();
      }
      if (parsed.due_date !== undefined) patch.due_date = parsed.due_date;
      if (parsed.due_time !== undefined) patch.due_time = parsed.due_time;
      if (parsed.priority) patch.priority = parsed.priority as EmailPriority;

      const task = await context.store.updateTask(context.userId, parsed.task_id, patch);
      return { ok: true, result: { task: taskView(task) }, summary: `Task updated: ${task.title}` };
    },
  },

  dismiss_task: {
    mutating: true,
    schema: taskIdArgs,
    definition: {
      type: 'function',
      function: {
        name: 'dismiss_task',
        description: 'Dismiss a task the user does not want to act on.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: { task_id: { type: 'string' } },
          required: ['task_id'],
        },
      },
    },
    handler: async (args, context) => {
      const parsed = taskIdArgs.parse(args);
      const task = await context.store.updateTask(context.userId, parsed.task_id, {
        status: 'DISMISSED',
        dismissed_at: new Date().toISOString(),
      });
      return { ok: true, result: { task: taskView(task) }, summary: `Task dismissed: ${task.title}` };
    },
  },

  get_tasks: {
    mutating: false,
    schema: listTasksArgs,
    definition: {
      type: 'function',
      function: {
        name: 'get_tasks',
        description: 'List the user\'s tasks, optionally filtered by status.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            status: {
              type: 'string',
              enum: ['ALL', 'SUGGESTED', 'TODO', 'IN_PROGRESS', 'COMPLETED', 'DISMISSED'],
            },
            limit: { type: 'integer', minimum: 1, maximum: 25 },
          },
          required: ['status', 'limit'],
        },
      },
    },
    handler: async (args, context) => {
      const parsed = listTasksArgs.parse(args);
      const page = await context.store.listTasks({
        userId: context.userId,
        status: parsed.status === 'ALL' ? 'ALL' : (parsed.status as TaskStatus),
        limit: parsed.limit,
        sort: parsed.status === 'COMPLETED' || parsed.status === 'DISMISSED' ? 'NEWEST' : 'DUE_SOONEST',
      });
      return {
        ok: true,
        result: { count: page.items.length, total_matching: page.total, tasks: page.items.map((item) => taskView(item.task)) },
        summary: `Returned ${page.items.length} task(s).`,
      };
    },
  },

  create_notification: {
    mutating: true,
    schema: createNotificationArgs,
    definition: {
      type: 'function',
      function: {
        name: 'create_notification',
        description: 'Create an in-app notification for the user. Use sparingly — only when the user asks to be reminded.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            title: { type: 'string' },
            message: { type: 'string' },
            related_email_id: { type: ['string', 'null'] },
          },
          required: ['title'],
        },
      },
    },
    handler: async (args, context) => {
      const parsed = createNotificationArgs.parse(args);
      const notification = await context.store.createNotification({
        user_id: context.userId,
        type: 'SYSTEM',
        title: parsed.title,
        message: parsed.message ?? null,
        priority: 'MEDIUM',
        entity_type: parsed.related_email_id ? 'email' : null,
        related_entity_id: parsed.related_email_id ?? null,
        action_url: parsed.related_email_id ? `/inbox/${parsed.related_email_id}` : '/notifications',
        metadata: { source: 'assistant' },
        dedupe_key: null,
      });
      return {
        ok: true,
        result: { created: Boolean(notification) },
        summary: `Notification created: ${parsed.title}`,
      };
    },
  },

  mark_email_read: {
    mutating: true,
    schema: markReadArgs,
    definition: {
      type: 'function',
      function: {
        name: 'mark_email_read',
        description: 'Mark an email as read or unread. This does not change anything in the email provider.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: { email_id: { type: 'string' }, read: { type: 'boolean' } },
          required: ['email_id', 'read'],
        },
      },
    },
    handler: async (args, context) => {
      const parsed = markReadArgs.parse(args);
      await loadEmail(context.store, context.userId, parsed.email_id);
      await context.store.updateEmail(context.userId, parsed.email_id, { is_read: parsed.read });
      return {
        ok: true,
        result: { email_id: parsed.email_id, is_read: parsed.read },
        summary: `Email marked as ${parsed.read ? 'read' : 'unread'}.`,
      };
    },
  },

  get_notifications: {
    mutating: false,
    schema: listNotificationsArgs,
    definition: {
      type: 'function',
      function: {
        name: 'get_notifications',
        description: 'Return recent in-app notifications.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: { unread_only: { type: 'boolean' }, limit: { type: 'integer', minimum: 1, maximum: 25 } },
          required: ['limit'],
        },
      },
    },
    handler: async (args, context) => {
      const parsed = listNotificationsArgs.parse(args);
      const notifications = await context.store.listNotifications(context.userId, {
        unreadOnly: parsed.unread_only,
        limit: parsed.limit,
      });
      return {
        ok: true,
        result: {
          count: notifications.length,
          notifications: notifications.map((notification) => ({
            id: notification.id,
            type: notification.type,
            title: notification.title,
            message: notification.message,
            is_read: notification.is_read,
            created_at: notification.created_at,
          })),
        },
        summary: `Returned ${notifications.length} notification(s).`,
      };
    },
  },

  get_user_preferences: {
    mutating: false,
    schema: z.object({}),
    definition: {
      type: 'function',
      function: {
        name: 'get_user_preferences',
        description: 'Read the user\'s VozInbox settings (analysis switches, notification preferences, summary length, confidence threshold).',
        parameters: { type: 'object', additionalProperties: false, properties: {}, required: [] },
      },
    },
    handler: async (_args, context) => {
      const preferences = await context.store.getPreferences(context.userId);
      return {
        ok: true,
        result: {
          auto_analyze_new_emails: preferences.auto_analyze_new_emails,
          auto_suggest_tasks: preferences.auto_suggest_tasks,
          deadline_detection_enabled: preferences.deadline_detection_enabled,
          priority_detection_enabled: preferences.priority_detection_enabled,
          summary_length: preferences.summary_length,
          confidence_threshold: preferences.confidence_threshold,
          notify_important_email: preferences.notify_important_email,
          notify_deadline: preferences.notify_deadline,
          notify_task_suggestion: preferences.notify_task_suggestion,
          notify_meeting: preferences.notify_meeting,
          notify_project: preferences.notify_project,
          notify_information: preferences.notify_information,
        },
        summary: 'Preferences returned.',
      };
    },
  },

  update_user_preferences: {
    mutating: true,
    schema: updatePreferencesArgs,
    definition: {
      type: 'function',
      function: {
        name: 'update_user_preferences',
        description: 'Change the user\'s VozInbox settings. Only call when the user explicitly asks to change a setting.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            auto_analyze_new_emails: { type: 'boolean' },
            auto_suggest_tasks: { type: 'boolean' },
            deadline_detection_enabled: { type: 'boolean' },
            priority_detection_enabled: { type: 'boolean' },
            summary_length: { type: 'string', enum: ['SHORT', 'NORMAL', 'DETAILED'] },
            confidence_threshold: { type: 'number', minimum: 0, maximum: 1 },
            notify_important_email: { type: 'boolean' },
            notify_deadline: { type: 'boolean' },
            notify_task_suggestion: { type: 'boolean' },
            notify_meeting: { type: 'boolean' },
            notify_project: { type: 'boolean' },
            notify_information: { type: 'boolean' },
          },
          required: [],
        },
      },
    },
    handler: async (args, context) => {
      const parsed = updatePreferencesArgs.parse(args);
      const updated = await context.store.updatePreferences(context.userId, parsed);
      return {
        ok: true,
        result: {
          updated: Object.keys(parsed),
          confidence_threshold: updated.confidence_threshold,
          summary_length: updated.summary_length,
        },
        summary: `Updated ${Object.keys(parsed).length} setting(s).`,
      };
    },
  },
};

// ── Public surface ───────────────────────────────────────────────────────────

/** Tool definitions handed to the model. */
export function toolDefinitions(): ToolDefinition[] {
  return Object.values(TOOLS).map((tool) => tool.definition);
}

export function isMutatingTool(name: string): boolean {
  return TOOLS[name]?.mutating ?? false;
}

export function knownTool(name: string): boolean {
  return Boolean(TOOLS[name]);
}

/**
 * Execute a tool call. Unknown tools, malformed arguments and depth-limit
 * breaches are rejected without ever reaching the data layer (§43).
 */
export async function executeTool(
  name: string,
  rawArguments: string,
  context: ToolContext,
): Promise<ToolExecution> {
  const spec = TOOLS[name];
  if (!spec) {
    logger.warn('agent.tool_denied', { tool: name, reason: 'unknown_tool' });
    return { ok: false, result: { error: `Tool "${name}" is not available.` }, summary: `Denied unknown tool ${name}.` };
  }

  if (context.depth >= context.maxDepth) {
    logger.warn('agent.tool_denied', { tool: name, reason: 'depth_limit', depth: context.depth });
    return {
      ok: false,
      result: { error: 'Tool call limit reached for this request.' },
      summary: `Depth limit reached before calling ${name}.`,
    };
  }

  let parsedArguments: unknown;
  try {
    parsedArguments = rawArguments.trim().length === 0 ? {} : JSON.parse(rawArguments);
  } catch {
    logger.warn('agent.tool_denied', { tool: name, reason: 'malformed_arguments' });
    return {
      ok: false,
      result: { error: 'Arguments were not valid JSON. Retry with valid JSON only.' },
      summary: `Malformed arguments for ${name}.`,
    };
  }

  try {
    const result = await spec.handler(parsedArguments, context);
    logger.debug('agent.tool_called', {
      tool: name,
      userId: context.userId,
      mutating: spec.mutating,
      ok: result.ok,
    });
    return result;
  } catch (error) {
    const appError = toAppError(error, 'INTERNAL');
    logger.warn('agent.tool_failed', { tool: name, code: appError.code, detail: appError.message });
    return {
      ok: false,
      result: { error: appError.userMessage },
      summary: `${name} failed: ${appError.userMessage}`,
    };
  }
}
