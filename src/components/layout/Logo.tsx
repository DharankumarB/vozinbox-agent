import Link from 'next/link';
import Image from 'next/image';
import logoImage from '@/app/VozInbox Neon Glass Logo.png';
import { cn } from '@/lib/utils';

export function Logo({
  className,
  href = '/dashboard',
  compact = false,
}: {
  className?: string;
  href?: string;
  compact?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn('group inline-flex shrink-0 items-center', className)}
      aria-label="VozInbox Agent home"
    >
      <Image
        src={logoImage}
        alt=""
        priority
        sizes={compact ? '72px' : '112px'}
        className={cn(
          'rounded-xl object-contain transition-transform group-hover:scale-[1.02]',
          compact ? 'h-[72px] w-[72px]' : 'h-28 w-28',
        )}
      />
    </Link>
  );
}
