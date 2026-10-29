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

/** A subset of the PC's settings the phone may read and change. */
export type PhoneSettings = Pick<UserSettings, "device_id" | "display_name" | "hostname" | "avatar_color" | "theme" | "read_receipts" | "quick_replies" | "reception_desk" | "profile" | "out_of_office" | "quiet_hours">;

export function installBridge(client: PhoneClient, store: BridgeStore) {
  const notOnPhone = () => Promise.reject(new Error("That works on the PC, not on the phone."));
  const settings = () => client.request<{ settings: PhoneSettings }>("settings").then((r) => r.settings as UserSettings);

  const apiPatch: Partial<typeof api> = {
    sendGame: (peerId, step) => client.request<{ sent: boolean }>("game_send", { peer_id: peerId, step }).then((r) => r.sent),
    getConversations: () => client.request<{ conversations: Conversation[] }>("conversations").then((r) => r.conversations),
    getMessages: (conversationId) => client.request<{ messages: PhoneMessage[] }>("messages", { conv: conversationId, limit: 200 }).then((r) => r.messages as Message[]),
    getPref: async (key) => storage.get(PREF + key),
    setPref: async (key, value) => storage.set(PREF + key, value),
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
    pickFolder: notOnPhone,
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
