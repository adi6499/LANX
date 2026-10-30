/** LANX 3.4 phone page: the rest of LANX — Appearance, Settings (sounds,
 *  chats, quiet hours, privacy, backup, help), Tools (calculator, PDF tools,
 *  shared folders, the directory, your apps) and a chat's options (mute,
 *  folders, delete) — all through the PC like everything else. */
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Calculator, ChevronRight, Contact, DatabaseBackup, ExternalLink, FileText, FolderSync, LayoutGrid, Palette, Plus, Trash2, X } from "lucide-react";
import type { ChatFolder, ConnectionCheck, Conversation, Peer, Profile, QuietHours, UpdateStatus, UserSettings } from "../types";
import { AppearancePanel } from "../components/AppearancePanel";
import { Directory } from "../components/office/Directory";
import { formatSize } from "../lib/format";
import type { AppItem, BackupOverviewInfo, PhoneClient, SyncShareInfo, SyncSubscriptionInfo } from "./client";
import type { PhoneSettings } from "./bridge";
import { Sheet, SheetRow, whenShort } from "./parts";

const field = "w-full rounded-xl lanx-field px-3.5 py-2.5 text-[15px] text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500 dark:text-white";
const primary = "rounded-full bg-sky-500 px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-40";
const quiet = "rounded-full lanx-group px-3 py-1.5 text-[12.5px] font-semibold text-slate-700 dark:text-slate-200 disabled:opacity-40";

export function Header({ title, onBack, right }: { title: string; onBack: () => void; right?: React.ReactNode }) {
  return (
    <header className="flex shrink-0 items-center gap-2 px-2 py-2 lanx-bar border-b lanx-line">
      <button type="button" data-ph-back onClick={onBack} className="lanx-tool p-2 text-sky-600 dark:text-sky-400" aria-label="Back">
        <ArrowLeft className="h-5 w-5" />
      </button>
      <div className="min-w-0 flex-1 truncate text-[15px] font-semibold text-slate-900 dark:text-white">{title}</div>
      {right}
    </header>
  );
}

function Group({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="mb-4">
      <div className="mb-1 px-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">{title}</div>
      <div className="rounded-[16px] lanx-card px-3 py-1">{children}</div>
      {hint && <p className="mt-1 px-2 text-[11px] leading-snug text-slate-500 dark:text-slate-400">{hint}</p>}
    </section>
  );
}

function Toggle({ title, hint, on, onChange, hook }: { title: string; hint?: string; on: boolean; onChange: (v: boolean) => void; hook: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b lanx-line py-2.5 last:border-0">
      <span className="min-w-0">
        <span className="block text-[14px] font-medium text-slate-900 dark:text-white">{title}</span>
        {hint && <span className="block text-[11.5px] leading-snug text-slate-500 dark:text-slate-400">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={title}
        data-ph-setting={hook}
        onClick={() => onChange(!on)}
        className={`relative h-[28px] w-[48px] shrink-0 rounded-full transition-colors duration-200 ${on ? "bg-sky-500" : "bg-[var(--lanx-fill-2)]"}`}
      >
        <span className={`absolute top-[2px] h-[24px] w-[24px] rounded-full bg-white shadow-[0_2px_4px_rgb(0_0_0/0.2)] transition-all duration-200 ${on ? "left-[22px]" : "left-[2px]"}`} />
      </button>
    </div>
  );
}

function Row({ icon, title, hint, onClick, hook }: { icon?: React.ReactNode; title: string; hint?: string; onClick: () => void; hook: string }) {
  return (
    <button type="button" data-ph-row={hook} onClick={onClick} className="flex w-full items-center gap-3 border-b lanx-line py-2.5 text-left last:border-0 active:opacity-70">
      {icon && <span className="shrink-0 text-slate-500">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-medium text-slate-900 dark:text-white">{title}</span>
        {hint && <span className="block truncate text-[11.5px] text-slate-500 dark:text-slate-400">{hint}</span>}
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
    </button>
  );
}

// -------------------------------------------------------------- appearance

/** The PC's own Appearance panel: a change here changes LANX on the PC too. */
export function AppearanceScreen({ settings, onBack, onChange, onError }: { settings: PhoneSettings; onBack: () => void; onChange: (patch: Partial<UserSettings>) => void; onError: (t: string) => void }) {
  return (
    <>
      <Header title="Appearance" onBack={onBack} />
      <div className="ph-scroll px-3 py-3" data-ph-appearance>
        <p className="mb-3 px-1 text-[12px] leading-snug text-slate-500 dark:text-slate-400">The same look as LANX on your PC — what you change here changes it on the PC too. "Auto" follows this phone's light or dark mode.</p>
        <AppearancePanel form={settings as UserSettings} onTheme={(theme) => onChange({ theme })} onChange={onChange} onError={onError} />
      </div>
    </>
  );
}

// ---------------------------------------------------------------- settings

const SOUNDS = [
  { id: "chime", label: "Chime" },
  { id: "soft", label: "Soft" },
  { id: "ding", label: "Ding" },
  { id: "pop", label: "Pop" },
];
const AUTO_LOCK = [
  { v: 0, label: "Never" },
  { v: 1, label: "1 min" },
  { v: 5, label: "5 min" },
  { v: 15, label: "15 min" },
  { v: 60, label: "1 hour" },
];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const TIPS: [string, string][] = [
  ["Send a photo or file", "+ in a chat. It goes from your PC, so the PC must be on."],
  ["Get attention", "⋯ in a chat → Ring: their PC rings."],
  ["Make a group", "The people icon at the top of Chats."],
  ["Tell everyone", "📣 at the top of Chats sends to many at once."],
  ["Secret chat", "⋯ in a chat → Secret messages: they disappear after reading."],
  ["Calls and meetings", "📞 / 📹 in a chat; 📹 in a group starts a meeting. Needs the secure connection."],
  ["Your colours", "More → Appearance: the same look as on the PC."],
  ["Colleague missing?", "Who's in → + → Connect by IP (their IP is in LANX Settings → Network on their PC)."],
  ["Alerts when the page is shut", "More → Secure connection & alerts."],
];

const hhmm = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const fromHhmm = (v: string) => {
  const [h, m] = v.split(":").map(Number);
  return ((h || 0) * 60 + (m || 0)) % (24 * 60);
};

export function SettingsScreen({
  settings,
  client,
  version,
  device,
  peers,
  updateVersion,
  onBack,
  onChange,
  onOpen,
  onLockPc,
  onError,
  onNotice,
}: {
  settings: PhoneSettings;
  client: PhoneClient;
  version: string;
  device: string;
  peers: Peer[];
  /** Bumped when the PC says the update status changed. */
  updateVersion: number;
  onBack: () => void;
  onChange: (patch: Partial<UserSettings>) => void;
  onOpen: (key: "appearance" | "secure" | "about" | "folders") => void;
  onLockPc: () => void;
  onError: (t: string) => void;
  onNotice: (t: string) => void;
}) {
  const [reply, setReply] = useState("");
  const [backups, setBackups] = useState<BackupOverviewInfo | null>(null);
  const [backingUp, setBackingUp] = useState(false);
  useEffect(() => {
    client
      .backups()
      .then((r) => setBackups(r.overview))
      .catch(() => {});
  }, [client]);
  const qh: QuietHours = settings.quiet_hours ?? { enabled: false, start: 19 * 60, end: 9 * 60, days: [0, 1, 2, 3, 4, 5, 6] };
  const setQh = (p: Partial<QuietHours>) => onChange({ quiet_hours: { ...qh, ...p } });
  const replies = settings.quick_replies ?? [];
  const backupNow = () => {
    setBackingUp(true);
    client
      .backupNow()
      .then((r) => {
        setBackups(r.overview);
        onNotice("Backed up on your PC.");
      })
      .catch((e: Error) => onError(e.message))
      .finally(() => setBackingUp(false));
  };
  return (
    <>
      <Header title="Settings" onBack={onBack} />
      <div className="ph-scroll px-3 py-3" data-ph-settings>
        <Group title="Look">
          <Row icon={<Palette className="h-4 w-4" />} title="Appearance" hint="Light / dark, colours, wallpaper, glass" hook="appearance" onClick={() => onOpen("appearance")} />
        </Group>

        <Group title="Notifications & sounds" hint="Sounds and pop-ups on your PC. Alerts on this phone: More → Secure connection & alerts.">
          <Toggle title="Show notifications on the PC" on={settings.notifications_enabled} onChange={(v) => onChange({ notifications_enabled: v })} hook="notifications" />
          <Toggle title="Play LANX sounds on the PC" on={settings.sound_enabled} onChange={(v) => onChange({ sound_enabled: v })} hook="sound" />
          {settings.sound_enabled && (
            <div className="border-b lanx-line py-2.5 last:border-0">
              <div className="mb-1.5 text-[13px] font-medium text-slate-900 dark:text-white">Sound</div>
              <div className="flex flex-wrap gap-1.5">
                {SOUNDS.map((s) => (
                  <button key={s.id} type="button" data-ph-sound={s.id} onClick={() => onChange({ sound_choice: s.id })} className={`rounded-full px-3 py-1 text-[12.5px] font-semibold ${settings.sound_choice === s.id ? "bg-sky-500 text-white" : "lanx-group text-slate-700 dark:text-slate-200"}`}>
                    {s.label}
                  </button>
                ))}
              </div>
              <label className="mt-2 flex items-center gap-2 text-[12px] text-slate-500 dark:text-slate-400">
                Volume
                <input type="range" min={0} max={100} value={settings.sound_volume} onChange={(e) => onChange({ sound_volume: Number(e.target.value) })} className="flex-1" data-ph-volume />
              </label>
            </div>
          )}
        </Group>

        <Group title="Chats">
          <Toggle title="Read receipts" hint="Send “Seen” and show when you're typing" on={settings.read_receipts} onChange={(v) => onChange({ read_receipts: v })} hook="read-receipts" />
          <Toggle title="Download pictures automatically" hint="On the PC, pictures under 10 MB" on={settings.auto_download_images} onChange={(v) => onChange({ auto_download_images: v })} hook="auto-images" />
          <Row title="Chat folders" hint={(settings.chat_folders ?? []).map((f) => f.name).join(", ") || "Sort chats into Work, Family…"} hook="folders" onClick={() => onOpen("folders")} />
        </Group>

        <Group title="Quick replies" hint="Type / in a message to use one.">
          <div className="py-1.5" data-ph-quick-replies={replies.length}>
            {replies.map((r, i) => (
              <div key={`${i}-${r}`} className="flex items-center gap-2 border-b lanx-line py-1.5 last:border-0">
                <span className="min-w-0 flex-1 truncate text-[13.5px] text-slate-800 dark:text-slate-100">{r}</span>
                <button type="button" aria-label={`Remove “${r}”`} onClick={() => onChange({ quick_replies: replies.filter((_, j) => j !== i) })} className="lanx-tool p-1 text-slate-400">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            <form
              className="mt-1.5 flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const t = reply.trim();
                if (!t) return;
                onChange({ quick_replies: [...replies, t] });
                setReply("");
              }}
            >
              <input data-ph-quick-reply-new value={reply} onChange={(e) => setReply(e.target.value)} placeholder="New quick reply" className={`${field} py-2`} />
              <button type="submit" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-500 text-white" aria-label="Add">
                <Plus className="h-4 w-4" />
              </button>
            </form>
          </div>
        </Group>

        <Group title="Quiet hours" hint="No sounds or pop-ups on the PC in these hours (messages still arrive).">
          <Toggle title="Quiet hours" on={qh.enabled} onChange={(v) => setQh({ enabled: v })} hook="quiet" />
          {qh.enabled && (
            <div className="py-2.5">
              <div className="flex items-center gap-2 text-[13px] text-slate-700 dark:text-slate-200">
                From <input type="time" value={hhmm(qh.start)} onChange={(e) => setQh({ start: fromHhmm(e.target.value) })} className="rounded-lg lanx-field px-2 py-1" data-ph-quiet-start />
                to <input type="time" value={hhmm(qh.end)} onChange={(e) => setQh({ end: fromHhmm(e.target.value) })} className="rounded-lg lanx-field px-2 py-1" data-ph-quiet-end />
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {DAYS.map((d, i) => {
                  const on = qh.days.includes(i);
                  return (
                    <button key={d} type="button" onClick={() => setQh({ days: on ? qh.days.filter((x) => x !== i) : [...qh.days, i].sort() })} className={`rounded-full px-2.5 py-1 text-[11.5px] font-semibold ${on ? "bg-sky-500 text-white" : "lanx-group text-slate-600 dark:text-slate-300"}`}>
                      {d}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </Group>

        <Group title="Privacy" hint={settings.pin_enabled ? undefined : "Set a PIN in LANX on the PC (Settings → Privacy) to lock LANX and hide chats."}>
          {settings.pin_enabled ? (
            <>
              <div className="border-b lanx-line py-2.5">
                <div className="mb-1.5 text-[13px] font-medium text-slate-900 dark:text-white">Lock LANX on the PC by itself after</div>
                <div className="flex flex-wrap gap-1.5">
                  {AUTO_LOCK.map((a) => (
                    <button key={a.v} type="button" data-ph-autolock={a.v} onClick={() => onChange({ auto_lock_minutes: a.v })} className={`rounded-full px-3 py-1 text-[12.5px] font-semibold ${settings.auto_lock_minutes === a.v ? "bg-sky-500 text-white" : "lanx-group text-slate-700 dark:text-slate-200"}`}>
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>
              <button type="button" data-ph-lock-pc onClick={onLockPc} className="w-full py-2.5 text-left text-[14px] font-medium text-rose-600 dark:text-rose-400">
                Lock LANX on my PC now
              </button>
            </>
          ) : (
            <div className="py-2.5 text-[13px] text-slate-500 dark:text-slate-400">No PIN yet.</div>
          )}
          <div className="border-t lanx-line py-2.5 text-[12.5px] text-slate-500 dark:text-slate-400">Messages are kept {settings.retention_days ? `for ${settings.retention_days} days` : "until you delete them"} (set by your office admin on the PC).</div>
        </Group>

        <Group title="Backup" hint={backups ? (backups.auto_enabled ? "Your PC also backs up by itself every day." : "Automatic backups are off (LANX Settings → Backup on the PC).") : undefined}>
          <div className="py-1.5" data-ph-backups={backups?.backups.length ?? -1}>
            {(backups?.backups ?? []).slice(0, 3).map((b) => (
              <div key={b.path} className="flex items-center gap-2 border-b lanx-line py-1.5 last:border-0">
                <DatabaseBackup className="h-4 w-4 shrink-0 text-slate-400" />
                <span className="min-w-0 flex-1 truncate text-[13px] text-slate-800 dark:text-slate-100">{new Date(b.created_at * 1000).toLocaleString([], { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</span>
                <span className="shrink-0 text-[11px] text-slate-400">
                  {b.kind} · {formatSize(b.size_bytes)}
                </span>
              </div>
            ))}
            {backups && backups.backups.length === 0 && <div className="py-1.5 text-[13px] text-slate-500">No backups yet.</div>}
            <button type="button" data-ph-backup-now disabled={backingUp} onClick={backupNow} className={`${quiet} my-1.5`}>
              {backingUp ? "Backing up…" : "Back up now"}
            </button>
          </div>
        </Group>

        <UpdatesGroup client={client} version={updateVersion} onError={onError} onNotice={onNotice} />

        <PcGroup settings={settings} client={client} peers={peers} onChange={onChange} onError={onError} />

        <Group title="Help">
          <div className="py-1.5">
            {TIPS.map(([t, d]) => (
              <div key={t} className="border-b lanx-line py-1.5 last:border-0">
                <div className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">{t}</div>
                <div className="text-[12px] text-slate-500 dark:text-slate-400">{d}</div>
              </div>
            ))}
          </div>
        </Group>

        <Group title="About">
          <Row title={`LANX ${version}`} hint={`${device} · through ${settings.hostname}`} hook="about" onClick={() => onOpen("about")} />
        </Group>
      </div>
    </>
  );
}

// ----------------------------------------------------------------- updates

function UpdatesGroup({ client, version, onError, onNotice }: { client: PhoneClient; version: number; onError: (t: string) => void; onNotice: (t: string) => void }) {
  const [u, setU] = useState<UpdateStatus | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    client
      .updateStatus()
      .then((r) => setU(r.update))
      .catch(() => {});
  }, [client, version]);
  if (!u) return null;
  const a = u.available;
  const behind = u.colleagues.filter((c) => c.behind);
  const stateText = !a
    ? ""
    : a.state === "downloading"
      ? `downloading… ${a.file_size ? Math.round((a.transferred_bytes / a.file_size) * 100) : 0}%`
      : a.state === "ready"
        ? "downloaded, ready to install"
        : a.state === "installing"
          ? "installing…"
          : a.state === "failed"
            ? `didn't work: ${a.error ?? "try again"}`
            : a.from_name
              ? `from ${a.from_name}`
              : "ready";
  const run = (p: Promise<unknown>, done?: string) => {
    setBusy(true);
    p.then(() => {
      if (done) onNotice(done);
      return client.updateStatus().then((r) => setU(r.update));
    })
      .catch((e: Error) => onError(e.message))
      .finally(() => setBusy(false));
  };
  return (
    <Group title="LANX updates" hint={a ? "Your PC closes LANX to install it and may ask “Yes” on its own screen; this page reconnects by itself." : undefined}>
      <div className="py-2.5" data-ph-update={a ? a.state : "none"}>
        <div className="text-[14px] font-medium text-slate-900 dark:text-white">LANX {u.current_version} on your PC</div>
        {a ? (
          <>
            <div className="mt-0.5 text-[12.5px] text-slate-600 dark:text-slate-300">
              LANX {a.version} is out — {stateText}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" data-ph-update-install disabled={busy || a.state === "installing" || a.state === "downloading"} onClick={() => run(client.updateInstall(), "Your PC is installing the update.")} className={primary}>
                {a.state === "ready" ? "Install now" : "Update now"}
              </button>
              <button type="button" disabled={busy} onClick={() => run(client.updateSnooze(), "It reminds you tomorrow.")} className={quiet}>
                Remind me tomorrow
              </button>
            </div>
          </>
        ) : (
          <div className="mt-0.5 text-[12.5px] text-slate-500 dark:text-slate-400">Up to date{u.latest_version && u.latest_version !== u.current_version ? ` (newest seen: ${u.latest_version})` : ""}.</div>
        )}
      </div>
      {behind.length > 0 && (
        <div className="border-t lanx-line py-2.5" data-ph-update-behind={behind.length}>
          <div className="text-[12.5px] text-slate-600 dark:text-slate-300">
            On an older LANX: {behind.map((c) => `${c.display_name}${c.app_version ? ` (${c.app_version})` : ""}`).join(", ")}
          </div>
          {u.sharing && (
            <button type="button" data-ph-update-send disabled={busy} onClick={() => run(client.updateSend(behind.map((c) => c.peer_id)), "The update goes to them.")} className={`${quiet} mt-2`}>
              Send them the update
            </button>
          )}
        </div>
      )}
    </Group>
  );
}

// ----------------------------------------------------------------- this PC

function PcGroup({ settings, client, peers, onChange, onError }: { settings: PhoneSettings; client: PhoneClient; peers: Peer[]; onChange: (patch: Partial<UserSettings>) => void; onError: (t: string) => void }) {
  const [info, setInfo] = useState<{ hostname: string; os: string; local_ips: string[]; fingerprint: string } | null>(null);
  const [who, setWho] = useState("");
  const [check, setCheck] = useState<ConnectionCheck | null>(null);
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    client
      .systemInfo()
      .then((r) => setInfo(r.info))
      .catch(() => {});
  }, [client]);
  const test = () => {
    if (!who) return;
    setChecking(true);
    setCheck(null);
    client
      .checkConnection(who)
      .then((r) => setCheck(r.check))
      .catch((e: Error) => onError(e.message))
      .finally(() => setChecking(false));
  };
  return (
    <>
      <Group title="Your PC" hint="Switches for LANX on the PC itself.">
        <Toggle title="Start LANX when Windows starts" on={settings.launch_at_startup} onChange={(v) => onChange({ launch_at_startup: v })} hook="startup" />
        <Toggle title="Keep running when the window is closed" hint="LANX waits in the tray near the clock" on={settings.close_to_tray} onChange={(v) => onChange({ close_to_tray: v })} hook="tray" />
        <Toggle title="“Send to → LANX” in File Explorer" hint="Right-click a file on the PC to send it" on={!!settings.send_to_menu} onChange={(v) => onChange({ send_to_menu: v })} hook="send-to" />
        <Toggle title="Screenshot shortcut Ctrl + Alt + S" hint="On the PC, anywhere" on={!!settings.screenshot_hotkey} onChange={(v) => onChange({ screenshot_hotkey: v })} hook="hotkey" />
      </Group>
      <Group title="Network">
        <div className="py-2 text-[12.5px] leading-relaxed text-slate-600 dark:text-slate-300 ph-select" data-ph-network>
          <div>
            PC: <b>{info?.hostname ?? settings.hostname}</b>
            {info?.os ? ` · ${info.os}` : ""}
          </div>
          <div>IP: {info?.local_ips?.join(", ") || "…"}</div>
          <div>
            Ports: messages {settings.tcp_messaging_port}, finding colleagues {settings.udp_discovery_port}
          </div>
          {info?.fingerprint && <div className="truncate">Fingerprint: {info.fingerprint}</div>}
        </div>
        <div className="border-t lanx-line py-2.5">
          <div className="mb-1.5 text-[13px] font-medium text-slate-900 dark:text-white">Test a connection</div>
          <div className="flex gap-2">
            <select value={who} onChange={(e) => setWho(e.target.value)} className="min-w-0 flex-1 rounded-lg lanx-field px-2 py-1.5 text-[13.5px] text-slate-800 dark:text-slate-100" data-ph-check-who>
              <option value="">Choose a colleague…</option>
              {peers
                .filter((p) => !p.id.startsWith("manual-"))
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.display_name}
                  </option>
                ))}
            </select>
            <button type="button" data-ph-check-go disabled={!who || checking} onClick={test} className={quiet}>
              {checking ? "Testing…" : "Test"}
            </button>
          </div>
          {check && (
            <div className="mt-2 rounded-xl lanx-group px-3 py-2" data-ph-check={check.ok ? "ok" : "problem"}>
              <div className={`text-[13px] font-semibold ${check.ok ? "text-emerald-600" : "text-rose-600"}`}>
                {check.ok ? "✓ " : "✗ "}
                {check.verdict}
                {check.latency_ms != null ? ` · ${check.latency_ms} ms` : ""}
              </div>
              {check.steps.map((s) => (
                <div key={s.label} className="text-[11.5px] text-slate-500 dark:text-slate-400">
                  {s.ok === true ? "✓" : s.ok === false ? "✗" : "·"} {s.label}
                  {s.detail ? ` — ${s.detail}` : ""}
                </div>
              ))}
            </div>
          )}
        </div>
      </Group>
    </>
  );
}

// ------------------------------------------------------------ chat folders

/** Make, rename and remove chat folders; with `conv`, also which folders that chat is in. */
export function FoldersSheet({ folders, conv, onSave, onPick, onClose }: { folders: ChatFolder[]; conv?: Conversation | null; onSave: (list: ChatFolder[]) => void; onPick?: (ids: string[]) => void; onClose: () => void }) {
  const [list, setList] = useState(folders);
  const [name, setName] = useState("");
  const [inChat, setInChat] = useState<string[]>(conv?.folders ?? []);
  const changed = JSON.stringify(list) !== JSON.stringify(folders);
  return (
    <Sheet title={conv ? `Folders for ${conv.peer_name}` : "Chat folders"} onClose={onClose} hook="folders">
      <div className="space-y-1" data-ph-folders={list.length}>
        {list.length === 0 && <div className="px-1 py-2 text-[13px] text-slate-500">No folders yet. Make one below — then the chat list has a tab for it.</div>}
        {list.map((f, i) => (
          <div key={f.id} className="flex items-center gap-2">
            {conv && (
              <input
                type="checkbox"
                aria-label={`In ${f.name}`}
                data-ph-folder-check={f.name}
                checked={inChat.includes(f.id)}
                onChange={(e) => setInChat(e.target.checked ? [...inChat, f.id] : inChat.filter((x) => x !== f.id))}
                className="h-5 w-5 accent-sky-500"
              />
            )}
            <input value={f.name} onChange={(e) => setList(list.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} className={`${field} py-1.5`} />
            <button type="button" aria-label="Delete folder (the chats stay)" onClick={() => setList(list.filter((_, j) => j !== i))} className="lanx-tool p-2 text-slate-400">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
      <form
        className="mt-2 flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const n = name.trim();
          if (!n || list.length >= 12) return;
          setList([...list, { id: `f-${Date.now().toString(36)}`, name: n }]);
          setName("");
        }}
      >
        <input data-ph-folder-new value={name} onChange={(e) => setName(e.target.value)} placeholder="New folder (Work, Family…)" className={`${field} py-2`} />
        <button type="submit" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-500 text-white" aria-label="Add folder">
          <Plus className="h-4 w-4" />
        </button>
      </form>
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          data-ph-folders-save
          onClick={() => {
            const clean = list.filter((f) => f.name.trim()).map((f) => ({ ...f, name: f.name.trim() }));
            if (changed) onSave(clean);
            if (conv && onPick) onPick(inChat.filter((id) => clean.some((f) => f.id === id)));
            onClose();
          }}
          className={primary}
        >
          Done
        </button>
      </div>
    </Sheet>
  );
}

export const MUTE_CHOICES = [
  { minutes: 60, label: "1 hour" },
  { minutes: 8 * 60, label: "8 hours" },
  { minutes: 7 * 24 * 60, label: "1 week" },
  { minutes: -1, label: "Until I turn it back on" },
];

/** The chat's sounds are off (muted_until -1 = always, or a time to come). */
export const isMuted = (c: Conversation) => !!c.muted_until && (c.muted_until < 0 || c.muted_until > Date.now() / 1000);

export function MuteSheet({ conv, onMute, onClose }: { conv: Conversation; onMute: (minutes: number) => void; onClose: () => void }) {
  return (
    <Sheet title={`Mute ${conv.peer_name}`} onClose={onClose} hook="mute">
      <p className="mb-1 px-1 text-[12px] text-slate-500 dark:text-slate-400">No sounds or pop-ups for this chat (on the PC and here). Messages still arrive.</p>
      {MUTE_CHOICES.map((c) => (
        <SheetRow key={c.minutes} label={c.label} hook={`mute:${c.minutes}`} onClick={() => onMute(c.minutes)} />
      ))}
    </Sheet>
  );
}

export function ConfirmSheet({ title, text, yes, onYes, onClose }: { title: string; text: string; yes: string; onYes: () => void; onClose: () => void }) {
  return (
    <Sheet title={title} onClose={onClose} hook="confirm">
      <p className="mb-3 px-1 text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">{text}</p>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className={quiet}>
          Cancel
        </button>
        <button type="button" data-ph-confirm onClick={onYes} className="rounded-full bg-rose-500 px-4 py-2 text-[13px] font-semibold text-white">
          {yes}
        </button>
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------- contacts

export function ConnectSheet({ onConnect, onClose }: { onConnect: (ip: string, port: number, name: string) => Promise<boolean>; onClose: () => void }) {
  const [ip, setIp] = useState("");
  const [port, setPort] = useState("52926");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Sheet title="Connect by IP" onClose={onClose} hook="connect">
      <p className="mb-2 px-1 text-[12px] leading-snug text-slate-500 dark:text-slate-400">For a colleague LANX can't find by itself (another floor or network). Their IP is in LANX Settings → Network on their PC.</p>
      <input data-ph-connect-ip value={ip} onChange={(e) => setIp(e.target.value)} inputMode="decimal" placeholder="IP address, e.g. 192.168.1.25" className={`${field} mb-2`} />
      <div className="mb-3 flex gap-2">
        <input data-ph-connect-port value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, ""))} inputMode="numeric" placeholder="Port" className={`${field} w-28`} />
        <input data-ph-connect-name value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (optional)" className={field} />
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          data-ph-connect-go
          disabled={!ip.trim() || busy}
          onClick={() => {
            setBusy(true);
            void onConnect(ip.trim(), Number(port) || 52926, name.trim()).then((done) => {
              setBusy(false);
              if (done) onClose();
            });
          }}
          className={primary}
        >
          {busy ? "Connecting…" : "Connect"}
        </button>
      </div>
    </Sheet>
  );
}

// ------------------------------------------------------------------- tools

export type ToolKey = "calc" | "pdf" | "sync" | "directory" | "apps";

export function ToolsScreen({ onBack, onOpen }: { onBack: () => void; onOpen: (key: ToolKey) => void }) {
  const items: { key: ToolKey; icon: React.ReactNode; label: string; hint: string; tint: string }[] = [
    { key: "calc", icon: <Calculator className="h-5 w-5" />, label: "Calculator", hint: "GST, percentages, EMI, units…", tint: "#475569" },
    { key: "pdf", icon: <FileText className="h-5 w-5" />, label: "PDF tools", hint: "Read, sign, merge, split, compress…", tint: "#f43f5e" },
    { key: "directory", icon: <Contact className="h-5 w-5" />, label: "Directory", hint: "Everyone's phone, e-mail and team", tint: "#0ea5e9" },
    { key: "sync", icon: <FolderSync className="h-5 w-5" />, label: "Shared folders", hint: "Folders your PC keeps in step", tint: "#10b981" },
    { key: "apps", icon: <LayoutGrid className="h-5 w-5" />, label: "Apps", hint: "The office's links and yours", tint: "#8b5cf6" },
  ];
  return (
    <>
      <Header title="Tools" onBack={onBack} />
      <div className="ph-scroll px-3 py-3" data-ph-tools>
        <div className="space-y-1.5">
          {items.map((it) => (
            <button key={it.key} type="button" data-ph-tool={it.key} onClick={() => onOpen(it.key)} className="flex w-full items-center gap-3 rounded-[16px] lanx-card px-3 py-3 text-left active:bg-[var(--lanx-fill)]">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] text-white" style={{ background: it.tint }}>
                {it.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14.5px] font-semibold text-slate-900 dark:text-white">{it.label}</span>
                <span className="block truncate text-[11.5px] text-slate-500 dark:text-slate-400">{it.hint}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

export function DirectoryScreen({ settings, peers, profiles, onBack, onChat }: { settings: PhoneSettings; peers: Peer[]; profiles: Record<string, Profile>; onBack: () => void; onChat: (peerId: string) => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-ph-directory>
      <Directory
        settings={settings as UserSettings}
        peers={peers}
        profiles={profiles}
        modeSwitch={
          <button type="button" data-ph-back onClick={onBack} className="lanx-tool flex items-center gap-1 p-1.5 text-[13px] font-semibold text-sky-600 dark:text-sky-400" aria-label="Back">
            <ArrowLeft className="h-5 w-5" /> Back
          </button>
        }
        onStartChat={onChat}
      />
    </div>
  );
}

export function SyncScreen({ client, onBack, onError, onNotice }: { client: PhoneClient; onBack: () => void; onError: (t: string) => void; onNotice: (t: string) => void }) {
  const [shares, setShares] = useState<SyncShareInfo[] | null>(null);
  const [subs, setSubs] = useState<SyncSubscriptionInfo[]>([]);
  const [confirm, setConfirm] = useState<{ op: "sync_stop" | "sync_unsubscribe"; id: string; name: string } | null>(null);
  const load = () =>
    client
      .syncList()
      .then((r) => {
        setShares(r.shares);
        setSubs(r.subscriptions.filter((s) => s.status === "active"));
      })
      .catch((e: Error) => onError(e.message));
  useEffect(() => {
    void load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const run = (op: "sync_resync" | "sync_stop" | "sync_unsubscribe", id: string, done: string) =>
    client
      .syncAction(op, id)
      .then(() => {
        onNotice(done);
        void load();
      })
      .catch((e: Error) => onError(e.message));
  return (
    <>
      <Header title="Shared folders" onBack={onBack} />
      <div className="ph-scroll px-3 py-3" data-ph-sync={shares ? shares.length + subs.length : -1}>
        <p className="mb-3 px-1 text-[12px] leading-snug text-slate-500 dark:text-slate-400">Folders your PC shares with colleagues (it sends every change), and colleagues' folders it keeps a copy of. Share a new folder from LANX on the PC.</p>
        <Group title={`Shared from your PC · ${shares?.length ?? 0}`}>
          {shares?.length === 0 && <div className="py-2.5 text-[13px] text-slate-500">None.</div>}
          {shares?.map((s) => (
            <div key={s.id} className="border-b lanx-line py-2.5 last:border-0" data-ph-share={s.name}>
              <div className="text-[14px] font-semibold text-slate-900 dark:text-white">{s.name}</div>
              <div className="text-[11.5px] text-slate-500 dark:text-slate-400">
                To {s.subscribers.join(", ") || "nobody yet"}
                {s.waiting > 0 ? ` · ${s.waiting} waiting to send` : " · up to date"}
              </div>
              <div className="mt-1.5 flex gap-2">
                <button type="button" onClick={() => void run("sync_resync", s.id, "Sending every file again.")} className={quiet}>
                  Send all again
                </button>
                <button type="button" onClick={() => setConfirm({ op: "sync_stop", id: s.id, name: s.name })} className="rounded-full px-3 py-1.5 text-[12.5px] font-semibold text-rose-600 dark:text-rose-400">
                  Stop sharing
                </button>
              </div>
            </div>
          ))}
        </Group>
        <Group title={`From colleagues · ${subs.length}`}>
          {subs.length === 0 && <div className="py-2.5 text-[13px] text-slate-500">None.</div>}
          {subs.map((s) => (
            <div key={s.share_id} className="border-b lanx-line py-2.5 last:border-0" data-ph-subscription={s.name}>
              <div className="text-[14px] font-semibold text-slate-900 dark:text-white">{s.name}</div>
              <div className="text-[11.5px] text-slate-500 dark:text-slate-400">
                From {s.owner_name} · {s.files} file{s.files === 1 ? "" : "s"}, {formatSize(s.bytes)}
                {s.last_at ? ` · last ${whenShort(s.last_at)}` : ""}
              </div>
              <button type="button" onClick={() => setConfirm({ op: "sync_unsubscribe", id: s.share_id, name: s.name })} className="mt-1 rounded-full px-0 py-1 text-[12.5px] font-semibold text-rose-600 dark:text-rose-400">
                Stop getting it
              </button>
            </div>
          ))}
        </Group>
      </div>
      {confirm && (
        <ConfirmSheet
          title={confirm.op === "sync_stop" ? "Stop sharing?" : "Stop getting it?"}
          text={confirm.op === "sync_stop" ? `Colleagues keep the files they have of “${confirm.name}”, but no more changes go to them.` : `The files of “${confirm.name}” stay on your PC; no more changes come in.`}
          yes={confirm.op === "sync_stop" ? "Stop sharing" : "Stop"}
          onYes={() => {
            const c = confirm;
            setConfirm(null);
            void run(c.op, c.id, c.op === "sync_stop" ? "Stopped sharing." : "Stopped.");
          }}
          onClose={() => setConfirm(null)}
        />
      )}
    </>
  );
}

const isWeb = (t: string) => /^https?:\/\//i.test(t.trim());

export function AppsScreen({ client, settings, onBack, onSave, onError }: { client: PhoneClient; settings: PhoneSettings; onBack: () => void; onSave: (apps: { name: string; target: string; emoji: string }[]) => void; onError: (t: string) => void }) {
  const [apps, setApps] = useState<AppItem[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("https://");
  const mine = settings.apps ?? [];
  const first = useRef(true);
  useEffect(() => {
    // Again when my own links change (they come back in the settings).
    client
      .apps()
      .then((r) => setApps(r.apps))
      .catch((e: Error) => {
        if (first.current) onError(e.message);
      });
    first.current = false;
  }, [client, JSON.stringify(mine)]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <Header
        title="Apps"
        onBack={onBack}
        right={
          <button type="button" data-ph-app-add onClick={() => setAdding(true)} className="lanx-tool p-2 text-sky-600 dark:text-sky-400" aria-label="Add a link">
            <Plus className="h-5 w-5" />
          </button>
        }
      />
      <div className="ph-scroll px-3 py-3" data-ph-apps={apps?.length ?? -1}>
        {apps?.length === 0 && <div className="px-4 py-10 text-center text-[13px] text-slate-400">No links yet. Tap + to add a website you use for work.</div>}
        <div className="grid grid-cols-3 gap-2">
          {apps?.map((a) => {
            const web = isWeb(a.target);
            return (
              <button
                key={`${a.office}-${a.target}`}
                type="button"
                data-ph-app={a.name}
                onClick={() => (web ? window.open(a.target, "_blank", "noopener") : onError(`“${a.name}” is a file or folder on the PC — open it in LANX on the PC.`))}
                className={`flex flex-col items-center gap-1 rounded-[16px] lanx-card px-2 py-3 text-center active:bg-[var(--lanx-fill)] ${web ? "" : "opacity-60"}`}
              >
                <span className="text-[26px] leading-none">{a.emoji || "🔗"}</span>
                <span className="line-clamp-2 text-[12px] font-semibold text-slate-800 dark:text-slate-100">{a.name}</span>
                <span className="text-[9.5px] font-bold uppercase tracking-wide text-slate-400">{a.office ? "Office" : web ? "Yours" : "On the PC"}</span>
              </button>
            );
          })}
        </div>
        {mine.length > 0 && (
          <Group title="Your links">
            {mine.map((a, i) => (
              <div key={`${i}-${a.target}`} className="flex items-center gap-2 border-b lanx-line py-2 last:border-0">
                <span className="text-[18px]">{a.emoji || "🔗"}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-semibold text-slate-900 dark:text-white">{a.name}</span>
                  <span className="block truncate text-[11px] text-slate-500">{a.target}</span>
                </span>
                <button type="button" aria-label={`Remove ${a.name}`} onClick={() => onSave(mine.filter((_, j) => j !== i).map((x) => ({ name: x.name, target: x.target, emoji: x.emoji ?? "" })))} className="lanx-tool p-1.5 text-slate-400">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </Group>
        )}
        <p className="mt-2 px-1 text-[11px] text-slate-500 dark:text-slate-400">
          <ExternalLink className="mr-1 inline h-3 w-3" />
          Websites open on the phone; files and folders on the office network open from LANX on the PC.
        </p>
      </div>
      {adding && (
        <Sheet title="Add a link" onClose={() => setAdding(false)} hook="app-add">
          <input data-ph-app-name value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (e.g. Tally, HR portal)" className={`${field} mb-2`} />
          <input data-ph-app-url value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" placeholder="https://…" className={`${field} mb-3`} />
          <div className="flex justify-end">
            <button
              type="button"
              data-ph-app-save
              disabled={!name.trim() || !isWeb(url)}
              onClick={() => {
                onSave([...mine.map((x) => ({ name: x.name, target: x.target, emoji: x.emoji ?? "" })), { name: name.trim(), target: url.trim(), emoji: "" }]);
                setAdding(false);
                setName("");
                setUrl("https://");
              }}
              className={primary}
            >
              Add
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}
