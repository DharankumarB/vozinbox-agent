import { z } from 'zod';
import { intQuery, jsonOk, optionalQuery, withUser } from '@/lib/api';
import { getStore } from '@/lib/store';
import { INBOX_FILTERS, INBOX_SORTS, EMAIL_CATEGORIES, EMAIL_PRIORITIES } from '@/lib/types/domain';
import { parseSearchQuery, toInboxQueryInput } from '@/lib/search/query-parser';
import { zonedAnchor } from '@/lib/search/zones';

const filterSchema = z.enum(INBOX_FILTERS);
const sortSchema = z.enum(INBOX_SORTS);
const categorySchema = z.enum(EMAIL_CATEGORIES);
const prioritySchema = z.enum(EMAIL_PRIORITIES);

export const GET = withUser(async ({ auth, request }) => {
  const store = await getStore();
  const filter = optionalQuery(request, 'filter');
  const sort = optionalQuery(request, 'sort');
  const category = optionalQuery(request, 'category');
  const priority = optionalQuery(request, 'priority');
  const search = optionalQuery(request, 'q') ?? optionalQuery(request, 'search');
  const limit = intQuery(request, 'limit', 25);
  const offset = intQuery(request, 'offset', 0);
  const actionRequired = optionalQuery(request, 'actionRequired');
  const isRead = optionalQuery(request, 'isRead');
  const threadId = optionalQuery(request, 'threadId');
  const deadlineFrom = optionalQuery(request, 'deadlineFrom');
  const deadlineTo = optionalQuery(request, 'deadlineTo');

  if (search && search.trim().length > 0 && !filter && !category && !priority) {
    // Natural-language search: parse to structured filters and report the result.
    const parsed = parseSearchQuery(search, zonedAnchor(auth.timezone));
    const page = await store.listInbox(toInboxQueryInput(parsed, auth.id, { limit, offset }));
    return jsonOk({ ...page, search: { query: search, interpretation: parsed.interpretation } });
  }

  const page = await store.listInbox({
    userId: auth.id,
    filter: filter ? filterSchema.catch('ALL').parse(filter) : 'ALL',
    sort: sort ? sortSchema.catch('NEWEST').parse(sort) : 'NEWEST',
    search: search ?? null,
    category: category ? categorySchema.catch('OTHER').parse(category) : null,
    priority: priority ? prioritySchema.catch('NONE').parse(priority) : null,
    actionRequired: actionRequired === null ? null : actionRequired === 'true',
    isRead: isRead === null ? null : isRead === 'true',
    threadId,
    deadlineFrom,
    deadlineTo,
    limit,
    offset,
  });

  return jsonOk(page);
});

export const runtime = 'nodejs';
