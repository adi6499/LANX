import React, { useState, useEffect } from "react";
import { UserSettings, SystemInfo, ConnectionTestResult } from "../types";
import { api, errorText } from "../lib/api";
import { formatSize } from "../lib/format";
import {
  X,
  User,
  Sun,
  Moon,
  Laptop,
  Network,
  Info,
  Check,
  Copy,
  Activity,
  RefreshCw,
  Bell,
  FolderOpen,
  SlidersHorizontal,
  KeyRound,
  CircleCheck,
  CircleAlert,
  ShieldCheck,
  Volume2,
  LifeBuoy,
  Play,
  Music,
  Sparkles,
  DatabaseBackup,
} from "lucide-react";
import { BackupPanel } from "./BackupPanel";

export type SettingsTab =
  | "profile"
  | "general"
  | "privacy"
  | "backup"
  | "sounds"
  | "appearance"
  | "files"
  | "network"
  | "diagnostics"
  | "help"
  | "about";
type Tab = SettingsTab;

interface SettingsModalProps {
  settings: UserSettings;
  isOpen: boolean;
  initialTab?: SettingsTab;
  onClose: () => void;
  onSave: (updated: UserSettings) => void;
  onThemeChange: (theme: "system" | "dark" | "light") => void;
  onShowGuide: () => void;
}

const SOUNDS: { id: string; label: string }[] = [
  { id: "chime", label: "Chime" },
  { id: "soft", label: "Soft" },
  { id: "ding", label: "Ding" },
  { id: "pop", label: "Pop" },
];

const AUTO_LOCK: { v: number; label: string }[] = [
  { v: 1, label: "1 minute" },
  { v: 5, label: "5 minutes" },
  { v: 15, label: "15 minutes" },
  { v: 60, label: "1 hour" },
  { v: 0, label: "Never (only when I lock it)" },
];

/** Set, change or remove the PIN. */
function PinManager({ pinSet, onChanged }: { pinSet: boolean; onChanged: () => void }) {
  const [mode, setMode] = useState<"idle" | "set" | "remove">("idle");
  const [current, setCurrent] = useState("");
  const [pin1, setPin1] = useState("");
  const [pin2, setPin2] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const reset = () => {
    setMode("idle");
    setCurrent("");
    setPin1("");
    setPin2("");
  };
  const save = async () => {
    setMsg(null);
    if (mode === "set" && pin1 !== pin2) {
      setMsg({ ok: false, text: "The two PINs don't match." });
      return;
    }
    try {
      await api.setPin(pinSet ? current : null, mode === "set" ? pin1 : null);
      setMsg({ ok: true, text: mode === "set" ? "PIN saved. LANX will ask for it when it starts or locks." : "PIN removed. Hidden chats are visible again." });
      reset();
      onChanged();
    } catch (err) {
      setMsg({ ok: false, text: errorText(err) });
    }
  };
  const field = "flex-1 min-w-0 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs text-slate-900 dark:text-white select-text";
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 p-3">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-200">
          <KeyRound className="h-4 w-4 text-sky-500" /> PIN lock
          <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${pinSet ? "bg-emerald-500/10 text-emerald-600" : "bg-slate-200 dark:bg-slate-800 text-slate-500"}`}>
            {pinSet ? "On" : "Off"}
          </span>
        </span>
        {mode === "idle" && (
          <div className="flex gap-1.5">
            <button type="button" onClick={() => setMode("set")} className="px-2.5 py-1 rounded-lg bg-sky-500 text-white text-[11px] font-semibold">
              {pinSet ? "Change PIN" : "Set a PIN"}
            </button>
            {pinSet && (
              <button type="button" onClick={() => setMode("remove")} className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-[11px] text-slate-600 dark:text-slate-300">
                Remove
              </button>
            )}
          </div>
        )}
      </div>
      <p className="mt-1 text-[11px] text-slate-500 leading-snug">
        When set, LANX asks for the PIN when it starts and after you've been away, so nobody else using this computer can read your chats.
      </p>
      {mode !== "idle" && (
        <div className="mt-3 space-y-2">
          {pinSet && (
            <input type="password" inputMode="numeric" placeholder="Current PIN" value={current} onChange={(e) => setCurrent(e.target.value)} className={field + " w-full"} />
          )}
          {mode === "set" && (
            <div className="flex gap-2">
              <input type="password" inputMode="numeric" placeholder="New PIN (4–12)" value={pin1} maxLength={12} onChange={(e) => setPin1(e.target.value)} className={field} />
              <input type="password" inputMode="numeric" placeholder="Repeat new PIN" value={pin2} maxLength={12} onChange={(e) => setPin2(e.target.value)} className={field} />
            </div>
          )}
          <div className="flex justify-end gap-1.5">
            <button type="button" onClick={reset} className="px-3 py-1.5 rounded-lg text-[11px] text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800">
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={(pinSet && !current) || (mode === "set" && (pin1.length < 4 || !pin2))}
              className={`px-3 py-1.5 rounded-lg text-white text-[11px] font-semibold disabled:opacity-40 ${mode === "remove" ? "bg-red-500" : "bg-sky-500"}`}
            >
              {mode === "remove" ? "Remove PIN" : "Save PIN"}
            </button>
          </div>
        </div>
      )}
      {msg && <p className={`mt-2 text-[11px] ${msg.ok ? "text-emerald-600" : "text-red-600"}`}>{msg.text}</p>}
    </div>
  );
}

const AVATAR_COLORS = ["#0284c7", "#6366f1", "#8b5cf6", "#ec4899", "#10b981", "#06b6d4", "#f59e0b", "#ef4444"];

const inputCls =
  "w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3.5 py-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500 select-text";
const labelCls = "block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5";

function Toggle({
  checked,
  onChange,
  title,
  description,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  title: string;
  description: string;
}) {
  return (
    <label className="flex items-start justify-between gap-4 p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 cursor-pointer">
      <span>
        <span className="block text-xs font-semibold text-slate-800 dark:text-slate-200">{title}</span>
        <span className="block text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">{description}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors ${
          checked ? "bg-sky-500" : "bg-slate-300 dark:bg-slate-700"
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
            checked ? "left-[18px]" : "left-0.5"
          }`}
        />
      </button>
    </label>
  );
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  settings,
  isOpen,
  initialTab,
  onClose,
  onSave,
  onThemeChange,
  onShowGuide,
}) => {
  const [activeTab, setActiveTab] = useState<Tab>("profile");
  useEffect(() => {
    if (isOpen && initialTab) setActiveTab(initialTab);
  }, [isOpen, initialTab]);
  const [form, setForm] = useState<UserSettings>({ ...settings });
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [testIp, setTestIp] = useState("");
  const [testPort, setTestPort] = useState(52926);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setForm({ ...settings });
      setError(null);
      api.getSystemInfo().then(setSystemInfo).catch(console.error);
    }
  }, [isOpen, settings]);

  if (!isOpen) return null;

  const portsChanged =
    form.tcp_messaging_port !== settings.tcp_messaging_port ||
    form.udp_discovery_port !== settings.udp_discovery_port;

  const copy = (key: string, text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  };

  const handleThemeSelect = async (theme: "system" | "dark" | "light") => {
    const updated = { ...form, theme };
    setForm(updated);
    onThemeChange(theme);
    try {
      const saved = await api.saveSettings({ ...settings, theme });
      onSave(saved);
    } catch (err) {
      console.error("Failed to persist theme setting:", err);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const saved = await api.saveSettings(form);
      onSave(saved);
      onClose();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  const handlePickFolder = async () => {
    try {
      const dir = await api.pickDownloadDir();
      if (dir) setForm({ ...form, default_download_dir: dir });
    } catch (err) {
      setError(errorText(err));
    }
  };

  const handleRunTest = async () => {
    if (!testIp.trim()) return;
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(await api.testLanConnection(testIp.trim(), testPort));
    } catch (err) {
      setTestResult({ reachable: false, ip: testIp, port: testPort, message: errorText(err) });
    } finally {
      setTesting(false);
    }
  };

  const navItem = (tab: Tab, label: string, Icon: React.ComponentType<{ className?: string }>) => (
    <button
      type="button"
      onClick={() => setActiveTab(tab)}
      className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-semibold rounded-lg transition-colors ${
        activeTab === tab
          ? "bg-sky-500 text-white shadow-sm"
          : "text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-800"
      }`}
    >
      <Icon className="h-4 w-4" />
      <span>{label}</span>
    </button>
  );

  const titles: Record<Tab, string> = {
    profile: "Profile",
    general: "General",
    privacy: "Privacy & security",
    backup: "Backup & restore",
    sounds: "Sounds",
    appearance: "Appearance",
    files: "Files",
    network: "Network",
    diagnostics: "Diagnostics",
    help: "Help",
    about: "About LANX",
  };

  const refreshPin = async () => {
    try {
      const s = await api.getSettings();
      setForm((f) => ({ ...f, pin_enabled: s.pin_enabled }));
      onSave({ ...settings, pin_enabled: s.pin_enabled });
    } catch {
      /* ignore */
    }
  };

  const preview = (name: string) => api.playSound(name, form.sound_volume, form.custom_sound_path).catch(() => {});

  const status = (ok: boolean | undefined, good: string, bad: string) =>
    ok ? (
      <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
        <CircleCheck className="h-3.5 w-3.5" /> {good}
      </span>
    ) : (
      <span className="flex items-center gap-1 text-red-600 dark:text-red-400">
        <CircleAlert className="h-3.5 w-3.5" /> {bad}
      </span>
    );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-3xl h-[600px] rounded-2xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 shadow-2xl flex overflow-hidden">
        <div className="w-52 border-r border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0c111c] p-3 flex flex-col justify-between shrink-0">
          <div className="space-y-1">
            <div className="px-3 py-2 text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Settings</div>
            {navItem("profile", "Profile", User)}
            {navItem("general", "General", Bell)}
            {navItem("privacy", "Privacy", ShieldCheck)}
            {navItem("backup", "Backup", DatabaseBackup)}
            {navItem("sounds", "Sounds", Volume2)}
            {navItem("appearance", "Appearance", Sun)}
            {navItem("files", "Files", FolderOpen)}
            {navItem("network", "Network", Network)}
            {navItem("diagnostics", "Diagnostics", Activity)}
            {navItem("help", "Help", LifeBuoy)}
            {navItem("about", "About", Info)}
          </div>
          <div className="px-3 py-2 text-[11px] text-slate-400 dark:text-slate-600 border-t border-slate-200 dark:border-slate-800">
            LANX v{systemInfo?.app_version || "1.2.0"} · Windows
          </div>
        </div>

        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-slate-100 dark:border-slate-800">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">{titles[activeTab]}</h3>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
            {activeTab === "profile" && (
              <>
                <div>
                  <label className={labelCls}>Your name (what colleagues see)</label>
                  <input
                    type="text"
                    value={form.display_name}
                    maxLength={60}
                    onChange={(e) => setForm({ ...form, display_name: e.target.value })}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Avatar colour</label>
                  <div className="flex items-center gap-2">
                    {AVATAR_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setForm({ ...form, avatar_color: c })}
                        className={`h-7 w-7 rounded-full transition-transform ${
                          form.avatar_color === c
                            ? "ring-2 ring-offset-2 ring-sky-500 scale-110 dark:ring-offset-slate-900"
                            : "opacity-80 hover:opacity-100"
                        }`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                </div>
                <div>
                  <label className={labelCls}>Computer name</label>
                  <input type="text" readOnly value={form.hostname} className={`${inputCls} text-slate-500 dark:text-slate-400`} />
                </div>
                <div>
                  <label className={labelCls}>Device ID</label>
                  <div className="flex items-center gap-2">
                    <input type="text" readOnly value={form.device_id} className={`${inputCls} font-mono text-slate-500 dark:text-slate-400`} />
                    <button
                      type="button"
                      onClick={() => copy("id", form.device_id)}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                    >
                      {copied === "id" ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
              </>
            )}

            {activeTab === "general" && (
              <>
                <Toggle
                  checked={form.notifications_enabled}
                  onChange={(v) => setForm({ ...form, notifications_enabled: v })}
                  title="Show notifications"
                  description="A Windows notification for new messages and files when LANX is not in front."
                />
                <Toggle
                  checked={form.launch_at_startup}
                  onChange={(v) => setForm({ ...form, launch_at_startup: v })}
                  title="Start LANX when Windows starts"
                  description="Starts quietly in the system tray so colleagues can always reach you."
                />
                <Toggle
                  checked={form.close_to_tray}
                  onChange={(v) => setForm({ ...form, close_to_tray: v })}
                  title="Keep running when the window is closed"
                  description="Closing the window hides LANX to the tray (bottom-right, near the clock) so messages still arrive. Quit from the tray icon."
                />
              </>
            )}

            {activeTab === "privacy" && (
              <>
                <PinManager pinSet={!!form.pin_enabled} onChanged={refreshPin} />
                <div className={`rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 p-3 ${form.pin_enabled ? "" : "opacity-50"}`}>
                  <label className={labelCls}>Lock automatically after I've been away for</label>
                  <select
                    disabled={!form.pin_enabled}
                    value={form.auto_lock_minutes}
                    onChange={(e) => setForm({ ...form, auto_lock_minutes: Number(e.target.value) })}
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs text-slate-900 dark:text-white"
                  >
                    {AUTO_LOCK.map((o) => (
                      <option key={o.v} value={o.v}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[11px] text-slate-500">
                    You can also lock right away with the 🔒 button at the bottom-left, or from the tray icon.
                  </p>
                </div>
                <Toggle
                  checked={form.read_receipts}
                  onChange={(v) => setForm({ ...form, read_receipts: v })}
                  title="Send “Seen” receipts and show when I'm typing"
                  description="Colleagues see when you've read their messages and when you're typing. (Secret messages always report “read” so they can disappear on both sides.)"
                />
                <Toggle
                  checked={form.auto_download_images}
                  onChange={(v) => setForm({ ...form, auto_download_images: v })}
                  title="Download pictures automatically"
                  description="Images under 10 MB (screenshots, photos) download and preview right away. Other files still need your OK."
                />
                <div className="rounded-xl border border-violet-200 dark:border-violet-900 bg-violet-50 dark:bg-violet-950/30 p-3 text-[11px] text-violet-800 dark:text-violet-200 leading-relaxed">
                  <b>Secret chats:</b> open a chat and press the ⏱ timer button. Messages then disappear for both of you after they're read, are never searchable, and LANX blocks screenshots while the chat is open.
                  <br />
                  <b>Hidden chats:</b> open a chat and press the crossed-out eye at the top to hide it. To see hidden chats again, click “Hidden chats” at the top of your chat list and enter your PIN — they show in purple so you always know where you are.
                </div>
              </>
            )}

            {activeTab === "backup" && <BackupPanel />}

            {activeTab === "sounds" && (
              <>
                <Toggle
                  checked={form.sound_enabled}
                  onChange={(v) => setForm({ ...form, sound_enabled: v })}
                  title="Play LANX sounds"
                  description="A sound for new messages and files (when LANX is not in front), and a bell when someone rings you."
                />
                <div className={form.sound_enabled ? "" : "opacity-50 pointer-events-none"}>
                  <label className={labelCls}>Message sound</label>
                  <div className="grid grid-cols-2 gap-2">
                    {SOUNDS.map((s) => (
                      <div
                        key={s.id}
                        className={`flex items-center justify-between rounded-xl border px-3 py-2 cursor-pointer transition-all ${
                          form.sound_choice === s.id
                            ? "border-sky-500 bg-sky-500/10 ring-1 ring-sky-500"
                            : "border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/60"
                        }`}
                        onClick={() => {
                          setForm({ ...form, sound_choice: s.id });
                          preview(s.id);
                        }}
                      >
                        <span className="flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-200">
                          <Music className="h-3.5 w-3.5 text-sky-500" /> {s.label}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            preview(s.id);
                          }}
                          className="p-1 rounded-md text-slate-500 hover:text-sky-600 hover:bg-white dark:hover:bg-slate-900"
                          title="Play"
                        >
                          <Play className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <div
                    className={`mt-2 flex items-center justify-between gap-2 rounded-xl border px-3 py-2 ${
                      form.sound_choice === "custom" ? "border-sky-500 bg-sky-500/10 ring-1 ring-sky-500" : "border-slate-200 dark:border-slate-800"
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">My own sound</div>
                      <div className="text-[11px] text-slate-500 truncate">
                        {form.custom_sound_path ? form.custom_sound_path.split(/[\\/]/).pop() : "Any .wav file up to 5 MB"}
                      </div>
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      {form.custom_sound_path && (
                        <button type="button" onClick={() => preview("custom")} className="p-1.5 rounded-md text-slate-500 hover:text-sky-600" title="Play">
                          <Play className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            const p = await api.pickSoundFile();
                            if (p) {
                              setForm({ ...form, sound_choice: "custom", custom_sound_path: p });
                              api.playSound("custom", form.sound_volume, p).catch(() => {});
                            }
                          } catch (err) {
                            setError(errorText(err));
                          }
                        }}
                        className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-[11px] font-semibold text-slate-700 dark:text-slate-200"
                      >
                        Choose…
                      </button>
                    </div>
                  </div>
                  <label className={`${labelCls} mt-4`}>Volume · {form.sound_volume}%</label>
                  <input
                    type="range"
                    min={10}
                    max={100}
                    step={5}
                    value={form.sound_volume}
                    onChange={(e) => setForm({ ...form, sound_volume: Number(e.target.value) })}
                    onMouseUp={() => preview(form.sound_choice)}
                    onKeyUp={() => preview(form.sound_choice)}
                    className="w-full accent-sky-500"
                  />
                  <div className="mt-3 flex items-center justify-between rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 px-3 py-2">
                    <span className="text-[11px] text-amber-800 dark:text-amber-200">
                      🔔 The ring bell (when a colleague rings you) always uses the bell sound.
                    </span>
                    <button type="button" onClick={() => preview("bell")} className="p-1 rounded-md text-amber-700 hover:bg-amber-100 dark:hover:bg-amber-900/40" title="Play bell">
                      <Play className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </>
            )}

            {activeTab === "help" && (
              <div className="space-y-4">
                <div className="rounded-2xl bg-gradient-to-br from-sky-500 to-indigo-600 p-5 text-white shadow-lg">
                  <Sparkles className="h-6 w-6 mb-2" />
                  <h4 className="text-sm font-bold">Take the tour again</h4>
                  <p className="mt-1 text-xs text-sky-100">A short animated guide to chatting, files, groups, secret chats, the PIN and the bell.</p>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onShowGuide();
                    }}
                    className="mt-3 px-4 py-2 rounded-xl bg-white text-sky-700 text-xs font-bold hover:bg-sky-50"
                  >
                    Show the guide
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-600 dark:text-slate-300">
                  {[
                    ["Send a file", "📎 button, drag it into a chat, or Ctrl+V for screenshots"],
                    ["Get attention", "🔔 bell in the chat header rings their computer"],
                    ["Make a group", "The people icon at the top of the chat list"],
                    ["Tell everyone", "The 📣 megaphone sends to many at once"],
                    ["Secret chat", "⏱ in a chat: messages disappear after reading"],
                    ["Lock LANX", "Settings → Privacy sets a PIN; 🔒 locks now"],
                    ["Colleague missing?", "Peers → Connect by IP (their IP is in Settings → Network)"],
                    ["Quit LANX", "Right-click the tray icon near the clock → Quit"],
                  ].map(([t, d]) => (
                    <div key={t} className="rounded-xl border border-slate-200 dark:border-slate-800 p-2.5">
                      <div className="font-semibold text-slate-800 dark:text-slate-100">{t}</div>
                      <div className="mt-0.5 text-slate-500">{d}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === "appearance" && (
              <>
                <div className="grid grid-cols-3 gap-3">
                  {(
                    [
                      ["system", "Match Windows", Laptop],
                      ["light", "Light", Sun],
                      ["dark", "Dark", Moon],
                    ] as const
                  ).map(([key, label, Icon]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => handleThemeSelect(key)}
                      className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-all ${
                        form.theme === key
                          ? "border-sky-500 bg-sky-500/10 text-sky-600 dark:text-sky-400 ring-1 ring-sky-500"
                          : "border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-700 dark:text-slate-300"
                      }`}
                    >
                      <Icon className="h-6 w-6" />
                      <span className="text-xs font-semibold">{label}</span>
                    </button>
                  ))}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">The theme is saved immediately.</p>
              </>
            )}

            {activeTab === "files" && (
              <>
                <div>
                  <label className={labelCls}>Save received files to</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={form.default_download_dir || "Downloads"}
                      className={`${inputCls} font-mono`}
                    />
                    <button
                      type="button"
                      onClick={handlePickFolder}
                      className="shrink-0 px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
                    >
                      Change…
                    </button>
                  </div>
                </div>
                <Toggle
                  checked={form.auto_download_transfers}
                  onChange={(v) => setForm({ ...form, auto_download_transfers: v })}
                  title="Auto-accept files from trusted contacts"
                  description="Files from contacts you marked as trusted start downloading without asking. Everyone else still needs your OK."
                />
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 p-3 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                  There is no size limit. Every file is encrypted in transit and checked with SHA-256 when it arrives. If
                  the network drops, press <b>Resume</b> and it continues from where it stopped. To send a folder, zip it
                  first (right-click → Send to → Compressed folder).
                </div>
              </>
            )}

            {activeTab === "network" && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Discovery port (UDP)</label>
                    <input
                      type="number"
                      min={1024}
                      max={65535}
                      value={form.udp_discovery_port}
                      onChange={(e) => setForm({ ...form, udp_discovery_port: parseInt(e.target.value) || 52925 })}
                      className={`${inputCls} font-mono`}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Messaging port (TCP)</label>
                    <input
                      type="number"
                      min={1024}
                      max={65535}
                      value={form.tcp_messaging_port}
                      onChange={(e) => setForm({ ...form, tcp_messaging_port: parseInt(e.target.value) || 52926 })}
                      className={`${inputCls} font-mono`}
                    />
                  </div>
                </div>
                {portsChanged && (
                  <div className="rounded-xl border border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 px-3 py-2 text-[11px] text-amber-800 dark:text-amber-200">
                    Port changes apply after you quit LANX from the tray icon and open it again. Every computer must use
                    the same discovery port.
                  </div>
                )}
                <div>
                  <label className={labelCls}>Announce this computer every (seconds)</label>
                  <input
                    type="number"
                    min={2}
                    max={60}
                    value={form.discovery_interval_secs}
                    onChange={(e) => setForm({ ...form, discovery_interval_secs: parseInt(e.target.value) || 5 })}
                    className={`${inputCls} font-mono`}
                  />
                </div>
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 p-3 text-xs text-slate-500 dark:text-slate-400">
                  <p className="font-semibold text-slate-700 dark:text-slate-300 mb-1">This computer's IP addresses</p>
                  <div className="flex flex-wrap gap-1.5">
                    {(systemInfo?.local_ips ?? []).map((ip) => (
                      <button
                        key={ip}
                        type="button"
                        onClick={() => copy(ip, ip)}
                        title="Copy"
                        className="px-2 py-0.5 rounded-md bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono text-[11px] text-sky-600 dark:text-sky-400"
                      >
                        {copied === ip ? "copied" : ip}
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-[11px]">
                    Colleagues on another subnet can add you with Peers → Connect by IP.
                  </p>
                </div>
              </>
            )}

            {activeTab === "diagnostics" && (
              <>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40">
                    <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Receiving messages</div>
                    {status(systemInfo?.tcp_listening, `Listening on TCP ${settings.tcp_messaging_port}`, `TCP port ${settings.tcp_messaging_port} is in use`)}
                  </div>
                  <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40">
                    <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Finding colleagues</div>
                    {status(systemInfo?.udp_listening, `Listening on UDP ${settings.udp_discovery_port}`, `UDP port ${settings.udp_discovery_port} is in use`)}
                  </div>
                </div>

                <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                    <KeyRound className="h-3 w-3" /> Your security code
                  </div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="font-mono text-sm text-slate-900 dark:text-white tracking-wide">{systemInfo?.fingerprint || "—"}</span>
                    {systemInfo?.fingerprint && (
                      <button
                        type="button"
                        onClick={() => copy("fp", systemInfo.fingerprint)}
                        className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-200/60 dark:hover:bg-slate-800"
                      >
                        {copied === "fp" ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                      </button>
                    )}
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Colleagues see this code in your contact details. Matching codes prove they are really talking to this computer.
                  </p>
                </div>

                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 p-4">
                  <h4 className="text-xs font-bold text-slate-900 dark:text-white mb-1">Test a connection</h4>
                  <p className="text-xs text-slate-500 mb-3">
                    Checks that LANX on another computer can be reached and that encryption works.
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="IP, e.g. 192.168.1.50"
                      value={testIp}
                      onChange={(e) => setTestIp(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleRunTest()}
                      className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-mono text-slate-900 dark:text-white select-text"
                    />
                    <input
                      type="number"
                      value={testPort}
                      onChange={(e) => setTestPort(parseInt(e.target.value) || 52926)}
                      className="w-24 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-mono text-slate-900 dark:text-white"
                    />
                    <button
                      type="button"
                      onClick={handleRunTest}
                      disabled={testing || !testIp.trim()}
                      className="px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-600 text-white text-xs font-semibold disabled:opacity-50 flex items-center gap-1.5"
                    >
                      {testing && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                      <span>Test</span>
                    </button>
                  </div>
                  {testResult && (
                    <div
                      className={`mt-3 p-3 rounded-lg text-xs ${
                        testResult.reachable
                          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30"
                          : "bg-red-500/10 text-red-700 dark:text-red-400 border border-red-500/30"
                      }`}
                    >
                      {testResult.message}
                    </div>
                  )}
                </div>

                <div className="text-[11px] text-slate-500 space-y-0.5">
                  <div>
                    Database: <span className="font-mono">{systemInfo?.database_path}</span> ({formatSize(systemInfo?.database_size_bytes ?? 0)})
                  </div>
                </div>
              </>
            )}

            {activeTab === "about" && (
              <div className="space-y-4 text-center py-4">
                <img src="/lanx-logo.png" alt="" className="mx-auto h-16 w-16 rounded-2xl shadow-lg" />
                <div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">LANX</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Version {systemInfo?.app_version || "1.0.0"}</p>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300 max-w-md mx-auto leading-relaxed">
                  Office messenger and file sharing for your local network. No internet, no server, no accounts: computers
                  find each other automatically and talk directly, end-to-end encrypted (X25519 key exchange,
                  ChaCha20-Poly1305, Ed25519 device identities). Messages and files wait and deliver automatically when a
                  colleague comes back online.
                </p>
                <div className="inline-flex items-center gap-1.5 text-[11px] text-slate-400">
                  <SlidersHorizontal className="h-3 w-3" /> Data is stored only on this PC, in %APPDATA%\LANX
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 px-6 py-4 border-t border-slate-100 dark:border-slate-800">
            <span className="text-[11px] text-red-600 dark:text-red-400 truncate">{error}</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || !form.display_name.trim()}
                className="px-5 py-2 rounded-xl bg-sky-500 hover:bg-sky-600 text-white text-xs font-semibold shadow-md shadow-sky-500/20 transition-all disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
