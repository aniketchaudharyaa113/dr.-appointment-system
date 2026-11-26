'use client';

import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Pause, Play } from 'lucide-react';

/**
 * Interactive 3D Medical Double-Helix & Cellular Telemetry Mesh using Three.js.
 * Respects `prefers-reduced-motion` and provides an accessible Pause/Play toggle (WCAG 2.2.2).
 */
export function MedicalHelixCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [webglReady, setWebglReady] = useState(true);
  const pausedRef = useRef(false);

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

    try {
      const width = container.clientWidth || 480;
      const height = container.clientHeight || 420;

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
      camera.position.set(0, 0, 11.5);

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

      // Lighting
      const ambient = new THREE.AmbientLight(0xffffff, 0.7);
      scene.add(ambient);

      const keyLight = new THREE.DirectionalLight(0x14b8a6, 2.2);
      keyLight.position.set(6, 8, 10);
      scene.add(keyLight);

      const rimLight = new THREE.DirectionalLight(0x38bdf8, 1.4);
      rimLight.position.set(-6, -4, 6);
      scene.add(rimLight);

      // Materials
      const tealMat = new THREE.MeshStandardMaterial({
        color: 0x0d9488,
        emissive: 0x0f766e,
        emissiveIntensity: 0.35,
        roughness: 0.25,
        metalness: 0.3,
      });

      const cyanMat = new THREE.MeshStandardMaterial({
        color: 0x06b6d4,
        emissive: 0x0e7490,
        emissiveIntensity: 0.35,
        roughness: 0.25,
        metalness: 0.3,
      });

      const rungMat = new THREE.MeshStandardMaterial({
        color: 0x99f6e4,
        roughness: 0.4,
        metalness: 0.1,
        transparent: true,
        opacity: 0.65,
      });

      const nodeGeo = new THREE.SphereGeometry(0.16, 16, 16);
      const rungGeo = new THREE.CylinderGeometry(0.03, 0.03, 1, 8);

      const turns = 26;
      const radius = 1.65;
      const verticalStep = 0.27;

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

      // Ambient cellular particles
      const particleCount = 70;
      const particleGeo = new THREE.BufferGeometry();
      const positions = new Float32Array(particleCount * 3);
      for (let i = 0; i < particleCount; i++) {
        positions[i * 3] = (Math.random() - 0.5) * 10;
        positions[i * 3 + 1] = (Math.random() - 0.5) * 9;
        positions[i * 3 + 2] = (Math.random() - 0.5) * 6;
      }
      particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const particleMat = new THREE.PointsMaterial({
        color: 0x2dd4bf,
        size: 0.08,
        transparent: true,
        opacity: 0.65,
      });
      const particles = new THREE.Points(particleGeo, particleMat);
      scene.add(particles);

      let targetMouseX = 0;
      let targetMouseY = 0;

      const onPointerMove = (e: PointerEvent) => {
        const rect = container.getBoundingClientRect();
        targetMouseX = ((e.clientX - rect.left) / rect.width - 0.5) * 0.5;
        targetMouseY = ((e.clientY - rect.top) / rect.height - 0.5) * 0.35;
      };
      container.addEventListener('pointermove', onPointerMove, { passive: true });

      const onResize = () => {
        if (!container || !renderer) return;
        const w = container.clientWidth || 480;
        const h = container.clientHeight || 420;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      };
      window.addEventListener('resize', onResize);

      // Render at least one frame even if reduced-motion is enabled
      renderer.render(scene, camera);

      const animate = () => {
        animationId = requestAnimationFrame(animate);
        if (!pausedRef.current && renderer) {
          helixGroup.rotation.y += 0.008;
          particles.rotation.y -= 0.002;
          helixGroup.rotation.x += (targetMouseY - helixGroup.rotation.x) * 0.05;
          camera.position.x += (targetMouseX * 1.2 - camera.position.x) * 0.05;
          camera.lookAt(0, 0, 0);
          renderer.render(scene, camera);
        }
      };
      animationId = requestAnimationFrame(animate);

      return () => {
        cancelAnimationFrame(animationId);
        container.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('resize', onResize);
        if (renderer && renderer.domElement.parentNode === container) {
          container.removeChild(renderer.domElement);
          renderer.dispose();
        }
      };
    } catch {
      setWebglReady(false);
    }
  }, []);

  const togglePause = () => {
    const next = !isPaused;
    pausedRef.current = next;
    setIsPaused(next);
  };

  return (
    <div className="relative w-full h-[340px] sm:h-[420px] rounded-3xl overflow-hidden bg-gradient-to-br from-teal-950/90 via-slate-900 to-cyan-950/80 border border-teal-500/20 shadow-2xl">
      {/* Subtle radial glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_45%,rgba(20,184,166,0.22),transparent_65%)]"
      />

      {webglReady ? (
        <div
          ref={containerRef}
          aria-hidden="true"
          className="w-full h-full cursor-grab active:cursor-grabbing"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-teal-300 text-xs font-medium">
          Interactive Clinical Telemetry Preview
        </div>
      )}

      {/* Floating telemetry HUD overlay */}
      <div className="pointer-events-none absolute top-4 left-4 flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-950/70 backdrop-blur-md border border-teal-500/30 text-[11px] font-semibold text-teal-300">
        <span className="h-2 w-2 rounded-full bg-emerald-400" />
        <span>Live Bio-Telemetry &amp; RAG Engine</span>
      </div>

      {/* Accessible Pause/Play control for persistent motion (WCAG 2.2.2) */}
      <button
        type="button"
        onClick={togglePause}
        aria-label={isPaused ? 'Play 3D molecular animation' : 'Pause 3D molecular animation'}
        className="absolute bottom-4 right-4 z-10 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-950/80 hover:bg-slate-900 text-slate-200 border border-slate-700/80 text-xs font-semibold backdrop-blur-md shadow-lg"
      >
        {isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
        <span>{isPaused ? 'Play 3D' : 'Pause 3D'}</span>
      </button>
    </div>
  );
}
