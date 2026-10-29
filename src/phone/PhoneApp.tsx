/** LANX 3.0: the phone page — connect with the code from the PC, then chats,
 *  one chat, and "Who's in", all through that PC (src/phone/client.ts). */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowUp,
  Check,
  CheckCheck,
  Clock,
  Download,
  FileText,
  Image as ImageIcon,
  Lock,
  MessageCircle,
  Paperclip,
  Smartphone,
  Users,
  X,
} from "lucide-react";
import type { Conversation, Peer, Profile } from "../types";
import { Avatar } from "../components/Avatar";
import { MessageText } from "../components/chat/chatUtils";
import { formatSize } from "../lib/format";
import { effective, statusLine, statusPreset } from "../lib/profile";
import { type ConnState, type Me, PhoneClient, type PhoneMessage, type Push, TOKEN_KEY, pair, pollPair, session, storage } from "./client";

// ------------------------------------------------------------------ helpers

const timeOf = (ts: number) => new Date(ts * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

function dayLabel(ts: number): string {
  const d = new Date(ts * 1000);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
}

function whenShort(ts: number): string {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  if (d.toDateString() === new Date().toDateString()) return timeOf(ts);
  return d.toLocaleDateString([], { day: "numeric", month: "short" });
}

const sortConvs = (list: Conversation[]) =>
  [...list].sort((a, b) => Number(b.is_pinned) - Number(a.is_pinned) || b.last_message_time - a.last_message_time);

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

const fileName = (m: PhoneMessage) => m.content.replace(/^(📎|📁|🎤)\s*/u, "");

const isVideoName = (name: string) => /\.(mp4|m4v|mov|webm)$/i.test(name);

function labelOf(m: PhoneMessage): string {
  switch (m.message_type) {
    case "sticker":
      return "Sticker";
    case "card":
      return "📋 Card — open LANX on the PC to see it";
    case "call":
      return "📞 Call";
    case "meeting":
      return "📅 Meeting";
    case "recording":
      return "🎥 Recording";
    case "ring":
      return "🔔 Ring";
    default:
      return m.content;
  }
}

/** The "Who's in" rule, the same as the PC's. */
function whereabouts(p: Profile | null, online: boolean): { group: "in" | "wfh" | "away" | "off"; label: string; emoji: string; color: string } {
  const st = effective(p)?.status ?? "";
  if (st === "leave") return { group: "away", label: "On leave", emoji: "🌴", color: "#14b8a6" };
  if (st === "road") return { group: "away", label: "On the road", emoji: "🚗", color: "#64748b" };
  if (st === "wfh") return { group: "wfh", label: "Working from home", emoji: "🏠", color: "#0ea5e9" };
  if (!online) return { group: "off", label: "Offline", emoji: "⚪", color: "#94a3b8" };
  const preset = statusPreset(st);
  return { group: "in", label: preset?.label ?? "In the office", emoji: preset?.emoji ?? "🟢", color: preset?.color ?? "#22c55e" };
}

const coarsePointer = () => window.matchMedia("(pointer: coarse)").matches;

// --------------------------------------------------------------------- root

export default function PhoneApp() {
  const [token, setToken] = useState<string | null>(() => storage.get(TOKEN_KEY));
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

  // Scanned: the code is in the link, so connect straight away.
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
            <button
              type="submit"
              data-ph-connect
              disabled={digits.length !== 8 || busy}
              className="mt-3 w-full rounded-2xl bg-sky-500 py-3 text-[15px] font-semibold text-white disabled:opacity-50"
            >
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
        <p className="mt-6 max-w-sm text-center text-[11.5px] leading-relaxed text-slate-400">
          Works on the office Wi-Fi while LANX is running on your PC. Nothing goes through the internet.
        </p>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------- main

interface Upload {
  id: number;
  name: string;
  pct: number;
}

function Main({ token, onForget }: { token: string; onForget: () => void }) {
  const client = useMemo(() => new PhoneClient(token), [token]);
  const [conn, setConn] = useState<ConnState>("idle");
  const [me, setMe] = useState<Me | null>(null);
  const [device, setDevice] = useState("");
  const [version, setVersion] = useState("");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [messages, setMessages] = useState<Record<string, PhoneMessage[]>>({});
  const [more, setMore] = useState<Record<string, boolean>>({});
  const [typing, setTyping] = useState<Record<string, { name: string; until: number }>>({});
  const [active, setActive] = useState<string | null>(null);
  const [tab, setTab] = useState<"chats" | "people">("chats");
  const [locked, setLocked] = useState(false);
  const [about, setAbout] = useState(false);
  const [problem, setProblem] = useState("");
  const [uploads, setUploads] = useState<Upload[]>([]);
  const activeRef = useRef<string | null>(null);
  activeRef.current = active;

  const upsertConv = useCallback((c: Conversation) => {
    setConversations((list) => sortConvs(list.some((x) => x.id === c.id) ? list.map((x) => (x.id === c.id ? c : x)) : [...list, c]));
  }, []);

  const fail = useCallback((e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "LOCKED") setLocked(true);
    else if (msg !== "offline") setProblem(msg);
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
      setLocked(false);
    } catch (e) {
      fail(e);
    }
  }, [client, fail]);

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

  const openChat = useCallback(
    (conv: string) => {
      setActive(conv);
      setTab("chats");
      if (!history.state?.chat) history.pushState({ chat: conv }, "");
      else history.replaceState({ chat: conv }, "");
      void loadMessages(conv);
      markRead(conv);
    },
    [loadMessages, markRead]
  );

  const goBack = useCallback(() => {
    if (history.state?.chat) history.back();
    else setActive(null);
  }, []);

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
          break;
        case "deleted": {
          const gone = new Set(p.message_ids);
          setMessages((all) => {
            const next: Record<string, PhoneMessage[]> = {};
            for (const [k, list] of Object.entries(all)) next[k] = list.filter((m) => !gone.has(m.id));
            return next;
          });
          break;
        }
        case "peer":
          setPeers((list) => (list.some((x) => x.id === p.peer.id) ? list.map((x) => (x.id === p.peer.id ? p.peer : x)) : [...list, p.peer]));
          setConversations((list) =>
            list.map((c) => (c.peer_id === p.peer.id ? { ...c, peer_status: p.peer.status, peer_name: p.peer.display_name, peer_avatar_color: p.peer.avatar_color } : c))
          );
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
        case "reload":
          void load();
          break;
        case "lock":
          setLocked(p.locked);
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
  }, [client, load, loadMessages, markRead, upsertConv, onForget]);

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

  // The phone's back button closes the chat.
  useEffect(() => {
    const onPop = () => {
      setActive(history.state?.chat ?? null);
      setAbout(false);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

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

  const unread = conversations.reduce((n, c) => n + (c.id === active ? 0 : c.unread_count), 0);
  useEffect(() => {
    document.title = unread ? `(${unread}) LANX` : "LANX";
  }, [unread]);

  const sendText = useCallback(
    async (conv: string, text: string) => {
      try {
        const r = await client.send(conv, text);
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

  const activeConv = active ? conversations.find((c) => c.id === active) ?? null : null;

  return (
    <div className="ph-root lanx-window" data-ph-screen={active ? "chat" : tab} data-ph-conn={conn}>
      {conn !== "open" && (
        <div className="shrink-0 bg-amber-500/15 px-4 py-1.5 text-center text-[11.5px] font-medium text-amber-700 dark:text-amber-200" data-ph-conn-bar>
          {conn === "connecting" || conn === "idle" ? "Connecting to your PC…" : "Can't reach your PC — trying again…"}
        </div>
      )}
      {active && activeConv ? (
        <ChatView
          conv={activeConv}
          me={me}
          peers={peers}
          profiles={profiles}
          messages={messages[active] ?? []}
          more={!!more[active]}
          typing={typing[active]?.name ?? null}
          uploads={uploads}
          client={client}
          onBack={goBack}
          onOlder={() => {
            const first = messages[active]?.[0];
            if (first) void loadMessages(active, first.timestamp);
          }}
          onSend={(text) => sendText(active, text)}
          onFiles={(files) => sendFiles(active, files)}
          onTyping={() => client.typing(active)}
        />
      ) : tab === "chats" ? (
        <ChatsScreen me={me} conversations={conversations} profiles={profiles} onOpen={openChat} onAbout={() => setAbout(true)} />
      ) : (
        <PeopleScreen me={me} peers={peers} profiles={profiles} onOpen={openPeer} />
      )}
      {!active && (
        <nav className="ph-safe-bottom shrink-0 border-t lanx-line lanx-bar">
          <div className="flex">
            {(
              [
                ["chats", "Chats", MessageCircle],
                ["people", "Who's in", Users],
              ] as const
            ).map(([key, label, Icon]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                data-ph-tab={key}
                onClick={() => setTab(key)}
                className="ph-tab relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[10.5px] font-semibold"
              >
                <Icon className="h-5 w-5" />
                {label}
                {key === "chats" && unread > 0 && (
                  <span className="absolute left-1/2 top-1 ml-2 min-w-[16px] rounded-full bg-sky-500 px-1 text-center text-[9.5px] font-bold text-white" data-ph-unread>
                    {unread}
                  </span>
                )}
              </button>
            ))}
          </div>
        </nav>
      )}
      {locked && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-6 backdrop-blur-sm" data-ph-locked>
          <div className="w-full max-w-xs rounded-[22px] lanx-sheet p-5 text-center">
            <Lock className="mx-auto h-7 w-7 text-slate-500" />
            <div className="mt-2 text-[15px] font-bold text-slate-900 dark:text-white">LANX is locked on your PC</div>
            <p className="mt-1 text-[12.5px] text-slate-500 dark:text-slate-400">Unlock it there (your PIN) and this page carries on.</p>
          </div>
        </div>
      )}
      {about && me && (
        <AboutSheet
          me={me}
          device={device}
          version={version}
          onClose={() => setAbout(false)}
          onForget={() => {
            client.close();
            onForget();
          }}
        />
      )}
      {problem && (
        <div className="pointer-events-none fixed inset-x-4 bottom-20 z-[70] rounded-2xl border border-amber-300/60 bg-amber-50/95 px-4 py-2.5 text-center text-[12.5px] text-amber-900 shadow-lg dark:bg-amber-900/80 dark:text-amber-100" data-ph-problem>
          {problem}
        </div>
      )}
    </div>
  );
}

// -------------------------------------------------------------------- chats

function ChatsScreen({
  me,
  conversations,
  profiles,
  onOpen,
  onAbout,
}: {
  me: Me | null;
  conversations: Conversation[];
  profiles: Record<string, Profile>;
  onOpen: (id: string) => void;
  onAbout: () => void;
}) {
  const list = conversations.filter((c) => !c.archived);
  return (
    <>
      <header className="flex shrink-0 items-center gap-3 px-4 py-3 lanx-bar border-b lanx-line">
        <button type="button" data-ph-about onClick={onAbout} className="shrink-0 rounded-full">
          {me ? <Avatar name={me.name} color={me.color} profile={me.profile} size={34} /> : <span className="block h-[34px] w-[34px] rounded-full bg-slate-300" />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="text-[18px] font-bold tracking-[-0.02em] text-slate-900 dark:text-white">Chats</div>
          <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">{me ? `${me.name} · through your PC` : "…"}</div>
        </div>
      </header>
      <div className="ph-scroll px-2 py-2">
        {list.length === 0 && <div className="px-4 py-10 text-center text-[13px] text-slate-400">No chats yet. Find a colleague under “Who's in”.</div>}
        {list.map((c) => {
          const group = c.kind === "group";
          const online = c.peer_status === "online";
          return (
            <button
              key={c.id}
              type="button"
              data-ph-chat={c.id}
              onClick={() => onOpen(c.id)}
              className="flex w-full items-center gap-3 rounded-[14px] px-2.5 py-2 text-left active:bg-[var(--lanx-fill)]"
            >
              <span className="relative shrink-0">
                <Avatar name={c.peer_name} color={c.peer_avatar_color} profile={group ? null : profiles[c.peer_id]} size={46} square={group} />
                {!group && (
                  <span className={`absolute bottom-0 right-0 h-3 w-3 rounded-full ring-2 ring-white dark:ring-[#1c1e24] ${online ? "bg-emerald-500" : "bg-slate-400 dark:bg-slate-600"}`} />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[14.5px] font-semibold text-slate-900 dark:text-white">{c.peer_name}</span>
                  <span className="shrink-0 text-[10.5px] text-slate-400">{whenShort(c.last_message_time)}</span>
                </span>
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-[12.5px] text-slate-500 dark:text-slate-400">{c.last_message_preview || (group ? `${c.member_count} members` : "Say hello")}</span>
                  {c.unread_count > 0 && (
                    <span className="min-w-[18px] shrink-0 rounded-full bg-sky-500 px-1.5 py-[2px] text-center text-[10px] font-bold text-white" data-ph-chat-unread>
                      {c.unread_count}
                    </span>
                  )}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

// ------------------------------------------------------------------- people

function PeopleScreen({ me, peers, profiles, onOpen }: { me: Me | null; peers: Peer[]; profiles: Record<string, Profile>; onOpen: (peerId: string) => void }) {
  const rows = [
    ...(me ? [{ id: me.id, name: `${me.name} (you)`, color: me.color, online: true, profile: me.profile, mine: true }] : []),
    ...peers.filter((p) => p.trust_state !== "blocked").map((p) => ({ id: p.id, name: p.display_name, color: p.avatar_color, online: p.status === "online", profile: profiles[p.id] ?? null, mine: false })),
  ].map((r) => ({ ...r, w: whereabouts(r.profile, r.online) }));
  const groups = [
    { key: "in", title: "In the office", of: rows.filter((r) => r.w.group === "in") },
    { key: "wfh", title: "Working from home", of: rows.filter((r) => r.w.group === "wfh") },
    { key: "away", title: "Away", of: rows.filter((r) => r.w.group === "away") },
    { key: "off", title: "Offline", of: rows.filter((r) => r.w.group === "off") },
  ];
  const working = rows.filter((r) => r.w.group === "in" || r.w.group === "wfh").length;
  return (
    <>
      <header className="shrink-0 px-4 py-3 lanx-bar border-b lanx-line">
        <div className="text-[18px] font-bold tracking-[-0.02em] text-slate-900 dark:text-white">Who's in</div>
        <div className="text-[11px] text-slate-500 dark:text-slate-400">
          <b>{working}</b> of {rows.length} working right now · {new Date().toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}
        </div>
      </header>
      <div className="ph-scroll px-3 py-3 space-y-4" data-ph-people>
        {groups.map((g) =>
          g.of.length === 0 ? null : (
            <div key={g.key} data-ph-people-group={g.key}>
              <div className="mb-1 px-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                {g.title} · {g.of.length}
              </div>
              <div className="space-y-0.5">
                {g.of.map((r) => {
                  const line = statusLine(r.profile, { until: true });
                  return (
                    <button
                      key={r.id}
                      type="button"
                      data-ph-person={r.name}
                      disabled={r.mine}
                      onClick={() => onOpen(r.id)}
                      className="flex w-full items-center gap-3 rounded-[14px] px-2 py-2 text-left active:bg-[var(--lanx-fill)]"
                    >
                      <Avatar name={r.name} color={r.color} profile={r.profile} size={40} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-semibold text-slate-900 dark:text-white">{r.name}</span>
                        <span className="block truncate text-[11.5px]" style={{ color: r.w.color }}>
                          {r.w.emoji} {line ? line.text : r.w.label}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )
        )}
      </div>
    </>
  );
}

// --------------------------------------------------------------------- chat

function ChatView({
  conv,
  me,
  peers,
  profiles,
  messages,
  more,
  typing,
  uploads,
  client,
  onBack,
  onOlder,
  onSend,
  onFiles,
  onTyping,
}: {
  conv: Conversation;
  me: Me | null;
  peers: Peer[];
  profiles: Record<string, Profile>;
  messages: PhoneMessage[];
  more: boolean;
  typing: string | null;
  uploads: Upload[];
  client: PhoneClient;
  onBack: () => void;
  onOlder: () => void;
  onSend: (text: string) => Promise<void>;
  onFiles: (files: FileList) => void;
  onTyping: () => void;
}) {
  const [text, setText] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);
  const boxRef = useRef<HTMLTextAreaElement | null>(null);
  const stick = useRef(true);
  const lastTyping = useRef(0);
  const group = conv.kind === "group";
  const names = useMemo(() => peers.map((p) => p.display_name), [peers]);
  const nameOf = (id: string) => peers.find((p) => p.id === id)?.display_name ?? "Someone";

  // Stay at the bottom while reading the latest; keep the place when loading older ones.
  const count = messages.length;
  const lastId = messages[count - 1]?.id;
  useEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [count, lastId, typing, uploads.length]);

  const submit = async () => {
    const t = text.trim();
    if (!t) return;
    setText("");
    if (boxRef.current) boxRef.current.style.height = "auto";
    stick.current = true;
    await onSend(t);
  };

  const subtitle = typing
    ? `${group ? typing + " is " : ""}typing…`
    : group
      ? `${conv.member_count} members`
      : conv.peer_status === "online"
        ? statusLine(profiles[conv.peer_id], { until: true })?.text ?? "Online"
        : "Offline";

  let lastDay = "";
  return (
    <>
      <header className="flex shrink-0 items-center gap-2 px-2 py-2 lanx-bar border-b lanx-line">
        <button type="button" data-ph-back onClick={onBack} className="lanx-tool p-2 text-sky-600 dark:text-sky-400" aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <Avatar name={conv.peer_name} color={conv.peer_avatar_color} profile={group ? null : profiles[conv.peer_id]} size={36} square={group} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold text-slate-900 dark:text-white" data-ph-chat-title>
            {conv.peer_name}
          </div>
          <div className={`truncate text-[11px] ${typing ? "text-sky-600 dark:text-sky-400" : "text-slate-500 dark:text-slate-400"}`} data-ph-chat-subtitle>
            {subtitle}
          </div>
        </div>
      </header>
      <div
        ref={listRef}
        className="ph-scroll px-3 py-3 space-y-1.5"
        data-ph-messages
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        {more && (
          <div className="flex justify-center pb-2">
            <button
              type="button"
              data-ph-older
              onClick={() => {
                stick.current = false;
                onOlder();
              }}
              className="rounded-full lanx-group px-3 py-1 text-[11.5px] font-semibold text-slate-600 dark:text-slate-300"
            >
              Earlier messages
            </button>
          </div>
        )}
        {messages.map((m) => {
          const day = dayLabel(m.timestamp);
          const sep = day !== lastDay;
          lastDay = day;
          return (
            <div key={m.id}>
              {sep && (
                <div className="flex justify-center py-2">
                  <span className="rounded-full lanx-chip px-2.5 py-0.5 text-[10px] font-semibold">{day}</span>
                </div>
              )}
              <Bubble m={m} group={group} myName={me?.name ?? ""} names={names} senderName={nameOf(m.sender_id)} client={client} />
            </div>
          );
        })}
        {uploads.map((u) => (
          <div key={u.id} className="flex justify-end" data-ph-upload>
            <div className="max-w-[82%] rounded-[18px] rounded-br-[6px] bg-sky-500/80 px-3.5 py-2 text-[13px] text-white">
              <div className="truncate font-medium">{u.name}</div>
              <div className="mt-1.5 h-1.5 w-40 overflow-hidden rounded-full bg-white/30">
                <div className="h-full rounded-full bg-white transition-all" style={{ width: `${u.pct}%` }} />
              </div>
              <div className="mt-0.5 text-[10px] text-white/80">{u.pct < 100 ? `Sending to your PC · ${u.pct}%` : "Your PC is sending it…"}</div>
            </div>
          </div>
        ))}
        {typing && (
          <div className="flex items-start">
            <div className="rounded-[18px] rounded-bl-[6px] lanx-bubble-in px-4 py-3">
              <span className="lanx-typing lanx-typing-lg">
                <i />
                <i />
                <i />
              </span>
            </div>
          </div>
        )}
      </div>
      <div className="ph-safe-bottom shrink-0 px-2 pt-1.5 pb-1.5 lanx-bar border-t lanx-line">
        <div className="flex items-end gap-1">
          <label className="lanx-tool p-2 text-slate-500 dark:text-slate-400" aria-label="Photo or video">
            <ImageIcon className="h-5 w-5" />
            <input
              type="file"
              accept="image/*,video/*"
              multiple
              data-ph-photo
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) onFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
          <label className="lanx-tool p-2 text-slate-500 dark:text-slate-400" aria-label="File">
            <Paperclip className="h-5 w-5" />
            <input
              type="file"
              multiple
              data-ph-attach
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) onFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
          <div className="flex min-w-0 flex-1 items-end rounded-[20px] bg-[color-mix(in_srgb,var(--lanx-surface)_70%,transparent)] py-1 pl-4 pr-1 shadow-[inset_0_0_0_1px_var(--lanx-line)]">
            <textarea
              ref={boxRef}
              data-ph-compose
              rows={1}
              value={text}
              placeholder="Message"
              enterKeyHint={coarsePointer() ? "enter" : "send"}
              onChange={(e) => {
                setText(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
                const now = Date.now();
                if (now - lastTyping.current > 2000) {
                  lastTyping.current = now;
                  onTyping();
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !coarsePointer()) {
                  e.preventDefault();
                  void submit();
                }
              }}
              className="max-h-[120px] min-h-[24px] w-full resize-none bg-transparent py-1.5 text-[16px] leading-snug text-slate-900 placeholder:text-slate-400 focus:outline-none dark:text-white ph-select"
            />
            <button
              type="button"
              data-ph-send
              disabled={!text.trim()}
              onClick={() => void submit()}
              className="mb-0.5 ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sky-500 text-white disabled:opacity-40"
              aria-label="Send"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function StatusIcon({ m }: { m: PhoneMessage }) {
  if (m.deliveries) {
    if (m.deliveries.read > 0) return <CheckCheck className="h-3 w-3 text-emerald-200" />;
    if (m.deliveries.delivered > 0) return <CheckCheck className="h-3 w-3" />;
    return <Clock className="h-3 w-3" />;
  }
  switch (m.status) {
    case "read":
      return <CheckCheck className="h-3 w-3 text-emerald-200" />;
    case "delivered":
      return <CheckCheck className="h-3 w-3" />;
    case "failed":
      return <span className="font-semibold text-amber-200">Not sent</span>;
    case "queued":
      return (
        <span className="flex items-center gap-0.5">
          <Clock className="h-3 w-3" /> Queued
        </span>
      );
    default:
      return <Check className="h-3 w-3 opacity-70" />;
  }
}

function FileBody({ m, isOut, client }: { m: PhoneMessage; isOut: boolean; client: PhoneClient }) {
  const t = m.transfer;
  const name = fileName(m);
  if (t?.ready && t.is_image) {
    return (
      <a href={client.fileUrl(t.id)} target="_blank" rel="noreferrer" data-ph-image>
        <img src={client.fileUrl(t.id)} alt={name} loading="lazy" className="ph-bubble-img rounded-xl bg-black/5" />
      </a>
    );
  }
  if (t?.ready && t.kind === "voice") {
    return <audio controls preload="none" src={client.fileUrl(t.id)} className="max-w-[230px]" />;
  }
  if (t?.ready && isVideoName(t.file_name)) {
    return <video controls playsInline preload="metadata" src={client.fileUrl(t.id)} className="ph-bubble-img rounded-xl bg-black" />;
  }
  const pct = t && t.file_size > 0 ? Math.round((t.transferred_bytes / t.file_size) * 100) : 0;
  const state = !t
    ? ""
    : t.ready
      ? ""
      : t.direction === "incoming"
        ? t.status === "pending"
          ? "Waiting for your PC to accept it"
          : t.status === "transferring"
            ? `Downloading on your PC · ${pct}%`
            : t.status === "failed"
              ? "Download failed on the PC"
              : t.status
        : t.status === "queued"
          ? "Waiting to send"
          : t.status;
  return (
    <div className="flex min-w-[170px] items-center gap-2.5">
      <FileText className="h-5 w-5 shrink-0 opacity-80" />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{name}</div>
        <div className={`text-[11px] ${isOut ? "text-white/75" : "text-slate-500 dark:text-slate-400"}`}>
          {t ? formatSize(t.file_size) : ""}
          {state ? ` · ${state}` : ""}
        </div>
      </div>
      {t?.ready && (
        <a href={client.fileUrl(t.id)} download={t.file_name} className={`shrink-0 rounded-full p-1.5 ${isOut ? "bg-white/20" : "bg-[var(--lanx-fill)]"}`} aria-label="Download" data-ph-download>
          <Download className="h-4 w-4" />
        </a>
      )}
    </div>
  );
}

function Bubble({ m, group, myName, names, senderName, client }: { m: PhoneMessage; group: boolean; myName: string; names: string[]; senderName: string; client: PhoneClient }) {
  const isOut = m.is_outgoing;
  if (m.message_type === "system" || m.message_type === "secret_setting") {
    return (
      <div className="flex justify-center py-1" data-ph-msg={m.id}>
        <span className="max-w-[90%] rounded-full lanx-chip px-2.5 py-0.5 text-center text-[10.5px] font-semibold">{m.content}</span>
      </div>
    );
  }
  const body = m.deleted ? (
    <i className="opacity-70">This message was deleted</i>
  ) : m.message_type === "file" ? (
    <FileBody m={m} isOut={isOut} client={client} />
  ) : m.message_type === "text" ? (
    <MessageText text={m.content} names={names} myName={myName} onAccent={isOut} />
  ) : (
    <span>{labelOf(m)}</span>
  );
  return (
    <div data-ph-msg={m.id} data-ph-out={isOut ? "1" : "0"} className={`flex flex-col ${isOut ? "items-end" : "items-start"}`}>
      {group && !isOut && <span className="mb-0.5 ml-3 text-[11px] font-semibold text-slate-500 dark:text-slate-400">{senderName}</span>}
      <div
        className={`relative max-w-[82%] rounded-[18px] px-3.5 py-2 text-[14px] ${
          isOut ? "bg-sky-500 text-white rounded-br-[6px] shadow-sm shadow-sky-500/20" : "lanx-bubble-in text-slate-900 dark:text-slate-100 rounded-bl-[6px]"
        }`}
      >
        {m.reply_preview && <div className={`mb-1 rounded-lg px-2 py-1 text-[11.5px] ${isOut ? "bg-white/15" : "bg-black/5 dark:bg-white/10"}`}>{m.reply_preview}</div>}
        <div className="whitespace-pre-wrap break-words leading-relaxed ph-select">{body}</div>
        <div className={`mt-0.5 flex items-center justify-end gap-1 text-[10px] ${isOut ? "text-white/75" : "text-slate-400"}`}>
          {m.edited_at ? <span>edited ·</span> : null}
          <span>{timeOf(m.timestamp)}</span>
          {isOut && <StatusIcon m={m} />}
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------------------- about

function AboutSheet({ me, device, version, onClose, onForget }: { me: Me; device: string; version: string; onClose: () => void; onForget: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/30 backdrop-blur-sm lanx-fade" onMouseDown={onClose} data-ph-about-sheet>
      <div className="ph-safe-bottom w-full max-w-md rounded-t-[22px] lanx-sheet p-5 lanx-rise" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div className="text-[15px] font-bold text-slate-900 dark:text-white">This phone</div>
          <button type="button" onClick={onClose} className="lanx-tool p-1.5" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-3 space-y-2 rounded-xl lanx-group p-3 text-[12.5px] text-slate-700 dark:text-slate-200">
          <div>
            Connected to <b>{me.name}</b>'s LANX on <b>{me.hostname || "the PC"}</b>.
          </div>
          <div>
            Your PC calls this phone <b>{device || "your phone"}</b>. LANX {version}.
          </div>
        </div>
        <p className="mt-3 text-[11.5px] leading-relaxed text-slate-500 dark:text-slate-400">
          <b>Tip:</b> add this page to your Home Screen (Share → Add to Home Screen) to open it like an app. A Home Screen copy asks for the code once more; the PC asks “Allow?” again.
        </p>
        <p className="mt-2 text-[11.5px] leading-relaxed text-slate-500 dark:text-slate-400">
          New messages show while this page is open. When your PC is off, or you leave the office Wi-Fi, the page waits.
        </p>
        <button
          type="button"
          data-ph-forget
          onClick={onForget}
          className="mt-4 w-full rounded-full lanx-btn py-2.5 text-[12.5px] font-semibold text-rose-600 dark:text-rose-400"
        >
          Disconnect this phone
        </button>
        <p className="mt-2 text-center text-[10.5px] text-slate-400">To remove it from the PC too: Settings → Phone there.</p>
      </div>
    </div>
  );
}
