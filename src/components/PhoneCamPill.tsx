/** LANX 3.6.2: a small pill while the phone's camera is asked for or in use
 *  ("Look at your phone: tap Allow" · "Phone camera" with Stop). */
import { useEffect, useState } from "react";
import { Loader2, Smartphone, X } from "lucide-react";
import { type PhoneCamState, onPhoneCamState, phoneCamState, stopPhoneCamera } from "../lib/phoneCamera";

export function PhoneCamPill() {
  const [s, setS] = useState<PhoneCamState>(phoneCamState);
  useEffect(() => onPhoneCamState(setS), []);
  if (s.phase === "off") return null;
  const text =
    s.phase === "asking" ? `Look at your phone: tap Allow to lend its camera${s.purpose !== "LANX" ? ` (for ${s.purpose})` : ""}`
    : s.phase === "on" ? `Using ${s.phone}'s camera`
    : s.message;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[190] flex justify-center px-4">
      <div data-phone-cam-pill={s.phase} className="pointer-events-auto flex max-w-[560px] items-center gap-2 rounded-full lanx-menu px-3 py-1.5 text-[12px] font-semibold text-slate-800 dark:text-slate-100 lanx-rise">
        {s.phase === "asking" ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-sky-500" /> : <Smartphone className={`h-3.5 w-3.5 shrink-0 ${s.phase === "error" ? "text-amber-500" : "text-emerald-500"}`} />}
        <span className="min-w-0 truncate">{text}</span>
        {(s.phase === "asking" || s.phase === "on") && (
          <button type="button" data-phone-cam-stop onClick={stopPhoneCamera} title={s.phase === "on" ? "Stop using the phone's camera" : "Stop asking"} className="lanx-tool -mr-1 p-0.5 text-slate-400">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
