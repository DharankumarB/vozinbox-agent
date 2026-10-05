import { getZonedParts, safeTimezone } from '@/lib/analysis/dates';

/** Time-of-day greeting in the user's own timezone (§6). */
export function greeting(timezone: string, now: Date = new Date()): string {
  const { hour } = getZonedParts(now, safeTimezone(timezone));
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  if (hour < 21) return 'Good evening';
  return 'Good evening';
}
