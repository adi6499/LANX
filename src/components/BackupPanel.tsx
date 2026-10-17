import React, { useCallback, useEffect, useState } from "react";
import { BackupInfo, BackupOverview, PickedBackup } from "../types";
import { api, errorText } from "../lib/api";
import { formatSize } from "../lib/format";
import {
  DatabaseBackup,
  Clock,
  HardDrive,
  Undo2,
  Upload,
  FileLock2,
  FolderOpen,
  RotateCcw,
  Loader2,
  CircleCheck,
  CircleAlert,
  X,
} from "lucide-react";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function when(ts: number): string {
  const d = new Date(ts * 1000);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === today.toDateString()) return `Today, ${time}`;
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday, ${time}`;
  return `${d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}, ${time}`;
}

const KIND: Record<string, { label: string; Icon: React.ComponentType<{ className?: string }>; tint: string }> = {
  auto: { label: "Automatic", Icon: Clock, tint: "text-emerald-600 bg-emerald-500/10" },
  manual: { label: "Saved by you", Icon: HardDrive, tint: "text-sky-600 bg-sky-500/10" },
  "before-restore": { label: "Before a restore (undo)", Icon: Undo2, tint: "text-amber-600 bg-amber-500/10" },
  imported: { label: "From a file", Icon: Upload, tint: "text-violet-600 bg-violet-500/10" },
  file: { label: "Backup", Icon: DatabaseBackup, tint: "text-slate-600 bg-slate-500/10" },
};

const field =
  "w-full rounded-xl lanx-field px-3 py-2 text-xs text-slate-900 dark:text-white select-text focus:outline-none focus:ring-2 focus:ring-sky-500";

type Confirm =
  | { kind: "list"; backup: BackupInfo }
  | { kind: "file"; picked: PickedBackup };

/** Settings → Backup: automatic daily backups, "Back up now", restore, and
 *  password-protected backup files for a USB drive or a new computer. */
export function BackupPanel() {
  const [data, setData] = useState<BackupOverview | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [filePassword, setFilePassword] = useState("");
  const [exporting, setExporting] = useState(false);
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [restarting, setRestarting] = useState(false);

  const load = useCallback(() => {
    api.getBackups().then(setData).catch((e) => setMsg({ ok: false, text: errorText(e) }));
  }, []);
  useEffect(load, [load]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      const text = errorText(e);
      if (text !== "PASSWORD") setMsg({ ok: false, text });
    } finally {
      setBusy(null);
    }
  };

  const backupNow = () =>
    run("now", async () => {
      const b = await api.backupNow();
      setMsg({ ok: true, text: `Backed up: ${plural(b.messages, "message")} in ${plural(b.conversations, "chat")}.` });
      load();
    });

  const toggleAuto = (enabled: boolean) =>
    run("auto", async () => {
      setData(await api.setAutoBackup(enabled));
    });

  const doRestore = () => {
    if (!confirm) return;
    run("restore", async () => {
      if (confirm.kind === "list") {
        await api.restoreBackup(confirm.backup.file_name);
      } else {
        await api.restoreBackupFile(confirm.picked.path, confirm.picked.encrypted ? filePassword : null);
      }
      setConfirm(null);
      setRestarting(true);
    });
  };

  const pickFile = () =>
    run("pick", async () => {
      const picked = await api.pickBackupFile();
      if (picked) {
        setFilePassword("");
        setConfirm({ kind: "file", picked });
      }
    });

  const saveFile = () => {
    if (pw1 !== pw2) {
      setMsg({ ok: false, text: "The two passwords don't match." });
      return;
    }
    run("export", async () => {
      const where = await api.exportBackup(pw1);
      if (where) {
        setMsg({ ok: true, text: `Saved to ${where}. Keep the password safe — without it the file can't be opened.` });
        setExporting(false);
        setPw1("");
        setPw2("");
      }
    });
  };

  if (restarting) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center gap-3 py-16">
        <Loader2 className="h-8 w-8 text-sky-500 animate-spin" />
        <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">Restoring your chats…</div>
        <div className="text-xs text-slate-500 max-w-xs">LANX is closing and will open again in a few seconds.</div>
      </div>
    );
  }

  const latest = data?.backups[0];
  const autoOn = data?.auto_enabled ?? true;

  return (
    <div className="space-y-4">
      {/* Status */}
      <div className="rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 p-5 text-white shadow-lg">
        <div className="flex items-start gap-3">
          <div className="h-11 w-11 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
            <DatabaseBackup className="h-6 w-6" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold">
              {latest ? "Your chats are backed up" : "No backup yet"}
            </div>
            <div className="text-[11px] text-emerald-50/90 mt-0.5 leading-snug">
              {latest
                ? `Last backup: ${when(latest.created_at)} · ${plural(latest.messages, "message")} in ${plural(latest.conversations, "chat")}`
                : "Make one now — it only takes a second."}
            </div>
          </div>
          <button
            type="button"
            onClick={backupNow}
            disabled={!!busy}
            className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white text-emerald-700 text-xs font-bold shadow hover:bg-emerald-50 disabled:opacity-60"
          >
            {busy === "now" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <DatabaseBackup className="h-3.5 w-3.5" />}
            Back up now
          </button>
        </div>
      </div>

      {msg && (
        <div
          className={`flex items-start gap-2 rounded-xl px-3 py-2 text-[11px] ${
            msg.ok ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-red-500/10 text-red-700 dark:text-red-300"
          }`}
        >
          {msg.ok ? <CircleCheck className="h-3.5 w-3.5 shrink-0 mt-px" /> : <CircleAlert className="h-3.5 w-3.5 shrink-0 mt-px" />}
          <span className="select-text break-all">{msg.text}</span>
        </div>
      )}

      {/* Automatic */}
      <label className="flex items-start justify-between gap-4 p-3 rounded-xl lanx-group cursor-pointer">
        <span>
          <span className="block text-xs font-semibold text-slate-800 dark:text-slate-200">Back up automatically every day</span>
          <span className="block text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
            LANX quietly saves a copy of your chats once a day and keeps the last 7, so you can go back if something goes wrong.
          </span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={autoOn}
          aria-label="Back up automatically every day"
          onClick={() => toggleAuto(!autoOn)}
          className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors ${autoOn ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-700"}`}
        >
          <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${autoOn ? "left-[18px]" : "left-0.5"}`} />
        </button>
      </label>

      {/* Restore list */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs font-bold text-slate-800 dark:text-slate-200">Go back to an earlier backup</div>
          <button
            type="button"
            onClick={() => api.revealBackupsFolder().catch(() => {})}
            className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-sky-600"
          >
            <FolderOpen className="h-3.5 w-3.5" /> Open folder
          </button>
        </div>
        {data && data.backups.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-4 text-center text-[11px] text-slate-500">
            Backups will appear here.
          </div>
        )}
        <div className="space-y-1.5">
          {data?.backups.map((b) => {
            const k = KIND[b.kind] || KIND.file;
            return (
              <div
                key={b.file_name}
                data-backup={b.file_name}
                className="flex items-center gap-3 rounded-xl lanx-group px-3 py-2.5"
              >
                <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${k.tint}`}>
                  <k.Icon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-slate-800 dark:text-slate-100">{when(b.created_at)}</div>
                  <div className="text-[11px] text-slate-500 truncate">
                    {k.label} · {plural(b.messages, "message")} · {plural(b.conversations, "chat")} · {formatSize(b.size_bytes)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setConfirm({ kind: "list", backup: b })}
                  disabled={!!busy}
                  className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg lanx-btn text-[11px] font-semibold text-slate-700 dark:text-slate-200 disabled:opacity-50"
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Restore
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Files */}
      <div className="rounded-xl lanx-group p-3 space-y-2">
        <div className="text-xs font-bold text-slate-800 dark:text-slate-200">New computer, or a copy on a USB drive</div>
        <p className="text-[11px] text-slate-500 leading-snug">
          Save a backup file protected by a password, then use “Restore from a file” on the new computer.
        </p>
        {!exporting ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setExporting(true);
                setMsg(null);
              }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-sky-500 text-white text-xs font-semibold hover:bg-sky-600"
            >
              <FileLock2 className="h-3.5 w-3.5" /> Save a backup file…
            </button>
            <button
              type="button"
              onClick={pickFile}
              disabled={!!busy}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl lanx-field text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-[var(--lanx-fill)]"
            >
              <Upload className="h-3.5 w-3.5" /> Restore from a file…
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex gap-2">
              <input type="password" placeholder="Choose a password (6+ characters)" value={pw1} onChange={(e) => setPw1(e.target.value)} className={field} />
              <input type="password" placeholder="Repeat the password" value={pw2} onChange={(e) => setPw2(e.target.value)} className={field} />
            </div>
            <div className="flex justify-end gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setExporting(false);
                  setPw1("");
                  setPw2("");
                }}
                className="px-3 py-1.5 rounded-lg text-[11px] text-slate-600 dark:text-slate-300 hover:bg-[var(--lanx-fill)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveFile}
                disabled={pw1.length < 6 || !pw2 || !!busy}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-sky-500 text-white text-[11px] font-semibold disabled:opacity-40"
              >
                {busy === "export" && <Loader2 className="h-3 w-3 animate-spin" />} Choose where to save…
              </button>
            </div>
          </div>
        )}
      </div>

      <p className="text-[11px] text-slate-400 leading-snug">
        Backups contain your chats, contacts, groups and settings (including your PIN at that time). Files you received stay in your
        Downloads folder and are not part of the backup. Secret messages are never backed up.
      </p>

      {/* Confirm restore */}
      {confirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center lanx-scrim p-4">
          <div className="w-full max-w-sm rounded-[22px] lanx-sheet lanx-sheet-in p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="h-10 w-10 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center shrink-0">
                <RotateCcw className="h-5 w-5" />
              </div>
              <button type="button" onClick={() => setConfirm(null)} className="p-1 rounded-lg text-slate-400 hover:bg-[var(--lanx-fill)]">
                <X className="h-4 w-4" />
              </button>
            </div>
            <h4 className="mt-3 text-sm font-bold text-slate-900 dark:text-white">
              {confirm.kind === "list"
                ? `Restore chats from ${when(confirm.backup.created_at)}?`
                : confirm.picked.info
                  ? `Restore chats from ${when(confirm.picked.info.created_at)}?`
                  : "Restore chats from this file?"}
            </h4>
            {confirm.kind === "file" && (
              <p className="mt-1 text-[11px] text-slate-500 break-all select-text">{confirm.picked.path}</p>
            )}
            <p className="mt-2 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              Your chats will go back to how they were in this backup. LANX will close and open again.
            </p>
            <p className="mt-2 text-[11px] text-slate-500 leading-relaxed">
              Changed your mind later? LANX first saves how things are right now, so you can undo this from the same list (“Before a restore”).
            </p>
            {confirm.kind === "file" && (confirm.picked.info?.display_name || "") !== "" && (
              <p className="mt-2 text-[11px] text-slate-500">
                This backup belongs to <b>{confirm.picked.info?.display_name}</b>. If you are moving to a new computer, stop using LANX on the old one afterwards.
              </p>
            )}
            {confirm.kind === "file" && confirm.picked.encrypted && (
              <input
                type="password"
                autoFocus
                placeholder="Password of this backup file"
                value={filePassword}
                onChange={(e) => setFilePassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && filePassword && doRestore()}
                className={field + " mt-3"}
              />
            )}
            {msg && !msg.ok && <p className="mt-2 text-[11px] text-red-600">{msg.text}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setConfirm(null);
                  setMsg(null);
                }}
                className="px-3 py-2 rounded-xl text-xs text-slate-600 dark:text-slate-300 hover:bg-[var(--lanx-fill)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={doRestore}
                disabled={!!busy || (confirm.kind === "file" && confirm.picked.encrypted && !filePassword)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-amber-500 text-white text-xs font-bold hover:bg-amber-600 disabled:opacity-50"
              >
                {busy === "restore" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Restore and restart
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
