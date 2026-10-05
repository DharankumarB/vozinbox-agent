'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { BellPlus, Check, ListPlus, Pencil, X } from 'lucide-react';
import type { EmailAnalysis } from '@/lib/types/database';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { PriorityBadge, StatusBadge } from '@/components/ui/Badge';
import { useToast } from '@/components/ui/Toast';
import { PRIORITY_META, cn, shortDate, timeLabel } from '@/lib/utils';
import type { EmailPriority, TaskStatus } from '@/lib/types/domain';

/**
 * AI SUGGESTED TASK (§13).
 *
 * Nothing irreversible happens without a click: create, edit, dismiss, or
 * "create & remind" all go through explicit user actions.
 */
export function SuggestedTaskCard({
  analysis,
  task,
  emailId,
}: {
  analysis: EmailAnalysis;
  task: { id: string; title: string; status: TaskStatus; due_date: string | null; due_time: string | null; priority: EmailPriority } | null;
  emailId: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState({
    title: task?.title ?? analysis.suggested_task?.title ?? analysis.suggested_action ?? '',
    dueDate: task?.due_date ?? analysis.suggested_task?.due_date ?? '',
    dueTime: task?.due_time ?? analysis.suggested_task?.due_time ?? '',
    priority: (task?.priority ?? analysis.suggested_task?.priority ?? analysis.priority) as EmailPriority,
  });

  const suggested = analysis.suggested_task;
  if (!analysis.action_required || (!suggested && !task)) return null;

  const act = async (path: string, body: Record<string, unknown>, method: 'POST' | 'PATCH') => {
    setBusy(true);
    try {
      const response = await fetch(path, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as
        | { ok: true; data: Record<string, unknown> }
        | { ok: false; error: { message: string } };
      if (!payload.ok) {
        toast.push(payload.error.message, 'error');
        return false;
      }
      router.refresh();
      return true;
    } catch {
      toast.push('Unable to complete this action. Please try again.', 'error');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const createdTaskId = (payload: { task?: { id?: string }; duplicateOf?: string } | undefined) =>
    payload?.task?.id ?? payload?.duplicateOf ?? null;

  const handleCreate = async (withReminder: boolean) => {
    if (task) {
      // Already tracked — promote from suggestion to an active to-do.
      const ok = await act(`/api/tasks/${task.id}`, { status: 'TODO' }, 'PATCH');
      if (ok) toast.push('Task is now on your list.', 'success');
      return;
    }
    const response = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: form.title,
        description: analysis.summary,
        sourceEmailId: emailId,
        category: analysis.category,
        priority: form.priority,
        dueDate: form.dueDate || null,
        dueTime: form.dueTime || null,
        status: 'TODO',
        createReminder: withReminder,
      }),
    });
    const payload = (await response.json()) as
      | { ok: true; data: { created?: boolean; task?: { id: string }; duplicateOf?: string; reason?: string } }
      | { ok: false; error: { message: string } };
    setBusy(false);
    if (!payload.ok) {
      toast.push(payload.error.message, 'error');
      return;
    }
    if (payload.data.created === false && payload.data.reason) {
      toast.push(payload.data.reason, 'info');
    } else {
      toast.push(withReminder ? 'Task created with a reminder.' : 'Task created.', 'success');
    }
    void createdTaskId(payload.data);
    router.refresh();
  };

  const handleDismiss = async () => {
    if (!task) {
      toast.push('Dismissed. The suggestion stays on the email for reference.', 'info');
      return;
    }
    const ok = await act(`/api/tasks/${task.id}`, { status: 'DISMISSED' }, 'PATCH');
    if (ok) toast.push('Suggestion dismissed.', 'success');
  };

  const handleSaveEdit = async () => {
    if (task) {
      const ok = await act(
        `/api/tasks/${task.id}`,
        {
          title: form.title,
          dueDate: form.dueDate || null,
          dueTime: form.dueTime || null,
          priority: form.priority,
          status: 'TODO',
        },
        'PATCH',
      );
      if (ok) {
        toast.push('Task updated.', 'success');
        setEditOpen(false);
      }
      return;
    }
    setBusy(true);
    const response = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: form.title,
        description: analysis.summary,
        sourceEmailId: emailId,
        category: analysis.category,
        priority: form.priority,
        dueDate: form.dueDate || null,
        dueTime: form.dueTime || null,
        status: 'TODO',
      }),
    });
    const payload = (await response.json()) as
      | { ok: true; data: Record<string, unknown> }
      | { ok: false; error: { message: string } };
    setBusy(false);
    if (!payload.ok) {
      toast.push(payload.error.message, 'error');
      return;
    }
    toast.push('Task created from your edits.', 'success');
    setEditOpen(false);
    router.refresh();
  };

  const confidence = analysis.action_confidence;
  const belowThreshold = confidence < 0.9;

  return (
    <section
      aria-label="AI suggested task"
      className="rounded-2xl border border-violet-400/25 bg-violet-500/[0.07] p-4"
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-violet-200">
          AI suggested task
        </h3>
        {task ? <StatusBadge status={task.status} /> : null}
      </div>

      <p className="text-sm font-medium text-mist-50">{form.title}</p>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <PriorityBadge priority={form.priority} />
        {form.dueDate ? (
          <span className="chip chip-neutral">
            Due {shortDate(form.dueDate)}
            {form.dueTime ? ` · ${timeLabel(form.dueTime)}` : ''}
          </span>
        ) : (
          <span className="chip chip-neutral" title="The message did not state a date, so none was invented.">
            No date stated
          </span>
        )}
        <span className="chip chip-neutral" title="How confident the analysis is about this action">
          {Math.round(confidence * 100)}% confidence
        </span>
      </div>

      {belowThreshold ? (
        <p className="mt-2.5 rounded-xl border border-medium/25 bg-medium/[0.08] p-2.5 text-[11px] text-medium">
          Possible action detected — please review. Confidence is below your configured threshold, so
          nothing was created automatically.
        </p>
      ) : null}

      {analysis.suggested_action && analysis.detected_deadline?.source_sentence ? (
        <p className="mt-2.5 border-l-2 border-white/[0.12] pl-3 text-xs italic text-mist-400">
          “{analysis.detected_deadline.source_sentence}”
        </p>
      ) : null}

      <div className="mt-3.5 flex flex-wrap gap-2">
        {task && task.status === 'TODO' ? (
          <Button variant="secondary" size="sm" onClick={() => act(`/api/tasks/${task.id}`, { status: 'COMPLETED' }, 'PATCH')} loading={busy}>
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
            Mark complete
          </Button>
        ) : (
          <>
            <Button variant="primary" size="sm" onClick={() => handleCreate(false)} loading={busy}>
              <ListPlus className="h-3.5 w-3.5" aria-hidden="true" />
              {task ? 'Keep on my list' : 'Create task'}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => handleCreate(true)} loading={busy}>
              <BellPlus className="h-3.5 w-3.5" aria-hidden="true" />
              Create &amp; remind
            </Button>
          </>
        )}
        <Button variant="ghost" size="sm" onClick={() => setEditOpen(true)}>
          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
          Edit
        </Button>
        <Button variant="ghost" size="sm" onClick={handleDismiss} disabled={busy}>
          <X className="h-3.5 w-3.5" aria-hidden="true" />
          Dismiss
        </Button>
      </div>

      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit suggested task"
        description="Adjust the wording, date or priority before adding it to your list."
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleSaveEdit} loading={busy} disabled={form.title.trim().length < 3}>
              Save task
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="label" htmlFor="task-title">
              Title
            </label>
            <input
              id="task-title"
              className="field"
              value={form.title}
              maxLength={200}
              onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="task-date">
                Due date
              </label>
              <input
                id="task-date"
                type="date"
                className="field"
                value={form.dueDate}
                onChange={(event) => setForm((current) => ({ ...current, dueDate: event.target.value }))}
              />
            </div>
            <div>
              <label className="label" htmlFor="task-time">
                Due time
              </label>
              <input
                id="task-time"
                type="time"
                className="field"
                value={form.dueTime}
                onChange={(event) => setForm((current) => ({ ...current, dueTime: event.target.value }))}
              />
            </div>
          </div>
          <div>
            <span className="label">Priority</span>
            <div className="flex flex-wrap gap-1.5">
              {(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'NONE'] as EmailPriority[]).map((priority) => (
                <button
                  key={priority}
                  type="button"
                  onClick={() => setForm((current) => ({ ...current, priority }))}
                  aria-pressed={form.priority === priority}
                  className={cn('chip', form.priority === priority ? PRIORITY_META[priority].chip : 'chip-neutral')}
                >
                  {PRIORITY_META[priority].label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Modal>
    </section>
  );
}
