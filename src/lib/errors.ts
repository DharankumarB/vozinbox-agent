/**
 * Error model (§32).
 *
 * Every failure that can reach a user is wrapped in an `AppError` carrying a
 * friendly message plus an internal code. Stack traces and provider payloads
 * stay in server logs; the UI only ever shows `userMessage`.
 */

export type AppErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'RATE_LIMITED'
  | 'NOT_CONFIGURED'
  | 'OAUTH_FAILED'
  | 'TOKEN_EXPIRED'
  | 'TOKEN_REVOKED'
  | 'PROVIDER_RATE_LIMITED'
  | 'PROVIDER_ERROR'
  | 'NETWORK'
  | 'AI_FAILED'
  | 'AI_INVALID_OUTPUT'
  | 'AI_UNAVAILABLE'
  | 'PARTIAL_SYNC'
  | 'MALFORMED_EMAIL'
  | 'DATABASE'
  | 'TIMEOUT'
  | 'CONFLICT'
  | 'INTERNAL';

const FRIENDLY: Record<AppErrorCode, string> = {
  UNAUTHENTICATED: 'Your session has ended. Please sign in again.',
  FORBIDDEN: 'You do not have access to this item.',
  NOT_FOUND: 'We could not find what you were looking for.',
  VALIDATION: 'Some of the information provided is not valid.',
  RATE_LIMITED: 'Too many requests just now. Please try again in a moment.',
  NOT_CONFIGURED: 'This feature is not configured yet on this deployment.',
  OAUTH_FAILED: 'We could not complete the connection with your email provider.',
  TOKEN_EXPIRED: 'Your email connection needs to be re-authorised.',
  TOKEN_REVOKED: 'Access to your mailbox was revoked. Please reconnect.',
  PROVIDER_RATE_LIMITED: 'Your email provider is limiting requests. We will retry shortly.',
  PROVIDER_ERROR: 'Your email provider returned an error. Please try again.',
  NETWORK: 'A network problem interrupted the request. Please try again.',
  AI_FAILED: 'The AI analysis could not be completed for this message.',
  AI_INVALID_OUTPUT: 'The AI returned an unexpected result, so nothing was saved.',
  AI_UNAVAILABLE: 'The AI service is not available right now.',
  PARTIAL_SYNC: 'Some messages could not be synced. The rest were saved.',
  MALFORMED_EMAIL: 'This message could not be read correctly.',
  DATABASE: 'We could not save your changes. Please try again.',
  TIMEOUT: 'The operation took too long. Please try again.',
  CONFLICT: 'That action conflicts with an existing item.',
  INTERNAL: 'Unable to complete this action. Please try again.',
};

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly userMessage: string;
  readonly status: number;
  readonly context: Record<string, unknown>;
  /** Set when the operation is safe to retry as-is. */
  readonly retryable: boolean;

  constructor(
    code: AppErrorCode,
    options: {
      message?: string;
      userMessage?: string;
      status?: number;
      context?: Record<string, unknown>;
      retryable?: boolean;
      cause?: unknown;
    } = {},
  ) {
    super(options.message ?? code, { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.userMessage = options.userMessage ?? FRIENDLY[code];
    this.status = options.status ?? defaultStatus(code);
    this.context = options.context ?? {};
    this.retryable =
      options.retryable ?? ['NETWORK', 'TIMEOUT', 'PROVIDER_RATE_LIMITED', 'PROVIDER_ERROR'].includes(code);
  }

  /** Serialisable shape safe to return from an API route. */
  toResponse(): { ok: false; error: { code: AppErrorCode; message: string } } {
    return { ok: false, error: { code: this.code, message: this.userMessage } };
  }
}

function defaultStatus(code: AppErrorCode): number {
  switch (code) {
    case 'UNAUTHENTICATED':
      return 401;
    case 'FORBIDDEN':
      return 403;
    case 'NOT_FOUND':
      return 404;
    case 'VALIDATION':
    case 'MALFORMED_EMAIL':
      return 422;
    case 'RATE_LIMITED':
    case 'PROVIDER_RATE_LIMITED':
      return 429;
    case 'CONFLICT':
      return 409;
    case 'NOT_CONFIGURED':
      return 503;
    case 'TIMEOUT':
      return 504;
    default:
      return 500;
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

/** Normalise anything thrown into an AppError without leaking internals. */
export function toAppError(error: unknown, fallbackCode: AppErrorCode = 'INTERNAL'): AppError {
  if (isAppError(error)) return error;

  if (error instanceof Error) {
    if (error.name === 'AbortError') {
      return new AppError('TIMEOUT', { message: error.message, cause: error });
    }
    if (error.name === 'TypeError' && /fetch/i.test(error.message)) {
      return new AppError('NETWORK', { message: error.message, cause: error });
    }
    return new AppError(fallbackCode, { message: error.message, cause: error });
  }

  return new AppError(fallbackCode, { message: String(error) });
}

/** Result wrapper used across the service layer. */
export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: AppErrorCode; message: string } };

export function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

export function fail(error: unknown): Result<never> {
  const appError = toAppError(error);
  return { ok: false, error: { code: appError.code, message: appError.userMessage } };
}
