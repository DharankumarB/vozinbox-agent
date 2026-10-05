import { z } from 'zod';
import { jsonOk, parseJson, withUser } from '@/lib/api';
import { getStore } from '@/lib/store';
import { EMAIL_PRIORITIES, TASK_STATUSES } from '@/lib/types/domain';
import { AppError } from '@/lib/errors';

type Params = { id: string };

const patchSchema = z.object({
  title: z.string().min(2).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(EMAIL_PRIORITIES).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  dueTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
  reminderAt: z.string().datetime().nullable().optional(),
});

export const PATCH = withUser<Params>(
  async ({ auth, params, request }) => {
    const body = await parseJson(request, patchSchema);
    const store = await getStore();
    const existing = await store.getTask(auth.id, params.id);
    if (!existing) {
      throw new AppError('NOT_FOUND', { message: 'Task not found', userMessage: 'That task no longer exists.' });
    }

    const patch: Record<string, unknown> = {};
    if (body.title !== undefined) patch.title = body.title.trim();
    if (body.description !== undefined) patch.description = body.description;
    if (body.priority !== undefined) patch.priority = body.priority;
    if (body.dueDate !== undefined) patch.due_date = body.dueDate;
    if (body.dueTime !== undefined) patch.due_time = body.dueTime;
    if (body.reminderAt !== undefined) patch.reminder_at = body.reminderAt;
    if (body.status !== undefined) {
      patch.status = body.status;
      if (body.status === 'COMPLETED') {
        patch.completed_at = new Date().toISOString();
        patch.dismissed_at = null;
      } else if (body.status === 'DISMISSED') {
        patch.dismissed_at = new Date().toISOString();
      } else {
        patch.completed_at = null;
        patch.dismissed_at = null;
      }
    }

    const task = await store.updateTask(auth.id, params.id, patch);

    if (body.status === 'COMPLETED') {
      await store.createNotification({
        user_id: auth.id,
        type: 'TASK_COMPLETED',
        title: 'Task completed',
        message: task.title,
        priority: 'NONE',
        entity_type: 'task',
        related_entity_id: task.id,
        action_url: '/tasks',
        metadata: {},
        dedupe_key: `task-completed:${task.id}`,
      });
    }

    return jsonOk({ task });
  },
  { rateLimit: 'taskMutation' },
);

export const DELETE = withUser<Params>(
  async ({ auth, params }) => {
    const store = await getStore();
    await store.deleteTask(auth.id, params.id);
    return jsonOk({ deleted: true });
  },
  { rateLimit: 'taskMutation' },
);

export const runtime = 'nodejs';
