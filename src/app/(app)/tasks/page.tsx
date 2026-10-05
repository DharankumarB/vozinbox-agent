import type { Metadata } from 'next';
import { requireAuthContext } from '@/lib/auth';
import { getStore } from '@/lib/store';
import { PageHeader } from '@/components/layout/PageHeader';
import { TasksView } from '@/components/tasks/TasksView';

export const metadata: Metadata = { title: 'Tasks' };
export const dynamic = 'force-dynamic';

export default async function TasksPage() {
  const auth = await requireAuthContext();
  const store = await getStore();
  const page = await store.listTasks({ userId: auth.id, status: 'ALL', limit: 200, sort: 'DUE_SOONEST' });

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5">
      <PageHeader
        title="Tasks"
        description="Suggested actions from your inbox, plus anything you have added yourself."
      />
      <TasksView items={page.items} timezone={auth.timezone} />
    </div>
  );
}
