import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthForm } from '@/components/layout/AuthForm';
import { getCurrentUser } from '@/lib/auth';

export const metadata: Metadata = { title: 'Create account' };

export default async function SignupPage() {
  const user = await getCurrentUser();
  if (user) redirect('/dashboard');
  return <AuthForm mode="signup" />;
}
