import 'server-only';

import { agentLimits } from '@/lib/env';
import { AppError, isAppError, toAppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { runEmailPipeline, type PipelineResult } from '@/lib/ai/pipeline';
import { getAccessToken } from '@/lib/integrations/accounts';
import { getGmailProfile, getMessage, listHistory, listMessageIds } from '@/lib/integrations/gmail';
import type { Email, EmailAccount, ThreadState, UserPreferences } from '@/lib/types/database';
import type { Store } from '@/lib/store/types';

/**
 * Sync + analysis orchestration (§21, §26, §32).
 *
 * Incremental by construction: Gmail's history cursor is the primary path, with
 * a date-bounded fallback when the cursor expires. Each message is written once
 * (unique `user_id + provider + provider_message_id`) and analysed once.
 */

export interface SyncSummary {
  accountId: string;
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'SKIPPED';
  fetched: number;
  created: number;
  analyzed: number;
  taskSuggestions: number;
  notifications: number;
  changes: number;
  message: string;
  failures: Array<{ providerMessageId: string; reason: string }>;
}

const MAX_FAILURES_REPORTED = 5;

export async function syncAccount(input: {
  store: Store;
  userId: string;
  account: EmailAccount;
  timezone: string;
  preferences: UserPreferences;
  limit?: number;
}): Promise<SyncSummary> {
  const { store, userId, account, timezone, preferences } = input;
  const limits = agentLimits();
  const limit = Math.min(input.limit ?? limits.maxEmailsPerSync, 100);

  const summary: SyncSummary = {
    accountId: account.id,
    status: 'SUCCESS',
    fetched: 0,
    created: 0,
    analyzed: 0,
    taskSuggestions: 0,
    notifications: 0,
    changes: 0,
    message: '',
    failures: [],
  };

  if (account.status === 'DISCONNECTED' || account.status === 'REVOKED') {
    summary.status = 'SKIPPED';
    summary.message = 'Mailbox is disconnected.';
    return summary;
  }

  await store.logAgentAction({
    user_id: userId,
    run_id: null,
    action_type: 'SYNC_STARTED',
    title: 'Inbox sync started',
    detail: account.email_address,
    tool_name: null,
    email_id: null,
    task_id: null,
    notification_id: null,
    severity: 'info',
    payload: { accountId: account.id, incremental: Boolean(account.last_history_id) },
  });

  try {
    const accessToken = await getAccessToken(store, userId, account);

    // ── 1. Which message ids are new? ────────────────────────────────────────
    let messageIds: string[] = [];
    let nextHistoryId: string | null = account.last_history_id;
    let usedFallback = false;

    if (account.last_history_id) {
      const history = await listHistory(accessToken, account.last_history_id, limit);
      if (history.expired) {
        usedFallback = true;
      } else {
        messageIds = history.newMessageIds;
        nextHistoryId = history.historyId ?? account.last_history_id;
      }
    } else {
      usedFallback = true;
    }

    if (usedFallback) {
      // Fallback: bounded by time, never a whole-mailbox download.
      const after = account.last_sync_at
        ? Math.floor(Date.parse(account.last_sync_at) / 1000) - 300
        : Math.floor(Date.now() / 1000) - 14 * 86_400;
      const listed = await listMessageIds(accessToken, {
        query: `after:${after} -in:chats`,
        maxResults: limit,
      });
      messageIds = listed.messages.map((message) => message.id);
    }

    messageIds = messageIds.slice(0, limit);
    summary.fetched = messageIds.length;

    // ── 2. Fetch, normalise and store ────────────────────────────────────────
    const touchedThreadIds = new Set<string>();
    const pendingAnalysis: Email[] = [];

    for (const messageId of messageIds) {
      try {
        const parsed = await getMessage(accessToken, messageId);

        const thread = await store.upsertThread({
          user_id: userId,
          account_id: account.id,
          provider: 'gmail',
          provider_thread_id: parsed.providerThreadId,
          subject: parsed.subject,
          participants: [
            { name: parsed.senderName, email: parsed.senderEmail },
            ...parsed.recipients,
          ],
          last_message_at: parsed.receivedAt,
          message_count: 1,
        });
        touchedThreadIds.add(thread.id);

        const email = await store.upsertEmail({
          user_id: userId,
          account_id: account.id,
          thread_id: thread.id,
          provider: 'gmail',
          provider_message_id: parsed.providerMessageId,
          provider_thread_id: parsed.providerThreadId,
          sender_name: parsed.senderName,
          sender_email: parsed.senderEmail,
          recipient: parsed.recipient,
          recipients: parsed.recipients,
          subject: parsed.subject,
          snippet: parsed.snippet,
          body_text: parsed.bodyText,
          body_html: parsed.bodyHtml,
          received_at: parsed.receivedAt,
          is_read: parsed.isRead,
          has_attachments: parsed.hasAttachments,
          attachments: parsed.attachments,
          labels: parsed.labels,
          headers: parsed.headers,
          size_estimate: parsed.sizeEstimate,
        });

        const alreadyAnalyzed = email.analysis_state === 'ANALYZED' && email.analyzed_at !== null;
        if (!alreadyAnalyzed && preferences.auto_analyze_new_emails) {
          pendingAnalysis.push(email);
        } else {
          summary.created += alreadyAnalyzed ? 0 : 1;
        }
      } catch (error) {
        const appError = toAppError(error, 'PROVIDER_ERROR');
        if (summary.failures.length < MAX_FAILURES_REPORTED) {
          summary.failures.push({ providerMessageId: messageId, reason: appError.userMessage });
        }
        logger.warn('sync.message_failed', {
          userId,
          accountId: account.id,
          messageId,
          code: appError.code,
        });
        summary.status = 'PARTIAL';
      }
    }

    // ── 3. Keep thread counters accurate ─────────────────────────────────────
    for (const threadId of touchedThreadIds) {
      try {
        const page = await store.listInbox({ userId, threadId, limit: 1, sort: 'NEWEST' });
        await store.updateThread(userId, threadId, {
          thread_state: (await store.getThread(userId, threadId))?.thread_state ?? {},
          changes_detected: (await store.getThread(userId, threadId))?.changes_detected ?? [],
          authoritative_email_id: (await store.getThread(userId, threadId))?.authoritative_email_id ?? null,
          message_count: page.total,
          last_message_at: page.items[0]?.email.received_at ?? null,
        });
      } catch (error) {
        logger.debug('sync.thread_counter_failed', { threadId, detail: toAppError(error).message });
      }
    }

    // ── 4. Analyse ───────────────────────────────────────────────────────────
    for (const email of pendingAnalysis) {
      const result = await analyzeStoredEmail({
        store,
        userId,
        email,
        preferences,
        timezone,
        trigger: 'SYNC',
      });
      if (result.status === 'FAILED') {
        summary.status = summary.status === 'SUCCESS' ? 'PARTIAL' : summary.status;
        continue;
      }
      summary.analyzed += 1;
      if (result.taskId) summary.taskSuggestions += 1;
      summary.notifications += result.notifications;
      summary.changes += result.changes.length;
      summary.created += 1;
    }

    // ── 5. Persist sync state ────────────────────────────────────────────────
    // When the cursor was absent or had expired, adopt the mailbox's current
    // historyId so the next run is incremental (§26).
    if (!nextHistoryId) {
      try {
        const profile = await getGmailProfile(accessToken);
        nextHistoryId = profile.historyId ?? null;
      } catch (error) {
        logger.warn('sync.history_id_unavailable', { accountId: account.id, detail: toAppError(error).message });
      }
    }

    await store.updateAccount(userId, account.id, {
      last_sync_at: new Date().toISOString(),
      last_sync_status: summary.status,
      last_sync_error: summary.failures.length > 0 ? summary.failures.map((failure) => failure.reason).join('; ') : null,
      last_history_id: nextHistoryId,
      status: summary.status === 'FAILED' ? 'ERROR' : 'CONNECTED',
    });

    summary.message =
      summary.fetched === 0
        ? 'No new messages.'
        : `${summary.fetched} new message(s), ${summary.analyzed} analysed.`;

    await store.logAgentAction({
      user_id: userId,
      run_id: null,
      action_type: 'SYNC_COMPLETED',
      title: 'Inbox sync completed',
      detail: summary.message,
      tool_name: null,
      email_id: null,
      task_id: null,
      notification_id: null,
      severity: summary.status === 'PARTIAL' ? 'warning' : 'info',
      payload: {
        accountId: account.id,
        fetched: summary.fetched,
        analyzed: summary.analyzed,
        failures: summary.failures.length,
      },
    });

    logger.info('sync.completed', {
      userId,
      accountId: account.id,
      status: summary.status,
      fetched: summary.fetched,
      analyzed: summary.analyzed,
      failures: summary.failures.length,
    });

    return summary;
  } catch (error) {
    const appError = toAppError(error, 'PROVIDER_ERROR');
    summary.status = 'FAILED';
    summary.message = appError.userMessage;

    await store.updateAccount(userId, account.id, {
      last_sync_status: 'FAILED',
      last_sync_error: appError.message,
      status: appError.code === 'TOKEN_REVOKED' || appError.code === 'TOKEN_EXPIRED' ? 'ERROR' : account.status,
    });
    await store.logAgentAction({
      user_id: userId,
      run_id: null,
      action_type: 'SYNC_FAILED',
      title: 'Inbox sync failed',
      detail: appError.userMessage,
      tool_name: null,
      email_id: null,
      task_id: null,
      notification_id: null,
      severity: 'error',
      payload: { accountId: account.id, code: appError.code },
    });

    logger.error('sync.failed', { userId, accountId: account.id, code: appError.code, detail: appError.message });
    return summary;
  }
}

/** Load context and run the agent pipeline for one already-stored email. */
export async function analyzeStoredEmail(input: {
  store: Store;
  userId: string;
  email: Email;
  preferences: UserPreferences;
  timezone: string;
  trigger: 'SYNC' | 'MANUAL' | 'REPROCESS' | 'CRON';
}): Promise<PipelineResult> {
  const { store, userId, email, preferences, timezone } = input;

  let threadState: ThreadState | null = null;
  let priorAnalyses: Awaited<ReturnType<Store['listThreadPriorAnalyses']>> = [];

  if (email.thread_id) {
    const thread = await store.getThread(userId, email.thread_id);
    threadState = thread?.thread_state ?? null;
    priorAnalyses = await store.listThreadPriorAnalyses(userId, email.thread_id, email.id);
  }

  return runEmailPipeline({
    store,
    userId,
    email,
    preferences,
    timezone,
    trigger: input.trigger,
    threadState,
    priorAnalyses,
  });
}

/** Analyse one email by id (used by the email detail page and API). */
export async function analyzeEmailById(input: {
  store: Store;
  userId: string;
  emailId: string;
  timezone: string;
  force?: boolean;
}): Promise<PipelineResult> {
  const { store, userId, emailId } = input;
  const email = await store.getEmail(userId, emailId);
  if (!email) {
    throw new AppError('NOT_FOUND', { message: 'Email not found', userMessage: 'That email could not be found.' });
  }
  const preferences = await store.getPreferences(userId);

  if (!input.force) {
    const existing = await store.getAnalysis(userId, emailId);
    if (existing && email.analysis_state === 'ANALYZED') {
      return {
        runId: 'cached',
        status: existing.needs_review ? 'NEEDS_REVIEW' : 'COMPLETED',
        analysis: null,
        taskId: null,
        changes: [],
        notifications: 0,
        error: null,
      };
    }
  }

  return analyzeStoredEmail({
    store,
    userId,
    email,
    preferences,
    timezone: input.timezone,
    trigger: input.force ? 'REPROCESS' : 'MANUAL',
  });
}

/** Sync every connected account for a user. */
export async function syncUserAccounts(input: {
  store: Store;
  userId: string;
  timezone: string;
  accountId?: string;
  limit?: number;
}): Promise<SyncSummary[]> {
  const { store, userId, timezone } = input;
  const accounts = await store.listAccounts(userId);
  const targets = input.accountId
    ? accounts.filter((account) => account.id === input.accountId)
    : accounts.filter((account) => account.status !== 'DISCONNECTED');

  if (targets.length === 0) {
    throw new AppError('NOT_FOUND', {
      message: 'No connected accounts',
      userMessage: 'No mailbox is connected yet.',
    });
  }

  const preferences = await store.getPreferences(userId);
  const summaries: SyncSummary[] = [];

  for (const account of targets) {
    try {
      summaries.push(
        await syncAccount({ store, userId, account, timezone, preferences, limit: input.limit }),
      );
    } catch (error) {
      const appError = isAppError(error) ? error : toAppError(error);
      summaries.push({
        accountId: account.id,
        status: 'FAILED',
        fetched: 0,
        created: 0,
        analyzed: 0,
        taskSuggestions: 0,
        notifications: 0,
        changes: 0,
        message: appError.userMessage,
        failures: [],
      });
    }
  }

  return summaries;
}
