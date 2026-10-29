/** LANX 3.2 phone page: the microphone (voice notes, intercom) and alerts
 *  when the page is closed (web push). Both only exist on a secure page —
 *  the browser hides them otherwise. */
import type { PushState } from "./more";

export const secure = () => window.isSecureContext;

// ------------------------------------------------------------------ record

export interface Recording {
  blob: Blob;
  ext: "webm" | "ogg" | "m4a" | "mp4";
  ms: number;
}

const mimeFor = (): { mime: string; ext: Recording["ext"] } => {
  const options: { mime: string; ext: Recording["ext"] }[] = [
    { mime: "audio/webm;codecs=opus", ext: "webm" },
    { mime: "audio/ogg;codecs=opus", ext: "ogg" },
    { mime: "audio/mp4", ext: "m4a" },
    { mime: "audio/webm", ext: "webm" },
  ];
  const ok = options.find((o) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(o.mime));
  return ok ?? { mime: "", ext: "m4a" };
};

export const canRecord = () => secure() && typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

/** Starts recording; `stop()` resolves with the sound (null when nothing was said). */
export async function startRecording(): Promise<{ stop: () => Promise<Recording | null>; cancel: () => void }> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const { mime, ext } = mimeFor();
  const rec = new MediaRecorder(stream, { mimeType: mime || undefined, audioBitsPerSecond: 64_000 });
  const chunks: BlobPart[] = [];
  const started = Date.now();
  rec.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  rec.start(250);
  const release = () => stream.getTracks().forEach((t) => t.stop());
  return {
    stop: () =>
      new Promise((resolve) => {
        rec.onstop = () => {
          release();
          const ms = Date.now() - started;
          if (ms < 400 || chunks.length === 0) {
            resolve(null);
            return;
          }
          resolve({ blob: new Blob(chunks, { type: mime || rec.mimeType }), ext, ms });
        };
        rec.state === "inactive" ? rec.onstop?.(new Event("stop")) : rec.stop();
      }),
    cancel: () => {
      try {
        rec.onstop = null;
        if (rec.state !== "inactive") rec.stop();
      } catch {
        /* already stopped */
      }
      release();
    },
  };
}

// -------------------------------------------------------------------- push

const supportsPush = () => secure() && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

function urlBase64ToUint8Array(s: string): Uint8Array {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** What the "alerts when closed" switch should show right now. */
export async function pushState(): Promise<PushState> {
  if (!supportsPush()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  try {
    const reg = await navigator.serviceWorker.getRegistration("/");
    const sub = await reg?.pushManager.getSubscription();
    return sub ? "on" : "off";
  } catch {
    return "off";
  }
}

/** Registers the worker, asks for permission, subscribes, and tells the PC. */
export async function enablePush(token: string): Promise<PushState> {
  if (!supportsPush()) return "unsupported";
  const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  await navigator.serviceWorker.ready;
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return "denied";
  const keyRes = await fetch("/api/push/key", { headers: { Authorization: `Bearer ${token}` }, credentials: "same-origin" });
  if (!keyRes.ok) throw new Error("The PC has no alert key yet.");
  const { key } = (await keyRes.json()) as { key: string };
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) as BufferSource }));
  const r = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    credentials: "same-origin",
    body: JSON.stringify(sub.toJSON()),
  });
  if (!r.ok) throw new Error("The PC did not accept the alert subscription.");
  return "on";
}
