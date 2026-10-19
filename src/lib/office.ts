/** LANX 1.8.0 office helpers: emergency kinds, kudos badges, birthdays. */
import type { AlertInfo } from "../types";

export const ALERT_KINDS: { id: AlertInfo["kind"]; emoji: string; label: string; text: string }[] = [
  { id: "fire", emoji: "🔥", label: "Fire", text: "Fire! Leave the building now by the nearest exit." },
  { id: "medical", emoji: "🚑", label: "Medical help", text: "Medical emergency. First-aiders, please come." },
  { id: "evacuate", emoji: "🚪", label: "Evacuate", text: "Evacuate the building now." },
  { id: "assembly", emoji: "📣", label: "Assembly point", text: "Everyone to the assembly point, please." },
  { id: "lockdown", emoji: "🔒", label: "Stay inside", text: "Stay where you are and keep the doors closed." },
  { id: "custom", emoji: "🚨", label: "Something else", text: "" },
];
export const alertKind = (id: string) => ALERT_KINDS.find((k) => k.id === id) ?? ALERT_KINDS[5];

/** An alert from a colleague that still needs your answer. */
export const needsAnswer = (a: AlertInfo, now = Date.now() / 1000) => !a.mine && !a.my_ack && !a.cleared_at && now - a.at < 6 * 3600;
/** An alert that is still going on (not cleared, not too old). */
export const stillOn = (a: AlertInfo, now = Date.now() / 1000) => !a.cleared_at && now - a.at < 6 * 3600;

export const KUDOS_BADGES: { id: string; emoji: string; label: string }[] = [
  { id: "thanks", emoji: "🙏", label: "Thank you" },
  { id: "teamwork", emoji: "🤝", label: "Great teamwork" },
  { id: "solver", emoji: "🧠", label: "Problem solver" },
  { id: "above", emoji: "🚀", label: "Above and beyond" },
  { id: "helper", emoji: "🫶", label: "Helping hand" },
  { id: "star", emoji: "⭐", label: "Star of the week" },
];
export const kudosBadge = (id: string) => KUDOS_BADGES.find((b) => b.id === id) ?? KUDOS_BADGES[0];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "MM-DD" → when it is next (0 = today) and how to show it ("19 Oct"). */
export function birthdayInfo(mmdd?: string | null, now = new Date()): { days: number; label: string; month: number; day: number } | null {
  const m = /^(\d{2})-(\d{2})$/.exec(mmdd ?? "");
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let next = new Date(now.getFullYear(), month - 1, day);
  // 29 Feb in a normal year: celebrate on 28 Feb.
  if (next.getMonth() !== month - 1) next = new Date(now.getFullYear(), month - 1, day - 1);
  if (next < today) next = new Date(now.getFullYear() + 1, month - 1, day);
  const days = Math.round((next.getTime() - today.getTime()) / 86400_000);
  return { days, label: `${day} ${MONTHS[month - 1]}`, month, day };
}

export const toMMDD = (month: number, day: number) => (month && day ? `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` : "");
export { MONTHS };
