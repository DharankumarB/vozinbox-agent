import { z } from 'zod';
import { intQuery, jsonOk, optionalQuery, parseJson, withUser } from '@/lib/api';
import { getStore } from '@/lib/store';

export const GET = withUser(async ({ auth, request }) => {
  const store = await getStore();
  const notifications = await store.listNotifications(auth.id, {
    unreadOnly: optionalQuery(request, 'unreadOnly') === 'true',
    limit: intQuery(request, 'limit', 50),
  });
  const counters = await store.dashboardCounters(auth.id);
  return jsonOk({ notifications, unreadCount: counters.unreadNotifications });
});

const patchSchema = z.object({ markAllRead: z.boolean().optional() });

export const PATCH = withUser(
  async ({ auth, request }) => {
    const body = await parseJson(request, patchSchema);
    const store = await getStore();
    if (body.markAllRead) {
      const updated = await store.markAllNotificationsRead(auth.id);
      return jsonOk({ updated });
    }
    return jsonOk({ updated: 0 });
  },
  { rateLimit: 'notificationMutation' },
);

export const runtime = 'nodejs';
