import type { Metadata } from 'next';
import { AuthForm } from '@/components/layout/AuthForm';

export const metadata: Metadata = { title: 'Reset password' };

export default function ForgotPasswordPage() {
  return <AuthForm mode="reset" />;
}
