/** The desktop Dynamic Island (LANX 1.2.7): runs in its own small,
 *  see-through window at the top centre of the screen. While LANX is hidden
 *  or behind other programs, new messages and files arrive here, with the
 *  delivery cat. Clicking opens LANX on that chat; files can be accepted
 *  right here. The window hides itself when there is nothing to show. */
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Bell, Check, ExternalLink, Lock } from "lucide-react";
import { UserSettings } from "./types";
import { applyAppearance } from "./lib/background";
import { setMotion } from "./lib/motion";
import { formatSize } from "./lib/format";
import { FileIcon } from "./components/FileCard";
import { CatMood, DeliveryCat } from "./components/DeliveryCat";

interface IslandAlert {
  id: string;
  kind: "message" | "file" | "ring";
  title: string;
  body: string;
  conversation_id?: string | null;
  avatar_color?: string | null;
  group?: string | null;
  transfer_id?: string | null;
  file_name?: string | null;
  file_size?: number | null;
  needs_accept: boolean;
  private: boolean;
}

type Mode = "hidden" | "message" | "request" | "file" | "accepted" | "ring";

const SIZE: Record<Mode, { w: number; h: number; r: number }> = {
  hidden: { w: 120, h: 30, r: 15 },
  message: { w: 400, h: 78, r: 30 },
  request: { w: 420, h: 110, r: 30 },
  file: { w: 400, h: 70, r: 30 },
  accepted: { w: 330, h: 54, r: 27 },
  ring: { w: 380, h: 66, r: 33 },
};

/** How long an alert stays (ms); the mouse on the island pauses it. */
const STAY: Record<Mode, number> = { hidden: 0, message: 7000, request: 25000, file: 7000, accepted: 1600, ring: 8000 };

export default function IslandApp() {
  const [queue, setQueue] = useState<IslandAlert[]>([]);
  const [mode, setMode] = useState<Mode>("hidden");
  const [cat, setCat] = useState<{ id: string; mood: CatMood } | null>(null);
  const [catOn, setCatOn] = useState(true);
  const [hover, setHover] = useState(false);
  const leaving = useRef(false);
  const current = queue[0] ?? null;

  // A see-through page that follows the user's theme and accent colour.
  const loadLook = useCallback(async () => {
    try {
      const s = await invoke<UserSettings>("get_settings");
      const dark = s.theme === "dark" || (s.theme === "system" && window.matchMedia?.("(prefers-color-scheme: dark)").matches);
      document.documentElement.classList.toggle("dark", !!dark);
      applyAppearance(s);
      setMotion(!!s.reduce_motion);
      setCatOn(s.cat_alerts);
    } catch {
      /* keep the defaults */
    }
  }, []);

  const take = useCallback(async () => {
    try {
      const fresh = await invoke<IslandAlert[]>("island_take");
      if (!fresh.length) return;
      void loadLook();
      setQueue((q) => [...q.filter((a) => !fresh.some((f) => f.id === a.id)), ...fresh]);
    } catch {
      /* LANX is closing */
    }
  }, [loadLook]);

  useEffect(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    document.title = "LANX alerts";
    void loadLook();
    void take();
    const un = [
      listen("lanx://island-alert", () => void take()),
      // LANX came to the front: its own island takes over.
      listen("lanx://island-dismiss", () => finishAll()),
    ];
    return () => un.forEach((p) => p.then((f) => f()).catch(() => {}));
  }, []);

  // Show the first alert in the queue.
  useEffect(() => {
    if (!current) return;
    leaving.current = false;
    setMode(current.kind === "message" ? "message" : current.kind === "ring" ? "ring" : current.needs_accept ? "request" : "file");
    setCat(catOn ? { id: current.id, mood: "hello" } : null);
  }, [current?.id, catOn]);

  // Next alert, or shrink away and hide the window.
  const next = useCallback(
    (mood: CatMood = "bye", delay = 900) => {
      if (leaving.current) return;
      leaving.current = true;
      setCat((c) => (c ? { ...c, mood } : c));
      window.setTimeout(() => {
        setQueue((q) => {
          const rest = q.slice(1);
          if (!rest.length) {
            setMode("hidden");
            setCat(null);
            window.setTimeout(() => void invoke("island_hide").catch(() => {}), 450);
          }
          return rest;
        });
      }, delay);
    },
    []
  );

  const finishAll = () => {
    setCat((c) => (c ? { ...c, mood: "bye" } : c));
    window.setTimeout(() => {
      setQueue([]);
      setMode("hidden");
      setCat(null);
      window.setTimeout(() => void invoke("island_hide").catch(() => {}), 450);
    }, 500);
  };

  useEffect(() => {
    if (!current || hover || mode === "hidden") return;
    const t = window.setTimeout(() => next("bye"), STAY[mode]);
    return () => window.clearTimeout(t);
  }, [current?.id, mode, hover]);

  const open = (a: IslandAlert) => {
    setCat((c) => (c ? { ...c, mood: "happy" } : c));
    window.setTimeout(() => {
      setQueue([]);
      setMode("hidden");
      setCat(null);
      void invoke("island_open", { conversationId: a.private ? null : a.conversation_id ?? null }).catch(() => {});
    }, 450);
  };

  const accept = async (a: IslandAlert) => {
    if (!a.transfer_id) return;
    try {
      await invoke("accept_transfer", { transferId: a.transfer_id });
      setMode("accepted");
      next("happy", 1500);
    } catch {
      open(a);
    }
  };

  const size = SIZE[mode];
  const a = current;
  let content: React.ReactNode = null;
  if (a && mode === "message") {
    content = (
      <div className="flex h-full items-center gap-3 px-3.5">
        <span
          className="h-11 w-11 shrink-0 rounded-full flex items-center justify-center text-white text-[15px] font-bold shadow-inner ring-2 ring-white/15"
          style={{ backgroundColor: a.private ? "#64748b" : a.avatar_color || "#0ea5e9" }}
        >
          {a.private ? <Lock className="h-5 w-5" /> : a.title.charAt(0).toUpperCase()}
        </span>
        <button type="button" onClick={() => open(a)} className="min-w-0 flex-1 text-left" title="Open in LANX">
          <span className="block text-[12.5px] font-semibold truncate">
            {a.title}
            {a.group && <span className="font-medium text-white/50"> · {a.group}</span>}
          </span>
          <span className="block text-[12px] text-white/75 leading-snug line-clamp-2 break-words">{a.body}</span>
        </button>
        <button
          type="button"
          onClick={() => open(a)}
          className="shrink-0 px-3 py-1 rounded-full bg-sky-500 hover:bg-sky-400 text-[11px] font-bold shadow-md shadow-sky-500/30"
        >
          Open
        </button>
      </div>
    );
  } else if (a && mode === "ring") {
    content = (
      <div className="flex h-full items-center gap-3 px-3.5">
        <span className="h-10 w-10 shrink-0 rounded-full bg-gradient-to-br from-amber-300 to-amber-500 flex items-center justify-center lanx-bell">
          <Bell className="h-5 w-5 text-amber-950" />
        </span>
        <button type="button" onClick={() => open(a)} className="min-w-0 flex-1 text-left" title="Open in LANX">
          <span className="block text-[12.5px] font-semibold truncate">
            {a.title} {a.body}
          </span>
          <span className="block text-[11px] text-white/60 truncate">They want your attention</span>
        </button>
        <button
          type="button"
          onClick={() => open(a)}
          className="shrink-0 px-3 py-1 rounded-full bg-amber-400 hover:bg-amber-300 text-amber-950 text-[11px] font-bold shadow-md shadow-amber-500/30"
        >
          Open
        </button>
      </div>
    );
  } else if (a && mode === "request") {
    content = (
      <div className="flex h-full flex-col justify-between px-4 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="h-10 w-10 shrink-0 rounded-[12px] bg-gradient-to-br from-amber-300 to-orange-500 flex items-center justify-center text-white shadow-inner">
            <FileIcon name={a.file_name || "file"} className="h-5 w-5" />
          </span>
          <button type="button" onClick={() => open(a)} className="min-w-0 flex-1 text-left" title="Open in LANX">
            <span className="block text-[11px] font-medium text-white/60 truncate">{a.title} wants to send you a file</span>
            <span className="block text-[13px] font-semibold truncate">
              {a.file_name || a.body}
              {a.file_size ? ` · ${formatSize(a.file_size)}` : ""}
            </span>
          </button>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10.5px] text-white/50">{queue.length > 1 ? `+${queue.length - 1} more` : "Encrypted · straight from their PC"}</span>
          <span className="flex gap-1.5">
            <button type="button" onClick={() => next("bye")} className="px-3 py-1 rounded-full bg-white/12 hover:bg-white/20 text-[11px] font-semibold">
              Later
            </button>
            <button
              type="button"
              onClick={() => void accept(a)}
              className="px-3.5 py-1 rounded-full bg-sky-500 hover:bg-sky-400 text-[11px] font-bold shadow-md shadow-sky-500/30 active:scale-95"
            >
              Accept
            </button>
          </span>
        </div>
      </div>
    );
  } else if (a && mode === "file") {
    content = (
      <div className="flex h-full items-center gap-3 px-3.5">
        <span className="h-10 w-10 shrink-0 rounded-[12px] bg-gradient-to-br from-amber-300 to-orange-500 flex items-center justify-center text-white">
          {a.private ? <Lock className="h-5 w-5" /> : <FileIcon name={a.file_name || "file"} className="h-5 w-5" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[12.5px] font-semibold truncate">{a.private ? a.title : `Receiving from ${a.title}`}</span>
          <span className="block text-[11.5px] text-white/65 truncate">{a.body}</span>
        </span>
        <button
          type="button"
          onClick={() => open(a)}
          className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/12 hover:bg-white/20 text-[11px] font-semibold"
        >
          <ExternalLink className="h-3 w-3" /> Open
        </button>
      </div>
    );
  } else if (a && mode === "accepted") {
    content = (
      <div className="flex h-full items-center gap-3 px-3.5">
        <span className="h-8 w-8 shrink-0 rounded-full bg-emerald-500 flex items-center justify-center lanx-pop">
          <Check className="h-4 w-4" strokeWidth={3} />
        </span>
        <span className="min-w-0 flex-1 text-[12px] font-semibold truncate">Accepted · receiving {a.file_name}</span>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen flex flex-col items-center pt-1 overflow-hidden select-none" data-desktop-island={mode}>
      <div
        role="status"
        aria-live="polite"
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        className={`lanx-island ${mode === "hidden" ? "lanx-island-hidden" : ""}`}
        style={{ width: size.w, height: size.h, borderRadius: size.r }}
      >
        <div key={mode + (a?.id ?? "")} className="lanx-island-content h-full">
          {content}
        </div>
      </div>
      {cat && a && (
        <DeliveryCat
          key={cat.id}
          alertId={cat.id}
          variant={a.kind === "file" ? "box" : a.kind === "ring" ? "bell" : "letter"}
          say={a.kind === "ring" ? `${a.private ? "Someone" : a.title.split(" ")[0]} is ringing you! 🔔` : undefined}
          from={a.private ? "Someone" : a.title}
          fileName={a.file_name ?? ""}
          fileSize={a.file_size ?? 0}
          mood={cat.mood}
        />
      )}
    </div>
  );
}
