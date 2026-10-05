'use client';

import { useId } from 'react';
import { cn } from '@/lib/utils';

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <label htmlFor={id} className="cursor-pointer text-sm font-medium text-mist-100">
          {label}
        </label>
        {description ? <p className="mt-0.5 text-xs text-mist-400">{description}</p> : null}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative mt-0.5 h-5.5 w-10 shrink-0 rounded-full border transition-colors duration-200',
          checked ? 'border-violet-400/50 bg-violet-500/80' : 'border-white/[0.12] bg-white/[0.06]',
          disabled && 'opacity-50',
        )}
        style={{ height: '22px' }}
      >
        <span
          className={cn(
            'absolute top-[2px] h-[16px] w-[16px] rounded-full bg-white shadow transition-all duration-200',
            checked ? 'left-[20px]' : 'left-[2px]',
          )}
        />
      </button>
    </div>
  );
}
