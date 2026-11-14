/** LANX 3.15.0: the walkie-talkie. Hold to talk: colleagues hear you while you are still
 *  talking. One voice at a time on a PC; a channel is one colleague ("peer:<id>"), a
 *  group ("group:<id>") or everyone ("all").
 *
 *  This is the part that lives in the window from the start (so a colleague's voice
 *  plays even if the walkie-talkie's screen was never opened): what is being said and
 *  heard right now, the choices (on / off, muted channels, loudness) and the last few
 *  things heard, to play again. The screen is src/components/talk. */
import { api, errorText, events } from "../api";
import { type HotkeyCombo, isValidCombo } from "../voice";
import { TalkMic, TalkSpeaker, canPlay, dropMicrophone, talkSupported, tone } from "./audio";
import type { TalkEvent, TalkRefusal, TalkStarted } from "./types";

export type { TalkEvent, TalkRefusal, TalkStarted } from "./types";

export interface TalkPrefs {
  /** Hear colleagues at all. */
  on: boolean;
  /** Channels that stay silent ("all", "group:<id>", "peer:<id>"). */
  muted: string[];
  /** 0…1.5 */
  volume: number;
  /** The channel chosen last. */
  channel: string;
  /** The little tones (you may talk, over, someone starts). */
  tones: boolean;
  /** The talk key (hold it in any program to talk; Windows). */
  key: boolean;
  keys: HotkeyCombo;
}
export const DEFAULT_TALK_KEYS: HotkeyCombo = { ctrl: true, alt: true, shift: false, win: false, key: "KeyT" };
export const DEFAULT_TALK: TalkPrefs = { on: true, muted: [], volume: 1, channel: "all", tones: true, key: true, keys: DEFAULT_TALK_KEYS };

export interface Talking {
  channel: string;
  label: string;
  /** opening: the colleagues' PCs are being asked · live: they hear you. */
  phase: "opening" | "live";
  since: number;
  listeners: number;
  refused: TalkRefusal[];
  level: number;
  /** The microphone test: nobody hears it, it is played back to you. */
  test: boolean;
}
export interface Hearing {
  talkId: string;
  fromId: string;
  fromName: string;
  channel: string;
  since: number;
  level: number;
  /** This PC could not play it (no click in LANX yet since it started): it is kept to play again. */
  silent: boolean;
}
/** Something heard, kept to play again (the last few, until LANX closes). */
export interface Clip {
  id: string;
  fromId: string;
  fromName: string;
  channel: string;
  at: number;
  ms: number;
  heard: boolean;
}
export interface TalkState {
  prefs: TalkPrefs;
  talking: Talking | null;
  hearing: Hearing | null;
  clips: Clip[];
  /** A short line about the last thing that happened ("Asha is talking."), and when. */
  note: string;
  noteAt: number;
}

/** Counters for LANX’s own tests (pieces of 20 ms): what the microphone made and sent, what was played and how loud. */
export const talkStats = { sent: 0, played: 0, peak: 0 };
(window as unknown as { __lanxTalkStats?: typeof talkStats }).__lanxTalkStats = talkStats;
const heard = (v: number) => {
  talkStats.played++;
  talkStats.peak = Math.max(talkStats.peak, v);
};

const HOLD_MAX_MS = 60000;
/** The button must be held this long before anyone is called. */
const HOLD_MIN_MS = 220;
const QUIET_MS = 4500;
const CLIPS_KEPT = 8;

let state: TalkState = { prefs: DEFAULT_TALK, talking: null, hearing: null, clips: [], note: "", noteAt: 0 };
const listeners = new Set<() => void>();
const set = (patch: Partial<TalkState>) => {
  state = { ...state, ...patch };
  for (const l of listeners) l();
};
export const talkStore = {
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  get: () => state,
};
const say = (note: string) => set({ note, noteAt: Date.now() });
const beep = (kind: Parameters<typeof tone>[0]) => {
  if (state.prefs.tones) tone(kind, state.prefs.volume);
};

// ------------------------------------------------------------------ the choices

export function cleanTalkPrefs(v: unknown): TalkPrefs {
  const o = (v && typeof v === "object" ? v : {}) as Partial<TalkPrefs>;
  const vol = Number(o.volume);
  return {
    on: typeof o.on === "boolean" ? o.on : DEFAULT_TALK.on,
    muted: Array.isArray(o.muted) ? o.muted.filter((m): m is string => typeof m === "string" && m.length < 120).slice(0, 200) : [],
    volume: Number.isFinite(vol) ? Math.min(1.5, Math.max(0, vol)) : DEFAULT_TALK.volume,
    channel: typeof o.channel === "string" && o.channel.length < 120 ? o.channel : DEFAULT_TALK.channel,
    tones: typeof o.tones === "boolean" ? o.tones : DEFAULT_TALK.tones,
    key: typeof o.key === "boolean" ? o.key : DEFAULT_TALK.key,
    keys: isValidCombo(o.keys) ? { ctrl: !!o.keys.ctrl, alt: !!o.keys.alt, shift: !!o.keys.shift, win: !!o.keys.win, key: o.keys.key } : DEFAULT_TALK_KEYS,
  };
}
const savePrefs = (prefs: TalkPrefs) => void api.setPref("talk", JSON.stringify(prefs)).catch(() => {});
/** Tells Windows about the talk key as these choices have it. False: another program has those keys. */
const applyKey = (p: TalkPrefs): Promise<boolean> => api.setTalkKey(p.on && p.key, p.keys).catch(() => false);
export function setTalkPrefs(patch: Partial<TalkPrefs>) {
  const before = state.prefs;
  const prefs = cleanTalkPrefs({ ...before, ...patch });
  set({ prefs });
  speaker?.setVolume(prefs.volume);
  if (!prefs.on) dropMicrophone();
  if (prefs.on !== before.on || prefs.key !== before.key) void applyKey(prefs);
  savePrefs(prefs);
}
/** Other keys for the talk key. They are kept only if Windows gives them to LANX. */
export async function chooseTalkKeys(keys: HotkeyCombo): Promise<boolean> {
  const before = state.prefs;
  const next = cleanTalkPrefs({ ...before, keys, key: true });
  if (!(await applyKey(next))) {
    await applyKey(before);
    return false;
  }
  set({ prefs: next });
  savePrefs(next);
  return true;
}
export function toggleMuted(channel: string) {
  const muted = state.prefs.muted.includes(channel) ? state.prefs.muted.filter((m) => m !== channel) : [...state.prefs.muted, channel];
  setTalkPrefs({ muted });
}

// ------------------------------------------------------------------ talking

let mic: TalkMic | null = null;
let talkId: string | null = null;
/** Said while the colleagues' PCs were still answering. */
let backlog: string[] = [];
let testFrames: string[] | null = null;
let released = false;
let pressedAt = 0;
let releasedAt = 0;
let sending: Promise<unknown> = Promise.resolve();
let holdTimer = 0;
let levelAt = 0;

function level(of: "talking" | "hearing", value: number) {
  const now = performance.now();
  if (now - levelAt < 70) return;
  levelAt = now;
  const cur = state[of];
  if (cur) set({ [of]: { ...cur, level: value } } as Partial<TalkState>);
}

function micProblem(e: unknown): string {
  const name = (e as { name?: string })?.name ?? "";
  if (name === "NotAllowedError" || name === "SecurityError") return "LANX is not allowed to use the microphone on this PC.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No microphone was found on this PC.";
  if (name === "NotReadableError") return "Another program is using the microphone.";
  return "The microphone could not be started.";
}

/** Why nobody hears a transmission, in one plain line. */
export function whyNobody(refused: TalkRefusal[]): string {
  if (!refused.length) return "Nobody on this channel is online right now.";
  const names = (why: TalkRefusal["why"]) => refused.filter((r) => r.why === why).map((r) => r.name);
  const list = (n: string[]) => (n.length > 2 ? `${n.slice(0, 2).join(", ")} and ${n.length - 2} more` : n.join(" and "));
  const busy = refused.find((r) => r.why === "busy");
  if (busy) return `${busy.who || "Someone"} is talking.`;
  if (names("old").length === refused.length) return `${list(names("old"))} ${refused.length === 1 ? "needs" : "need"} a newer LANX for the walkie-talkie.`;
  if (names("off").length === refused.length) return `${list(names("off"))} ${refused.length === 1 ? "has" : "have"} the walkie-talkie switched off.`;
  if (names("muted").length === refused.length) return `${list(names("muted"))} ${refused.length === 1 ? "has" : "have"} muted this channel.`;
  if (names("call").length === refused.length) return `${list(names("call"))} ${refused.length === 1 ? "is" : "are"} in a call.`;
  if (names("dnd").length === refused.length) return `${list(names("dnd"))} ${refused.length === 1 ? "has" : "have"} “Do not disturb” on.`;
  if (names("locked").length === refused.length) return `${list(names("locked"))}: LANX is locked there.`;
  if (names("unreachable").length === refused.length) return `${list(names("unreachable"))} could not be reached.`;
  return "Nobody can hear this right now.";
}

function sendFrames(frames: string[]) {
  const id = talkId;
  if (!id || !frames.length) return;
  // In order, 16 pieces at most per step.
  for (let i = 0; i < frames.length; i += 16) {
    const part = frames.slice(i, i + 16);
    talkStats.sent += part.length;
    sending = sending
      .then(() => api.talkAudio(id, part))
      .then(
        (n) => {
          if (n === 0 && talkId === id) {
            say("Nobody hears you any more.");
            void release();
          }
        },
        () => {
          if (talkId === id) void release();
        },
      );
  }
}

function clearTalking() {
  window.clearTimeout(holdTimer);
  talkId = null;
  mic = null;
  backlog = [];
  testFrames = null;
  set({ talking: null });
}

/** The button is pressed: starts talking on `channel` to these colleagues (device ids). */
export async function press(channel: string, targets: string[], label: string): Promise<void> {
  if (state.talking) return;
  if (!talkSupported()) return say("The walkie-talkie needs a newer web engine than this PC has.");
  if (state.hearing) {
    beep("busy");
    return say(`${state.hearing.fromName} is talking.`);
  }
  if (!targets.length) {
    beep("nobody");
    return say("Nobody on this channel is online right now.");
  }
  released = false;
  backlog = [];
  talkId = null;
  testFrames = null;
  pressedAt = performance.now();
  set({ talking: { channel, label, phase: "opening", since: Date.now(), listeners: 0, refused: [], level: 0, test: false }, note: "" });
  const m = new TalkMic(
    (frames) => {
      if (mic !== m) return;
      if (talkId) sendFrames(frames);
      else backlog.push(...frames);
    },
    (v) => level("talking", v),
  );
  mic = m;
  let micError: unknown = null;
  const micReady = m.start().catch((e) => {
    micError = e ?? new Error("microphone");
  });
  // A click is not a transmission: only a button that is still held a moment later
  // calls anyone. (The microphone is listening already, so no first word is lost.)
  await new Promise((r) => window.setTimeout(r, HOLD_MIN_MS));
  if (mic !== m) return;
  if (released) {
    await micReady;
    await m.stop();
    if (mic === m) {
      clearTalking();
      say("Hold the button while you talk.");
    }
    return;
  }
  let started: TalkStarted;
  try {
    started = await api.talkStart(channel.startsWith("peer:") ? "direct" : channel, targets);
  } catch (e) {
    await micReady;
    await m.stop();
    if (mic === m) {
      beep("busy");
      clearTalking();
      say(errorText(e));
    }
    return;
  }
  await micReady;
  // (It may have been taken from us meanwhile: "gave_way" cleared it.)
  if (mic !== m) {
    void api.talkEnd(started.talk_id).catch(() => {});
    return;
  }
  // (A click, not a hold: nothing is sent.)
  const quick = released && releasedAt - pressedAt < 350;
  if (micError || !started.listeners.length || quick) {
    await m.stop();
    void api.talkEnd(started.talk_id).catch(() => {});
    clearTalking();
    if (micError) say(micProblem(micError));
    else if (quick) say("Hold the button while you talk.");
    else {
      beep("nobody");
      say(whyNobody(started.refused));
    }
    return;
  }
  talkId = started.talk_id;
  const opening = talkStore.get().talking;
  if (opening) set({ talking: { ...opening, phase: "live", listeners: started.listeners.length, refused: started.refused } });
  beep("go");
  // What was said while their PCs were answering: the last half second of it.
  sendFrames(backlog.splice(0).slice(-25));
  holdTimer = window.setTimeout(() => void release(), HOLD_MAX_MS);
  if (released) await finish();
}

let finishing = false;
async function finish() {
  window.clearTimeout(holdTimer);
  const id = talkId;
  const m = mic;
  if (!id || !m || finishing) return;
  finishing = true;
  try {
    // The last pieces still come out of the encoder: they go out first, in order.
    await m.stop();
    await sending.catch(() => {});
    if (talkId !== id) return; // it ended another way meanwhile
    talkId = null;
    await api.talkEnd(id).catch(() => {});
    beep("over");
    clearTalking();
  } finally {
    finishing = false;
  }
}

/** The button is let go. */
export async function release(): Promise<void> {
  if (!state.talking) return;
  if (!released) releasedAt = performance.now();
  released = true;
  if (state.talking.test) return finishTest();
  if (talkId) await finish();
  // (Still opening: press() sees `released` when the colleagues' PCs have answered.)
}

/** The microphone test: hold, talk, let go — it is played back to you. Nobody hears it. */
export async function pressTest(): Promise<void> {
  if (state.talking || state.hearing) return;
  if (!talkSupported()) return say("The walkie-talkie needs a newer web engine than this PC has.");
  released = false;
  testFrames = [];
  const kept = testFrames;
  set({ talking: { channel: "test", label: "Microphone test", phase: "live", since: Date.now(), listeners: 0, refused: [], level: 0, test: true }, note: "" });
  const m = new TalkMic(
    (frames) => kept.push(...frames),
    (v) => level("talking", v),
  );
  mic = m;
  try {
    await m.start();
  } catch (e) {
    await m.stop();
    if (mic === m) {
      clearTalking();
      say(micProblem(e));
    }
    return;
  }
  holdTimer = window.setTimeout(() => void release(), 20000);
  if (released) await finishTest();
}
async function finishTest() {
  window.clearTimeout(holdTimer);
  const m = mic;
  const frames = testFrames;
  if (!m || !frames) return;
  mic = null;
  testFrames = null;
  await m.stop();
  clearTalking();
  if (frames.length < 5) return say("Hold the button while you talk.");
  say("Playing it back to you…");
  playWhole(frames);
}

// ------------------------------------------------------------------ hearing

let speaker: TalkSpeaker | null = null;
let clipFrames: string[] = [];
let lastVoice = 0;
let quietTimer = 0;
const kept = new Map<string, string[]>();

function playWhole(frames: string[]) {
  const sp = new TalkSpeaker(state.prefs.volume, heard, true);
  sp.push(frames);
  sp.finish(frames.length * 20 + 600);
}

function endHearing(withTone: boolean) {
  window.clearInterval(quietTimer);
  const h = state.hearing;
  if (!h) return;
  speaker?.finish();
  speaker = null;
  let clips = state.clips;
  if (clipFrames.length) {
    kept.set(h.talkId, clipFrames);
    clips = [{ id: h.talkId, fromId: h.fromId, fromName: h.fromName, channel: h.channel, at: h.since, ms: clipFrames.length * 20, heard: !h.silent }, ...clips].slice(0, CLIPS_KEPT);
    for (const id of [...kept.keys()]) if (!clips.some((c) => c.id === id)) kept.delete(id);
  }
  clipFrames = [];
  if (withTone && !h.silent) beep("over");
  set({ hearing: null, clips });
}

/** A colleague's channel as this PC names it. */
export const channelOf = (e: Pick<TalkEvent, "channel" | "from_id">) => (e.channel === "direct" ? `peer:${e.from_id}` : e.channel);

function onTalkEvent(e: TalkEvent) {
  switch (e.action) {
    case "start": {
      endHearing(false);
      const playable = talkSupported() && canPlay();
      speaker = playable
        ? new TalkSpeaker(state.prefs.volume, (v) => {
            heard(v);
            level("hearing", v);
          })
        : null;
      clipFrames = [];
      lastVoice = Date.now();
      lastHeard = { channel: channelOf(e), at: Date.now() };
      set({ hearing: { talkId: e.talk_id, fromId: e.from_id, fromName: e.from_name, channel: channelOf(e), since: Date.now(), level: 0, silent: !playable }, note: "" });
      if (playable) beep("incoming");
      window.clearInterval(quietTimer);
      quietTimer = window.setInterval(() => {
        if (Date.now() - lastVoice > QUIET_MS) endHearing(true);
      }, 500);
      break;
    }
    case "audio":
      if (state.hearing?.talkId !== e.talk_id) return;
      lastVoice = Date.now();
      if (lastHeard) lastHeard.at = lastVoice;
      if (clipFrames.length < 3200) clipFrames.push(...e.frames);
      speaker?.push(e.frames);
      break;
    case "end":
      if (state.hearing?.talkId === e.talk_id) endHearing(true);
      break;
    case "gave_way": {
      // Someone pressed at the same moment and has the word: ours stops.
      const m = mic;
      clearTalking();
      void m?.stop();
      beep("busy");
      say(`${e.from_name || "Someone else"} is talking.`);
      break;
    }
    case "stopped": {
      if (talkId !== e.talk_id) return;
      const m = mic;
      clearTalking();
      void m?.stop();
      beep("over");
      break;
    }
    case "joined":
      if (state.talking && talkId === e.talk_id) set({ talking: { ...state.talking, listeners: state.talking.listeners + 1, refused: state.talking.refused.filter((r) => r.peer_id !== e.from_id) } });
      break;
  }
}

/** Plays something heard earlier again. */
export function replay(id: string) {
  const frames = kept.get(id);
  if (!frames || state.hearing || state.talking) return;
  if (!canPlay()) return say("Click anywhere in LANX first, then play it again.");
  playWhole(frames);
  set({ clips: state.clips.map((c) => (c.id === id ? { ...c, heard: true } : c)) });
}

// ------------------------------------------------------------------ the talk key

/** The channel a colleague talked on last, and when their voice last came. */
let lastHeard: { channel: string; at: number } | null = null;
const ANSWER_MS = 20000;
let keyHeld = false;

/** Where the talk key talks: for a short while after a colleague talked it answers on
 *  their channel (as the screen does); otherwise the channel chosen last. */
export function keyChannel(): string {
  const c = lastHeard && Date.now() - lastHeard.at < ANSWER_MS ? lastHeard.channel : state.prefs.channel;
  return /^(peer|group):./.test(c) ? c : "all";
}

/** The talk key went down, in whatever program is in front. */
async function keyDown() {
  if (keyHeld) return;
  keyHeld = true;
  if (!state.prefs.on || !state.prefs.key || state.talking) return;
  const channel = keyChannel();
  let targets: string[] = [];
  let label = "Everyone";
  try {
    const peers = (await api.listPeers()).filter((p) => p.trust_state !== "blocked");
    const online = peers.filter((p) => p.status === "online");
    if (channel.startsWith("peer:")) {
      const p = peers.find((x) => x.id === channel.slice(5));
      label = p?.display_name ?? "this colleague";
      targets = p && p.status === "online" ? [p.id] : [];
    } else if (channel.startsWith("group:")) {
      const info = await api.getGroup(channel.slice(6));
      const ids = new Set((info?.members ?? []).filter((m) => !m.is_me).map((m) => m.device_id));
      label = info?.name ?? "the group";
      targets = online.filter((p) => ids.has(p.id)).map((p) => p.id);
    } else targets = online.map((p) => p.id);
  } catch {
    // (Nobody to reach then: press() says so.)
  }
  // Let go meanwhile: a tap, not a transmission.
  if (!keyHeld) return;
  await press(channel, targets, label);
}
function keyUp() {
  keyHeld = false;
  void release();
}

let started = false;
/** Once, when LANX's window starts: the choices, and listening for colleagues. */
export function initTalk(): () => void {
  if (started) return () => {};
  started = true;
  void api
    .getPref("talk")
    .then((v) => set({ prefs: cleanTalkPrefs(v ? JSON.parse(v) : null) }))
    .catch(() => {});
  let off: (() => void) | undefined;
  let gone = false;
  void events
    .onTalk(onTalkEvent)
    .then((u) => {
      if (gone) u();
      else off = u;
    })
    .catch(() => {});
  const onKey = (down: boolean) => (down ? void keyDown() : keyUp());
  let offKey: (() => void) | undefined;
  void events
    .onTalkKey(onKey)
    .then((u) => {
      if (gone) u();
      else offKey = u;
    })
    .catch(() => {});
  // The browser preview (no LANX behind it) can act a colleague and the talk key: see components/talk.
  const fake = (ev: Event) => onTalkEvent((ev as CustomEvent<TalkEvent>).detail);
  const fakeKey = (ev: Event) => onKey(!!(ev as CustomEvent<boolean>).detail);
  window.addEventListener("lanx:talk-preview", fake);
  window.addEventListener("lanx:talk-key-preview", fakeKey);
  return () => {
    gone = true;
    started = false;
    off?.();
    offKey?.();
    window.removeEventListener("lanx:talk-preview", fake);
    window.removeEventListener("lanx:talk-key-preview", fakeKey);
  };
}

/** Opens the walkie-talkie's screen (App listens), on a channel if given. */
export function openTalk(channel?: string) {
  window.dispatchEvent(new CustomEvent("lanx:talk-open", { detail: { channel } }));
}
