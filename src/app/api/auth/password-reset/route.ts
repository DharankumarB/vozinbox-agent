import { z } from 'zod';
import { jsonOk, parseJson, withoutUser } from '@/lib/api';
import { requestPasswordReset } from '@/lib/auth';
import { logger } from '@/lib/logger';

const schema = z.object({ email: z.string().email().max(254) });

export const POST = withoutUser(
  async ({ request }) => {
    const input = await parseJson(request, schema);
    let delivered = true;
    try {
      await requestPasswordReset(input.email.toLowerCase().trim());
    } catch (error) {
      // Never reveal whether an address exists — and never fail the UI here.
      delivered = false;
      logger.warn('auth.password_reset_unavailable', { detail: String(error) });
    }
    return jsonOk({
      delivered,
      message: delivered
        ? 'If an account exists for that address, a reset link is on its way.'
        : 'Password reset is not available on this deployment yet. Please contact the administrator.',
    });
  },
  { rateLimit: 'authAttempt' },
);

export const runtime = 'nodejs';
