/**
 * Duplicate prevention (§14).
 *
 * Two layers:
 *  1. Deterministic `dedupeKey` — identical action text from the same email
 *     always collapses. Enforced by a partial unique index in the database.
 *  2. Semantic similarity — compares candidate tasks against recent tasks from
 *     the same thread so a re-worded follow-up ("Submit assignment" →
 *     "Please submit the assignment today") does not create a second task.
 */

import type { EmailPriority } from '@/lib/types/domain';

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'to', 'for', 'of', 'in', 'on', 'at', 'by', 'and', 'or', 'your', 'you',
  'please', 'kindly', 'this', 'that', 'these', 'those', 'with', 'from', 'is', 'are', 'be',
  'it', 'as', 'before', 'after', 'than', 'then', 'all', 'any', 'my', 'our', 'we', 'i',
]);

export function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

/** Stable key for exact-duplicate prevention. */
export function buildDedupeKey(sourceEmailId: string, actionText: string): string {
  const normalised = tokenize(actionText).slice(0, 8).join('-');
  return `${sourceEmailId}:${normalised}`.slice(0, 240);
}

/** Jaccard similarity over token sets, with a verb-prefix bonus. */
export function semanticSimilarity(a: string, b: string): number {
  const first = new Set(tokenize(a));
  const second = new Set(tokenize(b));
  if (first.size === 0 || second.size === 0) return 0;

  let intersection = 0;
  for (const token of first) if (second.has(token)) intersection += 1;
  const union = first.size + second.size - intersection;
  const jaccard = union === 0 ? 0 : intersection / union;

  // The leading verb carries most of the meaning: "submit X" vs "send X" differ.
  const verbA = tokenize(a)[0];
  const verbB = tokenize(b)[0];
  const verbBonus = verbA && verbB && verbA === verbB ? 0.15 : 0;

  return Math.min(1, jaccard + verbBonus);
}

export interface ExistingTaskCandidate {
  id: string;
  title: string;
  source_email_id: string | null;
  source_thread_id: string | null;
  status: string;
  due_date: string | null;
  priority: EmailPriority;
}

export interface DuplicateDecision {
  duplicate: boolean;
  reason: string;
  existingTaskId: string | null;
  similarity: number;
  /** True when the new email adds information to an existing task. */
  enrich: boolean;
  enrichFields: Array<'due_date' | 'due_time' | 'priority' | 'description'>;
}

export interface DuplicateCheckInput {
  candidateTitle: string;
  candidateDueDate: string | null;
  candidateDueTime: string | null;
  candidatePriority: EmailPriority;
  sourceEmailId: string | null;
  sourceThreadId: string | null;
  existingTasks: ExistingTaskCandidate[];
  /** Similarity above which we consider two actions the same (§14). */
  threshold?: number;
}

/**
 * Statuses that represent finished business. These must never silently swallow
 * a new action: if the user dismissed a suggestion, or completed the work, a
 * later message about the same subject is allowed to create a fresh task.
 */
const TERMINAL_STATUSES = ['COMPLETED', 'DISMISSED'];

export function checkDuplicate(input: DuplicateCheckInput): DuplicateDecision {
  const threshold = input.threshold ?? 0.72;

  // Layer 1: same source email → always a duplicate. Re-analysing one email
  // must not produce a second task, even if the first one was dismissed.
  const sameEmail =
    input.sourceEmailId === null
      ? undefined
      : input.existingTasks.find((task) => task.source_email_id === input.sourceEmailId);
  if (sameEmail) {
    const terminal = TERMINAL_STATUSES.includes(sameEmail.status);
    return {
      duplicate: true,
      reason: terminal
        ? `This email already produced a task that is now ${sameEmail.status.toLowerCase()} (${sameEmail.title}).`
        : `A task already exists for this email (${sameEmail.title}).`,
      existingTaskId: sameEmail.id,
      similarity: 1,
      enrich: terminal ? false : hasNewInformation(sameEmail, input),
      enrichFields: terminal ? [] : newInformationFields(sameEmail, input),
    };
  }

  // Layer 2 compares only against open work.
  const comparable = input.existingTasks.filter((task) => !TERMINAL_STATUSES.includes(task.status));

  if (comparable.length === 0) {
    return {
      duplicate: false,
      reason: 'No open tasks to compare against.',
      existingTaskId: null,
      similarity: 0,
      enrich: false,
      enrichFields: [],
    };
  }

  // Layer 2: semantic similarity, weighted higher within the same thread.
  let best: { task: ExistingTaskCandidate; score: number } | null = null;
  for (const task of comparable) {
    const base = semanticSimilarity(input.candidateTitle, task.title);
    const sameThread = input.sourceThreadId !== null && task.source_thread_id === input.sourceThreadId;
    const score = Math.min(1, base + (sameThread ? 0.12 : 0));
    if (!best || score > best.score) best = { task, score };
  }

  if (best && best.score >= threshold) {
    const enrich = hasNewInformation(best.task, input);
    return {
      duplicate: true,
      reason: `Very similar to an existing task ("${best.task.title}", ${Math.round(best.score * 100)}% match).`,
      existingTaskId: best.task.id,
      similarity: Number(best.score.toFixed(3)),
      enrich,
      enrichFields: newInformationFields(best.task, input),
    };
  }

  return {
    duplicate: false,
    reason: best ? `Closest existing task is only ${Math.round(best.score * 100)}% similar.` : 'No comparable task found.',
    existingTaskId: null,
    similarity: best ? Number(best.score.toFixed(3)) : 0,
    enrich: false,
    enrichFields: [],
  };
}

function hasNewInformation(existing: ExistingTaskCandidate, input: DuplicateCheckInput): boolean {
  return newInformationFields(existing, input).length > 0;
}

function newInformationFields(
  existing: ExistingTaskCandidate,
  input: DuplicateCheckInput,
): Array<'due_date' | 'due_time' | 'priority' | 'description'> {
  const fields: Array<'due_date' | 'due_time' | 'priority' | 'description'> = [];
  if (input.candidateDueDate && input.candidateDueDate !== existing.due_date) {
    // Only treat it as new information when it is a genuine revision.
    fields.push('due_date');
  }
  const priorityRank: Record<EmailPriority, number> = {
    CRITICAL: 5, HIGH: 4, MEDIUM: 3, LOW: 2, NONE: 1,
  };
  if (priorityRank[input.candidatePriority] > priorityRank[existing.priority]) {
    fields.push('priority');
  }
  return fields;
}
