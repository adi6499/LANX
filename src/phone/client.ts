/** LANX 3.0: how the phone page talks to the PC — pairing over HTTP, then one
 *  WebSocket carrying JSON lines (see src-tauri/src/phone/api.rs). */
import type { Conversation, Message, Peer, Profile } from "../types";

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
}

export type PhoneMessage = Message & { transfer: PhoneTransfer | null };

export interface Me {
  id: string;
  name: string;
  color: string;
  hostname: string;
  profile: Profile | null;
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
}

export type Push =
  | { ev: "message"; message: PhoneMessage; conversation?: Conversation | null; from_phone?: number }
  | { ev: "transfer"; transfer: PhoneTransfer }
  | { ev: "deleted"; message_ids: string[]; conversation_ids: string[] }
  | { ev: "peer"; peer: Peer }
  | { ev: "peer-offline"; peer_id: string }
  | { ev: "profile"; peer_id: string; profile: Profile }
  | { ev: "typing"; conversation_id: string; display_name: string }
  | { ev: "read"; conversation_id: string; conversation: Conversation | null }
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
  const json = (await r.json()) as { state: string; token?: string };
  return json;
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

  hello() {
    return this.request<Hello>("hello");
  }

  messages(conv: string, before?: number) {
    return this.request<{ messages: PhoneMessage[]; more: boolean; conversation: Conversation | null }>("messages", { conv, before, limit: 60 });
  }

  send(conv: string, text: string) {
    return this.request<{ message: PhoneMessage }>("send", { conv, text });
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

  fileUrl(transferId: string) {
    return `/api/file/${encodeURIComponent(transferId)}`;
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
