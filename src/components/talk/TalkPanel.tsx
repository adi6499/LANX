import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { BellOff, Mic, Play, Radio, Users, UsersRound, Volume2 } from "lucide-react";
import { api } from "../../lib/api";
import { IS_WINDOWS } from "../../lib/platform";
import { chooseTalkKeys, press, pressTest, release, replay, setTalkPrefs, talkStore, toggleMuted, type TalkRefusal } from "../../lib/talk";
import { comboFromEvent, hotkeyLabel } from "../../lib/voice";
import type { Conversation, Peer } from "../../types";
import { Sheet } from "../together/common";

/** LANX 3.15.0: the walkie-talkie's screen. Choose a channel on the left (everyone, a
 *  group, one colleague), hold the big button (or the space bar) and talk: they hear you
 *  while you are still talking. One voice at a time. */

interface Channel {
  key: string;
  name: string;
  kind: "all" | "group" | "peer";
  /** Who would hear it now (device ids). */
  targets: string[];
  hint: string;
  color?: string;
  online: boolean;
}

const WHY: Record<TalkRefusal["why"], string> = {
  old: "needs a newer LANX",
  off: "has the walkie-talkie switched off",
  muted: "has muted this channel",
  locked: "LANX is locked there",
  busy: "is hearing someone else",
  call: "is in a call",
  dnd: "has “Do not disturb” on",
  unreachable: "could not be reached",
  group: "is not in this group",
  other: "could not take it",
};

/** Two letters for a name: "Marcus (Stores)" → "MS". */
const initials = (name: string) => {
  const words = name
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+/u, ""))
    .filter(Boolean);
  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? "")).toUpperCase() || "?";
};

/** The button keeps the pointer while it is held, so letting go outside it still counts. */
const keepPointer = (e: React.PointerEvent<HTMLButtonElement>) => {
  try {
    e.currentTarget.setPointerCapture(e.pointerId);
  } catch {
    // (No such pointer any more: the hold still works, only "let go outside" does not.)
  }
};

const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;

export function TalkPanel({ peers, conversations, initialChannel, onClose }: { peers: Peer[]; conversations: Conversation[]; initialChannel?: string; onClose: () => void }) {
  const t = useSyncExternalStore(talkStore.subscribe, talkStore.get, talkStore.get);
  const [picked, setPicked] = useState(initialChannel || t.prefs.channel || "all");
  const [members, setMembers] = useState<Record<string, string[]>>({});
  const [, tick] = useState(0);
  /** The talk key: can this LANX have one, and does Windows give it the keys? */
  const [keyInfo, setKeyInfo] = useState<{ available: boolean; working: boolean } | null>(null);
  /** "Change" pressed: the next key press becomes the talk key. */
  const [capturing, setCapturing] = useState(false);
  const [keyNote, setKeyNote] = useState("");
  const readKey = useCallback(() => void api.talkKeyState().then(setKeyInfo).catch(() => setKeyInfo({ available: false, working: false })), []);
  useEffect(() => {
    readKey();
  }, [readKey]);
  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") return setCapturing(false);
      const k = comboFromEvent(e);
      if (!k) return; // Ctrl, Alt or Shift alone, or a key that needs one of them
      setCapturing(false);
      void chooseTalkKeys(k).then((ok) => {
        setKeyNote(ok ? "" : `${hotkeyLabel(k)} is already used by another program. Choose different keys.`);
        readKey();
      });
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [capturing, readKey]);

  const online = useMemo(() => peers.filter((p) => p.status === "online" && p.trust_state !== "blocked"), [peers]);
  const groups = useMemo(() => conversations.filter((c) => c.kind === "group" && c.membership === "member"), [conversations]);

  // Who is in each group (asked once per group; who is online changes with `peers`).
  useEffect(() => {
    let alive = true;
    for (const g of groups) {
      if (members[g.id]) continue;
      void api
        .getGroup(g.id)
        .then((info) => alive && info && setMembers((m) => ({ ...m, [g.id]: info.members.filter((x) => !x.is_me).map((x) => x.device_id) })))
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
  }, [groups, members]);

  const channels: Channel[] = useMemo(() => {
    const onlineIds = new Set(online.map((p) => p.id));
    const list: Channel[] = [{ key: "all", name: "Everyone", kind: "all", targets: online.map((p) => p.id), hint: online.length ? `${online.length} online` : "nobody online", online: online.length > 0 }];
    for (const g of groups) {
      const ids = (members[g.id] ?? []).filter((id) => onlineIds.has(id));
      list.push({ key: `group:${g.id}`, name: g.peer_name, kind: "group", targets: ids, hint: ids.length ? `${ids.length} online` : "nobody online", color: g.peer_avatar_color, online: ids.length > 0 });
    }
    const people = peers.filter((p) => p.trust_state !== "blocked").sort((a, b) => Number(b.status === "online") - Number(a.status === "online") || a.display_name.localeCompare(b.display_name));
    for (const p of people) list.push({ key: `peer:${p.id}`, name: p.display_name, kind: "peer", targets: p.status === "online" ? [p.id] : [], hint: p.status === "online" ? "online" : "offline", color: p.avatar_color, online: p.status === "online" });
    return list;
  }, [online, groups, members, peers]);

  const channel = channels.find((c) => c.key === picked) ?? channels[0];
  const pick = (key: string) => {
    setPicked(key);
    setTalkPrefs({ channel: key });
  };

  // A colleague starts talking: their channel comes to the front (to answer with one press).
  const hearingChannel = t.hearing?.channel;
  useEffect(() => {
    if (hearingChannel && channels.some((c) => c.key === hearingChannel)) setPicked(hearingChannel);
  }, [hearingChannel]); // eslint-disable-line react-hooks/exhaustive-deps

  // The seconds while talking or hearing.
  const busy = !!(t.talking || t.hearing);
  useEffect(() => {
    if (!busy) return;
    const id = window.setInterval(() => tick((n) => n + 1), 250);
    return () => window.clearInterval(id);
  }, [busy]);

  const down = useCallback(() => void press(channel.key, channel.targets, channel.name), [channel]);
  const up = useCallback(() => void release(), []);

  // The space bar is the button too (not while typing somewhere).
  const held = useRef(false);
  useEffect(() => {
    const typing = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
    };
    const onDown = (e: KeyboardEvent) => {
      if (e.code !== "Space" || typing(e) || capturing) return;
      e.preventDefault();
      if (e.repeat || held.current) return;
      held.current = true;
      down();
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.code !== "Space" || !held.current) return;
      e.preventDefault();
      held.current = false;
      up();
    };
    const onBlur = () => {
      if (held.current) {
        held.current = false;
        up();
      }
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [down, up, capturing]);
  // Closing the screen while holding lets go.
  useEffect(() => () => void release(), []);

  const talking = t.talking && !t.talking.test ? t.talking : null;
  const testing = !!t.talking?.test;
  const hearing = t.hearing;
  const note = t.note && Date.now() - t.noteAt < 6000 ? t.note : "";
  const level = talking?.level ?? hearing?.level ?? (testing ? t.talking?.level ?? 0 : 0);
  const muted = t.prefs.muted.includes(channel.key);

  let line = "Hold the button (or the space bar) and talk.";
  let sub = channel.online ? `${channel.kind === "peer" ? channel.name : channel.targets.length === 1 ? "1 colleague" : `${channel.targets.length} colleagues`} will hear you.` : "Nobody on this channel is online right now.";
  if (hearing) {
    line = `${hearing.fromName} is talking`;
    sub = hearing.silent ? "Click anywhere in LANX to hear the walkie-talkie. This one is kept below to play again." : clock(Date.now() - hearing.since);
  } else if (talking) {
    line = talking.phase === "opening" ? "One moment…" : `Talking to ${talking.label}`;
    sub = talking.phase === "opening" ? "Their PCs are answering." : `${talking.listeners === 1 ? "1 colleague hears" : `${talking.listeners} colleagues hear`} you · ${clock(Date.now() - talking.since)}`;
  } else if (testing) {
    line = "Microphone test";
    sub = "Talk, then let go: it is played back to you. Nobody else hears it.";
  } else if (note) {
    sub = note;
  }

  return (
    <Sheet title="Walkie-talkie" subtitle="Hold to talk. Colleagues hear you while you are still talking." icon={<Radio className="h-5 w-5" />} onClose={onClose} wide tag="talk">
      <div data-talk-panel className="flex gap-4" style={{ height: "min(510px, 72vh)" }}>
        {/* the channels */}
        <div className="flex w-[250px] shrink-0 flex-col overflow-hidden rounded-[16px] bg-[var(--lanx-fill)] p-1.5">
          <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-0.5">
            {channels.map((c) => {
              const on = c.key === channel.key;
              const live = hearing?.channel === c.key;
              return (
                <button
                  key={c.key}
                  type="button"
                  data-talk-channel={c.key}
                  data-on={on ? "yes" : "no"}
                  onClick={() => pick(c.key)}
                  className={`flex w-full items-center gap-2.5 rounded-[12px] px-2.5 py-2 text-left ${on ? "bg-white shadow-sm dark:bg-white/10" : "hover:bg-black/5 dark:hover:bg-white/5"} ${c.online ? "" : "opacity-55"}`}
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white" style={{ background: c.kind === "all" ? "#0ea5e9" : c.color || "#64748b" }}>
                    {c.kind === "all" ? <Users className="h-4 w-4" /> : c.kind === "group" ? <UsersRound className="h-4 w-4" /> : initials(c.name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold text-slate-800 dark:text-slate-100">{c.name}</span>
                    <span className={`block truncate text-[11px] ${live ? "font-semibold text-emerald-600 dark:text-emerald-400" : "text-slate-500"}`}>{live ? "talking now" : c.hint}</span>
                  </span>
                  {t.prefs.muted.includes(c.key) && <BellOff className="h-3.5 w-3.5 shrink-0 text-slate-400" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* the button */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div data-talk-channel-name className="truncate text-[15px] font-bold text-slate-900 dark:text-white">{channel.name}</div>
              <div className="text-[11.5px] text-slate-500">{channel.kind === "all" ? "Every colleague who is online" : channel.kind === "group" ? "The members of this group who are online" : "Only this colleague"}</div>
            </div>
            <button type="button" data-talk-mute data-on={muted ? "yes" : "no"} onClick={() => toggleMuted(channel.key)} title={muted ? "You don't hear this channel. Click to hear it again." : "Stop hearing this channel"} className={`flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--lanx-line)] px-3 py-1.5 text-[12px] font-semibold ${muted ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" : "text-slate-600 hover:bg-[var(--lanx-fill)] dark:text-slate-300"}`}>
              <BellOff className="h-3.5 w-3.5" /> {muted ? "Muted" : "Mute"}
            </button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3">
            <button
              type="button"
              data-talk-button
              data-state={hearing ? "hearing" : talking ? talking.phase : "idle"}
              disabled={!!hearing || testing || !t.prefs.on}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                keepPointer(e);
                down();
              }}
              onPointerUp={up}
              onPointerCancel={up}
              onLostPointerCapture={up}
              onContextMenu={(e) => e.preventDefault()}
              className={`relative flex h-[150px] w-[150px] select-none flex-col items-center justify-center gap-1.5 rounded-full text-white transition-transform disabled:opacity-50 ${talking ? "scale-[1.04] bg-rose-500" : hearing ? "bg-emerald-500" : "bg-sky-500 hover:bg-sky-600 active:scale-[1.04]"}`}
              style={{ touchAction: "none" }}
            >
              {hearing ? <Volume2 className="h-9 w-9" /> : <Mic className="h-9 w-9" />}
              <span className="text-[12.5px] font-bold">{hearing ? "Listening" : talking ? (talking.phase === "live" ? "Talking" : "…") : "Hold to talk"}</span>
              {/* how loud it is: a plain ring that grows a little */}
              <span aria-hidden className="pointer-events-none absolute inset-0 rounded-full" style={{ boxShadow: `0 0 0 ${Math.round(level * 16)}px ${talking ? "rgba(244, 63, 94, 0.22)" : "rgba(16, 185, 129, 0.22)"}`, transition: "box-shadow 90ms linear", opacity: talking || hearing || testing ? 1 : 0 }} />
            </button>
            <div className="text-center">
              <div data-talk-line className="text-[14px] font-bold text-slate-900 dark:text-white">{line}</div>
              <div data-talk-sub className="mt-0.5 min-h-[18px] text-[12px] text-slate-500">{sub}</div>
              {talking && talking.refused.length > 0 && (
                <div data-talk-refused className="mx-auto mt-1 max-w-[420px] text-[11.5px] text-amber-700 dark:text-amber-300">
                  {talking.refused.slice(0, 3).map((r) => `${r.name} ${r.why === "busy" && r.who ? `is hearing ${r.who}` : WHY[r.why]}`).join(" · ")}
                  {talking.refused.length > 3 ? ` · and ${talking.refused.length - 3} more` : ""}
                </div>
              )}
            </div>
          </div>

          {/* heard lately */}
          {t.clips.length > 0 && (
            <div data-talk-clips className="mb-2 max-h-[84px] space-y-0.5 overflow-y-auto">
              {t.clips.map((c) => (
                <div key={c.id} className="flex items-center gap-2 rounded-[10px] px-2 py-1 text-[12px] text-slate-600 dark:text-slate-300">
                  <button type="button" data-talk-replay={c.id} onClick={() => replay(c.id)} disabled={busy} title="Play it again" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--lanx-fill)] text-slate-700 disabled:opacity-40 dark:text-slate-200">
                    <Play className="h-3 w-3" />
                  </button>
                  <span className="min-w-0 flex-1 truncate">
                    <b className={c.heard ? "font-semibold" : "font-bold text-sky-600 dark:text-sky-400"}>{c.fromName}</b> · {channels.find((x) => x.key === c.channel)?.name ?? "walkie-talkie"} · {new Date(c.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · {Math.max(1, Math.round(c.ms / 1000))} s{c.heard ? "" : " · not heard yet"}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* the choices */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--lanx-line)] pt-3 text-[12px] text-slate-600 dark:text-slate-300">
            <label className="flex cursor-pointer items-center gap-2">
              <input data-talk-on type="checkbox" checked={t.prefs.on} onChange={(e) => setTalkPrefs({ on: e.target.checked })} className="h-4 w-4 accent-sky-500" />
              Hear colleagues on the walkie-talkie
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input data-talk-tones type="checkbox" checked={t.prefs.tones} onChange={(e) => setTalkPrefs({ tones: e.target.checked })} className="h-4 w-4 accent-sky-500" />
              Tones
            </label>
            <label className="flex items-center gap-2">
              <Volume2 className="h-3.5 w-3.5" />
              <input data-talk-volume type="range" min={0} max={150} value={Math.round(t.prefs.volume * 100)} onChange={(e) => setTalkPrefs({ volume: Number(e.target.value) / 100 })} className="w-[110px]" />
            </label>
            <button
              type="button"
              data-talk-test
              disabled={!!talking || !!hearing}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                keepPointer(e);
                void pressTest();
              }}
              onPointerUp={up}
              onPointerCancel={up}
              onLostPointerCapture={up}
              className="ml-auto rounded-full border border-[var(--lanx-line)] px-3 py-1.5 font-semibold hover:bg-[var(--lanx-fill)] disabled:opacity-40"
              style={{ touchAction: "none" }}
            >
              {testing ? "Let go to hear it" : "Hold to test my microphone"}
            </button>
          </div>

          {/* the talk key */}
          <div data-talk-key-row data-working={keyInfo?.available ? (t.prefs.on && t.prefs.key && keyInfo.working ? "yes" : "no") : "none"} className="mt-2 flex min-h-[24px] flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-slate-600 dark:text-slate-300">
            {keyInfo?.available ? (
              <>
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    data-talk-key-on
                    type="checkbox"
                    checked={t.prefs.key}
                    disabled={!t.prefs.on}
                    onChange={(e) => {
                      setTalkPrefs({ key: e.target.checked });
                      setKeyNote("");
                      window.setTimeout(readKey, 350);
                    }}
                    className="h-4 w-4 accent-sky-500"
                  />
                  Talk key
                </label>
                <kbd data-talk-key className="rounded-[7px] border border-[var(--lanx-line)] bg-[var(--lanx-fill)] px-2 py-0.5 font-sans text-[11.5px] font-semibold text-slate-800 dark:text-slate-100">{capturing ? "Press the keys…" : hotkeyLabel(t.prefs.keys)}</kbd>
                <button type="button" data-talk-key-change disabled={!t.prefs.on} onClick={() => setCapturing((c) => !c)} className="font-semibold text-sky-600 hover:underline disabled:opacity-40 dark:text-sky-400">
                  {capturing ? "Cancel" : "Change"}
                </button>
                <span data-talk-key-note className={keyNote || (t.prefs.on && t.prefs.key && !keyInfo.working) ? "text-amber-700 dark:text-amber-300" : "text-slate-500"}>
                  {keyNote || (!t.prefs.on || !t.prefs.key ? "Off." : keyInfo.working ? "Hold it in any program to talk, let go to stop. It answers whoever talked last, otherwise it talks on the channel chosen here." : "Another program is using these keys. Choose different ones.")}
                </span>
              </>
            ) : keyInfo ? (
              <span data-talk-key-note className="text-slate-500">While this screen is open the space bar is the button too.{IS_WINDOWS ? "" : " A key that works from other programs is in LANX for Windows."}</span>
            ) : null}
          </div>
        </div>
      </div>
    </Sheet>
  );
}
