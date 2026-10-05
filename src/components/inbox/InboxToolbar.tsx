'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { INBOX_FILTERS, SORT_LABELS, INBOX_SORTS, type InboxFilter, type InboxSort } from '@/lib/types/domain';
import { CATEGORY_LABELS } from '@/lib/types/domain';
import { cn } from '@/lib/utils';

const FILTER_LABELS: Record<InboxFilter, string> = {
  ALL: 'All',
  UNREAD: 'Unread',
  ACTION_REQUIRED: 'Action required',
  HIGH_PRIORITY: 'High priority',
  DEADLINES: 'Deadlines',
  ASSIGNMENT: CATEGORY_LABELS.ASSIGNMENT,
  MEETING: CATEGORY_LABELS.MEETING,
  PROJECT: CATEGORY_LABELS.PROJECT,
  PERSONAL: CATEGORY_LABELS.PERSONAL,
  INFORMATION: CATEGORY_LABELS.INFORMATION,
  PROMOTIONAL: CATEGORY_LABELS.PROMOTIONAL,
  SPAM: CATEGORY_LABELS.SPAM,
};

/**
 * Inbox filters and sorting (§47, §48).
 * State lives in the URL so views are shareable and back/forward works.
 */
export function InboxToolbar({ total, interpretation }: { total: number; interpretation?: string | null }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [searchValue, setSearchValue] = useState(searchParams.get('q') ?? '');

  const activeFilter = (searchParams.get('filter') as InboxFilter | null) ?? 'ALL';
  const activeSort = (searchParams.get('sort') as InboxSort | null) ?? 'NEWEST';

  useEffect(() => {
    setSearchValue(searchParams.get('q') ?? '');
  }, [searchParams]);

  const update = (changes: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === '') params.delete(key);
      else params.set(key, value);
    }
    params.delete('offset');
    startTransition(() => router.push(`/inbox?${params.toString()}`));
  };

  return (
    <div className="space-y-3">
      <form
        className="relative"
        onSubmit={(event) => {
          event.preventDefault();
          update({ q: searchValue.trim() || null });
        }}
        role="search"
      >
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-mist-500" aria-hidden="true" />
        <input
          type="search"
          value={searchValue}
          onChange={(event) => setSearchValue(event.target.value)}
          placeholder="Search sender, subject, content — or try “deadlines this week”"
          className="field pl-9 pr-24"
          aria-label="Search emails"
        />
        <span className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
          {searchValue ? (
            <button
              type="button"
              onClick={() => {
                setSearchValue('');
                update({ q: null });
              }}
              className="rounded-lg p-1.5 text-mist-500 hover:bg-white/[0.06] hover:text-mist-200"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          ) : null}
          <button type="submit" className="btn btn-secondary btn-xs" disabled={pending}>
            Search
          </button>
        </span>
      </form>

      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-mist-500">
          <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
          Filter
        </span>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Inbox filters">
          {INBOX_FILTERS.map((filter) => (
            <button
              key={filter}
              type="button"
              onClick={() => update({ filter: filter === 'ALL' ? null : filter })}
              aria-pressed={activeFilter === filter}
              className={cn(
                'chip transition-colors',
                activeFilter === filter
                  ? 'border-violet-400/35 bg-violet-500/15 text-violet-100'
                  : 'chip-neutral hover:border-white/[0.14] hover:text-mist-100',
              )}
            >
              {FILTER_LABELS[filter]}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-[11px] text-mist-500">
            {total} {total === 1 ? 'message' : 'messages'}
          </span>
          <label className="sr-only" htmlFor="inbox-sort">
            Sort emails
          </label>
          <select
            id="inbox-sort"
            value={activeSort}
            onChange={(event) => update({ sort: event.target.value })}
            className="field w-auto py-1.5 text-xs"
          >
            {INBOX_SORTS.map((sort) => (
              <option key={sort} value={sort}>
                {SORT_LABELS[sort]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {interpretation ? (
        <p className="rounded-xl border border-violet-400/20 bg-violet-500/[0.07] px-3 py-2 text-[11px] text-violet-100">
          {interpretation}
        </p>
      ) : null}
    </div>
  );
}
