import { jsonOk, withUser } from '@/lib/api';
import { loadDashboard } from '@/lib/services/dashboard';

export const GET = withUser(async ({ auth }) => {
  const dashboard = await loadDashboard({ store: await (await import('@/lib/store')).getStore(), userId: auth.id });
  return jsonOk({
    counters: dashboard.counters,
    deadlines: dashboard.deadlines.map((entry) => ({
      emailId: entry.email.id,
      subject: entry.email.subject,
      sender: entry.email.sender_name ?? entry.email.sender_email,
      dueDate: entry.dueDate,
      dueTime: entry.dueTime,
      daysRemaining: entry.daysRemaining,
    })),
    activity: dashboard.activity,
  });
});

export const runtime = 'nodejs';
