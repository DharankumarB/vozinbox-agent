import { NextResponse } from 'next/server';
import { withUser } from '@/lib/api';
import { AppError } from '@/lib/errors';
import { getAccessToken } from '@/lib/integrations/accounts';
import { getMessageAttachment } from '@/lib/integrations/gmail';
import { getStore } from '@/lib/store';

type Params = { id: string; index: string };

const DEFAULT_MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const ALLOWED_INLINE_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);

export const GET = withUser<Params>(
  async ({ auth, params, request }) => {
    const index = Number(params.index);
    if (!Number.isSafeInteger(index) || index < 0 || index >= 25) {
      throw new AppError('VALIDATION', { message: 'Invalid attachment index' });
    }

    const store = await getStore();
    const email = await store.getEmail(auth.id, params.id);
    if (!email || email.provider !== 'gmail') {
      throw new AppError('NOT_FOUND', {
        message: 'Gmail email not found for requested attachment',
        userMessage: 'This attachment could not be found.',
      });
    }
    const attachment = email.attachments[index];
    if (!attachment) {
      throw new AppError('NOT_FOUND', {
        message: 'Attachment metadata is not present on this email',
        userMessage: 'This attachment could not be found.',
      });
    }

    const configuredLimit = Number(process.env.GMAIL_ATTACHMENT_MAX_BYTES);
    const maxBytes =
      Number.isSafeInteger(configuredLimit) && configuredLimit > 0
        ? configuredLimit
        : DEFAULT_MAX_ATTACHMENT_BYTES;
    if (attachment.size_bytes !== null && attachment.size_bytes !== undefined && attachment.size_bytes > maxBytes) {
      throw new AppError('VALIDATION', {
        message: `Attachment exceeds configured size limit (${attachment.size_bytes} bytes)`,
        userMessage: 'This attachment is too large to preview or download here.',
      });
    }

    const account = await store.getAccount(auth.id, email.account_id);
    if (!account || account.provider !== 'gmail' || account.status !== 'CONNECTED') {
      throw new AppError('NOT_FOUND', {
        message: 'Connected Gmail account for attachment is unavailable',
        userMessage: 'Reconnect Gmail to access this attachment.',
      });
    }
    const accessToken = await getAccessToken(store, auth.id, account);
    const file = await getMessageAttachment(accessToken, email.provider_message_id, index);
    if (
      file.filename !== attachment.filename ||
      (attachment.mime_type &&
        file.mimeType.toLowerCase() !== attachment.mime_type.toLowerCase())
    ) {
      throw new AppError('NOT_FOUND', {
        message: 'Attachment metadata changed after the email was synchronized',
        userMessage: 'This attachment changed in Gmail. Sync the email and try again.',
      });
    }
    if (file.bytes.byteLength > maxBytes) {
      throw new AppError('VALIDATION', {
        message: `Retrieved attachment exceeds configured size limit (${file.bytes.byteLength} bytes)`,
        userMessage: 'This attachment is too large to preview or download here.',
      });
    }

    const filename = safeFilename(file.filename);
    const inlineType = verifiedInlineType(file.mimeType, filename, file.bytes);
    const wantsDownload = new URL(request.url).searchParams.get('download') === '1';
    const disposition = wantsDownload || !inlineType ? 'attachment' : 'inline';
    const contentType = inlineType ?? 'application/octet-stream';
    const encodedFilename = encodeURIComponent(filename).replace(/['()*]/g, (char) =>
      `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
    );

    return new NextResponse(Uint8Array.from(file.bytes), {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(file.bytes.byteLength),
        'Content-Disposition': `${disposition}; filename="${filename.replace(/["\\]/g, '_')}"; filename*=UTF-8''${encodedFilename}`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store, max-age=0',
        ...(inlineType?.startsWith('image/') ? { 'Content-Security-Policy': "default-src 'none'" } : {}),
      },
    });
  },
  { rateLimit: 'emailMutation' },
);

function safeFilename(filename: string): string {
  const cleaned = filename
    .normalize('NFKC')
    .replace(/[\\/\u0000-\u001f\u007f]/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 180);
  return cleaned || 'attachment';
}

function verifiedInlineType(mimeType: string, filename: string, bytes: Buffer): string | null {
  const declaredType = mimeType.toLowerCase().split(';', 1)[0]?.trim();
  const extensionType =
    /\.pdf$/i.test(filename) ? 'application/pdf' :
    /\.png$/i.test(filename) ? 'image/png' :
    /\.jpe?g$/i.test(filename) ? 'image/jpeg' :
    /\.gif$/i.test(filename) ? 'image/gif' :
    /\.webp$/i.test(filename) ? 'image/webp' : null;
  const candidates = [declaredType, extensionType].filter(
    (type): type is string => Boolean(type && ALLOWED_INLINE_TYPES.has(type)),
  );
  for (const type of candidates) {
    if (matchesMagic(type, bytes)) return type;
  }
  return null;
}

function matchesMagic(type: string, bytes: Buffer): boolean {
  if (type === 'application/pdf') return bytes.subarray(0, 5).toString('ascii') === '%PDF-';
  if (type === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (type === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === 'image/gif') return ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'));
  if (type === 'image/webp') {
    return bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  }
  return false;
}

export const runtime = 'nodejs';
