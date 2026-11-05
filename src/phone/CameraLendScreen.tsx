/** LANX 3.6.2 phone page: "Your PC wants to use this phone's camera" — the
 *  question, then the picture being sent with Flip and Stop. Also the More →
 *  "Camera for your PC" sheet. */
import { useEffect, useRef, useSyncExternalStore } from "react";
import { Camera, Loader2, RefreshCw, Square } from "lucide-react";
import { type CameraLend, canLend } from "./camera";
import { Sheet } from "./parts";

export function CameraLendScreen({ manager }: { manager: CameraLend }) {
  const s = useSyncExternalStore(manager.subscribe, manager.snapshot, manager.snapshot);
  const video = useRef<HTMLVideoElement | null>(null);
  const stream = s?.phase === "on" ? s.stream : null;
  useEffect(() => {
    if (video.current && video.current.srcObject !== stream) video.current.srcObject = stream;
  }, [stream]);
  if (!s) return null;
  // What it's for, when the PC said ("a video call", "hand gestures").
  const forWhat = s.purpose && s.purpose !== "LANX" ? s.purpose : "";

  if (s.phase === "asking") {
    return (
      <div className="fixed inset-0 z-[88] flex items-end justify-center bg-black/40 lanx-fade" data-ph-cam="asking">
        <div className="ph-safe-bottom w-full max-w-md rounded-t-[22px] lanx-sheet p-5 lanx-rise">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-sky-500 text-white">
              <Camera className="h-5 w-5" />
            </span>
            <div>
              <div className="text-[16px] font-bold text-slate-900 dark:text-white">Your PC wants to use this phone's camera</div>
              <div className="text-[12.5px] text-slate-500 dark:text-slate-400">{forWhat ? `For ${forWhat}. ` : ""}The picture goes only to your PC, over the office network.</div>
            </div>
          </div>
          <label className="mt-4 flex items-center gap-2 text-[13px] text-slate-700 dark:text-slate-200">
            <input type="checkbox" data-ph-cam-always checked={manager.always} onChange={(e) => manager.setAlways(e.target.checked)} className="h-4 w-4" />
            Always allow my PC (while LANX is open here)
          </label>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button type="button" data-ph-cam-no onClick={() => manager.decline()} className="rounded-full lanx-group px-4 py-2.5 text-[14px] font-semibold text-slate-700 dark:text-slate-200">
              Not now
            </button>
            <button type="button" data-ph-cam-allow onClick={() => void manager.accept()} className="rounded-full bg-sky-500 px-4 py-2.5 text-[14px] font-semibold text-white">
              Allow
            </button>
          </div>
        </div>
      </div>
    );
  }

  const gestures = s.purpose === "hand gestures";
  return (
    <div className="fixed inset-0 z-[88] flex flex-col bg-black text-white" data-ph-cam={s.phase}>
      <video
        ref={video}
        autoPlay
        playsInline
        muted
        data-ph-cam-video
        className="absolute inset-0 h-full w-full object-contain"
        style={{ transform: s.phase === "on" && s.facing === "user" ? "scaleX(-1)" : undefined }}
      />
      <div className="relative z-10 px-5 pt-[calc(env(safe-area-inset-top)+20px)] text-center">
        <div className="inline-flex items-center gap-2 rounded-full bg-black/55 px-3 py-1.5 text-[13px] font-semibold">
          {s.phase === "starting" ? <Loader2 className="h-4 w-4 animate-spin" /> : <span className="h-2 w-2 rounded-full bg-red-500" />}
          {s.phase === "starting" ? "Starting the camera…" : forWhat ? `Your PC is using this camera — for ${forWhat}` : "Your PC is using this camera"}
        </div>
        {gestures && s.phase === "on" && <div className="mx-auto mt-2 max-w-xs rounded-xl bg-black/55 px-3 py-2 text-[12px] text-white/90">Stand the phone up below your screen, facing you, about an arm's length away. Keep this page open.</div>}
      </div>
      <div className="relative z-10 mt-auto flex items-center justify-center gap-10 pb-[calc(env(safe-area-inset-bottom)+28px)]">
        <div className="flex flex-col items-center gap-1.5">
          <button type="button" aria-label="Switch camera" data-ph-cam-flip disabled={s.phase !== "on"} onClick={() => void manager.flip()} className="flex h-14 w-14 items-center justify-center rounded-full bg-white/15 active:scale-90 transition-transform disabled:opacity-40">
            <RefreshCw className="h-5 w-5" />
          </button>
          <span className="text-[11.5px] text-white/85">Flip</span>
        </div>
        <div className="flex flex-col items-center gap-1.5">
          <button type="button" aria-label="Stop lending the camera" data-ph-cam-stop onClick={() => manager.stop()} className="flex h-14 w-14 items-center justify-center rounded-full bg-red-500 active:scale-90 transition-transform">
            <Square className="h-5 w-5 fill-current" />
          </button>
          <span className="text-[11.5px] text-white/85">Stop</span>
        </div>
      </div>
    </div>
  );
}

/** More → "Camera for your PC": what it is, and "always allow". */
export function PcCameraSheet({ manager, onClose }: { manager: CameraLend; onClose: () => void }) {
  useSyncExternalStore(manager.subscribe, manager.snapshot, manager.snapshot);
  const ok = canLend();
  return (
    <Sheet title="Camera for your PC" onClose={onClose} hook="pccam">
      <p className="text-[13px] text-slate-600 dark:text-slate-300">
        A PC without a camera can use this phone's instead — for video calls, meetings and hand gestures. When LANX on your PC needs a camera, this phone asks you, then sends the picture straight to your PC over the office network.
      </p>
      <p className="mt-2 text-[12.5px] text-slate-500 dark:text-slate-400">Keep LANX open on the phone (the camera stops when the phone locks or you switch apps). Stand it up facing you.</p>
      {!ok && <p className="mt-2 rounded-xl bg-amber-500/15 px-3 py-2 text-[12.5px] text-amber-700 dark:text-amber-300">This needs the secure connection: More → Secure connection & alerts.</p>}
      <label className="mt-3 flex items-center justify-between gap-3 rounded-xl lanx-group px-3 py-2.5 text-[13.5px] text-slate-800 dark:text-slate-100">
        Always allow my PC
        <input type="checkbox" data-ph-cam-always-setting checked={manager.always} onChange={(e) => manager.setAlways(e.target.checked)} className="h-4 w-4" />
      </label>
    </Sheet>
  );
}
