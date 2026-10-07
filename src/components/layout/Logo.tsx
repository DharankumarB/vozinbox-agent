import Link from 'next/link';
import { cn } from '@/lib/utils';

export function Logo({ className, href = '/dashboard' }: { className?: string; href?: string }) {
  return (
    <Link
      href={href}
      className={cn('group inline-flex items-center gap-2.5', className)}
      aria-label="VozInbox Agent home"
    >
      <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-violet-400/25 bg-[#100b24] transition-colors group-hover:border-violet-400/50">
        <svg viewBox="0 0 64 64" fill="none" aria-hidden="true" className="h-8 w-8">
          <defs>
            <linearGradient id="vozinbox-envelope" x1="7" y1="20" x2="58" y2="51" gradientUnits="userSpaceOnUse">
              <stop stopColor="#D946EF" />
              <stop offset=".52" stopColor="#7C3AED" />
              <stop offset="1" stopColor="#2563EB" />
            </linearGradient>
            <linearGradient id="vozinbox-flap" x1="15" y1="15" x2="43" y2="41" gradientUnits="userSpaceOnUse">
              <stop stopColor="#F0ABFC" />
              <stop offset=".55" stopColor="#A855F7" />
              <stop offset="1" stopColor="#38BDF8" />
            </linearGradient>
            <linearGradient id="vozinbox-spark" x1="47" y1="4" x2="57" y2="16" gradientUnits="userSpaceOnUse">
              <stop stopColor="#FFF" />
              <stop offset="1" stopColor="#C4B5FD" />
            </linearGradient>
          </defs>
          <path
            d="M11 19h42a6 6 0 0 1 6 6v24a7 7 0 0 1-7 7H12a7 7 0 0 1-7-7V25a6 6 0 0 1 6-6Z"
            fill="#16102E"
            stroke="url(#vozinbox-envelope)"
            strokeWidth="2.5"
          />
          <path
            d="m7 23 22.8 19.2a3.5 3.5 0 0 0 4.5 0L57 23"
            stroke="url(#vozinbox-envelope)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M8 20h17c6 0 10 2.5 13 7l5 7-9.1 7.7a3.5 3.5 0 0 1-4.5 0L8 24v-4Z"
            fill="url(#vozinbox-flap)"
            fillOpacity=".95"
          />
          <path
            d="M8 20h17c6 0 10 2.5 13 7l5 7"
            stroke="#F5D0FE"
            strokeOpacity=".9"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <path d="M52 4c1.2 5.4 2.1 6.3 7 7.5-4.9 1.2-5.8 2.1-7 7.5-1.2-5.4-2.1-6.3-7-7.5 4.9-1.2 5.8-2.1 7-7.5Z" fill="url(#vozinbox-spark)" />
        </svg>
      </span>
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="text-[15px] font-semibold tracking-tight text-mist-50">
          Voz<span className="bg-gradient-to-r from-fuchsia-400 via-violet-400 to-blue-400 bg-clip-text text-transparent">Inbox</span>
        </span>
        <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-mist-500">Agent</span>
      </span>
    </Link>
  );
}
