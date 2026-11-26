'use client';

import React, { useState, useEffect } from 'react';
import { formatIstDateTime, formatIstTime } from '@/lib/api';

interface ClientTimeProps {
  datetime: string | Date;
  mode?: 'datetime' | 'time' | 'date';
  className?: string;
  fallback?: string;
  suffix?: string;
}

export function ClientTime({
  datetime,
  mode = 'datetime',
  className,
  fallback = '—',
  suffix = '',
}: ClientTimeProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!datetime) return <span className={className}>{fallback}</span>;

  const iso = typeof datetime === 'string' ? datetime : datetime.toISOString();

  if (!mounted) {
    return (
      <span className={className} suppressHydrationWarning>
        {fallback}
      </span>
    );
  }

  let formatted = iso;
  if (mode === 'time') {
    formatted = formatIstTime(iso);
  } else {
    formatted = formatIstDateTime(iso);
  }

  return (
    <span className={className} suppressHydrationWarning>
      {formatted}
      {suffix}
    </span>
  );
}
