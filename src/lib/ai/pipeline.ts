import 'server-only';

import { aiConfig, analysisVersion, agentLimits } from '@/lib/env';
import { AppError, toAppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import type { Email, UserPreferences } from '@/lib/types/database';
import type { ThreadState } from '@/lib/types/database';
import type {
  DetectedDate,
  DetectedChange,
  EmailAnalysisResult,
  ProposedTask,
} from '@/lib/types/domain';
import { buildDedupeKey, checkDuplicate } from '@/lib/analysis/dedupe';
import { extractDeadline, getZonedParts, safeTimezone } from '@/lib/analysis/dates';
import { assessPriority } from '@/lib/analysis/priority';
import { runRulesAnalysis } from '@/lib/analysis/rules';
import { computeThreadState, describeChanges } from '@/lib/analysis/thread';
import type { PriorAnalysis, Store } from '@/lib/store/types';
import { applyGrounding, inspectUntrustedContent, verifyGrounding } from './guardrails';
import { buildAnalysisPrompt } from './prompts';
import type { AnalysisResponse } from './schemas';
import { analysisJsonSchema, validateAnalysisResponse } from './schemas';
import { createChatCompletion, extractJson, isAIConfigured } from './provider';
import { CHAT_MODEL_LABEL } from './constants';

/**
 * The agent pipeline (§21).
 *
 * STEP 1  receive email
 * STEP 2  validate source
 * STEP 3  fetch content
 * STEP 4  analyse (AI when configured, deterministic rules otherwise)
 * STEP 5  classify
 * STEP 6  extract structured information
 * STEP 7  calculate confidence
 * STEP 8  check duplicates
 * STEP 9  check existing related tasks
 * STEP 10 generate suggested action (never an irreversible write)
 * STEP 11 create notification if necessary
 * STEP 12 hand control back to the user for approval
 *
 * Every step is recorded in `agent_actions` so the user can audit exactly what
 * happened (§38). The loop is single-pass by design: no recursive tool calling,
 * and the tool depth bound from configuration is enforced.
 */

export interface PipelineInput {
  store: Store;
  userId: string;
  email: Email;
  preferences: UserPreferences;
  timezone: string;
  trigger: 'SYNC' | 'MANUAL' | 'REPROCESS' | 'CRON';
  threadState: ThreadState | null;
  priorAnalyses: PriorAnalysis[];
  force?: boolean;
}

export interface PipelineResult {
  runId: string;
  status: 'COMPLETED' | 'NEEDS_REVIEW' | 'FAILED' | 'SKIPPED';
  analysis: EmailAnalysisResult | null;
  taskId: string | null;
  changes: DetectedChange[];
  notifications: number;
  error: { code: string; message: string } | null;
}

export async function runEmailPipeline(input: PipelineInput): Promise<PipelineResult> {
  const { store, userId, email, preferences, timezone } = input;
  const started = Date.now();
  const limits = agentLimits();
  const maxToolDepth = aiConfig()?.maxToolDepth ?? 4;

  const run = await store.createRun({
    user_id: userId,
    trigger: input.trigger,
    email_id: email.id,
    thread_id: email.thread_id,
    max_tool_depth: maxToolDepth,
  });

  const step = async (
    action: Parameters<Store['logAgentAction']>[0]['action_type'],
    title: string,
    detail: string | null,
    extra: Partial<Parameters<Store['logAgentAction']>[0]> = {},
  ) => {
    await store.logAgentAction({
      user_id: userId,
      run_id: run.id,
      action_type: action,
      title,
      detail,
      tool_name: extra.tool_name ?? null,
      email_id: email.id,
      task_id: extra.task_id ?? null,
      notification_id: extra.notification_id ?? null,
      severity: extra.severity ?? 'info',
      payload: extra.payload ?? {},
    });
  };

  let notifications = 0;
  let taskId: string | null = null;
  let changes: DetectedChange[] = [];
  let analysis: EmailAnalysisResult | null = null;

  try {
    // ── STEP 1/2 — receive + validate source ─────────────────────────────────
    const validationError = validateSource(email, userId);
    if (validationError) {
      await store.updateEmail(userId, email.id, { analysis_state: 'SKIPPED' });
      await step('SOURCE_VALIDATED', 'Source validation failed', validationError, { severity: 'warning' });
      await finishRun(store, userId, run.id, started, {
        status: 'SKIPPED',
        error_code: 'MALFORMED_EMAIL',
        error_message: validationError,
      });
      return {
        runId: run.id,
        status: 'SKIPPED',
        analysis: null,
        taskId: null,
        changes: [],
        notifications: 0,
        error: { code: 'MALFORMED_EMAIL', message: validationError },
      };
    }
    await step('SOURCE_VALIDATED', 'Email source validated', `${email.provider} · ${email.provider_message_id}`);

    await store.updateEmail(userId, email.id, { analysis_state: 'ANALYZING' });

    // ── STEP 3 — content ────────────────────────────────────────────────────
    const bodyText = (email.body_text ?? email.snippet ?? '').trim();
    const sourceText = `${email.subject ?? ''}\n${bodyText}`.trim();
    const injection = inspectUntrustedContent(sourceText);
    if (injection.flagged) {
      await step(
        'GUARDRAIL_BLOCKED',
        'Instruction-like content detected in email',
        `Signals: ${injection.signals.join(', ')}. Content was treated as untrusted data and not acted upon.`,
        { severity: 'warning', payload: { signals: injection.signals, score: injection.score } },
      );
    }
    await store.updateRun(userId, run.id, {
      current_step: 'ANALYSING',
      steps_completed: ['SOURCE_VALIDATED', 'CONTENT_FETCHED'],
    });

    // ── STEPS 4–7 — analysis, classification, extraction, confidence ────────
    const outcome = await analyseEmail({
      email,
      bodyText,
      preferences,
      timezone,
      priorAnalyses: input.priorAnalyses,
      threadState: input.threadState,
    });
    analysis = outcome.analysis;

    // The guardrail verdict applies to the *content*, not to the analysis path:
    // it is recorded whichever engine produced the analysis (§43, §44).
    if (injection.flagged) {
      analysis = {
        ...analysis,
        injection_flagged: true,
        injection_signals: injection.signals,
        needs_review: true,
        review_reason: [
          analysis.review_reason,
          'This message contains text addressed to an AI assistant. It was treated strictly as email content and was not acted on.',
        ]
          .filter(Boolean)
          .join(' '),
      };
    }

    await step('EMAIL_ANALYZED', 'Email analysed', `${analysis.category} · ${analysis.priority} · confidence ${(analysis.confidence.overall * 100).toFixed(0)}%`, {
      tool_name: analysis.analysis_source === 'AI_PROVIDER' ? 'ai_analysis' : 'rules_engine',
      payload: { source: analysis.analysis_source, model: analysis.model_name },
    });
    await step('EMAIL_CLASSIFIED', 'Category assigned', `${analysis.category} (${(analysis.confidence.category * 100).toFixed(0)}% confidence)`);

    if (analysis.detected_deadline?.date) {
      await step(
        'DEADLINE_DETECTED',
        'Deadline detected',
        `${analysis.detected_deadline.date}${analysis.detected_deadline.time ? ` at ${analysis.detected_deadline.time}` : ' (no time stated)'}`,
        { payload: { deadline: analysis.detected_deadline } },
      );
    }
    if (analysis.action_required && analysis.suggested_action) {
      await step('ACTION_EXTRACTED', 'Action extracted', analysis.suggested_action);
    }
    await step('PRIORITY_DETECTED', 'Priority assessed', `${analysis.priority} — ${analysis.priority_reason ?? 'no reason recorded'}`);

    // Persist the analysis record.
    const stored = await store.upsertAnalysis({
      user_id: userId,
      email_id: email.id,
      thread_id: email.thread_id,
      result: analysis,
    });

    // Extracted actions (§11) — recorded for auditability.
    if (analysis.action_required && analysis.suggested_action) {
      await store.upsertEmailActions([
        {
          user_id: userId,
          email_id: email.id,
          analysis_id: stored.id,
          action_text: analysis.suggested_action,
          action_type: 'GENERAL',
          source_sentence: analysis.detected_deadline?.source_sentence ?? analysis.summary,
          due_date: analysis.detected_deadline?.date ?? null,
          due_time: analysis.detected_deadline?.time ?? null,
          timezone: analysis.detected_deadline?.timezone ?? null,
          confidence: analysis.confidence.action,
          requires_review: analysis.needs_review,
        },
      ]);
    }

    // ── STEPS 8/9 — duplicates and existing related tasks ───────────────────
    const candidates = await store.findDuplicateCandidates({
      userId,
      sourceEmailId: email.id,
      sourceThreadId: email.thread_id,
    });
    await step(
      'DUPLICATE_CHECKED',
      'Checked for duplicate tasks',
      candidates.length === 0
        ? 'No related open tasks found.'
        : `Compared against ${candidates.length} open task(s) from this email or thread.`,
    );

    const threshold = Number(preferences.confidence_threshold ?? limits.defaultConfidenceThreshold);
    const suggestion = analysis.suggested_task;

    if (
      analysis.action_required &&
      suggestion &&
      preferences.auto_suggest_tasks &&
      analysis.confidence.action >= threshold
    ) {
      const decision = checkDuplicate({
        candidateTitle: suggestion.title,
        candidateDueDate: suggestion.due_date,
        candidateDueTime: suggestion.due_time,
        candidatePriority: analysis.priority,
        sourceEmailId: email.id,
        sourceThreadId: email.thread_id,
        existingTasks: candidates,
      });

      if (decision.duplicate && decision.existingTaskId) {
        // A later thread message may legitimately refine an existing task.
        if (decision.enrich && decision.enrichFields.includes('due_date')) {
          await store.updateTask(userId, decision.existingTaskId, {
            due_date: suggestion.due_date ?? null,
            due_time: suggestion.due_time ?? null,
            priority: analysis.priority,
          });
          await step('TASK_UPDATED', 'Existing task updated from a later message', `${suggestion.title} → ${suggestion.due_date ?? 'no date'}`, {
            task_id: decision.existingTaskId,
          });
        } else {
          await step('TASK_SUGGESTED', 'Task suggestion suppressed as duplicate', decision.reason);
        }
        taskId = decision.existingTaskId;
      } else {
        const created = await store.createTask({
          user_id: userId,
          title: suggestion.title,
          description: suggestion.description,
          source_email_id: email.id,
          source_thread_id: email.thread_id,
          source_action_id: null,
          category: analysis.category,
          priority: analysis.priority,
          due_date: suggestion.due_date,
          due_time: suggestion.due_time,
          timezone: analysis.detected_deadline?.timezone ?? timezone,
          status: 'SUGGESTED',
          origin: 'AI_SUGGESTED',
          dedupe_key: buildDedupeKey(email.id, suggestion.title),
        });
        taskId = created.id;
        await step('TASK_SUGGESTED', 'Task suggested', `${suggestion.title}${suggestion.due_date ? ` · due ${suggestion.due_date}` : ''}`, {
          task_id: created.id,
        });
      }
    } else if (analysis.action_required && suggestion && analysis.confidence.action < threshold) {
      await step(
        'TASK_SUGGESTED',
        'Possible action detected — confidence below threshold',
        `Action confidence ${(analysis.confidence.action * 100).toFixed(0)}% is below your ${(threshold * 100).toFixed(0)}% threshold, so no task was created automatically. Please review.`,
        { severity: 'warning' },
      );
    }

    // ── STEP 10/11 — thread state, change detection, notifications ──────────
    if (email.thread_id) {
      const threadUpdate = computeThreadState(analysis, {
        previousState: input.threadState,
        priorAnalyses: input.priorAnalyses,
      }, email.id, sourceText);

      changes = threadUpdate.changes;

      await store.updateThread(userId, email.thread_id, {
        thread_state: threadUpdate.state,
        changes_detected: [...(changes ?? [])],
        authoritative_email_id: email.id,
        last_message_at: email.received_at,
      });

      if (changes.length > 0) {
        await step(
          'CHANGE_DETECTED',
          'Thread information changed',
          changes.map((change) => change.description).join(' '),
          { severity: 'warning', payload: { changes } },
        );
        // Preserve the previous interpretation for audit (§15).
        const previousSnapshot = await store.getAnalysis(userId, email.id);
        if (previousSnapshot) {
          await store.insertAnalysisHistory({
            user_id: userId,
            email_id: email.id,
            thread_id: email.thread_id,
            snapshot: previousSnapshot,
            change_summary: changes,
            analysis_version: analysisVersion(),
          });
        }
        if (preferences.notify_deadline || preferences.notify_information) {
          const described = describeChanges(changes);
          if (described) {
            const notification = await store.createNotification({
              user_id: userId,
              type: changes.some((change) => change.type === 'DEADLINE_CHANGED') ? 'DEADLINE_CHANGED' : 'INFORMATION_CHANGED',
              title: described.title,
              message: described.message,
              priority: analysis.priority,
              entity_type: 'email',
              related_entity_id: email.id,
              action_url: `/inbox/${email.id}`,
              metadata: { changes },
              dedupe_key: `change:${email.id}:${changes[0]?.type ?? 'unknown'}`,
            });
            if (notification) {
              notifications += 1;
              await step('NOTIFICATION_CREATED', 'Change notification created', described.title, {
                notification_id: notification.id,
              });
            }
          }
        }
      } else {
        await store.updateThread(userId, email.thread_id, {
          thread_state: threadUpdate.state,
          changes_detected: [],
          authoritative_email_id: email.id,
        });
      }
    }

    notifications += await createPipelineNotifications({
      store,
      userId,
      email,
      analysis,
      preferences,
      taskId,
      step,
    });

    await store.updateEmail(userId, email.id, {
      analysis_state: 'ANALYZED',
      analyzed_at: new Date().toISOString(),
    });

    const status: PipelineResult['status'] = analysis.needs_review ? 'NEEDS_REVIEW' : 'COMPLETED';

    await finishRun(store, userId, run.id, started, {
      status,
      analysis_source: analysis.analysis_source,
      model_name: analysis.model_name,
      confidence: analysis.confidence.overall,
      steps_completed: [
        'SOURCE_VALIDATED',
        'CONTENT_FETCHED',
        'ANALYSED',
        'CLASSIFIED',
        'EXTRACTED',
        'CONFIDENCE_CALCULATED',
        'DUPLICATE_CHECKED',
        'SUGGESTION_GENERATED',
        'NOTIFICATIONS_CREATED',
      ],
      tool_calls: 1,
      current_step: 'COMPLETE',
    });

    logger.info('agent.pipeline_completed', {
      userId,
      emailId: email.id,
      runId: run.id,
      status,
      source: analysis.analysis_source,
      durationMs: Date.now() - started,
      notifications,
      taskId,
    });

    return { runId: run.id, status, analysis, taskId, changes, notifications, error: null };
  } catch (error) {
    const appError = toAppError(error, 'AI_FAILED');
    await store.updateEmail(userId, email.id, { analysis_state: 'FAILED' });
    await step('ANALYSIS_FAILED', 'Analysis failed', appError.userMessage, {
      severity: 'error',
      payload: { code: appError.code },
    });
    await finishRun(store, userId, run.id, started, {
      status: 'FAILED',
      error_code: appError.code,
      error_message: appError.message,
      current_step: 'FAILED',
    });
    logger.error('agent.pipeline_failed', {
      userId,
      emailId: email.id,
      runId: run.id,
      code: appError.code,
      detail: appError.message,
    });
    return {
      runId: run.id,
      status: 'FAILED',
      analysis,
      taskId,
      changes,
      notifications,
      error: { code: appError.code, message: appError.userMessage },
    };
  }
}

// ── Source validation (STEP 2) ───────────────────────────────────────────────

function validateSource(email: Email, userId: string): string | null {
  if (email.user_id !== userId) {
    return 'Email does not belong to the requesting user.';
  }
  if (!email.provider_message_id) {
    return 'Email is missing a provider message id.';
  }
  const hasContent = Boolean((email.body_text ?? '').trim() || (email.subject ?? '').trim() || (email.snippet ?? '').trim());
  if (!hasContent) {
    return 'Email has no readable subject or body.';
  }
  if ((email.body_text ?? '').length > 400_000) {
    return 'Email body exceeds the maximum analysable size.';
  }
  return null;
}

// ── Analysis (STEPS 4–7) ─────────────────────────────────────────────────────

interface AnalyseInput {
  email: Email;
  bodyText: string;
  preferences: UserPreferences;
  timezone: string;
  priorAnalyses: PriorAnalysis[];
  threadState: ThreadState | null;
}

async function analyseEmail(
  input: AnalyseInput,
): Promise<{ analysis: EmailAnalysisResult; usedAI: boolean }> {
  const { email, bodyText, preferences } = input;
  const tz = safeTimezone(input.timezone);
  const referenceInstant = new Date(email.received_at);

  const rulesResult = runRulesAnalysis({
    subject: email.subject,
    bodyText,
    senderName: email.sender_name,
    senderEmail: email.sender_email,
    attachments: email.attachments,
    referenceInstant,
    timezone: tz,
    importantSenders: preferences.important_senders ?? [],
    ignoredSenders: preferences.ignored_senders ?? [],
    summaryLength: preferences.summary_length,
    analysisVersion: analysisVersion(),
    deadlineDetectionEnabled: preferences.deadline_detection_enabled,
    priorityDetectionEnabled: preferences.priority_detection_enabled,
  });

  if (!isAIConfigured()) {
    return {
      analysis: {
        ...rulesResult,
        grounding_report: {
          ...rulesResult.grounding_report,
          notes: [
            ...rulesResult.grounding_report.notes,
            'AI provider is not configured — deterministic rules engine used.',
          ],
        },
      },
      usedAI: false,
    };
  }

  try {
    const analysis = await analyseWithAI(input);
    return { analysis, usedAI: true };
  } catch (error) {
    const appError = toAppError(error, 'AI_FAILED');
    logger.warn('agent.ai_fallback_to_rules', {
      userId: input.email.user_id,
      emailId: email.id,
      code: appError.code,
      detail: appError.message,
    });
    // §32: an AI failure must never leave the user without analysis. Fall back to
    // the deterministic engine, and disclose the degraded mode in the report.
    return {
      analysis: {
        ...rulesResult,
        needs_review: rulesResult.needs_review || appError.code === 'AI_INVALID_OUTPUT',
        review_reason:
          [rulesResult.review_reason, `AI analysis was unavailable (${appError.code}); this result comes from the rules engine.`]
            .filter(Boolean)
            .join(' ') || null,
        grounding_report: {
          ...rulesResult.grounding_report,
          notes: [...rulesResult.grounding_report.notes, `AI analysis failed (${appError.code}) — rules engine result used.`],
        },
      },
      usedAI: false,
    };
  }
}

async function analyseWithAI(input: AnalyseInput): Promise<EmailAnalysisResult> {
  const { email, bodyText, preferences } = input;
  const tz = safeTimezone(input.timezone);
  const referenceInstant = new Date(email.received_at);
  const parts = getZonedParts(referenceInstant, tz);
  const referenceDate = `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
  const referenceWeekday = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][parts.weekday] ?? 'Monday';

  const prompt = buildAnalysisPrompt({
    subject: email.subject,
    senderName: email.sender_name,
    senderEmail: email.sender_email,
    recipient: email.recipient,
    receivedAtIso: email.received_at,
    timezone: tz,
    referenceDate,
    referenceWeekday,
    bodyText,
    attachmentNames: email.attachments.map((attachment) => attachment.filename),
    summaryLength: preferences.summary_length,
    threadContext: input.priorAnalyses.slice(-3).map((prior) => ({
      from: prior.email_id,
      receivedAt: prior.received_at,
      text: '',
      summary: prior.suggested_action ? `${prior.category}: ${prior.suggested_action}` : prior.category,
    })),
    importantSenders: preferences.important_senders ?? [],
    ignoredSenders: preferences.ignored_senders ?? [],
  });

  const completion = await createChatCompletion({
    messages: [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
    ],
    model: undefined,
    temperature: 0.1,
    maxTokens: 1600,
    responseFormat: { type: 'json_schema', name: 'email_analysis', schema: analysisJsonSchema as unknown as Record<string, unknown> },
    operation: 'email_analysis',
  });

  if (completion.refusal) {
    throw new AppError('AI_INVALID_OUTPUT', {
      message: `Model refused to analyse the message: ${completion.refusal}`,
    });
  }

  const parsed = validateAnalysisResponse(extractJson(completion.content));
  return mapResponseToResult(parsed, {
    email,
    tz,
    modelName: completion.model || CHAT_MODEL_LABEL,
  });
}

function mapResponseToResult(
  response: AnalysisResponse,
  context: { email: Email; tz: string; modelName: string },
): EmailAnalysisResult {
  const { email, tz, modelName } = context;
  const referenceInstant = new Date(email.received_at);

  const deadline = response.deadline.date
    ? {
        date: response.deadline.date,
        time: response.deadline.time,
        timezone: response.deadline.timezone,
        type: response.deadline.type,
        source_sentence: response.deadline.source_sentence,
        confidence: clamp01(response.deadline.confidence),
      }
    : response.deadline.type === 'UNKNOWN'
      ? {
          date: null,
          time: null,
          timezone: null,
          type: 'UNKNOWN' as const,
          source_sentence: response.deadline.source_sentence,
          confidence: clamp01(response.deadline.confidence),
        }
      : null;

  const otherDates: DetectedDate[] = response.other_dates.map((entry) => ({
    date: entry.date,
    time: entry.time,
    timezone: null,
    type: 'EXPLICIT',
    source_sentence: entry.source_sentence,
    confidence: clamp01(entry.confidence),
    label: entry.label,
  }));

  // Cross-check with the deterministic extractor. When it independently finds a
  // matching date we keep the model's deadline as-is; when it disagrees we keep
  // the date but flag it for review (grounding may still drop it entirely).
  let verifiedDeadline = deadline;
  let crossCheckNote: string | null = null;
  if (deadline?.date) {
    const check = crossCheckDeadline(email, tz, referenceInstant, deadline.date);
    if (check === 'match') {
      verifiedDeadline = { ...deadline, confidence: Math.min(0.99, deadline.confidence + 0.03) };
    } else if (check === 'mismatch') {
      crossCheckNote =
        'The AI resolved a date that our deterministic date extractor resolved differently — please confirm the deadline.';
      verifiedDeadline = { ...deadline, confidence: Math.max(0.3, deadline.confidence - 0.15) };
    }
  }

  const priorityAssessment = assessPriorityWithEvidence(email, tz, verifiedDeadline, response);

  const suggestedTask: ProposedTask | null =
    response.action_required && response.suggested_task
      ? {
          title: response.suggested_task.title.trim().slice(0, 180),
          description: response.suggested_task.description,
          due_date: verifiedDeadline?.date ?? null,
          due_time: verifiedDeadline?.time ?? null,
          priority: priorityAssessment.priority,
          category: response.category,
        }
      : null;

  const overall = clamp01(
    response.confidence.category * 0.32 +
      response.confidence.action * 0.28 +
      response.confidence.deadline * 0.2 +
      response.confidence.priority * 0.2,
  );

  const result: EmailAnalysisResult = {
    category: response.category,
    secondary_categories: response.secondary_categories as EmailAnalysisResult['secondary_categories'],
    summary: response.summary,
    action_required: response.action_required,
    priority: priorityAssessment.priority,
    priority_reason: priorityAssessment.reason ?? response.priority_reason,
    priority_score: priorityAssessment.score ?? null,
    detected_dates: otherDates,
    detected_deadline: verifiedDeadline,
    detected_people: response.people,
    detected_organizations: response.organizations,
    detected_links: response.links,
    detected_attachments: email.attachments,
    suggested_action: response.action_required ? response.suggested_action : null,
    suggested_task: suggestedTask,
    confidence: {
      category: clamp01(response.confidence.category),
      action: clamp01(response.confidence.action),
      deadline: verifiedDeadline?.confidence ?? 0,
      priority: priorityAssessment.confidence,
      overall,
    },
    needs_review: Boolean(crossCheckNote),
    review_reason: crossCheckNote,
    model_name: modelName,
    analysis_source: 'AI_PROVIDER',
    analysis_version: analysisVersion(),
    grounding_report: { checked: false, unsupported: [], dropped_count: 0, notes: [] },
    injection_flagged: false,
    injection_signals: [],
    raw_output: response,
  };

  // Grounding verification (§2, §43) — strip anything not traceable to the message.
  const grounding = verifyGrounding({
    sourceText: `${email.subject ?? ''}\n${email.body_text ?? ''}`,
    deadline: result.detected_deadline,
    dates: result.detected_dates,
    people: result.detected_people,
    organizations: result.detected_organizations,
    links: result.detected_links,
    attachments: result.detected_attachments,
    suggestedAction: result.suggested_action,
    suggestedTask: result.suggested_task,
  });

  return applyGrounding(result, grounding);
}

/** Deterministic second opinion on a deadline the model proposed. */
function crossCheckDeadline(
  email: Email,
  tz: string,
  referenceInstant: Date,
  proposedDate: string,
): 'match' | 'mismatch' | 'unknown' {
  const extraction = extractDeadline(`${email.subject ?? ''}\n${email.body_text ?? ''}`, {
    referenceInstant,
    timezone: tz,
  });
  if (!extraction.deadline) return 'unknown';
  const candidates = extraction.dates
    .map((entry) => entry.date)
    .filter((value): value is string => Boolean(value));
  if (candidates.length === 0) return 'unknown';
  if (candidates.includes(proposedDate)) return 'match';
  // Accept a one-day tolerance for timezone edge cases.
  const proposed = Date.parse(`${proposedDate}T00:00:00Z`);
  const close = candidates.some(
    (candidate) => Math.abs(Date.parse(`${candidate}T00:00:00Z`) - proposed) <= 86_400_000,
  );
  return close ? 'match' : 'mismatch';
}

function assessPriorityWithEvidence(
  email: Email,
  tz: string,
  deadline: EmailAnalysisResult['detected_deadline'],
  response: AnalysisResponse,
): { priority: EmailAnalysisResult['priority']; reason: string | null; score: number | null; confidence: number } {
  const evidence = assessPriority({
    subject: email.subject,
    bodyText: email.body_text,
    senderEmail: email.sender_email,
    actionRequired: response.action_required,
    deadline,
    importantSenders: [],
    ignoredSenders: [],
    referenceInstant: new Date(email.received_at),
    timezone: tz,
  });

  // The model's priority is accepted only when the evidence engine agrees within
  // one band. Otherwise the evidence-based band wins, so stated urgency words
  // cannot inflate a message's priority on their own (§10).
  const order = ['NONE', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
  const evidenceRank = order.indexOf(evidence.priority);
  const modelRank = order.indexOf(response.priority);
  const agreement = Math.abs(evidenceRank - modelRank);

  if (agreement <= 1) {
    return {
      priority: response.priority,
      reason: response.priority_reason,
      score: evidence.score,
      confidence: Math.max(0.4, Math.min(0.95, 0.92 - agreement * 0.12)),
    };
  }

  logger.debug('agent.priority_overridden', {
    emailId: email.id,
    model: response.priority,
    evidence: evidence.priority,
  });

  return {
    priority: evidence.priority,
    reason: `${response.priority_reason} Adjusted to match the evidence in the message: ${evidence.reason}`,
    score: evidence.score,
    confidence: Math.max(0.4, evidence.confidence - 0.1),
  };
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Number(Math.max(0, Math.min(1, value)).toFixed(3));
}

// ── STEP 11 — notifications ──────────────────────────────────────────────────

interface NotificationInput {
  store: Store;
  userId: string;
  email: Email;
  analysis: EmailAnalysisResult;
  preferences: UserPreferences;
  taskId: string | null;
  step: (
    action: Parameters<Store['logAgentAction']>[0]['action_type'],
    title: string,
    detail: string | null,
    extra?: Partial<Parameters<Store['logAgentAction']>[0]>,
  ) => Promise<void>;
}

async function createPipelineNotifications(input: NotificationInput): Promise<number> {
  const { store, userId, email, analysis, preferences, taskId, step } = input;
  let created = 0;

  const link = `/inbox/${email.id}`;
  const subject = email.subject ?? '(no subject)';

  const emit = async (payload: Parameters<Store['createNotification']>[0], title: string) => {
    const notification = await store.createNotification(payload);
    if (notification) {
      created += 1;
      await step('NOTIFICATION_CREATED', 'Notification created', title, { notification_id: notification.id });
    }
  };

  // Important email
  if (
    preferences.notify_important_email &&
    (analysis.priority === 'CRITICAL' || analysis.priority === 'HIGH') &&
    analysis.category !== 'PROMOTIONAL' &&
    analysis.category !== 'SPAM'
  ) {
    await emit(
      {
        user_id: userId,
        type: 'IMPORTANT_EMAIL',
        title: analysis.priority === 'CRITICAL' ? 'High-priority action detected' : 'Important email',
        message: `${subject} — ${analysis.summary ?? analysis.suggested_action ?? ''}`.slice(0, 400),
        priority: analysis.priority,
        entity_type: 'email',
        related_entity_id: email.id,
        action_url: link,
        metadata: { category: analysis.category, sender: email.sender_email },
        dedupe_key: `important:${email.id}`,
      },
      'Important email notification',
    );
  }

  // Deadline detected
  if (preferences.notify_deadline && analysis.detected_deadline?.date) {
    await emit(
      {
        user_id: userId,
        type: 'DEADLINE_DETECTED',
        title: 'Deadline detected',
        message: `${subject} — due ${analysis.detected_deadline.date}${analysis.detected_deadline.time ? ` at ${analysis.detected_deadline.time}` : ''}.`,
        priority: analysis.priority,
        entity_type: 'email',
        related_entity_id: email.id,
        action_url: link,
        metadata: { deadline: analysis.detected_deadline },
        dedupe_key: `deadline:${email.id}`,
      },
      'Deadline notification',
    );
  }

  // Task suggestion
  if (preferences.notify_task_suggestion && taskId && analysis.suggested_task) {
    await emit(
      {
        user_id: userId,
        type: 'TASK_SUGGESTION',
        title: 'New task suggestion',
        message: `${analysis.suggested_task.title}${analysis.suggested_task.due_date ? ` — due ${analysis.suggested_task.due_date}` : ''}.`,
        priority: analysis.priority,
        entity_type: 'task',
        related_entity_id: taskId,
        action_url: '/tasks',
        metadata: { sourceEmailId: email.id },
        dedupe_key: `task-suggestion:${taskId}`,
      },
      'Task suggestion notification',
    );
  }

  // Meeting reminder
  if (preferences.notify_meeting && (analysis.category === 'MEETING' || analysis.category === 'EVENT') && analysis.detected_deadline?.date) {
    await emit(
      {
        user_id: userId,
        type: 'MEETING_REMINDER',
        title: 'Meeting or event scheduled',
        message: `${subject} — ${analysis.detected_deadline.date}${analysis.detected_deadline.time ? ` at ${analysis.detected_deadline.time}` : ''}.`,
        priority: analysis.priority,
        entity_type: 'email',
        related_entity_id: email.id,
        action_url: link,
        metadata: { deadline: analysis.detected_deadline },
        dedupe_key: `meeting:${email.id}`,
      },
      'Meeting notification',
    );
  }

  // Needs review
  if (analysis.needs_review) {
    await emit(
      {
        user_id: userId,
        type: 'AI_NEEDS_REVIEW',
        title: 'Analysis needs your review',
        message: `${subject} — ${analysis.review_reason ?? 'Please confirm the detected details.'}`.slice(0, 400),
        priority: analysis.priority,
        entity_type: 'email',
        related_entity_id: email.id,
        action_url: link,
        metadata: { reason: analysis.review_reason },
        dedupe_key: `review:${email.id}`,
      },
      'Review notification',
    );
  }

  return created;
}

async function finishRun(
  store: Store,
  userId: string,
  runId: string,
  startedAt: number,
  values: {
    status: Parameters<Store['updateRun']>[2]['status'];
    error_code?: string | null;
    error_message?: string | null;
    analysis_source?: Parameters<Store['updateRun']>[2]['analysis_source'];
    model_name?: string | null;
    confidence?: number | null;
    steps_completed?: string[];
    tool_calls?: number;
    current_step?: string;
  },
): Promise<void> {
  await store.updateRun(userId, runId, {
    status: values.status,
    error_code: values.error_code ?? null,
    error_message: values.error_message ?? null,
    analysis_source: values.analysis_source ?? null,
    model_name: values.model_name ?? null,
    confidence: values.confidence ?? null,
    steps_completed: values.steps_completed ?? [],
    tool_calls: values.tool_calls ?? 0,
    current_step: values.current_step ?? 'COMPLETE',
    finished_at: new Date().toISOString(),
    duration_ms: Date.now() - startedAt,
  });
}
