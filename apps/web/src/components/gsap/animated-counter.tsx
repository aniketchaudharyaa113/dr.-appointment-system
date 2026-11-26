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

export function AnimatedCounter({
  value,
  duration = 1.8,
  prefix = '',
  suffix = '',
  className = '',
  formatter,
}: AnimatedCounterProps) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const [displayValue, setDisplayValue] = useState<number>(0);

  useGSAP(
    () => {
      if (isReducedMotion()) {
        setDisplayValue(value);
        return;
      }

      const obj = { count: 0 };

      const tween = gsap.to(obj, {
        count: value,
        duration,
        ease: 'power2.out',
        scrollTrigger: {
          trigger: containerRef.current,
          start: 'top 90%',
          once: true,
        },
        onUpdate: () => {
          setDisplayValue(Math.floor(obj.count));
        },
      });

      return () => {
        tween.kill();
      };
    },
    { scope: containerRef, dependencies: [value, duration] }
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
