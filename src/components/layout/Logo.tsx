import Link from 'next/link';
import { MailCheck } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Logo({ className, href = '/dashboard' }: { className?: string; href?: string }) {
  return (
    <Link
      href={href}
      className={cn('group inline-flex items-center gap-2.5', className)}
      aria-label="VozInbox Agent home"
    >
      <span className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-violet-400/25 bg-violet-500/12 text-violet-200 transition-colors group-hover:border-violet-400/40">
        <MailCheck className="h-[18px] w-[18px]" aria-hidden="true" />
      </span>
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="text-[15px] font-semibold tracking-tight text-mist-50">VozInbox</span>
        <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-mist-500">Agent</span>
      </span>
    </Link>
  );
}
