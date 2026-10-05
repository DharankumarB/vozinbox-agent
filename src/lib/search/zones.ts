/**
 * Calendar anchors computed in the user's timezone.
 *
 * Search phrases like "this week" must mean the user's week, not the server's.
 */

import { addDays, formatYmd, getZonedParts, type ZonedParts } from '@/lib/analysis/dates';

export interface ZonedAnchor {
  timezone: string;
  today: string;
  yesterday: string;
  tomorrow: string;
  endOfWeek: string;
  startOfNextWeek: string;
  endOfNextWeek: string;
  endOfMonth: string;
  sixtyDaysAgo: string;
  weekday: number;
  parts: ZonedParts;
}

export function zonedAnchor(timezone: string, now: Date = new Date()): ZonedAnchor {
  const parts = getZonedParts(now, timezone);
  const daysToSunday = (7 - parts.weekday) % 7;
  const endOfWeek = addDays(parts, daysToSunday);
  const startOfNextWeek = addDays(endOfWeek, 1);
  const endOfNextWeek = addDays(startOfNextWeek, 6);
  const endOfMonth = addDays(parts, daysInMonth(parts) - parts.day);

  return {
    timezone,
    today: formatYmd(parts),
    yesterday: formatYmd(addDays(parts, -1)),
    tomorrow: formatYmd(addDays(parts, 1)),
    endOfWeek: formatYmd(endOfWeek),
    startOfNextWeek: formatYmd(startOfNextWeek),
    endOfNextWeek: formatYmd(endOfNextWeek),
    endOfMonth: formatYmd(endOfMonth),
    sixtyDaysAgo: formatYmd(addDays(parts, -60)),
    weekday: parts.weekday,
    parts,
  };
}

/** A date N days after "today" in the user's timezone. */
export function zonedTo(anchor: ZonedAnchor, days: number): string {
  return formatYmd(addDays(anchor.parts, days));
}

function daysInMonth(parts: ZonedParts): number {
  return new Date(Date.UTC(parts.year, parts.month, 0)).getUTCDate();
}
