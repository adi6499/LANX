/** LANX 3.7.0: the "What's new" window after an update (and from Settings → Updates). */
import { X } from "lucide-react";
import type { Release } from "../lib/whatsNew";

export function WhatsNewModal({ releases, onClose, onTry, tryLabel = "Open Gesture settings" }: { releases: Release[]; onClose: () => void; onTry?: () => void; tryLabel?: string }) {
  const [first, ...older] = releases;
  if (!first) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30 backdrop-blur-sm lanx-fade" onMouseDown={onClose}>
      <div data-whats-new={first.version} role="dialog" aria-label={`What's new in LANX ${first.version}`} className="w-[520px] max-w-[94vw] max-h-[88vh] overflow-y-auto rounded-[22px] lanx-sheet p-6 lanx-rise" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[12px] font-semibold uppercase tracking-wide text-sky-600 dark:text-sky-400">What's new in LANX {first.version}</div>
            <h2 className="mt-1 text-[22px] font-bold leading-tight text-slate-900 dark:text-white">{first.title}</h2>
          </div>
          <button type="button" onClick={onClose} title="Close" className="lanx-tool -mr-1 -mt-1 p-1 text-slate-400"><X className="h-4 w-4" /></button>
        </div>
        <ul className="mt-5 space-y-4">
          {first.items.map((it) => (
            <li key={it.title} className="flex gap-3.5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl lanx-group text-[20px]">{it.icon}</span>
              <span className="min-w-0">
                <span className="block text-[14px] font-semibold text-slate-900 dark:text-white">{it.title}</span>
                <span className="block text-[12.5px] leading-snug text-slate-600 dark:text-slate-300">{it.text}</span>
              </span>
            </li>
          ))}
        </ul>
        {older.length > 0 && (
          <div className="mt-5 border-t border-[var(--lanx-line)] pt-4">
            <div className="text-[11.5px] font-semibold uppercase tracking-wide text-slate-400">Also new since your last update</div>
            {older.map((r) => (
              <div key={r.version} className="mt-2">
                <div className="text-[12.5px] font-semibold text-slate-800 dark:text-slate-100">LANX {r.version} — {r.title}</div>
                <div className="text-[12px] text-slate-500">{r.items.map((i) => `${i.icon} ${i.title}`).join(" · ")}</div>
              </div>
            ))}
          </div>
        )}
        <div className="mt-6 flex justify-end gap-2">
          {onTry && (
            <button type="button" data-whats-new-try onClick={onTry} className="rounded-full px-4 py-2 text-[13px] font-semibold text-sky-700 dark:text-sky-300 hover:bg-[var(--lanx-fill)]">
              {tryLabel}
            </button>
          )}
          <button type="button" data-whats-new-ok onClick={onClose} className="rounded-full bg-sky-500 px-5 py-2 text-[13px] font-semibold text-white hover:bg-sky-600">
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
