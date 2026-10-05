import { describe, expect, it } from 'vitest';
import { parseSearchQuery, toInboxQueryInput } from '@/lib/search/query-parser';
import { zonedAnchor, zonedTo } from '@/lib/search/zones';

/** §18, §47, §48 — natural-language search becomes structured, explainable filters. */

const ANCHOR = zonedAnchor('Africa/Johannesburg', new Date('2026-03-10T07:00:00.000Z'));

function parse(query: string) {
  return parseSearchQuery(query, ANCHOR);
}

describe('timezone anchor', () => {
  it('derives the user’s local date from the instant', () => {
    expect(ANCHOR.today).toBe('2026-03-10');
    expect(ANCHOR.weekday).toBe(2);
  });

  it('offsets days within the user timezone', () => {
    expect(zonedTo(ANCHOR, 0)).toBe('2026-03-10');
    expect(zonedTo(ANCHOR, 4)).toBe('2026-03-14');
  });
});

describe('filter phrases', () => {
  it('understands unread', () => {
    const parsed = parse('unread emails from my professor');
    expect(parsed.unreadOnly).toBe(true);
    expect(parsed.filter).toBe('UNREAD');
    // "professor" is a college signal, so it becomes a category filter.
    expect(parsed.category).toBe('COLLEGE');
  });

  it('understands "deadlines this week" as a date window', () => {
    const parsed = parse('deadlines this week');
    expect(parsed.deadlineFrom).toBe('2026-03-10');
    expect(parsed.deadlineTo).toBe('2026-03-15'); // the Sunday of this week
    expect(parsed.filter).toBe('DEADLINES');
  });

  it('understands "today"', () => {
    const parsed = parse('what needs action today');
    expect(parsed.deadlineFrom).toBe('2026-03-10');
    expect(parsed.deadlineTo).toBe('2026-03-10');
    expect(parsed.actionRequired).toBe(true);
    expect(parsed.filter).toBe('ACTION_REQUIRED');
  });

  it('understands priority words', () => {
    expect(parse('high priority invoices').priority).toBe('HIGH');
    expect(parse('urgent items').priority).toBe('HIGH');
    expect(parse('critical items').priority).toBe('CRITICAL');
    expect(parse('low priority newsletters').priority).toBe('LOW');
  });

  it('understands category words', () => {
    expect(parse('invoices from the finance team').category).toBe('FINANCE');
    expect(parse('meeting invitations').category).toBe('MEETING');
    expect(parse('assignment submissions').category).toBe('ASSIGNMENT');
  });

  it('understands action-required phrasing', () => {
    expect(parse('emails that need my action').actionRequired).toBe(true);
    expect(parse('anything needing action today').actionRequired).toBe(true);
    expect(parse('waiting for my reply').actionRequired).toBe(true);
  });

  it('understands sender-scoped phrases', () => {
    const parsed = parse('emails from naledi@example.org');
    expect(parsed.text?.toLowerCase()).toContain('naledi@example.org');
  });
});

describe('sorting', () => {
  it('maps "soonest" and "oldest" to the right orders', () => {
    expect(parse('soonest deadlines').sort).toBe('DEADLINE_SOONEST');
    expect(parse('oldest emails').sort).toBe('OLDEST');
    expect(parse('newest first').sort).toBe('NEWEST');
    expect(parse('unread first').sort).toBe('UNREAD_FIRST');
    expect(parse('action required first').sort).toBe('ACTION_REQUIRED_FIRST');
  });

  it('defaults to newest and explains itself', () => {
    const parsed = parse('report');
    expect(parsed.sort).toBe('NEWEST');
    expect(parsed.interpretation.length).toBeGreaterThan(0);
  });
});

describe('interpretation and safety', () => {
  it('always returns a human-readable interpretation', () => {
    for (const query of ['unread emails', 'deadlines this week', 'nonsense query ', 'invoices']) {
      expect(parse(query).interpretation.length).toBeGreaterThan(0);
    }
  });

  it('keeps unknown text as free-text search rather than dropping it', () => {
    const parsed = parse('quarterly budget reconciliation');
    expect(parsed.text).toContain('quarterly budget reconciliation');
  });

  it('handles an empty query without inventing filters', () => {
    const parsed = parse('   ');
    expect(parsed.deadlineFrom).toBeNull();
    expect(parsed.category).toBeNull();
    expect(parsed.priority).toBeNull();
    expect(parsed.unreadOnly).toBe(false);
  });

  it('never produces an unbounded or negative limit', () => {
    const query = toInboxQueryInput(parse('unread'), 'user-1', { limit: 25, offset: 0 });
    expect(query.limit).toBe(25);
    expect(query.offset).toBe(0);
    expect(query.userId).toBe('user-1');
  });
});
