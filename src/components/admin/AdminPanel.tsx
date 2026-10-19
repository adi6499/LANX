import { useEffect, useState } from "react";
import { AppWindow, Broom, Download, FileSpreadsheet, FileText, Plus, ShieldCheck, Trash2, X } from "lucide-react";
import type { AdminState, AppLink, Conversation, OfficePolicy, Peer, Profile, UserSettings } from "../../types";
import { api, errorText, events } from "../../lib/api";
import { exportChatExcel, printChat } from "../../lib/exportChat";
import { birthdayInfo } from "../../lib/office";

/** LANX 1.9.0: Admin — office settings from one admin computer, the Apps
 *  launcher, message clean-up and exports. */
export type AdminTab = "office" | "apps" | "cleanup" | "export";

const TABS: { id: AdminTab; label: string; icon: React.ElementType }[] = [
  { id: "office", label: "Office settings", icon: ShieldCheck },
  { id: "apps", label: "Apps", icon: AppWindow },
  { id: "cleanup", label: "Message clean-up", icon: Broom },
  { id: "export", label: "Export", icon: Download },
];

export const RETENTION: [number, string][] = [
  [0, "Keep everything"],
  [730, "2 years"],
  [365, "1 year"],
  [180, "6 months"],
  [90, "90 days"],
  [30, "30 days"],
];
const retentionLabel = (d: number) => RETENTION.find((r) => r[0] === d)?.[1] ?? `${d} days`;

const STATUS: Record<string, [string, string]> = {
  accepted: ["Following ✓", "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"],
  waiting: ["Asked — waiting for their yes", "bg-amber-500/15 text-amber-700 dark:text-amber-300"],
  declined: ["Said no", "bg-slate-500/15 text-slate-600 dark:text-slate-300"],
  left: ["Stopped following", "bg-slate-500/15 text-slate-600 dark:text-slate-300"],
  old: ["Needs LANX 1.9", "bg-red-500/10 text-red-600"],
  "other-admin": ["Follows another admin", "bg-slate-500/15 text-slate-600"],
  refused: ["Refused", "bg-red-500/10 text-red-600"],
};

const field = "lanx-field w-full rounded-xl px-3 py-2 text-[12.5px] text-slate-900 dark:text-white";
const btn = "inline-flex items-center justify-center gap-1.5 rounded-full px-4 py-2 text-[12.5px] font-semibold transition-colors disabled:opacity-40";

export function AdminPanel({
  settings,
  peers,
  profiles,
  conversations,
  versions,
  initialTab = "office",
  onClose,
  onError,
  onNotice,
  onExported,
}: {
  settings: UserSettings;
  peers: Peer[];
  profiles: Record<string, Profile>;
  conversations: Conversation[];
  versions: Record<string, { version?: string | null; behind: boolean }>;
  initialTab?: AdminTab;
  onClose: () => void;
  onError: (text: string) => void;
  onNotice: (text: string) => void;
  /** An Excel file was saved there. */
  onExported: (path: string) => void;
}) {
  const [tab, setTab] = useState<AdminTab>(initialTab);
  const [state, setState] = useState<AdminState | null>(null);
  const load = () => api.getAdminState().then(setState).catch((e) => onError(errorText(e)));
  useEffect(() => {
    void load();
    // Colleagues' answers (and new office settings) show up live.
    let un: (() => void) | undefined;
    let gone = false;
    events.onAdminChanged(() => void api.getAdminState().then(setState).catch(() => {})).then((u) => (gone ? u() : (un = u)));
    return () => {
      gone = true;
      un?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const run = async (f: () => Promise<AdminState>, done?: string) => {
    try {
      setState(await f());
      if (done) onNotice(done);
    } catch (e) {
      onError(errorText(e));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 lanx-scrim" onMouseDown={onClose}>
      <div
        data-admin
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-2xl h-[86vh] flex flex-col rounded-[24px] lanx-sheet !bg-[color-mix(in_srgb,var(--lanx-surface)_96%,transparent)] shadow-2xl lanx-rise"
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <h2 className="inline-flex items-center gap-2 text-[15px] font-semibold text-slate-900 dark:text-white">
            <ShieldCheck className="h-4 w-4 text-indigo-500" /> Admin
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="h-8 w-8 rounded-full flex items-center justify-center text-slate-500 hover:bg-[var(--lanx-fill)]">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 pb-2 flex gap-1 overflow-x-auto lanx-noscroll">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              data-admin-tab={t.id}
              onClick={() => setTab(t.id)}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors ${
                tab === t.id ? "bg-indigo-500 text-white" : "bg-slate-500/10 text-slate-600 dark:text-slate-300 hover:bg-slate-500/20"
              }`}
            >
              <t.icon className="h-3.5 w-3.5" /> {t.label}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {!state && <p className="py-10 text-center text-xs text-slate-400">Loading…</p>}
          {state && tab === "office" && <OfficeTab state={state} peers={peers} versions={versions} run={run} onError={onError} onExported={onExported} />}
          {state && tab === "apps" && <AppsTab state={state} settings={settings} run={run} onError={onError} />}
          {state && tab === "cleanup" && <CleanupTab state={state} run={run} onError={onError} onNotice={onNotice} />}
          {state && tab === "export" && (
            <ExportTab settings={settings} peers={peers} profiles={profiles} conversations={conversations} onError={onError} onExported={onExported} />
          )}
        </div>
      </div>
    </div>
  );
}

type Run = (f: () => Promise<AdminState>, done?: string) => Promise<void>;

// --------------------------------------------------------- office settings

function OfficeTab({
  state,
  peers,
  versions,
  run,
  onError,
  onExported,
}: {
  state: AdminState;
  peers: Peer[];
  versions: Record<string, { version?: string | null; behind: boolean }>;
  run: Run;
  onError: (t: string) => void;
  onExported: (p: string) => void;
}) {
  const [sure, setSure] = useState(false);
  const mine = state.my_policy;
  const [draft, setDraft] = useState<OfficePolicy | null>(mine);
  useEffect(() => setDraft(state.my_policy), [state.my_policy]);

  if (state.policy) {
    const p = state.policy;
    return (
      <div className="space-y-3" data-following>
        <div className="rounded-2xl bg-indigo-500/10 p-4">
          <div className="text-[13px] font-bold text-indigo-700 dark:text-indigo-300">This computer follows {p.admin_name}'s office settings</div>
          <ul className="mt-2 space-y-1 text-[12px] text-slate-700 dark:text-slate-200">
            <li>📱 {p.apps.length} company app{p.apps.length === 1 ? "" : "s"} in your Apps launcher</li>
            <li>🧹 Message clean-up: {p.retention_days ? `older than ${retentionLabel(p.retention_days)} are deleted (starred messages stay)` : "you decide"}</li>
            <li>💾 Backup copies: {p.backup_dir ? `to ${p.backup_dir}` : "you decide"}</li>
          </ul>
        </div>
        <button type="button" data-leave-policy onClick={() => run(() => api.leavePolicy(), "Your own settings apply again.")} className={`${btn} lanx-btn text-slate-700 dark:text-slate-200`}>
          Stop following these settings
        </button>
      </div>
    );
  }

  if (!mine || !draft) {
    return (
      <div className="space-y-3">
        <div className="rounded-2xl lanx-group p-4 text-[12.5px] text-slate-600 dark:text-slate-300 leading-relaxed">
          One computer in the office can be the <b>LANX admin</b>. It sends everyone the same <b>company apps</b>, <b>message clean-up</b> and <b>network backup folder</b>.
          Each colleague is asked first and can stop following any time. The admin never sees anyone's messages.
        </div>
        {sure ? (
          <div className="flex items-center gap-2 text-[12.5px]">
            Make this computer the LANX admin?
            <button type="button" data-become-admin onClick={() => run(() => api.becomeAdmin(), "This computer is now the LANX admin. Colleagues online are being asked.")} className={`${btn} bg-indigo-500 text-white`}>
              Yes
            </button>
            <button type="button" onClick={() => setSure(false)} className={`${btn} lanx-btn`}>
              No
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setSure(true)} className={`${btn} bg-indigo-500 hover:bg-indigo-600 text-white`}>
            <ShieldCheck className="h-4 w-4" /> Make this computer the LANX admin
          </button>
        )}
      </div>
    );
  }

  const nameOf = (id: string) => peers.find((p) => p.id === id)?.display_name ?? "Someone";
  const rows = peers
    .filter((p) => p.trust_state !== "blocked")
    .map((p) => {
      const st = state.peers.find((x) => x.peer_id === p.id);
      return { p, st, version: versions[p.id]?.version ?? st?.app_version ?? "" };
    });
  const exportList = async () => {
    try {
      const data = [["Name", "Computer", "IP address", "Online", "LANX version", "Office settings", "Last seen"]];
      for (const r of rows)
        data.push([
          r.p.display_name,
          r.p.hostname,
          r.p.last_ip,
          r.p.status === "online" ? "Yes" : "No",
          r.version || "",
          r.st ? (STATUS[r.st.status]?.[0] ?? r.st.status) : "Not reached yet",
          r.p.last_seen ? new Date(r.p.last_seen * 1000).toLocaleString() : "",
        ]);
      const path = await api.exportExcel(`LANX computers - ${new Date().toISOString().slice(0, 10)}`, "Computers", data);
      if (path) onExported(path);
    } catch (e) {
      onError(errorText(e));
    }
  };

  return (
    <div className="space-y-4" data-admin-mine>
      <div className="rounded-2xl bg-indigo-500/10 px-4 py-3 text-[12.5px] text-indigo-800 dark:text-indigo-200">
        <b>This computer is the LANX admin</b> · settings version {mine.version}. Colleagues get changes when they're online and say yes once.
      </div>

      <section className="space-y-2">
        <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Office settings</h3>
        <label className="block text-[12px] font-semibold text-slate-700 dark:text-slate-200">
          Message clean-up for everyone
          <select data-policy-retention value={draft.retention_days} onChange={(e) => setDraft({ ...draft, retention_days: Number(e.target.value) })} className={`${field} mt-1`}>
            <option value={0}>Everyone decides</option>
            {RETENTION.filter((r) => r[0] > 0).map(([d, l]) => (
              <option key={d} value={d}>
                Delete messages older than {l}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-[12px] font-semibold text-slate-700 dark:text-slate-200">
          Copy everyone's daily backup to (network folder)
          <input data-policy-backup value={draft.backup_dir} onChange={(e) => setDraft({ ...draft, backup_dir: e.target.value })} placeholder="e.g. \\SERVER\Backups\LANX (empty = everyone decides)" className={`${field} mt-1`} />
        </label>
        {draft.backup_dir.trim() && (
          <label className="block text-[12px] font-semibold text-slate-700 dark:text-slate-200">
            Password for those copies (keep it safe — needed to restore)
            <input data-policy-backup-pw type="password" value={draft.backup_password} onChange={(e) => setDraft({ ...draft, backup_password: e.target.value })} className={`${field} mt-1`} />
          </label>
        )}
        <p className="text-[11px] text-slate-400">Company apps: see the Apps tab.</p>
        <button type="button" data-policy-save onClick={() => run(() => api.savePolicy(draft), "Saved. Colleagues get the new settings when they're online.")} className={`${btn} bg-indigo-500 hover:bg-indigo-600 text-white`}>
          Save and send to everyone
        </button>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Computers in the office</h3>
          <button type="button" data-admin-export-list onClick={exportList} className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-emerald-600 hover:underline">
            <FileSpreadsheet className="h-3.5 w-3.5" /> Export to Excel
          </button>
        </div>
        <div className="space-y-1">
          {rows.map(({ p, st, version }) => {
            const s = st ? STATUS[st.status] ?? [st.status, "bg-slate-500/10"] : ["Not reached yet", "bg-slate-500/10 text-slate-500"];
            return (
              <div key={p.id} data-admin-peer={p.id} className="flex items-center gap-2 rounded-xl lanx-card px-3 py-2 text-[12px]">
                <span className={`h-2 w-2 rounded-full ${p.status === "online" ? "bg-emerald-500" : "bg-slate-400"}`} />
                <span className="font-semibold text-slate-900 dark:text-white min-w-0 truncate">{nameOf(p.id)}</span>
                <span className="text-slate-400 truncate">{p.hostname}</span>
                {version && <span className="text-slate-400">· {version}</span>}
                <span className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${s[1]}`}>{s[0]}</span>
              </div>
            );
          })}
          {rows.length === 0 && <p className="text-[12px] text-slate-400">No colleagues found yet.</p>}
        </div>
      </section>

      <button type="button" data-stop-admin onClick={() => run(() => api.stopAdmin(), "This computer is no longer the LANX admin. Colleagues use their own settings again.")} className="text-[12px] font-semibold text-red-600 hover:underline">
        Stop being the LANX admin
      </button>
    </div>
  );
}

// -------------------------------------------------------------------- apps

function AppsTab({ state, settings, run, onError }: { state: AdminState; settings: UserSettings; run: Run; onError: (t: string) => void }) {
  const admin = !!state.my_policy;
  const list: AppLink[] = admin ? state.my_policy!.apps : settings.apps ?? [];
  const [apps, setApps] = useState<AppLink[]>(list);
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [emoji, setEmoji] = useState("🌐");
  const office = state.apps.filter((a) => a.office && !admin);
  const add = () => {
    const t = target.trim();
    const okTarget = /^https?:\/\//i.test(t) || /^\\\\/.test(t) || /^[a-z]:\\/i.test(t);
    if (!name.trim() || !okTarget) {
      onError("Write a name, and a web address (https://…) or a folder / file path (\\\\SERVER\\Share or D:\\…).");
      return;
    }
    setApps([...apps, { name: name.trim(), target: t, emoji: emoji.trim() }]);
    setName("");
    setTarget("");
  };
  const save = () => (admin ? run(() => api.savePolicy({ ...state.my_policy!, apps }), "Company apps saved and sent to everyone.") : run(() => api.setMyApps(apps), "Your apps are saved."));

  return (
    <div className="space-y-4">
      <p className="text-[12px] text-slate-500 dark:text-slate-400">
        {admin
          ? "Company apps: web pages, shared folders or files everyone opens from the Apps button (⊞) above the chat list."
          : "Your links in the Apps button (⊞) above the chat list: web pages, shared folders, files."}
      </p>
      {office.length > 0 && (
        <div>
          <h3 className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">From your LANX admin</h3>
          {office.map((a) => (
            <div key={a.target} className="flex items-center gap-2 rounded-xl lanx-group px-3 py-2 text-[12px] mb-1">
              <span className="text-lg">{a.emoji || "🌐"}</span>
              <span className="font-semibold">{a.name}</span>
              <span className="truncate text-slate-400">{a.target}</span>
            </div>
          ))}
        </div>
      )}
      <div>
        <h3 className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">{admin ? "Company apps" : "Your apps"}</h3>
        {apps.length === 0 && <p className="text-[12px] text-slate-400">None yet.</p>}
        {apps.map((a, i) => (
          <div key={a.target} data-app-row={a.name} className="flex items-center gap-2 rounded-xl lanx-card px-3 py-2 text-[12px] mb-1">
            <span className="text-lg">{a.emoji || "🌐"}</span>
            <span className="font-semibold">{a.name}</span>
            <span className="flex-1 truncate text-slate-400">{a.target}</span>
            <button type="button" title="Remove" onClick={() => setApps(apps.filter((_, j) => j !== i))} className="lanx-tool p-1 text-red-500">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
      <div className="rounded-2xl lanx-group p-3 space-y-2">
        <div className="flex gap-2">
          <input value={emoji} onChange={(e) => setEmoji(e.target.value)} maxLength={4} className={`${field} !w-14 text-center`} title="Emoji" />
          <input data-app-name value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. Tally" maxLength={40} className={field} />
        </div>
        <input data-app-target value={target} onChange={(e) => setTarget(e.target.value)} placeholder="https://… or \\SERVER\Share or D:\Folder" className={field} />
        <button type="button" data-app-add onClick={add} className={`${btn} lanx-btn text-slate-700 dark:text-slate-200`}>
          <Plus className="h-4 w-4" /> Add
        </button>
      </div>
      <button type="button" data-apps-save onClick={save} className={`${btn} bg-indigo-500 hover:bg-indigo-600 text-white`}>
        {admin ? "Save and send to everyone" : "Save"}
      </button>
    </div>
  );
}

// --------------------------------------------------------------- clean-up

function CleanupTab({ state, run, onError, onNotice }: { state: AdminState; run: Run; onError: (t: string) => void; onNotice: (t: string) => void }) {
  const locked = !!state.policy && state.policy.retention_days > 0;
  const [sure, setSure] = useState(false);
  return (
    <div className="space-y-4">
      <p className="text-[12.5px] text-slate-600 dark:text-slate-300 leading-relaxed">
        LANX can delete old messages from this computer by itself (checked every hour). <b>Starred messages are always kept.</b> Files you received stay in your Downloads folder; only their line in Files disappears.
      </p>
      {locked && <div className="rounded-xl bg-indigo-500/10 px-3 py-2 text-[12px] text-indigo-700 dark:text-indigo-300">Set by your LANX admin ({state.policy!.admin_name}).</div>}
      <label className="block text-[12px] font-semibold text-slate-700 dark:text-slate-200">
        Keep messages for
        <select data-retention value={state.retention_days} disabled={locked} onChange={(e) => run(() => api.setRetention(Number(e.target.value)), "Saved.")} className={`${field} mt-1`}>
          {RETENTION.map(([d, l]) => (
            <option key={d} value={d}>
              {l}
            </option>
          ))}
        </select>
      </label>
      {state.retention_days > 0 &&
        (sure ? (
          <div className="flex items-center gap-2 text-[12.5px]">
            Delete messages older than {retentionLabel(state.retention_days)} now?
            <button
              type="button"
              data-retention-run
              onClick={async () => {
                setSure(false);
                try {
                  const n = await api.runRetention();
                  onNotice(n ? `${n} old message${n === 1 ? "" : "s"} deleted.` : "Nothing old enough to delete.");
                } catch (e) {
                  onError(errorText(e));
                }
              }}
              className={`${btn} bg-red-500 text-white`}
            >
              Delete
            </button>
            <button type="button" onClick={() => setSure(false)} className={`${btn} lanx-btn`}>
              Cancel
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setSure(true)} className={`${btn} lanx-btn text-slate-700 dark:text-slate-200`}>
            <Broom className="h-4 w-4" /> Clean up now
          </button>
        ))}
    </div>
  );
}

// ----------------------------------------------------------------- export

function ExportTab({
  settings,
  peers,
  profiles,
  conversations,
  onError,
  onExported,
}: {
  settings: UserSettings;
  peers: Peer[];
  profiles: Record<string, Profile>;
  conversations: Conversation[];
  onError: (t: string) => void;
  onExported: (p: string) => void;
}) {
  const [chat, setChat] = useState(conversations[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const conv = conversations.find((c) => c.id === chat);
  const go = async (f: () => Promise<string | null | void>) => {
    setBusy(true);
    try {
      const p = await f();
      if (typeof p === "string") onExported(p);
    } catch (e) {
      onError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const directory = () => {
    const rows = [["Name", "Job title", "Department", "Phone", "Email", "Birthday", "Online"]];
    const me = settings.profile;
    rows.push([settings.display_name, me.title, me.department, me.phone, me.email, birthdayInfo(me.birthday)?.label ?? "", "Yes"]);
    for (const p of peers.filter((x) => x.trust_state !== "blocked")) {
      const pr = profiles[p.id];
      rows.push([p.display_name, pr?.title ?? "", pr?.department ?? "", pr?.phone ?? "", pr?.email ?? "", birthdayInfo(pr?.birthday)?.label ?? "", p.status === "online" ? "Yes" : "No"]);
    }
    return api.exportExcel(`LANX staff directory - ${new Date().toISOString().slice(0, 10)}`, "Directory", rows);
  };
  return (
    <div className="space-y-4">
      <div className="rounded-2xl lanx-card p-4 space-y-2">
        <div className="text-[13px] font-bold text-slate-900 dark:text-white">A chat</div>
        <select data-export-chat value={chat} onChange={(e) => setChat(e.target.value)} className={field}>
          {conversations.map((c) => (
            <option key={c.id} value={c.id}>
              {c.peer_name}
            </option>
          ))}
        </select>
        <div className="flex flex-wrap gap-2">
          <button type="button" data-export-excel disabled={!conv || busy} onClick={() => go(() => exportChatExcel(conv!, peers, settings.display_name))} className={`${btn} bg-emerald-600 hover:bg-emerald-700 text-white`}>
            <FileSpreadsheet className="h-4 w-4" /> Excel
          </button>
          <button type="button" data-export-pdf disabled={!conv || busy} onClick={() => go(() => printChat(conv!, peers, settings.display_name))} className={`${btn} bg-red-500 hover:bg-red-600 text-white`}>
            <FileText className="h-4 w-4" /> PDF / print
          </button>
        </div>
        <p className="text-[11px] text-slate-400">PDF: in the print window choose “Microsoft Print to PDF” (or “Save as PDF”). Secret messages are never exported.</p>
      </div>
      <div className="rounded-2xl lanx-card p-4 space-y-2">
        <div className="text-[13px] font-bold text-slate-900 dark:text-white">The staff directory</div>
        <button type="button" data-export-directory disabled={busy} onClick={() => go(directory)} className={`${btn} bg-emerald-600 hover:bg-emerald-700 text-white`}>
          <FileSpreadsheet className="h-4 w-4" /> Excel
        </button>
      </div>
    </div>
  );
}
