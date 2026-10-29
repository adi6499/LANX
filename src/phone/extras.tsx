/** LANX 3.3 phone page: the PIN (unlock the PC, hidden chats), a chat's own
 *  menu (ring, secret messages, hide), broadcast, and the PC's music player
 *  and meme picker full screen. */
import { useEffect, useRef, useState } from "react";
import { Bell, EyeOff, Lock, Megaphone, Timer } from "lucide-react";
import type { Conversation, Peer, Profile } from "../types";
import { Avatar } from "../components/Avatar";
import { MusicApp } from "../components/music/MusicApp";
import { MemePanel } from "../components/memes/MemePanel";
import type { LockInfo } from "./client";
import { Sheet, SheetRow } from "./parts";

const field = "w-full rounded-xl lanx-field px-3.5 py-2.5 text-[15px] text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500 dark:text-white";
const primary = "rounded-full bg-sky-500 px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-40";

// --------------------------------------------------------------------- PIN

/** The PC is locked: type the PIN here to unlock it (the same PIN, the same
 *  wrong-attempt waits as on the PC). */
export function LockedScreen({ onUnlock }: { onUnlock: (pin: string) => Promise<string | null> }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    box.current?.focus();
  }, []);
  const submit = async () => {
    if (!pin || busy) return;
    setBusy(true);
    setError("");
    const problem = await onUnlock(pin);
    setBusy(false);
    if (problem) {
      setError(problem);
      setPin("");
    }
  };
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-6 backdrop-blur-sm" data-ph-locked>
      <form
        className="w-full max-w-xs rounded-[22px] lanx-sheet p-5 text-center"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Lock className="mx-auto h-7 w-7 text-slate-500" />
        <div className="mt-2 text-[15px] font-bold text-slate-900 dark:text-white">LANX is locked on your PC</div>
        <p className="mt-1 text-[12.5px] text-slate-500 dark:text-slate-400">Type your PIN to unlock it (the PC unlocks too).</p>
        <input
          ref={box}
          data-ph-pin
          type="password"
          inputMode="numeric"
          autoComplete="off"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 12))}
          className={`${field} ph-code mt-3 text-center text-[22px]`}
          placeholder="PIN"
        />
        {error && (
          <div className="mt-2 text-[12.5px] text-rose-600 dark:text-rose-400" data-ph-pin-error>
            {error}
          </div>
        )}
        <button type="submit" data-ph-unlock disabled={!pin || busy} className={`${primary} mt-3 w-full py-2.5`}>
          {busy ? "Checking…" : "Unlock"}
        </button>
      </form>
    </div>
  );
}

/** Asks for the PIN (to show hidden chats). */
export function PinSheet({ title, onClose, onPin }: { title: string; onClose: () => void; onPin: (pin: string) => Promise<string | null> }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Sheet title={title} onClose={onClose} hook="pin">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!pin || busy) return;
          setBusy(true);
          const problem = await onPin(pin);
          setBusy(false);
          if (problem) {
            setError(problem);
            setPin("");
          } else onClose();
        }}
      >
        <input
          autoFocus
          data-ph-pin-sheet
          type="password"
          inputMode="numeric"
          autoComplete="off"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 12))}
          className={`${field} ph-code text-center text-[22px]`}
          placeholder="PIN"
        />
        {error && <div className="mt-2 text-center text-[12.5px] text-rose-600 dark:text-rose-400">{error}</div>}
        <button type="submit" data-ph-pin-go disabled={!pin || busy} className={`${primary} mt-3 w-full py-2.5`}>
          {busy ? "Checking…" : "Show hidden chats"}
        </button>
      </form>
    </Sheet>
  );
}

// ------------------------------------------------------------- chat menu

export const SECRET_CHOICES: { ttl: number; label: string; short: string }[] = [
  { ttl: 0, label: "Off", short: "" },
  { ttl: 30, label: "30 seconds after reading", short: "30 s" },
  { ttl: 300, label: "5 minutes after reading", short: "5 min" },
  { ttl: 3600, label: "1 hour after reading", short: "1 h" },
  { ttl: 86400, label: "1 day after reading", short: "1 day" },
  { ttl: 604800, label: "1 week after reading", short: "1 week" },
];

export const secretShort = (ttl: number) => SECRET_CHOICES.find((c) => c.ttl === ttl)?.short ?? `${ttl}s`;

export function ChatMenuSheet({
  conv,
  lock,
  onClose,
  onRing,
  onSecret,
  onHide,
}: {
  conv: Conversation;
  lock: LockInfo | null;
  onClose: () => void;
  onRing: () => void;
  onSecret: (ttl: number) => void;
  onHide: (hidden: boolean) => void;
}) {
  const [secret, setSecret] = useState(false);
  const direct = conv.kind === "direct";
  if (secret)
    return (
      <Sheet title="Secret messages" onClose={onClose} hook="secret">
        <p className="mb-2 px-1 text-[12px] leading-relaxed text-slate-500 dark:text-slate-400">New messages in this chat disappear on both sides this long after they are read. Copies, forwards and screenshots stay possible — use it for passwords and such.</p>
        {SECRET_CHOICES.map((c) => (
          <SheetRow key={c.ttl} label={c.label} hint={conv.secret_ttl === c.ttl ? "✓" : undefined} hook={`secret:${c.ttl}`} onClick={() => onSecret(c.ttl)} />
        ))}
      </Sheet>
    );
  return (
    <Sheet title={conv.peer_name} onClose={onClose} hook="chat-menu">
      {direct && <SheetRow icon={<Bell className="h-4 w-4" />} label={`Ring ${conv.peer_name.split(" ")[0]}`} hint="their PC rings" hook="ring" onClick={onRing} />}
      {direct && <SheetRow icon={<Timer className="h-4 w-4" />} label="Secret messages" hint={conv.secret_ttl ? secretShort(conv.secret_ttl) : "Off"} hook="secret" onClick={() => setSecret(true)} />}
      {lock?.pin_set && (conv.is_hidden ? <SheetRow icon={<EyeOff className="h-4 w-4" />} label="Unhide this chat" hook="unhide" onClick={() => onHide(false)} /> : <SheetRow icon={<EyeOff className="h-4 w-4" />} label="Hide this chat" hint="behind your PIN" hook="hide" onClick={() => onHide(true)} />)}
      {!direct && !lock?.pin_set && <div className="px-3 py-2 text-[12.5px] text-slate-400">Nothing more for groups here.</div>}
    </Sheet>
  );
}

// -------------------------------------------------------------- broadcast

export function BroadcastSheet({ peers, profiles, onClose, onSend }: { peers: Peer[]; profiles: Record<string, Profile>; onClose: () => void; onSend: (ids: string[], text: string) => Promise<void> }) {
  const list = peers.filter((p) => p.trust_state !== "blocked");
  const [picked, setPicked] = useState<Set<string>>(() => new Set(list.filter((p) => p.status === "online").map((p) => p.id)));
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  return (
    <Sheet title="Message everyone" onClose={onClose} hook="broadcast">
      <p className="mb-2 px-1 text-[12px] text-slate-500 dark:text-slate-400">Each person gets it in their own chat with you.</p>
      <textarea data-ph-broadcast-text value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="Message" className={`${field} ph-select mb-2 resize-none`} />
      <div className="mb-1 flex items-center justify-between px-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">
        <span>To · {picked.size}</span>
        <button type="button" className="font-semibold normal-case text-sky-600 dark:text-sky-400" onClick={() => setPicked(picked.size === list.length ? new Set() : new Set(list.map((p) => p.id)))}>
          {picked.size === list.length ? "Nobody" : "Everyone"}
        </button>
      </div>
      <div className="mb-3 max-h-[34dvh] space-y-0.5 overflow-y-auto">
        {list.map((p) => (
          <button key={p.id} type="button" data-ph-broadcast-to={p.display_name} aria-pressed={picked.has(p.id)} onClick={() => toggle(p.id)} className={`flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left ${picked.has(p.id) ? "bg-sky-500/15 ring-1 ring-sky-500" : ""}`}>
            <Avatar name={p.display_name} color={p.avatar_color} profile={profiles[p.id]} size={30} />
            <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-slate-900 dark:text-white">{p.display_name}</span>
            <span className={`h-2 w-2 rounded-full ${p.status === "online" ? "bg-emerald-500" : "bg-slate-400"}`} />
          </button>
        ))}
      </div>
      <button
        type="button"
        data-ph-broadcast-send
        disabled={!text.trim() || picked.size === 0 || busy}
        onClick={() => {
          setBusy(true);
          onSend([...picked], text.trim())
            .then(onClose)
            .finally(() => setBusy(false));
        }}
        className={`${primary} w-full py-2.5`}
      >
        <Megaphone className="mr-1 inline h-4 w-4" /> Send to {picked.size}
      </button>
    </Sheet>
  );
}

// --------------------------------------------------------- music and memes

/** The PC's music player, full screen on the phone (songs play on the phone). */
export function MusicScreen({ chatName, onBack, onError, onSendCard }: { chatName: string | null; onBack: () => void; onError: (t: string) => void; onSendCard: (card: Record<string, unknown>) => Promise<void> }) {
  return <MusicApp chatName={chatName} onClose={onBack} onError={onError} onSendCard={(card) => onSendCard(card)} />;
}

/** The PC's meme picker, full screen; what it sends is kept and sent by the PC. */
export function MemesScreen({ chatName, onBack, onError, onSend }: { chatName: string | null; onBack: () => void; onError: (t: string) => void; onSend: (file: string) => Promise<void> }) {
  return <MemePanel chatName={chatName} onClose={onBack} onError={onError} onSendToChat={onSend} />;
}
