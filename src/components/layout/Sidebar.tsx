'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Logo } from './Logo';
import { NAV_ITEMS } from './navigation';
import { AgentStatusPill, type AgentState } from '@/components/agent/AgentStatusPill';
import { cn } from '@/lib/utils';

/** Desktop navigation (§4). Hidden below `lg`, where MobileNav takes over. */
export function Sidebar({
  unread,
  tasks,
  notifications,
  displayName,
  planLabel,
  agentState,
}: {
  unread: number;
  tasks: number;
  notifications: number;
  displayName: string;
  planLabel: string;
  agentState: AgentState;
}) {
  const pathname = usePathname();
  const badges: Record<string, number> = {
    '/inbox': unread,
    '/tasks': tasks,
    '/notifications': notifications,
  };

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-white/[0.06] bg-ink-950/60 px-3 py-4 lg:flex">
      <div className="px-2">
        <Logo />
      </div>

      <nav aria-label="Main" className="mt-6 flex-1 space-y-0.5">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          const badge = badges[item.href] ?? 0;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              title={item.description}
              className={cn(
                'group flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-colors',
                active
                  ? 'bg-violet-500/[0.14] text-mist-50 ring-1 ring-inset ring-violet-400/20'
                  : 'text-mist-400 hover:bg-white/[0.04] hover:text-mist-100',
              )}
            >
              <Icon
                className={cn(
                  'h-4 w-4 shrink-0',
                  active ? 'text-violet-300' : 'text-mist-500 group-hover:text-mist-300',
                )}
                aria-hidden="true"
              />
              <span className="flex-1 truncate">{item.label}</span>
              {badge > 0 ? (
                <span
                  className={cn(
                    'min-w-5 rounded-full px-1.5 py-0.5 text-center text-[10px] font-semibold',
                    active ? 'bg-violet-500/25 text-violet-100' : 'bg-white/[0.07] text-mist-300',
                  )}
                >
                  {badge > 99 ? '99+' : badge}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      <div className="mt-4 space-y-3 border-t border-white/[0.06] px-1 pt-4">
        <AgentStatusPill state={agentState} />
        <div className="px-2">
          <p className="truncate text-xs font-medium text-mist-200">{displayName}</p>
          <p className="truncate text-[11px] text-mist-600">{planLabel}</p>
        </div>
      </div>
    </aside>
  );
}
