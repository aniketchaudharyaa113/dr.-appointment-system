'use client';

import React, { useRef } from 'react';
import { gsap, isReducedMotion } from '@/lib/gsap';

interface GsapCardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  tiltMax?: number;
  scaleHover?: number;
  className?: string;
}

/**
 * 3D Interactive Tilt & Magnetic Card powered by GSAP.
 * Physics-smooth perspective transform tracking cursor movement.
 * Automatically disables if prefers-reduced-motion is active.
 */
export function GsapCard({
  children,
  tiltMax = 8,
  scaleHover = 1.02,
  className = '',
  ...props
}: GsapCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isReducedMotion() || !cardRef.current) return;

    const rect = cardRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const centerX = rect.width / 2;
    const centerY = rect.height / 2;

    const rotateX = ((y - centerY) / centerY) * -tiltMax;
    const rotateY = ((x - centerX) / centerX) * tiltMax;

    gsap.to(cardRef.current, {
      rotateX,
      rotateY,
      scale: scaleHover,
      transformPerspective: 900,
      ease: 'power1.out',
      duration: 0.35,
      overwrite: 'auto',
    });
  };

  const handleMouseLeave = () => {
    if (isReducedMotion() || !cardRef.current) return;

    gsap.to(cardRef.current, {
      rotateX: 0,
      rotateY: 0,
      scale: 1,
      ease: 'power2.out',
      duration: 0.6,
      overwrite: 'auto',
    });
  };

  return (
    <div
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className={`will-change-transform ${className}`}
      style={{ transformStyle: 'preserve-3d' }}
      {...props}
    >
      {children}
    </div>
  );
}
