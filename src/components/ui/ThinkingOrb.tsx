// @ts-nocheck
import React, { useEffect, useRef } from 'react';

interface ThinkingOrbProps {
  status: 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking' | 'error';
  micLevel?: number; // 0-1 normalized microphone level
}

/**
 * Thinking orb for Jarvis v2.
 *
 * Idle state: static SVG constellation — 7 nodes connected by subtle lines.
 * Active state: Canvas-based particle system with nodes pulsing to mic level.
 * Respects prefers-reduced-motion: Canvas falls back to static SVG.
 */
const ThinkingOrb: React.FC<ThinkingOrbProps> = ({ status, micLevel = 0.5 }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const isActive =
    status === 'listening' ||
    status === 'transcribing' ||
    status === 'thinking' ||
    status === 'speaking';

  const isError = status === 'error';

  // Canvas animation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !isActive || prefersReducedMotion) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const size = 80;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    // Nodes in relative coordinates (0-1)
    const nodes = [
      { x: 0.5, y: 0.15 },
      { x: 0.78, y: 0.3 },
      { x: 0.78, y: 0.65 },
      { x: 0.5, y: 0.85 },
      { x: 0.22, y: 0.65 },
      { x: 0.22, y: 0.3 },
      { x: 0.5, y: 0.5 },
    ];

    const edges = [
      [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0],
      [0, 6], [1, 6], [2, 6], [3, 6], [4, 6], [5, 6],
    ];

    const particles: Array<{
      x: number; y: number; vx: number; vy: number; life: number; maxLife: number;
    }> = [];
    let time = 0;

    const animate = () => {
      time += 0.016;
      ctx.clearRect(0, 0, size, size);

      // Pulse based on mic level + time
      const pulse = isActive ? 0.6 + 0.4 * Math.sin(time * 2 + micLevel * 3) : 1;
      const glowPulse = 0.3 + 0.2 * Math.sin(time * 1.5);

      // Draw edges
      ctx.strokeStyle = isError
        ? `rgba(239, 68, 68, ${0.15 + glowPulse * 0.15})`
        : `rgba(212, 163, 115, ${0.1 + glowPulse * 0.15})`;
      ctx.lineWidth = 1;
      for (const [i, j] of edges) {
        ctx.beginPath();
        ctx.moveTo(nodes[i].x * size, nodes[i].y * size);
        ctx.lineTo(nodes[j].x * size, nodes[j].y * size);
        ctx.stroke();
      }

      // Draw nodes
      for (const node of nodes) {
        const radius = node === nodes[6]
          ? 3.5 + pulse * 1.5 // center node pulses more
          : 2 + pulse * 0.8;
        ctx.beginPath();
        ctx.arc(node.x * size, node.y * size, radius, 0, Math.PI * 2);
        ctx.fillStyle = isError
          ? `rgba(239, 68, 68, ${0.5 + pulse * 0.3})`
          : `rgba(212, 163, 115, ${0.5 + pulse * 0.3})`;
        ctx.fill();

        // Glow
        ctx.beginPath();
        ctx.arc(node.x * size, node.y * size, radius * 2.5, 0, Math.PI * 2);
        ctx.fillStyle = isError
          ? `rgba(239, 68, 68, ${0.08})`
          : `rgba(212, 163, 115, ${0.08})`;
        ctx.fill();
      }

      // Spawn occasional particles around center
      if (isActive && Math.random() < 0.3) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 0.3 + Math.random() * 0.5;
        particles.push({
          x: nodes[6].x * size,
          y: nodes[6].y * size,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 0,
          maxLife: 40 + Math.random() * 30,
        });
      }

      // Update and draw particles
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life++;
        const alpha = 1 - p.life / p.maxLife;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.2 * alpha, 0, Math.PI * 2);
        ctx.fillStyle = isError
          ? `rgba(239, 68, 68, ${alpha * 0.5})`
          : `rgba(212, 163, 115, ${alpha * 0.5})`;
        ctx.fill();
        if (p.life >= p.maxLife) particles.splice(i, 1);
      }

      animRef.current = requestAnimationFrame(animate);
    };

    animate();
    return () => cancelAnimationFrame(animRef.current);
  }, [isActive, isError, micLevel, prefersReducedMotion]);

  // Static SVG for idle or reduced-motion
  const orbColor = isError ? '#ef4444' : '#d4a373';
  const centerPulse = isActive ? 0.8 : 1;

  return (
    <div
      style={{
        width: 80,
        height: 80,
        position: 'relative',
        flexShrink: 0,
      }}
      role="status"
      aria-label={
        status === 'idle'
          ? 'Jarvis is idle'
          : status === 'listening'
          ? 'Jarvis is listening'
          : status === 'thinking'
          ? 'Jarvis is thinking'
          : status === 'error'
          ? 'Jarvis encountered an error'
          : `Jarvis is ${status}`
      }
    >
      {/* Canvas for active animation */}
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          display: isActive && !prefersReducedMotion ? 'block' : 'none',
        }}
      />

      {/* SVG for idle / reduced-motion fallback */}
      <svg
        viewBox="0 0 80 80"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          display: isActive && !prefersReducedMotion ? 'none' : 'block',
        }}
      >
        {/* Edges */}
        <line x1="40" y1="12" x2="62.4" y2="24" stroke={orbColor} strokeWidth="1" opacity={isActive ? 0.3 : 0.2} />
        <line x1="62.4" y1="24" x2="62.4" y2="52" stroke={orbColor} strokeWidth="1" opacity={isActive ? 0.3 : 0.2} />
        <line x1="62.4" y1="52" x2="40" y2="68" stroke={orbColor} strokeWidth="1" opacity={isActive ? 0.3 : 0.2} />
        <line x1="40" y1="68" x2="17.6" y2="52" stroke={orbColor} strokeWidth="1" opacity={isActive ? 0.3 : 0.2} />
        <line x1="17.6" y1="52" x2="17.6" y2="24" stroke={orbColor} strokeWidth="1" opacity={isActive ? 0.3 : 0.2} />
        <line x1="17.6" y1="24" x2="40" y2="12" stroke={orbColor} strokeWidth="1" opacity={isActive ? 0.3 : 0.2} />
        <line x1="40" y1="12" x2="40" y2="40" stroke={orbColor} strokeWidth="1" opacity={0.15} />
        <line x1="62.4" y1="24" x2="40" y2="40" stroke={orbColor} strokeWidth="1" opacity={0.15} />
        <line x1="62.4" y1="52" x2="40" y2="40" stroke={orbColor} strokeWidth="1" opacity={0.15} />
        <line x1="40" y1="68" x2="40" y2="40" stroke={orbColor} strokeWidth="1" opacity={0.15} />
        <line x1="17.6" y1="52" x2="40" y2="40" stroke={orbColor} strokeWidth="1" opacity={0.15} />
        <line x1="17.6" y1="24" x2="40" y2="40" stroke={orbColor} strokeWidth="1" opacity={0.15} />

        {/* Outer nodes */}
        {[{ x: 40, y: 12 }, { x: 62.4, y: 24 }, { x: 62.4, y: 52 }, { x: 40, y: 68 }, { x: 17.6, y: 52 }, { x: 17.6, y: 24 }].map((n, i) => (
          <circle key={i} cx={n.x} cy={n.y} r={isActive ? "3" : "2.2"} fill={orbColor} opacity={isActive ? 0.8 : 0.5} />
        ))}
        {/* Center node */}
        <circle cx="40" cy="40" r={isActive ? "4" : "3"} fill={orbColor} opacity={isActive ? 0.9 : 0.6} />
        <circle cx="40" cy="40" r={isActive ? "8" : "6"} fill={orbColor} opacity={isActive ? 0.1 : 0.06} />
      </svg>

      {/* Status ring around the orb */}
      {isActive && (
        <div
          style={{
            position: 'absolute',
            inset: -3,
            borderRadius: '50%',
            border: `2px solid ${
              isError
                ? '#ef4444'
                : status === 'listening'
                ? '#10b981'
                : status === 'thinking'
                ? '#d4a373'
                : status === 'speaking'
                ? '#3b82f6'
                : '#d4a373'
            }`,
            opacity: 0.4,
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  );
};

export default ThinkingOrb;
