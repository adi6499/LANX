import { useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  Check,
  CheckCircle2,
  Circle,
  ClipboardCheck,
  Clock,
  FolderOpen,
  FolderSync,
  BellRing,
  Trophy,
  FileSignature,
  Link2,
  ListChecks,
  MapPin,
  Megaphone,
  Plus,
  Video,
  X,
  XCircle,
} from "lucide-react";
import type { Message } from "../../types";
import { api, errorText } from "../../lib/api";
import {
  KIND_LABEL,
  acks,
  approvalStatus,
  checklistItems,
  creatorOf,
  decisions,
  eventCancelled,
  myVote,
  parseCard,
  pollTally,
  rsvps,
  taskDone,
  taskDoneBy,
  type CardKind,
} from "./cardModel";
import { whenText } from "../chat/chatUtils";
import { ConfirmButton, ago, useSync } from "../tools/SyncPanel";
import { formatSize } from "../../lib/format";
import { kudosBadge } from "../../lib/office";

/** LANX 1.6.0: a card in a chat — notice, poll, task, approval, checklist or
 *  meeting — with what people did with it and the buttons to take part. */

const STYLE: Record<CardKind, { bar: string; icon: React.ElementType }> = {
  notice: { bar: "bg-amber-500/15 text-amber-700 dark:text-amber-300", icon: Megaphone },
  poll: { bar: "bg-violet-500/15 text-violet-700 dark:text-violet-300", icon: BarChart3 },
  task: { bar: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", icon: ClipboardCheck },
  approval: { bar: "bg-sky-500/15 text-sky-700 dark:text-sky-300", icon: FileSignature },
  checklist: { bar: "bg-teal-500/15 text-teal-700 dark:text-teal-300", icon: ListChecks },
  event: { bar: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300", icon: CalendarDays },
  sync: { bar: "bg-amber-500/15 text-amber-700 dark:text-amber-300", icon: FolderSync },
  visitor: { bar: "bg-orange-500/15 text-orange-700 dark:text-orange-300", icon: BellRing },
  kudos: { bar: "bg-yellow-400/20 text-yellow-800 dark:text-yellow-300", icon: Trophy },
};

const VISITOR_REPLIES: [string, string][] = [
  ["coming", "Coming now"],
  ["5min", "In 5 minutes"],
  ["send-in", "Send them in"],
  ["busy", "Not available"],
];

const btn = "inline-flex items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors active:scale-95 disabled:opacity-50";

export function CardView({
  msg,
  myId,
  nameOf,
  onChanged,
  onError,
  onStartMeeting,
  onJump,
  canAct = true,
  wide = false,
}: {
  msg: Message;
  myId: string;
  /** Display name for a device id ("You" for me). */
  nameOf: (id: string) => string;
  onChanged: (m: Message) => void;
  onError: (text: string) => void;
  onStartMeeting?: (conversationId: string) => void;
  onJump?: (messageId: string) => void;
  canAct?: boolean;
  wide?: boolean;
}) {
  const card = parseCard(msg);
  const [sync, reloadSync] = useSync();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [newItem, setNewItem] = useState("");
  if (!card) return null;
  const creator = creatorOf(msg, myId);
  const isCreator = creator === myId;
  const now = Math.floor(Date.now() / 1000);
  const act = async (key: string, value: unknown) => {
    setBusy(true);
    try {
      onChanged(await api.cardAction(msg.id, key, value));
    } catch (e) {
      onError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const S = STYLE[card.kind];
  const Icon = S.icon;

  let body: React.ReactNode = null;
  let status: React.ReactNode = null;

  if (card.kind === "notice") {
    const confirmed = acks(msg);
    const mine = confirmed.some((a) => a.id === myId);
    const readBy = msg.deliveries?.read_by ?? [];
    status = card.important ? (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-500 text-white px-2 py-0.5 text-[10px] font-bold normal-case">
        <AlertTriangle className="h-3 w-3" /> Important
      </span>
    ) : null;
    body = (
      <>
        {card.title && <div className="text-[14px] font-semibold text-slate-900 dark:text-white">{card.title}</div>}
        {card.body && <p className="text-[13px] text-slate-700 dark:text-slate-200 whitespace-pre-wrap break-words leading-relaxed">{card.body}</p>}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-[11px] text-slate-500 dark:text-slate-400" data-notice-reads>
          {msg.is_outgoing && msg.deliveries && (
            <span title={readBy.join(", ")}>
              Read by {msg.deliveries.read} of {msg.deliveries.total}
            </span>
          )}
          {card.ack && (
            <span title={confirmed.map((a) => a.name).join(", ")} data-ack-count>
              ✓ Confirmed by {confirmed.length ? confirmed.map((a) => a.name).join(", ") : "nobody yet"}
            </span>
          )}
        </div>
        {card.ack && !msg.is_outgoing && canAct && (
          mine ? (
            <div className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4" /> You confirmed you've read it
            </div>
          ) : (
            <button type="button" data-card-ack disabled={busy} onClick={() => act(`ack:${myId}`, true)} className={`${btn} bg-amber-500 hover:bg-amber-600 text-white`}>
              <Check className="h-3.5 w-3.5" /> I've read it
            </button>
          )
        )}
      </>
    );
  } else if (card.kind === "poll") {
    const t = pollTally(msg, card);
    const mine = myVote(msg, myId);
    const total = Math.max(1, card.multi ? t.voters : t.counts.reduce((a, b) => a + b, 0));
    status = t.closed ? <span className="rounded-full bg-slate-500/15 px-2 py-0.5 text-[10px] font-bold normal-case">Closed</span> : null;
    const vote = (i: number) => {
      if (t.closed || !canAct) return;
      const next = card.multi ? (mine.includes(i) ? mine.filter((x) => x !== i) : [...mine, i]) : mine[0] === i ? [] : [i];
      void act(`vote:${myId}`, next);
    };
    body = (
      <>
        <div className="text-[14px] font-semibold text-slate-900 dark:text-white">{card.question}</div>
        {card.multi && <div className="text-[11px] text-slate-500">Choose one or more</div>}
        <div className="space-y-1.5">
          {card.options.map((o, i) => {
            const pct = Math.round((t.counts[i] / total) * 100);
            const chosen = mine.includes(i);
            return (
              <button
                key={i}
                type="button"
                data-poll-option={i}
                disabled={busy || t.closed || !canAct}
                onClick={() => vote(i)}
                title={t.names[i].join(", ")}
                className={`relative w-full overflow-hidden rounded-xl border px-3 py-2 text-left text-[12.5px] transition-colors ${
                  chosen ? "border-violet-500 ring-1 ring-violet-500/40" : "border-slate-300/70 dark:border-slate-600 hover:border-violet-400"
                }`}
              >
                <span className="absolute inset-y-0 left-0 bg-violet-500/15 transition-all duration-500" style={{ width: `${t.voters ? pct : 0}%` }} />
                <span className="relative flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-2 min-w-0">
                    {chosen ? <CheckCircle2 className="h-4 w-4 text-violet-600 shrink-0" /> : <Circle className="h-4 w-4 text-slate-400 shrink-0" />}
                    <span className="truncate text-slate-800 dark:text-slate-100">{o}</span>
                  </span>
                  <span className="shrink-0 text-[11px] font-semibold text-slate-500 tabular-nums">
                    {t.counts[i]} {t.voters ? `· ${pct}%` : ""}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center justify-between pt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
          <span data-poll-voters>{t.voters === 1 ? "1 person voted" : `${t.voters} people voted`}</span>
          {isCreator && !t.closed && canAct && (
            <button type="button" disabled={busy} onClick={() => act("closed", true)} className="font-semibold text-violet-600 hover:underline">
              Close poll
            </button>
          )}
        </div>
      </>
    );
  } else if (card.kind === "task") {
    const done = taskDone(msg);
    const by = taskDoneBy(msg);
    const allowed = canAct && (!card.assignee || card.assignee === myId || isCreator);
    const overdue = !done && card.due && card.due < now;
    status = done ? (
      <span className="rounded-full bg-emerald-500 text-white px-2 py-0.5 text-[10px] font-bold normal-case">Done</span>
    ) : overdue ? (
      <span className="rounded-full bg-red-500 text-white px-2 py-0.5 text-[10px] font-bold normal-case">Overdue</span>
    ) : null;
    body = (
      <>
        <div className="flex items-start gap-2.5">
          <button
            type="button"
            data-task-toggle
            disabled={!allowed || busy}
            onClick={() => act("status", done ? "open" : "done")}
            title={done ? "Reopen" : "Mark done"}
            className="mt-0.5 shrink-0 disabled:cursor-default"
          >
            {done ? <CheckCircle2 className="h-5 w-5 text-emerald-500" /> : <Circle className="h-5 w-5 text-slate-400 hover:text-emerald-500" />}
          </button>
          <div className="min-w-0">
            <div className={`text-[14px] font-semibold ${done ? "line-through text-slate-400" : "text-slate-900 dark:text-white"}`}>{card.title}</div>
            <div className="text-[11.5px] text-slate-500 dark:text-slate-400">
              {card.assignee ? `For ${nameOf(card.assignee)}` : "For anyone"}
              {card.due && <span className={overdue ? "text-red-600 font-semibold" : ""}> · due {whenText(card.due)}</span>}
            </div>
          </div>
        </div>
        {card.notes && <p className="text-[12.5px] text-slate-600 dark:text-slate-300 whitespace-pre-wrap break-words">{card.notes}</p>}
        {card.from_message && onJump && (
          <button type="button" onClick={() => onJump(card.from_message!)} className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 hover:underline">
            <Link2 className="h-3 w-3" /> From a message
          </button>
        )}
        {done && by && <div className="text-[11px] text-slate-500">Done by {by.name} · {whenText(by.at)}</div>}
        {allowed && (
          <button type="button" data-task-done disabled={busy} onClick={() => act("status", done ? "open" : "done")} className={`${btn} ${done ? "bg-slate-500/10 text-slate-600 dark:text-slate-300" : "bg-emerald-500 hover:bg-emerald-600 text-white"}`}>
            {done ? "Reopen" : (<><Check className="h-3.5 w-3.5" /> Mark done</>)}
          </button>
        )}
      </>
    );
  } else if (card.kind === "approval") {
    const ds = decisions(msg);
    const st = approvalStatus(msg, card);
    const mineAsked = card.approvers.includes(myId);
    const mineDone = ds.find((d) => d.id === myId);
    status = (
      <span
        data-approval-status={st}
        className={`rounded-full px-2 py-0.5 text-[10px] font-bold normal-case text-white ${st === "approved" ? "bg-emerald-500" : st === "rejected" ? "bg-red-500" : "bg-amber-500"}`}
      >
        {st === "approved" ? "Approved" : st === "rejected" ? "Rejected" : "Waiting"}
      </span>
    );
    body = (
      <>
        <div className="flex items-start justify-between gap-2">
          <div className="text-[14px] font-semibold text-slate-900 dark:text-white">{card.title}</div>
          {card.amount && <span className="shrink-0 rounded-lg bg-sky-500/10 px-2 py-0.5 text-[12px] font-bold text-sky-700 dark:text-sky-300">{card.amount}</span>}
        </div>
        {card.details && <p className="text-[12.5px] text-slate-600 dark:text-slate-300 whitespace-pre-wrap break-words">{card.details}</p>}
        <div className="space-y-1">
          {card.approvers.map((id) => {
            const d = ds.find((x) => x.id === id);
            return (
              <div key={id} className="flex items-start gap-2 text-[12px]">
                {d?.d === "approved" ? <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" /> : d?.d === "rejected" ? <XCircle className="h-4 w-4 text-red-500 shrink-0" /> : <Clock className="h-4 w-4 text-amber-500 shrink-0" />}
                <span className="text-slate-700 dark:text-slate-200">
                  <b className="font-semibold">{nameOf(id)}</b> {d ? (d.d === "approved" ? "approved" : "rejected") : id === myId ? "haven't decided yet" : "hasn't decided yet"}
                  {d?.note && <span className="text-slate-500"> — “{d.note}”</span>}
                </span>
              </div>
            );
          })}
        </div>
        {mineAsked && !mineDone && canAct && (
          <div className="space-y-1.5 pt-1">
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Add a note (optional)" className="w-full rounded-lg lanx-field px-2.5 py-1.5 text-[12px]" />
            <div className="flex gap-2">
              <button type="button" data-approve disabled={busy} onClick={() => act(`decision:${myId}`, { d: "approved", note })} className={`${btn} flex-1 bg-emerald-500 hover:bg-emerald-600 text-white`}>
                <Check className="h-3.5 w-3.5" /> Approve
              </button>
              <button type="button" data-reject disabled={busy} onClick={() => act(`decision:${myId}`, { d: "rejected", note })} className={`${btn} flex-1 bg-red-500 hover:bg-red-600 text-white`}>
                <X className="h-3.5 w-3.5" /> Reject
              </button>
            </div>
          </div>
        )}
      </>
    );
  } else if (card.kind === "checklist") {
    const items = checklistItems(msg, card);
    const done = items.filter((i) => i.done).length;
    status = (
      <span className="rounded-full bg-teal-500/20 px-2 py-0.5 text-[10px] font-bold normal-case tabular-nums" data-checklist-progress>
        {done}/{items.length}
      </span>
    );
    body = (
      <>
        <div className="text-[14px] font-semibold text-slate-900 dark:text-white">{card.title}</div>
        <div className="h-1.5 rounded-full bg-slate-500/15 overflow-hidden">
          <div className="h-full rounded-full bg-teal-500 transition-all duration-500" style={{ width: `${items.length ? (done / items.length) * 100 : 0}%` }} />
        </div>
        <div className="space-y-0.5">
          {items.map((it) => (
            <button
              key={it.index}
              type="button"
              data-check-item={it.index}
              disabled={busy || !canAct}
              onClick={() => act(`item:${it.index}`, !it.done)}
              className="w-full flex items-center gap-2 rounded-lg px-1.5 py-1 text-left text-[12.5px] hover:bg-[var(--lanx-fill)]"
            >
              {it.done ? <CheckCircle2 className="h-4 w-4 text-teal-500 shrink-0" /> : <Circle className="h-4 w-4 text-slate-400 shrink-0" />}
              <span className={it.done ? "line-through text-slate-400" : "text-slate-800 dark:text-slate-100"}>{it.text}</span>
              {it.by && <span className="ml-auto text-[10px] text-slate-400">+{it.by}</span>}
            </button>
          ))}
        </div>
        {canAct && items.length < 100 && (
          <form
            className="flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              const t = newItem.trim();
              if (!t) return;
              setNewItem("");
              void act(`add:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, t);
            }}
          >
            <input value={newItem} onChange={(e) => setNewItem(e.target.value)} maxLength={200} placeholder="Add an item…" className="flex-1 min-w-0 rounded-lg lanx-field px-2.5 py-1 text-[12px]" />
            <button type="submit" disabled={busy || !newItem.trim()} aria-label="Add item" className="h-7 w-7 rounded-lg bg-teal-500 text-white flex items-center justify-center disabled:opacity-40">
              <Plus className="h-3.5 w-3.5" />
            </button>
          </form>
        )}
      </>
    );
  } else if (card.kind === "event") {
    const cancelled = eventCancelled(msg);
    const answers = rsvps(msg);
    const mine = answers.find((a) => a.id === myId)?.answer;
    const end = card.start + card.minutes * 60;
    const soon = !cancelled && now >= card.start - 15 * 60 && now <= end;
    const past = now > end;
    const invited = card.attendees.length ? [...new Set([creator, ...card.attendees])] : [];
    status = cancelled ? (
      <span className="rounded-full bg-red-500 text-white px-2 py-0.5 text-[10px] font-bold normal-case">Cancelled</span>
    ) : soon ? (
      <span className="rounded-full bg-emerald-500 text-white px-2 py-0.5 text-[10px] font-bold normal-case animate-pulse">Now</span>
    ) : past ? (
      <span className="rounded-full bg-slate-500/20 px-2 py-0.5 text-[10px] font-bold normal-case">Over</span>
    ) : null;
    body = (
      <>
        <div className={`text-[14px] font-semibold ${cancelled ? "line-through text-slate-400" : "text-slate-900 dark:text-white"}`}>{card.title}</div>
        <div className="space-y-0.5 text-[12px] text-slate-600 dark:text-slate-300">
          <div className="inline-flex items-center gap-1.5" data-event-when>
            <Clock className="h-3.5 w-3.5" /> {whenText(card.start)} · {card.minutes} min
          </div>
          {card.place && (
            <div className="flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5" /> {card.place}
            </div>
          )}
          {card.video && (
            <div className="flex items-center gap-1.5">
              <Video className="h-3.5 w-3.5" /> Video meeting in LANX
            </div>
          )}
        </div>
        {card.agenda && <p className="text-[12px] text-slate-600 dark:text-slate-300 whitespace-pre-wrap break-words border-l-2 border-indigo-400/50 pl-2">{card.agenda}</p>}
        <div className="flex flex-wrap gap-1">
          {(invited.length ? invited : answers.map((a) => a.id)).map((id) => {
            const a = answers.find((x) => x.id === id)?.answer;
            return (
              <span key={id} className={`rounded-full px-2 py-0.5 text-[11px] ${a === "yes" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : a === "no" ? "bg-red-500/10 text-red-600 line-through" : a === "maybe" ? "bg-amber-500/15 text-amber-700" : "bg-slate-500/10 text-slate-600 dark:text-slate-300"}`}>
                {id === creator ? `${nameOf(id)} (organiser)` : nameOf(id)}
                {a === "yes" ? " ✓" : a === "maybe" ? " ?" : ""}
              </span>
            );
          })}
          {!invited.length && <span className="text-[11px] text-slate-400">Everyone in this chat</span>}
        </div>
        {!cancelled && !past && canAct && (
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            {!isCreator &&
              (["yes", "maybe", "no"] as const).map((a) => (
                <button
                  key={a}
                  type="button"
                  data-rsvp={a}
                  disabled={busy}
                  onClick={() => act(`rsvp:${myId}`, a)}
                  className={`${btn} ${mine === a ? "bg-indigo-500 text-white" : "bg-slate-500/10 text-slate-700 dark:text-slate-200 hover:bg-slate-500/20"}`}
                >
                  {a === "yes" ? "Going" : a === "maybe" ? "Maybe" : "Can't"}
                </button>
              ))}
            {soon && card.video && onStartMeeting && (
              <button type="button" data-event-start onClick={() => onStartMeeting(msg.conversation_id)} className={`${btn} bg-emerald-500 hover:bg-emerald-600 text-white`}>
                <Video className="h-3.5 w-3.5" /> Start meeting
              </button>
            )}
            {isCreator && (
              <button type="button" disabled={busy} onClick={() => act("cancelled", true)} className="ml-auto text-[11px] font-semibold text-red-600 hover:underline">
                Cancel meeting
              </button>
            )}
          </div>
        )}
      </>
    );
  }

  if (card.kind === "visitor") {
    const reply = msg.card_state?.find((e) => e.key === "reply")?.value as { r: string; note?: string } | undefined;
    const vstatus = (msg.card_state?.find((e) => e.key === "status")?.value as string | undefined) ?? "waiting";
    const amHost = card.host === myId;
    status =
      vstatus === "met" ? (
        <span className="rounded-full bg-emerald-500 text-white px-2 py-0.5 text-[10px] font-bold normal-case">Met</span>
      ) : vstatus === "left" ? (
        <span className="rounded-full bg-slate-500/20 px-2 py-0.5 text-[10px] font-bold normal-case">Left</span>
      ) : (
        <span className="rounded-full bg-orange-500 text-white px-2 py-0.5 text-[10px] font-bold normal-case animate-pulse">At reception</span>
      );
    body = (
      <>
        <div className="text-[15px] font-semibold text-slate-900 dark:text-white">
          {card.visitor}
          {card.company && <span className="font-normal text-slate-500"> · {card.company}</span>}
        </div>
        <div className="text-[12px] text-slate-600 dark:text-slate-300">
          {amHost ? "is here to see you" : `is here to see ${card.host_name || nameOf(card.host)}`} · {new Date(msg.timestamp * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </div>
        {card.note && <p className="text-[12px] text-slate-600 dark:text-slate-300 border-l-2 border-orange-400/50 pl-2">{card.note}</p>}
        {reply && (
          <div data-visitor-reply className={`text-[12.5px] font-semibold ${reply.r === "busy" ? "text-red-600" : "text-emerald-600 dark:text-emerald-400"}`}>
            {amHost ? "You answered: " : `${card.host_name || nameOf(card.host)}: `}
            {VISITOR_REPLIES.find((r) => r[0] === reply.r)?.[1] ?? reply.r}
          </div>
        )}
        {amHost && canAct && vstatus === "waiting" && (
          <div className="flex flex-wrap gap-1.5">
            {VISITOR_REPLIES.map(([r, label]) => (
              <button
                key={r}
                type="button"
                data-visitor-answer={r}
                disabled={busy}
                onClick={() => act("reply", { r, note: "" })}
                className={`${btn} ${reply?.r === r ? "bg-orange-500 text-white" : r === "busy" ? "bg-red-500/10 text-red-600 hover:bg-red-500/20" : "bg-slate-500/10 text-slate-700 dark:text-slate-200 hover:bg-slate-500/20"}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {isCreator && canAct && vstatus === "waiting" && (
          <div className="flex gap-1.5">
            <button type="button" disabled={busy} onClick={() => act("status", "met")} className={`${btn} bg-emerald-500 hover:bg-emerald-600 text-white`}>
              <Check className="h-3.5 w-3.5" /> They've met
            </button>
            <button type="button" disabled={busy} onClick={() => act("status", "left")} className={`${btn} bg-slate-500/10 text-slate-700 dark:text-slate-200`}>
              Visitor left
            </button>
          </div>
        )}
      </>
    );
  } else if (card.kind === "kudos") {
    const b = kudosBadge(card.badge);
    const pluses = (msg.card_state ?? []).filter((e) => e.key.startsWith("plus:") && e.value === true);
    const minePlus = pluses.some((e) => e.key === `plus:${myId}`);
    body = (
      <>
        <div className="flex items-center gap-3">
          <span className="text-[44px] leading-none">{b.emoji}</span>
          <div className="min-w-0">
            <div className="text-[15px] font-bold text-slate-900 dark:text-white">Kudos to {card.to === myId ? "you" : card.to_name || nameOf(card.to)}!</div>
            <div className="text-[12px] font-semibold text-yellow-700 dark:text-yellow-300">{b.label}</div>
          </div>
        </div>
        {card.note && <p className="text-[13px] text-slate-700 dark:text-slate-200">“{card.note}”</p>}
        <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
          <span>from {nameOf(creator)}</span>
          {pluses.length > 0 && <span title={pluses.map((p) => p.name).join(", ")}>· 👏 {pluses.length}</span>}
          {canAct && !isCreator && card.to !== myId && (
            <button type="button" data-kudos-plus disabled={busy} onClick={() => act(`plus:${myId}`, !minePlus)} className={`ml-auto ${btn} ${minePlus ? "bg-yellow-400 text-yellow-950" : "bg-slate-500/10 text-slate-700 dark:text-slate-200 hover:bg-slate-500/20"}`}>
              👏 {minePlus ? "Clapped" : "Clap"}
            </button>
          )}
        </div>
      </>
    );
  }

  if (card.kind === "sync") {
    const share = sync.shares.find((s) => s.id === card.share_id);
    const sub = sync.subscriptions.find((s) => s.share_id === card.share_id);
    const run = async (f: () => Promise<unknown>) => {
      setBusy(true);
      try {
        await f();
        reloadSync();
      } catch (e) {
        onError(errorText(e));
      } finally {
        setBusy(false);
      }
    };
    const get = () =>
      run(async () => {
        const where = await api.pickFolder(`Where should “${card.name}” go on this computer?`);
        if (!where) return;
        const tail = where.split(/[\\/]/).filter(Boolean).pop() ?? "";
        const dest = tail.toLowerCase() === card.name.toLowerCase() ? where : `${where.replace(/[\\/]+$/, "")}\\${card.name}`;
        await api.subscribeFolder(msg.id, dest);
      });
    status = msg.is_outgoing ? (
      share ? <span className="rounded-full bg-emerald-500 text-white px-2 py-0.5 text-[10px] font-bold normal-case">Sharing</span> : <span className="rounded-full bg-slate-500/20 px-2 py-0.5 text-[10px] font-bold normal-case">Stopped</span>
    ) : sub?.status === "active" ? (
      <span className="rounded-full bg-emerald-500 text-white px-2 py-0.5 text-[10px] font-bold normal-case">You get it</span>
    ) : null;
    body = (
      <>
        <div className="flex items-center gap-3">
          <span className="h-11 w-11 rounded-xl bg-amber-500/15 text-amber-600 flex items-center justify-center shrink-0">
            <FolderSync className="h-6 w-6" />
          </span>
          <div className="min-w-0">
            <div className="text-[14px] font-semibold text-slate-900 dark:text-white truncate">{card.name}</div>
            <div className="text-[11.5px] text-slate-500 dark:text-slate-400">
              {card.files} file{card.files === 1 ? "" : "s"} · {formatSize(card.bytes)} · stays up to date
            </div>
          </div>
        </div>
        {msg.is_outgoing ? (
          share ? (
            <>
              <div className="text-[11.5px] text-slate-600 dark:text-slate-300" data-sync-card-subs>
                {share.subscribers.length ? `${share.subscribers.join(", ")} ${share.subscribers.length === 1 ? "gets" : "get"} a copy` : "Nobody has pressed “Get this folder” yet."}
                {share.waiting > 0 && ` · ${share.waiting} file${share.waiting === 1 ? "" : "s"} on the way`}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <button type="button" onClick={() => run(() => api.openSyncFolder(share.id))} className={`${btn} bg-slate-500/10 text-slate-700 dark:text-slate-200 hover:bg-slate-500/20`}>
                  <FolderOpen className="h-3.5 w-3.5" /> Open
                </button>
                <ConfirmButton
                  data-sync-card-stop
                  label="Stop sharing"
                  ask="Stop sharing?"
                  onYes={() => run(() => api.stopSharingFolder(share.id))}
                  className="ml-auto text-[11px] font-semibold text-red-600 hover:underline"
                />
              </div>
            </>
          ) : (
            <div className="text-[11.5px] text-slate-500">You stopped sharing this folder.</div>
          )
        ) : sub ? (
          <>
            <div className="text-[11.5px] text-slate-600 dark:text-slate-300 break-all" data-sync-card-dest>
              {sub.status === "active" ? (
                <>
                  Saved in <b>{sub.dest_path}</b> · {sub.files} file{sub.files === 1 ? "" : "s"} received · last {ago(sub.last_at)}
                </>
              ) : (
                <>{nameOf(sub.owner_id)} stopped sharing it. Your copy in {sub.dest_path} stays.</>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <button type="button" onClick={() => run(() => api.openSyncFolder(sub.share_id))} className={`${btn} bg-slate-500/10 text-slate-700 dark:text-slate-200 hover:bg-slate-500/20`}>
                <FolderOpen className="h-3.5 w-3.5" /> Open
              </button>
              {sub.status === "active" && (
                <ConfirmButton
                  data-sync-card-unsub
                  label="Stop getting it"
                  ask="Stop getting it?"
                  onYes={() => run(() => api.unsubscribeFolder(sub.share_id))}
                  className="ml-auto text-[11px] font-semibold text-red-600 hover:underline"
                />
              )}
            </div>
          </>
        ) : canAct ? (
          <>
            <div className="text-[11.5px] text-slate-500 dark:text-slate-400">Get a copy that stays up to date by itself.</div>
            <button type="button" data-sync-get disabled={busy} onClick={get} className={`${btn} bg-amber-500 hover:bg-amber-600 text-white`}>
              <FolderSync className="h-3.5 w-3.5" /> Get this folder
            </button>
          </>
        ) : null}
      </>
    );
  }

  return (
    <div data-card={card.kind} className={`${wide ? "w-full" : "w-[360px] max-w-full"} rounded-2xl lanx-card shadow-sm overflow-hidden text-left`}>
      <div className={`flex items-center gap-2 px-3.5 py-1.5 text-[10.5px] font-bold uppercase tracking-wide ${S.bar}`}>
        <Icon className="h-3.5 w-3.5" />
        <span>{KIND_LABEL[card.kind]}</span>
        <span className="ml-auto">{status}</span>
      </div>
      <div className="px-3.5 py-3 space-y-2">{body}</div>
    </div>
  );
}
