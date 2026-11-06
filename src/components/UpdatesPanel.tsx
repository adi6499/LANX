import React, { useState } from "react";
import { ColleagueUpdate, UpdateStatus } from "../types";
import { api, errorText } from "../lib/api";
import { formatSize } from "../lib/format";
import { IS_WINDOWS, OS_NAME } from "../lib/platform";
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
    case "not_chosen":
      return { text: `${v} · needs the update: tick to send it`, tone: amber };
    default:
      return { text: "Version shows when they are next online", tone: "text-slate-400" };
  }
}

/** Settings → Updates: everyone on the same LANX version. */
export const UpdatesPanel: React.FC<UpdatesPanelProps> = ({ status, installing, onInstall, onChanged }) => {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  /** LANX 2.0: who to send the update to. */
  const [sendTo, setSendTo] = useState<Record<string, boolean>>({});

  if (!status) {
    return <div className="text-xs text-slate-500">Loading…</div>;
  }
  const { available, sharing, colleagues, latest_version: latest } = status;
  const known = colleagues.filter((c) => c.app_version);
  const behind = colleagues.filter((c) => c.behind);
  const old = colleagues.filter((c) => c.state === "old_version" || c.state === "chat_sent");
  const chosenOld = old.filter((c) => picked[c.peer_id] ?? c.state === "old_version");
  const thisPcBehind = latest !== status.current_version && !available;
  const notChosen = colleagues.filter((c) => c.state === "not_chosen");
  const toSend = notChosen.filter((c) => sendTo[c.peer_id]);
  /** Chosen but not fetched yet: can still be taken back. */
  const canUnsend = (c: ColleagueUpdate) => !status.send_everyone && (c.state === "waiting" || c.state === "offered" || c.state === "not_offered");

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
      return status.send_everyone
        ? `Sharing LANX ${s.version}. Colleagues get it automatically as they come online.`
        : `Sharing LANX ${s.version}. Tick who should get it in the list above, then press Send update.`;
    });

  const sendUpdate = () =>
    run(async () => {
      const n = await api.sendUpdateTo(toSend.map((c) => c.peer_id));
      setSendTo({});
      return `Sending LANX ${sharing?.version ?? ""} to ${n} colleague${n === 1 ? "" : "s"}. Those who are offline get it when they come online.`;
    });

  const sendInChat = () =>
    run(async () => {
      const r = await api.sendUpdateAsFile(chosenOld.map((c) => c.peer_id));
      const problems = r.problems.length ? `\n${r.problems.join("\n")}` : "";
      return `Sent the installer to ${r.sent_to} colleague${r.sent_to === 1 ? "" : "s"} in their chat. They open it from there.${problems}`;
    });

  if (!IS_WINDOWS)
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 rounded-xl lanx-group p-3">
          <ArrowUpCircle className="h-5 w-5 text-sky-500 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
              This computer runs LANX {status.current_version} for {OS_NAME}
              <button type="button" data-whats-new-open onClick={() => window.dispatchEvent(new Event("lanx:whats-new"))} className="ml-2 font-semibold text-sky-600 hover:underline dark:text-sky-400">What's new</button>
            </div>
            <div className="text-[11px] text-slate-500">
              New Linux versions come from the LANX download page (the .deb or AppImage file). The automatic update exchange on this
              tab is between Windows PCs: their installer cannot run here, so this computer never asks for it or passes it on.
            </div>
          </div>
        </div>
      </div>
    );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 rounded-xl lanx-group p-3">
        <ArrowUpCircle className="h-5 w-5 text-sky-500 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
            This PC runs LANX {status.current_version}
            <button type="button" data-whats-new-open onClick={() => window.dispatchEvent(new Event("lanx:whats-new"))} className="ml-2 font-semibold text-sky-600 hover:underline dark:text-sky-400">What's new</button>
          </div>
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

      <div className="rounded-xl border lanx-line p-3">
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
                  ) : sharing && c.state === "not_chosen" ? (
                    <input
                      type="checkbox"
                      data-update-pick={c.display_name}
                      checked={!!sendTo[c.peer_id]}
                      onChange={(e) => setSendTo({ ...sendTo, [c.peer_id]: e.target.checked })}
                      className="accent-sky-500"
                    />
                  ) : (
                    <span className="w-[13px]" />
                  )}
                  <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${c.online ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-600"}`} />
                  <span className="font-semibold text-slate-700 dark:text-slate-200 truncate max-w-[35%]">{c.display_name}</span>
                  <span className={`truncate ${l.tone}`} data-update-state={c.state} title={c.detail ?? undefined}>
                    {l.text}
                  </span>
                  {sharing && canUnsend(c) && (
                    <button
                      type="button"
                      data-update-unsend={c.display_name}
                      disabled={busy}
                      onClick={() => run(async () => api.unsendUpdate([c.peer_id]))}
                      className="ml-auto shrink-0 text-[10.5px] font-semibold text-slate-500 hover:text-red-600 hover:underline"
                    >
                      Don't send
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {sharing && notChosen.length > 0 && (
          <div className="mt-3 rounded-lg bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-900 p-2.5">
            <p className="text-[11px] text-sky-900 dark:text-sky-100 leading-snug">
              {notChosen.length} colleague{notChosen.length === 1 ? "" : "s"} can get LANX {sharing.version}. Nobody gets it
              until you choose: tick them above, then press <b>Send update</b>.
            </p>
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                data-send-update
                disabled={busy || toSend.length === 0}
                onClick={sendUpdate}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-600 text-white text-[11px] font-semibold disabled:opacity-50"
              >
                <ArrowUpCircle className="h-3.5 w-3.5" />
                Send update ({toSend.length})
              </button>
              <button
                type="button"
                data-update-pick-all
                disabled={busy}
                onClick={() =>
                  setSendTo(
                    toSend.length === notChosen.length ? {} : Object.fromEntries(notChosen.map((c) => [c.peer_id, true]))
                  )
                }
                className="text-[11px] font-semibold text-sky-700 dark:text-sky-300 hover:underline"
              >
                {toSend.length === notChosen.length ? "Clear" : "Tick everyone"}
              </button>
            </div>
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

      <div className="rounded-xl border lanx-line p-3">
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
            <div className="mt-2 flex items-center gap-2.5 rounded-lg lanx-group px-3 py-2">
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
              {status.send_everyone
                ? "Every colleague with an older LANX gets it as soon as they are online: it downloads by itself and they see “Update LANX now”."
                : "Only the colleagues you choose in the list above get it. For them it downloads by itself and they see “Update LANX now”; nobody else is told."}
            </p>
            <label className="mt-2 flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                data-update-everyone
                checked={status.send_everyone}
                onChange={(e) => run(async () => api.setUpdateSendEveryone(e.target.checked))}
                className="accent-sky-500"
              />
              Send it to everyone automatically (no choosing)
            </label>
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
              <button type="button" disabled={busy} onClick={chooseInstaller} className="px-2.5 py-1 rounded-lg lanx-btn text-[11px] font-semibold text-slate-700 dark:text-slate-200">
                Choose another…
              </button>
              <button type="button" disabled={busy} onClick={() => run(async () => { await api.stopSharingUpdate(); return "Stopped sharing."; })} className="px-2.5 py-1 rounded-lg lanx-btn text-[11px] text-slate-600 dark:text-slate-300">
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
