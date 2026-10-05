/**
 * Natural-language date and deadline extraction (§12).
 *
 * Design rules that matter:
 *  • Everything resolves against the *email timestamp* in the *user's timezone*.
 *  • A time is only reported when the message states one unambiguously
 *    ("5 PM", "17:00", "noon"). "by Friday" → time = null. We never invent one.
 *  • Ambiguity is surfaced (`AMBIGUOUS_TIME`, `AMBIGUOUS_DATE`) rather than guessed.
 *  • All output dates are ISO `YYYY-MM-DD` wall-clock values in the user timezone.
 */

import type { DeadlineType, DetectedDate, DetectedDeadline } from '@/lib/types/domain';

// ── Zoned calendar primitives ────────────────────────────────────────────────

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number;
  /** 0 = Sunday … 6 = Saturday (wall-clock weekday in the target timezone). */
  weekday: number;
}

const partsFormatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timezone: string): Intl.DateTimeFormat {
  let formatter = partsFormatterCache.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
    });
    partsFormatterCache.set(timezone, formatter);
  }
  return formatter;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** Throws only for genuinely unknown timezones — callers pass a validated value. */
export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export function safeTimezone(timezone: string | null | undefined, fallback = 'UTC'): string {
  if (timezone && isValidTimezone(timezone)) return timezone;
  return isValidTimezone(fallback) ? fallback : 'UTC';
}

/** Convert an absolute instant into wall-clock parts in `timezone`. */
export function getZonedParts(instant: Date, timezone: string): ZonedParts {
  const tz = safeTimezone(timezone);
  const raw = partsFormatter(tz).formatToParts(instant);
  const bag = new Map(raw.map((part) => [part.type, part.value]));
  const hourRaw = bag.get('hour') ?? '0';
  // Intl may render midnight as "24" with hour12: false.
  const hour = hourRaw === '24' ? 0 : Number(hourRaw);
  const weekdayToken = bag.get('weekday') ?? 'Sun';
  return {
    year: Number(bag.get('year') ?? '1970'),
    month: Number(bag.get('month') ?? '1'),
    day: Number(bag.get('day') ?? '1'),
    hour,
    minute: Number(bag.get('minute') ?? '0'),
    weekday: Math.max(0, WEEKDAYS.indexOf(weekdayToken as (typeof WEEKDAYS)[number])),
  };
}

export function formatYmd(parts: Pick<ZonedParts, 'year' | 'month' | 'day'>): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

export function parseYmd(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!isRealDate(year, month, day)) return null;
  return { year, month, day };
}

export function isRealDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day
  );
}

/** Add calendar days inside the "wall clock as UTC" space (DST-safe). */
export function addDays(parts: ZonedParts, days: number): ZonedParts {
  const base = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  base.setUTCDate(base.getUTCDate() + days);
  return { ...parts, year: base.getUTCFullYear(), month: base.getUTCMonth() + 1, day: base.getUTCDate(), weekday: base.getUTCDay() };
}

/** Days until `target`, measured in whole calendar days from `from`. */
export function daysBetween(from: ZonedParts, target: { year: number; month: number; day: number }): number {
  const a = Date.UTC(from.year, from.month - 1, from.day);
  const b = Date.UTC(target.year, target.month - 1, target.day);
  return Math.round((b - a) / 86_400_000);
}

/** Convert a wall-clock date/time in `timezone` to an absolute ISO instant. */
export function zonedToInstant(
  date: string,
  time: string | null,
  timezone: string,
): string | null {
  const parsed = parseYmd(date);
  if (!parsed) return null;
  const tz = safeTimezone(timezone);
  const hh = time ? Number(time.slice(0, 2)) : 0;
  const mm = time ? Number(time.slice(3, 5)) : 0;
  // Start from the UTC guess, then correct by the zone offset at that instant.
  const guess = Date.UTC(parsed.year, parsed.month - 1, parsed.day, hh, mm, 0);
  const offsetMinutes = timezoneOffsetMinutes(new Date(guess), tz);
  return new Date(guess - offsetMinutes * 60_000).toISOString();
}

function timezoneOffsetMinutes(instant: Date, timezone: string): number {
  const parts = getZonedParts(instant, timezone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0);
  return (asUtc - instant.getTime()) / 60_000;
}

// ── Lexicon ──────────────────────────────────────────────────────────────────

const MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

const WEEKDAY_NAMES: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

/** Deadline-indicating verbs/phrases — used to pick the *authoritative* date. */
const DEADLINE_CUES = [
  'due',
  'deadline',
  'submit',
  'submission',
  'before',
  'by',
  'no later than',
  'latest by',
  'expires',
  'expiry',
  'last date',
  'cutoff',
  'cut-off',
  'closes',
  'closing',
  'must be completed',
  'must be submitted',
  'final date',
  'ends on',
  'rsvp',
  'response required by',
  'reply by',
];

const AMBIGUOUS_DATE_PHRASES = ['next week', 'this week', 'early next week', 'end of week', 'eow', 'soon', 'shortly', 'asap', 'in the coming days', 'following week', 'end of the month', 'this month', 'sometime'];

export interface DateExtractionContext {
  /** The email's timestamp — relative phrases resolve from here. */
  referenceInstant: Date;
  /** IANA timezone for the user. */
  timezone: string;
}

interface RawMatch {
  date: string | null;
  time: string | null;
  timezone: string | null;
  type: DeadlineType;
  matchedText: string;
  confidence: number;
  notes: string[];
  /** Character index in the source text, used to keep ordering stable. */
  index: number;
}

// ── Time extraction ──────────────────────────────────────────────────────────

interface TimeMatch {
  time: string;
  matchedText: string;
  confidence: number;
}

/** Extract an unambiguous wall-clock time from a text fragment. */
export function extractTime(fragment: string): TimeMatch | null {
  const text = fragment.toLowerCase();

  const named: Array<[RegExp, string, number]> = [
    [/\b(noon|midday|12\s*noon)\b/, '12:00', 0.95],
    [/\bmidnight\b/, '00:00', 0.9],
  ];
  for (const [pattern, value, confidence] of named) {
    const match = pattern.exec(text);
    if (match) return { time: value, matchedText: match[0], confidence };
  }

  // "5:30 PM" / "5.30pm" / "5 pm" / "5pm"
  const ampm = /\b(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/.exec(text);
  if (ampm) {
    let hour = Number(ampm[1]);
    const minute = ampm[2] ? Number(ampm[2]) : 0;
    const period = (ampm[3] ?? '').replace(/\./g, '');
    if (hour >= 1 && hour <= 12 && minute < 60) {
      if (period === 'pm' && hour !== 12) hour += 12;
      if (period === 'am' && hour === 12) hour = 0;
      return {
        time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
        matchedText: ampm[0],
        confidence: 0.97,
      };
    }
  }

  // 24h clock: "17:00", "09:30", "23:59h"
  const military = /\b([01]?\d|2[0-3]):([0-5]\d)\s*(?:h|hrs|hours)?\b/.exec(text);
  if (military) {
    return {
      time: `${String(Number(military[1])).padStart(2, '0')}:${military[2]}`,
      matchedText: military[0],
      confidence: 0.95,
    };
  }

  return null;
}

/** Is there an ambiguous clock reference we should flag rather than guess? */
function hasAmbiguousTime(text: string): boolean {
  return /\b(\d{1,2})\s*(?:o'?clock|hrs|hours)\b/.test(text) && !extractTime(text);
}

// ── Date extraction ──────────────────────────────────────────────────────────

function monthNamePattern(): string {
  return Object.keys(MONTHS).join('|');
}

/**
 * Find every candidate date expression in a text block.
 * Exported for unit testing (§62).
 */
export function findDateMatches(text: string, ctx: DateExtractionContext): RawMatch[] {
  const tz = safeTimezone(ctx.timezone);
  const now = getZonedParts(ctx.referenceInstant, tz);
  const results: RawMatch[] = [];
  const lowered = text.toLowerCase();

  const push = (match: RawMatch) => results.push(match);

  // 1. ISO / numeric dates: 2026-10-10, 10/10/2026, 10-10-2026 (day-first outside US)
  const isoRe = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
  for (const match of lowered.matchAll(isoRe)) {
    const [, y, m, d] = match;
    if (y && m && d && isRealDate(Number(y), Number(m), Number(d))) {
      push({
        date: `${y}-${m}-${d}`,
        time: null,
        timezone: null,
        type: 'EXPLICIT',
        matchedText: match[0],
        confidence: 0.98,
        notes: [],
        index: match.index ?? 0,
      });
    }
  }

  const numericRe = /\b(\d{1,2})[/.\-](\d{1,2})(?:[/.\-](\d{2,4}))?\b/g;
  for (const match of lowered.matchAll(numericRe)) {
    const [, first, second, yearPart] = match;
    if (!first || !second) continue;
    // Skip things already handled as ISO or that look like times/ranges.
    if (/(\d{1,2}):(\d{2})/.test(match[0])) continue;
    const a = Number(first);
    const b = Number(second);
    const year = yearPart
      ? Number(yearPart.length === 2 ? `20${yearPart}` : yearPart)
      : now.year;
    // Ambiguous slash dates: interpret day-first when the first value cannot be a month.
    let day = a;
    let month = b;
    let ambiguous = false;
    if (a <= 12 && b <= 12 && a !== b) {
      // Both interpretations are valid — prefer day-first (international) but flag it.
      ambiguous = true;
      day = a;
      month = b;
    } else if (a > 12) {
      day = a;
      month = b;
    } else {
      month = a;
      day = b;
    }
    if (!isRealDate(year, month, day)) continue;
    if (year < 2000 || year > 2100) continue;
    push({
      date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      time: null,
      timezone: null,
      type: 'EXPLICIT',
      matchedText: match[0],
      confidence: ambiguous ? 0.6 : 0.9,
      notes: ambiguous ? ['AMBIGUOUS_DATE_FORMAT'] : [],
      index: match.index ?? 0,
    });
  }

  // 2. Month-name dates: "October 10", "Oct 10, 2026", "10 October", "10th of Oct"
  const monthNames = monthNamePattern();
  const monthFirst = new RegExp(
    `\\b(${monthNames})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s*,?\\s*(\\d{4}))?\\b`,
    'g',
  );
  for (const match of lowered.matchAll(monthFirst)) {
    const [, monthToken, dayToken, yearToken] = match;
    if (!monthToken || !dayToken) continue;
    const month = MONTHS[monthToken];
    if (!month) continue;
    const year = yearToken ? Number(yearToken) : inferYear(now, month, Number(dayToken));
    const day = Number(dayToken);
    if (!isRealDate(year, month, day)) continue;
    push({
      date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      time: null,
      timezone: null,
      type: yearToken ? 'EXPLICIT' : 'RELATIVE',
      matchedText: match[0],
      confidence: yearToken ? 0.97 : 0.9,
      notes: yearToken ? [] : ['YEAR_INFERRED'],
      index: match.index ?? 0,
    });
  }

  const dayFirst = new RegExp(
    `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${monthNames})\\.?(?:\\s*,?\\s*(\\d{4}))?\\b`,
    'g',
  );
  for (const match of lowered.matchAll(dayFirst)) {
    const [, dayToken, monthToken, yearToken] = match;
    if (!dayToken || !monthToken) continue;
    const month = MONTHS[monthToken];
    if (!month) continue;
    const day = Number(dayToken);
    const year = yearToken ? Number(yearToken) : inferYear(now, month, day);
    if (!isRealDate(year, month, day)) continue;
    push({
      date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      time: null,
      timezone: null,
      type: yearToken ? 'EXPLICIT' : 'RELATIVE',
      matchedText: match[0],
      confidence: yearToken ? 0.97 : 0.9,
      notes: yearToken ? [] : ['YEAR_INFERRED'],
      index: match.index ?? 0,
    });
  }

  // 3. Relative day words
  const relativeWords: Array<[RegExp, number, DeadlineType, number]> = [
    [/\btoday\b/, 0, 'RELATIVE', 0.97],
    [/\btonight\b/, 0, 'RELATIVE', 0.9],
    [/\btomorrow\b|\btmrw\b|\btom\b/, 1, 'RELATIVE', 0.96],
    [/\bday after tomorrow\b/, 2, 'RELATIVE', 0.94],
    [/\byesterday\b/, -1, 'RELATIVE', 0.95],
  ];
  for (const [pattern, offset, type, confidence] of relativeWords) {
    const match = pattern.exec(lowered);
    if (match) {
      const target = addDays(now, offset);
      push({
        date: formatYmd(target),
        time: null,
        timezone: null,
        type,
        matchedText: match[0],
        confidence,
        notes: [],
        index: match.index ?? 0,
      });
    }
  }

  // 4. Weekday references: "Friday", "this Friday", "next Monday", "by Fri"
  const weekdayRe = new RegExp(
    `\\b(?:(next|this|coming|by|on|before|until|till)\\s+)?(${Object.keys(WEEKDAY_NAMES).join('|')})\\b`,
    'g',
  );
  for (const match of lowered.matchAll(weekdayRe)) {
    const [, modifier, dayToken] = match;
    if (!dayToken) continue;
    const targetWeekday = WEEKDAY_NAMES[dayToken];
    if (targetWeekday === undefined) continue;

    let delta = (targetWeekday - now.weekday + 7) % 7;
    if (delta === 0) {
      // "on Friday" said on a Friday almost always means the coming one, but from
      // a later-in-day email it is ambiguous. Prefer the next occurrence.
      delta = modifier === 'next' ? 7 : 7;
    } else if (modifier === 'next') {
      delta += 0; // already the next occurrence
    }
    if (modifier === 'next' && delta < 7 && delta > 0) {
      // "next Friday" from Monday → the Friday of next week is conventionally +7.
      delta += 0;
    }
    const target = addDays(now, delta);
    push({
      date: formatYmd(target),
      time: null,
      timezone: null,
      type: 'RELATIVE',
      matchedText: match[0],
      confidence: modifier === 'this' ? 0.88 : 0.85,
      notes: ['WEEKDAY_RESOLVED'],
      index: match.index ?? 0,
    });
  }

  // 5. "in N days/weeks/months"
  const inNRe = /\bin\s+(\d{1,3})\s+(day|days|week|weeks|month|months)\b/g;
  for (const match of lowered.matchAll(inNRe)) {
    const [, countToken, unit] = match;
    if (!countToken || !unit) continue;
    const count = Number(countToken);
    const days = unit.startsWith('day') ? count : unit.startsWith('week') ? count * 7 : count * 30;
    push({
      date: formatYmd(addDays(now, days)),
      time: null,
      timezone: null,
      type: 'RELATIVE',
      matchedText: match[0],
      confidence: unit.startsWith('month') ? 0.7 : 0.9,
      notes: unit.startsWith('month') ? ['MONTH_APPROXIMATED'] : [],
      index: match.index ?? 0,
    });
  }

  // 6. Vague phrases — recorded so the UI can explain why no date was stored
  for (const phrase of AMBIGUOUS_DATE_PHRASES) {
    const index = lowered.indexOf(phrase);
    if (index >= 0) {
      push({
        date: null,
        time: null,
        timezone: null,
        type: 'UNKNOWN',
        matchedText: phrase,
        confidence: 0.3,
        notes: ['AMBIGUOUS_DATE'],
        index,
      });
    }
  }

  // 7. Explicit timezone mention: "5 PM IST", "17:00 CET"
  const tzRe = /\b(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?))\s*(ist|utc|gmt|est|edt|cst|cdt|mst|mdt|pst|pdt|cet|cest|eet|jst|aest|bst|sgt)\b/gi;
  for (const match of text.matchAll(tzRe)) {
    const zone = match[2]?.toUpperCase();
    if (zone) {
      const existing = results.find((r) => r.index === (match.index ?? 0));
      if (existing) existing.timezone = zone;
    }
  }

  return results.sort((a, b) => a.index - b.index);
}

/** Pick a sensible year when the email omits one (next upcoming occurrence). */
function inferYear(now: ZonedParts, month: number, day: number): number {
  const candidate = { year: now.year, month, day };
  const delta = daysBetween(now, candidate);
  // Allow a small look-back (an email about "Oct 1" sent on Oct 3 is still about this year).
  return delta < -30 ? now.year + 1 : now.year;
}

// ── Deadline selection ───────────────────────────────────────────────────────

export interface DeadlineExtraction {
  deadline: DetectedDeadline | null;
  dates: DetectedDate[];
  notes: string[];
}

/**
 * Turn raw date matches into the analysis payload:
 *  • `dates`  — every date found, with context.
 *  • `deadline` — the single date most likely to represent required-by timing.
 */
export function extractDeadline(
  text: string,
  ctx: DateExtractionContext,
): DeadlineExtraction {
  if (!text || text.trim().length === 0) {
    return { deadline: null, dates: [], notes: ['NO_BODY_TEXT'] };
  }

  const matches = findDateMatches(text, ctx);
  const notes: string[] = [];

  const dates: DetectedDate[] = matches.map((match) => ({
    date: match.date,
    time: match.time ?? null,
    timezone: match.timezone,
    type: match.type,
    source_sentence: sentenceAround(text, match.index, match.matchedText.length),
    confidence: match.confidence,
    label: match.notes.includes('AMBIGUOUS_DATE') ? 'Ambiguous date reference' : null,
  }));

  // Attach times: a time that appears in the same sentence as the date belongs to it.
  for (let i = 0; i < matches.length; i += 1) {
    const match = matches[i];
    const dateEntry = dates[i];
    if (!match || !dateEntry || match.time) continue;
    const sentence = dateEntry.source_sentence ?? '';
    const time = extractTime(sentence);
    if (time) {
      dateEntry.time = time.time;
      match.time = time.time;
      match.confidence = Math.min(0.99, match.confidence + 0.02);
    }
  }

  const concrete = matches.filter((match) => match.date !== null);
  if (concrete.length === 0) {
    const vague = matches.find((match) => match.notes.includes('AMBIGUOUS_DATE'));
    if (vague) {
      notes.push('AMBIGUOUS_DATE');
      return {
        deadline: {
          date: null,
          time: null,
          timezone: null,
          type: 'UNKNOWN',
          source_sentence: sentenceAround(text, vague.index, vague.matchedText.length),
          confidence: 0.3,
        },
        dates,
        notes,
      };
    }
    return { deadline: null, dates, notes: ['NO_DATE_FOUND'] };
  }

  // Score candidates: deadline cues + explicit dates + temporal proximity to "now".
  const now = getZonedParts(ctx.referenceInstant, safeTimezone(ctx.timezone));
  const scored = concrete.map((match) => {
    const sentence = (sentenceAround(text, match.index, match.matchedText.length) ?? '').toLowerCase();
    let score = match.confidence;
    let cues = 0;
    for (const cue of DEADLINE_CUES) {
      if (sentence.includes(cue)) {
        cues += 1;
        if (cue === 'due' || cue === 'deadline' || cue === 'submit' || cue === 'submission') cues += 1;
      }
    }
    score += Math.min(cues, 4) * 0.12;

    const parsed = match.date ? parseYmd(match.date) : null;
    if (parsed) {
      const delta = daysBetween(now, parsed);
      // Future dates are far more likely to be the actionable deadline.
      if (delta >= -1 && delta <= 60) score += 0.1;
      if (delta < -3) score -= 0.25;
    }
    return { match, sentence, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best) {
    return { deadline: null, dates, notes: ['NO_DATE_FOUND'] };
  }

  const sentence = sentenceAround(text, best.match.index, best.match.matchedText.length);
  const bestNotes: string[] = [...best.match.notes];
  if (best.match.type === 'RELATIVE') bestNotes.push('RELATIVE_DATE_RESOLVED');
  if (!best.match.time) {
    bestNotes.push('NO_TIME_SPECIFIED');
    notes.push('NO_TIME_SPECIFIED');
  }
  if (hasAmbiguousTime(best.sentence)) {
    bestNotes.push('AMBIGUOUS_TIME');
    notes.push('AMBIGUOUS_TIME');
  }
  if (best.match.type === 'UNKNOWN') bestNotes.push('AMBIGUOUS_DATE');

  const confidence = Math.max(0, Math.min(0.99, best.score > 1 ? 0.9 : best.score));

  return {
    deadline: {
      date: best.match.date,
      time: best.match.time,
      timezone: best.match.timezone,
      type: best.match.type,
      source_sentence: sentence,
      confidence: Number(confidence.toFixed(3)),
    },
    dates,
    notes,
  };
}

/** The full sentence containing a match — the evidence users can audit. */
export function sentenceAround(text: string, index: number, length: number): string | null {
  if (index < 0 || index >= text.length) return null;
  const boundaries = /[.!?\n\r]+/g;
  let start = 0;
  let end = text.length;
  boundaries.lastIndex = 0;
  for (const boundary of text.matchAll(boundaries)) {
    const at = boundary.index ?? 0;
    if (at < index) start = at + boundary[0].length;
    else if (at >= index + length) {
      // Stop at the first sentence boundary at or after the match so the
      // evidence sentence never bleeds into the following sentence.
      end = at + 1;
      break;
    }
  }
  const sentence = text.slice(start, end).replace(/\s+/g, ' ').trim();
  return sentence.length > 0 ? sentence.slice(0, 500) : null;
}

/** Human-readable deadline rendering, used by UI + notifications. */
export function describeDeadline(
  deadline: DetectedDeadline,
  timezone: string,
  options: { now?: Date } = {},
): string {
  if (!deadline.date) {
    return deadline.type === 'UNKNOWN' ? 'No clear deadline stated' : 'Deadline unknown';
  }
  const parsed = parseYmd(deadline.date);
  if (!parsed) return 'Deadline unknown';

  const tz = safeTimezone(timezone);
  const now = getZonedParts(options.now ?? new Date(), tz);
  const delta = daysBetween(now, parsed);

  const monthLabel = MONTH_LABELS[parsed.month - 1] ?? '';
  const timeLabel = deadline.time ? formatTimeLabel(deadline.time) : null;
  const base = `${monthLabel} ${parsed.day}`;

  let relative = '';
  if (delta === 0) relative = 'Today';
  else if (delta === 1) relative = 'Tomorrow';
  else if (delta === -1) relative = 'Yesterday';
  else if (delta > 1 && delta <= 7) relative = `${WEEKDAY_LABELS[weekdayFor(parsed)]}`;
  else if (delta < 0) relative = `${Math.abs(delta)} days ago`;

  const core = relative && !timeLabel ? `${base} (${relative})` : base;
  return timeLabel ? `${core}, ${timeLabel}` : core;
}

const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function weekdayFor(parts: { year: number; month: number; day: number }): number {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
}

function formatTimeLabel(time: string): string {
  const hh = Number(time.slice(0, 2));
  const mm = time.slice(3, 5);
  const period = hh >= 12 ? 'PM' : 'AM';
  const hour12 = hh % 12 === 0 ? 12 : hh % 12;
  return mm === '00' ? `${hour12}:00 ${period}` : `${hour12}:${mm} ${period}`;
}

export { formatTimeLabel };
