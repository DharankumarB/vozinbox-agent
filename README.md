# VozInbox Agent

**Turn your inbox into actionable intelligence.**

VozInbox Agent reads the email you connect, understands what it means, extracts the actions and
deadlines inside it, and turns them into suggested tasks and notifications — with confidence scores,
evidence from the source text, and a human approval step before anything becomes real work.

It is a complete Next.js 15 application: authentication, a Supabase schema with row-level security, a
read-only Gmail integration, an AI analysis pipeline with a deterministic fallback, a tool-calling chat
assistant, and a dark, responsive product UI.

---

## 1. What actually works (and what needs configuration)

Nothing in this app pretends to work when it is not configured. The UI reads a live capability report
(`/profile` → *Capabilities*) and tells you exactly what is switched on.

| Capability | Without configuration | With configuration |
| --- | --- | --- |
| Accounts, sessions, protected routes | Local development store (file-based, dev only) | Supabase Auth (email + password, reset, persistence) |
| Inbox storage, tasks, notifications, audit log | Local development store (`.vozinbox-dev/`) | Supabase Postgres with RLS |
| Email analysis | **Deterministic rules engine** — classification, action detection, deadline extraction, priority scoring, thread change detection | Same pipeline, with an AI provider refining the output through a validated JSON contract |
| Deadline / priority / summary | Works (rules engine) | Works (AI + grounding verification) |
| Chat assistant | Unavailable, and says so | Grounded tool-calling assistant over your stored data |
| Gmail sync | Unavailable — *Connect Gmail* explains what is missing | Read-only OAuth sync with incremental history and re-analysis |
| Notifications, search, filters, sorting, audit trail, analytics | Fully functional on local data | Fully functional on Supabase |

**Not built here (and deliberately out of scope):** VozCore, VozProject, VozGoal and VozDay. The domain
layer defines forward-compatible types for them, but no routes, pages or logic exist yet. Outlook is
architected for (provider-agnostic accounts and messages) but not implemented. There is no WhatsApp
integration. Attachments are read as **metadata only** — contents are never downloaded, opened or
executed.

**The product never, at any point, sends, deletes, labels, archives or forwards email.** The Gmail
client requests `gmail.readonly` and there is no code path that mutates a mailbox.

---

## 2. Routes

| Route | Purpose |
| --- | --- |
| `/login`, `/signup`, `/forgot-password` | Authentication (Supabase or local dev store) |
| `/dashboard` | What needs attention now: priorities, deadlines, review queue, agent status |
| `/inbox` | Every analysed message with category, priority, deadline and action; search, filters, sorting |
| `/inbox/[id]` | One message: body, AI understanding panel (with evidence), suggested task, thread, history |
| `/tasks` | Suggested and tracked work: approve, edit, complete, reopen, dismiss, delete, source-email link |
| `/notifications` | Typed notifications (important mail, deadlines, task suggestions, thread changes, integration issues) |
| `/assistant` | Chat grounded strictly in stored inbox data, with a “how this answer was produced” trace |
| `/search` | Plain-language search translated into structured filters, with the interpretation shown |
| `/activity` | Agent Activity: every run, step, tool call and change, with depth limits visible |
| `/integrations` | Connect / disconnect Gmail, sync now, re-analyse, integration telemetry |
| `/settings` | Account, notifications, AI behaviour + confidence threshold, sync interval, privacy & data |
| `/profile` | Identity, capability report, privacy posture, agent statistics |
| `/api/*` | JSON API for every mutation, all user-scoped and rate limited |

---

## 3. Quick start (no external accounts required)

The app runs end to end against the local development store, including the analysis pipeline. This is a
development-only mode: `getStore()` refuses it in production (`NODE_ENV=production`).

```bash
git clone https://github.com/DharankumarB/vozinbox-agent.git
cd vozinbox-agent
npm install
cp .env.example .env.local          # leave the blanks blank for now
npm run dev                          # http://localhost:3000
```

1. Open <http://localhost:3000> → you are redirected to `/login`.
2. Create an account (anything with a password of at least 8 characters).
3. The dashboard shows the honest empty state: *No mailbox connected*.
4. Without Gmail credentials you cannot sync real mail, but every other feature — tasks, notifications,
   assistant (needs AI), search, activity, settings, per-user isolation — is fully testable.

Data lives in `.vozinbox-dev/data.json` (git-ignored). Delete the folder to reset.

---

## 4. Connecting real infrastructure

### 4.1 Supabase (database, auth, realtime)

1. Create a project at <https://supabase.com>.
2. **Project settings → API** and copy into `.env.local`:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` (or the newer publishable key)
   - `SUPABASE_SERVICE_ROLE_KEY` — server-only; used for background sync and cron
3. **Project settings → Database → Connection string** → copy the URI for `SUPABASE_DB_URL`.
4. Apply the schema (idempotent, safe to re-run):

   ```bash
   npm run db:migrate            # uses the pg driver or psql if installed
   npm run db:migrate -- --dry-run   # list migrations + checksums without applying
   ```

   No `psql`/`pg` available? Paste the files in `supabase/migrations/0001…0007` into the Supabase SQL
   editor **in filename order**. They create extensions, enums, tables, indexes, row-level security,
   functions, triggers, realtime publications and the query RPCs.

5. **Authentication → URL configuration** → add `http://localhost:3000/**` as a redirect URL, and set
   the Site URL to your deployment origin.

Row-level security is enforced on every table; the policies are in `0004_rls.sql`. The service-role key
is only used by server-side background jobs, and every query it makes is still scoped by `user_id`.

### 4.2 Gmail (read-only)

1. <https://console.cloud.google.com> → create/select a project.
2. **APIs & Services → Library** → enable **Gmail API**.
3. **OAuth consent screen** → External → add the scope
   `https://www.googleapis.com/auth/gmail.readonly`. While the app is in *Testing*, add your Google
   account under **Test users** (this matters: Gmail scopes require verification for public use).
4. **Credentials → Create credentials → OAuth client ID → Web application**.
   Authorized redirect URI:
   `https://YOUR-DOMAIN/api/integrations/gmail/callback`
   (use `http://localhost:3000/api/integrations/gmail/callback` locally).
5. Fill in `.env.local`:

   ```bash
   GOOGLE_CLIENT_ID="…apps.googleusercontent.com"
   GOOGLE_CLIENT_SECRET="…"
   TOKEN_ENCRYPTION_KEY="$(openssl rand -base64 32)"
   NEXT_PUBLIC_APP_URL="http://localhost:3000"
   ```

   `TOKEN_ENCRYPTION_KEY` is required: OAuth refresh/access tokens are encrypted with AES-256-GCM before
   they touch the database. Without it, *Connect Gmail* stays disabled and explains why.

6. Restart, go to **Integrations → Connect Gmail**, approve read-only access, then **Sync now**.
   The first sync pulls the last 14 days of non-chat mail (capped by `AGENT_MAX_EMAILS_PER_SYNC`);
   subsequent syncs use Gmail's incremental history API and fall back to a date-bounded query when the
   history cursor has expired.

### 4.3 AI provider (optional but recommended)

Any OpenAI-compatible endpoint works (OpenAI, Azure OpenAI, OpenRouter, Groq, Together, vLLM, Ollama):

```bash
AI_API_KEY="…"
AI_BASE_URL="https://api.openai.com/v1"
AI_MODEL="gpt-4o-mini"
AI_CHAT_MODEL=""                 # optional cheaper model for the assistant
AI_STRUCTURED_OUTPUT_MODE="auto" # auto | json_schema | json_object | prompt
AI_MAX_TOOL_DEPTH="4"            # hard cap on assistant tool rounds
```

The pipeline prefers strict JSON-schema structured output and degrades to JSON mode, then to
prompt-enforced JSON, per provider. If the provider fails or returns invalid output, the run is marked
degraded, the rules-engine result is stored, and the UI says so — it never silently invents a result.

### 4.4 Scheduled sync (optional)

`/api/cron/sync` requires `CRON_SECRET` (as `Authorization: Bearer …` or `?secret=`), walks accounts
whose sync interval has elapsed, and never runs more than `AGENT_MAX_EMAILS_PER_SYNC` messages per
account. Point any scheduler at it:

```
*/15 * * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://YOUR-DOMAIN/api/cron/sync
```

---

## 5. How the intelligence works

```
Gmail (read-only) ─▶ sync ─▶ stored message ─▶ agent pipeline ─▶ analysis + actions + thread state
                                                   │
                                                   ├─▶ suggested task (human approves)
                                                   ├─▶ typed notification
                                                   └─▶ audit trail (Agent Activity)
```

**Analysis pipeline** (12 logged steps): validate source → fetch content → inspect untrusted content →
classify (14 categories) → extract actions → detect deadlines → score priority → cross-check → compute
confidence → deduplicate tasks → update thread state → notify.

**Deterministic core.** Date resolution, priority scoring, category classification, action detection,
thread precedence, duplicate prevention and change detection are all pure, testable modules in
`src/lib/analysis/`. The AI layer refines them; it never replaces the guarantees.

**Guardrails.**

- Email content is untrusted input. Instruction-like text is detected, redacted, wrapped in explicit
  delimiters, and never concatenated into system instructions. Attempts are flagged to the user.
- Every extracted claim is verified against the source text before storage. A deadline that cannot be
  found in the message is dropped (stored as `null`) and confidence is reduced — `null` always beats a
  plausible-looking fabrication.
- Dates resolve against the **email's own timestamp** in the **user's timezone**; a time is only reported
  when the message states one unambiguously.
- Tasks are only ever created as `SUGGESTED` / `AI_SUGGESTED`; approving is a human action, and a unique
  `(user_id, source_email_id, dedupe_key)` index plus semantic matching prevent duplicate tasks.

**Threads.** The latest authoritative message wins. Earlier interpretations are preserved for audit, and
changes (deadline moved, meeting cancelled, instructions updated, attachment added, priority raised) are
surfaced rather than silently overwritten.

**Assistant.** Grounded strictly in stored, analysed data through a scoped tool surface (read tools plus
task/notification mutations). Tool depth is capped, list sizes are capped, email bodies are passed as
untrusted data, and every answer can show which lookups produced it.

---

## 6. Security model

- **Auth**: Supabase Auth (or the signed, HttpOnly local-dev cookie). Middleware refreshes the session
  on every request and protected pages verify the user server-side before rendering.
- **Isolation**: every table has RLS policies keyed on `auth.uid()`; every server query is additionally
  scoped by `user_id`.
- **Secrets**: `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_CLIENT_SECRET`, `AI_API_KEY`, `TOKEN_ENCRYPTION_KEY`
  and `CRON_SECRET` are only read in server modules (`src/lib/env.ts` enforces this), and the logger
  redacts secret-shaped values.
- **Tokens**: AES-256-GCM at rest, uniquely IV'd, never logged, revoked at Google on disconnect.
- **Rate limits**: per-user buckets on AI analysis (30/min), chat (20/min), search (60/min), sync
  (6/min), OAuth start/callback, task/email/notification mutations, profile changes, auth attempts and
  cron — enforced in memory and, when available, through the durable `consume_rate_limit` RPC.
- **Errors**: friendly messages to the user, codes and context to server logs. Stack traces and provider
  payloads are never returned over the wire.
- **Data deletion**: *Settings → Delete VozInbox data* removes stored messages, analyses, tasks,
  notifications and audit history, and disconnects the mailbox. It states plainly that the Gmail account
  itself is untouched.

---

## 7. Project layout

```
src/
  app/
    (auth)/            login, signup, forgot-password
    (app)/             dashboard, inbox, inbox/[id], tasks, notifications,
                       assistant, search, activity, integrations, settings, profile
    api/               auth, inbox, emails, email-analysis, tasks, notifications,
                       integrations/gmail/*, agent/*, search, settings, account, cron
  components/          ui primitives, layout chrome, inbox, tasks, chat, settings, integrations
  lib/
    analysis/          dates, priority, rules engine, thread, dedupe   ← deterministic core
    ai/                provider, schemas, prompts, guardrails, pipeline, tools, chat
    integrations/      gmail client, OAuth state, account lifecycle
    search/            natural-language query parser + timezone anchor
    services/          agent orchestration, dashboard aggregation
    store/             Store contract + Supabase and local implementations
    supabase/          browser/server/admin clients + middleware session refresh
supabase/migrations/   0001…0007 schema, RLS, functions, RPCs
tests/                 114+ unit and store tests over the deterministic core
scripts/               apply-migrations.mjs
```

---

## 8. Commands

```bash
npm run dev            # development server
npm run build          # production build (type-checks as part of the build)
npm start              # serve the production build
npm run typecheck      # tsc --noEmit (strict, noUncheckedIndexedAccess)
npm run lint           # ESLint (next/core-web-vitals + next/typescript)
npm test               # Vitest unit + store suite
npm run verify         # typecheck + tests + build
npm run db:migrate     # apply supabase/migrations
```

The test suite covers deadline extraction (including ambiguity and timezone edge cases), priority
scoring, the rules engine, thread precedence and change detection, duplicate prevention, prompt-injection
guardrails, grounding verification, natural-language search parsing, token encryption, rate limiting and
per-user data isolation.

---

## 9. Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| *Connect Gmail* is disabled with a message about missing configuration | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` or `TOKEN_ENCRYPTION_KEY` is unset. Add all three and restart. |
| Connect works but sync says *reconnect required* | The refresh token was revoked or expired. Disconnect and connect again. |
| Assistant says no AI provider is configured | `AI_API_KEY` is unset. Analysis still works through the rules engine. |
| Analysis says *degraded* | The AI provider failed or returned invalid output. The rules-engine result is stored instead; the audit trail records the failure code. |
| *Deadline could not be confidently determined* | The message contained a vague time reference (“soon”, “next week”). VozInbox refuses to invent a date; confirm it manually. |
| “Not configured to handle this request” from Supabase | `NEXT_PUBLIC_APP_URL` does not match the origin you are using. Set it, and add the matching redirect URL in Supabase. |
| Local mode banner on a deployed instance | `NEXT_PUBLIC_SUPABASE_URL`/`ANON_KEY` are missing. Local mode is refused in production, so configure Supabase. |

---

## 10. License / provenance

Built as a complete, runnable product. Every behaviour described here is implemented in this repository;
anything that is not implemented is listed in §1 as out of scope rather than implied by the UI.
