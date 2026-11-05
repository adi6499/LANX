/** LANX 3.2 phone page: routes the desktop code's `api` / `events` calls
 *  through the PC, so desktop pieces (the games, the cards, the profile
 *  editor) work on the phone unchanged. `api` and `events` are plain objects
 *  in src/lib/api.ts; outside Tauri their methods are the browser-preview
 *  mocks, and we replace the ones the reused pieces call. */
import type { Conversation, Message, Peer, Profile, SearchHit, SystemInfo, UserSettings } from "../types";
import { api, events } from "../lib/api";
import type { GameEvent } from "../lib/games";
import { type Hit, type PhoneClient, type PhoneMessage, storage } from "./client";

export interface BridgeStore {
  peers: () => Peer[];
  profiles: () => Record<string, Profile>;
}

const PREF = "lanx_phone_pref:";

/** 3.4: when this phone last changed the wallpaper (its own change coming
 *  back from the PC is not applied again over a slider still moving). */
let ownWallpaperAt = 0;
export const ownWallpaperRecently = () => Date.now() - ownWallpaperAt < 1500;

// ---- 3.4: files for the PC's PDF tools: picked on the phone, or a file
// from a chat (read from the PC); what they save downloads to the phone and
// is kept here a while, so it can be sent to a chat too.
const kept = new Map<string, Blob>();
let keptSeq = 0;
export function keepPhoneFile(name: string, blob: Blob): string {
  const path = `phone:${++keptSeq}/${name.replace(/[\\/]/g, "_")}`;
  kept.set(path, blob);
  return path;
}
export const keptFile = (path: string): Blob | null => kept.get(path) ?? null;
/** A file the PC has (sent or received in a chat), as a path the PDF tools can open. */
export const transferPath = (transferId: string, name: string) => `phone-transfer:${transferId}/${name.replace(/[\\/]/g, "_")}`;

/** Saves a file on the phone (the browser's download). */
export function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** A file the person picks on the phone (null if they cancel). */
export function pickPhoneFile(accept: string, multiple = false): Promise<File[] | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    let done = false;
    const finish = (files: File[] | null) => {
      if (done) return;
      done = true;
      window.removeEventListener("focus", onFocus);
      resolve(files && files.length ? files : null);
    };
    // Phones say nothing when the picker is closed without a file; the page
    // getting the focus back (and no file a moment later) means "cancel".
    const onFocus = () => window.setTimeout(() => finish(input.files ? Array.from(input.files) : null), 1200);
    input.addEventListener("change", () => finish(input.files ? Array.from(input.files) : null));
    input.addEventListener("cancel", () => finish(null));
    window.addEventListener("focus", onFocus);
    input.click();
  });
}

/** A subset of the PC's settings the phone may read and change. */
export type PhoneSettings = Pick<
  UserSettings,
  | "device_id"
  | "display_name"
  | "hostname"
  | "avatar_color"
  | "theme"
  | "read_receipts"
  | "quick_replies"
  | "reception_desk"
  | "profile"
  | "out_of_office"
  | "quiet_hours"
  // 3.4
  | "chat_background"
  | "accent_color"
  | "color_style"
  | "glass_level"
  | "frost_level"
  | "reduce_motion"
  | "cat_alerts"
  | "auto_download_images"
  | "auto_lock_minutes"
  | "pin_enabled"
  | "notifications_enabled"
  | "sound_enabled"
  | "sound_choice"
  | "sound_volume"
  | "chat_folders"
  | "apps"
  | "retention_days"
  | "launch_at_startup"
  | "close_to_tray"
  | "send_to_menu"
  | "screenshot_hotkey"
  | "tcp_messaging_port"
  | "udp_discovery_port"
>;

export function installBridge(client: PhoneClient, store: BridgeStore) {
  const notOnPhone = () => Promise.reject(new Error("That works on the PC, not on the phone."));
  const settings = () => client.request<{ settings: PhoneSettings }>("settings").then((r) => r.settings as UserSettings);
  let wallpaperTimer: number | undefined;

  const apiPatch: Partial<typeof api> = {
    sendGame: (peerId, step) => client.request<{ sent: boolean }>("game_send", { peer_id: peerId, step }).then((r) => r.sent),
    getConversations: () => client.request<{ conversations: Conversation[] }>("conversations").then((r) => r.conversations),
    getMessages: (conversationId) => client.request<{ messages: PhoneMessage[] }>("messages", { conv: conversationId, limit: 200 }).then((r) => r.messages as Message[]),
    // 3.4: the wallpaper is the PC's; the rest (music and meme favourites)
    // stays on this phone.
    getPref: async (key) => (key === "wallpaper" ? JSON.stringify(await client.wallpaper()) : storage.get(PREF + key)),
    setPref: async (key, value) => {
      if (key !== "wallpaper") return storage.set(PREF + key, value);
      ownWallpaperAt = Date.now();
      window.clearTimeout(wallpaperTimer);
      wallpaperTimer = window.setTimeout(() => {
        ownWallpaperAt = Date.now();
        client.wallpaperSet(JSON.parse(value)).catch(() => {});
      }, 300);
    },
    pickWallpaper: async () => {
      const files = await pickPhoneFile("image/*,video/*");
      if (!files) return null;
      ownWallpaperAt = Date.now();
      return client.uploadWallpaper(files[0]);
    },
    clearWallpaperFile: async () => {},
    cardAction: (messageId, key, value) => client.request<{ message: PhoneMessage }>("card_action", { message_id: messageId, key, value }).then((r) => r.message as Message),
    sendCard: (conversationId, card) => client.request<{ message: PhoneMessage }>("card_send", { conv: conversationId, card }).then((r) => r.message as Message),
    getOrCreateConversation: (peerId) => client.openChat(peerId).then((r) => r.conversation),
    listCards: () => client.request<{ hits: Hit[] }>("cards").then((r) => r.hits as SearchHit[]),
    listPeers: async () => store.peers(),
    getPeerProfiles: async () => store.profiles(),
    getSettings: settings,
    saveSettings: async (s) => {
      await client.request("profile_save", { profile: s.profile });
      if (s.out_of_office) await client.request("ooo_set", { enabled: s.out_of_office.enabled, until: s.out_of_office.until, message: s.out_of_office.message });
      return settings();
    },
    playSound: async () => {},
    // ---- 3.3: memes, music sharing, the help desk and birthday wishes.
    saveMemeFile: (bytes, ext, name) => client.saveMeme(bytes, ext, name),
    downloadMeme: (url, ext, name) => client.memeDownload(url, ext, name),
    copyFileToClipboard: () => Promise.reject(new Error("On the phone, send it to a chat instead.")),
    shareWhatsApp: async (req) => {
      // 3.4: a file the phone has (a saved PDF) goes through the phone's own share sheet.
      const blob = req.file ? kept.get(req.file) : undefined;
      if (blob && req.file) {
        const file = new File([blob], req.file.split("/").pop() ?? "file.pdf", { type: blob.type || "application/pdf" });
        if (navigator.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file] });
          return "opened";
        }
        throw new Error("This phone can't share files from the page — it was downloaded; send it from your Files app.");
      }
      if (!req.text) throw new Error("On the phone, send it to a chat; sharing pictures on WhatsApp works from the PC.");
      // WhatsApp on the phone opens with the text ready to send.
      window.open(`https://wa.me/?text=${encodeURIComponent(req.text)}`, "_blank", "noopener");
      return "opened";
    },
    sendSticker: (conversationId, id) => client.sticker(conversationId, id).then((r) => r.message as Message),
    getSystemInfo: async () => {
      const { info } = await client.systemInfo();
      const out: SystemInfo = { ...info, database_path: "", database_size_bytes: 0, tcp_listening: true, udp_listening: true, tcp_port: 0 } as SystemInfo;
      return out;
    },
    getItHelpers: () => client.itHelpers().then((r) => r.ids),
    captureScreen: () => Promise.reject(new Error("No screenshot from the phone.")),
    sendPastedImage: () => Promise.reject(new Error("No screenshot from the phone.")),
    // 3.4: recordings made on the phone are kept on the PC.
    recordingBegin: (title, ext) => client.recordingBegin(title, ext),
    recordingChunk: (id, data) => client.recordingPiece(id, data),
    recordingEnd: (id, conversationId, title, kind, secs) => client.recordingEnd(id, conversationId, title, kind, secs).then((r) => r.name),
    recordingCancel: (id) => client.recordingCancel(id).then(() => {}),
    // 3.4: the PDF tools on the phone.
    pickDocuments: async (kind = "pdf") => {
      const accept = kind === "images" ? "image/*" : kind === "pdf" ? "application/pdf,.pdf" : "application/pdf,.pdf,image/*";
      const files = await pickPhoneFile(accept, true);
      return files ? files.map((f) => keepPhoneFile(f.name, f)) : [];
    },
    readFileBytes: async (path) => {
      const blob = kept.get(path);
      if (blob) return new Uint8Array(await blob.arrayBuffer());
      const t = /^phone-transfer:([^/]+)\//.exec(path);
      if (t) {
        const r = await fetch(client.fileUrl(t[1]), { credentials: "same-origin" });
        if (!r.ok) throw new Error("Couldn't open that file from your PC.");
        return new Uint8Array(await r.arrayBuffer());
      }
      throw new Error("That file is on the PC.");
    },
    saveFileBytes: async (name, bytes, kind = "pdf") => {
      const blob = new Blob([bytes.slice(0)], { type: kind === "pdf" ? "application/pdf" : "text/plain" });
      downloadBlob(name, blob);
      return keepPhoneFile(name, blob);
    },
    saveTextFile: async (name, text) => {
      const blob = new Blob([text], { type: "text/plain" });
      downloadBlob(name, blob);
      return keepPhoneFile(name, blob);
    },
    // "Where should the split PDFs go?": the phone's downloads.
    pickFolder: async () => "phone-downloads",
    saveFileInFolder: async (_folder, name, bytes) => {
      const blob = new Blob([bytes.slice(0)]);
      downloadBlob(name, blob);
      return keepPhoneFile(name, blob);
    },
    openFolder: async () => {},
    openDocument: async (path) => {
      const blob = kept.get(path);
      if (blob) window.open(URL.createObjectURL(blob), "_blank", "noopener");
    },
    subscribeFolder: notOnPhone,
    openSyncFolder: notOnPhone,
    stopSharingFolder: notOnPhone,
    unsubscribeFolder: notOnPhone,
  };
  Object.assign(api, apiPatch);

  const eventsPatch: Partial<typeof events> = {
    onGame: (cb) =>
      Promise.resolve(
        client.onPush((p) => {
          if (p.ev === "game") cb(p as unknown as GameEvent);
        })
      ),
    onMessageReceived: (cb) =>
      Promise.resolve(
        client.onPush((p) => {
          if (p.ev === "message") cb({ message: p.message, conversation: p.conversation ?? null });
        })
      ),
    onMessageStatusUpdated: (cb) =>
      Promise.resolve(
        client.onPush((p) => {
          if (p.ev === "message" && !p.conversation) cb({ message_id: p.message.id, status: p.message.status, error_reason: p.message.error_reason ?? null, message: p.message });
        })
      ),
    onStateChanged: (cb) =>
      Promise.resolve(
        client.onPush((p) => {
          if (p.ev === "reload") cb();
        })
      ),
  };
  Object.assign(events, eventsPatch);
}
