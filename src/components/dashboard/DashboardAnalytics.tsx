import { Activity, CalendarCheck, Clock, ListChecks, TrendingUp, Zap } from 'lucide-react';
import type { AnalyticsSummary } from '@/lib/services/dashboard';
import { Card, CardHeader } from '@/components/ui/Card';
import { formatDuration } from '@/lib/utils';

export function DashboardAnalytics({ analytics }: { analytics: AnalyticsSummary }) {
  const metrics = [
    {
      label: 'Analyzed today',
      value: analytics.emailsAnalyzedToday,
      icon: Activity,
      hint: 'Messages processed in the last 24 hours',
    },
    {
      label: 'Actionable',
      value: analytics.actionableEmails,
      icon: Zap,
      hint: 'Emails that require something from you (7 days)',
    },
    {
      label: 'Deadlines detected',
      value: analytics.deadlinesDetected,
      icon: CalendarCheck,
      hint: 'Dates resolved from message text (7 days)',
    },
    {
      label: 'High priority',
      value: analytics.highPriorityEmails,
      icon: TrendingUp,
      hint: 'Critical or high priority (7 days)',
    },
    {
      label: 'Tasks created',
      value: analytics.tasksCreated,
      icon: ListChecks,
      hint: 'Suggested by the agent and saved',
    },
    {
      label: 'Avg processing',
      value: formatDuration(analytics.avgProcessingMs),
      icon: Clock,
      hint: 'Average analysis time per message',
    },
  ];

  return (
    <Card>
      <CardHeader title="Processing analytics" description="Real numbers from your analysed inbox." />
      <dl className="grid grid-cols-2 gap-3">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          return (
            <div key={metric.label} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3" title={metric.hint}>
              <dt className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-mist-500">
                <Icon className="h-3 w-3" aria-hidden="true" />
                {metric.label}
              </dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums text-mist-50">{metric.value}</dd>
            </div>
          );
        })}
      </dl>
    </Card>
  );
}
