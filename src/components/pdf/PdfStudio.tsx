import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Download,
  Eraser,
  ExternalLink,
  FilePlus2,
  FileText,
  Highlighter,
  Loader2,
  MessageCircle,
  MousePointer2,
  PenLine,
  RotateCw,
  Send,
  Signature as SignatureIcon,
  Stamp,
  Trash2,
  Type,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { api, errorText } from "../../lib/api";
import { CSS, type Mark, type PageState, type Source, bounds, buildPdf, imageToPdf, moveMark, openSource, pagesOf, paintMarks, renderPage, shownSize, warmMarks } from "../../lib/pdfEngine";

/** LANX 2.5.0: PDF tools — erase (for good), highlight, draw, add text,
 *  stamps and a signature; rotate, delete and reorder pages; add pages from
 *  other PDFs or pictures; save some or all pages as a new PDF. */

type Tool = "select" | "erase" | "highlight" | "pen" | "text" | "stamp" | "sign";
const TOOLS: { id: Tool; label: string; icon: React.ElementType; hint: string }[] = [
  { id: "select", label: "Move", icon: MousePointer2, hint: "Click a mark to move or delete it" },
  { id: "erase", label: "Erase", icon: Eraser, hint: "Drag over anything to white it out — gone for good when you save" },
  { id: "highlight", label: "Highlight", icon: Highlighter, hint: "Drag over text" },
  { id: "pen", label: "Draw", icon: PenLine, hint: "Draw with the mouse" },
  { id: "text", label: "Text", icon: Type, hint: "Click where the text should go" },
  { id: "stamp", label: "Stamp", icon: Stamp, hint: "Click to place the stamp" },
  { id: "sign", label: "Sign", icon: SignatureIcon, hint: "Click to place your signature" },
];
const STAMPS = ["APPROVED", "PAID", "RECEIVED", "URGENT", "CONFIDENTIAL", "DRAFT", "COPY", "VERIFIED"];
const COLORS = ["black", "blue", "red", "green", "orange", "yellow", "grey"];

function baseName(path: string): string {
  const n = path.split(/[\\/]/).pop() ?? "document.pdf";
  return n.replace(/\.pdf$/i, "");
}

export function PdfStudio({
  initialPath,
  onClose,
  onError,
  onSendFile,
}: {
  /** A PDF to open at once (a received file, a picked file), or nothing for an empty studio. */
  initialPath?: string | null;
  onClose: () => void;
  onError: (text: string) => void;
  /** "Send to chat" for the saved file. */
  onSendFile: (path: string) => void;
}) {
  const [sources, setSources] = useState<Source[]>([]);
  const [pages, setPages] = useState<PageState[]>([]);
  const [cur, setCur] = useState(0);
  const [tool, setTool] = useState<Tool>("select");
  const [color, setColor] = useState("black");
  const [penWidth, setPenWidth] = useState(2.5);
  const [textSize, setTextSize] = useState(14);
  const [stampText, setStampText] = useState("APPROVED");
  const [stampDate, setStampDate] = useState(true);
  const [signature, setSignature] = useState<string | null>(null);
  const [signPad, setSignPad] = useState(false);
  const [signWidth, setSignWidth] = useState(150);
  const [selected, setSelected] = useState<number>(-1);
  const [scale, setScale] = useState(1.2);
  const [busy, setBusy] = useState<string | null>(null);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [pendingText, setPendingText] = useState<{ x: number; y: number; value: string } | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const pageImage = useRef<HTMLCanvasElement | null>(null);
  const drag = useRef<{ kind: "rect" | "pen" | "move"; x: number; y: number; points?: { x: number; y: number }[]; origin?: Mark } | null>(null);
  const undo = useRef<Map<number, Mark[][]>>(new Map());
  const page = pages[cur];
  const dirty = pages.some((p) => p.marks.length || p.rotate || p.deleted) || sources.length > 1;

  // ---- loading
  const addSource = useCallback(async (bytes: Uint8Array, name: string) => {
    const lower = name.toLowerCase();
    const pdfBytes = lower.endsWith(".pdf") ? bytes : await imageToPdf(bytes, name);
    const src = await openSource(pdfBytes, name);
    let idx = 0;
    setSources((s) => {
      idx = s.length;
      return [...s, src];
    });
    const ps = await pagesOf(idx, src);
    setPages((p) => [...p, ...ps]);
    return ps.length;
  }, []);

  const openPaths = useCallback(
    async (paths: string[]) => {
      if (!paths.length) return;
      setBusy("Opening…");
      try {
        for (const p of paths) {
          const bytes = await api.readFileBytes(p);
          await addSource(bytes, p.split(/[\\/]/).pop() ?? "file.pdf");
        }
      } catch (e) {
        onError(errorText(e));
      } finally {
        setBusy(null);
      }
    },
    [addSource, onError]
  );

  useEffect(() => {
    if (initialPath) void openPaths([initialPath]);
    api.getPref("signature").then((v) => v && setSignature(JSON.parse(v).png ?? null)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- drawing the current page
  const repaint = useCallback(() => {
    const c = canvasRef.current;
    const img = pageImage.current;
    if (!c || !img || !page) return;
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    paintMarks(ctx, page.marks, scale * dpr(), selected);
    const d = drag.current;
    if (d && d.kind === "rect" && d.points) {
      const [a, b] = d.points;
      ctx.save();
      ctx.globalAlpha = tool === "erase" ? 0.9 : 0.35;
      ctx.fillStyle = tool === "erase" ? "#fff" : CSS[color] ?? CSS.yellow;
      ctx.strokeStyle = "#0ea5e9";
      ctx.setLineDash([4, 3]);
      const s = scale * dpr();
      ctx.fillRect(Math.min(a.x, b.x) * s, Math.min(a.y, b.y) * s, Math.abs(b.x - a.x) * s, Math.abs(b.y - a.y) * s);
      ctx.strokeRect(Math.min(a.x, b.x) * s, Math.min(a.y, b.y) * s, Math.abs(b.x - a.x) * s, Math.abs(b.y - a.y) * s);
      ctx.restore();
    } else if (d && d.kind === "pen" && d.points) {
      paintMarks(ctx, [{ t: "pen", points: d.points, color, width: penWidth }], scale * dpr());
    }
  }, [page, scale, selected, tool, color, penWidth]);

  function dpr() {
    return Math.min(2, window.devicePixelRatio || 1);
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!page) return;
      await warmMarks(page.marks);
      const img = await renderPage(sources[page.source], page, scale * dpr());
      if (!alive) return;
      pageImage.current = img;
      repaint();
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page?.source, page?.index, page?.rotate, scale, sources]);
  useEffect(() => repaint(), [repaint, page?.marks]);

  // Fit the first page to the available width.
  useEffect(() => {
    if (!page || !wrapRef.current) return;
    const { w } = shownSize(page);
    const fit = (wrapRef.current.clientWidth - 48) / w;
    setScale(Math.max(0.5, Math.min(1.6, fit)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages.length > 0]);

  // Thumbnails (small, rendered one after the other).
  useEffect(() => {
    let alive = true;
    (async () => {
      for (let i = 0; i < pages.length; i++) {
        const p = pages[i];
        const key = `${p.source}:${p.index}:${p.rotate}`;
        if (thumbs[key]) continue;
        const c = await renderPage(sources[p.source], p, 0.22);
        if (!alive) return;
        setThumbs((t) => ({ ...t, [key]: c.toDataURL("image/jpeg", 0.7) }));
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages, sources]);

  // ---- marks
  const setMarks = (marks: Mark[], remember = true) => {
    setPages((ps) =>
      ps.map((p, i) => {
        if (i !== cur) return p;
        if (remember) {
          const stack = undo.current.get(cur) ?? [];
          undo.current.set(cur, [...stack.slice(-30), p.marks]);
        }
        return { ...p, marks };
      })
    );
  };
  const addMark = (m: Mark) => {
    setMarks([...(page?.marks ?? []), m]);
    setSelected(-1);
  };
  const undoLast = () => {
    const stack = undo.current.get(cur);
    if (!stack?.length) return;
    const prev = stack.pop()!;
    setMarks(prev, false);
    setSelected(-1);
  };

  const toPt = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  };
  const hit = (pt: { x: number; y: number }) => {
    if (!page) return -1;
    const ctx = canvasRef.current?.getContext("2d") ?? undefined;
    for (let i = page.marks.length - 1; i >= 0; i--) {
      const b = bounds(page.marks[i], ctx);
      if (pt.x >= b.x - 3 && pt.x <= b.x + b.w + 3 && pt.y >= b.y - 3 && pt.y <= b.y + b.h + 3) return i;
    }
    return -1;
  };

  const onDown = (e: React.PointerEvent) => {
    if (!page || pendingText) return;
    const pt = toPt(e);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    switch (tool) {
      case "select": {
        const i = hit(pt);
        setSelected(i);
        if (i >= 0) drag.current = { kind: "move", x: pt.x, y: pt.y, origin: page.marks[i] };
        break;
      }
      case "erase":
      case "highlight":
        drag.current = { kind: "rect", x: pt.x, y: pt.y, points: [pt, pt] };
        break;
      case "pen":
        drag.current = { kind: "pen", x: pt.x, y: pt.y, points: [pt] };
        break;
      case "text":
        setPendingText({ x: pt.x, y: pt.y, value: "" });
        break;
      case "stamp": {
        const text = stampDate ? `${stampText} · ${new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}` : stampText;
        addMark({ t: "stamp", x: pt.x, y: pt.y, text, color: color === "black" || color === "yellow" || color === "grey" ? "red" : color, size: 16 });
        break;
      }
      case "sign": {
        if (!signature) {
          setSignPad(true);
          break;
        }
        const img = new Image();
        img.onload = () => addMark({ t: "sign", x: pt.x, y: pt.y, w: signWidth, h: (signWidth * img.height) / img.width, png: signature });
        img.src = signature;
        break;
      }
    }
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !page) return;
    const pt = toPt(e);
    if (d.kind === "rect") d.points = [{ x: d.x, y: d.y }, pt];
    else if (d.kind === "pen") d.points!.push(pt);
    else if (d.kind === "move" && selected >= 0 && d.origin) {
      const moved = moveMark(d.origin, pt.x - d.x, pt.y - d.y);
      setPages((ps) => ps.map((p, i) => (i === cur ? { ...p, marks: p.marks.map((m, j) => (j === selected ? moved : m)) } : p)));
      return;
    }
    repaint();
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d || !page) return;
    if (d.kind === "rect" && d.points) {
      const [a, b] = d.points;
      const w = Math.abs(b.x - a.x);
      const h = Math.abs(b.y - a.y);
      if (w > 2 && h > 2) {
        const r = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w, h };
        addMark(tool === "erase" ? { t: "erase", ...r } : { t: "highlight", ...r, color: color === "black" ? "yellow" : color });
      } else repaint();
    } else if (d.kind === "pen" && d.points) {
      addMark({ t: "pen", points: d.points, color, width: penWidth });
    } else if (d.kind === "move") {
      // the move already changed the marks; remember the start for undo
      const stack = undo.current.get(cur) ?? [];
      undo.current.set(cur, [...stack.slice(-30), page.marks.map((m, j) => (j === selected && d.origin ? d.origin : m))]);
    }
  };

  const commitText = () => {
    if (!pendingText) return;
    const v = pendingText.value.trim();
    if (v) addMark({ t: "text", x: pendingText.x, y: pendingText.y, text: v, size: textSize, color });
    setPendingText(null);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (pendingText || signPad) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undoLast();
      } else if ((e.key === "Delete" || e.key === "Backspace") && selected >= 0 && page) {
        setMarks(page.marks.filter((_, j) => j !== selected));
        setSelected(-1);
      } else if (e.key === "Escape") {
        if (selected >= 0) setSelected(-1);
        else onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, page, pendingText, signPad, cur]);

  // ---- pages
  const rotatePage = (i: number) => setPages((ps) => ps.map((p, j) => (j === i ? { ...p, rotate: (p.rotate + 90) % 360 } : p)));
  const togglePage = (i: number) => setPages((ps) => ps.map((p, j) => (j === i ? { ...p, deleted: !p.deleted } : p)));
  const movePage = (i: number, dir: -1 | 1) =>
    setPages((ps) => {
      const j = i + dir;
      if (j < 0 || j >= ps.length) return ps;
      const n = [...ps];
      [n[i], n[j]] = [n[j], n[i]];
      if (cur === i) setCur(j);
      else if (cur === j) setCur(i);
      return n;
    });
  const addPages = async () => {
    try {
      const paths = await api.pickDocuments("any");
      await openPaths(paths);
    } catch (e) {
      onError(errorText(e));
    }
  };

  // ---- saving
  const save = async (onlyPicked = false) => {
    if (!sources.length) return;
    setBusy(onlyPicked ? "Saving the picked pages…" : "Saving…");
    try {
      const bytes = await buildPdf(sources, pages, onlyPicked ? picked : undefined);
      const name = `${baseName(sources[0].name)}${onlyPicked ? "-pages" : "-edited"}.pdf`;
      const path = await api.saveFileBytes(name, bytes, "pdf");
      if (path) {
        setSavedPath(path);
        onError(`Saved: ${path.split(/[\\/]/).pop()}`);
      }
    } catch (e) {
      onError(errorText(e));
    } finally {
      setBusy(null);
    }
  };
  const share = async () => {
    if (!savedPath) return;
    try {
      const r = await api.shareWhatsApp({ file: savedPath });
      if (r === "copied") onError("The PDF is copied — pick the chat in WhatsApp and press Ctrl+V to send it.");
    } catch (e) {
      onError(errorText(e));
    }
  };

  const live = useMemo(() => pages.filter((p) => !p.deleted).length, [pages]);
  const tip = TOOLS.find((t) => t.id === tool)?.hint;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 lanx-scrim">
      <div data-pdf-studio className="w-full h-full max-w-[1400px] flex flex-col rounded-[22px] lanx-sheet overflow-hidden lanx-rise">
        {/* Top bar */}
        <div className="flex items-center gap-2 px-4 py-2 border-b lanx-line">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-rose-500 text-white"><FileText className="h-4 w-4" /></span>
          <div className="min-w-0">
            <div className="text-[14px] font-bold text-slate-900 dark:text-white truncate">{sources[0]?.name ?? "PDF tools"}</div>
            <div className="text-[11px] text-slate-400 truncate">{pages.length ? `${live} page${live === 1 ? "" : "s"}${dirty ? " · changed, not saved yet" : ""}` : "Open a PDF, or add pictures to make one"}</div>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <button type="button" data-pdf-add onClick={addPages} className="px-3 py-1.5 rounded-full lanx-group text-[12px] font-semibold text-slate-700 dark:text-slate-200 inline-flex items-center gap-1"><FilePlus2 className="h-3.5 w-3.5" /> {pages.length ? "Add pages…" : "Open PDF / pictures…"}</button>
            {picked.size > 0 && (
              <button type="button" data-pdf-save-picked onClick={() => save(true)} disabled={!!busy} className="px-3 py-1.5 rounded-full lanx-group text-[12px] font-semibold text-slate-700 dark:text-slate-200">Save {picked.size} picked page{picked.size === 1 ? "" : "s"}…</button>
            )}
            <button type="button" data-pdf-save onClick={() => save(false)} disabled={!pages.length || !!busy} className="px-3.5 py-1.5 rounded-full bg-rose-500 hover:bg-rose-600 disabled:opacity-40 text-white text-[12px] font-semibold inline-flex items-center gap-1">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} {busy ?? "Save PDF…"}
            </button>
            {savedPath && (
              <>
                <button type="button" data-pdf-send onClick={() => onSendFile(savedPath)} className="px-3 py-1.5 rounded-full bg-sky-500 hover:bg-sky-600 text-white text-[12px] font-semibold inline-flex items-center gap-1"><Send className="h-3.5 w-3.5" /> Send to chat</button>
                <button type="button" onClick={share} title="Copies the PDF; paste it in WhatsApp" className="px-3 py-1.5 rounded-full bg-emerald-500 hover:bg-emerald-600 text-white text-[12px] font-semibold inline-flex items-center gap-1"><MessageCircle className="h-3.5 w-3.5" /> WhatsApp</button>
                <button type="button" onClick={() => api.openDocument(savedPath).catch((e) => onError(errorText(e)))} className="lanx-tool p-1.5 text-slate-500" title="Open the saved file"><ExternalLink className="h-4 w-4" /></button>
              </>
            )}
            <button type="button" onClick={onClose} className="lanx-tool p-1 text-slate-400 ml-1"><X className="h-4 w-4" /></button>
          </div>
        </div>

        {/* Tools */}
        <div className="flex items-center gap-1 px-3 py-1.5 border-b lanx-line flex-wrap">
          {TOOLS.map((t) => (
            <button key={t.id} type="button" data-pdf-tool={t.id} title={t.hint} onClick={() => { setTool(t.id); setSelected(-1); }} className={`px-2.5 py-1.5 rounded-lg text-[12px] font-semibold inline-flex items-center gap-1.5 ${tool === t.id ? "bg-slate-800 text-white dark:bg-white dark:text-slate-900" : "text-slate-600 dark:text-slate-300 hover:bg-[var(--lanx-fill)]"}`}>
              <t.icon className="h-3.5 w-3.5" /> {t.label}
            </button>
          ))}
          <span className="mx-1 h-5 w-px bg-black/10 dark:bg-white/10" />
          {(tool === "highlight" || tool === "pen" || tool === "text" || tool === "stamp") && (
            <div className="flex items-center gap-1">
              {COLORS.map((c) => (
                <button key={c} type="button" data-pdf-color={c} onClick={() => setColor(c)} title={c} className={`h-5 w-5 rounded-full border ${color === c ? "ring-2 ring-sky-500 ring-offset-1" : "border-black/10"}`} style={{ backgroundColor: CSS[c] }} />
              ))}
            </div>
          )}
          {tool === "pen" && (
            <label className="ml-2 text-[11.5px] text-slate-500 inline-flex items-center gap-1.5">Width <input type="range" min={1} max={10} step={0.5} value={penWidth} onChange={(e) => setPenWidth(Number(e.target.value))} /></label>
          )}
          {tool === "text" && (
            <label className="ml-2 text-[11.5px] text-slate-500 inline-flex items-center gap-1.5">Size
              <select value={textSize} onChange={(e) => setTextSize(Number(e.target.value))} className="lanx-field rounded-md px-1.5 py-0.5 text-[11.5px] text-slate-900 dark:text-white">
                {[9, 11, 12, 14, 16, 18, 22, 28, 36].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
          )}
          {tool === "stamp" && (
            <div className="ml-2 flex items-center gap-1.5 flex-wrap">
              {STAMPS.map((s) => (
                <button key={s} type="button" data-pdf-stamp={s} onClick={() => setStampText(s)} className={`px-2 py-0.5 rounded-md text-[11px] font-bold border ${stampText === s ? "border-rose-500 text-rose-600" : "border-slate-300 text-slate-500"}`}>{s}</button>
              ))}
              <input value={stampText} onChange={(e) => setStampText(e.target.value.toUpperCase().slice(0, 30))} className="lanx-field rounded-md px-2 py-0.5 text-[11.5px] w-36 text-slate-900 dark:text-white" placeholder="Your own text" />
              <label className="text-[11.5px] text-slate-500 inline-flex items-center gap-1"><input type="checkbox" checked={stampDate} onChange={(e) => setStampDate(e.target.checked)} /> with today's date</label>
            </div>
          )}
          {tool === "sign" && (
            <div className="ml-2 flex items-center gap-2">
              {signature ? <img src={signature} alt="Your signature" className="h-7 rounded border border-black/10 bg-white px-1" /> : <span className="text-[11.5px] text-slate-500">No signature yet</span>}
              <button type="button" data-pdf-sign-pad onClick={() => setSignPad(true)} className="px-2.5 py-1 rounded-lg lanx-group text-[11.5px] font-semibold text-slate-700 dark:text-slate-200">{signature ? "Draw again" : "Draw your signature"}</button>
              <label className="text-[11.5px] text-slate-500 inline-flex items-center gap-1.5">Size <input type="range" min={60} max={300} step={10} value={signWidth} onChange={(e) => setSignWidth(Number(e.target.value))} /></label>
            </div>
          )}
          <span className="ml-auto text-[11.5px] text-slate-400">{tip}</span>
          <button type="button" onClick={undoLast} title="Undo (Ctrl+Z)" className="lanx-tool p-1.5 text-slate-500"><Undo2 className="h-4 w-4" /></button>
          <button type="button" onClick={() => setScale((s) => Math.max(0.4, s - 0.15))} className="lanx-tool p-1.5 text-slate-500"><ZoomOut className="h-4 w-4" /></button>
          <span className="text-[11px] text-slate-400 w-10 text-center">{Math.round(scale * 100)}%</span>
          <button type="button" onClick={() => setScale((s) => Math.min(3, s + 0.15))} className="lanx-tool p-1.5 text-slate-500"><ZoomIn className="h-4 w-4" /></button>
        </div>

        <div className="flex-1 min-h-0 flex">
          {/* Pages */}
          <div className="w-[168px] shrink-0 border-r lanx-line overflow-y-auto p-2 space-y-2">
            {pages.map((p, i) => {
              const key = `${p.source}:${p.index}:${p.rotate}`;
              const { w, h } = shownSize(p);
              return (
                <div key={`${key}-${i}`} data-pdf-page={i} className={`relative rounded-lg border-2 p-1 ${i === cur ? "border-rose-500" : "border-transparent hover:border-slate-300"} ${p.deleted ? "opacity-40" : ""}`}>
                  <button type="button" onClick={() => { setCur(i); setSelected(-1); }} className="block w-full">
                    {thumbs[key] ? (
                      <img src={thumbs[key]} alt={`Page ${i + 1}`} className="w-full rounded bg-white shadow-sm" style={{ aspectRatio: `${w} / ${h}` }} />
                    ) : (
                      <div className="w-full rounded bg-white/60 animate-pulse" style={{ aspectRatio: `${w} / ${h}` }} />
                    )}
                  </button>
                  <div className="mt-1 flex items-center justify-between text-[10.5px] text-slate-500">
                    <label className="inline-flex items-center gap-1" title="Pick pages to save on their own">
                      <input type="checkbox" checked={picked.has(i)} onChange={(e) => setPicked((s) => { const n = new Set(s); e.target.checked ? n.add(i) : n.delete(i); return n; })} />
                      {i + 1}{p.deleted ? " · deleted" : ""}
                    </label>
                    <div className="flex items-center">
                      <button type="button" title="Rotate" onClick={() => rotatePage(i)} className="p-0.5 hover:text-slate-800"><RotateCw className="h-3 w-3" /></button>
                      <button type="button" title="Move up" onClick={() => movePage(i, -1)} className="p-0.5 hover:text-slate-800"><ArrowUp className="h-3 w-3" /></button>
                      <button type="button" title="Move down" onClick={() => movePage(i, 1)} className="p-0.5 hover:text-slate-800"><ArrowDown className="h-3 w-3" /></button>
                      <button type="button" data-pdf-delete-page={i} title={p.deleted ? "Keep this page" : "Delete this page"} onClick={() => togglePage(i)} className={`p-0.5 ${p.deleted ? "text-emerald-600" : "hover:text-red-600"}`}>{p.deleted ? <Undo2 className="h-3 w-3" /> : <Trash2 className="h-3 w-3" />}</button>
                    </div>
                  </div>
                </div>
              );
            })}
            {!pages.length && !busy && (
              <div className="text-[11.5px] text-slate-400 p-2 text-center">
                No pages yet.
                {!("__TAURI_INTERNALS__" in window) && (
                  <label className="block mt-2 text-sky-600 cursor-pointer">Choose a file<input type="file" accept=".pdf,image/*" multiple className="hidden" onChange={async (e) => { for (const f of Array.from(e.target.files ?? [])) await addSource(new Uint8Array(await f.arrayBuffer()), f.name); }} /></label>
                )}
              </div>
            )}
          </div>

          {/* Page */}
          <div ref={wrapRef} className="flex-1 min-w-0 overflow-auto bg-slate-200/60 dark:bg-black/30 p-6 relative">
            {busy && !pages.length && <div className="absolute inset-0 flex items-center justify-center text-slate-500 text-[13px] gap-2"><Loader2 className="h-4 w-4 animate-spin" /> {busy}</div>}
            {page && (
              <div className="relative mx-auto shadow-xl bg-white" style={{ width: shownSize(page).w * scale, height: shownSize(page).h * scale }}>
                <canvas
                  ref={canvasRef}
                  data-pdf-canvas
                  onPointerDown={onDown}
                  onPointerMove={onMove}
                  onPointerUp={onUp}
                  onPointerCancel={onUp}
                  style={{ width: "100%", height: "100%", cursor: tool === "select" ? "default" : tool === "pen" ? "crosshair" : tool === "text" ? "text" : "cell", touchAction: "none" }}
                />
                {page.deleted && <div className="absolute inset-0 bg-white/60 flex items-center justify-center text-[14px] font-semibold text-red-600">This page is deleted (press the ↶ under it to keep it)</div>}
                {pendingText && (
                  <textarea
                    autoFocus
                    data-pdf-text-input
                    value={pendingText.value}
                    onChange={(e) => setPendingText({ ...pendingText, value: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        commitText();
                      } else if (e.key === "Escape") setPendingText(null);
                    }}
                    onBlur={commitText}
                    rows={2}
                    placeholder="Type, Enter to place"
                    className="absolute bg-white/90 border border-sky-500 rounded px-1 text-slate-900 outline-none"
                    style={{ left: pendingText.x * scale, top: pendingText.y * scale, fontSize: textSize * scale, lineHeight: 1.25, minWidth: 160 }}
                  />
                )}
              </div>
            )}
            {page?.marks.some((m) => m.t === "erase") && (
              <div className="sticky bottom-0 mt-3 mx-auto w-fit rounded-full bg-slate-900/80 text-white text-[11.5px] px-3 py-1">Erased parts are removed from the file for good when you save (that page becomes a picture).</div>
            )}
          </div>
        </div>
      </div>

      {signPad && (
        <SignaturePad
          onClose={() => setSignPad(false)}
          onDone={async (png) => {
            setSignature(png);
            setSignPad(false);
            setTool("sign");
            try {
              await api.setPref("signature", JSON.stringify({ png }));
            } catch (e) {
              onError(errorText(e));
            }
          }}
        />
      )}
    </div>
  );
}

/** Draw a signature with the mouse (kept on this PC for next time). */
function SignaturePad({ onClose, onDone }: { onClose: () => void; onDone: (png: string) => void }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);
  const pos = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * ref.current!.width, y: ((e.clientY - r.top) / r.height) * ref.current!.height };
  };
  const down = (e: React.PointerEvent) => {
    drawing.current = true;
    const ctx = ref.current!.getContext("2d")!;
    const p = pos(e);
    ctx.strokeStyle = "#1e3a8a";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    const ctx = ref.current!.getContext("2d")!;
    const p = pos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    setEmpty(false);
  };
  const up = () => (drawing.current = false);
  const clear = () => {
    ref.current!.getContext("2d")!.clearRect(0, 0, ref.current!.width, ref.current!.height);
    setEmpty(true);
  };
  const done = () => {
    // Trim the empty space around the signature.
    const c = ref.current!;
    const ctx = c.getContext("2d")!;
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let minX = c.width, minY = c.height, maxX = 0, maxY = 0;
    for (let y = 0; y < c.height; y++)
      for (let x = 0; x < c.width; x++)
        if (d[(y * c.width + x) * 4 + 3] > 10) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
    if (maxX <= minX) return;
    const out = document.createElement("canvas");
    out.width = maxX - minX + 12;
    out.height = maxY - minY + 12;
    out.getContext("2d")!.drawImage(c, minX - 6, minY - 6, out.width, out.height, 0, 0, out.width, out.height);
    onDone(out.toDataURL("image/png"));
  };
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40" onMouseDown={onClose}>
      <div data-sign-pad className="rounded-[18px] lanx-sheet p-4 w-[560px] max-w-[94vw]" onMouseDown={(e) => e.stopPropagation()}>
        <div className="text-[14px] font-bold text-slate-900 dark:text-white mb-1">Draw your signature</div>
        <div className="text-[11.5px] text-slate-500 mb-2">Use the mouse (or a touch screen). It is kept on this PC for next time.</div>
        <canvas ref={ref} width={1000} height={360} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} className="w-full rounded-xl bg-white border border-slate-300 touch-none" style={{ aspectRatio: "1000 / 360", cursor: "crosshair" }} />
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={clear} className="px-3 py-1.5 rounded-full lanx-group text-[12px] font-semibold text-slate-700 dark:text-slate-200">Clear</button>
          <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-full text-[12px] font-semibold text-slate-600 dark:text-slate-300">Cancel</button>
          <button type="button" data-sign-done disabled={empty} onClick={done} className="px-4 py-1.5 rounded-full bg-rose-500 hover:bg-rose-600 disabled:opacity-40 text-white text-[12px] font-semibold">Use this signature</button>
        </div>
      </div>
    </div>
  );
}
