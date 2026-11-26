'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { Pause, Play, Activity, ShieldCheck, HeartPulse } from 'lucide-react';

/**
 * Interactive 3D Medical Double-Helix & Cellular Telemetry Card using Three.js.
 * Respects `prefers-reduced-motion`, stops RAF completely when paused, disposes GPU
 * resources cleanly on unmount, and provides an accessible Pause/Play toggle (WCAG 2.2.2).
 */
export function MedicalHelixCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [webglReady, setWebglReady] = useState(true);
  const pausedRef = useRef(false);
  const startRafRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (mq.matches) {
      pausedRef.current = true;
      setIsPaused(true);
    }

    const container = containerRef.current;
    if (!container) return;

    let renderer: THREE.WebGLRenderer | null = null;
    let animationId = 0;
    let resizeObserver: ResizeObserver | null = null;

    let nodeGeo: THREE.SphereGeometry | null = null;
    let rungGeo: THREE.CylinderGeometry | null = null;
    let particleGeo: THREE.BufferGeometry | null = null;
    let tealMat: THREE.MeshStandardMaterial | null = null;
    let cyanMat: THREE.MeshStandardMaterial | null = null;
    let rungMat: THREE.MeshStandardMaterial | null = null;
    let particleMat: THREE.PointsMaterial | null = null;

    try {
      const width = container.clientWidth || 480;
      const height = container.clientHeight || 400;

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(44, width / height, 0.1, 100);
      camera.position.set(0, 0, 11.2);

      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance',
      });
      renderer.setSize(width, height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      container.appendChild(renderer.domElement);

      const helixGroup = new THREE.Group();
      helixGroup.rotation.z = Math.PI / 9;
      scene.add(helixGroup);

      const ambient = new THREE.AmbientLight(0xffffff, 0.75);
      scene.add(ambient);

      const keyLight = new THREE.DirectionalLight(0x2dd4bf, 2.3);
      keyLight.position.set(6, 8, 10);
      scene.add(keyLight);

      const rimLight = new THREE.DirectionalLight(0x38bdf8, 1.5);
      rimLight.position.set(-6, -4, 6);
      scene.add(rimLight);

      tealMat = new THREE.MeshStandardMaterial({
        color: 0x14b8a6,
        emissive: 0x0f766e,
        emissiveIntensity: 0.4,
        roughness: 0.22,
        metalness: 0.35,
      });

      cyanMat = new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        emissive: 0x0369a1,
        emissiveIntensity: 0.38,
        roughness: 0.22,
        metalness: 0.35,
      });

      rungMat = new THREE.MeshStandardMaterial({
        color: 0x99f6e4,
        roughness: 0.35,
        metalness: 0.15,
        transparent: true,
        opacity: 0.65,
      });

      nodeGeo = new THREE.SphereGeometry(0.15, 16, 16);
      rungGeo = new THREE.CylinderGeometry(0.028, 0.028, 1, 8);

      const turns = 26;
      const radius = 1.62;
      const verticalStep = 0.26;

      for (let i = 0; i < turns; i++) {
        const angle = i * 0.48;
        const y = (i - turns / 2) * verticalStep;

        const x1 = Math.cos(angle) * radius;
        const z1 = Math.sin(angle) * radius;
        const x2 = Math.cos(angle + Math.PI) * radius;
        const z2 = Math.sin(angle + Math.PI) * radius;

        const sphereA = new THREE.Mesh(nodeGeo, tealMat);
        sphereA.position.set(x1, y, z1);
        helixGroup.add(sphereA);

        const sphereB = new THREE.Mesh(nodeGeo, cyanMat);
        sphereB.position.set(x2, y, z2);
        helixGroup.add(sphereB);

        if (i % 2 === 0) {
          const rung = new THREE.Mesh(rungGeo, rungMat);
          rung.position.set(0, y, 0);
          rung.scale.set(1, radius * 2, 1);
          rung.rotation.z = Math.PI / 2;
          rung.rotation.y = -angle;
          helixGroup.add(rung);
        }
      }

      const particleCount = 64;
      particleGeo = new THREE.BufferGeometry();
      const positions = new Float32Array(particleCount * 3);
      for (let i = 0; i < particleCount; i++) {
        positions[i * 3] = (Math.random() - 0.5) * 9.5;
        positions[i * 3 + 1] = (Math.random() - 0.5) * 8.5;
        positions[i * 3 + 2] = (Math.random() - 0.5) * 5.5;
      }
      particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      particleMat = new THREE.PointsMaterial({
        color: 0x2dd4bf,
        size: 0.075,
        transparent: true,
        opacity: 0.6,
      });
      const particles = new THREE.Points(particleGeo, particleMat);
      scene.add(particles);

      let targetMouseX = 0;
      let targetMouseY = 0;

      const onPointerMove = (e: PointerEvent) => {
        const rect = container.getBoundingClientRect();
        targetMouseX = ((e.clientX - rect.left) / rect.width - 0.5) * 0.45;
        targetMouseY = ((e.clientY - rect.top) / rect.height - 0.5) * 0.3;
      };
      container.addEventListener('pointermove', onPointerMove, { passive: true });

      const handleResize = () => {
        if (!container || !renderer) return;
        const w = container.clientWidth || 480;
        const h = container.clientHeight || 400;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
        renderer.render(scene, camera);
      };

      resizeObserver = new ResizeObserver(handleResize);
      resizeObserver.observe(container);

      // Render static frame even when paused
      renderer.render(scene, camera);

      const animate = () => {
        if (pausedRef.current || !renderer) {
          animationId = 0;
          return;
        }
        helixGroup.rotation.y += 0.007;
        particles.rotation.y -= 0.0018;
        helixGroup.rotation.x += (targetMouseY - helixGroup.rotation.x) * 0.05;
        camera.position.x += (targetMouseX * 1.1 - camera.position.x) * 0.05;
        camera.lookAt(0, 0, 0);
        renderer.render(scene, camera);
        animationId = requestAnimationFrame(animate);
      };

      startRafRef.current = () => {
        if (!animationId && !pausedRef.current) {
          animationId = requestAnimationFrame(animate);
        }
      };

      if (!pausedRef.current) {
        animationId = requestAnimationFrame(animate);
      }

      return () => {
        startRafRef.current = null;
        if (animationId) cancelAnimationFrame(animationId);
        container.removeEventListener('pointermove', onPointerMove);
        resizeObserver?.disconnect();
        nodeGeo?.dispose();
        rungGeo?.dispose();
        particleGeo?.dispose();
        tealMat?.dispose();
        cyanMat?.dispose();
        rungMat?.dispose();
        particleMat?.dispose();
        if (renderer && renderer.domElement.parentNode === container) {
          container.removeChild(renderer.domElement);
          renderer.dispose();
        }
      };
    } catch {
      setWebglReady(false);
    }
  }, []);

  const togglePause = useCallback(() => {
    const next = !pausedRef.current;
    pausedRef.current = next;
    setIsPaused(next);
    if (!next) {
      startRafRef.current?.();
    }
  }, []);

  return (
    <div className="relative w-full h-[380px] sm:h-[440px] rounded-3xl overflow-hidden bg-gradient-to-br from-[#071521] via-[#0b1f2e] to-[#06101a] border border-slate-200/20 dark:border-teal-500/20 shadow-[0_24px_60px_-15px_rgba(13,148,136,0.28)] flex flex-col justify-between">
      {/* Radial depth glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_55%_45%,rgba(20,184,166,0.24),transparent_62%)]"
      />

      {/* Embedded Top Clinical HUD Bar */}
      <div className="relative z-10 flex items-center justify-between px-4 pt-4">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-950/75 backdrop-blur-md border border-teal-500/30 text-[11px] font-semibold text-teal-300">
          <span className="h-2 w-2 rounded-full bg-emerald-400" aria-hidden="true" />
          <span>Clinical Telemetry &amp; RAG Engine</span>
        </div>

        <button
          type="button"
          onClick={togglePause}
          aria-label={isPaused ? 'Play 3D molecular animation' : 'Pause 3D molecular animation'}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-950/75 hover:bg-slate-900 text-slate-200 border border-slate-700/70 text-[11px] font-semibold backdrop-blur-md shadow-sm transition-colors"
        >
          {isPaused ? <Play className="w-3 h-3" aria-hidden="true" /> : <Pause className="w-3 h-3" aria-hidden="true" />}
          <span>{isPaused ? 'Play 3D' : 'Pause 3D'}</span>
        </button>
      </div>

      {/* Interactive Three.js Viewport */}
      {webglReady ? (
        <div
          ref={containerRef}
          aria-hidden="true"
          className="absolute inset-0 w-full h-full cursor-grab active:cursor-grabbing"
        />
      ) : (
        <div className="flex-1 flex items-center justify-center text-teal-300 text-xs font-medium px-6 text-center">
          Interactive Clinical Telemetry Preview
        </div>
      )}

      {/* Embedded Bottom Telemetry Strip */}
      <div className="relative z-10 mx-4 mb-4 p-3 rounded-2xl bg-slate-950/75 backdrop-blur-md border border-white/10 grid grid-cols-3 gap-2 text-center">
        <div className="px-2">
          <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold flex items-center justify-center gap-1">
            <Activity className="w-3 h-3 text-teal-400" aria-hidden="true" />
            Uptime
          </p>
          <p className="font-mono text-xs sm:text-sm font-bold text-white tabular-nums mt-0.5">99.98%</p>
        </div>
        <div className="px-2 border-x border-white/10">
          <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold flex items-center justify-center gap-1">
            <HeartPulse className="w-3 h-3 text-rose-400" aria-hidden="true" />
            Vitals Sync
          </p>
          <p className="font-mono text-xs sm:text-sm font-bold text-emerald-400 tabular-nums mt-0.5">Live WebRTC</p>
        </div>
        <div className="px-2">
          <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold flex items-center justify-center gap-1">
            <ShieldCheck className="w-3 h-3 text-cyan-400" aria-hidden="true" />
            Hold Lock
          </p>
          <p className="font-mono text-xs sm:text-sm font-bold text-cyan-300 tabular-nums mt-0.5">Redis Atomic</p>
        </div>
      </div>
    </div>
  );
}
