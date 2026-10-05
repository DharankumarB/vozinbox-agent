/**
 * Guardrails for untrusted email content (§43, §44) and output grounding (§2).
 *
 * Two independent controls:
 *
 * 1. `inspectUntrustedContent` — detects instruction-like content inside emails.
 *    Email text is **never** concatenated into system instructions; it is passed
 *    as delimited data in a user-role message. This module only *flags* attempts
 *    so the agent can degrade safely (and so we can tell the user).
 *
 * 2. `verifyGrounding` — after the model returns structured output, every
 *    concrete claim (dates, names, links, quoted deadline sentences) must be
 *    traceable to the source text. Unsupported claims are stripped before the
 *    record is written to the database. We would rather store `null` than a
 *    fabricated deadline.
 */

import type {
  DetectedAttachment,
  DetectedDate,
  DetectedDeadline,
  DetectedLink,
  DetectedOrganization,
  DetectedPerson,
  EmailAnalysisResult,
  GroundingReport,
  ProposedTask,
} from '@/lib/types/domain';

// ── Injection detection ──────────────────────────────────────────────────────

export interface InjectionInspection {
  flagged: boolean;
  signals: string[];
  /** Higher score = more confident this is an injection attempt. */
  score: number;
}

interface InjectionPattern {
  code: string;
  re: RegExp;
  weight: number;
}

const INJECTION_PATTERNS: InjectionPattern[] = [
  { code: 'IGNORE_INSTRUCTIONS', re: /\b(?:ignore|disregard|forget)\s+(?:all\s+)?(?:previous|prior|above|earlier|your)\s+(?:instructions?|prompts?|rules?|directions?)\b/i, weight: 3 },
  { code: 'REVEAL_SYSTEM_PROMPT', re: /\b(?:reveal|show|print|output|repeat|disclose)\s+(?:your\s+)?(?:system\s+)?(?:prompt|instructions?|initial\s+message|configuration)\b/i, weight: 3 },
  { code: 'ROLE_OVERRIDE', re: /\byou\s+are\s+(?:now|no longer)\b|\bact\s+as\s+(?:an?\s+)?(?:admin|developer|system|unrestricted)\b|\bnew\s+(?:system\s+)?(?:instructions?|rules?)\s*:/i, weight: 2.5 },
  { code: 'SECRET_EXFILTRATION', re: /\b(?:send|email|forward|post|upload|exfiltrate|share)\b[^.]{0,80}\b(?:all\s+)?(?:user\s+)?(?:data|emails?|credentials?|tokens?|api\s+keys?|passwords?|database|contacts?)\b/i, weight: 3 },
  { code: 'TOKEN_REQUEST', re: /\b(?:oauth|access|refresh|api)[\s_-]*(?:token|key|secret)s?\b/i, weight: 2 },
  { code: 'TOOL_INVOCATION', re: /\b(?:call|invoke|execute|run)\s+(?:the\s+)?(?:tool|function|command|script|code)\b/i, weight: 1.8 },
  { code: 'PRIVILEGE_ESCALATION', re: /\b(?:grant|give)\s+(?:me\s+)?(?:admin|root|owner|full)\s+(?:access|permissions?|rights?)\b/i, weight: 2.5 },
  { code: 'DELIMITER_ESCAPE', re: /<\/?(?:system|assistant|tool|instructions?)[\s>]|\[\/?(?:INST|SYSTEM)\]|<\|(?:im_start|im_end|system|endoftext)\|>/i, weight: 2.2 },
  { code: 'DATA_DUMP_REQUEST', re: /\b(?:list|dump|return)\s+(?:all|every)\s+(?:emails?|messages?|users?|records?)\b/i, weight: 1.8 },
  { code: 'IMPERSONATION', re: /\b(?:as\s+the\s+user|on\s+behalf\s+of\s+the\s+user|impersonate)\b[^.]{0,60}\b(?:send|reply|delete)\b/i, weight: 2.4 },
];

/**
 * Scan raw message content. This never blocks analysis — the analysis proceeds
 * with the content treated purely as data, and the flag is surfaced to the user.
 */
export function inspectUntrustedContent(content: string): InjectionInspection {
  const signals: string[] = [];
  let score = 0;

  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.re.test(content)) {
      signals.push(pattern.code);
      score += pattern.weight;
    }
  }

  // Heuristic: multiple imperative lines addressed to an AI.
  const aiAddress = /\b(?:dear\s+)?(?:ai|assistant|chatgpt|gpt|claude|agent|bot)\b[^\n]{0,60}\b(?:please|you\s+must|you\s+should|do\s+the\s+following)\b/i;
  if (aiAddress.test(content)) {
    signals.push('ADDRESSES_AI_DIRECTLY');
    score += 1.5;
  }

  return {
    flagged: score >= 2.0,
    signals,
    score: Number(score.toFixed(2)),
  };
}

/**
 * Remove any instruction-like spans before the text reaches a model prompt.
 * The remaining text is still untrusted; this is defence in depth, not a
 * substitute for treating all email content as data.
 */
export function sanitiseForPrompt(content: string, maxLength = 12_000): string {
  if (!content) return '';
  let output = content;

  for (const pattern of INJECTION_PATTERNS) {
    output = output.replace(new RegExp(pattern.re.source, `${pattern.re.flags.replace('g', '')}g`), '[redacted-instruction-like-content]');
  }

  output = output
    // Strip control characters that could confuse delimiters.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    // Neutralise fence/role markers so the model cannot be tricked into
    // believing the data section has ended.
    .replace(/(?:^|\n)\s*(```|<\|[^|]*\|>|#{0,3}\s*(?:SYSTEM|ASSISTANT|TOOL)\s*:)/gi, '\n[marker-removed] ');

  return output.slice(0, maxLength);
}

/** Wraps untrusted content for inclusion in a *user* message with explicit delimiters. */
export function wrapUntrusted(label: string, content: string): string {
  const sanitised = sanitiseForPrompt(content);
  return `<<<BEGIN_UNTRUSTED_${label.toUpperCase()}>>>\n${sanitised}\n<<<END_UNTRUSTED_${label.toUpperCase()}>>>`;
}

// ── Grounding verification ───────────────────────────────────────────────────

export interface GroundingInput {
  /** The text the model was allowed to read: subject + body. */
  sourceText: string;
  deadline: DetectedDeadline | null;
  dates: DetectedDate[];
  people: DetectedPerson[];
  organizations: DetectedOrganization[];
  links: DetectedLink[];
  attachments: DetectedAttachment[];
  suggestedAction: string | null;
  suggestedTask: ProposedTask | null;
}

export interface GroundingResult {
  deadline: DetectedDeadline | null;
  dates: DetectedDate[];
  people: DetectedPerson[];
  organizations: DetectedOrganization[];
  links: DetectedLink[];
  suggestedAction: string | null;
  suggestedTask: ProposedTask | null;
  report: GroundingReport;
}

function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s@.:/-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(value: string): string[] {
  return normalise(value).split(' ').filter((token) => token.length > 2);
}

/** Does the source contain this value (fuzzy for names, exact for dates)? */
function sourceContains(source: string, value: string, options: { fuzzy?: boolean } = {}): boolean {
  const haystack = normalise(source);
  const needle = normalise(value);
  if (!needle) return false;
  if (haystack.includes(needle)) return true;
  if (!options.fuzzy) return false;

  const needleTokens = tokens(value);
  if (needleTokens.length === 0) return false;
  const matched = needleTokens.filter((token) => haystack.includes(token)).length;
  return matched / needleTokens.length >= 0.75;
}

/**
 * Verify every concrete claim in the analysis against the source text.
 * Unsupported values are dropped and reported — never silently stored.
 */
export function verifyGrounding(input: GroundingInput): GroundingResult {
  const source = input.sourceText ?? '';
  const unsupported: string[] = [];
  const notes: string[] = [];
  let dropped = 0;

  // Deadline — date must be explainable. We accept any date when the extracted
  // source sentence itself contains a date expression, because relative
  // resolution ("Friday" → 2026-10-09) is legitimate transformation.
  let deadline = input.deadline;
  if (deadline) {
    const sentence = deadline.source_sentence ?? '';
    const sentenceHasDate = /\d|today|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|week|month|end of day|eod/i.test(sentence);
    const sentenceFromSource = sentence.length === 0 || sourceContains(source, sentence, { fuzzy: true });

    if (!sentenceFromSource) {
      unsupported.push('deadline.source_sentence not found in message');
      dropped += 1;
      deadline = null;
      notes.push('Dropped deadline: the quoted evidence sentence does not appear in the message.');
    } else if (deadline.date && !sentenceHasDate) {
      unsupported.push(`deadline.date ${deadline.date} has no supporting date expression`);
      dropped += 1;
      deadline = { ...deadline, date: null, time: null, type: 'UNKNOWN', confidence: Math.min(deadline.confidence, 0.3) };
      notes.push('Cleared deadline date: no date expression was found in the supporting sentence.');
    } else if (deadline.date) {
      // Independent cross-check: the deterministic extractor must also find a date
      // expression in the source. This is the strongest anti-fabrication control.
      const hasAnyDateExpression = /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b|\b(?:today|tomorrow|tonight|next|this|coming|by|before|due|deadline)\b|\b(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*day?\b/i.test(source);
      if (!hasAnyDateExpression) {
        unsupported.push(`deadline.date ${deadline.date} unsupported: message contains no date expression`);
        dropped += 1;
        deadline = { ...deadline, date: null, time: null, type: 'UNKNOWN', confidence: 0.2 };
        notes.push('Cleared deadline date: the message contains no date expression at all.');
      }
    }
  }

  const dates = input.dates.filter((entry) => {
    if (!entry.date) return true;
    const sentence = entry.source_sentence ?? '';
    const ok = sentence.length === 0 || sourceContains(source, sentence, { fuzzy: true });
    if (!ok) {
      unsupported.push(`date ${entry.date} quotes text not present in the message`);
      dropped += 1;
    }
    return ok;
  });

  const people = input.people.filter((person) => {
    const ok = sourceContains(source, person.name, { fuzzy: true });
    if (!ok) {
      unsupported.push(`person "${person.name}" not found in message`);
      dropped += 1;
    }
    return ok;
  });

  const organizations = input.organizations.filter((org) => {
    // Organizations derived from the sender domain cannot be expected in the body.
    const ok = sourceContains(source, org.name, { fuzzy: true }) || /\./.test(org.name);
    if (!ok) {
      unsupported.push(`organization "${org.name}" not found in message`);
      dropped += 1;
    }
    return ok;
  });

  const links = input.links.filter((link) => {
    const ok = source.includes(link.url) || source.includes(link.url.replace(/^https?:\/\//, ''));
    if (!ok) {
      unsupported.push(`link "${link.url}" not found in message`);
      dropped += 1;
    }
    return ok;
  });

  // The suggested action is a transformation, not a quotation, but its key verb
  // must appear somewhere in the message.
  let suggestedAction = input.suggestedAction;
  let suggestedTask = input.suggestedTask;
  if (suggestedAction) {
    const words = tokens(suggestedAction);
    const verb = words[0];
    const supported = verb ? normalise(source).includes(verb) : false;
    if (!supported && words.length > 0) {
      unsupported.push(`suggested action "${suggestedAction}" not supported by message text`);
      dropped += 1;
      suggestedAction = null;
      suggestedTask = null;
      notes.push('Removed suggested action: no supporting language in the message.');
    } else if (suggestedTask?.due_date && deadline?.date && suggestedTask.due_date !== deadline.date) {
      unsupported.push('suggested task due date differed from the verified deadline');
      dropped += 1;
      suggestedTask = { ...suggestedTask, due_date: deadline.date, due_time: deadline.time };
    }
  }

  return {
    deadline,
    dates,
    people,
    organizations,
    links,
    suggestedAction,
    suggestedTask,
    report: {
      checked: true,
      unsupported: unsupported.slice(0, 25),
      dropped_count: dropped,
      notes,
    },
  };
}

/** Apply a grounding result back onto a full analysis object. */
export function applyGrounding(
  analysis: EmailAnalysisResult,
  grounding: GroundingResult,
): EmailAnalysisResult {
  const deadlineChanged = JSON.stringify(analysis.detected_deadline) !== JSON.stringify(grounding.deadline);
  const dropped = grounding.report.dropped_count;

  return {
    ...analysis,
    detected_deadline: grounding.deadline,
    detected_dates: grounding.dates,
    detected_people: grounding.people,
    detected_organizations: grounding.organizations,
    detected_links: grounding.links,
    suggested_action: grounding.suggestedAction,
    suggested_task: grounding.suggestedTask,
    // Confidence reflects what survived verification.
    confidence: {
      ...analysis.confidence,
      deadline: grounding.deadline?.confidence ?? 0,
      overall: Number(
        Math.max(
          0,
          analysis.confidence.overall - Math.min(dropped * 0.05, 0.25) - (deadlineChanged ? 0.03 : 0),
        ).toFixed(3),
      ),
    },
    needs_review: analysis.needs_review || dropped > 0 || deadlineChanged,
    review_reason: [
      analysis.review_reason,
      dropped > 0 ? 'Some extracted details could not be verified against the message and were removed.' : null,
    ]
      .filter(Boolean)
      .join(' ') || null,
    grounding_report: grounding.report,
  };
}
