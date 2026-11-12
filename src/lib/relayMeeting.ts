/** LANX 3.10.0: a big meeting's one connection — to the organizer's relay
 *  (src-tauri/src/relay.rs). This PC sends its microphone and its camera once
 *  (the camera in two sizes: small "q" for tiles, sharp "h" for the large one)
 *  and receives fixed slots: 6 voices (the loudest) and 16 pictures (the people
 *  it shows). A data channel says who is in which slot, and who is talking;
 *  this PC says whom it shows, and whom large. */
import { api } from "./api";
import { iceGathered } from "./webrtc";

export const AUDIO_SLOTS = 6;
export const VIDEO_SLOTS = 16;

interface SlotMsg {
  mid: string;
  id: string | null;
  ready?: boolean;
}

/** The camera's two sizes (the screen: the large one sharp, full size). */
function encodings(screen: boolean): RTCRtpEncodingParameters[] {
  return screen
    ? [
        { rid: "q", scaleResolutionDownBy: 4, maxBitrate: 200_000 },
        { rid: "h", scaleResolutionDownBy: 1, maxBitrate: 1_800_000 },
      ]
    : [
        { rid: "q", scaleResolutionDownBy: 3, maxBitrate: 160_000 },
        { rid: "h", scaleResolutionDownBy: 1.5, maxBitrate: 750_000 },
      ];
}

/** What the relay needs from this PC's offer. The browser's offer lists every
 *  picture format it knows and every network address, in each of the 24
 *  channels (≈125 KB, too big to send); the relay uses Opus and VP8, and one
 *  shared connection, so the rest is left out (≈17 KB). The browser keeps its
 *  full offer: the relay's answer picks from what is still listed. */
export function relayOffer(sdp: string): string {
  const keepExt = /urn:ietf:params:rtp-hdrext:(ssrc-audio-level|sdes:mid|sdes:rtp-stream-id|sdes:repaired-rtp-stream-id)|abs-send-time|transport-wide-cc|video-orientation/;
  // (Every channel after the first shares the first one's connection: BUNDLE.)
  const shared = /^a=(candidate|end-of-candidates|ice-ufrag|ice-pwd|ice-options|fingerprint|setup)\b/;
  const [head, ...sections] = sdp.split(/\r?\n(?=m=)/);
  const out = [head];
  sections.forEach((sec, n) => {
    const lines = sec.split(/\r?\n/).filter((l) => l !== "");
    const m = lines[0].match(/^m=(audio|video) (\d+) (\S+) /);
    if (!m) {
      out.push(lines.filter((l) => n === 0 || !shared.test(l)).join("\r\n"));
      return;
    }
    const kind = m[1];
    const pts = new Set<string>();
    for (const l of lines) {
      const r = l.match(/^a=rtpmap:(\d+) ([^/\s]+)\//);
      if (r && (kind === "audio" ? /^opus$/i.test(r[2]) : /^VP8$/i.test(r[2]))) pts.add(r[1]);
    }
    for (const l of lines) {
      const f = l.match(/^a=fmtp:(\d+) apt=(\d+)/);
      if (f && pts.has(f[2])) pts.add(f[1]);
    }
    if (!pts.size) {
      out.push(sec);
      return;
    }
    const kept = lines.slice(1).filter((l) => {
      const p = l.match(/^a=(?:rtpmap|fmtp|rtcp-fb):(\d+)/);
      if (p && !pts.has(p[1])) return false;
      if (n > 0 && shared.test(l)) return false;
      return !(l.startsWith("a=extmap:") && !keepExt.test(l));
    });
    out.push([`m=${kind} ${m[2]} ${m[3]} ${[...pts].join(" ")}`, ...kept].join("\r\n"));
  });
  return out.join("\r\n") + "\r\n";
}

export class RelayConnection {
  pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private mic: RTCRtpTransceiver | null = null;
  private cam: RTCRtpTransceiver | null = null;
  private audio: RTCRtpTransceiver[] = [];
  private video: RTCRtpTransceiver[] = [];
  private aMap = new Map<string, string>();
  private vMap = new Map<string, { id: string; ready: boolean }>();
  /** Per person: their picture (once it's through) and voice, in a stream that
   *  stays the same object while its tracks do (so tiles don't flicker). */
  streams = new Map<string, MediaStream>();
  /** Per voice slot: a stream to play (always the same object). */
  voices: MediaStream[] = [];
  speaker: string | null = null;
  connected = false;
  /** Connecting failed (the meeting tries again a moment later). */
  failed = false;
  private wantSent = "";
  private wantNext: { ids: string[]; big: string | null } | null = null;
  private closed = false;
  private screen = false;

  constructor(private onChange: () => void) {}

  async connect(meetingId: string, mic: MediaStreamTrack | null, video: MediaStreamTrack | null, screen = false) {
    this.screen = screen;
    const pc = new RTCPeerConnection({ iceServers: [] });
    this.pc = pc;
    // The data channel goes into the first offer (no renegotiation later).
    const dc = pc.createDataChannel("lanx-relay");
    this.dc = dc;
    dc.onopen = () => this.flushWant();
    dc.onmessage = (e) => this.message(String(e.data));
    this.mic = pc.addTransceiver(mic ?? "audio", { direction: "sendonly" });
    this.cam = pc.addTransceiver(video ?? "video", { direction: "sendonly", sendEncodings: encodings(screen) });
    this.audio = Array.from({ length: AUDIO_SLOTS }, () => pc.addTransceiver("audio", { direction: "recvonly" }));
    this.video = Array.from({ length: VIDEO_SLOTS }, () => pc.addTransceiver("video", { direction: "recvonly" }));
    this.voices = this.audio.map((t) => new MediaStream([t.receiver.track]));
    pc.onconnectionstatechange = () => {
      this.connected = pc.connectionState === "connected";
      this.onChange();
    };
    await pc.setLocalDescription(await pc.createOffer());
    await iceGathered(pc);
    if (this.closed) return;
    const answer = await api.meetingRelayOffer(meetingId, relayOffer(pc.localDescription?.sdp ?? ""));
    if (this.closed) return;
    await pc.setRemoteDescription({ type: "answer", sdp: answer });
    this.onChange();
  }

  private message(text: string) {
    let m: { t?: string; a?: SlotMsg[]; v?: SlotMsg[]; id?: string | null };
    try {
      m = JSON.parse(text);
    } catch {
      return;
    }
    if (m.t === "slots") {
      this.aMap.clear();
      this.vMap.clear();
      for (const s of m.a ?? []) if (s.id) this.aMap.set(s.mid, s.id);
      for (const s of m.v ?? []) if (s.id) this.vMap.set(s.mid, { id: s.id, ready: !!s.ready });
      this.rebuild();
    } else if (m.t === "speaker") {
      this.speaker = m.id ?? null;
      this.onChange();
    }
  }

  /** Per person: the tracks of their slots; a new stream only when those change. */
  private rebuild() {
    const want = new Map<string, MediaStreamTrack[]>();
    const add = (id: string, t: MediaStreamTrack) => want.set(id, [...(want.get(id) ?? []), t]);
    for (const t of this.video) {
      const s = t.mid ? this.vMap.get(t.mid) : undefined;
      if (s?.ready) add(s.id, t.receiver.track);
    }
    for (const t of this.audio) {
      const id = t.mid ? this.aMap.get(t.mid) : undefined;
      if (id) add(id, t.receiver.track);
    }
    const next = new Map<string, MediaStream>();
    for (const [id, tracks] of want) {
      const old = this.streams.get(id);
      const same = old && old.getTracks().length === tracks.length && tracks.every((t) => old.getTracks().includes(t));
      next.set(id, same ? old! : new MediaStream(tracks));
    }
    this.streams = next;
    this.onChange();
  }

  /** Whom this PC shows (in order), and whom large (sharp). Sent when it changes. */
  setWanted(ids: string[], big: string | null) {
    this.wantNext = { ids: ids.slice(0, VIDEO_SLOTS), big };
    this.flushWant();
  }
  private flushWant() {
    const w = this.wantNext;
    if (!w || this.dc?.readyState !== "open") return;
    const text = JSON.stringify({ t: "want", ids: w.ids, big: w.big });
    if (text === this.wantSent) return;
    this.wantSent = text;
    this.dc.send(text);
  }

  async replace(kind: "audio" | "video", track: MediaStreamTrack | null, screen = this.screen) {
    const t = kind === "audio" ? this.mic : this.cam;
    await t?.sender.replaceTrack(track).catch(() => {});
    if (kind === "video" && t && screen !== this.screen) {
      this.screen = screen;
      const p = t.sender.getParameters();
      const want = encodings(screen);
      p.encodings = p.encodings.map((e, i) => ({ ...e, ...(want.find((w) => w.rid === e.rid) ?? want[i] ?? {}) }));
      await t.sender.setParameters(p).catch(() => {});
    }
  }

  close() {
    this.closed = true;
    this.pc?.close();
    this.pc = null;
    this.streams = new Map();
    this.connected = false;
  }

  /** For tests: who is in which slot, and how many pictures each slot has shown. */
  async probe() {
    const stats = (await this.pc?.getStats()) ?? new Map();
    const decoded = new Map<string, number>();
    stats.forEach((r: { type: string; kind?: string; mid?: string; framesDecoded?: number }) => {
      if (r.type === "inbound-rtp" && r.kind === "video" && r.mid) decoded.set(r.mid, r.framesDecoded ?? 0);
    });
    return {
      connected: this.connected,
      speaker: this.speaker,
      video: this.video.map((t) => ({ mid: t.mid, who: t.mid ? (this.vMap.get(t.mid) ?? null) : null, frames: t.mid ? (decoded.get(t.mid) ?? 0) : 0 })),
      audio: this.audio.map((t) => ({ mid: t.mid, who: t.mid ? (this.aMap.get(t.mid) ?? null) : null })),
      people: [...this.streams.entries()].map(([id, s]) => ({ id, video: s.getVideoTracks().length, audio: s.getAudioTracks().length })),
    };
  }
}
