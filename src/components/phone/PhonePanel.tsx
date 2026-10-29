/** LANX 3.0: Settings → Phone — "Use on your phone". The PC serves a small
 *  page on the office Wi-Fi; a phone scans the QR code (or types the code),
 *  you allow it here, and it chats through this PC. */
import { useEffect, useMemo, useState } from "react";
import { Check, RefreshCw, Smartphone, Trash2, X } from "lucide-react";
import { api, errorText, events } from "../../lib/api";
import type { PhoneStatus } from "../../types";
import { QrCode } from "./QrCode";

const splitCode = (code: string) => `${code.slice(0, 4)} ${code.slice(4)}`;

function whenSeen(ts: number): string {
  if (!ts) return "never";
  const d = new Date(ts * 1000);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return `today ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  return d.toLocaleDateString([], { day: "numeric", month: "short" });
}

export function PhonePanel() {
  const [status, setStatus] = useState<PhoneStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [url, setUrl] = useState("");
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  const refresh = () => api.phoneStatus().then(setStatus).catch((e) => setProblem(errorText(e)));

  useEffect(() => {
    void refresh();
    let off: (() => void) | undefined;
    events.onPhoneChanged(() => void refresh()).then((f) => (off = f));
    return () => off?.();
  }, []);

  useEffect(() => {
    if (!status?.pairing) return;
    const t = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(t);
  }, [status?.pairing]);

  // The address on the phone's network (the first adapter unless chosen).
  const urls = status?.urls ?? [];
  const chosen = urls.includes(url) ? url : urls[0] ?? "";
  const link = useMemo(() => (status?.pairing && chosen ? `${chosen}/#code=${status.pairing.code}` : ""), [status?.pairing, chosen]);

  const run = (f: () => Promise<PhoneStatus>) => async () => {
    setBusy(true);
    setProblem("");
    try {
      setStatus(await f());
    } catch (e) {
      setProblem(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const on = !!status?.enabled;
  const left = status?.pairing ? Math.max(0, status.pairing.expires_at - now) : 0;
  const mmss = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;

  return (
    <div className="space-y-4" data-phone-panel>
      <button
        type="button"
        data-phone-toggle
        aria-pressed={on}
        disabled={busy || !status}
        onClick={run(() => api.phoneSetEnabled(!on))}
        className="w-full rounded-xl lanx-group p-3 flex items-start gap-3 text-left"
      >
        <Smartphone className="h-4 w-4 mt-0.5 text-sky-500 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-slate-900 dark:text-white">Use LANX on your phone</div>
          <div className="text-[11.5px] text-slate-500 dark:text-slate-400 leading-snug">
            This PC serves a small page on the office Wi-Fi. A phone that scans your code reads and sends your chats through this PC — nothing goes through the
            internet, and it works while LANX runs here.
          </div>
          {on && status && (
            <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400" data-phone-listening={status.listening ? "1" : "0"}>
              {status.listening ? `Ready on port ${status.port}` : "Starting…"}
              {status.connected > 0 ? ` · ${status.connected} phone${status.connected > 1 ? "s" : ""} connected now` : ""}
            </div>
          )}
        </div>
        <span className={`relative mt-0.5 h-[22px] w-[38px] shrink-0 rounded-full transition-colors ${on ? "bg-sky-500" : "bg-[var(--lanx-fill-2)]"}`}>
          <span className={`absolute top-[2px] h-[18px] w-[18px] rounded-full bg-white shadow transition-all ${on ? "left-[18px]" : "left-[2px]"}`} />
        </span>
      </button>

      {on && (
        <div className="rounded-xl lanx-group p-3" data-phone-pairing={status?.pairing ? "on" : "off"}>
          <div className="text-[13px] font-semibold text-slate-900 dark:text-white">Add a phone</div>
          {status?.pairing ? (
            <div className="mt-2 flex gap-4">
              <div className="shrink-0 rounded-xl bg-white p-2 shadow-sm">{link ? <QrCode text={link} size={168} /> : <div className="h-[168px] w-[168px]" />}</div>
              <div className="min-w-0 flex-1 text-[12px] text-slate-600 dark:text-slate-300 leading-relaxed">
                <div>
                  On the phone, open the <b>camera</b> and point it at the code, then tap the link. Or open this address in the phone's browser and type the code:
                </div>
                {urls.length > 1 ? (
                  <select
                    data-phone-url
                    value={chosen}
                    onChange={(e) => setUrl(e.target.value)}
                    className="mt-1.5 w-full rounded-lg lanx-field px-2 py-1.5 font-mono text-[12px] text-slate-900 dark:text-white"
                  >
                    {urls.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="mt-1.5 font-mono text-[12.5px] text-slate-900 dark:text-white select-text" data-phone-url>
                    {chosen || "…"}
                  </div>
                )}
                <div className="mt-2 text-[26px] font-bold tracking-[0.18em] text-slate-900 dark:text-white select-text" data-phone-code={status.pairing.code}>
                  {splitCode(status.pairing.code)}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  Good for {mmss}. When the phone sends it, LANX asks you <b>Allow this phone?</b>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    data-phone-new-code
                    disabled={busy}
                    onClick={run(() => api.phoneStartPairing())}
                    className="px-3 py-1.5 rounded-full lanx-group text-[12px] font-semibold text-slate-700 dark:text-slate-200 inline-flex items-center gap-1.5"
                  >
                    <RefreshCw className="h-3.5 w-3.5" /> New code
                  </button>
                  <button
                    type="button"
                    data-phone-done
                    disabled={busy}
                    onClick={run(() => api.phoneCancelPairing())}
                    className="px-3 py-1.5 rounded-full lanx-group text-[12px] font-semibold text-slate-700 dark:text-slate-200"
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-1.5 flex flex-wrap items-center gap-3">
              <div className="text-[11.5px] text-slate-500 dark:text-slate-400">Shows a QR code and an 8-digit code, good for ten minutes.</div>
              <button
                type="button"
                data-phone-show-code
                disabled={busy || !status?.listening}
                onClick={run(() => api.phoneStartPairing())}
                className="px-3 py-1.5 rounded-full bg-sky-500 hover:bg-sky-600 text-white text-[12px] font-semibold disabled:opacity-50"
              >
                Show a code
              </button>
            </div>
          )}
        </div>
      )}

      {status && status.requests.length > 0 && (
        <div className="rounded-xl lanx-group p-3 space-y-2" data-phone-requests>
          <div className="text-[13px] font-semibold text-slate-900 dark:text-white">Waiting for your answer</div>
          {status.requests.map((r) => (
            <div key={r.id} data-phone-request={r.id} className="flex items-center gap-2 rounded-xl lanx-card px-3 py-2 text-[12px]">
              <Smartphone className="h-4 w-4 text-sky-500 shrink-0" />
              <span className="flex-1 min-w-0 truncate text-slate-800 dark:text-slate-100">
                <b>{r.name}</b> <span className="text-slate-400">({r.ip})</span>
              </span>
              <button
                type="button"
                data-phone-request-deny
                disabled={busy}
                onClick={run(() => api.phoneAnswer(r.id, false))}
                className="lanx-tool p-1 text-slate-500"
                title="No"
              >
                <X className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                data-phone-request-allow
                disabled={busy}
                onClick={run(() => api.phoneAnswer(r.id, true))}
                className="px-2.5 py-1 rounded-full bg-sky-500 text-white text-[11.5px] font-semibold inline-flex items-center gap-1"
              >
                <Check className="h-3.5 w-3.5" /> Allow
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-xl lanx-group p-3" data-phone-devices>
        <div className="text-[13px] font-semibold text-slate-900 dark:text-white">Phones allowed in</div>
        {!status || status.devices.length === 0 ? (
          <div className="mt-1 text-[11.5px] text-slate-500 dark:text-slate-400">None yet.</div>
        ) : (
          <div className="mt-2 space-y-1">
            {status.devices.map((d) => (
              <div key={d.id} data-phone-row={d.id} data-phone-connected={d.connected ? "1" : "0"} className="flex items-center gap-2 rounded-xl lanx-card px-3 py-2 text-[12px]">
                <span className={`h-2 w-2 rounded-full shrink-0 ${d.connected ? "bg-emerald-500 online-pulse" : "bg-slate-400 dark:bg-slate-600"}`} />
                <span className="flex-1 min-w-0 truncate text-slate-800 dark:text-slate-100">
                  <b>{d.name}</b>
                  <span className="text-slate-400"> · {d.connected ? "connected now" : `last seen ${whenSeen(d.last_seen)}`}</span>
                </span>
                <button
                  type="button"
                  data-phone-remove
                  disabled={busy}
                  onClick={run(() => api.phoneForget(d.id))}
                  title="Remove this phone"
                  className="lanx-tool p-1 text-red-500"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="mt-2 text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
          A removed phone has to scan a new code. Phones see new messages while their LANX page is open; they don't get alerts when it is closed.
        </div>
      </div>

      {problem && (
        <div className="rounded-xl bg-amber-500/15 px-3 py-2 text-[12px] text-amber-700 dark:text-amber-200" data-phone-problem>
          {problem}
        </div>
      )}
    </div>
  );
}
