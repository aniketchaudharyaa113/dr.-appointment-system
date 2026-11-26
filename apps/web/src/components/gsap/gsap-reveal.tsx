'use client';

import React, { useRef } from 'react';
import { gsap, useGSAP, isReducedMotion } from '@/lib/gsap';

interface GsapRevealProps {
  children: React.ReactNode;
  direction?: 'up' | 'down' | 'left' | 'right' | 'zoom';
  delay?: number;
  duration?: number;
  distance?: number;
  className?: string;
  triggerOnce?: boolean;
}

/**
 * ScrollTrigger-backed entrance reveal with GSAP.
 * Guarantees final visible state (opacity: 1) and uses compositor-only transforms
 * so elements are never left hidden even if reduced-motion or StrictMode triggers.
 */
export function GsapReveal({
  children,
  direction = 'up',
  delay = 0,
  duration = 0.65,
  distance = 18,
  className = '',
  triggerOnce = true,
}: GsapRevealProps) {
  const elRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const el = elRef.current;
      if (!el || isReducedMotion()) return;

      const offsetProps: gsap.TweenVars = {};
      switch (direction) {
        case 'up':
          offsetProps.y = distance;
          break;
        case 'down':
          offsetProps.y = -distance;
          break;
        case 'left':
          offsetProps.x = distance;
          break;
        case 'right':
          offsetProps.x = -distance;
          break;
        case 'zoom':
          offsetProps.scale = 0.96;
          break;
      }

      const tween = gsap.fromTo(
        el,
        { ...offsetProps, opacity: 0.92 },
        {
          x: 0,
          y: 0,
          scale: 1,
          opacity: 1,
          ease: 'power3.out',
          duration,
          delay,
          clearProps: 'transform,opacity',
          scrollTrigger: {
            trigger: el,
            start: 'top 94%',
            once: triggerOnce,
          },
        },
      );

      return () => {
        tween.kill();
        if (el) {
          gsap.set(el, { clearProps: 'transform,opacity' });
        }
      };
    },
    { scope: elRef, dependencies: [direction, delay, duration, distance] },
  );

  return (
    <div ref={elRef} className={className}>
      {children}
    </div>
  );
}
