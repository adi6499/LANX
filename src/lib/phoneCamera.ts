/** LANX 3.6.2: the phone as this PC's camera — for everything in LANX that uses a
 *  camera (calls, meetings, hand gestures). A PC without a camera of its own uses
 *  the paired phone's while LANX is open on it, and "Phone camera" shows in the
 *  camera lists. The PC asks, the phone says yes, and the picture comes straight
 *  from the phone over the office network (WebRTC, never the internet).
 *
 *  It works by standing in for the browser's camera (getUserMedia /
 *  enumerateDevices), so every feature gets it without changes. */
import { api, events, type PhoneCamEvent } from "./api";
import { iceGathered } from "./webrtc";

export const PHONE_CAMERA_ID = "lanx-phone-camera";
export type PhoneCamMode = "auto" | "always" | "never";
const MODE_KEY = "lanx.phoneCamera";
/** How long the phone has to say yes (someone may have to pick it up). */
const ANSWER_MS = 30_000;
/** The offer goes again this often, for a phone that opens LANX meanwhile. */
const RESEND_MS = 3000;
/** Nothing has used the picture this long: the phone's camera goes off. */
const IDLE_MS = 8000;
/** After a no (or no answer), asks fail at once for a moment instead of asking again. */
const QUIET_MS = 6000;
/** After Stop (on the phone or here), longer: a call that reopens its camera by itself
 *  mustn't turn the phone's straight back on. */
const STOPPED_MS = 20_000;

export type PhoneCamState =
  | { phase: "off" }
  | { phase: "asking"; purpose: string }
  | { phase: "on"; phone: string }
  | { phase: "error"; message: string };

let mode: PhoneCamMode = (() => {
  try {
    const v = localStorage.getItem(MODE_KEY);
    return v === "always" || v === "never" ? v : "auto";
  } catch {
    return "auto";
  }
})();
let state: PhoneCamState = { phase: "off" };
const listeners = new Set<(s: PhoneCamState) => void>();
const setState = (s: PhoneCamState) => {
  state = s;
  for (const l of listeners) l(s);
};

export const phoneCamMode = () => mode;
export function setPhoneCamMode(m: PhoneCamMode) {
  mode = m;
  try {
    localStorage.setItem(MODE_KEY, m);
  } catch {}
  if (m === "never") stopPhoneCamera();
  for (const l of listeners) l(state);
}
export const phoneCamState = () => state;
export function onPhoneCamState(cb: (s: PhoneCamState) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

let purpose = "LANX";
/** What the next picture is for, shown on the phone ("hand gestures", "a video call"). */
export function setPhoneCamPurpose(p: string) {
  purpose = p;
}

/** Thrown like the browser's own camera errors, so every feature's message fits. */
function camError(name: "NotFoundError" | "NotAllowedError" | "NotReadableError", message: string) {
  return new DOMException(message, name);
}

interface Link {
  id: string;
  pc: RTCPeerConnection;
  track: MediaStreamTrack;
  phone: string;
}
let link: Link | null = null;
let opening: Promise<Link> | null = null;
let quietUntil = 0;
let quietError: DOMException | null = null;
/** The copies of the picture handed out; when all are stopped, the phone's camera goes off. */
const users = new Set<MediaStreamTrack>();
let idleSince = 0;
let watch = 0;

const waiting = new Map<string, (e: PhoneCamEvent) => void>();
let listening = false;
function listen() {
  if (listening) return;
  listening = true;
  void events.onPhoneCam((e) => {
    const w = waiting.get(e.cam_id);
    if (w) return w(e);
    // The phone stopped lending it (Stop pressed, LANX closed there).
    if (link && e.cam_id === link.id && (e.action === "stop" || e.action === "decline")) close(false, "The phone's camera was stopped on the phone.");
  });
}

async function phones() {
  try {
    const s = await api.phoneStatus();
    return { paired: s.enabled && s.devices.length > 0, online: s.devices.filter((d) => d.connected).length };
  } catch {
    return { paired: false, online: 0 };
  }
}

/** `stopped`: someone pressed Stop — asks fail with this for a while. */
function close(tellPhone: boolean, stopped?: string) {
  if (stopped) {
    quietUntil = performance.now() + STOPPED_MS;
    quietError = camError("NotAllowedError", stopped);
  }
  window.clearInterval(watch);
  watch = 0;
  const l = link;
  link = null;
  // Everything using the picture hears it ended (a call turns its camera off, gestures
  // say so): stopping a copy alone doesn't tell its user.
  for (const t of users) {
    if (t.readyState === "live") {
      t.stop();
      t.dispatchEvent(new Event("ended"));
    }
  }
  users.clear();
  if (!l) return;
  l.track.stop();
  l.pc.close();
  if (tellPhone) void api.phoneCamSend({ action: "stop", cam_id: l.id }).catch(() => {});
  setState({ phase: "off" });
}

/** Turns the phone's camera off now (the pictures handed out end). */
export function stopPhoneCamera() {
  opening = null;
  close(true, "The phone's camera was stopped.");
}

function watchUsers() {
  if (watch) return;
  idleSince = 0;
  watch = window.setInterval(() => {
    for (const t of users) if (t.readyState === "ended") users.delete(t);
    if (users.size) idleSince = 0;
    else if (!idleSince) idleSince = performance.now();
    else if (performance.now() - idleSince > IDLE_MS) close(true);
  }, 1000);
}

async function open(facing: "user" | "environment"): Promise<Link> {
  if (link && link.track.readyState === "live") return link;
  if (opening) return opening;
  if (performance.now() < quietUntil && quietError) throw quietError;
  listen();
  const run = (async () => {
    const { paired, online } = await phones();
    if (!paired) throw camError("NotFoundError", "No camera was found, and no phone is paired. Pair your phone in Settings → Phone to use its camera.");
    const id = crypto.randomUUID();
    const pc = new RTCPeerConnection({ iceServers: [] });
    pc.addTransceiver("video", { direction: "recvonly" });
    const got = new Promise<MediaStreamTrack>((resolve) => {
      pc.ontrack = (e) => resolve(e.track);
    });
    await pc.setLocalDescription(await pc.createOffer());
    await iceGathered(pc);
    const offer = { action: "offer" as const, cam_id: id, sdp: pc.localDescription?.sdp ?? "", facing, purpose };
    setState({ phase: "asking", purpose });
    const answer = await new Promise<PhoneCamEvent>((resolve, reject) => {
      const send = () => void api.phoneCamSend(offer).catch(() => {});
      send();
      const again = window.setInterval(send, RESEND_MS);
      const timer = window.setTimeout(() => {
        end();
        reject(
          camError(
            "NotFoundError",
            online ? "Your phone didn't answer. Open LANX on it and tap Allow." : "No camera was found. Open LANX on your phone to use its camera (a note was sent to it).",
          ),
        );
      }, online ? ANSWER_MS : ANSWER_MS / 2);
      const end = () => {
        window.clearInterval(again);
        window.clearTimeout(timer);
        waiting.delete(id);
      };
      waiting.set(id, (e) => {
        if (e.action === "answer" && e.sdp) {
          end();
          resolve(e);
        } else if (e.action === "decline" || e.action === "stop") {
          end();
          reject(camError(e.reason === "busy" ? "NotReadableError" : "NotAllowedError", e.reason === "busy" ? "Your phone's camera is busy (a call on the phone?)." : e.reason === "insecure" ? "Your phone is on LANX's plain page: open the secure one (Settings → Phone on the phone) to lend its camera." : "Your phone said no to lending its camera."));
        }
      });
    });
    // The other phones (if any) stop asking.
    void api.phoneCamSend({ action: "taken", cam_id: id }).catch(() => {});
    await pc.setRemoteDescription({ type: "answer", sdp: answer.sdp ?? "" });
    const track = await Promise.race([got, new Promise<never>((_, reject) => window.setTimeout(() => reject(camError("NotReadableError", "The phone's picture didn't arrive.")), 8000))]);
    pc.onconnectionstatechange = () => {
      if ((pc.connectionState === "failed" || pc.connectionState === "closed") && link?.pc === pc) close(false);
    };
    const l: Link = { id, pc, track, phone: answer.device_name || "your phone" };
    link = l;
    setState({ phase: "on", phone: l.phone });
    watchUsers();
    return l;
  })();
  opening = run;
  try {
    return await run;
  } catch (e) {
    quietUntil = performance.now() + QUIET_MS;
    quietError = e instanceof DOMException ? e : camError("NotFoundError", String(e));
    setState({ phase: "error", message: quietError.message });
    window.setTimeout(() => state.phase === "error" && setState({ phase: "off" }), 5000);
    throw quietError;
  } finally {
    if (opening === run) opening = null;
  }
}

/** A copy of the phone's picture (stop it when done, like any camera track). */
export async function phoneCameraTrack(facing: "user" | "environment" = "user"): Promise<MediaStreamTrack> {
  const l = await open(facing);
  const t = l.track.clone();
  t.contentHint = "motion";
  users.add(t);
  return t;
}

const first = (v: unknown): string | undefined => {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return typeof v[0] === "string" ? v[0] : undefined;
  if (v && typeof v === "object") {
    const o = v as { exact?: unknown; ideal?: unknown };
    return first(o.exact ?? o.ideal);
  }
  return undefined;
};
const noCamera = (e: unknown) => e instanceof DOMException && (e.name === "NotFoundError" || e.name === "OverconstrainedError" || e.name === "DevicesNotFoundError");

/** Puts the phone in the browser's camera list and requests (desktop window only). */
export function installPhoneCamera() {
  const md = navigator.mediaDevices as (MediaDevices & { __lanxPhone?: boolean }) | undefined;
  if (!md || md.__lanxPhone || typeof RTCPeerConnection === "undefined") return;
  md.__lanxPhone = true;
  const realGum = md.getUserMedia.bind(md);
  const realList = md.enumerateDevices.bind(md);
  const ownCamera = async () => (await realList().catch(() => [] as MediaDeviceInfo[])).some((d) => d.kind === "videoinput");

  md.enumerateDevices = async () => {
    const list = await realList();
    if (mode === "never" || !(await phones()).paired) return list;
    const phone = { deviceId: PHONE_CAMERA_ID, groupId: PHONE_CAMERA_ID, kind: "videoinput", label: "Phone camera (LANX on your phone)", toJSON() { return this; } };
    return [...list, phone as unknown as MediaDeviceInfo];
  };

  md.getUserMedia = async (c?: MediaStreamConstraints) => {
    if (!c?.video || mode === "never") return realGum(c);
    const v = typeof c.video === "object" ? c.video : {};
    const asked = first(v.deviceId);
    const facing = first(v.facingMode) === "environment" ? "environment" : "user";
    let usePhone = asked === PHONE_CAMERA_ID || (mode === "always" && !asked);
    if (!usePhone && !asked && mode === "auto" && !(await ownCamera())) usePhone = (await phones()).paired;
    if (!usePhone) {
      try {
        return await realGum(c);
      } catch (e) {
        // The PC's camera is gone (unplugged, say): the phone's, if there is one.
        if (!(mode === "auto" && noCamera(e) && (await phones()).paired)) throw e;
      }
    }
    const mic = c.audio ? await realGum({ audio: c.audio }) : null;
    try {
      const track = await phoneCameraTrack(facing);
      return new MediaStream([...(mic?.getAudioTracks() ?? []), track]);
    } catch (e) {
      mic?.getTracks().forEach((t) => t.stop());
      throw e;
    }
  };
}
