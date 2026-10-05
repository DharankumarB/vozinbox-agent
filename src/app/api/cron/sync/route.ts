import { NextResponse } from 'next/server';
import { cronSecret } from '@/lib/env';
import { AppError, toAppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { getStore } from '@/lib/store';
import { syncUserAccounts } from '@/lib/services/agent';

/**
 * Optional background sync endpoint (§26).
 *
 * Protected by CRON_SECRET and intended to be called by a scheduler. Accounts
 * that are not due yet are skipped according to `sync_interval_minutes`.
 */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    const secret = cronSecret();
    const provided =
      request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
      new URL(request.url).searchParams.get('secret');

    if (!secret || provided !== secret) {
      throw new AppError('FORBIDDEN', { message: 'Invalid cron secret' });
    }

    const store = await getStore();
    const dueUsers = await findDueUsers(store);
    const results: Array<{ userId: string; summaries: unknown }> = [];

    for (const userId of dueUsers) {
      const profile = await store.getProfile(userId);
      const summaries = await syncUserAccounts({
        store,
        userId,
        timezone: profile?.timezone ?? 'UTC',
      });
      results.push({ userId, summaries });
    }

    return NextResponse.json({ ok: true, data: { processed: results.length, results } });
  } catch (error) {
    const appError = toAppError(error);
    logger.warn('cron.sync_failed', { code: appError.code, detail: appError.message });
    return NextResponse.json(appError.toResponse(), { status: appError.status });
  }
}

/**
 * Accounts whose last sync is older than their configured interval.
 * Implemented with a bounded scan so a single cron tick stays predictable.
 */
async function findDueUsers(store: Awaited<ReturnType<typeof getStore>>): Promise<string[]> {
  const now = Date.now();
  const due: string[] = [];

  // The store API is user-scoped by design; cron therefore walks a bounded set of
  // known accounts. `listAccounts` for a user is cheap, so we use the profile
  // table via a dedicated helper when available, otherwise fall back to skipping.
  const candidateUserIds = await store.listCronCandidates(25);
  for (const userId of candidateUserIds) {
    const accounts = await store.listAccounts(userId);
    const preferences = await store.getPreferences(userId);
    const intervalMs = (preferences.sync_interval_minutes ?? 15) * 60_000;
    const isDue = accounts.some((account) => {
      if (account.status !== 'CONNECTED') return false;
      if (!account.last_sync_at) return true;
      return now - Date.parse(account.last_sync_at) >= intervalMs;
    });
    if (isDue) due.push(userId);
  }

  return due;
}

export const runtime = 'nodejs';
export const maxDuration = 300;
