import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { LocalStore } from '@/lib/store/local-store';
import { buildDedupeKey } from '@/lib/analysis/dedupe';
import type { NewEmailInput, NewTaskInput } from '@/lib/store/types';

/**
 * §17, §37 — the data layer must isolate users and enforce duplicate prevention.
 * These run against the local development store, which implements the exact same
 * contract as the Supabase store (verified again by the SQL indexes).
 */

let store: LocalStore;
let tempDir: string;

beforeAll(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), 'vozinbox-test-'));
  process.env.VOZINBOX_LOCAL_DIR = tempDir;
  const module = await import('@/lib/store/local-store');
  store = new module.LocalStore();
});

afterAll(async () => {
  delete process.env.VOZINBOX_LOCAL_DIR;
  await rm(tempDir, { recursive: true, force: true });
});

const USER_A = 'user-a';
const USER_B = 'user-b';

function emailInput(overrides: Partial<NewEmailInput> = {}): NewEmailInput {
  return {
    user_id: USER_A,
    account_id: 'account-1',
    thread_id: 'thread-1',
    provider: 'gmail',
    provider_message_id: `msg-${Math.random().toString(36).slice(2)}`,
    provider_thread_id: 'provider-thread-1',
    sender_name: 'Naledi Mokoena',
    sender_email: 'naledi@example.org',
    recipient: 'me@example.com',
    recipients: [{ name: null, email: 'me@example.com' }],
    subject: 'Assignment submission',
    snippet: 'Please submit your assignment by Friday.',
    body_text: 'Please submit your assignment by Friday 20 March 2026.',
    body_html: null,
    received_at: new Date().toISOString(),
    is_read: false,
    has_attachments: false,
    attachments: [],
    labels: ['INBOX'],
    headers: {},
    size_estimate: 1024,
    ...overrides,
  };
}

function taskInput(emailId: string, overrides: Partial<NewTaskInput> = {}): NewTaskInput {
  const title = overrides.title ?? 'Submit the assignment';
  return {
    user_id: USER_A,
    title,
    description: null,
    source_email_id: emailId,
    source_thread_id: 'thread-1',
    source_action_id: null,
    category: 'ASSIGNMENT',
    priority: 'HIGH',
    due_date: '2026-03-20',
    due_time: null,
    timezone: 'Africa/Johannesburg',
    status: 'SUGGESTED',
    origin: 'AI_SUGGESTED',
    dedupe_key: buildDedupeKey(emailId, title),
    ...overrides,
  };
}

describe('user bootstrap', () => {
  it('creates a profile and default preferences once', async () => {
    const first = await store.ensureBootstrap({
      userId: USER_A,
      email: 'a@example.com',
      fullName: 'User A',
      timezone: 'Africa/Johannesburg',
    });
    expect(first.profile.id).toBe(USER_A);
    expect(first.preferences.confidence_threshold).toBeGreaterThan(0);

    const second = await store.ensureBootstrap({
      userId: USER_A,
      email: 'a@example.com',
      fullName: 'User A',
      timezone: 'Africa/Johannesburg',
    });
    expect(second.profile.id).toBe(USER_A);
  });
});

describe('per-user isolation', () => {
  it('never returns another user’s email', async () => {
    const mine = await store.upsertEmail(emailInput({ user_id: USER_A }));
    const theirs = await store.upsertEmail(emailInput({ user_id: USER_B }));

    expect(await store.getEmail(USER_A, theirs.id)).toBeNull();
    expect(await store.getEmail(USER_B, mine.id)).toBeNull();
    expect((await store.getEmail(USER_A, mine.id))?.id).toBe(mine.id);

    const pageB = await store.listInbox({ userId: USER_B, limit: 50 });
    expect(pageB.items.every((item) => item.email.user_id === USER_B)).toBe(true);
    expect(pageB.items.some((item) => item.email.id === mine.id)).toBe(false);
  });

  it('counts only the requesting user’s data', async () => {
    const inboxA = await store.listInbox({ userId: USER_A, limit: 200 });
    const inboxB = await store.listInbox({ userId: USER_B, limit: 200 });
    const countersA = await store.dashboardCounters(USER_A);
    const countersB = await store.dashboardCounters(USER_B);

    expect(countersA.totalEmails).toBe(inboxA.total);
    expect(countersB.totalEmails).toBe(inboxB.total);
    expect(inboxA.items.every((item) => item.email.user_id === USER_A)).toBe(true);
    expect(inboxB.items.every((item) => item.email.user_id === USER_B)).toBe(true);
  });
});

describe('email upsert', () => {
  it('is idempotent for the same provider message id', async () => {
    const input = emailInput({ provider_message_id: 'duplicate-message-id' });
    const first = await store.upsertEmail(input);
    const second = await store.upsertEmail({ ...input, subject: 'Updated subject' });
    expect(second.id).toBe(first.id);
    expect(second.subject).toBe('Updated subject');
  });
});

describe('task duplicate prevention', () => {
  it('rejects a second task with the same dedupe key for one email', async () => {
    const email = await store.upsertEmail(emailInput());
    await store.createTask(taskInput(email.id));

    await expect(store.createTask(taskInput(email.id))).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('allows a genuinely different action from the same email', async () => {
    const email = await store.upsertEmail(emailInput());
    await store.createTask(taskInput(email.id, { title: 'Book the review room' }));
    const second = await store.createTask(taskInput(email.id, { title: 'Print the handouts' }));
    expect(second.id).toBeTruthy();
  });

  it('returns existing duplicate candidates for the same thread', async () => {
    const email = await store.upsertEmail(emailInput({ thread_id: 'thread-dup', provider_thread_id: 'p-thread-dup' }));
    const task = await store.createTask(
      taskInput(email.id, { title: 'Send the signed contract', source_thread_id: 'thread-dup' }),
    );

    const candidates = await store.findDuplicateCandidates({
      userId: USER_A,
      sourceEmailId: email.id,
      sourceThreadId: 'thread-dup',
    });
    expect(candidates.some((candidate) => candidate.id === task.id)).toBe(true);
  });
});

describe('notifications', () => {
  it('collapses repeated notifications with the same dedupe key', async () => {
    const first = await store.createNotification({
      user_id: USER_A,
      type: 'IMPORTANT_EMAIL',
      title: 'Important email',
      message: null,
      priority: 'HIGH',
      entity_type: 'email',
      related_entity_id: null,
      action_url: '/inbox',
      metadata: {},
      dedupe_key: 'important:fixed',
    });
    const second = await store.createNotification({
      user_id: USER_A,
      type: 'IMPORTANT_EMAIL',
      title: 'Important email again',
      message: null,
      priority: 'HIGH',
      entity_type: 'email',
      related_entity_id: null,
      action_url: '/inbox',
      metadata: {},
      dedupe_key: 'important:fixed',
    });

    expect(first?.id).toBe(second?.id);
  });

  it('marks all notifications read for one user only', async () => {
    await store.createNotification({
      user_id: USER_B,
      type: 'IMPORTANT_EMAIL',
      title: 'B only',
      message: null,
      priority: 'HIGH',
      entity_type: 'email',
      related_entity_id: null,
      action_url: null,
      metadata: {},
      dedupe_key: 'b-only',
    });

    await store.markAllNotificationsRead(USER_A);

    expect((await store.listNotifications(USER_A, { unreadOnly: true })).length).toBe(0);
    expect((await store.listNotifications(USER_B, { unreadOnly: true })).length).toBeGreaterThan(0);
  });
});

describe('data deletion', () => {
  it('removes every record for one user and leaves the other untouched', async () => {
    const counts = await store.deleteAllUserData(USER_A);
    expect(Object.keys(counts).length).toBeGreaterThan(0);
    expect((await store.listInbox({ userId: USER_A, limit: 10 })).total).toBe(0);
    expect((await store.listInbox({ userId: USER_B, limit: 10 })).total).toBeGreaterThan(0);
  });
});
