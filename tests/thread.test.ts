import { describe, expect, it } from 'vitest';
import { computeThreadState, describeChanges, detectThreadChanges } from '@/lib/analysis/thread';
import type { EmailAnalysisResult } from '@/lib/types/domain';
import type { ThreadState } from '@/lib/types/database';

/** §15, §16 — the latest authoritative message wins; earlier state is preserved. */

function analysis(overrides: Partial<EmailAnalysisResult> = {}): EmailAnalysisResult {
  return {
    category: 'OTHER',
    secondary_categories: [],
    summary: null,
    action_required: false,
    priority: 'NONE',
    priority_reason: null,
    priority_score: null,
    detected_dates: [],
    detected_deadline: null,
    detected_people: [],
    detected_organizations: [],
    detected_links: [],
    detected_attachments: [],
    suggested_action: null,
    suggested_task: null,
    confidence: { category: 0.5, action: 0.5, deadline: 0.5, priority: 0.5, overall: 0.5 },
    needs_review: false,
    review_reason: null,
    model_name: 'rules-engine',
    analysis_source: 'RULES_ENGINE',
    analysis_version: '1.0.0',
    grounding_report: { checked: true, unsupported: [], dropped_count: 0, notes: [] },
    injection_flagged: false,
    injection_signals: [],
    ...overrides,
  };
}

function deadline(date: string, time: string | null = null) {
  return {
    date,
    time,
    timezone: 'Africa/Johannesburg',
    type: 'EXPLICIT' as const,
    source_sentence: `due ${date}`,
    confidence: 0.9,
  };
}

function previousState(overrides: Partial<ThreadState> = {}): ThreadState {
  return {
    deadline: deadline('2026-03-20'),
    action_required: true,
    suggested_action: 'Submit the report',
    category: 'ASSIGNMENT',
    priority: 'HIGH',
    meeting: null,
    cancelled: false,
    updated_from_email_id: 'email-1',
    updated_at: '2026-03-10T08:00:00.000Z',
    ...overrides,
  };
}

const context = (state: ThreadState | null) => ({
  previousState: state,
  priorAnalyses: state
    ? [
        {
          email_id: 'email-1',
          category: state.category ?? ('OTHER' as const),
          priority: state.priority ?? ('NONE' as const),
          action_required: state.action_required ?? false,
          suggested_action: state.suggested_action ?? null,
          deadline: state.deadline ?? null,
          received_at: '2026-03-10T08:00:00.000Z',
        },
      ]
    : [],
});

describe('change detection', () => {
  it('detects a deadline change and records both values', () => {
    const changes = detectThreadChanges(
      analysis({ detected_deadline: deadline('2026-03-25'), category: 'ASSIGNMENT' }),
      context(previousState()),
      'The deadline has been extended. The new deadline is 25 March 2026.',
      'email-2',
    );

    const change = changes.find((entry) => entry.type === 'DEADLINE_CHANGED');
    expect(change).toBeDefined();
    expect(change?.previous).toContain('2026-03-20');
    expect(change?.current).toContain('2026-03-25');
    expect(change?.description).toMatch(/deadline changed/i);
    expect(change?.email_id).toBe('email-2');
  });

  it('detects a cancellation', () => {
    const changes = detectThreadChanges(
      analysis({ category: 'MEETING' }),
      context(previousState({ meeting: { date: '2026-03-12', time: '09:00', location: null } })),
      'The meeting has been cancelled. No action required.',
      'email-3',
    );
    expect(changes.some((entry) => entry.type === 'MEETING_CANCELLED' || entry.type === 'EVENT_CANCELLED')).toBe(
      true,
    );
  });

  it('detects an attachment added later in the thread', () => {
    const changes = detectThreadChanges(
      analysis({
        category: 'PROJECT',
        detected_attachments: [
          { filename: 'spec-v2.pdf', mime_type: 'application/pdf', size_bytes: 1024, attachment_id: null },
        ],
      }),
      context(previousState()),
      'Please find the revised specification attached.',
      'email-4',
    );
    const attachment = changes.find((entry) => entry.type === 'ATTACHMENT_ADDED');
    expect(attachment).toBeDefined();
    expect(attachment?.current).toContain('spec-v2.pdf');
  });

  it('detects a raised priority', () => {
    const changes = detectThreadChanges(
      analysis({ priority: 'CRITICAL', action_required: true }),
      context(previousState({ priority: 'MEDIUM' })),
      'This is urgent — the client needs the deck today.',
      'email-5',
    );
    expect(changes.some((entry) => entry.type === 'PRIORITY_INCREASED')).toBe(true);
  });

  it('reports nothing when the follow-up adds no new information', () => {
    const changes = detectThreadChanges(
      analysis({ category: 'ASSIGNMENT' }),
      context(previousState()),
      'Thanks, noted.',
      'email-6',
    );
    expect(changes).toHaveLength(0);
  });

  it('renders changes into a notification message', () => {
    const changes = detectThreadChanges(
      analysis({ detected_deadline: deadline('2026-03-25'), category: 'ASSIGNMENT' }),
      context(previousState()),
      'The deadline has been extended to 25 March 2026.',
      'email-7',
    );
    const rendered = describeChanges(changes);
    expect(rendered?.title).toBeTruthy();
    expect(rendered?.message).toMatch(/deadline/i);
  });
});

describe('thread state precedence', () => {
  it('keeps the earlier deadline when a newer message is purely informational', () => {
    const update = computeThreadState(
      analysis({ category: 'INFORMATION', action_required: false }),
      context(previousState()),
      'email-8',
      'Just a quick note to say thanks for your help.',
    );
    expect(update.state.deadline?.date).toBe('2026-03-20');
    expect(update.superseded).toBe(true);
    expect(update.notes.join(' ')).toMatch(/still applies/i);
  });

  it('adopts a newer deadline when the message states one', () => {
    const update = computeThreadState(
      analysis({
        category: 'ASSIGNMENT',
        action_required: true,
        detected_deadline: deadline('2026-04-02'),
      }),
      context(previousState()),
      'email-9',
      'The deadline has moved to 2 April 2026.',
    );
    expect(update.state.deadline?.date).toBe('2026-04-02');
    expect(update.superseded).toBe(false);
  });

  it('never downgrades priority below the thread’s own history', () => {
    const update = computeThreadState(
      analysis({ category: 'INFORMATION', priority: 'LOW' }),
      context(previousState({ priority: 'CRITICAL' })),
      'email-10',
      'Sharing the minutes for reference.',
    );
    expect(update.state.priority).toBe('CRITICAL');
  });

  it('starts a fresh thread state when there is no history', () => {
    const update = computeThreadState(
      analysis({ category: 'FINANCE', action_required: true, detected_deadline: deadline('2026-03-30') }),
      context(null),
      'email-11',
      'Please settle invoice 22 by 30 March 2026.',
    );
    expect(update.state.updated_from_email_id).toBe('email-11');
    expect(update.state.deadline?.date).toBe('2026-03-30');
    expect(update.changes).toHaveLength(0);
  });
});
