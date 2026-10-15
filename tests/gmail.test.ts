import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getMessageAttachment,
  buildGmailRawMessage,
  listHistory,
  modifyMessageReadState,
  parseGmailMessage,
  sendGmailMessage,
} from '@/lib/integrations/gmail';
import { sanitizeHtml } from '@/lib/sanitizer';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Gmail MIME parsing', () => {
  it('reads nested multipart bodies, decodes the declared charset, and finds attachments', () => {
    const latin1 = Buffer.from([0x63, 0x61, 0x66, 0xe9]).toString('base64url');
    const message = parseGmailMessage({
      id: 'message-1',
      threadId: 'thread-1',
      labelIds: ['UNREAD'],
      payload: {
        mimeType: 'multipart/mixed',
        headers: [{ name: 'From', value: 'Sender <sender@example.com>' }],
        parts: [
          {
            mimeType: 'multipart/alternative',
            parts: [
              {
                mimeType: 'text/plain',
                headers: [{ name: 'Content-Type', value: 'text/plain; charset=iso-8859-1' }],
                body: { data: latin1 },
              },
              {
                mimeType: 'text/html',
                body: { data: Buffer.from('<p>formatted <strong>mail</strong></p>').toString('base64url') },
              },
            ],
          },
          {
            filename: 'report.pdf',
            mimeType: 'application/pdf',
            body: { attachmentId: 'attachment-1', size: 8 },
          },
        ],
      },
    });

    expect(message.bodyText).toBe('café');
    expect(message.bodyHtml).toContain('<strong>mail</strong>');
    expect(message.isRead).toBe(false);
    expect(message.attachments).toEqual([
      {
        filename: 'report.pdf',
        mime_type: 'application/pdf',
        size_bytes: 8,
        attachment_id: 'attachment-1',
      },
    ]);
  });

  it('retains HTML-only content as readable text and sanitized HTML', () => {
    const message = parseGmailMessage({
      id: 'html-only',
      payload: {
        mimeType: 'text/html',
        body: {
          data: Buffer.from('<p>Hello <a href="https://example.com">there</a></p><script>alert(1)</script>').toString(
            'base64url',
          ),
        },
      },
    });
    expect(message.bodyText).toContain('Hello');
    expect(message.bodyHtml).toContain('href="https://example.com"');
    expect(message.bodyHtml).not.toContain('<script>');
  });

  it('neutralizes active content while preserving ordinary links', () => {
    const html = sanitizeHtml(
      '<p onclick="run()">Safe <a href="https://example.com">link</a><a href="javascript:alert(1)">bad</a></p><svg/onload=run()>',
    );
    expect(html).toContain('href="https://example.com"');
    expect(html).not.toMatch(/onclick|javascript:|<svg/i);
  });
});

describe('Gmail message composition', () => {
  it('encodes a plain-text Unicode message as base64url MIME with thread headers', () => {
    const raw = buildGmailRawMessage(
      {
        to: ['person@example.com'],
        cc: ['copy@example.com'],
        bcc: [],
        subject: 'Re: Café',
        body: 'Thanks — I will review this.',
        threadId: 'thread-1',
        inReplyTo: '<original@example.com>',
        references: '<root@example.com> <original@example.com>',
      },
      'me@example.com',
    );
    expect(raw).toContain('To: person@example.com');
    expect(raw).toContain('Cc: copy@example.com');
    expect(raw).toContain('In-Reply-To: <original@example.com>');
    expect(raw).toContain('References: <root@example.com> <original@example.com>');
    expect(raw).toContain(`Subject: =?UTF-8?B?${Buffer.from('Re: Café').toString('base64')}?=`);
    expect(raw).toContain(Buffer.from('Thanks — I will review this.').toString('base64'));
  });

  it('folds long Unicode subjects and wraps encoded bodies within MIME line limits', () => {
    const raw = buildGmailRawMessage(
      { to: ['person@example.com'], cc: [], bcc: [], subject: '📨'.repeat(80), body: 'A'.repeat(800) },
      'me@example.com',
    );
    const lines = raw.split('\r\n');
    expect(Math.max(...lines.map((line) => line.length))).toBeLessThanOrEqual(998);
    expect(lines.some((line) => line.length > 76 && line.startsWith('=?UTF-8?B?'))).toBe(false);
    expect(lines.filter((line) => /^[A-Za-z0-9+/=]+$/.test(line)).every((line) => line.length <= 76)).toBe(true);
  });

  it('rejects header injection and missing recipients', () => {
    expect(() =>
      buildGmailRawMessage(
        { to: ['person@example.com'], cc: [], bcc: [], subject: 'Hello\r\nBcc: victim@example.com', body: 'Hi' },
        'me@example.com',
      ),
    ).toThrow(/Subject contains a line break/);
    expect(() =>
      buildGmailRawMessage({ to: [], cc: [], bcc: [], subject: 'Hello', body: 'Hi' }, 'me@example.com'),
    ).toThrow(/At least one To recipient/);
  });

  it('submits a user-composed message to Gmail and returns its provider identifiers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'sent-1', threadId: 'thread-1' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      sendGmailMessage(
        'access-token',
        { to: ['person@example.com'], cc: [], bcc: [], subject: 'Hello', body: 'Message' },
        'me@example.com',
      ),
    ).resolves.toEqual({ id: 'sent-1', threadId: 'thread-1' });
    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(request.body)) as { raw: string };
    expect(Buffer.from(payload.raw, 'base64url').toString('utf8')).toContain('To: person@example.com');
  });

  it('does not disguise an uncertain network send as a safe-to-retry failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    await expect(
      sendGmailMessage(
        'access-token',
        { to: ['person@example.com'], cc: [], bcc: [], subject: 'Hello', body: 'Message' },
        'me@example.com',
      ),
    ).rejects.toMatchObject({ code: 'NETWORK', retryable: false });
  });
});

describe('Gmail attachment retrieval', () => {
  it('fetches attachment bytes through the Gmail attachment endpoint', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'message-1',
            payload: {
              mimeType: 'multipart/mixed',
              parts: [
                {
                  filename: 'report.pdf',
                  mimeType: 'application/pdf',
                  body: { attachmentId: 'attachment-1', size: 8 },
                },
              ],
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: Buffer.from('%PDF-1.7').toString('base64url') }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const attachment = await getMessageAttachment('access-token', 'message-1', 0);

    expect(attachment.filename).toBe('report.pdf');
    expect(attachment.mimeType).toBe('application/pdf');
    expect(attachment.bytes.toString('ascii')).toBe('%PDF-1.7');
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(
      '/messages/message-1/attachments/attachment-1',
    );
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      headers: { authorization: 'Bearer access-token', accept: 'application/json' },
    });
  });

  it('decodes attachment content embedded directly in a MIME part', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'message-2',
          payload: {
            mimeType: 'multipart/mixed',
            parts: [
              {
                filename: 'inline.pdf',
                mimeType: 'application/pdf',
                body: { data: Buffer.from('%PDF-inline').toString('base64url'), size: 11 },
              },
            ],
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const attachment = await getMessageAttachment('access-token', 'message-2', 0);

    expect(attachment.bytes.toString('ascii')).toBe('%PDF-inline');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('Gmail read-state updates', () => {
  it.each([
    [true, { removeLabelIds: ['UNREAD'] }],
    [false, { addLabelIds: ['UNREAD'] }],
  ])('sends the correct Gmail label change for isRead=%s', async (isRead, expectedBody) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await modifyMessageReadState('access-token', 'gmail-message-id', isRead);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/gmail-message-id/modify',
      expect.objectContaining({ method: 'POST', body: JSON.stringify(expectedBody) }),
    );
  });

  it('reports missing Gmail modify permission without claiming success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: 'Insufficient Permission', status: 'PERMISSION_DENIED' } }), {
          status: 403,
        }),
      ),
    );

    await expect(modifyMessageReadState('access-token', 'gmail-message-id', true)).rejects.toMatchObject({
      userMessage: expect.stringContaining('Reconnect Gmail'),
    });
  });
});

describe('Gmail history read-state synchronization', () => {
  it('collects IDs changed by label additions and removals', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          historyId: '200',
          history: [
            {
              messagesAdded: [{ message: { id: 'new' } }],
              labelsAdded: [{ message: { id: 'changed-1' } }],
              labelsRemoved: [{ message: { id: 'changed-2' } }],
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(listHistory('access-token', '100')).resolves.toEqual({
      historyId: '200',
      newMessageIds: ['new'],
      changedMessageIds: ['changed-1', 'changed-2'],
      expired: false,
    });
    const requestedUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requestedUrl.searchParams.getAll('historyTypes')).toEqual([
      'messageAdded',
      'labelAdded',
      'labelRemoved',
    ]);
  });
});
