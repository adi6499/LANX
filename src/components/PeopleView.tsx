import React, { useState } from "react";
import { Peer } from "../types";
import { errorText } from "../lib/api";
import { stagger } from "../lib/motion";
import {
  Users,
  Plus,
  Shield,
  ShieldAlert,
  ShieldBan,
  MessageSquare,
  Laptop,
} from "lucide-react";

function lastSeenText(ts: number): string {
  if (!ts) return "Not seen yet";
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 90) return "Seen just now";
  if (diff < 3600) return `Seen ${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `Seen ${Math.floor(diff / 3600)} h ago`;
  return `Seen ${new Date(ts * 1000).toLocaleDateString()}`;
}

interface PeopleViewProps {
  peers: Peer[];
  /** LANX version each colleague last reported, and whether it is behind. */
  versions: Record<string, { version?: string | null; behind: boolean }>;
  latestVersion: string | null;
  searchQuery: string;
  onStartChat: (peerId: string) => void;
  onAddManualPeer: (ip: string, port: number, name?: string) => Promise<void>;
  onUpdateTrust: (peerId: string, trustState: "unverified" | "trusted" | "blocked") => void;
}

export const PeopleView: React.FC<PeopleViewProps> = ({
  peers,
  versions,
  latestVersion,
  searchQuery,
  onStartChat,
  onAddManualPeer,
  onUpdateTrust,
}) => {
  const [filter, setFilter] = useState<"all" | "online" | "trusted">("all");
  const [showAddModal, setShowAddModal] = useState(false);
  const [manualIp, setManualIp] = useState("");
  const [manualPort, setManualPort] = useState(52926);
  const [manualName, setManualName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const filteredPeers = peers.filter((p) => {
    const matchesSearch =
      p.display_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.last_ip.includes(searchQuery) ||
      p.hostname.toLowerCase().includes(searchQuery.toLowerCase());

    if (!matchesSearch) return false;
    if (filter === "online") return p.status === "online";
    if (filter === "trusted") return p.trust_state === "trusted";
    return true;
  });

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualIp.trim()) return;
    setSubmitting(true);
    setAddError(null);
    try {
      await onAddManualPeer(manualIp.trim(), manualPort, manualName.trim() || undefined);
      setShowAddModal(false);
      setManualIp("");
      setManualName("");
    } catch (err) {
      setAddError(errorText(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex-1 h-full flex flex-col overflow-hidden select-none lanx-screen-in">
      {/* Header */}
      <div className="h-16 px-8 border-b lanx-line lanx-bar flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            Local Network Peers
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Computers and colleagues discovered on your LAN
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex rounded-[11px] bg-[var(--lanx-fill)] p-[3px] text-xs">
            <button
              type="button"
              onClick={() => setFilter("all")}
              className={`px-3 py-1 rounded-lg font-medium transition-colors ${
                filter === "all"
                  ? "bg-white dark:bg-white/15 text-slate-900 dark:text-white shadow-[0_1px_3px_rgb(0_0_0/0.12)]"
                  : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
              }`}
            >
              All ({peers.length})
            </button>
            <button
              type="button"
              onClick={() => setFilter("online")}
              className={`px-3 py-1 rounded-lg font-medium transition-colors ${
                filter === "online"
                  ? "bg-white dark:bg-white/15 text-slate-900 dark:text-white shadow-[0_1px_3px_rgb(0_0_0/0.12)]"
                  : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
              }`}
            >
              Online ({peers.filter((p) => p.status === "online").length})
            </button>
            <button
              type="button"
              onClick={() => setFilter("trusted")}
              className={`px-3 py-1 rounded-lg font-medium transition-colors ${
                filter === "trusted"
                  ? "bg-white dark:bg-white/15 text-slate-900 dark:text-white shadow-[0_1px_3px_rgb(0_0_0/0.12)]"
                  : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
              }`}
            >
              Trusted
            </button>
          </div>

          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-sky-500 hover:bg-sky-600 text-white text-xs font-semibold shadow-md shadow-sky-500/20 transition-all"
          >
            <Plus className="h-4 w-4" />
            <span>Connect by IP</span>
          </button>
        </div>
      </div>

      {/* Peer Grid */}
      <div className="flex-1 overflow-y-auto p-8">
        {filteredPeers.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center text-center p-8 text-xs text-slate-400">
            <Users className="h-10 w-10 text-slate-300 dark:text-slate-700 mb-2" />
            <p className="font-semibold text-slate-700 dark:text-slate-300">
              No Peers Found
            </p>
            <p className="mt-1 text-slate-500 max-w-sm">
              Colleagues running LANX on the same network appear here within a few seconds. If someone is on a
              different subnet (or the Wi-Fi blocks discovery), use "Connect by IP".
            </p>
            <button
              type="button"
              onClick={() => setShowAddModal(true)}
              className="mt-4 px-4 py-2 rounded-xl bg-sky-500 text-white text-xs font-semibold shadow-sm"
            >
              Connect to Peer by IP
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredPeers.map((peer, i) => {
              const isOnline = peer.status === "online";
              const isTrusted = peer.trust_state === "trusted";
              const isBlocked = peer.trust_state === "blocked";

              return (
                <div
                  key={peer.id}
                  style={stagger(i, 45)}
                  className="rounded-2xl lanx-card lanx-lift lanx-item-in p-5 flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-start justify-between mb-3">
                      <div className="relative">
                        <div
                          className="h-12 w-12 rounded-full flex items-center justify-center text-white font-bold text-base shadow-sm"
                          style={{ backgroundColor: peer.avatar_color }}
                        >
                          {peer.display_name.charAt(0).toUpperCase()}
                        </div>
                        <span
                          className={`absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-2 border-white dark:border-[#111827] ${
                            isOnline ? "bg-emerald-500 online-pulse" : "bg-slate-400"
                          }`}
                        />
                      </div>

                      <div className="flex items-center gap-1.5">
                        {isTrusted ? (
                          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-semibold border border-emerald-500/20">
                            <Shield className="h-3 w-3" />
                            <span>Trusted</span>
                          </span>
                        ) : isBlocked ? (
                          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/10 text-red-600 dark:text-red-400 text-[10px] font-semibold border border-red-500/20">
                            <ShieldBan className="h-3 w-3" />
                            <span>Blocked</span>
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[10px] font-semibold border border-amber-500/20">
                            <ShieldAlert className="h-3 w-3" />
                            <span>Unverified</span>
                          </span>
                        )}
                      </div>
                    </div>

                    <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                      {peer.display_name}
                    </h4>
                    <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1 mt-0.5">
                      <Laptop className="h-3.5 w-3.5" />
                      <span>{peer.hostname || "LAN Workstation"}</span>
                    </p>
                    {!isOnline && (
                      <p className="text-[11px] text-slate-400 mt-0.5">{lastSeenText(peer.last_seen)}</p>
                    )}
                    {versions[peer.id]?.version && (
                      <p className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                        <span>LANX {versions[peer.id].version}</span>
                        {versions[peer.id].behind ? (
                          <span
                            className="px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[10px] font-semibold border border-amber-500/20"
                            title={latestVersion ? `LANX ${latestVersion} is the newest on your network` : undefined}
                          >
                            Behind{latestVersion ? ` · ${latestVersion} available` : ""}
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-semibold border border-emerald-500/20">
                            Up to date
                          </span>
                        )}
                      </p>
                    )}

                    <div className="mt-3 py-2 px-3 rounded-xl lanx-group text-[11px] font-mono text-slate-600 dark:text-slate-300 flex items-center justify-between">
                      <span>{peer.last_ip}</span>
                      <span className="text-slate-400">:{peer.tcp_port}</span>
                    </div>
                  </div>

                  <div className="mt-4 pt-4 border-t lanx-line flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onStartChat(peer.id)}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-sky-500 hover:bg-sky-600 text-white text-xs font-semibold shadow-sm transition-colors"
                    >
                      <MessageSquare className="h-3.5 w-3.5" />
                      <span>Chat</span>
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        onUpdateTrust(peer.id, isTrusted || isBlocked ? "unverified" : "trusted")
                      }
                      title={isBlocked ? "Unblock" : isTrusted ? "Remove trust" : "Mark as trusted"}
                      className="p-2 rounded-xl lanx-btn text-slate-600 dark:text-slate-300 transition-colors"
                    >
                      <Shield className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Manual Peer Add Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center lanx-scrim p-4">
          <div className="w-full max-w-md rounded-[22px] lanx-sheet lanx-sheet-in p-6">
            <h3 className="text-base font-bold text-slate-900 dark:text-white mb-1">
              Connect to Peer by IP
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              Type the IP address of the other computer (they can find it in Settings → Network). If it's
              switched off right now, it is saved and your messages wait until it comes online.
            </p>

            <form onSubmit={handleAddSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Peer IP Address
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. 192.168.1.120"
                  value={manualIp}
                  onChange={(e) => setManualIp(e.target.value)}
                  className="w-full rounded-xl lanx-field px-3.5 py-2 text-xs font-mono text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  TCP Messaging Port
                </label>
                <input
                  type="number"
                  required
                  value={manualPort}
                  onChange={(e) => setManualPort(parseInt(e.target.value) || 52926)}
                  className="w-full rounded-xl lanx-field px-3.5 py-2 text-xs font-mono text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Optional Label / Nickname
                </label>
                <input
                  type="text"
                  placeholder="e.g. Alex (Office Laptop)"
                  value={manualName}
                  onChange={(e) => setManualName(e.target.value)}
                  className="w-full rounded-xl lanx-field px-3.5 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              {addError && (
                <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-xs text-red-700 dark:text-red-300">
                  {addError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddModal(false);
                    setAddError(null);
                  }}
                  className="px-4 py-2 rounded-xl lanx-btn text-xs font-medium text-slate-700 dark:text-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || !manualIp.trim()}
                  className="px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-600 text-white text-xs font-semibold shadow-md shadow-sky-500/20 disabled:opacity-50"
                >
                  {submitting ? "Connecting..." : "Add & Connect"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
