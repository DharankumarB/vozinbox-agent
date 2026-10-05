import { jsonOk, withUser } from '@/lib/api';
import { getStore } from '@/lib/store';
import { analyzeEmailById } from '@/lib/services/agent';

export const POST = withUser<{ id: string }>(
  async ({ auth, params }) => {
    const store = await getStore();
    const result = await analyzeEmailById({
      store,
      userId: auth.id,
      emailId: params.id,
      timezone: auth.timezone,
      force: true,
    });

    return jsonOk({
      status: result.status,
      taskId: result.taskId,
      notifications: result.notifications,
      changes: result.changes,
      error: result.error,
    });
  },
  { rateLimit: 'aiAnalysis' },
);

export const runtime = 'nodejs';
export const maxDuration = 60;
