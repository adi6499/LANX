/** LANX 3.9.0: Bells and timers — "Lunch is served", "Stand-up in 10 minutes":
 *  every chosen PC (and this one) rings at the same second, with a countdown on
 *  the screen if wanted. The time is on the sender's clock; each PC lines its
 *  clock up with the sender's (like Listen together) and rings on the spot. */
import { useEffect, useState, useSyncExternalStore } from "react";
import { BellRing, Loader2, Play, X } from "lucide-react";
import { announce, clockWith, myClock, perfAt, rand, together } from "../../lib/together";
import { PeoplePicker, Sheet, chosen, primaryBtn, secondaryBtn, useMyName, useOnline, presetPicked } from "./common";

type Sound = "bell" | "chime" | "gong";
interface Bell {
  id: string;
  /** "" = this PC sent it. */
  from: string;
  fromName: string;
  label: string;
  /** When, on the sender's clock (ms). */
  at: number;
  countdown: boolean;
  sound: Sound;
  /** Who it was sent to (the sender keeps it, to cancel). */
  to: { id: string }[];
  rang: boolean;
}

// ------------------------------------------------------------------ the sound

let ctx: AudioContext | null = null;
function audio(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});
  return ctx;
}
/** A struck bell, a two-note chime or a gong, starting at audio time `t`. */
export function strike(sound: Sound, t?: number) {
  const c = audio();
  const at = t ?? c.currentTime + 0.02;
  const out = c.createGain();
  out.gain.value = 0.32;
  out.connect(c.destination);
  const note = (f: number, start: number, decay: number, partials: [number, number][]) => {
    for (const [ratio, amp] of partials) {
      const o = c.createOscillator();
      const g = c.createGain();
      o.frequency.value = f * ratio;
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(amp, start + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, start + decay * (ratio > 2 ? 0.45 : 1));
      o.connect(g).connect(out);
      o.start(start);
      o.stop(start + decay + 0.1);
    }
  };
  if (sound === "bell") {
    note(784, at, 2.6, [[1, 0.6], [2, 0.25], [2.76, 0.22], [5.4, 0.1], [8.93, 0.05]]);
    note(784, at + 1.2, 2.6, [[1, 0.5], [2, 0.2], [2.76, 0.18], [5.4, 0.08]]);
  } else if (sound === "chime") {
    note(659.3, at, 1.6, [[1, 0.6], [2, 0.12], [3, 0.05]]);
    note(523.3, at + 0.55, 2.2, [[1, 0.6], [2, 0.12], [3, 0.05]]);
  } else {
    note(98, at, 5, [[1, 0.7], [1.48, 0.3], [2.03, 0.35], [2.76, 0.2], [3.94, 0.12], [5.3, 0.06]]);
  }
}

// ------------------------------------------------------------------ the bells this PC knows

const bells = new Map<string, Bell>();
const timers = new Map<string, number[]>();
const subs = new Set<() => void>();
let list: Bell[] = [];
let ringing: Bell[] = [];
const changed = () => {
  list = [...bells.values()].filter((b) => !b.rang).sort((a, b) => a.at - b.at);
  for (const s of subs) s();
};
const subscribe = (cb: () => void) => {
  subs.add(cb);
  return () => subs.delete(cb);
};
/** Page time at which the bell's moment comes. */
const due = (b: Bell) => perfAt(b.at, b.from || undefined);

function schedule(b: Bell) {
  for (const t of timers.get(b.id) ?? []) window.clearTimeout(t);
  bells.set(b.id, b);
  const ts: number[] = [];
  const left = due(b) - performance.now();
  // A long wait: line the clocks up again shortly before.
  if (b.from && left > 60000) ts.push(window.setTimeout(() => void clockWith(b.from, 6, 0).then(() => schedule(b)).catch(() => {}), left - 30000));
  // A little before: hand the sound card the exact moment.
  ts.push(
    window.setTimeout(() => {
      const c = audio();
      const leftMs = due(b) - performance.now();
      const lat = (c.baseLatency || 0) + ((c as AudioContext & { outputLatency?: number }).outputLatency || 0);
      strike(b.sound, c.currentTime + Math.max(0.01, leftMs / 1000 - lat));
    }, Math.max(0, left - 400)),
  );
  ts.push(
    window.setTimeout(() => {
      b.rang = true;
      ringing = [b, ...ringing.filter((x) => x.id !== b.id)].slice(0, 3);
      changed();
      window.setTimeout(() => {
        ringing = ringing.filter((x) => x.id !== b.id);
        bells.delete(b.id);
        changed();
      }, 15000);
    }, Math.max(0, left)),
  );
  timers.set(b.id, ts);
  changed();
}
function cancel(id: string) {
  for (const t of timers.get(id) ?? []) window.clearTimeout(t);
  timers.delete(id);
  bells.delete(id);
  changed();
}

// What colleagues send.
let listening = false;
function listen() {
  if (listening) return;
  listening = true;
  together.on("bell", (e) => {
    if (e.action !== "event") return;
    const d = e.data;
    if (typeof d.cancel === "string") return cancel(d.cancel);
    const at = Number(d.at_ms);
    if (!Number.isFinite(at) || typeof d.id !== "string") return;
    const sound: Sound = d.sound === "chime" || d.sound === "gong" ? d.sound : "bell";
    void clockWith(e.from_id, 8, 0)
      .catch(() => {})
      .then(() => {
        const b: Bell = { id: d.id as string, from: e.from_id, fromName: e.from_name, label: String(d.label ?? "Bell").slice(0, 120), at, countdown: !!d.countdown, sound, to: [], rang: false };
        // Long past (a PC that was asleep): not now.
        if (due(b) - performance.now() < -30000) return;
        schedule(b);
      });
  });
}

const QUICK = ["🍛 Lunch break", "☕ Tea break", "🧍 Stand-up", "📅 Meeting starts", "🏠 Home time", "🎉 Celebration in the hall"];

export function BellSetup({ onClose }: { onClose: () => void }) {
  const myName = useMyName();
  const online = useOnline();
  const [picked, setPicked] = useState<Record<string, boolean>>(presetPicked);
  const [label, setLabel] = useState("");
  const [when, setWhen] = useState<"now" | "in" | "at">("in");
  const [mins, setMins] = useState(10);
  const [clockTime, setClockTime] = useState(() => {
    const d = new Date(Date.now() + 30 * 60000);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  });
  const [countdown, setCountdown] = useState(true);
  const [sound, setSound] = useState<Sound>("bell");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<Record<string, string>>({});
  const mine = useSyncExternalStore(subscribe, () => list).filter((b) => !b.from);
  useEffect(listen, []);

  const send = async () => {
    setBusy(true);
    try {
      const people = chosen(online, picked);
      const now = await myClock();
      let target: number;
      if (when === "now") target = now + 1500;
      else if (when === "in") target = now + Math.max(1, mins) * 60000;
      else {
        const [h, m] = clockTime.split(":").map(Number);
        const d = new Date();
        d.setHours(h, m, 0, 0);
        if (d.getTime() < Date.now() - 1000) d.setDate(d.getDate() + 1);
        target = now + (d.getTime() - Date.now());
      }
      const b: Bell = { id: `bell-${rand()}`, from: "", fromName: myName, label: label.trim() || "🔔 Bell", at: Math.round(target), countdown, sound, to: people, rang: false };
      const f = await announce("bell", people, { id: b.id, label: b.label, at_ms: b.at, countdown: countdown ? 1 : 0, sound }, b.id);
      setFailed(f);
      schedule(b);
      if (!Object.keys(f).length) setPicked({});
    } finally {
      setBusy(false);
    }
  };
  const seg = (k: typeof when, text: string) => (
    <button type="button" data-bell-when={k} onClick={() => setWhen(k)} className={`flex-1 rounded-full py-1.5 text-[12.5px] font-semibold ${when === k ? "bg-sky-500 text-white" : "text-slate-600 dark:text-slate-300"}`}>
      {text}
    </button>
  );
  return (
    <Sheet title="Bell or timer" subtitle="Rings on every chosen PC — and this one — at the same second" icon={<BellRing className="h-5 w-5" />} onClose={onClose} tag="bell">
      <input data-bell-label value={label} onChange={(e) => setLabel(e.target.value)} placeholder="What's it for? (Lunch break…)" maxLength={120} className="w-full rounded-xl border border-[var(--lanx-line)] bg-transparent px-3 py-2 text-[14px] text-slate-900 outline-none focus:border-sky-400 dark:text-white" />
      <div className="mt-2 flex flex-wrap gap-1.5">
        {QUICK.map((q) => (
          <button key={q} type="button" onClick={() => setLabel(q)} className="rounded-full bg-[var(--lanx-fill)] px-2.5 py-1 text-[12px] text-slate-700 dark:text-slate-200">
            {q}
          </button>
        ))}
      </div>
      <div className="mt-4 flex gap-1 rounded-full bg-[var(--lanx-fill)] p-1">
        {seg("now", "Now")}
        {seg("in", "In minutes")}
        {seg("at", "At a time")}
      </div>
      <div className="mt-2.5 flex items-center gap-3 text-[13px] text-slate-700 dark:text-slate-200">
        {when === "in" && (
          <label className="flex items-center gap-2">
            In <input type="number" data-bell-mins min={1} max={600} value={mins} onChange={(e) => setMins(Number(e.target.value))} className="w-20 rounded-lg border border-[var(--lanx-line)] bg-transparent px-2 py-1" /> minutes
          </label>
        )}
        {when === "at" && (
          <label className="flex items-center gap-2">
            At <input type="time" value={clockTime} onChange={(e) => setClockTime(e.target.value)} className="rounded-lg border border-[var(--lanx-line)] bg-transparent px-2 py-1" />
          </label>
        )}
        {when !== "now" && (
          <label className="ml-auto flex items-center gap-2">
            <input type="checkbox" checked={countdown} onChange={(e) => setCountdown(e.target.checked)} className="h-4 w-4 accent-sky-500" /> Countdown on screens
          </label>
        )}
      </div>
      <div className="mt-3 flex items-center gap-2">
        {(["bell", "chime", "gong"] as Sound[]).map((s) => (
          <button key={s} type="button" onClick={() => setSound(s)} className={`${secondaryBtn} ${sound === s ? "!border-sky-400 !text-sky-600 dark:!text-sky-300" : ""}`}>
            {s === "bell" ? "Bell" : s === "chime" ? "Chime" : "Gong"}
          </button>
        ))}
        <button type="button" title="Hear it" onClick={() => strike(sound)} className="lanx-tool ml-auto p-2 text-slate-500">
          <Play className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-4">
        <PeoplePicker picked={picked} onChange={setPicked} failed={failed} />
      </div>
      <button type="button" data-bell-send disabled={busy} onClick={() => void send()} className={`${primaryBtn} mt-3`}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />}
        {Object.values(picked).some(Boolean) ? "Set the bell" : "Set the bell (just this PC)"}
      </button>
      {mine.length > 0 && (
        <div className="mt-4">
          <div className="text-[12px] font-semibold text-slate-500">Your bells</div>
          {mine.map((b) => (
            <div key={b.id} data-bell-mine={b.id} className="mt-1.5 flex items-center gap-2 rounded-xl lanx-group px-3 py-2 text-[13px] text-slate-800 dark:text-slate-100">
              <span className="min-w-0 flex-1 truncate">{b.label}</span>
              <Countdown bell={b} />
              <button
                type="button"
                title="Cancel it everywhere"
                onClick={() => {
                  cancel(b.id);
                  void announce("bell", b.to, { cancel: b.id });
                }}
                className="lanx-tool p-1 text-slate-400"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </Sheet>
  );
}

function fmt(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}` : `${m}:${String(ss).padStart(2, "0")}`;
}
function Countdown({ bell }: { bell: Bell }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 250);
    return () => window.clearInterval(t);
  }, []);
  return <span className="tabular-nums text-slate-500">{fmt(due(bell) - performance.now())}</span>;
}

/** Always there: countdowns of coming bells, and the bell when it rings. */
export function BellLayer() {
  useEffect(listen, []);
  const pending = useSyncExternalStore(subscribe, () => list);
  const rung = useSyncExternalStore(subscribe, () => ringing);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 500);
    return () => window.clearInterval(t);
  }, []);
  const soon = pending.filter((b) => b.countdown || due(b) - performance.now() < 60000).slice(0, 2);
  if (!soon.length && !rung.length) return null;
  return (
    <div className="pointer-events-none fixed left-1/2 top-3 z-[88] flex w-[380px] max-w-[92vw] -translate-x-1/2 flex-col items-center gap-2">
      {rung.map((b) => (
        <div key={b.id} data-bell-ringing={b.id} className="pointer-events-auto flex w-full items-center gap-3 rounded-2xl lanx-sheet p-3.5 shadow-2xl lanx-rise">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-400/20 text-amber-600">
            <BellRing className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-bold text-slate-900 dark:text-white">{b.label}</div>
            <div className="text-[12px] text-slate-500">{b.from ? `from ${b.fromName}` : "your bell"}</div>
          </div>
          <button type="button" onClick={() => ((ringing = ringing.filter((x) => x.id !== b.id)), changed())} className="lanx-tool p-1.5 text-slate-400">
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
      {soon.map((b) => (
        <div key={b.id} data-bell-countdown={b.id} className="pointer-events-auto flex items-center gap-2 rounded-full lanx-sheet px-3.5 py-1.5 text-[12.5px] shadow-lg">
          <BellRing className="h-3.5 w-3.5 text-amber-500" />
          <span className="max-w-[200px] truncate font-semibold text-slate-800 dark:text-slate-100">{b.label}</span>
          <span className="tabular-nums text-slate-500">{fmt(due(b) - performance.now())}</span>
          {b.from && <span className="text-slate-400">· {b.fromName}</span>}
        </div>
      ))}
    </div>
  );
}

/** For tests: the bells this PC knows (and when each is due, page time). */
(window as unknown as { __lanxBells?: unknown }).__lanxBells = { list: () => [...bells.values()].map((b) => ({ id: b.id, label: b.label, due: due(b), rang: b.rang })) };
