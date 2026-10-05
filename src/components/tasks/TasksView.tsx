'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BellPlus, CalendarClock, CheckCircle2, ExternalLink, Pencil, Plus, RotateCcw, Search, Trash2, XCircle } from 'lucide-react';
import type { Email, Task } from '@/lib/types/database';
import type { EmailPriority, TaskStatus } from '@/lib/types/domain';
import { Button } from '@/components/ui/Button';
import { Modal, ConfirmDialog } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/States';
import { CategoryBadge, PriorityBadge, StatusBadge } from '@/components/ui/Badge';
import { useToast } from '@/components/ui/Toast';
import { PRIORITY_META, cn, relativeTime, shortDate, timeLabel } from '@/lib/utils';

export interface TaskListItem {
  task: Task;
  sourceEmail: Email | null;
}

const STATUS_TABS: Array<{ value: TaskStatus | 'ALL'; label: string }> = [
  { value: 'ALL', label: 'All' },
  { value: 'SUGGESTED', label: 'Suggested' },
  { value: 'TODO', label: 'To do' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'DISMISSED', label: 'Dismissed' },
];

const SORTS = [
  { value: 'DUE_SOONEST', label: 'Due soonest' },
  { value: 'NEWEST', label: 'Newest' },
  { value: 'PRIORITY', label: 'Highest priority' },
  { value: 'STATUS', label: 'Status' },
] as const;

export function TasksView({ items, timezone }: { items: TaskListItem[]; timezone: string }) {
  const router = useRouter();
  const toast = useToast();
  const [status, setStatus] = useState<TaskStatus | 'ALL'>('ALL');
  const [sort, setSort] = useState<(typeof SORTS)[number]['value']>('DUE_SOONEST');
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<TaskListItem | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<TaskListItem | null>(null);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const rows = items.filter((item) => {
      if (status !== 'ALL' && item.task.status !== status) return false;
      if (needle.length === 0) return true;
      return (
        item.task.title.toLowerCase().includes(needle) ||
        (item.task.description ?? '').toLowerCase().includes(needle) ||
        (item.sourceEmail?.subject ?? '').toLowerCase().includes(needle)
      );
    });

    return [...rows].sort((a, b) => {
      if (sort === 'NEWEST') return b.task.created_at.localeCompare(a.task.created_at);
      if (sort === 'PRIORITY') {
        const rank: Record<EmailPriority, number> = { CRITICAL: 5, HIGH: 4, MEDIUM: 3, LOW: 2, NONE: 1 };
        return rank[b.task.priority] - rank[a.task.priority];
      }
      if (sort === 'STATUS') return a.task.status.localeCompare(b.task.status);
      const aDate = a.task.due_date ?? '9999-12-31';
      const bDate = b.task.due_date ?? '9999-12-31';
      if (aDate !== bDate) return aDate.localeCompare(bDate);
      return (a.task.due_time ?? '00:00').localeCompare(b.task.due_time ?? '00:00');
    });
  }, [items, status, sort, search]);

  const mutate = async (taskId: string, body: Record<string, unknown>, method: 'PATCH' | 'DELETE' = 'PATCH') => {
    setBusyId(taskId);
    try {
      const response = await fetch(`/api/tasks/${taskId}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: method === 'DELETE' ? undefined : JSON.stringify(body),
      });
      const payload = (await response.json()) as { ok: boolean; error?: { message: string } };
      if (!payload.ok) {
        toast.push(payload.error?.message ?? 'Unable to update this task.', 'error');
        return false;
      }
      router.refresh();
      return true;
    } catch {
      toast.push('Unable to complete this action. Please try again.', 'error');
      return false;
    } finally {
      setBusyId(null);
    }
  };

  const counts = useMemo(() => {
    const map = new Map<TaskStatus | 'ALL', number>();
    map.set('ALL', items.length);
    for (const item of items) {
      map.set(item.task.status, (map.get(item.task.status) ?? 0) + 1);
    }
    return map;
  }, [items]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filter tasks by status">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={status === tab.value}
              onClick={() => setStatus(tab.value)}
              className={cn(
                'chip transition-colors',
                status === tab.value
                  ? 'border-violet-400/35 bg-violet-500/15 text-violet-100'
                  : 'chip-neutral hover:border-white/[0.14] hover:text-mist-100',
              )}
            >
              {tab.label}
              <span className="ml-1 text-[10px] text-mist-500">{counts.get(tab.value) ?? 0}</span>
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-mist-500" aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search tasks"
              aria-label="Search tasks"
              className="field w-44 py-1.5 pl-8 text-xs"
            />
          </div>
          <label className="sr-only" htmlFor="task-sort">
            Sort tasks
          </label>
          <select
            id="task-sort"
            value={sort}
            onChange={(event) => setSort(event.target.value as (typeof SORTS)[number]['value'])}
            className="field w-auto py-1.5 text-xs"
          >
            {SORTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            New task
          </Button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title={items.length === 0 ? 'No actionable tasks yet.' : 'No tasks match this view.'}
          description={
            items.length === 0
              ? 'When VozInbox detects an action in your email, a suggested task appears here for you to approve, edit or dismiss.'
              : 'Adjust the filter or clear your search to see other tasks.'
          }
        />
      ) : (
        <ul className="space-y-2.5">
          {filtered.map((item) => {
            const { task, sourceEmail } = item;
            const overdue =
              task.due_date !== null &&
              ['SUGGESTED', 'TODO', 'IN_PROGRESS'].includes(task.status) &&
              Date.parse(`${task.due_date}T23:59:59Z`) < Date.now();

            return (
              <li key={task.id} className="panel p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3
                        className={cn(
                          'text-sm font-medium',
                          task.status === 'COMPLETED' || task.status === 'DISMISSED'
                            ? 'text-mist-500 line-through'
                            : 'text-mist-50',
                        )}
                      >
                        {task.title}
                      </h3>
                      <StatusBadge status={task.status} />
                    </div>

                    {task.description ? (
                      <p className="mt-1.5 line-clamp-2x text-xs leading-relaxed text-mist-400">
                        {task.description}
                      </p>
                    ) : null}

                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                      <PriorityBadge priority={task.priority} />
                      <CategoryBadge category={task.category} />
                      {task.due_date ? (
                        <span className={cn('chip', overdue ? 'border-critical/35 bg-critical/10 text-critical' : 'chip-neutral')}>
                          <CalendarClock className="h-3 w-3" aria-hidden="true" />
                          {overdue ? 'Overdue ' : 'Due '}
                          {shortDate(task.due_date)}
                          {task.due_time ? ` · ${timeLabel(task.due_time)}` : ''}
                        </span>
                      ) : (
                        <span className="chip chip-neutral">No date</span>
                      )}
                      {task.reminder_at ? (
                        <span className="chip border-violet-400/25 bg-violet-500/10 text-violet-200">
                          <BellPlus className="h-3 w-3" aria-hidden="true" />
                          Reminder set
                        </span>
                      ) : null}
                      <span className="text-[11px] text-mist-600">created {relativeTime(task.created_at)}</span>
                    </div>

                    {sourceEmail ? (
                      <p className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-mist-500">
                        <span>Source:</span>
                        <Link
                          href={`/inbox/${sourceEmail.id}`}
                          className="inline-flex items-center gap-1 text-violet-300 hover:text-violet-200"
                        >
                          {sourceEmail.subject ?? '(no subject)'}
                          <ExternalLink className="h-3 w-3" aria-hidden="true" />
                        </Link>
                      </p>
                    ) : null}
                  </div>

                  <div className="flex shrink-0 flex-wrap gap-1.5">
                    {task.status !== 'COMPLETED' ? (
                      <Button
                        variant="secondary"
                        size="xs"
                        loading={busyId === task.id}
                        onClick={() => mutate(task.id, { status: 'COMPLETED' })}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                        Complete
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        size="xs"
                        loading={busyId === task.id}
                        onClick={() => mutate(task.id, { status: 'TODO' })}
                      >
                        <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                        Reopen
                      </Button>
                    )}
                    {task.status === 'SUGGESTED' ? (
                      <Button
                        variant="primary"
                        size="xs"
                        loading={busyId === task.id}
                        onClick={() => mutate(task.id, { status: 'TODO' })}
                      >
                        Approve
                      </Button>
                    ) : null}
                    <Button variant="ghost" size="xs" onClick={() => setEditing(item)}>
                      <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                      Edit
                    </Button>
                    {task.status !== 'DISMISSED' ? (
                      <Button variant="ghost" size="xs" onClick={() => mutate(task.id, { status: 'DISMISSED' })}>
                        <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                        Dismiss
                      </Button>
                    ) : null}
                    <Button variant="ghost" size="xs" onClick={() => setDeleting(item)}>
                      <Trash2 className="h-3.5 w-3.5 text-critical" aria-hidden="true" />
                      <span className="sr-only">Delete task</span>
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <TaskForm
        open={creating || editing !== null}
        item={editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSaved={() => {
          setCreating(false);
          setEditing(null);
          router.refresh();
        }}
        timezone={timezone}
      />

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          const ok = await mutate(deleting.task.id, {}, 'DELETE');
          if (ok) toast.push('Task deleted.', 'success');
          setDeleting(null);
        }}
        title="Delete this task?"
        message={`“${deleting?.task.title ?? ''}” will be removed permanently. The source email is not affected.`}
        confirmLabel="Delete task"
        destructive
      />
    </div>
  );
}

function TaskForm({
  open,
  item,
  onClose,
  onSaved,
  timezone,
}: {
  open: boolean;
  item: TaskListItem | null;
  onClose: () => void;
  onSaved: () => void;
  timezone: string;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    title: item?.task.title ?? '',
    description: item?.task.description ?? '',
    dueDate: item?.task.due_date ?? '',
    dueTime: item?.task.due_time ?? '',
    priority: (item?.task.priority ?? 'MEDIUM') as EmailPriority,
    reminder: Boolean(item?.task.reminder_at),
  });

  // Reset the form whenever a different task is opened.
  const formKey = item?.task.id ?? 'new';
  const [activeKey, setActiveKey] = useState(formKey);
  if (activeKey !== formKey) {
    setActiveKey(formKey);
    setForm({
      title: item?.task.title ?? '',
      description: item?.task.description ?? '',
      dueDate: item?.task.due_date ?? '',
      dueTime: item?.task.due_time ?? '',
      priority: (item?.task.priority ?? 'MEDIUM') as EmailPriority,
      reminder: Boolean(item?.task.reminder_at),
    });
  }

  const submit = async () => {
    if (form.title.trim().length < 2) {
      toast.push('Please give the task a title.', 'error');
      return;
    }
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        title: form.title.trim(),
        description: form.description.trim() || null,
        dueDate: form.dueDate || null,
        dueTime: form.dueTime || null,
        priority: form.priority,
      };
      if (form.reminder && form.dueDate) {
        body.reminderAt = new Date(`${form.dueDate}T${form.dueTime || '09:00'}:00`).toISOString();
      }

      const response = await fetch(item ? `/api/tasks/${item.task.id}` : '/api/tasks', {
        method: item ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(item ? body : { ...body, createReminder: form.reminder, status: 'TODO' }),
      });
      const payload = (await response.json()) as { ok: boolean; error?: { message: string } };
      if (!payload.ok) {
        toast.push(payload.error?.message ?? 'Unable to save this task.', 'error');
        return;
      }
      toast.push(item ? 'Task updated.' : 'Task created.', 'success');
      onSaved();
    } catch {
      toast.push('Unable to complete this action. Please try again.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={item ? 'Edit task' : 'New task'}
      description={timezone ? `Dates and times are stored in ${timezone}.` : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={busy}>
            {item ? 'Save changes' : 'Create task'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="label" htmlFor="form-title">
            Title
          </label>
          <input
            id="form-title"
            className="field"
            maxLength={200}
            value={form.title}
            onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
            placeholder="Submit Data Science assignment"
          />
        </div>
        <div>
          <label className="label" htmlFor="form-description">
            Notes
          </label>
          <textarea
            id="form-description"
            className="field min-h-[84px] resize-y"
            maxLength={2000}
            value={form.description}
            onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="form-date">
              Due date
            </label>
            <input
              id="form-date"
              type="date"
              className="field"
              value={form.dueDate}
              onChange={(event) => setForm((current) => ({ ...current, dueDate: event.target.value }))}
            />
          </div>
          <div>
            <label className="label" htmlFor="form-time">
              Due time
            </label>
            <input
              id="form-time"
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
                aria-pressed={form.priority === priority}
                onClick={() => setForm((current) => ({ ...current, priority }))}
                className={cn('chip', form.priority === priority ? PRIORITY_META[priority].chip : 'chip-neutral')}
              >
                {PRIORITY_META[priority].label}
              </button>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-2 text-xs text-mist-300">
          <input
            type="checkbox"
            checked={form.reminder}
            disabled={!form.dueDate}
            onChange={(event) => setForm((current) => ({ ...current, reminder: event.target.checked }))}
            className="h-4 w-4 rounded border-white/[0.15] bg-ink-900 accent-violet-500"
          />
          Create a reminder for this task {form.dueDate ? '' : '(set a due date first)'}
        </label>
      </div>
    </Modal>
  );
}
