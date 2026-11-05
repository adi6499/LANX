import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarDays, Eye, EyeOff, Gamepad2, Hand, Loader2, Mic, Pause, Play, Power, Settings2, SkipForward, StickyNote, X } from "lucide-react";
import { api, errorText } from "../../lib/api";
import { player } from "../../lib/music";
import { loadDictationPrefs, startPcmRecorder, type PcmRecorder } from "../../lib/voice";
import { GestureEngine, type EngineStatus, type Frame } from "../../lib/gestures/engine";
import { type Cursor, type GEvent, GestureInterpreter, type Sign } from "../../lib/gestures/interpret";
import { DomDriver, type Target, elementAt } from "../../lib/gestures/dom";
import { type Intent, parseCommand, restoreCase, splitWho } from "../../lib/gestures/commands";
import { type GesturePrefs, useGesturePrefs } from "../../lib/gestures/prefs";
import { WindowFrame } from "../../lib/gestures/windowFrame";

/** LANX 3.5.0: Gesture control — move a hand in front of the camera and
 *  LANX follows it, like using a touch screen from across the desk. A pinch
 *  clicks, a fist grabs and scrolls, two hands zoom, a flick skips, and
 *  holding up ✌ listens for a spoken command ("call Bharat"). */

export interface GestureActions {
  /** 👍: answer what is ringing. True when there was something to answer. */
  yes: () => boolean;
  /** 👎: decline what is ringing. */
  no: () => boolean;
  /** Carries out a spoken command; answers with what happened. */
  run: (intent: Intent) => Promise<string>;
  /** Contact and group names, to tell where a name ends in "message Bharat …". */
  names: () => string[];
  /** Closes the window on top (Notes, the calendar, a settings window…). False when none is open. */
  close: () => boolean;
}

type Voice = { phase: "idle" } | { phase: "listening"; level: number } | { phase: "thinking" };
const SIGN_EMOJI: Record<Sign, string> = { yes: "👍", no: "👎", listen: "✌️", wheel: "🤟" };
const BOX = 28;
/** LANX 3.6.1: hold the pointer still on a button this long and it clicks (no pinch needed). */
const DWELL_MS = 900;
/** How far the pointer may wander while holding still (px). */
const DWELL_MOVE = 28;
/** It must have travelled this far (px) in the moment before reaching the button: a hand that
 *  was only resting in view (chin on hand…) never clicks. */
const DWELL_ARRIVE = 60;
const DWELL_ARRIVE_MS = 1500;
/** The "hold still to click" whisper shows for the first few clicks only. */
const HINT_CLICKS = 6;
const HINT_KEY = "lanx.gestures.clicks";
const clicksSoFar = () => {
  try {
    return Number(localStorage.getItem(HINT_KEY) ?? 0);
  } catch {
    return HINT_CLICKS;
  }
};
const countClick = () => {
  try {
    localStorage.setItem(HINT_KEY, String(clicksSoFar() + 1));
  } catch {}
};

export function GestureLayer({ actions, locked, onError, onOpenSettings, onOpenVoiceSettings }: { actions: GestureActions; locked: boolean; onError: (t: string) => void; onOpenSettings: () => void; onOpenVoiceSettings: () => void }) {
  const [prefs, setPrefs] = useGesturePrefs();
  const [status, setStatus] = useState<EngineStatus>({ phase: "off" });
  const [hidden, setHidden] = useState(document.hidden);
  const [focused, setFocused] = useState(document.hasFocus());
  const [hasHand, setHasHand] = useState(false);
  const [voice, setVoice] = useState<Voice>({ phase: "idle" });
  const [toast, setToast] = useState<string | null>(null);
  const [wheel, setWheel] = useState<{ x: number; y: number } | null>(null);
  const [choose, setChoose] = useState<{ el: HTMLSelectElement; rect: DOMRect } | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  /** Two hands resizing the window: the glow and the size label. */
  const [framing, setFraming] = useState<{ w: number; h: number; fill?: boolean } | null>(null);
  const winFrame = useRef<WindowFrame | null>(null);
  /** The pill's words: shown for a few seconds when something changes, or while the mouse (or hand) is on it. */
  const [pillOpen, setPillOpen] = useState(false);
  const [pillFresh, setPillFresh] = useState(true);
  useEffect(() => {
    setPillFresh(true);
    const t = window.setTimeout(() => setPillFresh(false), 4000);
    return () => window.clearTimeout(t);
  }, [status.phase, hasHand, focused, hidden, locked]);

  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const prefsRef = useRef<GesturePrefs | null>(prefs);
  prefsRef.current = prefs;
  const focusedRef = useRef(focused);
  focusedRef.current = focused;
  const wheelRef = useRef(wheel);
  wheelRef.current = wheel;
  const voiceRef = useRef(voice);
  voiceRef.current = voice;

  const engine = useRef<GestureEngine | null>(null);
  const interp = useRef<GestureInterpreter | null>(null);
  const driver = useRef<DomDriver | null>(null);
  const cursor = useRef<Cursor | null>(null);
  const second = useRef<{ x: number; y: number } | null>(null);
  const target = useRef<Target | null>(null);
  const lastFrame = useRef<Frame | null>(null);
  const ringEl = useRef<HTMLDivElement>(null);
  const dotEl = useRef<HTMLDivElement>(null);
  const holdEl = useRef<HTMLDivElement>(null);
  const holdArc = useRef<SVGCircleElement>(null);
  const holdLabel = useRef<HTMLSpanElement>(null);
  const secondEl = useRef<HTMLDivElement>(null);
  const fillEl = useRef<HTMLDivElement>(null);
  const hintEl = useRef<HTMLSpanElement>(null);
  /** Holding still on a button: which, where it started, since when, and whether it already clicked. */
  const dwell = useRef<{ el: Element; x: number; y: number; since: number; done: boolean } | null>(null);
  const dwellP = useRef(0);
  /** Where the pointer has been lately (to tell a pointer brought here from a resting hand). */
  const trail = useRef<{ t: number; x: number; y: number }[]>([]);
  const flashUntil = useRef(0);
  const hintsLeft = useRef(clicksSoFar() < HINT_CLICKS);
  const previewCanvas = useRef<HTMLCanvasElement>(null);
  const toastTimer = useRef(0);
  const fedAt = useRef(0);
  const statusRef = useRef(status);
  statusRef.current = status;

  const say = useCallback((t: string, ms = 2200) => {
    window.clearTimeout(toastTimer.current);
    setToast(t);
    toastTimer.current = window.setTimeout(() => setToast(null), ms);
  }, []);

  // ---- spoken commands (✌, the wheel, or Ctrl + Alt + J)
  /** The words heard → done, with a note of what happened. */
  const act = useCallback(async (said: string) => {
    let intent = parseCommand(said);
    if (intent.kind === "message" && intent.rest !== undefined) intent = { ...intent, ...splitWho(intent.rest, actionsRef.current.names()) };
    if (intent.kind === "message" || intent.kind === "note") intent = { ...intent, text: restoreCase(said, intent.text) };
    const result = await actionsRef.current.run(intent);
    say(`“${said}” — ${result}`, 3600);
    return result;
  }, [say]);
  const rec = useRef<PcmRecorder | null>(null);
  const askedForModel = useRef(false);
  /** `asked`: a key or a button (always explains); ✌ explains once, then just says so. */
  const listen = useCallback(async (asked = true) => {
    if (voiceRef.current.phase !== "idle") return;
    const dp = await loadDictationPrefs();
    const models = await api.voiceModels().catch(() => []);
    const model = models.find((m) => m.id === dp.model && m.downloaded) ?? models.find((m) => m.downloaded);
    if (!model) {
      if (asked || !askedForModel.current) {
        askedForModel.current = true;
        onError("Spoken commands need the speech model once: open Voice settings and download it.");
        onOpenVoiceSettings();
      } else say("✌ Spoken commands need the speech model (Voice settings)");
      return;
    }
    let r: PcmRecorder;
    try {
      r = await startPcmRecorder();
    } catch (e) {
      onError(`Microphone: ${errorText(e)}`);
      return;
    }
    rec.current = r;
    setVoice({ phase: "listening", level: 0 });
    let heard = false;
    let quietSince = 0;
    await new Promise<void>((done) => {
      const tick = window.setInterval(() => {
        if (rec.current !== r) {
          window.clearInterval(tick);
          done();
          return;
        }
        const lv = r.level();
        const secs = r.seconds();
        setVoice({ phase: "listening", level: lv });
        if (lv > 0.14) {
          heard = true;
          quietSince = 0;
        } else if (heard && lv < 0.08 && !quietSince) quietSince = performance.now();
        if ((heard && quietSince && performance.now() - quietSince > 900) || secs > 8 || (!heard && secs > 4.5)) {
          window.clearInterval(tick);
          done();
        }
      }, 80);
    });
    if (rec.current !== r) {
      void r.stop();
      return; // cancelled
    }
    rec.current = null;
    const pcm = await r.stop();
    if (!heard || pcm.length < 8000) {
      setVoice({ phase: "idle" });
      say("I didn't hear a command — hold up ✌ again and speak.");
      return;
    }
    setVoice({ phase: "thinking" });
    try {
      // English letters even for Hinglish ("Bharat ko call karo"), which the rules understand.
      const t = await api.transcribe(pcm, model.id, "en");
      const said = t.text.trim();
      if (!said) {
        say("I didn't catch that. Try again a little closer to the microphone.");
        return;
      }
      await act(said);
    } catch (e) {
      say(errorText(e), 3600);
    } finally {
      setVoice({ phase: "idle" });
    }
  }, [onError, onOpenVoiceSettings, say, act]);
  const stopListening = () => {
    rec.current = null;
    setVoice({ phase: "idle" });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.altKey && !e.shiftKey && e.code === "KeyJ" && prefsRef.current?.voice !== false) {
        e.preventDefault();
        if (voiceRef.current.phase === "listening") stopListening();
        else void listen();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [listen]);

  // ---- signs and flicks
  const onSign = useCallback((sign: Sign) => {
    const a = actionsRef.current;
    if (sign === "yes") {
      if (a.yes()) return say("👍 Answered");
      // 👍 over a message: like it.
      const c = cursor.current;
      const msg = c ? elementAt(c.x, c.y)?.closest("[data-msg]")?.getAttribute("data-msg") : null;
      if (msg) void a.run({ kind: "react", emoji: "👍", messageId: msg }).then((t) => say(`👍 ${t}`));
      else say("👍");
    } else if (sign === "no") {
      if (a.no()) return say("👎 Declined");
      if (!a.close()) driver.current?.key("Escape");
      say("👎 Closed");
    } else if (sign === "listen") {
      if (prefsRef.current?.voice) void listen(false);
    } else if (sign === "wheel") {
      const c = cursor.current;
      if (c) setWheel({ x: Math.min(window.innerWidth - 130, Math.max(130, c.x)), y: Math.min(window.innerHeight - 130, Math.max(130, c.y)) });
    }
  }, [listen, say]);

  const onSwipe = useCallback((dir: "left" | "right" | "up" | "down") => {
    if (wheelRef.current) {
      setWheel(null);
      return;
    }
    // Whatever is open (a game, the PDF tools) may take the flick for itself.
    const ev = new CustomEvent("lanx:gesture-swipe", { cancelable: true, detail: { dir } });
    if (!window.dispatchEvent(ev)) return;
    if (dir === "up") {
      if (!actionsRef.current.close()) driver.current?.key("Escape");
      return say("Closed");
    }
    if (dir === "down") return;
    const ps = player.state();
    if (ps.song) {
      if (dir === "left") {
        player.next();
        say("Next song");
      } else {
        player.prev();
        say("Previous song");
      }
      return;
    }
    driver.current?.key(dir === "left" ? "ArrowRight" : "ArrowLeft");
  }, [say]);

  const handle = useCallback((e: GEvent) => {
    const d = driver.current;
    if (!d) return;
    switch (e.type) {
      case "press":
        if (dwell.current) dwell.current.done = true;
        return d.press(e.x, e.y);
      case "drag": return d.drag(e.x, e.y);
      case "release":
        if (e.click) {
          countClick();
          hintsLeft.current = clicksSoFar() < HINT_CLICKS;
        }
        return d.release(e.x, e.y, e.click, e.double);
      case "cancel": return d.cancel();
      case "longpress": return d.longPress(e.x, e.y);
      case "grab": return d.grab(e.x, e.y);
      case "grab-move": return d.grabMove(e.dx, e.dy);
      case "grab-end": return d.grabEnd(e.vx, e.vy);
      case "zoom-start": return d.zoomStart(e.cx, e.cy);
      case "zoom": return d.zoom(e.scale, e.rotate, e.cx, e.cy);
      case "zoom-end": return d.zoomEnd();
      case "frame-start":
        winFrame.current ??= new WindowFrame((w, h, fill) => setFraming({ w, h, fill }));
        void winFrame.current.begin();
        return;
      case "frame":
        return winFrame.current?.set(e.scale);
      case "frame-end":
        winFrame.current?.end();
        return setFraming(null);
      case "swipe": return onSwipe(e.dir);
      case "sign": return onSign(e.sign);
    }
  }, [onSign, onSwipe]);
  const handleRef = useRef(handle);
  handleRef.current = handle;

  // ---- each frame from the camera
  const onFrame = useCallback((f: Frame) => {
    const p = prefsRef.current;
    const g = interp.current;
    const d = driver.current;
    if (!p || !g || !d) return;
    lastFrame.current = f;
    g.opts = { speed: p.speed, hand: p.hand, swipes: p.swipes };
    const out = g.update(f, window.innerWidth, window.innerHeight);
    const active = focusedRef.current;
    for (const e of out.events) {
      // Behind other windows only the signs work (👍 answers a call, ✌ listens).
      if (active || e.type === "sign") handleRef.current(e);
    }
    const c = active ? out.cursor : null;
    cursor.current = c;
    second.current = active ? out.second : null;
    if (c) {
      const t = d.move(c.x, c.y, c.mode !== "point");
      // While pressing, the pointer stays wrapped round the button being pressed.
      if (c.mode === "point") target.current = t;
      else if (c.mode !== "press") target.current = null;
    } else {
      target.current = null;
      d.leave();
    }
    if (c) {
      trail.current.push({ t: f.t, x: c.x, y: c.y });
      while (trail.current.length && f.t - trail.current[0].t > DWELL_ARRIVE_MS) trail.current.shift();
    } else trail.current = [];
    // Holding still on a button clicks it: the button fills up first, so it never surprises.
    const t = target.current;
    const dwellable = !!t && (t.hug || /^(INPUT|TEXTAREA|SELECT)$/.test(t.el.tagName));
    if (c && t && dwellable && c.mode === "point" && !c.hold && c.ready !== false && p.dwell !== false && out.tracking < 2) {
      let dw = dwell.current;
      if (!dw || dw.el !== t.el) {
        // Brought here on purpose (it moved a little way just before)? Otherwise it waits until the pointer leaves.
        const tr = trail.current;
        let travelled = 0;
        for (let i = 1; i < tr.length; i++) travelled = Math.max(travelled, Math.hypot(tr[i].x - tr[0].x, tr[i].y - tr[0].y));
        dw = dwell.current = { el: t.el, x: c.x, y: c.y, since: f.t, done: travelled < DWELL_ARRIVE };
      }
      else if (!dw.done && Math.hypot(c.x - dw.x, c.y - dw.y) > DWELL_MOVE) Object.assign(dw, { x: c.x, y: c.y, since: f.t });
      if (dw.done) dwellP.current = 0;
      else {
        dwellP.current = Math.min(1, (f.t - dw.since) / DWELL_MS);
        if (dwellP.current >= 1) {
          dw.done = true;
          dwellP.current = 0;
          flashUntil.current = performance.now() + 220;
          const r = t.rect;
          const x = Math.min(r.right - 2, Math.max(r.left + 2, c.x));
          const y = Math.min(r.bottom - 2, Math.max(r.top + 2, c.y));
          d.press(x, y);
          d.release(x, y, true, false);
          countClick();
          hintsLeft.current = clicksSoFar() < HINT_CLICKS;
        }
      }
    } else {
      if (!c || c.mode === "point") dwell.current = null;
      dwellP.current = 0;
    }
    setHasHand((h) => (h === out.tracking > 0 ? h : out.tracking > 0));
    drawPreview(previewCanvas.current, f);
  }, []);

  // ---- the camera on and off
  const wanted = !!prefs?.enabled && !locked && !hidden;
  useEffect(() => {
    if (!prefs?.enabled) {
      engine.current?.dispose();
      engine.current = null;
      setStatus({ phase: "off" });
      return;
    }
    if (!engine.current) {
      // (Frames fed in by LANX's tests take over from the camera for a moment.)
      engine.current = new GestureEngine((f) => performance.now() - fedAt.current > 10000 && onFrame(f), (s) => setStatus(s));
      interp.current = new GestureInterpreter({ speed: prefs.speed, hand: prefs.hand, swipes: prefs.swipes });
      driver.current = new DomDriver({ onSelect: (el) => setChoose({ el, rect: el.getBoundingClientRect() }) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs?.enabled, onFrame]);
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    e.stop();
    setStream(null);
    interp.current?.reset();
    driver.current?.leave();
    cursor.current = null;
    target.current = null;
    if (wanted) void e.start(prefs?.camera).then((ok) => setStream(ok ? e.stream : null));
  }, [wanted, prefs?.camera, prefs?.enabled]);
  useEffect(() => () => engine.current?.dispose(), []);

  // For LANX's own tests: hand frames can be fed in without a real hand.
  useEffect(() => {
    if (!prefs?.enabled) return;
    const w = window as unknown as { __lanxGestures?: unknown };
    w.__lanxGestures = {
      feed: (f: Frame) => {
        fedAt.current = performance.now();
        focusedRef.current = true;
        onFrame(f);
      },
      last: () => lastFrame.current,
      cursor: () => cursor.current,
      target: () => target.current?.el ?? null,
      status: () => statusRef.current,
      /** A spoken command, as if the speech engine had heard it. */
      say: (text: string) => act(text),
      /** Only fed frames from now on (a test camera keeps showing hands). */
      ignoreCamera: () => {
        fedAt.current = Infinity;
      },
    };
    return () => {
      delete w.__lanxGestures;
    };
  }, [prefs?.enabled, onFrame, act]);
  useEffect(() => {
    const vis = () => setHidden(document.hidden);
    const foc = () => setFocused(true);
    const blur = () => setFocused(false);
    document.addEventListener("visibilitychange", vis);
    window.addEventListener("focus", foc);
    window.addEventListener("blur", blur);
    return () => {
      document.removeEventListener("visibilitychange", vis);
      window.removeEventListener("focus", foc);
      window.removeEventListener("blur", blur);
    };
  }, []);

  // ---- drawing the pointer, sixty times a second, between camera frames
  useEffect(() => {
    if (status.phase !== "on") return;
    let raf = 0;
    let t0 = performance.now();
    const box = { x: -100, y: -100, w: BOX, h: BOX, r: BOX / 2 };
    let shown = 0;
    const step = (now: number) => {
      const dt = Math.min(0.05, (now - t0) / 1000);
      t0 = now;
      const c = cursor.current;
      const ring = ringEl.current;
      const dot = dotEl.current;
      if (ring && dot) {
        const t = target.current;
        const hug = c && (c.mode === "point" || c.mode === "press") && t?.hug;
        const want = hug && t
          ? { x: t.rect.left - 4, y: t.rect.top - 4, w: t.rect.width + 8, h: t.rect.height + 8, r: t.radius + 4 }
          : c
            ? { x: c.x - (c.mode === "grab" ? 10 : BOX / 2), y: c.y - (c.mode === "grab" ? 10 : BOX / 2), w: c.mode === "grab" ? 20 : BOX, h: c.mode === "grab" ? 20 : BOX, r: c.mode === "grab" ? 10 : BOX / 2 }
            : null;
        if (want) {
          const jump = box.x < -50;
          const kp = jump ? 1 : 1 - Math.exp(-dt * 30);
          const ks = jump ? 1 : 1 - Math.exp(-dt * 22);
          box.x += (want.x - box.x) * kp;
          box.y += (want.y - box.y) * kp;
          box.w += (want.w - box.w) * ks;
          box.h += (want.h - box.h) * ks;
          box.r += (want.r - box.r) * ks;
        }
        shown += ((c ? 1 : 0) - shown) * (1 - Math.exp(-dt * 14));
        ring.style.transform = `translate3d(${box.x}px, ${box.y}px, 0)`;
        ring.style.width = `${box.w}px`;
        ring.style.height = `${box.h}px`;
        ring.style.borderRadius = `${box.r}px`;
        ring.style.opacity = String(shown);
        const flash = now < flashUntil.current;
        ring.dataset.mode = c ? (hug ? (c.mode === "press" || flash ? "hug-press" : "hug") : c.mode) : "none";
        if (fillEl.current) fillEl.current.style.transform = `scaleX(${hug ? dwellP.current : 0})`;
        const hint = hintEl.current;
        if (hint) {
          const showHint = !!hug && hintsLeft.current && dwellP.current > 0.12;
          hint.style.opacity = showHint ? "1" : "0";
          if (showHint) hint.style.transform = `translate3d(${box.x + box.w / 2}px, ${box.y + box.h + 8}px, 0) translateX(-50%)`;
        }
        dot.style.opacity = String(c && !hug && c.mode !== "grab" ? shown : 0);
        if (c) dot.style.transform = `translate3d(${c.x - 2.5}px, ${c.y - 2.5}px, 0)`;
      }
      const hold = holdEl.current;
      if (hold && holdArc.current && holdLabel.current) {
        const h = c?.hold;
        hold.style.opacity = h ? "1" : "0";
        if (h && c) {
          hold.style.transform = `translate3d(${c.x - 26}px, ${c.y - 26}px, 0)`;
          holdArc.current.style.strokeDashoffset = String(150.8 * (1 - h.p));
          holdLabel.current.textContent = SIGN_EMOJI[h.sign];
        }
      }
      const s2 = secondEl.current;
      if (s2) {
        const s = second.current;
        s2.style.opacity = s ? "1" : "0";
        if (s) s2.style.transform = `translate3d(${s.x - 10}px, ${s.y - 10}px, 0)`;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [status.phase]);

  // The wheel closes by itself after a while.
  useEffect(() => {
    if (!wheel) return;
    const t = window.setTimeout(() => setWheel(null), 8000);
    return () => window.clearTimeout(t);
  }, [wheel]);

  const set = (p: Partial<GesturePrefs>) => prefs && setPrefs({ ...prefs, ...p });
  const playing = player.state().playing;
  const wheelItems: { id: string; label: string; icon: React.ReactNode; run: () => void }[] = [
    { id: "play", label: playing ? "Pause" : "Play", icon: playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />, run: () => (player.state().song ? player.toggle() : void actionsRef.current.run({ kind: "open", what: "music" })) },
    { id: "next", label: "Next song", icon: <SkipForward className="h-5 w-5" />, run: () => player.next() },
    { id: "speak", label: "Speak", icon: <Mic className="h-5 w-5" />, run: () => void listen() },
    { id: "notes", label: "Notes", icon: <StickyNote className="h-5 w-5" />, run: () => void actionsRef.current.run({ kind: "open", what: "notes" }) },
    { id: "calendar", label: "Calendar", icon: <CalendarDays className="h-5 w-5" />, run: () => void actionsRef.current.run({ kind: "open", what: "calendar" }) },
    { id: "games", label: "Games", icon: <Gamepad2 className="h-5 w-5" />, run: () => void actionsRef.current.run({ kind: "open", what: "games" }) },
  ];

  const statusText =
    status.phase === "starting" ? "Starting the camera…"
    : status.phase === "error" ? status.message ?? "The camera stopped"
    : status.phase === "on" ? (focused ? (hasHand ? "Following your hand" : "Show your open hand") : "In the background: 👍 ✌ still work")
    : locked ? "Paused while LANX is locked"
    : hidden ? "Paused while LANX is hidden"
    : "Off";

  if (!prefs) return null;
  const on = prefs.enabled;
  const pillShown = pillOpen || pillFresh || status.phase !== "on";

  return (
    <>
      {/* The pointer and its rings: never in the way of the page (and skipped when finding what is under the hand). */}
      <div data-gesture-ui aria-hidden className="pointer-events-none fixed inset-0 z-[200] overflow-hidden">
        <div ref={ringEl} data-gesture-cursor className="lanx-gesture-ring absolute left-0 top-0 overflow-hidden" style={{ opacity: 0 }}>
          <div ref={fillEl} data-gesture-fill className="absolute inset-0 origin-left bg-sky-500/25" style={{ transform: "scaleX(0)" }} />
        </div>
        <span ref={hintEl} data-gesture-hint className="absolute left-0 top-0 whitespace-nowrap rounded-full bg-slate-900/85 px-2.5 py-1 text-[11px] font-medium text-white transition-opacity duration-200" style={{ opacity: 0 }}>
          Hold still to click · or pinch
        </span>
        <div ref={dotEl} className="absolute left-0 top-0 h-[5px] w-[5px] rounded-full bg-white shadow-[0_0_0_1px_rgb(15_23_42/0.6)]" style={{ opacity: 0 }} />
        <div ref={secondEl} className="lanx-gesture-ring absolute left-0 top-0 h-5 w-5 rounded-full" data-mode="zoom" style={{ opacity: 0 }} />
        <div ref={holdEl} className="absolute left-0 top-0 h-[52px] w-[52px] transition-opacity duration-150" style={{ opacity: 0 }}>
          <svg viewBox="0 0 52 52" className="absolute inset-0 -rotate-90">
            <circle cx="26" cy="26" r="24" fill="rgb(255 255 255 / 0.55)" stroke="rgb(15 23 42 / 0.18)" strokeWidth="3" />
            <circle ref={holdArc} cx="26" cy="26" r="24" fill="none" stroke="#0ea5e9" strokeWidth="3" strokeLinecap="round" strokeDasharray="150.8" strokeDashoffset="150.8" />
          </svg>
          <span ref={holdLabel} className="absolute -top-7 left-1/2 -translate-x-1/2 text-[18px]" />
        </div>
      </div>

      {/* Two hands resizing the window: a soft moving glow round the edge, and the size. */}
      <div data-gesture-ui data-gesture-glow className="lanx-glow" data-on={framing ? "" : undefined} aria-hidden />
      {framing && (
        <div data-gesture-ui data-gesture-size className="pointer-events-none fixed left-1/2 top-1/2 z-[211] -translate-x-1/2 -translate-y-1/2 rounded-full lanx-menu px-4 py-2 text-[15px] font-semibold tabular-nums text-slate-800 dark:text-slate-100 lanx-menu-in">
          {framing.fill ? "Full screen" : `${framing.w} × ${framing.h}`}
        </div>
      )}

      {/* The camera dot and its menu. */}
      {on && (
        <div className="pointer-events-none fixed left-4 bottom-[76px] z-[190] flex flex-col items-start gap-2">
          {prefs.preview && stream && status.phase === "on" && (
            <div data-gesture-ui data-gesture-preview className="relative h-[120px] w-[160px] overflow-hidden rounded-2xl lanx-menu">
              <video autoPlay muted playsInline ref={(v) => { if (v && v.srcObject !== stream) v.srcObject = stream; }} className="absolute inset-0 h-full w-full object-cover -scale-x-100" />
              <canvas ref={previewCanvas} width={160} height={120} className="absolute inset-0 h-full w-full" />
            </div>
          )}
          <div
            data-gesture-status={status.phase}
            onMouseEnter={() => setPillOpen(true)}
            onMouseLeave={() => setPillOpen(false)}
            className="flex items-center gap-1 rounded-full lanx-menu p-1 text-[11.5px] text-slate-700 dark:text-slate-200 pointer-events-auto"
          >
            <span className={`flex h-6 w-6 items-center justify-center rounded-full ${status.phase === "on" ? "bg-emerald-500 text-white" : status.phase === "error" ? "bg-red-500 text-white" : "bg-slate-500/20"}`}>
              {status.phase === "starting" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Hand className="h-3.5 w-3.5" />}
            </span>
            <span className={`flex items-center gap-1 overflow-hidden transition-[max-width,opacity] duration-300 ease-out ${pillShown ? "max-w-[380px] opacity-100" : "max-w-0 opacity-0"}`}>
              <span data-gesture-status-text className="max-w-[260px] truncate px-1" title={statusText}>{statusText}</span>
              <button type="button" title={prefs.preview ? "Hide the camera picture" : "Show the camera picture"} onClick={() => set({ preview: !prefs.preview })} className="lanx-tool h-6 w-6 shrink-0 flex items-center justify-center text-slate-500">
                {prefs.preview ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
              <button type="button" title="Gesture settings" onClick={onOpenSettings} className="lanx-tool h-6 w-6 shrink-0 flex items-center justify-center text-slate-500"><Settings2 className="h-3.5 w-3.5" /></button>
              <button type="button" data-gesture-off title="Turn gestures off (the camera stops)" onClick={() => set({ enabled: false })} className="lanx-tool h-6 w-6 shrink-0 flex items-center justify-center text-slate-500 hover:text-red-500"><Power className="h-3.5 w-3.5" /></button>
            </span>
          </div>
        </div>
      )}

      {/* Listening for a command. */}
      {voice.phase !== "idle" && (
        <div data-gesture-voice={voice.phase} className="fixed left-1/2 top-4 z-[195] -translate-x-1/2 flex items-center gap-2.5 rounded-full lanx-menu px-3 py-2 text-[12.5px] text-slate-800 dark:text-slate-100 lanx-menu-in">
          {voice.phase === "listening" ? (
            <>
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-red-500 text-white"><Mic className="h-4 w-4" /></span>
              <span className="font-semibold">Listening…</span>
              <span className="flex h-4 items-end gap-[2px]">
                {[0.5, 0.8, 1, 0.7, 0.45].map((k, i) => (
                  <span key={i} className="w-[3px] rounded-full bg-red-500 transition-[height] duration-75" style={{ height: `${Math.max(3, Math.min(16, voice.level * 22 * k))}px` }} />
                ))}
              </span>
              <span className="text-slate-400">say a command</span>
              <button type="button" onClick={stopListening} className="lanx-tool h-6 w-6 flex items-center justify-center text-slate-400"><X className="h-3.5 w-3.5" /></button>
            </>
          ) : (
            <>
              <Loader2 className="h-4 w-4 animate-spin text-slate-500" />
              <span className="font-semibold">Working it out…</span>
            </>
          )}
        </div>
      )}

      {/* What just happened. */}
      {toast && (
        <div data-gesture-toast className="fixed left-1/2 bottom-6 z-[195] -translate-x-1/2 max-w-[80vw] truncate rounded-full bg-slate-900/90 px-4 py-2 text-[12.5px] font-medium text-white shadow-lg lanx-menu-in">
          {toast}
        </div>
      )}

      {/* 🤟 the command wheel: point at one and pinch. */}
      {wheel && (
        <div data-gesture-menu="wheel" className="fixed inset-0 z-[185]" onMouseDown={() => setWheel(null)}>
          {wheelItems.map((it, i) => {
            const a = (i / wheelItems.length) * Math.PI * 2 - Math.PI / 2;
            return (
              <button
                key={it.id}
                type="button"
                data-wheel-item={it.id}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => {
                  setWheel(null);
                  it.run();
                }}
                className="lanx-wheel-item absolute flex h-[72px] w-[72px] flex-col items-center justify-center gap-1 rounded-full lanx-menu text-[10.5px] font-semibold text-slate-700 dark:text-slate-100"
                style={{ left: wheel.x + Math.cos(a) * 100 - 36, top: wheel.y + Math.sin(a) * 100 - 36, animationDelay: `${i * 25}ms` }}
              >
                {it.icon}
                {it.label}
              </button>
            );
          })}
          <button type="button" data-wheel-item="close" onClick={() => setWheel(null)} className="lanx-wheel-item absolute flex h-11 w-11 items-center justify-center rounded-full bg-slate-900/80 text-white" style={{ left: wheel.x - 22, top: wheel.y - 22 }}>
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* A list (a <select>) pinched: its choices, big enough for a hand. */}
      {choose && (
        <div data-gesture-menu="select" className="fixed inset-0 z-[185]" onMouseDown={() => setChoose(null)}>
          <div
            className="absolute max-h-[60vh] w-[260px] overflow-y-auto rounded-[14px] lanx-menu p-1.5 lanx-menu-in"
            style={{ left: Math.min(window.innerWidth - 270, choose.rect.left), top: Math.min(window.innerHeight * 0.4, choose.rect.bottom + 6) }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {Array.from(choose.el.options).map((o) => (
              <button
                key={o.value + o.index}
                type="button"
                disabled={o.disabled}
                onClick={() => {
                  const el = choose.el;
                  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(el, o.value);
                  el.dispatchEvent(new Event("input", { bubbles: true }));
                  el.dispatchEvent(new Event("change", { bubbles: true }));
                  setChoose(null);
                }}
                className={`w-full rounded-lg px-3 py-2.5 text-left text-[13px] ${o.selected ? "bg-sky-500/15 font-semibold text-sky-700 dark:text-sky-300" : "text-slate-700 dark:text-slate-200 hover:bg-[var(--lanx-fill)]"}`}
              >
                {o.text}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

const BONES: [number, number][] = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];

/** The hand's lines over the little camera picture (mirrored, like a mirror). */
function drawPreview(cv: HTMLCanvasElement | null, f: Frame) {
  const ctx = cv?.getContext("2d");
  if (!cv || !ctx) return;
  ctx.clearRect(0, 0, cv.width, cv.height);
  // The picture is cropped to fill the tile (object-cover): match that.
  const tileAspect = cv.width / cv.height;
  const sx = f.aspect > tileAspect ? f.aspect / tileAspect : 1;
  const sy = f.aspect > tileAspect ? 1 : tileAspect / f.aspect;
  const px = (x: number) => ((1 - x - 0.5) * sx + 0.5) * cv.width;
  const py = (y: number) => ((y - 0.5) * sy + 0.5) * cv.height;
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  for (const h of f.hands) {
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.beginPath();
    for (const [a, b] of BONES) {
      ctx.moveTo(px(h.lm[a * 3]), py(h.lm[a * 3 + 1]));
      ctx.lineTo(px(h.lm[b * 3]), py(h.lm[b * 3 + 1]));
    }
    ctx.stroke();
    ctx.fillStyle = "#38bdf8";
    for (let i = 0; i < 21; i++) {
      ctx.beginPath();
      ctx.arc(px(h.lm[i * 3]), py(h.lm[i * 3 + 1]), i % 4 === 0 ? 2.6 : 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
