import React, { useState } from "react";
import { UserSettings } from "../types";
import { api } from "../lib/api";
import { Shield, Wifi, CheckCircle2, ArrowRight, User, Sparkles } from "lucide-react";

interface OnboardingModalProps {
  settings: UserSettings;
  onComplete: (updated: UserSettings) => void;
}

const AVATAR_COLORS = [
  "#0284c7", // Sky blue
  "#6366f1", // Indigo
  "#8b5cf6", // Purple
  "#ec4899", // Pink
  "#10b981", // Emerald
  "#06b6d4", // Cyan
  "#f59e0b", // Amber
  "#ef4444", // Red
];

export const OnboardingModal: React.FC<OnboardingModalProps> = ({
  settings,
  onComplete,
}) => {
  const [step, setStep] = useState<1 | 2>(1);
  const [displayName, setDisplayName] = useState(settings.display_name || "LANX User");
  const [avatarColor, setAvatarColor] = useState(settings.avatar_color || "#0284c7");
  const [launchAtStartup, setLaunchAtStartup] = useState(settings.launch_at_startup ?? true);
  const [saving, setSaving] = useState(false);

  const handleFinish = async () => {
    if (!displayName.trim()) return;
    setSaving(true);
    try {
      const updated = await api.completeOnboarding(displayName.trim(), avatarColor, launchAtStartup);
      onComplete(updated);
    } catch (err) {
      console.error("Failed to complete onboarding:", err);
      // Fallback
      onComplete({
        ...settings,
        display_name: displayName.trim(),
        avatar_color: avatarColor,
        launch_at_startup: launchAtStartup,
        onboarding_completed: true,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center lanx-scrim p-4">
      <div className="w-full max-w-lg rounded-[22px] lanx-sheet lanx-sheet-in overflow-hidden transition-all duration-300">
        {/* Header bar */}
        <div className="relative px-8 pt-8 pb-4 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-500/10 text-sky-500 dark:bg-sky-500/20 shadow-inner">
            <Wifi className="h-7 w-7" />
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Welcome to LANX
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            High-speed, zero-cloud messenger for your local network
          </p>
        </div>

        {/* Step Indicator */}
        <div className="flex items-center justify-center gap-2 px-8 py-2">
          <div
            className={`h-1.5 rounded-full transition-all duration-300 ${
              step === 1 ? "w-8 bg-sky-500" : "w-2 bg-slate-300 dark:bg-slate-700"
            }`}
          />
          <div
            className={`h-1.5 rounded-full transition-all duration-300 ${
              step === 2 ? "w-8 bg-sky-500" : "w-2 bg-slate-300 dark:bg-slate-700"
            }`}
          />
        </div>

        <div className="p-8">
          {step === 1 && (
            <div className="space-y-6">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
                  Your Display Name
                </label>
                <div className="relative">
                  <User className="absolute left-3.5 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Enter your name or handle..."
                    className="w-full rounded-xl lanx-field pl-11 pr-4 py-3 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500 transition-all"
                  />
                </div>
                <p className="mt-1.5 text-xs text-slate-500">
                  This is how colleagues and devices on your LAN will identify you.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
                  Choose Avatar Color
                </label>
                <div className="flex items-center gap-3">
                  <div
                    className="h-12 w-12 rounded-full flex items-center justify-center text-white font-bold text-lg shadow-md transition-transform"
                    style={{ backgroundColor: avatarColor }}
                  >
                    {displayName.charAt(0).toUpperCase() || "U"}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {AVATAR_COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => setAvatarColor(color)}
                        className={`h-7 w-7 rounded-full transition-transform ${
                          avatarColor === color
                            ? "ring-2 ring-offset-2 ring-sky-500 scale-110 dark:ring-offset-slate-900"
                            : "hover:scale-105 opacity-80 hover:opacity-100"
                        }`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>
              </div>

              <div className="rounded-xl lanx-group p-4 text-xs text-slate-600 dark:text-slate-300 flex items-start gap-3">
                <Sparkles className="h-5 w-5 text-sky-500 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold text-slate-900 dark:text-white">
                    Private by design
                  </span>
                  <p className="mt-0.5 text-slate-500 dark:text-slate-400">
                    This PC has its own encryption key, created just now and stored only here. Chats and files are
                    end-to-end encrypted and never leave your office network.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setStep(2)}
                disabled={!displayName.trim()}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-sky-500 hover:bg-sky-600 active:bg-sky-700 text-white font-semibold py-3 px-4 shadow-lg shadow-sky-500/20 transition-all disabled:opacity-50"
              >
                <span>Continue</span>
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6">
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 dark:bg-emerald-500/15 p-4 text-xs">
                <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-300 font-semibold mb-1">
                  <CheckCircle2 className="h-4 w-4" />
                  <span>Local-Network-First Architecture</span>
                </div>
                <p className="text-emerald-900/80 dark:text-emerald-200/80">
                  LANX works without the internet. Computers on the same office Wi-Fi or network find each other
                  automatically within a few seconds.
                </p>
              </div>

              <div className="space-y-3">
                <div className="flex items-start gap-3 text-xs text-slate-600 dark:text-slate-300">
                  <Shield className="h-4 w-4 text-sky-500 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold text-slate-900 dark:text-white">Firewall already set up</span>
                    <p className="text-slate-500 dark:text-slate-400 mt-0.5">
                      The installer allowed LANX through Windows Firewall, so colleagues can reach you straight away.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 text-xs text-slate-600 dark:text-slate-300">
                  <Wifi className="h-4 w-4 text-sky-500 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold text-slate-900 dark:text-white">Manual Connection Option</span>
                    <p className="text-slate-500 dark:text-slate-400 mt-0.5">
                      If a colleague doesn't appear (different floor or subnet), open Peers → Connect by IP and type
                      their IP address.
                    </p>
                  </div>
                </div>
              </div>

              <label className="flex items-start gap-3 rounded-xl border lanx-line p-3 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={launchAtStartup}
                  onChange={(e) => setLaunchAtStartup(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-sky-500"
                />
                <span>
                  <span className="font-semibold text-slate-900 dark:text-white">Start LANX when Windows starts</span>
                  <span className="block text-slate-500 dark:text-slate-400 mt-0.5">
                    Runs quietly in the tray so you never miss a message. You can change this in Settings.
                  </span>
                </span>
              </label>

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="rounded-xl lanx-btn py-3 px-5 text-sm font-medium text-slate-700 dark:text-slate-300 transition-colors"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={handleFinish}
                  disabled={saving}
                  className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-sky-500 hover:bg-sky-600 active:bg-sky-700 text-white font-semibold py-3 px-4 shadow-lg shadow-sky-500/20 transition-all disabled:opacity-50"
                >
                  {saving ? (
                    <span>Initializing...</span>
                  ) : (
                    <>
                      <span>Launch LANX</span>
                      <CheckCircle2 className="h-4 w-4" />
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
