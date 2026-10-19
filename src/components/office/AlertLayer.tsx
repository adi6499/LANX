import { useState } from "react";
import { Check, ChevronDown, ChevronUp, HandHelping, ShieldCheck } from "lucide-react";
import type { AlertInfo } from "../../types";
import { alertKind, needsAnswer, stillOn } from "../../lib/office";

/** LANX 1.8.0: emergency alerts. A colleague's alert covers the whole window
 *  (with an alarm) until you answer; your own alert shows who has answered. */
export function AlertLayer({
  alerts,
  onAnswer,
  onClear,
}: {
  alerts: AlertInfo[];
  onAnswer: (id: string, status: "safe" | "help") => void;
  onClear: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const now = Date.now() / 1000;
  const incoming = alerts.find((a) => needsAnswer(a, now));
  const mine = alerts.find((a) => a.mine && stillOn(a, now));
  const answered = alerts.find((a) => !a.mine && a.my_ack && stillOn(a, now));
  const time = (t: number) => new Date(t * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  if (incoming) {
    const k = alertKind(incoming.kind);
    return (
      <div data-alert-overlay={incoming.id} className="fixed inset-0 z-[95] flex items-center justify-center bg-red-700/95 text-white lanx-fade">
        <div className="absolute inset-0 animate-pulse bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.18),transparent_60%)] pointer-events-none" />
        <div className="relative flex max-w-xl flex-col items-center px-8 text-center">
          <div className="text-[96px] leading-none drop-shadow-lg">{k.emoji}</div>
          <div className="mt-4 text-[13px] font-black uppercase tracking-[0.3em] text-white/80">Emergency</div>
          <h1 className="mt-2 text-3xl font-extrabold leading-tight">{incoming.text}</h1>
          <p className="mt-3 text-sm text-white/80">
            From {incoming.from_name} · {time(incoming.at)}
          </p>
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <button
              type="button"
              data-alert-safe
              disabled={busy}
              onClick={() => {
                setBusy(true);
                onAnswer(incoming.id, "safe");
                setTimeout(() => setBusy(false), 1500);
              }}
              className="inline-flex items-center gap-2 rounded-full bg-white px-7 py-3.5 text-lg font-bold text-emerald-700 shadow-xl hover:scale-[1.03] active:scale-95 transition-transform"
            >
              <ShieldCheck className="h-6 w-6" /> I'm safe
            </button>
            <button
              type="button"
              data-alert-help
              disabled={busy}
              onClick={() => {
                setBusy(true);
                onAnswer(incoming.id, "help");
                setTimeout(() => setBusy(false), 1500);
              }}
              className="inline-flex items-center gap-2 rounded-full border-2 border-white px-7 py-3.5 text-lg font-bold text-white hover:bg-white/10 active:scale-95 transition-transform"
            >
              <HandHelping className="h-6 w-6" /> I need help
            </button>
          </div>
          <p className="mt-6 text-[12px] text-white/70">{incoming.from_name} sees your answer. The alarm stops when you answer.</p>
        </div>
      </div>
    );
  }

  if (mine) {
    const k = alertKind(mine.kind);
    const help = mine.acks.filter((a) => a.status === "help");
    const waiting = mine.sent_to.filter((n) => !mine.acks.some((a) => a.name === n));
    return (
      <div data-my-alert={mine.id} className="fixed top-0 inset-x-0 z-[65] bg-red-600 text-white shadow-lg lanx-fade">
        <div className="flex items-center gap-3 px-4 py-2 text-[13px]">
          <span className="text-lg">{k.emoji}</span>
          <span className="font-bold">Your emergency alert is out</span>
          <span className="text-white/85" data-my-alert-count>
            {mine.acks.length} of {mine.sent_to.length} answered{help.length ? ` · ${help.length} need help!` : ""}
          </span>
          <button type="button" onClick={() => setOpen((o) => !o)} className="ml-auto inline-flex items-center gap-1 rounded-full bg-white/15 px-3 py-1 font-semibold hover:bg-white/25">
            Who {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
          <button type="button" data-alert-clear onClick={() => onClear(mine.id)} className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 font-bold text-red-700 hover:bg-red-50">
            <Check className="h-3.5 w-3.5" /> All clear
          </button>
        </div>
        {open && (
          <div className="grid gap-x-6 gap-y-1 px-12 pb-3 text-[12px] sm:grid-cols-2">
            {help.map((a) => (
              <div key={a.peer_id} className="font-bold">🆘 {a.name} needs help</div>
            ))}
            {mine.acks
              .filter((a) => a.status === "safe")
              .map((a) => (
                <div key={a.peer_id}>✅ {a.name} is safe</div>
              ))}
            {waiting.map((n) => (
              <div key={n} className="text-white/70">… {n} hasn't answered</div>
            ))}
            {mine.sent_to.length === 0 && <div className="text-white/80">Nobody was online to get it.</div>}
          </div>
        )}
      </div>
    );
  }

  if (answered) {
    const k = alertKind(answered.kind);
    return (
      <div data-alert-answered className="fixed top-0 inset-x-0 z-[65] bg-red-600/95 text-white text-[12.5px] px-4 py-1.5 text-center shadow lanx-fade">
        {k.emoji} <b>Emergency</b> from {answered.from_name}: {answered.text} — you said{" "}
        <b>{answered.my_ack === "help" ? "you need help" : "you're safe"}</b>. This goes away when they call the all-clear.
      </div>
    );
  }
  return null;
}
