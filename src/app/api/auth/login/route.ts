import { z } from 'zod';
import { jsonOk, parseJson, withoutUser } from '@/lib/api';
import { signIn } from '@/lib/auth';
import { AppError } from '@/lib/errors';

const schema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(200),
});

export const POST = withoutUser(
  async ({ request }) => {
    const input = await parseJson(request, schema);
    const result = await signIn({ email: input.email.toLowerCase().trim(), password: input.password });
    if (!result.user) {
      throw new AppError('UNAUTHENTICATED', {
        userMessage: 'That email and password combination does not match our records.',
      });
    }
    return jsonOk({ user: { id: result.user.id, email: result.user.email } });
  },
  { rateLimit: 'authAttempt' },
);

export const runtime = 'nodejs';
