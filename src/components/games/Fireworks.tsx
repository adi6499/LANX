// LANX 3.12.0: fireworks when someone wins. Rockets rise from the bottom and burst into
// sparks that fall and fade, for a few seconds over the game, with a winner banner. Drawn on
// one canvas that clicks go straight through; nothing keeps running once it is over. Lighter
// on 4 GB PCs and Linux (fewer sparks), and only the banner for people who asked for less motion.
import { useEffect, useRef, useState } from "react";
import * as games from "../../lib/games";
import type { Match } from "../../lib/games";
import { sfx } from "../../lib/gameSounds";

const COLOURS = ["#ff4d6d", "#ffd166", "#06d6a0", "#4cc9f0", "#c77dff", "#ff8c42", "#ffffff"];
const RUN_MS = 5200;

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  colour: string;
  size: number;
}
interface Rocket {
  x: number;
  y: number;
  vy: number;
  vx: number;
  burstAt: number;
  colour: string;
}

const lessMotion = () => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.classList.contains("lanx-still");
  } catch {
    return false;
  }
};
const light = () => document.documentElement.classList.contains("lanx-lite") || document.documentElement.classList.contains("lanx-linux");

/** Runs the fireworks on `canvas` until `until`; returns a stop function. */
export function launchFireworks(canvas: HTMLCanvasElement, until = RUN_MS): () => void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return () => {};
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const fit = () => {
    const r = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
  };
  fit();
  const W = () => canvas.width / dpr;
  const H = () => canvas.height / dpr;
  const sparksPerBurst = light() ? 46 : 90;
  const rockets: Rocket[] = [];
  const sparks: Spark[] = [];
  const t0 = performance.now();
  let last = t0;
  let nextLaunch = t0;
  let raf = 0;
  const launch = () => {
    const w = W(), h = H();
    rockets.push({
      x: w * (0.15 + Math.random() * 0.7),
      y: h + 6,
      vx: (Math.random() - 0.5) * 60,
      vy: -(h * (0.95 + Math.random() * 0.35)),
      burstAt: h * (0.18 + Math.random() * 0.32),
      colour: COLOURS[Math.floor(Math.random() * COLOURS.length)],
    });
  };
  const burst = (r: Rocket) => {
    const two = Math.random() < 0.35 ? COLOURS[Math.floor(Math.random() * COLOURS.length)] : r.colour;
    for (let i = 0; i < sparksPerBurst; i++) {
      const a = (i / sparksPerBurst) * Math.PI * 2 + Math.random() * 0.2;
      const speed = 110 + Math.random() * 170;
      sparks.push({ x: r.x, y: r.y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, life: 0, max: 0.9 + Math.random() * 0.8, colour: i % 3 === 0 ? two : r.colour, size: 1.4 + Math.random() * 1.6 });
    }
    sfx("pop", 0.25);
  };
  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const running = now - t0 < until;
    if (running && now >= nextLaunch) {
      launch();
      if (Math.random() < 0.4) launch();
      nextLaunch = now + 380 + Math.random() * 420;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Trails: what was drawn fades out instead of being wiped.
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    ctx.fillRect(0, 0, W(), H());
    ctx.globalCompositeOperation = "lighter";
    for (let i = rockets.length - 1; i >= 0; i--) {
      const r = rockets[i];
      r.vy += 240 * dt;
      r.x += r.vx * dt;
      r.y += r.vy * dt;
      ctx.fillStyle = r.colour;
      ctx.beginPath();
      ctx.arc(r.x, r.y, 2.2, 0, Math.PI * 2);
      ctx.fill();
      if (r.y <= r.burstAt || r.vy >= 0) {
        burst(r);
        rockets.splice(i, 1);
      }
    }
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.life += dt;
      if (s.life >= s.max) {
        sparks.splice(i, 1);
        continue;
      }
      s.vx *= 1 - 1.4 * dt;
      s.vy = s.vy * (1 - 1.4 * dt) + 150 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      ctx.globalAlpha = Math.max(0, 1 - s.life / s.max);
      ctx.fillStyle = s.colour;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (running || rockets.length || sparks.length) raf = requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, W(), H());
  };
  raf = requestAnimationFrame(frame);
  return () => {
    cancelAnimationFrame(raf);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };
}

/** Over a match: when it ends with a winner (as it happens, not when an old game is opened),
 *  fireworks and a banner saying who won. */
export function WinCelebration({ match: m }: { match: Match }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const was = useRef(m.status);
  const [banner, setBanner] = useState<string | null>(null);
  const [night, setNight] = useState(false);
  const won = m.status === "over" && !!m.result && !m.result.draw && m.result.winner !== null;
  useEffect(() => {
    const before = was.current;
    was.current = m.status;
    if (!won || before !== "playing") return;
    const text = games.resultText(m);
    setBanner(text);
    const moving = !lessMotion() && !!canvas.current;
    // A night sky for the fireworks (they don't show on a light board), fading back after.
    setNight(moving);
    const dawn = window.setTimeout(() => setNight(false), RUN_MS);
    const hide = window.setTimeout(() => setBanner(null), RUN_MS + 1200);
    const stop = moving && canvas.current ? launchFireworks(canvas.current) : () => {};
    return () => {
      window.clearTimeout(dawn);
      window.clearTimeout(hide);
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.status, won]);
  return (
    <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden rounded-[18px]" data-game-fireworks={banner ? "on" : undefined}>
      <div className={`absolute inset-0 bg-[#0b1026] transition-opacity duration-700 ${night ? "opacity-60" : "opacity-0"}`} />
      <canvas ref={canvas} className="absolute inset-0 h-full w-full" />
      {banner && (
        <div className="absolute inset-x-0 top-[18%] flex justify-center px-4">
          <div data-game-winner className="lanx-pop max-w-[90%] rounded-[20px] bg-slate-900/80 px-6 py-3.5 text-center text-white shadow-2xl ring-1 ring-white/15">
            <div className="text-[34px] leading-none">🏆</div>
            <div className="mt-1.5 text-[18px] font-extrabold tracking-tight">{banner.split(" — ")[0]}!</div>
            {banner.includes(" — ") && <div className="mt-0.5 text-[12.5px] text-white/70">{banner.split(" — ").slice(1).join(" — ")}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
