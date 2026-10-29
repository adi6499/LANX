/** LANX 3.x: the phone page — connect with the code from the PC, then chats,
 *  one chat, Who's in and Files, all through that PC (src/phone/client.ts). */
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FolderOpen, Lock, MessageCircle, Smartphone, Users } from "lucide-react";
import type { Conversation, GroupInfo, Peer, Profile } from "../types";
import { type ConnState, type Hit, type Me, PhoneClient, type PhoneMessage, type PhoneTransfer, type Progress, type Push, type StickerInfo, TOKEN_KEY, pair, pollPair, session, storage } from "./client";
import { ChatView, type Upload } from "./ChatView";
import { AboutSheet, ChatsScreen, FilesScreen, ForwardPicker, GroupCreateScreen, GroupInfoScreen, HitsScreen, PeopleScreen } from "./screens";

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
  page?: "group-new" | "group-info" | "search" | "starred";
  q?: string;
  gid?: string;
  jump?: string;
}

type Tab = "chats" | "people" | "files";

function Main({ token, onForget }: { token: string; onForget: () => void }) {
  const client = useMemo(() => new PhoneClient(token), [token]);
  const [conn, setConn] = useState<ConnState>("idle");
  const [me, setMe] = useState<Me | null>(null);
  const [device, setDevice] = useState("");
  const [version, setVersion] = useState("");
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
  const [view, setView] = useState<View>({});
  const [tab, setTab] = useState<Tab>("chats");
  const [query, setQuery] = useState("");
  const [locked, setLocked] = useState(false);
  const [about, setAbout] = useState(false);
  const [forwardFrom, setForwardFrom] = useState<PhoneMessage | null>(null);
  const [problem, setProblem] = useState("");
  const [notice, setNotice] = useState("");
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [scheduledVersion, setScheduledVersion] = useState(0);
  const activeRef = useRef<string | null>(null);
  const active = view.chat ?? null;
  activeRef.current = active;
  // The latest list, for callbacks made before a chat was added (a new group).
  const conversationsRef = useRef<Conversation[]>([]);
  conversationsRef.current = conversations;

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
      setLocked(false);
    } catch (e) {
      fail(e);
    }
  }, [client, fail]);

  const loadTransfers = useCallback(() => {
    client
      .transfers()
      .then((r) => setTransfers(r.transfers))
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
      setAbout(false);
      setForwardFrom(null);
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
  }, [client, load, loadMessages, markRead, upsertConv, onForget, changed]);

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

  // The Files tab loads on first sight (and when it is shown again).
  useEffect(() => {
    if (tab === "files" && !active && conn === "open") loadTransfers();
  }, [tab, active, conn, loadTransfers]);

  // A group page needs its members.
  useEffect(() => {
    if (view.page === "group-info" && view.gid) loadGroup(view.gid);
  }, [view.page, view.gid, loadGroup]);

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
    (page: "search" | "starred", q?: string) => {
      go({ page, q });
      setHits([]);
      setHitsLoading(true);
      (page === "search" ? client.search(q ?? "") : client.starred())
        .then((r) => setHits(r.hits))
        .catch(fail)
        .finally(() => setHitsLoading(false));
    },
    [client, go, fail]
  );

  const transferAction = useCallback(
    (what: "accept" | "cancel" | "retry", id: string) => {
      (what === "accept" ? client.accept(id) : what === "cancel" ? client.cancel(id) : client.retry(id))
        .then((r) => setTransfers((list) => (list.some((t) => t.id === r.transfer.id) ? list.map((t) => (t.id === r.transfer.id ? r.transfer : t)) : [r.transfer, ...list])))
        .catch(fail);
    },
    [client, fail]
  );

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
    screen = <HitsScreen title={view.page === "starred" ? "Starred messages" : `Results for “${view.q ?? ""}”`} hits={hits} loading={hitsLoading} onBack={back} onOpen={(conv, id) => openChat(conv, id)} />;
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
        }}
        onForward={(m) => setForwardFrom(m)}
        onChanged={changed}
        onRemoved={(id) => setMessages((all) => ({ ...all, [active]: (all[active] ?? []).filter((m) => m.id !== id) }))}
        onNotice={setNotice}
        onProblem={fail}
        onAccept={(id) => transferAction("accept", id)}
      />
    );
  } else if (tab === "people") {
    screen = <PeopleScreen me={me} peers={peers} profiles={profiles} onOpen={openPeer} />;
  } else if (tab === "files") {
    screen = <FilesScreen transfers={transfers} progress={progress} conversations={conversations} client={client} onAccept={(id) => transferAction("accept", id)} onCancel={(id) => transferAction("cancel", id)} onRetry={(id) => transferAction("retry", id)} />;
  } else {
    screen = (
      <ChatsScreen
        me={me}
        conversations={conversations}
        profiles={profiles}
        query={query}
        onQuery={setQuery}
        onOpen={(id) => openChat(id)}
        onAbout={() => setAbout(true)}
        onNewGroup={() => go({ page: "group-new" })}
        onSearchMessages={(q) => runHits("search", q)}
        onStarred={() => runHits("starred")}
      />
    );
  }

  const showTabs = !active && !view.page;
  const screenName = view.page ?? (active ? "chat" : tab);
  return (
    <div className="ph-root lanx-window" data-ph-screen={screenName} data-ph-conn={conn}>
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
              </button>
            ))}
          </div>
        </nav>
      )}
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
