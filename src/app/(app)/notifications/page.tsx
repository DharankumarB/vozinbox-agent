import type { Metadata } from 'next';
import { requireAuthContext } from '@/lib/auth';
import { getStore } from '@/lib/store';
import { PageHeader } from '@/components/layout/PageHeader';
import { NotificationsView } from '@/components/notifications/NotificationsView';

export const metadata: Metadata = { title: 'Notifications' };
export const dynamic = 'force-dynamic';

export default async function NotificationsPage() {
  const auth = await requireAuthContext();
  const store = await getStore();
  const notifications = await store.listNotifications(auth.id, { limit: 100 });

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <PageHeader
        title="Notifications"
        description="Important email, deadlines, task suggestions and integration issues."
      />
      <NotificationsView notifications={notifications} />
    </div>
  );
}
