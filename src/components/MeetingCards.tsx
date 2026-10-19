import { useState } from "react";
import { ChevronDown, ChevronUp, FolderOpen, Play, Users, Video } from "lucide-react";
import type { Message } from "../types";
import { api, errorText } from "../lib/api";
import { formatSize } from "../lib/format";

/** LANX 1.4.0: chat cards for meetings ("Meeting · 25 min · 4 people", with
 *  the meeting chat and "Join again") and saved recordings. */

interface MeetingRecord {
  meeting_id?: string;
  title?: string;
  outcome?: "attended" | "missed" | "declined";
  secs?: number;
  attended?: number;
  host_id?: string;
  host_name?: string;
  people?: { id: string; name: string }[];
  chat?: { from: string; name: string; text: string; at: number }[];
}

function parse<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function lengthText(secs: number) {
  if (secs >= 3600) return `${Math.floor(secs / 3600)} h ${Math.floor((secs % 3600) / 60)} min`;
  if (secs >= 60) return `${Math.floor(secs / 60)} min`;
  return `${secs} s`;
}

const time = (ts: number) => new Date(ts * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export function MeetingCard({ msg, myId, onRejoin }: { msg: Message; myId: string | null; onRejoin: (messageId: string) => void }) {
  const [open, setOpen] = useState(false);
  const v = parse<MeetingRecord>(msg.content) ?? {};
  const chat = (v.chat ?? []).filter((l) => l.from !== "");
  const names = (v.people ?? []).map((p) => (p.id === myId ? "You" : p.name)).filter(Boolean);
  const host = v.host_id === myId ? "you" : v.host_name || "a colleague";
  const missed = v.outcome === "missed";
  let line: string;
  if (v.outcome === "attended") {
    const n = v.attended ?? names.length;
    line = `${lengthText(v.secs ?? 0)}${n > 1 ? ` · ${n} people` : ""}`;
  } else if (missed) {
    line = `Missed — started by ${host}`;
  } else {
    line = `You declined — started by ${host}`;
  }
  return (
    <div data-meeting-card={v.outcome ?? ""} className="w-full max-w-md rounded-2xl lanx-card px-4 py-3 text-left shadow-sm">
      <div className="flex items-start gap-3">
        <span
          className={`h-9 w-9 shrink-0 rounded-xl flex items-center justify-center text-white ${
            missed ? "bg-gradient-to-br from-rose-400 to-red-500" : "bg-gradient-to-br from-sky-400 to-indigo-500"
          }`}
        >
          <Video className="h-4.5 w-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-slate-800 dark:text-slate-100 truncate">{v.title || "Meeting"}</div>
          <div className={`text-[12px] ${missed ? "text-red-600 dark:text-red-400 font-medium" : "text-slate-500 dark:text-slate-400"}`}>
            {line} · {time(msg.timestamp)}
          </div>
          {v.outcome === "attended" && names.length > 1 && (
            <div className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500 truncate flex items-center gap-1">
              <Users className="h-3 w-3 shrink-0" /> {names.join(", ")}
            </div>
          )}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {v.meeting_id && (
          <button
            type="button"
            data-meeting-rejoin
            onClick={() => onRejoin(msg.id)}
            className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/20"
          >
            {v.outcome === "attended" ? "Join again" : "Join"}
          </button>
        )}
        {chat.length > 0 && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="inline-flex items-center gap-1 rounded-full bg-slate-500/10 px-2.5 py-1 text-[11px] font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-500/20"
          >
            {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />} Meeting chat ({chat.length})
          </button>
        )}
      </div>
      {open && (
        <div className="mt-2 max-h-56 overflow-y-auto rounded-xl bg-slate-500/5 px-3 py-2 space-y-1.5">
          {chat.map((l, i) => (
            <div key={i} className="text-[12px] leading-snug">
              <span className="font-semibold text-slate-700 dark:text-slate-200">{l.from === myId ? "You" : l.name}</span>
              <span className="ml-1.5 text-[10px] text-slate-400">{time(l.at)}</span>
              <div className="text-slate-600 dark:text-slate-300 whitespace-pre-wrap break-words">{l.text}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface RecordingRecord {
  path?: string;
  name?: string;
  size?: number;
  secs?: number;
  kind?: "meeting" | "call";
  title?: string;
}

export function RecordingCard({ msg, onError }: { msg: Message; onError: (text: string) => void }) {
  const v = parse<RecordingRecord>(msg.content) ?? {};
  const secs = v.secs ?? 0;
  const run = (f: () => Promise<void>) => f().catch((e) => onError(errorText(e)));
  return (
    <div data-recording-card className="w-full max-w-md rounded-2xl lanx-card px-4 py-3 text-left shadow-sm">
      <div className="flex items-start gap-3">
        <span className="h-9 w-9 shrink-0 rounded-xl bg-gradient-to-br from-red-400 to-rose-600 flex items-center justify-center">
          <span className="h-3 w-3 rounded-full bg-white" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-slate-800 dark:text-slate-100 truncate">
            Recording saved{v.title ? ` · ${v.title}` : ""}
          </div>
          <div className="text-[12px] text-slate-500 dark:text-slate-400 truncate" title={v.path}>
            {v.name || "Recording"}
          </div>
          <div className="text-[11px] text-slate-400 dark:text-slate-500">
            {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")} · {formatSize(v.size ?? 0)} · only on this computer
          </div>
        </div>
      </div>
      {v.path && (
        <div className="mt-2 flex gap-1.5">
          <button
            type="button"
            data-recording-play
            onClick={() => run(() => api.openRecording(v.path!))}
            className="inline-flex items-center gap-1 rounded-full bg-sky-500/10 px-2.5 py-1 text-[11px] font-semibold text-sky-700 dark:text-sky-400 hover:bg-sky-500/20"
          >
            <Play className="h-3 w-3" /> Play
          </button>
          <button
            type="button"
            onClick={() => run(() => api.revealRecording(v.path!))}
            className="inline-flex items-center gap-1 rounded-full bg-slate-500/10 px-2.5 py-1 text-[11px] font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-500/20"
          >
            <FolderOpen className="h-3 w-3" /> Show in folder
          </button>
        </div>
      )}
    </div>
  );
}
