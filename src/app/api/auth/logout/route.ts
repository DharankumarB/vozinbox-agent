import { jsonOk, withoutUser } from '@/lib/api';
import { signOut } from '@/lib/auth';

export const POST = withoutUser(async () => {
  await signOut();
  return jsonOk({ signedOut: true });
});

export const runtime = 'nodejs';
