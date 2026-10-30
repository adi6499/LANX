/** LANX 3.2 phone page: the call screen — ringing, calling, connecting, and
 *  the live call with the other person's picture, mute, camera and hang up. */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Circle, Mic, MicOff, Phone, PhoneOff, RefreshCw, Square, Video, VideoOff } from "lucide-react";
import { recordingSupported } from "../lib/recorder";
import type { Profile } from "../types";
import { Avatar } from "../components/Avatar";
import { type PhoneCall, canCall } from "./call";

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
};

function Round({ label, onClick, tone, children, hook, caption }: { label: string; onClick: () => void; tone: "red" | "green" | "dark" | "light"; children: React.ReactNode; hook?: string; caption?: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <button
        type="button"
        aria-label={label}
        data-ph-call-btn={hook}
        onClick={onClick}
        className={`flex h-16 w-16 items-center justify-center rounded-full shadow-lg active:scale-90 transition-transform ${
          tone === "red" ? "bg-red-500 text-white" : tone === "green" ? "bg-emerald-500 text-white" : tone === "light" ? "bg-white text-slate-900" : "bg-white/15 text-white"
        }`}
      >
        {children}
      </button>
      {caption && <span className="text-[11.5px] text-white/85">{caption}</span>}
    </div>
  );
}

export function CallScreen({ manager, profiles }: { manager: PhoneCall; profiles: Record<string, Profile> }) {
  const call = useSyncExternalStore(manager.subscribe, manager.snapshot, manager.snapshot);
  const remoteAudio = useRef<HTMLAudioElement | null>(null);
  const remoteVideo = useRef<HTMLVideoElement | null>(null);
  const localVideo = useRef<HTMLVideoElement | null>(null);
  const [, setTick] = useState(0);

  // Attach the streams whenever a track arrives or the camera changes.
  const tracks = call?.tracks ?? 0;
  const camera = call?.camera ?? false;
  useEffect(() => {
    const a = remoteAudio.current;
    if (a && a.srcObject !== manager.remoteStream) {
      a.srcObject = manager.remoteStream;
      a.play().catch(() => {});
    }
    const v = remoteVideo.current;
    if (v && v.srcObject !== manager.remoteStream) {
      v.srcObject = manager.remoteStream;
      v.play().catch(() => {});
    }
    const l = localVideo.current;
    if (l && l.srcObject !== manager.localStream) {
      l.srcObject = manager.localStream;
      l.play().catch(() => {});
    }
  }, [tracks, camera, call?.status, manager]);

  const active = call?.status === "active";
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [active]);

  if (!call) return null;
  const { info, status } = call;
  const name = info.private ? "Incoming call" : info.peer_name || "Someone";
  const kind = info.video ? "video" : "voice";
  const remoteVideoTrack = manager.remoteStream?.getVideoTracks().find((t) => t.readyState === "live" && !t.muted);
  const showRemoteVideo = status === "active" && (call.remoteVideo || call.remoteScreen) && !!remoteVideoTrack;
  // 3.4: a shared screen (remote help) is shown whole, not cropped.
  const screen = call.remoteScreen || info.help === "view";
  // Remote help a phone can take: a colleague who wants to show their screen.
  const canAnswerHelp = !info.help || info.help === "show";
  const line =
    status === "starting"
      ? "Starting the call…"
      : status === "outgoing"
        ? `Calling… (${kind} call)`
        : status === "incoming"
          ? `is ${info.video ? "video " : ""}calling you`
          : status === "connecting"
            ? "Connecting…"
            : status === "ended"
              ? call.endText ?? "Call ended"
              : clock(Date.now() - (call.connectedAt ?? Date.now()));

  return (
    <div className="fixed inset-0 z-[90] flex flex-col bg-slate-900 text-white" data-ph-call-status={status} data-ph-call={info.call_id || "starting"}>
      <audio ref={remoteAudio} autoPlay playsInline data-ph-call-audio />
      {/* The other person's picture fills the screen when it is on. */}
      <video ref={remoteVideo} autoPlay playsInline muted data-ph-call-remote-video data-ph-call-screen={screen ? "1" : "0"} className={`absolute inset-0 h-full w-full ${screen ? "object-contain bg-black" : "object-cover"} ${showRemoteVideo ? "" : "hidden"}`} />
      {!showRemoteVideo && <div className="absolute inset-0" style={{ background: `radial-gradient(circle at 50% 30%, ${info.avatar_color}55, #0f172a 70%)` }} />}

      <div className="relative z-10 flex flex-1 flex-col items-center px-6 pt-[calc(env(safe-area-inset-top)+48px)]">
        {!showRemoteVideo && (
          <>
            <div className={status === "incoming" || status === "outgoing" ? "lanx-call-pulse rounded-full" : ""}>
              {info.private ? (
                <span className="flex h-28 w-28 items-center justify-center rounded-full" style={{ backgroundColor: info.avatar_color }}>
                  <Phone className="h-10 w-10" />
                </span>
              ) : (
                <Avatar name={name} color={info.avatar_color} profile={profiles[info.peer_id]} size={112} />
              )}
            </div>
            <div className="mt-5 text-center text-[24px] font-bold" data-ph-call-name>
              {name}
            </div>
          </>
        )}
        <div className={`mt-1 text-center text-[14px] ${status === "ended" ? "text-amber-200" : "text-white/80"} ${showRemoteVideo ? "rounded-full bg-black/40 px-3 py-1" : ""}`} data-ph-call-line>
          {line}
          {status === "active" && call.remoteMuted && " · they muted"}
          {(call.remoteRecording || call.recording) && " · 🔴 recording"}
          {status === "active" && info.help === "view" && ` · 🛟 ${info.private ? "their" : `${name.split(" ")[0]}'s`} screen`}
        </div>
        {status === "incoming" && info.help === "view" && <div className="mt-3 rounded-xl bg-white/10 px-3 py-2 text-center text-[13px]">Remote help: they want to see your screen — answer it on your PC.</div>}
        {status === "incoming" && info.help === "show" && <div className="mt-3 rounded-xl bg-white/10 px-3 py-2 text-center text-[13px]">🛟 Remote help: they want to show you their screen.</div>}
        {(status === "outgoing" || status === "starting") && info.help === "view" && <div className="mt-3 rounded-xl bg-white/10 px-3 py-2 text-center text-[13px]">🛟 Asking to see their screen…</div>}
        {status === "incoming" && !canCall() && (
          <div className="mt-3 max-w-xs rounded-xl bg-white/10 px-3 py-2 text-center text-[12.5px] text-white/90" data-ph-call-insecure>
            Answering on the phone needs the secure connection (More → Secure connection). Answer on your PC, or decline here.
          </div>
        )}
      </div>

      {/* My own picture, small, when my camera is on. */}
      <video
        ref={localVideo}
        autoPlay
        playsInline
        muted
        data-ph-call-local-video
        className={`absolute right-4 top-[calc(env(safe-area-inset-top)+16px)] z-20 h-36 w-24 rounded-2xl bg-black object-cover shadow-xl ${camera && status !== "ended" ? "" : "hidden"} ${call.facing === "user" ? "-scale-x-100" : ""}`}
      />

      <div className="relative z-10 pb-[calc(env(safe-area-inset-bottom)+36px)]">
        {status === "incoming" ? (
          <div className="flex items-end justify-center gap-10">
            <Round label="Decline" hook="decline" tone="red" onClick={() => void manager.decline()} caption="Decline">
              <PhoneOff className="h-7 w-7" />
            </Round>
            {canAnswerHelp && canCall() && (
              <>
                {info.video && !info.help && (
                  <Round label="Answer with video" hook="answer-video" tone="green" onClick={() => void manager.answer(true)} caption="Video">
                    <Video className="h-7 w-7" />
                  </Round>
                )}
                <Round label="Answer" hook="answer" tone="green" onClick={() => void manager.answer(false)} caption={info.help ? "Watch" : info.video ? "Voice only" : "Answer"}>
                  <Phone className="h-7 w-7" />
                </Round>
              </>
            )}
          </div>
        ) : status === "ended" ? null : (
          <div className="flex items-end justify-center gap-5">
            {(status === "active" || status === "connecting") && (
              <>
                <Round label={call.muted ? "Unmute" : "Mute"} hook="mute" tone={call.muted ? "light" : "dark"} onClick={() => manager.toggleMute()} caption={call.muted ? "Muted" : "Mute"}>
                  {call.muted ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
                </Round>
                <Round label={camera ? "Camera off" : "Camera on"} hook="camera" tone={camera ? "light" : "dark"} onClick={() => void manager.toggleCamera()} caption="Camera">
                  {camera ? <Video className="h-6 w-6" /> : <VideoOff className="h-6 w-6" />}
                </Round>
                {camera && (
                  <Round label="Switch camera" hook="flip" tone="dark" onClick={() => void manager.flipCamera()} caption="Flip">
                    <RefreshCw className="h-6 w-6" />
                  </Round>
                )}
                {status === "active" && recordingSupported() && (
                  <Round label={call.recording ? "Stop recording" : "Record"} hook="record" tone={call.recording ? "red" : "dark"} onClick={() => void (call.recording ? manager.stopRecording() : manager.startRecording())} caption={call.recording ? "Stop" : "Record"}>
                    {call.recording ? <Square className="h-5 w-5" /> : <Circle className="h-6 w-6" />}
                  </Round>
                )}
              </>
            )}
            <Round label="Hang up" hook="hangup" tone="red" onClick={() => void manager.hangup()} caption="End">
              <PhoneOff className="h-7 w-7" />
            </Round>
          </div>
        )}
      </div>
    </div>
  );
}
