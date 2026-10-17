import React, { useEffect, useRef, useState } from "react";
import { Lock, Delete, X, KeyRound } from "lucide-react";
import { errorText } from "../lib/api";

interface PinPadProps {
  onSubmit: (pin: string) => Promise<void>;
  submitLabel?: string;
  autoFocus?: boolean;
}

/** PIN entry: keyboard or on-screen pad, shakes on a wrong PIN. */
export const PinPad: React.FC<PinPadProps> = ({ onSubmit, submitLabel = "Unlock", autoFocus = true }) => {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const submit = async () => {
    if (pin.length < 4 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(pin);
    } catch (err) {
      setError(errorText(err));
      setPin("");
      setShake(true);
      setTimeout(() => setShake(false), 500);
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  const press = (d: string) => {
    setError(null);
    setPin((p) => (p.length < 12 ? p + d : p));
    inputRef.current?.focus();
  };

  return (
    <div className="flex flex-col items-center">
      <input
        ref={inputRef}
        type="password"
        inputMode="numeric"
        autoComplete="off"
        value={pin}
        maxLength={12}
        onChange={(e) => {
          setError(null);
          setPin(e.target.value.replace(/\s/g, ""));
        }}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        className="sr-only"
        aria-label="PIN"
      />
      <div
        onClick={() => inputRef.current?.focus()}
        className={`flex items-center justify-center gap-2.5 h-10 min-w-[180px] cursor-text ${shake ? "lanx-shake" : ""}`}
      >
        {pin.length === 0 ? (
          <span className="text-xs text-slate-400">Type your PIN</span>
        ) : (
          Array.from({ length: pin.length }).map((_, i) => (
            <span key={i} className="h-3 w-3 rounded-full bg-sky-500 lanx-pop" />
          ))
        )}
      </div>
      <div className="h-5 mt-1 text-xs text-red-500 text-center">{error}</div>

      <div className="mt-3 grid grid-cols-3 gap-2.5">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => press(d)}
            className="h-12 w-12 rounded-full lanx-card text-lg font-medium text-slate-800 dark:text-slate-100 hover:bg-white/90 dark:hover:bg-white/20 active:scale-90 transition-all"
          >
            {d}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setPin((p) => p.slice(0, -1))}
          className="h-12 w-12 rounded-full flex items-center justify-center text-slate-500 hover:bg-[var(--lanx-fill)]"
          aria-label="Delete"
        >
          <Delete className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={() => press("0")}
          className="h-12 w-12 rounded-full lanx-card text-lg font-medium text-slate-800 dark:text-slate-100 hover:bg-white/90 dark:hover:bg-white/20 active:scale-90 transition-all"
        >
          0
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={pin.length < 4 || busy}
          className="h-12 w-12 rounded-full bg-sky-500 text-white text-xs font-bold disabled:opacity-40 hover:bg-sky-600 active:scale-90 transition-transform"
        >
          {busy ? "…" : "OK"}
        </button>
      </div>
      <button
        type="button"
        onClick={submit}
        disabled={pin.length < 4 || busy}
        className="sr-only"
      >
        {submitLabel}
      </button>
    </div>
  );
};

interface LockScreenProps {
  displayName: string;
  avatarColor: string;
  /** Right PIN: the card zooms away before the app appears. */
  leaving?: boolean;
  onUnlock: (pin: string) => Promise<void>;
}

export const LockScreen: React.FC<LockScreenProps> = ({ displayName, avatarColor, leaving, onUnlock }) => {
  const [showHelp, setShowHelp] = useState(false);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center overflow-hidden lanx-window">
      <div className={`relative flex flex-col items-center rounded-[28px] lanx-glass px-10 pt-8 pb-6 ${leaving ? "lanx-unlock-out" : "lanx-sheet-in"}`}>
        <img src="/lanx-logo.png" alt="" className="h-14 w-14 rounded-2xl shadow-xl shadow-sky-500/30 mb-5" />
        <div
          className="h-16 w-16 rounded-full flex items-center justify-center text-white text-2xl font-bold shadow-lg ring-4 ring-white/60 dark:ring-slate-900/60"
          style={{ backgroundColor: avatarColor }}
        >
          {displayName.charAt(0).toUpperCase()}
        </div>
        <h2 className="mt-3 text-lg font-bold text-slate-900 dark:text-white">{displayName}</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1 mb-5">
          <Lock className="h-3 w-3" /> LANX is locked — messages still arrive in the background
        </p>
        <PinPad onSubmit={onUnlock} />
        <button
          type="button"
          onClick={() => setShowHelp(!showHelp)}
          className="mt-6 text-[11px] text-slate-500 hover:text-sky-600"
        >
          Forgot your PIN?
        </button>
        {showHelp && (
          <p className="mt-2 max-w-xs text-center text-[11px] text-slate-500 leading-relaxed">
            For your privacy the PIN cannot be recovered. Your IT person can remove LANX's data folder
            (%APPDATA%\LANX) — this deletes the chat history on this computer.
          </p>
        )}
      </div>
    </div>
  );
};

interface NewPinDialogProps {
  title: string;
  description: string;
  onDone: (pin: string) => Promise<void>;
  onClose: () => void;
}

/** Choose a new PIN (typed twice). */
export const NewPinDialog: React.FC<NewPinDialogProps> = ({ title, description, onDone, onClose }) => {
  const [first, setFirst] = useState<string | null>(null);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center lanx-scrim p-4">
      <div className="w-full max-w-sm rounded-[22px] lanx-sheet p-6 lanx-sheet-in relative">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 p-1.5 rounded-lg text-slate-400 hover:bg-[var(--lanx-fill)]"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-500/10 text-violet-600">
          <KeyRound className="h-5 w-5" />
        </div>
        <h3 className="text-center text-base font-bold text-slate-900 dark:text-white">
          {first ? "Type the same PIN again" : title}
        </h3>
        <p className="mt-1 mb-3 text-center text-xs text-slate-500 dark:text-slate-400">
          {first ? "Just to be sure you remember it. 4 to 12 digits." : description}
        </p>
        <PinPad
          key={first ? "confirm" : "choose"}
          submitLabel={first ? "Save PIN" : "Next"}
          onSubmit={async (pin) => {
            if (!first) {
              setFirst(pin);
              return;
            }
            if (pin !== first) throw "That's not the same PIN. Try again.";
            await onDone(pin);
          }}
        />
        {first && (
          <button type="button" onClick={() => setFirst(null)} className="mt-3 w-full text-center text-[11px] text-slate-500 hover:text-sky-600">
            Start over
          </button>
        )}
      </div>
    </div>
  );
};

interface PinDialogProps {
  title: string;
  description: string;
  submitLabel: string;
  onSubmit: (pin: string) => Promise<void>;
  onClose: () => void;
}

export const PinDialog: React.FC<PinDialogProps> = ({ title, description, submitLabel, onSubmit, onClose }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center lanx-scrim p-4">
    <div className="w-full max-w-sm rounded-[22px] lanx-sheet p-6 lanx-sheet-in relative">
      <button
        type="button"
        onClick={onClose}
        className="absolute top-3 right-3 p-1.5 rounded-lg text-slate-400 hover:bg-[var(--lanx-fill)]"
      >
        <X className="h-4 w-4" />
      </button>
      <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-500/10 text-sky-500">
        <KeyRound className="h-5 w-5" />
      </div>
      <h3 className="text-center text-base font-bold text-slate-900 dark:text-white">{title}</h3>
      <p className="mt-1 mb-3 text-center text-xs text-slate-500 dark:text-slate-400">{description}</p>
      <PinPad onSubmit={onSubmit} submitLabel={submitLabel} />
    </div>
  </div>
);
