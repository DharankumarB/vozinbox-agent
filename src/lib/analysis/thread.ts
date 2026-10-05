/**
 * Thread precedence and change detection (§15, §16).
 *
 * A thread is a sequence of statements about the same subject. The most recent
 * authoritative message wins, but the earlier interpretation is preserved so the
 * user can see exactly what changed and when.
 */

import type {
  ChangeType,
  DetectedChange,
  EmailAnalysisResult,
  EmailCategory,
  EmailPriority,
} from '@/lib/types/domain';
import { PRIORITY_WEIGHT } from '@/lib/types/domain';
import type { ThreadState } from '@/lib/types/database';

export interface ThreadContext {
  previousState: ThreadState | null;
  /** Analyses in the thread ordered oldest → newest, excluding the current email. */
  priorAnalyses: Array<{
    email_id: string;
    category: EmailCategory;
    priority: EmailPriority;
    action_required: boolean;
    suggested_action: string | null;
    deadline: EmailAnalysisResult['detected_deadline'];
    received_at: string;
  }>;
}

export interface ThreadUpdate {
  state: ThreadState;
  changes: DetectedChange[];
  /** True when a later message supersedes this one (this one is history). */
  superseded: boolean;
  notes: string[];
}

// ── Change lexicons ──────────────────────────────────────────────────────────

const PATTERNS = {
  cancellation:
    /\b(?:cancell?ed|called off|no longer (?:taking place|happening|required)|will not (?:be held|take place)|stands? cancelled)\b/i,
  reschedule:
    /\b(?:resched(?:uled|ule)|moved (?:to|from)|shifted (?:to|from)|changed to|postponed to|new (?:time|timing|slot))\b/i,
  extension:
    /\b(?:extend(?:ed|ing|sion)?|new deadline|deadline (?:has been )?(?:extended|changed|revised|moved)|revised deadline|additional time)\b/i,
  locationChange:
    /\b(?:venue|location|room|hall|campus|address|meeting link|zoom link)\b[^.]{0,120}?\b(?:changed|moved|updated|now|shifted)\b/i,
  instructionChange:
    /\b(?:instructions?|guidelines?|requirements?|criteria|steps?|format)\b[^.]{0,120}?\b(?:changed|updated|revised|modified|new|corrected)\b/i,
  submissionChange:
    /\b(?:submit|submission|upload|send)\b[^.]{0,120}?\b(?:portal|link|platform|method|form|email instead|via)\b/i,
  attachmentAdded:
    /\b(?:attached|attachment|enclosed|please find (?:the )?attached|see attached)\b/i,
  timeChange:
    /\b(?:meeting|call|session|class|interview|exam)\b[^.]{0,120}?\b(?:moved|rescheduled|shifted|now at|changed to|starting at)\b/i,
  eventCancelled:
    /\b(?:event|workshop|seminar|webinar|fest|session|exam|class)\b[^.]{0,80}?\b(?:cancell?ed|postponed|rescheduled)\b/i,
} as const;

function describeDeadline(deadline: EmailAnalysisResult['detected_deadline']): string | null {
  if (!deadline) return null;
  if (!deadline.date) return deadline.type === 'UNKNOWN' ? 'no clear deadline stated' : null;
  return deadline.time ? `${deadline.date} at ${deadline.time}` : deadline.date;
}

const CHANGE_TITLES: Record<ChangeType, string> = {
  DEADLINE_CHANGED: 'Deadline changed',
  MEETING_TIME_CHANGED: 'Meeting time changed',
  MEETING_CANCELLED: 'Meeting cancelled',
  LOCATION_CHANGED: 'Location changed',
  INSTRUCTIONS_CHANGED: 'Instructions changed',
  SUBMISSION_METHOD_CHANGED: 'Submission method changed',
  EVENT_CANCELLED: 'Event cancelled',
  ATTACHMENT_ADDED: 'New attachment',
  ACTION_ADDED: 'New action required',
  PRIORITY_INCREASED: 'Priority increased',
};

/**
 * Compare this message against the thread's established understanding.
 * `text` is the raw message content (subject + body) used for cue detection.
 */
export function detectThreadChanges(
  current: EmailAnalysisResult,
  context: ThreadContext,
  text: string,
  currentEmailId: string,
): DetectedChange[] {
  const previous = context.previousState;
  const changes: DetectedChange[] = [];
  const nowIso = new Date().toISOString();

  const push = (type: ChangeType, previousValue: string | null, currentValue: string | null, description: string) => {
    changes.push({
      type,
      previous: previousValue,
      current: currentValue,
      description,
      detected_at: nowIso,
      email_id: currentEmailId,
    });
  };

  // 1. Deadline changes — the headline case (§16).
  const previousDeadline = previous?.deadline ?? null;
  const currentDeadline = current.detected_deadline;
  const previousLabel = describeDeadline(previousDeadline);
  const currentLabel = describeDeadline(currentDeadline);

  if (previousDeadline?.date && currentDeadline?.date && previousDeadline.date !== currentDeadline.date) {
    push(
      'DEADLINE_CHANGED',
      previousLabel,
      currentLabel,
      `Deadline changed from ${previousLabel} to ${currentLabel}.`,
    );
  } else if (previousDeadline?.date && PATTERNS.extension.test(text)) {
    push(
      'DEADLINE_CHANGED',
      previousLabel,
      currentLabel ?? 'revised in this message',
      `${previousLabel ? `The earlier deadline (${previousLabel})` : 'The earlier deadline'} was revised in this message${
        currentLabel ? ` to ${currentLabel}` : ''
      }.`,
    );
  } else if (!previousDeadline?.date && currentDeadline?.date && context.priorAnalyses.length > 0) {
    push(
      'DEADLINE_CHANGED',
      'no deadline known',
      currentLabel,
      `A deadline was introduced: ${currentLabel}.`,
    );
  }

  // 2. Meeting / event changes.
  const hadMeeting = Boolean(previous?.meeting) || context.priorAnalyses.some((a) => a.category === 'MEETING' || a.category === 'EVENT');
  if (hadMeeting && PATTERNS.cancellation.test(text)) {
    push('MEETING_CANCELLED', 'scheduled', 'cancelled', 'A later message cancels the meeting or event.');
  } else if (hadMeeting && PATTERNS.timeChange.test(text)) {
    push(
      'MEETING_TIME_CHANGED',
      previous?.meeting?.time ?? null,
      currentDeadline?.time ?? null,
      'The meeting time was changed in this message.',
    );
  }
  if (hadMeeting && PATTERNS.eventCancelled.test(text) && !PATTERNS.cancellation.test(text)) {
    push('EVENT_CANCELLED', 'scheduled', 'postponed or cancelled', 'A scheduled event was postponed or cancelled.');
  }
  if (PATTERNS.reschedule.test(text) && !changes.some((c) => c.type === 'MEETING_TIME_CHANGED')) {
    push('MEETING_TIME_CHANGED', null, currentDeadline?.time ?? null, 'A scheduling change was announced in this message.');
  }

  // 3. Location changes.
  if (PATTERNS.locationChange.test(text)) {
    push('LOCATION_CHANGED', previous?.meeting?.location ?? null, null, 'The location or meeting link changed in this message.');
  }

  // 4. Instruction / submission-method changes.
  if (PATTERNS.instructionChange.test(text) && context.priorAnalyses.length > 0) {
    push('INSTRUCTIONS_CHANGED', null, null, 'Instructions or requirements were updated in this message.');
  }
  if (PATTERNS.submissionChange.test(text) && context.priorAnalyses.length > 0) {
    push('SUBMISSION_METHOD_CHANGED', null, null, 'The submission method or portal referenced in this thread changed.');
  }

  // 5. New attachment.
  if (PATTERNS.attachmentAdded.test(text) && current.detected_attachments.length > 0) {
    push(
      'ATTACHMENT_ADDED',
      null,
      current.detected_attachments.map((a) => a.filename).join(', '),
      `Attachment added: ${current.detected_attachments.map((a) => a.filename).join(', ')}.`,
    );
  }

  // 6. Priority escalation.
  if (previous?.priority && PRIORITY_WEIGHT[current.priority] > PRIORITY_WEIGHT[previous.priority]) {
    push(
      'PRIORITY_INCREASED',
      previous.priority,
      current.priority,
      `Priority increased from ${previous.priority} to ${current.priority} within this thread.`,
    );
  }

  // 7. Action newly required by a later message.
  if (previous && previous.action_required === false && current.action_required === true) {
    push(
      'ACTION_ADDED',
      'no action required',
      current.suggested_action ?? 'action required',
      'A later message added an action that was not previously required.',
    );
  }

  return changes;
}

/**
 * Compute the thread's authoritative state after this email.
 * The newest definite statement wins; older statements survive only when the
 * newer message is silent about that field.
 */
export function computeThreadState(
  current: EmailAnalysisResult,
  context: ThreadContext,
  currentEmailId: string,
  text: string,
): ThreadUpdate {
  const notes: string[] = [];
  const previous = context.previousState ?? {};

  const isCancellation = PATTERNS.cancellation.test(text);
  const deadlineKnownNow = Boolean(current.detected_deadline?.date);

  const state: ThreadState = {
    deadline: deadlineKnownNow ? current.detected_deadline : (previous.deadline ?? null),
    action_required: current.action_required || (previous.action_required ?? false),
    suggested_action: current.suggested_action ?? previous.suggested_action ?? null,
    category: current.category !== 'OTHER' ? current.category : (previous.category ?? current.category),
    priority:
      previous.priority && PRIORITY_WEIGHT[previous.priority] > PRIORITY_WEIGHT[current.priority]
        ? previous.priority
        : current.priority,
    meeting: previous.meeting ?? null,
    cancelled: isCancellation ? true : (previous.cancelled ?? false),
    updated_from_email_id: currentEmailId,
    updated_at: new Date().toISOString(),
  };

  if (current.detected_deadline && !current.detected_deadline.date) {
    notes.push('This message references a deadline but no date could be determined.');
  }

  // A purely informational follow-up should not wipe out an established deadline.
  const superseded =
    Boolean(previous.deadline) &&
    !deadlineKnownNow &&
    current.category === 'INFORMATION' &&
    current.action_required === false;

  if (superseded) {
    notes.push('The deadline established earlier in this thread still applies; this message did not change it.');
  }
  if (deadlineKnownNow && previous.deadline?.date && previous.deadline.date !== current.detected_deadline?.date) {
    notes.push('This message changed the deadline for the thread.');
  }

  return {
    state,
    changes: detectThreadChanges(current, context, text, currentEmailId),
    superseded,
    notes,
  };
}

/** Render changes for the notification feed and the "INFORMATION CHANGED" banner (§16). */
export function describeChanges(changes: DetectedChange[]): { title: string; message: string } | null {
  const primary = changes[0];
  if (!primary) return null;
  const title = CHANGE_TITLES[primary.type] ?? 'Information changed';
  const message = changes
    .map((change) => change.description)
    .join(' ')
    .slice(0, 400);
  return { title, message };
}

export { CHANGE_TITLES };
