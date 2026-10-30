/** LANX 3.x phone page: one chat — messages, the composer, and (3.1) the
 *  message actions: reply, react, forward, star, pin, remind, edit, delete,
 *  stickers, quick replies, @mentions and "send later". */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlarmClock, ArrowLeft, ArrowUp, ClipboardCheck, ClipboardList, FolderUp, Clock, Copy, CornerUpLeft, Forward, Image as ImageIcon, Info, Laugh, MessageCircle, Mic, MoreVertical, Music2, Paperclip, Pencil, Phone, Pin, Plus, Radio, Smile, Star, StickyNote, Timer, Trash2, Video, X, Zap } from "lucide-react";
import type { Conversation, GroupInfo, Peer, Profile, ScheduledMessage } from "../types";
import { Avatar } from "../components/Avatar";
import { QUICK_REACTIONS, localInputValue, whenChoices, whenText, withoutForwardMark } from "../components/chat/chatUtils";
import { statusLine } from "../lib/profile";
import type { Me, PhoneClient, PhoneMessage, Progress, StickerInfo } from "./client";
import { type Recording, canRecord } from "./media";
import { Bubble, Sheet, SheetRow, coarsePointer, copyText, dayLabel, fileName } from "./parts";
import { RecordSheet } from "./RecordSheet";

/** Phones that can pick a whole folder in the browser (Android; not iPhone). */
const canPickFolder = () => !/iPhone|iPad|iPod/i.test(navigator.userAgent) && "webkitdirectory" in document.createElement("input");
import { secretShort } from "./extras";

export interface Upload {
  id: number;
  name: string;
  pct: number;
}

interface Mention {
  id: string;
  name: string;
}

const snippet = (m: PhoneMessage) => (m.message_type === "file" ? fileName(m) : m.message_type === "sticker" ? "Sticker" : m.content).slice(0, 80);

export function ChatView({
  conv,
  me,
  peers,
  profiles,
  messages,
  more,
  typing,
  uploads,
  progress,
  client,
  stickers,
  quickReplies,
  group,
  scheduledVersion,
  jumpTo,
  onBack,
  onOlder,
  onSend,
  onFiles,
  onTyping,
  onInfo,
  onForward,
  onChanged,
  onRemoved,
  onNotice,
  onProblem,
  onAccept,
  onCreateCard,
  onCall,
  onMeeting,
  onMakeTask,
  onSaveNote,
  onRejoinMeeting,
  onFolder,
  onMenu,
  onMemes,
  onMusic,
  secure,
  onVoice,
  onIntercom,
}: {
  conv: Conversation;
  me: Me | null;
  peers: Peer[];
  profiles: Record<string, Profile>;
  messages: PhoneMessage[];
  more: boolean;
  typing: string | null;
  uploads: Upload[];
  progress: Record<string, Progress>;
  client: PhoneClient;
  stickers: StickerInfo[];
  quickReplies: string[];
  group: GroupInfo | null;
  scheduledVersion: number;
  /** A message to scroll to once it is on screen (from search or starred). */
  jumpTo?: string;
  onBack: () => void;
  onOlder: () => void;
  onSend: (text: string, replyTo: string | null, mentions: string[]) => Promise<void>;
  onFiles: (files: FileList) => void;
  onTyping: () => void;
  onInfo: () => void;
  onForward: (m: PhoneMessage) => void;
  onChanged: (m: PhoneMessage) => void;
  onRemoved: (id: string) => void;
  onNotice: (text: string) => void;
  onProblem: (e: unknown) => void;
  onAccept: (transferId: string) => void;
  /** 3.2: a card (poll, task…) into this chat. */
  onCreateCard: () => void;
  /** 3.2: a voice or video call from the phone (one-to-one chats). */
  onCall: (video: boolean) => void;
  /** 3.4: a group's video meeting; a task or a note from a message; "Join again" on a meeting card. */
  onMeeting?: () => void;
  onMakeTask?: (m: PhoneMessage) => void;
  onSaveNote?: (m: PhoneMessage) => void;
  onRejoinMeeting?: (messageId: string) => void;
  /** 3.4: a whole folder (phones that can pick one: Android). */
  onFolder?: (files: File[]) => void;
  /** 3.3: ring, secret messages, hide this chat. */
  onMenu: () => void;
  /** 3.3: the meme picker / music player, sending into this chat. */
  onMemes: () => void;
  onMusic: () => void;
  /** 3.2: the page is served securely (microphone allowed). */
  secure: boolean;
  onVoice: (rec: Recording) => Promise<void>;
  onIntercom: (rec: Recording) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [recordMode, setRecordMode] = useState<"voice" | "intercom" | null>(null);
  const [reply, setReply] = useState<PhoneMessage | null>(null);
  const [editing, setEditing] = useState<PhoneMessage | null>(null);
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [actions, setActions] = useState<PhoneMessage | null>(null);
  const [plus, setPlus] = useState(false);
  const [stickersOpen, setStickersOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [laterOpen, setLaterOpen] = useState(false);
  const [remindFor, setRemindFor] = useState<PhoneMessage | null>(null);
  const [customAt, setCustomAt] = useState("");
  const [noReply, setNoReply] = useState(false);
  const [scheduled, setScheduled] = useState<ScheduledMessage[]>([]);
  const [showScheduled, setShowScheduled] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const boxRef = useRef<HTMLTextAreaElement | null>(null);
  const stick = useRef(true);
  const lastTyping = useRef(0);
  const isGroup = conv.kind === "group";
  const names = useMemo(() => peers.map((p) => p.display_name), [peers]);
  const nameOf = useCallback((id: string) => (id === me?.id ? me.name : peers.find((p) => p.id === id)?.display_name ?? "Someone"), [peers, me]);

  // Stay at the bottom while reading the latest; keep the place when loading older ones.
  const count = messages.length;
  const lastId = messages[count - 1]?.id;
  useEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [count, lastId, typing, uploads.length]);

  // Opened from search or starred: show that message.
  useEffect(() => {
    if (!jumpTo || !messages.some((m) => m.id === jumpTo)) return;
    stick.current = false;
    window.setTimeout(() => document.querySelector(`[data-ph-msg="${jumpTo}"]`)?.scrollIntoView({ block: "center" }), 50);
  }, [jumpTo, messages]);

  // "Send later" items of this chat.
  useEffect(() => {
    let on = true;
    client
      .scheduled(conv.id)
      .then((r) => on && setScheduled(r.items))
      .catch(() => {});
    return () => {
      on = false;
    };
  }, [client, conv.id, scheduledVersion]);

  const resize = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  };

  const mentionIds = (t: string) => mentions.filter((m) => t.includes(`@${m.name}`)).map((m) => m.id);

  const clearComposer = () => {
    setText("");
    setReply(null);
    setEditing(null);
    setMentions([]);
    setMentionQuery(null);
    if (boxRef.current) boxRef.current.style.height = "auto";
  };

  const submit = async () => {
    const t = text.trim();
    if (!t) return;
    if (editing) {
      const target = editing;
      clearComposer();
      try {
        const r = await client.edit(target.id, t, mentionIds(t));
        onChanged(r.message);
      } catch (e) {
        onProblem(e);
      }
      return;
    }
    const replyTo = reply?.id ?? null;
    const ids = mentionIds(t);
    clearComposer();
    stick.current = true;
    await onSend(t, replyTo, ids);
  };

  const onTextChange = (value: string, el: HTMLTextAreaElement) => {
    setText(value);
    resize(el);
    const now = Date.now();
    if (now - lastTyping.current > 2000 && value.trim()) {
      lastTyping.current = now;
      onTyping();
    }
    // "@" in a group: offer the members; "/" first: quick replies.
    if (isGroup) {
      const at = value.lastIndexOf("@");
      const query = at >= 0 && (at === 0 || /\s/.test(value[at - 1])) ? value.slice(at + 1) : null;
      setMentionQuery(query !== null && !/\s/.test(query) ? query : null);
    }
    setQuickOpen(value.startsWith("/") && !value.includes(" "));
  };

  const pickMention = (id: string, name: string) => {
    const at = text.lastIndexOf("@");
    const next = `${text.slice(0, at)}@${name} `;
    setText(next);
    setMentions((list) => (list.some((m) => m.id === id) ? list : [...list, { id, name }]));
    setMentionQuery(null);
    boxRef.current?.focus();
  };

  const members = group?.members.filter((m) => !m.is_me) ?? [];
  const mentionList = mentionQuery === null ? [] : members.filter((m) => m.display_name.toLowerCase().startsWith(mentionQuery.toLowerCase()));
  const quickList = quickOpen ? quickReplies.filter((q) => q.toLowerCase().includes(text.slice(1).toLowerCase())) : [];

  const run = (f: () => Promise<void>) => {
    f().catch(onProblem);
  };

  const react = (m: PhoneMessage, emoji: string) =>
    run(async () => {
      const r = await client.react(m.id, emoji);
      onChanged(r.message);
    });

  const act = (what: string, m: PhoneMessage) => {
    setActions(null);
    switch (what) {
      case "reply":
        setEditing(null);
        setReply(m);
        boxRef.current?.focus();
        break;
      case "forward":
        onForward(m);
        break;
      case "copy":
        onNotice(copyText(m.message_type === "file" ? fileName(m) : m.content) ? "Copied" : "Couldn't copy on this phone");
        break;
      case "task":
        onMakeTask?.(m);
        break;
      case "note":
        onSaveNote?.(m);
        break;
      case "whatsapp":
        window.open(`https://wa.me/?text=${encodeURIComponent(withoutForwardMark(m.content))}`, "_blank", "noopener");
        break;
      case "star":
        run(async () => onChanged((await client.star(m.id, !m.starred)).message));
        break;
      case "pin":
        run(async () => onChanged((await client.pin(m.id, !m.pinned_at)).message));
        break;
      case "remind":
        setNoReply(false);
        setCustomAt(localInputValue(Math.floor(Date.now() / 1000) + 3600));
        setRemindFor(m);
        break;
      case "cancel-remind":
        run(async () => onChanged((await client.cancelRemind(m.id)).message));
        break;
      case "edit":
        setReply(null);
        setEditing(m);
        setText(m.content);
        window.setTimeout(() => {
          boxRef.current?.focus();
          resize(boxRef.current);
        }, 50);
        break;
      case "delete-me":
        run(async () => {
          await client.delete(m.id, false);
          onRemoved(m.id);
        });
        break;
      case "delete-all":
        run(async () => {
          const r = await client.delete(m.id, true);
          if (r.message) onChanged(r.message);
        });
        break;
    }
  };

  const sendLater = (at: number) => {
    const t = text.trim();
    setLaterOpen(false);
    if (!t) {
      onNotice("Type the message first, then choose when to send it.");
      return;
    }
    const replyTo = reply?.id ?? null;
    const ids = mentionIds(t);
    run(async () => {
      await client.later(conv.id, t, at, replyTo, ids);
      clearComposer();
      setScheduled((await client.scheduled(conv.id)).items);
      onNotice(`Will be sent ${whenText(at)}.`);
    });
  };

  const setReminder = (m: PhoneMessage, at: number) => {
    setRemindFor(null);
    run(async () => {
      onChanged((await client.remind(m.id, at, noReply)).message);
      onNotice(`Reminder set for ${whenText(at)}.`);
    });
  };

  const customSecs = () => {
    const d = new Date(customAt);
    return Number.isNaN(d.getTime()) ? null : Math.floor(d.getTime() / 1000);
  };

  const pinned = [...messages].reverse().find((m) => m.pinned_at && !m.deleted);
  const subtitle = typing
    ? `${isGroup ? typing + " is " : ""}typing…`
    : isGroup
      ? `${conv.member_count} members`
      : conv.peer_status === "online"
        ? statusLine(profiles[conv.peer_id], { until: true })?.text ?? "Online"
        : "Offline";

  let lastDay = "";
  return (
    <>
      <header className="flex shrink-0 items-center gap-2 px-2 py-2 lanx-bar border-b lanx-line">
        <button type="button" data-ph-back onClick={onBack} className="lanx-tool p-2 text-sky-600 dark:text-sky-400" aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <button type="button" onClick={onInfo} className="flex min-w-0 flex-1 items-center gap-2 text-left" data-ph-chat-info>
          <Avatar name={conv.peer_name} color={conv.peer_avatar_color} profile={isGroup ? null : profiles[conv.peer_id]} size={36} square={isGroup} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-semibold text-slate-900 dark:text-white" data-ph-chat-title>
              {conv.peer_name}
            </span>
            <span className={`block truncate text-[11px] ${typing ? "text-sky-600 dark:text-sky-400" : "text-slate-500 dark:text-slate-400"}`} data-ph-chat-subtitle>
              {subtitle}
            </span>
          </span>
        </button>
        {isGroup ? (
          <>
            {onMeeting && (
              <button type="button" data-ph-meeting-start onClick={onMeeting} className="lanx-tool p-2 text-sky-600 dark:text-sky-400" aria-label="Video meeting">
                <Video className="h-5 w-5" />
              </button>
            )}
            <button type="button" onClick={onInfo} className="lanx-tool p-2 text-slate-500" aria-label="Group info">
              <Info className="h-5 w-5" />
            </button>
          </>
        ) : (
          <>
            <button type="button" data-ph-call-start="voice" onClick={() => onCall(false)} className="lanx-tool p-2 text-sky-600 dark:text-sky-400" aria-label="Voice call">
              <Phone className="h-5 w-5" />
            </button>
            <button type="button" data-ph-call-start="video" onClick={() => onCall(true)} className="lanx-tool p-2 text-sky-600 dark:text-sky-400" aria-label="Video call">
              <Video className="h-5 w-5" />
            </button>
          </>
        )}
        <button type="button" data-ph-chat-menu onClick={onMenu} className="lanx-tool p-2 text-slate-500" aria-label="More">
          <MoreVertical className="h-5 w-5" />
        </button>
      </header>
      {conv.secret_ttl > 0 && (
        <div className="flex shrink-0 items-center gap-2 border-b lanx-line bg-violet-500/10 px-4 py-1.5 text-[12px] text-violet-700 dark:text-violet-200" data-ph-secret-bar={conv.secret_ttl}>
          <Timer className="h-3.5 w-3.5 shrink-0" />
          Secret messages: they disappear {secretShort(conv.secret_ttl)} after reading.
        </div>
      )}

      {pinned && (
        <button
          type="button"
          data-ph-pinned
          onClick={() => document.querySelector(`[data-ph-msg="${pinned.id}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" })}
          className="flex shrink-0 items-center gap-2 border-b lanx-line bg-amber-500/10 px-4 py-1.5 text-left text-[12px] text-slate-700 dark:text-slate-200"
        >
          <Pin className="h-3.5 w-3.5 shrink-0 text-amber-600" />
          <span className="truncate">{snippet(pinned)}</span>
        </button>
      )}
      {scheduled.length > 0 && (
        <div className="shrink-0 border-b lanx-line bg-sky-500/10 px-4 py-1.5 text-[12px] text-slate-700 dark:text-slate-200" data-ph-scheduled={scheduled.length}>
          <button type="button" className="flex w-full items-center gap-2 text-left" onClick={() => setShowScheduled((s) => !s)}>
            <Clock className="h-3.5 w-3.5 shrink-0 text-sky-600" />
            <span className="flex-1">
              {scheduled.length} message{scheduled.length > 1 ? "s" : ""} waiting to be sent
            </span>
            <span className="text-[11px] text-slate-400">{showScheduled ? "Hide" : "Show"}</span>
          </button>
          {showScheduled &&
            scheduled.map((s) => (
              <div key={s.id} className="mt-1 flex items-center gap-2 rounded-lg lanx-card px-2 py-1" data-ph-scheduled-item={s.id}>
                <span className="min-w-0 flex-1 truncate">
                  <b>{whenText(s.send_at)}</b> · {s.content}
                </span>
                <button
                  type="button"
                  data-ph-scheduled-cancel
                  className="lanx-tool p-1 text-rose-500"
                  onClick={() =>
                    run(async () => {
                      await client.cancelLater(s.id, conv.id);
                      setScheduled((list) => list.filter((x) => x.id !== s.id));
                    })
                  }
                  aria-label="Cancel"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
        </div>
      )}

      <div
        ref={listRef}
        className="ph-scroll px-3 py-3 space-y-1.5"
        data-ph-messages
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        {more && (
          <div className="flex justify-center pb-2">
            <button
              type="button"
              data-ph-older
              onClick={() => {
                stick.current = false;
                onOlder();
              }}
              className="rounded-full lanx-group px-3 py-1 text-[11.5px] font-semibold text-slate-600 dark:text-slate-300"
            >
              Earlier messages
            </button>
          </div>
        )}
        {messages.map((m) => {
          const day = dayLabel(m.timestamp);
          const sep = day !== lastDay;
          lastDay = day;
          return (
            <div key={m.id}>
              {sep && (
                <div className="flex justify-center py-2">
                  <span className="rounded-full lanx-chip px-2.5 py-0.5 text-[10px] font-semibold">{day}</span>
                </div>
              )}
              <Bubble
                m={m}
                group={isGroup}
                myId={me?.id ?? ""}
                myName={me?.name ?? ""}
                names={names}
                nameOf={(id) => (id === me?.id ? "You" : nameOf(id))}
                senderName={nameOf(m.sender_id)}
                client={client}
                stickers={stickers}
                progress={m.transfer ? progress[m.transfer.id] && Math.round((progress[m.transfer.id].transferred_bytes / Math.max(1, progress[m.transfer.id].file_size)) * 100) : undefined}
                onActions={(x) => setActions(x)}
                onReact={react}
                onAccept={onAccept}
                onCardChanged={onChanged}
                onError={(t) => onProblem(new Error(t))}
                onRejoin={onRejoinMeeting}
              />
            </div>
          );
        })}
        {uploads.map((u) => (
          <div key={u.id} className="flex justify-end" data-ph-upload>
            <div className="max-w-[82%] rounded-[18px] rounded-br-[6px] bg-sky-500/80 px-3.5 py-2 text-[13px] text-white">
              <div className="truncate font-medium">{u.name}</div>
              <div className="mt-1.5 h-1.5 w-40 overflow-hidden rounded-full bg-white/30">
                <div className="h-full rounded-full bg-white transition-all" style={{ width: `${u.pct}%` }} />
              </div>
              <div className="mt-0.5 text-[10px] text-white/80">{u.pct < 100 ? `Sending to your PC · ${u.pct}%` : "Your PC is sending it…"}</div>
            </div>
          </div>
        ))}
        {typing && (
          <div className="flex items-start">
            <div className="rounded-[18px] rounded-bl-[6px] lanx-bubble-in px-4 py-3">
              <span className="lanx-typing lanx-typing-lg">
                <i />
                <i />
                <i />
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="ph-safe-bottom shrink-0 px-2 pt-1.5 pb-1.5 lanx-bar border-t lanx-line">
        {(reply || editing) && (
          <div className="mb-1.5 flex items-center gap-2 rounded-xl lanx-group px-3 py-1.5 text-[12px]" data-ph-compose-bar={editing ? "edit" : "reply"}>
            {editing ? <Pencil className="h-3.5 w-3.5 shrink-0 text-sky-600" /> : <CornerUpLeft className="h-3.5 w-3.5 shrink-0 text-sky-600" />}
            <span className="min-w-0 flex-1 truncate text-slate-700 dark:text-slate-200">
              {editing ? "Editing your message" : `${nameOf(reply!.sender_id)}: ${snippet(reply!)}`}
            </span>
            <button type="button" className="lanx-tool p-1" onClick={clearComposer} aria-label="Cancel">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        {mentionList.length > 0 && (
          <div className="mb-1.5 flex flex-wrap gap-1.5" data-ph-mentions>
            {mentionList.slice(0, 6).map((m) => (
              <button key={m.device_id} type="button" data-ph-mention={m.display_name} onClick={() => pickMention(m.device_id, m.display_name)} className="rounded-full lanx-card px-3 py-1 text-[12.5px] font-semibold text-slate-800 dark:text-slate-100">
                @{m.display_name}
              </button>
            ))}
          </div>
        )}
        {quickList.length > 0 && (
          <div className="mb-1.5 space-y-1" data-ph-quick-list>
            {quickList.slice(0, 6).map((q) => (
              <button
                key={q}
                type="button"
                data-ph-quick={q}
                onClick={() => {
                  setText(q);
                  setQuickOpen(false);
                  boxRef.current?.focus();
                }}
                className="block w-full truncate rounded-xl lanx-card px-3 py-1.5 text-left text-[13px] text-slate-800 dark:text-slate-100"
              >
                <Zap className="mr-1.5 inline h-3.5 w-3.5 text-amber-500" />
                {q}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-end gap-1">
          <button type="button" data-ph-plus onClick={() => setPlus(true)} className="lanx-tool p-2 text-slate-500 dark:text-slate-400" aria-label="More">
            <Plus className="h-5 w-5" />
          </button>
          <label className="lanx-tool p-2 text-slate-500 dark:text-slate-400" aria-label="Photo or video">
            <ImageIcon className="h-5 w-5" />
            <input
              type="file"
              accept="image/*,video/*"
              multiple
              data-ph-photo
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) onFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
          <div className="flex min-w-0 flex-1 items-end rounded-[20px] bg-[color-mix(in_srgb,var(--lanx-surface)_70%,transparent)] py-1 pl-4 pr-1 shadow-[inset_0_0_0_1px_var(--lanx-line)]">
            <textarea
              ref={boxRef}
              data-ph-compose
              rows={1}
              value={text}
              placeholder={editing ? "Edit your message" : "Message"}
              enterKeyHint={coarsePointer() ? "enter" : "send"}
              onChange={(e) => onTextChange(e.target.value, e.target)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !coarsePointer()) {
                  e.preventDefault();
                  void submit();
                }
                if (e.key === "Escape" && (reply || editing)) clearComposer();
              }}
              className="max-h-[120px] min-h-[24px] w-full resize-none bg-transparent py-1.5 text-[16px] leading-snug text-slate-900 placeholder:text-slate-400 focus:outline-none dark:text-white ph-select"
            />
            <button
              type="button"
              data-ph-send
              disabled={!text.trim()}
              onClick={() => void submit()}
              className="mb-0.5 ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sky-500 text-white disabled:opacity-40"
              aria-label={editing ? "Save" : "Send"}
            >
              {editing ? <Pencil className="h-4 w-4" /> : <ArrowUp className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </div>

      {actions && (
        <Sheet onClose={() => setActions(null)} hook="actions">
          <div className="mb-2 flex justify-between px-1" data-ph-react-row>
            {QUICK_REACTIONS.map((e) => (
              <button
                key={e}
                type="button"
                data-ph-react={e}
                onClick={() => {
                  const m = actions;
                  setActions(null);
                  react(m, e);
                }}
                className="flex h-11 w-11 items-center justify-center rounded-full text-[24px] active:bg-[var(--lanx-fill)]"
              >
                {e}
              </button>
            ))}
          </div>
          <SheetRow icon={<CornerUpLeft className="h-4 w-4" />} label="Reply" hook="reply" onClick={() => act("reply", actions)} />
          <SheetRow icon={<Forward className="h-4 w-4" />} label="Forward" hook="forward" onClick={() => act("forward", actions)} />
          {(actions.message_type === "text" || actions.message_type === "file") && <SheetRow icon={<Copy className="h-4 w-4" />} label="Copy" hook="copy" onClick={() => act("copy", actions)} />}
          {actions.message_type === "text" && !actions.deleted && !conv.secret_ttl && (
            <>
              {onMakeTask && <SheetRow icon={<ClipboardCheck className="h-4 w-4" />} label="Make a task…" hook="task" onClick={() => act("task", actions)} />}
              {onSaveNote && <SheetRow icon={<StickyNote className="h-4 w-4" />} label="Save to notes" hook="note" onClick={() => act("note", actions)} />}
              <SheetRow icon={<MessageCircle className="h-4 w-4" />} label="Share on WhatsApp" hook="whatsapp" onClick={() => act("whatsapp", actions)} />
            </>
          )}
          <SheetRow icon={<Star className="h-4 w-4" />} label={actions.starred ? "Unstar" : "Star"} hook="star" onClick={() => act("star", actions)} />
          <SheetRow icon={<Pin className="h-4 w-4" />} label={actions.pinned_at ? "Unpin" : "Pin in this chat"} hook="pin" onClick={() => act("pin", actions)} />
          {actions.remind_at ? (
            <SheetRow icon={<AlarmClock className="h-4 w-4" />} label="Cancel reminder" hint={whenText(actions.remind_at)} hook="cancel-remind" onClick={() => act("cancel-remind", actions)} />
          ) : (
            <SheetRow icon={<AlarmClock className="h-4 w-4" />} label="Remind me…" hook="remind" onClick={() => act("remind", actions)} />
          )}
          {actions.is_outgoing && actions.message_type === "text" && !actions.deleted && <SheetRow icon={<Pencil className="h-4 w-4" />} label="Edit" hook="edit" onClick={() => act("edit", actions)} />}
          <SheetRow icon={<Trash2 className="h-4 w-4" />} label="Delete for me" hook="delete-me" onClick={() => act("delete-me", actions)} danger />
          {actions.is_outgoing && !actions.deleted && <SheetRow icon={<Trash2 className="h-4 w-4" />} label="Delete for everyone" hook="delete-all" onClick={() => act("delete-all", actions)} danger />}
        </Sheet>
      )}

      {plus && (
        <Sheet onClose={() => setPlus(false)} hook="plus">
          <label className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[14px] text-slate-800 active:bg-[var(--lanx-fill)] dark:text-slate-100">
            <Paperclip className="h-4 w-4 opacity-80" /> File
            <input
              type="file"
              multiple
              data-ph-attach
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) onFiles(e.target.files);
                e.target.value = "";
                setPlus(false);
              }}
            />
          </label>
          {onFolder && canPickFolder() && (
            <label className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[14px] text-slate-800 active:bg-[var(--lanx-fill)] dark:text-slate-100">
              <FolderUp className="h-4 w-4 opacity-80" /> A whole folder
              <input
                type="file"
                multiple
                data-ph-attach-folder
                className="hidden"
                ref={(el) => el?.setAttribute("webkitdirectory", "")}
                onChange={(e) => {
                  const files = e.target.files ? Array.from(e.target.files) : [];
                  e.target.value = "";
                  setPlus(false);
                  if (files.length) onFolder(files);
                }}
              />
            </label>
          )}
          <SheetRow
            icon={<Smile className="h-4 w-4" />}
            label="Sticker"
            hook="stickers"
            onClick={() => {
              setPlus(false);
              setStickersOpen(true);
            }}
          />
          <SheetRow
            icon={<Zap className="h-4 w-4" />}
            label="Quick reply"
            hint={quickReplies.length ? `${quickReplies.length}` : "none set"}
            hook="quick"
            onClick={() => {
              setPlus(false);
              setText("/");
              setQuickOpen(true);
              boxRef.current?.focus();
            }}
          />
          <SheetRow
            icon={<Clock className="h-4 w-4" />}
            label="Send later…"
            hint={text.trim() ? "this message" : "type it first"}
            hook="later"
            onClick={() => {
              setPlus(false);
              setCustomAt(localInputValue(Math.floor(Date.now() / 1000) + 3600));
              setLaterOpen(true);
            }}
          />
          <SheetRow
            icon={<Laugh className="h-4 w-4" />}
            label="Meme / GIF"
            hook="memes"
            onClick={() => {
              setPlus(false);
              onMemes();
            }}
          />
          <SheetRow
            icon={<Music2 className="h-4 w-4" />}
            label="Song"
            hint="send a song card"
            hook="music"
            onClick={() => {
              setPlus(false);
              onMusic();
            }}
          />
          <SheetRow
            icon={<ClipboardList className="h-4 w-4" />}
            label="Card…"
            hint="poll, task, notice…"
            hook="card"
            onClick={() => {
              setPlus(false);
              onCreateCard();
            }}
          />
          <SheetRow
            icon={<Mic className="h-4 w-4" />}
            label="Voice note"
            hint={secure && canRecord() ? undefined : "needs the secure connection"}
            hook="voice"
            onClick={() => {
              setPlus(false);
              if (secure && canRecord()) setRecordMode("voice");
              else onNotice("Voice notes need the secure connection — More → Secure connection.");
            }}
          />
          {!isGroup && (
            <SheetRow
              icon={<Radio className="h-4 w-4" />}
              label="Intercom"
              hint={secure && canRecord() ? "plays out loud on their PC" : "needs the secure connection"}
              hook="intercom"
              onClick={() => {
                setPlus(false);
                if (secure && canRecord()) setRecordMode("intercom");
                else onNotice("The intercom needs the secure connection — More → Secure connection.");
              }}
            />
          )}
        </Sheet>
      )}

      {recordMode && (
        <RecordSheet
          mode={recordMode}
          onClose={() => setRecordMode(null)}
          onDone={async (rec) => {
            setRecordMode(null);
            try {
              await (recordMode === "voice" ? onVoice(rec) : onIntercom(rec));
            } catch (e) {
              onProblem(e);
            }
          }}
          onProblem={onProblem}
        />
      )}

      {stickersOpen && (
        <Sheet title="Stickers" onClose={() => setStickersOpen(false)} hook="stickers">
          <div className="grid grid-cols-4 gap-2" data-ph-sticker-grid>
            {stickers.map((s) => (
              <button
                key={s.id}
                type="button"
                data-ph-sticker-pick={s.id}
                onClick={() => {
                  setStickersOpen(false);
                  run(async () => {
                    const r = await client.sticker(conv.id, s.id);
                    onChanged(r.message);
                  });
                }}
                className="flex flex-col items-center rounded-xl py-2 active:bg-[var(--lanx-fill)]"
              >
                <span className="text-[40px] leading-none">{s.emoji}</span>
                <span className="mt-1 text-[10.5px] font-semibold text-slate-600 dark:text-slate-300">{s.label}</span>
              </button>
            ))}
          </div>
        </Sheet>
      )}

      {laterOpen && (
        <Sheet title="Send later" onClose={() => setLaterOpen(false)} hook="later">
          {whenChoices("send").map((c) => (
            <SheetRow key={c.label} label={c.label} hint={c.hint} hook={`later:${c.label}`} onClick={() => sendLater(c.at)} />
          ))}
          <div className="mt-2 flex items-center gap-2 px-1">
            <input type="datetime-local" value={customAt} onChange={(e) => setCustomAt(e.target.value)} className="flex-1 rounded-xl lanx-field px-3 py-2 text-[14px] text-slate-900 dark:text-white" data-ph-later-custom />
            <button
              type="button"
              data-ph-later-go
              onClick={() => {
                const at = customSecs();
                if (at) sendLater(at);
              }}
              className="rounded-full bg-sky-500 px-4 py-2 text-[12.5px] font-semibold text-white"
            >
              Send then
            </button>
          </div>
        </Sheet>
      )}

      {remindFor && (
        <Sheet title="Remind me" onClose={() => setRemindFor(null)} hook="remind">
          <div className="mb-2 truncate rounded-xl lanx-group px-3 py-2 text-[12.5px] text-slate-600 dark:text-slate-300">{snippet(remindFor)}</div>
          <label className="mb-1 flex items-center gap-2 px-3 py-1.5 text-[13px] text-slate-700 dark:text-slate-200">
            <input type="checkbox" checked={noReply} onChange={(e) => setNoReply(e.target.checked)} data-ph-remind-noreply /> Only if nobody has replied by then
          </label>
          {whenChoices("remind").map((c) => (
            <SheetRow key={c.label} label={c.label} hint={c.hint} hook={`remind:${c.label}`} onClick={() => setReminder(remindFor, c.at)} />
          ))}
          <div className="mt-2 flex items-center gap-2 px-1">
            <input type="datetime-local" value={customAt} onChange={(e) => setCustomAt(e.target.value)} className="flex-1 rounded-xl lanx-field px-3 py-2 text-[14px] text-slate-900 dark:text-white" data-ph-remind-custom />
            <button
              type="button"
              data-ph-remind-go
              onClick={() => {
                const at = customSecs();
                if (at) setReminder(remindFor, at);
              }}
              className="rounded-full bg-sky-500 px-4 py-2 text-[12.5px] font-semibold text-white"
            >
              Remind then
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}
