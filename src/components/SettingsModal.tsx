import React, { useState, useEffect } from "react";
import { UserSettings, SystemInfo, ConnectionTestResult } from "../types";
import { api } from "../lib/api";
import {
  X,
  User,
  Sun,
  Moon,
  Laptop,
  Database,
  Network,
  Info,
  Check,
  Copy,
  Activity,
  RefreshCw,
} from "lucide-react";

interface SettingsModalProps {
  settings: UserSettings;
  isOpen: boolean;
  onClose: () => void;
  onSave: (updated: UserSettings) => void;
  onThemeChange: (theme: "system" | "dark" | "light") => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  settings,
  isOpen,
  onClose,
  onSave,
  onThemeChange,
}) => {
  const [activeTab, setActiveTab] = useState<
    "profile" | "appearance" | "network" | "storage" | "diagnostics" | "about"
  >("profile");

  const [form, setForm] = useState<UserSettings>({ ...settings });
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [copiedId, setCopiedId] = useState(false);
  const [saving, setSaving] = useState(false);

  // Diagnostics test state
  const [testIp, setTestIp] = useState("192.168.1.1");
  const [testPort, setTestPort] = useState(52926);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setForm({ ...settings });
      api.getSystemInfo().then(setSystemInfo).catch(console.error);
    }
  }, [isOpen, settings]);

  if (!isOpen) return null;

  const handleCopyDeviceId = () => {
    navigator.clipboard.writeText(form.device_id);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  const handleThemeSelect = async (theme: "system" | "dark" | "light") => {
    const updated = { ...form, theme };
    setForm(updated);
    onThemeChange(theme);
    try {
      await api.saveSettings(updated);
      onSave(updated);
    } catch (err) {
      console.error("Failed to persist theme setting:", err);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.saveSettings(form);
      onSave(form);
      onClose();
    } catch (err) {
      console.error("Failed to save settings:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleRunTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api.testLanConnection(testIp, testPort);
      setTestResult(res);
    } catch (err) {
      setTestResult({
        reachable: false,
        ip: testIp,
        port: testPort,
        message: String(err),
      });
    } finally {
      setTesting(false);
    }
  };

  const AVATAR_COLORS = [
    "#0284c7",
    "#6366f1",
    "#8b5cf6",
    "#ec4899",
    "#10b981",
    "#06b6d4",
    "#f59e0b",
    "#ef4444",
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl h-[560px] rounded-2xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 shadow-2xl flex overflow-hidden">
        {/* Navigation Sidebar */}
        <div className="w-52 border-r border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0c111c] p-3 flex flex-col justify-between">
          <div className="space-y-1">
            <div className="px-3 py-2 text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              Settings
            </div>
            <button
              type="button"
              onClick={() => setActiveTab("profile")}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-semibold rounded-lg transition-colors ${
                activeTab === "profile"
                  ? "bg-sky-500 text-white shadow-sm"
                  : "text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-800"
              }`}
            >
              <User className="h-4 w-4" />
              <span>Profile</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("appearance")}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-semibold rounded-lg transition-colors ${
                activeTab === "appearance"
                  ? "bg-sky-500 text-white shadow-sm"
                  : "text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-800"
              }`}
            >
              <Sun className="h-4 w-4" />
              <span>Appearance</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("network")}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-semibold rounded-lg transition-colors ${
                activeTab === "network"
                  ? "bg-sky-500 text-white shadow-sm"
                  : "text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-800"
              }`}
            >
              <Network className="h-4 w-4" />
              <span>LAN Discovery</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("storage")}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-semibold rounded-lg transition-colors ${
                activeTab === "storage"
                  ? "bg-sky-500 text-white shadow-sm"
                  : "text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-800"
              }`}
            >
              <Database className="h-4 w-4" />
              <span>Database & Files</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("diagnostics")}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-semibold rounded-lg transition-colors ${
                activeTab === "diagnostics"
                  ? "bg-sky-500 text-white shadow-sm"
                  : "text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-800"
              }`}
            >
              <Activity className="h-4 w-4" />
              <span>Diagnostics</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("about")}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-semibold rounded-lg transition-colors ${
                activeTab === "about"
                  ? "bg-sky-500 text-white shadow-sm"
                  : "text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-800"
              }`}
            >
              <Info className="h-4 w-4" />
              <span>About LANX</span>
            </button>
          </div>

          <div className="px-3 py-2 text-[11px] text-slate-400 dark:text-slate-600 border-t border-slate-200 dark:border-slate-800">
            LANX v0.1.0 • Windows
          </div>
        </div>

        {/* Content Panel */}
        <div className="flex-1 flex flex-col justify-between p-6 overflow-y-auto">
          <div>
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
              <h3 className="text-base font-bold text-slate-900 dark:text-white capitalize">
                {activeTab} Settings
              </h3>
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-5 space-y-4">
              {activeTab === "profile" && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                      Display Name
                    </label>
                    <input
                      type="text"
                      value={form.display_name}
                      onChange={(e) =>
                        setForm({ ...form, display_name: e.target.value })
                      }
                      className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3.5 py-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
                      Avatar Palette
                    </label>
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
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                      Device Identity (UUID)
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        readOnly
                        value={form.device_id}
                        className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-900/60 px-3 py-2 text-xs font-mono text-slate-500 dark:text-slate-400 select-all"
                      />
                      <button
                        type="button"
                        onClick={handleCopyDeviceId}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                      >
                        {copiedId ? (
                          <>
                            <Check className="h-3.5 w-3.5 text-emerald-500" />
                            <span className="text-emerald-500">Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="h-3.5 w-3.5" />
                            <span>Copy</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                      Windows Computer Name
                    </label>
                    <input
                      type="text"
                      readOnly
                      value={form.hostname}
                      className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-900/60 px-3.5 py-2.5 text-xs text-slate-500 dark:text-slate-400 select-all"
                    />
                  </div>
                </div>
              )}

              {activeTab === "appearance" && (
                <div className="space-y-4">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
                    Application Theme
                  </label>
                  <div className="grid grid-cols-3 gap-3">
                    <button
                      type="button"
                      onClick={() => handleThemeSelect("system")}
                      className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-all ${
                        form.theme === "system"
                          ? "border-sky-500 bg-sky-500/10 text-sky-600 dark:text-sky-400 ring-1 ring-sky-500"
                          : "border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-700 dark:text-slate-300"
                      }`}
                    >
                      <Laptop className="h-6 w-6" />
                      <span className="text-xs font-semibold">System Default</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleThemeSelect("light")}
                      className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-all ${
                        form.theme === "light"
                          ? "border-sky-500 bg-sky-500/10 text-sky-600 dark:text-sky-400 ring-1 ring-sky-500"
                          : "border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-700 dark:text-slate-300"
                      }`}
                    >
                      <Sun className="h-6 w-6" />
                      <span className="text-xs font-semibold">Light Theme</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleThemeSelect("dark")}
                      className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-all ${
                        form.theme === "dark"
                          ? "border-sky-500 bg-sky-500/10 text-sky-600 dark:text-sky-400 ring-1 ring-sky-500"
                          : "border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-700 dark:text-slate-300"
                      }`}
                    >
                      <Moon className="h-6 w-6" />
                      <span className="text-xs font-semibold">Dark Theme</span>
                    </button>
                  </div>

                  <div className="pt-2 text-xs text-slate-500 dark:text-slate-400">
                    Follows Windows 10/11 system appearance by default. When light or dark is selected, LANX persists your preference immediately.
                  </div>
                </div>
              )}

              {activeTab === "network" && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                        UDP Broadcast Discovery Port
                      </label>
                      <input
                        type="number"
                        value={form.udp_discovery_port}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            udp_discovery_port: parseInt(e.target.value) || 52925,
                          })
                        }
                        className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3.5 py-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500 font-mono"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                        TCP Direct Messaging Port
                      </label>
                      <input
                        type="number"
                        value={form.tcp_messaging_port}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            tcp_messaging_port: parseInt(e.target.value) || 52926,
                          })
                        }
                        className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3.5 py-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500 font-mono"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                      Discovery Beacon Interval (seconds)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={60}
                      value={form.discovery_interval_secs}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          discovery_interval_secs: parseInt(e.target.value) || 5,
                        })
                      }
                      className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3.5 py-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500 font-mono"
                    />
                  </div>

                  <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 p-3 text-xs text-slate-500 dark:text-slate-400">
                    <p className="font-semibold text-slate-700 dark:text-slate-300 mb-0.5">
                      Detected Local IP Addresses:
                    </p>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {systemInfo?.local_ips.map((ip) => (
                        <span
                          key={ip}
                          className="px-2 py-0.5 rounded-md bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono text-[11px] text-sky-600 dark:text-sky-400"
                        >
                          {ip}
                        </span>
                      )) || <span>127.0.0.1</span>}
                    </div>
                  </div>
                </div>
              )}

              {activeTab === "storage" && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                      SQLite Database Location
                    </label>
                    <input
                      type="text"
                      readOnly
                      value={systemInfo?.database_path || "%APPDATA%\\LANX\\lanx.db"}
                      className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-900/60 px-3.5 py-2.5 text-xs font-mono text-slate-500 dark:text-slate-400 select-all"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40">
                      <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                        Database Size
                      </div>
                      <div className="text-lg font-bold text-slate-900 dark:text-white mt-0.5">
                        {systemInfo ? (systemInfo.database_size_bytes / 1024).toFixed(1) + " KB" : "40.0 KB"}
                      </div>
                      <div className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-1">
                        ● WAL Journal Mode Active
                      </div>
                    </div>

                    <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40">
                      <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                        Default Downloads Directory
                      </div>
                      <div className="text-xs font-mono text-slate-700 dark:text-slate-300 truncate mt-1">
                        {form.default_download_dir || "Public\\Downloads"}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 p-3 text-xs text-slate-500">
                    <span className="font-semibold text-slate-700 dark:text-slate-300">
                      Backup & Export Strategy:
                    </span>{" "}
                    Your SQLite database stores versioned migrations, chat transcripts, and known peer identities safely on your local disk without external transmission.
                  </div>
                </div>
              )}

              {activeTab === "diagnostics" && (
                <div className="space-y-4">
                  <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 p-4">
                    <h4 className="text-xs font-bold text-slate-900 dark:text-white mb-2">
                      LAN Peer Socket Ping Test
                    </h4>
                    <p className="text-xs text-slate-500 mb-3">
                      Test direct TCP connectivity to another machine on the LAN to verify that Windows Defender Firewall or router AP Isolation is not blocking connections.
                    </p>

                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="IP (e.g. 192.168.1.50)"
                        value={testIp}
                        onChange={(e) => setTestIp(e.target.value)}
                        className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-mono text-slate-900 dark:text-white"
                      />
                      <input
                        type="number"
                        placeholder="Port"
                        value={testPort}
                        onChange={(e) => setTestPort(parseInt(e.target.value) || 52926)}
                        className="w-24 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-mono text-slate-900 dark:text-white"
                      />
                      <button
                        type="button"
                        onClick={handleRunTest}
                        disabled={testing}
                        className="px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-600 text-white text-xs font-semibold transition-all disabled:opacity-50 flex items-center gap-1.5"
                      >
                        {testing ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : null}
                        <span>Test Ping</span>
                      </button>
                    </div>

                    {testResult && (
                      <div
                        className={`mt-3 p-3 rounded-lg text-xs font-mono ${
                          testResult.reachable
                            ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30"
                            : "bg-red-500/10 text-red-700 dark:text-red-400 border border-red-500/30"
                        }`}
                      >
                        {testResult.message}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {activeTab === "about" && (
                <div className="space-y-4 text-center py-4">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-500 text-white font-bold text-2xl shadow-lg shadow-sky-500/30">
                    L
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                      LANX Desktop
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Version 0.1.0 (Milestone 1 — Foundation Shell)
                    </p>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-300 max-w-sm mx-auto leading-relaxed">
                    Completely free, modern, local-network desktop messaging with Apple-inspired ergonomics, native SQLite storage, and no centralized cloud dependency.
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-100 dark:border-slate-800">
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
              disabled={saving}
              className="px-5 py-2 rounded-xl bg-sky-500 hover:bg-sky-600 text-white text-xs font-semibold shadow-md shadow-sky-500/20 transition-all disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
