import type { Metadata } from 'next';
import { PageHeader } from '@/components/layout/PageHeader';
import { parseSearchQuery, toInboxQueryInput } from '@/lib/search/query-parser';
import { zonedAnchor } from '@/lib/search/zones';
import { EmailCard } from '@/components/inbox/EmailCard';
import { InboxToolbar } from '@/components/inbox/InboxToolbar';
import { EmptyState } from '@/components/ui/States';
import { Button } from '@/components/ui/Button';
import { ConnectGmailButton } from '@/components/integrations/ConnectGmailButton';
import { Inbox } from 'lucide-react';
import Link from 'next/link';
import { requireAuthContext } from '@/lib/auth';
import { getStore } from '@/lib/store';
import { capabilityReport } from '@/lib/env';
import { INBOX_FILTERS, INBOX_SORTS, EMAIL_CATEGORIES, EMAIL_PRIORITIES, type InboxFilter, type InboxSort } from '@/lib/types/domain';

export const metadata: Metadata = { title: 'Inbox' };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 25;

export default async function InboxPage({
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

  const filterParam = pick('filter');
  const sortParam = pick('sort');
  const categoryParam = pick('category');
  const priorityParam = pick('priority');
  const query = pick('q');
  const offset = Math.max(0, Number.parseInt(pick('offset') ?? '0', 10) || 0);

  const filter: InboxFilter = INBOX_FILTERS.includes(filterParam as InboxFilter)
    ? (filterParam as InboxFilter)
    : 'ALL';
  const sort: InboxSort = INBOX_SORTS.includes(sortParam as InboxSort)
    ? (sortParam as InboxSort)
    : 'NEWEST';

  const accounts = await store.listAccounts(auth.id);
  const hasConnectedAccount = accounts.some((account) => account.status === 'CONNECTED');

  let page;
  let interpretation: string | null = null;

  if (query && query.trim().length > 0 && filter === 'ALL' && !categoryParam && !priorityParam) {
    // Natural-language search (§18) — the interpretation is shown to the user.
    const parsed = parseSearchQuery(query, zonedAnchor(auth.timezone));
    interpretation = parsed.interpretation;
    page = await store.listInbox(toInboxQueryInput(parsed, auth.id, { limit: PAGE_SIZE, offset }));
  } else {
    page = await store.listInbox({
      userId: auth.id,
      filter,
      sort,
      search: query,
      category: EMAIL_CATEGORIES.includes(categoryParam as (typeof EMAIL_CATEGORIES)[number])
        ? (categoryParam as (typeof EMAIL_CATEGORIES)[number])
        : null,
      priority: EMAIL_PRIORITIES.includes(priorityParam as (typeof EMAIL_PRIORITIES)[number])
        ? (priorityParam as (typeof EMAIL_PRIORITIES)[number])
        : null,
      limit: PAGE_SIZE,
      offset,
    });
  }

  const capabilities = capabilityReport();
  const params$ = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string') params$.set(key, value);
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5">
      <PageHeader
        title="Inbox"
        description="Every analysed message, with its category, priority, deadline and action."
      />

      {page.total === 0 && !hasConnectedAccount ? (
        <EmptyState
          icon={<Inbox className="h-5 w-5" aria-hidden="true" />}
          title="Your inbox intelligence starts here."
          description="Connect your email account to let VozInbox understand what needs your attention. Access is read-only and you can disconnect at any time."
          action={<ConnectGmailButton configured={capabilities.gmail === 'configured'} />}
        />
      ) : (
        <>
          <InboxToolbar total={page.total} interpretation={interpretation} />

          {page.items.length === 0 ? (
            <EmptyState
              icon={<Inbox className="h-5 w-5" aria-hidden="true" />}
              title="No messages match this view"
              description="Try a different filter or clear the search. Nothing here means nothing needs your attention in this slice."
              action={
                <Button variant="secondary" size="sm" asChild>
                  <Link href="/inbox">Clear filters</Link>
                </Button>
              }
            />
          ) : (
            <ul className="space-y-2.5">
              {page.items.map((item) => (
                <li key={item.email.id}>
                  <EmailCard item={item} timezone={auth.timezone} />
                </li>
              ))}
            </ul>
          )}

          {page.total > PAGE_SIZE ? (
            <nav className="flex items-center justify-between pt-2" aria-label="Pagination">
              <span className="text-xs text-mist-500">
                Showing {offset + 1}–{Math.min(offset + page.items.length, page.total)} of {page.total}
              </span>
              <div className="flex gap-2">
                {offset > 0 ? (
                  <Button variant="secondary" size="sm" asChild>
                    <Link
                      href={`/inbox?${(() => {
                        const next = new URLSearchParams(params$);
                        next.set('offset', String(Math.max(0, offset - PAGE_SIZE)));
                        return next.toString();
                      })()}`}
                    >
                      Previous
                    </Link>
                  </Button>
                ) : null}
                {page.hasMore ? (
                  <Button variant="secondary" size="sm" asChild>
                    <Link
                      href={`/inbox?${(() => {
                        const next = new URLSearchParams(params$);
                        next.set('offset', String(offset + PAGE_SIZE));
                        return next.toString();
                      })()}`}
                    >
                      Next
                    </Link>
                  </Button>
                ) : null}
              </div>
            </nav>
          ) : null}
        </>
      )}
    </div>
  );
}
