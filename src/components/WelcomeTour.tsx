import React, { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  CheckCheck,
  EyeOff,
  FileSpreadsheet,
  Lock,
  Megaphone,
  Monitor,
  Timer,
  Users,
  X,
} from "lucide-react";

/** Animated, step-by-step guide to LANX (shown after first setup, and from Settings → Help). */

interface Step {
  title: string;
  text: string;
  tip?: string;
  art: React.ReactNode;
}

const Avatar: React.FC<{ letter: string; color: string; className?: string; style?: React.CSSProperties }> = ({ letter, color, className = "", style }) => (
  <div className={`h-9 w-9 rounded-full flex items-center justify-center text-white text-xs font-bold shadow-md ${className}`} style={{ backgroundColor: color, ...style }}>
    {letter}
  </div>
);

const Screen: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="relative mx-auto h-56 w-[340px] rounded-2xl bg-white/90 dark:bg-slate-900/90 border border-white/60 dark:border-slate-700 shadow-2xl overflow-hidden">
    <div className="flex items-center gap-1 px-3 py-2 border-b border-slate-100 dark:border-slate-800">
      <span className="h-2 w-2 rounded-full bg-red-400" />
      <span className="h-2 w-2 rounded-full bg-amber-400" />
      <span className="h-2 w-2 rounded-full bg-emerald-400" />
      <span className="ml-2 text-[10px] font-semibold text-slate-400">LANX</span>
    </div>
    <div className="relative h-[calc(100%-29px)] p-3">{children}</div>
  </div>
);

const STEPS: Step[] = [
  {
    title: "Welcome to LANX",
    text: "Chat and share files with everyone on your office network — instantly, privately, and without the internet.",
    art: (
      <div className="relative mx-auto h-56 w-[340px] flex items-center justify-center">
        <span className="tour-ripple" />
        <span className="tour-ripple" style={{ animationDelay: "0.8s" }} />
        <span className="tour-ripple" style={{ animationDelay: "1.6s" }} />
        <img src="/lanx-logo.png" alt="" className="relative h-24 w-24 rounded-3xl shadow-2xl shadow-sky-500/40 tour-bounce" />
        {[
          ["A", "#6366f1", "8%", "18%"],
          ["B", "#10b981", "78%", "12%"],
          ["C", "#ec4899", "80%", "70%"],
          ["D", "#f59e0b", "6%", "72%"],
        ].map(([l, c, x, y], i) => (
          <div key={l} className="absolute tour-pop" style={{ left: x, top: y, animationDelay: `${0.4 + i * 0.25}s` }}>
            <div className="flex flex-col items-center">
              <Monitor className="h-8 w-8 text-slate-500 dark:text-slate-300" />
              <Avatar letter={l} color={c} className="-mt-2 h-6 w-6 text-[10px]" />
            </div>
          </div>
        ))}
      </div>
    ),
  },
  {
    title: "Colleagues appear by themselves",
    text: "Everyone running LANX on the same network shows up in a few seconds. No accounts, no setup.",
    tip: "Someone missing? Peers → Connect by IP.",
    art: (
      <Screen>
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-600 mb-3">
          <span className="h-2 w-2 rounded-full bg-emerald-500 online-pulse" /> 3 colleagues online
        </div>
        {[
          ["Asha (Accounts)", "#6366f1"],
          ["Bharat (Stores)", "#10b981"],
          ["Chetan (Sales)", "#ec4899"],
        ].map(([n, c], i) => (
          <div key={n} className="flex items-center gap-2.5 mb-2 tour-slide-in" style={{ animationDelay: `${0.3 + i * 0.45}s` }}>
            <div className="relative">
              <Avatar letter={n[0]} color={c} />
              <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-emerald-500 border-2 border-white dark:border-slate-900" />
            </div>
            <div>
              <div className="text-xs font-semibold text-slate-800 dark:text-slate-100">{n}</div>
              <div className="text-[10px] text-slate-400">Online</div>
            </div>
          </div>
        ))}
      </Screen>
    ),
  },
  {
    title: "Chat — encrypted, straight to their PC",
    text: "Messages go directly to your colleague's computer. If they're offline, LANX delivers them later automatically.",
    tip: "✓✓ turns green with “Seen” once they've read it.",
    art: (
      <Screen>
        <div className="flex flex-col gap-2">
          <div className="self-start max-w-[70%] rounded-2xl rounded-bl-sm bg-slate-100 dark:bg-slate-800 px-3 py-2 text-[11px] text-slate-700 dark:text-slate-200 tour-slide-in" style={{ animationDelay: "0.2s" }}>
            Is the quotation ready?
          </div>
          <div className="self-end max-w-[70%] rounded-2xl rounded-br-sm bg-sky-500 px-3 py-2 text-[11px] text-white tour-slide-in" style={{ animationDelay: "1.1s" }}>
            Yes — sending it now 👍
            <div className="mt-0.5 flex justify-end items-center gap-0.5 text-[9px] text-emerald-100 tour-fade-in" style={{ animationDelay: "2s" }}>
              <CheckCheck className="h-3 w-3" /> Seen
            </div>
          </div>
          <div className="self-start rounded-2xl rounded-bl-sm bg-slate-100 dark:bg-slate-800 px-3 py-2.5 tour-fade-in" style={{ animationDelay: "2.6s" }}>
            <span className="lanx-typing"><i /><i /><i /></span>
          </div>
        </div>
      </Screen>
    ),
  },
  {
    title: "Send files of any size",
    text: "Press 📎, drag files into the chat, or paste a screenshot with Ctrl+V. Big files resume if the network drops, and every file is checked when it arrives.",
    art: (
      <Screen>
        <div className="absolute left-4 top-6 tour-fly">
          <FileSpreadsheet className="h-10 w-10 text-emerald-500 drop-shadow" />
        </div>
        <div className="absolute right-4 bottom-4 w-52 rounded-2xl rounded-br-sm bg-sky-500 p-3 text-white shadow-lg tour-fade-in" style={{ animationDelay: "1.2s" }}>
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-7 w-7" />
            <div className="text-[11px] font-semibold">Q3-Closing.xlsx<div className="text-[9px] font-normal text-sky-100">2.4 GB</div></div>
          </div>
          <div className="mt-2 h-1.5 rounded-full bg-white/25 overflow-hidden">
            <div className="h-full bg-white rounded-full tour-progress" />
          </div>
          <div className="mt-1 text-[9px] text-sky-100">283 MB/s · encrypted · verified</div>
        </div>
      </Screen>
    ),
  },
  {
    title: "Groups and announcements",
    text: "Make a group for your team — everyone sees every message and file. The 📣 megaphone sends one message to many people at once.",
    art: (
      <Screen>
        <div className="flex items-center justify-center gap-2 mt-2">
          {[
            ["A", "#6366f1"],
            ["B", "#10b981"],
            ["C", "#ec4899"],
          ].map(([l, c], i) => (
            <Avatar key={l} letter={l} color={c} className="tour-gather" style={{ animationDelay: `${i * 0.15}s`, ["--dx" as string]: `${(i - 1) * 46}px` } as React.CSSProperties} />
          ))}
        </div>
        <div className="mx-auto mt-3 w-fit flex items-center gap-2 rounded-xl bg-indigo-500 px-3 py-2 text-white shadow-lg tour-pop" style={{ animationDelay: "1.1s" }}>
          <Users className="h-4 w-4" />
          <span className="text-[11px] font-bold">Accounts Team</span>
        </div>
        <div className="absolute bottom-4 left-0 right-0 flex items-center justify-center gap-2 tour-fade-in" style={{ animationDelay: "1.8s" }}>
          <Megaphone className="h-6 w-6 text-amber-500 tour-wiggle" />
          <span className="tour-wave" />
          <span className="tour-wave" style={{ animationDelay: "0.3s" }} />
          <span className="tour-wave" style={{ animationDelay: "0.6s" }} />
          <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">“Office closed tomorrow”</span>
        </div>
      </Screen>
    ),
  },
  {
    title: "Ring the bell 🔔",
    text: "Need an answer now? Press the bell in a chat. Their LANX rings, flashes in the taskbar and shows a notification — even if it's hidden.",
    tip: "Choose your own message sound in Settings → Sounds.",
    art: (
      <div className="relative mx-auto h-56 w-[340px] flex items-center justify-center">
        <span className="tour-ripple tour-ripple-amber" />
        <span className="tour-ripple tour-ripple-amber" style={{ animationDelay: "0.6s" }} />
        <div className="relative h-24 w-24 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-2xl shadow-amber-500/40">
          <Bell className="h-12 w-12 text-white tour-ring" />
        </div>
        <div className="absolute bottom-3 rounded-xl bg-white dark:bg-slate-800 px-3 py-2 text-[11px] font-semibold text-slate-700 dark:text-slate-200 shadow-xl tour-slide-up" style={{ animationDelay: "0.8s" }}>
          🔔 Asha is ringing you
        </div>
      </div>
    ),
  },
  {
    title: "Private when you need it",
    text: "Set a PIN to lock LANX. Use ⏱ secret chats — messages vanish after they're read and screenshots are blocked. Hide chats you don't want on screen.",
    art: (
      <Screen>
        <div className="flex items-start justify-around pt-2">
          <div className="flex flex-col items-center">
            <div className="h-14 w-14 rounded-2xl bg-sky-500/10 flex items-center justify-center">
              <Lock className="h-7 w-7 text-sky-500 tour-wiggle" />
            </div>
            <div className="mt-2 flex gap-1.5">
              {[0, 1, 2, 3].map((i) => (
                <span key={i} className="h-2.5 w-2.5 rounded-full bg-sky-500 tour-pop" style={{ animationDelay: `${0.4 + i * 0.3}s` }} />
              ))}
            </div>
            <span className="mt-1 text-[10px] text-slate-500">PIN lock</span>
          </div>
          <div className="flex flex-col items-center">
            <div className="h-14 w-14 rounded-2xl bg-violet-500/10 flex items-center justify-center">
              <Timer className="h-7 w-7 text-violet-500" />
            </div>
            <div className="mt-2 rounded-lg bg-violet-600 px-2 py-1 text-[10px] text-white tour-vanish">door code 4417</div>
            <span className="mt-1 text-[10px] text-slate-500">Secret chat</span>
          </div>
          <div className="flex flex-col items-center">
            <div className="h-14 w-14 rounded-2xl bg-slate-500/10 flex items-center justify-center">
              <EyeOff className="h-7 w-7 text-slate-500" />
            </div>
            <div className="mt-2 h-6 w-20 rounded-lg bg-slate-200 dark:bg-slate-700 tour-hide" />
            <span className="mt-1 text-[10px] text-slate-500">Hidden chats</span>
          </div>
        </div>
      </Screen>
    ),
  },
  {
    title: "Always there, quietly",
    text: "Closing the window keeps LANX running near the clock, so messages still reach you. Right-click the tray icon to lock or quit.",
    art: (
      <div className="relative mx-auto h-56 w-[340px] flex items-end justify-center pb-6">
        <div className="w-full rounded-xl bg-slate-800/90 px-3 py-2 flex items-center justify-end gap-3 text-white shadow-2xl">
          <span className="text-[10px] opacity-70">ENG</span>
          <div className="relative">
            <img src="/lanx-logo.png" alt="" className="h-6 w-6 rounded-md tour-glow" />
            <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-sky-400 tour-pop" style={{ animationDelay: "1s" }} />
          </div>
          <span className="text-[10px] tabular-nums">10:42</span>
        </div>
        <div className="absolute top-8 right-6 rounded-xl bg-white dark:bg-slate-800 shadow-xl px-3 py-2 text-[11px] text-slate-700 dark:text-slate-200 tour-slide-up" style={{ animationDelay: "1.2s" }}>
          <div className="font-semibold">Bharat (Stores)</div>
          <div className="text-slate-500">Got the file, thanks!</div>
        </div>
      </div>
    ),
  },
];

interface WelcomeTourProps {
  name: string;
  onClose: () => void;
}

export const WelcomeTour: React.FC<WelcomeTourProps> = ({ name, onClose }) => {
  const [step, setStep] = useState(0);
  const [done, setDone] = useState(false);
  const last = step === STEPS.length - 1;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setStep((s) => Math.min(s + 1, STEPS.length - 1));
      if (e.key === "ArrowLeft") setStep((s) => Math.max(s - 1, 0));
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const s = STEPS[step];

  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center p-4 bg-gradient-to-br from-sky-100/95 via-white/95 to-indigo-100/95 dark:from-[#0b1324]/97 dark:via-[#080c14]/97 dark:to-[#140f2e]/97 backdrop-blur">
      <div className="lanx-orb lanx-orb-a" />
      <div className="lanx-orb lanx-orb-b" />
      <button type="button" onClick={onClose} className="absolute top-5 right-5 flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs text-slate-500 hover:bg-white/60 dark:hover:bg-slate-800">
        Skip guide <X className="h-3.5 w-3.5" />
      </button>

      {done ? (
        <div className="relative text-center lanx-rise">
          <div className="tour-confetti" aria-hidden>
            {Array.from({ length: 28 }).map((_, i) => (
              <i key={i} style={{ left: `${(i * 37) % 100}%`, animationDelay: `${(i % 7) * 0.12}s`, backgroundColor: ["#38bdf8", "#6366f1", "#f59e0b", "#10b981", "#ec4899"][i % 5] }} />
            ))}
          </div>
          <img src="/lanx-logo.png" alt="" className="mx-auto h-20 w-20 rounded-3xl shadow-2xl shadow-sky-500/40 tour-bounce" />
          <h2 className="mt-5 text-2xl font-bold text-slate-900 dark:text-white">You're all set, {name.split(" ")[0]}!</h2>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Pick a colleague on the left and say hello.</p>
          <button type="button" onClick={onClose} className="mt-6 px-6 py-3 rounded-2xl bg-sky-500 hover:bg-sky-600 text-white font-semibold shadow-lg shadow-sky-500/30 active:scale-95 transition-transform">
            Start using LANX
          </button>
        </div>
      ) : (
        <div className="relative w-full max-w-xl text-center">
          <div key={step} className="tour-step">
            {s.art}
            <h2 className="mt-7 text-xl font-bold text-slate-900 dark:text-white">{s.title}</h2>
            <p className="mt-2 mx-auto max-w-md text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{s.text}</p>
            {s.tip && <p className="mt-2 text-xs text-sky-700 dark:text-sky-300">💡 {s.tip}</p>}
          </div>

          <div className="mt-7 flex items-center justify-center gap-1.5">
            {STEPS.map((_, i) => (
              <button
                key={i}
                type="button"
                aria-label={`Step ${i + 1}`}
                onClick={() => setStep(i)}
                className={`h-1.5 rounded-full transition-all duration-300 ${i === step ? "w-7 bg-sky-500" : "w-1.5 bg-slate-300 dark:bg-slate-700 hover:bg-slate-400"}`}
              />
            ))}
          </div>
          <div className="mt-5 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => setStep((x) => Math.max(0, x - 1))}
              disabled={step === 0}
              className="flex items-center gap-1 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-sm text-slate-600 dark:text-slate-300 disabled:opacity-30 hover:bg-white/70 dark:hover:bg-slate-800"
            >
              <ArrowLeft className="h-4 w-4" /> Back
            </button>
            <button
              type="button"
              onClick={() => (last ? setDone(true) : setStep((x) => x + 1))}
              className="flex items-center gap-1 px-6 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-600 text-white text-sm font-semibold shadow-lg shadow-sky-500/30 active:scale-95 transition-transform"
            >
              {last ? "Finish" : "Next"} <ArrowRight className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-3 text-[11px] text-slate-400">
            Step {step + 1} of {STEPS.length} · use ← → keys · reopen anytime in Settings → Help
          </p>
        </div>
      )}
    </div>
  );
};
