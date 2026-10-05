import { describe, expect, it } from 'vitest';
import { buildDedupeKey, checkDuplicate, semanticSimilarity, tokenize } from '@/lib/analysis/dedupe';
import type { ExistingTaskCandidate } from '@/lib/analysis/dedupe';

/** §14 — one action must never produce two tasks. */

function task(overrides: Partial<ExistingTaskCandidate> = {}): ExistingTaskCandidate {
  return {
    id: 'task-1',
    title: 'Submit the project report',
    source_email_id: 'email-1',
    source_thread_id: 'thread-1',
    status: 'TODO',
    due_date: '2026-03-20',
    priority: 'HIGH',
    ...overrides,
  };
}

function input(overrides: Partial<Parameters<typeof checkDuplicate>[0]> = {}) {
  return {
    candidateTitle: 'Submit the project report',
    candidateDueDate: '2026-03-20',
    candidateDueTime: null,
    candidatePriority: 'HIGH' as const,
    sourceEmailId: 'email-2',
    sourceThreadId: 'thread-1',
    existingTasks: [task()],
    ...overrides,
  };
}

describe('dedupe keys', () => {
  it('is stable for the same email and action, regardless of case or spacing', () => {
    expect(buildDedupeKey('email-1', 'Submit  the Report')).toBe(buildDedupeKey('email-1', 'submit the report'));
  });

  it('differs across emails so the unique index only collapses true repeats', () => {
    expect(buildDedupeKey('email-1', 'Submit the report')).not.toBe(
      buildDedupeKey('email-2', 'Submit the report'),
    );
  });

  it('ignores stopwords when tokenising', () => {
    expect(tokenize('Please submit the report')).not.toContain('the');
  });
});

describe('semantic similarity', () => {
  it('scores a paraphrase highly', () => {
    const score = semanticSimilarity('Submit the project report', 'Please submit your project report today');
    expect(score).toBeGreaterThan(0.7);
  });

  it('scores unrelated actions low', () => {
    const score = semanticSimilarity('Submit the project report', 'Book a flight to Cape Town');
    expect(score).toBeLessThan(0.4);
  });
});

describe('duplicate decisions', () => {
  it('always treats a second action from the same email as a duplicate', () => {
    const decision = checkDuplicate(
      input({
        candidateTitle: 'Completely different wording here',
        sourceEmailId: 'email-1',
        existingTasks: [task({ source_email_id: 'email-1' })],
      }),
    );
    expect(decision.duplicate).toBe(true);
    expect(decision.existingTaskId).toBe('task-1');
  });

  it('collapses a re-worded follow-up in the same thread', () => {
    const decision = checkDuplicate(
      input({
        candidateTitle: 'Please submit your project report today',
        sourceEmailId: 'email-9',
        existingTasks: [task({ source_email_id: 'email-1' })],
      }),
    );
    expect(decision.duplicate).toBe(true);
    expect(decision.similarity).toBeGreaterThanOrEqual(0.72);
  });

  it('keeps genuinely different work as separate tasks', () => {
    const decision = checkDuplicate(
      input({
        candidateTitle: 'Book the venue for the conference',
        candidateDueDate: null,
        sourceEmailId: 'email-12',
        sourceThreadId: 'thread-9',
        existingTasks: [task()],
      }),
    );
    expect(decision.duplicate).toBe(false);
    expect(decision.existingTaskId).toBeNull();
  });

  it('enriches an existing task when the follow-up adds a date', () => {
    const decision = checkDuplicate(
      input({
        candidateTitle: 'Submit the project report',
        candidateDueDate: '2026-03-27',
        candidateDueTime: '17:00',
        sourceEmailId: 'email-13',
        existingTasks: [task({ due_date: null })],
      }),
    );
    expect(decision.duplicate).toBe(true);
    expect(decision.enrich).toBe(true);
    expect(decision.enrichFields).toContain('due_date');
  });

  it('does not enrich when the existing task already has the same information', () => {
    const decision = checkDuplicate(
      input({
        candidateTitle: 'Submit the project report',
        sourceEmailId: 'email-14',
        existingTasks: [task({ due_date: '2026-03-20', priority: 'HIGH' })],
      }),
    );
    expect(decision.duplicate).toBe(true);
    expect(decision.enrich).toBe(false);
  });

  it('never matches a dismissed task again', () => {
    const decision = checkDuplicate(
      input({
        candidateTitle: 'Submit the project report',
        sourceEmailId: 'email-15',
        existingTasks: [task({ status: 'DISMISSED' })],
      }),
    );
    expect(decision.duplicate).toBe(false);
  });
});
