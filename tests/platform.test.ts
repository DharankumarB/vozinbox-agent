import { beforeEach, describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, isEncryptionConfigured, redactSecrets } from '@/lib/crypto';
import { RATE_LIMITS, checkRateLimit, clientIdentifier, enforceRateLimit, resetRateLimits } from '@/lib/rate-limit';
import { AppError } from '@/lib/errors';
import { absoluteTime, initials, percent, pluralise, relativeTime, truncate } from '@/lib/utils';

/** §24, §31, §42 — token encryption and rate limiting. */

describe('token encryption (§24, §31)', () => {
  beforeEach(() => {
    process.env.TOKEN_ENCRYPTION_KEY = 'uJq0m2C5mS1oY3fT8xW4nR7pL2bE6vK9dH0aQ4zX1cS=';
  });

  it('is configured when a key is present', () => {
    expect(isEncryptionConfigured()).toBe(true);
  });

  it('round-trips a token', () => {
    const token = 'ya29.a0AfH6SMB_example_refresh_token';
    const sealed = encryptSecret(token);
    expect(sealed).not.toContain(token);
    expect(decryptSecret(sealed)).toBe(token);
  });

  it('produces a different ciphertext each time (unique IV)', () => {
    expect(encryptSecret('same-value')).not.toBe(encryptSecret('same-value'));
  });

  it('refuses to decrypt tampered ciphertext', () => {
    const sealed = encryptSecret('refresh-token');
    const tampered = `${sealed.slice(0, -4)}AAAA`;
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it('refuses to decrypt with a different key', () => {
    const sealed = encryptSecret('refresh-token');
    process.env.TOKEN_ENCRYPTION_KEY = 'aGVsbG8td29ybGQtdGhpcy1pcy1hbm90aGVyLWtleSE=';
    expect(() => decryptSecret(sealed)).toThrow();
  });

  it('reports a clear error when no key is configured', () => {
    delete process.env.TOKEN_ENCRYPTION_KEY;
    expect(isEncryptionConfigured()).toBe(false);
    expect(() => encryptSecret('x')).toThrow(AppError);
  });

  it('never lets a secret reach a log line', () => {
    const raw = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature';
    expect(redactSecrets(raw)).not.toContain('payload');
  });
});

describe('rate limiting (§42)', () => {
  beforeEach(() => {
    resetRateLimits();
  });

  it('allows requests up to the configured limit and then blocks', () => {
    const limit = RATE_LIMITS.aiChat.limit;
    for (let index = 0; index < limit; index += 1) {
      expect(checkRateLimit('aiChat', 'user-1').allowed).toBe(true);
    }
    const blocked = checkRateLimit('aiChat', 'user-1');
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it('keeps buckets separate per identifier', () => {
    for (let index = 0; index < RATE_LIMITS.aiChat.limit; index += 1) {
      checkRateLimit('aiChat', 'user-1');
    }
    expect(checkRateLimit('aiChat', 'user-1').allowed).toBe(false);
    expect(checkRateLimit('aiChat', 'user-2').allowed).toBe(true);
  });

  it('keeps buckets separate per rule', () => {
    for (let index = 0; index < RATE_LIMITS.aiChat.limit; index += 1) {
      checkRateLimit('aiChat', 'user-1');
    }
    expect(checkRateLimit('sync', 'user-1').allowed).toBe(true);
  });

  it('throws a retryable AppError when enforcing', () => {
    for (let index = 0; index < RATE_LIMITS.sync.limit; index += 1) {
      enforceRateLimit('sync', 'user-1');
    }
    expect(() => enforceRateLimit('sync', 'user-1')).toThrow(AppError);
  });

  it('falls back to the forwarded IP for anonymous requests', () => {
    const headers = new Headers({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' });
    expect(clientIdentifier(headers)).toBe('ip:203.0.113.9');
    expect(clientIdentifier(new Headers())).toBe('ip:unknown');
  });

  it('prefers the authenticated user over the IP', () => {
    const headers = new Headers({ 'x-forwarded-for': '203.0.113.9' });
    expect(clientIdentifier(headers, 'user-42')).toBe('user:user-42');
  });
});

describe('presentation helpers', () => {
  const now = new Date('2026-03-10T09:00:00.000Z');

  it('renders relative times that never look like precision they lack', () => {
    expect(relativeTime('2026-03-10T08:59:30.000Z', now)).toMatch(/just now|second/);
    expect(relativeTime('2026-03-10T08:30:00.000Z', now)).toContain('30 minute');
    expect(relativeTime('2026-03-09T09:00:00.000Z', now)).toContain('yesterday');
    expect(relativeTime(null, now)).toBe('');
  });

  it('formats absolute times in the user timezone', () => {
    const formatted = absoluteTime('2026-03-10T09:00:00.000Z', 'Africa/Johannesburg');
    expect(formatted).toContain('2026');
    expect(formatted).toContain('11:00');
  });

  it('derives initials safely', () => {
    expect(initials('Naledi Mokoena')).toBe('NM');
    expect(initials('')).toBe('?');
    expect(initials(null, '?')).toBe('?');
  });

  it('formats percentages without pretending to be exact', () => {
    expect(percent(0.87)).toBe('87%');
    expect(percent(null)).toBe('—');
  });

  it('pluralises nouns', () => {
    expect(pluralise(1, 'message')).toBe('message');
    expect(pluralise(3, 'message')).toBe('messages');
    expect(pluralise(2, 'person', 'people')).toBe('people');
  });

  it('truncates long values and leaves short ones alone', () => {
    expect(truncate('abcdefghij', 4)).toBe('abc…');
    expect(truncate('short', 10)).toBe('short');
  });
});
