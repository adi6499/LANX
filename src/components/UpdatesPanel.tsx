import React, { useState } from "react";
import { ColleagueUpdate, UpdateStatus } from "../types";
import { api, errorText } from "../lib/api";
import { formatSize } from "../lib/format";
import { ArrowUpCircle, CircleCheck, FileCheck2, Loader2, MessageSquare, ShieldCheck, Share2, Users } from "lucide-react";

interface UpdatesPanelProps {
  status: UpdateStatus | null;
  installing: boolean;
  onInstall: () => void;
  onChanged: () => void;
}

function stateLabel(c: ColleagueUpdate): { text: string; tone: string } {
  const v = c.app_version ? `LANX ${c.app_version}` : "";
  const amber = "text-amber-600 dark:text-amber-400";
  const sky = "text-sky-600 dark:text-sky-400";
  const green = "text-emerald-600 dark:text-emerald-400";
  switch (c.state) {
    case "up_to_date":
      return { text: `${v} · up to date`, tone: green };
    case "behind":
      return { text: `${v} · behind`, tone: amber };
    case "old_version":
      return { text: `${v} · too old for automatic updates: send it in chat`, tone: amber };
    case "chat_sent":
      return { text: `${v} · installer sent in their chat, waiting for them to open it`, tone: sky };
    case "waiting":
      return { text: `${v} · gets it when they come online`, tone: "text-slate-500" };
    case "offered":
      return { text: `${v} · offered, downloading soon`, tone: sky };
    case "downloading":
      return { text: `${v} · downloading it now…`, tone: sky };
    case "received":
      return { text: `${v} · has it, waiting for them to click Update LANX now`, tone: sky };
    case "declined":
      return { text: c.detail || "Not needed", tone: "text-slate-500" };
    case "failed":
      return { text: c.detail || "Something went wrong", tone: "text-red-600 dark:text-red-400" };
    case "not_offered":
      return { text: `${v} · offered the next time they come online`, tone: "text-slate-500" };
    default:
      return { text: "Version shows when they are next online", tone: "text-slate-400" };
  }
}

/** Settings → Updates: everyone on the same LANX version. */
export const UpdatesPanel: React.FC<UpdatesPanelProps> = ({ status, installing, onInstall, onChanged }) => {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [picked, setPicked] = useState<Record<string, boolean>>({});

  if (!status) {
    return <div className="text-xs text-slate-500">Loading…</div>;
  }
  const { available, sharing, colleagues, latest_version: latest } = status;
  const known = colleagues.filter((c) => c.app_version);
  const behind = colleagues.filter((c) => c.behind);
  const old = colleagues.filter((c) => c.state === "old_version" || c.state === "chat_sent");
  const chosenOld = old.filter((c) => picked[c.peer_id] ?? c.state === "old_version");
  const thisPcBehind = latest !== status.current_version && !available;

  const run = async (fn: () => Promise<string | void>) => {
    setBusy(true);
    setMsg(null);
    try {
      const text = await fn();
      if (text) setMsg({ ok: true, text });
      onChanged();
    } catch (err) {
      setMsg({ ok: false, text: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  const chooseInstaller = () =>
    run(async () => {
      const path = await api.pickUpdateInstaller();
      if (!path) return;
      const s = await api.shareUpdate(path);
      return `Sharing LANX ${s.version}. Colleagues get it automatically as they come online.`;
    });

  const sendInChat = () =>
    run(async () => {
      const r = await api.sendUpdateAsFile(chosenOld.map((c) => c.peer_id));
      const problems = r.problems.length ? `\n${r.problems.join("\n")}` : "";
      return `Sent the installer to ${r.sent_to} colleague${r.sent_to === 1 ? "" : "s"} in their chat. They open it from there.${problems}`;
    });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 p-3">
        <ArrowUpCircle className="h-5 w-5 text-sky-500 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">This PC runs LANX {status.current_version}</div>
          <div className="text-[11px] text-slate-500">
            {available
              ? available.state === "installing"
                ? `Installing LANX ${available.version}…`
                : available.state === "ready"
                  ? `LANX ${available.version} is downloaded and checked, ready to install.`
                  : `LANX ${available.version} is coming${available.from_name ? ` from ${available.from_name}` : ""}.`
              : thisPcBehind
                ? `A colleague runs LANX ${latest}. It is offered here as soon as a PC that has its installer is online.`
                : "This is the newest LANX on your network."}
          </div>
        </div>
        {available && (available.state === "ready" || available.state === "available" || available.state === "failed") && (
          <button
            type="button"
            onClick={onInstall}
            disabled={installing}
            className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-600 text-white text-[11px] font-semibold disabled:opacity-60"
          >
            {installing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {available.state === "ready" ? "Update LANX now" : "Update now"}
          </button>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3">
        <div className="flex items-center justify-between gap-2 mb-2">
          <span className="flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-200">
            <Users className="h-4 w-4 text-sky-500" /> Everyone's version
          </span>
          {known.length > 0 && (
            behind.length === 0 ? (
              <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                <CircleCheck className="h-3.5 w-3.5" /> Everyone is on LANX {latest}
              </span>
            ) : (
              <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                {behind.length} of {known.length} behind · newest is {latest}
              </span>
            )
          )}
        </div>
        {colleagues.length === 0 ? (
          <p className="text-[11px] text-slate-500">No colleagues found yet.</p>
        ) : (
          <div className="space-y-1">
            {colleagues.map((c) => {
              const l = stateLabel(c);
              const isOld = c.state === "old_version" || c.state === "chat_sent";
              return (
                <div key={c.peer_id} className="flex items-center gap-2 text-[11px]">
                  {sharing && isOld ? (
                    <input
                      type="checkbox"
                      checked={picked[c.peer_id] ?? c.state === "old_version"}
                      onChange={(e) => setPicked({ ...picked, [c.peer_id]: e.target.checked })}
                      className="accent-sky-500"
                    />
                  ) : (
                    <span className="w-[13px]" />
                  )}
                  <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${c.online ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-600"}`} />
                  <span className="font-semibold text-slate-700 dark:text-slate-200 truncate max-w-[35%]">{c.display_name}</span>
                  <span className={`truncate ${l.tone}`} title={c.detail ?? undefined}>{l.text}</span>
                </div>
              );
            })}
          </div>
        )}
        {sharing && old.length > 0 && (
          <div className="mt-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 p-2.5">
            <p className="text-[11px] text-amber-800 dark:text-amber-200 leading-snug">
              LANX 1.1 and older can't update by themselves. {status.auto_chat ? "LANX sends them the installer once as a chat file; " : "Send them the installer once as a chat file; "}
              they open it from the chat and click Yes. From then on, updates arrive by themselves.
            </p>
            <button
              type="button"
              disabled={busy || chosenOld.length === 0}
              onClick={sendInChat}
              className="mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-[11px] font-semibold disabled:opacity-50"
            >
              <MessageSquare className="h-3.5 w-3.5" />
              Send installer in chat ({chosenOld.length})
            </button>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-200">
            <Share2 className="h-4 w-4 text-sky-500" /> Share an update with colleagues
          </span>
          {sharing && (
            <span className="px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 text-[10px] font-semibold">On</span>
          )}
        </div>
        {sharing ? (
          <>
            <div className="mt-2 flex items-center gap-2.5 rounded-lg bg-slate-50 dark:bg-slate-900/60 px-3 py-2">
              <FileCheck2 className="h-4 w-4 text-emerald-600 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold text-slate-800 dark:text-slate-100 truncate">
                  LANX {sharing.version} · {sharing.file_name}
                </div>
                <div className="flex items-center gap-1 text-[11px] text-slate-500">
                  <ShieldCheck className="h-3 w-3 text-emerald-600" /> Official LANX release, checked · {formatSize(sharing.size)}
                </div>
              </div>
            </div>
            <p className="mt-2 text-[11px] text-slate-500 leading-snug">
              Every colleague with an older LANX gets it as soon as they are online: it downloads by itself and they see
              “Update LANX now”. Each PC that updates passes it on too, so nobody depends on this PC being on.
            </p>
            <label className="mt-2 flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={status.auto_chat}
                onChange={(e) => run(async () => api.setUpdateAutoChat(e.target.checked))}
                className="accent-sky-500"
              />
              Also send it once as a chat file to colleagues on LANX 1.1 or older
            </label>
            <div className="mt-2 flex gap-1.5">
              <button type="button" disabled={busy} onClick={chooseInstaller} className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-[11px] font-semibold text-slate-700 dark:text-slate-200">
                Choose another…
              </button>
              <button type="button" disabled={busy} onClick={() => run(async () => { await api.stopSharingUpdate(); return "Stopped sharing."; })} className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-[11px] text-slate-600 dark:text-slate-300">
                Stop sharing
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="mt-1.5 text-[11px] text-slate-500 leading-snug">
              Have a newer <b>LANX-Setup-….exe</b>? Choose it and LANX brings every colleague up to that version. Keep its
              <b> .sig</b> file (made by <span className="font-mono">npm run release</span>) in the same folder: LANX only
              shares official, signed releases. (A PC installed straight from that folder shares it by itself.)
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={chooseInstaller}
              className="mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-600 text-white text-[11px] font-semibold disabled:opacity-60"
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Choose installer…
            </button>
          </>
        )}
        {msg && <p className={`mt-2 text-[11px] whitespace-pre-line ${msg.ok ? "text-emerald-600" : "text-red-600"}`}>{msg.text}</p>}
      </div>

      <div className="rounded-xl border border-sky-200 dark:border-sky-900 bg-sky-50 dark:bg-sky-950/30 p-3 text-[11px] text-sky-900 dark:text-sky-100 leading-relaxed">
        <b>Why there is no blue “Windows protected your PC” box:</b> Windows shows it for programs that came from the internet,
        e-mail or WhatsApp. A file LANX receives from a colleague isn't marked that way, so it opens normally. Windows still
        asks <i>“Do you want to allow this app to make changes?”</i>; click <b>Yes</b>. LANX then updates and opens again,
        with all chats kept.
      </div>
    </div>
  );
};
