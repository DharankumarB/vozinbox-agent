import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { publicEnv } from '@/lib/env';

/**
 * Refreshes the Supabase auth session on every matched request.
 *
 * Two details that matter and are easy to get wrong:
 *  1. Always return the `supabaseResponse` object that `setAll` built — an
 *     earlier response would lose the refreshed cookies and sign the user out.
 *  2. Claims are read via `getClaims()`, which verifies the JWT, rather than
 *     `getSession()`, which merely decodes the cookie.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const { supabaseUrl, supabaseAnonKey } = publicEnv();
  if (!supabaseUrl || !supabaseAnonKey) {
    // Local mode: session cookies are handled by the app's own auth layer.
    return response;
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options?: Record<string, unknown> }>) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  try {
    await supabase.auth.getClaims();
  } catch {
    // A failed refresh must not break the request; the page-level guard will
    // redirect to /login because no valid claims are present.
  }

  return response;
}
