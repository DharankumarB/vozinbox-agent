import 'server-only';

import { redactSecrets } from './crypto';

/**
 * Structured server logger (§45).
 *
 * Logs execution, tool calls, errors, sync events, analysis failures and
 * notification creation. Never logs tokens, passwords or credentials — the
 * redaction pass runs on every value regardless of caller discipline.
 */

type Level = 'debug' | 'info' | 'warn' | 'error';

export interface LogFields {
  [key: string]: unknown;
}

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function minLevel(): Level {
  const configured = (process.env.LOG_LEVEL ?? '').toLowerCase();
  if (configured === 'debug' || configured === 'info' || configured === 'warn' || configured === 'error') {
    return configured;
  }
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
}

function scrub(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[truncated]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactSecrets(value).slice(0, 2000);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Error) {
    return { name: value.name, message: redactSecrets(value.message).slice(0, 1000) };
  }
  if (Array.isArray(value)) return value.slice(0, 25).map((entry) => scrub(entry, depth + 1));
  if (typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>).slice(0, 40)) {
      if (/token|password|secret|credential|authorization|cookie|refresh|access_token/i.test(key)) {
        output[key] = '[redacted]';
        continue;
      }
      output[key] = scrub(entry, depth + 1);
    }
    return output;
  }
  return String(value);
}

function emit(level: Level, event: string, fields: LogFields = {}): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel()]) return;
  const payload = {
    ts: new Date().toISOString(),
    level,
    event,
    ...(scrub(fields) as Record<string, unknown>),
  };
  const line = JSON.stringify(payload);
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    // eslint-disable-next-line no-console -- the logger is the single sink for structured output.
    console.log(line);
  }
}

export const logger = {
  debug: (event: string, fields?: LogFields) => emit('debug', event, fields),
  info: (event: string, fields?: LogFields) => emit('info', event, fields),
  warn: (event: string, fields?: LogFields) => emit('warn', event, fields),
  error: (event: string, fields?: LogFields) => emit('error', event, fields),
};

export { redactSecrets };
