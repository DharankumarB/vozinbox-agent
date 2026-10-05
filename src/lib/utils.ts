import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { EmailCategory, EmailPriority, NotificationType, TaskStatus } from '@/lib/types/domain';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

// ── Relative time ────────────────────────────────────────────────────────────

export function relativeTime(value: string | null | undefined, now: Date = new Date()): string {
  if (!value) return '';
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return '';
  const diff = timestamp - now.getTime();
  const abs = Math.abs(diff);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 86_400_000;

  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

  if (abs < minute) return 'just now';
  if (abs < hour) return formatter.format(Math.round(diff / minute), 'minute');
  if (abs < day) return formatter.format(Math.round(diff / hour), 'hour');
  if (abs < 7 * day) return formatter.format(Math.round(diff / day), 'day');
  return new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function absoluteTime(value: string | null | undefined, timezone?: string): string {
  if (!value) return '';
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return '';
  try {
    return new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: timezone,
    }).format(new Date(timestamp));
  } catch {
    return new Date(timestamp).toLocaleString();
  }
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.round(ms / 60_000)} min`;
}

/** "Oct 10" — used in cards where space is tight. */
export function shortDate(isoDate: string | null | undefined): string {
  if (!isoDate) return '';
  const parsed = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!parsed) return isoDate;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[Number(parsed[2]) - 1] ?? '';
  return `${month} ${Number(parsed[3])}`;
}

export function timeLabel(time: string | null | undefined): string | null {
  if (!time) return null;
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) return time;
  const hour = Number(match[1]);
  const minute = match[2];
  const period = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return minute === '00' ? `${hour12}:00 ${period}` : `${hour12}:${minute} ${period}`;
}

// ── Priority / category presentation (§40: never colour alone) ───────────────

export interface PriorityMeta {
  label: string;
  /** Tailwind classes for the chip. */
  chip: string;
  dot: string;
  /** Non-colour indicator so priority is never conveyed by colour alone. */
  symbol: string;
}

export const PRIORITY_META: Record<EmailPriority, PriorityMeta> = {
  CRITICAL: {
    label: 'Critical',
    chip: 'border-critical/35 bg-critical/12 text-critical',
    dot: 'bg-critical',
    symbol: '▲▲',
  },
  HIGH: {
    label: 'High',
    chip: 'border-high/35 bg-high/12 text-high',
    dot: 'bg-high',
    symbol: '▲',
  },
  MEDIUM: {
    label: 'Medium',
    chip: 'border-medium/30 bg-medium/10 text-medium',
    dot: 'bg-medium',
    symbol: '●',
  },
  LOW: {
    label: 'Low',
    chip: 'border-low/30 bg-low/10 text-low',
    dot: 'bg-low',
    symbol: '▽',
  },
  NONE: {
    label: 'None',
    chip: 'border-white/[0.08] bg-white/[0.04] text-mist-400',
    dot: 'bg-mist-500',
    symbol: '–',
  },
};

export const CATEGORY_ACCENT: Record<EmailCategory, string> = {
  ACTION_REQUIRED: 'border-high/30 bg-high/10 text-high',
  ASSIGNMENT: 'border-violet-400/30 bg-violet-500/12 text-violet-200',
  DEADLINE: 'border-critical/30 bg-critical/10 text-critical',
  MEETING: 'border-electric-400/30 bg-electric-500/10 text-electric-300',
  EVENT: 'border-electric-300/25 bg-electric-500/10 text-electric-300',
  PROJECT: 'border-violet-400/25 bg-violet-500/10 text-violet-200',
  WORK: 'border-low/25 bg-low/10 text-low',
  COLLEGE: 'border-violet-300/25 bg-violet-500/10 text-violet-200',
  PERSONAL: 'border-positive/25 bg-positive/10 text-positive',
  FINANCE: 'border-medium/25 bg-medium/10 text-medium',
  INFORMATION: 'border-white/[0.1] bg-white/[0.05] text-mist-300',
  PROMOTIONAL: 'border-mist-500/25 bg-white/[0.04] text-mist-400',
  SPAM: 'border-critical/25 bg-critical/8 text-critical',
  OTHER: 'border-white/[0.08] bg-white/[0.04] text-mist-400',
};

export const TASK_STATUS_CHIP: Record<TaskStatus, string> = {
  SUGGESTED: 'border-violet-400/35 bg-violet-500/12 text-violet-200',
  TODO: 'border-white/[0.12] bg-white/[0.05] text-mist-200',
  IN_PROGRESS: 'border-electric-400/30 bg-electric-500/10 text-electric-300',
  COMPLETED: 'border-positive/30 bg-positive/10 text-positive',
  DISMISSED: 'border-white/[0.07] bg-white/[0.03] text-mist-500',
};

export const NOTIFICATION_ICON_GROUP: Record<NotificationType, 'alert' | 'deadline' | 'task' | 'info' | 'integration'> = {
  IMPORTANT_EMAIL: 'alert',
  TASK_SUGGESTION: 'task',
  DEADLINE_DETECTED: 'deadline',
  DEADLINE_APPROACHING: 'deadline',
  DEADLINE_CHANGED: 'deadline',
  MEETING_REMINDER: 'deadline',
  MEETING_CHANGED: 'deadline',
  TASK_CREATED: 'task',
  TASK_COMPLETED: 'task',
  AI_PROCESSING_COMPLETED: 'info',
  AI_NEEDS_REVIEW: 'alert',
  INFORMATION_CHANGED: 'info',
  INTEGRATION_ISSUE: 'integration',
  INTEGRATION_CONNECTED: 'integration',
  AGENT_ERROR: 'alert',
  SYSTEM: 'info',
};

export function initials(name: string | null | undefined, fallback = '?'): string {
  if (!name) return fallback;
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? '').join('') || fallback;
}

/** Deterministic avatar tint so the same sender keeps the same colour. */
export function avatarTint(seed: string): string {
  const palette = [
    'bg-violet-500/25 text-violet-100',
    'bg-electric-500/20 text-electric-300',
    'bg-positive/20 text-positive',
    'bg-high/20 text-high',
    'bg-low/20 text-low',
    'bg-medium/20 text-medium',
  ];
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 9973;
  }
  return palette[hash % palette.length] ?? palette[0]!;
}

export function percent(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined) return '—';
  return `${(value * 100).toFixed(digits)}%`;
}

export function pluralise(count: number, singular: string, plural?: string): string {
  return count === 1 ? singular : (plural ?? `${singular}s`);
}

export function truncate(value: string, max = 160): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
