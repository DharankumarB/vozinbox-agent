import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, CalendarClock, Inbox, ListChecks, Mail, Sparkles, TrendingUp } from 'lucide-react';
import { requireAuthContext } from '@/lib/auth';
import { getStore } from '@/lib/store';
import { loadDashboard, loadAnalytics } from '@/lib/services/dashboard';
import { Card, CardHeader, SectionTitle } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/States';
import { Button } from '@/components/ui/Button';
import { EmailCard } from '@/components/inbox/EmailCard';
import { ActivityFeed } from '@/components/agent/ActivityFeed';
import { DashboardAnalytics } from '@/components/dashboard/DashboardAnalytics';
import { ConnectGmailButton } from '@/components/integrations/ConnectGmailButton';
import { greeting } from '@/lib/greeting';

export const metadata: Metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const auth = await requireAuthContext();
  const store = await getStore();

  const [dashboard, analytics] = await Promise.all([
    loadDashboard({ store, userId: auth.id }),
    loadAnalytics({ store, userId: auth.id, days: 7 }),
  ]);

  const { counters } = dashboard;

  const stats = [
    { label: 'Unread', value: counters.unread, icon: Mail, href: '/inbox?filter=UNREAD', tone: 'text-mist-100' },
    { label: 'Action required', value: counters.actionRequired, icon: AlertTriangle, href: '/inbox?filter=ACTION_REQUIRED', tone: 'text-high' },
    { label: 'High priority', value: counters.highPriority, icon: TrendingUp, href: '/inbox?filter=HIGH_PRIORITY', tone: 'text-critical' },
    { label: 'Pending tasks', value: counters.pendingTasks, icon: ListChecks, href: '/tasks', tone: 'text-violet-200' },
  ];

  const hasInbox = dashboard.hasAnyEmail || dashboard.hasConnectedAccount;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <header className="animate-fade-up">
        <h1 className="text-2xl font-semibold tracking-tight text-mist-50 sm:text-[28px]">
          {greeting(auth.timezone)} 👋
        </h1>
        <p className="mt-1 text-sm text-mist-400">
          {hasInbox
            ? "Here's what needs your attention."
            : 'Connect your inbox to see what needs your attention.'}
        </p>
      </header>

      {!hasInbox ? (
        <EmptyState
          icon={<Inbox className="h-5 w-5" aria-hidden="true" />}
          title="No inbox connected yet"
          description="VozInbox reads your email, extracts deadlines and actions, and suggests tasks — while asking before anything irreversible. Connect Gmail to get started."
          action={<ConnectGmailButton />}
        />
      ) : null}

      <section aria-label="Inbox summary" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <Link
              key={stat.label}
              href={stat.href}
              className="panel panel-hover group flex flex-col gap-2 p-4"
            >
              <span className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-mist-500">
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                {stat.label}
              </span>
              <span className={`text-2xl font-semibold tabular-nums ${stat.tone}`}>
                {stat.value}
              </span>
            </Link>
          );
        })}
      </section>

      {hasInbox ? (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
          <div className="space-y-6">
            <section aria-labelledby="attention-heading">
              <div className="mb-3 flex items-center justify-between">
                <SectionTitle className="mb-0">
                  <span id="attention-heading">Needs your attention</span>
                </SectionTitle>
                <Link href="/inbox?filter=ACTION_REQUIRED" className="text-xs text-violet-300 hover:text-violet-200">
                  View all
                </Link>
              </div>

              {dashboard.attention.length === 0 ? (
                <EmptyState
                  icon={<Sparkles className="h-5 w-5" aria-hidden="true" />}
                  title="Nothing urgent right now"
                  description="We didn't find any messages that clearly require action. New email will appear here as it is analysed."
                  className="py-8"
                />
              ) : (
                <ul className="space-y-2.5">
                  {dashboard.attention.map((item) => (
                    <li key={item.email.id}>
                      <EmailCard item={item} timezone={auth.timezone} />
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section aria-labelledby="deadlines-heading">
              <div className="mb-3 flex items-center justify-between">
                <SectionTitle className="mb-0">
                  <span id="deadlines-heading">Upcoming deadlines</span>
                </SectionTitle>
                <Link href="/inbox?filter=DEADLINES" className="text-xs text-violet-300 hover:text-violet-200">
                  View all
                </Link>
              </div>

              {dashboard.deadlines.length === 0 ? (
                <EmptyState
                  icon={<CalendarClock className="h-5 w-5" aria-hidden="true" />}
                  title="No deadlines detected"
                  description="When a message states a due date, it will appear here with the evidence sentence it came from."
                  className="py-8"
                />
              ) : (
                <ul className="space-y-2">
                  {dashboard.deadlines.map((entry) => (
                    <li key={entry.email.id}>
                      <Link
                        href={`/inbox/${entry.email.id}`}
                        className="panel panel-hover flex items-center justify-between gap-4 p-3.5"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-mist-100">
                            {entry.email.subject ?? '(no subject)'}
                          </p>
                          <p className="truncate text-xs text-mist-500">
                            {entry.email.sender_name ?? entry.email.sender_email ?? 'Unknown sender'}
                          </p>
                        </div>
                        <span className="shrink-0 text-right">
                          <span className="block text-xs font-semibold text-mist-200">
                            {new Date(`${entry.dueDate}T00:00:00Z`).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              timeZone: 'UTC',
                            })}
                          </span>
                          <span className="block text-[11px] text-mist-500">
                            {entry.daysRemaining === 0
                              ? 'Today'
                              : entry.daysRemaining === 1
                                ? 'Tomorrow'
                                : entry.daysRemaining < 0
                                  ? `${Math.abs(entry.daysRemaining)}d overdue`
                                  : `in ${entry.daysRemaining} days`}
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section aria-labelledby="recent-heading">
              <div className="mb-3 flex items-center justify-between">
                <SectionTitle className="mb-0">
                  <span id="recent-heading">Recent inbox activity</span>
                </SectionTitle>
                <Link href="/inbox" className="text-xs text-violet-300 hover:text-violet-200">
                  Open inbox
                </Link>
              </div>
              {dashboard.recentEmails.length === 0 ? (
                <EmptyState
                  title="No messages yet"
                  description="Run a sync to fetch your latest messages."
                  className="py-8"
                />
              ) : (
                <ul className="space-y-2.5">
                  {dashboard.recentEmails.slice(0, 4).map((item) => (
                    <li key={item.email.id}>
                      <EmailCard item={item} timezone={auth.timezone} compact />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader
                title="What the agent did"
                description="Every analysis step, logged as it happened."
                action={
                  <Link href="/activity" className="text-xs text-violet-300 hover:text-violet-200">
                    All
                  </Link>
                }
              />
              <ActivityFeed actions={dashboard.activity} compact />
            </Card>

            <DashboardAnalytics analytics={analytics} />

            <Card>
              <CardHeader title="Weekly trend" description="Emails analysed per day (last 7 days)" />
              {analytics.weeklyTrend.length === 0 ? (
                <p className="text-xs text-mist-500">No activity recorded yet.</p>
              ) : (
                <ul className="space-y-2.5">
                  {analytics.weeklyTrend.map((day) => {
                    const max = Math.max(...analytics.weeklyTrend.map((entry) => entry.emailsAnalyzed), 1);
                    const width = Math.round((day.emailsAnalyzed / max) * 100);
                    return (
                      <li key={day.day} className="flex items-center gap-3">
                        <span className="w-14 shrink-0 text-[11px] text-mist-500">
                          {new Date(`${day.day}T00:00:00Z`).toLocaleDateString('en-US', {
                            weekday: 'short',
                            timeZone: 'UTC',
                          })}
                        </span>
                        <span className="h-2 flex-1 overflow-hidden rounded-full bg-white/[0.05]">
                          <span
                            className="block h-full rounded-full bg-gradient-to-r from-violet-500 to-electric-400"
                            style={{ width: `${Math.max(width, day.emailsAnalyzed > 0 ? 6 : 0)}%` }}
                          />
                        </span>
                        <span className="w-6 shrink-0 text-right text-[11px] tabular-nums text-mist-400">
                          {day.emailsAnalyzed}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>

            <Card className="border-violet-400/15 bg-violet-500/[0.05]">
              <CardHeader
                title="Ask about your inbox"
                description="The assistant answers only from your real data."
                icon={<Sparkles className="h-4 w-4" aria-hidden="true" />}
              />
              <Button variant="primary" size="sm" asChild className="w-full">
                <Link href="/assistant" className="flex w-full items-center justify-center gap-2">
                  Open the assistant
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </Button>
            </Card>
          </div>
        </div>
      ) : null}
    </div>
  );
}
