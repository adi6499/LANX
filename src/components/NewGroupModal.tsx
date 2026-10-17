import React, { useMemo, useState } from "react";
import { Peer } from "../types";
import { Users, X, Check, Search } from "lucide-react";
import { errorText } from "../lib/api";

interface PeerPickerProps {
  peers: Peer[];
  selected: string[];
  onChange: (ids: string[]) => void;
  /** Peers that can't be picked (with the reason as tooltip). */
  disabledReason?: (p: Peer) => string | null;
}

/** Searchable checklist of colleagues. */
export const PeerPicker: React.FC<PeerPickerProps> = ({ peers, selected, onChange, disabledReason }) => {
  const [q, setQ] = useState("");
  const shown = useMemo(
    () =>
      peers
        .filter((p) => p.trust_state !== "blocked")
        .filter((p) => p.display_name.toLowerCase().includes(q.toLowerCase()) || p.hostname.toLowerCase().includes(q.toLowerCase()))
        .sort((a, b) => (a.status === b.status ? a.display_name.localeCompare(b.display_name) : a.status === "online" ? -1 : 1)),
    [peers, q]
  );
  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  return (
    <div>
      <div className="relative mb-2">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search colleagues…"
          className="w-full rounded-xl lanx-field pl-9 pr-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500 select-text"
        />
      </div>
      <div className="max-h-60 overflow-y-auto rounded-xl border lanx-line divide-y divide-slate-100 dark:divide-slate-800">
        {shown.length === 0 && <p className="p-4 text-center text-xs text-slate-400">No colleagues found yet.</p>}
        {shown.map((p) => {
          const reason = disabledReason?.(p) ?? null;
          const on = selected.includes(p.id);
          return (
            <button
              key={p.id}
              type="button"
              disabled={!!reason}
              title={reason ?? ""}
              onClick={() => toggle(p.id)}
              className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${
                on ? "bg-sky-500/10" : "hover:bg-[var(--lanx-fill)]"
              } disabled:opacity-40`}
            >
              <div className="relative">
                <div
                  className="h-8 w-8 rounded-full flex items-center justify-center text-white text-xs font-bold"
                  style={{ backgroundColor: p.avatar_color }}
                >
                  {p.display_name.charAt(0).toUpperCase()}
                </div>
                <span
                  className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white dark:border-[#111827] ${
                    p.status === "online" ? "bg-emerald-500" : "bg-slate-400"
                  }`}
                />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-slate-900 dark:text-white truncate">{p.display_name}</div>
                <div className="text-[10px] text-slate-400 truncate">{reason ?? p.hostname}</div>
              </div>
              <span
                className={`h-5 w-5 rounded-md border flex items-center justify-center transition-colors ${
                  on ? "bg-sky-500 border-sky-500 text-white" : "border-slate-300 dark:border-slate-600"
                }`}
              >
                {on && <Check className="h-3.5 w-3.5" />}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export const groupPickReason = (p: Peer): string | null =>
  p.id.startsWith("manual-") || !p.public_key ? "Not reached yet — can be added once they've been online" : null;

interface NewGroupModalProps {
  peers: Peer[];
  onCreate: (name: string, memberIds: string[]) => Promise<void>;
  onClose: () => void;
}

export const NewGroupModal: React.FC<NewGroupModalProps> = ({ peers, onCreate, onClose }) => {
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      await onCreate(name.trim(), selected);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center lanx-scrim p-4">
      <div className="w-full max-w-md rounded-[22px] lanx-sheet p-6 lanx-rise">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-indigo-500/10 text-indigo-500 flex items-center justify-center">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">New group</h3>
              <p className="text-[11px] text-slate-500">Everyone in the group sees every message and file.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:bg-[var(--lanx-fill)]">
            <X className="h-4 w-4" />
          </button>
        </div>
        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">Group name</label>
        <input
          autoFocus
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Accounts Team"
          className="w-full mb-4 rounded-xl lanx-field px-3.5 py-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500 select-text"
        />
        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
          Members <span className="font-normal text-slate-400">({selected.length} selected)</span>
        </label>
        <PeerPicker peers={peers} selected={selected} onChange={setSelected} disabledReason={groupPickReason} />
        {error && <div className="mt-3 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 px-3 py-2 text-xs text-red-700 dark:text-red-300">{error}</div>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl lanx-btn text-xs font-medium text-slate-700 dark:text-slate-200">
            Cancel
          </button>
          <button
            type="button"
            onClick={create}
            disabled={busy || !name.trim() || selected.length === 0}
            className="px-5 py-2 rounded-xl bg-sky-500 hover:bg-sky-600 text-white text-xs font-semibold shadow-md shadow-sky-500/20 disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create group"}
          </button>
        </div>
      </div>
    </div>
  );
};
