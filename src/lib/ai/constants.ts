/** Shared constants for the AI layer. */

/** Fallback model label used when a provider omits the model in its response. */
export const CHAT_MODEL_LABEL = 'configured-model';

export const AI_ERROR_CODES = [
  'AI_FAILED',
  'AI_INVALID_OUTPUT',
  'AI_UNAVAILABLE',
] as const;
