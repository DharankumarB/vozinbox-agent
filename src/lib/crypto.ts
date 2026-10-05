/**
 * Token encryption at rest (§24, §31).
 *
 * OAuth refresh/access tokens are encrypted with AES-256-GCM before they touch
 * the database. The key lives only in the server environment. A token that
 * leaks out of the database (backup, log dump, mis-scoped query) is useless
 * without the key.
 */

import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { AppError } from './errors';
import { tokenEncryptionKey } from './env';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const CURRENT_KEY_VERSION = 1;

interface CipherEnvelope {
  v: number;
  iv: string;
  tag: string;
  data: string;
}

function deriveKey(): Buffer {
  const raw = tokenEncryptionKey();
  if (!raw) {
    throw new AppError('NOT_CONFIGURED', {
      message: 'TOKEN_ENCRYPTION_KEY is not set',
      userMessage:
        'Secure token storage is not configured on this deployment, so your mailbox cannot be connected yet.',
    });
  }
  // Accept base64 or hex keys; otherwise derive a stable 32-byte key from the
  // passphrase so operators cannot accidentally run with a weak short key.
  const base64 = /^[A-Za-z0-9+/=]{43,44}$/.test(raw);
  const hex = /^[0-9a-fA-F]{64}$/.test(raw);
  if (base64) {
    const decoded = Buffer.from(raw, 'base64');
    if (decoded.length === 32) return decoded;
  }
  if (hex) return Buffer.from(raw, 'hex');
  return createHash('sha256').update(`vozinbox:${raw}`).digest();
}

export function isEncryptionConfigured(): boolean {
  try {
    deriveKey();
    return true;
  } catch {
    return false;
  }
}

/** Encrypt a secret for storage. Returns a self-describing envelope string. */
export function encryptSecret(plaintext: string): string {
  if (!plaintext) {
    throw new AppError('VALIDATION', { message: 'Cannot encrypt an empty secret' });
  }
  const key = deriveKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const envelope: CipherEnvelope = {
    v: CURRENT_KEY_VERSION,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: encrypted.toString('base64'),
  };
  return `voz1:${Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64')}`;
}

/** Decrypt a stored secret. Throws a neutral error — never echoes ciphertext. */
export function decryptSecret(ciphertext: string): string {
  const key = deriveKey();
  if (!ciphertext.startsWith('voz1:')) {
    throw new AppError('INTERNAL', {
      message: 'Unrecognised credential envelope',
      userMessage: 'The stored mailbox credentials are unreadable. Please reconnect your account.',
    });
  }
  try {
    const envelope = JSON.parse(
      Buffer.from(ciphertext.slice('voz1:'.length), 'base64').toString('utf8'),
    ) as CipherEnvelope;
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(envelope.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.data, 'base64')),
      decipher.final(),
    ]);
    return plaintext.toString('utf8');
  } catch (error) {
    throw new AppError('INTERNAL', {
      message: 'Failed to decrypt credential',
      userMessage: 'The stored mailbox credentials could not be read. Please reconnect your account.',
      cause: error,
    });
  }
}

/** Opaque, high-entropy token for OAuth `state` parameters. */
export function createOAuthState(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Redact anything token-shaped before it reaches a log line (§45).
 * Applied by the logger, not by callers, so nothing is missed by omission.
 */
export function redactSecrets(value: string): string {
  return value
    .replace(/\b(ya29\.[A-Za-z0-9._-]{10,})/g, '[redacted-access-token]')
    .replace(/\b(1\/\/[A-Za-z0-9._-]{10,})/g, '[redacted-refresh-token]')
    .replace(/\b(sk-[A-Za-z0-9-]{10,})/g, '[redacted-api-key]')
    .replace(/\b(eyJ[A-Za-z0-9._-]{20,})/g, '[redacted-jwt]')
    .replace(/(["']?(?:access_token|refresh_token|id_token|client_secret|api_key|apiKey|password|authorization)["']?\s*[:=]\s*["'])([^"']{6,})(["'])/gi, '$1[redacted]$3');
}
