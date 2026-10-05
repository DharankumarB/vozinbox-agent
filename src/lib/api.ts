import 'server-only';

import { NextResponse } from 'next/server';
import type { ZodTypeAny, z } from 'zod';
import { getAuthContext, type AuthContext } from '@/lib/auth';
import { AppError, toAppError } from '@/lib/errors';
import { clientIdentifier, enforceRateLimit, type RateLimitName } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

/**
 * API helpers (§32, §42, §58).
 *
 * Every route handler is wrapped so that:
 *  • the caller is authenticated before any work happens;
 *  • request bodies are validated with zod;
 *  • rate limits are applied per user (or per IP when unauthenticated);
 *  • thrown errors become friendly JSON — never stack traces.
 */

export interface RouteContext<P = Record<string, string>> {
  auth: AuthContext;
  request: Request;
  /** Resolved dynamic route params (Next.js 15 passes these as a promise). */
  params: P;
}

export function jsonOk<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json({ ok: true, data }, { status: 200, ...init });
}

export function jsonError(error: unknown): NextResponse {
  const appError = toAppError(error);
  if (appError.status >= 500) {
    logger.error('api.error', {
      code: appError.code,
      detail: appError.message,
      context: appError.context,
    });
  }
  return NextResponse.json(appError.toResponse(), { status: appError.status });
}

export async function parseJson<T extends ZodTypeAny>(
  request: Request,
  schema: T,
): Promise<z.infer<T>> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    throw new AppError('VALIDATION', {
      message: 'Request body was not valid JSON',
      userMessage: 'We could not read that request. Please try again.',
    });
  }
  const result = schema.safeParse(payload);
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 6)
      .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
      .join('; ');
    throw new AppError('VALIDATION', {
      message: `Invalid request body: ${issues}`,
      userMessage: 'Some of the information provided is not valid.',
      context: { issues },
    });
  }
  return result.data;
}

export function requireQuery(request: Request, key: string): string {
  const value = new URL(request.url).searchParams.get(key);
  if (!value) {
    throw new AppError('VALIDATION', {
      message: `Missing query parameter: ${key}`,
      userMessage: 'That request was missing required information.',
    });
  }
  return value;
}

export function optionalQuery(request: Request, key: string): string | null {
  return new URL(request.url).searchParams.get(key);
}

export function intQuery(request: Request, key: string, fallback: number): number {
  const raw = new URL(request.url).searchParams.get(key);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Authenticated route wrapper.
 * `handler` receives the resolved auth context (user, profile, preferences).
 */
export function withUser<P extends Record<string, string> = Record<string, string>>(
  handler: (context: RouteContext<P>) => Promise<NextResponse>,
  options: { rateLimit?: RateLimitName } = {},
) {
  /**
   * The second argument is typed as Next.js expects it: `params` is always a
   * promise (Next 15), whether or not the route is dynamic. Static routes
   * simply receive an empty object.
   */
  return async (request: Request, routeContext: { params: Promise<P> }): Promise<NextResponse> => {
    try {
      const auth = await getAuthContext();
      if (!auth) throw new AppError('UNAUTHENTICATED');

      if (options.rateLimit) {
        enforceRateLimit(options.rateLimit, clientIdentifier(request.headers, auth.id));
      }

      const params = routeContext?.params ? await routeContext.params : ({} as P);
      return await handler({ auth, request, params });
    } catch (error) {
      return jsonError(error);
    }
  };
}

/** Unauthenticated route wrapper (auth endpoints). */
export function withoutUser(
  handler: (context: { request: Request }) => Promise<NextResponse>,
  options: { rateLimit?: RateLimitName } = {},
) {
  return async (request: Request): Promise<NextResponse> => {
    try {
      if (options.rateLimit) {
        enforceRateLimit(options.rateLimit, clientIdentifier(request.headers));
      }
      return await handler({ request });
    } catch (error) {
      return jsonError(error);
    }
  };
}
