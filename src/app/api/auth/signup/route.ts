import { z } from 'zod';
import { jsonOk, parseJson, withoutUser } from '@/lib/api';
import { signUp } from '@/lib/auth';
import { AppError } from '@/lib/errors';
import { isValidTimezone } from '@/lib/analysis/dates';

const schema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(200),
  fullName: z.string().max(120).optional(),
  timezone: z.string().max(64).optional(),
});

export const POST = withoutUser(
  async ({ request }) => {
    const input = await parseJson(request, schema);
    const timezone = input.timezone && isValidTimezone(input.timezone) ? input.timezone : 'UTC';

    const result = await signUp({
      email: input.email.toLowerCase().trim(),
      password: input.password,
      fullName: input.fullName?.trim() || null,
      timezone,
    });

    if (!result.user) {
      throw new AppError('INTERNAL', {
        message: 'Signup returned no user',
        userMessage: 'We could not create your account. Please try again.',
      });
    }

    return jsonOk({
      user: { id: result.user.id, email: result.user.email },
      requiresEmailConfirmation: result.requiresEmailConfirmation,
    });
  },
  { rateLimit: 'authAttempt' },
);

export const runtime = 'nodejs';
