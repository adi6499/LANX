/** LANX 3.9.0: Together — the launcher (wrench menu → Together), the invites
 *  colleagues get, and the screens of the sessions this PC is in. Each activity
 *  lives in its own file; this only puts them on the screen. */
import { useEffect, useState } from "react";
import { BellRing, Brain, Check, Clapperboard, Headphones, Loader2, Megaphone, MicVocal, Presentation, Users } from "lucide-react";
import { type Invite, type Kind, type Session, decline, join, leave } from "../../lib/together";
import { InviteStack, Sheet, useTogether } from "./common";
import { QuizScreen, QuizSetup } from "./Quiz";
import { PresentScreen, PresentSetup } from "./Present";
import { WatchScreen, WatchSetup } from "./Watch";
import { BellLayer, BellSetup } from "./Bells";
import { AnnounceLayer, AnnounceSetup } from "./Announce";

type Open = null | "hub" | Kind;

const INVITE_TEXT: Record<Kind, (inv: Invite) => { icon: string; title: string }> = {
  quiz: (i) => ({ icon: "🧠", title: `${i.hostName} started a live quiz` }),
  present: (i) => ({ icon: "🖥️", title: `${i.hostName} is presenting` }),
  watch: (i) => ({ icon: "🎬", title: `${i.hostName} wants to watch together` }),
  bell: (i) => ({ icon: "🔔", title: `${i.hostName}` }),
  pa: (i) => ({ icon: "📢", title: `${i.hostName}` }),
};

function Hub({ onPick, onClose }: { onPick: (k: Open | "music" | "karaoke") => void; onClose: () => void }) {
  const tiles: { key: Open | "music" | "karaoke"; icon: React.ReactNode; title: string; text: string }[] = [
    { key: "music", icon: <Headphones className="h-5 w-5" />, title: "Listen together", text: "Your music on colleagues' PCs and phones, the same second." },
    { key: "karaoke", icon: <MicVocal className="h-5 w-5" />, title: "Karaoke", text: "Big lyrics in step with the song, on every PC listening." },
    { key: "quiz", icon: <Brain className="h-5 w-5" />, title: "Live quiz", text: "Questions on everyone's screen; fastest right answer wins." },
    { key: "present", icon: <Presentation className="h-5 w-5" />, title: "Present to everyone", text: "A PDF or pictures: everyone follows your page and pointer." },
    { key: "watch", icon: <Clapperboard className="h-5 w-5" />, title: "Watch together", text: "A video on every PC, playing in step." },
    { key: "pa", icon: <Megaphone className="h-5 w-5" />, title: "Announcement", text: "Hold to talk; every PC plays it at the same moment." },
    { key: "bell", icon: <BellRing className="h-5 w-5" />, title: "Bell or timer", text: "Lunch, break, stand-up: rings on every PC at the same second." },
  ];
  return (
    <Sheet title="Together" subtitle="Do something with colleagues, on all your PCs at once" icon={<Users className="h-5 w-5" />} onClose={onClose} tag="hub" wide>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {tiles.map((t) => (
          <button key={String(t.key)} type="button" data-together-tile={t.key} onClick={() => onPick(t.key)} className="flex flex-col items-start gap-2 rounded-2xl lanx-group p-3.5 text-left hover:bg-[var(--lanx-fill)]">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-500/15 text-sky-600 dark:text-sky-400">{t.icon}</span>
            <span className="text-[13.5px] font-semibold text-slate-900 dark:text-white">{t.title}</span>
            <span className="text-[12px] leading-snug text-slate-500">{t.text}</span>
          </button>
        ))}
      </div>
      <p className="mt-3 text-[11.5px] text-slate-400">Colleagues need LANX 3.9.0 or newer (Settings → Updates sends it).</p>
    </Sheet>
  );
}

function Invites({ invites }: { invites: Invite[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<Record<string, string>>({});
  const shown = invites.filter((i) => i.kind === "quiz" || i.kind === "present" || i.kind === "watch").slice(0, 3);
  if (!shown.length) return null;
  return (
    <InviteStack>
      {shown.map((inv) => {
        const t = INVITE_TEXT[inv.kind](inv);
        return (
          <div key={inv.sessionId} data-together-invite-kind={inv.kind} className="pointer-events-auto rounded-2xl lanx-sheet p-3 shadow-2xl lanx-rise">
            <div className="text-[13px] font-semibold text-slate-900 dark:text-white">
              {t.icon} {t.title}
            </div>
            {typeof inv.data.title === "string" && inv.data.title && <div className="truncate text-[12px] text-slate-500">{inv.data.title}</div>}
            {problem[inv.sessionId] && <div className="mt-1 text-[12px] text-amber-600">{problem[inv.sessionId]}</div>}
            <div className="mt-2.5 flex gap-2">
              <button
                type="button"
                data-together-join-kind={inv.kind}
                disabled={busy === inv.sessionId}
                onClick={async () => {
                  setBusy(inv.sessionId);
                  try {
                    await join(inv);
                  } catch (e) {
                    setProblem((p) => ({ ...p, [inv.sessionId]: e instanceof Error ? e.message : String(e) }));
                  } finally {
                    setBusy(null);
                  }
                }}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full bg-sky-500 py-2 text-[12.5px] font-bold text-white hover:bg-sky-600"
              >
                {busy === inv.sessionId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Join
              </button>
              <button type="button" onClick={() => decline(inv)} className="flex-1 rounded-full bg-[var(--lanx-fill)] py-2 text-[12.5px] font-semibold text-slate-700 dark:text-slate-200">
                Not now
              </button>
            </div>
          </div>
        );
      })}
    </InviteStack>
  );
}

export function TogetherLayer() {
  const { sessions, invites } = useTogether();
  const [open, setOpen] = useState<Open>(null);
  useEffect(() => {
    const hub = () => setOpen("hub");
    window.addEventListener("lanx:together-hub", hub);
    return () => window.removeEventListener("lanx:together-hub", hub);
  }, []);
  const close = () => setOpen(null);
  const pick = (k: Open | "music" | "karaoke") => {
    if (k === "music" || k === "karaoke") {
      setOpen(null);
      window.dispatchEvent(new Event("lanx:open-music"));
      window.setTimeout(() => window.dispatchEvent(new Event(k === "music" ? "lanx:together-open" : "lanx:karaoke-open")), 350);
      return;
    }
    setOpen(k);
  };
  const screen = (s: Session) => {
    const done = () => void leave(s);
    if (s.kind === "quiz") return <QuizScreen key={s.id} session={s} onClose={done} />;
    if (s.kind === "present") return <PresentScreen key={s.id} session={s} onClose={done} />;
    if (s.kind === "watch") return <WatchScreen key={s.id} session={s} onClose={done} />;
    return null;
  };
  return (
    <>
      {open === "hub" && <Hub onPick={pick} onClose={close} />}
      {open === "quiz" && <QuizSetup onClose={close} onStarted={close} />}
      {open === "present" && <PresentSetup onClose={close} onStarted={close} />}
      {open === "watch" && <WatchSetup onClose={close} onStarted={close} />}
      {open === "pa" && <AnnounceSetup onClose={close} />}
      {open === "bell" && <BellSetup onClose={close} />}
      {sessions.map(screen)}
      <Invites invites={invites} />
      <BellLayer />
      <AnnounceLayer />
    </>
  );
}
