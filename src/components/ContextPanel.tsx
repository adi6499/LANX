import React, { useEffect, useState } from "react";
import { Conversation, Peer, TransferRecord, TrustState } from "../types";
import { X, Shield, ShieldAlert, ShieldBan, KeyRound } from "lucide-react";
import { FileIcon } from "./FileCard";
import { formatSize, keyFingerprint } from "../lib/format";

interface ContextPanelProps {
  conversation: Conversation | null;
  peer: Peer | null;
  transfers: TransferRecord[];
  onClose: () => void;
  onUpdateTrust: (peerId: string, trustState: TrustState) => void;
  onOpenTransfer: (transferId: string) => void;
}

const STATUS_LABEL: Record<string, string> = {
  queued: "Queued",
  pending: "Waiting",
  transferring: "Sending…",
  completed: "Done",
  declined: "Declined",
  cancelled: "Cancelled",
  failed: "Failed",
};

export const ContextPanel: React.FC<ContextPanelProps> = ({
  conversation,
  peer,
  transfers,
  onClose,
  onUpdateTrust,
  onOpenTransfer,
}) => {
  const [code, setCode] = useState("");

  useEffect(() => {
    let alive = true;
    if (peer?.public_key) {
      keyFingerprint(peer.public_key).then((c) => alive && setCode(c));
    } else {
      setCode("");
    }
    return () => {
      alive = false;
    };
  }, [peer?.public_key]);

  if (!conversation) return null;

  const peerTransfers = transfers.filter((t) => t.peer_id === conversation.peer_id);
  const trust = peer?.trust_state ?? "unverified";

  return (
    <aside className="w-72 h-full border-l border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0c111c] flex flex-col overflow-y-auto select-none shrink-0">
      <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Contact</span>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="p-6 text-center border-b border-slate-100 dark:border-slate-800">
        <div
          className="mx-auto h-16 w-16 rounded-full flex items-center justify-center text-white font-bold text-xl shadow-md mb-3"
          style={{ backgroundColor: conversation.peer_avatar_color }}
        >
          {conversation.peer_name.charAt(0).toUpperCase()}
        </div>
        <h3 className="text-sm font-bold text-slate-900 dark:text-white">{conversation.peer_name}</h3>
        <p className="text-xs text-slate-400 mt-0.5">{peer?.hostname || "Computer on your network"}</p>
        <div className="mt-3 flex items-center justify-center gap-1.5">
          <span
            className={`h-2 w-2 rounded-full ${
              conversation.peer_status === "online" ? "bg-emerald-500 online-pulse" : "bg-slate-400"
            }`}
          />
          <span className="text-xs font-semibold capitalize text-slate-600 dark:text-slate-300">
            {conversation.peer_status}
          </span>
        </div>
      </div>

      <div className="p-4 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-bold text-slate-700 dark:text-slate-300">Identity & trust</span>
          {trust === "trusted" ? (
            <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
              <Shield className="h-3 w-3" /> Trusted
            </span>
          ) : trust === "blocked" ? (
            <span className="flex items-center gap-1 text-[10px] font-semibold text-red-600 dark:text-red-400">
              <ShieldBan className="h-3 w-3" /> Blocked
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
              <ShieldAlert className="h-3 w-3" /> Unverified
            </span>
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
              <button
                type="button"
                onClick={() => onUpdateTrust(peer.id, "trusted")}
                className="w-full py-2 px-3 rounded-xl text-xs font-semibold bg-emerald-500 hover:bg-emerald-600 text-white shadow-sm"
              >
                Mark as trusted
              </button>
            )}
            {trust === "trusted" && (
              <button
                type="button"
                onClick={() => onUpdateTrust(peer.id, "unverified")}
                className="w-full py-2 px-3 rounded-xl text-xs font-semibold border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Remove trust
              </button>
            )}
            {trust === "blocked" ? (
              <button
                type="button"
                onClick={() => onUpdateTrust(peer.id, "unverified")}
                className="w-full py-2 px-3 rounded-xl text-xs font-semibold border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Unblock
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onUpdateTrust(peer.id, "blocked")}
                className="w-full py-2 px-3 rounded-xl text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"
              >
                Block
              </button>
            )}
          </div>
        )}
        <p className="mt-2 text-[10px] text-slate-400 leading-snug">
          Trusted contacts' files can download automatically (Settings → Files).
        </p>
      </div>

      <div className="p-4 space-y-2.5 border-b border-slate-100 dark:border-slate-800 text-xs">
        <span className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">Network</span>
        <div className="flex justify-between items-center text-slate-500">
          <span>IP address</span>
          <span className="font-mono text-slate-800 dark:text-slate-200">{conversation.peer_ip}</span>
        </div>
        <div className="flex justify-between items-center text-slate-500">
          <span>Port</span>
          <span className="font-mono text-slate-800 dark:text-slate-200">{peer?.tcp_port || 52926}</span>
        </div>
        <div className="flex justify-between items-center text-slate-500">
          <span>Encryption</span>
          <span className="text-slate-800 dark:text-slate-200">X25519 · ChaCha20</span>
        </div>
      </div>

      <div className="p-4 text-xs flex-1">
        <div className="flex items-center justify-between mb-3">
          <span className="font-bold text-slate-700 dark:text-slate-300">Shared files</span>
          <span className="text-[11px] text-slate-400">{peerTransfers.length}</span>
        </div>
        {peerTransfers.length === 0 ? (
          <p className="text-[11px] text-slate-400 text-center py-4">No files shared with this contact yet.</p>
        ) : (
          <div className="space-y-1.5">
            {peerTransfers.slice(0, 30).map((tx) => (
              <button
                key={tx.id}
                type="button"
                onClick={() => onOpenTransfer(tx.id)}
                disabled={tx.status !== "completed"}
                title={tx.status === "completed" ? "Open" : tx.error_reason || ""}
                className="w-full text-left p-2.5 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 text-[11px] hover:border-sky-500/40 disabled:hover:border-slate-100 dark:disabled:hover:border-slate-800"
              >
                <div className="flex items-center gap-2 font-medium text-slate-800 dark:text-slate-200">
                  <FileIcon name={tx.file_name} className="h-3.5 w-3.5 text-sky-500 shrink-0" />
                  <span className="truncate">{tx.file_name}</span>
                </div>
                <div className="flex items-center justify-between text-[10px] text-slate-400 mt-1">
                  <span>
                    {tx.direction === "incoming" ? "Received" : "Sent"} · {formatSize(tx.file_size)}
                  </span>
                  <span>{STATUS_LABEL[tx.status] || tx.status}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
};
