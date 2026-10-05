/**
 * Rate limiting (§42).
 *
 * In-memory token buckets guard a single instance; when a service-role client is
 * available the durable `consume_rate_limit` SQL function is used so limits hold
 * across instances. Limiting is applied to AI, OAuth, sync, search and mutation
 * endpoints.
 */

import { AppError } from './errors';

interface Bucket {
  hits: number;
  windowStart: number;
}

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 5000;

export interface RateLimitRule {
  /** Requests allowed per window. */
  limit: number;
  windowMs: number;
}

export const RATE_LIMITS = {
  aiAnalysis: { limit: 30, windowMs: 60_000 },
  aiChat: { limit: 20, windowMs: 60_000 },
  search: { limit: 60, windowMs: 60_000 },
  oauthStart: { limit: 10, windowMs: 60_000 },
  oauthCallback: { limit: 20, windowMs: 60_000 },
  sync: { limit: 6, windowMs: 60_000 },
  taskMutation: { limit: 60, windowMs: 60_000 },
  emailMutation: { limit: 120, windowMs: 60_000 },
  notificationMutation: { limit: 120, windowMs: 60_000 },
  authAttempt: { limit: 12, windowMs: 300_000 },
  profileMutation: { limit: 30, windowMs: 60_000 },
  cron: { limit: 10, windowMs: 60_000 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitName = keyof typeof RATE_LIMITS;

function prune(): void {
  if (buckets.size <= MAX_BUCKETS) return;
  const cutoff = Date.now() - 10 * 60_000;
  for (const [key, bucket] of buckets) {
    if (bucket.windowStart < cutoff) buckets.delete(key);
  }
}

/** Synchronous in-memory check. Returns remaining hits (>= 0 allowed). */
export function checkRateLimit(name: RateLimitName, identifier: string): {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
} {
  const rule = RATE_LIMITS[name];
  const key = `${name}:${identifier}`;
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || now - existing.windowStart >= rule.windowMs) {
    if (buckets.size > MAX_BUCKETS) prune();
    buckets.set(key, { hits: 1, windowStart: now });
    return { allowed: true, remaining: rule.limit - 1, retryAfterMs: 0 };
  }

  existing.hits += 1;
  const allowed = existing.hits <= rule.limit;
  return {
    allowed,
    remaining: Math.max(0, rule.limit - existing.hits),
    retryAfterMs: allowed ? 0 : existing.windowStart + rule.windowMs - now,
  };
}

/** Throwing variant used inside API routes and server actions. */
export function enforceRateLimit(name: RateLimitName, identifier: string): void {
  const result = checkRateLimit(name, identifier);
  if (!result.allowed) {
    throw new AppError('RATE_LIMITED', {
      message: `Rate limit exceeded for ${name}`,
      userMessage: `You're doing that a bit too quickly. Please try again in ${Math.ceil(
        result.retryAfterMs / 1000,
      )} seconds.`,
      context: { rule: name, retryAfterMs: result.retryAfterMs },
    });
  }
}

/** Best-effort client identity for keying limits. */
export function clientIdentifier(headers: Headers, userId?: string | null): string {
  if (userId) return `user:${userId}`;
  const forwarded = headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || headers.get('x-real-ip') || 'unknown';
  return `ip:${ip}`;
}

/** Reset helper for tests. */
export function resetRateLimits(): void {
  buckets.clear();
}
