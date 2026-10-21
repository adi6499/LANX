import { useEffect, useRef, useState } from "react";
import { Keyboard, Monitor, MousePointer2 } from "lucide-react";
import { COMBOS, RemoteInput, videoPoint, wheelUnits } from "../../lib/remote";

/** LANX 2.0: the colleague's screen while you control it. Your mouse and
 *  (once you click the picture) your keyboard work on their PC. */
export function RemoteSurface({
  video,
  name,
  send,
}: {
  /** The video element showing their screen. */
  video: () => HTMLVideoElement | null;
  name: string;
  send: (events: RemoteInput[]) => void;
}) {
  const el = useRef<HTMLDivElement | null>(null);
  const queue = useRef<RemoteInput[]>([]);
  const frame = useRef(0);
  const held = useRef<Set<string>>(new Set());
  const buttons = useRef<Set<number>>(new Set());
  const wheelLeft = useRef({ dx: 0, dy: 0 });
  const [typing, setTyping] = useState(false);
  const sendRef = useRef(send);
  sendRef.current = send;

  const flush = () => {
    frame.current = 0;
    const e = queue.current;
    queue.current = [];
    if (e.length) sendRef.current(e);
  };
  const push = (ev: RemoteInput) => {
    const q = queue.current;
    // Only the latest pointer position matters between two frames.
    if (ev.t === "move" && q.length && q[q.length - 1].t === "move") q[q.length - 1] = ev;
    else q.push(ev);
    if (!frame.current) frame.current = requestAnimationFrame(flush);
  };
  const at = (e: { clientX: number; clientY: number }) => {
    const v = video();
    return v ? videoPoint(v, e.clientX, e.clientY) : null;
  };

  /** Lets go of everything (leaving the picture, or control ending). */
  const letGo = () => {
    for (const code of held.current) push({ t: "key", code, down: false });
    for (const b of buttons.current) push({ t: "button", b, down: false });
    held.current.clear();
    buttons.current.clear();
  };

  useEffect(() => {
    const node = el.current;
    if (!node) return;
    // The wheel needs a non-passive listener (Ctrl + wheel would zoom LANX).
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const w = wheelLeft.current;
      w.dx += wheelUnits(-e.deltaX, e.deltaMode); // right = positive
      w.dy += wheelUnits(e.deltaY, e.deltaMode); // up = positive
      const dx = Math.trunc(w.dx);
      const dy = Math.trunc(w.dy);
      if (dx || dy) {
        w.dx -= dx;
        w.dy -= dy;
        push({ t: "wheel", dx, dy });
      }
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    node.focus();
    return () => {
      node.removeEventListener("wheel", onWheel);
      letGo();
      if (frame.current) cancelAnimationFrame(frame.current);
      flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const first = name.split(" ")[0] || "their";
  return (
    <div
      ref={el}
      data-remote-surface
      tabIndex={0}
      className="absolute inset-0 z-10 outline-none ring-4 ring-inset ring-orange-500/90"
      onPointerMove={(e) => {
        const p = at(e);
        if (p) push({ t: "move", ...p });
      }}
      onPointerDown={(e) => {
        el.current?.focus();
        const p = at(e);
        if (!p || e.button > 4) return;
        e.preventDefault();
        el.current?.setPointerCapture(e.pointerId);
        push({ t: "move", ...p });
        buttons.current.add(e.button);
        push({ t: "button", b: e.button, down: true });
      }}
      onPointerUp={(e) => {
        if (!buttons.current.has(e.button)) return;
        const p = at(e);
        if (p) push({ t: "move", ...p });
        buttons.current.delete(e.button);
        push({ t: "button", b: e.button, down: false });
      }}
      onContextMenu={(e) => e.preventDefault()}
      onAuxClick={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!e.code || e.code === "Unidentified") return;
        held.current.add(e.code);
        push({ t: "key", code: e.code, down: true });
      }}
      onKeyUp={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!held.current.has(e.code)) return;
        held.current.delete(e.code);
        push({ t: "key", code: e.code, down: false });
      }}
      onFocus={() => setTyping(true)}
      onBlur={() => {
        setTyping(false);
        letGo();
      }}
    >
      <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 inline-flex items-center gap-1.5 rounded-full bg-orange-500/95 px-3 py-1 text-[11.5px] font-semibold text-white shadow-lg">
        <MousePointer2 className="h-3.5 w-3.5 shrink-0" />
        {typing
          ? `You're controlling ${first}'s PC · your keyboard types there`
          : `You're controlling ${first}'s PC · click the picture to type`}
      </div>
    </div>
  );
}

/** Shortcut keys this PC keeps for itself (Windows key, Alt + Tab…). */
export function RemoteKeysButton({ onCombo }: { onCombo: (codes: string[]) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        data-remote-keys
        aria-label="Special keys"
        title="Special keys (Windows key, Alt + Tab…)"
        onClick={() => setOpen((o) => !o)}
        className={`h-10 w-10 rounded-full flex items-center justify-center transition-colors active:scale-90 ${open ? "bg-white text-slate-900" : "bg-white/10 hover:bg-white/20 text-white"}`}
      >
        <Keyboard className="h-4 w-4" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute bottom-12 left-1/2 z-30 w-64 -translate-x-1/2 rounded-2xl border border-white/10 bg-slate-900/95 p-1.5 shadow-2xl backdrop-blur">
            {COMBOS.map((c) => (
              <button
                key={c.id}
                type="button"
                data-remote-combo={c.id}
                onClick={() => {
                  setOpen(false);
                  onCombo(c.codes);
                }}
                className="block w-full rounded-xl px-3 py-2 text-left text-[12.5px] text-white hover:bg-white/10"
              >
                {c.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function RemoteScreenButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      data-remote-next-screen
      aria-label="Switch screen"
      title="Wrong screen? Switch to their other screen"
      onClick={onClick}
      className="h-10 w-10 rounded-full flex items-center justify-center bg-white/10 hover:bg-white/20 text-white transition-colors active:scale-90"
    >
      <Monitor className="h-4 w-4" />
    </button>
  );
}

/** "Bharat wants to control your PC": Allow / No (the person being helped). */
export function RemoteAskDialog({
  name,
  problem,
  onAllow,
  onDeny,
  onWholeScreen,
}: {
  name: string;
  /** Why Allow didn't work yet (sharing a single window). */
  problem: string | null;
  onAllow: () => Promise<void>;
  onDeny: () => void;
  onWholeScreen: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const first = name.split(" ")[0] || "Your colleague";
  const run = (f: () => Promise<void>) => async () => {
    setBusy(true);
    try {
      await f();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 backdrop-blur-sm lanx-fade">
      <div
        data-remote-ask-dialog
        className="w-[440px] max-w-[92vw] rounded-[22px] border border-black/5 bg-white p-5 shadow-2xl lanx-rise dark:border-white/10 dark:bg-slate-900"
      >
        <div className="flex items-center gap-2.5 text-[15px] font-bold text-slate-900 dark:text-white">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-orange-500 text-white">
            <MousePointer2 className="h-4 w-4" />
          </span>
          {first} wants to control your PC
        </div>
        <ul className="mt-2 space-y-1.5 text-[12.5px] text-slate-700 dark:text-slate-200">
          <li>• They can move your mouse, click, type, and copy and paste between your PCs.</li>
          <li>• Your own mouse always wins: move it and theirs waits.</li>
          <li>
            • Stop any time with the <b>Stop</b> bar at the bottom of your screen, or by ending the call.
          </li>
        </ul>
        <p className="mt-2 text-[11.5px] text-slate-500 dark:text-slate-400">
          Only allow people you trust. Windows' own "allow this app" and lock-screen prompts stay yours to answer.
        </p>
        {problem && (
          <div className="mt-3 rounded-xl bg-amber-500/15 px-3 py-2 text-[12px] text-amber-700 dark:text-amber-200">{problem}</div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            data-remote-deny
            disabled={busy}
            onClick={onDeny}
            className="rounded-full px-4 py-2 text-[12.5px] font-semibold text-slate-600 dark:text-slate-300 hover:bg-[var(--lanx-fill)]"
          >
            No
          </button>
          {problem ? (
            <button
              type="button"
              data-remote-whole-screen
              disabled={busy}
              onClick={run(onWholeScreen)}
              className="rounded-full bg-orange-500 hover:bg-orange-600 px-4 py-2 text-[12.5px] font-semibold text-white"
            >
              Share my whole screen and allow
            </button>
          ) : (
            <button
              type="button"
              data-remote-allow
              disabled={busy}
              onClick={run(onAllow)}
              className="rounded-full bg-orange-500 hover:bg-orange-600 px-4 py-2 text-[12.5px] font-semibold text-white"
            >
              Allow control
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
