/** LANX 1.9.0: exporting a chat — rows for Excel, or a clean page to print /
 *  "Save as PDF" (Windows' own print window, so every language and emoji works). */
import type { Conversation, Message, Peer } from "../types";
import { api } from "./api";

const KIND: Record<string, string> = {
  text: "Message",
  file: "File",
  card: "Card",
  sticker: "Sticker",
  ring: "Ring",
  call: "Call",
  meeting: "Meeting",
  recording: "Recording",
  system: "Event",
  secret_setting: "Event",
};

/** What a message says, as plain text. */
export function plainText(m: Message): string {
  if (m.deleted) return "(deleted)";
  if (m.ttl_secs) return "(secret message)";
  switch (m.message_type) {
    case "card":
      try {
        const c = JSON.parse(m.content);
        return [c.kind?.toUpperCase(), c.title ?? c.question ?? c.name ?? c.visitor ?? c.to_name ?? "", c.body ?? c.notes ?? c.details ?? c.note ?? ""].filter(Boolean).join(" — ");
      } catch {
        return m.content;
      }
    case "ring":
      return "🔔 Ring";
    case "call":
    case "meeting":
    case "recording":
      try {
        const c = JSON.parse(m.content);
        return `${KIND[m.message_type]}${c.outcome ? ` (${c.outcome})` : ""}${c.secs ? `, ${Math.round(c.secs / 60)} min` : ""}`;
      } catch {
        return KIND[m.message_type];
      }
    default:
      return m.content;
  }
}

export function senderName(m: Message, conv: Conversation, peers: Peer[], myName: string): string {
  if (m.message_type === "system" || m.message_type === "secret_setting") return "";
  if (m.is_outgoing) return myName;
  if (conv.kind === "direct") return conv.peer_name;
  return peers.find((p) => p.id === m.sender_id)?.display_name ?? "Someone";
}

export function chatRows(conv: Conversation, messages: Message[], peers: Peer[], myName: string): string[][] {
  const rows: string[][] = [["Date", "Time", "From", "Message", "Type"]];
  for (const m of messages) {
    const d = new Date(m.timestamp * 1000);
    rows.push([
      d.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" }),
      d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      senderName(m, conv, peers, myName),
      plainText(m),
      KIND[m.message_type] ?? m.message_type,
    ]);
  }
  return rows;
}

const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 60) || "Chat";

/** Saves the chat as an Excel file; returns where (null if cancelled). */
export async function exportChatExcel(conv: Conversation, peers: Peer[], myName: string): Promise<string | null> {
  const messages = await api.getMessages(conv.id);
  const stamp = new Date().toISOString().slice(0, 10);
  return api.exportExcel(`LANX chat - ${safeName(conv.peer_name)} - ${stamp}`, safeName(conv.peer_name), chatRows(conv, messages, peers, myName));
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Opens Windows' print window with the chat laid out as a document (choose
 *  "Microsoft Print to PDF" / "Save as PDF" to get a PDF). */
export async function printChat(conv: Conversation, peers: Peer[], myName: string): Promise<void> {
  const messages = await api.getMessages(conv.id);
  let lastDay = "";
  const body = messages
    .map((m) => {
      const d = new Date(m.timestamp * 1000);
      const day = d.toLocaleDateString([], { weekday: "long", year: "numeric", month: "long", day: "numeric" });
      const head = day !== lastDay ? `<h3>${esc(day)}</h3>` : "";
      lastDay = day;
      const who = senderName(m, conv, peers, myName);
      const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      if (!who) return `${head}<p class="ev">${esc(plainText(m))} · ${time}</p>`;
      return `${head}<div class="m${m.is_outgoing ? " me" : ""}"><div class="h"><b>${esc(who)}</b><span>${time}</span></div><div class="t">${esc(plainText(m)).replace(/\n/g, "<br>")}</div></div>`;
    })
    .join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>LANX chat - ${esc(conv.peer_name)}</title>
<style>
  @page { margin: 16mm 14mm; }
  body { font: 11pt "Segoe UI", system-ui, sans-serif; color: #0f172a; }
  header { border-bottom: 2px solid #0ea5e9; padding-bottom: 6px; margin-bottom: 10px; }
  header h1 { font-size: 16pt; margin: 0; } header p { margin: 2px 0 0; color: #64748b; font-size: 9pt; }
  h3 { font-size: 9.5pt; color: #64748b; text-transform: uppercase; letter-spacing: .04em; margin: 14px 0 6px; border-bottom: 1px solid #e2e8f0; padding-bottom: 2px; }
  .m { margin: 0 0 7px; padding: 6px 9px; border-radius: 8px; background: #f1f5f9; break-inside: avoid; }
  .m.me { background: #e0f2fe; }
  .h { display: flex; justify-content: space-between; font-size: 9pt; color: #475569; margin-bottom: 2px; }
  .t { white-space: normal; word-wrap: break-word; }
  .ev { text-align: center; color: #64748b; font-size: 9pt; margin: 6px 0; }
</style></head><body>
<header><h1>${esc(conv.peer_name)}</h1><p>LANX chat · ${messages.length} messages · exported ${esc(new Date().toLocaleString())} by ${esc(myName)}</p></header>
${body || "<p>No messages.</p>"}
</body></html>`;
  const frame = document.createElement("iframe");
  frame.setAttribute("data-print-frame", "");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(html);
  doc.close();
  await new Promise((r) => setTimeout(r, 300));
  frame.contentWindow?.focus();
  frame.contentWindow?.print();
  setTimeout(() => frame.remove(), 60_000);
}
