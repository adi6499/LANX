/** LANX 2.0: the bar at the bottom of the screen while a colleague controls
 *  this PC ("Bharat is controlling your PC · Stop"). It runs in its own
 *  small always-on-top window that never takes the keyboard away from the
 *  program being used; Rust shows and hides it (remote.rs). */
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { MousePointer2 } from "lucide-react";
import type { RemoteInfo } from "./types";

export default function RemoteBar() {
  const [info, setInfo] = useState<RemoteInfo | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    invoke<RemoteInfo>("remote_info")
      .then(setInfo)
      .catch(() => {});
    const un = listen<RemoteInfo>("lanx://remote", (e) => {
      setInfo(e.payload);
      setBusy(false);
    });
    return () => {
      void un.then((u) => u());
    };
  }, []);

  const first = info?.peer_name.split(" ")[0] || "A colleague";
  return (
    <div className="flex h-screen w-screen items-center justify-center p-1.5 select-none">
      <div
        data-remote-bar
        className="flex h-full w-full items-center gap-3 rounded-full bg-orange-500 pl-4 pr-1.5 text-white shadow-[0_6px_24px_rgba(0,0,0,0.35)] ring-1 ring-black/10"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/20">
          <MousePointer2 className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-[13px] font-bold">{first} is controlling your PC</span>
          <span className="block truncate text-[11px] text-white/85">
            {info?.blocked ? "Windows blocked them here: please click it yourself" : "Move your mouse to take over"}
          </span>
        </span>
        <button
          type="button"
          data-remote-bar-stop
          disabled={busy}
          onClick={() => {
            setBusy(true);
            invoke("remote_stop").catch(() => setBusy(false));
          }}
          className="h-[calc(100%-4px)] shrink-0 rounded-full bg-white px-5 text-[13px] font-bold text-orange-600 hover:bg-orange-50 active:scale-95 transition-transform"
        >
          Stop
        </button>
      </div>
    </div>
  );
}
