'use client';

import React, { useRef } from 'react';
import { gsap, useGSAP, isReducedMotion } from '@/lib/gsap';

interface FloatingElementProps {
  children: React.ReactNode;
  yOffset?: number;
  xOffset?: number;
  duration?: number;
  delay?: number;
  className?: string;
}

/**
 * Continuous smooth sine-wave floating element with GSAP.
 */
export function FloatingElement({
  children,
  yOffset = 8,
  xOffset = 0,
  duration = 3.2,
  delay = 0,
  className = '',
}: FloatingElementProps) {
  const elementRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (isReducedMotion() || !elementRef.current) return;

      gsap.to(elementRef.current, {
        y: `-=${yOffset}`,
        x: xOffset !== 0 ? `+=${xOffset}` : undefined,
        duration,
        delay,
        ease: 'sine.inOut',
        repeat: -1,
        yoyo: true,
      });
    },
    { scope: elementRef, dependencies: [yOffset, xOffset, duration, delay] },
  );

  return (
    <div ref={elementRef} className={`will-change-transform ${className}`}>
      {children}
    </div>
  );
}
