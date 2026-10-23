/** LANX 2.5.0: the PDF tools' engine. pdf.js draws pages; pdf-lib writes the
 *  new file. Pages with an "erase" mark (or other things pdf-lib can't draw
 *  as vectors, like a signature on a rotated page) are flattened: the page is
 *  drawn to a picture with the marks on it and that picture replaces the
 *  page, so erased text is really gone from the file. */
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import type { PDFDocumentProxy } from "pdfjs-dist";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type Mark =
  | { t: "erase"; x: number; y: number; w: number; h: number }
  | { t: "highlight"; x: number; y: number; w: number; h: number; color: string }
  | { t: "pen"; points: { x: number; y: number }[]; color: string; width: number }
  | { t: "text"; x: number; y: number; text: string; size: number; color: string }
  | { t: "stamp"; x: number; y: number; text: string; color: string; size: number }
  | { t: "sign"; x: number; y: number; w: number; h: number; png: string };

/** One page of the document being edited. Coordinates of marks are in PDF
 *  points, origin top-left of the page as shown (after its own rotation). */
export interface PageState {
  /** Which loaded source (0 = the opened file, more after "Add pages"). */
  source: number;
  /** Page number inside that source (0-based). */
  index: number;
  /** Extra rotation added by the user (0/90/180/270). */
  rotate: number;
  deleted: boolean;
  marks: Mark[];
  /** Size in points as shown (rotation applied). */
  width: number;
  height: number;
  /** The page's own /Rotate in the file. */
  baseRotate: number;
}

export interface Source {
  bytes: Uint8Array;
  doc: PDFDocumentProxy;
  name: string;
}

export const HEX: Record<string, [number, number, number]> = {
  red: [0.86, 0.15, 0.15],
  green: [0.09, 0.64, 0.29],
  blue: [0.1, 0.45, 0.85],
  black: [0.1, 0.1, 0.1],
  yellow: [1, 0.9, 0.2],
  orange: [0.95, 0.55, 0.1],
  grey: [0.45, 0.47, 0.5],
};
export const CSS: Record<string, string> = {
  red: "#dc2626",
  green: "#16a34a",
  blue: "#1a73d9",
  black: "#1a1a1a",
  yellow: "#ffe633",
  orange: "#f28c1a",
  grey: "#73777f",
};

export async function openSource(bytes: Uint8Array, name: string): Promise<Source> {
  const doc = await pdfjs.getDocument({ data: bytes.slice(0) }).promise;
  return { bytes, doc, name };
}

/** Pages of a source, with their sizes, ready for the editor. */
export async function pagesOf(source: number, s: Source): Promise<PageState[]> {
  const out: PageState[] = [];
  for (let i = 0; i < s.doc.numPages; i++) {
    const page = await s.doc.getPage(i + 1);
    const vp = page.getViewport({ scale: 1 });
    out.push({ source, index: i, rotate: 0, deleted: false, marks: [], width: vp.width, height: vp.height, baseRotate: page.rotate });
  }
  return out;
}

/** Size of a page as shown with the user's extra rotation. */
export function shownSize(p: PageState): { w: number; h: number } {
  return p.rotate % 180 === 0 ? { w: p.width, h: p.height } : { w: p.height, h: p.width };
}

/** Draws a page (without marks) to a canvas at `scale` pixels per point. */
export async function renderPage(s: Source, p: PageState, scale: number, canvas?: HTMLCanvasElement): Promise<HTMLCanvasElement> {
  const page = await s.doc.getPage(p.index + 1);
  const vp = page.getViewport({ scale, rotation: (page.rotate + p.rotate) % 360 });
  const c = canvas ?? document.createElement("canvas");
  c.width = Math.max(1, Math.round(vp.width));
  c.height = Math.max(1, Math.round(vp.height));
  const ctx = c.getContext("2d", { alpha: false })!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport: vp, canvas: c }).promise;
  return c;
}

const signCache = new Map<string, HTMLImageElement>();
function signImage(png: string): HTMLImageElement {
  let img = signCache.get(png);
  if (!img) {
    img = new Image();
    img.src = png;
    signCache.set(png, img);
  }
  return img;
}
/** Loads the signature pictures a page uses, so painting is synchronous. */
export async function warmMarks(marks: Mark[]) {
  await Promise.all(
    marks
      .filter((m): m is Extract<Mark, { t: "sign" }> => m.t === "sign")
      .map((m) => {
        const img = signImage(m.png);
        return img.complete ? Promise.resolve() : new Promise<void>((r) => ((img.onload = () => r()), (img.onerror = () => r())));
      })
  );
}

/** Paints marks on a canvas that shows the page at `scale`. Used for the
 *  editor and for flattening, so both look the same. */
export function paintMarks(ctx: CanvasRenderingContext2D, marks: Mark[], scale: number, selected = -1) {
  marks.forEach((m, i) => {
    ctx.save();
    switch (m.t) {
      case "erase":
        ctx.fillStyle = "#fff";
        ctx.fillRect(m.x * scale, m.y * scale, m.w * scale, m.h * scale);
        break;
      case "highlight":
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = CSS[m.color] ?? CSS.yellow;
        ctx.fillRect(m.x * scale, m.y * scale, m.w * scale, m.h * scale);
        break;
      case "pen":
        ctx.strokeStyle = CSS[m.color] ?? CSS.black;
        ctx.lineWidth = m.width * scale;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        m.points.forEach((pt, j) => (j ? ctx.lineTo(pt.x * scale, pt.y * scale) : ctx.moveTo(pt.x * scale, pt.y * scale)));
        if (m.points.length === 1) ctx.lineTo(m.points[0].x * scale + 0.1, m.points[0].y * scale);
        ctx.stroke();
        break;
      case "text":
        ctx.fillStyle = CSS[m.color] ?? CSS.black;
        ctx.font = `${m.size * scale}px Helvetica, Arial, sans-serif`;
        ctx.textBaseline = "top";
        m.text.split("\n").forEach((line, j) => ctx.fillText(line, m.x * scale, (m.y + j * m.size * 1.25) * scale));
        break;
      case "stamp": {
        const col = CSS[m.color] ?? CSS.red;
        ctx.font = `bold ${m.size * scale}px Helvetica, Arial, sans-serif`;
        ctx.textBaseline = "top";
        const pad = m.size * 0.45 * scale;
        const tw = ctx.measureText(m.text).width;
        ctx.strokeStyle = col;
        ctx.lineWidth = Math.max(1, m.size * 0.12 * scale);
        ctx.globalAlpha = 0.9;
        roundRect(ctx, m.x * scale - pad, m.y * scale - pad * 0.6, tw + pad * 2, m.size * scale + pad * 1.2, pad * 0.6);
        ctx.stroke();
        ctx.fillStyle = col;
        ctx.fillText(m.text, m.x * scale, m.y * scale);
        break;
      }
      case "sign": {
        const img = signImage(m.png);
        if (img.complete && img.naturalWidth) ctx.drawImage(img, m.x * scale, m.y * scale, m.w * scale, m.h * scale);
        break;
      }
    }
    ctx.restore();
    if (i === selected) {
      const b = bounds(m, ctx);
      ctx.save();
      ctx.strokeStyle = "#0ea5e9";
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1.5;
      ctx.strokeRect(b.x * scale - 3, b.y * scale - 3, b.w * scale + 6, b.h * scale + 6);
      ctx.restore();
    }
  });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** The box a mark covers, in points. */
export function bounds(m: Mark, ctx?: CanvasRenderingContext2D): { x: number; y: number; w: number; h: number } {
  switch (m.t) {
    case "erase":
    case "highlight":
    case "sign":
      return { x: m.x, y: m.y, w: m.w, h: m.h };
    case "pen": {
      const xs = m.points.map((p) => p.x);
      const ys = m.points.map((p) => p.y);
      const pad = m.width / 2;
      return { x: Math.min(...xs) - pad, y: Math.min(...ys) - pad, w: Math.max(...xs) - Math.min(...xs) + m.width, h: Math.max(...ys) - Math.min(...ys) + m.width };
    }
    case "text": {
      const lines = m.text.split("\n");
      const longest = Math.max(...lines.map((l) => l.length), 1);
      let w = longest * m.size * 0.55;
      if (ctx) {
        ctx.save();
        ctx.font = `${m.size}px Helvetica, Arial, sans-serif`;
        w = Math.max(...lines.map((l) => ctx.measureText(l).width), 4);
        ctx.restore();
      }
      return { x: m.x, y: m.y, w, h: lines.length * m.size * 1.25 };
    }
    case "stamp": {
      let w = m.text.length * m.size * 0.65;
      if (ctx) {
        ctx.save();
        ctx.font = `bold ${m.size}px Helvetica, Arial, sans-serif`;
        w = ctx.measureText(m.text).width;
        ctx.restore();
      }
      const pad = m.size * 0.45;
      return { x: m.x - pad, y: m.y - pad * 0.6, w: w + pad * 2, h: m.size + pad * 1.2 };
    }
  }
}

export function moveMark(m: Mark, dx: number, dy: number): Mark {
  if (m.t === "pen") return { ...m, points: m.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
  return { ...m, x: m.x + dx, y: m.y + dy };
}

const WIN_ANSI = /^[\x20-\x7E -ÿ€–—‘’“”•…]*$/;

/** Does this page have to become a picture? (erased parts must really go;
 *  pdf-lib's built-in fonts only know Western letters; rotated pages are
 *  simpler to flatten than to transform). */
export function mustFlatten(p: PageState): boolean {
  if (!p.marks.length) return false;
  if (p.baseRotate % 360 !== 0 || p.rotate % 360 !== 0) return true;
  return p.marks.some((m) => m.t === "erase" || m.t === "sign" || ((m.t === "text" || m.t === "stamp") && !WIN_ANSI.test(m.text)));
}

/** Builds the new PDF from the pages (in order, skipping deleted ones). */
export async function buildPdf(sources: Source[], pages: PageState[], only?: Set<number>): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  const loaded = new Map<number, PDFDocument>();
  const font = await out.embedFont(StandardFonts.Helvetica);
  const bold = await out.embedFont(StandardFonts.HelveticaBold);
  const list = pages.map((p, i) => [p, i] as const).filter(([p, i]) => !p.deleted && (!only || only.has(i)));
  for (const [p] of list) {
    if (mustFlatten(p)) {
      // 2.2 px per point ≈ 160 dpi: crisp enough for office papers, not huge.
      await warmMarks(p.marks);
      const c = await renderPage(sources[p.source], p, 2.2);
      const ctx = c.getContext("2d")!;
      paintMarks(ctx, p.marks, 2.2);
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.88));
      const jpg = await out.embedJpg(new Uint8Array(await blob!.arrayBuffer()));
      const { w, h } = shownSize(p);
      const page = out.addPage([w, h]);
      page.drawImage(jpg, { x: 0, y: 0, width: w, height: h });
      continue;
    }
    let src = loaded.get(p.source);
    if (!src) {
      src = await PDFDocument.load(sources[p.source].bytes, { ignoreEncryption: true });
      loaded.set(p.source, src);
    }
    const [copied] = await out.copyPages(src, [p.index]);
    const page = out.addPage(copied);
    if (p.rotate) page.setRotation(degrees((p.baseRotate + p.rotate) % 360));
    const H = p.height;
    for (const m of p.marks) {
      switch (m.t) {
        case "highlight": {
          const [r, g, b] = HEX[m.color] ?? HEX.yellow;
          page.drawRectangle({ x: m.x, y: H - m.y - m.h, width: m.w, height: m.h, color: rgb(r, g, b), opacity: 0.35 });
          break;
        }
        case "pen": {
          const [r, g, b] = HEX[m.color] ?? HEX.black;
          const pts = m.points.length === 1 ? [m.points[0], { x: m.points[0].x + 0.1, y: m.points[0].y }] : m.points;
          for (let i = 1; i < pts.length; i++) {
            page.drawLine({
              start: { x: pts[i - 1].x, y: H - pts[i - 1].y },
              end: { x: pts[i].x, y: H - pts[i].y },
              thickness: m.width,
              color: rgb(r, g, b),
              lineCap: 1,
            });
          }
          break;
        }
        case "text": {
          const [r, g, b] = HEX[m.color] ?? HEX.black;
          m.text.split("\n").forEach((line, j) => {
            page.drawText(line, { x: m.x, y: H - m.y - j * m.size * 1.25 - m.size * 0.95, size: m.size, font, color: rgb(r, g, b) });
          });
          break;
        }
        case "stamp": {
          const [r, g, b] = HEX[m.color] ?? HEX.red;
          const tw = bold.widthOfTextAtSize(m.text, m.size);
          const pad = m.size * 0.45;
          page.drawRectangle({
            x: m.x - pad,
            y: H - m.y - m.size - pad * 0.6,
            width: tw + pad * 2,
            height: m.size + pad * 1.2,
            borderColor: rgb(r, g, b),
            borderWidth: Math.max(1, m.size * 0.12),
            opacity: 0,
            borderOpacity: 0.9,
          });
          page.drawText(m.text, { x: m.x, y: H - m.y - m.size * 0.95, size: m.size, font: bold, color: rgb(r, g, b) });
          break;
        }
      }
    }
  }
  if (!out.getPageCount()) throw new Error("There are no pages left to save.");
  out.setProducer("LANX PDF tools");
  out.setModificationDate(new Date());
  return out.save();
}

/** A picture as a one-page PDF (fits an A4 sheet, keeps the proportions). */
export async function imageToPdf(bytes: Uint8Array, name: string): Promise<Uint8Array> {
  const lower = name.toLowerCase();
  let data = bytes;
  let isPng = lower.endsWith(".png");
  if (!isPng && !(lower.endsWith(".jpg") || lower.endsWith(".jpeg"))) {
    // Other picture types: go through a canvas → PNG.
    const blob = new Blob([bytes.slice(0)]);
    const bmp = await createImageBitmap(blob);
    const c = document.createElement("canvas");
    c.width = bmp.width;
    c.height = bmp.height;
    c.getContext("2d")!.drawImage(bmp, 0, 0);
    const png = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"));
    data = new Uint8Array(await png!.arrayBuffer());
    isPng = true;
  }
  const doc = await PDFDocument.create();
  const img = isPng ? await doc.embedPng(data) : await doc.embedJpg(data);
  const A4 = { w: 595.28, h: 841.89 };
  const landscape = img.width > img.height;
  const sheet = landscape ? { w: A4.h, h: A4.w } : A4;
  const margin = 24;
  const s = Math.min((sheet.w - margin * 2) / img.width, (sheet.h - margin * 2) / img.height, 1);
  const w = img.width * s;
  const h = img.height * s;
  const page = doc.addPage([sheet.w, sheet.h]);
  page.drawImage(img, { x: (sheet.w - w) / 2, y: (sheet.h - h) / 2, width: w, height: h });
  return doc.save();
}

/** Words on a page (used by tests to check that erased text is gone). */
export async function pageText(s: Source, index: number): Promise<string> {
  const page = await s.doc.getPage(index + 1);
  const tc = await page.getTextContent();
  return tc.items.map((it) => ("str" in it ? it.str : "")).join(" ");
}
