import type { Metadata } from 'next';
import { requireAuthContext } from '@/lib/auth';
import { getStore } from '@/lib/store';
import { capabilityReport } from '@/lib/env';
import { PageHeader } from '@/components/layout/PageHeader';
import { SettingsView } from '@/components/settings/SettingsView';

export const metadata: Metadata = { title: 'Settings' };
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const auth = await requireAuthContext();
  const store = await getStore();

  const [accounts, emailCount, taskPage, notifications] = await Promise.all([
    store.listAccounts(auth.id),
    store.countEmails(auth.id),
    store.listTasks({ userId: auth.id, status: 'ALL', limit: 1 }),
    store.listNotifications(auth.id, { limit: 200 }),
  ]);

  const { ai } = capabilityReport();

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <PageHeader
        title="Settings"
        description="Account, notifications, AI behaviour and the data VozInbox keeps about you."
      />
      <SettingsView
        profile={auth.profile}
        preferences={auth.preferences}
        email={auth.email}
        authSource={auth.source}
        gmailConnected={accounts.some((account) => account.status === 'CONNECTED')}
        aiConfigured={ai === 'configured'}
        dataCounts={{
          emails: emailCount,
          tasks: taskPage.total,
          notifications: notifications.length,
        }}
      />
    </div>
  );
}
