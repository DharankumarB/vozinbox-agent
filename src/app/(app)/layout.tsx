import type { ReactNode } from 'react';
import { requireAuthContext } from '@/lib/auth';
import { getStore, usingLocalStore } from '@/lib/store';
import { capabilityReport } from '@/lib/env';
import { Sidebar } from '@/components/layout/Sidebar';
import { TopBar } from '@/components/layout/TopBar';
import { MobileNav } from '@/components/layout/MobileNav';
import { RealtimeRefresher } from '@/components/layout/RealtimeRefresher';
import type { AgentState } from '@/components/agent/AgentStatusPill';
import { Database, Info } from 'lucide-react';

/**
 * Protected application shell (§5, §39).
 *
 * The auth check happens on the server before anything renders; unauthenticated
 * visitors are redirected to /login.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const auth = await requireAuthContext();
  const store = await getStore();

  const [counters, accounts, runs] = await Promise.all([
    store.dashboardCounters(auth.id),
    store.listAccounts(auth.id),
    store.listAgentRuns(auth.id, 3),
  ]);

  const connected = accounts.filter((account) => account.status === 'CONNECTED');
  const latestRun = runs[0] ?? null;
  const lastSyncAt = connected
    .map((account) => account.last_sync_at)
    .filter((value): value is string => Boolean(value))
    .sort()
    .reverse()[0] ?? null;

  const agentState: AgentState =
    connected.length === 0
      ? 'NO_INTEGRATION'
      : latestRun?.status === 'RUNNING'
        ? 'ANALYSING'
        : latestRun?.status === 'FAILED'
          ? 'ERROR'
          : counters.needsReview > 0
            ? 'NEEDS_REVIEW'
            : 'IDLE';

  const capabilities = capabilityReport();
  const localMode = usingLocalStore();

  return (
    <div className="flex min-h-dvh">
      <RealtimeRefresher userId={auth.id} />

      <Sidebar
        unread={counters.unread}
        tasks={counters.pendingTasks}
        notifications={counters.unreadNotifications}
        displayName={auth.profile.full_name ?? auth.fullName ?? auth.email ?? 'Your account'}
        planLabel={localMode ? 'Local development mode' : 'VozInbox Agent'}
        agentState={agentState}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          email={auth.email}
          lastSyncAt={lastSyncAt}
          unreadNotifications={counters.unreadNotifications}
        />

        {localMode ? (
          <div className="border-b border-violet-400/20 bg-violet-500/[0.07] px-4 py-2 text-[11px] text-violet-100 lg:px-6">
            <p className="flex items-start gap-2">
              <Database className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>
                <strong className="font-semibold">Local development mode.</strong> Supabase is not
                configured, so data is stored on this machine.
                {capabilities.gmail === 'configured'
                  ? ' Google credentials are active for Gmail connection.'
                  : ' Add Google credentials to connect real Gmail accounts.'}
                {' '}Add your Supabase URL & Key to connect to cloud infrastructure.
              </span>
            </p>
          </div>
        ) : null}

        {!localMode && capabilities.ai === 'not_configured' ? (
          <div className="border-b border-medium/20 bg-medium/[0.06] px-4 py-2 text-[11px] text-medium lg:px-6">
            <p className="flex items-start gap-2">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>
                No AI provider is configured, so emails are analysed by the built-in rules engine and
                the assistant is unavailable. Add <code className="font-mono">AI_API_KEY</code> to
                enable model-based analysis.
              </span>
            </p>
          </div>
        ) : null}

        <main id="main" className="min-w-0 flex-1 px-4 pb-24 pt-5 lg:px-6 lg:pb-10">
          {children}
        </main>
      </div>

      <MobileNav unreadNotifications={counters.unreadNotifications} />
    </div>
  );
}
