import type { Metadata } from 'next';
import Link from 'next/link';
import {
  AlertTriangle,
  BadgeCheck,
  Brain,
  CalendarDays,
  CheckCircle2,
  Mail,
  MapPin,
  Pencil,
  Plug,
  ShieldCheck,
} from 'lucide-react';
import { requireAuthContext } from '@/lib/auth';
import { getStore } from '@/lib/store';
import { loadAnalytics } from '@/lib/services/dashboard';
import { capabilityReport } from '@/lib/env';
import { PageHeader } from '@/components/layout/PageHeader';
import { DashboardAnalytics } from '@/components/dashboard/DashboardAnalytics';
import { Button } from '@/components/ui/Button';
import { absoluteTime, initials, relativeTime } from '@/lib/utils';

export const metadata: Metadata = { title: 'Profile' };
export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  const auth = await requireAuthContext();
  const store = await getStore();

  const [counters, accounts, analytics] = await Promise.all([
    store.dashboardCounters(auth.id),
    store.listAccounts(auth.id),
    loadAnalytics({ store, userId: auth.id, days: 14 }),
  ]);

  const capabilities = capabilityReport();
  const displayName = auth.profile.full_name ?? auth.fullName ?? auth.email ?? 'You';
  const connectedMailboxes = accounts.filter((account) => account.status === 'CONNECTED');

  const facts = [
    {
      icon: <Mail className="h-3.5 w-3.5" aria-hidden="true" />,
      label: 'Email address',
      value: auth.email ?? 'Not available',
    },
    {
      icon: <MapPin className="h-3.5 w-3.5" aria-hidden="true" />,
      label: 'Timezone',
      value: auth.profile.timezone,
    },
    {
      icon: <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />,
      label: 'Member since',
      value: absoluteTime(auth.profile.created_at, auth.timezone),
    },
    {
      icon: <Plug className="h-3.5 w-3.5" aria-hidden="true" />,
      label: 'Connected mailboxes',
      value:
        connectedMailboxes.length === 0
          ? 'None yet'
          : connectedMailboxes.map((account) => account.email_address).join(', '),
    },
  ];

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5">
      <PageHeader
        title="Profile"
        description="Who VozInbox is working for, and what it currently knows."
        action={
          <Button variant="secondary" size="sm" asChild>
            <Link href="/settings">
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              Edit profile
            </Link>
          </Button>
        }
      />

      <section className="panel p-5">
        <div className="flex flex-wrap items-center gap-4">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.04] text-lg font-semibold text-mist-100">
            {initials(displayName)}
          </span>
          <div className="min-w-0">
            <h2 className="flex flex-wrap items-center gap-2 text-base font-semibold text-mist-50">
              {displayName}
              <span className="chip chip-neutral">
                <BadgeCheck className="h-3 w-3" aria-hidden="true" />
                {auth.source === 'supabase' ? 'Supabase account' : 'Local development account'}
              </span>
            </h2>
            <p className="mt-1 text-xs text-mist-400">
              VozInbox reads your connected mailboxes, extracts what needs action, and never speaks on your
              behalf.
            </p>
          </div>
        </div>

        <dl className="mt-5 grid gap-4 sm:grid-cols-2">
          {facts.map((fact) => (
            <div key={fact.label} className="flex items-start gap-2.5">
              <span className="mt-0.5 text-mist-500">{fact.icon}</span>
              <div className="min-w-0">
                <dt className="text-[11px] uppercase tracking-wide text-mist-500">{fact.label}</dt>
                <dd className="mt-0.5 break-anywhere text-sm text-mist-200">{fact.value}</dd>
              </div>
            </div>
          ))}
        </dl>
      </section>

      <section className="panel p-5">
        <h2 className="text-sm font-semibold text-mist-50">What the agent has processed</h2>
        <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'Messages stored', value: counters.totalEmails },
            { label: 'Analysed today', value: counters.analyzedToday },
            { label: 'Awaiting review', value: counters.needsReview },
            { label: 'Open tasks', value: counters.pendingTasks },
          ].map((entry) => (
            <div key={entry.label} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
              <dt className="text-[11px] uppercase tracking-wide text-mist-500">{entry.label}</dt>
              <dd className="mt-1 text-xl font-semibold text-mist-50">{entry.value}</dd>
            </div>
          ))}
        </dl>
        <div className="divider my-4" />
        <DashboardAnalytics analytics={analytics} />
      </section>

      <section className="panel p-5">
        <h2 className="text-sm font-semibold text-mist-50">Capabilities</h2>
        <p className="mt-0.5 text-xs text-mist-400">
          Exactly what is switched on right now — VozInbox never claims a feature works when its
          configuration is missing.
        </p>

        <ul className="mt-3 space-y-2 text-xs">
          <CapabilityRow
            label="Database"
            ok
            value={capabilities.database === 'supabase' ? 'Supabase (row-level security on)' : 'Local development store'}
          />
          <CapabilityRow
            label="Authentication"
            ok
            value={auth.source === 'supabase' ? 'Supabase Auth' : 'Local development auth'}
          />
          <CapabilityRow
            label="AI provider"
            ok={capabilities.ai === 'configured'}
            value={
              capabilities.ai === 'configured'
                ? 'Configured — AI analysis and chat enabled'
                : 'Not configured — deterministic rules engine only'
            }
          />
          <CapabilityRow
            label="Gmail integration"
            ok={capabilities.gmail === 'configured'}
            value={
              capabilities.gmail === 'configured'
                ? 'OAuth client configured — connect a mailbox from Integrations'
                : 'OAuth client not configured — Gmail cannot be connected'
            }
          />
          <CapabilityRow
            label="Token encryption"
            ok={capabilities.tokenEncryption === 'configured'}
            value={
              capabilities.tokenEncryption === 'configured'
                ? 'AES-256-GCM at rest'
                : 'TOKEN_ENCRYPTION_KEY missing — OAuth tokens will not be stored'
            }
          />
        </ul>

        {capabilities.issues.length > 0 ? (
          <div className="mt-4 rounded-xl border border-medium/25 bg-medium/[0.07] p-3">
            <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-medium">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
              Setup notes
            </p>
            <ul className="mt-2 space-y-1.5 text-[11px] leading-relaxed text-medium">
              {capabilities.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section className="panel p-5">
        <h2 className="text-sm font-semibold text-mist-50">Privacy posture</h2>
        <ul className="mt-3 space-y-2.5 text-xs leading-relaxed text-mist-300">
          <li className="flex gap-2.5">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-positive" aria-hidden="true" />
            Read-only mailbox access. VozInbox has no code path that sends, deletes, labels or forwards email.
          </li>
          <li className="flex gap-2.5">
            <Brain className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-300" aria-hidden="true" />
            Email content is treated as untrusted data: instructions inside a message are never executed.
          </li>
          <li className="flex gap-2.5">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-positive" aria-hidden="true" />
            Every extracted date, name and deadline is checked against the original text before it is stored.
          </li>
        </ul>
        <p className="mt-4 text-[11px] text-mist-600">
          Last account update {relativeTime(auth.profile.updated_at)}. Manage or remove everything from{' '}
          <Link href="/settings" className="text-violet-300 hover:text-violet-200">
            Settings
          </Link>
          .
        </p>
      </section>
    </div>
  );
}

function CapabilityRow({ label, ok, value }: { label: string; ok: boolean; value: string }) {
  return (
    <li className="flex items-start gap-2.5">
      <span className={`mt-0.5 flex h-4 w-4 items-center justify-center rounded-full ${ok ? 'text-positive' : 'text-medium'}`}>
        {ok ? (
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
        ) : (
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
        )}
      </span>
      <span className="min-w-0">
        <span className="font-medium text-mist-100">{label}: </span>
        <span className="text-mist-400">{value}</span>
      </span>
    </li>
  );
}
