// LANX 2.14.0: the reading view of the PDF tools — every page in one scroll,
// zoom, find words, jump to a page. Double-click a page to mark it up.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { shownSize, type PageState, type Source } from "../../lib/pdfEngine";
import { findText, pagePicture, type Decor, type Hit } from "../../lib/pdfTools";

export function PdfReader({
  sources,
  pages,
  decor,
  file,
  scale,
  onCur,
  jump,
  onEdit,
  version,
}: {
  sources: Source[];
  pages: PageState[];
  decor?: Decor;
  file: string;
  scale: number;
  /** The page in view (index into `pages`). */
  onCur: (i: number) => void;
  /** Scroll to this page (index into `pages`) when `tick` changes. */
  jump: { i: number; tick: number } | null;
  onEdit: (i: number) => void;
  /** Changes when marks or decorations change, so pages are drawn again. */
  version: string;
}) {
  const live = useMemo(() => pages.map((p, i) => ({ p, i })).filter((x) => !x.p.deleted), [pages]);
  const total = live.length;
  const scroller = useRef<HTMLDivElement | null>(null);
  const els = useRef(new Map<number, HTMLDivElement>());
  const canvases = useRef(new Map<number, HTMLCanvasElement>());
  const drawn = useRef(new Map<number, string>());
  const [visible, setVisible] = useState<Set<number>>(new Set());
  const observer = useRef<IntersectionObserver | null>(null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [at, setAt] = useState(0);
  const [searching, setSearching] = useState(false);
  const findBox = useRef<HTMLInputElement | null>(null);
  const dpr = Math.min(2, window.devicePixelRatio || 1);

  // Which pages are near the window: only those are drawn (a 300-page file stays light).
  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        setVisible((v) => {
          const n = new Set(v);
          for (const e of entries) {
            const i = Number((e.target as HTMLElement).dataset.pdfRpage);
            if (e.isIntersecting) n.add(i);
            else {
              n.delete(i);
              const c = canvases.current.get(i);
              if (c) {
                c.width = 0; // let the memory go
                drawn.current.delete(i);
              }
            }
          }
          return n;
        });
      },
      { root, rootMargin: "900px 0px" },
    );
    observer.current = io;
    for (const el of els.current.values()) io.observe(el);
    return () => io.disconnect();
  }, [total]);

  const setEl = useCallback((i: number, el: HTMLDivElement | null) => {
    const prev = els.current.get(i);
    if (prev && prev !== el) observer.current?.unobserve(prev);
    if (el) {
      els.current.set(i, el);
      observer.current?.observe(el);
    } else els.current.delete(i);
  }, []);

  // Draw the pages in view, one after the other.
  useEffect(() => {
    let alive = true;
    (async () => {
      for (const { p, i } of live) {
        if (!alive) return;
        if (!visible.has(i)) continue;
        const key = `${scale}:${version}:${p.rotate}:${p.source}:${p.index}`;
        if (drawn.current.get(i) === key) continue;
        const c = canvases.current.get(i);
        if (!c) continue;
        const k = live.findIndex((x) => x.i === i);
        try {
          await pagePicture(sources[p.source], p, scale * dpr, { decor, file, pageNo: k + 1, total }, c);
        } catch {
          continue;
        }
        if (!alive) return;
        drawn.current.set(i, key);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, scale, version, live, sources, decor, file]);

  // Which page is "current": the one at the top third of the window.
  const onScroll = () => {
    const root = scroller.current;
    if (!root) return;
    const line = root.scrollTop + root.clientHeight / 3;
    let best = live[0]?.i ?? 0;
    for (const { i } of live) {
      const el = els.current.get(i);
      if (!el) continue;
      if (el.offsetTop <= line) best = i;
      else break;
    }
    onCur(best);
  };

  useEffect(() => {
    if (!jump) return;
    const el = els.current.get(jump.i);
    const root = scroller.current;
    if (el && root) root.scrollTo({ top: el.offsetTop - 16, behavior: "auto" });
  }, [jump]);

  // ---- find
  const runFind = async (text: string) => {
    const t = text.trim();
    if (!t) {
      setHits([]);
      return;
    }
    setSearching(true);
    try {
      const h = await findText(sources, pages, t);
      setHits(h);
      setAt(0);
    } finally {
      setSearching(false);
    }
  };
  const goTo = (k: number) => {
    if (!hits.length) return;
    const n = ((k % hits.length) + hits.length) % hits.length;
    setAt(n);
    const h = hits[n];
    const el = els.current.get(h.page);
    const root = scroller.current;
    if (el && root) root.scrollTo({ top: el.offsetTop + h.rect.y * scale - root.clientHeight / 2, behavior: "smooth" });
  };
  useEffect(() => {
    if (hits.length) goTo(at);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hits]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        findBox.current?.focus();
        findBox.current?.select();
      } else if (e.key === "PageDown" || e.key === "PageUp") {
        const root = scroller.current;
        if (!root || (e.target as HTMLElement)?.tagName === "INPUT") return;
        e.preventDefault();
        root.scrollBy({ top: (e.key === "PageDown" ? 1 : -1) * (root.clientHeight - 40), behavior: "smooth" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex-1 min-w-0 min-h-0 flex flex-col" data-pdf-reader>
      <div className="flex items-center gap-2 px-3 py-1.5 border-b lanx-line" data-pdf-find>
        <Search className="h-3.5 w-3.5 text-slate-400" />
        <input
          ref={findBox}
          data-pdf-find-input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              if (hits.length && q.trim()) goTo(at + (e.shiftKey ? -1 : 1));
              else void runFind(q);
            } else if (e.key === "Escape") {
              setQ("");
              setHits([]);
              (e.target as HTMLInputElement).blur();
            }
          }}
          placeholder="Find words in this PDF (Ctrl+F) — Enter for the next one"
          className="lanx-field rounded-lg px-2.5 py-1 text-[12px] w-[320px] max-w-[50vw] text-slate-900 dark:text-white"
        />
        <button type="button" data-pdf-find-go onClick={() => void runFind(q)} disabled={!q.trim() || searching} className="px-2.5 py-1 rounded-lg lanx-group text-[11.5px] font-semibold text-slate-700 dark:text-slate-200 disabled:opacity-40">
          {searching ? "Looking…" : "Find"}
        </button>
        {q.trim() && !searching && (
          <span data-pdf-find-count className="text-[11.5px] text-slate-500">
            {hits.length ? `${at + 1} of ${hits.length}` : "Not found"}
          </span>
        )}
        {hits.length > 0 && (
          <>
            <button type="button" data-pdf-find-prev onClick={() => goTo(at - 1)} className="lanx-tool p-1 text-slate-500" title="Previous (Shift+Enter)"><ChevronUp className="h-4 w-4" /></button>
            <button type="button" data-pdf-find-next onClick={() => goTo(at + 1)} className="lanx-tool p-1 text-slate-500" title="Next (Enter)"><ChevronDown className="h-4 w-4" /></button>
            <button type="button" onClick={() => { setQ(""); setHits([]); }} className="lanx-tool p-1 text-slate-400" title="Clear"><X className="h-4 w-4" /></button>
          </>
        )}
        <span className="ml-auto text-[11px] text-slate-400">Double-click a page to mark it up · PgUp / PgDn to turn pages</span>
      </div>
      <div ref={scroller} onScroll={onScroll} className="flex-1 min-h-0 overflow-auto bg-slate-200/60 dark:bg-black/30 px-6 pt-6 pb-10" data-pdf-pages>
        {live.map(({ p, i }, k) => {
          const { w, h } = shownSize(p);
          return (
            <div key={`${i}`} data-pdf-rpage={i} ref={(el) => setEl(i, el)} onDoubleClick={() => onEdit(i)} className="relative mx-auto mb-7 bg-white shadow-xl" style={{ width: w * scale, height: h * scale }} title="Double-click to mark this page up">
              <canvas
                ref={(c) => {
                  if (c) canvases.current.set(i, c);
                  else canvases.current.delete(i);
                }}
                className="block"
                style={{ width: "100%", height: "100%" }}
              />
              {hits.map((hh, j) =>
                hh.page === i ? (
                  <span key={j} data-pdf-hit={j} className={`absolute pointer-events-none rounded-sm ${j === at ? "bg-orange-400/60 ring-2 ring-orange-500" : "bg-yellow-300/50"}`} style={{ left: hh.rect.x * scale, top: hh.rect.y * scale, width: hh.rect.w * scale, height: hh.rect.h * scale }} />
                ) : null,
              )}
              <span className="absolute -bottom-5 left-0 right-0 text-center text-[10.5px] text-slate-500 select-none">
                {k + 1} / {total}
              </span>
            </div>
          );
        })}
        {!total && <div className="text-center text-[13px] text-slate-500 mt-10">No pages to show.</div>}
      </div>
    </div>
  );
}
