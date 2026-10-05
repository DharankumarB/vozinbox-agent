import 'server-only';

import { AppError, toAppError } from '@/lib/errors';
import { googleOAuthConfig } from '@/lib/env';
import { logger } from '@/lib/logger';

/**
 * Gmail integration (§25).
 *
 * Read-only by design. The scope requested is `gmail.readonly`; this module
 * contains no code path that sends, deletes, modifies or labels messages.
 * Attachment bodies are never fetched — only metadata is read.
 *
 * Tokens live in `email_account_credentials` encrypted at rest (§24); nothing in
 * this module ever returns a token to a caller outside the server layer.
 */

export const GMAIL_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/gmail.readonly',
] as const;

const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';

export interface GmailTokens {
  access_token: string | null;
  refresh_token: string | null;
  scope: string | null;
  expires_at: string | null;
  token_type: string;
}

export interface GmailProfile {
  providerAccountId: string;
  emailAddress: string;
  displayName: string | null;
  scopes: string[];
  /** Current mailbox historyId — the incremental sync cursor (§26). */
  historyId: string | null;
}

export interface GmailMessageSummary {
  id: string;
  threadId: string;
}

export interface ParsedGmailMessage {
  providerMessageId: string;
  providerThreadId: string;
  senderName: string | null;
  senderEmail: string | null;
  recipient: string | null;
  recipients: Array<{ name: string | null; email: string | null }>;
  subject: string | null;
  snippet: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  receivedAt: string;
  isRead: boolean;
  labels: string[];
  hasAttachments: boolean;
  attachments: Array<{ filename: string; mime_type: string | null; size_bytes: number | null; attachment_id: string | null }>;
  headers: Record<string, string>;
  sizeEstimate: number | null;
}

// ── OAuth ────────────────────────────────────────────────────────────────────

export function isGmailConfigured(): boolean {
  return googleOAuthConfig() !== null;
}

function requireConfig() {
  const config = googleOAuthConfig();
  if (!config) {
    throw new AppError('NOT_CONFIGURED', {
      message: 'Google OAuth credentials are missing',
      userMessage:
        'Gmail is not configured on this deployment yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to enable it.',
    });
  }
  return config;
}

export function buildGoogleAuthUrl(state: string, options: { loginHint?: string } = {}): string {
  const config = requireConfig();
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: GMAIL_SCOPES.join(' '),
    access_type: 'offline',
    // Force a refresh token so reconnecting repairs a broken credential.
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  if (options.loginHint) params.set('login_hint', options.loginHint);
  return `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;
}

export async function exchangeCodeForTokens(code: string): Promise<GmailTokens> {
  const config = requireConfig();
  const body = new URLSearchParams({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    grant_type: 'authorization_code',
  });

  const payload = await requestToken(body, 'exchange');
  return normaliseTokens(payload);
}

export async function refreshAccessToken(refreshToken: string): Promise<GmailTokens> {
  const config = requireConfig();
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: 'refresh_token',
  });

  const payload = await requestToken(body, 'refresh');
  const tokens = normaliseTokens(payload);
  return { ...tokens, refresh_token: tokens.refresh_token ?? refreshToken };
}

async function requestToken(body: URLSearchParams, stage: 'exchange' | 'refresh'): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      cache: 'no-store',
    });
  } catch (error) {
    throw new AppError('NETWORK', {
      message: `Google token ${stage} request failed`,
      userMessage: 'We could not reach Google to complete the connection. Please try again.',
      cause: error,
    });
  }

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok) {
    const errorCode = String(payload.error ?? response.status);
    logger.error('gmail.token_error', { stage, status: response.status, error: errorCode });

    if (errorCode === 'invalid_grant') {
      throw new AppError('TOKEN_REVOKED', {
        message: 'Google rejected the refresh token (invalid_grant)',
        userMessage: 'Access to your mailbox was revoked or expired. Please reconnect Gmail.',
      });
    }
    if (errorCode === 'invalid_client') {
      throw new AppError('OAUTH_FAILED', {
        message: 'Google rejected the OAuth client credentials',
        userMessage: 'The Gmail connection is misconfigured on this deployment. Please contact support.',
      });
    }
    throw new AppError('OAUTH_FAILED', {
      message: `Google token ${stage} failed: ${errorCode} ${String(payload.error_description ?? '')}`,
    });
  }

  return payload;
}

function normaliseTokens(payload: Record<string, unknown>): GmailTokens {
  const expiresIn = Number(payload.expires_in ?? 0);
  return {
    access_token: typeof payload.access_token === 'string' ? payload.access_token : null,
    refresh_token: typeof payload.refresh_token === 'string' ? payload.refresh_token : null,
    scope: typeof payload.scope === 'string' ? payload.scope : null,
    expires_at: expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000).toISOString() : null,
    token_type: typeof payload.token_type === 'string' ? payload.token_type : 'Bearer',
  };
}

/** Best-effort revoke on disconnect. Failure never blocks local teardown. */
export async function revokeToken(token: string): Promise<boolean> {
  try {
    const response = await fetch(`${GOOGLE_REVOKE_ENDPOINT}?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      cache: 'no-store',
    });
    return response.ok;
  } catch (error) {
    logger.warn('gmail.revoke_failed', { detail: toAppError(error).message });
    return false;
  }
}

// ── API ──────────────────────────────────────────────────────────────────────

async function gmailFetch<T>(accessToken: string, path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const url = new URL(`${GMAIL_API}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
      cache: 'no-store',
    });
  } catch (error) {
    throw new AppError('NETWORK', {
      message: 'Gmail API unreachable',
      cause: error,
    });
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const status = response.status;

    if (status === 401) {
      throw new AppError('TOKEN_EXPIRED', {
        message: `Gmail API 401: ${detail.slice(0, 200)}`,
      });
    }
    if (status === 403 && /quota|rate/i.test(detail)) {
      throw new AppError('PROVIDER_RATE_LIMITED', {
        message: `Gmail API 403 (rate): ${detail.slice(0, 200)}`,
      });
    }
    if (status === 404) {
      throw new AppError('NOT_FOUND', { message: `Gmail API 404 for ${path}` });
    }
    throw new AppError('PROVIDER_ERROR', {
      message: `Gmail API ${status}: ${detail.slice(0, 300)}`,
    });
  }

  return (await response.json()) as T;
}

export async function getGmailProfile(accessToken: string): Promise<GmailProfile> {
  const payload = await gmailFetch<{
    emailAddress?: string;
    messagesTotal?: number;
    historyId?: string;
  }>(accessToken, '/profile');

  const emailAddress = payload.emailAddress;
  if (!emailAddress) {
    throw new AppError('MALFORMED_EMAIL', {
      message: 'Gmail profile did not include an email address',
      userMessage: 'We could not read your Gmail profile. Please try connecting again.',
    });
  }

  return {
    providerAccountId: emailAddress.toLowerCase(),
    emailAddress,
    displayName: null,
    scopes: [],
    historyId: payload.historyId ?? null,
  };
}

/** Read the user's identity (sub / email) from the OpenID userinfo endpoint. */
export async function getGoogleUserInfo(accessToken: string): Promise<{ sub: string | null; email: string | null; name: string | null }> {
  try {
    const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    });
    if (!response.ok) return { sub: null, email: null, name: null };
    const payload = (await response.json()) as { sub?: string; email?: string; name?: string };
    return { sub: payload.sub ?? null, email: payload.email ?? null, name: payload.name ?? null };
  } catch {
    return { sub: null, email: null, name: null };
  }
}

/**
 * List message ids. `query` uses Gmail search syntax; `after:` is applied for
 * incremental sync so a full mailbox is never re-downloaded (§26).
 */
export async function listMessageIds(
  accessToken: string,
  options: { query?: string; pageToken?: string; maxResults?: number; labelIds?: string[] },
): Promise<{ messages: GmailMessageSummary[]; nextPageToken: string | null; resultSizeEstimate: number | null }> {
  const payload = await gmailFetch<{
    messages?: Array<{ id?: string; threadId?: string }>;
    nextPageToken?: string;
    resultSizeEstimate?: number;
  }>(accessToken, '/messages', {
    q: options.query,
    pageToken: options.pageToken,
    maxResults: options.maxResults ?? 25,
    labelIds: options.labelIds?.join(','),
  });

  return {
    messages: (payload.messages ?? [])
      .filter((message): message is { id: string; threadId?: string } => Boolean(message.id))
      .map((message) => ({ id: message.id, threadId: message.threadId ?? message.id })),
    nextPageToken: payload.nextPageToken ?? null,
    resultSizeEstimate: payload.resultSizeEstimate ?? null,
  };
}

export interface GmailHistoryResult {
  historyId: string | null;
  newMessageIds: string[];
  expired: boolean;
}

/** Incremental sync via the history endpoint (§26). */
export async function listHistory(
  accessToken: string,
  startHistoryId: string,
  maxResults = 50,
): Promise<GmailHistoryResult> {
  try {
    const payload = await gmailFetch<{
      historyId?: string;
      history?: Array<{ messagesAdded?: Array<{ message?: { id?: string } }> }>;
    }>(accessToken, '/history', {
      startHistoryId,
      historyTypes: 'messageAdded',
      maxResults,
    });

    const ids = new Set<string>();
    for (const entry of payload.history ?? []) {
      for (const added of entry.messagesAdded ?? []) {
        if (added.message?.id) ids.add(added.message.id);
      }
    }
    return { historyId: payload.historyId ?? null, newMessageIds: [...ids], expired: false };
  } catch (error) {
    const appError = toAppError(error, 'PROVIDER_ERROR');
    // Gmail returns 404 when the historyId is too old to be useful.
    if (appError.code === 'NOT_FOUND' || /404/.test(appError.message)) {
      logger.warn('gmail.history_expired', { startHistoryId });
      return { historyId: null, newMessageIds: [], expired: true };
    }
    throw appError;
  }
}

export async function getMessage(accessToken: string, messageId: string): Promise<ParsedGmailMessage> {
  const payload = await gmailFetch<GmailApiMessage>(accessToken, `/messages/${encodeURIComponent(messageId)}`, {
    format: 'full',
  });
  return parseGmailMessage(payload);
}

export async function getMessageMetadata(accessToken: string, messageId: string): Promise<{ internalDate: number | null; labelIds: string[] }> {
  const payload = await gmailFetch<{ internalDate?: string; labelIds?: string[] }>(
    accessToken,
    `/messages/${encodeURIComponent(messageId)}`,
    { format: 'minimal' },
  );
  return {
    internalDate: payload.internalDate ? Number(payload.internalDate) : null,
    labelIds: payload.labelIds ?? [],
  };
}

// ── Parsing ──────────────────────────────────────────────────────────────────

interface GmailApiMessage {
  id?: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  sizeEstimate?: number;
  payload?: GmailPart;
}

interface GmailPart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: Array<{ name?: string; value?: string }>;
  body?: { attachmentId?: string; size?: number; data?: string };
  parts?: GmailPart[];
}

const MAX_BODY_CHARS = 200_000;

export function parseGmailMessage(message: GmailApiMessage): ParsedGmailMessage {
  if (!message.id) {
    throw new AppError('MALFORMED_EMAIL', {
      message: 'Gmail message had no id',
      userMessage: 'A message from your mailbox could not be read.',
    });
  }

  const headers = collectHeaders(message.payload);
  const from = parseAddress(headers.from ?? '');
  const to = parseAddressList(headers.to ?? '');
  const attachments = collectAttachments(message.payload);

  const { text, html } = collectBodies(message.payload);

  return {
    providerMessageId: message.id,
    providerThreadId: message.threadId ?? message.id,
    senderName: from.name,
    senderEmail: from.email,
    recipient: to[0]?.email ?? null,
    recipients: to,
    subject: headers.subject ?? null,
    snippet: message.snippet ?? null,
    bodyText: text.length > 0 ? text.slice(0, MAX_BODY_CHARS) : htmlToText(html).slice(0, MAX_BODY_CHARS),
    bodyHtml: html.length > 0 ? html.slice(0, MAX_BODY_CHARS) : null,
    receivedAt: message.internalDate
      ? new Date(Number(message.internalDate)).toISOString()
      : new Date().toISOString(),
    isRead: !(message.labelIds ?? []).includes('UNREAD'),
    labels: message.labelIds ?? [],
    hasAttachments: attachments.length > 0,
    attachments,
    headers,
    sizeEstimate: message.sizeEstimate ?? null,
  };
}

function collectHeaders(part: GmailPart | undefined): Record<string, string> {
  const output: Record<string, string> = {};
  for (const header of part?.headers ?? []) {
    if (!header.name || header.value === undefined) continue;
    const key = header.name.toLowerCase();
    // Keep only headers the product needs — avoid storing arbitrary content.
    if (['from', 'to', 'cc', 'subject', 'date', 'message-id', 'reply-to', 'list-unsubscribe'].includes(key)) {
      output[key] = header.value.slice(0, 2000);
    }
  }
  return output;
}

function collectAttachments(part: GmailPart | undefined): ParsedGmailMessage['attachments'] {
  const attachments: ParsedGmailMessage['attachments'] = [];
  const walk = (node: GmailPart | undefined): void => {
    if (!node) return;
    const isAttachment = Boolean(node.filename && node.filename.length > 0 && node.body);
    if (isAttachment) {
      attachments.push({
        filename: String(node.filename).slice(0, 300),
        mime_type: node.mimeType ?? null,
        size_bytes: node.body?.size ?? null,
        attachment_id: node.body?.attachmentId ?? null,
      });
    }
    for (const child of node.parts ?? []) walk(child);
  };
  walk(part);
  return attachments.slice(0, 25);
}

function collectBodies(part: GmailPart | undefined): { text: string; html: string } {
  let text = '';
  let html = '';

  const walk = (node: GmailPart | undefined): void => {
    if (!node) return;
    const mime = (node.mimeType ?? '').toLowerCase();
    const data = node.body?.data;

    if (data && node.filename === undefined) {
      const decoded = decodeBase64Url(data);
      if (mime === 'text/plain' && text.length < MAX_BODY_CHARS) text += decoded;
      else if (mime === 'text/html' && html.length < MAX_BODY_CHARS) html += decoded;
    }
    for (const child of node.parts ?? []) walk(child);
  };

  walk(part);
  return { text, html };
}

export function decodeBase64Url(data: string): string {
  try {
    const normalised = data.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(normalised, 'base64').toString('utf8');
  } catch {
    return '';
  }
}

/** Minimal, dependency-free HTML → text conversion for search and analysis. */
export function htmlToText(html: string): string {
  if (!html) return '';
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function parseAddress(value: string): { name: string | null; email: string | null } {
  if (!value) return { name: null, email: null };
  const angled = /^(.*?)<([^>]+)>/.exec(value);
  if (angled) {
    const name = cleanName(angled[1] ?? '');
    return { name, email: (angled[2] ?? '').trim().toLowerCase() || null };
  }
  const bare = /[\w.+-]+@[\w.-]+\.\w+/.exec(value);
  return { name: null, email: bare ? bare[0].toLowerCase() : null };
}

export function parseAddressList(value: string): Array<{ name: string | null; email: string | null }> {
  if (!value) return [];
  return value
    .split(',')
    .map((part) => parseAddress(part.trim()))
    .filter((address) => Boolean(address.email))
    .slice(0, 20);
}

function cleanName(value: string): string | null {
  const cleaned = value.replace(/["']/g, '').trim();
  return cleaned.length > 0 ? cleaned.slice(0, 200) : null;
}

export { GOOGLE_TOKEN_ENDPOINT, GOOGLE_AUTH_ENDPOINT };
