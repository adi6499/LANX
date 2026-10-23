import { useEffect, useRef, useState } from "react";
import { Check, Download, Loader2, Mic, Trash2, X } from "lucide-react";
import { api, errorText } from "../../lib/api";
import { DEFAULT_DICTATION, DICTATE_SHORTCUT, type DictationPrefs, LANGS, downloadModel, loadDictationPrefs, saveDictationPrefs } from "../../lib/voice";
import { IS_WINDOWS } from "../../lib/platform";

/** LANX 2.5.0: Voice settings — the speech model (downloaded once), language,
 *  the dictation hotkey and where the words go. */
export function VoiceSettingsModal({ onClose, onError }: { onClose: () => void; onError: (t: string) => void }) {
  const [prefs, setPrefs] = useState<DictationPrefs>(DEFAULT_DICTATION);
  const [models, setModels] = useState<Awaited<ReturnType<typeof api.voiceModels>>>([]);
  const [busy, setBusy] = useState<{ id: string; done: number; total: number } | null>(null);
  const abort = useRef<AbortController | null>(null);

  const refresh = () => api.voiceModels().then(setModels).catch((e) => onError(errorText(e)));
  useEffect(() => {
    loadDictationPrefs().then(setPrefs);
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = async (p: Partial<DictationPrefs>) => {
    const next = { ...prefs, ...p };
    setPrefs(next);
    try {
      await saveDictationPrefs(next);
    } catch (e) {
      onError(errorText(e));
    }
  };

  const get = async (id: string, url: string) => {
    abort.current = new AbortController();
    setBusy({ id, done: 0, total: 0 });
    try {
      await downloadModel(id, url, (done, total) => setBusy({ id, done, total }), abort.current.signal);
      await refresh();
      await set({ model: id as DictationPrefs["model"] });
      onError("The speech model is ready. Dictation works offline from now on.");
    } catch (e) {
      if (!abort.current?.signal.aborted) onError(errorText(e));
    } finally {
      setBusy(null);
    }
  };
  const remove = async (id: string) => {
    try {
      await api.voiceModelDelete(id);
      await refresh();
    } catch (e) {
      onError(errorText(e));
    }
  };
  const mb = (n: number) => `${(n / 1048576).toFixed(0)} MB`;

  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center bg-black/30 backdrop-blur-sm lanx-fade" onMouseDown={onClose}>
      <div data-voice-settings className="w-[560px] max-w-[94vw] max-h-[92vh] overflow-y-auto rounded-[22px] lanx-sheet p-5 lanx-rise" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-[15px] font-bold text-slate-900 dark:text-white">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-red-500 text-white"><Mic className="h-4 w-4" /></span>
            Voice: dictation and recordings
          </h3>
          <button type="button" onClick={onClose} className="lanx-tool p-1 text-slate-400"><X className="h-4 w-4" /></button>
        </div>
        <p className="mt-2 text-[12px] text-slate-500">
          Speech is turned into text <b>on this PC</b> — nothing is sent anywhere. It needs a speech model file once (that download uses the internet); after that it works offline.
        </p>

        <div className="mt-3 space-y-2">
          {models.map((m) => (
            <div key={m.id} data-voice-model={m.id} className={`flex items-center gap-3 rounded-xl p-3 ${prefs.model === m.id ? "bg-sky-500/10 shadow-[inset_0_0_0_1.5px_var(--color-sky-500)]" : "lanx-group"}`}>
              <button type="button" disabled={!m.downloaded} onClick={() => set({ model: m.id as DictationPrefs["model"] })} className={`h-5 w-5 rounded-full border-2 flex items-center justify-center ${prefs.model === m.id ? "bg-sky-500 border-sky-500 text-white" : "border-slate-300 dark:border-slate-600"} disabled:opacity-40`}>
                {prefs.model === m.id && <Check className="h-3 w-3" strokeWidth={3} />}
              </button>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold text-slate-900 dark:text-white">{m.name} <span className="text-[11px] font-medium text-slate-400">· {m.id}</span></div>
                <div className="text-[11.5px] text-slate-500">{m.about}</div>
                {busy?.id === m.id && (
                  <div className="mt-1.5 h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                    <div className="h-full bg-sky-500 transition-all" style={{ width: busy.total ? `${Math.round((busy.done / busy.total) * 100)}%` : "30%" }} />
                  </div>
                )}
              </div>
              {m.downloaded ? (
                <>
                  <span className="text-[11px] font-semibold text-emerald-600">Ready · {mb(m.bytes)}</span>
                  <button type="button" title="Remove this model" onClick={() => remove(m.id)} className="lanx-tool p-1 text-slate-400 hover:text-red-500"><Trash2 className="h-4 w-4" /></button>
                </>
              ) : busy?.id === m.id ? (
                <button type="button" onClick={() => abort.current?.abort()} className="px-3 py-1.5 rounded-full lanx-group text-[12px] font-semibold text-slate-700 dark:text-slate-200 inline-flex items-center gap-1"><Loader2 className="h-3.5 w-3.5 animate-spin" /> {busy.total ? `${mb(busy.done)} / ${mb(busy.total)}` : "Starting…"} · Cancel</button>
              ) : (
                <button type="button" data-voice-download={m.id} disabled={!!busy} onClick={() => get(m.id, m.url)} className="px-3 py-1.5 rounded-full bg-sky-500 hover:bg-sky-600 disabled:opacity-40 text-white text-[12px] font-semibold inline-flex items-center gap-1"><Download className="h-3.5 w-3.5" /> Download</button>
              )}
            </div>
          ))}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="text-[11.5px] font-semibold text-slate-500">
            Language
            <select value={prefs.lang} onChange={(e) => set({ lang: e.target.value })} className="lanx-field mt-1 w-full rounded-[10px] px-2 py-1.5 text-[12.5px] font-normal text-slate-900 dark:text-white">
              {LANGS.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
          <div className="space-y-2 pt-4">
            <label className="flex items-center gap-2 text-[12.5px] text-slate-700 dark:text-slate-200"><input type="checkbox" checked={prefs.hotkey} onChange={(e) => set({ hotkey: e.target.checked })} /> Shortcut {DICTATE_SHORTCUT} {IS_WINDOWS ? "anywhere in Windows" : "inside LANX"}</label>
            {IS_WINDOWS && <label className="flex items-center gap-2 text-[12.5px] text-slate-700 dark:text-slate-200"><input type="checkbox" checked={prefs.typeInto} onChange={(e) => set({ typeInto: e.target.checked })} /> Type the words into the program that was in front</label>}
          </div>
        </div>
        <div className="mt-3 rounded-xl lanx-group p-3 text-[11.5px] text-slate-600 dark:text-slate-300">
          <b>How to dictate:</b> put the cursor where the text should go (a message, a note, Word, an email…), press <b>{DICTATE_SHORTCUT}</b>, speak, press it again (or Done). The words appear there a moment later. In Notes, <b>Record</b> keeps the sound too and can write it out afterwards.
        </div>
        <div className="mt-3 flex justify-end">
          <button type="button" onClick={onClose} className="px-4 py-1.5 rounded-full bg-slate-700 hover:bg-slate-800 text-white text-[12.5px] font-semibold">Done</button>
        </div>
      </div>
    </div>
  );
}
