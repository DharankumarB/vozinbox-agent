import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthForm } from '@/components/layout/AuthForm';
import { getCurrentUser } from '@/lib/auth';

export const metadata: Metadata = { title: 'Create account' };

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ oauthError?: string }>;
}) {
  const user = await getCurrentUser();
  if (user) redirect('/dashboard');
  const params = await searchParams;
  return <AuthForm mode="signup" googleError={params.oauthError === 'google'} />;
}
