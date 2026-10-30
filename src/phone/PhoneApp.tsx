/** LANX 3.x: the phone page — connect with the code from the PC, then chats,
 *  one chat, Who's in, Files and More (cards, notes, calendar, games, status…),
 *  all through that PC (src/phone/client.ts, src/phone/bridge.ts). */
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FolderOpen, LayoutGrid, MessageCircle, Smartphone, Users } from "lucide-react";
import type { AlertInfo, ChatFolder, Conversation, GroupInfo, Peer, Profile, UserSettings } from "../types";
import { CreateCardModal } from "../components/org/CreateCardModal";
import { needsMe } from "../components/org/cardModel";
import * as games from "../lib/games";
import { api } from "../lib/api";
import { needsAnswer } from "../lib/office";
import { type ConnState, type Hit, type LockInfo, type Me, PhoneClient, type PhoneMessage, type PhoneTransfer, type Progress, type Push, type StickerInfo, TOKEN_KEY, pair, pollPair, session, storage } from "./client";
import { ChatView, type Upload } from "./ChatView";
import { AboutSheet, ChatsScreen, FilesScreen, ForwardPicker, GroupCreateScreen, GroupInfoScreen, HitsScreen, PeopleScreen } from "./screens";
import { AlertBanner, CalendarScreen, CardsScreen, EmergencyScreen, KudosSheet, MoreScreen, type MoreKey, NotesScreen, PersonSheet, ProfileSheet, type PushState, ReportSheet, SecureSheet, StatusSheet } from "./more";
import { GamesScreen } from "./GamesScreen";
import { BroadcastSheet, ChatMenuSheet, LockedScreen, MemesScreen, MusicScreen, PinSheet } from "./extras";
import { MusicPlayer } from "../components/music/MusicPlayer";
import { HelpDeskModal } from "../components/HelpDeskModal";
import { OfficePanel } from "../components/office/OfficePanel";
import { type PhoneSettings, installBridge, keptFile, ownWallpaperRecently, transferPath } from "./bridge";
import { WallpaperLayer } from "../components/WallpaperLayer";
import { CalcPanel } from "../components/tools/CalcPanel";
import { PdfStudio } from "../components/pdf/PdfStudio";
import { WhatsAppInviteModal } from "../components/WhatsAppInviteModal";
import { AppearanceScreen, AppsScreen, ConfirmSheet, ConnectSheet, DirectoryScreen, FoldersSheet, MuteSheet, SettingsScreen, SyncScreen, ToolsScreen, type ToolKey, isMuted } from "./more34";
import { applyLook, wallpaperSrc } from "./look";
import { type MeetingPush, PhoneMeeting, canMeet } from "./meeting";
import { MeetingScreen } from "./MeetingScreen";
import type { CardKind } from "../components/org/cardModel";
import { type Recording, enablePush, pushState as readPushState, secure as isSecure } from "./media";
import { PhoneCall, canCall, unlockAudio } from "./call";
import { CallScreen } from "./CallScreen";

const sortConvs = (list: Conversation[]) => [...list].sort((a, b) => Number(b.is_pinned) - Number(a.is_pinned) || b.last_message_time - a.last_message_time);

function upsertMessage(list: PhoneMessage[], m: PhoneMessage): PhoneMessage[] {
  const i = list.findIndex((x) => x.id === m.id);
  if (i >= 0) {
    const next = list.slice();
    next[i] = m;
    return next;
  }
  const next = [...list, m];
  // New messages arrive in order; a late one (reconnect) still lands in place.
  if (list.length && list[list.length - 1].timestamp > m.timestamp) next.sort((a, b) => a.timestamp - b.timestamp);
  return next;
}

/** `#token=…` (moving to the secure page) and `#chat=…` (an alert tapped). */
function readHash(): { token?: string; chat?: string } {
  const h = new URLSearchParams(location.hash.replace(/^#/, ""));
  return { token: h.get("token") ?? undefined, chat: h.get("chat") ?? undefined };
}

// --------------------------------------------------------------------- root

export default function PhoneApp() {
  const [token, setToken] = useState<string | null>(() => {
    const { token: fromHash } = readHash();
    if (fromHash) {
      storage.set(TOKEN_KEY, fromHash);
      history.replaceState(null, "", location.pathname);
      return fromHash;
    }
    return storage.get(TOKEN_KEY);
  });
  const forget = useCallback(() => {
    storage.remove(TOKEN_KEY);
    setToken(null);
  }, []);
  if (!token) {
    return (
      <Connect
        onDone={(t) => {
          storage.set(TOKEN_KEY, t);
          setToken(t);
        }}
      />
    );
  }
  return <Main key={token} token={token} onForget={forget} />;
}

// ------------------------------------------------------------------ connect

function Connect({ onDone }: { onDone: (token: string) => void }) {
  const fromLink = useMemo(() => (new URLSearchParams(location.hash.replace(/^#/, "")).get("code") ?? "").replace(/\D/g, "").slice(0, 8), []);
  const [code, setCode] = useState(fromLink);
  const [phase, setPhase] = useState<"idle" | "sending" | "waiting" | "denied" | "error">("idle");
  const [error, setError] = useState("");
  const [request, setRequest] = useState<string | null>(null);
  const auto = useRef(fromLink.length === 8);

  const submit = useCallback(async (c: string) => {
    setPhase("sending");
    setError("");
    try {
      const r = await pair(c);
      if (r.status === 202 && r.request) {
        setRequest(r.request);
        setPhase("waiting");
        return;
      }
      setPhase("error");
      setError(
        r.status === 403
          ? "That code isn't right. Check the code on your PC."
          : r.status === 410
            ? "No code is active on the PC. Open Settings → Phone there and tap “New code”."
            : r.status === 429
              ? "Too many phones are waiting. Try again in a minute."
              : `The PC answered with ${r.status}.`
      );
    } catch {
      setPhase("error");
      setError("Can't reach the PC. Is this phone on the office Wi-Fi?");
    }
  }, []);

  useEffect(() => {
    if (auto.current) {
      auto.current = false;
      void submit(fromLink);
    }
  }, [fromLink, submit]);

  useEffect(() => {
    if (phase !== "waiting" || !request) return;
    let on = true;
    let timer = 0;
    const tick = async () => {
      try {
        const r = await pollPair(request);
        if (!on) return;
        if (r.state === "allowed" && r.token) {
          await session(r.token);
          history.replaceState(null, "", location.pathname);
          onDone(r.token);
          return;
        }
        if (r.state === "denied") {
          setPhase("denied");
          return;
        }
        if (r.state === "expired") {
          setPhase("error");
          setError("The PC didn't answer in time. Try again.");
          return;
        }
      } catch {
        /* the PC is busy; ask again */
      }
      if (on) timer = window.setTimeout(tick, 1500);
    };
    timer = window.setTimeout(tick, 800);
    return () => {
      on = false;
      window.clearTimeout(timer);
    };
  }, [phase, request, onDone]);

  const digits = code.replace(/\D/g, "").slice(0, 8);
  const shown = digits.length > 4 ? `${digits.slice(0, 4)} ${digits.slice(4)}` : digits;
  const busy = phase === "sending" || phase === "waiting";

  return (
    <div className="ph-root lanx-window" data-ph-screen="connect">
      <div className="ph-scroll flex flex-col items-center justify-center px-6 py-10">
        <div className="w-full max-w-sm rounded-[22px] lanx-card p-6">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-500 text-white">
              <Smartphone className="h-5 w-5" />
            </span>
            <div>
              <div className="text-[17px] font-bold tracking-[-0.02em] text-slate-900 dark:text-white">LANX on your phone</div>
              <div className="text-[12px] text-slate-500 dark:text-slate-400">Your chats, through your PC</div>
            </div>
          </div>
          <p className="mt-4 text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">
            On your PC open LANX → Settings → <b>Phone</b>. Scan the QR code with this phone's camera, or type the 8-digit code here.
          </p>
          <form
            className="mt-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (digits.length === 8 && !busy) void submit(digits);
            }}
          >
            <input
              data-ph-code
              inputMode="numeric"
              pattern="[0-9 ]*"
              autoComplete="one-time-code"
              placeholder="0000 0000"
              value={shown}
              disabled={busy}
              onChange={(e) => setCode(e.target.value)}
              className="ph-code w-full rounded-2xl lanx-field px-4 py-3 text-center text-[22px] font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
            <button type="submit" data-ph-connect disabled={digits.length !== 8 || busy} className="mt-3 w-full rounded-2xl bg-sky-500 py-3 text-[15px] font-semibold text-white disabled:opacity-50">
              {phase === "waiting" ? "Waiting for your PC…" : phase === "sending" ? "Connecting…" : "Connect"}
            </button>
          </form>
          <div data-ph-status={phase} className="mt-3 min-h-[20px] text-[12.5px] leading-snug">
            {phase === "waiting" && (
              <span className="text-slate-600 dark:text-slate-300">
                Your PC is asking <b>“Allow this phone?”</b> — tap <b>Allow</b> there.
                <button
                  type="button"
                  className="ml-2 font-semibold text-sky-600 dark:text-sky-400"
                  onClick={() => {
                    setPhase("idle");
                    setRequest(null);
                  }}
                >
                  Cancel
                </button>
              </span>
            )}
            {phase === "denied" && <span className="text-rose-600 dark:text-rose-400">The PC said no. Ask again if that was a slip.</span>}
            {phase === "error" && <span className="text-rose-600 dark:text-rose-400">{error}</span>}
          </div>
        </div>
        <p className="mt-6 max-w-sm text-center text-[11.5px] leading-relaxed text-slate-400">Works on the office Wi-Fi while LANX is running on your PC. Nothing goes through the internet.</p>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------- main

/** Where the page is: a chat, a page over the tabs, or the tabs. Kept in
 *  history so the phone's back button works. */
interface View {
  chat?: string;
  page?: "group-new" | "group-info" | "search" | "starred" | "cards" | "notes" | "calendar" | "emergency" | "games" | "music" | "memes" | "appearance" | "settings" | "tools" | "directory" | "sync" | "apps";
  q?: string;
  /** 3.4: search filters — what kind, and inside the open chat only. */
  kind?: string;
  inChat?: boolean;
  gid?: string;
  jump?: string;
}

type Tab = "chats" | "people" | "files" | "more";
type SheetKind = "about" | "status" | "profile" | "kudos" | "report" | "secure" | "broadcast" | "hidden" | "chat-menu" | "helpdesk" | "office" | "mute" | "folders" | "folders-edit" | "delete-chat" | "connect" | "invite" | null;

const FOLDER_KEY = "lanx_phone_folder";

interface PingInfo {
  https_urls: string[];
  cert_fingerprint: string;
}

function Main({ token, onForget }: { token: string; onForget: () => void }) {
  const client = useMemo(() => new PhoneClient(token), [token]);
  const [conn, setConn] = useState<ConnState>("idle");
  const [me, setMe] = useState<Me | null>(null);
  const [device, setDevice] = useState("");
  const [version, setVersion] = useState("");
  const [settings, setSettings] = useState<PhoneSettings | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [quickReplies, setQuickReplies] = useState<string[]>([]);
  const [stickers, setStickers] = useState<StickerInfo[]>([]);
  const [messages, setMessages] = useState<Record<string, PhoneMessage[]>>({});
  const [more, setMore] = useState<Record<string, boolean>>({});
  const [typing, setTyping] = useState<Record<string, { name: string; until: number }>>({});
  const [groups, setGroups] = useState<Record<string, GroupInfo>>({});
  const [transfers, setTransfers] = useState<PhoneTransfer[]>([]);
  const [progress, setProgress] = useState<Record<string, Progress>>({});
  const [hits, setHits] = useState<Hit[]>([]);
  const [hitsLoading, setHitsLoading] = useState(false);
  const [cards, setCards] = useState<Hit[]>([]);
  const [cardsLoading, setCardsLoading] = useState(false);
  const [alerts, setAlerts] = useState<AlertInfo[]>([]);
  const [alertBanner, setAlertBanner] = useState<AlertInfo | null>(null);
  const [calendarVersion, setCalendarVersion] = useState(0);
  const [ping, setPing] = useState<PingInfo>({ https_urls: [], cert_fingerprint: "" });
  const [push, setPush] = useState<PushState>("unsupported");
  const [view, setView] = useState<View>({});
  const [tab, setTab] = useState<Tab>("chats");
  const [query, setQuery] = useState("");
  const [locked, setLocked] = useState(false);
  // 3.3: the PC's PIN lock and hidden chats.
  const [lockInfo, setLockInfo] = useState<LockInfo | null>(null);
  // 3.3: where a meme or song picked outside a chat should go (chosen after).
  const [pendingSend, setPendingSend] = useState<{ kind: "meme"; file: string } | { kind: "song"; card: Record<string, unknown> } | null>(null);
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [person, setPerson] = useState<Peer | null>(null);
  const [forwardFrom, setForwardFrom] = useState<PhoneMessage | null>(null);
  const [createCardFor, setCreateCardFor] = useState<string | null>(null);
  const [pickCardChat, setPickCardChat] = useState(false);
  const [problem, setProblem] = useState("");
  const [notice, setNotice] = useState("");
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [scheduledVersion, setScheduledVersion] = useState(0);
  // 3.4
  const [folder, setFolderState] = useState(() => storage.get(FOLDER_KEY) ?? "all");
  const setFolder = useCallback((f: string) => {
    setFolderState(f);
    storage.set(FOLDER_KEY, f);
  }, []);
  const [createCardInit, setCreateCardInit] = useState<{ kind: CardKind; title?: string; fromMessage?: string } | null>(null);
  const [calcOpen, setCalcOpen] = useState(false);
  /** The PDF tools: undefined = shut, null = open with nothing, else a file to open. */
  const [pdfPath, setPdfPath] = useState<string | null | undefined>(undefined);
  const [sendFilePath, setSendFilePath] = useState<string | null>(null);
  const [updateVersion, setUpdateVersion] = useState(0);
  const reportTo = useMemo(() => (sheet === "report" ? client.reportTo().then((r) => r.ids) : undefined), [sheet, client]);
  const activeRef = useRef<string | null>(null);
  const active = view.chat ?? null;
  activeRef.current = active;
  const conversationsRef = useRef<Conversation[]>([]);
  conversationsRef.current = conversations;
  const peersRef = useRef<Peer[]>([]);
  peersRef.current = peers;
  const profilesRef = useRef<Record<string, Profile>>({});
  profilesRef.current = profiles;
  const secure = isSecure();

  // 3.2: calls on the phone (the PC does the signalling).
  const calls = useMemo(
    () =>
      new PhoneCall(
        client,
        (t) => setProblem(t),
        (t) => setNotice(t)
      ),
    [client]
  );
  // 3.4: group meetings, the same way.
  const meetings = useMemo(
    () =>
      new PhoneMeeting(
        client,
        (t) => setProblem(t),
        (t) => setNotice(t)
      ),
    [client]
  );

  // The PC's own code (games, cards) calls `api`; route it through the PC.
  useMemo(() => installBridge(client, { peers: () => peersRef.current, profiles: () => profilesRef.current }), [client]);

  const upsertConv = useCallback((c: Conversation) => {
    setConversations((list) => sortConvs(list.some((x) => x.id === c.id) ? list.map((x) => (x.id === c.id ? c : x)) : [...list, c]));
  }, []);

  const fail = useCallback((e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "LOCKED") setLocked(true);
    else if (msg !== "offline") setProblem(msg);
  }, []);

  const changed = useCallback((m: PhoneMessage) => {
    setMessages((all) => (all[m.conversation_id] ? { ...all, [m.conversation_id]: upsertMessage(all[m.conversation_id], m) } : all));
    setCards((list) => (list.some((h) => h.message.id === m.id) ? list.map((h) => (h.message.id === m.id ? { ...h, message: m } : h)) : list));
  }, []);

  const load = useCallback(async () => {
    try {
      const h = await client.hello();
      setMe(h.me);
      setDevice(h.device);
      setVersion(h.version);
      setConversations(sortConvs(h.conversations));
      setPeers(h.peers);
      setProfiles(h.profiles);
      setQuickReplies(h.quick_replies ?? []);
      setStickers(h.stickers ?? []);
      if (h.settings) setSettings(h.settings as PhoneSettings);
      if (h.lock) setLockInfo(h.lock);
      setLocked(false);
      calls.myDeviceId = h.device_id ?? "";
      void calls.resume();
      // 3.4: the PC's wallpaper, and a meeting going on.
      if (h.wallpaper && !ownWallpaperRecently()) window.dispatchEvent(new CustomEvent("lanx-wallpaper", { detail: h.wallpaper }));
      void meetings.resume(h.device_id ?? "");
    } catch (e) {
      fail(e);
    }
  }, [client, fail, calls, meetings]);

  const loadSettings = useCallback(() => {
    client
      .request<{ settings: PhoneSettings }>("settings")
      .then((r) => setSettings(r.settings))
      .catch(fail);
  }, [client, fail]);

  const loadTransfers = useCallback(() => {
    client
      .transfers()
      .then((r) => setTransfers(r.transfers))
      .catch(fail);
  }, [client, fail]);

  const loadCards = useCallback(() => {
    setCardsLoading(true);
    client
      .request<{ hits: Hit[] }>("cards")
      .then((r) => setCards(r.hits))
      .catch(fail)
      .finally(() => setCardsLoading(false));
  }, [client, fail]);

  const loadAlerts = useCallback(() => {
    client
      .request<{ alerts: AlertInfo[] }>("alerts")
      .then((r) => setAlerts(r.alerts))
      .catch(fail);
  }, [client, fail]);

  const loadGroup = useCallback(
    (id: string) => {
      client
        .group(id)
        .then((r) => setGroups((g) => ({ ...g, [id]: r.group })))
        .catch(() => {});
    },
    [client]
  );

  const markRead = useCallback(
    (conv: string) => {
      client
        .read(conv)
        .then((r) => r.conversation && upsertConv(r.conversation))
        .catch(fail);
    },
    [client, upsertConv, fail]
  );

  const loadMessages = useCallback(
    async (conv: string, before?: number) => {
      try {
        const r = await client.messages(conv, before);
        setMessages((all) => {
          const cur = all[conv] ?? [];
          const ids = new Set(r.messages.map((m) => m.id));
          const merged = before ? [...r.messages, ...cur.filter((m) => !ids.has(m.id))] : r.messages.concat(cur.filter((m) => !ids.has(m.id) && m.timestamp > (r.messages[r.messages.length - 1]?.timestamp ?? 0)));
          return { ...all, [conv]: merged };
        });
        setMore((x) => ({ ...x, [conv]: r.more }));
        if (r.conversation) upsertConv(r.conversation);
      } catch (e) {
        fail(e);
      }
    },
    [client, upsertConv, fail]
  );

  // Navigation (the phone's back button pops these).
  const go = useCallback((v: View) => {
    setView(v);
    history.pushState({ ph: v }, "");
  }, []);
  const back = useCallback(() => {
    if (history.state?.ph) history.back();
    else setView({});
  }, []);
  useEffect(() => {
    const onPop = () => {
      setView((history.state?.ph as View | undefined) ?? {});
      setSheet(null);
      setForwardFrom(null);
      setPerson(null);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const openChat = useCallback(
    (conv: string, jump?: string) => {
      go({ chat: conv, jump });
      setTab("chats");
      void loadMessages(conv);
      markRead(conv);
      const c = conversationsRef.current.find((x) => x.id === conv);
      if (!c || c.kind === "group") loadGroup(conv);
    },
    [go, loadMessages, markRead, loadGroup]
  );

  // A game card's "Play" (the PC's own card code) opens the board here.
  useEffect(() => {
    const open = (e: Event) => {
      const d = ((e as CustomEvent).detail ?? {}) as { matchId?: string; card?: games.GameCardData; message?: Parameters<typeof games.openFromCard>[1] };
      if (d.card && d.message) {
        games
          .openFromCard(d.card, d.message, peersRef.current)
          .then((m) => go({ page: "games", gid: m.id }))
          .catch(fail);
      } else go({ page: "games", gid: d.matchId ?? undefined });
    };
    window.addEventListener("lanx:game-open", open);
    return () => window.removeEventListener("lanx:game-open", open);
  }, [go, fail]);

  // The connection, and what the PC tells us.
  useEffect(() => {
    const offState = client.onState((s) => {
      setConn(s);
      if (s === "open") {
        void load();
        const a = activeRef.current;
        if (a) {
          void loadMessages(a);
          markRead(a);
        }
      }
      if (s === "unauthorized") onForget();
    });
    const offPush = client.onPush((p: Push) => {
      switch (p.ev) {
        case "message": {
          const m = p.message;
          setMessages((all) => (all[m.conversation_id] ? { ...all, [m.conversation_id]: upsertMessage(all[m.conversation_id], m) } : all));
          if (m.message_type === "card") setCards((list) => (list.some((h) => h.message.id === m.id) ? list.map((h) => (h.message.id === m.id ? { ...h, message: m } : h)) : list));
          if (p.conversation) upsertConv(p.conversation);
          if (!m.is_outgoing) {
            setTyping((t) => {
              if (!(m.conversation_id in t)) return t;
              const n = { ...t };
              delete n[m.conversation_id];
              return n;
            });
            if (activeRef.current === m.conversation_id && document.visibilityState === "visible") markRead(m.conversation_id);
          }
          break;
        }
        case "transfer":
          setMessages((all) => {
            const next: Record<string, PhoneMessage[]> = {};
            for (const [k, list] of Object.entries(all)) {
              next[k] = list.map((m) => (m.transfer?.id === p.transfer.id || m.transfer_id === p.transfer.id ? { ...m, transfer: p.transfer } : m));
            }
            return next;
          });
          setTransfers((list) => (list.some((t) => t.id === p.transfer.id) ? list.map((t) => (t.id === p.transfer.id ? p.transfer : t)) : [p.transfer, ...list]));
          if (p.transfer.status !== "transferring") {
            setProgress((pr) => {
              if (!(p.transfer.id in pr)) return pr;
              const n = { ...pr };
              delete n[p.transfer.id];
              return n;
            });
          }
          break;
        case "progress":
          setProgress((pr) => ({ ...pr, [p.transfer_id]: { transferred_bytes: p.transferred_bytes, file_size: p.file_size, bytes_per_sec: p.bytes_per_sec } }));
          break;
        case "deleted": {
          const gone = new Set(p.message_ids);
          setMessages((all) => {
            const next: Record<string, PhoneMessage[]> = {};
            for (const [k, list] of Object.entries(all)) next[k] = list.filter((m) => !gone.has(m.id));
            return next;
          });
          setCards((list) => list.filter((h) => !gone.has(h.message.id)));
          break;
        }
        case "peer":
          setPeers((list) => (list.some((x) => x.id === p.peer.id) ? list.map((x) => (x.id === p.peer.id ? p.peer : x)) : [...list, p.peer]));
          setConversations((list) => list.map((c) => (c.peer_id === p.peer.id ? { ...c, peer_status: p.peer.status, peer_name: p.peer.display_name, peer_avatar_color: p.peer.avatar_color } : c)));
          break;
        case "peer-offline":
          setPeers((list) => list.map((x) => (x.id === p.peer_id ? { ...x, status: "offline" } : x)));
          setConversations((list) => list.map((c) => (c.peer_id === p.peer_id ? { ...c, peer_status: "offline" } : c)));
          break;
        case "profile":
          setProfiles((pr) => ({ ...pr, [p.peer_id]: p.profile }));
          break;
        case "typing":
          setTyping((t) => ({ ...t, [p.conversation_id]: { name: p.display_name, until: Date.now() + 4000 } }));
          break;
        case "read":
          if (p.conversation) upsertConv(p.conversation);
          break;
        case "scheduled":
          setScheduledVersion((v) => v + 1);
          if (p.problem) setProblem(p.problem);
          break;
        case "reminder":
          setNotice(`⏰ ${p.title}: ${p.text}`.slice(0, 160));
          changed(p.message);
          break;
        case "game":
          games.receive(p as unknown as games.GameEvent);
          break;
        case "call":
          void calls.handle(p);
          break;
        case "alert": {
          const a = p.alert as AlertInfo;
          setAlerts((list) => (list.some((x) => x.id === a.id) ? list.map((x) => (x.id === a.id ? a : x)) : [a, ...list]));
          if (needsAnswer(a)) setAlertBanner(a);
          else setAlertBanner((cur) => (cur && cur.id === a.id ? null : cur));
          break;
        }
        case "calendar": {
          const a = p.alert as { title?: string; text?: string };
          setNotice(`📅 ${a.title ?? "Event"}${a.text ? ` · ${a.text}` : ""}`.slice(0, 160));
          setCalendarVersion((v) => v + 1);
          break;
        }
        case "intercom": {
          const i = p as unknown as { transfer_id: string; name?: string; quiet?: boolean };
          setNotice(`📻 ${i.name ?? "Intercom"}`);
          if (!i.quiet && i.transfer_id) {
            const a = new Audio(client.fileUrl(i.transfer_id));
            a.play().catch(() => {});
          }
          break;
        }
        case "ring": {
          const r = p as unknown as { peer_name?: string };
          setNotice(`🔔 ${r.peer_name ?? "Someone"} is ringing you`);
          if ("vibrate" in navigator) navigator.vibrate?.([200, 100, 200]);
          break;
        }
        case "notice": {
          const n = p as unknown as { text?: string };
          if (n.text) setNotice(n.text.slice(0, 160));
          break;
        }
        case "reload":
          void load();
          break;
        case "wallpaper": {
          // Changed on the PC: follow it (a moment later if this phone has
          // just changed it itself, so a moving slider does not jump back).
          const refresh = () => window.dispatchEvent(new CustomEvent("lanx-wallpaper"));
          if (ownWallpaperRecently()) window.setTimeout(refresh, 1600);
          else refresh();
          break;
        }
        case "meeting":
          meetings.handle(p as unknown as MeetingPush, calls.myDeviceId);
          break;
        case "update":
          setUpdateVersion((n) => n + 1);
          break;
        case "lock":
          setLocked(p.locked);
          setLockInfo((cur) => ({ pin_set: p.pin_set ?? cur?.pin_set ?? true, locked: p.locked, hidden_unlocked: p.hidden_unlocked ?? false, retry_after_secs: p.retry_after_secs ?? 0 }));
          if (!p.locked) void load();
          break;
      }
    });
    client.connect();
    return () => {
      offState();
      offPush();
      client.close();
    };
  }, [client, load, loadMessages, markRead, upsertConv, onForget, changed, calls, meetings]);

  // 3.4: the PC's Appearance here too; quick replies follow the settings.
  useEffect(() => {
    applyLook(settings);
    if (settings?.quick_replies) setQuickReplies(settings.quick_replies);
  }, [settings]);

  // Settings changed here go to the PC a moment later, together (a colour
  // being dragged, a slider), and show at once.
  const pendingPatch = useRef<Record<string, unknown>>({});
  const patchTimer = useRef<number | undefined>(undefined);
  const changeSettings = useCallback(
    (patch: Partial<UserSettings>) => {
      setSettings((s) => (s ? ({ ...s, ...patch } as PhoneSettings) : s));
      pendingPatch.current = { ...pendingPatch.current, ...patch };
      window.clearTimeout(patchTimer.current);
      patchTimer.current = window.setTimeout(() => {
        const p = pendingPatch.current;
        pendingPatch.current = {};
        client
          .settingsSave(p)
          .then((r) => setSettings(r.settings as PhoneSettings))
          .catch((e) => {
            fail(e);
            loadSettings();
          });
      }, 350);
    },
    [client, fail, loadSettings]
  );

  // For the end-to-end tests.
  useEffect(() => {
    (window as unknown as { __lanxPhoneMeeting?: PhoneMeeting }).__lanxPhoneMeeting = meetings;
  }, [meetings]);

  // For the end-to-end tests: the call's packet counts (like the games' __lanxStages).
  useEffect(() => {
    (window as unknown as { __lanxPhoneCall?: PhoneCall }).__lanxPhoneCall = calls;
  }, [calls]);

  // Phones only play the ring after a tap: the first tap anywhere unlocks sound.
  useEffect(() => {
    window.addEventListener("pointerdown", unlockAudio, { passive: true });
    return () => window.removeEventListener("pointerdown", unlockAudio);
  }, []);

  // The PC's secure address, and whether alerts are on.
  useEffect(() => {
    PhoneClient.ping()
      .then((p) => setPing({ https_urls: p.https_urls, cert_fingerprint: p.cert_fingerprint }))
      .catch(() => {});
    void readPushState().then(setPush);
  }, []);

  // An alert tapped on the phone opens that chat.
  useEffect(() => {
    const { chat } = readHash();
    if (chat) {
      history.replaceState(null, "", location.pathname);
      window.setTimeout(() => openChat(chat), 300);
    }
    const onHash = () => {
      const h = readHash();
      if (h.chat) {
        history.replaceState(null, "", location.pathname);
        openChat(h.chat);
      }
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [openChat]);

  // Back on screen: reconnect and catch up.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      client.wake();
      const a = activeRef.current;
      if (a && client.state === "open") {
        void loadMessages(a);
        markRead(a);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onVisible);
    };
  }, [client, loadMessages, markRead]);

  // "typing…" fades by itself.
  useEffect(() => {
    if (Object.keys(typing).length === 0) return;
    const t = window.setInterval(() => {
      const now = Date.now();
      setTyping((cur) => {
        const next = Object.fromEntries(Object.entries(cur).filter(([, v]) => v.until > now));
        return Object.keys(next).length === Object.keys(cur).length ? cur : next;
      });
    }, 1000);
    return () => window.clearInterval(t);
  }, [typing]);

  useEffect(() => {
    if (!problem) return;
    const t = window.setTimeout(() => setProblem(""), 8000);
    return () => window.clearTimeout(t);
  }, [problem]);
  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(""), 5000);
    return () => window.clearTimeout(t);
  }, [notice]);

  // Pages load what they show when they open.
  useEffect(() => {
    if (conn !== "open") return;
    if (tab === "files" && !active && !view.page) loadTransfers();
    if (view.page === "cards") loadCards();
    if (view.page === "emergency") loadAlerts();
    if (view.page === "group-info" && view.gid) loadGroup(view.gid);
    if (tab === "more" && !active && !view.page) {
      loadCards();
      loadAlerts();
    }
  }, [tab, active, conn, view.page, view.gid, loadTransfers, loadCards, loadAlerts, loadGroup]);

  const unread = conversations.reduce((n, c) => n + (c.id === active ? 0 : c.unread_count), 0);
  useEffect(() => {
    document.title = unread ? `(${unread}) LANX` : "LANX";
  }, [unread]);

  const sendText = useCallback(
    async (conv: string, text: string, replyTo: string | null, mentions: string[]) => {
      try {
        const r = await client.send(conv, text, replyTo, mentions);
        setMessages((all) => ({ ...all, [conv]: upsertMessage(all[conv] ?? [], r.message) }));
      } catch (e) {
        fail(e);
      }
    },
    [client, fail]
  );

  const sendFiles = useCallback(
    (conv: string, files: FileList | File[]) => {
      for (const file of Array.from(files)) {
        const id = Date.now() + Math.random();
        setUploads((u) => [...u, { id, name: file.name || "photo", pct: 0 }]);
        client
          .upload(conv, file, (pct) => setUploads((u) => u.map((x) => (x.id === id ? { ...x, pct } : x))))
          .then((m) => setMessages((all) => ({ ...all, [conv]: upsertMessage(all[conv] ?? [], m) })))
          .catch(fail)
          .finally(() => setUploads((u) => u.filter((x) => x.id !== id)));
      }
    },
    [client, fail]
  );

  const sendRecording = useCallback(
    async (conv: string, rec: Recording, intercom: boolean) => {
      const m = await (intercom ? client.intercom(conv, rec.blob, rec.ms, rec.ext) : client.voice(conv, rec.blob, rec.ms, rec.ext));
      setMessages((all) => ({ ...all, [conv]: upsertMessage(all[conv] ?? [], m) }));
      if (intercom) setNotice("Sent — it plays on their PC now.");
    },
    [client]
  );

  const openPeer = useCallback(
    (peerId: string) => {
      const existing = conversations.find((c) => c.peer_id === peerId);
      if (existing) {
        openChat(existing.id);
        return;
      }
      client
        .openChat(peerId)
        .then((r) => {
          upsertConv(r.conversation);
          openChat(r.conversation.id);
        })
        .catch(fail);
    },
    [client, conversations, openChat, upsertConv, fail]
  );

  const runHits = useCallback(
    (page: "search" | "starred", q?: string, filter?: { conv?: string; kind?: string }, replace = false) => {
      const kind = filter?.kind ?? "all";
      const v: View = { page, q, kind, chat: filter?.conv, inChat: !!filter?.conv };
      if (replace) {
        setView(v);
        history.replaceState({ ph: v }, "");
      } else go(v);
      setHits([]);
      setHitsLoading(true);
      (page === "starred" ? client.starred() : kind !== "all" || filter?.conv ? client.searchEx(q ?? "", { kind, conversation_id: filter?.conv }) : client.search(q ?? ""))
        .then((r) => setHits(r.hits))
        .catch(fail)
        .finally(() => setHitsLoading(false));
    },
    [client, go, fail]
  );

  // 3.4: a chat's own options (pin, mute, archive…): the PC changes, the list follows.
  const chatAct = useCallback(
    (run: () => Promise<{ conversation: Conversation }>, done?: string) =>
      run()
        .then((r) => {
          upsertConv(r.conversation);
          if (done) setNotice(done);
        })
        .catch(fail),
    [upsertConv, fail]
  );

  const startMeeting = useCallback(
    (conv: Conversation) => {
      if (!canMeet()) {
        setNotice("Meetings on the phone need the secure connection — More → Secure connection & alerts.");
        return;
      }
      void meetings.start(conv, true);
    },
    [meetings]
  );

  const transferAction = useCallback(
    (what: "accept" | "cancel" | "retry", id: string) => {
      (what === "accept" ? client.accept(id) : what === "cancel" ? client.cancel(id) : client.retry(id))
        .then((r) => setTransfers((list) => (list.some((t) => t.id === r.transfer.id) ? list.map((t) => (t.id === r.transfer.id ? r.transfer : t)) : [r.transfer, ...list])))
        .catch(fail);
    },
    [client, fail]
  );

  const sendCardTo = useCallback(
    async (peerId: string, card: Record<string, unknown>) => {
      const c = await api.getOrCreateConversation(peerId);
      upsertConv(c);
      const m = (await api.sendCard(c.id, card)) as PhoneMessage;
      changed(m);
    },
    [upsertConv, changed]
  );

  /** 3.3: a card (a song…) into a chat by its id. */
  const sendCardHere = useCallback(
    async (convId: string, card: Record<string, unknown>) => {
      const m = (await api.sendCard(convId, card)) as PhoneMessage;
      changed(m);
    },
    [changed]
  );

  const answerAlert = useCallback(
    async (id: string, status: "safe" | "help") => {
      try {
        const r = await client.request<{ alert: AlertInfo }>("alert_answer", { alert_id: id, status });
        setAlerts((list) => list.map((a) => (a.id === id ? r.alert : a)));
        setAlertBanner((cur) => (cur && cur.id === id ? null : cur));
      } catch (e) {
        fail(e);
      }
    },
    [client, fail]
  );

  const nameOf = useCallback((id: string) => (id === me?.id ? "You" : (peers.find((p) => p.id === id)?.display_name ?? "Someone")), [me, peers]);
  const chatName = useCallback((id: string) => conversations.find((c) => c.id === id)?.peer_name ?? "a chat", [conversations]);
  const forMe = me ? cards.filter((h) => needsMe(h.message, me.id)).length : 0;
  const alertsLive = alerts.filter((a) => !a.cleared_at && Date.now() / 1000 - a.at < 6 * 3600).length;

  const activeConv = active ? conversations.find((c) => c.id === active) ?? null : null;

  let screen: ReactNode;
  if (view.page === "group-new") {
    screen = (
      <GroupCreateScreen
        peers={peers}
        profiles={profiles}
        onBack={back}
        onCreate={(name, ids) =>
          client
            .groupCreate(name, ids)
            .then((r) => {
              upsertConv(r.conversation);
              history.back();
              window.setTimeout(() => openChat(r.conversation.id), 50);
            })
            .catch(fail)
        }
      />
    );
  } else if (view.page === "group-info" && view.gid) {
    const g = groups[view.gid];
    screen = g ? (
      <GroupInfoScreen
        group={g}
        me={me}
        peers={peers}
        profiles={profiles}
        onBack={back}
        onRename={(name) =>
          client
            .groupUpdate(g.id, name, [], [])
            .then((r) => {
              setGroups((all) => ({ ...all, [g.id]: r.group }));
              setConversations((list) => list.map((c) => (c.id === g.id ? { ...c, peer_name: r.group.name } : c)));
            })
            .catch(fail)
        }
        onAdd={(ids) =>
          client
            .groupUpdate(g.id, null, ids, [])
            .then((r) => setGroups((all) => ({ ...all, [g.id]: r.group })))
            .catch(fail)
        }
        onRemove={(id) =>
          client
            .groupUpdate(g.id, null, [], [id])
            .then((r) => setGroups((all) => ({ ...all, [g.id]: r.group })))
            .catch(fail)
        }
        onLeave={() =>
          client
            .groupLeave(g.id)
            .then(() => {
              setNotice("You left the group.");
              void load();
              setView({});
              history.pushState({ ph: {} }, "");
            })
            .catch(fail)
        }
      />
    ) : (
      <div className="ph-scroll flex items-center justify-center text-[13px] text-slate-400">Loading…</div>
    );
  } else if (view.page === "search" || view.page === "starred") {
    const inChat = view.inChat && view.chat ? conversations.find((c) => c.id === view.chat) ?? null : null;
    const kindTitle = view.kind === "files" ? "Shared files" : view.kind === "links" ? "Shared links" : view.kind === "cards" ? "Cards" : null;
    screen = (
      <HitsScreen
        title={view.page === "starred" ? "Starred messages" : inChat ? `${kindTitle ?? "Search"} · ${inChat.peer_name}` : `Results for “${view.q ?? ""}”`}
        hits={hits}
        loading={hitsLoading}
        onBack={back}
        onOpen={(conv, id) => openChat(conv, id)}
        kind={view.kind}
        onKind={view.page === "search" ? (k) => runHits("search", view.q ?? "", { conv: inChat?.id, kind: k }, true) : undefined}
        query={inChat ? view.q ?? "" : undefined}
        onQuery={inChat ? (q) => runHits("search", q, { conv: inChat.id, kind: view.kind }, true) : undefined}
      />
    );
  } else if (view.page === "appearance" && settings) {
    screen = <AppearanceScreen settings={settings} onBack={back} onChange={changeSettings} onError={(t) => setProblem(t)} />;
  } else if (view.page === "settings" && settings) {
    screen = (
      <SettingsScreen
        settings={settings}
        client={client}
        version={version}
        device={device}
        peers={peers}
        updateVersion={updateVersion}
        onBack={back}
        onChange={changeSettings}
        onOpen={(key) => {
          if (key === "appearance") go({ page: "appearance" });
          else if (key === "folders") setSheet("folders-edit");
          else setSheet(key);
        }}
        onLockPc={() =>
          client
            .lockPc()
            .then((r) => {
              setLockInfo(r.status);
              setLocked(true);
            })
            .catch(fail)
        }
        onError={(t) => setProblem(t)}
        onNotice={(t) => setNotice(t)}
      />
    );
  } else if (view.page === "tools") {
    screen = (
      <ToolsScreen
        onBack={back}
        onOpen={(key: ToolKey) => {
          if (key === "calc") setCalcOpen(true);
          else if (key === "pdf") setPdfPath(null);
          else go({ page: key });
        }}
      />
    );
  } else if (view.page === "directory" && settings) {
    screen = <DirectoryScreen settings={settings} peers={peers} profiles={profiles} onBack={back} onChat={(id) => (id === "me" ? undefined : openPeer(id))} />;
  } else if (view.page === "sync") {
    screen = <SyncScreen client={client} onBack={back} onError={(t) => setProblem(t)} onNotice={(t) => setNotice(t)} />;
  } else if (view.page === "apps" && settings) {
    screen = <AppsScreen client={client} settings={settings} onBack={back} onSave={(apps) => changeSettings({ apps })} onError={(t) => setProblem(t)} />;
  } else if (view.page === "cards" && me) {
    screen = <CardsScreen me={me} hits={cards} loading={cardsLoading} nameOf={nameOf} chatName={chatName} onBack={back} onChanged={changed} onError={(t) => setProblem(t)} onNew={() => setPickCardChat(true)} />;
  } else if (view.page === "notes") {
    screen = <NotesScreen client={client} onBack={back} onError={(t) => setProblem(t)} />;
  } else if (view.page === "calendar") {
    screen = <CalendarScreen client={client} onBack={back} onError={(t) => setProblem(t)} version={calendarVersion} />;
  } else if (view.page === "emergency") {
    screen = (
      <EmergencyScreen
        alerts={alerts}
        onBack={back}
        onRaise={async (kind, text) => {
          try {
            const r = await client.request<{ alert: AlertInfo }>("alert_raise", { kind, text });
            setAlerts((list) => [r.alert, ...list.filter((a) => a.id !== r.alert.id)]);
            setNotice("Alert sent to everyone online.");
          } catch (e) {
            fail(e);
          }
        }}
        onAnswer={answerAlert}
        onClear={async (id) => {
          try {
            const r = await client.request<{ alert: AlertInfo }>("alert_clear", { alert_id: id });
            setAlerts((list) => list.map((a) => (a.id === id ? r.alert : a)));
          } catch (e) {
            fail(e);
          }
        }}
      />
    );
  } else if (view.page === "music") {
    const target = view.chat ? conversations.find((c) => c.id === view.chat) ?? null : null;
    screen = (
      <MusicScreen
        chatName={target?.peer_name ?? null}
        onBack={back}
        onError={(t) => setNotice(t)}
        onSendCard={async (card) => {
          if (target) {
            await sendCardHere(target.id, card);
            setNotice(`Song sent to ${target.peer_name}.`);
          } else setPendingSend({ kind: "song", card });
        }}
      />
    );
  } else if (view.page === "memes") {
    const target = view.chat ? conversations.find((c) => c.id === view.chat) ?? null : null;
    screen = (
      <MemesScreen
        chatName={target?.peer_name ?? null}
        onBack={back}
        onError={(t) => setProblem(t)}
        onSend={async (file) => {
          if (target) {
            const r = await client.memeSend(target.id, file);
            changed(r.message);
            setNotice(`Sent to ${target.peer_name}.`);
          } else setPendingSend({ kind: "meme", file });
        }}
      />
    );
  } else if (view.page === "games" && me) {
    screen = <GamesScreen me={me} peers={peers} openMatchId={view.gid ?? null} onBack={back} onError={(t) => setProblem(t)} />;
  } else if (active && activeConv) {
    screen = (
      <ChatView
        conv={activeConv}
        me={me}
        peers={peers}
        profiles={profiles}
        messages={messages[active] ?? []}
        more={!!more[active]}
        typing={typing[active]?.name ?? null}
        uploads={uploads}
        progress={progress}
        client={client}
        stickers={stickers}
        quickReplies={quickReplies}
        group={activeConv.kind === "group" ? groups[active] ?? null : null}
        scheduledVersion={scheduledVersion}
        jumpTo={view.jump}
        onBack={back}
        onOlder={() => {
          const first = messages[active]?.[0];
          if (first) void loadMessages(active, first.timestamp);
        }}
        onSend={(text, replyTo, mentions) => sendText(active, text, replyTo, mentions)}
        onFiles={(files) => sendFiles(active, files)}
        onTyping={() => client.typing(active)}
        onInfo={() => {
          if (activeConv.kind === "group") go({ chat: active, page: "group-info", gid: active });
          else {
            const p = peers.find((x) => x.id === activeConv.peer_id);
            if (p) setPerson(p);
          }
        }}
        onForward={(m) => setForwardFrom(m)}
        onChanged={changed}
        onRemoved={(id) => setMessages((all) => ({ ...all, [active]: (all[active] ?? []).filter((m) => m.id !== id) }))}
        onNotice={setNotice}
        onProblem={fail}
        onAccept={(id) => transferAction("accept", id)}
        onCreateCard={() => setCreateCardFor(active)}
        onMenu={() => setSheet("chat-menu")}
        onMemes={() => go({ chat: active, page: "memes" })}
        onMusic={() => go({ chat: active, page: "music" })}
        onCall={(video) => {
          if (!canCall()) {
            setNotice("Calls on the phone need the secure connection — More → Secure connection & alerts.");
            return;
          }
          void calls.start(activeConv, video);
        }}
        onMeeting={() => startMeeting(activeConv)}
        onMakeTask={(m) => {
          setCreateCardInit({ kind: "task", title: m.content.slice(0, 200), fromMessage: m.id });
          setCreateCardFor(active);
        }}
        onSaveNote={(m) =>
          client
            .request("note_save", { note: { id: "", title: "", body: m.content.replace(/^↪️?\s*/u, ""), kind: "note", color: "default", pinned: false, audio: [], created_at: 0, updated_at: 0, deleted_at: null } })
            .then(() => setNotice("Saved to Notes (More → Notes)."))
            .catch(fail)
        }
        onFolder={(files) => {
          const id = Date.now() + Math.random();
          const root = (files[0] as File & { webkitRelativePath?: string }).webkitRelativePath?.split("/")[0] || "Folder";
          setUploads((u) => [...u, { id, name: `📁 ${root}`, pct: 0 }]);
          client
            .sendFolder(active, files, (done, total) => setUploads((u) => u.map((x) => (x.id === id ? { ...x, pct: Math.round((done / total) * 100) } : x))))
            .then((m) => setMessages((all) => ({ ...all, [active]: upsertMessage(all[active] ?? [], m) })))
            .catch(fail)
            .finally(() => setUploads((u) => u.filter((x) => x.id !== id)));
        }}
        onRejoinMeeting={(id) => {
          if (!canMeet()) {
            setNotice("Meetings on the phone need the secure connection — More → Secure connection & alerts.");
            return;
          }
          void meetings.rejoin(id);
        }}
        secure={secure}
        onVoice={(rec) => sendRecording(active, rec, false)}
        onIntercom={(rec) => sendRecording(active, rec, true)}
      />
    );
  } else if (tab === "people") {
    screen = (
      <PeopleScreen
        me={me}
        peers={peers}
        profiles={profiles}
        onOpen={openPeer}
        onInfo={(id) => setPerson(peers.find((p) => p.id === id) ?? null)}
        onConnect={() => setSheet("connect")}
        onInvite={() => setSheet("invite")}
        onDirectory={() => go({ page: "directory" })}
      />
    );
  } else if (tab === "files") {
    screen = (
      <FilesScreen
        transfers={transfers}
        progress={progress}
        conversations={conversations}
        client={client}
        onAccept={(id) => transferAction("accept", id)}
        onCancel={(id) => transferAction("cancel", id)}
        onRetry={(id) => transferAction("retry", id)}
        onPdf={(t) => setPdfPath(transferPath(t.id, t.file_name))}
        onShowInChat={(t) => t.conversation_id && openChat(t.conversation_id)}
      />
    );
  } else if (tab === "more") {
    screen = (
      <MoreScreen
        forMe={forMe}
        alertsLive={alertsLive}
        secure={secure}
        onOpen={(key: MoreKey) => {
          if (key === "cards" || key === "notes" || key === "calendar" || key === "emergency" || key === "games" || key === "music" || key === "memes" || key === "appearance" || key === "settings" || key === "tools") go({ page: key });
          else setSheet(key);
        }}
      />
    );
  } else {
    screen = (
      <ChatsScreen
        me={me}
        conversations={conversations}
        profiles={profiles}
        query={query}
        onQuery={setQuery}
        onOpen={(id) => openChat(id)}
        onAbout={() => setSheet("status")}
        onNewGroup={() => go({ page: "group-new" })}
        onSearchMessages={(q) => runHits("search", q)}
        onStarred={() => runHits("starred")}
        lock={lockInfo}
        onBroadcast={() => setSheet("broadcast")}
        folders={settings?.chat_folders ?? []}
        folder={folder}
        onFolder={setFolder}
        onHiddenChats={() => {
          if (lockInfo?.hidden_unlocked)
            client
              .hideHidden()
              .then((r) => {
                setLockInfo(r.status);
                setConversations(sortConvs(r.conversations));
              })
              .catch(fail);
          else setSheet("hidden");
        }}
      />
    );
  }

  const cardConv = createCardFor ? conversations.find((c) => c.id === createCardFor) ?? null : null;
  const cardPeople = cardConv
    ? cardConv.kind === "group"
      ? (groups[cardConv.id]?.members ?? []).filter((m) => !m.is_me).map((m) => ({ id: m.device_id, name: m.display_name, color: peers.find((p) => p.id === m.device_id)?.avatar_color ?? "#64748b" }))
      : [{ id: cardConv.peer_id, name: cardConv.peer_name, color: cardConv.peer_avatar_color }]
    : [];

  const showTabs = !active && !view.page;
  const screenName = view.page ?? (active ? "chat" : tab);
  return (
    <div className="ph-root lanx-window" data-ph-screen={screenName} data-ph-conn={conn} data-ph-secure={secure ? "1" : "0"}>
      {/* 3.4: the PC's live wallpaper, behind everything. */}
      <WallpaperLayer reduceMotion={!!settings?.reduce_motion} fileSrc={wallpaperSrc} />
      {conn !== "open" && (
        <div className="shrink-0 bg-amber-500/15 px-4 py-1.5 text-center text-[11.5px] font-medium text-amber-700 dark:text-amber-200" data-ph-conn-bar>
          {conn === "connecting" || conn === "idle" ? "Connecting to your PC…" : "Can't reach your PC — trying again…"}
        </div>
      )}
      {screen}
      {showTabs && (
        <nav className="ph-safe-bottom shrink-0 border-t lanx-line lanx-bar">
          <div className="flex">
            {(
              [
                ["chats", "Chats", MessageCircle],
                ["people", "Who's in", Users],
                ["files", "Files", FolderOpen],
                ["more", "More", LayoutGrid],
              ] as const
            ).map(([key, label, Icon]) => (
              <button key={key} type="button" role="tab" aria-selected={tab === key} data-ph-tab={key} onClick={() => setTab(key)} className="ph-tab relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[10.5px] font-semibold">
                <Icon className="h-5 w-5" />
                {label}
                {key === "chats" && unread > 0 && (
                  <span className="absolute left-1/2 top-1 ml-2 min-w-[16px] rounded-full bg-sky-500 px-1 text-center text-[9.5px] font-bold text-white" data-ph-unread>
                    {unread}
                  </span>
                )}
                {key === "more" && alertsLive > 0 && <span className="absolute left-1/2 top-1 ml-2 h-2.5 w-2.5 rounded-full bg-rose-500" />}
              </button>
            ))}
          </div>
        </nav>
      )}
      {alertBanner && <AlertBanner alert={alertBanner} onAnswer={answerAlert} onOpen={() => go({ page: "emergency" })} />}
      <CallScreen manager={calls} profiles={profiles} />
      <MeetingScreen manager={meetings} peers={peers} profiles={profiles} />
      {/* 3.3: the song playing stays here while you move around. */}
      {view.page !== "music" && <MusicPlayer onOpenMusic={() => go({ page: "music" })} />}
      {forwardFrom && (
        <ForwardPicker
          conversations={conversations}
          profiles={profiles}
          onClose={() => setForwardFrom(null)}
          onPick={(ids) => {
            const m = forwardFrom;
            setForwardFrom(null);
            client
              .forward([m.id], ids)
              .then((r) => setNotice(r.problems.length ? r.problems.join(" ") : `Forwarded to ${r.sent} chat${r.sent === 1 ? "" : "s"}.`))
              .catch(fail);
          }}
        />
      )}
      {pickCardChat && (
        <ForwardPicker
          conversations={conversations}
          profiles={profiles}
          title="A card in which chat?"
          single
          onClose={() => setPickCardChat(false)}
          onPick={(ids) => {
            setPickCardChat(false);
            if (ids[0]) {
              const c = conversations.find((x) => x.id === ids[0]);
              if (c?.kind === "group") loadGroup(c.id);
              setCreateCardFor(ids[0]);
            }
          }}
        />
      )}
      {cardConv && (
        <CreateCardModal
          initialKind={createCardInit?.kind ?? "notice"}
          initialTitle={createCardInit?.title ?? ""}
          fromMessage={createCardInit?.fromMessage ?? null}
          people={cardPeople}
          profiles={profiles}
          chatName={cardConv.peer_name}
          onClose={() => {
            setCreateCardFor(null);
            setCreateCardInit(null);
          }}
          onCreate={async (card) => {
            try {
              const m = (await api.sendCard(cardConv.id, card)) as PhoneMessage;
              changed(m);
              setCreateCardFor(null);
              setCreateCardInit(null);
              if (view.page === "cards") loadCards();
              return true;
            } catch (e) {
              fail(e);
              return false;
            }
          }}
        />
      )}
      {sheet === "status" && settings && (
        <StatusSheet
          settings={settings}
          onClose={() => setSheet(null)}
          onSaveStatus={async (status, text, until) => {
            try {
              await client.request("status_set", { status, status_text: text, status_until: until });
              loadSettings();
              setNotice("Status saved.");
            } catch (e) {
              fail(e);
            }
          }}
          onSaveOoo={async (enabled, until, message) => {
            try {
              await client.request("ooo_set", { enabled, until, message });
              loadSettings();
              setNotice(enabled ? "Out of office is on." : "Out of office is off.");
            } catch (e) {
              fail(e);
            }
          }}
        />
      )}
      {sheet === "profile" && settings && me && (
        <ProfileSheet
          me={me}
          settings={settings}
          onClose={() => setSheet(null)}
          onSave={async (p) => {
            try {
              await client.request("profile_save", { profile: p });
              loadSettings();
              void load();
              setNotice("Profile saved.");
            } catch (e) {
              fail(e);
            }
          }}
        />
      )}
      {sheet === "kudos" && (
        <KudosSheet
          peers={peers}
          profiles={profiles}
          onClose={() => setSheet(null)}
          onSend={async (peer, badge, note) => {
            try {
              await sendCardTo(peer.id, { kind: "kudos", to: peer.id, to_name: peer.display_name, badge, note });
              setNotice(`Kudos sent to ${peer.display_name}.`);
            } catch (e) {
              fail(e);
            }
          }}
        />
      )}
      {sheet === "report" && (
        <ReportSheet
          peers={peers}
          profiles={profiles}
          lastTo={reportTo}
          onClose={() => setSheet(null)}
          onSend={async (to, done, pending, blockers) => {
            try {
              client.reportToSet(to.map((p) => p.id)).catch(() => {});
              const day = new Date();
              day.setHours(0, 0, 0, 0);
              const card = { kind: "report", to: to.map((p) => p.id), done, pending, blockers, day: Math.floor(day.getTime() / 1000) };
              for (const p of to) await sendCardTo(p.id, card);
              setNotice(`Report sent to ${to.map((p) => p.display_name).join(", ")}.`);
            } catch (e) {
              fail(e);
            }
          }}
        />
      )}
      {sheet === "secure" && (
        <SecureSheet
          secure={secure}
          httpsUrls={ping.https_urls}
          fingerprint={ping.cert_fingerprint}
          token={token}
          push={push}
          onClose={() => setSheet(null)}
          onEnablePush={() => {
            setPush("busy");
            enablePush(token)
              .then(setPush)
              .catch((e) => {
                setPush("off");
                fail(e);
              });
          }}
        />
      )}
      {sheet === "about" && me && (
        <AboutSheet
          me={me}
          device={device}
          version={version}
          lock={lockInfo}
          onLockPc={() => {
            setSheet(null);
            client
              .lockPc()
              .then((r) => {
                setLockInfo(r.status);
                setLocked(true);
              })
              .catch(fail);
          }}
          onClose={() => setSheet(null)}
          onForget={() => {
            client.close();
            onForget();
          }}
        />
      )}
      {person && (
        <PersonSheet
          peer={person}
          profile={profiles[person.id] ?? null}
          onClose={() => setPerson(null)}
          onChat={() => {
            const id = person.id;
            setPerson(null);
            openPeer(id);
          }}
          onTrust={(trust) => {
            const p = person;
            setPerson(null);
            client
              .peerTrust(p.id, trust)
              .then((r) => {
                setPeers(r.peers);
                setProfiles(r.profiles);
                setNotice(trust === "blocked" ? `${p.display_name} is blocked.` : trust === "trusted" ? `${p.display_name} is trusted.` : p.trust_state === "blocked" ? `${p.display_name} is unblocked.` : `${p.display_name} is no longer marked as trusted.`);
              })
              .catch(fail);
          }}
        />
      )}
      {sheet === "hidden" && (
        <PinSheet
          title="Hidden chats"
          onClose={() => setSheet(null)}
          onPin={async (pin) => {
            try {
              const r = await client.unlockHidden(pin);
              setLockInfo(r.status);
              setConversations(sortConvs(r.conversations));
              return null;
            } catch (e) {
              return e instanceof Error ? e.message : String(e);
            }
          }}
        />
      )}
      {sheet === "chat-menu" && activeConv && (
        <ChatMenuSheet
          conv={activeConv}
          lock={lockInfo}
          onClose={() => setSheet(null)}
          onRing={() => {
            setSheet(null);
            client
              .ring(activeConv.id)
              .then(() => setNotice(`🔔 Ringing ${activeConv.peer_name}…`))
              .catch(fail);
          }}
          onSecret={(ttl) => {
            setSheet(null);
            client
              .secret(activeConv.id, ttl)
              .then((r) => {
                if (r.conversation) upsertConv(r.conversation);
                changed(r.message);
              })
              .catch(fail);
          }}
          more={{
            muted: isMuted(activeConv),
            onPin: () => {
              setSheet(null);
              void chatAct(() => client.chatPin(activeConv.id, !activeConv.is_pinned), activeConv.is_pinned ? "Unpinned." : "Pinned to the top of Chats.");
            },
            onMute: () => setSheet("mute"),
            onUnmute: () => {
              setSheet(null);
              void chatAct(() => client.chatMute(activeConv.id, 0), "Sounds are back on.");
            },
            onUnread: () => {
              setSheet(null);
              void chatAct(() => client.chatUnread(activeConv.id));
              back();
            },
            onFolders: () => setSheet("folders"),
            onArchive: () => {
              setSheet(null);
              const was = !!activeConv.archived;
              void chatAct(() => client.chatArchive(activeConv.id, !was), was ? "Back in Chats." : "Archived — it's under Archived in Chats.");
              if (!was) back();
            },
            onSearchIn: () => {
              setSheet(null);
              runHits("search", "", { conv: activeConv.id, kind: "all" });
            },
            onShared: (kind) => {
              setSheet(null);
              runHits("search", "", { conv: activeConv.id, kind });
            },
            onDelete: () => setSheet("delete-chat"),
            onMeeting:
              activeConv.kind === "group"
                ? () => {
                    setSheet(null);
                    startMeeting(activeConv);
                  }
                : undefined,
            onSeeScreen:
              activeConv.kind === "direct"
                ? () => {
                    setSheet(null);
                    if (!canCall()) {
                      setNotice("Remote help on the phone needs the secure connection — More → Secure connection & alerts.");
                      return;
                    }
                    void calls.start(activeConv, false, "view");
                  }
                : undefined,
            onWhatsApp: (() => {
              const ph = activeConv.kind === "direct" ? profiles[activeConv.peer_id]?.phone ?? "" : "";
              const digits = /^\+?[\d\s().-]{10,}$/.test(ph) ? ph.replace(/\D/g, "") : "";
              return digits.length >= 10
                ? () => {
                    setSheet(null);
                    window.open(`https://wa.me/${digits}`, "_blank", "noopener");
                  }
                : undefined;
            })(),
          }}
          onHide={(hidden) => {
            setSheet(null);
            client
              .chatHide(activeConv.id, hidden)
              .then((r) => {
                setConversations(sortConvs(r.conversations));
                if (hidden) {
                  setNotice("The chat is hidden. Show hidden chats with your PIN (👁 in Chats).");
                  back();
                }
              })
              .catch(fail);
          }}
        />
      )}
      {sheet === "broadcast" && (
        <BroadcastSheet
          peers={peers}
          profiles={profiles}
          onClose={() => setSheet(null)}
          onSend={async (ids, text) => {
            try {
              const r = await client.broadcast(ids, text);
              setNotice(r.problems.length ? r.problems.join(" ") : `Sent to ${r.sent_to} ${r.sent_to === 1 ? "person" : "people"}.`);
              void load();
            } catch (e) {
              fail(e);
            }
          }}
        />
      )}
      {pendingSend && (
        <ForwardPicker
          conversations={conversations}
          profiles={profiles}
          title={pendingSend.kind === "meme" ? "Send the meme to…" : "Send the song to…"}
          single
          onClose={() => setPendingSend(null)}
          onPick={(ids) => {
            const p = pendingSend;
            setPendingSend(null);
            const conv = ids[0];
            if (!conv) return;
            const name = conversations.find((c) => c.id === conv)?.peer_name ?? "the chat";
            (p.kind === "meme" ? client.memeSend(conv, p.file).then((r) => changed(r.message)) : sendCardHere(conv, p.card))
              .then(() => setNotice(`Sent to ${name}.`))
              .catch(fail);
          }}
        />
      )}
      {sheet === "helpdesk" && me && (
        <HelpDeskModal
          conversations={conversations}
          peers={peers}
          myId={me.id}
          onClose={() => setSheet(null)}
          onSent={(ids) => {
            setSheet(null);
            setNotice(`Ticket sent to ${ids.length} ${ids.length === 1 ? "helper" : "helpers"}.`);
          }}
          onError={(t) => setProblem(t)}
        />
      )}
      {sheet === "office" && me && settings && (
        <OfficePanel
          settings={settings as UserSettings}
          myId={me.id}
          peers={peers}
          profiles={profiles}
          conversations={conversations}
          alerts={alerts}
          initialTab="reception"
          onClose={() => setSheet(null)}
          onSaveSettings={async (s) => {
            await api.saveSettings(s);
            loadSettings();
          }}
          onRaiseAlert={async (kind, text) => {
            try {
              const r = await client.request<{ alert: AlertInfo }>("alert_raise", { kind, text });
              setAlerts((list) => [r.alert, ...list.filter((a) => a.id !== r.alert.id)]);
              setSheet(null);
              setNotice("Alert sent to everyone online.");
            } catch (e) {
              fail(e);
            }
          }}
          onOpenChat={(conv, messageId) => {
            setSheet(null);
            openChat(conv, messageId);
          }}
          onSendWishes={(peerId) => {
            setSheet(null);
            client
              .openChat(peerId)
              .then(async (r) => {
                upsertConv(r.conversation);
                await client.sticker(r.conversation.id, "birthday");
                openChat(r.conversation.id);
              })
              .catch(fail);
          }}
          onError={(t) => setProblem(t)}
          onNotice={(t) => setNotice(t)}
          onCardSent={() => void load()}
        />
      )}
      {sheet === "mute" && activeConv && (
        <MuteSheet
          conv={activeConv}
          onClose={() => setSheet(null)}
          onMute={(minutes) => {
            setSheet(null);
            void chatAct(() => client.chatMute(activeConv.id, minutes), "Muted.");
          }}
        />
      )}
      {(sheet === "folders" || sheet === "folders-edit") && settings && (
        <FoldersSheet
          folders={settings.chat_folders ?? []}
          conv={sheet === "folders" ? activeConv : null}
          onClose={() => setSheet(null)}
          onSave={(list: ChatFolder[]) => changeSettings({ chat_folders: list })}
          onPick={(ids) => {
            if (!activeConv) return;
            // New folders are saved a moment after; the chat joins them then.
            window.setTimeout(() => void chatAct(() => client.chatFolders(activeConv.id, ids), "Chat folders saved."), 600);
          }}
        />
      )}
      {sheet === "delete-chat" && activeConv && (
        <ConfirmSheet
          title="Delete chat history?"
          text={`Every message with ${activeConv.peer_name} goes from your PC (and this phone). ${activeConv.peer_name.split(" ")[0]} keeps theirs. This can't be undone — your PC's backups still have it.`}
          yes="Delete"
          onClose={() => setSheet(null)}
          onYes={() => {
            setSheet(null);
            const id = activeConv.id;
            client
              .chatDelete(id)
              .then((r) => {
                setConversations(sortConvs(r.conversations));
                setMessages((all) => ({ ...all, [id]: [] }));
                setNotice("Chat history deleted.");
                back();
              })
              .catch(fail);
          }}
        />
      )}
      {sheet === "connect" && (
        <ConnectSheet
          onClose={() => setSheet(null)}
          onConnect={async (ip, port, name) => {
            try {
              const r = await client.peerAdd(ip, port, name);
              setNotice(`Connected to ${r.peer.display_name}.`);
              void load();
              return true;
            } catch (e) {
              fail(e);
              return false;
            }
          }}
        />
      )}
      {sheet === "invite" && <WhatsAppInviteModal onClose={() => setSheet(null)} onError={(t) => setProblem(t)} />}
      {calcOpen && <CalcPanel onClose={() => setCalcOpen(false)} onError={(t) => setProblem(t)} />}
      {pdfPath !== undefined && (
        <PdfStudio
          initialPath={pdfPath}
          onClose={() => setPdfPath(undefined)}
          onError={(t) => setNotice(t)}
          onSendFile={(path) => setSendFilePath(path)}
        />
      )}
      {sendFilePath && (
        <ForwardPicker
          conversations={conversations}
          profiles={profiles}
          title="Send the file to…"
          single
          onClose={() => setSendFilePath(null)}
          onPick={(ids) => {
            const path = sendFilePath;
            setSendFilePath(null);
            const blob = keptFile(path);
            if (!ids[0] || !blob) return;
            const name = path.split("/").pop() ?? "file.pdf";
            sendFiles(ids[0], [new File([blob], name, { type: blob.type || "application/pdf" })]);
            setNotice(`Sending ${name}…`);
          }}
        />
      )}
      {locked && (
        <LockedScreen
          onUnlock={async (pin) => {
            try {
              const r = await client.unlock(pin);
              setLockInfo(r.status);
              setLocked(false);
              void load();
              return null;
            } catch (e) {
              return e instanceof Error ? e.message : String(e);
            }
          }}
        />
      )}
      {(problem || notice) && (
        <div
          className={`pointer-events-none fixed inset-x-4 bottom-20 z-[75] rounded-2xl px-4 py-2.5 text-center text-[12.5px] shadow-lg ${
            problem ? "border border-amber-300/60 bg-amber-50/95 text-amber-900 dark:bg-amber-900/80 dark:text-amber-100" : "bg-slate-900/90 text-white dark:bg-white/90 dark:text-slate-900"
          }`}
          data-ph-problem={problem ? "1" : undefined}
          data-ph-notice={notice ? "1" : undefined}
        >
          {problem || notice}
        </div>
      )}
    </div>
  );
}
