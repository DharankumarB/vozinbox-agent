import 'server-only';

import type { Store, DashboardCounters, DailyAnalytics, AgentHealth, DeadlineItem } from '@/lib/store/types';
import type { AgentAction, AppNotification } from '@/lib/types/database';

/**
 * Dashboard composition (§6, §56).
 *
 * Every number comes from the database. There is no placeholder, no sample data
 * and no fabricated figure — an account with no inbox renders an empty state.
 */

export interface DashboardData {
  counters: DashboardCounters;
  deadlines: DeadlineItem[];
  recentEmails: Awaited<ReturnType<Store['listInbox']>>['items'];
  attention: Awaited<ReturnType<Store['listInbox']>>['items'];
  activity: AgentAction[];
  notifications: AppNotification[];
  analytics: DailyAnalytics[];
  health: AgentHealth[];
  hasAnyEmail: boolean;
  hasConnectedAccount: boolean;
}

export async function loadDashboard(input: {
  store: Store;
  userId: string;
  limit?: number;
}): Promise<DashboardData> {
  const { store, userId } = input;
  const limit = input.limit ?? 6;

  const [
    counters,
    deadlines,
    recentEmails,
    attention,
    activity,
    notifications,
    analytics,
    health,
    accounts,
  ] = await Promise.all([
    store.dashboardCounters(userId),
    store.getUpcomingDeadlines(userId, 14, 5),
    store.listInbox({ userId, limit, sort: 'NEWEST' }),
    store.listInbox({ userId, limit: limit + 2, sort: 'ACTION_REQUIRED_FIRST' }),
    store.listAgentActions(userId, { limit: 8 }),
    store.listNotifications(userId, { unreadOnly: true, limit: 5 }),
    store.dailyAnalytics(userId, 7),
    store.agentHealth(userId, 7),
    store.listAccounts(userId),
  ]);

  const actionable = attention.items.filter(
    (item) => item.analysis?.action_required || item.analysis?.priority === 'HIGH' || item.analysis?.priority === 'CRITICAL',
  );

  return {
    counters,
    deadlines,
    recentEmails: recentEmails.items,
    attention: actionable.slice(0, limit),
    activity,
    notifications,
    analytics,
    health,
    hasAnyEmail: counters.totalEmails > 0,
    hasConnectedAccount: accounts.some((account) => account.status === 'CONNECTED'),
  };
}

export interface AnalyticsSummary {
  emailsAnalyzedToday: number;
  actionableEmails: number;
  tasksCreated: number;
  deadlinesDetected: number;
  highPriorityEmails: number;
  avgProcessingMs: number | null;
  tasksCompleted: number;
  weeklyTrend: DailyAnalytics[];
  health: AgentHealth[];
}

export async function loadAnalytics(input: {
  store: Store;
  userId: string;
  days?: number;
}): Promise<AnalyticsSummary> {
  const { store, userId } = input;
  const days = input.days ?? 7;

  const [analytics, health, tasks] = await Promise.all([
    store.dailyAnalytics(userId, days),
    store.agentHealth(userId, days),
    store.listTasks({ userId, status: 'ALL', limit: 200 }),
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const todayBucket = analytics.find((entry) => entry.day === today);

  const durations = health.map((entry) => entry.avgDurationMs).filter((value): value is number => value !== null);
  const avgProcessingMs =
    durations.length > 0 ? Math.round(durations.reduce((total, value) => total + value, 0) / durations.length) : null;

  const weeklyTotals = analytics.reduce(
    (totals, entry) => ({
      emailsAnalyzed: totals.emailsAnalyzed + entry.emailsAnalyzed,
      actionable: totals.actionable + entry.actionableEmails,
      deadlines: totals.deadlines + entry.deadlinesDetected,
      highPriority: totals.highPriority + entry.highPriorityEmails,
    }),
    { emailsAnalyzed: 0, actionable: 0, deadlines: 0, highPriority: 0 },
  );

  return {
    emailsAnalyzedToday: todayBucket?.emailsAnalyzed ?? 0,
    actionableEmails: weeklyTotals.actionable,
    tasksCreated: tasks.items.filter((item) => item.task.origin === 'AI_SUGGESTED').length,
    deadlinesDetected: weeklyTotals.deadlines,
    highPriorityEmails: weeklyTotals.highPriority,
    avgProcessingMs,
    tasksCompleted: tasks.items.filter((item) => item.task.status === 'COMPLETED').length,
    weeklyTrend: analytics,
    health,
  };
}

export { type DashboardCounters };
