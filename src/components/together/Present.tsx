/** LANX 3.9.0: Present to everyone — open a PDF (or pictures) and every PC that
 *  joins follows your page and your pointer, no projector needed.
 *
 *  - Setup: the file, a title, who to invite.
 *  - Presenter: the page large, ‹ › (or the arrow keys), a strip of pages; the
 *    mouse over the page is a red dot on everyone's screen.
 *  - Colleague: the presenter's page, their dot gliding over it; they may look
 *    back at earlier pages and return with one click.
 *  The pictures and the wire are in lib/present.ts. */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ChevronLeft, ChevronRight, FileText, Images, Loader2, LogOut, Presentation, Undo2, UserPlus, Users, X } from "lucide-react";
import { type Session, host, invite, leave, tell, together } from "../../lib/together";
import { type Pic, type PresentState, type Presenter, type Watcher, Deck, attach, onPresenters, presenterOf, watcherOf } from "../../lib/present";
import { PeoplePicker, Sheet, chosen, initials, primaryBtn, secondaryBtn, useMyName, useOnline, useTogether } from "./common";
import type { Peer } from "../../types";

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
};

// ------------------------------------------------------------------ setup

export function PresentSetup({ onClose, onStarted }: { onClose: () => void; onStarted: (sessionId: string) => void }) {
  const peers = useOnline();
  const myName = useMyName();
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [deck, setDeck] = useState<Deck | null>(null);
  const [title, setTitle] = useState("");
  const [cover, setCover] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [failed, setFailed] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const deckRef = useRef<Deck | null>(null);
  const started = useRef(false);

  // Closed without starting: the file is let go.
  useEffect(
    () => () => {
      if (!started.current) deckRef.current?.dispose();
    },
    [],
  );

  const pick = async (files: File[]) => {
    if (!files.length) return;
    setOpening(true);
    setProblem(null);
    try {
      const d = await Deck.open(files);
      deckRef.current?.dispose();
      deckRef.current = d;
      setDeck(d);
      setTitle(d.title);
      setCover(null);
      d.thumb(0).then(setCover, () => {});
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setOpening(false);
    }
  };

  const people = chosen(peers, picked);
  const start = async () => {
    if (!deck || !people.length || busy) return;
    setBusy(true);
    setFailed({});
    setProblem(null);
    const t = title.trim() || deck.title;
    try {
      const { session, failed: f } = await host<PresentState>("present", people, myName || "A colleague", { title: t, page: 0, pages: deck.pages, pointer: null }, { title: t });
      // Cancelled on the "Inviting…" screen meanwhile: stay here with the file.
      if (!together.session(session.id)) return;
      if (Object.keys(f).length >= people.length) {
        // Nobody could be invited: stay here and say why.
        void leave(session as unknown as Session);
        setFailed(f);
        setProblem("Nobody could be invited.");
        return;
      }
      const p = attach(session as unknown as Session, deck);
      p.notInvited = people.filter((x) => f[x.id]).map((x) => ({ name: x.name, why: f[x.id] }));
      started.current = true;
      onStarted(session.id);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title="Present to everyone" subtitle="A PDF or pictures — everyone follows your page and pointer" icon={<Presentation className="h-5 w-5" />} onClose={onClose} tag="present">
      <input
        ref={fileInput}
        type="file"
        data-present-file
        accept=".pdf,application/pdf,.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          void pick(files);
        }}
      />
      {!deck ? (
        <button type="button" data-present-choose onClick={() => fileInput.current?.click()} disabled={opening} className="flex w-full flex-col items-center gap-2 rounded-2xl lanx-group px-4 py-7 text-center hover:bg-[var(--lanx-fill)] disabled:opacity-60">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-500/15 text-sky-600 dark:text-sky-400">{opening ? <Loader2 className="h-5 w-5 animate-spin" /> : <FileText className="h-5 w-5" />}</span>
          <span className="text-[13.5px] font-semibold text-slate-900 dark:text-white">{opening ? "Opening…" : "Choose a PDF or pictures"}</span>
          <span className="text-[12px] text-slate-500">One PDF, or several JPG, PNG or WebP pictures (shown in name order)</span>
        </button>
      ) : (
        <div className="flex items-center gap-3 rounded-2xl lanx-group p-3" data-present-chosen>
          <div className="flex h-[72px] w-[56px] shrink-0 items-center justify-center overflow-hidden rounded-md bg-white shadow-[0_0_0_0.5px_rgb(0_0_0/0.12),0_2px_6px_rgb(0_0_0/0.08)]">
            {cover ? <img src={cover} alt="" className="h-full w-full object-contain" /> : <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
          </div>
          <div className="min-w-0 flex-1">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value.slice(0, 120))}
              data-present-title
              aria-label="Title"
              className="w-full rounded-lg lanx-field px-2.5 py-1.5 text-[13.5px] font-semibold text-slate-900 dark:text-white"
            />
            <div className="mt-1 flex items-center gap-1.5 px-0.5 text-[12px] text-slate-500">
              {deck.kind === "pdf" ? <FileText className="h-3.5 w-3.5" /> : <Images className="h-3.5 w-3.5" />}
              {deck.pages} {deck.kind === "pdf" ? (deck.pages === 1 ? "page" : "pages") : deck.pages === 1 ? "picture" : "pictures"}
              <button type="button" onClick={() => fileInput.current?.click()} disabled={opening} className="ml-auto font-semibold text-sky-600 dark:text-sky-400">
                {opening ? "Opening…" : "Change"}
              </button>
            </div>
          </div>
        </div>
      )}
      {problem && <div className="mt-2 text-[12.5px] text-amber-600 dark:text-amber-400">{problem}</div>}
      <div className="mt-4">
        <PeoplePicker picked={picked} onChange={setPicked} failed={failed} />
      </div>
      <button type="button" data-present-start disabled={!deck || !people.length || busy} onClick={start} className={`${primaryBtn} mt-4`}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Presentation className="h-4 w-4" />}
        {busy ? "Inviting…" : people.length ? `Present to ${people.length === 1 ? people[0].name : `${people.length} people`}` : "Start presenting"}
      </button>
      <p className="mt-2 text-center text-[11.5px] text-slate-400">The pages go to colleagues as pictures, only while you present.</p>
    </Sheet>
  );
}

// ------------------------------------------------------------------ the page on screen

/** The page fitted into the space, the previous one fading under the new one;
 *  a spinner over it while the page asked for is still coming. */
function Stage({
  pic,
  loading,
  waiting,
  onBox,
  children,
  hostMouse,
}: {
  pic: Pic | null;
  loading: boolean;
  waiting: string;
  onBox?: (w: number, h: number) => void;
  children?: React.ReactNode;
  hostMouse?: { move: (e: React.MouseEvent<HTMLDivElement>) => void; leave: () => void };
}) {
  const area = useRef<HTMLDivElement | null>(null);
  const [room, setRoom] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setRoom({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setRoom({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  const [layers, setLayers] = useState<{ prev: Pic | null; cur: Pic | null }>({ prev: null, cur: pic });
  // A new page: the old one stays underneath while it fades in (worked out while rendering,
  // so the new page is on screen in the same frame, not one later).
  if (pic && pic.url !== layers.cur?.url) setLayers({ prev: layers.cur, cur: pic });
  const cur = layers.cur;
  const aw = cur?.w ?? 4;
  const ah = cur?.h ?? 3;
  const pad = 28;
  const s = Math.max(0, Math.min((room.w - pad * 2) / aw, (room.h - pad * 2) / ah));
  const bw = Math.floor(aw * s);
  const bh = Math.floor(ah * s);
  useEffect(() => onBox?.(bw, bh), [bw, bh, onBox]);
  return (
    <div ref={area} className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
      {room.w > 0 && (
        <div
          data-present-box
          onMouseMove={hostMouse?.move}
          onMouseLeave={hostMouse?.leave}
          style={{ width: bw, height: bh }}
          className={`relative overflow-hidden rounded-[6px] bg-white shadow-[0_0_0_0.5px_rgb(0_0_0/0.1),0_10px_40px_-14px_rgb(0_0_0/0.35)] dark:shadow-[0_0_0_0.5px_rgb(255_255_255/0.08),0_14px_50px_-14px_rgb(0_0_0/0.9)] ${hostMouse ? "cursor-none" : ""}`}
        >
          {layers.prev && <img src={layers.prev.url} alt="" draggable={false} className="pointer-events-none absolute inset-0 h-full w-full select-none object-contain" />}
          {cur && (
            <img
              key={cur.url}
              src={cur.url}
              alt=""
              draggable={false}
              data-present-img={cur.page}
              onAnimationEnd={() => setLayers((l) => (l.prev ? { prev: null, cur: l.cur } : l))}
              style={{ animation: layers.prev ? "lanx-fade 0.2s ease-out both" : undefined }}
              className="pointer-events-none absolute inset-0 h-full w-full select-none object-fill"
            />
          )}
          {(loading || !cur) && (
            // (Fades in after 150 ms: a page that's ready a moment later never flashes a spinner.)
            <div data-present-loading style={{ animation: "lanx-fade 0.26s ease-out 0.15s both" }} className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-white/55 text-slate-600 dark:bg-black/35 dark:text-slate-200">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white/90 shadow-[0_0_0_0.5px_rgb(0_0_0/0.1),0_4px_14px_rgb(0_0_0/0.12)] dark:bg-slate-800/90">
                <Loader2 className="h-5 w-5 animate-spin text-sky-500" />
              </span>
              <span className="rounded-full bg-white/90 px-2.5 py-0.5 text-[12px] font-semibold dark:bg-slate-800/90">{waiting}</span>
            </div>
          )}
          {children}
        </div>
      )}
    </div>
  );
}

const dotStyle = "pointer-events-none absolute left-0 top-0 -ml-[8px] -mt-[8px] h-4 w-4 rounded-full bg-red-500 opacity-0 shadow-[0_0_0_2px_#fff,0_1px_5px_rgb(0_0_0/0.4)] transition-opacity duration-150";

/** The presenter's dot on a colleague's screen: glides to each new spot. */
function PointerDot({ watcher, page, bw, bh }: { watcher: Watcher; page: number; bw: number; bh: number }) {
  const el = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const d = el.current;
    if (!d) return;
    let target = watcher.pointer;
    let cur: { x: number; y: number } | null = null;
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      raf = 0;
      const t = target;
      if (!t || t.x < 0 || t.p !== page || !bw) {
        d.style.opacity = "0";
        cur = null;
        return;
      }
      const tx = (t.x / 10000) * bw;
      const ty = (t.y / 10000) * bh;
      if (!cur) cur = { x: tx, y: ty };
      else {
        // Eases toward each new spot (~70 ms), so 10 updates a second look like motion.
        const k = 1 - Math.exp(-Math.min(100, now - last) / 70);
        cur.x += (tx - cur.x) * k;
        cur.y += (ty - cur.y) * k;
      }
      last = now;
      d.style.transform = `translate(${cur.x.toFixed(1)}px, ${cur.y.toFixed(1)}px)`;
      d.style.opacity = "1";
      if (Math.abs(tx - cur.x) > 0.3 || Math.abs(ty - cur.y) > 0.3) raf = requestAnimationFrame(tick);
    };
    const kick = () => {
      if (!raf) {
        last = performance.now();
        raf = requestAnimationFrame(tick);
      }
    };
    const un = watcher.onPointer((p) => {
      target = p;
      d.dataset.tx = String(p.x);
      d.dataset.ty = String(p.y);
      d.dataset.tp = String(p.p);
      if (p.x < 0 || p.p !== page) {
        // Off the page (or on another one): gone at once, no frame needed.
        d.style.opacity = "0";
        cur = null;
        return;
      }
      kick();
    });
    kick();
    return () => {
      un();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [watcher, page, bw, bh]);
  return <div ref={el} data-present-pointer className={dotStyle} />;
}

function Avatar({ name, color, size = 26 }: { name: string; color?: string; size?: number }) {
  return (
    <span className="flex shrink-0 items-center justify-center rounded-full font-bold text-white ring-2 ring-[var(--lanx-surface)]" style={{ width: size, height: size, fontSize: size * 0.4, background: color || "#64748b" }}>
      {initials(name)}
    </span>
  );
}

// ------------------------------------------------------------------ the screens

export function PresentScreen({ session, onClose }: { session: Session; onClose: () => void }) {
  useTogether(); // re-render as the session changes
  useSyncExternalStore(onPresenters, presenterVersion, presenterVersion);
  const s = together.session(session.id) ?? session;
  if (s.role === "host") {
    const p = presenterOf(s.id);
    if (!p) return <Starting onClose={onClose} />;
    return <HostScreen key={s.id} p={p} session={s} onClose={onClose} />;
  }
  return <MemberScreen key={s.id} session={s} onClose={onClose} />;
}
let pv = 0;
onPresenters(() => void (pv += 1));
const presenterVersion = () => pv;

function Starting({ onClose }: { onClose: () => void }) {
  return (
    <div data-present-screen="starting" className="fixed inset-0 z-[78] flex flex-col items-center justify-center gap-3 bg-[color-mix(in_srgb,var(--lanx-surface)_89%,#000)] dark:bg-[color-mix(in_srgb,var(--lanx-surface)_42%,#000)] text-slate-500 lanx-fade">
      <Loader2 className="h-6 w-6 animate-spin text-sky-500" />
      <div className="text-[13px] font-semibold">Inviting…</div>
      <button type="button" onClick={onClose} className={secondaryBtn}>
        Cancel
      </button>
    </div>
  );
}

function useBox() {
  const [box, setBox] = useState({ w: 0, h: 0 });
  const onBox = useMemo(() => (w: number, h: number) => setBox((b) => (b.w === w && b.h === h ? b : { w, h })), []);
  return [box, onBox] as const;
}

/** The window behind the page: the app's own surface, a step darker (so any look fits). */
const shell = "fixed inset-0 z-[78] flex flex-col bg-[color-mix(in_srgb,var(--lanx-surface)_89%,#000)] dark:bg-[color-mix(in_srgb,var(--lanx-surface)_42%,#000)] lanx-fade";
const bar = "flex h-[56px] shrink-0 items-center gap-3 border-b border-[var(--lanx-line)] bg-[var(--lanx-surface)] px-4";
const roundBtn = "flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--lanx-fill)] text-slate-700 transition hover:bg-[var(--lanx-fill-2)] active:scale-95 disabled:opacity-30 dark:text-slate-200";

function HostScreen({ p, session, onClose }: { p: Presenter; session: Session; onClose: () => void }) {
  useSyncExternalStore(p.subscribe, p.version, p.version);
  const deck = p.deck;
  const page = p.page;
  // A page already drawn shows in this very render (no spinner frame); one still being
  // drawn shows the last page under a spinner until it's ready.
  const ready = deck.ready(page);
  const lastShown = useRef<Pic | null>(null);
  if (ready) lastShown.current = ready;
  const pic = ready ?? lastShown.current;
  const [, drawn] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [people, setPeople] = useState(false);
  const dot = useRef<HTMLDivElement | null>(null);
  const root = useRef<HTMLDivElement | null>(null);
  const online = useOnline();
  const colors = useMemo(() => new Map((online ?? []).map((x: Peer) => [x.id, x.avatar_color])), [online]);

  useEffect(() => {
    setErr(null);
    if (deck.ready(page)) return;
    let alive = true;
    deck.picture(page, true).then(
      () => alive && drawn((n) => n + 1),
      (e) => alive && setErr(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      alive = false;
    };
  }, [deck, page]);

  useEffect(() => {
    root.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      let to: number | null = null;
      if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === "ArrowDown" || e.key === " ") to = p.page + 1;
      else if (e.key === "ArrowLeft" || e.key === "PageUp" || e.key === "ArrowUp") to = p.page - 1;
      else if (e.key === "Home") to = 0;
      else if (e.key === "End") to = deck.pages - 1;
      if (to === null) return;
      e.preventDefault();
      e.stopPropagation();
      p.go(to);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [p, deck]);

  const mouse = useMemo(
    () => ({
      move: (e: React.MouseEvent<HTMLDivElement>) => {
        const r = e.currentTarget.getBoundingClientRect();
        const fx = (e.clientX - r.left) / r.width;
        const fy = (e.clientY - r.top) / r.height;
        const d = dot.current;
        if (fx < 0 || fx > 1 || fy < 0 || fy > 1) {
          if (d) d.style.opacity = "0";
          p.pointer(-1, -1);
          return;
        }
        if (d) {
          d.style.transform = `translate(${e.clientX - r.left}px, ${e.clientY - r.top}px)`;
          d.style.opacity = "1";
        }
        p.pointer(fx * 10000, fy * 10000);
      },
      leave: () => {
        if (dot.current) dot.current.style.opacity = "0";
        p.pointer(-1, -1);
      },
    }),
    [p],
  );

  const members = [...session.members.values()];
  const behind = members.filter((m) => !p.hasPage(m.id)).length;
  // Stopping ends it for those watching (onClose); invites not yet answered go away too.
  const stop = () => {
    for (const id of session.invited.keys()) void tell(session, "end", {}, id);
    onClose();
  };
  return (
    <div ref={root} tabIndex={-1} data-present-screen="host" data-present-page={page} data-present-shown={pic?.page ?? -1} className={`${shell} outline-none`}>
      <div className={bar}>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-sky-500/15 text-sky-600 dark:text-sky-400">
          <Presentation className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold text-slate-900 dark:text-white">{p.title}</div>
          <div className="truncate text-[11.5px] text-slate-500">
            <span data-present-count>
              Page {page + 1} of {deck.pages}
            </span>
            <span className="hidden sm:inline"> · ← → turn the page · your mouse is the pointer</span>
          </div>
        </div>
        <div className="relative">
          <button type="button" data-present-people onClick={() => setPeople((v) => !v)} className="flex items-center gap-2 rounded-full py-1 pl-1 pr-3 hover:bg-[var(--lanx-fill)]">
            <span className="flex -space-x-2">
              {members.slice(0, 4).map((m) => (
                <Avatar key={m.id} name={m.name} color={colors.get(m.id)} />
              ))}
              {!members.length && (
                <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-[var(--lanx-fill)] text-slate-500">
                  <Users className="h-3.5 w-3.5" />
                </span>
              )}
            </span>
            <span className="text-[12.5px] font-semibold text-slate-700 dark:text-slate-200" data-present-watching={members.length}>
              {members.length ? `${members.length} watching` : "Waiting for people"}
            </span>
            {behind > 0 && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
          </button>
          {people && <PeoplePanel p={p} session={session} colors={colors} onClose={() => setPeople(false)} />}
        </div>
        <button type="button" data-present-stop onClick={stop} className="rounded-full bg-red-500 px-3.5 py-1.5 text-[12.5px] font-bold text-white transition hover:bg-red-600 active:scale-95">
          Stop presenting
        </button>
      </div>
      <Stage pic={pic} loading={!err && (!pic || pic.page !== page)} waiting={`Page ${page + 1}…`} hostMouse={mouse}>
        <div ref={dot} className={dotStyle} />
        {err && <div className="absolute inset-x-0 bottom-3 mx-auto w-fit rounded-full bg-amber-500 px-3 py-1 text-[12px] font-semibold text-white">{err}</div>}
      </Stage>
      <div className="flex h-[100px] shrink-0 items-center gap-3 border-t border-[var(--lanx-line)] bg-[var(--lanx-surface)] px-4">
        <button type="button" data-present-prev title="Previous page (←)" disabled={page === 0} onClick={() => p.go(page - 1)} className={roundBtn}>
          <ChevronLeft className="h-5 w-5" />
        </button>
        <Strip deck={deck} page={page} onPick={(i) => p.go(i)} />
        <button type="button" data-present-next title="Next page (→)" disabled={page >= deck.pages - 1} onClick={() => p.go(page + 1)} className={roundBtn}>
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}

/** Every page small, drawn only when it scrolls into view. */
function Strip({ deck, page, onPick }: { deck: Deck; page: number; onPick: (i: number) => void }) {
  const strip = useRef<HTMLDivElement | null>(null);
  const [seen, setSeen] = useState<Set<number>>(new Set());
  const [urls, setUrls] = useState<Record<number, string>>({});
  useEffect(() => {
    const root = strip.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (es) => {
        const add = es.filter((e) => e.isIntersecting).map((e) => Number((e.target as HTMLElement).dataset.presentThumb));
        if (add.length) setSeen((s) => (add.every((i) => s.has(i)) ? s : new Set([...s, ...add])));
      },
      { root, rootMargin: "0px 300px" },
    );
    root.querySelectorAll("[data-present-thumb]").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [deck]);
  useEffect(() => {
    let alive = true;
    for (const i of seen) {
      if (urls[i]) continue;
      deck.thumb(i).then(
        (u) => alive && setUrls((x) => (x[i] ? x : { ...x, [i]: u })),
        () => {},
      );
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seen, deck]);
  // Keep the current page in view.
  useEffect(() => {
    const root = strip.current;
    const el = root?.querySelector<HTMLElement>(`[data-present-thumb="${page}"]`);
    if (!root || !el) return;
    const left = el.offsetLeft - root.clientWidth / 2 + el.clientWidth / 2;
    root.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
  }, [page]);
  return (
    <div ref={strip} className="flex h-full min-w-0 flex-1 items-center gap-2.5 overflow-x-auto overflow-y-hidden px-1 [scrollbar-width:thin]">
      {Array.from({ length: deck.pages }, (_, i) => (
        <button
          key={i}
          type="button"
          data-present-thumb={i}
          onClick={() => onPick(i)}
          title={`Page ${i + 1}`}
          className={`group flex shrink-0 flex-col items-center gap-1 rounded-md p-0.5 transition ${i === page ? "" : "opacity-75 hover:opacity-100"}`}
        >
          <span className={`flex h-[60px] min-w-[44px] items-center justify-center overflow-hidden rounded-[4px] bg-white shadow-[0_0_0_0.5px_rgb(0_0_0/0.15)] transition ${i === page ? "ring-2 ring-sky-500 ring-offset-2 ring-offset-[var(--lanx-surface)]" : ""}`}>
            {urls[i] ? <img src={urls[i]} alt="" draggable={false} className="h-full w-auto max-w-[110px] object-contain" /> : <span className="text-[10px] text-slate-300">{i + 1}</span>}
          </span>
          <span className={`text-[10.5px] font-semibold tabular-nums ${i === page ? "text-sky-600 dark:text-sky-400" : "text-slate-400"}`}>{i + 1}</span>
        </button>
      ))}
    </div>
  );
}

/** Who is watching (and has the page), who hasn't joined yet, and inviting more. */
function PeoplePanel({ p, session, colors, onClose }: { p: Presenter; session: Session; colors: Map<string, string>; onClose: () => void }) {
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [failed, setFailed] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const peers = useOnline();
  const members = [...session.members.values()];
  const invited = [...session.invited.entries()];
  const exclude = useMemo(() => members.map((m) => m.id), [members.map((m) => m.id).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  const panel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (panel.current && !panel.current.contains(e.target as Node) && !(e.target as HTMLElement).closest?.("[data-present-people]")) onClose();
    };
    window.addEventListener("mousedown", away);
    return () => window.removeEventListener("mousedown", away);
  }, [onClose]);
  const people = chosen(peers, picked);
  const send = async () => {
    if (!people.length) return;
    setBusy(true);
    const f = await invite(session, people, { title: p.title });
    setBusy(false);
    setFailed(f);
    if (!Object.keys(f).length) {
      setAdding(false);
      setPicked({});
    }
  };
  return (
    <div ref={panel} data-present-people-panel className="absolute right-0 top-[calc(100%+8px)] z-10 w-[330px] rounded-2xl lanx-menu p-3 lanx-rise">
      <div className="flex items-center justify-between">
        <div className="text-[13px] font-semibold text-slate-900 dark:text-white">Watching</div>
        <button type="button" onClick={onClose} className="lanx-tool p-1 text-slate-400" title="Close">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="mt-1.5 space-y-0.5">
        {!members.length && <div className="px-1 py-1 text-[12px] text-slate-500">Nobody yet — they see an invite and choose to join.</div>}
        {members.map((m) => {
          const has = p.hasPage(m.id);
          const why = p.problem(m.id);
          return (
            <div key={m.id} data-present-member={m.id} className="flex items-center gap-2.5 rounded-xl px-1.5 py-1.5">
              <Avatar name={m.name} color={colors.get(m.id)} size={28} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold text-slate-800 dark:text-slate-100">{m.name}</div>
                <div className={`truncate text-[11.5px] ${why ? "text-amber-600 dark:text-amber-400" : "text-slate-500"}`}>{why ? why : has ? `Sees page ${p.page + 1}` : `Getting page ${p.page + 1}…`}</div>
              </div>
              {!why && !has && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
            </div>
          );
        })}
      </div>
      {(invited.length > 0 || p.notInvited.length > 0) && (
        <>
          <div className="mt-2.5 text-[12px] font-semibold text-slate-500">Invited</div>
          <div className="mt-1 space-y-0.5">
            {invited.map(([id, name]) => (
              <div key={id} className="flex items-center gap-2.5 px-1.5 py-1 text-[12.5px] text-slate-600 dark:text-slate-300">
                <Avatar name={name} color={colors.get(id)} size={22} />
                <span className="min-w-0 flex-1 truncate">{name}</span>
                <span className="text-[11.5px] text-slate-400">hasn't joined</span>
              </div>
            ))}
            {p.notInvited.map((x) => (
              <div key={x.name} className="px-1.5 py-1 text-[12px] text-amber-600 dark:text-amber-400">
                {x.name}: {x.why}
              </div>
            ))}
          </div>
        </>
      )}
      <div className="mt-3 border-t border-[var(--lanx-line)] pt-3">
        {!adding ? (
          <button type="button" data-present-invite onClick={() => setAdding(true)} className={`${secondaryBtn} w-full`}>
            <UserPlus className="h-4 w-4" /> Invite more people
          </button>
        ) : (
          <>
            <PeoplePicker picked={picked} onChange={setPicked} failed={failed} exclude={exclude} />
            <button type="button" data-present-invite-send disabled={!people.length || busy} onClick={send} className={`${primaryBtn} mt-2.5`}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} Invite
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function MemberScreen({ session, onClose }: { session: Session; onClose: () => void }) {
  const w = watcherOf(session.id);
  useSyncExternalStore(w.subscribe, w.version, w.version);
  const st = session.state as PresentState | null;
  const pages = st && Number.isInteger(st.pages) && st.pages > 0 ? st.pages : 0;
  const hostPage = st && Number.isInteger(st.page) && st.page >= 0 ? Math.min(st.page, Math.max(0, pages - 1)) : 0;
  /** null: following the presenter; a number: looking back at that page. */
  const [own, setOwn] = useState<number | null>(null);
  const view = own ?? hostPage;
  const [box, onBox] = useBox();
  const root = useRef<HTMLDivElement | null>(null);
  const lastShown = useRef<Pic | null>(null);
  const want = w.pics.get(view) ?? null;
  if (want) lastShown.current = want;
  const pic = want ?? lastShown.current;

  // Looking back at a page this PC doesn't have: ask for it. Following: ask only if it's slow.
  useEffect(() => {
    if (!st || w.pics.has(view)) return;
    const t = window.setTimeout(() => w.ask(session, view), own === null ? 4000 : 0);
    return () => window.clearTimeout(t);
  }, [st, view, own, w, session, w.pics.size]); // eslint-disable-line react-hooks/exhaustive-deps

  const prev = () => setOwn(Math.max(0, view - 1));
  const next = () => setOwn(view + 1 >= hostPage ? null : view + 1);
  useEffect(() => {
    root.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "ArrowLeft" || e.key === "PageUp" || e.key === "ArrowUp") prev();
      else if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === "ArrowDown") next();
      else if (e.key === "Escape" && own !== null) setOwn(null);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  // Nothing from the presenter for a while after joining: say so (Leave is right there).
  const [silent, setSilent] = useState(false);
  useEffect(() => {
    if (st) return setSilent(false);
    const t = window.setTimeout(() => setSilent(true), 10000);
    return () => window.clearTimeout(t);
  }, [st]);
  const waiting = !st ? (silent ? `No answer from ${session.hostName} — the presentation may have ended` : `Joining ${session.hostName}'s presentation…`) : `Page ${view + 1} is on its way…`;
  return (
    <div ref={root} tabIndex={-1} data-present-screen="member" data-present-page={view} data-present-host-page={hostPage} data-present-shown={want ? want.page : -1} data-present-following={own === null ? "1" : "0"} className={`${shell} outline-none`}>
      <div className={bar}>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-sky-500/15 text-sky-600 dark:text-sky-400">
          <Presentation className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold text-slate-900 dark:text-white">{st?.title || "Presentation"}</div>
          <div className="truncate text-[11.5px] text-slate-500">{session.hostName} is presenting</div>
        </div>
        {pages > 0 && (
          <div className="rounded-full bg-[var(--lanx-fill)] px-2.5 py-1 text-[12px] font-semibold tabular-nums text-slate-600 dark:text-slate-300" data-present-count>
            {view + 1} / {pages}
          </div>
        )}
        <button type="button" data-present-leave onClick={onClose} className={secondaryBtn}>
          <LogOut className="h-4 w-4" /> Leave
        </button>
      </div>
      <Stage pic={pic} loading={!want} waiting={waiting} onBox={onBox}>
        <PointerDot watcher={w} page={view} bw={box.w} bh={box.h} />
      </Stage>
      <div className="flex h-[64px] shrink-0 items-center justify-center gap-2">
        {pages > 1 && (
          <div className="flex items-center gap-1.5 rounded-full lanx-sheet p-1.5">
            <button type="button" data-present-prev title="An earlier page (←)" disabled={view === 0} onClick={prev} className={`${roundBtn} h-9 w-9 bg-transparent`}>
              <ChevronLeft className="h-5 w-5" />
            </button>
            {own === null ? (
              <span className="px-2 text-[12.5px] font-semibold text-slate-600 dark:text-slate-300">Following {session.hostName}</span>
            ) : (
              <button type="button" data-present-back onClick={() => setOwn(null)} className="inline-flex items-center gap-1.5 rounded-full bg-sky-500 px-3.5 py-1.5 text-[12.5px] font-bold text-white transition hover:bg-sky-600 active:scale-95 lanx-fade">
                <Undo2 className="h-4 w-4" /> Back to {session.hostName} · page {hostPage + 1}
              </button>
            )}
            <button type="button" data-present-next title="Later page (→)" disabled={own === null} onClick={next} className={`${roundBtn} h-9 w-9 bg-transparent`}>
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
