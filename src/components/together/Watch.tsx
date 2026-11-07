/** LANX 3.9.0: Watch together — a video on every PC, in step. The host picks a
 *  video file (this PC lends it over the office network; colleagues' LANX
 *  stream it, nobody waits for a copy) or pastes a link to a video file. The
 *  host plays, pauses and jumps; every PC follows the same plan on the host's
 *  clock and keeps its picture there (a little faster or slower — no one sees
 *  it — or a jump when far off). */
import { useEffect, useMemo, useRef, useState } from "react";
import { Clapperboard, FileVideo, Link2, Loader2, Maximize, Pause, Play, Volume2, X } from "lucide-react";
import { api, errorText } from "../../lib/api";
import { type Session, host as hostSession, hostNow, msUntil, publish, tell } from "../../lib/together";
import { PeoplePicker, Sheet, chosen, primaryBtn, secondaryBtn, useMyName, useOnline, useTogether } from "./common";

interface WatchState {
  title: string;
  src: { kind: "file"; port: number; path: string } | { kind: "link"; url: string };
  anchor: { pos_ms: number; host_us: number; playing: number };
  [k: string]: unknown;
}

const fmt = (s: number) => {
  const n = Math.max(0, Math.floor(s));
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  return `${h ? `${h}:${String(m).padStart(2, "0")}` : m}:${String(n % 60).padStart(2, "0")}`;
};

export function WatchSetup({ onClose, onStarted }: { onClose: () => void; onStarted: (sessionId: string) => void }) {
  const myName = useMyName();
  const online = useOnline();
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [src, setSrc] = useState<WatchState["src"] | null>(null);
  const [title, setTitle] = useState("");
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [failed, setFailed] = useState<Record<string, string>>({});

  const chooseFile = async () => {
    setProblem(null);
    try {
      const [path] = await api.pickFiles();
      if (!path) return;
      const w = await api.watchServe(path);
      setSrc({ kind: "file", port: w.port, path: `/w/${w.token}/${encodeURIComponent(w.name)}` });
      setTitle(w.name.replace(/\.[^.]+$/, ""));
    } catch (e) {
      setProblem(errorText(e));
    }
  };
  const useLink = () => {
    const u = link.trim();
    if (!/^https?:\/\/\S+$/i.test(u)) return setProblem("Paste a link starting with http:// or https://");
    if (/youtube\.com|youtu\.be/i.test(u)) return setProblem("YouTube links can't be played in step yet — use a video file, or a link to an MP4/WebM file.");
    setSrc({ kind: "link", url: u });
    setTitle(decodeURIComponent(u.split(/[?#]/)[0].split("/").pop() || "Video"));
    setProblem(null);
  };
  const start = async () => {
    if (!src) return;
    setBusy(true);
    try {
      const people = chosen(online, picked);
      const state: WatchState = { title: title || "Video", src, anchor: { pos_ms: 0, host_us: Math.round(hostNow() * 1000), playing: 0 } };
      const { session, failed: f } = await hostSession("watch", people, myName || "A colleague", state, { title: state.title });
      setFailed(f);
      onStarted(session.id);
    } catch (e) {
      setProblem(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet title="Watch together" subtitle="A video on every chosen PC, in step" icon={<Clapperboard className="h-5 w-5" />} onClose={onClose} tag="watch">
      {!src ? (
        <div className="space-y-3">
          <button type="button" data-watch-file onClick={() => void chooseFile()} className="flex w-full items-center gap-3 rounded-2xl lanx-group p-3.5 text-left hover:bg-[var(--lanx-fill)]">
            <FileVideo className="h-6 w-6 text-sky-600" />
            <span>
              <span className="block text-[14px] font-semibold text-slate-900 dark:text-white">Choose a video file</span>
              <span className="block text-[12px] text-slate-500">MP4, WebM, MOV or MKV on this PC — colleagues stream it from here</span>
            </span>
          </button>
          <div className="rounded-2xl lanx-group p-3.5">
            <div className="flex items-center gap-2 text-[14px] font-semibold text-slate-900 dark:text-white">
              <Link2 className="h-4 w-4 text-sky-600" /> Or a link to a video file
            </div>
            <div className="mt-2 flex gap-2">
              <input data-watch-link value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…/training.mp4" className="min-w-0 flex-1 rounded-xl border border-[var(--lanx-line)] bg-transparent px-3 py-2 text-[13px] text-slate-900 outline-none dark:text-white" />
              <button type="button" onClick={useLink} className={secondaryBtn}>
                Use it
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 rounded-xl lanx-group px-3 py-2">
            <FileVideo className="h-4 w-4 text-sky-600" />
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="min-w-0 flex-1 bg-transparent text-[13.5px] font-semibold text-slate-900 outline-none dark:text-white" />
            <button type="button" onClick={() => setSrc(null)} className="lanx-tool p-1 text-slate-400">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="mt-4">
            <PeoplePicker picked={picked} onChange={setPicked} failed={failed} />
          </div>
          <button type="button" data-watch-start disabled={busy || !Object.values(picked).some(Boolean)} onClick={() => void start()} className={`${primaryBtn} mt-3`}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Invite and open the player
          </button>
        </>
      )}
      {problem && <p className="mt-3 text-[12.5px] text-amber-600">{problem}</p>}
    </Sheet>
  );
}

export function WatchScreen({ session, onClose }: { session: Session; onClose: () => void }) {
  const { sessions } = useTogether();
  const s = sessions.find((x) => x.id === session.id) ?? session;
  const st = s.state as WatchState | null;
  const isHost = s.role === "host";
  const hostPeer = s.hostId || undefined;
  const video = useRef<HTMLVideoElement | null>(null);
  const box = useRef<HTMLDivElement | null>(null);
  const anchor = useRef<WatchState["anchor"] | null>(null);
  const err = useRef<number | null>(null);
  /** How long a jump takes on this PC (ms): a jump aims that far ahead. */
  const seekLag = useRef(120);
  const seekAt = useRef(0);
  const [hostIp, setHostIp] = useState<string | null>(null);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);
  const [errMs, setErrMs] = useState<number | null>(null);
  const [vol, setVol] = useState(1);
  const [problem, setProblem] = useState<string | null>(null);
  anchor.current = st?.anchor ?? null;

  // Where the video is: this PC's own server for the host, the host's address for others.
  useEffect(() => {
    if (isHost || st?.src.kind !== "file") return;
    api
      .listPeers()
      .then((l) => setHostIp(l.find((p) => p.id === s.hostId)?.last_ip ?? null))
      .catch(() => setHostIp(null));
  }, [isHost, s.hostId, st?.src.kind]);
  const url = useMemo(() => {
    if (!st) return null;
    if (st.src.kind === "link") return st.src.url;
    const ip = isHost ? "127.0.0.1" : hostIp;
    return ip ? `http://${ip.includes(":") ? `[${ip}]` : ip}:${st.src.port}${st.src.path}` : null;
  }, [st, isHost, hostIp]);

  // Follow the plan: start at the planned moment, then stay on it.
  useEffect(() => {
    const a = st?.anchor;
    const v = video.current;
    if (!a || !v) return;
    const at = a.host_us / 1000;
    const wait = msUntil(at, hostPeer);
    if (a.playing && wait > 0) {
      v.pause();
      v.currentTime = a.pos_ms / 1000;
      const t = window.setTimeout(() => void v.play().catch(() => {}), Math.max(0, wait - 25));
      return () => window.clearTimeout(t);
    }
  }, [st?.anchor, hostPeer]);
  useEffect(() => {
    const t = window.setInterval(() => {
      const v = video.current;
      const a = anchor.current;
      if (!v || !a || v.readyState < 1) return;
      setPos(v.currentTime);
      if (v.duration && Number.isFinite(v.duration)) setDur(v.duration);
      const now = hostNow(hostPeer);
      const started = now >= a.host_us / 1000;
      const expected = Math.min(v.duration || Infinity, (a.pos_ms + (a.playing && started ? now - a.host_us / 1000 : 0)) / 1000);
      if (!a.playing || !started) {
        if (!a.playing && !v.paused) v.pause();
        if (!a.playing && Math.abs(v.currentTime - expected) > 0.04) v.currentTime = expected;
        return;
      }
      if (v.ended || expected >= (v.duration || Infinity) - 0.05) return;
      if (v.paused) {
        v.currentTime = expected + 0.08;
        void v.play().catch((e) => setProblem(`The video won't play here: ${errorText(e)}`));
        return;
      }
      const e = v.currentTime - expected;
      // Far off (a jump, a slow start): jump to where the plan will be when the jump is done.
      if (Math.abs(e) > 0.12) {
        if (v.seeking || performance.now() - seekAt.current < 700) return;
        seekAt.current = performance.now();
        v.currentTime = expected + seekLag.current / 1000;
        v.playbackRate = 1;
        err.current = null;
        return;
      }
      err.current = err.current == null ? e * 1000 : err.current * 0.7 + e * 300;
      const ee = Math.abs(err.current) < 12 ? 0 : err.current / 1000;
      v.playbackRate = Math.max(0.93, Math.min(1.07, 1 - ee * 0.8));
    }, 200);
    const report = window.setInterval(() => {
      setErrMs(err.current == null ? null : Math.round(err.current));
      if (!isHost) void tell(s, "status", { err_ms: err.current == null ? -1 : Math.round(Math.abs(err.current)), ready: (video.current?.readyState ?? 0) >= 2 ? 1 : 0 });
    }, 2000);
    return () => {
      window.clearInterval(t);
      window.clearInterval(report);
    };
  }, [hostPeer, isHost, s]);

  // Host: the plan for everyone, a moment ahead.
  const plan = (playing: boolean, toS?: number) => {
    if (!st) return;
    const lead = playing ? 500 : 200;
    const h = hostNow() + lead;
    const a = st.anchor;
    const cur = a.playing ? a.pos_ms + Math.max(0, h - a.host_us / 1000) : a.pos_ms;
    publish(s, { ...st, anchor: { pos_ms: Math.round(toS != null ? toS * 1000 : cur), host_us: Math.round(h * 1000), playing: playing ? 1 : 0 } });
  };
  const playing = !!st?.anchor.playing;
  const close = () => {
    if (isHost && st?.src.kind === "file") void api.watchStop().catch(() => {});
    onClose();
  };
  const members = [...s.members.values()];
  const inStep = errMs != null && Math.abs(errMs) <= 40;
  return (
    <div data-watch-screen={s.role} ref={box} className="fixed inset-0 z-[77] flex flex-col bg-black text-white lanx-fade">
      <div className="flex items-center gap-3 px-4 py-2.5">
        <Clapperboard className="h-5 w-5 text-sky-300" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold">{st?.title ?? "Video"}</div>
          <div className="text-[11.5px] text-white/60">
            {isHost ? `You're showing it · ${members.length} watching${members.length ? ": " + members.map((m) => m.name).join(", ") : ""}` : `With ${s.hostName} · ${s.hostName} plays and pauses`}
            {errMs != null && <span className={inStep ? " text-emerald-300" : ""}> · {inStep ? `in step (±${Math.abs(errMs)} ms)` : `catching up (${Math.abs(errMs)} ms)`}</span>}
          </div>
        </div>
        <button type="button" data-watch-close onClick={close} className="rounded-full bg-white/10 px-3.5 py-1.5 text-[12.5px] font-semibold hover:bg-white/20">
          {isHost ? "Stop for everyone" : "Leave"}
        </button>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        {url ? (
          <video
            ref={video}
            data-watch-video
            src={url}
            preload="auto"
            onSeeked={() => {
              if (seekAt.current) seekLag.current = Math.min(600, seekLag.current * 0.6 + (performance.now() - seekAt.current) * 0.4);
            }}
            playsInline
            className="max-h-full max-w-full"
            onError={() => setProblem("The video couldn't be loaded (is the host's PC still sharing it?).")}
          />
        ) : (
          <Loader2 className="h-8 w-8 animate-spin text-white/50" />
        )}
        {problem && <div className="absolute bottom-4 rounded-full bg-black/70 px-4 py-2 text-[12.5px] text-amber-300">{problem}</div>}
      </div>
      <div className="flex items-center gap-3 px-4 py-3">
        {isHost && (
          <button type="button" data-watch-toggle onClick={() => plan(!playing)} className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-slate-900">
            {playing ? <Pause className="h-5 w-5" /> : <Play className="ml-0.5 h-5 w-5" />}
          </button>
        )}
        <span className="w-14 text-right text-[12px] tabular-nums text-white/70">{fmt(pos)}</span>
        <input
          type="range"
          data-watch-seek
          min={0}
          max={Math.max(1, Math.round(dur))}
          value={Math.round(pos)}
          disabled={!isHost}
          onChange={(e) => plan(playing, Number(e.target.value))}
          className="flex-1 accent-sky-400 disabled:opacity-60"
        />
        <span className="w-14 text-[12px] tabular-nums text-white/70">{fmt(dur)}</span>
        <Volume2 className="h-4 w-4 text-white/70" />
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(vol * 100)}
          onChange={(e) => {
            const n = Number(e.target.value) / 100;
            setVol(n);
            if (video.current) video.current.volume = n;
          }}
          className="w-24 accent-sky-400"
        />
        <button type="button" title="Full screen" onClick={() => void box.current?.requestFullscreen?.().catch(() => {})} className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/15">
          <Maximize className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

/** For tests: where this PC's video is against the plan. */
(window as unknown as { __lanxWatch?: unknown }).__lanxWatch = {
  probe: () => {
    const v = document.querySelector<HTMLVideoElement>("[data-watch-video]");
    return v ? { time: v.currentTime, paused: v.paused, rate: v.playbackRate, ready: v.readyState, wall: performance.timeOrigin + performance.now() } : null;
  },
};
