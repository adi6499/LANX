// LANX 2.13.0: a live line between the host of a table and each player, for
// the real-time games. It is a WebRTC data channel (the same kind of
// connection calls use), set up through the match's "delta" steps, which
// carry the offer and answer. If the channel never opens, the same messages
// fall back to the (slower) delta relay through the host.

import { iceGathered } from "./webrtc";

export interface ChannelHooks {
  /** This PC's player number and whether it hosts. */
  me: number;
  host: boolean;
  /** Everyone's player numbers (the host's table). */
  players: number[];
  /** Sends a delta through the host relay (what the board already has). */
  sendDelta: (data: unknown) => void;
}

type Msg = { kind: "rtc"; to?: number; from: number; sdp: string; what: "offer" | "answer" };
type Line = { pc: RTCPeerConnection; dc: RTCDataChannel | null; open: boolean };
/** A message is passed through the host's relay at most this often per player (each one is a whole connection). */
const RELAY_EVERY_MS = 100;

export class GameChannel {
  private lines = new Map<number, Line>();
  private listeners = new Set<(from: number, data: unknown) => void>();
  private closed = false;
  /** LANX 3.17.0: every message has a number; one older than the newest heard from that player is left out. */
  private sent = 0;
  private heard = new Map<number, number>();
  private relayed = new Map<number, number>();
  /** True for a message that is newer than anything heard from that player (or carries no number: an older LANX). */
  private fresh(from: number, q: unknown): boolean {
    if (typeof q !== "number") return true;
    if (q <= (this.heard.get(from) ?? 0)) return false;
    this.heard.set(from, q);
    return true;
  }

  private hooks: ChannelHooks;

  constructor(hooks: ChannelHooks) {
    this.hooks = hooks;
    if (hooks.host) for (const p of hooks.players) if (p !== hooks.me) void this.offer(p);
  }

  /** Called with every delta the board receives; the channel takes the ones meant for it. */
  feed(data: unknown): boolean {
    const d = data as Msg & { kind: string; payload?: unknown };
    if (!d || typeof d !== "object") return false;
    if (d.kind === "rtc") {
      if (d.what === "offer" && !this.hooks.host && d.to === this.hooks.me) void this.answer(d.from, d.sdp);
      else if (d.what === "answer" && this.hooks.host) void this.lines.get(d.from)?.pc.setRemoteDescription({ type: "answer", sdp: d.sdp });
      return true;
    }
    if (d.kind === "live" && typeof d.from === "number") {
      // LANX 2.16.0: the sender as the match vouches for it (the host's relay), not as it claims.
      const claimed = (d as unknown as { __from?: unknown }).__from;
      const from = typeof claimed === "number" ? claimed : d.from;
      if (this.fresh(from, (d as unknown as { q?: unknown }).q)) for (const fn of this.listeners) fn(from, d.payload);
      return true;
    }
    return false;
  }

  onMessage(fn: (from: number, data: unknown) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /** Sends to one player (the host) or to everyone (the guests only reach the host). */
  send(data: unknown, to?: number) {
    if (this.closed) return;
    // LANX 3.17.0: player by player. Whoever has an open line gets it there; anyone whose line
    // is not open gets it through the host's relay. (The relay used to be tried only when no line
    // at all was open: with three or more at the table, a PC whose own line never opened got
    // nothing while the others played.) The relay is slower, so a player gets at most ten
    // messages a second that way.
    const q = ++this.sent;
    const text = JSON.stringify({ from: this.hooks.me, payload: data, q });
    const now = Date.now();
    const onLine = (l: Line | undefined): boolean => {
      if (!l?.dc || !l.open || l.dc.readyState !== "open") return false;
      try {
        l.dc.send(text);
        return true;
      } catch {
        return false; // the relay, then
      }
    };
    /** Not more often than the relay can bear (per player; a guest's one way is filed under -1). */
    const relayNow = (who: number): boolean => {
      if (now - (this.relayed.get(who) ?? 0) < RELAY_EVERY_MS) return false;
      this.relayed.set(who, now);
      return true;
    };
    if (!this.hooks.host) {
      // A guest reaches only the host: its line, or the relay.
      if (!onLine([...this.lines.values()][0]) && relayNow(-1)) this.hooks.sendDelta({ kind: "live", from: this.hooks.me, to, payload: data, q });
      return;
    }
    for (const t of to === undefined ? this.hooks.players.filter((p) => p !== this.hooks.me) : [to]) {
      if (!onLine(this.lines.get(t)) && relayNow(t)) this.hooks.sendDelta({ kind: "live", from: this.hooks.me, to: t, payload: data, q });
    }
  }

  get live(): boolean {
    return [...this.lines.values()].some((l) => l.open);
  }

  close() {
    this.closed = true;
    for (const l of this.lines.values()) {
      try {
        l.dc?.close();
        l.pc.close();
      } catch {
        /* closing */
      }
    }
    this.lines.clear();
  }

  private wire(p: number, pc: RTCPeerConnection, dc: RTCDataChannel) {
    const line: Line = { pc, dc, open: false };
    this.lines.set(p, line);
    dc.onopen = () => {
      line.open = true;
    };
    dc.onclose = () => {
      line.open = false;
    };
    dc.onmessage = (e) => {
      try {
        const m = JSON.parse(String(e.data)) as { from: number; payload: unknown; q?: unknown };
        // LANX 2.16.0: a line belongs to one player — whatever it says, it speaks for that player only.
        if (this.fresh(p, m.q)) for (const fn of this.listeners) fn(p, m.payload);
      } catch {
        /* ignore */
      }
    };
  }

  private async offer(p: number) {
    const pc = new RTCPeerConnection();
    const dc = pc.createDataChannel("game", { ordered: false, maxRetransmits: 0 });
    this.wire(p, pc, dc);
    await pc.setLocalDescription(await pc.createOffer());
    await iceGathered(pc, 1500);
    this.hooks.sendDelta({ kind: "rtc", what: "offer", to: p, from: this.hooks.me, sdp: pc.localDescription?.sdp ?? "" } satisfies Msg);
  }

  private async answer(from: number, sdp: string) {
    const pc = new RTCPeerConnection();
    const line: Line = { pc, dc: null, open: false };
    this.lines.set(from, line);
    pc.ondatachannel = (e) => this.wire(from, pc, e.channel);
    await pc.setRemoteDescription({ type: "offer", sdp });
    await pc.setLocalDescription(await pc.createAnswer());
    await iceGathered(pc, 1500);
    this.hooks.sendDelta({ kind: "rtc", what: "answer", to: from, from: this.hooks.me, sdp: pc.localDescription?.sdp ?? "" } satisfies Msg);
  }
}
