import 'server-only';

import { aiConfig, type AIConfig } from '@/lib/env';
import { AppError, toAppError } from '@/lib/errors';
import { logger } from '@/lib/logger';

/**
 * Provider-agnostic chat-completions client.
 *
 * Targets the OpenAI-compatible `/chat/completions` contract so operators can
 * point `AI_BASE_URL` at OpenAI, Azure OpenAI, OpenRouter, Groq, Together,
 * vLLM or a local Ollama instance without code changes.
 *
 * Structured output (§33) is requested in the strongest form the provider
 * supports: `json_schema` first, then `json_object`, then prompt-only JSON.
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  name?: string;
  tool_calls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface JsonSchemaFormat {
  type: 'json_schema';
  name: string;
  schema: Record<string, unknown>;
}

export interface JsonObjectFormat {
  type: 'json_object';
}

export interface CompletionResult {
  content: string;
  toolCalls: ToolCall[];
  refusal: string | null;
  model: string;
  finishReason: string | null;
  usage: { promptTokens: number | null; completionTokens: number | null } | null;
}

export interface CompletionOptions {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: JsonSchemaFormat | JsonObjectFormat;
  tools?: ToolDefinition[];
  timeoutMs?: number;
  /** Set for internal logging context only; never sent to the provider. */
  operation?: string;
}

type WireMode = 'json_schema' | 'json_object' | 'prompt';

const workingMode = new Map<string, WireMode>();

export function isAIConfigured(): boolean {
  try {
    return aiConfig() !== null;
  } catch {
    return false;
  }
}

function requireConfig(): AIConfig {
  const config = aiConfig();
  if (!config) {
    throw new AppError('AI_UNAVAILABLE', {
      message: 'AI_API_KEY is not configured',
      userMessage:
        'The AI service is not connected on this deployment yet. Connect an AI provider to enable analysis.',
    });
  }
  return config;
}

function initialMode(config: AIConfig): WireMode {
  if (config.structuredOutputMode === 'auto') return 'json_schema';
  return config.structuredOutputMode;
}

/**
 * Call the provider. JSON-schema requests that the provider rejects are
 * automatically retried with a weaker format before surfacing an error.
 */
export async function createChatCompletion(options: CompletionOptions): Promise<CompletionResult> {
  const config = requireConfig();
  const modeKey = `${config.baseUrl}|${options.model ?? config.model}`;
  const requested = options.responseFormat
    ? initialMode(config)
    : 'prompt';
  const mode: WireMode = options.responseFormat
    ? (workingMode.get(modeKey) ?? requested)
    : 'prompt';

  try {
    return await performRequest(options, mode, config);
  } catch (error) {
    const appError = toAppError(error, 'AI_FAILED');
    const isFormatRejection =
      options.responseFormat &&
      mode === 'json_schema' &&
      /response_format|json_schema|unsupported|invalid_request/i.test(appError.message);

    if (isFormatRejection) {
      logger.warn('ai.format_fallback', {
        operation: options.operation ?? 'unknown',
        from: 'json_schema',
        to: 'json_object',
        detail: appError.message,
      });
      workingMode.set(modeKey, 'json_object');
      return performRequest(options, 'json_object', config);
    }
    throw appError;
  }
}

async function performRequest(
  options: CompletionOptions,
  mode: WireMode,
  config: AIConfig,
): Promise<CompletionResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? config.timeoutMs);
  const started = Date.now();

  const body: Record<string, unknown> = {
    model: options.model ?? config.model,
    messages: options.messages,
  };
  if (typeof options.temperature === 'number') body.temperature = options.temperature;
  if (typeof options.maxTokens === 'number') body.max_tokens = options.maxTokens;
  if (options.tools && options.tools.length > 0) {
    body.tools = options.tools;
    body.tool_choice = 'auto';
  }

  if (options.responseFormat) {
    if (mode === 'json_schema' && options.responseFormat.type === 'json_schema') {
      body.response_format = {
        type: 'json_schema',
        json_schema: {
          name: options.responseFormat.name,
          strict: true,
          schema: options.responseFormat.schema,
        },
      };
    } else if (mode === 'json_object') {
      body.response_format = { type: 'json_object' };
    }
    // mode === 'prompt': rely on instructions only.
  }

  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: 'no-store',
    });

    if (!response.ok) {
      const detail = await safeErrorText(response);
      const code = response.status;
      logger.error('ai.request_failed', {
        operation: options.operation ?? 'unknown',
        status: code,
        detail,
      });
      if (code === 429) {
        throw new AppError('PROVIDER_RATE_LIMITED', {
          message: `AI provider rate limited: ${detail}`,
          userMessage: 'The AI service is busy right now. Please try again in a moment.',
        });
      }
      if (code === 401 || code === 403) {
        throw new AppError('AI_FAILED', {
          message: `AI provider rejected credentials: ${detail}`,
          userMessage: 'The AI provider rejected our credentials. Please check the API key configuration.',
        });
      }
      throw new AppError('AI_FAILED', {
        message: `AI provider error ${code}: ${detail}`,
      });
    }

    const payload = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string | null;
          refusal?: string | null;
          tool_calls?: ToolCall[];
        };
        finish_reason?: string | null;
      }>;
      model?: string;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const choice = payload.choices?.[0];
    const message = choice?.message;

    return {
      content: message?.content ?? '',
      toolCalls: message?.tool_calls ?? [],
      refusal: message?.refusal ?? null,
      model: payload.model ?? String(body.model),
      finishReason: choice?.finish_reason ?? null,
      usage: payload.usage
        ? {
            promptTokens: payload.usage.prompt_tokens ?? null,
            completionTokens: payload.usage.completion_tokens ?? null,
          }
        : null,
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    const appError = toAppError(error, 'AI_FAILED');
    logger.error('ai.request_exception', {
      operation: options.operation ?? 'unknown',
      code: appError.code,
      detail: appError.message,
      durationMs: Date.now() - started,
    });
    if (appError.code === 'TIMEOUT') {
      throw new AppError('AI_FAILED', {
        message: 'AI request timed out',
        userMessage: 'The AI service took too long to respond. Please try again.',
        cause: error,
      });
    }
    throw new AppError('AI_FAILED', {
      message: appError.message,
      cause: error,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function safeErrorText(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, 500);
  } catch {
    return response.statusText;
  }
}

/**
 * Extract a JSON object from a model response. Handles fenced code blocks and
 * stray prose that some providers emit despite JSON mode (§33 — validate before
 * writing anything to the database).
 */
export function extractJson(content: string): unknown {
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    throw new AppError('AI_INVALID_OUTPUT', { message: 'Empty AI response' });
  }

  const candidates: string[] = [trimmed];

  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fenced?.[1]) candidates.push(fenced[1].trim());

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      continue;
    }
  }

  throw new AppError('AI_INVALID_OUTPUT', {
    message: 'AI response was not valid JSON',
    userMessage: 'The AI returned an unexpected result, so nothing was saved.',
  });
}
