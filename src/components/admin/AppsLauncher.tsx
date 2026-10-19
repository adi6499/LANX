import { useEffect, useState } from "react";
import { LayoutGrid, Settings2 } from "lucide-react";
import type { AppView } from "../../types";
import { api, errorText, events } from "../../lib/api";

/** LANX 1.9.0: the Apps launcher — company and personal links (web pages,
 *  shared folders, files) one click away. */
export function AppsLauncher({ onEdit, onError }: { onEdit: () => void; onError: (t: string) => void }) {
  const [open, setOpen] = useState(false);
  const [apps, setApps] = useState<AppView[]>([]);
  const load = () =>
    api
      .getAdminState()
      .then((s) => setApps(s.apps))
      .catch(() => {});
  useEffect(() => {
    void load();
    let un: (() => void) | undefined;
    let gone = false;
    events.onAdminChanged(load).then((u) => (gone ? u() : (un = u)));
    return () => {
      gone = true;
      un?.();
    };
  }, []);
  useEffect(() => {
    if (!open) return;
    void load();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open]);

  return (
    <div className="relative">
      <button
        type="button"
        data-open-apps
        onClick={() => setOpen((o) => !o)}
        title="Apps: company websites, shared folders and files"
        className={`lanx-tool flex h-8 w-8 items-center justify-center text-violet-600 dark:text-violet-300 ${open ? "!bg-[var(--lanx-fill)]" : ""}`}
      >
        <LayoutGrid className="h-[17px] w-[17px]" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div data-apps-menu className="absolute left-0 top-9 z-40 w-72 rounded-[16px] lanx-menu p-3 lanx-menu-in">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[12.5px] font-bold text-slate-900 dark:text-white">Apps</span>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onEdit();
                }}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-sky-600 hover:underline"
              >
                <Settings2 className="h-3 w-3" /> Edit
              </button>
            </div>
            {apps.length === 0 ? (
              <p className="py-4 text-center text-[11.5px] text-slate-500 dark:text-slate-400">
                No apps yet. Press <b>Edit</b> to add your company's websites, shared folders or files.
              </p>
            ) : (
              <div className="grid grid-cols-3 gap-1.5">
                {apps.map((a) => (
                  <button
                    key={a.target}
                    type="button"
                    data-app={a.name}
                    title={`${a.target}${a.office ? " (from your LANX admin)" : ""}`}
                    onClick={() => {
                      setOpen(false);
                      api.openAppLink(a.target).catch((e) => onError(errorText(e)));
                    }}
                    className="flex flex-col items-center gap-1 rounded-xl px-1 py-2 hover:bg-[var(--lanx-fill)] transition-colors"
                  >
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--lanx-fill)] text-[22px]">{a.emoji || "🌐"}</span>
                    <span className="w-full truncate text-center text-[10.5px] font-semibold text-slate-700 dark:text-slate-200">{a.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** "Asha wants to manage LANX settings for the office" — yes / no. */
export function PolicyOfferDialog({
  offer,
  onAnswer,
}: {
  offer: { admin_name: string; apps: { name: string }[]; retention_days: number; backup_dir: string };
  onAnswer: (accept: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 backdrop-blur-sm lanx-fade">
      <div data-policy-offer className="w-[420px] max-w-[92vw] rounded-[22px] lanx-menu p-5 shadow-2xl lanx-rise">
        <div className="text-[15px] font-bold text-slate-900 dark:text-white">🛡️ {offer.admin_name} is the LANX admin</div>
        <p className="mt-1 text-[12.5px] text-slate-600 dark:text-slate-300">They'd like this computer to use the office's LANX settings:</p>
        <ul className="mt-2 space-y-1 text-[12.5px] text-slate-700 dark:text-slate-200">
          <li>📱 {offer.apps.length ? `${offer.apps.length} company app${offer.apps.length === 1 ? "" : "s"} in your Apps button` : "Company apps in your Apps button"}</li>
          {offer.retention_days > 0 && <li>🧹 Messages older than {offer.retention_days} days are deleted (starred ones stay)</li>}
          {offer.backup_dir && <li>💾 A locked copy of your daily backup goes to {offer.backup_dir}</li>}
        </ul>
        <p className="mt-2 text-[11.5px] text-slate-500 dark:text-slate-400">They can't read your messages. You can stop following any time (Admin → Office settings).</p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            data-policy-no
            disabled={busy}
            onClick={() => {
              setBusy(true);
              onAnswer(false);
            }}
            className="rounded-full px-4 py-2 text-[12.5px] font-semibold text-slate-600 dark:text-slate-300 hover:bg-[var(--lanx-fill)]"
          >
            No thanks
          </button>
          <button
            type="button"
            data-policy-yes
            disabled={busy}
            onClick={() => {
              setBusy(true);
              onAnswer(true);
            }}
            className="rounded-full bg-indigo-500 hover:bg-indigo-600 px-4 py-2 text-[12.5px] font-semibold text-white"
          >
            Use the office settings
          </button>
        </div>
      </div>
    </div>
  );
}
