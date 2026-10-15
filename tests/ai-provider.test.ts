import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChatCompletion } from '@/lib/ai/provider';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('AI structured output mode', () => {
  it('honors an explicit JSON-object request when provider configuration defaults to auto', async () => {
    vi.stubEnv('AI_API_KEY', 'test-key');
    vi.stubEnv('AI_BASE_URL', 'https://provider.example/v1');
    vi.stubEnv('AI_STRUCTURED_OUTPUT_MODE', 'auto');
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        model: 'test-model',
        choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }],
      }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await createChatCompletion({
      operation: 'json-test',
      messages: [{ role: 'user', content: 'Return JSON.' }],
      responseFormat: { type: 'json_object' },
    });
    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      response_format?: { type?: string };
    };
    expect(request.response_format).toEqual({ type: 'json_object' });
  });
});
