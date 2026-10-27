"use client";

import { useEffect, useRef } from "react";

// Brand terracotta/clay + accent gold, plus white for contrast against both -
// no pink, deliberately (see the brand-color comment in globals.css).
const COLORS = ["#bc522f", "#dd9278", "#94a57c", "#788c5d", "#ffffff"];
const PARTICLE_COUNT = 46;
const DURATION_MS = 1500;
const GRAVITY = 0.12;

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  rotationSpeed: number;
  size: number;
  color: string;
  shape: "rect" | "circle";
};

/**
 * A short, contained confetti burst fired once behind the booking-
 * confirmation checkmark. Deliberately scoped to a small canvas centred on
 * the checkmark rather than the full viewport - a full-screen effect on a
 * payment confirmation reads as gimmicky, a contained one reads as a
 * considered detail. Renders nothing under prefers-reduced-motion: the
 * checkmark's own pop/draw-in is celebration enough without motion.
 */
export function ConfettiBurst({ size = 220 }: { size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    const center = size / 2;
    const particles: Particle[] = Array.from({ length: PARTICLE_COUNT }, () => {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.5 + Math.random() * 3.5;
      return {
        x: center,
        y: center,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1.5,
        rotation: Math.random() * 360,
        rotationSpeed: (Math.random() - 0.5) * 16,
        size: 4 + Math.random() * 4,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        shape: Math.random() > 0.5 ? "rect" : "circle",
      };
    });

    const start = performance.now();
    let frame: number;

    function tick(now: number) {
      const elapsed = now - start;
      const fade = 1 - Math.min(elapsed / DURATION_MS, 1);
      ctx!.clearRect(0, 0, size, size);

      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += GRAVITY;
        p.rotation += p.rotationSpeed;

        ctx!.save();
        ctx!.translate(p.x, p.y);
        ctx!.rotate((p.rotation * Math.PI) / 180);
        ctx!.globalAlpha = fade;
        ctx!.fillStyle = p.color;
        if (p.shape === "rect") {
          ctx!.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        } else {
          ctx!.beginPath();
          ctx!.arc(0, 0, p.size / 2, 0, Math.PI * 2);
          ctx!.fill();
        }
        ctx!.restore();
      }

      if (elapsed < DURATION_MS) frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [size]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: size, height: size }}
      className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
      aria-hidden
    />
  );
}
