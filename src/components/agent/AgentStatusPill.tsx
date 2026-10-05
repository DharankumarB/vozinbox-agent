import { AlertTriangle, Brain, CheckCircle2, Loader2, PlugZap, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

export type AgentState = 'IDLE' | 'ANALYSING' | 'NEEDS_REVIEW' | 'ERROR' | 'NO_INTEGRATION' | 'SYNCING';

const STATE_META: Record<AgentState, { label: string; description: string; className: string; icon: typeof Brain }> = {
  IDLE: {
    label: 'AI ready',
    description: 'Ready to analyse new email.',
    className: 'border-positive/25 bg-positive/[0.08] text-positive',
    icon: CheckCircle2,
  },
  ANALYSING: {
    label: 'AI analysing…',
    description: 'Analysing your inbox right now.',
    className: 'border-violet-400/30 bg-violet-500/10 text-violet-200',
    icon: Loader2,
  },
  SYNCING: {
    label: 'Syncing…',
    description: 'Fetching new messages from your provider.',
    className: 'border-electric-400/30 bg-electric-500/10 text-electric-300',
    icon: RefreshCw,
  },
  NEEDS_REVIEW: {
    label: 'AI needs review',
    description: 'Some analyses need your confirmation.',
    className: 'border-medium/30 bg-medium/10 text-medium',
    icon: AlertTriangle,
  },
  ERROR: {
    label: 'Analysis error',
    description: 'The last processing run failed.',
    className: 'border-critical/30 bg-critical/10 text-critical',
    icon: AlertTriangle,
  },
  NO_INTEGRATION: {
    label: 'No inbox connected',
    description: 'Connect a mailbox to start analysing.',
    className: 'border-white/[0.1] bg-white/[0.04] text-mist-300',
    icon: PlugZap,
  },
};

export function AgentStatusPill({ state, className }: { state: AgentState; className?: string }) {
  const meta = STATE_META[state];
  const Icon = meta.icon;
  const spinning = state === 'ANALYSING' || state === 'SYNCING';

  return (
    <div className={cn('flex items-center gap-2.5 rounded-xl border px-3 py-2.5', meta.className, className)}>
      <Icon className={cn('h-4 w-4 shrink-0', spinning && 'animate-spin')} aria-hidden="true" />
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold">{meta.label}</p>
        <p className="truncate text-[11px] opacity-80">{meta.description}</p>
      </div>
    </div>
  );
}

export { STATE_META };
