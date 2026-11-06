/** LANX 3.5.0: carrying out a spoken command. Answers with a few words for
 *  the little note at the bottom ("Calling Bharat…"). */
import { api, errorText } from "../../lib/api";
import { player, searchSongs } from "../../lib/music";
import { type Intent, type TabId, type ToolId, bestMatch } from "../../lib/gestures/commands";
import type { Conversation, Message, Peer } from "../../types";
import type { CallLayerHandle, IslandCall } from "../CallLayer";
import type { IslandMeeting, MeetingLayerHandle } from "../MeetingLayer";

export interface IntentContext {
  peers: Peer[];
  conversations: Conversation[];
  activeConversationId: string | null;
  messages: Message[];
  call: IslandCall | null;
  meeting: IslandMeeting | null;
  callLayer: CallLayerHandle | null;
  meetingLayer: MeetingLayerHandle | null;
  openConversation: (c: Conversation) => void;
  send: (conversationId: string, text: string) => Promise<void>;
  updateMessage: (m: Message) => void;
  setTab: (t: TabId) => void;
  open: (what: ToolId) => void;
  setTheme: (t: "dark" | "light" | "system") => void;
  search: (q: string) => void;
  note: (text: string) => void;
  gesturesOff: () => void;
  /** Closes the window on top; false when none is open. */
  close: () => boolean;
}

const TOOL_NAMES: Record<ToolId, string> = {
  music: "Music", notes: "Notes", calendar: "the calendar", games: "Games", calculator: "the calculator", pdf: "PDF tools", memes: "Memes",
  settings: "Settings", voice: "Voice settings", gestures: "Gesture settings", organiser: "the Organiser", starred: "Starred messages", "help-desk": "the IT help desk",
};
const TAB_NAMES: Record<TabId, string> = { messages: "your chats", people: "who's in", transfers: "your files", history: "the history" };
const first = (name: string) => name.replace(/\s*\(.*\)\s*$/, "").split(/\s+/)[0] || name;

/** A person (their direct chat) or a group, by the name that was said. */
async function chatFor(who: string, ctx: IntentContext): Promise<Conversation | null> {
  const groups = ctx.conversations.filter((c) => c.kind === "group" && c.membership !== "left" && c.membership !== "removed");
  const peer = bestMatch(who, ctx.peers.filter((p) => p.trust_state !== "blocked"), (p) => p.display_name);
  const group = bestMatch(who, groups, (c) => c.peer_name);
  if (group && (!peer || group.peer_name.toLowerCase().includes(who.toLowerCase()))) return group;
  if (!peer) {
    const direct = bestMatch(who, ctx.conversations.filter((c) => c.kind === "direct"), (c) => c.peer_name);
    return direct ?? group;
  }
  const existing = ctx.conversations.find((c) => c.kind === "direct" && c.peer_id === peer.id);
  return existing ?? (await api.getOrCreateConversation(peer.id));
}

/** The biggest list on screen that can scroll (the chat, mostly). */
function mainScroller(): Element | null {
  let best: Element | null = null;
  let area = 0;
  for (const el of document.querySelectorAll("div, main, section, ul")) {
    if (el.closest("[data-gesture-ui]")) continue;
    if (el.scrollHeight <= el.clientHeight + 4) continue;
    const s = getComputedStyle(el);
    if (!/(auto|scroll)/.test(s.overflowY)) continue;
    const r = el.getBoundingClientRect();
    const a = r.width * r.height;
    if (a > area) {
      area = a;
      best = el;
    }
  }
  return best;
}

export async function runIntent(intent: Intent, ctx: IntentContext): Promise<string> {
  const notFound = (who: string) => `I couldn't find “${who}” in your contacts.`;
  try {
    switch (intent.kind) {
      case "call": {
        const conv = await chatFor(intent.who, ctx);
        if (!conv) return notFound(intent.who);
        ctx.openConversation(conv);
        if (conv.kind === "group") {
          ctx.meetingLayer?.start(conv, intent.video);
          return `Starting a meeting in ${conv.peer_name}…`;
        }
        ctx.callLayer?.start(conv, intent.video);
        return `${intent.video ? "Video calling" : "Calling"} ${first(conv.peer_name)}…`;
      }
      case "message": {
        const conv = await chatFor(intent.who, ctx);
        if (!conv) return notFound(intent.who);
        ctx.openConversation(conv);
        if (!intent.text.trim()) return `Opened ${first(conv.peer_name)} — what should I write? Say it again with the words.`;
        await ctx.send(conv.id, intent.text.trim());
        return `Sent to ${first(conv.peer_name)}: “${intent.text.trim()}”`;
      }
      case "open-chat": {
        const conv = await chatFor(intent.who, ctx);
        if (!conv) return notFound(intent.who);
        ctx.openConversation(conv);
        return `Opened ${conv.peer_name}`;
      }
      case "open":
        ctx.open(intent.what);
        return `Opened ${TOOL_NAMES[intent.what]}`;
      case "tab":
        ctx.setTab(intent.tab);
        return `Showing ${TAB_NAMES[intent.tab]}`;
      case "music": {
        const ps = player.state();
        switch (intent.action) {
          case "play": {
            if (intent.query) {
              const songs = await searchSongs(intent.query, 12);
              if (!songs.length) return `No song found for “${intent.query}”.`;
              await player.play(songs[0], songs);
              return `Playing ${songs[0].title} — ${songs[0].artist}`;
            }
            if (ps.song) {
              if (!ps.playing) player.toggle();
              return `Playing ${ps.song.title}`;
            }
            ctx.open("music");
            return "Opened Music — say “play” and a song name";
          }
          case "pause":
            if (!ps.song) return "Nothing is playing.";
            if (ps.playing) player.toggle();
            return "Paused";
          case "stop":
            player.stop();
            return "Stopped";
          case "next":
            if (!ps.song) return "Nothing is playing.";
            player.next();
            return "Next song";
          case "prev":
            if (!ps.song) return "Nothing is playing.";
            player.prev();
            return "Previous song";
          case "louder":
          case "quieter": {
            const v = Math.min(1, Math.max(0, ps.volume + (intent.action === "louder" ? 0.15 : -0.15)));
            player.setVolume(v);
            return `Volume ${Math.round(v * 100)}%`;
          }
        }
        return "Done";
      }
      case "call-control": {
        const a = intent.action;
        if (a === "answer" || a === "answer-video") {
          if (ctx.call?.status === "incoming") {
            ctx.callLayer?.accept(a === "answer-video" || ctx.call.video);
            return `Answered ${first(ctx.call.name)}`;
          }
          if (ctx.meeting?.status === "invited") {
            ctx.meetingLayer?.join(a === "answer-video" || ctx.meeting.video);
            return "Joining the meeting…";
          }
          return "Nothing is ringing.";
        }
        if (a === "decline") {
          if (ctx.call?.status === "incoming") {
            ctx.callLayer?.decline();
            return "Declined";
          }
          if (ctx.meeting?.status === "invited") {
            ctx.meetingLayer?.decline();
            return "Declined the meeting";
          }
          return "Nothing is ringing.";
        }
        if (a === "hangup") {
          if (ctx.call) {
            ctx.callLayer?.hangup();
            return "Call ended";
          }
          if (ctx.meeting) {
            ctx.meetingLayer?.leave();
            return "Left the meeting";
          }
          return "There's no call right now.";
        }
        const mute = a === "mute" || a === "unmute";
        const on = a === "unmute" || a === "camera-on";
        const done = mute
          ? ctx.callLayer?.setMuted(a === "mute") || ctx.meetingLayer?.setMuted(a === "mute")
          : ctx.callLayer?.setCamera(on) || ctx.meetingLayer?.setCamera(on);
        if (!done) return "There's no call right now.";
        return mute ? (a === "mute" ? "Microphone off" : "Microphone on") : on ? "Camera on" : "Camera off";
      }
      case "hand":
        return ctx.meetingLayer?.setHand(intent.up) ? (intent.up ? "✋ Hand raised" : "Hand lowered") : "Raising a hand works in a meeting.";
      case "meeting": {
        const conv = intent.who ? await chatFor(intent.who, ctx) : ctx.conversations.find((c) => c.id === ctx.activeConversationId) ?? null;
        if (!conv) return intent.who ? notFound(intent.who) : "Open a chat first, or say who the meeting is with.";
        ctx.openConversation(conv);
        ctx.meetingLayer?.start(conv, intent.video);
        return `Starting a meeting with ${conv.kind === "group" ? conv.peer_name : first(conv.peer_name)}…`;
      }
      case "theme":
        ctx.setTheme(intent.theme);
        return intent.theme === "dark" ? "Dark mode" : intent.theme === "light" ? "Light mode" : "Following Windows";
      case "search":
        ctx.search(intent.query);
        return `Searching for “${intent.query}”`;
      case "note":
        ctx.note(intent.text);
        return intent.text ? "Note started" : "New note";
      case "react": {
        const msg = intent.messageId
          ? ctx.messages.find((m) => m.id === intent.messageId)
          : [...ctx.messages].reverse().find((m) => !m.deleted);
        if (!msg) return "Open a chat first.";
        ctx.updateMessage(await api.reactMessage(msg.id, intent.emoji));
        return `${intent.emoji} on the message`;
      }
      case "scroll": {
        const el = mainScroller();
        if (!el) return "Nothing to scroll.";
        const h = el.clientHeight * 0.8;
        const top = intent.dir === "top" ? -el.scrollHeight : intent.dir === "bottom" ? el.scrollHeight : intent.dir === "up" ? -h : h;
        el.scrollBy({ top, behavior: "smooth" });
        return intent.dir === "top" ? "To the top" : intent.dir === "bottom" ? "To the bottom" : `Scrolled ${intent.dir}`;
      }
      case "back": {
        if (ctx.close()) return "Closed";
        const el = document.activeElement instanceof HTMLElement ? document.activeElement : document.body;
        el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
        return "Closed";
      }
      case "gestures-off":
        ctx.gesturesOff();
        return "Gestures off — the camera has stopped";
      case "help":
        ctx.open("gestures");
        return "Here's what you can do";
      case "unknown":
        return "I didn't understand that. Try “call Bharat”, “play music” or “open notes”.";
      default:
        // LANX 3.7.0: the keyboard, keys, typing, the PC itself — done by the gesture layer.
        return "Turn on hand gestures for that.";
    }
  } catch (e) {
    return errorText(e);
  }
}
