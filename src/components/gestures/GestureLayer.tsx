import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarDays, Eye, EyeOff, Gamepad2, GraduationCap, Hand, Keyboard, Loader2, Mic, Pause, Play, Power, Settings2, SkipForward, StickyNote, X } from "lucide-react";
import { emitTo, listen as listenTauri } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api, errorText, events } from "../../lib/api";
import { player } from "../../lib/music";
import { loadDictationPrefs, startPcmRecorder, type PcmRecorder } from "../../lib/voice";
import { GestureEngine, type EngineStatus, type Frame } from "../../lib/gestures/engine";
import { type Cursor, type GEvent, GestureInterpreter, type Sign } from "../../lib/gestures/interpret";
import { DomDriver, type Target, elementAt } from "../../lib/gestures/dom";
import { type Intent, parseCommand, restoreCase, splitWho } from "../../lib/gestures/commands";
import { type GesturePrefs, useGesturePrefs } from "../../lib/gestures/prefs";
import { WindowFrame } from "../../lib/gestures/windowFrame";
import { OsDriver } from "../../lib/gestures/os";
import { type CustomSign, SignWatcher } from "../../lib/gestures/signs";
import { type CallMove, CallWatcher } from "../../lib/gestures/calls";
import { EMPTY_KB, KB_SIZE, type KbOut, type KbState, type KeyRect, applyKey, keyAt, layoutKeyboard, loadDictionary, suggest } from "../../lib/gestures/keyboard";
import { HUD_EVENT, HUD_NOTE_H, HUD_NOTE_W, type HudState } from "../../lib/gestures/hud";
import { AirKeyboard } from "./AirKeyboard";
import { setGestureLive, useGestureHint } from "../../lib/gestures/live";
import { GestureTutorial } from "./GestureTutorial";
import { IS_LINUX } from "../../lib/platform";

/** 3.7.1: the practice guide opens by itself once, the first time the camera comes on. */
const LEARNED_KEY = "lanx.gestures.learned";
const learned = () => {
  try {
    return localStorage.getItem(LEARNED_KEY) === "1";
  } catch {
    return true;
  }
};

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
  /** LANX 3.7.0: in a call or a meeting right now (hands in the air do things there). */
  inCall: () => "call" | "meeting" | null;
  /** 👍 and friends during a call or meeting; false when not in one. */
  react: (emoji: string) => boolean;
  /** Microphone off or on: the new state (true = off), null when not in a call. */
  toggleMute: () => boolean | null;
  /** A meeting's raised hand: the new state, null when not in a meeting. */
  toggleHand: () => boolean | null;
  /** Ends the call or leaves the meeting; false when there is none. */
  hangup: () => boolean;
}

type Voice = { phase: "idle" } | { phase: "listening"; level: number; typing?: boolean } | { phase: "thinking" };
/** A text box hands can type into (the air keyboard). */
const isEditable = (el: Element | null): el is HTMLElement =>
  !!el &&
  !el.closest("[data-air-keyboard]") &&
  ((el instanceof HTMLInputElement && /^(text|search|email|url|tel|password|number|)$/.test(el.type)) || el instanceof HTMLTextAreaElement || (el instanceof HTMLElement && el.isContentEditable));
/** A wave starts this countdown before the call ends (a fist stays). */
const ENDING_MS = 3000;
const SIGN_EMOJI: Record<Sign, string> = { yes: "👍", no: "👎", listen: "✌️", wheel: "🤟" };
const BOX = 28;
/** LANX 3.6.1: hold the pointer still on a button this long and it clicks (no pinch needed). */
const DWELL_MS = 900;
/** LANX 3.6.2: once the pointer is on a button it stays "on" it while within this many px
 *  of its edges — a hand held in the air sways 20–40 px, and small icons sit 34 px apart. */
const STICK_PX = 22;
/** It must have travelled this far (px) in the moment before reaching the button: a hand that
 *  was only resting in view (chin on hand…) never clicks. */
const DWELL_ARRIVE = 40;
const DWELL_ARRIVE_MS = 1500;
/** LANX 3.6.2: a pinch presses the button the pointer showed most over this long before
 *  (a closing hand makes the pointer jump 50–90 px, measured on a real hand). */
const LIT_MS = 350;
/** A pinch this soon after holding still clicked the same button is that same click. */
const DWELL_PINCH_MS = 1200;
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
  /** Which button the pointer showed, frame by frame (for the next pinch). */
  const litHist = useRef<{ t: number; el: Element | null }[]>([]);
  const dwellClick = useRef<{ el: Element; at: number } | null>(null);
  const flashUntil = useRef(0);
  const hintsLeft = useRef(clicksSoFar() < HINT_CLICKS);
  const previewCanvas = useRef<HTMLCanvasElement>(null);
  const toastTimer = useRef(0);
  // (3.7.0: was 0 — the page clock starts at 0 too, so the camera was ignored for its first 10 s.)
  const fedAt = useRef(-Infinity);
  const statusRef = useRef(status);
  statusRef.current = status;

  // ---- LANX 3.7.0: the whole PC, the air keyboard, your own signs, calls
  const os = useRef<OsDriver | null>(null);
  /** This PC's mouse can be driven (Windows): null until known. */
  const [pcReady, setPcReady] = useState<boolean | null>(null);
  const pc = !!prefs?.enabled && !!prefs.pc && pcReady === true;
  const pcRef = useRef(pc);
  pcRef.current = pc;
  /** The hand's point in "whole PC" mode (LANX's own ring isn't drawn then). */
  const pointer = useRef<Cursor | null>(null);
  const signWatch = useRef(new SignWatcher());
  const callWatch = useRef(new CallWatcher());
  /** A sign of the user's or a call gesture being held: shown on the hold ring. */
  const extraHold = useRef<{ label: string; p: number } | null>(null);
  /** A pinch skipped because a sign of the user's was up (its release is skipped too). */
  const skipped = useRef(false);
  /** Teaching a sign: frames go to the teacher, nothing else happens. */
  const teaching = useRef(false);
  const ending = useRef<{ until: number } | null>(null);
  const [endingLeft, setEndingLeft] = useState<number | null>(null);
  const [kb, setKb] = useState<KbState | null>(null);
  const kbRef = useRef(kb);
  kbRef.current = kb;
  const [kbHover, setKbHover] = useState<string | null>(null);
  const kbHoverRef = useRef(kbHover);
  kbHoverRef.current = kbHover;
  const [kbPressed, setKbPressed] = useState<string | null>(null);
  const kbPress = useRef<KeyRect | null>(null);
  const kbPanel = useRef<HTMLDivElement>(null);
  /** The LANX text box the keyboard types into. */
  const kbTarget = useRef<HTMLElement | null>(null);
  const hudRect = useRef<{ x: number; y: number; width: number; height: number; scale: number } | null>(null);
  const hudSize = useRef("");
  const [hudNote, setHudNote] = useState<{ text: string; tone?: "red" } | null>(null);
  const hudTimer = useRef(0);
  /** 3.7.1: inside LANX a drag and a fist scroll glide at screen rate between camera frames. */
  const dragAim = useRef<{ x: number; y: number } | null>(null);
  const dragAt = useRef<{ x: number; y: number } | null>(null);
  const grabLeft = useRef({ dx: 0, dy: 0 });
  const hint = useGestureHint();
  const [learn, setLearn] = useState(false);

  const say = useCallback((t: string, ms = 2200) => {
    window.clearTimeout(toastTimer.current);
    setToast(t);
    toastTimer.current = window.setTimeout(() => setToast(null), ms);
    // Controlling the whole PC with LANX out of sight: the note shows over the other programs.
    if (pcRef.current && !focusedRef.current) {
      window.clearTimeout(hudTimer.current);
      setHudNote({ text: t });
      hudTimer.current = window.setTimeout(() => setHudNote(null), ms);
    }
  }, []);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  /** Keys and typing for the whole PC (made on first use: keys and text need no screen). */
  const osFor = useCallback(() => (os.current ??= new OsDriver((t) => onErrorRef.current(t))), []);

  /** LANX 3.7.0: commands the gesture layer does itself (the keyboard, keys, the PC…); null: not one of those. */
  const runLocal = useRef<(intent: Intent) => Promise<string | null>>(async () => null);

  // ---- spoken commands (✌, the wheel, or Ctrl + Alt + J)
  /** The words heard → done, with a note of what happened. */
  const act = useCallback(async (said: string) => {
    let intent = parseCommand(said);
    if (intent.kind === "message" && intent.rest !== undefined) intent = { ...intent, ...splitWho(intent.rest, actionsRef.current.names()) };
    if (intent.kind === "message" || intent.kind === "note" || intent.kind === "type") intent = { ...intent, text: restoreCase(said, intent.text) };
    const result = (await runLocal.current(intent)) ?? (await actionsRef.current.run(intent));
    say(`“${said}” — ${result}`, 3600);
    return result;
  }, [say]);
  const rec = useRef<PcmRecorder | null>(null);
  const askedForModel = useRef(false);
  /** `asked`: a key or a button (always explains); ✌ explains once, then just says so. */
  /** Listens until the speaker stops and answers with the words (null: nothing, with a note why).
   *  Leaves the "Working it out…" state on for the caller to end. 3.7.0: shared by commands and
   *  the keyboard's microphone key (`typing`). */
  const hear = useCallback(async (asked: boolean, typing: boolean): Promise<string | null> => {
    if (voiceRef.current.phase !== "idle") return null;
    const dp = await loadDictationPrefs();
    const models = await api.voiceModels().catch(() => []);
    const model = models.find((m) => m.id === dp.model && m.downloaded) ?? models.find((m) => m.downloaded);
    if (!model) {
      if (asked || !askedForModel.current) {
        askedForModel.current = true;
        onError(`${typing ? "Typing by voice" : "Spoken commands"} need the speech model once: open Voice settings and download it.`);
        onOpenVoiceSettings();
      } else say("✌ Spoken commands need the speech model (Voice settings)");
      return null;
    }
    let r: PcmRecorder;
    try {
      r = await startPcmRecorder();
    } catch (e) {
      onError(`Microphone: ${errorText(e)}`);
      return null;
    }
    rec.current = r;
    setVoice({ phase: "listening", level: 0, typing });
    let heard = false;
    let quietSince = 0;
    let peak = 0;
    // The room's own level, from the first moments: speech is clearly above it (3.6.2 — a fixed
    // level missed quieter voices and microphones).
    const room: number[] = [];
    await new Promise<void>((done) => {
      const tick = window.setInterval(() => {
        if (rec.current !== r) {
          window.clearInterval(tick);
          done();
          return;
        }
        const lv = r.level();
        const secs = r.seconds();
        setVoice({ phase: "listening", level: lv, typing });
        if (secs < 0.35) room.push(lv);
        const floor = room.length ? room.reduce((a, b) => a + b, 0) / room.length : 0.02;
        const loud = Math.max(0.05, floor * 2.2 + 0.02);
        const soft = Math.max(0.03, floor * 1.4 + 0.01);
        peak = Math.max(peak, lv - floor);
        if (secs >= 0.35 && lv > loud) {
          heard = true;
          quietSince = 0;
        } else if (heard && lv < soft && !quietSince) quietSince = performance.now();
        if ((heard && quietSince && performance.now() - quietSince > 900) || secs > 8 || (!heard && secs > 6)) {
          window.clearInterval(tick);
          done();
        }
      }, 80);
    });
    if (rec.current !== r) {
      void r.stop();
      return null; // cancelled
    }
    rec.current = null;
    const pcm = await r.stop();
    // Any voice at all: let the speech engine decide what was said.
    if ((!heard && peak < 0.03) || pcm.length < 8000) {
      setVoice({ phase: "idle" });
      say("I didn't hear anything. Speak as soon as the red “Listening…” appears.", 4000);
      return null;
    }
    setVoice({ phase: "thinking" });
    try {
      // English letters even for Hinglish ("Bharat ko call karo"), which the rules understand.
      const t = await api.transcribe(pcm, model.id, "en");
      const said = t.text.trim();
      if (!said) {
        setVoice({ phase: "idle" });
        say("I didn't catch that. Try again a little closer to the microphone.");
        return null;
      }
      return said;
    } catch (e) {
      setVoice({ phase: "idle" });
      say(errorText(e), 3600);
      return null;
    }
  }, [onError, onOpenVoiceSettings, say]);
  const listen = useCallback(async (asked = true) => {
    const said = await hear(asked, false);
    if (!said) return;
    try {
      await act(said);
    } catch (e) {
      say(errorText(e), 3600);
    } finally {
      setVoice({ phase: "idle" });
    }
  }, [hear, act, say]);
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

  // ---- LANX 3.7.0: the air keyboard
  // The text box it types into: the last one used in LANX.
  useEffect(() => {
    const on = (e: FocusEvent) => {
      if (isEditable(e.target as Element | null)) kbTarget.current = e.target as HTMLElement;
    };
    document.addEventListener("focusin", on);
    return () => document.removeEventListener("focusin", on);
  }, []);
  const openKb = useCallback(() => {
    if (!kbRef.current) setKb({ ...EMPTY_KB, suggestions: suggest("") });
    void loadDictionary();
  }, []);
  /** Into LANX's own text box (the keyboard inside the LANX window). */
  const typeInLanx = useCallback((text: string) => {
    const el = kbTarget.current;
    if (!el?.isConnected) return say("Pick a text box first (pinch it), then type.");
    if (document.activeElement !== el) el.focus();
    document.execCommand("insertText", false, text);
  }, [say]);
  const keyInLanx = useCallback((code: "Backspace" | "Enter" | "ArrowLeft" | "ArrowRight") => {
    const el = kbTarget.current;
    if (!el?.isConnected) return;
    if (document.activeElement !== el) el.focus();
    if (code === "Backspace") {
      document.execCommand("delete");
      return;
    }
    if (code === "Enter") {
      // The chat box sends on Enter; other boxes get a new line.
      const ok = el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
      if (ok && !(el instanceof HTMLInputElement)) document.execCommand("insertText", false, "\n");
      return;
    }
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      const at = Math.max(0, Math.min(el.value.length, (el.selectionStart ?? 0) + (code === "ArrowLeft" ? -1 : 1)));
      el.setSelectionRange(at, at);
    }
  }, []);
  const typeText = useCallback((text: string) => (pcRef.current ? osFor().text(text) : typeInLanx(text)), [osFor, typeInLanx]);
  const typeKey = useCallback((code: "Backspace" | "Enter" | "ArrowLeft" | "ArrowRight") => (pcRef.current ? osFor().key(code) : keyInLanx(code)), [osFor, keyInLanx]);
  /** The keyboard's microphone: what is said gets typed. */
  const dictate = useCallback(async () => {
    const said = await hear(true, true);
    setVoice({ phase: "idle" });
    if (said) typeText(`${said} `);
  }, [hear, typeText]);
  const doOut = useCallback((o: KbOut) => {
    switch (o.kind) {
      case "text": return typeText(o.text);
      case "key": return typeKey(o.code);
      case "backspaces":
        for (let i = 0; i < o.n; i++) typeKey("Backspace");
        return;
      case "close": return setKb(null);
      case "mic": return void dictate();
    }
  }, [typeText, typeKey, dictate]);
  const pressKey = useCallback((k: KeyRect) => {
    const cur = kbRef.current;
    if (!cur) return;
    const { state, out } = applyKey(cur, k);
    setKb(state);
    for (const o of out) doOut(o);
  }, [doOut]);
  /** The key under the hand's point (LANX's panel, or the hands window over other programs). */
  const kbKeyAt = useCallback((x: number, y: number): KeyRect | null => {
    const st = kbRef.current;
    if (!st) return null;
    if (pcRef.current) {
      const r = hudRect.current;
      const o = os.current;
      if (!r || !o) return null;
      const real = o.toReal(x, y);
      return keyAt(layoutKeyboard(KB_SIZE.w, KB_SIZE.h, st), (real.x - r.x) / r.scale, (real.y - r.y) / r.scale - HUD_NOTE_H);
    }
    const panel = kbPanel.current?.getBoundingClientRect();
    if (!panel) return null;
    return keyAt(layoutKeyboard(panel.width, panel.height, st), x - panel.left, y - panel.top);
  }, []);
  /** Pinches over the keyboard press its keys (they never reach what is under it). */
  const kbTakes = useCallback((e: GEvent): boolean => {
    if (!kbRef.current) return false;
    switch (e.type) {
      case "press": {
        const k = kbKeyAt(e.x, e.y);
        if (!k) return false;
        kbPress.current = k;
        setKbPressed(k.id);
        return true;
      }
      case "drag":
        return !!kbPress.current;
      case "longpress": {
        const k = kbPress.current;
        if (!k) return false;
        // Holding ⌫ deletes the whole word before.
        if (k.kind === "back") {
          kbPress.current = null;
          setKbPressed(null);
          if (pcRef.current) osFor().chord(["ControlLeft", "Backspace"]);
          else for (let i = 0; i < Math.max(1, kbRef.current.word.length); i++) keyInLanx("Backspace");
          setKb((s) => (s ? { ...s, word: "", suggestions: suggest("") } : s));
        }
        return true;
      }
      case "release": {
        const k = kbPress.current;
        if (!k) return false;
        kbPress.current = null;
        setKbPressed(null);
        // A hand drifts while pinching: still that key if it ends on it (or was a quick pinch).
        if (e.click || kbKeyAt(e.x, e.y)?.id === k.id) pressKey(k);
        return true;
      }
      case "cancel":
        if (!kbPress.current) return false;
        kbPress.current = null;
        setKbPressed(null);
        return true;
      default:
        return false;
    }
  }, [kbKeyAt, pressKey, osFor, keyInLanx]);

  // ---- LANX 3.7.0: the user's own signs, and hands in calls
  const runSign = useCallback((s: CustomSign) => {
    say(`🖐 ${s.name || s.command}`, 1600);
    void act(s.command);
  }, [act, say]);
  const cancelEnding = useCallback((note = true) => {
    if (!ending.current) return;
    ending.current = null;
    setEndingLeft(null);
    if (note) say("✊ Staying in the call");
  }, [say]);
  const onCallMove = useCallback((m: CallMove, where: "call" | "meeting") => {
    const a = actionsRef.current;
    if (m === "raise") {
      if (where !== "meeting") return say("✋ Raising a hand works in meetings");
      const up = a.toggleHand();
      if (up !== null) say(up ? "✋ Hand raised" : "Hand lowered");
    } else if (m === "mute") {
      const off = a.toggleMute();
      if (off !== null) say(off ? "🔇 Microphone off" : "🎙 Microphone on");
    } else if (!ending.current) {
      ending.current = { until: performance.now() + ENDING_MS };
      setEndingLeft(Math.ceil(ENDING_MS / 1000));
    }
  }, [say]);
  // The countdown after a wave.
  useEffect(() => {
    if (endingLeft === null) return;
    const t = window.setInterval(() => {
      const e = ending.current;
      if (!e) return;
      const left = e.until - performance.now();
      if (left <= 0) {
        ending.current = null;
        setEndingLeft(null);
        if (actionsRef.current.hangup()) say("👋 Call ended");
      } else setEndingLeft(Math.ceil(left / 1000));
    }, 200);
    return () => window.clearInterval(t);
  }, [endingLeft !== null, say]); // eslint-disable-line react-hooks/exhaustive-deps

  // Commands the gesture layer does itself.
  runLocal.current = async (intent: Intent): Promise<string | null> => {
    const a = actionsRef.current;
    switch (intent.kind) {
      case "keyboard": {
        const open = intent.open ?? !kbRef.current;
        if (open) openKb();
        else setKb(null);
        return open ? "Keyboard open: point at a key and pinch" : "Keyboard closed";
      }
      case "type":
        typeText(intent.text);
        return "Typed";
      case "keys":
        osFor().chord(intent.keys);
        return `Pressed ${intent.label}`;
      case "screenshot":
        // Windows saves it by itself (Pictures → Screenshots).
        osFor().chord(["MetaLeft", "PrintScreen"]);
        return "Screenshot saved in Pictures → Screenshots";
      case "lock":
        await api.lockPc();
        return "Locked";
      case "show-lanx": {
        const w = getCurrentWindow();
        await w.unminimize().catch(() => {});
        await w.show().catch(() => {});
        await w.setFocus().catch(() => {});
        return "Here's LANX";
      }
      case "mute-toggle": {
        const off = a.toggleMute();
        return off === null ? "There's no call right now." : off ? "Microphone off" : "Microphone on";
      }
      case "hand-toggle": {
        const up = a.toggleHand();
        return up === null ? "Raising a hand works in a meeting." : up ? "✋ Hand raised" : "Hand lowered";
      }
      default:
        return null;
    }
  };

  // ---- signs and flicks
  const onSign = useCallback((sign: Sign) => {
    const a = actionsRef.current;
    // Over other programs (whole PC), Esc and arrows go to the program in front.
    const elsewhere = pcRef.current && !focusedRef.current;
    if (sign === "yes") {
      if (a.yes()) return say("👍 Answered");
      // 3.7.0: in a call or meeting, a 👍 for everyone to see.
      if (prefsRef.current?.calls !== false && a.inCall() && a.react("👍")) return say("👍");
      // 👍 over a message: like it.
      const c = cursor.current;
      const msg = c ? elementAt(c.x, c.y)?.closest("[data-msg]")?.getAttribute("data-msg") : null;
      if (msg) void a.run({ kind: "react", emoji: "👍", messageId: msg }).then((t) => say(`👍 ${t}`));
      else say("👍");
    } else if (sign === "no") {
      if (a.no()) return say("👎 Declined");
      if (elsewhere) osFor().key("Escape");
      else if (!a.close()) driver.current?.key("Escape");
      say("👎 Closed");
    } else if (sign === "listen") {
      if (prefsRef.current?.voice) void listen(false);
    } else if (sign === "wheel") {
      // 3.7.0: over other programs 🤟 opens and closes the keyboard.
      if (pcRef.current) return void runLocal.current({ kind: "keyboard", open: null }).then((t) => t && say(`🤟 ${t}`));
      const c = cursor.current;
      if (c) setWheel({ x: Math.min(window.innerWidth - 130, Math.max(130, c.x)), y: Math.min(window.innerHeight - 130, Math.max(130, c.y)) });
    }
  }, [listen, say, osFor]);

  const onSwipe = useCallback((dir: "left" | "right" | "up" | "down") => {
    const elsewhere = pcRef.current && !focusedRef.current;
    if (wheelRef.current) {
      setWheel(null);
      return;
    }
    // Whatever is open (a game, the PDF tools) may take the flick for itself.
    const ev = new CustomEvent("lanx:gesture-swipe", { cancelable: true, detail: { dir } });
    if (!window.dispatchEvent(ev)) return;
    if (dir === "up") {
      if (elsewhere) osFor().key("Escape");
      else if (!actionsRef.current.close()) driver.current?.key("Escape");
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
    const key = dir === "left" ? "ArrowRight" : "ArrowLeft";
    if (elsewhere) osFor().key(key);
    else driver.current?.key(key);
  }, [say, osFor]);

  /** A text box picked by hand in LANX: the keyboard comes up for it. */
  const afterClick = useCallback(() => {
    requestAnimationFrame(() => {
      if (prefsRef.current?.keyboard !== false && !kbRef.current && isEditable(document.activeElement)) openKb();
    });
  }, [openKb]);
  /** Controlling the whole PC: the same moves on this PC's real mouse. */
  const handleOs = useCallback((e: GEvent, o: OsDriver) => {
    switch (e.type) {
      case "press": return o.pressAt(e.x, e.y);
      case "drag": return o.drag(e.x, e.y);
      case "release": return o.release(e.x, e.y, e.click, e.double);
      case "cancel": return o.cancel();
      case "longpress": return o.longPress(e.x, e.y);
      case "grab": return o.grab();
      case "grab-move": return o.grabMove(e.dx, e.dy);
      case "grab-end": return o.grabEnd(e.vx, e.vy);
      case "zoom-start": return o.zoomStart();
      case "zoom": return o.zoom(e.scale);
      case "swipe": return onSwipe(e.dir);
      case "sign": return onSign(e.sign);
      // 3.11.2: both hands held up resize the window between them, in any program.
      case "frame-start": return o.frameStart(e.cx, e.cy, (t) => say(t, 2600));
      case "frame": return o.frameSet(e.scale);
      case "frame-end": return o.frameEnd((t) => say(t, 2600));
      default: return;
    }
  }, [onSwipe, onSign, say]);
  const handle = useCallback((e: GEvent) => {
    if (kbTakes(e)) return;
    if (pcRef.current && os.current) return handleOs(e, os.current);
    const d = driver.current;
    if (!d) return;
    switch (e.type) {
      case "press": {
        if (dwell.current) dwell.current.done = true;
        // The button that was lit as the fingers came together (ties: the latest).
        const h = litHist.current;
        const end = h.length ? h[h.length - 1].t : 0;
        const seen = new Map<Element, number>();
        for (const s of h) if (s.el && end - s.t <= LIT_MS) seen.set(s.el, (seen.get(s.el) ?? 0) + 1);
        let lit: Element | null = null;
        let most = 0;
        for (const [el, n] of seen) if (n >= most) [lit, most] = [el, n];
        const dc = dwellClick.current;
        if (dc && lit === dc.el && (lastFrame.current?.t ?? 0) - dc.at < DWELL_PINCH_MS) return;
        d.press(e.x, e.y, lit);
        return afterClick();
      }
      case "drag":
        // Eased towards the hand by the drawing loop (no steps between camera frames).
        if (statusRef.current.phase !== "on") return d.drag(e.x, e.y);
        dragAim.current = { x: e.x, y: e.y };
        if (!dragAt.current) {
          dragAt.current = { x: e.x, y: e.y };
          d.drag(e.x, e.y);
        }
        return;
      case "release":
        if (dragAt.current) d.drag(e.x, e.y);
        dragAim.current = dragAt.current = null;
        if (e.click) {
          countClick();
          hintsLeft.current = clicksSoFar() < HINT_CLICKS;
        }
        d.release(e.x, e.y, e.click, e.double);
        if (e.click) afterClick();
        return;
      case "cancel":
        dragAim.current = dragAt.current = null;
        return d.cancel();
      case "longpress": return d.longPress(e.x, e.y);
      case "grab":
        grabLeft.current = { dx: 0, dy: 0 };
        return d.grab(e.x, e.y);
      case "grab-move":
        // Let out by the drawing loop, a share each screen refresh.
        if (statusRef.current.phase !== "on") return d.grabMove(e.dx, e.dy);
        grabLeft.current.dx += e.dx;
        grabLeft.current.dy += e.dy;
        return;
      case "grab-end": {
        const g = grabLeft.current;
        if (g.dx || g.dy) d.grabMove(g.dx, g.dy);
        grabLeft.current = { dx: 0, dy: 0 };
        return d.grabEnd(e.vx, e.vy);
      }
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
  }, [onSign, onSwipe, kbTakes, handleOs, afterClick]);
  const handleRef = useRef(handle);
  handleRef.current = handle;

  // ---- each frame from the camera
  /** What the frame handler calls (kept current; the handler itself never changes). */
  const fx = useRef({ runSign, onCallMove, cancelEnding, kbKeyAt, afterClick });
  fx.current = { runSign, onCallMove, cancelEnding, kbKeyAt, afterClick };
  const onFrame = useCallback((f: Frame) => {
    const p = prefsRef.current;
    const g = interp.current;
    const d = driver.current;
    if (!p || !g || !d) return;
    lastFrame.current = f;
    // 3.7.0: teaching a sign — the frames go to the teacher, nothing else happens.
    if (teaching.current) {
      window.dispatchEvent(new CustomEvent("lanx:gesture-frame", { detail: f }));
      cursor.current = null;
      pointer.current = null;
      target.current = null;
      d.leave();
      setHasHand((h) => (h === f.hands.length > 0 ? h : f.hands.length > 0));
      drawPreview(previewCanvas.current, f);
      return;
    }
    const fn = fx.current;
    // The user's own signs, and hands in calls, look at the hands first.
    const sw = signWatch.current.update(f, p.signs ?? []);
    if (sw.fired) fn.runSign(sw.fired);
    const where = p.calls !== false ? actionsRef.current.inCall() : null;
    const cw = where ? callWatch.current.update(f) : null;
    if (!where) callWatch.current.reset();
    if (cw?.fired && where) fn.onCallMove(cw.fired, where);
    if (cw?.fist && ending.current) fn.cancelEnding();
    extraHold.current = sw.holding ? { label: "🖐", p: sw.holding.p } : cw?.holding ? { label: cw.holding.move === "raise" ? "✋" : "🔇", p: cw.holding.p } : null;
    const P = pcRef.current ? os.current : null;
    // (No flicks in a call: a wave would skip songs.)
    g.opts = { speed: p.speed, hand: p.hand, swipes: p.swipes && !where };
    const out = P ? g.update(f, P.w, P.h) : g.update(f, window.innerWidth, window.innerHeight);
    const active = !!P || focusedRef.current;
    for (const e of out.events) {
      // A sign of the user's is up: its pinch waits (and so does the release that goes with it).
      if (e.type === "press" && sw.active) {
        skipped.current = true;
        continue;
      }
      if (skipped.current && (e.type === "drag" || e.type === "release" || e.type === "cancel" || e.type === "longpress")) {
        if (e.type === "release" || e.type === "cancel") skipped.current = false;
        continue;
      }
      // Behind other windows only the signs work (👍 answers a call, ✌ listens).
      if (active || e.type === "sign") handleRef.current(e);
    }
    const pt = active ? out.cursor : null;
    setGestureLive({ on: true, pc: !!P, tracking: out.tracking, mode: pt?.mode ?? null, x: P ? null : pt?.x ?? null, y: P ? null : pt?.y ?? null, holding: pt?.hold?.sign ?? null });
    // The keyboard key under the hand.
    const hoverKey = kbRef.current && pt && (pt.mode === "point" || pt.mode === "press") ? fn.kbKeyAt(pt.x, pt.y)?.id ?? null : null;
    if (hoverKey !== kbHoverRef.current) setKbHover(hoverKey);
    if (P) {
      // The whole PC: the real mouse follows the hand (LANX's own ring isn't drawn).
      pointer.current = pt;
      cursor.current = null;
      second.current = null;
      target.current = null;
      dwell.current = null;
      dwellP.current = 0;
      if (pt && (pt.mode === "point" || pt.mode === "drag")) P.move(pt.x, pt.y);
      else if (!pt) P.leave();
      P.tick(performance.now());
      setHasHand((h) => (h === out.tracking > 0 ? h : out.tracking > 0));
      drawPreview(previewCanvas.current, f);
      return;
    }
    pointer.current = null;
    const c = pt;
    cursor.current = c;
    second.current = active ? out.second : null;
    // Over the keyboard: its keys, not what is under it.
    const kbBox = kbRef.current ? kbPanel.current?.getBoundingClientRect() : null;
    const overKb = !!c && !!kbBox && c.x >= kbBox.left - 14 && c.x <= kbBox.right + 14 && c.y >= kbBox.top - 14 && c.y <= kbBox.bottom + 14;
    let under: Element | null = null;
    if (c && !overKb) {
      let t = d.move(c.x, c.y, c.mode !== "point");
      under = t?.el ?? null;
      // Sticky: the button the pointer is on keeps it while the hand sways a little,
      // even when a neighbour is now nearer.
      const cur = target.current;
      if (c.mode === "point" && cur && t?.el !== cur.el && cur.el.isConnected) {
        const r = cur.el.getBoundingClientRect();
        if (c.x >= r.left - STICK_PX && c.x <= r.right + STICK_PX && c.y >= r.top - STICK_PX && c.y <= r.bottom + STICK_PX) t = { ...cur, rect: r };
      }
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
    if (c?.mode === "point") {
      // What is really under the pointer (not the sway-sticky one): just arrived on the next
      // button and pinched at once, it is that button.
      litHist.current.push({ t: f.t, el: under });
      while (litHist.current.length && f.t - litHist.current[0].t > LIT_MS) litHist.current.shift();
    } else if (!c) litHist.current = [];
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
          d.press(x, y, t.el);
          d.release(x, y, true, false);
          dwellClick.current = { el: t.el, at: f.t };
          fn.afterClick();
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
  // 3.7.0: controlling the whole PC keeps going while LANX is hidden or minimised.
  const wanted = !!prefs?.enabled && !locked && (!hidden || pc);
  useEffect(() => {
    if (!prefs?.enabled || !prefs.pc) {
      os.current?.leave();
      return;
    }
    let alive = true;
    void osFor()
      .init()
      .then((ok) => {
        if (!alive) return;
        setPcReady(ok);
        if (!ok) onErrorRef.current("Controlling the whole PC works on Windows for now.");
      });
    return () => {
      alive = false;
    };
  }, [prefs?.enabled, prefs?.pc, osFor]);
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
  // A phone just connected while there was no camera: it can lend its own (3.6.2).
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let off: (() => void) | undefined;
    void events.onPhoneChanged(() => statusRef.current.phase === "error" && setRetry((n) => n + 1)).then((u) => (off = u));
    return () => off?.();
  }, []);
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    e.stop();
    setStream(null);
    interp.current?.reset();
    driver.current?.leave();
    cursor.current = null;
    target.current = null;
    os.current?.leave();
    if (wanted) void e.start(prefs?.camera).then((ok) => setStream(ok ? e.stream : null));
  }, [wanted, prefs?.camera, prefs?.enabled, retry]);
  // 3.7.0: switching to (or from) the whole PC keeps the camera going; the pointer starts afresh.
  useEffect(() => {
    interp.current?.reset();
    driver.current?.leave();
    os.current?.leave();
    cursor.current = null;
    target.current = null;
  }, [pc]);

  useEffect(() => {
    setGestureLive({ on: status.phase === "on", pc, ...(status.phase === "on" ? {} : { tracking: 0, mode: null, x: null, y: null, holding: null }) });
  }, [status.phase, pc]);
  useEffect(() => () => setGestureLive({ on: false, tracking: 0, mode: null, x: null, y: null, holding: null }), []);

  // ---- 3.7.0: the hands window over other programs (keyboard, notes) while controlling the whole PC
  const voiceNote = voice.phase === "listening" ? (voice.typing ? "Listening… say what to type" : "Listening… say a command") : voice.phase === "thinking" ? "Working it out…" : null;
  const endingNote = endingLeft !== null ? `👋 Ending the call in ${endingLeft}… make a fist to stay` : null;
  const sendHud = useRef<() => void>(() => {});
  useEffect(() => {
    const o = os.current;
    const away = !focused;
    const note = endingNote ?? (away ? voiceNote ?? hudNote?.text ?? (prefsRef.current?.hints !== false ? hint : null) : null);
    const red = !!endingNote || (away && voice.phase === "listening");
    const show = pc && !!o && (!!kb || !!note);
    const w = kb ? KB_SIZE.w : HUD_NOTE_W;
    const h = HUD_NOTE_H + (kb ? KB_SIZE.h : 0);
    const size = show ? `${w}x${h}` : "";
    const state: HudState = { kb, hover: kbHover, pressed: kbPressed, listening: voice.phase === "listening" && !!voice.typing, note, noteTone: red ? "red" : "plain", dark: document.documentElement.classList.contains("dark") };
    sendHud.current = () => {
      if ("__TAURI_INTERNALS__" in window) void emitTo("hud", HUD_EVENT, state).catch(() => {});
    };
    if (size !== hudSize.current) {
      hudSize.current = size;
      if (!show) hudRect.current = null;
      void api
        .handHud(o?.screen ?? 0, show ? w : 0, show ? h : 0)
        .then((r) => {
          if (!show) return;
          hudRect.current = r;
          sendHud.current();
        })
        .catch(() => {});
    } else if (show) sendHud.current();
  }, [pc, kb, kbHover, kbPressed, hudNote, voice.phase, voice.phase === "listening" && voice.typing, endingNote, voiceNote, focused, hint]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    // The hands window asks for what to show once it has loaded.
    let off: (() => void) | undefined;
    let gone = false;
    void listenTauri("lanx:hud-ready", () => sendHud.current())
      .then((u) => (gone ? u() : (off = u)))
      .catch(() => {});
    return () => {
      gone = true;
      off?.();
      if (hudSize.current) void api.handHud(0, 0, 0).catch(() => {});
    };
  }, []);
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
      /** LANX 3.7.0 */
      keyboard: () => kbRef.current,
      kbHover: () => kbHoverRef.current,
      openKeyboard: () => openKb(),
      inCall: () => actionsRef.current.inCall(),
      /** Controlling the whole PC: the screen in pointer units and real pixels, and the hands window. */
      pc: () => (pcRef.current && os.current ? { w: os.current.w, h: os.current.h, real: os.current.real, hud: hudRect.current } : null),
    };
    return () => {
      delete w.__lanxGestures;
    };
  }, [prefs?.enabled, onFrame, act, openKb]);
  // 3.7.1: the practice guide — once by itself when the camera first comes on, and on request.
  useEffect(() => {
    if (status.phase === "on" && !learned()) setLearn(true);
  }, [status.phase]);
  useEffect(() => {
    const on = () => {
      setLearn(true);
      const p = prefsRef.current;
      if (p && !p.enabled) setPrefs({ ...p, enabled: true });
    };
    window.addEventListener("lanx:gesture-learn", on);
    return () => window.removeEventListener("lanx:gesture-learn", on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const closeLearn = () => {
    setLearn(false);
    try {
      localStorage.setItem(LEARNED_KEY, "1");
    } catch {}
  };

  // 3.7.0: Gesture settings → "Teach a sign" borrows the camera's frames for a moment.
  useEffect(() => {
    const on = (e: Event) => {
      teaching.current = !!(e as CustomEvent<{ on: boolean }>).detail?.on;
      interp.current?.reset();
      signWatch.current.reset();
    };
    window.addEventListener("lanx:gesture-teach", on);
    return () => window.removeEventListener("lanx:gesture-teach", on);
  }, []);
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
      // 3.7.1: a drag follows the hand smoothly, and a fist scroll is let out evenly.
      const dv = driver.current;
      const da = dragAim.current;
      const dp = dragAt.current;
      if (dv && da && dp) {
        const k = 1 - Math.exp(-dt * 28);
        const nx = dp.x + (da.x - dp.x) * k;
        const ny = dp.y + (da.y - dp.y) * k;
        if (Math.abs(nx - dp.x) + Math.abs(ny - dp.y) > 0.3) {
          dp.x = nx;
          dp.y = ny;
          dv.drag(nx, ny);
        }
      }
      const gl = grabLeft.current;
      if (dv && (Math.abs(gl.dx) > 0.5 || Math.abs(gl.dy) > 0.5)) {
        const k = 1 - Math.exp(-dt * 22);
        const px = gl.dx * k;
        const py = gl.dy * k;
        gl.dx -= px;
        gl.dy -= py;
        dv.grabMove(px, py);
      }
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
        // LANX's signs, or (3.7.0) the user's own and the ones in calls.
        const h = c?.hold ? { label: SIGN_EMOJI[c.hold.sign], p: c.hold.p } : extraHold.current;
        hold.style.opacity = h && c ? "1" : "0";
        if (h && c) {
          hold.style.transform = `translate3d(${c.x - 26}px, ${c.y - 26}px, 0)`;
          holdArc.current.style.strokeDashoffset = String(150.8 * (1 - h.p));
          holdLabel.current.textContent = h.label;
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
    { id: "keyboard", label: "Keyboard", icon: <Keyboard className="h-5 w-5" />, run: openKb },
  ];

  const statusText =
    status.phase === "starting" ? "Starting the camera…"
    : status.phase === "error" ? status.message ?? "The camera stopped"
    : status.phase === "on" && pc ? (hasHand ? "Your hand is the mouse, in every program" : "Show your open hand: it moves the mouse")
    : status.phase === "on" ? (focused ? (hasHand ? "Following your hand" : "Show your open hand") : "In the background: 👍 ✌ still work")
    : locked ? "Paused while LANX is locked"
    : hidden ? "Paused while LANX is hidden"
    : "Off";

  if (!prefs) return null;
  const on = prefs.enabled;
  // The keyboard inside LANX: opposite the text box, so what is typed stays in view.
  const kbW = Math.min(KB_SIZE.w, window.innerWidth - 24);
  const kbH = Math.round((kbW * KB_SIZE.h) / KB_SIZE.w);
  const kbBox = kb && !pc && kbTarget.current?.isConnected ? kbTarget.current.getBoundingClientRect() : null;
  const kbTop = !!kbBox && kbBox.top + kbBox.height / 2 > window.innerHeight / 2;
  const kbBottom = !!kb && !pc && !kbTop;
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
        <div className="pointer-events-none fixed left-4 bottom-[76px] z-[190] flex flex-col items-start gap-2" style={kbBottom ? { bottom: kbH + 20 } : undefined}>
          {prefs.preview && stream && status.phase === "on" && (
            <div data-gesture-ui data-gesture-preview className="relative h-[120px] w-[160px] overflow-hidden rounded-2xl lanx-menu">
              <video autoPlay muted playsInline ref={(v) => { if (v && v.srcObject !== stream) v.srcObject = stream; }} className="absolute inset-0 h-full w-full object-cover -scale-x-100" />
              <canvas ref={previewCanvas} width={160} height={120} className="absolute inset-0 h-full w-full" />
            </div>
          )}
          {/* 3.7.1: what LANX thinks the hand is doing, and what to do next. */}
          {prefs.hints !== false && hint && status.phase === "on" && (
            <div data-gesture-hint-chip className="rounded-full bg-slate-900/85 px-3 py-1.5 text-[12px] font-medium text-white">{hint}</div>
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
            {prefs.voice && (
              <button type="button" data-gesture-speak title="Speak a command, like “call Mahek” (or hold up ✌, or press Ctrl + Alt + J)" onClick={() => void listen(true)} className="flex h-6 items-center gap-1 rounded-full bg-red-500 px-2 text-[11px] font-semibold text-white hover:bg-red-600">
                <Mic className="h-3 w-3" /> Speak
              </button>
            )}
            <button type="button" data-gesture-keyboard title={kb ? "Close the keyboard" : "A keyboard to type on with your hand (pinch the keys)"} onClick={() => (kb ? setKb(null) : openKb())} className={`flex h-6 w-6 items-center justify-center rounded-full ${kb ? "bg-sky-500 text-white" : "lanx-tool text-slate-500"}`}>
              <Keyboard className="h-3.5 w-3.5" />
            </button>
            <span className={`flex items-center gap-1 overflow-hidden transition-[max-width,opacity] duration-300 ease-out ${pillShown ? "max-w-[380px] opacity-100" : "max-w-0 opacity-0"}`}>
              <span data-gesture-status-text className="max-w-[260px] truncate px-1" title={statusText}>{statusText}</span>
              <button type="button" title={prefs.preview ? "Hide the camera picture" : "Show the camera picture"} onClick={() => set({ preview: !prefs.preview })} className="lanx-tool h-6 w-6 shrink-0 flex items-center justify-center text-slate-500">
                {prefs.preview ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
              <button type="button" data-gesture-learn title="Learn hand gestures: a short practice" onClick={() => setLearn(true)} className="lanx-tool h-6 w-6 shrink-0 flex items-center justify-center text-slate-500"><GraduationCap className="h-3.5 w-3.5" /></button>
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
              <span className="text-slate-400">{voice.typing ? "say what to type" : "say a command"}</span>
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

      {/* 3.7.1: Learn hand gestures. */}
      {learn && on && <GestureTutorial onClose={closeLearn} pcAvailable={!IS_LINUX} pcOn={!!prefs.pc} onTurnOnPc={() => set({ pc: true })} />}

      {/* 3.7.0: the air keyboard inside LANX (over other programs it is in the hands window). */}
      {kb && !pc && (
        <div ref={kbPanel} data-gesture-kb className={`fixed left-1/2 z-[186] -translate-x-1/2 lanx-menu-in ${kbTop ? "top-3" : "bottom-3"}`} style={{ width: kbW, height: kbH }}>
          <AirKeyboard state={kb} width={kbW} height={kbH} hover={kbHover} pressed={kbPressed} listening={voice.phase === "listening" && !!voice.typing} interactive onKey={pressKey} />
        </div>
      )}

      {/* 3.7.0: a wave ends the call after a moment; a fist (or this button) stays. */}
      {endingLeft !== null && focused && (
        <div data-gesture-ending className="fixed left-1/2 top-4 z-[196] -translate-x-1/2 flex items-center gap-2 rounded-full bg-red-500 px-4 py-2 text-[13px] font-semibold text-white lanx-menu-in">
          👋 Ending the call in {endingLeft}… make a fist to stay
          <button type="button" onClick={() => cancelEnding()} className="rounded-full bg-white/20 px-2.5 py-0.5 text-[12px] hover:bg-white/30">Stay</button>
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
