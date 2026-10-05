import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * The test suite covers the deterministic core of VozInbox Agent: date and
 * deadline extraction, priority scoring, the rules engine, thread precedence,
 * duplicate prevention, prompt-injection guardrails, grounding verification,
 * natural-language search parsing, token encryption and rate limiting.
 *
 * These modules are pure (no network, no database, no Next.js runtime), which is
 * exactly why they are the parts of the product that must never regress.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    reporters: 'default',
    restoreMocks: true,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // `server-only` is a bundler guard, not runtime behaviour — stub it so the
      // data layer can be tested directly.
      'server-only': fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url)),
    },
  },
});
