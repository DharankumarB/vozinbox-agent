import { z } from 'zod';
import { jsonOk, parseJson, withUser } from '@/lib/api';
import { updatePassword } from '@/lib/auth';

const schema = z.object({ password: z.string().min(8).max(200) });

export const POST = withUser(
  async ({ request }) => {
    const input = await parseJson(request, schema);
    await updatePassword(input.password);
    return jsonOk({ updated: true });
  },
  { rateLimit: 'profileMutation' },
);

export const runtime = 'nodejs';
