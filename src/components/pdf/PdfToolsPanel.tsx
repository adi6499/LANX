// LANX 2.14.0: the Tools tab of the PDF tools — merge, split, compress,
// pages → pictures, the text, page numbers, watermark, header & footer,
// fill a form, blank / duplicate pages, properties, print.
import { useEffect, useMemo, useState } from "react";
import { Copy, FileImage, FileText, FolderOpen, Hash, Info, Layers, ListOrdered, Printer, Scissors, Shrink, Stamp, TextCursorInput } from "lucide-react";
import { api, errorText } from "../../lib/api";
import { CSS, buildPdf, shownSize, type PageState, type Source } from "../../lib/pdfEngine";
import { allText, blankPdf, fillForm, fmtBytes, formFields, pagesToImages, parseGroups, readProps, type Decor, type DocProps, type FormField, type NumberPos } from "../../lib/pdfTools";

export interface ToolsProps {
  sources: Source[];
  pages: PageState[];
  setPages: React.Dispatch<React.SetStateAction<PageState[]>>;
  cur: number;
  picked: Set<number>;
  decor: Decor;
  setDecor: (d: Decor) => void;
  /** The file's name without .pdf. */
  file: string;
  busy: string | null;
  setBusy: (t: string | null) => void;
  notify: (t: string) => void;
  addPages: () => Promise<void>;
  addSource: (bytes: Uint8Array, name: string, at?: number) => Promise<number>;
  replaceSource: (index: number, bytes: Uint8Array) => Promise<void>;
  onSave: () => void;
  onPrint: () => void;
  onSaved: (path: string) => void;
}

type ToolId = "merge" | "split" | "compress" | "images" | "text" | "numbers" | "watermark" | "headfoot" | "form" | "pages" | "props" | "print";
const TOOLS: { id: ToolId; label: string; icon: React.ElementType; blurb: string }[] = [
  { id: "merge", label: "Merge", icon: Layers, blurb: "Several PDFs (or pictures) into one" },
  { id: "split", label: "Split", icon: Scissors, blurb: "One PDF into several" },
  { id: "compress", label: "Compress", icon: Shrink, blurb: "A smaller file for e-mail or WhatsApp" },
  { id: "images", label: "Pages → pictures", icon: FileImage, blurb: "Every page as a PNG or JPG" },
  { id: "text", label: "Text", icon: Copy, blurb: "Copy or save all the words" },
  { id: "numbers", label: "Page numbers", icon: Hash, blurb: "Numbered pages" },
  { id: "watermark", label: "Watermark", icon: Stamp, blurb: "CONFIDENTIAL, DRAFT, your company…" },
  { id: "headfoot", label: "Header & footer", icon: ListOrdered, blurb: "A line at the top or bottom of every page" },
  { id: "form", label: "Fill a form", icon: TextCursorInput, blurb: "Type into the fields of a fillable PDF" },
  { id: "pages", label: "Blank / duplicate page", icon: FileText, blurb: "Add an empty page, repeat a page" },
  { id: "props", label: "Properties", icon: Info, blurb: "Title, author, subject, size" },
  { id: "print", label: "Print", icon: Printer, blurb: "To any printer, or Microsoft Print to PDF" },
];
const COLORS = ["grey", "black", "blue", "red", "green", "orange"];
const RASTER = {
  sharp: { scale: 2, quality: 0.8, label: "Still sharp", hint: "about 145 dpi — fine to print" },
  smaller: { scale: 1.4, quality: 0.72, label: "Smaller", hint: "about 100 dpi — fine on screen" },
  smallest: { scale: 1, quality: 0.6, label: "Smallest", hint: "72 dpi — for WhatsApp" },
} as const;

const field = "lanx-field rounded-lg px-2.5 py-1.5 text-[12.5px] text-slate-900 dark:text-white";
const btnP = "px-3.5 py-1.5 rounded-full bg-rose-500 hover:bg-rose-600 disabled:opacity-40 text-white text-[12px] font-semibold inline-flex items-center gap-1.5";
const btnS = "px-3 py-1.5 rounded-full lanx-group text-[12px] font-semibold text-slate-700 dark:text-slate-200 inline-flex items-center gap-1.5 disabled:opacity-40";
const label = "block text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-1";

function Colours({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex items-center gap-1">
      {COLORS.map((c) => (
        <button key={c} type="button" onClick={() => onChange(c)} title={c} className={`h-5 w-5 rounded-full border ${value === c ? "ring-2 ring-sky-500 ring-offset-1" : "border-black/10"}`} style={{ backgroundColor: CSS[c] }} />
      ))}
    </div>
  );
}

function Toggle({ on, onChange, children }: { on: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="inline-flex items-center gap-2 text-[12.5px] text-slate-800 dark:text-slate-100 cursor-pointer">
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} /> {children}
    </label>
  );
}

export function PdfToolsPanel(p: ToolsProps) {
  const [tool, setTool] = useState<ToolId>("merge");
  const live = useMemo(() => p.pages.map((pg, i) => ({ pg, i })).filter((x) => !x.pg.deleted), [p.pages]);
  const total = live.length;
  const sizeNow = useMemo(() => p.sources.reduce((a, s) => a + s.bytes.length, 0), [p.sources]);
  const hasDoc = p.sources.length > 0 && total > 0;
  const [doneFolder, setDoneFolder] = useState<string | null>(null);
  const folderName = (f: string) => f.split(/[\\/]/).filter(Boolean).pop() ?? f;

  // ---- split
  const [splitMode, setSplitMode] = useState<"each" | "ranges" | "picked">("each");
  const [ranges, setRanges] = useState("");
  const split = async () => {
    let groups: number[][];
    if (splitMode === "each") groups = live.map((x) => [x.i]);
    else if (splitMode === "ranges") groups = parseGroups(ranges, total).map((g) => g.map((k) => live[k].i));
    else groups = [[...p.picked].filter((i) => !p.pages[i]?.deleted)];
    if (!groups.length || groups.every((g) => !g.length)) return p.notify(splitMode === "picked" ? "Tick some pages in the Edit tab first." : "Say which pages go together — for example 1-3, 4-6, 7.");
    const folder = await api.pickFolder("Where should the split PDFs go?").catch(() => null);
    if (!folder) return;
    p.setBusy("Splitting…");
    try {
      const pad = String(groups.length).length;
      let n = 0;
      for (const [k, g] of groups.entries()) {
        if (!g.length) continue;
        const bytes = await buildPdf(p.sources, p.pages, new Set(g), { decor: p.decor, file: p.file });
        const name = splitMode === "each" ? `${p.file}-page${String(k + 1).padStart(pad, "0")}.pdf` : splitMode === "picked" ? `${p.file}-picked.pdf` : `${p.file}-part${k + 1}.pdf`;
        await api.saveFileInFolder(folder, name, bytes);
        n++;
        p.setBusy(`Splitting… ${n} of ${groups.length}`);
      }
      setDoneFolder(folder);
      p.notify(`${n} PDF${n === 1 ? "" : "s"} saved in ${folderName(folder)}`);
    } catch (e) {
      p.notify(errorText(e));
    } finally {
      p.setBusy(null);
    }
  };

  // ---- compress
  const [level, setLevel] = useState<keyof typeof RASTER>("smaller");
  const [shrunk, setShrunk] = useState<{ before: number; after: number } | null>(null);
  const compress = async () => {
    p.setBusy("Compressing…");
    try {
      const r = RASTER[level];
      const bytes = await buildPdf(p.sources, p.pages, undefined, { decor: p.decor, file: p.file, raster: { scale: r.scale, quality: r.quality } });
      setShrunk({ before: sizeNow, after: bytes.length });
      if (bytes.length >= sizeNow) {
        p.notify(`This PDF is already small: as pictures it would grow from ${fmtBytes(sizeNow)} to ${fmtBytes(bytes.length)}, so nothing was saved.`);
        return;
      }
      const path = await api.saveFileBytes(`${p.file}-small.pdf`, bytes, "pdf");
      if (path) {
        p.onSaved(path);
        p.notify(`Saved: ${fmtBytes(sizeNow)} → ${fmtBytes(bytes.length)}`);
      }
    } catch (e) {
      p.notify(errorText(e));
    } finally {
      p.setBusy(null);
    }
  };

  // ---- pictures
  const [imgType, setImgType] = useState<"png" | "jpg">("png");
  const [dpi, setDpi] = useState(150);
  const toImages = async () => {
    const folder = await api.pickFolder("Where should the pictures go?").catch(() => null);
    if (!folder) return;
    p.setBusy("Drawing pages…");
    try {
      const files = await pagesToImages(p.sources, p.pages, dpi, imgType, p.file, p.decor, (d, t) => p.setBusy(`Drawing page ${d} of ${t}…`));
      for (const f of files) await api.saveFileInFolder(folder, f.name, f.bytes);
      setDoneFolder(folder);
      p.notify(`${files.length} picture${files.length === 1 ? "" : "s"} saved in ${folderName(folder)}`);
    } catch (e) {
      p.notify(errorText(e));
    } finally {
      p.setBusy(null);
    }
  };

  // ---- text
  const [textPreview, setTextPreview] = useState<string | null>(null);
  useEffect(() => {
    if (tool !== "text" || !hasDoc) return;
    let alive = true;
    allText(p.sources, p.pages).then((t) => alive && setTextPreview(t)).catch(() => alive && setTextPreview(""));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, p.sources, p.pages]);
  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(textPreview ?? "");
      p.notify("The text is copied — paste it anywhere.");
    } catch (e) {
      p.notify(errorText(e));
    }
  };
  const saveText = async () => {
    try {
      const path = await api.saveTextFile(`${p.file}.txt`, textPreview ?? "", "txt");
      if (path) p.notify(`Saved: ${path.split(/[\\/]/).pop()}`);
    } catch (e) {
      p.notify(errorText(e));
    }
  };

  // ---- forms
  const [fields, setFields] = useState<FormField[] | null>(null);
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [flatten, setFlatten] = useState(false);
  useEffect(() => {
    if (tool !== "form" || p.sources.length !== 1) return;
    let alive = true;
    formFields(p.sources[0].bytes)
      .then((f) => {
        if (!alive) return;
        setFields(f);
        setValues(Object.fromEntries(f.map((x) => [x.name, x.value])));
      })
      .catch(() => alive && setFields([]));
    return () => {
      alive = false;
    };
  }, [tool, p.sources]);
  const applyForm = async () => {
    p.setBusy("Filling the form…");
    try {
      const bytes = await fillForm(p.sources[0].bytes, values, flatten);
      await p.replaceSource(0, bytes);
      p.notify(flatten ? "Filled and locked. Save PDF… keeps it." : "Filled. Save PDF… keeps it (the fields stay fillable).");
    } catch (e) {
      p.notify(errorText(e));
    } finally {
      p.setBusy(null);
    }
  };

  // ---- blank / duplicate
  const curPage = p.pages[p.cur];
  const addBlank = async () => {
    const { w, h } = curPage ? shownSize(curPage) : { w: 595.28, h: 841.89 };
    p.setBusy("Adding a page…");
    try {
      await p.addSource(await blankPdf(w, h), "Blank page.pdf", p.cur + 1);
      p.notify(`A blank page went in after page ${p.cur + 1}.`);
    } catch (e) {
      p.notify(errorText(e));
    } finally {
      p.setBusy(null);
    }
  };
  const duplicate = () => {
    if (!curPage) return;
    p.setPages((ps) => [...ps.slice(0, p.cur + 1), { ...curPage, marks: curPage.marks.map((m) => ({ ...m })), deleted: false }, ...ps.slice(p.cur + 1)]);
    p.notify(`Page ${p.cur + 1} is repeated right after itself.`);
  };

  // ---- properties
  const [props, setProps] = useState<DocProps | null>(null);
  useEffect(() => {
    if (tool !== "props" || !p.sources.length) return;
    let alive = true;
    readProps(p.sources[0].bytes).then((d) => {
      if (!alive) return;
      setProps(d);
      if (!p.decor.props) p.setDecor({ ...p.decor, props: { title: d.title, author: d.author, subject: d.subject } });
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, p.sources]);

  const d = p.decor;
  const numbers = d.numbers;
  const wm = d.watermark;
  const setNumbers = (on: boolean) => p.setDecor({ ...d, numbers: on ? { pos: "bc", format: "n-of-total", start: 1, size: 10, skipFirst: false, color: "grey" } : undefined });
  const setWm = (on: boolean) => p.setDecor({ ...d, watermark: on ? { text: "CONFIDENTIAL", color: "red", size: 72, opacity: 0.18, diagonal: true } : undefined });
  const band = (which: "header" | "footer", on: boolean) => p.setDecor({ ...d, [which]: on ? { left: which === "header" ? "{file}" : "", center: "", right: which === "header" ? "{date}" : "Page {page} of {pages}", size: 9, color: "grey" } : undefined });

  const needDoc = <div className="text-[12.5px] text-slate-500">Open a PDF first (Add pages… at the top).</div>;

  return (
    <div className="flex-1 min-h-0 flex" data-pdf-tools>
      <div className="w-[228px] shrink-0 border-r lanx-line overflow-y-auto p-2 space-y-0.5">
        {TOOLS.map((t) => (
          <button key={t.id} type="button" data-pdf-tool-pick={t.id} onClick={() => setTool(t.id)} className={`w-full flex items-start gap-2.5 rounded-xl px-2.5 py-2 text-left ${tool === t.id ? "bg-rose-500 text-white" : "hover:bg-[var(--lanx-fill)] text-slate-800 dark:text-slate-100"}`}>
            <t.icon className={`h-4 w-4 mt-0.5 shrink-0 ${tool === t.id ? "text-white" : "text-rose-500"}`} />
            <span className="min-w-0">
              <span className="block text-[12.5px] font-semibold leading-tight">{t.label}</span>
              <span className={`block text-[10.5px] leading-tight ${tool === t.id ? "text-white/80" : "text-slate-500"}`}>{t.blurb}</span>
            </span>
          </button>
        ))}
      </div>
      <div className="flex-1 min-w-0 overflow-y-auto p-5 space-y-4" data-pdf-tool-form={tool}>
        {tool === "merge" && (
          <>
            <h3 className="text-[15px] font-bold text-slate-900 dark:text-white">Merge PDFs and pictures</h3>
            <p className="text-[12.5px] text-slate-600 dark:text-slate-300">Add as many PDFs, photos or scans as you like; they line up after the pages you have. Put them in order in the Edit tab (the arrows under each page), then save the whole thing as one PDF.</p>
            <div className="text-[12.5px] text-slate-500">{p.sources.length ? `${p.sources.length} file${p.sources.length === 1 ? "" : "s"} open · ${total} page${total === 1 ? "" : "s"}` : "Nothing open yet."}</div>
            <div className="flex flex-wrap gap-2">
              <button type="button" data-pdf-merge-add onClick={() => void p.addPages()} className={btnS}><Layers className="h-3.5 w-3.5" /> Add PDFs or pictures…</button>
              <button type="button" data-pdf-merge-save onClick={p.onSave} disabled={!hasDoc || !!p.busy} className={btnP}>Save the merged PDF…</button>
            </div>
          </>
        )}
        {tool === "split" && (
          <>
            <h3 className="text-[15px] font-bold text-slate-900 dark:text-white">Split into several PDFs</h3>
            {!hasDoc ? needDoc : (
              <>
                <div className="space-y-2 text-[12.5px] text-slate-800 dark:text-slate-100">
                  <label className="flex items-center gap-2"><input type="radio" name="split" checked={splitMode === "each"} onChange={() => setSplitMode("each")} /> Every page as its own PDF ({total} file{total === 1 ? "" : "s"})</label>
                  <label className="flex items-center gap-2"><input type="radio" name="split" checked={splitMode === "ranges"} onChange={() => setSplitMode("ranges")} /> By page ranges</label>
                  {splitMode === "ranges" && <input data-pdf-split-ranges value={ranges} onChange={(e) => setRanges(e.target.value)} placeholder={`for example 1-3, 4-6, 7-${total}`} className={`${field} ml-6 w-[320px]`} />}
                  <label className="flex items-center gap-2"><input type="radio" name="split" checked={splitMode === "picked"} onChange={() => setSplitMode("picked")} /> The pages ticked in the Edit tab ({p.picked.size}) as one PDF</label>
                </div>
                <div className="flex flex-wrap gap-2 items-center">
                  <button type="button" data-pdf-split-go onClick={() => void split()} disabled={!!p.busy} className={btnP}><Scissors className="h-3.5 w-3.5" /> Split and save into a folder…</button>
                  {doneFolder && <button type="button" data-pdf-open-folder onClick={() => api.openFolder(doneFolder).catch((e) => p.notify(errorText(e)))} className={btnS}><FolderOpen className="h-3.5 w-3.5" /> Open {folderName(doneFolder)}</button>}
                </div>
              </>
            )}
          </>
        )}
        {tool === "compress" && (
          <>
            <h3 className="text-[15px] font-bold text-slate-900 dark:text-white">Compress</h3>
            {!hasDoc ? needDoc : (
              <>
                <p className="text-[12.5px] text-slate-600 dark:text-slate-300">Every page is redrawn as a picture, so scans and photo-heavy PDFs shrink a lot. Words can no longer be searched or copied in the small copy — the original stays as it is. Now: <b>{fmtBytes(sizeNow)}</b>.</p>
                <div className="flex flex-wrap gap-2">
                  {(Object.keys(RASTER) as (keyof typeof RASTER)[]).map((k) => (
                    <button key={k} type="button" data-pdf-compress-level={k} onClick={() => setLevel(k)} className={`rounded-xl px-3 py-2 text-left ${level === k ? "bg-rose-500 text-white" : "lanx-group text-slate-800 dark:text-slate-100"}`}>
                      <span className="block text-[12.5px] font-semibold">{RASTER[k].label}</span>
                      <span className={`block text-[10.5px] ${level === k ? "text-white/80" : "text-slate-500"}`}>{RASTER[k].hint}</span>
                    </button>
                  ))}
                </div>
                {shrunk && <div data-pdf-compress-result className="text-[12.5px] text-emerald-700 dark:text-emerald-300 font-semibold">{fmtBytes(shrunk.before)} → {fmtBytes(shrunk.after)}</div>}
                <button type="button" data-pdf-compress-go onClick={() => void compress()} disabled={!!p.busy} className={btnP}><Shrink className="h-3.5 w-3.5" /> Compress and save…</button>
              </>
            )}
          </>
        )}
        {tool === "images" && (
          <>
            <h3 className="text-[15px] font-bold text-slate-900 dark:text-white">Pages → pictures</h3>
            {!hasDoc ? needDoc : (
              <>
                <div className="flex flex-wrap items-center gap-4 text-[12.5px] text-slate-800 dark:text-slate-100">
                  <label className="flex items-center gap-2">Type
                    <select value={imgType} onChange={(e) => setImgType(e.target.value as "png" | "jpg")} className={field}><option value="png">PNG (sharp)</option><option value="jpg">JPG (smaller)</option></select>
                  </label>
                  <label className="flex items-center gap-2">Quality
                    <select value={dpi} onChange={(e) => setDpi(Number(e.target.value))} className={field}><option value={96}>96 dpi — screen</option><option value={150}>150 dpi — documents</option><option value={200}>200 dpi — print</option><option value={300}>300 dpi — large</option></select>
                  </label>
                </div>
                <div className="flex flex-wrap gap-2 items-center">
                  <button type="button" data-pdf-images-go onClick={() => void toImages()} disabled={!!p.busy} className={btnP}><FileImage className="h-3.5 w-3.5" /> Save {total} picture{total === 1 ? "" : "s"} into a folder…</button>
                  {doneFolder && <button type="button" data-pdf-open-folder onClick={() => api.openFolder(doneFolder).catch((e) => p.notify(errorText(e)))} className={btnS}><FolderOpen className="h-3.5 w-3.5" /> Open {folderName(doneFolder)}</button>}
                </div>
              </>
            )}
          </>
        )}
        {tool === "text" && (
          <>
            <h3 className="text-[15px] font-bold text-slate-900 dark:text-white">The text</h3>
            {!hasDoc ? needDoc : (
              <>
                <div className="flex flex-wrap gap-2">
                  <button type="button" data-pdf-text-copy onClick={() => void copyText()} disabled={textPreview === null} className={btnP}><Copy className="h-3.5 w-3.5" /> Copy all the text</button>
                  <button type="button" data-pdf-text-save onClick={() => void saveText()} disabled={textPreview === null} className={btnS}>Save as .txt…</button>
                </div>
                <textarea data-pdf-text-preview readOnly value={textPreview ?? "Reading…"} className={`${field} w-full h-[46vh] font-mono text-[11.5px] whitespace-pre`} />
                <p className="text-[11.5px] text-slate-500">Scanned pages (pictures of text) have no words to copy.</p>
              </>
            )}
          </>
        )}
        {tool === "numbers" && (
          <>
            <h3 className="text-[15px] font-bold text-slate-900 dark:text-white">Page numbers</h3>
            <Toggle on={!!numbers} onChange={setNumbers}>Number the pages (shown in Read and Edit; written when you save)</Toggle>
            {numbers && (
              <div className="grid grid-cols-2 gap-3 max-w-[560px]" data-pdf-numbers>
                <label><span className={label}>Where</span>
                  <select value={numbers.pos} onChange={(e) => p.setDecor({ ...d, numbers: { ...numbers, pos: e.target.value as NumberPos } })} className={`${field} w-full`}>
                    <option value="bc">Bottom, centre</option><option value="br">Bottom, right</option><option value="bl">Bottom, left</option><option value="tc">Top, centre</option><option value="tr">Top, right</option><option value="tl">Top, left</option>
                  </select>
                </label>
                <label><span className={label}>Looks like</span>
                  <select value={numbers.format} onChange={(e) => p.setDecor({ ...d, numbers: { ...numbers, format: e.target.value as "n" | "page-n" | "n-of-total" } })} className={`${field} w-full`}>
                    <option value="n">1</option><option value="page-n">Page 1</option><option value="n-of-total">Page 1 of {total}</option>
                  </select>
                </label>
                <label><span className={label}>Start at</span><input type="number" min={0} value={numbers.start} onChange={(e) => p.setDecor({ ...d, numbers: { ...numbers, start: Math.max(0, Number(e.target.value) || 0) } })} className={`${field} w-full`} /></label>
                <label><span className={label}>Size</span><input type="number" min={6} max={24} value={numbers.size} onChange={(e) => p.setDecor({ ...d, numbers: { ...numbers, size: Math.min(24, Math.max(6, Number(e.target.value) || 10)) } })} className={`${field} w-full`} /></label>
                <div><span className={label}>Colour</span><Colours value={numbers.color} onChange={(c) => p.setDecor({ ...d, numbers: { ...numbers, color: c } })} /></div>
                <div className="self-end"><Toggle on={numbers.skipFirst} onChange={(v) => p.setDecor({ ...d, numbers: { ...numbers, skipFirst: v } })}>Not on the first page</Toggle></div>
              </div>
            )}
          </>
        )}
        {tool === "watermark" && (
          <>
            <h3 className="text-[15px] font-bold text-slate-900 dark:text-white">Watermark</h3>
            <Toggle on={!!wm} onChange={setWm}>Put a watermark on every page</Toggle>
            {wm && (
              <div className="grid grid-cols-2 gap-3 max-w-[560px]" data-pdf-watermark>
                <label className="col-span-2"><span className={label}>Words</span><input data-pdf-watermark-text value={wm.text} onChange={(e) => p.setDecor({ ...d, watermark: { ...wm, text: e.target.value.slice(0, 40) } })} className={`${field} w-full`} placeholder="CONFIDENTIAL" /></label>
                <div className="col-span-2 flex flex-wrap gap-1.5">
                  {["CONFIDENTIAL", "DRAFT", "COPY", "INTERNAL", "SAMPLE", "PAID", "VOID"].map((s) => (
                    <button key={s} type="button" onClick={() => p.setDecor({ ...d, watermark: { ...wm, text: s } })} className={`px-2 py-0.5 rounded-md text-[11px] font-bold border ${wm.text === s ? "border-rose-500 text-rose-600" : "border-slate-300 text-slate-500"}`}>{s}</button>
                  ))}
                </div>
                <label><span className={label}>Size · {wm.size}</span><input type="range" min={24} max={140} value={wm.size} onChange={(e) => p.setDecor({ ...d, watermark: { ...wm, size: Number(e.target.value) } })} className="w-full" /></label>
                <label><span className={label}>Strength · {Math.round(wm.opacity * 100)}%</span><input type="range" min={5} max={70} value={Math.round(wm.opacity * 100)} onChange={(e) => p.setDecor({ ...d, watermark: { ...wm, opacity: Number(e.target.value) / 100 } })} className="w-full" /></label>
                <div><span className={label}>Colour</span><Colours value={wm.color} onChange={(c) => p.setDecor({ ...d, watermark: { ...wm, color: c } })} /></div>
                <div className="self-end"><Toggle on={wm.diagonal} onChange={(v) => p.setDecor({ ...d, watermark: { ...wm, diagonal: v } })}>Diagonal</Toggle></div>
              </div>
            )}
          </>
        )}
        {tool === "headfoot" && (
          <>
            <h3 className="text-[15px] font-bold text-slate-900 dark:text-white">Header & footer</h3>
            <p className="text-[12px] text-slate-500">You can write <code>{"{page}"}</code>, <code>{"{pages}"}</code>, <code>{"{date}"}</code> and <code>{"{file}"}</code> — they become the page number, the number of pages, today's date and the file's name.</p>
            {(["header", "footer"] as const).map((which) => {
              const b = d[which];
              return (
                <div key={which} className="rounded-xl lanx-group p-3 space-y-2 max-w-[640px]" data-pdf-band={which}>
                  <Toggle on={!!b} onChange={(v) => band(which, v)}>{which === "header" ? "A line at the top of every page" : "A line at the bottom of every page"}</Toggle>
                  {b && (
                    <>
                      <div className="grid grid-cols-3 gap-2">
                        {(["left", "center", "right"] as const).map((side) => (
                          <label key={side}><span className={label}>{side}</span><input value={b[side]} onChange={(e) => p.setDecor({ ...d, [which]: { ...b, [side]: e.target.value.slice(0, 80) } })} className={`${field} w-full`} /></label>
                        ))}
                      </div>
                      <div className="flex items-center gap-4">
                        <label className="text-[12px] text-slate-600 dark:text-slate-300 inline-flex items-center gap-2">Size <input type="number" min={6} max={18} value={b.size} onChange={(e) => p.setDecor({ ...d, [which]: { ...b, size: Math.min(18, Math.max(6, Number(e.target.value) || 9)) } })} className={`${field} w-16`} /></label>
                        <Colours value={b.color} onChange={(c) => p.setDecor({ ...d, [which]: { ...b, color: c } })} />
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </>
        )}
        {tool === "form" && (
          <>
            <h3 className="text-[15px] font-bold text-slate-900 dark:text-white">Fill a form</h3>
            {!hasDoc ? needDoc : p.sources.length !== 1 ? (
              <div className="text-[12.5px] text-slate-500">Open just the form (one PDF) to fill it in.</div>
            ) : fields === null ? (
              <div className="text-[12.5px] text-slate-500">Looking for fields…</div>
            ) : !fields.length ? (
              <div className="text-[12.5px] text-slate-500" data-pdf-form-none>This PDF has no fillable fields. Use <b>Text</b> in the Edit tab to write on it instead.</div>
            ) : (
              <>
                <div className="space-y-2 max-w-[640px]" data-pdf-form-fields>
                  {fields.map((f) => (
                    <label key={f.name} className="flex items-center gap-3 text-[12.5px] text-slate-800 dark:text-slate-100" data-pdf-form-field={f.name}>
                      <span className="w-[200px] shrink-0 truncate text-slate-600 dark:text-slate-300" title={f.name}>{f.name}</span>
                      {f.kind === "text" && (f.multiline ? <textarea value={String(values[f.name] ?? "")} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })} rows={3} className={`${field} flex-1`} /> : <input value={String(values[f.name] ?? "")} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })} className={`${field} flex-1`} />)}
                      {f.kind === "check" && <input type="checkbox" checked={!!values[f.name]} onChange={(e) => setValues({ ...values, [f.name]: e.target.checked })} />}
                      {(f.kind === "radio" || f.kind === "dropdown") && (
                        <select value={String(values[f.name] ?? "")} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })} className={`${field} flex-1`}>
                          <option value="">—</option>
                          {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                      )}
                      {f.kind === "other" && <span className="text-slate-400">(a button or a signature field)</span>}
                    </label>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <button type="button" data-pdf-form-apply onClick={() => void applyForm()} disabled={!!p.busy} className={btnP}><TextCursorInput className="h-3.5 w-3.5" /> Put the answers in</button>
                  <Toggle on={flatten} onChange={setFlatten}>Lock the fields (nobody can change them later)</Toggle>
                </div>
                <p className="text-[11.5px] text-slate-500">Then <b>Save PDF…</b> at the top. Marks you drew on this file are cleared when the answers go in, so fill the form first.</p>
              </>
            )}
          </>
        )}
        {tool === "pages" && (
          <>
            <h3 className="text-[15px] font-bold text-slate-900 dark:text-white">Blank page · duplicate page</h3>
            {!hasDoc ? needDoc : (
              <>
                <p className="text-[12.5px] text-slate-600 dark:text-slate-300">Both go in right after page {p.cur + 1} (the page picked in the Edit tab). Rotate, delete and reorder pages there too — under each page.</p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" data-pdf-blank-add onClick={() => void addBlank()} disabled={!!p.busy} className={btnP}><FileText className="h-3.5 w-3.5" /> Add a blank page after page {p.cur + 1}</button>
                  <button type="button" data-pdf-duplicate onClick={duplicate} disabled={!!p.busy || !curPage} className={btnS}><Copy className="h-3.5 w-3.5" /> Duplicate page {p.cur + 1}</button>
                </div>
              </>
            )}
          </>
        )}
        {tool === "props" && (
          <>
            <h3 className="text-[15px] font-bold text-slate-900 dark:text-white">Properties</h3>
            {!hasDoc ? needDoc : (
              <>
                <div className="text-[12.5px] text-slate-600 dark:text-slate-300" data-pdf-props-info>{p.sources[0].name} · {total} page{total === 1 ? "" : "s"} · {fmtBytes(sizeNow)}{props && props.pages !== total ? ` (${props.pages} in the file)` : ""}</div>
                <div className="grid gap-3 max-w-[560px]">
                  {(["title", "author", "subject"] as const).map((k) => (
                    <label key={k}><span className={label}>{k}</span><input data-pdf-prop={k} value={d.props?.[k] ?? ""} onChange={(e) => p.setDecor({ ...d, props: { title: "", author: "", subject: "", ...(d.props ?? {}), [k]: e.target.value.slice(0, 200) } })} className={`${field} w-full`} /></label>
                  ))}
                </div>
                <p className="text-[11.5px] text-slate-500">Written into the file when you save.</p>
              </>
            )}
          </>
        )}
        {tool === "print" && (
          <>
            <h3 className="text-[15px] font-bold text-slate-900 dark:text-white">Print</h3>
            {!hasDoc ? needDoc : (
              <>
                <p className="text-[12.5px] text-slate-600 dark:text-slate-300">Prints the {total} page{total === 1 ? "" : "s"} as you see them (marks, numbers and watermark included) on any printer — or choose <b>Microsoft Print to PDF</b> in the print box.</p>
                <button type="button" data-pdf-print-go onClick={p.onPrint} disabled={!!p.busy} className={btnP}><Printer className="h-3.5 w-3.5" /> Print…</button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
