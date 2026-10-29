/** LANX 3.0: how the phone page talks to the PC — pairing over HTTP, then one
 *  WebSocket carrying JSON lines (see src-tauri/src/phone/api.rs). */
import type { Conversation, ForwardResult, GroupInfo, Message, Peer, Profile, ScheduledMessage } from "../types";

export interface PhoneTransfer {
  id: string;
  file_name: string;
  file_size: number;
  status: string;
  direction: "incoming" | "outgoing";
  kind: string;
  transferred_bytes: number;
  is_image: boolean;
  /** The file is on the PC (sent from it, or finished downloading). */
  ready: boolean;
  peer_name: string | null;
  conversation_id?: string | null;
  created_at?: number;
  completed_at?: number | null;
  error_reason?: string | null;
  parent_id?: string | null;
}

export type PhoneMessage = Message & { transfer: PhoneTransfer | null };

export interface Me {
  id: string;
  name: string;
  color: string;
  hostname: string;
  profile: Profile | null;
}

export interface StickerInfo {
  id: string;
  emoji: string;
  label: string;
}

export interface Hello {
  me: Me;
  conversations: Conversation[];
  peers: Peer[];
  profiles: Record<string, Profile>;
  version: string;
  now: number;
  /** What the PC calls this phone ("Safari on iPhone"). */
  device: string;
  ip: string;
  quick_replies?: string[];
  stickers?: StickerInfo[];
  /** 3.2: the PC's settings the phone may read (see bridge.ts PhoneSettings). */
  settings?: Record<string, unknown>;
}

export interface Hit {
  message: PhoneMessage;
  peer_name: string;
  peer_avatar_color: string;
}

export interface Progress {
  transferred_bytes: number;
  file_size: number;
  bytes_per_sec: number;
}

export type Push =
  | { ev: "message"; message: PhoneMessage; conversation?: Conversation | null; from_phone?: number }
  | { ev: "transfer"; transfer: PhoneTransfer }
  | { ev: "progress"; transfer_id: string; transferred_bytes: number; file_size: number; bytes_per_sec: number }
  | { ev: "deleted"; message_ids: string[]; conversation_ids: string[] }
  | { ev: "peer"; peer: Peer }
  | { ev: "peer-offline"; peer_id: string }
  | { ev: "profile"; peer_id: string; profile: Profile }
  | { ev: "typing"; conversation_id: string; display_name: string }
  | { ev: "read"; conversation_id: string; conversation: Conversation | null }
  | { ev: "scheduled"; conversation_id: string; problem: string | null }
  | { ev: "reminder"; message: PhoneMessage; conversation_id: string; title: string; text: string }
  | { ev: "game"; from_id: string; from_name: string; match_id: string; game: string; action: string; seq: number; data: unknown; at: number }
  | { ev: "alert"; alert: unknown }
  | { ev: "calendar"; alert: unknown }
  | { ev: "intercom"; transfer_id: string; conversation_id: string; peer_id: string; name: string; quiet: boolean }
  | { ev: "ring"; conversation_id: string; peer_name: string }
  | { ev: "notice"; text: string }
  | { ev: "reload" }
  | { ev: "lock"; locked: boolean };

export type ConnState = "idle" | "connecting" | "open" | "closed" | "unauthorized";

export const TOKEN_KEY = "lanx_phone_token";

/** localStorage that never throws (private windows, cleared data). */
export const storage = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* nothing to do */
    }
  },
  remove(key: string) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* nothing to do */
    }
  },
};

async function postJson(path: string, body: unknown, token?: string): Promise<{ status: number; json: Record<string, unknown> }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(path, { method: "POST", headers, body: JSON.stringify(body), credentials: "same-origin" });
  let json: Record<string, unknown> = {};
  try {
    json = (await r.json()) as Record<string, unknown>;
  } catch {
    /* no body */
  }
  return { status: r.status, json };
}

/** Sends the code; the PC then asks its user. Resolves with the request id. */
export async function pair(code: string): Promise<{ request?: string; status: number }> {
  const { status, json } = await postJson("/api/pair", { code });
  return { request: typeof json.request === "string" ? json.request : undefined, status };
}

export async function pollPair(request: string): Promise<{ state: string; token?: string }> {
  const r = await fetch(`/api/pair/${encodeURIComponent(request)}`, { credentials: "same-origin" });
  return (await r.json()) as { state: string; token?: string };
}

/** Gives this browser the cookie for pictures and downloads (a copy added to
 *  the Home Screen starts without it). */
export async function session(token: string): Promise<boolean> {
  try {
    return (await postJson("/api/session", { token })).status === 200;
  } catch {
    return false;
  }
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

export class PhoneClient {
  state: ConnState = "idle";
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private pushHandlers = new Set<(p: Push) => void>();
  private stateHandlers = new Set<(s: ConnState) => void>();
  private backoff = 1000;
  private stopped = false;
  private timer: number | undefined;

  constructor(public readonly token: string) {}

  onPush(cb: (p: Push) => void): () => void {
    this.pushHandlers.add(cb);
    return () => this.pushHandlers.delete(cb);
  }

  onState(cb: (s: ConnState) => void): () => void {
    this.stateHandlers.add(cb);
    return () => this.stateHandlers.delete(cb);
  }

  private setState(s: ConnState) {
    if (this.state === s) return;
    this.state = s;
    for (const cb of this.stateHandlers) cb(s);
  }

  connect() {
    this.stopped = false;
    this.open();
  }

  /** Reconnects now (the page came back to the front).  */
  wake() {
    if (this.stopped || this.state === "open" || this.state === "connecting" || this.state === "unauthorized") return;
    window.clearTimeout(this.timer);
    this.backoff = 1000;
    this.open();
  }

  close() {
    this.stopped = true;
    window.clearTimeout(this.timer);
    this.ws?.close();
    this.ws = null;
    this.setState("closed");
  }

  private open() {
    if (this.stopped) return;
    this.setState("connecting");
    const proto = location.protocol === "https:" ? "wss" : "ws";
    let ws: WebSocket;
    try {
      ws = new WebSocket(`${proto}://${location.host}/ws`);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.request<{ device: string }>("auth", { token: this.token })
        .then(() => {
          this.backoff = 1000;
          this.setState("open");
        })
        .catch((e: Error) => {
          if (e.message === "unauthorized") {
            this.stopped = true;
            this.setState("unauthorized");
            ws.close();
          }
        });
    };
    ws.onmessage = (ev) => {
      let v: Record<string, unknown>;
      try {
        v = JSON.parse(String(ev.data)) as Record<string, unknown>;
      } catch {
        return;
      }
      if (typeof v.id === "number") {
        const p = this.pending.get(v.id);
        if (!p) return;
        this.pending.delete(v.id);
        if (v.ok) p.resolve(v);
        else p.reject(new Error(typeof v.error === "string" ? v.error : "error"));
        return;
      }
      if (typeof v.ev === "string") {
        for (const cb of this.pushHandlers) cb(v as unknown as Push);
      }
    };
    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      for (const p of this.pending.values()) p.reject(new Error("offline"));
      this.pending.clear();
      if (this.state !== "unauthorized") {
        this.setState("closed");
        this.scheduleReconnect();
      }
    };
    ws.onerror = () => {
      /* onclose follows */
    };
  }

  private scheduleReconnect() {
    if (this.stopped) return;
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.open(), this.backoff);
    this.backoff = Math.min(this.backoff * 2, 10000);
  }

  request<T>(op: string, params: Record<string, unknown> = {}): Promise<T> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error("offline"));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: (v) => resolve(v as T), reject });
      ws.send(JSON.stringify({ id, op, ...params }));
      window.setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error("timeout"));
      }, 30000);
    });
  }

  // ---- chats
  hello() {
    return this.request<Hello>("hello");
  }
  messages(conv: string, before?: number) {
    return this.request<{ messages: PhoneMessage[]; more: boolean; conversation: Conversation | null }>("messages", { conv, before, limit: 60 });
  }
  send(conv: string, text: string, replyTo?: string | null, mentions: string[] = []) {
    return this.request<{ message: PhoneMessage }>("send", { conv, text, reply_to: replyTo ?? undefined, mentions });
  }
  read(conv: string) {
    return this.request<{ conversation: Conversation | null }>("read", { conv });
  }
  typing(conv: string) {
    this.request("typing", { conv }).catch(() => {});
  }
  openChat(peerId: string) {
    return this.request<{ conversation: Conversation }>("open", { peer_id: peerId });
  }

  // ---- 3.1 chat extras
  react(messageId: string, emoji: string) {
    return this.request<{ message: PhoneMessage }>("react", { message_id: messageId, emoji });
  }
  sticker(conv: string, sticker: string) {
    return this.request<{ message: PhoneMessage }>("sticker", { conv, sticker });
  }
  edit(messageId: string, text: string, mentions: string[] = []) {
    return this.request<{ message: PhoneMessage }>("edit", { message_id: messageId, text, mentions });
  }
  delete(messageId: string, everyone: boolean) {
    return this.request<{ message?: PhoneMessage }>("delete", { message_id: messageId, everyone });
  }
  forward(messageIds: string[], conversationIds: string[]) {
    return this.request<ForwardResult>("forward", { message_ids: messageIds, conversation_ids: conversationIds });
  }
  star(messageId: string, on: boolean) {
    return this.request<{ message: PhoneMessage }>("star", { message_id: messageId, on });
  }
  pin(messageId: string, on: boolean) {
    return this.request<{ message: PhoneMessage }>("pin", { message_id: messageId, on });
  }
  starred() {
    return this.request<{ hits: Hit[] }>("starred");
  }
  search(query: string) {
    return this.request<{ hits: Hit[] }>("search", { query });
  }
  later(conv: string, text: string, at: number, replyTo?: string | null, mentions: string[] = []) {
    return this.request<{ scheduled: ScheduledMessage }>("later", { conv, text, at, reply_to: replyTo ?? undefined, mentions });
  }
  scheduled(conv: string) {
    return this.request<{ items: ScheduledMessage[] }>("scheduled", { conv });
  }
  cancelLater(id: string, conv: string) {
    // (`id` is the request envelope's id, so the item goes as `scheduled_id`.)
    return this.request<Record<string, never>>("cancel_later", { scheduled_id: id, conv });
  }
  remind(messageId: string, at: number, noReply: boolean) {
    return this.request<{ message: PhoneMessage }>("remind", { message_id: messageId, at, no_reply: noReply });
  }
  cancelRemind(messageId: string) {
    return this.request<{ message: PhoneMessage }>("cancel_remind", { message_id: messageId });
  }

  // ---- groups
  groupCreate(name: string, memberIds: string[]) {
    return this.request<{ conversation: Conversation }>("group_create", { name, member_ids: memberIds });
  }
  group(groupId: string) {
    return this.request<{ group: GroupInfo }>("group", { group_id: groupId });
  }
  groupUpdate(groupId: string, name: string | null, add: string[], remove: string[]) {
    return this.request<{ group: GroupInfo }>("group_update", { group_id: groupId, name: name ?? undefined, add, remove });
  }
  groupLeave(groupId: string) {
    return this.request<Record<string, never>>("group_leave", { group_id: groupId });
  }

  // ---- files
  transfers() {
    return this.request<{ transfers: PhoneTransfer[] }>("transfers");
  }
  accept(transferId: string) {
    return this.request<{ transfer: PhoneTransfer }>("accept", { transfer_id: transferId });
  }
  cancel(transferId: string) {
    return this.request<{ transfer: PhoneTransfer }>("cancel", { transfer_id: transferId });
  }
  retry(transferId: string) {
    return this.request<{ transfer: PhoneTransfer }>("retry", { transfer_id: transferId });
  }

  fileUrl(transferId: string) {
    return `/api/file/${encodeURIComponent(transferId)}`;
  }

  /** The PC's secure address and certificate (no token needed). */
  static async ping(): Promise<{ version: string; https_port: number; https_urls: string[]; cert_fingerprint: string }> {
    const r = await fetch("/api/ping", { credentials: "same-origin" });
    const j = (await r.json()) as Partial<{ version: string; https_port: number; https_urls: string[]; cert_fingerprint: string }>;
    return { version: j.version ?? "", https_port: j.https_port ?? 0, https_urls: j.https_urls ?? [], cert_fingerprint: j.cert_fingerprint ?? "" };
  }

  /** A recorded voice note (3.2; the page must be secure to record). */
  voice(conv: string, blob: Blob, ms: number, ext: string): Promise<PhoneMessage> {
    return this.post(`/api/voice?conv=${encodeURIComponent(conv)}&ms=${Math.round(ms)}&ext=${encodeURIComponent(ext)}`, blob);
  }

  /** An intercom message: plays out loud on the colleague's PC. */
  intercom(conv: string, blob: Blob, ms: number, ext: string): Promise<PhoneMessage> {
    return this.post(`/api/intercom?conv=${encodeURIComponent(conv)}&ms=${Math.round(ms)}&ext=${encodeURIComponent(ext)}`, blob);
  }

  private async post(path: string, body: Blob): Promise<PhoneMessage> {
    const r = await fetch(path, { method: "POST", headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/octet-stream" }, body, credentials: "same-origin" });
    const j = (await r.json().catch(() => ({}))) as { message?: PhoneMessage; error?: string };
    if (!r.ok || !j.message) throw new Error(j.error ?? `failed (${r.status})`);
    return j.message;
  }

  /** Sends a photo or file into a chat (with progress 0–100). */
  upload(conv: string, file: File, onProgress: (pct: number) => void): Promise<PhoneMessage> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const name = file.name || `photo-${Date.now()}.jpg`;
      xhr.open("POST", `/api/upload?conv=${encodeURIComponent(conv)}&name=${encodeURIComponent(name)}`);
      xhr.setRequestHeader("Authorization", `Bearer ${this.token}`);
      xhr.setRequestHeader("Content-Type", "application/octet-stream");
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        if (xhr.status === 200) {
          try {
            resolve((JSON.parse(xhr.responseText) as { message: PhoneMessage }).message);
            return;
          } catch {
            /* fall through */
          }
        }
        let error = `upload failed (${xhr.status})`;
        try {
          error = (JSON.parse(xhr.responseText) as { error?: string }).error ?? error;
        } catch {
          /* keep */
        }
        reject(new Error(error));
      };
      xhr.onerror = () => reject(new Error("offline"));
      xhr.send(file);
    });
  }
}
