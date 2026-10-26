/** LANX 2.14.0: the rest of the PDF toolkit — finding text, page pictures,
 *  text export, compressing, page numbers / watermark / header & footer,
 *  filling forms, blank pages, printing and document properties. The
 *  editor's engine (pdfEngine.ts) draws pages and writes files; this file
 *  adds what the Tools tab does on top. */
import { PDFCheckBox, PDFDocument, PDFDropdown, PDFRadioGroup, PDFTextField, degrees, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { CSS, HEX, type PageState, type Source, paintMarks, renderPage, shownSize, warmMarks } from "./pdfEngine";

// ---------------------------------------------------------------- decorations (numbers, watermark, header & footer)

export type NumberPos = "bc" | "br" | "bl" | "tc" | "tr" | "tl";
export interface Decor {
  numbers?: { pos: NumberPos; format: "n" | "page-n" | "n-of-total"; start: number; size: number; skipFirst: boolean; color: string };
  watermark?: { text: string; color: string; size: number; opacity: number; diagonal: boolean };
  header?: { left: string; center: string; right: string; size: number; color: string };
  footer?: { left: string; center: string; right: string; size: number; color: string };
  props?: { title: string; author: string; subject: string };
}

/** One piece of text to draw on a page: (x, y) is the anchor in points from the top-left; rotated text is anchored at its centre. */
export interface DecorItem {
  text: string;
  x: number;
  y: number;
  size: number;
  color: string;
  opacity: number;
  align: "left" | "center" | "right";
  rotate?: number;
}

const WIN_ANSI_CHARS = /[^\x20-\x7E -ÿ€–—‘’“”•…]/g;
/** pdf-lib's built-in fonts know Western letters only. */
export const ansiOnly = (s: string) => s.replace(WIN_ANSI_CHARS, "?");

export function fillPlaceholders(t: string, pageNo: number, total: number, file: string): string {
  return t
    .replace(/\{page\}/gi, String(pageNo))
    .replace(/\{pages\}/gi, String(total))
    .replace(/\{date\}/gi, new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }))
    .replace(/\{file\}/gi, file);
}

export const hasDecor = (d: Decor | undefined) => !!d && !!(d.numbers || (d.watermark && d.watermark.text.trim()) || d.header || d.footer);

/** What to draw on page `pageNo` (1-based of `total`) of size w × h points. */
export function decorItems(d: Decor | undefined, pageNo: number, total: number, w: number, h: number, file: string): DecorItem[] {
  if (!d) return [];
  const out: DecorItem[] = [];
  const M = 28; // margin in points
  if (d.numbers && !(d.numbers.skipFirst && pageNo === 1)) {
    const n = d.numbers.start + pageNo - 1;
    const text = d.numbers.format === "page-n" ? `Page ${n}` : d.numbers.format === "n-of-total" ? `Page ${n} of ${d.numbers.start + total - 1}` : String(n);
    const top = d.numbers.pos.startsWith("t");
    const side = d.numbers.pos[1];
    out.push({ text, x: side === "l" ? M : side === "r" ? w - M : w / 2, y: top ? M - d.numbers.size : h - M, size: d.numbers.size, color: d.numbers.color, opacity: 1, align: side === "l" ? "left" : side === "r" ? "right" : "center" });
  }
  for (const [band, isHeader] of [[d.header, true], [d.footer, false]] as const) {
    if (!band) continue;
    const y = isHeader ? 14 : h - 14 - band.size;
    const parts: [string, DecorItem["align"], number][] = [[band.left, "left", M], [band.center, "center", w / 2], [band.right, "right", w - M]];
    for (const [t, align, x] of parts) {
      const text = fillPlaceholders(t, pageNo, total, file).trim();
      if (text) out.push({ text, x, y, size: band.size, color: band.color, opacity: 1, align });
    }
  }
  if (d.watermark && d.watermark.text.trim()) {
    out.push({ text: d.watermark.text.trim(), x: w / 2, y: h / 2, size: d.watermark.size, color: d.watermark.color, opacity: d.watermark.opacity, align: "center", rotate: d.watermark.diagonal ? -45 : 0 });
  }
  return out;
}

/** Draws decorations on a page canvas that shows the page at `scale` (the editor, the reader, flattened pages). */
export function paintDecor(ctx: CanvasRenderingContext2D, items: DecorItem[], scale: number) {
  for (const it of items) {
    ctx.save();
    ctx.globalAlpha = it.opacity;
    ctx.fillStyle = CSS[it.color] ?? CSS.grey;
    ctx.font = `${it.rotate !== undefined ? "bold " : ""}${it.size * scale}px Helvetica, Arial, sans-serif`;
    ctx.textBaseline = "top";
    if (it.rotate !== undefined) {
      ctx.translate(it.x * scale, it.y * scale);
      ctx.rotate((it.rotate * Math.PI) / 180);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(it.text, 0, 0);
    } else {
      ctx.textAlign = it.align;
      ctx.fillText(it.text, it.x * scale, it.y * scale);
    }
    ctx.restore();
  }
}

/** The same decorations written into the PDF page (vector text). `h` = page height in points. */
export function drawDecor(page: PDFPage, font: PDFFont, bold: PDFFont, items: DecorItem[], h: number) {
  for (const it of items) {
    const text = ansiOnly(it.text);
    const f = it.rotate !== undefined ? bold : font;
    const tw = f.widthOfTextAtSize(text, it.size);
    const [r, g, b] = HEX[it.color] ?? HEX.grey;
    if (it.rotate !== undefined) {
      const a = (it.rotate * Math.PI) / 180;
      // pdf-lib turns text about its bottom-left corner; start half a width back along the slope (and half a height down).
      const x = it.x - (tw / 2) * Math.cos(a) + (it.size / 2) * Math.sin(a);
      const y = h - it.y + (tw / 2) * Math.sin(a) - (it.size / 2) * Math.cos(a);
      page.drawText(text, { x, y, size: it.size, font: f, color: rgb(r, g, b), opacity: it.opacity, rotate: degrees(-it.rotate) });
    } else {
      const x = it.align === "left" ? it.x : it.align === "right" ? it.x - tw : it.x - tw / 2;
      page.drawText(text, { x, y: h - it.y - it.size * 0.95, size: it.size, font: f, color: rgb(r, g, b), opacity: it.opacity });
    }
  }
}

// ---------------------------------------------------------------- a page as a picture (the reader, printing, exports)

export interface PagePictureOpts {
  decor?: Decor;
  file?: string;
  /** Page number shown (1-based) and the number of live pages, for the decorations. */
  pageNo: number;
  total: number;
}

/** The page with its marks and decorations drawn, at `scale` pixels per point. */
export async function pagePicture(s: Source, p: PageState, scale: number, o: PagePictureOpts, canvas?: HTMLCanvasElement): Promise<HTMLCanvasElement> {
  await warmMarks(p.marks);
  const c = await renderPage(s, p, scale, canvas);
  const ctx = c.getContext("2d")!;
  paintMarks(ctx, p.marks, scale);
  const { w, h } = shownSize(p);
  paintDecor(ctx, decorItems(o.decor, o.pageNo, o.total, w, h, o.file ?? ""), scale);
  return c;
}

const livePages = (pages: PageState[]) => pages.map((p, i) => [p, i] as const).filter(([p]) => !p.deleted);

/** Every live page as a PNG or JPEG file (bytes + a file name). */
export async function pagesToImages(sources: Source[], pages: PageState[], dpi: number, type: "png" | "jpg", baseName: string, decor?: Decor, onProgress?: (done: number, total: number) => void): Promise<{ name: string; bytes: Uint8Array }[]> {
  const list = livePages(pages);
  const out: { name: string; bytes: Uint8Array }[] = [];
  const pad = String(list.length).length;
  for (let k = 0; k < list.length; k++) {
    const [p] = list[k];
    const c = await pagePicture(sources[p.source], p, dpi / 72, { decor, file: baseName, pageNo: k + 1, total: list.length });
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, type === "png" ? "image/png" : "image/jpeg", 0.9));
    out.push({ name: `${baseName}-p${String(k + 1).padStart(pad, "0")}.${type}`, bytes: new Uint8Array(await blob!.arrayBuffer()) });
    onProgress?.(k + 1, list.length);
  }
  return out;
}

// ---------------------------------------------------------------- text: finding and exporting

export interface TextItem {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
const itemCache = new Map<string, TextItem[]>();
const itemKey = (s: Source, p: PageState) => `${s.name}#${s.bytes.length}:${p.index}:${p.rotate}`;

/** The words on a page with where they are (points from the top-left, as shown). */
export async function pageItems(s: Source, p: PageState): Promise<TextItem[]> {
  const key = itemKey(s, p);
  const hit = itemCache.get(key);
  if (hit) return hit;
  const page = await s.doc.getPage(p.index + 1);
  const vp = page.getViewport({ scale: 1, rotation: (page.rotate + p.rotate) % 360 });
  const tc = await page.getTextContent();
  const items: TextItem[] = [];
  for (const it of tc.items) {
    if (!("str" in it) || !it.str.trim()) continue;
    const t = it.transform;
    const r = vp.convertToViewportRectangle([t[4], t[5], t[4] + it.width, t[5] + it.height]);
    items.push({ str: it.str, x: Math.min(r[0], r[2]), y: Math.min(r[1], r[3]), w: Math.abs(r[2] - r[0]), h: Math.abs(r[3] - r[1]) });
  }
  if (itemCache.size > 400) itemCache.clear();
  itemCache.set(key, items);
  return items;
}

export interface Hit {
  /** Index into `pages`. */
  page: number;
  rect: { x: number; y: number; w: number; h: number };
  snippet: string;
}

/** Every place the words appear (case does not matter), page by page. */
export async function findText(sources: Source[], pages: PageState[], query: string): Promise<Hit[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: Hit[] = [];
  for (const [p, i] of livePages(pages)) {
    const items = await pageItems(sources[p.source], p);
    for (const it of items) {
      const s = it.str.toLowerCase();
      let from = 0;
      while (from <= s.length - q.length) {
        const at = s.indexOf(q, from);
        if (at < 0) break;
        const horizontal = it.w >= it.h;
        const f0 = at / s.length;
        const f1 = (at + q.length) / s.length;
        const rect = horizontal ? { x: it.x + it.w * f0, y: it.y, w: Math.max(2, it.w * (f1 - f0)), h: it.h } : { x: it.x, y: it.y + it.h * f0, w: it.w, h: Math.max(2, it.h * (f1 - f0)) };
        hits.push({ page: i, rect, snippet: it.str });
        from = at + Math.max(1, q.length);
      }
    }
  }
  return hits;
}

/** All the text, page by page ("— Page 3 —" between pages). */
export async function allText(sources: Source[], pages: PageState[]): Promise<string> {
  const parts: string[] = [];
  const list = livePages(pages);
  for (let k = 0; k < list.length; k++) {
    const [p] = list[k];
    const page = await sources[p.source].doc.getPage(p.index + 1);
    const tc = await page.getTextContent();
    let line = "";
    let lastY: number | null = null;
    const lines: string[] = [];
    for (const it of tc.items) {
      if (!("str" in it)) continue;
      const y = it.transform[5];
      if (lastY !== null && Math.abs(y - lastY) > 2) {
        lines.push(line.trimEnd());
        line = "";
      }
      line += it.str + (it.hasEOL ? "\n" : "");
      lastY = y;
    }
    if (line.trim()) lines.push(line.trimEnd());
    parts.push(`— Page ${k + 1} —\n${lines.join("\n").replace(/\n{3,}/g, "\n\n")}`);
  }
  return parts.join("\n\n");
}

// ---------------------------------------------------------------- forms

export interface FormField {
  name: string;
  kind: "text" | "check" | "radio" | "dropdown" | "other";
  value: string | boolean;
  options?: string[];
  multiline?: boolean;
}

/** The fields of a fillable PDF (none for a plain document). */
export async function formFields(bytes: Uint8Array): Promise<FormField[]> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  let fields;
  try {
    fields = doc.getForm().getFields();
  } catch {
    return [];
  }
  return fields.map((f) => {
    const name = f.getName();
    if (f instanceof PDFTextField) return { name, kind: "text" as const, value: f.getText() ?? "", multiline: f.isMultiline() };
    if (f instanceof PDFCheckBox) return { name, kind: "check" as const, value: f.isChecked() };
    if (f instanceof PDFRadioGroup) return { name, kind: "radio" as const, value: f.getSelected() ?? "", options: f.getOptions() };
    if (f instanceof PDFDropdown) return { name, kind: "dropdown" as const, value: f.getSelected()[0] ?? "", options: f.getOptions() };
    return { name, kind: "other" as const, value: "" };
  });
}

/** The PDF with the fields filled in (and, if asked, flattened so they can't be changed again). */
export async function fillForm(bytes: Uint8Array, values: Record<string, string | boolean>, flatten: boolean): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const form = doc.getForm();
  for (const f of form.getFields()) {
    const v = values[f.getName()];
    if (v === undefined) continue;
    try {
      if (f instanceof PDFTextField) f.setText(ansiOnly(String(v)));
      else if (f instanceof PDFCheckBox) (v ? f.check() : f.uncheck());
      else if (f instanceof PDFRadioGroup && typeof v === "string" && v) f.select(v);
      else if (f instanceof PDFDropdown && typeof v === "string" && v) f.select(v);
    } catch {
      /* a field this PDF can't take: left as it was */
    }
  }
  try {
    form.updateFieldAppearances();
  } catch {
    /* some PDFs lack fonts for this; the values are still in the file */
  }
  if (flatten) form.flatten();
  return doc.save();
}

// ---------------------------------------------------------------- blank pages, properties

/** A one-page empty PDF of the given size (points). */
export async function blankPdf(w: number, h: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([w, h]);
  return doc.save();
}

export interface DocProps {
  title: string;
  author: string;
  subject: string;
  pages: number;
  bytes: number;
}

export async function readProps(bytes: Uint8Array): Promise<DocProps> {
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    return { title: doc.getTitle() ?? "", author: doc.getAuthor() ?? "", subject: doc.getSubject() ?? "", pages: doc.getPageCount(), bytes: bytes.length };
  } catch {
    return { title: "", author: "", subject: "", pages: 0, bytes: bytes.length };
  }
}

// ---------------------------------------------------------------- printing

/** Prints the live pages: they are drawn as pictures into a print-only part of the page, then Windows' print dialog opens. */
export async function printPages(sources: Source[], pages: PageState[], decor: Decor | undefined, file: string, onProgress?: (done: number, total: number) => void): Promise<void> {
  const list = livePages(pages);
  if (!list.length) return;
  const holder = document.createElement("div");
  holder.id = "lanx-print";
  const style = document.createElement("style");
  style.textContent = `#lanx-print{display:none}@media print{body>*:not(#lanx-print){display:none!important}#lanx-print{display:block!important}#lanx-print img{display:block;width:100%;height:auto;page-break-after:always;break-after:page}#lanx-print img:last-child{page-break-after:auto;break-after:auto}@page{margin:0}}`;
  holder.appendChild(style);
  for (let k = 0; k < list.length; k++) {
    const [p] = list[k];
    const c = await pagePicture(sources[p.source], p, 2, { decor, file, pageNo: k + 1, total: list.length });
    const img = document.createElement("img");
    img.src = c.toDataURL("image/jpeg", 0.9);
    const { w, h } = shownSize(p);
    img.style.aspectRatio = `${w} / ${h}`;
    holder.appendChild(img);
    onProgress?.(k + 1, list.length);
  }
  document.body.appendChild(holder);
  await new Promise((r) => setTimeout(r, 50));
  const done = () => {
    holder.remove();
    window.removeEventListener("afterprint", done);
  };
  window.addEventListener("afterprint", done);
  window.print();
  // Some WebViews never send afterprint: tidy up later anyway.
  setTimeout(done, 60_000);
}

/** Bytes as "1.2 MB". */
export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 2 : 1)} MB`;
}

/** "1-3, 7, 9-" → the 0-based page indexes (of `total` pages), in order, without repeats. */
export function parseRanges(text: string, total: number): number[] {
  const out: number[] = [];
  for (const part of text.split(/[,;\s]+/).filter(Boolean)) {
    const m = /^(\d*)-(\d*)$/.exec(part);
    let from: number;
    let to: number;
    if (m) {
      from = m[1] ? Number(m[1]) : 1;
      to = m[2] ? Number(m[2]) : total;
    } else if (/^\d+$/.test(part)) from = to = Number(part);
    else continue;
    for (let i = Math.max(1, from); i <= Math.min(total, to); i++) if (!out.includes(i - 1)) out.push(i - 1);
  }
  return out;
}

/** The split "1-3, 4-6" as groups of 0-based indexes (each group = one file). */
export function parseGroups(text: string, total: number): number[][] {
  return text
    .split(/[,;]+/)
    .map((g) => parseRanges(g, total))
    .filter((g) => g.length);
}
