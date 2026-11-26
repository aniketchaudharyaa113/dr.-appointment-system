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
 */
export function GsapReveal({
  children,
  direction = 'up',
  delay = 0,
  duration = 0.9,
  distance = 36,
  className = '',
  triggerOnce = true,
}: GsapRevealProps) {
  const elRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (isReducedMotion() || !elRef.current) return;

      let fromVars: gsap.TweenVars = {
        opacity: 0,
        ease: 'power3.out',
        duration,
        delay,
        scrollTrigger: {
          trigger: elRef.current,
          start: 'top 88%',
          once: triggerOnce,
        },
      };

      switch (direction) {
        case 'up':
          fromVars.y = distance;
          break;
        case 'down':
          fromVars.y = -distance;
          break;
        case 'left':
          fromVars.x = distance;
          break;
        case 'right':
          fromVars.x = -distance;
          break;
        case 'zoom':
          fromVars.scale = 0.85;
          break;
      }

      const tween = gsap.from(elRef.current, fromVars);

      return () => {
        tween.kill();
      };
    },
    { scope: elRef, dependencies: [direction, delay, duration, distance] }
  );

  return (
    <div ref={elRef} className={className}>
      {children}
    </div>
  );
}
