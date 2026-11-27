import React from 'react';
import { cn } from '@/lib/utils';

interface BrandLogoProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'default' | 'light';
}

export function BrandLogo({
  className,
  size = 'md',
  variant = 'default',
}: BrandLogoProps) {
  const iconSize = size === 'sm' ? 'w-7 h-7' : size === 'lg' ? 'w-10 h-10' : 'w-8 h-8';
  const textSize = size === 'sm' ? 'text-base' : size === 'lg' ? 'text-xl' : 'text-lg';

  return (
    <span className={cn('inline-flex items-center gap-2.5 select-none', className)}>
      <span
        className={cn(
          'inline-flex items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-700 text-white shadow-sm shrink-0',
          iconSize,
        )}
        aria-hidden="true"
      >
        <svg viewBox="0 0 32 32" className="w-[62%] h-[62%]" fill="none">
          <path
            d="M16 3.5L26 7.5V15C26 21.3 21.7 26.6 16 28.5C10.3 26.6 6 21.3 6 15V7.5L16 3.5Z"
            fill="rgba(255,255,255,0.16)"
            stroke="#ffffff"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <path
            d="M9.5 16.2H13L14.8 11.5L17.3 20.2L19.1 16.2H22.5"
            stroke="#ffffff"
            strokeWidth="2.1"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span className={cn('font-display font-extrabold tracking-tight leading-none', textSize)}>
        <span className={variant === 'light' ? 'text-white' : 'text-[#132238] dark:text-white'}>
          Cura
        </span>
        <span className={variant === 'light' ? 'text-emerald-300' : 'text-emerald-600 dark:text-emerald-400'}>
          Bridge
        </span>
      </span>
    </span>
  );
}
