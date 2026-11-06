import { type JSX, type PointerEvent as ReactPointerEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Monitor, X } from "lucide-react";
import type { Sign } from "../../lib/gestures/interpret";
import { type GestureLive, useGestureLive } from "../../lib/gestures/live";

/** LANX 3.7.1: the gesture practice guide. Seven short steps that teach the
 *  hand gestures by doing them — each one ticks itself off the moment LANX
 *  sees it done, then moves on. Everything here works by hand (through the
 *  gesture driver: plain buttons click on a pinch, the ball takes a press →
 *  move → release, a fist scrolls the list, the text box brings up the air
 *  keyboard) and with the real mouse and keyboard too.
 *
 *  Never mark this with data-gesture-ui: the gesture driver skips anything
 *  inside that, and here the hand has to reach everything. */

export interface GestureTutorialProps {
  onClose: () => void;
  /** Controlling the whole PC is possible on this computer. */
  pcAvailable: boolean;
  /** …and it is already on. */
  pcOn: boolean;
  onTurnOnPc: () => void;
}

const LAST = 7;
/** A step done: the tick shows this long, then the next step comes. */
const ADVANCE_MS = 700;
/** Step 1: the open hand seen this long. */
const SEEN_MS = 800;
/** Step 5: scrolled this far. */
const SCROLL_PX = 150;
/** LANX's air keyboard is up inside the window (it would cover the guide's lower half). */
const keyboardUp = () => !!document.querySelector("[data-gesture-kb], [data-air-keyboard]");

// Plain and gentle: transform/opacity only, and nothing moves for people who asked for less motion.
// (The dim backdrop fades its colour, never its opacity: that would switch off the panel's glass.)
const CSS = `
@keyframes gt-rise { 0%, 100% { transform: translateY(5px) rotate(-5deg); } 50% { transform: translateY(-5px) rotate(5deg); } }
@keyframes gt-slide { 0%, 100% { transform: translateX(-13px); } 50% { transform: translateX(13px); } }
@keyframes gt-pinch { 0%, 60%, 100% { transform: scale(1); } 30% { transform: scale(0.78); } }
@keyframes gt-drag { 0% { transform: translateX(-13px) scale(1); } 18% { transform: translateX(-13px) scale(0.82); } 62% { transform: translateX(13px) scale(0.82); } 78% { transform: translateX(13px) scale(1); } 100% { transform: translateX(-13px) scale(1); } }
@keyframes gt-scroll { 0%, 100% { transform: translateY(-10px); } 50% { transform: translateY(10px); } }
@keyframes gt-tap { 0%, 55%, 100% { transform: translateY(0) scale(1); } 25% { transform: translateY(6px) scale(0.84); } }
@keyframes gt-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-5px); } }
@keyframes gt-pop { 0% { opacity: 0; transform: scale(0.5); } 60% { opacity: 1; transform: scale(1.06); } 100% { opacity: 1; transform: scale(1); } }
@keyframes gt-dim { from { background-color: transparent; } }
.gt-art { display: inline-block; will-change: transform; }
.gt-pop { animation: gt-pop 0.38s var(--ease-out-soft, ease-out) both; }
@media (prefers-reduced-motion: reduce) {
  .gt-art, .gt-pop { animation: none !important; }
  [data-gesture-tutorial] * { transition-duration: 0.01ms !important; }
}
`;

interface StepInfo {
  title: string;
  text: string;
  /** The picture: a big emoji and how it moves. */
  art: string;
  anim: string;
}
const STEPS: Record<number, StepInfo> = {
  1: { title: "Show your hand", text: "Hold one hand up, palm towards the screen, about an arm's length from the camera.", art: "✋", anim: "gt-rise 2.8s ease-in-out infinite" },
  2: { title: "Move the pointer", text: "Move your open hand slowly — the ring on the screen follows it. Touch all three circles.", art: "✋", anim: "gt-slide 2.6s ease-in-out infinite" },
  3: { title: "Pinch to click", text: "Point at the button. Touch your thumb and first finger together, then open them.", art: "🤏", anim: "gt-pinch 1.8s ease-in-out infinite" },
  4: { title: "Pinch and move to drag", text: "Point at the ball and pinch. Keep pinching while you move your hand to the ring, then open your hand to drop it.", art: "🤏", anim: "gt-drag 3s ease-in-out infinite" },
  5: { title: "Make a fist to scroll", text: "Make a fist over the list and move it up or down; open your hand to let go.", art: "✊", anim: "gt-scroll 2.2s ease-in-out infinite" },
  6: { title: "Type in the air", text: "Pinch the box: a keyboard comes up. Point at a key and pinch it. Type hi.", art: "⌨️", anim: "" },
  7: { title: "You're ready", text: "That's all of it. Here it is in one place — open this guide again any time with Learn.", art: "🙌", anim: "gt-float 3s ease-in-out infinite" },
};

const HOLDING: Record<Sign, string> = {
  yes: "👍 Thumbs up — hold it to answer a call",
  no: "👎 Thumbs down — hold it to say no or close",
  listen: "✌️ Victory — hold it and LANX listens",
  wheel: "🤟 Hold it for the command wheel",
};

type Tone = "off" | "wait" | "ok" | "act";
/** What LANX sees right now, in plain words. */
function describe(l: GestureLive): { tone: Tone; text: string } {
  if (!l.on) return { tone: "off", text: "Turn the camera on first (the hand button in the top row)" };
  if (l.holding) return { tone: "act", text: HOLDING[l.holding] };
  if (l.tracking === 0) return { tone: "wait", text: "I can't see your hand yet — hold it up, palm towards the screen" };
  switch (l.mode) {
    case "point": return { tone: "ok", text: "✋ Following your hand" };
    case "press":
    case "drag": return { tone: "act", text: "🤏 Pinched!" };
    case "grab": return { tone: "act", text: "✊ Fist — scrolling" };
    case "zoom":
    case "frame": return { tone: "act", text: "🙌 Two hands" };
    default: return { tone: "ok", text: l.pc ? "✋ I can see your hand — it's moving the mouse" : "✋ I can see your hand" };
  }
}
const TONE_DOT: Record<Tone, string> = { off: "bg-amber-500", wait: "bg-amber-500", ok: "bg-emerald-500", act: "bg-sky-500" };

function LiveLine() {
  const s = describe(useGestureLive());
  return (
    <div data-tutorial-live={s.tone} aria-live="polite" className="flex min-h-7 items-center gap-2 text-[13px] text-slate-600 dark:text-slate-300">
      <span className={`h-2 w-2 shrink-0 rounded-full ${TONE_DOT[s.tone]}`} />
      <span className="truncate">{s.text}</span>
    </div>
  );
}

function Art({ step }: { step: number }) {
  const s = STEPS[step];
  return (
    <div aria-hidden className="relative flex h-[84px] w-[84px] shrink-0 items-center justify-center overflow-hidden rounded-[24px] lanx-group">
      {step === 6 ? (
        <>
          <span className="gt-art absolute top-2 text-[26px] leading-none" style={{ animation: "gt-tap 1.5s ease-in-out infinite" }}>🤏</span>
          <span className="absolute bottom-2.5 text-[34px] leading-none">⌨️</span>
        </>
      ) : (
        <span className="gt-art text-[46px] leading-none" style={{ animation: s.anim }}>{s.art}</span>
      )}
    </div>
  );
}

interface StepProps {
  done: boolean;
  onDone: () => void;
}

// ---- 1. Show your hand
function SeeHand({ done, onDone }: StepProps) {
  const live = useGestureLive();
  const seen = live.on && live.tracking > 0 && live.mode === "point";
  useEffect(() => {
    if (!seen || done) return;
    const t = window.setTimeout(onDone, SEEN_MS);
    return () => window.clearTimeout(t);
  }, [seen, done, onDone]);
  const full = seen || done;
  const note = done ? "Got it — I can see your hand." : seen ? "That's it — hold it there…" : !live.on ? "The camera is off." : live.tracking ? "Open your hand, palm towards the screen." : "Waiting for your hand…";
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-4">
      <div className={`flex h-[104px] w-[104px] items-center justify-center rounded-full text-[52px] transition-transform duration-300 ${full ? "scale-105 bg-emerald-500/15" : "bg-[var(--lanx-fill)]"}`}>✋</div>
      <div className="h-1.5 w-[220px] overflow-hidden rounded-full bg-[var(--lanx-fill-2)]">
        <div className="h-full w-full origin-left rounded-full bg-emerald-500" style={{ transform: `scaleX(${full ? 1 : 0})`, transition: done ? "none" : seen ? `transform ${SEEN_MS}ms linear` : "transform 0.2s ease-out" }} />
      </div>
      <p className="text-[13px] text-slate-500 dark:text-slate-400">{note}</p>
    </div>
  );
}

// ---- 2. Move the pointer
const SPOTS = [
  { left: "15%", top: "31%" },
  { left: "50%", top: "62%" },
  { left: "85%", top: "31%" },
];
function MovePointer({ onDone }: StepProps) {
  const live = useGestureLive();
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  const [visited, setVisited] = useState<boolean[]>(() => SPOTS.map(() => false));
  const [over, setOver] = useState(-1);
  const visit = useCallback((i: number) => setVisited((v) => (v[i] ? v : v.map((x, j) => x || j === i))), []);
  // The hand pointer (CSS px in the window) over a circle.
  useEffect(() => {
    const { x, y } = live;
    let hit = -1;
    if (x !== null && y !== null) {
      refs.current.forEach((el, i) => {
        const r = el?.getBoundingClientRect();
        if (r && x >= r.left - 6 && x <= r.right + 6 && y >= r.top - 6 && y <= r.bottom + 6) hit = i;
      });
    }
    setOver(hit);
    if (hit >= 0) visit(hit);
  }, [live.x, live.y, visit]); // eslint-disable-line react-hooks/exhaustive-deps
  const count = visited.filter(Boolean).length;
  useEffect(() => {
    if (count === SPOTS.length) onDone();
  }, [count, onDone]);
  return (
    <div className="relative h-full">
      {SPOTS.map((s, i) => (
        <div
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          data-tutorial-target={i + 1}
          data-visited={visited[i] ? "" : undefined}
          // The real mouse (and the gesture driver's hover events) count too.
          onPointerEnter={() => visit(i)}
          className={`absolute flex h-[88px] w-[88px] items-center justify-center rounded-full text-[22px] font-bold transition-[transform,background-color,color] duration-200 ${visited[i] ? "bg-sky-500 text-white" : "bg-[var(--lanx-fill)] text-slate-500 dark:text-slate-400"}`}
          style={{ left: s.left, top: s.top, translate: "-50% -50%", transform: over === i ? "scale(1.1)" : "none" }}
        >
          {visited[i] ? <Check className="gt-pop h-9 w-9" strokeWidth={3} /> : i + 1}
        </div>
      ))}
      <p className="absolute inset-x-0 bottom-3 text-center text-[12.5px] text-slate-500 dark:text-slate-400">{count} of 3 touched</p>
    </div>
  );
}

// ---- 3. Pinch to click
function PinchClick({ done, onDone }: StepProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-4">
      <button
        type="button"
        data-tutorial-pinch
        onClick={onDone}
        className="flex h-[96px] min-w-[260px] items-center justify-center gap-3 rounded-full bg-sky-500 px-10 text-[22px] font-semibold text-white transition-[transform,background-color] duration-150 hover:bg-sky-600 active:scale-95"
      >
        <span className="text-[30px] leading-none">🤏</span>
        {done ? "Clicked!" : "Pinch me"}
      </button>
      <p className="text-[12.5px] text-slate-500 dark:text-slate-400">Tip: holding still on a button for a moment clicks it too.</p>
    </div>
  );
}

// ---- 4. Pinch and move to drag
function DragBall({ done, onDone }: StepProps) {
  const area = useRef<HTMLDivElement>(null);
  const ball = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const [held, setHeld] = useState(false);
  const [near, setNear] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);

  const inRing = (cx: number, cy: number) => {
    const r = ring.current?.getBoundingClientRect();
    return !!r && Math.hypot(cx - (r.left + r.width / 2), cy - (r.top + r.height / 2)) <= r.width / 2;
  };
  // Pointer events from the real mouse and from the hand alike (LANX's gesture
  // driver sends pointerdown → pointermove… → pointerup with its own pointer id).
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    stop.current?.();
    const a = area.current?.getBoundingClientRect();
    const b = ball.current?.getBoundingClientRect();
    if (!a || !b) return;
    const id = e.pointerId;
    const start = { x: e.clientX, y: e.clientY, ox: off.x, oy: off.y };
    // The ball's centre with no offset, and how far it may go (it stays in the box).
    const home = { x: b.left + b.width / 2 - off.x, y: b.top + b.height / 2 - off.y };
    const rad = b.width / 2;
    const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
    let cur = { x: off.x, y: off.y };
    try {
      e.currentTarget.setPointerCapture(id);
    } catch {
      /* (not a live pointer: the window listeners below still hear it) */
    }
    setHeld(true);
    setNote(null);
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      cur = { x: clamp(start.ox + ev.clientX - start.x, a.left + rad - home.x, a.right - rad - home.x), y: clamp(start.oy + ev.clientY - start.y, a.top + rad - home.y, a.bottom - rad - home.y) };
      setOff(cur);
      setNear(inRing(home.x + cur.x, home.y + cur.y));
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      stop.current = null;
      setHeld(false);
      setNear(false);
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      end();
      const r = ring.current?.getBoundingClientRect();
      if (r && inRing(home.x + cur.x, home.y + cur.y)) {
        // Settles in the middle of the ring.
        setOff({ x: r.left + r.width / 2 - home.x, y: r.top + r.height / 2 - home.y });
        onDone();
      } else if (Math.hypot(cur.x - start.ox, cur.y - start.oy) > 12) setNote("Almost — drop it inside the ring.");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    stop.current = end;
  };
  const inside = done || near;
  return (
    <div ref={area} className="relative h-full touch-none select-none">
      <div
        ref={ring}
        data-tutorial-ring
        className={`absolute flex h-[136px] w-[136px] items-center justify-center rounded-full border-[3px] transition-colors duration-200 ${inside ? "border-solid border-emerald-500 bg-emerald-500/10" : "border-dashed border-slate-300 dark:border-slate-600"}`}
        style={{ left: "77%", top: "50%", translate: "-50% -50%" }}
      >
        {!done && <span className="text-[12.5px] font-medium text-slate-400">Drop here</span>}
      </div>
      <div
        ref={ball}
        data-tutorial-ball
        // A drag, never a list scroll — even if the guide itself has to scroll in a small window.
        data-gesture-drag
        onPointerDown={onPointerDown}
        // A pinch held still too long turns into a right-click (and lets go of the ball).
        onContextMenu={(e) => {
          e.preventDefault();
          setNote("Pinch, then move straight away — holding still too long lets go.");
        }}
        className={`absolute flex h-[84px] w-[84px] items-center justify-center rounded-full bg-sky-500 text-[13px] font-semibold text-white shadow-[0_6px_14px_-6px_rgb(15_23_42/0.45)] ${held ? "cursor-grabbing" : "cursor-grab"}`}
        style={{
          left: "22%",
          top: "50%",
          translate: `calc(-50% + ${off.x}px) calc(-50% + ${off.y}px)`,
          scale: held ? "1.08" : "1",
          transition: held ? "scale 0.15s ease-out" : "translate 0.32s var(--ease-out-soft, ease-out), scale 0.15s ease-out",
        }}
      >
        {done ? <Check className="h-8 w-8" strokeWidth={3} /> : "Drag me"}
      </div>
      <p className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-[12.5px] text-slate-500 dark:text-slate-400">{note ?? (held ? "Keep pinching… now move to the ring" : "Pinch the ball and move it into the ring")}</p>
    </div>
  );
}

// ---- 5. Make a fist to scroll
const ROWS = Array.from({ length: 30 }, (_, i) => (i === 0 ? "Row 1 — make a fist here" : i === 29 ? "Row 30 — the end" : `Row ${i + 1}`));
function FistScroll({ onDone }: StepProps) {
  const [top, setTop] = useState(0);
  return (
    <div className="relative h-full">
      <div
        data-tutorial-list
        onScroll={(e) => {
          const t = e.currentTarget.scrollTop;
          setTop(t);
          if (t > SCROLL_PX) onDone();
        }}
        // (Out of the flow: the list's height never stretches the guide.)
        className="absolute inset-0 overflow-y-auto overscroll-contain"
      >
        {ROWS.map((r, i) => (
          <div key={i} className="flex h-[52px] items-center border-b border-[var(--lanx-line)] px-5 text-[14px] text-slate-700 dark:text-slate-200">
            {r}
          </div>
        ))}
      </div>
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-1 bg-[var(--lanx-fill)]">
        <div className="h-full w-full origin-left bg-emerald-500 transition-transform duration-150" style={{ transform: `scaleX(${Math.min(1, top / SCROLL_PX)})` }} />
      </div>
    </div>
  );
}

// ---- 6. Type in the air
function AirType({ done, onDone, waitKb }: StepProps & { waitKb: boolean }) {
  const [v, setV] = useState("");
  useEffect(() => {
    if (/hi/i.test(v)) onDone();
  }, [v, onDone]);
  return (
    <div className="flex h-full flex-col items-center gap-3 px-6 pt-6">
      {/* (A plain text box: pinched by hand it gets the cursor, and LANX brings up the air keyboard for it.) */}
      <input
        type="text"
        data-tutorial-text
        value={v}
        onChange={(e) => setV(e.target.value)}
        placeholder="Type hi"
        autoComplete="off"
        spellCheck={false}
        aria-label="Practice typing"
        className="lanx-field h-16 w-full max-w-[440px] rounded-2xl px-5 text-[22px] text-slate-900 placeholder:text-slate-400 dark:text-white"
      />
      <p className="text-center text-[12.5px] text-slate-500 dark:text-slate-400">
        {waitKb ? (
          <b data-tutorial-kb-note className="font-semibold text-slate-900 dark:text-white">Well done! Now pinch ✕ on the keyboard to put it away.</b>
        ) : done ? (
          "Well done!"
        ) : (
          "No keyboard? Hold up 🤟 and pick Keyboard. Typing with your own keyboard works too."
        )}
      </p>
    </div>
  );
}

// ---- 7. You're ready
const CHEATS: [string, string, string][] = [
  ["✋", "Open hand", "Move the pointer"],
  ["🤏", "Pinch", "Click"],
  ["🤏", "Pinch + move", "Drag"],
  ["✊", "Fist", "Scroll"],
  ["🙌", "Two hands", "Zoom"],
  ["👍", "Thumbs up", "Answer a call"],
  ["✌️", "Victory", "Say a command"],
  ["🤟", "Rock on", "Keyboard / command wheel"],
];
function Ready({ pcAvailable, pcOn, onTurnOnPc }: { pcAvailable: boolean; pcOn: boolean; onTurnOnPc: () => void }) {
  return (
    <div className="mt-4 flex flex-1 flex-col gap-3">
      <div className="grid grid-cols-4 gap-2" data-tutorial-cheats>
        {CHEATS.map(([sign, name, does]) => (
          <div key={name} className="flex items-center gap-2.5 rounded-2xl lanx-group px-3 py-2.5">
            <span className="w-7 shrink-0 text-center text-[22px] leading-none">{sign}</span>
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold leading-tight text-slate-900 dark:text-white">{name}</span>
              <span className="block text-[11.5px] leading-snug text-slate-500 dark:text-slate-400">{does}</span>
            </span>
          </div>
        ))}
      </div>
      {pcAvailable && !pcOn && (
        <div data-tutorial-pc-card className="flex items-center gap-4 rounded-2xl lanx-group p-3.5">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-sky-500 text-white"><Monitor className="h-6 w-6" /></span>
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold text-slate-900 dark:text-white">Use your hand for every program</div>
            <div className="text-[12.5px] leading-snug text-slate-500 dark:text-slate-400">Control the whole PC: your hand becomes the mouse in Chrome, Excel, everywhere — LANX can be minimised.</div>
          </div>
          <button type="button" data-tutorial-pc onClick={onTurnOnPc} className="h-14 shrink-0 rounded-full bg-sky-500 px-6 text-[14px] font-semibold text-white transition-[transform,background-color] duration-150 hover:bg-sky-600 active:scale-95">
            Turn it on
          </button>
        </div>
      )}
      {!(pcAvailable && !pcOn) && (
        <div className="rounded-2xl lanx-group px-3.5 py-3 text-[12.5px] leading-snug text-slate-600 dark:text-slate-300">
          <b className="font-semibold text-slate-900 dark:text-white">For the best tracking:</b> sit about an arm's length from the camera, with light on your face — not a bright window behind you. Keep your hand at chest height, palm towards the screen.
        </div>
      )}
      {pcAvailable && pcOn && (
        <div data-tutorial-pc-on className="flex items-center gap-2 text-[13px] text-slate-600 dark:text-slate-300">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white"><Check className="h-3.5 w-3.5" strokeWidth={3} /></span>
          Your hand controls the whole PC — every program, even with LANX minimised.
        </div>
      )}
    </div>
  );
}

/** The practice box under each step's words, with the tick when it's done. */
function Practice({ children, ticked }: { children: ReactNode; ticked: boolean }) {
  return (
    <div className="relative mt-4 min-h-[200px] flex-1 overflow-hidden rounded-[20px] lanx-group [@media(max-height:620px)]:min-h-[176px]">
      {children}
      {ticked && (
        <div data-tutorial-tick aria-hidden className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[color-mix(in_srgb,var(--lanx-surface)_82%,transparent)] lanx-fade">
          <span className="gt-pop flex h-[72px] w-[72px] items-center justify-center rounded-full bg-emerald-500 text-white"><Check className="h-10 w-10" strokeWidth={3} /></span>
          <span className="gt-pop text-[15px] font-semibold text-slate-900 dark:text-white">Nice!</span>
        </div>
      )}
    </div>
  );
}

export function GestureTutorial({ onClose, pcAvailable, pcOn, onTurnOnPc }: GestureTutorialProps): JSX.Element {
  const [step, setStep] = useState(1);
  const [done, setDone] = useState<ReadonlySet<number>>(() => new Set());
  const doneRef = useRef<ReadonlySet<number>>(done);
  /** The step just finished on this visit (its tick shows). */
  const [ticked, setTicked] = useState<number | null>(null);
  const advance = useRef(0);
  /** Step 6 done with the air keyboard still up: the next step waits until it is put away. */
  const [waitKb, setWaitKb] = useState<number | null>(null);

  // On by itself — unless the user has already gone somewhere else.
  const moveOn = useCallback((n: number) => {
    window.clearTimeout(advance.current);
    advance.current = window.setTimeout(() => setStep((s) => (s === n ? n + 1 : s)), ADVANCE_MS);
  }, []);
  const markDone = useCallback((n: number) => {
    if (doneRef.current.has(n)) return;
    const next = new Set(doneRef.current);
    next.add(n);
    doneRef.current = next;
    setDone(next);
    if (n >= LAST) return;
    setTicked(n);
    if (n === 6 && keyboardUp()) setWaitKb(n);
    else moveOn(n);
  }, [moveOn]);
  const doneNow = useCallback(() => markDone(step), [markDone, step]);
  useEffect(() => () => window.clearTimeout(advance.current), []);
  useEffect(() => {
    setTicked((t) => (t === step ? t : null));
    setWaitKb((w) => (w === step ? w : null));
    if (step === LAST) markDone(LAST);
  }, [step, markDone]);
  useEffect(() => {
    if (waitKb === null) return;
    const t = window.setInterval(() => {
      if (keyboardUp()) return;
      setWaitKb(null);
      moveOn(waitKb);
    }, 150);
    return () => window.clearInterval(t);
  }, [waitKb, moveOn]);
  // Escape from a real keyboard closes the guide (a hand's flick sends one too: that one is ignored).
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape" && e.isTrusted) close.current();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);

  const go = (n: number) => setStep(Math.min(LAST, Math.max(1, n)));
  const info = STEPS[step];
  const isDone = done.has(step);
  const props: StepProps = { done: isDone, onDone: doneNow };

  return (
    <div data-gesture-tutorial role="dialog" aria-modal="true" aria-labelledby="gt-title" className="fixed inset-0 z-[180] flex items-center justify-center bg-[rgb(15_23_42/0.2)] p-3 dark:bg-[rgb(0_0_0/0.45)]" style={{ animation: "gt-dim 0.3s ease backwards" }}>
      <style>{CSS}</style>
      <div className="flex h-[540px] max-h-[88vh] w-[760px] max-w-[94vw] flex-col overflow-y-auto rounded-[26px] px-6 pb-5 pt-3 lanx-sheet lanx-sheet-in">
        {/* Where you are: one dot per step */}
        <div className="flex shrink-0 items-center gap-3">
          <div className="flex items-center gap-2" aria-hidden>
            {Array.from({ length: LAST }, (_, i) => i + 1).map((n) => (
              <span
                key={n}
                data-tutorial-dot={n}
                className={`h-2.5 w-2.5 rounded-full transition-[transform,background-color] duration-300 ${n === step ? "scale-[1.4] bg-sky-500" : done.has(n) ? "bg-emerald-500" : "bg-[var(--lanx-fill-2)]"}`}
              />
            ))}
          </div>
          <span className="text-[12px] font-semibold text-slate-400">Step {step} of {LAST}</span>
          <span className="flex-1" />
          <button type="button" data-tutorial-close aria-label="Close the guide" title="Close" onClick={onClose} className="group -mr-3 flex h-14 w-14 items-center justify-center rounded-full">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--lanx-fill)] text-slate-500 transition-[transform,background-color] duration-150 group-hover:bg-[var(--lanx-fill-2)] group-active:scale-90 dark:text-slate-300">
              <X className="h-[18px] w-[18px]" />
            </span>
          </button>
        </div>

        <div key={step} data-tutorial-step={step} data-tutorial-done={isDone ? "" : undefined} className="flex flex-1 flex-col lanx-tab-in">
          <div className="mt-1 flex items-center gap-4">
            <Art step={step} />
            <div className="min-w-0">
              <h2 id="gt-title" className="flex items-center gap-2 text-[20px] font-bold text-slate-900 dark:text-white">
                {info.title}
                {isDone && step < LAST && (
                  <span className="gt-pop flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 text-white"><Check className="h-4 w-4" strokeWidth={3} /></span>
                )}
              </h2>
              <p className="mt-1 text-[14px] leading-snug text-slate-600 dark:text-slate-300">{info.text}</p>
            </div>
          </div>
          {step === LAST ? (
            <Ready pcAvailable={pcAvailable} pcOn={pcOn} onTurnOnPc={onTurnOnPc} />
          ) : (
            <Practice ticked={ticked === step && waitKb !== step}>
              {step === 1 && <SeeHand {...props} />}
              {step === 2 && <MovePointer {...props} />}
              {step === 3 && <PinchClick {...props} />}
              {step === 4 && <DragBall {...props} />}
              {step === 5 && <FistScroll {...props} />}
              {step === 6 && <AirType {...props} waitKb={waitKb === 6} />}
            </Practice>
          )}
        </div>

        <div className="mt-3 shrink-0">
          <LiveLine />
        </div>
        <div className="mt-2 flex shrink-0 items-center gap-2">
          <button
            type="button"
            data-tutorial-back
            onClick={() => go(step - 1)}
            className={`flex h-14 items-center gap-2 rounded-full px-5 text-[15px] font-semibold text-slate-700 lanx-btn dark:text-slate-200 ${step === 1 ? "invisible" : ""}`}
          >
            <ArrowLeft className="h-[18px] w-[18px]" /> Back
          </button>
          <span className="flex-1" />
          {step < LAST ? (
            <>
              {!isDone && (
                <button type="button" data-tutorial-skip onClick={() => go(step + 1)} className="h-14 rounded-full px-5 text-[15px] font-semibold text-slate-500 lanx-tool dark:text-slate-400">
                  Skip
                </button>
              )}
              <button
                type="button"
                data-tutorial-next
                disabled={!isDone}
                onClick={() => go(step + 1)}
                className="flex h-14 items-center gap-2 rounded-full bg-sky-500 px-7 text-[15px] font-semibold text-white transition-[transform,background-color] duration-150 enabled:hover:bg-sky-600 enabled:active:scale-95 disabled:bg-[var(--lanx-fill-2)] disabled:text-slate-400"
              >
                Next <ArrowRight className="h-[18px] w-[18px]" />
              </button>
            </>
          ) : (
            <button type="button" data-tutorial-finish onClick={onClose} className="flex h-14 items-center gap-2 rounded-full bg-sky-500 px-8 text-[15px] font-semibold text-white transition-[transform,background-color] duration-150 hover:bg-sky-600 active:scale-95">
              <Check className="h-[18px] w-[18px]" strokeWidth={3} /> Finish
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
