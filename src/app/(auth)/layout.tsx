import Link from 'next/link';
import type { ReactNode } from 'react';
import { Logo } from '@/components/layout/Logo';
import { ShieldCheck, Sparkles, Clock3 } from 'lucide-react';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main
      id="main"
      className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col items-center justify-center gap-6 px-4 py-8 sm:py-10 lg:flex-row lg:items-center lg:gap-16"
    >
      <section className="hidden w-full max-w-md lg:block lg:flex-1">
        <Logo href="/login" className="mb-8" />
        <h1 className="text-3xl font-semibold leading-tight text-mist-50 sm:text-4xl">
          Turn your inbox into
          <span className="block bg-gradient-to-r from-violet-300 to-electric-300 bg-clip-text text-transparent">
            actionable intelligence.
          </span>
        </h1>
        <p className="mt-4 max-w-md text-sm leading-relaxed text-mist-300">
          VozInbox reads your email, understands what it means, detects deadlines and actions, and
          suggests tasks. You stay in control of every decision.
        </p>

        <ul className="mt-8 space-y-3 text-sm text-mist-300">
          <li className="flex items-start gap-3">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-violet-300" aria-hidden="true" />
            <span>Understands intent — not just keywords — with confidence scores on every field.</span>
          </li>
          <li className="flex items-start gap-3">
            <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-electric-300" aria-hidden="true" />
            <span>Resolves “by Friday, 5 PM” against the email’s own timestamp and your timezone.</span>
          </li>
          <li className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-positive" aria-hidden="true" />
            <span>Never invents a date. If it is unclear, it says so instead of guessing.</span>
          </li>
        </ul>
      </section>

      <section className="w-full max-w-md lg:w-[420px]">{children}</section>

      <p className="text-center text-[11px] text-mist-600 lg:hidden">
        <Link href="/login" className="underline-offset-4 hover:underline">
          VozInbox Agent
        </Link>{' '}
        · read-only Gmail access · your data stays yours
      </p>
    </main>
  );
}
