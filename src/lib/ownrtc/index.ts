/** LANX 3.13.0: a stand-in for the browser's RTCPeerConnection, for web engines
 *  that have none (Linux: WebKitGTK). It does what LANX's calls, meetings, big
 *  meetings, live games, remote help and the phone camera ask of a connection;
 *  the connection itself is LANX's own engine (src-tauri ownrtc.rs), and the
 *  pictures and sound are squeezed and shown here (./media.ts).
 *
 *  Not everything a browser has is here — only what LANX uses: offers and
 *  answers with every address in them (no trickle), transceivers with
 *  replaceTrack / setParameters, data channels, connection states and the stats
 *  the quality watch reads. */
import { Channel, invoke } from "@tauri-apps/api/core";
import { AudioSink, SendSlot, VideoSink, sound, type Target, type VideoSettings } from "./media";

type Dir = RTCRtpTransceiverDirection;
const sends = (d: Dir | null) => d === "sendrecv" || d === "sendonly";
const receives = (d: Dir | null) => d === "sendrecv" || d === "recvonly";

interface OfferOut {
  sdp: string;
  mids: string[];
  cids: number[];
}
interface MediaInfo {
  mid: string;
  kind: "audio" | "video";
  dir: Dir;
}
type Ctrl =
  | { t: "state"; s: "connected" | "closed" }
  | { t: "ice"; s: "new" | "checking" | "connected" | "completed" | "disconnected" }
  | { t: "media"; mid: string; kind: "audio" | "video"; dir: Dir }
  | { t: "dir"; mid: string; dir: Dir }
  | { t: "key"; mid: string }
  | { t: "paused"; mid: string; paused: boolean }
  | { t: "open"; cid: number; label: string }
  | { t: "close"; cid: number }
  | { t: "low"; cid: number };

/** An EventTarget whose `onX` properties are called too (like the browser's). */
class Emitter extends EventTarget {
  [k: string]: unknown;
  protected fire(type: string, extra: Record<string, unknown> = {}) {
    const ev = new Event(type);
    for (const [k, v] of Object.entries(extra)) Object.defineProperty(ev, k, { value: v, enumerable: true });
    const h = this[`on${type}`];
    if (typeof h === "function") {
      try {
        (h as (e: Event) => void).call(this, ev);
      } catch (e) {
        console.error(e);
      }
    }
    this.dispatchEvent(ev);
  }
}

// ------------------------------------------------------------------ data channels

export class OwnDataChannel extends Emitter {
  id: number | null = null;
  readyState: RTCDataChannelState = "connecting";
  bufferedAmount = 0;
  bufferedAmountLowThreshold = 0;
  binaryType: BinaryType = "arraybuffer";
  readonly negotiated = false;
  readonly ordered: boolean;
  readonly maxRetransmits: number | null;
  readonly maxPacketLifeTime: number | null;
  readonly protocol: string;
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onclose: ((e: Event) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  onbufferedamountlow: ((e: Event) => void) | null = null;
  onclosing: ((e: Event) => void) | null = null;
  constructor(
    private pc: OwnPeerConnection,
    readonly label: string,
    init: RTCDataChannelInit = {},
  ) {
    super();
    this.ordered = init.ordered ?? true;
    this.maxRetransmits = init.maxRetransmits ?? null;
    this.maxPacketLifeTime = init.maxPacketLifeTime ?? null;
    this.protocol = init.protocol ?? "";
  }
  spec() {
    return { label: this.label, ordered: this.ordered, max_retransmits: this.maxRetransmits, max_life: this.maxPacketLifeTime, protocol: this.protocol };
  }
  /** (The engine opened it.) */
  opened() {
    if (this.readyState !== "connecting") return;
    this.readyState = "open";
    this.fire("open");
  }
  closed() {
    if (this.readyState === "closed") return;
    this.readyState = "closed";
    this.fire("close");
  }
  received(binary: boolean, data: Uint8Array) {
    if (this.readyState !== "open") return;
    let payload: unknown;
    if (!binary) payload = new TextDecoder().decode(data);
    else if (this.binaryType === "blob") payload = new Blob([data.slice()]);
    else payload = data.slice().buffer;
    const ev = new MessageEvent("message", { data: payload });
    try {
      this.onmessage?.call(this, ev);
    } catch (e) {
      console.error(e);
    }
    this.dispatchEvent(ev);
  }
  send(data: string | Blob | ArrayBuffer | ArrayBufferView) {
    if (this.readyState !== "open" || this.id === null) throw new DOMException("The data channel isn't open.", "InvalidStateError");
    if (data instanceof Blob) {
      void data.arrayBuffer().then((b) => this.sendBytes(true, new Uint8Array(b)));
      return;
    }
    if (typeof data === "string") this.sendBytes(false, new TextEncoder().encode(data));
    else if (data instanceof ArrayBuffer) this.sendBytes(true, new Uint8Array(data));
    else this.sendBytes(true, new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  }
  private sendBytes(binary: boolean, bytes: Uint8Array) {
    const id = this.id;
    if (id === null) return;
    this.pc.queue(() => invoke("ownrtc_send", bytes.slice(), { headers: { "x-ownrtc": `${this.pc.conn}:${id}:${binary ? 1 : 0}` } }));
  }
  close() {
    if (this.readyState === "closed" || this.readyState === "closing") return;
    this.readyState = "closing";
    if (this.id !== null && this.pc.conn) void invoke("ownrtc_close_channel", { id: this.pc.conn, cid: this.id }).catch(() => {});
    queueMicrotask(() => this.closed());
  }
}

// ------------------------------------------------------------------ senders, receivers, transceivers

export class OwnSender implements Target {
  track: MediaStreamTrack | null;
  streamIds: string[];
  readonly transport = null;
  readonly dtmf = null;
  private slot: SendSlot;
  private params: { maxBitrate: number; scale: number; fps: number; degradation: string; rid?: string };
  constructor(
    private t: OwnTransceiver,
    track: MediaStreamTrack | null,
    streams: MediaStream[],
  ) {
    this.track = track;
    this.streamIds = streams.map((s) => s.id);
    this.slot = new SendSlot(t.kind, this);
    this.params = { maxBitrate: t.kind === "audio" ? 64_000 : 1_000_000, scale: 1, fps: 30, degradation: "maintain-framerate" };
  }
  conn() {
    return this.t.pc.conn;
  }
  mid() {
    return this.t.mid;
  }
  live() {
    return this.t.pc.connectionState === "connected" && sends(this.t.currentDirection ?? this.t.direction) && !this.t.stopped;
  }
  /** (Re)attaches to the right encoder. */
  update() {
    const s: VideoSettings = { maxBitrate: this.params.maxBitrate, scale: this.params.scale, fps: this.params.fps };
    this.slot.set(this.t.stopped ? null : this.track, s);
  }
  async replaceTrack(track: MediaStreamTrack | null) {
    this.track = track;
    this.update();
  }
  setStreams(...streams: MediaStream[]) {
    this.streamIds = streams.map((s) => s.id);
  }
  getParameters(): RTCRtpSendParameters {
    const encodings = this.t.mid
      ? [
          {
            active: true,
            ...(this.params.rid ? { rid: this.params.rid } : {}),
            maxBitrate: this.params.maxBitrate,
            ...(this.t.kind === "video" ? { scaleResolutionDownBy: this.params.scale, maxFramerate: this.params.fps } : {}),
          },
        ]
      : [];
    return { transactionId: "own", encodings, codecs: [], headerExtensions: [], rtcp: {}, degradationPreference: this.params.degradation } as unknown as RTCRtpSendParameters;
  }
  async setParameters(p: RTCRtpSendParameters) {
    const e = p.encodings?.[0] as (RTCRtpEncodingParameters & { maxFramerate?: number }) | undefined;
    if (e?.rid) this.params.rid = e.rid;
    if (e?.maxBitrate) this.params.maxBitrate = e.maxBitrate;
    if (e?.scaleResolutionDownBy) this.params.scale = e.scaleResolutionDownBy;
    if (e?.maxFramerate) this.params.fps = e.maxFramerate;
    const d = (p as unknown as { degradationPreference?: string }).degradationPreference;
    if (d) this.params.degradation = d;
    this.update();
  }
  async getStats() {
    return new Map() as unknown as RTCStatsReport;
  }
  keyframe() {
    this.slot.key();
  }
  busy() {
    return this.slot.busy();
  }
  frames() {
    return this.slot.frames();
  }
  stop() {
    this.slot.detach();
  }
}

export class OwnReceiver {
  readonly track: MediaStreamTrack;
  readonly transport = null;
  private video: VideoSink | null = null;
  private audio: AudioSink | null = null;
  jitterBufferTarget: number | null = null;
  constructor(t: OwnTransceiver) {
    if (t.kind === "video") {
      this.video = new VideoSink(() => {
        if (t.pc.conn && t.mid) void invoke("ownrtc_keyframe", { id: t.pc.conn, mid: t.mid }).catch(() => {});
      });
      this.track = this.video.track;
    } else {
      this.audio = new AudioSink();
      this.track = this.audio.track;
    }
  }
  push(codec: number, key: boolean, rtp: number, data: Uint8Array) {
    if (this.video) this.video.push(codec, key, rtp, data);
    else this.audio?.push(rtp, data);
  }
  paused(p: boolean) {
    this.video?.paused(p);
    this.audio?.paused(p);
  }
  fps() {
    return this.video?.fps() ?? 0;
  }
  frames() {
    return this.video?.framesIn ?? 0;
  }
  decodeSeconds() {
    return (this.video?.decodeMs ?? 0) / 1000;
  }
  getContributingSources() {
    return [];
  }
  getSynchronizationSources() {
    return [];
  }
  async getStats() {
    return new Map() as unknown as RTCStatsReport;
  }
  close() {
    this.video?.close();
    this.audio?.close();
  }
}

export class OwnTransceiver {
  mid: string | null = null;
  pendingMid: string | null = null;
  direction: Dir;
  currentDirection: Dir | null = null;
  stopped = false;
  readonly sender: OwnSender;
  readonly receiver: OwnReceiver;
  /** "track" was told for this line. */
  announced = false;
  constructor(
    readonly pc: OwnPeerConnection,
    readonly kind: "audio" | "video",
    direction: Dir,
    track: MediaStreamTrack | null,
    streams: MediaStream[],
  ) {
    this.direction = direction;
    this.sender = new OwnSender(this, track, streams);
    this.receiver = new OwnReceiver(this);
  }
  setCodecPreferences() {
    /* one codec each way: VP8 for pictures, Opus for sound */
  }
  stop() {
    this.stopped = true;
    this.direction = "inactive" as Dir;
    this.currentDirection = "stopped" as Dir;
    this.sender.stop();
    this.receiver.close();
  }
}

// ------------------------------------------------------------------ the connection

/** The other side's addresses that LANX's engine can't use are left out: hidden ones
 *  ("1f2e….local", a browser's privacy name) and TCP ones. The two still meet — the
 *  other side's first check tells the engine its real address. */
export function cleanRemote(sdp: string): string {
  const nl = sdp.includes("\r\n") ? "\r\n" : "\n";
  return sdp
    .split(/\r?\n/)
    .filter((l) => {
      const m = /^a=candidate:\S+ \d+ (\S+) \d+ (\S+) /i.exec(l);
      return !m || (m[1].toLowerCase() === "udp" && !m[2].toLowerCase().endsWith(".local"));
    })
    .join(nl);
}

export class OwnPeerConnection extends Emitter {
  conn = 0;
  connectionState: RTCPeerConnectionState = "new";
  iceConnectionState: RTCIceConnectionState = "new";
  iceGatheringState: RTCIceGatheringState = "new";
  signalingState: RTCSignalingState = "stable";
  localDescription: RTCSessionDescription | null = null;
  remoteDescription: RTCSessionDescription | null = null;
  currentLocalDescription: RTCSessionDescription | null = null;
  currentRemoteDescription: RTCSessionDescription | null = null;
  pendingLocalDescription: RTCSessionDescription | null = null;
  pendingRemoteDescription: RTCSessionDescription | null = null;
  readonly canTrickleIceCandidates = false;
  readonly sctp = null;
  ontrack: ((e: RTCTrackEvent) => void) | null = null;
  onconnectionstatechange: ((e: Event) => void) | null = null;
  oniceconnectionstatechange: ((e: Event) => void) | null = null;
  onicegatheringstatechange: ((e: Event) => void) | null = null;
  onsignalingstatechange: ((e: Event) => void) | null = null;
  onicecandidate: ((e: RTCPeerConnectionIceEvent) => void) | null = null;
  ondatachannel: ((e: RTCDataChannelEvent) => void) | null = null;
  onnegotiationneeded: ((e: Event) => void) | null = null;
  onicecandidateerror: ((e: Event) => void) | null = null;
  private transceivers: OwnTransceiver[] = [];
  private channels = new Map<number, OwnDataChannel>();
  private newChannels: OwnDataChannel[] = [];
  private answer: string | null = null;
  private ready: Promise<void>;
  private closedByUs = false;
  private disconnectTimer = 0;
  private remoteStream = new MediaStream();
  private order: Promise<unknown> = Promise.resolve();

  constructor(_config?: RTCConfiguration) {
    super();
    const ch = new Channel<unknown>();
    ch.onmessage = (m) => this.incoming(m);
    this.ready = invoke<number>("ownrtc_open", { events: ch }).then((id) => {
      this.conn = id;
      if (this.closedByUs) void invoke("ownrtc_close", { id }).catch(() => {});
    });
  }

  /** Runs `job` after the ones before it (data-channel messages stay in order). */
  queue(job: () => Promise<unknown>) {
    this.order = this.order.then(job).catch(() => {});
  }

  // ---- what the page calls

  addTransceiver(trackOrKind: MediaStreamTrack | string, init: RTCRtpTransceiverInit = {}): OwnTransceiver {
    const track = typeof trackOrKind === "string" ? null : trackOrKind;
    const kind = (track ? track.kind : trackOrKind) as "audio" | "video";
    const t = new OwnTransceiver(this, kind, init.direction ?? "sendrecv", track, init.streams ?? []);
    this.transceivers.push(t);
    // A camera asked for in sizes (a big meeting): this engine sends one, the sharpest.
    const size = init.sendEncodings?.[init.sendEncodings.length - 1];
    if (size) void t.sender.setParameters({ encodings: [size] } as unknown as RTCRtpSendParameters);
    else t.sender.update();
    return t;
  }
  addTrack(track: MediaStreamTrack, ...streams: MediaStream[]): OwnSender {
    const free = this.transceivers.find((t) => !t.stopped && t.kind === track.kind && !t.sender.track && t.mid && receives(t.direction) && !sends(t.direction));
    if (free) {
      free.direction = "sendrecv";
      free.sender.setStreams(...streams);
      void free.sender.replaceTrack(track);
      return free.sender;
    }
    return this.addTransceiver(track, { direction: "sendrecv", streams }).sender;
  }
  removeTrack(sender: OwnSender) {
    void sender.replaceTrack(null);
  }
  getTransceivers() {
    return this.transceivers.filter((t) => !t.stopped);
  }
  getSenders() {
    return this.getTransceivers().map((t) => t.sender);
  }
  getReceivers() {
    return this.getTransceivers().map((t) => t.receiver);
  }
  createDataChannel(label: string, init: RTCDataChannelInit = {}): OwnDataChannel {
    const ch = new OwnDataChannel(this, label, init);
    if (this.remoteDescription && this.conn) {
      // After the first agreement: opened straight away on the existing link.
      void invoke<number>("ownrtc_new_channel", { id: this.conn, spec: ch.spec() }).then(
        (cid) => {
          ch.id = cid;
          this.channels.set(cid, ch);
        },
        () => ch.closed(),
      );
    } else this.newChannels.push(ch);
    return ch;
  }

  async createOffer(_opts?: RTCOfferOptions): Promise<RTCSessionDescriptionInit> {
    await this.ready;
    const fresh = this.transceivers.filter((t) => !t.mid && !t.pendingMid && !t.stopped);
    const chans = this.newChannels.splice(0);
    const out = await invoke<OfferOut>("ownrtc_offer", {
      id: this.conn,
      media: fresh.map((t) => ({ kind: t.kind, dir: t.direction, stream: t.sender.streamIds[0] ?? null, track: t.sender.track?.id ?? null })),
      channels: chans.map((c) => c.spec()),
    });
    fresh.forEach((t, i) => (t.pendingMid = out.mids[i] ?? null));
    chans.forEach((c, i) => {
      c.id = out.cids[i];
      this.channels.set(c.id, c);
    });
    return { type: "offer", sdp: out.sdp };
  }

  async createAnswer(_opts?: RTCAnswerOptions): Promise<RTCSessionDescriptionInit> {
    if (this.signalingState !== "have-remote-offer" || !this.answer) throw new DOMException("No offer to answer.", "InvalidStateError");
    return { type: "answer", sdp: this.answer };
  }

  async setLocalDescription(desc?: RTCSessionDescriptionInit): Promise<void> {
    if (!desc || !desc.sdp) desc = this.signalingState === "have-remote-offer" ? await this.createAnswer() : await this.createOffer();
    const d = { type: desc.type, sdp: desc.sdp ?? "", toJSON: () => ({ type: desc!.type, sdp: desc!.sdp }) } as RTCSessionDescription;
    this.localDescription = d;
    if (desc.type === "offer") {
      for (const t of this.transceivers) if (t.pendingMid) t.mid = t.pendingMid;
      this.pendingLocalDescription = d;
      this.setSignaling("have-local-offer");
    } else {
      this.currentLocalDescription = d;
      this.pendingRemoteDescription = null;
      this.setSignaling("stable");
      this.announce();
    }
    for (const t of this.transceivers) t.sender.update();
    // Every address is in the description already: gathering is complete at once.
    if (this.iceGatheringState !== "complete") {
      this.iceGatheringState = "gathering";
      this.fire("icegatheringstatechange");
      this.iceGatheringState = "complete";
      setTimeout(() => {
        this.fire("icecandidate", { candidate: null });
        this.fire("icegatheringstatechange");
      }, 0);
    }
  }

  /**
   * A browser never says "connected" before the description that makes the link has been
   * taken in. The engine can (on one PC or a fast LAN it links up within milliseconds, and
   * its news can overtake the answer to our own request), so its news waits until then.
   */
  async setRemoteDescription(desc: RTCSessionDescriptionInit): Promise<void> {
    this.settling++;
    try {
      await this.takeRemote(desc);
    } finally {
      // After the caller's own next lines have run.
      setTimeout(() => {
        if (--this.settling > 0 || this.connectionState === "closed") return;
        for (const c of this.held.splice(0)) this.apply(c);
      }, 0);
    }
  }

  private async takeRemote(desc: RTCSessionDescriptionInit): Promise<void> {
    await this.ready;
    const sdp = cleanRemote(desc.sdp ?? "");
    const d = { type: desc.type, sdp, toJSON: () => ({ type: desc.type, sdp }) } as RTCSessionDescription;
    if (desc.type === "answer") {
      const media = await invoke<MediaInfo[]>("ownrtc_accept_answer", { id: this.conn, sdp });
      this.remoteDescription = d;
      this.currentRemoteDescription = d;
      this.currentLocalDescription = this.localDescription;
      this.pendingLocalDescription = null;
      for (const m of media) {
        const t = this.transceivers.find((x) => x.mid === m.mid);
        if (t) t.currentDirection = m.dir;
      }
      this.setSignaling("stable");
      this.announce();
    } else if (desc.type === "offer") {
      const out = await invoke<{ sdp: string; media: MediaInfo[] }>("ownrtc_accept_offer", { id: this.conn, sdp });
      this.answer = out.sdp;
      this.remoteDescription = d;
      this.pendingRemoteDescription = d;
      for (const m of out.media) {
        let t = this.transceivers.find((x) => x.mid === m.mid);
        if (!t) {
          // A line the other side added: ours answers it (the page may add a track).
          t = new OwnTransceiver(this, m.kind, m.dir, null, []);
          t.mid = m.mid;
          this.transceivers.push(t);
        }
        t.direction = m.dir;
        t.currentDirection = m.dir;
      }
      this.setSignaling("have-remote-offer");
      // (The browser tells of incoming tracks here, before the answer.)
      this.announce();
    } else if (desc.type === "rollback") {
      this.setSignaling("stable");
    }
  }

  async addIceCandidate(_c?: RTCIceCandidateInit | null) {
    /* every address travels in the description */
  }
  restartIce() {
    /* not needed on a LAN */
  }
  getConfiguration(): RTCConfiguration {
    return { iceServers: [] };
  }
  setConfiguration() {
    /* nothing to change */
  }

  async getStats(): Promise<RTCStatsReport> {
    const m = new Map<string, Record<string, unknown>>();
    if (!this.conn || this.connectionState === "closed") return m as unknown as RTCStatsReport;
    let s: { peer?: { rtt?: number | null; lossOut?: number | null }; egress?: Record<string, { bytes?: number; packets?: number; rtt?: number | null; loss?: number | null }>; ingress?: Record<string, { bytes?: number; packets?: number; jitter?: number }> } = {};
    try {
      s = await invoke("ownrtc_stats", { id: this.conn });
    } catch {
      /* closed meanwhile */
    }
    const now = performance.now();
    const rtt = (s.peer?.rtt ?? 0) / 1000;
    for (const t of this.getTransceivers()) {
      if (!t.mid) continue;
      const eg = s.egress?.[t.mid];
      if (eg && sends(t.currentDirection ?? t.direction)) {
        m.set(`out-${t.mid}`, { id: `out-${t.mid}`, type: "outbound-rtp", timestamp: now, kind: t.kind, mid: t.mid, bytesSent: eg.bytes ?? 0, packetsSent: eg.packets ?? 0, framesEncoded: t.sender.frames(), qualityLimitationReason: t.kind === "video" && t.sender.busy() ? "cpu" : "none" });
        m.set(`remote-in-${t.mid}`, { id: `remote-in-${t.mid}`, type: "remote-inbound-rtp", timestamp: now, kind: t.kind, fractionLost: eg.loss ?? 0, roundTripTime: (eg.rtt ?? s.peer?.rtt ?? 0) / 1000 });
      }
      const ing = s.ingress?.[t.mid];
      if (ing && receives(t.currentDirection ?? t.direction)) {
        m.set(`in-${t.mid}`, { id: `in-${t.mid}`, type: "inbound-rtp", timestamp: now, kind: t.kind, mid: t.mid, bytesReceived: ing.bytes ?? 0, packetsReceived: ing.packets ?? 0, framesPerSecond: t.receiver.fps(), framesDecoded: t.receiver.frames(), totalDecodeTime: t.receiver.decodeSeconds(), jitterBufferDelay: 0, jitterBufferEmittedCount: t.receiver.frames() });
      }
    }
    m.set("pair", { id: "pair", type: "candidate-pair", timestamp: now, state: this.connectionState === "connected" ? "succeeded" : "in-progress", nominated: true, currentRoundTripTime: rtt });
    return m as unknown as RTCStatsReport;
  }

  close() {
    if (this.connectionState === "closed") return;
    this.closedByUs = true;
    window.clearTimeout(this.disconnectTimer);
    if (this.conn) void invoke("ownrtc_close", { id: this.conn }).catch(() => {});
    for (const t of this.transceivers) t.stop();
    for (const c of this.channels.values()) c.closed();
    this.connectionState = "closed";
    this.iceConnectionState = "closed";
    this.signalingState = "closed";
  }

  // ---- what the engine says

  private setSignaling(s: RTCSignalingState) {
    if (this.signalingState === s) return;
    this.signalingState = s;
    this.fire("signalingstatechange");
  }
  private setConnection(s: RTCPeerConnectionState) {
    if (this.connectionState === s || this.connectionState === "closed") return;
    this.connectionState = s;
    for (const t of this.transceivers) t.sender.update();
    this.fire("connectionstatechange");
  }
  private setIce(s: RTCIceConnectionState) {
    if (this.iceConnectionState === s || this.iceConnectionState === "closed") return;
    this.iceConnectionState = s;
    this.fire("iceconnectionstatechange");
  }

  /** "track" for each line that receives and hasn't been told yet. */
  private announce() {
    for (const t of this.transceivers) {
      if (t.announced || t.stopped || !t.mid || !receives(t.currentDirection ?? t.direction)) continue;
      t.announced = true;
      if (!this.remoteStream.getTracks().includes(t.receiver.track)) this.remoteStream.addTrack(t.receiver.track);
      this.fire("track", { track: t.receiver.track, streams: [this.remoteStream], receiver: t.receiver, transceiver: t });
    }
  }

  private incoming(m: unknown) {
    if (this.connectionState === "closed") return;
    if (m instanceof ArrayBuffer) this.records(new Uint8Array(m));
    else if (m instanceof Uint8Array) this.records(m);
    else if (Array.isArray(m)) for (const c of m as Ctrl[]) this.control(c);
  }

  private records(b: Uint8Array) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let i = 0;
    while (i < b.length) {
      const type = b[i];
      if (type === 1) {
        const ml = b[i + 1];
        const mid = new TextDecoder().decode(b.subarray(i + 2, i + 2 + ml));
        let p = i + 2 + ml;
        const codec = b[p];
        const flags = b[p + 1];
        const lo = dv.getUint32(p + 2, true);
        const hi = dv.getUint32(p + 6, true);
        const rtp = hi * 4294967296 + lo;
        const len = dv.getUint32(p + 10, true);
        p += 14;
        const data = b.subarray(p, p + len);
        i = p + len;
        const t = this.transceivers.find((x) => x.mid === mid);
        t?.receiver.push(codec, (flags & 1) === 1, rtp, data);
      } else if (type === 2) {
        const cid = dv.getUint32(i + 1, true);
        const binary = b[i + 5] === 1;
        const len = dv.getUint32(i + 6, true);
        const data = b.subarray(i + 10, i + 10 + len);
        i += 10 + len;
        this.channels.get(cid)?.received(binary, data);
      } else return; // unknown: stop reading this batch
    }
  }

  private settling = 0;
  private held: Ctrl[] = [];
  private control(c: Ctrl) {
    if (this.settling > 0) this.held.push(c);
    else this.apply(c);
  }

  private apply(c: Ctrl) {
    switch (c.t) {
      case "ice": {
        const map: Record<string, RTCIceConnectionState> = { new: "new", checking: "checking", connected: "connected", completed: "completed", disconnected: "disconnected" };
        this.setIce(map[c.s] ?? "checking");
        if (c.s === "checking" && this.connectionState === "new") this.setConnection("connecting");
        if (c.s === "disconnected") {
          this.setConnection("disconnected");
          window.clearTimeout(this.disconnectTimer);
          // (A browser gives up after a while too.)
          this.disconnectTimer = window.setTimeout(() => {
            if (this.iceConnectionState === "disconnected") {
              this.setIce("failed");
              this.setConnection("failed");
            }
          }, 20_000);
        } else if ((c.s === "connected" || c.s === "completed") && this.connectionState === "disconnected") {
          window.clearTimeout(this.disconnectTimer);
          this.setConnection("connected");
        }
        break;
      }
      case "state":
        if (c.s === "connected") this.setConnection("connected");
        else if (c.s === "closed" && !this.closedByUs) {
          this.setIce("failed");
          this.setConnection("failed");
          for (const ch of this.channels.values()) ch.closed();
        }
        break;
      case "media":
      case "dir": {
        const t = this.transceivers.find((x) => x.mid === c.mid);
        if (t) t.currentDirection = c.dir;
        break;
      }
      case "key":
        this.transceivers.find((x) => x.mid === c.mid)?.sender.keyframe();
        break;
      case "paused":
        this.transceivers.find((x) => x.mid === c.mid)?.receiver.paused(c.paused);
        break;
      case "open": {
        let ch = this.channels.get(c.cid);
        if (ch) ch.opened();
        else {
          // The other side opened it.
          ch = new OwnDataChannel(this, c.label);
          ch.id = c.cid;
          this.channels.set(c.cid, ch);
          ch.readyState = "open";
          this.fire("datachannel", { channel: ch });
          const opened = ch;
          setTimeout(() => {
            if (opened.readyState === "open") (opened as unknown as { fire(t: string): void }).fire("open");
          }, 0);
        }
        break;
      }
      case "close":
        this.channels.get(c.cid)?.closed();
        break;
      case "low": {
        const ch = this.channels.get(c.cid);
        if (ch) (ch as unknown as { fire(t: string): void }).fire("bufferedamountlow");
        break;
      }
    }
  }
}

// ------------------------------------------------------------------ switching it on

let installed = false;

/** Puts the stand-in in place where the web engine has no RTCPeerConnection (or a
 *  test copy asks for it). Returns whether it is in use. */
export async function installOwnRtc(): Promise<boolean> {
  if (installed) return true;
  const w = window as unknown as Record<string, unknown>;
  if (!("__TAURI_INTERNALS__" in window)) return false;
  const missing = typeof w.RTCPeerConnection !== "function";
  let forced = false;
  if (!missing) forced = await invoke<boolean>("ownrtc_forced").catch(() => false);
  if (!missing && !forced) return false;
  if (typeof w.VideoEncoder !== "function" || typeof w.AudioEncoder !== "function" || typeof w.VideoDecoder !== "function") {
    console.warn("[ownrtc] this web engine can't squeeze pictures and sound: no calls");
    return false;
  }
  w.RTCPeerConnection = OwnPeerConnection;
  w.webkitRTCPeerConnection = OwnPeerConnection;
  if (typeof w.RTCDataChannel !== "function") w.RTCDataChannel = OwnDataChannel;
  if (typeof w.RTCRtpSender !== "function") w.RTCRtpSender = OwnSender;
  if (typeof w.RTCRtpReceiver !== "function") w.RTCRtpReceiver = OwnReceiver;
  if (typeof w.RTCRtpTransceiver !== "function") w.RTCRtpTransceiver = OwnTransceiver;
  if (typeof w.RTCSessionDescription !== "function")
    w.RTCSessionDescription = class {
      type: RTCSdpType;
      sdp: string;
      constructor(init: RTCSessionDescriptionInit) {
        this.type = init.type;
        this.sdp = init.sdp ?? "";
      }
      toJSON() {
        return { type: this.type, sdp: this.sdp };
      }
    };
  try {
    sound.direct = localStorage.getItem("lanx.ownrtc.directSound") === "1";
  } catch {
    /* default */
  }
  installed = true;
  document.documentElement.dataset.ownRtc = forced ? "forced" : "on";
  return true;
}

export const ownRtcInUse = () => installed;
