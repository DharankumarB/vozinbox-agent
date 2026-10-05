/**
 * Environment access with explicit validation.
 *
 * Rules (§31, §59):
 *  • Server secrets are only ever read through functions called from server code.
 *  • Client code may only import `publicEnv()`.
 *  • Missing configuration degrades to a clear, actionable state — never to a crash
 *    on a marketing page, and never to fabricated data.
 */

const isServer = typeof window === 'undefined';

function read(name: string): string | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed.toLowerCase() === 'placeholder' || trimmed.startsWith('your-')) {
    return undefined;
  }
  return trimmed;
}

export interface PublicEnv {
  appUrl: string;
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
  /** True when no Supabase project is configured (local-only mode). */
  localMode: boolean;
}

let cachedPublic: PublicEnv | null = null;

export function publicEnv(): PublicEnv {
  if (cachedPublic) return cachedPublic;

  const appUrl = read('NEXT_PUBLIC_APP_URL') ?? 'http://localhost:3000';
  const supabaseUrl = read('NEXT_PUBLIC_SUPABASE_URL') ?? null;
  const supabaseAnonKey =
    read('NEXT_PUBLIC_SUPABASE_ANON_KEY') ?? read('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY') ?? null;

  cachedPublic = {
    appUrl: appUrl.replace(/\/$/, ''),
    supabaseUrl,
    supabaseAnonKey,
    localMode: isLocalModeEnabled() && (!supabaseUrl || !supabaseAnonKey),
  };
  return cachedPublic;
}

/** True when the app should run against the local development store. */
export function isLocalModeEnabled(): boolean {
  const mode = (read('VOZINBOX_LOCAL_MODE') ?? 'auto').toLowerCase();
  if (mode === 'on') return true;
  if (mode === 'off') return false;
  // auto: only when Supabase is unconfigured and we are not in production.
  const hasSupabase = Boolean(read('NEXT_PUBLIC_SUPABASE_URL') && (read('NEXT_PUBLIC_SUPABASE_ANON_KEY') ?? read('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY')));
  return !hasSupabase && process.env.NODE_ENV !== 'production';
}

// ── Server-only secrets ──────────────────────────────────────────────────────

function requireServer(): void {
  if (!isServer) {
    throw new Error(
      'Server-only environment variable accessed from the browser. This is a security boundary.',
    );
  }
}

export function supabaseServiceRoleKey(): string | null {
  requireServer();
  return read('SUPABASE_SERVICE_ROLE_KEY') ?? null;
}

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  allowedWorkspaceDomain: string | null;
  redirectUri: string;
}

export function googleOAuthConfig(): GoogleOAuthConfig | null {
  requireServer();
  const clientId = read('GOOGLE_CLIENT_ID');
  const clientSecret = read('GOOGLE_CLIENT_SECRET');
  if (!clientId || !clientSecret) return null;
  const { appUrl } = publicEnv();
  return {
    clientId,
    clientSecret,
    allowedWorkspaceDomain: read('GOOGLE_ALLOWED_WORKSPACE_DOMAIN') ?? null,
    redirectUri: `${appUrl}/api/integrations/gmail/callback`,
  };
}

export interface AIConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  chatModel: string;
  structuredOutputMode: 'auto' | 'json_schema' | 'json_object' | 'prompt';
  timeoutMs: number;
  maxToolDepth: number;
}

export function aiConfig(): AIConfig | null {
  requireServer();
  const apiKey = read('AI_API_KEY');
  if (!apiKey) return null;
  const model = read('AI_MODEL') ?? 'gpt-4o-mini';
  const mode = (read('AI_STRUCTURED_OUTPUT_MODE') ?? 'auto').toLowerCase();
  return {
    apiKey,
    baseUrl: (read('AI_BASE_URL') ?? 'https://api.openai.com/v1').replace(/\/$/, ''),
    model,
    chatModel: read('AI_CHAT_MODEL') ?? model,
    structuredOutputMode:
      mode === 'json_schema' || mode === 'json_object' || mode === 'prompt'
        ? (mode as AIConfig['structuredOutputMode'])
        : 'auto',
    timeoutMs: Number(read('AI_REQUEST_TIMEOUT_MS') ?? '45000') || 45000,
    maxToolDepth: Number(read('AI_MAX_TOOL_DEPTH') ?? '4') || 4,
  };
}

export function tokenEncryptionKey(): string | null {
  requireServer();
  return read('TOKEN_ENCRYPTION_KEY') ?? null;
}

export function cronSecret(): string | null {
  requireServer();
  return read('CRON_SECRET') ?? null;
}

export function analysisVersion(): string {
  return read('AGENT_ANALYSIS_VERSION') ?? '1.0.0';
}

export function agentLimits() {
  return {
    maxEmailsPerSync: Number(read('AGENT_MAX_EMAILS_PER_SYNC') ?? '40') || 40,
    defaultConfidenceThreshold: Number(read('AGENT_CONFIDENCE_THRESHOLD_DEFAULT') ?? '0.9') || 0.9,
  };
}

/**
 * Capability report surfaced in the UI so the product never pretends an
 * integration or AI provider is connected when it is not (§67).
 */
export interface CapabilityReport {
  database: 'supabase' | 'local';
  auth: 'supabase' | 'local';
  ai: 'configured' | 'not_configured';
  gmail: 'configured' | 'not_configured';
  tokenEncryption: 'configured' | 'not_configured';
  appUrl: string;
  issues: string[];
}

export function capabilityReport(): CapabilityReport {
  requireServer();
  const { supabaseUrl, supabaseAnonKey, localMode, appUrl } = publicEnv();
  const hasSupabase = Boolean(supabaseUrl && supabaseAnonKey);
  const ai = aiConfig();
  const google = googleOAuthConfig();
  const cryptoConfigured = Boolean(tokenEncryptionKey());

  const issues: string[] = [];
  if (!hasSupabase && !localMode) {
    issues.push('Supabase is not configured and local mode is disabled.');
  }
  if (google && !cryptoConfigured) {
    issues.push(
      'GOOGLE_CLIENT_ID is set but TOKEN_ENCRYPTION_KEY is missing — OAuth tokens cannot be stored securely, so Gmail connect is disabled.',
    );
  }
  if (!ai) {
    issues.push(
      'AI_API_KEY is not set. Emails will be processed by the deterministic rules engine only, and the AI chat/summary features stay unavailable.',
    );
  }

  return {
    database: hasSupabase ? 'supabase' : 'local',
    auth: hasSupabase ? 'supabase' : 'local',
    ai: ai ? 'configured' : 'not_configured',
    gmail: google && cryptoConfigured ? 'configured' : 'not_configured',
    tokenEncryption: cryptoConfigured ? 'configured' : 'not_configured',
    appUrl,
    issues,
  };
}
