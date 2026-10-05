import type { Metadata } from 'next';
import { Suspense } from 'react';
import { requireAuthContext } from '@/lib/auth';
import { getStore } from '@/lib/store';
import { parseSearchQuery, toInboxQueryInput } from '@/lib/search/query-parser';
import { zonedAnchor } from '@/lib/search/zones';
import { PageHeader } from '@/components/layout/PageHeader';
import { SearchExperience } from '@/components/search/SearchExperience';
import { LoadingState } from '@/components/ui/States';
import { EMAIL_CATEGORIES, EMAIL_PRIORITIES, INBOX_SORTS } from '@/lib/types/domain';
import type { EmailCategory, EmailPriority, InboxSort } from '@/lib/types/domain';

export const metadata: Metadata = { title: 'Search' };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 25;

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireAuthContext();
  const store = await getStore();
  const params = await searchParams;

  const pick = (key: string): string | null => {
    const value = params[key];
    if (Array.isArray(value)) return value[0] ?? null;
    return value ?? null;
  };

  const query = pick('q') ?? '';
  const categoryParam = pick('category');
  const priorityParam = pick('priority');
  const sortParam = pick('sort');
  const offset = Math.max(0, Number.parseInt(pick('offset') ?? '0', 10) || 0);

  const category = EMAIL_CATEGORIES.includes(categoryParam as EmailCategory)
    ? (categoryParam as EmailCategory)
    : null;
  const priority = EMAIL_PRIORITIES.includes(priorityParam as EmailPriority)
    ? (priorityParam as EmailPriority)
    : null;
  const sort = INBOX_SORTS.includes(sortParam as InboxSort) ? (sortParam as InboxSort) : null;

  const parsed = parseSearchQuery(query, zonedAnchor(auth.timezone));

  const page = await store.listInbox({
    ...toInboxQueryInput(parsed, auth.id, { limit: PAGE_SIZE, offset }),
    category: category ?? parsed.category,
    priority: priority ?? parsed.priority,
    sort: sort ?? parsed.sort,
  });

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5">
      <PageHeader
        title="Search"
        description="Find any message by sender, subject, category, priority, action or deadline."
      />
      <Suspense fallback={<LoadingState label="Loading search…" />}>
        <SearchExperience
          items={page.items}
          total={page.total}
          hasMore={page.hasMore}
          interpretation={parsed.interpretation}
          timezone={auth.timezone}
          usedQuery={query}
        />
      </Suspense>
    </div>
  );
}
