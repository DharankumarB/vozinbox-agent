'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Filter, Search, Sparkles, X } from 'lucide-react';
import { EmailCard } from '@/components/inbox/EmailCard';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/States';
import type { InboxItem } from '@/lib/types/database';
import type { EmailPriority, InboxSort } from '@/lib/types/domain';
import { EMAIL_CATEGORIES, CATEGORY_LABELS, SORT_LABELS } from '@/lib/types/domain';

const EXAMPLES = [
  'unread emails from my professor',
  'deadlines this week',
  'high priority invoices',
  'emails about my project',
  'anything needing action today',
];

const SORTS: InboxSort[] = [
  'NEWEST',
  'OLDEST',
  'HIGHEST_PRIORITY',
  'DEADLINE_SOONEST',
  'UNREAD_FIRST',
  'ACTION_REQUIRED_FIRST',
];
const PRIORITIES: EmailPriority[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

export function SearchExperience({
  items,
  total,
  hasMore,
  interpretation,
  timezone,
  usedQuery,
}: {
  items: InboxItem[];
  total: number;
  hasMore: boolean;
  interpretation: string | null;
  timezone: string;
  usedQuery: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(usedQuery);

  const category = params.get('category') ?? '';
  const priority = params.get('priority') ?? '';
  const sort = (params.get('sort') as InboxSort | null) ?? 'NEWEST';

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, entry] of Object.entries(patch)) {
      if (entry === null || entry === '') next.delete(key);
      else next.set(key, entry);
    }
    startTransition(() => router.push(`/search?${next.toString()}`));
  };

  const hasFilters = category !== '' || priority !== '' || sort !== 'NEWEST';

  return (
    <div className="space-y-4">
      <form
        className="panel flex items-center gap-2 p-2"
        onSubmit={(event) => {
          event.preventDefault();
          update({ q: value });
        }}
        role="search"
      >
        <Search className="ml-1.5 h-4 w-4 shrink-0 text-mist-500" aria-hidden="true" />
        <label className="sr-only" htmlFor="search-input">
          Search your inbox in plain language
        </label>
        <input
          id="search-input"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Search by sender, subject, category, priority, action or deadline…"
          className="min-w-0 flex-1 bg-transparent px-1 py-2 text-sm text-mist-100 outline-none placeholder:text-mist-600"
          autoComplete="off"
        />
        {value.length > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            aria-label="Clear search"
            onClick={() => {
              setValue('');
              update({ q: null });
            }}
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        ) : null}
        <Button type="submit" variant="primary" size="sm" loading={pending}>
          Search
        </Button>
      </form>

      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-mist-500">
          <Filter className="h-3 w-3" aria-hidden="true" />
          Narrow
        </span>

        <label className="sr-only" htmlFor="filter-category">
          Category
        </label>
        <select
          id="filter-category"
          className="field w-auto py-1.5 text-xs"
          value={category}
          onChange={(event) => update({ category: event.target.value })}
        >
          <option value="">All categories</option>
          {EMAIL_CATEGORIES.map((entry) => (
            <option key={entry} value={entry}>
              {CATEGORY_LABELS[entry]}
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor="filter-priority">
          Priority
        </label>
        <select
          id="filter-priority"
          className="field w-auto py-1.5 text-xs"
          value={priority}
          onChange={(event) => update({ priority: event.target.value })}
        >
          <option value="">Any priority</option>
          {PRIORITIES.map((entry) => (
            <option key={entry} value={entry}>
              {entry.charAt(0) + entry.slice(1).toLowerCase()}
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor="filter-sort">
          Sort
        </label>
        <select
          id="filter-sort"
          className="field w-auto py-1.5 text-xs"
          value={sort}
          onChange={(event) => update({ sort: event.target.value })}
        >
          {SORTS.map((entry) => (
            <option key={entry} value={entry}>
              {SORT_LABELS[entry]}
            </option>
          ))}
        </select>

        {hasFilters || value ? (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => {
              setValue('');
              startTransition(() => router.push('/search'));
            }}
          >
            Reset
          </Button>
        ) : null}

        {interpretation ? (
          <span className="chip ml-auto border-violet-400/25 bg-violet-500/10 text-violet-200">
            <Sparkles className="h-3 w-3" aria-hidden="true" />
            {interpretation}
          </span>
        ) : null}
      </div>

      {usedQuery.trim().length === 0 && !hasFilters ? (
        <div className="panel p-5">
          <h2 className="text-sm font-medium text-mist-100">Search the way you think</h2>
          <p className="mt-1 text-xs leading-relaxed text-mist-400">
            Describe what you are looking for and VozInbox translates it into filters over the analysis it
            already stored. Nothing is sent anywhere to make this work.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                className="chip chip-neutral hover:border-violet-400/30 hover:text-violet-100"
                onClick={() => {
                  setValue(example);
                  update({ q: example });
                }}
              >
                {example}
              </button>
            ))}
          </div>
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Search className="h-5 w-5" aria-hidden="true" />}
          title="No messages match that search"
          description="Try different words, or relax the filters. Searches only cover messages VozInbox has already read."
        />
      ) : (
        <>
          <p className="text-xs text-mist-500" role="status">
            {total} {total === 1 ? 'result' : 'results'}
            {usedQuery ? (
              <>
                {' '}
                for <span className="text-mist-300">“{usedQuery}”</span>
              </>
            ) : null}
          </p>
          <ul className="space-y-2.5">
            {items.map((item) => (
              <li key={item.email.id}>
                <EmailCard item={item} timezone={timezone} />
              </li>
            ))}
          </ul>
          {hasMore ? (
            <div className="flex justify-center pt-1">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  const offset = Number.parseInt(params.get('offset') ?? '0', 10) || 0;
                  update({ offset: String(offset + items.length) });
                }}
              >
                Load more results
              </Button>
            </div>
          ) : null}
        </>
      )}

      <p className="pt-2 text-[11px] text-mist-600">
        Looking for something else?{' '}
        <Link href="/inbox" className="text-violet-300 hover:text-violet-200">
          Browse the full inbox
        </Link>
        .
      </p>
    </div>
  );
}
