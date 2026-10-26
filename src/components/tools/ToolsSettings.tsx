import { useEffect, useState } from "react";
import { IS_WINDOWS } from "../../lib/platform";
import { FileText, Moon, Scissors, Send } from "lucide-react";
import type { QuietHours, ToolsStatus, UserSettings } from "../../types";
import { api } from "../../lib/api";
import { DAY_SHORT, DEFAULT_QUIET, fromTime, quietNow, toTime } from "../../lib/tools";

/** LANX 1.7.0 settings: quiet hours, the screenshot key, "Send to → LANX". */
export function ToolsSettings({ form, onChange }: { form: UserSettings; onChange: (patch: Partial<UserSettings>) => void }) {
  const q: QuietHours = form.quiet_hours ?? DEFAULT_QUIET;
  const setQ = (patch: Partial<QuietHours>) => onChange({ quiet_hours: { ...q, ...patch } });
  const [status, setStatus] = useState<ToolsStatus | null>(null);
  useEffect(() => {
    api.getToolsStatus().then(setStatus).catch(() => {});
  }, [form.screenshot_hotkey]);
  const sw = (on: boolean) => (
    <span className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors ${on ? "bg-sky-500" : "bg-slate-300 dark:bg-slate-600"}`}>
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${on ? "translate-x-[18px]" : "translate-x-0.5"}`} />
    </span>
  );

  return (
    <>
      <div className="rounded-xl lanx-group p-3 space-y-3" data-quiet-hours>
        <button type="button" data-quiet-toggle onClick={() => setQ({ enabled: !q.enabled })} className="w-full flex items-start gap-3 text-left">
          <Moon className="h-4 w-4 mt-0.5 text-indigo-500 shrink-0" />
          <span className="flex-1">
            <span className="block text-[13px] font-semibold text-slate-900 dark:text-white">Quiet hours</span>
            <span className="block text-[11.5px] text-slate-500 dark:text-slate-400">
              No sounds or pop-ups for messages, files and rings at these times (like Do not disturb). Messages still arrive, and calls still come through.
              {q.enabled && quietNow(q) && <b className="text-indigo-600 dark:text-indigo-300"> Quiet right now.</b>}
            </span>
          </span>
          {sw(q.enabled)}
        </button>
        <div className={`flex flex-wrap items-center gap-2 pl-7 ${q.enabled ? "" : "opacity-50 pointer-events-none"}`}>
          <label className="text-[12px] text-slate-600 dark:text-slate-300">From</label>
          <input type="time" data-quiet-start value={toTime(q.start)} onChange={(e) => setQ({ start: fromTime(e.target.value) })} className="lanx-field rounded-lg px-2 py-1 text-[12px] text-slate-900 dark:text-white" />
          <label className="text-[12px] text-slate-600 dark:text-slate-300">to</label>
          <input type="time" data-quiet-end value={toTime(q.end)} onChange={(e) => setQ({ end: fromTime(e.target.value) })} className="lanx-field rounded-lg px-2 py-1 text-[12px] text-slate-900 dark:text-white" />
          {q.end < q.start && <span className="text-[11px] text-slate-400">(next morning)</span>}
          <div className="w-full flex flex-wrap gap-1">
            {DAY_SHORT.map((d, i) => {
              const on = q.days.includes(i);
              return (
                <button
                  key={d}
                  type="button"
                  data-quiet-day={i}
                  onClick={() => setQ({ days: on ? q.days.filter((x) => x !== i) : [...q.days, i].sort() })}
                  className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${on ? "bg-indigo-500 text-white" : "bg-[var(--lanx-fill)] text-slate-500"}`}
                >
                  {d}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {IS_WINDOWS && (<>
      <button type="button" data-hotkey-toggle onClick={() => onChange({ screenshot_hotkey: !(form.screenshot_hotkey ?? true) })} className="w-full rounded-xl lanx-group p-3 flex items-start gap-3 text-left">
        <Scissors className="h-4 w-4 mt-0.5 text-sky-500 shrink-0" />
        <span className="flex-1">
          <span className="block text-[13px] font-semibold text-slate-900 dark:text-white">Screenshot key: {status?.hotkey ?? "Ctrl + Alt + S"}</span>
          <span className="block text-[11.5px] text-slate-500 dark:text-slate-400">
            Press it anywhere in Windows to take a screenshot, mark it up and send it. (Also the ✂ button next to the message box.)
            {(form.screenshot_hotkey ?? true) && status && !status.hotkey_working && (
              <b className="block text-amber-600"> Another app already uses this key, so it can't work right now — the ✂ button still does.</b>
            )}
          </span>
        </span>
        {sw(form.screenshot_hotkey ?? true)}
      </button>

      <button type="button" data-sendto-toggle onClick={() => onChange({ send_to_menu: !(form.send_to_menu ?? true) })} className="w-full rounded-xl lanx-group p-3 flex items-start gap-3 text-left">
        <Send className="h-4 w-4 mt-0.5 text-emerald-500 shrink-0" />
        <span className="flex-1">
          <span className="block text-[13px] font-semibold text-slate-900 dark:text-white">“Send to → LANX” in File Explorer</span>
          <span className="block text-[11.5px] text-slate-500 dark:text-slate-400">
            Right-click files or folders in File Explorer → Send to → LANX, then pick who gets them. (On Windows 11: “Show more options” first.)
          </span>
        </span>
        {sw(form.send_to_menu ?? true)}
      </button>

      <PdfDefaultCard />
      </>)}
    </>
  );
}

const IT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<DefaultAssociations>
  <Association Identifier=".pdf" ProgId="LANX.pdf" ApplicationName="LANX" />
</DefaultAssociations>
`;

/** LANX 2.14.0: make LANX the program that opens PDF files on this PC. */
function PdfDefaultCard() {
  const [status, setStatus] = useState<{ is_lanx: boolean; current: string } | null>(null);
  const refresh = () => api.pdfDefaultStatus().then(setStatus).catch(() => {});
  useEffect(() => {
    void refresh();
    const t = window.setInterval(refresh, 4000);
    return () => window.clearInterval(t);
  }, []);
  const [note, setNote] = useState("");
  const choose = async () => {
    try {
      await api.choosePdfApp();
      setNote("Pick LANX in the Windows box, tick “Always”, and press OK.");
      setTimeout(refresh, 2000);
    } catch (e) {
      setNote(String((e as Error)?.message ?? e));
    }
  };
  const forIT = async () => {
    try {
      const path = await api.saveTextFile("LANX-DefaultAppAssociations.xml", IT_XML, "xml");
      if (path) setNote(`Saved. IT applies it with: Dism /Online /Import-DefaultAppAssociations:"${path}" (or Group Policy → Set a default associations configuration file).`);
    } catch (e) {
      setNote(String((e as Error)?.message ?? e));
    }
  };
  return (
    <div className="w-full rounded-xl lanx-group p-3 flex items-start gap-3 text-left" data-pdf-default={status?.is_lanx ? "lanx" : "other"}>
      <FileText className="h-4 w-4 mt-0.5 text-rose-500 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold text-slate-900 dark:text-white">Open PDF files in LANX</div>
        <div className="text-[11.5px] text-slate-500 dark:text-slate-400">
          {status?.is_lanx ? (
            <>
              Double-clicking any PDF opens it in LANX’s PDF tools. <b className="text-emerald-600 dark:text-emerald-400">LANX is your PDF program.</b>
            </>
          ) : (
            <>
              Double-click any PDF and it opens here — to read, mark up, sign, merge, split and more. Windows asks each person once: pick <b>LANX</b> and tick <b>Always</b>.
              {status?.current ? <span className="text-slate-400"> (Right now: {status.current})</span> : null}
            </>
          )}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" data-pdf-default-choose onClick={() => void choose()} className="px-3 py-1.5 rounded-full bg-rose-500 hover:bg-rose-600 text-white text-[12px] font-semibold">
            {status?.is_lanx ? "Choose again…" : "Make LANX my PDF program…"}
          </button>
          <button type="button" onClick={() => api.openDefaultApps().catch(() => {})} className="px-3 py-1.5 rounded-full lanx-group text-[12px] font-semibold text-slate-700 dark:text-slate-200">
            Windows “Default apps”…
          </button>
          <button type="button" data-pdf-default-it onClick={() => void forIT()} className="px-3 py-1.5 rounded-full lanx-group text-[12px] font-semibold text-slate-700 dark:text-slate-200" title="A file IT can apply to every PC at once">
            For IT: a file for all PCs…
          </button>
        </div>
        {note && <div className="mt-1.5 text-[11.5px] text-slate-600 dark:text-slate-300" data-pdf-default-note>{note}</div>}
      </div>
    </div>
  );
}
