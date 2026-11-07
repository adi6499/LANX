/** LANX 3.8.0: Listen together — the host's music on colleagues' PCs, every PC
 *  playing the same moment of the same song.
 *
 *  How it stays together:
 *  - Clocks. Every PC compares its clock with the host's over the network
 *    (NTP-style, the quickest of many round trips: Rust `music_clock`), and this
 *    page's clock with its PC's (`music_now`). Everything shared is host time.
 *  - Plans, not commands. The host never says "play now"; it says "1:02.350 of
 *    the song is heard at 12:00:03.250 host time" — a third of a second ahead,
 *    so the plan has reached every PC before it is due.
 *  - Sample-exact sound. Each PC downloads and decodes the song itself and gives
 *    the sound card the whole song with the exact start (Web Audio), timed by the
 *    sound card's own clock (`getOutputTimestamp`: when a sample really leaves).
 *  - Staying together. Four times a second each PC checks where its speaker is
 *    against where it should be: a few milliseconds are evened out by playing a
 *    hair faster or slower (0.4% at most, nobody hears it); more than 45 ms, it
 *    jumps to the right place.
 *  Numbers on the wire are whole (ms positions, µs host times): a fraction can be
 *  read back a hair differently on another PC and break the packet's signature. */
import { api, events } from "./api";
import { type Song, musicOutput, player, rememberPlayed, searchSongs } from "./music";

/** Where the song is: `posMs` of song `songId` is heard at host time `hostUs`. */
export interface Anchor {
  songId: string;
  posMs: number;
  hostUs: number;
  playing: boolean;
}
export interface Member {
  id: string;
  name: string;
  /** How far their speaker is from the plan (ms, smoothed); null before they report. */
  errMs: number | null;
  loading: boolean;
  at: number;
}
export type PartyView =
  | null
  | {
      id: string;
      role: "host" | "member";
      hostId: string;
      hostName: string;
      members: Member[];
      /** Invited, not (yet) joined. */
      invited: { id: string; name: string }[];
      song: Song | null;
      playing: boolean;
      /** This PC against the plan (ms, smoothed). */
      errMs: number | null;
      loading: boolean;
      /** Clock: host − this PC (ms) and the quickest round trip. */
      offsetMs: number;
      delayMs: number;
      problem: string | null;
    };
export interface Invite {
  partyId: string;
  hostId: string;
  hostName: string;
  song: Song | null;
  people: number;
  at: number;
}
interface StepEvent {
  from_id: string;
  from_name: string;
  party_id: string;
  action: string;
  seq: number;
  data: Record<string, unknown>;
}
/** How Listen together reaches other PCs (LANX; a stand-in in tests). */
export interface Transport {
  now(): Promise<number>;
  clock(peerId: string, samples: number): Promise<{ offset_ms: number; delay_ms: number }>;
  send(peerId: string, step: { party_id: string; action: string; seq: number; data: unknown; at: number }): Promise<boolean>;
  onStep(cb: (e: StepEvent) => void): () => void;
}

const LEAD_MS = 350;
const PAUSE_LEAD_MS = 220;
const HARD_MS = 45;
const TICK_MS = 250;
/** Waiting for colleagues to have a new song ready, at most. */
const READY_WAIT_MS = 2500;
const HEARTBEAT_MS = 8000;
const STATUS_MS = 4000;
const CLOCK_EVERY_MS = 15000;
/** No word from the host for this long: they are gone. */
const LOST_MS = 30000;
const DELAY_PREF = "music_sync_delay";

const lanx: Transport = {
  now: () => api.musicNow(),
  clock: (peerId, samples) => api.musicClock(peerId, samples),
  send: (peerId, step) => api.sendMusic(peerId, step),
  onStep: (cb) => {
    let un: (() => void) | null = null;
    let gone = false;
    void events.onMusic((e) => cb(e as StepEvent)).then((u) => (gone ? u() : (un = u)));
    return () => {
      gone = true;
      un?.();
    };
  },
};
let transport: Transport = lanx;

// ------------------------------------------------------------------ clocks

/** page clock (performance.now) → this PC's clock → the host's clock, all ms. */
const clock = {
  /** this PC − page */
  corr: 0,
  /** host − this PC */
  offset: 0,
  delay: 0,
  calibratedAt: 0,
  hostNow: () => performance.now() + clock.corr + clock.offset,
  perfAt: (hostMs: number) => hostMs - clock.corr - clock.offset,
  async local() {
    let best = { rtt: Infinity, corr: clock.corr };
    for (let i = 0; i < 7; i++) {
      const a = performance.now();
      const pc = await transport.now();
      const b = performance.now();
      if (b - a < best.rtt) best = { rtt: b - a, corr: pc - (a + b) / 2 };
    }
    clock.corr = best.corr;
    clock.calibratedAt = performance.now();
  },
  /** The host's clock against ours (members only). */
  async host(hostId: string, samples: number) {
    const c = await transport.clock(hostId, samples);
    const jump = Math.abs(c.offset_ms - clock.offset);
    // A small change is most likely the measurement wobbling: meet it halfway.
    clock.offset = clock.calibratedAt && jump < 4 ? clock.offset + (c.offset_ms - clock.offset) / 2 : c.offset_ms;
    clock.delay = c.delay_ms;
    return jump;
  },
};

// ------------------------------------------------------------------ the sound

interface Playing {
  songId: string;
  buf: AudioBuffer;
  /** Only the start of the song is in (the rest is still downloading). */
  partial: boolean;
  src: AudioBufferSourceNode;
  gain: GainNode;
  /** The song position `pos0` (s) leaves the speaker at audio-clock time `c0`, at `rate`. */
  c0: number;
  pos0: number;
  rate: number;
  ended: boolean;
}

/** The start of a song (about 37 s at 320 kbps) decodes in a quarter of a second, so
 *  the music starts on it while the whole song downloads; then the whole song takes
 *  over at the same sample (they are the same sound), so nobody hears the change. */
const PART_BYTES = 1_500_000;
/** Songs kept decoded: this one, the next, one more (≈100 MB each at most). */
const KEEP_SONGS = 3;

/** The first of these to succeed (or the last failure). */
function firstOf<T>(ps: Promise<T>[]): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let left = ps.length;
    for (const p of ps)
      p.then(resolve, (e) => {
        if (--left === 0) reject(e);
      });
  });
}

class Engine {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  volume = 0.9;
  /** This PC's speakers are this much later than Windows says (Bluetooth…), ms. */
  delayMs = 0;
  song: Song | null = null;
  anchor: Anchor | null = null;
  /** Per song: resolves when it can start playing. */
  private loads = new Map<string, Promise<AudioBuffer>>();
  /** Per song: the longest decoded so far (its start, or all of it). */
  private best = new Map<string, AudioBuffer>();
  private whole = new Set<string>();
  private wholeFailed = new Map<string, string>();
  private order: string[] = [];
  private cur: Playing | null = null;
  /** audio clock − page clock (ms), the middle of the last few readings. */
  private map: number[] = [];
  private errEma: number | null = null;
  private timer = 0;
  loading = false;
  problem: string | null = null;
  onEnded: (() => void) | null = null;
  onChange: (() => void) | null = null;

  private audio(): AudioContext {
    if (!this.ctx) {
      try {
        // The songs are 44.1 kHz: decoding at that rate skips a resampling step.
        this.ctx = new AudioContext({ latencyHint: "interactive", sampleRate: 44100 });
      } catch {
        this.ctx = new AudioContext({ latencyHint: "interactive" });
      }
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume().catch(() => {});
    return this.ctx;
  }
  /** Call from a click (the sound card may wait for one). */
  wake() {
    this.audio();
  }

  private async fetchDecode(url: string, part: boolean): Promise<AudioBuffer> {
    const ctl = new AbortController();
    const t = window.setTimeout(() => ctl.abort(), part ? 20000 : 90000);
    try {
      const res = await fetch(url, { signal: ctl.signal, headers: part ? { Range: `bytes=0-${PART_BYTES - 1}` } : undefined });
      if (!res.ok) throw new Error(`the music service answered ${res.status}`);
      return await this.audio().decodeAudioData(await res.arrayBuffer());
    } finally {
      window.clearTimeout(t);
    }
  }

  /** Starts downloading a song; resolves as soon as it can start playing. */
  load(song: Song): Promise<AudioBuffer> {
    const had = this.loads.get(song.id);
    if (had) return had;
    const take = (b: AudioBuffer, whole: boolean) => {
      if (!this.loads.has(song.id)) return b; // let go meanwhile
      const old = this.best.get(song.id);
      if (!old || b.duration > old.duration) this.best.set(song.id, b);
      if (whole) this.whole.add(song.id);
      this.upgrade(song.id);
      return b;
    };
    const whole = this.fetchDecode(song.stream, false).then((b) => take(b, true));
    whole.catch((e) => {
      this.wholeFailed.set(song.id, e instanceof Error ? e.message : String(e));
      this.upgrade(song.id);
    });
    // (A service that ignores the range sends the whole song: then that's it.)
    const part = this.fetchDecode(song.stream, true).then((b) => take(b, b.duration >= song.duration - 1));
    part.catch(() => {});
    const first = firstOf([part, whole]);
    first.catch(() => {
      this.loads.delete(song.id);
      this.best.delete(song.id);
    });
    this.loads.set(song.id, first);
    this.wholeFailed.delete(song.id);
    this.order = [...this.order.filter((id) => id !== song.id), song.id];
    for (const id of [...this.order]) {
      if (this.order.length <= KEEP_SONGS) break;
      if (id === this.song?.id || id === song.id) continue;
      this.order = this.order.filter((x) => x !== id);
      this.loads.delete(id);
      this.best.delete(id);
      this.whole.delete(id);
    }
    return first;
  }
  isReady = (id: string) => this.best.has(id);

  /** More of the song arrived: carry on with it from the very same sample. */
  private upgrade(id: string) {
    const ctx = this.ctx;
    const a = this.anchor;
    if (!ctx || !a || this.song?.id !== id) return;
    const buf = this.best.get(id);
    const p = this.cur;
    if (!buf) return;
    if (p && !p.ended && p.songId === id) {
      if (!p.partial || buf.duration <= p.buf.duration + 0.5) return;
      const at = ctx.currentTime + 0.05;
      const pos = p.pos0 + (at - p.c0) * p.rate;
      if (pos < p.buf.duration - 0.05) {
        this.fadeOut(p, at, 0.004);
        this.cur = this.startSource(id, buf, at, pos, p.rate, 0.004);
        return;
      }
    }
    // The start ran out before the rest came (or a jump went past it): the plan says where.
    if (a.playing && (!p || p.ended || p.songId !== id)) {
      if (this.wholeFailed.has(id) && !this.whole.has(id)) {
        this.loading = false;
        this.problem = `The rest of this song didn't download (${this.wholeFailed.get(id)}).`;
        this.onChange?.();
        return;
      }
      this.loading = false;
      this.place(buf);
      this.onChange?.();
    }
  }

  // -- clocks: audio clock ↔ page clock ↔ host clock
  private stamp(): { c: number; p: number } {
    const ctx = this.ctx!;
    const ts = ctx.getOutputTimestamp?.();
    if (ts && ts.performanceTime && ts.contextTime) return { c: ts.contextTime, p: ts.performanceTime };
    return { c: ctx.currentTime - (ctx.baseLatency || 0) - ((ctx as AudioContext & { outputLatency?: number }).outputLatency || 0), p: performance.now() };
  }
  private remap() {
    const s = this.stamp();
    this.map.push(s.c * 1000 - s.p);
    if (this.map.length > 9) this.map.shift();
    return s;
  }
  private get mapMs() {
    if (!this.map.length) this.remap();
    const v = [...this.map].sort((a, b) => a - b);
    return v[v.length >> 1];
  }
  /** Audio-clock time (s) a sample must have to be heard at host time `h` (ms)… */
  private ctxAtHost(h: number) {
    return (clock.perfAt(h) - this.delayMs + this.mapMs) / 1000;
  }
  /** …and the host time (ms) at which the sample at audio-clock time `c` (s) is heard. */
  private hostAtCtx(c: number) {
    return c * 1000 - this.mapMs + this.delayMs + clock.corr + clock.offset;
  }
  /** The song position (s) the plan wants heard at host time `h`. */
  private planned(h: number): number {
    const a = this.anchor!;
    return (a.posMs + (a.playing ? h - a.hostUs / 1000 : 0)) / 1000;
  }

  /** Where the song is now (s), for the screen. */
  position(): number {
    if (!this.anchor) return 0;
    const a = this.anchor;
    if (!a.playing) return a.posMs / 1000;
    const h = clock.hostNow();
    return Math.max(0, h < a.hostUs / 1000 ? a.posMs / 1000 : this.planned(h));
  }
  errMs(): number | null {
    return this.errEma == null ? null : Math.round(this.errEma * 10) / 10;
  }
  /** For tests: the song position (s) heard at page time `perfMs`, from what the sound card was given. */
  heardAt(perfMs: number): number | null {
    const p = this.cur;
    if (!p || !this.ctx || p.ended) return null;
    const c = (perfMs - this.delayMs + this.mapMs) / 1000;
    return c < p.c0 ? null : p.pos0 + (c - p.c0) * p.rate;
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  /** Follow this plan for this song. */
  async apply(song: Song, anchor: Anchor) {
    const changed = this.song?.id !== song.id;
    this.song = song;
    this.anchor = anchor;
    this.problem = null;
    if (!this.best.has(song.id)) {
      // Silence while the new song loads (the old one stops at the plan's moment).
      if (changed) this.stopAt(anchor.hostUs / 1000);
      this.loading = true;
      this.onChange?.();
      try {
        await this.load(song);
      } catch (e) {
        if (this.song?.id === song.id) {
          this.loading = false;
          this.problem = `This song could not be loaded here (${e instanceof Error ? e.message : String(e)}).`;
          this.onChange?.();
        }
        return;
      }
      if (this.song?.id !== song.id || this.anchor !== anchor) return; // a newer plan came meanwhile
      this.loading = false;
    }
    this.place(this.best.get(song.id)!);
    this.onChange?.();
  }

  private startSource(songId: string, buf: AudioBuffer, when: number, pos: number, rate: number, fade: number): Playing {
    const ctx = this.ctx!;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(1, when + fade);
    gain.connect(this.master!);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    src.connect(gain);
    const partial = !this.whole.has(songId) && buf.duration < (this.song?.duration ?? 0) - 1;
    const p: Playing = { songId, buf, partial, src, gain, c0: when, pos0: pos, rate, ended: false };
    src.onended = () => {
      if (this.cur !== p || p.ended) return;
      p.ended = true;
      if (p.partial) {
        // Ran past the start before the rest came: quiet until it does.
        this.cur = null;
        this.loading = true;
        this.onChange?.();
        this.upgrade(songId);
      } else this.finish();
    };
    src.start(when, Math.max(0, pos));
    this.run();
    return p;
  }

  /** Hands the sound card the song so the plan is met (a fade of a few ms, no click). */
  private place(buf: AudioBuffer, crossfade = false) {
    const ctx = this.audio();
    const a = this.anchor!;
    this.remap();
    const startAt = a.hostUs / 1000;
    if (!a.playing) {
      this.stopAt(startAt);
      return;
    }
    // The plan's moment, or — if that is past or too near for the sound card (its own
    // buffer is ahead of the speaker) — the first moment it can still be met, further in.
    const h = Math.max(startAt, this.hostAtCtx(ctx.currentTime + 0.03));
    const pos = this.planned(h);
    const partial = !this.whole.has(a.songId) && buf.duration < (this.song?.duration ?? 0) - 1;
    if (pos >= buf.duration - 0.05) {
      this.stopAt(h);
      if (partial) {
        // Past the part that's in: on as soon as the rest comes.
        this.loading = true;
        this.upgrade(a.songId);
      } else this.finish();
      return;
    }
    const when = this.ctxAtHost(h);
    const fade = crossfade ? 0.012 : 0.006;
    if (this.cur) this.fadeOut(this.cur, when, fade);
    this.cur = this.startSource(a.songId, buf, when, pos, 1, fade);
    this.errEma = null;
  }

  private fadeOut(p: Playing, when: number, fade: number) {
    const ctx = this.ctx!;
    p.ended = true;
    const at = Math.max(ctx.currentTime, when - fade);
    p.gain.gain.cancelScheduledValues(at);
    p.gain.gain.setValueAtTime(1, at);
    p.gain.gain.linearRampToValueAtTime(0, at + fade);
    try {
      p.src.stop(at + fade + 0.01);
    } catch {
      /* already stopped */
    }
  }
  /** The sound stops at host time `h` (ms). */
  private stopAt(h: number) {
    if (!this.cur || !this.ctx) return;
    this.remap();
    this.fadeOut(this.cur, Math.max(this.ctx.currentTime, this.ctxAtHost(h)), 0.006);
    this.cur = null;
  }
  private finish() {
    if (this.anchor) this.anchor = { ...this.anchor, playing: false, posMs: Math.round((this.song?.duration ?? 0) * 1000) };
    this.onEnded?.();
    this.onChange?.();
  }

  stop() {
    if (this.cur) this.fadeOut(this.cur, this.ctx?.currentTime ?? 0, 0.006);
    this.cur = null;
    this.anchor = null;
    this.song = null;
    this.loading = false;
    window.clearInterval(this.timer);
    this.timer = 0;
    this.onChange?.();
  }

  /** Four times a second: is the speaker where the plan wants it? */
  private run() {
    if (this.timer) return;
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
  }
  tick() {
    const p = this.cur;
    const a = this.anchor;
    if (!this.ctx || !p || !a || !a.playing || p.ended) return;
    const s = this.remap();
    if (s.c < p.c0) return; // not started yet
    const actual = p.pos0 + (s.c - p.c0) * p.rate;
    // The sample leaving now is heard `delayMs` later: when, on the host's clock?
    const heardAt = s.p + clock.corr + clock.offset + this.delayMs;
    const err = actual - this.planned(heardAt);
    if (Math.abs(err) * 1000 > HARD_MS) {
      const buf = this.best.get(p.songId);
      if (buf) this.place(buf, true);
      return;
    }
    this.errEma = this.errEma == null ? err * 1000 : this.errEma * 0.7 + err * 300;
    const e = this.errEma / 1000;
    const rate = Math.abs(e) < 0.0015 ? 1 : 1 - Math.max(-0.004, Math.min(0.004, e * 0.4));
    if (rate !== p.rate) {
      const now = this.ctx.currentTime;
      p.pos0 = p.pos0 + (now - p.c0) * p.rate;
      p.c0 = now;
      p.rate = rate;
      p.src.playbackRate.setValueAtTime(rate, now);
    }
    // The song is over (onended also says so; this catches a suspended context).
    if (!p.partial && this.song && actual >= this.song.duration - 0.03 && !p.ended) {
      p.ended = true;
      this.finish();
    }
  }
}
export const engine = new Engine();

// ------------------------------------------------------------------ the party

interface Party {
  id: string;
  role: "host" | "member";
  hostId: string;
  hostName: string;
  members: Map<string, Member>;
  invited: Map<string, string>;
  seq: number;
  song: Song | null;
  next: Song | null;
  anchor: Anchor | null;
  heardAt: number;
  /** The host is changing song: plans after this one wait. */
  token: number;
  problem: string | null;
}
let party: Party | null = null;
const invites = new Map<string, Invite>();
const viewListeners = new Set<() => void>();
let view: PartyView = null;
let inviteList: Invite[] = [];
let timers: number[] = [];
let unStep: (() => void) | null = null;

const rand = () => Math.random().toString(36).slice(2, 10);
const slim = (s: Song | null) =>
  s && { id: s.id, title: s.title, artist: s.artist, album: s.album, albumId: s.albumId, cover: s.cover, url: s.url, stream: s.stream, duration: Math.round(s.duration), language: s.language, year: s.year, artistIds: s.artistIds.slice(0, 4) };
const asSong = (v: unknown): Song | null => {
  const s = v as Song | null;
  return s && typeof s.id === "string" && typeof s.stream === "string" && /^https:\/\//.test(s.stream) ? { ...s, artistIds: Array.isArray(s.artistIds) ? s.artistIds : [] } : null;
};
const asAnchor = (v: unknown): Anchor | null => {
  const a = v as { song_id?: string; pos_ms?: number; host_us?: number; playing?: boolean } | null;
  return a && typeof a.song_id === "string" && Number.isFinite(a.pos_ms) && Number.isFinite(a.host_us) ? { songId: a.song_id, posMs: Number(a.pos_ms), hostUs: Number(a.host_us), playing: !!a.playing } : null;
};
const wireAnchor = (a: Anchor | null) => a && { song_id: a.songId, pos_ms: Math.round(a.posMs), host_us: Math.round(a.hostUs), playing: a.playing };

function refresh() {
  const p = party;
  view = p && {
    id: p.id,
    role: p.role,
    hostId: p.hostId,
    hostName: p.hostName,
    members: [...p.members.values()],
    invited: [...p.invited].map(([id, name]) => ({ id, name })),
    song: engine.song ?? p.song,
    playing: !!engine.anchor?.playing,
    errMs: engine.errMs(),
    loading: engine.loading,
    offsetMs: Math.round(clock.offset * 100) / 100,
    delayMs: Math.round(clock.delay * 100) / 100,
    problem: engine.problem ?? p.problem,
  };
  inviteList = [...invites.values()].sort((a, b) => b.at - a.at);
  for (const l of viewListeners) l();
  // The music app's player shows the party's song and where it is.
  if (p) musicOutput.update({ song: engine.song ?? p.song, playing: !!engine.anchor?.playing, position: engine.position(), duration: (engine.song ?? p.song)?.duration ?? 0, error: engine.problem });
}
engine.onChange = refresh;

function stateData(p: Party, extra: Record<string, unknown> = {}) {
  return {
    song: slim(p.song),
    next: slim(p.next),
    anchor: wireAnchor(p.anchor),
    host_name: p.hostName,
    members: [...p.members.values()].map((m) => ({ id: m.id, name: m.name })),
    ...extra,
  };
}
async function send(peerId: string, action: string, data: Record<string, unknown> = {}, seq = party?.seq ?? 0): Promise<string | null> {
  if (!party) return "Not listening together.";
  try {
    await transport.send(peerId, { party_id: party.id, action, seq, data, at: 0 });
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
/** Host: the plan to every colleague (all at once). */
function broadcast(extra: Record<string, unknown> = {}) {
  const p = party;
  if (!p || p.role !== "host") return;
  p.seq += 1;
  const data = stateData(p, extra);
  for (const m of p.members.values()) {
    void send(m.id, "state", data, p.seq).then((err) => {
      if (err && party === p && /offline|reach|No answer/.test(err)) {
        // Two misses in a row: they're gone.
        const mm = p.members.get(m.id);
        if (mm && Date.now() - mm.at > HEARTBEAT_MS * 2) {
          p.members.delete(m.id);
          refresh();
        }
      }
    });
  }
}

function every(ms: number, fn: () => void) {
  timers.push(window.setInterval(fn, ms));
}
function clearTimers() {
  timers.forEach((t) => window.clearInterval(t));
  timers = [];
}

// -- host: the music app's player plays through the party

const hostOutput = {
  follower: false,
  play: (song: Song, fromS: number) => void hostPlay(song, fromS),
  resume: () => hostPlan(true),
  pause: () => hostPlan(false),
  seek: (s: number) => hostPlan(!!party?.anchor?.playing, s),
  setVolume: (v: number) => engine.setVolume(v),
  stop: () => hostPlan(false),
};
const followerOutput = {
  follower: true,
  play: () => {},
  resume: () => {},
  pause: () => {},
  seek: () => {},
  setVolume: (v: number) => engine.setVolume(v),
  stop: () => void leave(),
};

async function hostPlay(song: Song, fromS: number) {
  const p = party;
  if (!p || p.role !== "host") return;
  const token = ++p.token;
  p.song = song;
  const q = player.state();
  p.next = q.queue[q.index + 1] ?? null;
  // Everyone starts loading now; the start is planned once they have it.
  p.anchor = { songId: song.id, posMs: Math.round(fromS * 1000), hostUs: Math.round(clock.hostNow() * 1000), playing: false };
  for (const m of p.members.values()) m.loading = true;
  broadcast({ preparing: true });
  await engine.apply(song, p.anchor);
  if (party !== p || p.token !== token) return;
  const until = performance.now() + READY_WAIT_MS;
  while (performance.now() < until && [...p.members.values()].some((m) => m.loading)) {
    await new Promise((r) => window.setTimeout(r, 60));
    if (party !== p || p.token !== token) return;
  }
  p.anchor = { songId: song.id, posMs: Math.round(fromS * 1000), hostUs: Math.round((clock.hostNow() + LEAD_MS) * 1000), playing: true };
  void engine.apply(song, p.anchor);
  broadcast();
  void rememberPlayedSoon(song);
}
async function rememberPlayedSoon(song: Song) {
  void rememberPlayed(song);
}
/** Host: play or pause (or jump to `seekS`), a moment from now everywhere. */
function hostPlan(playing: boolean, seekS?: number) {
  const p = party;
  if (!p || p.role !== "host" || !p.song) return;
  p.token += 1;
  const lead = playing ? LEAD_MS : PAUSE_LEAD_MS;
  const h = clock.hostNow() + lead;
  const pos = seekS != null ? seekS * 1000 : p.anchor ? (p.anchor.playing ? p.anchor.posMs + (h - p.anchor.hostUs / 1000) : p.anchor.posMs) : 0;
  p.anchor = { songId: p.song.id, posMs: Math.round(Math.max(0, pos)), hostUs: Math.round(h * 1000), playing };
  void engine.apply(p.song, p.anchor);
  broadcast();
}

/** Starts Listen together with these colleagues (invites them; they choose to join).
 *  Returns, per colleague who couldn't be invited, why. Call from a click. */
export async function startListening(people: { id: string; name: string }[], myName: string): Promise<Record<string, string>> {
  if (party?.role === "member") await leave();
  engine.wake();
  if (!party) {
    await clock.local();
    clock.offset = 0;
    clock.delay = 0;
    party = { id: `lt-${rand()}${rand()}`, role: "host", hostId: "", hostName: myName, members: new Map(), invited: new Map(), seq: 0, song: null, next: null, anchor: null, heardAt: Date.now(), token: 0, problem: null };
    listen();
    engine.onEnded = () => musicOutput.ended();
    const was = musicOutput.attach(hostOutput);
    every(HEARTBEAT_MS, () => broadcast());
    every(30000, () => void clock.local());
    every(TICK_MS, () => party && refresh());
    // What was playing carries on, now in step for everyone.
    if (was.song) {
      party.song = was.song;
      const p = party;
      const token = ++p.token;
      void engine.load(was.song).then(() => {
        if (party !== p || p.token !== token) return;
        const h = clock.hostNow() + LEAD_MS;
        const pos = (musicOutput.localTime() + LEAD_MS / 1000) * 1000;
        p.anchor = { songId: was.song!.id, posMs: Math.round(pos), hostUs: Math.round(h * 1000), playing: was.playing };
        musicOutput.silenceLocalAt(was.playing ? LEAD_MS : 0);
        void engine.apply(was.song!, p.anchor);
        broadcast();
      });
    }
  }
  const p = party;
  const failed: Record<string, string> = {};
  await Promise.all(
    people.map(async (x) => {
      if (p.members.has(x.id)) return;
      const err = await send(x.id, "invite", stateData(p, { people: p.members.size + 1 }));
      if (err) failed[x.id] = err;
      else p.invited.set(x.id, x.name);
    }),
  );
  refresh();
  return failed;
}

/** Host: everyone stops; this PC carries on alone with the normal player. */
export async function stopListening() {
  const p = party;
  if (!p || p.role !== "host") return;
  const pos = engine.position();
  const playing = !!engine.anchor?.playing;
  const song = engine.song;
  await Promise.all([...p.members.keys()].map((id) => send(id, "end")));
  closeParty();
  musicOutput.attach(null);
  if (song) musicOutput.resumeLocal(song, pos, playing);
}

// -- members

/** Joins a colleague's music (call from a click: the sound card may need one). */
export async function join(inv: Invite) {
  if (party) {
    if (party.role === "host") await stopListening();
    else await leave();
  }
  engine.wake();
  invites.delete(inv.partyId);
  party = { id: inv.partyId, role: "member", hostId: inv.hostId, hostName: inv.hostName, members: new Map(), invited: new Map(), seq: 0, song: inv.song, next: null, anchor: null, heardAt: Date.now(), token: 0, problem: null };
  const p = party;
  listen();
  player.stop();
  musicOutput.attach(followerOutput);
  refresh();
  try {
    await clock.local();
    await clock.host(inv.hostId, 16);
  } catch (e) {
    p.problem = `Couldn't line up with ${inv.hostName}'s clock: ${e instanceof Error ? e.message : String(e)}`;
  }
  if (party !== p) return;
  const err = await send(inv.hostId, "join", {});
  if (err) {
    p.problem = err;
    refresh();
    return;
  }
  every(CLOCK_EVERY_MS, async () => {
    if (party !== p) return;
    try {
      const jump = await clock.host(p.hostId, 8);
      // A big correction: the plan's moment moved, so place the sound again.
      if (jump > HARD_MS / 2 && engine.song && engine.anchor) void engine.apply(engine.song, engine.anchor);
    } catch {
      /* next time */
    }
  });
  every(30000, () => void clock.local());
  every(STATUS_MS, () => {
    if (party !== p) return;
    if (Date.now() - p.heardAt > LOST_MS) {
      p.problem = `Lost contact with ${p.hostName}.`;
      void leave(false);
      return;
    }
    void send(p.hostId, "status", { err_ms: engine.errMs() == null ? null : Math.round(engine.errMs()!), song_id: engine.song?.id ?? null, loading: engine.loading });
  });
  every(TICK_MS, () => party && refresh());
}

/** Stops listening along (and tells the host, unless they ended it). */
export async function leave(tell = true) {
  const p = party;
  if (!p || p.role !== "member") return;
  closeParty();
  musicOutput.attach(null);
  musicOutput.update({ song: null, playing: false, position: 0, duration: 0, queue: [], index: -1, error: null });
  if (tell) await transport.send(p.hostId, { party_id: p.id, action: "leave", seq: 0, data: {}, at: 0 }).catch(() => {});
}
export function decline(inv: Invite) {
  invites.delete(inv.partyId);
  refresh();
  void transport.send(inv.hostId, { party_id: inv.partyId, action: "decline", seq: 0, data: {}, at: 0 }).catch(() => {});
}

function closeParty() {
  clearTimers();
  engine.stop();
  engine.onEnded = null;
  party = null;
  refresh();
}

// -- what colleagues send

function listen() {
  if (unStep) return;
  unStep = transport.onStep(onStep);
}
export function startListeningForInvites() {
  listen();
}

function onStep(e: StepEvent) {
  const p = party;
  const d = e.data ?? {};
  if (e.action === "invite") {
    if (p?.id === e.party_id) return;
    invites.set(e.party_id, { partyId: e.party_id, hostId: e.from_id, hostName: e.from_name, song: asSong(d.song), people: Number(d.people) || 1, at: Date.now() });
    refresh();
    return;
  }
  if (!p || p.id !== e.party_id) {
    if (e.action === "end" && invites.delete(e.party_id)) refresh();
    return;
  }
  if (p.role === "host") {
    const m = p.members.get(e.from_id);
    if (e.action === "join") {
      p.invited.delete(e.from_id);
      p.members.set(e.from_id, { id: e.from_id, name: e.from_name, errMs: null, loading: true, at: Date.now() });
      refresh();
      void send(e.from_id, "state", stateData(p), p.seq);
    } else if (e.action === "leave" || e.action === "decline") {
      p.members.delete(e.from_id);
      p.invited.delete(e.from_id);
      refresh();
    } else if (m && e.action === "ready") {
      if (d.song_id === p.song?.id) m.loading = false;
      m.at = Date.now();
      refresh();
    } else if (m && e.action === "status") {
      m.errMs = typeof d.err_ms === "number" ? d.err_ms : null;
      m.loading = !!d.loading;
      m.at = Date.now();
      refresh();
    }
    return;
  }
  // member
  if (e.from_id !== p.hostId) return;
  p.heardAt = Date.now();
  if (e.action === "end") {
    p.problem = null;
    void leave(false);
    window.dispatchEvent(new CustomEvent("lanx:listen-ended", { detail: { hostName: p.hostName } }));
    return;
  }
  if (e.action !== "state" || e.seq < p.seq) return;
  p.seq = e.seq;
  const song = asSong(d.song);
  const anchor = asAnchor(d.anchor);
  p.next = asSong(d.next);
  if (Array.isArray(d.members)) {
    p.members = new Map((d.members as { id: string; name: string }[]).filter((m) => m && typeof m.id === "string").map((m) => [m.id, { id: m.id, name: String(m.name ?? ""), errMs: null, loading: false, at: Date.now() }]));
  }
  if (!song || !anchor) {
    refresh();
    return;
  }
  p.song = song;
  p.anchor = anchor;
  void engine.apply(song, anchor).then(() => {
    if (party === p && engine.isReady(song.id)) void send(p.hostId, "ready", { song_id: song.id });
    // The next song downloads while this one plays: changing song is then instant.
    if (party === p && p.next && !engine.isReady(p.next.id)) void engine.load(p.next).catch(() => {});
  });
  refresh();
}

// ------------------------------------------------------------------ for the screen

export const listenTogether = {
  subscribe(l: () => void): () => void {
    viewListeners.add(l);
    return () => viewListeners.delete(l);
  },
  view: () => view,
  invites: () => inviteList,
  /** This PC's speakers are this much later than Windows says (ms; Bluetooth ≈ 150–250). */
  async setDelay(ms: number) {
    engine.delayMs = Math.max(-300, Math.min(600, Math.round(ms)));
    await api.setPref(DELAY_PREF, String(engine.delayMs)).catch(() => {});
    if (engine.song && engine.anchor) void engine.apply(engine.song, engine.anchor);
    refresh();
  },
  delay: () => engine.delayMs,
  /** For tests: the clocks and where this PC's speaker is against the plan. */
  probe(wallMs?: number) {
    const a = engine.anchor;
    return { heard: wallMs == null ? null : engine.heardAt(wallMs - performance.timeOrigin), hostNow: clock.hostNow(), position: engine.position(), errMs: engine.errMs(), offset: clock.offset, corr: clock.corr, delay: clock.delay, songId: engine.song?.id ?? null, playing: !!a?.playing, loading: engine.loading, ctx: engine.ctx?.state ?? null };
  },
  /** For tests: talk through a stand-in instead of LANX. */
  useTransport(t: Transport) {
    unStep?.();
    unStep = null;
    transport = t;
    listen();
  },
};
/** For the end-to-end tests (and support): where this PC is against the plan. */
(window as unknown as { __lanxListen?: unknown }).__lanxListen = { ...listenTogether, start: startListening, join, leave, stop: stopListening, player, searchSongs };

void api
  .getPref(DELAY_PREF)
  .then((v) => {
    const n = Number(v);
    if (v && Number.isFinite(n)) engine.delayMs = n;
  })
  .catch(() => {});
