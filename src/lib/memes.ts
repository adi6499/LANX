/** LANX 2.6.0: the hidden meme & GIF picker (type `/meme` in a chat).
 *
 *  Two free sources: Imgflip's public list of classic meme templates (the
 *  captions are drawn by LANX itself, no account needed) and Tenor for GIFs
 *  and stickers (needs a free key, entered once in the picker; the strictest
 *  content filter is on). Favourites and recent memes stay on this PC. */
import { api } from "./api";

export type MemeSource = "imgflip" | "tenor" | "mine";

export interface MemeItem {
  id: string;
  source: MemeSource;
  title: string;
  /** Small picture for the grid. */
  preview: string;
  /** The real file (same as preview for templates). */
  full: string;
  kind: "image" | "gif";
  width?: number;
  height?: number;
  /** Imgflip: how many text boxes the template usually has. */
  boxes?: number;
}

export interface MemePrefs {
  tenorKey: string;
}
export const DEFAULT_MEME_PREFS: MemePrefs = { tenorKey: "" };

const TEMPLATE_CACHE_DAYS = 7;
const RECENT_MAX = 48;

// ------------------------------------------------------------ preferences

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const v = await api.getPref(key);
    return v ? { ...fallback, ...(JSON.parse(v) as Partial<T>) } : fallback;
  } catch {
    return fallback;
  }
}
async function readList(key: string): Promise<MemeItem[]> {
  try {
    const v = await api.getPref(key);
    const list = v ? (JSON.parse(v) as MemeItem[]) : [];
    return Array.isArray(list) ? list.filter((m) => m && typeof m.id === "string" && typeof m.full === "string") : [];
  } catch {
    return [];
  }
}
export const loadMemePrefs = () => readJson<MemePrefs>("memes", DEFAULT_MEME_PREFS);
export const saveMemePrefs = (p: MemePrefs) => api.setPref("memes", JSON.stringify(p));
export const loadFavourites = () => readList("memes_fav");
export const loadRecent = () => readList("memes_recent");
export async function toggleFavourite(item: MemeItem): Promise<MemeItem[]> {
  const favs = await loadFavourites();
  const next = favs.some((f) => f.id === item.id) ? favs.filter((f) => f.id !== item.id) : [item, ...favs];
  await api.setPref("memes_fav", JSON.stringify(next));
  return next;
}
export async function rememberRecent(item: MemeItem): Promise<void> {
  const recent = await loadRecent();
  const next = [item, ...recent.filter((r) => r.id !== item.id)].slice(0, RECENT_MAX);
  await api.setPref("memes_recent", JSON.stringify(next)).catch(() => {});
}

// ------------------------------------------------------------ Imgflip templates

interface ImgflipMeme {
  id: string;
  name: string;
  url: string;
  width: number;
  height: number;
  box_count: number;
}

/** The classic templates (cached for a week, so the picker works offline). */
export async function loadTemplates(force = false): Promise<MemeItem[]> {
  const cache = await readJson<{ at: number; items: MemeItem[] }>("memes_cache", { at: 0, items: [] });
  const fresh = Date.now() - cache.at < TEMPLATE_CACHE_DAYS * 86_400_000;
  if (!force && fresh && cache.items.length) return cache.items;
  try {
    const res = await fetch("https://api.imgflip.com/get_memes");
    if (!res.ok) throw new Error(`Imgflip answered ${res.status}`);
    const data = (await res.json()) as { success: boolean; data?: { memes: ImgflipMeme[] } };
    const items: MemeItem[] = (data.data?.memes ?? []).map((m) => ({
      id: `imgflip-${m.id}`,
      source: "imgflip",
      title: m.name,
      preview: m.url,
      full: m.url,
      kind: "image",
      width: m.width,
      height: m.height,
      boxes: m.box_count,
    }));
    if (items.length) {
      await api.setPref("memes_cache", JSON.stringify({ at: Date.now(), items })).catch(() => {});
      return items;
    }
  } catch (e) {
    if (cache.items.length) return cache.items;
    throw e;
  }
  return cache.items;
}

// ------------------------------------------------------------ Tenor GIFs

interface TenorResult {
  id: string;
  title?: string;
  content_description?: string;
  media_formats: Record<string, { url: string; dims?: number[] }>;
}

function tenorItem(r: TenorResult): MemeItem | null {
  const gif = r.media_formats.gif ?? r.media_formats.mediumgif;
  const small = r.media_formats.tinygif ?? r.media_formats.nanogif ?? gif;
  if (!gif || !small) return null;
  return {
    id: `tenor-${r.id}`,
    source: "tenor",
    title: r.content_description || r.title || "GIF",
    preview: small.url,
    full: gif.url,
    kind: "gif",
    width: gif.dims?.[0],
    height: gif.dims?.[1],
  };
}

async function tenor(path: string, key: string, params: Record<string, string>): Promise<{ results: TenorResult[]; next?: string }> {
  const q = new URLSearchParams({ key, client_key: "lanx", contentfilter: "high", media_filter: "gif,tinygif,nanogif", ...params });
  const res = await fetch(`https://tenor.googleapis.com/v2/${path}?${q.toString()}`);
  if (res.status === 400 || res.status === 403) throw new Error("Tenor did not accept the key. Check it in the GIFs tab.");
  if (!res.ok) throw new Error(`Tenor answered ${res.status}`);
  return (await res.json()) as { results: TenorResult[]; next?: string };
}

export async function tenorSearch(key: string, query: string, limit = 30): Promise<MemeItem[]> {
  const q = query.trim();
  const data = q ? await tenor("search", key, { q, limit: String(limit) }) : await tenor("featured", key, { limit: String(limit) });
  return data.results.map(tenorItem).filter((m): m is MemeItem => !!m);
}

export async function tenorCategories(key: string): Promise<string[]> {
  try {
    const q = new URLSearchParams({ key, client_key: "lanx", contentfilter: "high", type: "featured" });
    const res = await fetch(`https://tenor.googleapis.com/v2/categories?${q.toString()}`);
    if (!res.ok) return [];
    const data = (await res.json()) as { tags?: { searchterm: string; name: string }[] };
    return (data.tags ?? []).map((t) => t.searchterm).slice(0, 16);
  } catch {
    return [];
  }
}

// ------------------------------------------------------------ pictures → files

/** A picture or GIF from the internet as bytes (through the page's own fetch). */
export async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not fetch the picture (${res.status}).`);
  return new Uint8Array(await res.arrayBuffer());
}

export function extOf(url: string, kind: MemeItem["kind"]): "png" | "jpg" | "gif" | "webp" {
  const m = /\.(png|jpe?g|gif|webp)(\?|$)/i.exec(url);
  const e = (m?.[1] ?? "").toLowerCase();
  if (e === "jpeg") return "jpg";
  if (e === "png" || e === "jpg" || e === "gif" || e === "webp") return e;
  return kind === "gif" ? "gif" : "png";
}

/** Saves bytes in LANX's meme folder; returns the file path. */
export async function saveMeme(bytes: Uint8Array, ext: string, name: string): Promise<string> {
  const saved = await api.saveMemeFile(bytes, ext, name);
  return saved.file;
}

/** The item as a file on this PC (fetched or, for a captioned meme, drawn). */
export async function materialize(item: MemeItem): Promise<string> {
  if (item.source === "mine" && item.full.startsWith("blob:")) {
    const bytes = await fetchBytes(item.full);
    return saveMeme(bytes, "png", item.title);
  }
  const bytes = await fetchBytes(item.full);
  return saveMeme(bytes, extOf(item.full, item.kind), item.title);
}

// ------------------------------------------------------------ captions (drawn by LANX)

export interface Caption {
  top: string;
  bottom: string;
  /** Text size relative to the picture (1 = normal). */
  size: number;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const probe = line ? `${line} ${w}` : w;
    if (ctx.measureText(probe).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else line = probe;
  }
  if (line) lines.push(line);
  return lines;
}

function drawBlock(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number, fromBottom: boolean) {
  const lines = wrap(ctx, text.toUpperCase(), maxWidth);
  const start = fromBottom ? y - (lines.length - 1) * lineHeight : y;
  lines.forEach((l, i) => {
    const yy = start + i * lineHeight;
    ctx.strokeText(l, x, yy);
    ctx.fillText(l, x, yy);
  });
}

/** The template with the captions drawn on it, as PNG bytes (and a preview URL). */
export async function captionTemplate(url: string, caption: Caption): Promise<{ bytes: Uint8Array; previewUrl: string }> {
  const bytes = await fetchBytes(url);
  const blob = new Blob([bytes.slice(0).buffer]);
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No drawing surface");
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const base = Math.max(18, Math.round(Math.min(canvas.width, canvas.height) / 9));
  const px = Math.round(base * (caption.size || 1));
  ctx.font = `bold ${px}px Impact, "Arial Black", "Segoe UI", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = Math.max(2, Math.round(px / 10));
  ctx.lineJoin = "round";
  const maxWidth = canvas.width * 0.92;
  const lineHeight = Math.round(px * 1.1);
  if (caption.top.trim()) drawBlock(ctx, caption.top, canvas.width / 2, Math.round(canvas.height * 0.03), maxWidth, lineHeight, false);
  if (caption.bottom.trim()) {
    ctx.textBaseline = "bottom";
    drawBlock(ctx, caption.bottom, canvas.width / 2, Math.round(canvas.height * 0.97), maxWidth, lineHeight, true);
  }
  const out: Blob = await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not make the picture"))), "image/png"));
  return { bytes: new Uint8Array(await out.arrayBuffer()), previewUrl: URL.createObjectURL(out) };
}

/** A captioned meme as an item (kept in Recent / Favourites with its preview). */
export function mineItem(previewUrl: string, title: string): MemeItem {
  return { id: `mine-${Date.now()}`, source: "mine", title, preview: previewUrl, full: previewUrl, kind: "image" };
}
