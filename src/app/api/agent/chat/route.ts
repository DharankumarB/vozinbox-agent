import { z } from 'zod';
import { jsonOk, parseJson, withUser } from '@/lib/api';
import { getStore } from '@/lib/store';
import { chatFailureMessage, runAssistant } from '@/lib/ai/chat';
import { toAppError } from '@/lib/errors';
import { logger } from '@/lib/logger';

const schema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1).max(4000),
      }),
    )
    .min(1)
    .max(24),
});

export const POST = withUser(
  async ({ auth, request }) => {
    const input = await parseJson(request, schema);
    const store = await getStore();

    try {
      const result = await runAssistant({
        store,
        userId: auth.id,
        timezone: auth.timezone,
        turns: input.messages,
      });

      // Record assistant activity so the Agent Activity page reflects it (§38).
      await store.logAgentAction({
        user_id: auth.id,
        run_id: null,
        action_type: 'TOOL_CALLED',
        title: 'Assistant answered a question',
        detail: result.toolTrace.length > 0 ? result.toolTrace.map((trace) => trace.summary).join(' ') : 'Answered from stored inbox analysis.',
        tool_name: result.toolTrace[0]?.name ?? null,
        email_id: null,
        task_id: null,
        notification_id: null,
        severity: 'info',
        payload: { tools: result.toolTrace, rounds: result.rounds },
      });

      return jsonOk({ reply: result.reply, tools: result.toolTrace });
    } catch (error) {
      const appError = toAppError(error, 'AI_FAILED');
      logger.warn('assistant.failed', { userId: auth.id, code: appError.code });
      // Surface the failure honestly rather than pretending to answer (§65).
      return jsonOk({
        reply: chatFailureMessage(error),
        tools: [],
        degraded: true,
        errorCode: appError.code,
      });
    }
  },
  { rateLimit: 'aiChat' },
);

export const runtime = 'nodejs';
export const maxDuration = 60;
