/** LANX 1.6.0: reading cards — what a card says and what people did with it. */
import type { CardEntry, Message } from "../../types";

export type CardKind = "notice" | "poll" | "task" | "approval" | "checklist" | "event" | "sync";

export interface NoticeCard {
  kind: "notice";
  title: string;
  body: string;
  important: boolean;
  ack: boolean;
}
export interface PollCard {
  kind: "poll";
  question: string;
  options: string[];
  multi: boolean;
}
export interface TaskCard {
  kind: "task";
  title: string;
  notes: string;
  assignee: string;
  due: number | null;
  from_message: string | null;
}
export interface ApprovalCard {
  kind: "approval";
  title: string;
  details: string;
  amount: string;
  approvers: string[];
}
export interface ChecklistCard {
  kind: "checklist";
  title: string;
  items: string[];
}
export interface EventCard {
  kind: "event";
  title: string;
  start: number;
  minutes: number;
  attendees: string[];
  place: string;
  video: boolean;
  agenda: string;
}
/** LANX 1.7.0: a shared folder that stays up to date. */
export interface SyncCard {
  kind: "sync";
  name: string;
  share_id: string;
  files: number;
  bytes: number;
}
export type Card = NoticeCard | PollCard | TaskCard | ApprovalCard | ChecklistCard | EventCard | SyncCard;

export const KIND_LABEL: Record<CardKind, string> = {
  notice: "Notice",
  poll: "Poll",
  task: "Task",
  approval: "Approval",
  checklist: "Checklist",
  event: "Meeting",
  sync: "Shared folder",
};

export function parseCard(m: Message): Card | null {
  if (m.message_type !== "card") return null;
  try {
    const c = JSON.parse(m.content);
    return c && typeof c.kind === "string" ? (c as Card) : null;
  } catch {
    return null;
  }
}

export const entries = (m: Message): CardEntry[] => m.card_state ?? [];
const entry = (m: Message, key: string) => entries(m).find((e) => e.key === key);
const perPerson = (m: Message, prefix: string) =>
  entries(m)
    .filter((e) => e.key.startsWith(prefix))
    .map((e) => ({ id: e.key.slice(prefix.length), name: e.name, value: e.value, at: e.at }));

/** Who made the card. */
export const creatorOf = (m: Message, myId: string) => (m.is_outgoing ? myId : m.sender_id);

// ---- poll
export function pollTally(m: Message, c: PollCard) {
  const votes = perPerson(m, "vote:").filter((v) => Array.isArray(v.value) && (v.value as number[]).length);
  const counts = c.options.map(() => 0);
  const names: string[][] = c.options.map(() => []);
  for (const v of votes) for (const i of v.value as number[]) if (counts[i] !== undefined) {
    counts[i] += 1;
    names[i].push(v.name);
  }
  return { counts, names, voters: votes.length, closed: entry(m, "closed")?.value === true };
}
export const myVote = (m: Message, myId: string): number[] => (entry(m, `vote:${myId}`)?.value as number[] | undefined) ?? [];

// ---- notice
export const acks = (m: Message) => perPerson(m, "ack:").filter((a) => a.value === true);

// ---- task
export const taskDone = (m: Message) => entry(m, "status")?.value === "done";
export const taskDoneBy = (m: Message) => entry(m, "status");

// ---- approval
export function decisions(m: Message) {
  return perPerson(m, "decision:").map((d) => ({ ...d, d: (d.value as { d: string; note?: string }).d, note: (d.value as { note?: string }).note ?? "" }));
}
export function approvalStatus(m: Message, c: ApprovalCard): "approved" | "rejected" | "pending" {
  const ds = decisions(m);
  if (ds.some((d) => d.d === "rejected")) return "rejected";
  if (c.approvers.length && c.approvers.every((id) => ds.some((d) => d.id === id && d.d === "approved"))) return "approved";
  return "pending";
}

// ---- checklist
export function checklistItems(m: Message, c: ChecklistCard) {
  const added = entries(m)
    .filter((e) => e.key.startsWith("add:"))
    .sort((a, b) => a.at - b.at)
    .map((e) => ({ text: String(e.value), by: e.name }));
  const all = [...c.items.map((t) => ({ text: t, by: "" })), ...added];
  return all.map((it, i) => ({ ...it, index: i, done: entry(m, `item:${i}`)?.value === true }));
}

// ---- meeting
export const rsvps = (m: Message) => perPerson(m, "rsvp:").map((r) => ({ ...r, answer: String(r.value) }));
export const eventCancelled = (m: Message) => entry(m, "cancelled")?.value === true;

/** Does this card wait for something from me? */
export function needsMe(m: Message, myId: string): string | null {
  const c = parseCard(m);
  if (!c || m.deleted) return null;
  const now = Math.floor(Date.now() / 1000);
  switch (c.kind) {
    case "notice":
      return !m.is_outgoing && c.ack && !acks(m).some((a) => a.id === myId) ? "Confirm you've read it" : null;
    case "poll":
      return !pollTally(m, c).closed && !myVote(m, myId).length && !m.is_outgoing ? "Vote" : null;
    case "task": {
      const mine = c.assignee === myId || (!c.assignee && m.is_outgoing);
      return mine && !taskDone(m) ? (c.due && c.due < now ? "Overdue" : "To do") : null;
    }
    case "approval":
      return c.approvers.includes(myId) && !decisions(m).some((d) => d.id === myId) ? "Approve or reject" : null;
    case "event": {
      const invited = !m.is_outgoing && (c.attendees.length === 0 || c.attendees.includes(myId));
      return invited && !eventCancelled(m) && c.start + c.minutes * 60 > now && !rsvps(m).some((r) => r.id === myId) ? "Reply" : null;
    }
    default:
      return null;
  }
}
