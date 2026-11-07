/** LANX 3.9.0: pieces every "together" activity uses — choosing colleagues, my
 *  name, the sessions and invites as they change, the sheet around a screen. */
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { api } from "../../lib/api";
import { type Invite, type Session, together } from "../../lib/together";
import type { Peer } from "../../types";

export function useTogether(): { sessions: Session[]; invites: Invite[] } {
  return useSyncExternalStore(together.subscribe, together.snapshot, together.snapshot);
}

/** This PC's name as colleagues see it. */
export function useMyName(): string {
  const [name, setName] = useState("");
  useEffect(() => {
    api.getSettings().then((s) => setName(s.display_name)).catch(() => {});
  }, []);
  return name;
}

/** Colleagues online now (not blocked). */
export function useOnline(): Peer[] | null {
  const [peers, setPeers] = useState<Peer[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => api.listPeers().then((l) => alive && setPeers(l.filter((p) => p.status === "online" && p.trust_state !== "blocked"))).catch(() => alive && setPeers([]));
    void load();
    const t = window.setInterval(load, 5000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, []);
  return peers;
}

export const initials = (n: string) =>
  n
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("") || "?";

/** Tick colleagues (or Everyone). `failed`: why someone couldn't be reached. */
export function PeoplePicker({ picked, onChange, failed = {}, exclude = [] }: { picked: Record<string, boolean>; onChange: (p: Record<string, boolean>) => void; failed?: Record<string, string>; exclude?: string[] }) {
  const peers = useOnline();
  const online = useMemo(() => (peers ?? []).filter((p) => !exclude.includes(p.id)), [peers, exclude]);
  const all = online.length > 0 && online.every((p) => picked[p.id]);
  return (
    <div data-people-picker>
      <div className="flex items-center justify-between">
        <div className="text-[12px] font-semibold text-slate-500">{online.length ? "Who's online" : peers ? "Nobody else is online right now." : "Looking…"}</div>
        {online.length > 1 && (
          <button type="button" data-people-all onClick={() => onChange(all ? {} : Object.fromEntries(online.map((p) => [p.id, true])))} className="text-[12px] font-semibold text-sky-600 dark:text-sky-400">
            {all ? "Clear" : "Everyone"}
          </button>
        )}
      </div>
      <div className="mt-1.5 max-h-[220px] space-y-0.5 overflow-y-auto pr-1">
        {online.map((p) => (
          <label key={p.id} data-people-peer={p.id} className={`flex cursor-pointer items-center gap-3 rounded-xl px-2.5 py-1.5 ${picked[p.id] ? "bg-[var(--lanx-fill)]" : "hover:bg-[var(--lanx-fill)]"}`}>
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white" style={{ background: p.avatar_color || "#64748b" }}>
              {initials(p.display_name)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold text-slate-800 dark:text-slate-100">{p.display_name}</span>
              {failed[p.id] && <span className="block text-[11.5px] text-amber-600 dark:text-amber-400">{failed[p.id]}</span>}
            </span>
            <input type="checkbox" checked={!!picked[p.id]} onChange={(e) => onChange({ ...picked, [p.id]: e.target.checked })} className="h-4 w-4 accent-sky-500" />
          </label>
        ))}
      </div>
    </div>
  );
}
/** The chosen people, as the together layer wants them. */
export function chosen(peers: Peer[] | null, picked: Record<string, boolean>) {
  return (peers ?? []).filter((p) => picked[p.id]).map((p) => ({ id: p.id, name: p.display_name }));
}

/** A plain sheet (the app's look) over a dim window. Esc closes. */
export function Sheet({ title, subtitle, icon, onClose, children, wide = false, tag }: { title: string; subtitle?: string; icon?: React.ReactNode; onClose: () => void; children: React.ReactNode; wide?: boolean; tag?: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/30 p-3 lanx-fade" onMouseDown={onClose}>
      <div data-together-sheet={tag} className={`${wide ? "w-[860px]" : "w-[460px]"} max-h-[90vh] max-w-[96vw] overflow-y-auto rounded-[22px] lanx-sheet p-5 lanx-rise`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            {icon && <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-sky-500/15 text-sky-600 dark:text-sky-400">{icon}</span>}
            <div>
              <div className="text-[17px] font-bold tracking-tight text-slate-900 dark:text-white">{title}</div>
              {subtitle && <div className="text-[12px] text-slate-500">{subtitle}</div>}
            </div>
          </div>
          <button type="button" onClick={onClose} title="Close" className="lanx-tool p-1.5 text-slate-400">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

export const primaryBtn = "inline-flex w-full items-center justify-center gap-2 rounded-full bg-sky-500 py-2.5 text-[13.5px] font-bold text-white hover:bg-sky-600 disabled:opacity-40";
export const secondaryBtn = "inline-flex items-center justify-center gap-1.5 rounded-full border border-[var(--lanx-line)] px-3.5 py-2 text-[12.5px] font-semibold text-slate-700 hover:bg-[var(--lanx-fill)] dark:text-slate-200";

/** One column at the top right for every invite (music, quiz, presenting, video): they stack, never overlap. */
export function InviteStack({ children }: { children: React.ReactNode }) {
  const [el] = useState(() => {
    let d = document.getElementById("lanx-invite-stack");
    if (!d) {
      d = document.createElement("div");
      d.id = "lanx-invite-stack";
      d.className = "pointer-events-none fixed right-6 top-16 z-[90] flex w-[360px] max-w-[92vw] flex-col gap-2";
      document.body.appendChild(d);
    }
    return d;
  });
  return createPortal(children, el);
}
