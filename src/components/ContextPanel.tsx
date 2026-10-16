import React, { useEffect, useState } from "react";
import { Conversation, GroupInfo, Peer, SpeedTestResult, TransferRecord, TrustState, secretLabel } from "../types";
import {
  X,
  Shield,
  ShieldAlert,
  ShieldBan,
  KeyRound,
  Users,
  Crown,
  UserPlus,
  UserMinus,
  LogOut,
  Pencil,
  Check,
  EyeOff,
  Eye,
  Timer,
  Gauge,
} from "lucide-react";
import { FileIcon } from "./FileCard";
import { PeerPicker, groupPickReason } from "./NewGroupModal";
import { api, errorText } from "../lib/api";
import { formatSize, keyFingerprint } from "../lib/format";

interface ContextPanelProps {
  conversation: Conversation | null;
  peer: Peer | null;
  peers: Peer[];
  transfers: TransferRecord[];
  pinEnabled: boolean;
  onClose: () => void;
  onUpdateTrust: (peerId: string, trustState: TrustState) => void;
  onOpenTransfer: (transferId: string) => void;
  onSetHidden: (hidden: boolean) => void;
  onError: (message: string) => void;
}


/** Measures the real network speed to this colleague (LANX 1.2.3+). */
function SpeedTestCard({ peer, busy: sending }: { peer: Peer; busy: boolean }) {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<SpeedTestResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setRes(null);
    setErr(null);
  }, [peer.id]);
  const run = async () => {
    setBusy(true);
    setErr(null);
    setRes(null);
    try {
      setRes(await api.speedTest(peer.id));
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const best = res ? Math.max(res.single_mbps, res.multi_mbps) : 0;
  const bar = (v: number) => `${Math.max(4, Math.min(100, (v / Math.max(best, 1)) * 100))}%`;
  return (
    <div className="p-4 border-b border-slate-100 dark:border-slate-800">
      <div className="flex items-center justify-between mb-2">
        <span className="flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300">
          <Gauge className="h-3.5 w-3.5 text-sky-500" /> Connection speed
        </span>
        <button
          type="button"
          onClick={run}
          disabled={busy || peer.status !== "online"}
          className="px-2.5 py-1 rounded-lg bg-sky-500 hover:bg-sky-600 text-white text-[11px] font-semibold disabled:opacity-40"
        >
          {busy ? "Testing… (7 s)" : res ? "Test again" : "Test speed"}
        </button>
      </div>
      {sending && (
        <p className="mb-2 rounded-lg bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-700 dark:text-amber-300 leading-snug" data-speed-busy>
          A file is being sent right now, so the result will be lower than normal. Test again when it has finished.
        </p>
      )}
      {!res && !err && (
        <p className="text-[11px] text-slate-500 leading-snug">
          {peer.status === "online"
            ? `Measures how fast files can travel between you and ${peer.display_name} right now.`
            : `${peer.display_name} is offline.`}
        </p>
      )}
      {err && <p className="text-[11px] text-red-600 dark:text-red-400 leading-snug">{err}</p>}
      {res && (
        <div className="space-y-2" data-speed-result>
          {[
            ["1 connection", res.single_mbps],
            [`${res.connections} connections (what LANX uses for big files)`, res.multi_mbps],
          ].map(([label, v]) => (
            <div key={label as string}>
              <div className="flex justify-between text-[11px] text-slate-600 dark:text-slate-300">
                <span>{label}</span>
                <span className="font-bold tabular-nums">{(v as number).toFixed(1)} MB/s</span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                <div className="h-full rounded-full bg-sky-500 transition-all" style={{ width: bar(v as number) }} />
              </div>
            </div>
          ))}
          <p className="text-[11px] text-slate-500 leading-snug">
            {best < 6
              ? "This link is slow. Usually one of the two PCs is on 2.4 GHz or weak Wi-Fi — a network cable or the 5 GHz Wi-Fi would make every transfer much faster."
              : best < 30
                ? "Normal Wi-Fi speed. A network cable would be faster still."
                : "Fast — a cable or strong 5 GHz Wi-Fi."}
            {res.multi_mbps > res.single_mbps * 1.3 &&
              ` Big files go over ${res.connections} connections, so they travel at about ${res.multi_mbps.toFixed(0)} MB/s here.`}
          </p>
        </div>
      )}
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = {
  queued: "Queued",
  pending: "Waiting",
  completed: "Done",
  declined: "Declined",
  cancelled: "Cancelled",
  failed: "Failed",
};

export const ContextPanel: React.FC<ContextPanelProps> = ({
  conversation,
  peer,
  peers,
  transfers,
  pinEnabled,
  onClose,
  onUpdateTrust,
  onOpenTransfer,
  onSetHidden,
  onError,
}) => {
  const [code, setCode] = useState("");
  const [group, setGroup] = useState<GroupInfo | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [toAdd, setToAdd] = useState<string[]>([]);
  const [confirmLeave, setConfirmLeave] = useState(false);

  const isGroup = conversation?.kind === "group";

  useEffect(() => {
    let alive = true;
    if (peer?.public_key && !isGroup) {
      keyFingerprint(peer.public_key).then((c) => alive && setCode(c));
    } else {
      setCode("");
    }
    return () => {
      alive = false;
    };
  }, [peer?.public_key, isGroup]);

  // Group details (refreshed when the chat's name/member count changes).
  useEffect(() => {
    setRenaming(false);
    setAdding(false);
    setConfirmLeave(false);
    if (!isGroup || !conversation) {
      setGroup(null);
      return;
    }
    let alive = true;
    api.getGroup(conversation.id).then((g) => alive && setGroup(g)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [isGroup, conversation?.id, conversation?.peer_name, conversation?.member_count, conversation?.membership, conversation?.peer_status]);

  if (!conversation) return null;

  // One entry per file: a file sent to a group has a copy per member.
  const seenParents = new Set<string>();
  const chatTransfers = transfers.filter((t) => {
    if (t.conversation_id !== conversation.id) return false;
    if (!t.parent_id) return true;
    if (seenParents.has(t.parent_id)) return false;
    seenParents.add(t.parent_id);
    return true;
  });
  const trust = peer?.trust_state ?? "unverified";
  const me = group?.members.find((m) => m.is_me);
  const iAmAdmin = !!me?.is_admin && group?.membership === "member";

  const refreshGroup = async (g: Promise<GroupInfo>) => {
    try {
      setGroup(await g);
    } catch (err) {
      onError(errorText(err));
    }
  };

  const hideBlock = (
    <div className="p-4 border-b border-slate-100 dark:border-slate-800">
      <button
        type="button"
        onClick={() => onSetHidden(!conversation.is_hidden)}
        className="w-full flex items-center justify-between rounded-xl px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800"
      >
        <span className="flex items-center gap-2">
          {conversation.is_hidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
          {conversation.is_hidden ? "Unhide this chat" : "Hide this chat"}
        </span>
        {!pinEnabled && <span className="text-[10px] font-normal text-slate-400">you will choose a PIN</span>}
      </button>
      <p className="mt-1.5 text-[10px] text-slate-400 leading-snug">
        Hidden chats leave your normal list, search and Files. To see them: "Hidden chats" at the top of your chat list, then your PIN.
      </p>
    </div>
  );

  return (
    <aside className="w-72 h-full border-l border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0c111c] flex flex-col overflow-y-auto select-none shrink-0 lanx-slide-left">
      <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wider text-slate-400">{isGroup ? "Group" : "Contact"}</span>
        <button type="button" onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="p-6 text-center border-b border-slate-100 dark:border-slate-800">
        <div
          className="mx-auto h-16 w-16 rounded-full flex items-center justify-center text-white font-bold text-xl shadow-md mb-3"
          style={{ backgroundColor: conversation.peer_avatar_color }}
        >
          {isGroup ? <Users className="h-7 w-7" /> : conversation.peer_name.charAt(0).toUpperCase()}
        </div>
        {renaming ? (
          <div className="flex items-center gap-1">
            <input
              autoFocus
              value={newName}
              maxLength={60}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newName.trim()) {
                  setRenaming(false);
                  refreshGroup(api.updateGroup(conversation.id, newName.trim(), [], []));
                }
              }}
              className="flex-1 min-w-0 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-2 py-1 text-xs text-slate-900 dark:text-white select-text"
            />
            <button
              type="button"
              disabled={!newName.trim()}
              onClick={() => {
                setRenaming(false);
                refreshGroup(api.updateGroup(conversation.id, newName.trim(), [], []));
              }}
              className="p-1.5 rounded-lg bg-sky-500 text-white disabled:opacity-40"
            >
              <Check className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center justify-center gap-1.5">
            {conversation.peer_name}
            {iAmAdmin && (
              <button
                type="button"
                title="Rename group"
                onClick={() => {
                  setNewName(conversation.peer_name);
                  setRenaming(true);
                }}
                className="p-0.5 rounded text-slate-400 hover:text-sky-600"
              >
                <Pencil className="h-3 w-3" />
              </button>
            )}
          </h3>
        )}
        <p className="text-xs text-slate-400 mt-0.5">
          {isGroup ? `${group?.members.length ?? conversation.member_count} members` : peer?.hostname || "Computer on your network"}
        </p>
        <div className="mt-3 flex items-center justify-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${conversation.peer_status === "online" ? "bg-emerald-500 online-pulse" : "bg-slate-400"}`} />
          <span className="text-xs font-semibold capitalize text-slate-600 dark:text-slate-300">
            {isGroup ? (conversation.peer_status === "online" ? "Members online" : "Nobody online") : conversation.peer_status}
          </span>
        </div>
      </div>

      {isGroup && group && (
        <div className="p-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-slate-700 dark:text-slate-300">Members</span>
            {iAmAdmin && !adding && (
              <button type="button" onClick={() => setAdding(true)} className="flex items-center gap-1 text-[11px] font-semibold text-sky-600 hover:underline">
                <UserPlus className="h-3 w-3" /> Add
              </button>
            )}
          </div>
          {adding && (
            <div className="mb-3">
              <PeerPicker
                peers={peers.filter((p) => !group.members.some((m) => m.device_id === p.id))}
                selected={toAdd}
                onChange={setToAdd}
                disabledReason={groupPickReason}
              />
              <div className="mt-2 flex justify-end gap-1.5">
                <button type="button" onClick={() => { setAdding(false); setToAdd([]); }} className="px-2.5 py-1 rounded-lg text-[11px] text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={toAdd.length === 0}
                  onClick={() => {
                    setAdding(false);
                    const ids = toAdd;
                    setToAdd([]);
                    refreshGroup(api.updateGroup(conversation.id, null, ids, []));
                  }}
                  className="px-2.5 py-1 rounded-lg bg-sky-500 text-white text-[11px] font-semibold disabled:opacity-40"
                >
                  Add {toAdd.length || ""}
                </button>
              </div>
            </div>
          )}
          <div className="space-y-1">
            {group.members.map((m) => (
              <div key={m.device_id} className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-slate-50 dark:hover:bg-slate-900/50 group/member">
                <span className={`h-2 w-2 rounded-full shrink-0 ${m.status === "online" ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-600"}`} />
                <span className="flex-1 min-w-0 truncate text-xs text-slate-700 dark:text-slate-200">
                  {m.display_name}
                  {m.is_me && <span className="text-slate-400"> (you)</span>}
                </span>
                {m.is_admin && <Crown className="h-3 w-3 text-amber-500 shrink-0" aria-label="Admin" />}
                {iAmAdmin && !m.is_me && (
                  <button
                    type="button"
                    title={`Remove ${m.display_name}`}
                    onClick={() => refreshGroup(api.updateGroup(conversation.id, null, [], [m.device_id]))}
                    className="opacity-0 group-hover/member:opacity-100 p-0.5 rounded text-slate-400 hover:text-red-500"
                  >
                    <UserMinus className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
          <p className="mt-2 text-[10px] text-slate-400 leading-snug">
            {iAmAdmin ? "You're the admin: you can rename the group and add or remove people." : "Only the admin (crown) can change members."}
          </p>
          {group.membership === "member" && (
            confirmLeave ? (
              <div className="mt-3 flex items-center gap-1.5 text-[11px]">
                <span className="flex-1 text-red-600 dark:text-red-400 font-medium">Leave “{group.name}”?</span>
                <button
                  type="button"
                  onClick={async () => {
                    setConfirmLeave(false);
                    try {
                      await api.leaveGroup(conversation.id);
                    } catch (err) {
                      onError(errorText(err));
                    }
                  }}
                  className="px-2 py-1 rounded-lg bg-red-500 text-white font-semibold"
                >
                  Leave
                </button>
                <button type="button" onClick={() => setConfirmLeave(false)} className="px-2 py-1 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">
                  Stay
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmLeave(true)}
                className="mt-3 w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"
              >
                <LogOut className="h-3.5 w-3.5" /> Leave group
              </button>
            )
          )}
        </div>
      )}

      {!isGroup && (
        <div className="p-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-slate-700 dark:text-slate-300">Identity & trust</span>
            {trust === "trusted" ? (
              <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400"><Shield className="h-3 w-3" /> Trusted</span>
            ) : trust === "blocked" ? (
              <span className="flex items-center gap-1 text-[10px] font-semibold text-red-600 dark:text-red-400"><ShieldBan className="h-3 w-3" /> Blocked</span>
            ) : (
              <span className="flex items-center gap-1 text-[10px] font-semibold text-amber-600 dark:text-amber-400"><ShieldAlert className="h-3 w-3" /> Unverified</span>
            )}
          </div>

          {code ? (
            <div className="rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-100 dark:border-slate-800 p-2.5 mb-3">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                <KeyRound className="h-3 w-3" /> Security code
              </div>
              <div className="mt-1 font-mono text-[11px] text-slate-800 dark:text-slate-200 tracking-wide">{code}</div>
              <p className="mt-1 text-[10px] text-slate-500 leading-snug">
                To verify, ask {conversation.peer_name} to open Settings → Diagnostics. If their code matches, mark them trusted.
              </p>
            </div>
          ) : (
            <p className="text-[11px] text-slate-500 mb-3">Not reached yet — the security code appears after the first connection.</p>
          )}

          {peer && (
            <div className="space-y-1.5">
              {trust !== "trusted" && trust !== "blocked" && (
                <button type="button" onClick={() => onUpdateTrust(peer.id, "trusted")} className="w-full py-2 px-3 rounded-xl text-xs font-semibold bg-emerald-500 hover:bg-emerald-600 text-white shadow-sm">
                  Mark as trusted
                </button>
              )}
              {trust === "trusted" && (
                <button type="button" onClick={() => onUpdateTrust(peer.id, "unverified")} className="w-full py-2 px-3 rounded-xl text-xs font-semibold border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">
                  Remove trust
                </button>
              )}
              {trust === "blocked" ? (
                <button type="button" onClick={() => onUpdateTrust(peer.id, "unverified")} className="w-full py-2 px-3 rounded-xl text-xs font-semibold border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">
                  Unblock
                </button>
              ) : (
                <button type="button" onClick={() => onUpdateTrust(peer.id, "blocked")} className="w-full py-2 px-3 rounded-xl text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30">
                  Block
                </button>
              )}
            </div>
          )}
          <div className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-500">
            <Timer className="h-3 w-3" />
            {conversation.secret_ttl > 0
              ? `Secret messages on — disappear ${secretLabel(conversation.secret_ttl)} after reading`
              : "Secret messages off (use the timer button above)"}
          </div>
        </div>
      )}

      {!isGroup && peer && <SpeedTestCard peer={peer} busy={transfers.some((t) => t.status === "transferring")} />}

      {hideBlock}

      <div className="p-4 text-xs flex-1">
        <div className="flex items-center justify-between mb-3">
          <span className="font-bold text-slate-700 dark:text-slate-300">Shared files</span>
          <span className="text-[11px] text-slate-400">{chatTransfers.length}</span>
        </div>
        {chatTransfers.length === 0 ? (
          <p className="text-[11px] text-slate-400 text-center py-4">No files shared here yet.</p>
        ) : (
          <div className="space-y-1.5">
            {chatTransfers.slice(0, 30).map((tx) => (
              <button
                key={tx.id}
                type="button"
                onClick={() => onOpenTransfer(tx.id)}
                disabled={tx.direction === "incoming" && tx.status !== "completed"}
                title={tx.status === "completed" ? "Open" : tx.error_reason || ""}
                className="w-full text-left p-2.5 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 text-[11px] hover:border-sky-500/40 disabled:hover:border-slate-100 dark:disabled:hover:border-slate-800"
              >
                <div className="flex items-center gap-2 font-medium text-slate-800 dark:text-slate-200">
                  <FileIcon name={tx.file_name} className="h-3.5 w-3.5 text-sky-500 shrink-0" />
                  <span className="truncate">{tx.file_name}</span>
                </div>
                <div className="flex items-center justify-between text-[10px] text-slate-400 mt-1">
                  <span>
                    {tx.direction === "incoming" ? `From ${tx.peer_name ?? "?"}` : "Sent"} · {formatSize(tx.file_size)}
                  </span>
                  <span>
                    {tx.status === "transferring" ? (tx.direction === "incoming" ? "Receiving…" : "Sending…") : STATUS_LABEL[tx.status] || tx.status}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
};
