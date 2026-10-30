/** LANX 3.4 phone page: group meetings on the phone. The PC keeps who is in
 *  the meeting and passes each pair's offer and answer
 *  (src-tauri/src/networking/meetings.rs, as for its own window); the phone
 *  connects to everyone else in the meeting directly with WebRTC, the way the
 *  PC's MeetingLayer does (the smaller device id of a pair makes the offer;
 *  the phone counts as its PC). Recording works as on the PC (saved in the
 *  PC's Recordings folder); no screen sharing from a phone browser. */
import type { Conversation, MeetingChatLine, MeetingEvent, MeetingInfo } from "../types";
import { iceGathered, preferCodecs, tuneSdp } from "../lib/webrtc";
import { Recorder, recordingSupported } from "../lib/recorder";
import type { PhoneClient } from "./client";

/** "pc": the meeting is in LANX on the PC (the phone only says so). */
export type MeetingStatus = "invited" | "joining" | "active" | "pc";

export interface PhoneMeetingState {
  meeting: MeetingInfo;
  status: MeetingStatus;
  muted: boolean;
  camera: boolean;
  hand: boolean;
  facing: "user" | "environment";
  unread: number;
  /** 3.4: this phone records the meeting. */
  recording: boolean;
  /** Bumped when a connection or a track changes (the screen redraws). */
  version: number;
}

export type MeetingPush = MeetingEvent & { ev: "meeting" };

interface Conn {
  pc: RTCPeerConnection;
  stream: MediaStream;
  audio: RTCRtpTransceiver | null;
  video: RTCRtpTransceiver | null;
  tries: number;
  connected: boolean;
  grace: number;
  timer: number;
}

const OFFER_RETRIES = 4;
const DISCONNECT_GRACE_MS = 8_000;
const CONNECT_TIMEOUT_MS = 15_000;
const LOST_AFTER_MS = 30_000;

export const canMeet = () => window.isSecureContext && !!navigator.mediaDevices?.getUserMedia && typeof RTCPeerConnection !== "undefined";

async function getMic(): Promise<MediaStreamTrack | null> {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const t = s.getAudioTracks()[0] ?? null;
    if (t) t.contentHint = "speech";
    return t;
  } catch {
    return null;
  }
}

async function getCam(facing: "user" | "environment"): Promise<MediaStreamTrack | null> {
  // Everyone sends to everyone: a meeting asks for less than a call.
  for (const video of [{ facingMode: facing, width: { ideal: 960 }, height: { ideal: 540 }, frameRate: { ideal: 24, max: 30 } }, { facingMode: facing }, true as const]) {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video });
      const t = s.getVideoTracks()[0] ?? null;
      if (t) t.contentHint = "motion";
      return t;
    } catch {
      /* try a simpler request */
    }
  }
  return null;
}

export class PhoneMeeting {
  state: PhoneMeetingState | null = null;
  localStream = new MediaStream();
  private conns = new Map<string, Conn>();
  private mic: MediaStreamTrack | null = null;
  private cam: MediaStreamTrack | null = null;
  private listeners = new Set<() => void>();
  /** Chat lines while the chat panel is shut count as unread. */
  chatOpen = false;
  /** Offers and arrivals that came while we were still joining. */
  private pending: MeetingPush[] = [];
  private myPhone = "";
  /** The meeting whose "on your PC" bar was put away. */
  private dismissedId = "";

  constructor(
    private client: PhoneClient,
    private onProblem: (text: string) => void,
    private onNotice: (text: string) => void
  ) {}

  // (Arrow functions: React's useSyncExternalStore keeps them as they are.)
  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };
  snapshot = () => this.state;

  private set(next: PhoneMeetingState | null) {
    this.state = next;
    for (const l of this.listeners) l();
  }

  private patch(p: Partial<PhoneMeetingState>) {
    if (this.state) this.set({ ...this.state, ...p });
  }

  private bump() {
    if (this.state) this.patch({ version: this.state.version + 1 });
  }

  /** A colleague's sound and picture (null until connected). */
  streamOf(id: string): MediaStream | null {
    return this.conns.get(id)?.stream ?? null;
  }

  isConnected(id: string): boolean {
    return !!this.conns.get(id)?.connected;
  }

  private myId() {
    return this.state?.meeting.my_id ?? "";
  }
  private inMeeting(id: string) {
    return !!this.state?.meeting.people.some((p) => p.device_id === id);
  }
  /** For each pair, the smaller id makes the offer (as on the PC). */
  private shouldOffer(id: string) {
    return this.myId() !== "" && this.myId() < id;
  }
  private meetingId() {
    return this.state?.meeting.meeting_id ?? "";
  }

  // ------------------------------------------------------------- media

  private refreshLocal() {
    this.localStream = new MediaStream([this.mic, this.cam].filter((t): t is MediaStreamTrack => !!t));
  }

  private async grabMedia(video: boolean) {
    this.mic = await getMic();
    if (!this.mic) this.onNotice("No microphone — the others won't hear you.");
    this.cam = video ? await getCam(this.state?.facing ?? "user") : null;
    if (video && !this.cam) this.onNotice("No camera — you join without video.");
    this.refreshLocal();
    this.patch({ muted: !this.mic, camera: !!this.cam });
  }

  private releaseMedia() {
    for (const t of [this.mic, this.cam]) t?.stop();
    this.mic = this.cam = null;
    this.localStream = new MediaStream();
  }

  private closeConn(id: string) {
    const c = this.conns.get(id);
    if (!c) return;
    window.clearTimeout(c.grace);
    window.clearTimeout(c.timer);
    c.pc.ontrack = null;
    c.pc.onconnectionstatechange = null;
    try {
      c.pc.close();
    } catch {
      /* already closed */
    }
    this.conns.delete(id);
    this.bump();
  }

  private closeAll() {
    for (const id of [...this.conns.keys()]) this.closeConn(id);
  }

  /** Back to nothing: the meeting is over or happens elsewhere. */
  private finish(text: string | null) {
    void this.stopRecording();
    this.pending = [];
    this.closeAll();
    this.releaseMedia();
    this.set(null);
    if (text) this.onNotice(text);
  }

  private drop(id: string) {
    this.closeConn(id);
    const mid = this.meetingId();
    if (mid) this.client.request("meeting_drop", { meeting_id: mid, peer_id: id }).catch(() => {});
  }

  private retry(id: string, c: Conn) {
    if (this.conns.get(id) !== c) return;
    c.connected = false;
    if (!this.inMeeting(id)) {
      this.closeConn(id);
      return;
    }
    if (this.shouldOffer(id)) {
      if (c.tries >= OFFER_RETRIES) {
        this.drop(id);
        return;
      }
      const tries = c.tries + 1;
      c.tries = tries;
      window.setTimeout(() => {
        if (this.conns.get(id) === c) void this.offerTo(id, tries);
      }, 1200 * tries);
    } else if (!c.timer) {
      // They make a new offer; give up if nothing works for a while.
      c.timer = window.setTimeout(() => {
        if (this.conns.get(id) === c && !c.connected) this.drop(id);
      }, LOST_AFTER_MS);
    }
    this.bump();
  }

  private newConn(id: string): Conn {
    const tries = this.conns.get(id)?.tries ?? 0;
    this.closeConn(id);
    const pc = new RTCPeerConnection({ iceServers: [] });
    const c: Conn = { pc, stream: new MediaStream(), audio: null, video: null, tries, connected: false, grace: 0, timer: 0 };
    pc.ontrack = (e) => {
      if (!c.stream.getTracks().includes(e.track)) c.stream.addTrack(e.track);
      e.track.onunmute = () => this.bump();
      e.track.onmute = () => this.bump();
      this.bump();
    };
    pc.onconnectionstatechange = () => {
      if (this.conns.get(id) !== c) return;
      const s = pc.connectionState;
      if (s === "connected") {
        c.connected = true;
        c.tries = 0;
        window.clearTimeout(c.grace);
        window.clearTimeout(c.timer);
        c.grace = c.timer = 0;
      } else if (s === "disconnected") {
        if (!c.grace)
          c.grace = window.setTimeout(() => {
            c.grace = 0;
            if (pc.connectionState !== "connected") this.retry(id, c);
          }, DISCONNECT_GRACE_MS);
      } else if (s === "failed") {
        this.retry(id, c);
      }
      this.bump();
    };
    this.conns.set(id, c);
    this.bump();
    return c;
  }

  private async offerTo(id: string, tries = 0) {
    const mid = this.meetingId();
    if (!mid || !this.inMeeting(id)) return;
    const c = this.newConn(id);
    c.tries = tries;
    c.audio = c.pc.addTransceiver("audio", { direction: "sendrecv" });
    c.video = c.pc.addTransceiver("video", { direction: "sendrecv" });
    try {
      await c.audio.sender.replaceTrack(this.mic);
      await c.video.sender.replaceTrack(this.cam);
      preferCodecs(c.pc);
      await c.pc.setLocalDescription(await c.pc.createOffer());
      await iceGathered(c.pc);
      if (this.conns.get(id) !== c) return;
      await this.client.request("meeting_signal", { meeting_id: mid, to: id, kind: "offer", sdp: c.pc.localDescription?.sdp ?? "" });
      c.timer = window.setTimeout(() => {
        c.timer = 0;
        if (this.conns.get(id) === c && !c.connected) this.retry(id, c);
      }, CONNECT_TIMEOUT_MS);
    } catch {
      if (this.conns.get(id) === c) this.retry(id, c);
    }
  }

  private maybeOffer(id: string) {
    if (id && id !== this.myId() && this.shouldOffer(id) && !this.conns.has(id)) void this.offerTo(id);
  }

  private async onOffer(from: string, sdp: string) {
    const mid = this.meetingId();
    if (!mid) return;
    const c = this.newConn(from);
    try {
      await c.pc.setRemoteDescription({ type: "offer", sdp: tuneSdp(sdp) });
      for (const t of c.pc.getTransceivers()) {
        const kind = t.receiver.track.kind;
        t.direction = "sendrecv";
        if (kind === "audio" && !c.audio) c.audio = t;
        else if (kind === "video" && !c.video) c.video = t;
      }
      await c.audio?.sender.replaceTrack(this.mic);
      await c.video?.sender.replaceTrack(this.cam);
      preferCodecs(c.pc);
      await c.pc.setLocalDescription(await c.pc.createAnswer());
      await iceGathered(c.pc);
      if (this.conns.get(from) !== c) return;
      await this.client.request("meeting_signal", { meeting_id: mid, to: from, kind: "answer", sdp: c.pc.localDescription?.sdp ?? "" });
      c.timer = window.setTimeout(() => {
        c.timer = 0;
        if (this.conns.get(from) === c && !c.connected) this.drop(from);
      }, LOST_AFTER_MS);
    } catch {
      /* the one who offered tries again */
    }
  }

  private async onAnswer(from: string, sdp: string) {
    const c = this.conns.get(from);
    if (c && c.pc.signalingState === "have-local-offer") await c.pc.setRemoteDescription({ type: "answer", sdp: tuneSdp(sdp) }).catch(() => {});
  }

  private async replaceAll(kind: "audio" | "video", track: MediaStreamTrack | null) {
    await Promise.all([...this.conns.values()].map((c) => (kind === "audio" ? c.audio : c.video)?.sender.replaceTrack(track).catch(() => {})));
  }

  private becameActive(m: MeetingInfo) {
    this.set({ meeting: m, status: "active", muted: this.state?.muted ?? !this.mic, camera: !!this.cam, hand: false, facing: this.state?.facing ?? "user", unread: 0, recording: false, version: (this.state?.version ?? 0) + 1 });
    void this.client.request("meeting_media", { meeting_id: m.meeting_id, muted: !this.mic || (this.state?.muted ?? false), camera: !!this.cam }).catch(() => {});
    for (const p of m.people) if (!p.is_me) this.maybeOffer(p.device_id);
    const queued = this.pending;
    this.pending = [];
    for (const e of queued) this.handle(e, this.myPhone);
  }

  private blank(m: MeetingInfo, status: MeetingStatus): PhoneMeetingState {
    return { meeting: m, status, muted: false, camera: false, hand: false, facing: "user", unread: 0, recording: false, version: 0 };
  }

  // ------------------------------------------------------------ actions

  /** After (re)connecting: a meeting the PC knows of — an invitation, one on
   *  this phone (reconnect to everyone) or one in LANX on the PC. */
  async resume(myPhone: string) {
    try {
      const { meeting } = await this.client.request<{ meeting: MeetingInfo | null }>("meeting_get");
      if (!meeting) {
        if (this.state && this.state.status !== "joining") this.finish(null);
        return;
      }
      if (meeting.phase === "invited") {
        if (!this.state) this.set(this.blank(meeting, "invited"));
        return;
      }
      if (meeting.on_phone && meeting.on_phone === myPhone) {
        if (this.state?.status === "active") {
          this.patch({ meeting });
          return;
        }
        // The page was reloaded in the middle of the meeting: back in.
        this.set(this.blank(meeting, "joining"));
        await this.grabMedia(meeting.video);
        this.becameActive(meeting);
        return;
      }
      this.closeAll();
      this.releaseMedia();
      this.set(meeting.meeting_id === this.dismissedId ? null : this.blank(meeting, "pc"));
    } catch {
      /* not connected yet */
    }
  }

  async start(conv: Conversation, video: boolean) {
    if (this.state && this.state.status !== "invited") {
      this.onProblem(this.state.status === "pc" ? "You're in a meeting on your PC." : "You're already in a meeting.");
      return;
    }
    this.set({ ...this.blank({ meeting_id: "", title: conv.peer_name, conversation_id: conv.id, group_id: null, host_id: "", host_name: "", inviter_id: "", inviter_name: "", inviter_color: "#64748b", video, phase: "joined", started_at: 0, joined_at: null, people: [], chat: [], private: false, my_id: "" }, "joining") });
    await this.grabMedia(video);
    try {
      const { meeting } = await this.client.request<{ meeting: MeetingInfo }>("meeting_start", { conv: conv.id, video });
      this.becameActive(meeting);
    } catch (e) {
      this.finish(null);
      this.onProblem(e instanceof Error ? e.message : String(e));
    }
  }

  async join(video: boolean) {
    const m = this.state?.meeting;
    if (!m || this.state?.status !== "invited") return;
    this.patch({ status: "joining" });
    await this.grabMedia(video);
    try {
      const { meeting } = await this.client.request<{ meeting: MeetingInfo }>("meeting_join", { meeting_id: m.meeting_id });
      this.becameActive(meeting);
    } catch (e) {
      this.finish(null);
      this.onProblem(e instanceof Error ? e.message : String(e));
    }
  }

  /** "Join again" on a meeting card in a chat. */
  async rejoin(messageId: string) {
    if (this.state && this.state.status !== "invited") {
      this.onProblem(this.state.status === "pc" ? "You're in this meeting on your PC." : "You're already in a meeting.");
      return;
    }
    this.set(this.blank({ meeting_id: "", title: "Meeting", conversation_id: "", group_id: null, host_id: "", host_name: "", inviter_id: "", inviter_name: "", inviter_color: "#64748b", video: true, phase: "joined", started_at: 0, joined_at: null, people: [], chat: [], private: false, my_id: "" }, "joining"));
    await this.grabMedia(true);
    try {
      const { meeting } = await this.client.request<{ meeting: MeetingInfo }>("meeting_rejoin", { message_id: messageId });
      this.becameActive(meeting);
    } catch (e) {
      this.finish(null);
      this.onProblem(e instanceof Error ? e.message : String(e));
    }
  }

  async decline() {
    const m = this.state?.meeting;
    this.finish(null);
    if (m?.meeting_id) await this.client.request("meeting_decline", { meeting_id: m.meeting_id }).catch(() => {});
  }

  async leave() {
    const m = this.state?.meeting;
    if (!m) return;
    if (this.state?.status === "invited") return this.decline();
    this.finish(null);
    if (m.meeting_id) await this.client.request("meeting_leave", { meeting_id: m.meeting_id }).catch(() => {});
  }

  // ------------------------------------------------------------ recording

  private recorder: Recorder | null = null;

  /** Records the meeting — everyone's picture and voice — into the PC's
   *  Recordings folder; everyone in the meeting is told, as on the PC. */
  async startRecording() {
    const st = this.state;
    if (!st || st.status !== "active" || this.recorder) return;
    if (!recordingSupported()) {
      this.onProblem("This phone can't record meetings.");
      return;
    }
    const m = st.meeting;
    const rec = new Recorder({
      title: m.private ? "Meeting" : m.title || "Meeting",
      kind: "meeting",
      conversationId: m.private ? null : m.conversation_id,
      light: true,
      tiles: () =>
        (this.state?.meeting.people ?? []).map((p) => {
          const s = p.is_me ? this.localStream : this.streamOf(p.device_id);
          return { id: p.device_id, name: p.is_me ? "You" : p.name, color: p.avatar_color, video: (p.is_me ? this.cam : s?.getVideoTracks()[0]) ?? null, audio: (p.is_me ? this.mic : s?.getAudioTracks()[0]) ?? null, muted: p.is_me ? this.state?.muted : p.muted, screen: p.screen };
        }),
      onFailed: (t) => {
        this.onProblem(`The recording stopped: ${t}`);
        void this.stopRecording();
      },
    });
    try {
      await rec.start();
      this.recorder = rec;
      this.patch({ recording: true });
      void this.client.request("meeting_media", { meeting_id: m.meeting_id, recording: true }).catch(() => {});
    } catch (e) {
      this.onProblem(e instanceof Error ? e.message : String(e));
    }
  }

  async stopRecording() {
    const rec = this.recorder;
    if (!rec) return;
    this.recorder = null;
    const mid = this.state?.meeting.meeting_id;
    this.patch({ recording: false });
    if (mid) void this.client.request("meeting_media", { meeting_id: mid, recording: false }).catch(() => {});
    try {
      const r = await rec.stop();
      this.onNotice(`Recording saved on your PC (and in the chat): ${r.name}`);
    } catch (e) {
      this.onProblem(e instanceof Error ? e.message : String(e));
    }
  }

  clearUnread() {
    if (this.state?.unread) this.patch({ unread: 0 });
  }

  /** Hides the "in a meeting on your PC" bar (it comes back with the next change). */
  dismiss() {
    if (this.state?.status === "pc") {
      this.dismissedId = this.state.meeting.meeting_id;
      this.set(null);
    }
  }

  toggleMute() {
    const st = this.state;
    if (!st || st.status !== "active") return;
    if (!this.mic) {
      this.onNotice("No microphone on this phone (or LANX wasn't allowed to use it).");
      return;
    }
    const muted = !st.muted;
    this.mic.enabled = !muted;
    this.patch({ muted });
    void this.client.request("meeting_media", { meeting_id: st.meeting.meeting_id, muted }).catch(() => {});
  }

  async toggleCamera() {
    const st = this.state;
    if (!st || st.status !== "active") return;
    if (st.camera) {
      this.cam?.stop();
      this.cam = null;
      await this.replaceAll("video", null);
    } else {
      this.cam = await getCam(st.facing);
      if (!this.cam) {
        this.onNotice("No camera on this phone (or LANX wasn't allowed to use it).");
        return;
      }
      await this.replaceAll("video", this.cam);
    }
    this.refreshLocal();
    this.patch({ camera: !!this.cam });
    void this.client.request("meeting_media", { meeting_id: st.meeting.meeting_id, camera: !!this.cam }).catch(() => {});
  }

  async flipCamera() {
    const st = this.state;
    if (!st || !this.cam) return;
    const facing = st.facing === "user" ? "environment" : "user";
    const next = await getCam(facing);
    if (!next) return;
    this.cam.stop();
    this.cam = next;
    await this.replaceAll("video", next);
    this.refreshLocal();
    this.patch({ facing });
  }

  toggleHand() {
    const st = this.state;
    if (!st || st.status !== "active") return;
    const hand = !st.hand;
    this.patch({ hand });
    void this.client.request("meeting_media", { meeting_id: st.meeting.meeting_id, hand }).catch(() => {});
  }

  async chat(text: string): Promise<boolean> {
    const st = this.state;
    if (!st || st.status !== "active" || !text.trim()) return false;
    try {
      const { line } = await this.client.request<{ line: MeetingChatLine }>("meeting_chat", { meeting_id: st.meeting.meeting_id, text });
      const cur = this.state;
      if (cur && cur.meeting.meeting_id === st.meeting.meeting_id && !cur.meeting.chat.some((l) => l.at === line.at && l.text === line.text && l.from === line.from))
        this.patch({ meeting: { ...cur.meeting, chat: [...cur.meeting.chat, line] } });
      return true;
    } catch (e) {
      this.onProblem(e instanceof Error ? e.message : String(e));
      return false;
    }
  }

  async invite(peerIds: string[]) {
    const st = this.state;
    if (!st || st.status !== "active" || !peerIds.length) return;
    try {
      const { problems } = await this.client.request<{ problems: string[] }>("meeting_invite", { meeting_id: st.meeting.meeting_id, peer_ids: peerIds });
      this.onNotice(problems.length ? problems.join(" ") : `Invited ${peerIds.length} more.`);
    } catch (e) {
      this.onProblem(e instanceof Error ? e.message : String(e));
    }
  }

  // ------------------------------------------------------------- events

  handle(e: MeetingPush, myPhone: string) {
    this.myPhone = myPhone;
    const cur = this.state;
    if (e.action === "invited") {
      if (!cur && e.meeting) this.set(this.blank(e.meeting, "invited"));
      return;
    }
    if (e.action === "ended") {
      if (cur && e.meeting && (!cur.meeting.meeting_id || e.meeting.meeting_id === cur.meeting.meeting_id)) {
        if (cur.status === "invited" && e.reason === "timeout") this.finish(`You missed a meeting with ${cur.meeting.private ? "a colleague" : cur.meeting.inviter_name}.`);
        else if (cur.status !== "joining") this.finish(null);
      }
      return;
    }
    if (!e.meeting) return;
    if (cur && cur.meeting.meeting_id && e.meeting.meeting_id !== cur.meeting.meeting_id) return;
    // Joined in LANX on the PC (or moved there): the phone stays out of it.
    if (e.meeting.phase === "joined" && e.meeting.on_phone !== myPhone) {
      if (cur?.status === "joining") return; // our own join, a moment early
      if (cur?.status === "active") this.finish("The meeting moved to your PC.");
      else if (e.meeting.on_phone || e.meeting.meeting_id === this.dismissedId) this.set(null);
      else if (cur?.status === "pc") this.patch({ meeting: e.meeting });
      else this.set(this.blank(e.meeting, "pc"));
      return;
    }
    if (!cur || cur.status === "pc" || cur.status === "invited") {
      if (cur) this.patch({ meeting: e.meeting });
      return;
    }
    if (cur.status === "joining") {
      if (e.action === "signal" || e.action === "person-joined") this.pending.push(e);
      this.patch({ meeting: e.meeting });
      return;
    }
    const unread = e.action === "chat" && !this.chatOpen ? cur.unread + 1 : cur.unread;
    this.patch({ meeting: e.meeting, unread });
    switch (e.action) {
      case "joined":
        for (const p of e.meeting.people) if (!p.is_me) this.maybeOffer(p.device_id);
        break;
      case "person-joined":
        if (e.from) this.maybeOffer(e.from);
        break;
      case "person-left":
        if (e.from) this.closeConn(e.from);
        break;
      case "signal":
        if (e.from && e.sdp) {
          if (e.kind === "offer") void this.onOffer(e.from, e.sdp);
          else if (e.kind === "answer") void this.onAnswer(e.from, e.sdp);
        }
        break;
      case "declined":
      case "notice":
        if (e.text) this.onNotice(e.text);
        break;
    }
  }

  /** For the end-to-end tests: how many connections are up, and bytes in. */
  async stats(): Promise<{ connected: number; audioIn: number; videoIn: number }> {
    let audioIn = 0;
    let videoIn = 0;
    let connected = 0;
    for (const c of this.conns.values()) {
      if (c.connected) connected++;
      const r = await c.pc.getStats().catch(() => null);
      r?.forEach((s: { type: string; kind?: string; bytesReceived?: number }) => {
        if (s.type === "inbound-rtp") {
          if (s.kind === "audio") audioIn += s.bytesReceived ?? 0;
          if (s.kind === "video") videoIn += s.bytesReceived ?? 0;
        }
      });
    }
    return { connected, audioIn, videoIn };
  }
}
