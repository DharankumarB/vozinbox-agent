import { z } from 'zod';
import { AppError } from '@/lib/errors';
import { EMAIL_CATEGORIES, EMAIL_PRIORITIES } from '@/lib/types/domain';

/**
 * Structured output contract for email analysis (§33).
 *
 * Two parallel definitions of the same shape:
 *  • `analysisJsonSchema` — hand-written JSON Schema sent to the provider with
 *    `strict: true`. Every property is required and `additionalProperties` is
 *    false, which is what strict structured outputs demand.
 *  • `analysisResponseSchema` — zod validation of whatever comes back. The model
 *    is not trusted to honour the schema; invalid output is retried and, if it
 *    still fails, stored as an analysis failure rather than written as data.
 */

const categoryEnum = [...EMAIL_CATEGORIES] as [string, ...string[]];
const priorityEnum = [...EMAIL_PRIORITIES] as [string, ...string[]];

const nullableString = { type: ['string', 'null'] } as const;

export const analysisJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'category',
    'secondary_categories',
    'summary',
    'action_required',
    'priority',
    'priority_reason',
    'suggested_action',
    'deadline',
    'other_dates',
    'people',
    'organizations',
    'links',
    'attachments_present',
    'suggested_task',
    'confidence',
  ],
  properties: {
    category: { type: 'string', enum: categoryEnum },
    secondary_categories: { type: 'array', items: { type: 'string', enum: categoryEnum } },
    summary: { type: 'string' },
    action_required: { type: 'boolean' },
    priority: { type: 'string', enum: priorityEnum },
    priority_reason: { type: 'string' },
    suggested_action: nullableString,
    deadline: {
      type: 'object',
      additionalProperties: false,
      required: ['date', 'time', 'timezone', 'type', 'source_sentence', 'confidence'],
      properties: {
        date: nullableString,
        time: nullableString,
        timezone: nullableString,
        type: { type: 'string', enum: ['EXPLICIT', 'RELATIVE', 'INFERRED', 'UNKNOWN'] },
        source_sentence: nullableString,
        confidence: { type: 'number' },
      },
    },
    other_dates: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['date', 'time', 'label', 'source_sentence', 'confidence'],
        properties: {
          date: nullableString,
          time: nullableString,
          label: nullableString,
          source_sentence: nullableString,
          confidence: { type: 'number' },
        },
      },
    },
    people: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'email', 'role'],
        properties: { name: { type: 'string' }, email: nullableString, role: nullableString },
      },
    },
    organizations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'confidence'],
        properties: { name: { type: 'string' }, confidence: { type: 'number' } },
      },
    },
    links: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['url', 'label'],
        properties: { url: { type: 'string' }, label: nullableString },
      },
    },
    attachments_present: { type: 'array', items: { type: 'string' } },
    suggested_task: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['title', 'description', 'due_date', 'due_time'],
      properties: {
        title: { type: 'string' },
        description: nullableString,
        due_date: nullableString,
        due_time: nullableString,
      },
    },
    confidence: {
      type: 'object',
      additionalProperties: false,
      required: ['category', 'action', 'deadline', 'priority'],
      properties: {
        category: { type: 'number' },
        action: { type: 'number' },
        deadline: { type: 'number' },
        priority: { type: 'number' },
      },
    },
  },
} as const;

const confidenceSchema = z.object({
  category: z.number().min(0).max(1),
  action: z.number().min(0).max(1),
  deadline: z.number().min(0).max(1),
  priority: z.number().min(0).max(1),
});

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
  .nullable();

const clockTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:mm')
  .nullable();

export const analysisResponseSchema = z.object({
  category: z.enum(EMAIL_CATEGORIES),
  secondary_categories: z.array(z.enum(EMAIL_CATEGORIES)).max(4).default([]),
  summary: z.string().min(1).max(2000),
  action_required: z.boolean(),
  priority: z.enum(EMAIL_PRIORITIES),
  priority_reason: z.string().min(1).max(600),
  suggested_action: z.string().max(300).nullable(),
  deadline: z.object({
    date: isoDate,
    time: clockTime,
    timezone: z.string().max(64).nullable(),
    type: z.enum(['EXPLICIT', 'RELATIVE', 'INFERRED', 'UNKNOWN']),
    source_sentence: z.string().max(600).nullable(),
    confidence: z.number().min(0).max(1),
  }),
  other_dates: z
    .array(
      z.object({
        date: isoDate,
        time: clockTime,
        label: z.string().max(120).nullable(),
        source_sentence: z.string().max(600).nullable(),
        confidence: z.number().min(0).max(1),
      }),
    )
    .max(8)
    .default([]),
  people: z
    .array(
      z.object({
        name: z.string().min(1).max(120),
        email: z.string().max(200).nullable(),
        role: z.string().max(80).nullable(),
      }),
    )
    .max(12)
    .default([]),
  organizations: z
    .array(z.object({ name: z.string().min(1).max(160), confidence: z.number().min(0).max(1) }))
    .max(10)
    .default([]),
  links: z
    .array(z.object({ url: z.string().max(2048), label: z.string().max(200).nullable() }))
    .max(25)
    .default([]),
  attachments_present: z.array(z.string().max(200)).max(20).default([]),
  suggested_task: z
    .object({
      title: z.string().min(3).max(200),
      description: z.string().max(1000).nullable(),
      due_date: isoDate,
      due_time: clockTime,
    })
    .nullable(),
  confidence: confidenceSchema,
});

export type AnalysisResponse = z.infer<typeof analysisResponseSchema>;

/**
 * Validate the model's output.
 * Throws `AI_INVALID_OUTPUT` (a retryable, non-persisting failure) when the
 * payload does not match — malformed data is never written to the database.
 */
export function validateAnalysisResponse(raw: unknown): AnalysisResponse {
  const result = analysisResponseSchema.safeParse(raw);
  if (result.success) return normaliseAnalysisResponse(result.data);

  const issues = result.error.issues
    .slice(0, 8)
    .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
    .join('; ');

  throw new AppError('AI_INVALID_OUTPUT', {
    message: `AI analysis output failed schema validation: ${issues}`,
    context: { issues },
  });
}

function normaliseAnalysisResponse(input: AnalysisResponse): AnalysisResponse {
  return {
    ...input,
    summary: input.summary.trim().slice(0, 1200),
    priority_reason: input.priority_reason.trim().slice(0, 500),
    suggested_action: input.suggested_action?.trim() || null,
    // A deadline object without a date carries no information — keep it explicit.
    deadline: {
      ...input.deadline,
      source_sentence: input.deadline.source_sentence?.trim() || null,
    },
  };
}
