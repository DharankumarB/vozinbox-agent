import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthForm } from '@/components/layout/AuthForm';
import { getCurrentUser } from '@/lib/auth';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; oauthError?: string }>;
}) {
  const user = await getCurrentUser();
  if (user) redirect('/dashboard');
  const params = await searchParams;
  const next =
    params.next?.startsWith('/') && !params.next.startsWith('//') && !params.next.includes('\\')
      ? params.next
      : '/dashboard';

  return <AuthForm mode="login" nextPath={next} googleError={params.oauthError === 'google'} />;
}
