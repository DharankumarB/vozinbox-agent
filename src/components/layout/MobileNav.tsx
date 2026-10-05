'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { NAV_ITEMS } from './navigation';
import { Logo } from './Logo';

/**
 * Mobile navigation (§39): a five-item bottom bar plus a sheet for the rest.
 */
export function MobileNav({ unreadNotifications }: { unreadNotifications: number }) {
  const pathname = usePathname();
  const [sheetOpen, setSheetOpen] = useState(false);

  const primary = NAV_ITEMS.filter((item) => item.primaryMobile).slice(0, 4);
  const secondary = NAV_ITEMS.filter((item) => !primary.includes(item));

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <>
      {sheetOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="More navigation">
          <div className="absolute inset-0 bg-ink-950/80 backdrop-blur-sm" onClick={() => setSheetOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 max-h-[75vh] overflow-y-auto rounded-t-2xl border-t border-white/[0.08] bg-ink-850 p-5 animate-fade-up">
            <div className="mb-4 flex items-center justify-between">
              <Logo />
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                className="rounded-lg p-2 text-mist-400 hover:bg-white/[0.05] hover:text-mist-100"
                aria-label="Close navigation"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <nav className="grid grid-cols-2 gap-2" aria-label="More navigation">
              {secondary.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setSheetOpen(false)}
                    className={cn(
                      'flex items-center gap-2.5 rounded-xl border p-3 text-sm',
                      isActive(item.href)
                        ? 'border-violet-400/25 bg-violet-500/10 text-mist-50'
                        : 'border-white/[0.07] bg-white/[0.02] text-mist-300',
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0 text-mist-400" aria-hidden="true" />
                    <span className="truncate">{item.label}</span>
                  </Link>
                );
              })}
            </nav>
          </div>
        </div>
      ) : null}

      <nav
        aria-label="Primary navigation"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-white/[0.07] bg-ink-900/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
      >
        <ul className="grid grid-cols-5">
          {primary.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex flex-col items-center gap-1 px-1 py-2.5 text-[10px] font-medium transition-colors',
                    active ? 'text-violet-300' : 'text-mist-500',
                  )}
                >
                  <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
                  <span className="truncate">{item.label}</span>
                </Link>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              onClick={() => setSheetOpen(true)}
              aria-label="More navigation options"
              className="relative flex w-full flex-col items-center gap-1 px-1 py-2.5 text-[10px] font-medium text-mist-500"
            >
              <Menu className="h-[18px] w-[18px]" aria-hidden="true" />
              <span>More</span>
              {unreadNotifications > 0 ? (
                <span className="absolute right-3 top-2 h-2 w-2 rounded-full bg-violet-400" aria-hidden="true" />
              ) : null}
            </button>
          </li>
        </ul>
      </nav>
    </>
  );
}
