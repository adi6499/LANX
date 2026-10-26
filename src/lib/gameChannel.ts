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

export class GameChannel {
  private lines = new Map<number, Line>();
  private listeners = new Set<(from: number, data: unknown) => void>();
  private closed = false;

  constructor(private hooks: ChannelHooks) {
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
      for (const fn of this.listeners) fn(d.from, d.payload);
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
    const targets = this.hooks.host ? (to === undefined ? [...this.lines.keys()] : [to]) : [...this.lines.keys()];
    const text = JSON.stringify({ from: this.hooks.me, payload: data });
    let sent = false;
    for (const t of targets) {
      const l = this.lines.get(t);
      if (l?.dc && l.open && l.dc.readyState === "open") {
        try {
          l.dc.send(text);
          sent = true;
        } catch {
          /* fall through to the relay */
        }
      }
    }
    if (!sent) this.hooks.sendDelta({ kind: "live", from: this.hooks.me, to, payload: data });
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
        const m = JSON.parse(String(e.data)) as { from: number; payload: unknown };
        for (const fn of this.listeners) fn(m.from, m.payload);
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
