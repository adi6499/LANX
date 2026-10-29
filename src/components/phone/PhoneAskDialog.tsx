/** LANX 3.0: "Allow this phone?" — a phone typed the right code. */
import { useState } from "react";
import { Smartphone } from "lucide-react";
import type { PairRequestInfo } from "../../types";

export function PhoneAskDialog({ request, onAnswer }: { request: PairRequestInfo; onAnswer: (allow: boolean) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const answer = (allow: boolean) => async () => {
    setBusy(true);
    try {
      await onAnswer(allow);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 backdrop-blur-sm lanx-fade">
      <div data-phone-ask className="w-[440px] max-w-[92vw] rounded-[22px] border border-black/5 bg-white p-5 shadow-2xl lanx-rise dark:border-white/10 dark:bg-slate-900">
        <div className="flex items-center gap-2.5 text-[15px] font-bold text-slate-900 dark:text-white">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sky-500 text-white">
            <Smartphone className="h-4 w-4" />
          </span>
          Allow this phone to use LANX?
        </div>
        <p className="mt-2 text-[12.5px] text-slate-700 dark:text-slate-200">
          <b data-phone-ask-name>{request.name}</b> ({request.ip}) typed your code. If you allow it, that phone reads and sends messages <b>as you</b>, through this PC, while LANX is running here.
        </p>
        <p className="mt-2 text-[11.5px] text-slate-500 dark:text-slate-400">Only allow a phone you are holding. You can remove it any time in Settings → Phone.</p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            data-phone-deny
            disabled={busy}
            onClick={answer(false)}
            className="rounded-full px-4 py-2 text-[12.5px] font-semibold text-slate-600 hover:bg-[var(--lanx-fill)] dark:text-slate-300"
          >
            No
          </button>
          <button
            type="button"
            data-phone-allow
            disabled={busy}
            onClick={answer(true)}
            className="rounded-full bg-sky-500 px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-sky-600"
          >
            Allow
          </button>
        </div>
      </div>
    </div>
  );
}
