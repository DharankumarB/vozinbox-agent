import { z } from 'zod';
import { intQuery, jsonOk, optionalQuery, parseJson, withUser } from '@/lib/api';
import { getStore } from '@/lib/store';
import { buildDedupeKey, checkDuplicate } from '@/lib/analysis/dedupe';
import { EMAIL_CATEGORIES, EMAIL_PRIORITIES, TASK_STATUSES } from '@/lib/types/domain';
import { AppError } from '@/lib/errors';

export const GET = withUser(async ({ auth, request }) => {
  const store = await getStore();
  const status = optionalQuery(request, 'status');
  const priority = optionalQuery(request, 'priority');
  const search = optionalQuery(request, 'q');
  const sortParam = optionalQuery(request, 'sort');

  const page = await store.listTasks({
    userId: auth.id,
    status: status && status !== 'ALL' ? z.enum(TASK_STATUSES).catch('TODO').parse(status) : 'ALL',
    priority: priority ? z.enum(EMAIL_PRIORITIES).catch('MEDIUM').parse(priority) : null,
    search,
    sort:
      sortParam === 'DUE_SOONEST' || sortParam === 'NEWEST' || sortParam === 'PRIORITY' || sortParam === 'STATUS'
        ? sortParam
        : 'DUE_SOONEST',
    limit: intQuery(request, 'limit', 50),
    offset: intQuery(request, 'offset', 0),
  });

  return jsonOk(page);
});

const createSchema = z.object({
  title: z.string().min(2).max(200),
  description: z.string().max(2000).nullable().optional(),
  sourceEmailId: z.string().max(64).nullable().optional(),
  category: z.enum(EMAIL_CATEGORIES).default('OTHER'),
  priority: z.enum(EMAIL_PRIORITIES).default('MEDIUM'),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  dueTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
  status: z.enum(TASK_STATUSES).default('TODO'),
  createReminder: z.boolean().default(false),
});

export const POST = withUser(
  async ({ auth, request }) => {
    const input = await parseJson(request, createSchema);
    const store = await getStore();

    let threadId: string | null = null;
    if (input.sourceEmailId) {
      const email = await store.getEmail(auth.id, input.sourceEmailId);
      if (!email) {
        throw new AppError('NOT_FOUND', { message: 'Source email not found', userMessage: 'That email could not be found.' });
      }
      threadId = email.thread_id;
    }

    // Duplicate prevention applies to user-created tasks too (§14) — the user is
    // warned rather than silently getting a second identical task.
    const candidates = await store.findDuplicateCandidates({
      userId: auth.id,
      sourceEmailId: input.sourceEmailId ?? null,
      sourceThreadId: threadId,
    });
    const decision = checkDuplicate({
      candidateTitle: input.title,
      candidateDueDate: input.dueDate ?? null,
      candidateDueTime: input.dueTime ?? null,
      candidatePriority: input.priority,
      sourceEmailId: input.sourceEmailId ?? null,
      sourceThreadId: threadId,
      existingTasks: candidates,
    });

    if (decision.duplicate && decision.existingTaskId && !decision.enrich) {
      return jsonOk({ created: false, duplicateOf: decision.existingTaskId, reason: decision.reason });
    }

    if (decision.duplicate && decision.enrich && decision.existingTaskId) {
      const updated = await store.updateTask(auth.id, decision.existingTaskId, {
        due_date: input.dueDate ?? null,
        due_time: input.dueTime ?? null,
        priority: input.priority,
      });
      return jsonOk({ created: false, updated: true, task: updated, reason: decision.reason });
    }

    const task = await store.createTask({
      user_id: auth.id,
      title: input.title.trim(),
      description: input.description ?? null,
      source_email_id: input.sourceEmailId ?? null,
      source_thread_id: threadId,
      source_action_id: null,
      category: input.category,
      priority: input.priority,
      due_date: input.dueDate ?? null,
      due_time: input.dueTime ?? null,
      timezone: auth.timezone,
      status: input.status,
      origin: 'USER',
      dedupe_key: input.sourceEmailId ? buildDedupeKey(input.sourceEmailId, input.title) : null,
      reminder_at: input.createReminder && input.dueDate ? `${input.dueDate}T${input.dueTime ?? '09:00'}:00` : null,
    });

    return jsonOk({ created: true, task });
  },
  { rateLimit: 'taskMutation' },
);

export const runtime = 'nodejs';
