import { useEffect, useMemo, useRef, useState } from "react";
import { Building2, Cake, Check, MessageSquare, Palmtree, Siren, Trophy, UserRound, Users, X } from "lucide-react";
import type { AlertInfo, Conversation, Message, Peer, Profile, SearchHit, UserSettings } from "../../types";
import { api, errorText, events } from "../../lib/api";
import { ALERT_KINDS, KUDOS_BADGES, alertKind, birthdayInfo, kudosBadge, stillOn } from "../../lib/office";
import { effective, statusLine, statusPreset } from "../../lib/profile";

/** LANX 1.8.0: the Office — emergency alerts, reception (visitors), kudos,
 *  birthdays and out-of-office. */
export type OfficeTab = "emergency" | "reception" | "kudos" | "birthdays" | "away" | "today";

const TABS: { id: OfficeTab; label: string; icon: React.ElementType }[] = [
  { id: "today", label: "Who's in", icon: Users },
  { id: "emergency", label: "Emergency", icon: Siren },
  { id: "reception", label: "Reception", icon: UserRound },
  { id: "kudos", label: "Kudos", icon: Trophy },
  { id: "birthdays", label: "Birthdays", icon: Cake },
  { id: "away", label: "Out of office", icon: Palmtree },
];

interface VisitorCard {
  kind: "visitor";
  visitor: string;
  company: string;
  host: string;
  host_name: string;
  note: string;
}
interface KudosCard {
  kind: "kudos";
  to: string;
  to_name: string;
  badge: string;
  note: string;
}
const parse = <T,>(m: Message): T | null => {
  try {
    return JSON.parse(m.content) as T;
  } catch {
    return null;
  }
};
const entry = (m: Message, key: string) => m.card_state?.find((e) => e.key === key)?.value;
const REPLY: Record<string, string> = { coming: "Coming now", "5min": "In 5 minutes", "send-in": "Send them in", busy: "Not available" };

const field = "lanx-field w-full rounded-xl px-3 py-2 text-[12.5px] text-slate-900 dark:text-white";
const btn = "inline-flex items-center justify-center gap-1.5 rounded-full px-4 py-2 text-[12.5px] font-semibold transition-colors disabled:opacity-40";

export function OfficePanel({
  settings,
  myId,
  peers,
  profiles,
  conversations,
  alerts,
  initialTab = "emergency",
  onClose,
  onSaveSettings,
  onRaiseAlert,
  onOpenChat,
  onSendWishes,
  onError,
  onNotice,
  onCardSent,
}: {
  settings: UserSettings;
  myId: string;
  peers: Peer[];
  profiles: Record<string, Profile>;
  conversations: Conversation[];
  alerts: AlertInfo[];
  initialTab?: OfficeTab;
  onClose: () => void;
  onSaveSettings: (s: UserSettings) => Promise<void>;
  onRaiseAlert: (kind: string, text: string) => Promise<void>;
  onOpenChat: (conversationId: string, messageId?: string) => void;
  onSendWishes: (peerId: string) => void;
  onError: (text: string) => void;
  onNotice: (text: string) => void;
  /** A visitor or kudos card was posted (the chat list should show it). */
  onCardSent?: () => void;
}) {
  const [tab, setTab] = useState<OfficeTab>(initialTab);
  const [cards, setCards] = useState<SearchHit[]>([]);
  const loadCards = () =>
    api
      .listCards()
      .then(setCards)
      .catch(() => {});
  const posted = () => {
    void loadCards();
    onCardSent?.();
  };
  useEffect(() => {
    void loadCards();
    // Answers on visitor / kudos cards show up here live.
    let timer: number | undefined;
    const refresh = (m: Message) => {
      if (m.message_type !== "card") return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void loadCards(), 250);
    };
    const offs: Array<() => void> = [];
    let gone = false;
    const keep = (p: Promise<() => void>) => p.then((u) => (gone ? u() : offs.push(u))).catch(() => {});
    keep(events.onMessageStatusUpdated(({ message }) => refresh(message)));
    keep(events.onMessageReceived(({ message }) => refresh(message)));
    return () => {
      gone = true;
      window.clearTimeout(timer);
      offs.forEach((u) => u());
    };
  }, []);
  const nameOf = (id: string) => (id === myId ? settings.display_name : peers.find((p) => p.id === id)?.display_name ?? "Someone");
  const people = peers.filter((p) => p.trust_state !== "blocked");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 lanx-scrim" onMouseDown={onClose}>
      <div
        data-office
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-2xl h-[86vh] flex flex-col rounded-[24px] lanx-sheet !bg-[color-mix(in_srgb,var(--lanx-surface)_96%,transparent)] shadow-2xl lanx-rise"
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <h2 className="inline-flex items-center gap-2 text-[15px] font-semibold text-slate-900 dark:text-white">
            <Building2 className="h-4 w-4 text-orange-500" /> Office
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="h-8 w-8 rounded-full flex items-center justify-center text-slate-500 hover:bg-[var(--lanx-fill)]">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 pb-2 flex gap-1 overflow-x-auto lanx-noscroll">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              data-office-tab={t.id}
              onClick={() => setTab(t.id)}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors ${
                tab === t.id ? (t.id === "emergency" ? "bg-red-500 text-white" : "bg-sky-500 text-white") : "bg-slate-500/10 text-slate-600 dark:text-slate-300 hover:bg-slate-500/20"
              }`}
            >
              <t.icon className="h-3.5 w-3.5" /> {t.label}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {tab === "emergency" && <EmergencyTab alerts={alerts} onRaise={onRaiseAlert} onlineCount={peers.filter((p) => p.status === "online").length} />}
          {tab === "reception" && (
            <ReceptionTab
              settings={settings}
              myId={myId}
              people={people}
              cards={cards}
              onSaveSettings={onSaveSettings}
              onPosted={posted}
              onError={onError}
              onNotice={onNotice}
              onOpenChat={onOpenChat}
            />
          )}
          {tab === "kudos" && (
            <KudosTab myId={myId} people={people} conversations={conversations} cards={cards} nameOf={nameOf} onPosted={posted} onError={onError} onNotice={onNotice} />
          )}
          {tab === "birthdays" && <BirthdaysTab settings={settings} people={people} profiles={profiles} onSendWishes={onSendWishes} />}
          {tab === "away" && <AwayTab settings={settings} onSave={onSaveSettings} onNotice={onNotice} />}
          {tab === "today" && <TodayTab settings={settings} people={people} profiles={profiles} onOpenPeer={onSendWishes} />}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------- emergency

function EmergencyTab({ alerts, onRaise, onlineCount }: { alerts: AlertInfo[]; onRaise: (kind: string, text: string) => Promise<void>; onlineCount: number }) {
  const [kind, setKind] = useState<AlertInfo["kind"]>("fire");
  const [text, setText] = useState(ALERT_KINDS[0].text);
  const [hold, setHold] = useState(0);
  const timer = useRef<number | undefined>(undefined);
  const holdStart = useRef(0);
  const HOLD_MS = 1200;
  const begin = () => {
    holdStart.current = Date.now();
    window.clearInterval(timer.current);
    timer.current = window.setInterval(() => {
      const p = Math.min(1, (Date.now() - holdStart.current) / HOLD_MS);
      setHold(p);
      if (p >= 1) {
        window.clearInterval(timer.current);
        setHold(0);
        void onRaise(kind, text);
      }
    }, 30);
  };
  const cancel = () => {
    window.clearInterval(timer.current);
    setHold(0);
  };
  useEffect(() => () => window.clearInterval(timer.current), []);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-red-300/60 dark:border-red-900 bg-red-500/10 p-4">
        <div className="text-[13px] font-bold text-red-700 dark:text-red-300">Send an emergency alert to everyone</div>
        <p className="mt-0.5 text-[11.5px] text-red-800/80 dark:text-red-200/80">
          Every colleague whose LANX is on ({onlineCount} online now) gets a full-screen alert with an alarm — even in Do not disturb — and answers “I'm safe” or “I need help”.
          You see the answers live. Older LANX versions get it as a message.
        </p>
        <div className="mt-3 grid grid-cols-3 gap-1.5">
          {ALERT_KINDS.map((k) => (
            <button
              key={k.id}
              type="button"
              data-alert-kind={k.id}
              onClick={() => {
                setKind(k.id);
                setText(k.text);
              }}
              className={`flex items-center gap-2 rounded-xl px-3 py-2 text-left text-[12px] font-semibold transition-colors ${
                kind === k.id ? "bg-red-500 text-white" : "bg-white/70 dark:bg-white/5 text-slate-700 dark:text-slate-200 hover:bg-white"
              }`}
            >
              <span className="text-lg">{k.emoji}</span> {k.label}
            </button>
          ))}
        </div>
        <textarea data-alert-text value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={300} placeholder="What should everyone know or do?" className={`${field} mt-2 resize-none`} />
        <button
          type="button"
          data-alert-send
          onPointerDown={begin}
          onPointerUp={cancel}
          onPointerLeave={cancel}
          onKeyDown={(e) => (e.key === " " || e.key === "Enter") && !e.repeat && begin()}
          onKeyUp={cancel}
          className="relative mt-3 w-full overflow-hidden rounded-xl bg-red-600 px-4 py-3 text-[13.5px] font-bold text-white select-none"
        >
          <span className="absolute inset-y-0 left-0 bg-red-800" style={{ width: `${hold * 100}%` }} />
          <span className="relative">{hold > 0 ? "Keep holding…" : "Press and hold to send to everyone"}</span>
        </button>
      </div>

      <div>
        <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">Recent alerts</h3>
        {alerts.length === 0 && <p className="text-[12px] text-slate-400">No alerts in the last 30 days.</p>}
        <div className="space-y-2">
          {alerts.map((a) => {
            const k = alertKind(a.kind);
            return (
              <div key={a.id} data-alert-row={a.id} className="rounded-2xl lanx-card p-3">
                <div className="flex items-center gap-2 text-[12.5px]">
                  <span className="text-lg">{k.emoji}</span>
                  <span className="font-semibold text-slate-900 dark:text-white flex-1 min-w-0 truncate">{a.text}</span>
                  {stillOn(a) ? <span className="rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-bold text-white">Going on</span> : <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">All clear</span>}
                </div>
                <div className="mt-0.5 pl-8 text-[11px] text-slate-500 dark:text-slate-400">
                  {a.mine ? "You sent it" : `From ${a.from_name}`} · {new Date(a.at * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
                  {a.mine && ` · ${a.acks.length} of ${a.sent_to.length} answered`}
                  {!a.mine && a.my_ack && ` · you said ${a.my_ack === "help" ? "you need help" : "you're safe"}`}
                </div>
                {a.mine && a.acks.length > 0 && (
                  <div className="mt-1 pl-8 flex flex-wrap gap-1">
                    {a.acks.map((x) => (
                      <span key={x.peer_id} className={`rounded-full px-2 py-0.5 text-[10.5px] ${x.status === "help" ? "bg-red-500 text-white font-bold" : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"}`}>
                        {x.status === "help" ? "🆘" : "✅"} {x.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------- reception

function ReceptionTab({
  settings,
  myId,
  people,
  cards,
  onSaveSettings,
  onPosted,
  onError,
  onNotice,
  onOpenChat,
}: {
  settings: UserSettings;
  myId: string;
  people: Peer[];
  cards: SearchHit[];
  onSaveSettings: (s: UserSettings) => Promise<void>;
  onPosted: () => void;
  onError: (t: string) => void;
  onNotice: (t: string) => void;
  onOpenChat: (conversationId: string, messageId?: string) => void;
}) {
  const [visitor, setVisitor] = useState("");
  const [company, setCompany] = useState("");
  const [host, setHost] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const visits = cards
    .filter((h) => h.message.is_outgoing && h.message.timestamp * 1000 >= today.getTime() && parse<VisitorCard>(h.message)?.kind === "visitor")
    .sort((a, b) => b.message.timestamp - a.message.timestamp);
  const forMe = cards.filter((h) => !h.message.is_outgoing && parse<VisitorCard>(h.message)?.kind === "visitor" && parse<VisitorCard>(h.message)?.host === myId).slice(0, 10);

  const announce = async () => {
    const p = people.find((x) => x.id === host);
    if (!visitor.trim() || !p) return;
    setBusy(true);
    try {
      const conv = await api.getOrCreateConversation(p.id);
      await api.sendCard(conv.id, { kind: "visitor", visitor: visitor.trim(), company: company.trim(), host: p.id, host_name: p.display_name, note: note.trim() });
      onNotice(`${p.display_name} has been told that ${visitor.trim()} is here.`);
      setVisitor("");
      setCompany("");
      setNote("");
      onPosted();
    } catch (e) {
      onError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <label className="flex items-center gap-3 rounded-2xl lanx-group p-3 cursor-pointer">
        <input
          type="checkbox"
          data-reception-toggle
          checked={!!settings.reception_desk}
          onChange={(e) => onSaveSettings({ ...settings, reception_desk: e.target.checked })}
          className="h-4 w-4 accent-sky-500"
        />
        <span className="flex-1">
          <span className="block text-[12.5px] font-semibold text-slate-900 dark:text-white">This computer is the reception desk</span>
          <span className="block text-[11px] text-slate-500 dark:text-slate-400">Shows the 🛎️ button above the chat list for telling colleagues their visitor has arrived.</span>
        </span>
      </label>

      <div className="rounded-2xl lanx-card p-4 space-y-2">
        <div className="text-[13px] font-bold text-slate-900 dark:text-white">🛎️ A visitor has arrived</div>
        <div className="grid grid-cols-2 gap-2">
          <input data-visitor-name value={visitor} onChange={(e) => setVisitor(e.target.value)} placeholder="Visitor's name" maxLength={80} className={field} />
          <input data-visitor-company value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Company (optional)" maxLength={80} className={field} />
        </div>
        <select data-visitor-host value={host} onChange={(e) => setHost(e.target.value)} className={field}>
          <option value="">Here to see…</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.display_name}
              {p.status === "online" ? "" : " (offline)"}
            </option>
          ))}
        </select>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional), e.g. “has a delivery to sign”" maxLength={300} className={field} />
        <button type="button" data-visitor-send disabled={busy || !visitor.trim() || !host} onClick={announce} className={`${btn} w-full bg-sky-500 hover:bg-sky-600 text-white`}>
          Tell them
        </button>
      </div>

      {visits.length > 0 && (
        <div>
          <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">Visitors today</h3>
          <div className="space-y-1.5">
            {visits.map((h) => {
              const c = parse<VisitorCard>(h.message)!;
              const reply = entry(h.message, "reply") as { r: string; note?: string } | undefined;
              const status = (entry(h.message, "status") as string) || "waiting";
              return (
                <div key={h.message.id} data-visit={h.message.id} className="rounded-xl lanx-card px-3 py-2 flex items-center gap-2 text-[12px]">
                  <span className="font-semibold text-slate-900 dark:text-white">{c.visitor}</span>
                  {c.company && <span className="text-slate-400">({c.company})</span>}
                  <span className="text-slate-500">→ {c.host_name}</span>
                  <span className="text-slate-400">{new Date(h.message.timestamp * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  <span className={`ml-auto rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${reply ? (reply.r === "busy" ? "bg-red-500/10 text-red-600" : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300") : "bg-amber-500/15 text-amber-700"}`}>
                    {reply ? `${REPLY[reply.r] ?? reply.r}${reply.note ? ` — ${reply.note}` : ""}` : "No answer yet"}
                  </span>
                  {status === "waiting" ? (
                    <button type="button" onClick={() => api.cardAction(h.message.id, "status", "met").then(onPosted).catch((e) => onError(errorText(e)))} className="rounded-full bg-slate-500/10 px-2 py-0.5 font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-500/20">
                      Met
                    </button>
                  ) : (
                    <span className="text-[10.5px] text-slate-400">{status === "met" ? "✓ Met" : "Left"}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {forMe.length > 0 && (
        <div>
          <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">Your visitors</h3>
          {forMe.map((h) => {
            const c = parse<VisitorCard>(h.message)!;
            return (
              <button key={h.message.id} type="button" onClick={() => onOpenChat(h.message.conversation_id, h.message.id)} className="w-full text-left rounded-xl lanx-card px-3 py-2 text-[12px] mb-1.5 hover:bg-[var(--lanx-fill)]">
                🛎️ <b>{c.visitor}</b> {c.company && `(${c.company})`} · {new Date(h.message.timestamp * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- kudos

function KudosTab({
  myId,
  people,
  conversations,
  cards,
  nameOf,
  onPosted,
  onError,
  onNotice,
}: {
  myId: string;
  people: Peer[];
  conversations: Conversation[];
  cards: SearchHit[];
  nameOf: (id: string) => string;
  onPosted: () => void;
  onError: (t: string) => void;
  onNotice: (t: string) => void;
}) {
  const [to, setTo] = useState("");
  const [badge, setBadge] = useState("thanks");
  const [note, setNote] = useState("");
  const [where, setWhere] = useState("direct");
  const [busy, setBusy] = useState(false);
  const groups = conversations.filter((c) => c.kind === "group" && c.membership === "member");
  const kudos = useMemo(
    () => cards.filter((h) => parse<KudosCard>(h.message)?.kind === "kudos" && !h.message.deleted).sort((a, b) => b.message.timestamp - a.message.timestamp),
    [cards]
  );
  const month = new Date();
  month.setDate(1);
  month.setHours(0, 0, 0, 0);
  const board = useMemo(() => {
    const m: Record<string, { name: string; n: number }> = {};
    for (const h of kudos) {
      if (h.message.timestamp * 1000 < month.getTime()) continue;
      const c = parse<KudosCard>(h.message)!;
      m[c.to] = { name: c.to === myId ? "You" : c.to_name || nameOf(c.to), n: (m[c.to]?.n ?? 0) + 1 };
    }
    return Object.entries(m).sort((a, b) => b[1].n - a[1].n).slice(0, 8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kudos]);

  const give = async () => {
    const p = people.find((x) => x.id === to);
    if (!p) return;
    setBusy(true);
    try {
      const convId = where === "direct" ? (await api.getOrCreateConversation(p.id)).id : where;
      await api.sendCard(convId, { kind: "kudos", to: p.id, to_name: p.display_name, badge, note: note.trim() });
      onNotice(`Kudos sent to ${p.display_name} 🎉`);
      setNote("");
      onPosted();
    } catch (e) {
      onError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl lanx-card p-4 space-y-2">
        <div className="text-[13px] font-bold text-slate-900 dark:text-white">🏆 Give kudos</div>
        <select data-kudos-to value={to} onChange={(e) => setTo(e.target.value)} className={field}>
          <option value="">To…</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.display_name}
            </option>
          ))}
        </select>
        <div className="flex flex-wrap gap-1.5">
          {KUDOS_BADGES.map((b) => (
            <button
              key={b.id}
              type="button"
              data-kudos-badge={b.id}
              onClick={() => setBadge(b.id)}
              className={`rounded-full px-3 py-1 text-[12px] font-semibold ${badge === b.id ? "bg-amber-500 text-white" : "bg-slate-500/10 text-slate-600 dark:text-slate-300"}`}
            >
              {b.emoji} {b.label}
            </button>
          ))}
        </div>
        <input data-kudos-note value={note} onChange={(e) => setNote(e.target.value)} placeholder="For what? e.g. “sorting out the dispatch on Saturday”" maxLength={300} className={field} />
        <select value={where} onChange={(e) => setWhere(e.target.value)} className={field}>
          <option value="direct">Post it in your chat with them</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              Post it in the group “{g.peer_name}” (everyone sees it)
            </option>
          ))}
        </select>
        <button type="button" data-kudos-send disabled={busy || !to} onClick={give} className={`${btn} w-full bg-amber-500 hover:bg-amber-600 text-white`}>
          Give kudos
        </button>
      </div>

      {board.length > 0 && (
        <div>
          <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">Kudos this month</h3>
          <div className="space-y-1">
            {board.map(([id, b], i) => (
              <div key={id} className="flex items-center gap-2 text-[12.5px]">
                <span className="w-5 text-center">{["🥇", "🥈", "🥉"][i] ?? `${i + 1}.`}</span>
                <span className="flex-1 font-semibold text-slate-800 dark:text-slate-100">{b.name}</span>
                <span className="text-slate-500">{b.n} kudos</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div>
        <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">Recent kudos</h3>
        {kudos.length === 0 && <p className="text-[12px] text-slate-400">No kudos yet — be the first!</p>}
        <div className="space-y-1.5">
          {kudos.slice(0, 20).map((h) => {
            const c = parse<KudosCard>(h.message)!;
            const b = kudosBadge(c.badge);
            const from = h.message.is_outgoing ? "You" : nameOf(h.message.sender_id);
            const plus = (h.message.card_state ?? []).filter((e) => e.key.startsWith("plus:") && e.value === true).length;
            return (
              <div key={h.message.id} className="rounded-xl lanx-card px-3 py-2 text-[12px]">
                <span className="text-base">{b.emoji}</span> <b>{from}</b> → <b>{c.to === myId ? "you" : c.to_name}</b>: {b.label}
                {c.note && <span className="text-slate-500"> — {c.note}</span>}
                {plus > 0 && <span className="ml-1 text-amber-600">+{plus}</span>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ birthdays

function BirthdaysTab({ settings, people, profiles, onSendWishes }: { settings: UserSettings; people: Peer[]; profiles: Record<string, Profile>; onSendWishes: (peerId: string) => void }) {
  const list = people
    .map((p) => ({ p, b: birthdayInfo(profiles[p.id]?.birthday) }))
    .filter((x): x is { p: Peer; b: NonNullable<ReturnType<typeof birthdayInfo>> } => !!x.b && x.b.days <= 60)
    .sort((a, b) => a.b.days - b.b.days);
  const mine = birthdayInfo(settings.profile?.birthday);
  return (
    <div className="space-y-3">
      {!mine && (
        <div className="rounded-2xl bg-pink-500/10 px-4 py-3 text-[12px] text-pink-800 dark:text-pink-200">
          🎂 Add your birthday in <b>Settings → Profile</b> so colleagues can wish you. Only the day and month are shown, never the year.
        </div>
      )}
      {list.length === 0 && <p className="py-6 text-center text-[12px] text-slate-400">No birthdays in the next 60 days (that colleagues have shared).</p>}
      {list.map(({ p, b }) => (
        <div key={p.id} data-birthday={p.id} className={`rounded-2xl p-3 flex items-center gap-3 ${b.days === 0 ? "bg-gradient-to-r from-pink-500/20 to-amber-400/20" : "lanx-card"}`}>
          <span className="text-2xl">{b.days === 0 ? "🎂" : "🎈"}</span>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold text-slate-900 dark:text-white">{p.display_name}</div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              {b.label} · {b.days === 0 ? "today! 🎉" : b.days === 1 ? "tomorrow" : `in ${b.days} days`}
            </div>
          </div>
          {b.days === 0 && (
            <button type="button" data-send-wishes={p.id} onClick={() => onSendWishes(p.id)} className={`${btn} bg-pink-500 hover:bg-pink-600 text-white`}>
              <MessageSquare className="h-3.5 w-3.5" /> Send wishes
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

// -------------------------------------------------------- out of office

function AwayTab({ settings, onSave, onNotice }: { settings: UserSettings; onSave: (s: UserSettings) => Promise<void>; onNotice: (t: string) => void }) {
  const ooo = settings.out_of_office ?? { enabled: false, until: 0, message: "" };
  const toLocal = (t: number) => {
    if (!t) return "";
    const d = new Date(t * 1000);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const [until, setUntil] = useState(toLocal(ooo.until));
  const [message, setMessage] = useState(ooo.message);
  const [busy, setBusy] = useState(false);
  const untilSecs = until ? Math.floor(new Date(until).getTime() / 1000) : 0;
  const preview = message.trim() || `I'm out of the office${untilSecs ? ` until ${new Date(untilSecs * 1000).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : ""}. I'll reply when I'm back.`;

  const save = async (enabled: boolean) => {
    setBusy(true);
    try {
      const p = settings.profile;
      // Your status shows it too ("On leave · Back Monday").
      const profile = enabled
        ? { ...p, status: "leave", status_text: "Out of office", status_until: untilSecs }
        : p.status === "leave" && p.status_text === "Out of office"
          ? { ...p, status: "", status_text: "", status_until: 0 }
          : p;
      await onSave({ ...settings, profile, out_of_office: { enabled, until: untilSecs, message: message.trim() } });
      onNotice(enabled ? "Out of office is on: colleagues who message you get your automatic reply (once every 12 hours)." : "Out of office is off.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className={`rounded-2xl p-4 ${ooo.enabled ? "bg-emerald-500/15" : "lanx-group"}`}>
        <div className="flex items-center gap-2 text-[13px] font-bold text-slate-900 dark:text-white">
          🌴 Out of office {ooo.enabled && <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] text-white">ON</span>}
        </div>
        <p className="mt-0.5 text-[11.5px] text-slate-500 dark:text-slate-400">
          While you're away, anyone who messages you directly gets an automatic reply (once every 12 hours each), and your status shows “On leave”.
        </p>
      </div>
      <label className="block text-[12px] font-semibold text-slate-700 dark:text-slate-200">
        Until (leave empty for “until I turn it off”)
        <input data-ooo-until type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} className={`${field} mt-1`} />
      </label>
      <label className="block text-[12px] font-semibold text-slate-700 dark:text-slate-200">
        Your message
        <textarea data-ooo-message value={message} onChange={(e) => setMessage(e.target.value)} rows={3} maxLength={500} placeholder="e.g. I'm on leave until Monday. For urgent orders, please contact Bharat." className={`${field} mt-1 resize-none`} />
      </label>
      <div className="rounded-xl bg-[var(--lanx-fill)] px-3 py-2 text-[12px] text-slate-600 dark:text-slate-300">
        <span className="text-slate-400">They'll see: </span>🌴 Automatic reply: {preview}
      </div>
      <div className="flex gap-2">
        <button type="button" data-ooo-on disabled={busy} onClick={() => save(true)} className={`${btn} flex-1 bg-emerald-500 hover:bg-emerald-600 text-white`}>
          <Check className="h-4 w-4" /> {ooo.enabled ? "Save" : "Turn on"}
        </button>
        {ooo.enabled && (
          <button type="button" data-ooo-off disabled={busy} onClick={() => save(false)} className={`${btn} lanx-btn text-slate-700 dark:text-slate-200`}>
            Turn off
          </button>
        )}
      </div>
    </div>
  );
}

// -------------------------------------------------- Who's in today (LANX 2.4.0)

/** How a status counts: away (leave/road/lunch), in-but-elsewhere (wfh), or in. */
function whereabouts(p: Profile | null, online: boolean): { group: "away" | "wfh" | "in" | "off"; label: string; emoji: string; color: string } {
  const e = effective(p);
  const st = e?.status ?? "";
  if (st === "leave") return { group: "away", label: "On leave", emoji: "🌴", color: "#14b8a6" };
  if (st === "road") return { group: "away", label: "On the road", emoji: "🚗", color: "#64748b" };
  if (st === "wfh") return { group: "wfh", label: "Working from home", emoji: "🏠", color: "#0ea5e9" };
  if (!online) return { group: "off", label: "Offline", emoji: "⚪", color: "#94a3b8" };
  const preset = statusPreset(st);
  return { group: "in", label: preset?.label ?? "In the office", emoji: preset?.emoji ?? "🟢", color: preset?.color ?? "#22c55e" };
}

function TodayTab({
  settings,
  people,
  profiles,
  onOpenPeer,
}: {
  settings: UserSettings;
  people: Peer[];
  profiles: Record<string, Profile>;
  onOpenPeer: (peerId: string) => void;
}) {
  const me = {
    id: settings.device_id,
    name: `${settings.display_name} (you)`,
    color: "#0ea5e9",
    online: true,
    profile: (settings.profile as Profile | undefined) ?? null,
  };
  const rows = [
    me,
    ...people.map((p) => ({ id: p.id, name: p.display_name, color: p.avatar_color, online: p.status === "online", profile: profiles[p.id] ?? null })),
  ].map((r) => ({ ...r, w: whereabouts(r.profile ?? null, r.online) }));

  const groups: { key: string; title: string; of: typeof rows }[] = [
    { key: "in", title: "In the office", of: rows.filter((r) => r.w.group === "in") },
    { key: "wfh", title: "Working from home", of: rows.filter((r) => r.w.group === "wfh") },
    { key: "away", title: "Away", of: rows.filter((r) => r.w.group === "away") },
    { key: "off", title: "Offline", of: rows.filter((r) => r.w.group === "off") },
  ];
  const inCount = rows.filter((r) => r.w.group === "in" || r.w.group === "wfh").length;

  return (
    <div data-today className="space-y-3">
      <div className="rounded-xl lanx-group p-3 text-[12.5px] text-slate-700 dark:text-slate-200">
        <b>{inCount}</b> of {rows.length} are working right now · {new Date().toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}
      </div>
      {groups.map((g) =>
        g.of.length === 0 ? null : (
          <div key={g.key} data-today-group={g.key}>
            <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">{g.title} · {g.of.length}</div>
            <div className="space-y-1">
              {g.of.map((r) => {
                const line = statusLine(r.profile, { until: true });
                return (
                  <button
                    key={r.id}
                    type="button"
                    data-today-person={r.name}
                    onClick={() => r.id !== settings.device_id && onOpenPeer(r.id)}
                    className="w-full flex items-center gap-2.5 rounded-xl px-2 py-1.5 text-left hover:bg-[var(--lanx-fill)]"
                  >
                    <span className="h-8 w-8 rounded-full flex items-center justify-center text-white text-[12px] font-bold shrink-0" style={{ backgroundColor: r.color }}>
                      {r.name.charAt(0).toUpperCase()}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-[12.5px] font-semibold text-slate-900 dark:text-white truncate">{r.name}</span>
                      <span className="block text-[11px] truncate" style={{ color: r.w.color }}>
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
  );
}

