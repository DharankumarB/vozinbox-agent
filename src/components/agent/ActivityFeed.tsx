import {
  Activity,
  AlertTriangle,
  BellRing,
  Brain,
  CalendarClock,
  CheckCircle2,
  GitBranch,
  ListChecks,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
  Tag,
  Zap,
} from 'lucide-react';
import type { AgentAction } from '@/lib/types/database';
import type { AgentActionType } from '@/lib/types/domain';
import { cn, relativeTime } from '@/lib/utils';

const ACTION_ICON: Record<AgentActionType, typeof Activity> = {
  EMAIL_RECEIVED: Activity,
  SOURCE_VALIDATED: ShieldAlert,
  EMAIL_ANALYZED: Brain,
  EMAIL_CLASSIFIED: Tag,
  ACTION_EXTRACTED: Zap,
  DEADLINE_DETECTED: CalendarClock,
  PRIORITY_DETECTED: AlertTriangle,
  DUPLICATE_CHECKED: Search,
  TASK_SUGGESTED: Sparkles,
  TASK_CREATED: ListChecks,
  TASK_UPDATED: ListChecks,
  TASK_DISMISSED: ListChecks,
  NOTIFICATION_CREATED: BellRing,
  THREAD_UPDATED: GitBranch,
  CHANGE_DETECTED: GitBranch,
  ANALYSIS_FAILED: AlertTriangle,
  GUARDRAIL_BLOCKED: ShieldAlert,
  TOOL_CALLED: Zap,
  TOOL_DENIED: ShieldAlert,
  SYNC_STARTED: RefreshCw,
  SYNC_COMPLETED: CheckCircle2,
  SYNC_FAILED: AlertTriangle,
};

/**
 * Agent activity timeline (§38, §53).
 * Renders exactly what the agent recorded — no synthesised steps.
 */
export function ActivityFeed({
  actions,
  compact = false,
  className,
}: {
  actions: AgentAction[];
  compact?: boolean;
  className?: string;
}) {
  if (actions.length === 0) {
    return (
      <p className={cn('text-xs text-mist-500', className)}>
        No agent activity yet. Once a message is analysed, every step will be listed here.
      </p>
    );
  }

  const items = compact ? actions.slice(0, 6) : actions;

  return (
    <ol className={cn('space-y-3.5', className)}>
      {items.map((action) => {
        const Icon = ACTION_ICON[action.action_type] ?? Activity;
        return (
          <li key={action.id} className="flex items-start gap-3">
            <span
              className={cn(
                'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border',
                action.severity === 'error'
                  ? 'border-critical/25 bg-critical/10 text-critical'
                  : action.severity === 'warning'
                    ? 'border-medium/25 bg-medium/10 text-medium'
                    : 'border-white/[0.08] bg-white/[0.04] text-violet-300',
              )}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <p className="text-[13px] font-medium text-mist-100">{action.title}</p>
                <time
                  dateTime={action.created_at}
                  className="shrink-0 text-[11px] text-mist-500"
                  title={new Date(action.created_at).toLocaleString()}
                >
                  {relativeTime(action.created_at)}
                </time>
              </div>
              {action.detail ? (
                <p className="mt-0.5 break-anywhere text-xs leading-relaxed text-mist-400">{action.detail}</p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
