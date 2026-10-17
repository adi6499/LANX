import React, { useState } from "react";
import { Peer } from "../types";
import { Megaphone, X, Paperclip, FileText } from "lucide-react";
import { api, errorText } from "../lib/api";
import { PeerPicker } from "./NewGroupModal";

interface BroadcastModalProps {
  peers: Peer[];
  onDone: (summary: string) => void;
  onClose: () => void;
}

/** One message and/or files to many colleagues, each in their own chat. */
export const BroadcastModal: React.FC<BroadcastModalProps> = ({ peers, onDone, onClose }) => {
  const [selected, setSelected] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const available = peers.filter((p) => p.trust_state !== "blocked");
  const online = available.filter((p) => p.status === "online").map((p) => p.id);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.broadcast(selected, text.trim() || null, files);
      const base = `Sent to ${r.sent_to} ${r.sent_to === 1 ? "colleague" : "colleagues"}.`;
      onDone(r.problems.length ? `${base}\n${r.problems.join("\n")}` : base);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center lanx-scrim p-4">
      <div className="w-full max-w-lg rounded-[22px] lanx-sheet p-6 lanx-sheet-in">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center">
              <Megaphone className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">Message everyone</h3>
              <p className="text-[11px] text-slate-500">Each person gets it in their own private chat. Offline colleagues get it later.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:bg-[var(--lanx-fill)]">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
            To <span className="font-normal text-slate-400">({selected.length} selected)</span>
          </label>
          <div className="flex gap-1.5 text-[11px]">
            <button type="button" onClick={() => setSelected(online)} className="px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 font-semibold">
              Everyone online ({online.length})
            </button>
            <button type="button" onClick={() => setSelected(available.map((p) => p.id))} className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-semibold">
              Everyone ({available.length})
            </button>
          </div>
        </div>
        <PeerPicker peers={available} selected={selected} onChange={setSelected} />

        <label className="block mt-4 text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">Message</label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          placeholder="e.g. Office will be closed tomorrow for maintenance."
          className="w-full rounded-xl lanx-field px-3.5 py-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500 resize-none select-text"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={async () => {
              try {
                const picked = await api.pickFiles();
                if (picked.length) setFiles((f) => [...new Set([...f, ...picked])]);
              } catch (err) {
                setError(errorText(err));
              }
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg lanx-btn text-xs text-slate-700 dark:text-slate-300"
          >
            <Paperclip className="h-3.5 w-3.5" /> Attach files
          </button>
          {files.map((f) => (
            <span key={f} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-[11px] text-slate-600 dark:text-slate-300">
              <FileText className="h-3 w-3" />
              {f.split(/[\\/]/).pop()}
              <button type="button" onClick={() => setFiles((x) => x.filter((y) => y !== f))} className="ml-0.5 text-slate-400 hover:text-red-500">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>

        {error && <div className="mt-3 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 px-3 py-2 text-xs text-red-700 dark:text-red-300">{error}</div>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl lanx-btn text-xs font-medium text-slate-700 dark:text-slate-200">
            Cancel
          </button>
          <button
            type="button"
            onClick={send}
            disabled={busy || selected.length === 0 || (!text.trim() && files.length === 0)}
            className="px-5 py-2 rounded-xl bg-sky-500 hover:bg-sky-600 text-white text-xs font-semibold shadow-md shadow-sky-500/20 disabled:opacity-50"
          >
            {busy ? "Sending…" : `Send to ${selected.length || "…"}`}
          </button>
        </div>
      </div>
    </div>
  );
};
