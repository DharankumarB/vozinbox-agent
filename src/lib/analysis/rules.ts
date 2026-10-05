/**
 * Deterministic rules engine — the analysis path that always works.
 *
 * It is used in two situations:
 *  1. No AI provider is configured (the product must still deliver value).
 *  2. The AI provider fails or returns invalid output (§32, §33).
 *
 * Everything produced here is traceable to the source text. Nothing is invented:
 * when the rules cannot determine something, the field stays null and the
 * confidence is reported as low.
 */

import type {
  DetectedAttachment,
  DetectedLink,
  DetectedOrganization,
  DetectedPerson,
  EmailAnalysisResult,
  EmailCategory,
  ProposedTask,
} from '@/lib/types/domain';
import { extractDeadline, sentenceAround, type DateExtractionContext } from './dates';
import { assessPriority } from './priority';

export interface RulesAnalysisInput {
  subject: string | null;
  bodyText: string | null;
  senderName: string | null;
  senderEmail: string | null;
  attachments: DetectedAttachment[];
  referenceInstant: Date;
  timezone: string;
  importantSenders: string[];
  ignoredSenders: string[];
  summaryLength: 'SHORT' | 'NORMAL' | 'DETAILED';
  analysisVersion: string;
  deadlineDetectionEnabled: boolean;
  priorityDetectionEnabled: boolean;
}

// ── Category classification (§9) ─────────────────────────────────────────────

interface CategoryRule {
  category: EmailCategory;
  patterns: Array<{ re: RegExp; weight: number }>;
  /** Secondary label to attach when this category wins. */
  secondary?: EmailCategory[];
}

const CATEGORY_RULES: CategoryRule[] = [
  {
    category: 'SPAM',
    patterns: [
      { re: /\b(?:viagra|casino|crypto\s+giveaway|bitcoin\s+profit|fake\s+invoice|you have won|claim your prize|lottery)\b/i, weight: 3 },
      { re: /\b(?:wire transfer|western union|gift card|urgent confidential business)\b/i, weight: 2.2 },
      { re: /\bworking from home.{0,40}\$\d+/i, weight: 1.8 },
    ],
  },
  {
    category: 'PROMOTIONAL',
    patterns: [
      { re: /\bunsubscribe\b/i, weight: 1.6 },
      { re: /\b(?:limited time|exclusive offer|flash sale|mega sale|discount|coupon|use code|buy now|shop now|off\s*\d{1,2}%)\b/i, weight: 1.7 },
      { re: /\b(?:newsletter|weekly digest|product update|what'?s new)\b/i, weight: 1.0 },
      { re: /\bdeal of the day\b/i, weight: 1.2 },
    ],
  },
  {
    category: 'ASSIGNMENT',
    patterns: [
      { re: /\bassignment\b/i, weight: 3 },
      { re: /\bsubmit(?:ting)?\s+(?:your\s+|the\s+)?(?:report|work|project|file|document|code)\b/i, weight: 2.2 },
      { re: /\b(?:homework|coursework|lab report|problem set)\b/i, weight: 2.4 },
      { re: /\b(?:submission (?:link|portal|deadline)|upload your)\b/i, weight: 2 },
      { re: /\bgraded?\b.{0,30}\b(?:submit|deadline)\b/i, weight: 1.2 },
    ],
    secondary: ['COLLEGE'],
  },
  {
    category: 'DEADLINE',
    patterns: [
      { re: /\bdeadline\b/i, weight: 2.4 },
      { re: /\bno later than\b/i, weight: 1.6 },
      { re: /\blast date\b/i, weight: 1.6 },
      { re: /\b(?:submission|application|registration|enrol?ment)\s+(?:closes|ends|deadline)\b/i, weight: 1.8 },
    ],
  },
  {
    category: 'MEETING',
    patterns: [
      { re: /\b(?:meeting|meet(?:ing)? invite|calendar invite)\b/i, weight: 2.4 },
      { re: /\b(?:zoom|google meet|teams|webex|conference call)\b/i, weight: 1.8 },
      { re: /\b(?:agenda|minutes of meeting|mom)\b/i, weight: 1.2 },
      { re: /\b(?:standup|sync-?up|one-?on-?one|1:1)\b/i, weight: 1.4 },
      { re: /\b(?:interview|viva|panel discussion)\b/i, weight: 1.4 },
    ],
    secondary: ['WORK'],
  },
  {
    category: 'EVENT',
    patterns: [
      { re: /\b(?:webinar|workshop|seminar|conference|symposium|hackathon|fest)\b/i, weight: 2.2 },
      { re: /\b(?:invitation to|you are invited|rsvp)\b/i, weight: 1.8 },
      { re: /\b(?:cultural fest|tech talk|guest lecture)\b/i, weight: 1.8 },
    ],
  },
  {
    category: 'FINANCE',
    patterns: [
      { re: /\b(?:invoice|receipt|payment|paid|refund|transaction|statement)\b/i, weight: 2.2 },
      { re: /\b(?:emi|installment|instalment|balance due|amount due|outstanding)\b/i, weight: 2.4 },
      { re: /\b(?:bank|credit card|upi|net banking)\b/i, weight: 1.2 },
      { re: /\b(?:salary|payslip|tax|gst|itr)\b/i, weight: 1.6 },
    ],
  },
  {
    category: 'PROJECT',
    patterns: [
      { re: /\bproject\b/i, weight: 1.8 },
      { re: /\b(?:milestone|sprint|deliverable|roadmap|backlog|pull request|repository)\b/i, weight: 1.6 },
      { re: /\b(?:client requirement|scope|sprint review)\b/i, weight: 1.4 },
    ],
    secondary: ['WORK'],
  },
  {
    category: 'COLLEGE',
    patterns: [
      { re: /\b(?:university|college|department|semester|faculty|professor|prof\.?|dean|hod|exam cell)\b/i, weight: 2 },
      { re: /\b(?:enrol?ment|registration|attendance|timetable|syllabus|credits)\b/i, weight: 1.6 },
      { re: /\b(?:students?|class|lecture|course)\b/i, weight: 1.0 },
    ],
  },
  {
    category: 'WORK',
    patterns: [
      { re: /\b(?:client|stakeholder|manager|team lead|appraisal|onboarding|payroll)\b/i, weight: 1.8 },
      { re: /\b(?:jira|ticket|timesheet|kpi|quarterly review)\b/i, weight: 1.6 },
      { re: /\b(?:company policy|hr|human resources)\b/i, weight: 1.2 },
    ],
  },
  {
    category: 'PERSONAL',
    patterns: [
      { re: /\b(?:birthday|anniversary|family|friend|wedding|holiday|vacation|trip)\b/i, weight: 2 },
      { re: /\b(?:hope you are doing well|how are you|catch up|long time)\b/i, weight: 1.4 },
      { re: /\b(?:dinner|lunch|coffee|weekend plans)\b/i, weight: 1.2 },
    ],
  },
  {
    category: 'INFORMATION',
    patterns: [
      { re: /\b(?:for your information|fyi|no action required|no reply needed)\b/i, weight: 2.6 },
      { re: /\b(?:notification|announcement|circular|inform you|please note)\b/i, weight: 1.2 },
      { re: /\b(?:status update|progress update|summary of)\b/i, weight: 1.0 },
      { re: /\b(?:automated (?:message|notification)|do not reply)\b/i, weight: 1.2 },
    ],
  },
];

export interface CategoryVerdict {
  category: EmailCategory;
  secondary: EmailCategory[];
  confidence: number;
  evidence: string[];
}

export function classifyCategory(input: {
  subject: string | null;
  bodyText: string | null;
  senderEmail?: string | null;
}): CategoryVerdict {
  const subject = input.subject ?? '';
  const body = (input.bodyText ?? '').slice(0, 8000);
  const haystack = `${subject}\n${body}`;

  if (haystack.trim().length === 0) {
    return { category: 'OTHER', secondary: [], confidence: 0.2, evidence: [] };
  }

  const scores: Array<{ category: EmailCategory; score: number; evidence: string[] }> = [];

  for (const rule of CATEGORY_RULES) {
    let score = 0;
    const evidence: string[] = [];
    for (const { re, weight } of rule.patterns) {
      const subjectHit = re.test(subject);
      const bodyHit = re.test(body);
      if (subjectHit) {
        score += weight * 1.4;
        evidence.push(`subject matched ${re.source}`);
      } else if (bodyHit) {
        score += weight;
        evidence.push(`body matched ${re.source}`);
      }
    }
    if (rule.category === 'PROMOTIONAL' && input.senderEmail && /(?:newsletter|marketing|promo|noreply|no-reply)/i.test(input.senderEmail)) {
      score += 0.8;
    }
    if (score > 0) scores.push({ category: rule.category, score, evidence });
  }

  // Action-required is a cross-cutting signal that wins when strong.
  const actionVerdict = detectActionRequired(subject, body);
  if (actionVerdict.required && actionVerdict.confidence >= 0.6) {
    const existing = scores.find((s) => s.category === 'ACTION_REQUIRED');
    if (existing) {
      existing.score += 1.4;
      existing.evidence.push('imperative action phrasing detected');
    } else {
      scores.push({
        category: 'ACTION_REQUIRED',
        score: 1.9 + actionVerdict.confidence,
        evidence: ['imperative action phrasing detected'],
      });
    }
  }

  scores.sort((a, b) => b.score - a.score);
  const best = scores[0];

  if (!best || best.score < 1.0) {
    return { category: 'OTHER', secondary: [], confidence: 0.35, evidence: scores.flatMap((s) => s.evidence).slice(0, 3) };
  }

  const runnerUp = scores[1];
  const margin = runnerUp ? best.score - runnerUp.score : best.score;
  // Confidence grows with absolute evidence and with separation from the runner-up.
  const confidence = Math.max(
    0.4,
    Math.min(0.96, 0.5 + Math.min(best.score, 6) * 0.05 + Math.min(margin, 3) * 0.06),
  );

  const rule = CATEGORY_RULES.find((r) => r.category === best.category);
  const secondary = (rule?.secondary ?? []).filter((category) => category !== best.category);

  return {
    category: best.category,
    secondary,
    confidence: Number(confidence.toFixed(3)),
    evidence: best.evidence.slice(0, 4),
  };
}

// ── Action extraction (§11) ──────────────────────────────────────────────────

export interface ActionVerdict {
  required: boolean;
  action: string | null;
  actionType: string;
  sourceSentence: string | null;
  confidence: number;
  /** True when the sentence is a request but not an instruction to act. */
  isRequest: boolean;
}

const NEGATIVE_ACTION_PATTERNS = [
  /\bno action (?:is )?(?:required|needed|necessary)\b/i,
  /\bno (?:reply|response) (?:is )?(?:required|needed|necessary)\b/i,
  /\bfor your (?:information|reference|records)(?: only)?\b/i,
  /\bnothing (?:for you )?to do\b/i,
  /\bjust (?:to )?(?:let you know|inform you)\b/i,
  /\bno need to (?:respond|reply|act)\b/i,
  /\bdo not (?:respond|reply)\b/i,
];

/** Imperative instructions: verb-first sentences addressed to the reader. */
const IMPERATIVE_PATTERNS: Array<{ re: RegExp; actionType: string; weight: number }> = [
  { re: /\bplease\s+(?:kindly\s+)?submit\b/i, actionType: 'SUBMIT', weight: 1.0 },
  { re: /\bsubmit\s+(?:your|the|it|this)\b/i, actionType: 'SUBMIT', weight: 0.95 },
  { re: /\b(?:kindly|please)\s+(?:do\s+)?(?:send|share|forward|upload|attach)\b/i, actionType: 'SEND', weight: 0.9 },
  { re: /\bplease\s+(?:review|go through|check|verify)\b/i, actionType: 'REVIEW', weight: 0.9 },
  { re: /\b(?:review|go through)\s+the\s+(?:attached|document|report|details)\b/i, actionType: 'REVIEW', weight: 0.85 },
  { re: /\bplease\s+(?:confirm|acknowledge)\b/i, actionType: 'CONFIRM', weight: 0.95 },
  { re: /\b(?:rsvp|confirm your (?:attendance|availability|presence))\b/i, actionType: 'CONFIRM', weight: 0.95 },
  { re: /\bplease\s+(?:reply|respond)\b/i, actionType: 'REPLY', weight: 0.9 },
  { re: /\breply\s+(?:to this|by|before)\b/i, actionType: 'REPLY', weight: 0.85 },
  { re: /\b(?:join|attend)\s+(?:the\s+)?(?:meeting|call|session|webinar|class)\b/i, actionType: 'ATTEND', weight: 0.9 },
  { re: /\b(?:you are|you're)\s+(?:requested|required|expected)\s+to\b/i, actionType: 'GENERAL', weight: 1.0 },
  { re: /\b(?:students|applicants|candidates|team|employees|members)\s+are?\s+(?:requested|required|expected|asked)\s+to\b/i, actionType: 'GENERAL', weight: 1.1 },
  { re: /\b(?:kindly|please)\s+(?:complete|fill|fill in|update|renew|register|enrol?l)\b/i, actionType: 'COMPLETE', weight: 0.9 },
  { re: /\bmust\s+(?:be\s+)?(?:submit|complete|finish|reply|respond|sign|return)/i, actionType: 'GENERAL', weight: 0.85 },
  { re: /\b(?:need|require)\s+(?:your|you to)\b/i, actionType: 'GENERAL', weight: 0.7 },
  { re: /\b(?:action required|requires? your attention|your action is required)\b/i, actionType: 'GENERAL', weight: 1.1 },
  { re: /\b(?:sign|fill)\s+(?:the\s+)?(?:form|document|agreement|contract)\b/i, actionType: 'SIGN', weight: 0.9 },
  { re: /\b(?:pay|clear|settle)\s+(?:the\s+)?(?:amount|invoice|bill|dues|fees)\b/i, actionType: 'PAY', weight: 0.95 },
  { re: /\b(?:let me know|get back to me)\b/i, actionType: 'REPLY', weight: 0.6 },
];

export function detectActionRequired(subject: string, body: string): ActionVerdict {
  const haystack = `${subject}\n${body}`;
  const lowered = haystack.toLowerCase();

  // Explicit "no action" statements win — they are unambiguous (§63).
  for (const pattern of NEGATIVE_ACTION_PATTERNS) {
    const match = pattern.exec(haystack);
    if (match) {
      return {
        required: false,
        action: null,
        actionType: 'NONE',
        sourceSentence: sentenceAround(haystack, match.index ?? 0, match[0].length),
        confidence: 0.92,
        isRequest: false,
      };
    }
  }

  let best: { index: number; length: number; actionType: string; weight: number; text: string } | null = null;

  for (const { re, actionType, weight } of IMPERATIVE_PATTERNS) {
    const globalRe = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
    for (const match of haystack.matchAll(globalRe)) {
      const index = match.index ?? 0;
      // Subject-line hits are weaker evidence than body instructions.
      const inSubject = index < (subject.length + 1);
      const adjusted = weight * (inSubject ? 0.85 : 1);
      if (!best || adjusted > best.weight) {
        best = {
          index,
          length: match[0].length,
          actionType,
          weight: adjusted,
          text: match[0],
        };
      }
    }
  }

  if (!best) {
    // A direct question is a request for a response, but not an instruction.
    const question = /\b(?:can|could|would|will)\s+you\b[^?]{0,120}\?/i.exec(haystack);
    if (question) {
      return {
        required: true,
        action: normaliseAction(`Reply to ${''}`, question[0]),
        actionType: 'REPLY',
        sourceSentence: sentenceAround(haystack, question.index ?? 0, question[0].length),
        confidence: 0.62,
        isRequest: true,
      };
    }
    if (/\?\s*$/m.test(lowered) && body.trim().length > 0) {
      return {
        required: false,
        action: null,
        actionType: 'NONE',
        sourceSentence: null,
        confidence: 0.4,
        isRequest: true,
      };
    }
    return { required: false, action: null, actionType: 'NONE', sourceSentence: null, confidence: 0.55, isRequest: false };
  }

  const sentence = sentenceAround(haystack, best.index, best.length);
  const action = deriveActionPhrase(best.actionType, sentence ?? best.text, subject);

  return {
    required: true,
    action,
    actionType: best.actionType,
    sourceSentence: sentence,
    confidence: Number(Math.min(0.95, 0.6 + best.weight * 0.3).toFixed(3)),
    isRequest: false,
  };
}

function deriveActionPhrase(actionType: string, sentence: string, subject: string | null): string {
  const cleaned = cleanupSentence(sentence);
  switch (actionType) {
    case 'SUBMIT': {
      const target = extractObject(cleaned, /\b(?:submit|upload|send)\b\s+(?:your\s+|the\s+)?(.{2,80}?)(?:\s+(?:by|before|on|to|at)\b|[.,;]|$)/i);
      return target ? `Submit ${target}` : `Submit ${shorten(subject) ?? 'the requested material'}`;
    }
    case 'REVIEW': {
      const target = extractObject(cleaned, /\b(?:review|go through|check|verify)\b\s+(?:the\s+)?(.{2,80}?)(?:\s+(?:and|by|before|to)\b|[.,;]|$)/i);
      return target ? `Review ${target}` : 'Review the attached material';
    }
    case 'CONFIRM': {
      const target = extractObject(cleaned, /\b(?:confirm|acknowledge)\b\s+(?:your\s+)?(.{2,60}?)(?:\s+(?:by|before|to)\b|[.,;]|$)/i);
      return target ? `Confirm ${target}` : 'Confirm your attendance';
    }
    case 'REPLY':
      return 'Reply to sender';
    case 'ATTEND': {
      const target = extractObject(cleaned, /\b(?:join|attend)\b\s+(?:the\s+)?(.{2,60}?)(?:\s+(?:at|on|by)\b|[.,;]|$)/i);
      return target ? `Attend ${target}` : 'Attend the scheduled meeting';
    }
    case 'PAY': {
      const target = extractObject(cleaned, /\b(?:pay|clear|settle)\b\s+(?:the\s+)?(.{2,60}?)(?:\s+(?:by|before|on)\b|[.,;]|$)/i);
      return target ? `Pay ${target}` : 'Complete the payment';
    }
    case 'SIGN': {
      const target = extractObject(cleaned, /\b(?:sign|fill)\b\s+(?:the\s+)?(.{2,60}?)(?:\s+(?:by|before|and)\b|[.,;]|$)/i);
      return target ? `Sign ${target}` : 'Sign the requested document';
    }
    case 'COMPLETE': {
      const target = extractObject(cleaned, /\b(?:complete|fill(?: in)?|update|renew|register|enrol?l)\b\s+(?:your\s+|the\s+)?(.{2,80}?)(?:\s+(?:by|before|on|at)\b|[.,;]|$)/i);
      return target ? `Complete ${target}` : 'Complete the requested step';
    }
    case 'SEND': {
      const target = extractObject(cleaned, /\b(?:send|share|forward|upload|attach)\b\s+(?:your\s+|the\s+)?(.{2,80}?)(?:\s+(?:by|before|to)\b|[.,;]|$)/i);
      return target ? `Send ${target}` : 'Send the requested information';
    }
    default:
      return deriveFromSentence(cleaned, subject);
  }
}

function deriveFromSentence(sentence: string, subject: string | null): string {
  // "Students are requested to submit the X" → "Submit the X"
  const requested = /\b(?:requested|required|expected|asked|instructed)\s+to\s+(.{4,120})/i.exec(sentence);
  if (requested?.[1]) {
    const phrase = trimTrailingClause(requested[1]);
    return capitalise(trimToWords(phrase, 12));
  }
  const pleaseClause = /\bplease\s+(.{4,120})/i.exec(sentence);
  if (pleaseClause?.[1]) {
    return capitalise(trimToWords(trimTrailingClause(pleaseClause[1]), 12));
  }
  const shortened = shorten(subject);
  return shortened ? `Handle: ${shortened}` : 'Review this email and act';
}

function extractObject(sentence: string, pattern: RegExp): string | null {
  const match = pattern.exec(sentence);
  const raw = match?.[1]?.trim();
  if (!raw || raw.length < 2) return null;
  // Reject fragments that are pure filler.
  if (/^(?:it|this|that|same|asap|soon|promptly)$/i.test(raw)) return null;
  return trimToWords(trimTrailingClause(raw), 10);
}

/** Naive canonical action string used for duplicate detection. */
export function normaliseAction(prefix: string, sentence: string): string {
  return `${prefix.trim()} ${trimToWords(cleanupSentence(sentence), 10)}`.trim();
}

function cleanupSentence(sentence: string): string {
  return sentence
    .replace(/\s+/g, ' ')
    .replace(/^(?:hi|hello|dear)[^,]{0,60},\s*/i, '')
    .replace(/^(?:and|also|then)\s+/i, '')
    .trim();
}

function trimTrailingClause(value: string): string {
  return value
    .replace(/\s+(?:by|before|on|at|no later than|latest by|within)\s+.*$/i, '')
    .replace(/[.,;:!?]+$/, '')
    .trim();
}

function trimToWords(value: string, maxWords: number): string {
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return value.trim();
  return `${words.slice(0, maxWords).join(' ')}…`;
}

function shorten(subject: string | null): string | null {
  if (!subject) return null;
  const cleaned = subject
    .replace(/^(?:re|fwd?|fw)\s*:\s*/gi, '')
    .replace(/[\[(].{0,30}[\])]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > 0 ? trimToWords(cleaned, 10) : null;
}

function capitalise(value: string): string {
  return value.length === 0 ? value : `${value[0]?.toUpperCase() ?? ''}${value.slice(1)}`;
}

// ── Entity extraction ────────────────────────────────────────────────────────

export function extractPeople(
  text: string,
  senderName: string | null,
  senderEmail: string | null,
): DetectedPerson[] {
  const people = new Map<string, DetectedPerson>();

  if (senderName) {
    people.set(senderName.toLowerCase(), { name: senderName, email: senderEmail, role: 'Sender' });
  }

  // "Prof. Sharma", "Dr. Rao", "Mr. Kumar", "Ms. Iyer" — titles appear
  // capitalised in real mail, so match them case-insensitively while still
  // requiring a capitalised name.
  const titled =
    /\b(?:[Pp]rof(?:essor)?|[Dd]r|[Mm]r|[Mm]rs|[Mm]s|[Mm]iss|[Ss]ir|[Mm]adam)\.?\s+([A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+)?)/g;
  for (const match of text.matchAll(titled)) {
    const name = match[1]?.trim();
    if (name && name.length > 1) {
      const key = name.toLowerCase();
      if (!people.has(key)) people.set(key, { name, email: null, role: 'Mentioned' });
    }
  }

  return Array.from(people.values()).slice(0, 10);
}

const ORG_SUFFIXES = /\b(?:university|college|institute|school|department|labs?|inc|llc|ltd|pvt|corp(?:oration)?|technologies|solutions|systems|foundation|academy)\b/i;

export function extractOrganizations(text: string, senderEmail: string | null): DetectedOrganization[] {
  const found = new Map<string, DetectedOrganization>();

  if (senderEmail) {
    const domain = senderEmail.split('@')[1];
    if (domain && !/gmail|yahoo|outlook|hotmail|icloud|proton|live|aol/i.test(domain)) {
      const label = domain.split('.')[0];
      if (label) {
        found.set(label.toLowerCase(), { name: label, confidence: 0.7 });
      }
    }
  }

  const properNounPhrase = /\b([A-Z][a-zA-Z&.'-]+(?:\s+[A-Z][a-zA-Z&.'-]+){0,3}\s+(?:University|College|Institute|School|Department|Labs?|Technologies|Solutions|Systems|Foundation|Academy|Corporation|Company))\b/g;
  for (const match of text.matchAll(properNounPhrase)) {
    const name = match[1]?.trim();
    if (name && name.length > 3) {
      found.set(name.toLowerCase(), { name, confidence: 0.85 });
    }
  }

  return Array.from(found.values()).slice(0, 8);
}

export function extractLinks(html: string | null, text: string | null): DetectedLink[] {
  const links = new Map<string, DetectedLink>();
  const urlRe = /https?:\/\/[^\s<>"')\]]+/gi;

  for (const source of [text ?? '', html ?? '']) {
    for (const match of source.matchAll(urlRe)) {
      const url = match[0].replace(/[.,;:]+$/, '');
      if (url.length > 2048) continue;
      if (!links.has(url)) links.set(url, { url, label: null });
      if (links.size >= 25) break;
    }
  }
  return Array.from(links.values());
}

// ── Summary ──────────────────────────────────────────────────────────────────

export function buildExtractiveSummary(
  subject: string | null,
  body: string | null,
  length: 'SHORT' | 'NORMAL' | 'DETAILED',
): string | null {
  const text = (body ?? '').replace(/\r/g, '');
  if (text.trim().length === 0) {
    return subject ? `Message titled "${subject}" — no readable body content.` : null;
  }

  const limit = length === 'SHORT' ? 1 : length === 'NORMAL' ? 3 : 5;
  const sentences = splitSentences(text).filter((sentence) => sentence.length > 25);
  const selected: string[] = [];

  // Prefer sentences that carry obligations or key facts.
  const ranked = sentences
    .map((sentence) => ({ sentence, score: sentenceScore(sentence) }))
    .sort((a, b) => b.score - a.score);

  for (const { sentence } of ranked) {
    if (selected.length >= limit) break;
    if (selected.some((existing) => similar(existing, sentence))) continue;
    selected.push(sentence);
  }

  if (selected.length === 0) {
    return subject ? `Message about "${subject}".` : null;
  }

  // Present in original order for readability.
  const ordered = sentences.filter((sentence) => selected.includes(sentence));
  return ordered.join(' ').slice(0, length === 'SHORT' ? 240 : length === 'NORMAL' ? 600 : 1200);
}

function splitSentences(text: string): string[] {
  return text
    .replace(/\n{2,}/g, '\n')
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])|\n+/)
    .map((sentence) => sentence.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function sentenceScore(sentence: string): number {
  let score = Math.min(sentence.length, 200) / 200;
  const cues = [
    /\b(?:please|kindly|must|required|should|need to)\b/i,
    /\b(?:deadline|due|submit|by \w+|before \w+)\b/i,
    /\b(?:meeting|scheduled|rescheduled|cancelled|canceled)\b/i,
    /\b(?:important|note that|please note|update)\b/i,
    /\b(?:attached|attachment|document|report)\b/i,
  ];
  for (const cue of cues) if (cue.test(sentence)) score += 0.35;
  if (/^(?:hi|hello|dear|thanks|thank you|regards|best)\b/i.test(sentence)) score -= 0.5;
  return score;
}

function similar(a: string, b: string): boolean {
  const first = new Set(a.toLowerCase().split(/\s+/).slice(0, 12));
  const second = b.toLowerCase().split(/\s+/).slice(0, 12);
  const overlap = second.filter((word) => first.has(word)).length;
  return overlap / Math.max(second.length, 1) > 0.6;
}

// ── Full deterministic analysis ──────────────────────────────────────────────

export function runRulesAnalysis(input: RulesAnalysisInput): EmailAnalysisResult {
  const dateContext: DateExtractionContext = {
    referenceInstant: input.referenceInstant,
    timezone: input.timezone,
  };

  const body = input.bodyText ?? '';
  const subject = input.subject ?? '';
  const categoryVerdict = classifyCategory({
    subject: input.subject,
    bodyText: input.bodyText,
    senderEmail: input.senderEmail,
  });
  const actionVerdict = detectActionRequired(subject, body);

  const deadlineExtraction = input.deadlineDetectionEnabled
    ? extractDeadline(body.length > 0 ? body : subject, dateContext)
    : { deadline: null, dates: [], notes: ['DEADLINE_DETECTION_DISABLED'] };

  const priorityAssessment = input.priorityDetectionEnabled
    ? assessPriority({
        subject: input.subject,
        bodyText: input.bodyText,
        senderEmail: input.senderEmail,
        actionRequired: actionVerdict.required,
        deadline: deadlineExtraction.deadline,
        importantSenders: input.importantSenders,
        ignoredSenders: input.ignoredSenders,
        referenceInstant: input.referenceInstant,
        timezone: input.timezone,
      })
    : {
        priority: 'NONE' as const,
        score: 0,
        reason: 'Priority detection is turned off in your settings.',
        signals: [],
        confidence: 0.3,
      };

  const summary = buildExtractiveSummary(input.subject, input.bodyText, input.summaryLength);

  const suggestedTask: ProposedTask | null =
    actionVerdict.required && actionVerdict.action
      ? {
          title: actionVerdict.action.slice(0, 160),
          description: actionVerdict.sourceSentence ?? summary,
          due_date: deadlineExtraction.deadline?.date ?? null,
          due_time: deadlineExtraction.deadline?.time ?? null,
          priority: priorityAssessment.priority,
          category: categoryVerdict.category,
        }
      : null;

  const overall = Number(
    (
      categoryVerdict.confidence * 0.35 +
      actionVerdict.confidence * 0.3 +
      (deadlineExtraction.deadline?.confidence ?? 0.4) * 0.2 +
      priorityAssessment.confidence * 0.15
    ).toFixed(3),
  );

  const reviewReasons: string[] = [];
  if (deadlineExtraction.deadline && deadlineExtraction.deadline.date === null && categoryVerdict.category !== 'PROMOTIONAL') {
    reviewReasons.push('A time reference was found but no clear deadline could be determined.');
  }
  if (actionVerdict.isRequest && actionVerdict.confidence < 0.7) {
    reviewReasons.push('This message looks like a request — please confirm whether it needs action.');
  }
  if (categoryVerdict.confidence < 0.5) {
    reviewReasons.push('The category could not be determined confidently.');
  }

  return {
    category: categoryVerdict.category,
    secondary_categories: categoryVerdict.secondary,
    summary,
    action_required: actionVerdict.required,
    priority: priorityAssessment.priority,
    priority_reason: priorityAssessment.reason,
    priority_score: priorityAssessment.score,
    detected_dates: deadlineExtraction.dates,
    detected_deadline: deadlineExtraction.deadline,
    detected_people: extractPeople(`${subject}\n${body}`, input.senderName, input.senderEmail),
    detected_organizations: extractOrganizations(`${subject}\n${body}`, input.senderEmail),
    detected_links: extractLinks(null, body),
    detected_attachments: input.attachments,
    suggested_action: actionVerdict.action,
    suggested_task: suggestedTask,
    confidence: {
      category: categoryVerdict.confidence,
      action: actionVerdict.confidence,
      deadline: deadlineExtraction.deadline?.confidence ?? 0,
      priority: priorityAssessment.confidence,
      overall,
    },
    needs_review: reviewReasons.length > 0,
    review_reason: reviewReasons.length > 0 ? reviewReasons.join(' ') : null,
    model_name: 'rules-engine',
    analysis_source: 'RULES_ENGINE',
    analysis_version: input.analysisVersion,
    grounding_report: {
      checked: true,
      unsupported: [],
      dropped_count: 0,
      notes: [
        'Deterministic analysis: every field is derived from the message text.',
        ...deadlineExtraction.notes,
      ],
    },
    injection_flagged: false,
    injection_signals: [],
  };
}

// Re-exported for tests and for the AI path's evidence checks.
export { ORG_SUFFIXES, CATEGORY_RULES };
