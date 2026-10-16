import React from "react";
import { Conversation, Peer, TransferRecord } from "../types";
import {
  X,
  Shield,
  ShieldAlert,
  FileText,
} from "lucide-react";

interface ContextPanelProps {
  conversation: Conversation | null;
  peer: Peer | null;
  transfers: TransferRecord[];
  onClose: () => void;
  onUpdateTrust: (peerId: string, trustState: "unverified" | "trusted" | "blocked") => void;
}

export const ContextPanel: React.FC<ContextPanelProps> = ({
  conversation,
  peer,
  transfers,
  onClose,
  onUpdateTrust,
}) => {
  if (!conversation) return null;

  const peerTransfers = transfers.filter((t) => t.peer_id === conversation.peer_id);

  const isTrusted = peer?.trust_state === "trusted";

  const handleToggleTrust = () => {
    if (!peer) return;
    const newState = isTrusted ? "unverified" : "trusted";
    onUpdateTrust(peer.id, newState);
  };

  return (
    <aside className="w-72 h-full border-l border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0c111c] flex flex-col justify-between overflow-y-auto select-none transition-colors">
      <div>
        {/* Header */}
        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Peer Information
          </span>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Profile Card */}
        <div className="p-6 text-center border-b border-slate-100 dark:border-slate-800">
          <div
            className="mx-auto h-16 w-16 rounded-full flex items-center justify-center text-white font-bold text-xl shadow-md mb-3"
            style={{ backgroundColor: conversation.peer_avatar_color }}
          >
            {conversation.peer_name.charAt(0).toUpperCase()}
          </div>
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">
            {conversation.peer_name}
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            {peer?.hostname || "Local Network Host"}
          </p>

          <div className="mt-3 flex items-center justify-center gap-1.5">
            <span
              className={`h-2 w-2 rounded-full ${
                conversation.peer_status === "online"
                  ? "bg-emerald-500 online-pulse"
                  : "bg-slate-400"
              }`}
            />
            <span className="text-xs font-semibold capitalize text-slate-600 dark:text-slate-300">
              {conversation.peer_status}
            </span>
          </div>
        </div>

        {/* Trust Management */}
        <div className="p-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
              Identity & Trust
            </span>
            {isTrusted ? (
              <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                <Shield className="h-3 w-3" />
                <span>Verified</span>
              </span>
            ) : (
              <span className="flex items-center gap-1 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                <ShieldAlert className="h-3 w-3" />
                <span>Unverified</span>
              </span>
            )}
          </div>

          <p className="text-[11px] text-slate-500 mb-3 leading-relaxed">
            {isTrusted
              ? "You have marked this peer as trusted. File transfers and messages will skip untrusted warnings."
              : "Newly discovered peer. Verify their device ID before accepting unsolicited file transfers."}
          </p>

          <button
            type="button"
            onClick={handleToggleTrust}
            className={`w-full py-2 px-3 rounded-xl text-xs font-semibold transition-all ${
              isTrusted
                ? "border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                : "bg-emerald-500 hover:bg-emerald-600 text-white shadow-sm"
            }`}
          >
            {isTrusted ? "Mark as Unverified" : "Trust this Peer"}
          </button>
        </div>

        {/* Connection Details */}
        <div className="p-4 space-y-3 border-b border-slate-100 dark:border-slate-800 text-xs">
          <span className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
            Network Socket
          </span>

          <div className="flex justify-between items-center text-slate-500">
            <span>IP Address</span>
            <span className="font-mono text-slate-800 dark:text-slate-200">
              {conversation.peer_ip}
            </span>
          </div>

          <div className="flex justify-between items-center text-slate-500">
            <span>TCP Messaging Port</span>
            <span className="font-mono text-slate-800 dark:text-slate-200">
              {peer?.tcp_port || 52926}
            </span>
          </div>

          <div className="flex justify-between items-center text-slate-500">
            <span>Transport Protocol</span>
            <span className="text-slate-800 dark:text-slate-200">
              TCP Local Socket
            </span>
          </div>

          <div className="flex justify-between items-center text-slate-500">
            <span>Integrity Verification</span>
            <span className="text-slate-800 dark:text-slate-200">
              SHA-256
            </span>
          </div>
        </div>

        {/* Shared Files in Conversation */}
        <div className="p-4 text-xs">
          <div className="flex items-center justify-between mb-3">
            <span className="font-bold text-slate-700 dark:text-slate-300">
              Shared Transfers
            </span>
            <span className="text-[11px] text-slate-400">
              {peerTransfers.length} items
            </span>
          </div>

          {peerTransfers.length === 0 ? (
            <p className="text-[11px] text-slate-400 text-center py-4">
              No files transferred with this peer yet.
            </p>
          ) : (
            <div className="space-y-2">
              {peerTransfers.map((tx) => (
                <div
                  key={tx.id}
                  className="p-2.5 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 text-[11px]"
                >
                  <div className="flex items-center gap-2 font-medium text-slate-800 dark:text-slate-200 truncate">
                    <FileText className="h-3.5 w-3.5 text-sky-500 shrink-0" />
                    <span className="truncate">{tx.file_name}</span>
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-slate-400 mt-1">
                    <span>{(tx.file_size / (1024 * 1024)).toFixed(1)} MB</span>
                    <span className="capitalize">{tx.status}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="p-4 text-center text-[10px] text-slate-400 border-t border-slate-100 dark:border-slate-800">
        Direct LAN Connection • No Cloud Relay
      </div>
    </aside>
  );
};
