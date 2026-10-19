import { useState } from "react";
import { FolderOpen, Loader2, Server } from "lucide-react";
import type { BackupOverview } from "../../types";
import { api, errorText } from "../../lib/api";

/** LANX 1.9.0: a locked copy of each daily backup on a network folder
 *  (another PC's shared folder or a NAS), the newest 7 kept. */
export function NetworkBackup({
  data,
  onChange,
  onMsg,
}: {
  data: BackupOverview;
  onChange: (d: BackupOverview) => void;
  onMsg: (m: { ok: boolean; text: string }) => void;
}) {
  const [dir, setDir] = useState(data.net_dir ?? "");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const locked = !!data.net_locked;
  const field = "lanx-field w-full rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white disabled:opacity-60";
  const go = async (key: string, f: () => Promise<BackupOverview>, ok: string) => {
    setBusy(key);
    try {
      const d = await f();
      onChange(d);
      onMsg(d.net_error ? { ok: false, text: d.net_error } : { ok: true, text: ok });
    } catch (e) {
      onMsg({ ok: false, text: errorText(e) });
    } finally {
      setBusy(null);
    }
  };
  return (
    <div data-net-backup className="rounded-xl lanx-group p-3 space-y-2">
      <div className="flex items-start gap-2">
        <Server className="h-4 w-4 mt-0.5 text-sky-500 shrink-0" />
        <div>
          <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">Also copy backups to a network folder</div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
            Each daily backup is also saved, locked with a password, in a shared folder on another computer or a network drive — so your chats survive even if this PC breaks. The newest 7 are kept.
          </div>
        </div>
      </div>
      {locked ? (
        <div className="rounded-lg bg-indigo-500/10 px-3 py-2 text-[11.5px] text-indigo-700 dark:text-indigo-300">
          Your LANX admin set this: <b className="break-all">{data.net_dir}</b>
        </div>
      ) : (
        <>
          <div className="flex gap-2">
            <input data-net-dir value={dir} onChange={(e) => setDir(e.target.value)} placeholder="\\SERVER\Backups  or  Z:\LANX Backups" className={field} />
            <button
              type="button"
              title="Choose a folder"
              onClick={() => api.pickFolder("Choose the network folder for backup copies").then((d) => d && setDir(d)).catch(() => {})}
              className="shrink-0 rounded-xl lanx-btn px-2.5 text-slate-600 dark:text-slate-300"
            >
              <FolderOpen className="h-4 w-4" />
            </button>
          </div>
          {dir.trim() && (
            <input
              data-net-pw
              type="password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              placeholder={data.net_has_password ? "Password (leave empty to keep the current one)" : "Password for the copies (at least 6 characters)"}
              className={field}
            />
          )}
          <button
            type="button"
            data-net-save
            disabled={!!busy}
            onClick={() => go("save", () => api.setNetBackup(dir.trim(), pw || null), dir.trim() ? "Saved. The next daily backup is copied there too." : "Network copies turned off.")}
            className="rounded-full bg-sky-500 hover:bg-sky-600 px-3 py-1.5 text-[11.5px] font-semibold text-white disabled:opacity-50"
          >
            {dir.trim() ? "Save" : "Turn off"}
          </button>
        </>
      )}
      {data.net_dir && (
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
          <span data-net-status>
            {data.net_error ? <span className="text-red-600">⚠️ {data.net_error}</span> : data.net_last_at ? `Last copy: ${new Date(data.net_last_at * 1000).toLocaleString()}` : "No copy yet."}
          </span>
          <button
            type="button"
            data-net-now
            disabled={!!busy}
            onClick={() => go("now", () => api.netBackupNow(), "Backed up and copied to the network folder.")}
            className="ml-auto inline-flex items-center gap-1 rounded-full lanx-btn px-2.5 py-1 font-semibold text-slate-700 dark:text-slate-200 disabled:opacity-50"
          >
            {busy === "now" && <Loader2 className="h-3 w-3 animate-spin" />} Copy now
          </button>
        </div>
      )}
      <p className="text-[10.5px] text-slate-400">To restore one: Settings → Backups → “Restore from a file”, choose the copy and type its password.</p>
    </div>
  );
}
