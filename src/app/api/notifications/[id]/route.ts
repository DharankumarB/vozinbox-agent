import { z } from 'zod';
import { jsonOk, parseJson, withUser } from '@/lib/api';
import { getStore } from '@/lib/store';

type Params = { id: string };

const patchSchema = z.object({ read: z.boolean() });

export const PATCH = withUser<Params>(
  async ({ auth, params, request }) => {
    const body = await parseJson(request, patchSchema);
    const store = await getStore();
    await store.setNotificationRead(auth.id, params.id, body.read);
    return jsonOk({ updated: true });
  },
  { rateLimit: 'notificationMutation' },
);

export const DELETE = withUser<Params>(
  async ({ auth, params }) => {
    const store = await getStore();
    await store.deleteNotification(auth.id, params.id);
    return jsonOk({ deleted: true });
  },
  { rateLimit: 'notificationMutation' },
);

export const runtime = 'nodejs';
