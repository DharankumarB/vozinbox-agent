/**
 * Natural-language inbox search (§18).
 *
 * Deterministic first: the phrasing users actually type ("deadlines this week",
 * "high-priority unread", "emails from my professors") is mapped to structured
 * filters without spending an AI call. When the parser cannot classify a query it
 * degrades to a plain full-text search over the stored message content.
 *
 * The interpretation is returned to the UI so the user can see how their words
 * were understood — and correct it with advanced filters if needed.
 */

import type { InboxFilter, InboxSort, EmailCategory, EmailPriority } from '@/lib/types/domain';
import { zonedTo, type ZonedAnchor } from './zones';

export interface ParsedSearch {
  /** Free-text portion that should be matched against message content. */
  text: string | null;
  filter: InboxFilter;
  sort: InboxSort;
  category: EmailCategory | null;
  priority: EmailPriority | null;
  actionRequired: boolean | null;
  unreadOnly: boolean;
  deadlineFrom: string | null;
  deadlineTo: string | null;
  /** Plain-language explanation shown above the results. */
  interpretation: string;
}

const CATEGORY_KEYWORDS: Array<{ pattern: RegExp; category: EmailCategory; label: string }> = [
  { pattern: /\bassignments?\b|\bhomework\b|\bsubmissions?\b/i, category: 'ASSIGNMENT', label: 'assignments' },
  { pattern: /\bmeetings?\b|\bcalls?\b|\bstandups?\b|\binterviews?\b/i, category: 'MEETING', label: 'meetings' },
  { pattern: /\bprojects?\b/i, category: 'PROJECT', label: 'projects' },
  { pattern: /\b(?:events?|webinars?|workshops?|seminars?)\b/i, category: 'EVENT', label: 'events' },
  { pattern: /\b(?:college|university|class|classes|professors?|faculty|lectures?)\b/i, category: 'COLLEGE', label: 'college email' },
  { pattern: /\b(?:work|office|clients?|manager)\b/i, category: 'WORK', label: 'work email' },
  { pattern: /\b(?:personal|family|friends?)\b/i, category: 'PERSONAL', label: 'personal email' },
  { pattern: /\b(?:finance|finances|invoices?|payments?|bills?)\b/i, category: 'FINANCE', label: 'finance email' },
  { pattern: /\b(?:promotions?|promotional|offers?|deals?|marketing)\b/i, category: 'PROMOTIONAL', label: 'promotions' },
  { pattern: /\bspam\b|\bjunk\b/i, category: 'SPAM', label: 'spam' },
  { pattern: /\b(?:information|informational|fyi|updates?)\b/i, category: 'INFORMATION', label: 'informational email' },
];

const PRIORITY_KEYWORDS: Array<{ pattern: RegExp; priority: EmailPriority; label: string }> = [
  { pattern: /\bcritical\b|\bmost important\b/i, priority: 'CRITICAL', label: 'critical' },
  { pattern: /\bhigh[\s-]?priority\b|\burgent\b|\bimportant\b/i, priority: 'HIGH', label: 'high priority' },
  { pattern: /\bmedium[\s-]?priority\b/i, priority: 'MEDIUM', label: 'medium priority' },
  { pattern: /\blow[\s-]?priority\b/i, priority: 'LOW', label: 'low priority' },
];

/** Words that carry no search value on their own. */
const STOPWORDS = new Set([
  'show', 'me', 'my', 'all', 'the', 'a', 'an', 'emails', 'email', 'messages', 'message',
  'which', 'what', 'that', 'with', 'have', 'has', 'from', 'in', 'this', 'of', 'to', 'do',
  'i', 'need', 'any', 'are', 'is', 'please', 'find', 'list', 'get', 'give', 'recent',
  'and', 'or', 'for', 'on', 'at', 'it', 'them', 'there', 'their',
  'anything', 'something', 'everything', 'needing', 'needs', 'needed', 'waiting', 'wait',
]);

export function parseSearchQuery(rawQuery: string, anchor: ZonedAnchor): ParsedSearch {
  const query = rawQuery.trim();
  const lower = query.toLowerCase();

  const interpretations: string[] = [];
  let filter: InboxFilter = 'ALL';
  let sort: InboxSort = 'NEWEST';
  let category: EmailCategory | null = null;
  let priority: EmailPriority | null = null;
  let actionRequired: boolean | null = null;
  let unreadOnly = false;
  let deadlineFrom: string | null = null;
  let deadlineTo: string | null = null;

  // ── Time windows ───────────────────────────────────────────────────────────
  const window = detectTimeWindow(lower, anchor);
  if (window) {
    deadlineFrom = window.from;
    deadlineTo = window.to;
    interpretations.push(`with deadlines ${window.label}`);
  }

  // ── Deadlines / pending actions / unread ───────────────────────────────────
  if (/\bdeadlines?\b|\bdue\b/i.test(lower)) {
    filter = 'DEADLINES';
    // The time window (if any) already explains the deadline scope, so only add
    // the generic qualifier when no window was recognised.
    if (!interpretations.some((entry) => entry.startsWith('with deadlines'))) {
      interpretations.push('with a detected deadline');
    }
  }

  if (
    /\b(?:pending actions?|action required|action (?:is )?(?:needed|required)|needing (?:my |your )?action)\b/i.test(
      lower,
    ) ||
    /\bneed(?:s|ed|ing)?\s+(?:my|your|any|some)?\s*(?:action|attention|reply|response|input|approval)\b/i.test(lower) ||
    /\bto do\b|\btodo\b|\brequires? (?:a )?(?:reply|response)\b/i.test(lower)
  ) {
    actionRequired = true;
    filter = 'ACTION_REQUIRED';
    interpretations.push('action required');
  }

  if (/\b(?:where i (?:need|have) to reply|need to reply|awaiting (?:my )?(?:reply|response)|waiting for (?:my )?reply)\b/i.test(lower)) {
    actionRequired = true;
    filter = 'ACTION_REQUIRED';
    interpretations.push('awaiting your reply');
  }

  if (/\bunread\b|\bnot read\b|\bnew\b/i.test(lower)) {
    unreadOnly = true;
    filter = filter === 'ALL' ? 'UNREAD' : filter;
    interpretations.push('unread');
  }

  // ── Category ───────────────────────────────────────────────────────────────
  for (const entry of CATEGORY_KEYWORDS) {
    if (entry.pattern.test(lower)) {
      category = entry.category;
      interpretations.push(`categorised as ${entry.label}`);
      break;
    }
  }

  // ── Priority ───────────────────────────────────────────────────────────────
  for (const entry of PRIORITY_KEYWORDS) {
    if (entry.pattern.test(lower)) {
      priority = entry.priority;
      if (entry.priority === 'HIGH' || entry.priority === 'CRITICAL') {
        filter = filter === 'ALL' || filter === 'DEADLINES' ? 'HIGH_PRIORITY' : filter;
      }
      interpretations.push(entry.label.endsWith('priority') ? entry.label : `${entry.label} priority`);
      break;
    }
  }

  // ── Sorting ────────────────────────────────────────────────────────────────
  if (/\bsoonest\b|\bfirst due\b|\bdeadline soonest\b/i.test(lower)) {
    sort = 'DEADLINE_SOONEST';
    interpretations.push('soonest first');
  } else if (/\boldest\b/i.test(lower)) {
    sort = 'OLDEST';
  } else if (/\bmost important\b|\bhighest priority\b/i.test(lower)) {
    sort = 'HIGHEST_PRIORITY';
  } else if (/\bunread first\b|\bunread on top\b/i.test(lower)) {
    sort = 'UNREAD_FIRST';
    interpretations.push('unread first');
  } else if (/\baction (?:required|needed) first\b/i.test(lower)) {
    sort = 'ACTION_REQUIRED_FIRST';
    interpretations.push('action required first');
  }

  // ── Residual free text ─────────────────────────────────────────────────────
  const text = extractFreeText(query);

  if (interpretations.length === 0 && !text) {
    return {
      text: query.length > 0 ? query : null,
      filter: 'ALL',
      sort,
      category,
      priority,
      actionRequired,
      unreadOnly,
      deadlineFrom,
      deadlineTo,
      interpretation: 'Searching the full text of your inbox.',
    };
  }

  const qualifiers = [...new Set(interpretations)];
  const interpretation =
    qualifiers.length > 0 || text
      ? `Showing email${text ? ` matching “${text}”` : ''}${
          qualifiers.length > 0 ? ` — ${qualifiers.join(', ')}` : ''
        }.`
      : 'Searching the full text of your inbox.';

  return {
    text,
    filter,
    sort,
    category,
    priority,
    actionRequired,
    unreadOnly,
    deadlineFrom,
    deadlineTo,
    interpretation,
  };
}

interface Window {
  from: string;
  to: string;
  label: string;
}

function detectTimeWindow(lower: string, anchor: ZonedAnchor): Window | null {
  if (/\btoday\b/.test(lower)) {
    return { from: anchor.today, to: anchor.today, label: 'due today' };
  }
  if (/\btomorrow\b/.test(lower)) {
    return { from: anchor.tomorrow, to: anchor.tomorrow, label: 'due tomorrow' };
  }
  if (/\bthis week\b|\bend of (?:the )?week\b|\bthis week's\b/.test(lower)) {
    return { from: anchor.today, to: anchor.endOfWeek, label: 'due this week' };
  }
  if (/\bnext week\b/.test(lower)) {
    return { from: anchor.startOfNextWeek, to: anchor.endOfNextWeek, label: 'due next week' };
  }
  if (/\bthis month\b/.test(lower)) {
    return { from: anchor.today, to: anchor.endOfMonth, label: 'due this month' };
  }
  if (/\b(?:overdue|past due|missed)\b/.test(lower)) {
    return { from: anchor.sixtyDaysAgo, to: anchor.yesterday, label: 'overdue' };
  }
  if (/\bfortnight\b|\bnext two weeks\b|\bnext 14 days\b/.test(lower)) {
    return { from: anchor.today, to: zonedTo(anchor, 14), label: 'due in the next two weeks' };
  }
  if (/\bthis month\b|\bnext 30 days\b/.test(lower)) {
    return { from: anchor.today, to: zonedTo(anchor, 30), label: 'due in the next 30 days' };
  }
  return null;
}

function extractFreeText(query: string): string | null {
  const cleaned = query
    .replace(/[?!.,;:]+$/g, '')
    .split(/\s+/)
    .filter((word) => {
      const lower = word.toLowerCase();
      if (STOPWORDS.has(lower)) return false;
      // Drop phrases the structured filters already consumed (including the
      // time-window vocabulary), so the residual text stays meaningful.
      if (
        /^(deadlines?|due|unread|urgent|important|critical|high|low|medium|priority|action|required|reply|assignments?|meetings?|projects?|events?|spam|promotions?|college|university|professors?|finance|invoices?|payments?)$/i.test(
          lower,
        )
      ) {
        return false;
      }
      if (/^(today|tomorrow|yesterday|tonight|week|weeks|weekend|month|months|fortnight|overdue|soonest|oldest|first|upcoming|past)$/i.test(lower)) {
        return false;
      }
      return true;
    })
    .join(' ')
    .trim();

  return cleaned.length >= 2 ? cleaned.slice(0, 120) : null;
}

/** Map a parsed query onto the store query shape. */
export function toInboxQueryInput(
  parsed: ParsedSearch,
  userId: string,
  options: { limit?: number; offset?: number } = {},
) {
  return {
    userId,
    filter: parsed.filter,
    sort: parsed.sort,
    search: parsed.text,
    category: parsed.category,
    priority: parsed.priority,
    actionRequired: parsed.actionRequired,
    isRead: parsed.unreadOnly ? false : null,
    deadlineFrom: parsed.deadlineFrom,
    deadlineTo: parsed.deadlineTo,
    limit: options.limit ?? 25,
    offset: options.offset ?? 0,
  };
}
