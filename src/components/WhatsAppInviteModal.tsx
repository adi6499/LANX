import { useEffect, useState } from "react";
import { MessageCircle, X } from "lucide-react";
import { api, errorText } from "../lib/api";

const DEFAULT_LINK = "https://github.com/adi6499/LANX";

/** LANX 2.5.0: invite people to LANX over WhatsApp (the download link goes in the message). */
export function WhatsAppInviteModal({ onClose, onError }: { onClose: () => void; onError: (t: string) => void }) {
  const [link, setLink] = useState(DEFAULT_LINK);
  const [text, setText] = useState("");
  useEffect(() => {
    api
      .getPref("share_link")
      .then((v) => {
        const l = v && v.trim() ? v.trim() : DEFAULT_LINK;
        setLink(l);
        setText(`Join me on LANX, our office messenger — chat, files and calls on the office network, no internet needed.\nDownload: ${l}`);
      })
      .catch(() => setText(`Join me on LANX, our office messenger.\nDownload: ${DEFAULT_LINK}`));
  }, []);
  const send = async () => {
    try {
      if (link.trim()) await api.setPref("share_link", link.trim()).catch(() => {});
      await api.shareWhatsApp({ text });
      onClose();
    } catch (e) {
      onError(errorText(e));
    }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm lanx-fade" onMouseDown={onClose}>
      <div data-whatsapp-invite className="w-[460px] max-w-[94vw] rounded-[22px] lanx-sheet p-5 lanx-rise" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-[15px] font-bold text-slate-900 dark:text-white">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500 text-white"><MessageCircle className="h-4 w-4" /></span>
            Invite on WhatsApp
          </h3>
          <button type="button" onClick={onClose} className="lanx-tool p-1 text-slate-400"><X className="h-4 w-4" /></button>
        </div>
        <label className="block mt-3 text-[11.5px] font-semibold text-slate-500">Download link (your LANX website)</label>
        <input value={link} onChange={(e) => { setLink(e.target.value); setText((t) => t.replace(/Download: .*$/m, `Download: ${e.target.value}`)); }} className="lanx-field mt-1 w-full rounded-[10px] px-3 py-1.5 text-[12.5px] text-slate-900 dark:text-white" />
        <label className="block mt-3 text-[11.5px] font-semibold text-slate-500">Message</label>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} className="lanx-field mt-1 w-full rounded-[10px] px-3 py-2 text-[13px] text-slate-900 dark:text-white resize-none" />
        <p className="mt-2 text-[11px] text-slate-400">WhatsApp opens with this message ready; you pick who gets it there.</p>
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-1.5 rounded-full text-[12.5px] font-semibold text-slate-600 dark:text-slate-300">Cancel</button>
          <button type="button" data-whatsapp-send onClick={send} className="px-4 py-1.5 rounded-full bg-emerald-500 hover:bg-emerald-600 text-white text-[12.5px] font-semibold inline-flex items-center gap-1.5"><MessageCircle className="h-3.5 w-3.5" /> Open WhatsApp</button>
        </div>
      </div>
    </div>
  );
}
