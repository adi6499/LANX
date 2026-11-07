/** LANX 3.9.0: doing things together — the layer under the live quiz, bells and
 *  timers, office announcements, presenting and watching a video.
 *
 *  - Sessions: one PC hosts, colleagues are invited and join (or not), the host
 *    publishes the state, members answer. One-off things (a bell, an
 *    announcement) need no session: they are "events" to the people chosen.
 *  - Clocks, as in Listen together: each PC compares its clock with the host's
 *    over the network (the quickest of several round trips), so "at 12:00:03.250
 *    host time" is the same instant everywhere — a bell rings, a question opens,
 *    a voice plays on every PC at once.
 *  - Big things (a voice clip, a page picture) go in parts of 180 KB.
 *  Numbers on the wire are whole (ms, µs): a fraction can be read back a hair
 *  differently on another PC and break the packet's signature. */
import { api, events } from "./api";

export type Kind = "quiz" | "bell" | "pa" | "present" | "watch";
export interface Step {
  from_id: string;
  from_name: string;
  session_id: string;
  kind: Kind;
  action: string;
  seq: number;
  data: Record<string, unknown>;
}
export interface Transport {
  /** This PC's clock, ms. */
  now(): Promise<number>;
  clock(peerId: string, samples: number): Promise<{ offset_ms: number; delay_ms: number }>;
  send(peerId: string, step: { session_id: string; kind: Kind; action: string; seq: number; data: unknown; at: number }): Promise<boolean>;
  onStep(cb: (e: Step) => void): () => void;
}
export interface Member {
  id: string;
  name: string;
  at: number;
  /** What the member last sent (an answer, a status…). */
  data: Record<string, unknown> | null;
}
export interface Session<S = Record<string, unknown>> {
  id: string;
  kind: Kind;
  role: "host" | "member";
  /** "" when this PC hosts. */
  hostId: string;
  hostName: string;
  members: Map<string, Member>;
  invited: Map<string, string>;
  seq: number;
  state: S | null;
  heardAt: number;
}
export interface Invite {
  sessionId: string;
  kind: Kind;
  hostId: string;
  hostName: string;
  data: Record<string, unknown>;
  at: number;
}

const lanx: Transport = {
  now: () => api.musicNow(),
  clock: (peerId, samples) => api.musicClock(peerId, samples),
  send: (peerId, step) => api.sendTogether(peerId, step),
  onStep: (cb) => {
    let un: (() => void) | null = null;
    let gone = false;
    void events.onTogether((e) => cb(e as Step)).then((u) => (gone ? u() : (un = u)));
    return () => {
      gone = true;
      un?.();
    };
  },
};
let transport: Transport = lanx;
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
export const rand = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);

// ------------------------------------------------------------------ clocks

/** page clock → this PC's clock (ms); before the first check, the page's own idea of the time. */
const local = { corr: performance.timeOrigin, at: -Infinity };
/** per colleague: their clock − this PC's (ms) */
const offsets = new Map<string, { offset: number; delay: number; at: number }>();

async function calibrate(force = false) {
  if (!force && performance.now() - local.at < 20000) return;
  let best = { rtt: Infinity, corr: local.corr };
  for (let i = 0; i < 7; i++) {
    const a = performance.now();
    const pc = await transport.now();
    const b = performance.now();
    if (b - a < best.rtt) best = { rtt: b - a, corr: pc - (a + b) / 2 };
  }
  local.corr = best.corr;
  local.at = performance.now();
}
/** Compares a colleague's clock with ours (kept a while). */
export async function clockWith(peerId: string, samples = 8, maxAgeMs = 15000): Promise<void> {
  await calibrate();
  const had = offsets.get(peerId);
  if (had && performance.now() - had.at < maxAgeMs) return;
  const c = await transport.clock(peerId, samples);
  offsets.set(peerId, { offset: c.offset_ms, delay: c.delay_ms, at: performance.now() });
}
/** This PC's clock now, checked first (use it to stamp a moment others will follow). */
export async function myClock(): Promise<number> {
  await calibrate();
  return hostNow();
}
/** The time on `peerId`'s clock now ("" or undefined: this PC), ms. */
export function hostNow(peerId?: string): number {
  return performance.now() + local.corr + (peerId ? (offsets.get(peerId)?.offset ?? 0) : 0);
}
/** Page time (performance.now) at which it is `hostMs` on `peerId`'s clock. */
export function perfAt(hostMs: number, peerId?: string): number {
  return hostMs - local.corr - (peerId ? (offsets.get(peerId)?.offset ?? 0) : 0);
}
/** Milliseconds from now until it is `hostMs` on `peerId`'s clock. */
export const msUntil = (hostMs: number, peerId?: string) => perfAt(hostMs, peerId) - performance.now();
export const clockInfo = (peerId: string) => offsets.get(peerId) ?? null;

// ------------------------------------------------------------------ sessions

const sessions = new Map<string, Session>();
const invites = new Map<string, Invite>();
const listeners = new Set<() => void>();
type Handler = (e: Step, s: Session | null) => void;
const handlers = new Map<Kind, Set<Handler>>();
let snapshot: { sessions: Session[]; invites: Invite[] } = { sessions: [], invites: [] };
let unStep: (() => void) | null = null;

function changed() {
  snapshot = { sessions: [...sessions.values()], invites: [...invites.values()].sort((a, b) => b.at - a.at) };
  for (const l of listeners) l();
}
function listen() {
  if (!unStep) unStep = transport.onStep(onStep);
}

async function send(peerId: string, sessionId: string, kind: Kind, action: string, data: unknown, seq = 0): Promise<string | null> {
  try {
    await transport.send(peerId, { session_id: sessionId, kind, action, seq, data, at: 0 });
    return null;
  } catch (e) {
    return errText(e);
  }
}

/** Starts a session: invites `people` (who choose to join). Returns who couldn't be invited, and why. */
export async function host<S extends Record<string, unknown>>(kind: Kind, people: { id: string; name: string }[], myName: string, state: S, inviteData: Record<string, unknown> = {}): Promise<{ session: Session<S>; failed: Record<string, string> }> {
  listen();
  await calibrate(true);
  const session: Session<S> = { id: `${kind}-${rand()}`, kind, role: "host", hostId: "", hostName: myName, members: new Map(), invited: new Map(), seq: 0, state, heardAt: Date.now() };
  sessions.set(session.id, session as unknown as Session);
  changed();
  const failed = await invite(session as unknown as Session, people, inviteData);
  return { session, failed };
}
/** Host: more people. */
export async function invite(s: Session, people: { id: string; name: string }[], inviteData: Record<string, unknown> = {}): Promise<Record<string, string>> {
  const failed: Record<string, string> = {};
  await Promise.all(
    people.map(async (p) => {
      if (s.members.has(p.id)) return;
      const err = await send(p.id, s.id, s.kind, "invite", { host_name: s.hostName, ...inviteData });
      if (err) failed[p.id] = err;
      else s.invited.set(p.id, p.name);
    }),
  );
  changed();
  return failed;
}
/** Host: the new state to every member (and keeps it for those who join later). */
export function publish<S extends Record<string, unknown>>(s: Session<S>, state: S) {
  if (s.role !== "host") return;
  s.state = state;
  s.seq += 1;
  for (const m of s.members.values()) void send(m.id, s.id, s.kind, "state", state, s.seq);
  changed();
}
/** Host → one member, or member → host. */
export function tell(s: Session, action: string, data: Record<string, unknown>, to?: string) {
  const peer = to ?? s.hostId;
  if (!peer) return Promise.resolve("No one to tell.");
  return send(peer, s.id, s.kind, action, data, s.seq);
}
/** Joins an invite: lines up with the host's clock, then asks for the state. */
export async function join(inv: Invite): Promise<Session> {
  listen();
  invites.delete(inv.sessionId);
  const s: Session = { id: inv.sessionId, kind: inv.kind, role: "member", hostId: inv.hostId, hostName: inv.hostName, members: new Map(), invited: new Map(), seq: -1, state: null, heardAt: Date.now() };
  sessions.set(s.id, s);
  changed();
  try {
    await clockWith(inv.hostId, 12, 0);
  } catch {
    /* their LANX will say why below */
  }
  const err = await send(inv.hostId, s.id, s.kind, "join", {});
  if (err) {
    sessions.delete(s.id);
    changed();
    throw new Error(err);
  }
  return s;
}
export function decline(inv: Invite) {
  invites.delete(inv.sessionId);
  changed();
  void send(inv.hostId, inv.sessionId, inv.kind, "decline", {});
}
/** Member leaves; host ends it for everyone. */
export async function leave(s: Session) {
  sessions.delete(s.id);
  changed();
  if (s.role === "member") await send(s.hostId, s.id, s.kind, "leave", {});
  // The host ends it for everyone — those who joined and those still holding the invite.
  else await Promise.all([...new Set([...s.members.keys(), ...s.invited.keys()])].map((id) => send(id, s.id, s.kind, "end", {})));
  for (const h of handlers.get(s.kind) ?? []) h({ from_id: "", from_name: "", session_id: s.id, kind: s.kind, action: "closed", seq: 0, data: {} }, s);
}
/** One-off to these people (no session): a bell, an announcement. */
export async function announce(kind: Kind, people: { id: string }[], data: Record<string, unknown>, id = `${kind}-${rand()}`): Promise<Record<string, string>> {
  listen();
  await calibrate(true);
  const failed: Record<string, string> = {};
  await Promise.all(
    people.map(async (p) => {
      const err = await send(p.id, id, kind, "event", data);
      if (err) failed[p.id] = err;
    }),
  );
  return failed;
}

// -- big things in parts

const PART = 180 * 1024;
const assembling = new Map<string, { parts: string[]; got: number; at: number }>();
/** Sends text (base64) of any size to one colleague, in parts; they get one "blob" step. */
export async function sendBlob(peerId: string, sessionId: string, kind: Kind, blobId: string, base64: string, meta: Record<string, unknown> = {}): Promise<string | null> {
  const n = Math.max(1, Math.ceil(base64.length / PART));
  for (let i = 0; i < n; i++) {
    const err = await send(peerId, sessionId, kind, "part", { blob: blobId, i, n, chunk: base64.slice(i * PART, (i + 1) * PART), ...(i === n - 1 ? meta : {}) });
    if (err) return err;
  }
  return null;
}
function onPart(e: Step) {
  const d = e.data;
  const key = `${e.from_id}/${String(d.blob)}`;
  const n = Number(d.n);
  const i = Number(d.i);
  if (!Number.isInteger(n) || n < 1 || n > 400 || !Number.isInteger(i) || i < 0 || i >= n) return;
  let a = assembling.get(key);
  if (!a) {
    a = { parts: new Array(n).fill(""), got: 0, at: Date.now() };
    assembling.set(key, a);
  }
  if (!a.parts[i]) {
    a.parts[i] = String(d.chunk ?? "");
    a.got += 1;
  }
  // Old half-finished ones go.
  for (const [k, v] of assembling) if (Date.now() - v.at > 120000) assembling.delete(k);
  if (a.got < n) return;
  assembling.delete(key);
  const { chunk: _c, i: _i, n: _n, ...meta } = d;
  // In a session this PC joined, only its host sends the big things.
  const s = sessions.get(e.session_id);
  if (s && s.role === "member" && e.from_id !== s.hostId) return;
  deliver({ ...e, action: "blob", data: { ...meta, base64: a.parts.join("") } });
}

// -- what colleagues send

function deliver(e: Step) {
  const s = sessions.get(e.session_id) ?? null;
  for (const h of handlers.get(e.kind) ?? []) {
    try {
      h(e, s);
    } catch (err) {
      console.error("together handler", err);
    }
  }
}

function onStep(e: Step) {
  const d = e.data ?? {};
  if (e.action === "part") return onPart(e);
  if (e.action === "event") return deliver(e);
  if (e.action === "invite") {
    if (sessions.has(e.session_id)) return;
    invites.set(e.session_id, { sessionId: e.session_id, kind: e.kind, hostId: e.from_id, hostName: String(d.host_name ?? e.from_name), data: d, at: Date.now() });
    changed();
    deliver(e);
    return;
  }
  const s = sessions.get(e.session_id);
  if (!s) {
    if (e.action === "end" && invites.delete(e.session_id)) changed();
    return;
  }
  if (s.role === "host") {
    // Only the host ends (or sets the state of) its own session.
    if (e.action === "end" || e.action === "state" || e.action === "invite") return;
    if (e.action === "join") {
      s.invited.delete(e.from_id);
      s.members.set(e.from_id, { id: e.from_id, name: e.from_name, at: Date.now(), data: null });
      changed();
      if (s.state) void send(e.from_id, s.id, s.kind, "state", s.state, s.seq);
    } else if (e.action === "leave" || e.action === "decline") {
      s.members.delete(e.from_id);
      s.invited.delete(e.from_id);
      changed();
    } else {
      const m = s.members.get(e.from_id);
      if (m) {
        m.data = d;
        m.at = Date.now();
        changed();
      }
    }
    deliver(e);
    return;
  }
  // member: only the host speaks
  if (e.from_id !== s.hostId) return;
  s.heardAt = Date.now();
  if (e.action === "end") {
    sessions.delete(s.id);
    changed();
    deliver(e);
    return;
  }
  if (e.action === "state") {
    if (e.seq <= s.seq) return;
    s.seq = e.seq;
    s.state = d;
    changed();
  }
  deliver(e);
}

// ------------------------------------------------------------------ for the features and the screen

export const together = {
  subscribe(l: () => void): () => void {
    listen();
    listeners.add(l);
    return () => listeners.delete(l);
  },
  snapshot: () => snapshot,
  session: (id: string) => sessions.get(id) ?? null,
  /** A feature hears every step of its kind (and "closed" when this PC leaves). */
  on(kind: Kind, h: Handler): () => void {
    listen();
    let set = handlers.get(kind);
    if (!set) handlers.set(kind, (set = new Set()));
    set.add(h);
    return () => set!.delete(h);
  },
  /** For tests: talk through a stand-in instead of LANX. */
  useTransport(t: Transport) {
    unStep?.();
    unStep = null;
    transport = t;
    local.at = -Infinity;
    offsets.clear();
    listen();
  },
};

/** For the end-to-end tests (and support). */
(window as unknown as { __lanxTogether?: unknown }).__lanxTogether = { together, host, invite, publish, tell, join, leave, announce, hostNow, clockInfo };
