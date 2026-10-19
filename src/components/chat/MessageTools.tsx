import { useEffect, useRef, useState } from "react";
import {
  AlarmClock,
  Bell,
  BellOff,
  ChevronLeft,
  Copy,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Reply,
  SmilePlus,
  Star,
  StarOff,
  Trash2,
  Undo2,
} from "lucide-react";
import type { Message, Reaction } from "../../types";
import { QUICK_REACTIONS, localInputValue, whenChoices, whenText } from "./chatUtils";

/** LANX 1.5.0: what you can do with a message — a small bar that appears
 *  when the mouse is on it (quick reactions, reply, more…). */

export interface MessageActions {
  reply: (m: Message) => void;
  edit: (m: Message) => void;
  react: (m: Message, emoji: string) => void;
  pin: (m: Message, pinned: boolean) => void;
  star: (m: Message, starred: boolean) => void;
  remind: (m: Message, at: number | null) => void;
  deleteMe: (m: Message) => void;
  deleteEveryone: (m: Message) => void;
}

const EDIT_WINDOW = 24 * 3600;
const DELETE_WINDOW = 48 * 3600;
const MORE_EMOJI = ["👍", "❤️", "😂", "😮", "😢", "🙏", "✅", "🔥", "🎉", "👏", "💯", "👀", "🤝", "😊", "🙌", "⚡", "❌", "🤔"];

export function MessageTools({
  msg,
  isOut,
  actions,
  canAct,
}: {
  msg: Message;
  isOut: boolean;
  actions: MessageActions;
  /** False in chats you have left (only local things stay). */
  canAct: boolean;
}) {
  const [menu, setMenu] = useState<null | "main" | "remind" | "emoji">(null);
  const [custom, setCustom] = useState(() => localInputValue(Math.floor(Date.now() / 1000) + 3600));
  const [up, setUp] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const now = Math.floor(Date.now() / 1000);
  const isText = msg.message_type === "text";
  const secret = !!msg.ttl_secs;
  const canEdit = canAct && isOut && isText && !secret && now - msg.timestamp < EDIT_WINDOW;
  const canDeleteAll = canAct && isOut && now - msg.timestamp < DELETE_WINDOW;

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setMenu(null);
        setConfirm(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);

  const open = (which: "main" | "emoji") => {
    const r = ref.current?.getBoundingClientRect();
    setUp(!!r && window.innerHeight - r.bottom < 340);
    setMenu((m) => (m === which ? null : which));
    setConfirm(false);
  };
  const done = (f: () => void) => () => {
    f();
    setMenu(null);
    setConfirm(false);
  };

  const item = (icon: React.ReactNode, label: string, onClick: () => void, danger = false, testId?: string) => (
    <button
      type="button"
      data-msg-action={testId}
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-[12.5px] rounded-lg text-left hover:bg-[var(--lanx-fill)] ${
        danger ? "text-red-600 dark:text-red-400" : "text-slate-700 dark:text-slate-200"
      }`}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div
      ref={ref}
      data-msg-tools
      className={`absolute top-1/2 -translate-y-1/2 ${isOut ? "right-full mr-2" : "left-full ml-2"} ${
        menu
          ? "z-40 opacity-100"
          : "z-10 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto"
      } transition-opacity`}
    >
      <div className="flex items-center gap-0.5 rounded-full lanx-menu px-1 py-0.5 shadow-lg whitespace-nowrap">
        {canAct &&
          QUICK_REACTIONS.slice(0, 4).map((e) => (
            <button
              key={e}
              type="button"
              data-react={e}
              onClick={() => actions.react(msg, e)}
              className="h-7 w-7 rounded-full text-[15px] hover:bg-[var(--lanx-fill)] hover:scale-125 transition-transform"
              title={`React ${e}`}
            >
              {e}
            </button>
          ))}
        {canAct && (
          <button type="button" onClick={() => open("emoji")} title="More reactions" className="h-7 w-7 rounded-full flex items-center justify-center text-slate-500 hover:bg-[var(--lanx-fill)]">
            <SmilePlus className="h-4 w-4" />
          </button>
        )}
        {canAct && (
          <button type="button" data-msg-action="reply" onClick={() => actions.reply(msg)} title="Reply" className="h-7 w-7 rounded-full flex items-center justify-center text-slate-500 hover:bg-[var(--lanx-fill)]">
            <Reply className="h-4 w-4" />
          </button>
        )}
        <button type="button" data-msg-more onClick={() => open("main")} title="More" className="h-7 w-7 rounded-full flex items-center justify-center text-slate-500 hover:bg-[var(--lanx-fill)]">
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </div>

      {menu === "emoji" && (
        <div className={`absolute ${up ? "bottom-full mb-1.5" : "top-full mt-1.5"} ${isOut ? "right-0" : "left-0"} w-[232px] rounded-2xl lanx-menu p-2 shadow-xl grid grid-cols-6 gap-1 lanx-rise`}>
          {MORE_EMOJI.map((e) => (
            <button key={e} type="button" onClick={done(() => actions.react(msg, e))} className="h-8 w-8 rounded-lg text-[17px] hover:bg-[var(--lanx-fill)] hover:scale-110 transition-transform">
              {e}
            </button>
          ))}
        </div>
      )}

      {(menu === "main" || menu === "remind") && (
        <div
          data-msg-menu
          className={`absolute ${up ? "bottom-full mb-1.5" : "top-full mt-1.5"} ${isOut ? "right-0" : "left-0"} w-60 rounded-2xl lanx-menu p-1.5 shadow-xl lanx-rise`}
        >
          {menu === "main" ? (
            <>
              {canAct && item(<Reply className="h-4 w-4" />, "Reply", done(() => actions.reply(msg)))}
              {isText && !secret && item(<Copy className="h-4 w-4" />, "Copy text", done(() => navigator.clipboard.writeText(msg.content).catch(() => {})))}
              {canEdit && item(<Pencil className="h-4 w-4" />, "Edit", done(() => actions.edit(msg)), false, "edit")}
              {canAct && !secret &&
                (msg.pinned_at
                  ? item(<PinOff className="h-4 w-4" />, "Unpin", done(() => actions.pin(msg, false)), false, "unpin")
                  : item(<Pin className="h-4 w-4" />, "Pin for everyone", done(() => actions.pin(msg, true)), false, "pin"))}
              {!secret &&
                (msg.starred
                  ? item(<StarOff className="h-4 w-4" />, "Unstar", done(() => actions.star(msg, false)), false, "unstar")
                  : item(<Star className="h-4 w-4" />, "Star (save)", done(() => actions.star(msg, true)), false, "star"))}
              {msg.remind_at
                ? item(<BellOff className="h-4 w-4" />, `Cancel reminder (${whenText(msg.remind_at)})`, done(() => actions.remind(msg, null)), false, "unremind")
                : item(<AlarmClock className="h-4 w-4" />, "Remind me…", () => setMenu("remind"), false, "remind")}
              <div className="my-1 border-t lanx-line" />
              {item(<Trash2 className="h-4 w-4" />, "Delete for me", done(() => actions.deleteMe(msg)), true, "delete-me")}
              {canDeleteAll &&
                (confirm
                  ? item(<Undo2 className="h-4 w-4" />, "Sure? Delete for everyone", done(() => actions.deleteEveryone(msg)), true, "delete-all-confirm")
                  : item(<Trash2 className="h-4 w-4" />, "Delete for everyone…", () => setConfirm(true), true, "delete-all"))}
            </>
          ) : (
            <>
              <button type="button" onClick={() => setMenu("main")} className="flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-slate-500">
                <ChevronLeft className="h-3.5 w-3.5" /> Remind me about this
              </button>
              {whenChoices("remind").map((c) => (
                <button
                  key={c.label}
                  type="button"
                  data-remind-choice={c.label}
                  onClick={done(() => actions.remind(msg, c.at))}
                  className="w-full flex items-center justify-between gap-2 px-3 py-1.5 text-[12.5px] rounded-lg hover:bg-[var(--lanx-fill)] text-slate-700 dark:text-slate-200"
                >
                  <span className="inline-flex items-center gap-2">
                    <Bell className="h-3.5 w-3.5" /> {c.label}
                  </span>
                  <span className="text-[10.5px] text-slate-400">{c.hint}</span>
                </button>
              ))}
              <div className="mt-1 flex items-center gap-1.5 px-2 pb-1">
                <input
                  type="datetime-local"
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                  className="flex-1 min-w-0 rounded-lg lanx-field px-2 py-1 text-[11.5px]"
                />
                <button
                  type="button"
                  onClick={done(() => actions.remind(msg, Math.floor(new Date(custom).getTime() / 1000)))}
                  className="rounded-lg bg-sky-500 hover:bg-sky-600 text-white px-2.5 py-1 text-[11.5px] font-semibold"
                >
                  Set
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Emoji chips under a message; click to add/take back yours. */
export function ReactionChips({
  reactions,
  isOut,
  onToggle,
}: {
  reactions: Reaction[];
  isOut: boolean;
  onToggle?: (emoji: string) => void;
}) {
  if (!reactions.length) return null;
  return (
    <div data-reactions className={`-mt-1.5 relative z-[1] flex flex-wrap gap-1 ${isOut ? "justify-end mr-2" : "ml-2"}`}>
      {reactions.map((r) => (
        <button
          key={r.emoji}
          type="button"
          data-reaction={r.emoji}
          onClick={() => onToggle?.(r.emoji)}
          title={r.names.join(", ")}
          className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[12px] shadow-sm transition-transform active:scale-90 ${
            r.mine ? "bg-sky-500/15 ring-1 ring-sky-500/60 lanx-card" : "lanx-card"
          }`}
        >
          <span>{r.emoji}</span>
          {r.count > 1 && <span className="text-[10.5px] font-semibold text-slate-600 dark:text-slate-300">{r.count}</span>}
        </button>
      ))}
    </div>
  );
}
