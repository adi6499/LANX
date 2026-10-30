/** LANX 3.4 phone page: a group meeting — the invitation, everyone's picture
 *  in a grid, mute / camera / hand / chat / invite, and leaving. The PC's
 *  own meeting window does the same on the desktop (MeetingLayer). */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Circle, Hand, MessageSquare, Mic, MicOff, PhoneOff, RefreshCw, Send, Square, UserPlus, Users, Video, VideoOff, X } from "lucide-react";
import { recordingSupported } from "../lib/recorder";
import type { MeetingPerson, Peer, Profile } from "../types";
import { Avatar } from "../components/Avatar";
import { type PhoneMeeting, canMeet } from "./meeting";

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
};

function Ctl({ label, onClick, on, tone, children, hook, badge }: { label: string; onClick: () => void; on?: boolean; tone?: "red"; children: React.ReactNode; hook: string; badge?: number }) {
  return (
    <button
      type="button"
      aria-label={label}
      data-ph-meeting-btn={hook}
      aria-pressed={on}
      onClick={onClick}
      className={`relative flex h-12 w-12 items-center justify-center rounded-full active:scale-90 transition-transform ${tone === "red" ? "bg-red-500 text-white" : on ? "bg-white text-slate-900" : "bg-white/15 text-white"}`}
    >
      {children}
      {!!badge && <span className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-sky-500 px-1 text-center text-[10px] font-bold text-white">{badge}</span>}
    </button>
  );
}

/** One person's tile: their picture when it comes, else their avatar. */
function Tile({ person, stream, local, connected, profile, facing, version }: { person: MeetingPerson; stream: MediaStream | null; local?: boolean; connected: boolean; profile: Profile | null; facing?: string; version: number }) {
  const video = useRef<HTMLVideoElement | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    const v = video.current;
    if (v && stream && v.srcObject !== stream) {
      v.srcObject = stream;
      v.play().catch(() => {});
    }
    const a = audio.current;
    if (a && stream && !local && a.srcObject !== stream) {
      a.srcObject = stream;
      a.play().catch(() => {});
    }
  }, [stream, local, version]);
  const live = !!stream?.getVideoTracks().some((t) => t.readyState === "live" && !t.muted);
  const showVideo = person.camera && live;
  return (
    <div className="relative overflow-hidden rounded-2xl bg-slate-800" data-ph-meeting-tile={person.device_id} data-ph-meeting-connected={local || connected ? "1" : "0"}>
      {!local && <audio ref={audio} autoPlay playsInline />}
      <video ref={video} autoPlay playsInline muted className={`absolute inset-0 h-full w-full object-cover ${showVideo ? "" : "hidden"} ${local && facing === "user" ? "-scale-x-100" : ""}`} />
      {!showVideo && (
        <div className="absolute inset-0 flex items-center justify-center" style={{ background: `radial-gradient(circle at 50% 40%, ${person.avatar_color}66, #1e293b 75%)` }}>
          <Avatar name={person.name} color={person.avatar_color} profile={profile} size={56} />
        </div>
      )}
      <div className="absolute inset-x-1.5 bottom-1.5 flex items-center gap-1">
        <span className="min-w-0 truncate rounded-full bg-black/50 px-2 py-0.5 text-[11px] font-semibold text-white">
          {local ? "You" : person.name}
          {!local && !connected && " · connecting…"}
        </span>
        {person.muted && <MicOff className="h-3.5 w-3.5 shrink-0 rounded-full bg-black/50 p-0.5 text-white" />}
        {person.hand && <span className="shrink-0 text-[14px]">✋</span>}
      </div>
    </div>
  );
}

export function MeetingScreen({ manager, peers, profiles, onOpenChat }: { manager: PhoneMeeting; peers: Peer[]; profiles: Record<string, Profile>; onOpenChat?: (conv: string) => void }) {
  const st = useSyncExternalStore(manager.subscribe, manager.snapshot, manager.snapshot);
  const [panel, setPanel] = useState<"chat" | "invite" | null>(null);
  const [text, setText] = useState("");
  const [, setTick] = useState(0);
  const joinedAt = useRef<number | null>(null);
  const chatEnd = useRef<HTMLDivElement | null>(null);

  const active = st?.status === "active";
  useEffect(() => {
    if (!active) {
      joinedAt.current = null;
      setPanel(null);
      return;
    }
    joinedAt.current = joinedAt.current ?? Date.now();
    const t = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [active]);
  useEffect(() => {
    manager.chatOpen = panel === "chat";
    if (panel === "chat") {
      manager.clearUnread();
      chatEnd.current?.scrollIntoView({ block: "end" });
    }
  }, [panel, st?.meeting.chat.length, manager]);

  if (!st) return null;
  const m = st.meeting;
  const who = m.private ? "A colleague" : m.inviter_name || "Someone";

  // The meeting is in LANX on the PC: a bar, nothing more.
  if (st.status === "pc")
    return (
      <div className="fixed inset-x-2 top-[calc(env(safe-area-inset-top)+6px)] z-[80] flex items-center gap-2 rounded-2xl bg-emerald-600 px-3 py-2 text-white shadow-xl lanx-rise" data-ph-meeting-status="pc">
        <Users className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">In a meeting on your PC{m.private ? "" : ` · ${m.title}`}</span>
        <button type="button" onClick={() => manager.dismiss()} className="rounded-full p-1" aria-label="Hide">
          <X className="h-4 w-4" />
        </button>
      </div>
    );

  if (st.status === "invited")
    return (
      <div className="fixed inset-x-2 top-[calc(env(safe-area-inset-top)+6px)] z-[80] rounded-2xl bg-slate-900 p-3 text-white shadow-2xl lanx-rise" data-ph-meeting-status="invited">
        <div className="flex items-center gap-2.5">
          <span className="lanx-call-pulse rounded-full">
            <Avatar name={who} color={m.inviter_color} profile={m.private ? null : profiles[m.inviter_id] ?? null} size={40} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-bold">{m.private ? "Meeting invitation" : m.title || "Meeting"}</div>
            <div className="truncate text-[12px] text-white/75">
              {who} invites you · {m.video ? "video" : "voice"} meeting
            </div>
          </div>
        </div>
        {!canMeet() && <div className="mt-2 rounded-xl bg-white/10 px-2.5 py-1.5 text-[11.5px] text-white/85">Joining on the phone needs the secure connection (More → Secure connection). Join on your PC, or decline here.</div>}
        <div className="mt-2.5 flex gap-2">
          <button type="button" data-ph-meeting-decline onClick={() => void manager.decline()} className="flex-1 rounded-full bg-red-500 py-2 text-[13px] font-semibold">
            Decline
          </button>
          {canMeet() && (
            <>
              <button type="button" data-ph-meeting-join-voice onClick={() => void manager.join(false)} className="flex-1 rounded-full bg-white/15 py-2 text-[13px] font-semibold">
                Voice
              </button>
              <button type="button" data-ph-meeting-join onClick={() => void manager.join(true)} className="flex-1 rounded-full bg-emerald-500 py-2 text-[13px] font-semibold">
                Join
              </button>
            </>
          )}
        </div>
      </div>
    );

  if (st.status === "joining")
    return (
      <div className="fixed inset-0 z-[90] flex flex-col items-center justify-center gap-3 bg-slate-900 text-white" data-ph-meeting-status="joining">
        <span className="h-10 w-10 animate-spin rounded-full border-2 border-white/20 border-t-white" />
        <p className="text-[14px] text-white/80">Joining the meeting…</p>
      </div>
    );

  const me = m.people.find((p) => p.is_me) ?? { device_id: m.my_id, name: "You", avatar_color: "#64748b", muted: st.muted, camera: st.camera, screen: false, hand: st.hand, recording: false, is_me: true };
  const others = m.people.filter((p) => !p.is_me);
  const all = [{ ...me, muted: st.muted, camera: st.camera, hand: st.hand }, ...others];
  const cols = all.length <= 1 ? 1 : all.length <= 4 ? 2 : 3;
  const invitable = peers.filter((p) => p.status === "online" && p.trust_state !== "blocked" && !p.id.startsWith("manual-") && !m.people.some((x) => x.device_id === p.id));
  const recording = m.people.some((p) => p.recording);

  return (
    <div className="fixed inset-0 z-[90] flex flex-col bg-slate-950 text-white" data-ph-meeting-status="active" data-ph-meeting={m.meeting_id} data-ph-meeting-people={m.people.length}>
      <header className="flex shrink-0 items-center gap-2 px-3 pb-2 pt-[calc(env(safe-area-inset-top)+8px)]">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-bold">{m.private ? "Meeting" : m.title || "Meeting"}</div>
          <div className="text-[11.5px] text-white/70" data-ph-meeting-line>
            {m.people.length} in the meeting · {clock(Date.now() - (joinedAt.current ?? Date.now()))}
            {recording && " · 🔴 recording"}
          </div>
        </div>
        {onOpenChat && m.conversation_id && (
          <button type="button" onClick={() => onOpenChat(m.conversation_id)} className="rounded-full bg-white/10 px-3 py-1.5 text-[12px] font-semibold">
            Group chat
          </button>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-2">
        <div className="grid h-full gap-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridAutoRows: all.length <= 2 ? "minmax(0, 1fr)" : "minmax(150px, 1fr)" }}>
          {all.map((p) => (
            <Tile
              key={p.device_id}
              person={p}
              local={p.is_me}
              stream={p.is_me ? manager.localStream : manager.streamOf(p.device_id)}
              connected={p.is_me || manager.isConnected(p.device_id)}
              profile={p.is_me ? null : profiles[p.device_id] ?? null}
              facing={st.facing}
              version={st.version}
            />
          ))}
        </div>
        {others.length === 0 && <div className="py-3 text-center text-[12.5px] text-white/60">Waiting for the others to join…</div>}
      </div>

      {panel && (
        <div className="absolute inset-x-0 bottom-0 top-[30%] z-30 flex flex-col rounded-t-3xl bg-slate-900 shadow-2xl lanx-rise" data-ph-meeting-panel={panel}>
          <div className="flex items-center justify-between px-4 py-3">
            <div className="text-[14px] font-bold">{panel === "chat" ? "Meeting chat" : "Invite to the meeting"}</div>
            <button type="button" onClick={() => setPanel(null)} className="rounded-full p-1.5 text-white/70" aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          </div>
          {panel === "chat" ? (
            <>
              <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-4 ph-select" data-ph-meeting-chat={m.chat.length}>
                {m.chat.length === 0 && <div className="py-6 text-center text-[12.5px] text-white/50">Nothing said yet.</div>}
                {m.chat.map((l, i) =>
                  l.from ? (
                    <div key={i} className="text-[13px]">
                      <span className="font-semibold text-sky-300">{l.from === m.my_id ? "You" : l.name}</span> <span className="text-white/90">{l.text}</span>
                    </div>
                  ) : (
                    <div key={i} className="text-center text-[11.5px] text-white/50">
                      {l.text}
                    </div>
                  )
                )}
                <div ref={chatEnd} />
              </div>
              <form
                className="flex items-center gap-2 px-3 pb-[calc(env(safe-area-inset-bottom)+10px)] pt-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const t = text.trim();
                  if (!t) return;
                  void manager.chat(t).then((sent) => sent && setText(""));
                }}
              >
                <input data-ph-meeting-chat-text value={text} onChange={(e) => setText(e.target.value)} placeholder="Message everyone" className="min-w-0 flex-1 rounded-full bg-white/10 px-4 py-2 text-[15px] text-white placeholder:text-white/40 focus:outline-none" />
                <button type="submit" data-ph-meeting-chat-send className="flex h-9 w-9 items-center justify-center rounded-full bg-sky-500" aria-label="Send">
                  <Send className="h-4 w-4" />
                </button>
              </form>
            </>
          ) : (
            <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-3 pb-[calc(env(safe-area-inset-bottom)+10px)]">
              {invitable.length === 0 && <div className="py-6 text-center text-[12.5px] text-white/50">Everyone online is already here.</div>}
              {invitable.map((p) => (
                <button key={p.id} type="button" data-ph-meeting-invite={p.display_name} onClick={() => void manager.invite([p.id])} className="flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left active:bg-white/10">
                  <Avatar name={p.display_name} color={p.avatar_color} profile={profiles[p.id]} size={34} />
                  <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{p.display_name}</span>
                  <span className="text-[12px] font-semibold text-sky-300">Invite</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="relative z-20 flex shrink-0 items-center justify-center gap-3 px-3 pb-[calc(env(safe-area-inset-bottom)+14px)] pt-3">
        <Ctl label={st.muted ? "Unmute" : "Mute"} hook="mute" on={st.muted} onClick={() => manager.toggleMute()}>
          {st.muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
        </Ctl>
        <Ctl label={st.camera ? "Camera off" : "Camera on"} hook="camera" on={st.camera} onClick={() => void manager.toggleCamera()}>
          {st.camera ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
        </Ctl>
        {st.camera && (
          <Ctl label="Switch camera" hook="flip" onClick={() => void manager.flipCamera()}>
            <RefreshCw className="h-5 w-5" />
          </Ctl>
        )}
        <Ctl label={st.hand ? "Lower hand" : "Raise hand"} hook="hand" on={st.hand} onClick={() => manager.toggleHand()}>
          <Hand className="h-5 w-5" />
        </Ctl>
        <Ctl label="Chat" hook="chat" on={panel === "chat"} badge={panel === "chat" ? 0 : st.unread} onClick={() => setPanel(panel === "chat" ? null : "chat")}>
          <MessageSquare className="h-5 w-5" />
        </Ctl>
        <Ctl label="Invite" hook="invite" on={panel === "invite"} onClick={() => setPanel(panel === "invite" ? null : "invite")}>
          <UserPlus className="h-5 w-5" />
        </Ctl>
        {recordingSupported() && (
          <Ctl label={st.recording ? "Stop recording" : "Record"} hook="record" on={st.recording} onClick={() => void (st.recording ? manager.stopRecording() : manager.startRecording())}>
            {st.recording ? <Square className="h-4 w-4 text-red-500" /> : <Circle className="h-5 w-5" />}
          </Ctl>
        )}
        <Ctl label="Leave" hook="leave" tone="red" onClick={() => void manager.leave()}>
          <PhoneOff className="h-5 w-5" />
        </Ctl>
      </div>
    </div>
  );
}
