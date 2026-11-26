'use client';

import React, { useRef, useState } from 'react';
import { gsap, useGSAP, isReducedMotion } from '@/lib/gsap';

interface AnimatedCounterProps {
  value: number;
  duration?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
  formatter?: (val: number) => string;
}

/**
 * Renders the exact target metric immediately (never stuck at 0),
 * and smoothly counts up when scrolled into view if motion is enabled.
 */
export function AnimatedCounter({
  value,
  duration = 1.4,
  prefix = '',
  suffix = '',
  className = '',
  formatter,
}: AnimatedCounterProps) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const [displayValue, setDisplayValue] = useState<number>(value);

  useGSAP(
    () => {
      if (isReducedMotion() || !containerRef.current) {
        setDisplayValue(value);
        return;
      }

      const startVal = Math.max(0, Math.floor(value * 0.45));
      const obj = { count: startVal };

      const tween = gsap.to(obj, {
        count: value,
        duration,
        ease: 'power2.out',
        scrollTrigger: {
          trigger: containerRef.current,
          start: 'top 95%',
          once: true,
        },
        onUpdate: () => {
          setDisplayValue(Math.round(obj.count));
        },
        onComplete: () => {
          setDisplayValue(value);
        },
      });

      return () => {
        tween.kill();
        setDisplayValue(value);
      };
    },
    { scope: containerRef, dependencies: [value, duration] },
  );

  const formatted = formatter
    ? formatter(displayValue)
    : displayValue.toLocaleString('en-IN');

  return (
    <span ref={containerRef} className={className} aria-label={`${prefix}${value}${suffix}`}>
      {prefix}
      {formatted}
      {suffix}
    </span>
  );
}
