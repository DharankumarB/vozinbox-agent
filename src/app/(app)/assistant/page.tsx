import type { Metadata } from 'next';
import { requireAuthContext } from '@/lib/auth';
import { getStore } from '@/lib/store';
import { capabilityReport } from '@/lib/env';
import { greeting } from '@/lib/greeting';
import { PageHeader } from '@/components/layout/PageHeader';
import { AssistantChat } from '@/components/chat/AssistantChat';

export const metadata: Metadata = { title: 'Assistant' };
export const dynamic = 'force-dynamic';

export default async function AssistantPage() {
  const auth = await requireAuthContext();
  const store = await getStore();
  const counters = await store.dashboardCounters(auth.id);
  const { ai } = capabilityReport();

  const name =
    auth.fullName?.split(' ')[0] ??
    auth.profile.full_name?.split(' ')[0] ??
    auth.email?.split('@')[0] ??
    'there';

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <PageHeader
        title="Assistant"
        description="Ask questions about your inbox in plain language. Answers are grounded in what VozInbox actually read."
        action={<span className="chip chip-neutral">{greeting(auth.timezone)}</span>}
      />
      <p className="text-xs text-mist-500">
        Grounded in {counters.totalEmails} stored {counters.totalEmails === 1 ? 'message' : 'messages'} and{' '}
        {counters.pendingTasks} open {counters.pendingTasks === 1 ? 'task' : 'tasks'}. Every answer cites real
        message data or says it does not know — it will never invent a date, name or deadline.
      </p>
      <AssistantChat aiConfigured={ai === 'configured'} greetingName={name} />
    </div>
  );
}
