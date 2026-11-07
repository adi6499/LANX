/** LANX 3.9.0: Present to everyone — the page pictures and what goes on the wire.
 *
 *  The presenter's PC turns a page (of a PDF, or one of the pictures) into a JPEG
 *  only when it is needed (≤ 1600 px wide, kept under ~600 KB) and sends it once
 *  to each colleague watching: the current page first, then the next two, so
 *  turning the page is usually instant on their screens too.
 *
 *  On the wire (kind "present"), whole numbers only:
 *   - state, host → all (publish):  { title, page, pages, pointer: null }   page is 0-based
 *   - blob,  host → one (sendBlob):  { page, w, h, base64 }                 a JPEG of that page
 *   - status, host → one:            { x, y, p }   the pointer on page p, 0–10000 across and
 *                                                  down the page; x = y = -1 when off the page
 *   - status, member → host:         { want }      a page it doesn't have (looking back)
 */
import { type Session, type Step, publish, sendBlob, tell, together } from "./together";
import type { Source } from "./pdfEngine";

export type PresentState = { title: string; page: number; pages: number; pointer: null };

/** A page as a picture. */
export interface Pic {
  page: number;
  w: number;
  h: number;
  /** An object URL (this PC only). */
  url: string;
}
interface HostPic extends Pic {
  blob: Blob;
  base64?: string;
}

const MAX_W = 1600;
const MAX_H = 2000;
const BUDGET = 600 * 1024;
const MAX_PAGES = 500;
/** Pointer: at most this often (ms), and only while it moves. */
const POINTER_MS = 100;

const isInt = (v: unknown, lo: number, hi: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function toBlob(c: HTMLCanvasElement, q: number): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Could not make the page picture."))), "image/jpeg", q));
}
function base64Of(b: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).slice(String(r.result).indexOf(",") + 1));
    r.onerror = () => rej(r.error ?? new Error("Could not read the picture."));
    r.readAsDataURL(b);
  });
}
/** Waits until the browser has decoded the picture, so showing it never flashes. */
async function decoded(url: string) {
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch {
    /* shown anyway */
  }
}
function shrink(c: HTMLCanvasElement, f: number): HTMLCanvasElement {
  const d = document.createElement("canvas");
  d.width = Math.max(1, Math.round(c.width * f));
  d.height = Math.max(1, Math.round(c.height * f));
  const ctx = d.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(c, 0, 0, d.width, d.height);
  return d;
}
/** JPEG at ~0.8; less (then smaller) until it fits the budget. */
async function jpegWithin(c: HTMLCanvasElement, budget: number): Promise<{ blob: Blob; w: number; h: number }> {
  let cv = c;
  for (let round = 0; round < 4; round++) {
    for (const q of [0.8, 0.68, 0.56]) {
      const blob = await toBlob(cv, q);
      if (blob.size <= budget || (round === 3 && q === 0.56)) return { blob, w: cv.width, h: cv.height };
    }
    cv = shrink(cv, 0.8);
  }
  throw new Error("unreachable");
}

// ------------------------------------------------------------------ the deck (presenter's PC)

type Raster = (i: number, maxW: number, maxH: number) => Promise<HTMLCanvasElement>;
interface Job {
  key: string;
  prio: number;
  order: number;
  run: () => Promise<void>;
  /** Called instead of run when the deck is closed first. */
  drop?: () => void;
}

/** What is being shown: its pages, drawn one at a time, only when asked for. */
export class Deck {
  readonly title: string;
  readonly pages: number;
  readonly kind: "pdf" | "pictures";
  private raster: Raster;
  private closeSource: () => void;
  private pics = new Map<number, Promise<HostPic>>();
  private done = new Map<number, HostPic>();
  private thumbs = new Map<number, Promise<string>>();
  private used = new Map<number, number>();
  private queue: Job[] = [];
  private running = false;
  private order = 0;
  private urgentN = 0;
  private gone = false;
  /** Pages near this one are kept when the cache is trimmed. */
  current = 0;

  private constructor(kind: "pdf" | "pictures", title: string, pages: number, raster: Raster, close: () => void) {
    this.kind = kind;
    this.title = title;
    this.pages = pages;
    this.raster = raster;
    this.closeSource = close;
  }

  /** A PDF, or pictures (jpg/png/webp). One PDF wins over pictures. */
  static async open(files: File[]): Promise<Deck> {
    const pdf = files.find((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name));
    const stem = (n: string) => n.replace(/\.[^.]+$/, "");
    if (pdf) {
      const eng = await import("./pdfEngine");
      let src: Source;
      try {
        src = await eng.openSource(new Uint8Array(await pdf.arrayBuffer()), pdf.name);
      } catch (e) {
        const name = (e as { name?: string })?.name;
        throw new Error(name === "PasswordException" ? "This PDF has a password. Save a copy without one, then present that." : `This PDF could not be opened (${errText(e)}).`);
      }
      const n = Math.min(src.doc.numPages, MAX_PAGES);
      if (!n) throw new Error("This PDF has no pages.");
      const raster: Raster = async (i, maxW, maxH) => {
        const page = await src.doc.getPage(i + 1);
        const vp = page.getViewport({ scale: 1, rotation: page.rotate });
        const scale = Math.min(maxW / vp.width, maxH / vp.height, 6);
        return eng.renderPage(src, { source: 0, index: i, rotate: 0, deleted: false, marks: [], width: vp.width, height: vp.height, baseRotate: page.rotate }, scale);
      };
      return new Deck("pdf", stem(pdf.name), n, raster, () => void src.doc.destroy());
    }
    // In name order (photo-2 before photo-10): a file window hands them over in its own order.
    const pics = files
      .filter((f) => /^image\/(jpeg|png|webp)$/.test(f.type) || /\.(jpe?g|png|webp)$/i.test(f.name))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }))
      .slice(0, MAX_PAGES);
    if (!pics.length) throw new Error("Choose a PDF, or pictures (JPG, PNG or WebP).");
    const raster: Raster = async (i, maxW, maxH) => {
      let bmp: ImageBitmap;
      try {
        bmp = await createImageBitmap(pics[i]);
      } catch {
        throw new Error(`${pics[i].name} could not be read as a picture.`);
      }
      const s = Math.min(1, maxW / bmp.width, maxH / bmp.height);
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(bmp.width * s));
      c.height = Math.max(1, Math.round(bmp.height * s));
      const ctx = c.getContext("2d", { alpha: false })!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bmp, 0, 0, c.width, c.height);
      bmp.close();
      return c;
    };
    const title = pics.length === 1 ? stem(pics[0].name) : `${stem(pics[0].name)} and ${pics.length - 1} more`;
    return new Deck("pictures", title, pics.length, raster, () => {});
  }

  /** One drawing at a time: the page on screen first, then the newest urgent one, the
   *  pages next to it and pages colleagues asked for, then thumbnails. A page that was
   *  urgent but has since been skipped past waits behind those. */
  private rank(j: Job) {
    if (j.key === `p${this.current}`) return -1e12;
    // (Urgent is only ever asked for the page on screen: one that isn't any more was skipped.)
    return j.prio < 0 ? 3 : j.prio;
  }
  private schedule(key: string, prio: number, run: () => Promise<void>, drop?: () => void) {
    const had = this.queue.find((j) => j.key === key);
    if (had) {
      had.prio = Math.min(had.prio, prio);
      return;
    }
    if (this.gone) return drop?.();
    this.queue.push({ key, prio, order: this.order++, run, drop });
    void this.pump();
  }
  private async pump() {
    if (this.running) return;
    this.running = true;
    while (this.queue.length && !this.gone) {
      this.queue.sort((a, b) => this.rank(a) - this.rank(b) || a.order - b.order);
      const job = this.queue.shift()!;
      try {
        await job.run();
      } catch {
        /* the asker hears about it */
      }
    }
    this.running = false;
  }

  /** Page `i` as a JPEG (drawn once, kept). `urgent`: before everything waiting. */
  picture(i: number, urgent = false): Promise<Pic> {
    return this.hostPic(i, urgent);
  }
  private hostPic(i: number, urgent: boolean, prio = 1): Promise<HostPic> {
    this.used.set(i, performance.now());
    const p = urgent ? -++this.urgentN : prio;
    let had = this.pics.get(i);
    if (had) {
      if (!this.done.has(i)) this.schedule(`p${i}`, p, async () => {});
      return had;
    }
    had = new Promise<HostPic>((res, rej) => {
      this.schedule(`p${i}`, p, async () => {
        try {
          const c = await this.raster(i, MAX_W, MAX_H);
          const { blob, w, h } = await jpegWithin(c, BUDGET);
          c.width = 0;
          const url = URL.createObjectURL(blob);
          await decoded(url);
          const pic: HostPic = { page: i, w, h, url, blob };
          if (this.gone) URL.revokeObjectURL(url);
          else this.done.set(i, pic);
          res(pic);
          this.trim();
        } catch (e) {
          this.pics.delete(i);
          rej(e);
        }
      }, () => rej(new Error("The presentation has ended.")));
    });
    had.catch(() => {});
    this.pics.set(i, had);
    return had;
  }
  /** The page as base64 for the wire (made once). */
  async wire(i: number, prio = 1): Promise<{ base64: string; w: number; h: number }> {
    const pic = await this.hostPic(i, false, prio);
    if (!pic.base64) pic.base64 = await base64Of(pic.blob);
    return { base64: pic.base64, w: pic.w, h: pic.h };
  }
  /** Already drawn? (no waiting) */
  ready(i: number): Pic | null {
    return this.done.get(i) ?? null;
  }
  /** A small picture for the strip (object URL). */
  thumb(i: number): Promise<string> {
    let had = this.thumbs.get(i);
    if (had) return had;
    had = new Promise<string>((res, rej) => {
      this.schedule(`t${i}`, 10 + i / 1000, async () => {
        try {
          const c = await this.raster(i, 220, 300);
          const b = await toBlob(c, 0.72);
          c.width = 0;
          res(URL.createObjectURL(b));
        } catch (e) {
          this.thumbs.delete(i);
          rej(e);
        }
      }, () => rej(new Error("The presentation has ended.")));
    });
    had.catch(() => {});
    this.thumbs.set(i, had);
    return had;
  }
  /** Big decks: keep at most ~40 page pictures (never the ones near the current page). */
  private trim() {
    if (this.done.size <= 40) return;
    const keep = (i: number) => i >= this.current - 2 && i <= this.current + 3;
    const old = [...this.done.keys()].filter((i) => !keep(i)).sort((a, b) => (this.used.get(a) ?? 0) - (this.used.get(b) ?? 0));
    for (const i of old.slice(0, this.done.size - 40)) {
      URL.revokeObjectURL(this.done.get(i)!.url);
      this.done.delete(i);
      this.pics.delete(i);
    }
  }
  dispose() {
    if (this.gone) return;
    this.gone = true;
    const left = this.queue;
    this.queue = [];
    for (const j of left) j.drop?.();
    for (const p of this.done.values()) URL.revokeObjectURL(p.url);
    for (const t of this.thumbs.values()) void t.then((u) => URL.revokeObjectURL(u), () => {});
    this.done.clear();
    this.pics.clear();
    try {
      this.closeSource();
    } catch {
      /* already closed */
    }
  }
}

// ------------------------------------------------------------------ the presenter (host side of a session)

interface Out {
  /** Pages still to send, in order. */
  queue: number[];
  busy: number | null;
  failed: string | null;
}

export class Presenter {
  readonly deck: Deck;
  readonly session: Session;
  /** The title colleagues see (the presenter may have changed the file name). */
  readonly title: string;
  page = 0;
  /** Who couldn't be invited when it started, and why. */
  notInvited: { name: string; why: string }[] = [];
  /** member → pages they have. */
  private have = new Map<string, Set<number>>();
  private out = new Map<string, Out>();
  private listeners = new Set<() => void>();
  private ver = 0;
  private ptr = { next: { x: -1, y: -1, p: 0 }, sent: "", last: 0, timer: 0 };
  private ptrOut = new Map<string, { busy: boolean; pending: { x: number; y: number; p: number } | null }>();
  private gone = false;

  constructor(deck: Deck, session: Session) {
    this.deck = deck;
    this.session = session;
    const st = session.state as PresentState | null;
    this.title = (st && typeof st.title === "string" && st.title) || deck.title;
    this.page = st && isInt(st.page, 0, deck.pages - 1) ? st.page : 0;
    deck.current = this.page;
    void deck.picture(this.page, true);
    for (const id of session.members.keys()) this.joined(id);
  }

  // -- for the screen
  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  };
  version = () => this.ver;
  private changed() {
    this.ver += 1;
    for (const l of this.listeners) l();
  }
  /** Has this colleague got the page on screen? */
  hasPage(memberId: string, page = this.page) {
    return this.have.get(memberId)?.has(page) ?? false;
  }
  problem(memberId: string) {
    return this.out.get(memberId)?.failed ?? null;
  }

  /** Turn to page `i`: everyone follows. */
  go(i: number) {
    const page = Math.max(0, Math.min(this.deck.pages - 1, Math.round(i)));
    if (page === this.page || this.gone) return;
    this.page = page;
    this.deck.current = page;
    void this.deck.picture(page, true);
    publish(this.session, { title: this.title, page, pages: this.deck.pages, pointer: null } satisfies PresentState);
    for (const id of this.session.members.keys()) this.feed(id, this.around(page));
    // Prefetch here too, so the presenter's own next page is instant.
    for (const n of [page + 1, page + 2]) if (n < this.deck.pages) void this.deck.wire(n, 2).catch(() => {});
    // The pointer stays where it was, now on this page.
    if (this.ptr.next.x >= 0) this.pointer(this.ptr.next.x, this.ptr.next.y, true);
    this.changed();
  }
  private around(page: number) {
    return [page, page + 1, page + 2].filter((n) => n < this.deck.pages);
  }

  /** A colleague joined: the current page straight away, then the next two. */
  joined(id: string) {
    if (!this.have.has(id)) this.have.set(id, new Set());
    this.feed(id, this.around(this.page));
    this.changed();
  }
  left(id: string) {
    this.have.delete(id);
    this.out.delete(id);
    this.ptrOut.delete(id);
    this.changed();
  }
  /** A colleague looking back asks for a page they don't have. */
  want(id: string, page: number) {
    if (!this.session.members.has(id) || page > this.page) return;
    this.feed(id, [page], true);
  }

  /** Line up pages for one colleague: replaces what was waiting (a new current page
   *  matters more than old prefetches); `front` puts these before what's waiting. */
  private feed(id: string, pages: number[], front = false) {
    if (this.gone) return;
    let o = this.out.get(id);
    if (!o) this.out.set(id, (o = { queue: [], busy: null, failed: null }));
    const have = this.have.get(id) ?? new Set<number>();
    const fresh = pages.filter((p) => !have.has(p) && p !== o!.busy);
    o.queue = front ? [...fresh, ...o.queue.filter((p) => !fresh.includes(p))] : fresh;
    void this.pumpTo(id);
  }
  private async pumpTo(id: string) {
    const o = this.out.get(id);
    if (!o || o.busy !== null) return;
    while (o.queue.length && !this.gone && this.out.get(id) === o) {
      const page = o.queue.shift()!;
      if (this.have.get(id)?.has(page)) continue;
      o.busy = page;
      let err: string | null;
      try {
        const { base64, w, h } = await this.deck.wire(page, page === this.page ? -1e9 : 1);
        if (this.gone || this.out.get(id) !== o) break;
        err = await sendBlob(id, this.session.id, "present", `${this.session.id.slice(-8)}-${page}`, base64, { page, w, h });
      } catch (e) {
        err = errText(e);
      }
      o.busy = null;
      if (err) {
        o.failed = err;
        this.changed();
        break;
      }
      o.failed = null;
      this.have.get(id)?.add(page);
      this.changed();
    }
    o.busy = null;
  }

  /** The presenter's mouse over the page (0–10000), or -1, -1 off it. Sent at most
   *  ~10 times a second, only when it moved; a slow colleague gets the latest only. */
  pointer(x: number, y: number, force = false) {
    if (this.gone) return;
    const nx = x < 0 || y < 0 ? -1 : Math.max(0, Math.min(10000, Math.round(x)));
    const ny = nx < 0 ? -1 : Math.max(0, Math.min(10000, Math.round(y)));
    this.ptr.next = { x: nx, y: ny, p: this.page };
    if (force) this.ptr.sent = "";
    if (this.ptr.timer) return;
    const wait = Math.max(0, POINTER_MS - (performance.now() - this.ptr.last));
    this.ptr.timer = window.setTimeout(() => this.flushPointer(), wait);
  }
  private flushPointer() {
    this.ptr.timer = 0;
    const d = { ...this.ptr.next };
    const key = `${d.x},${d.y},${d.p}`;
    if (key === this.ptr.sent) return;
    this.ptr.sent = key;
    this.ptr.last = performance.now();
    for (const id of this.session.members.keys()) this.pointTo(id, d);
  }
  private pointTo(id: string, d: { x: number; y: number; p: number }) {
    let o = this.ptrOut.get(id);
    if (!o) this.ptrOut.set(id, (o = { busy: false, pending: null }));
    if (o.busy) {
      o.pending = d;
      return;
    }
    o.busy = true;
    void tell(this.session, "status", d, id).finally(() => {
      o!.busy = false;
      const next = o!.pending;
      o!.pending = null;
      if (next && !this.gone && this.ptrOut.get(id) === o) this.pointTo(id, next);
    });
  }

  dispose() {
    if (this.gone) return;
    this.gone = true;
    window.clearTimeout(this.ptr.timer);
    this.out.clear();
    this.deck.dispose();
    this.changed();
    this.listeners.clear();
  }
}

// ------------------------------------------------------------------ a colleague watching

export interface Pointer {
  x: number;
  y: number;
  p: number;
}

export class Watcher {
  readonly sessionId: string;
  pics = new Map<number, Pic>();
  pointer: Pointer | null = null;
  /** When each page picture arrived (performance.now), for the tests and the "on its way" text. */
  arrived = new Map<number, number>();
  private asked = new Map<number, number>();
  private listeners = new Set<() => void>();
  private pointerListeners = new Set<(p: Pointer) => void>();
  private ver = 0;
  private gone = false;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }
  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  };
  version = () => this.ver;
  onPointer(l: (p: Pointer) => void) {
    this.pointerListeners.add(l);
    return () => void this.pointerListeners.delete(l);
  }
  private changed() {
    this.ver += 1;
    for (const l of this.listeners) l();
  }

  async addPicture(d: Record<string, unknown>) {
    const { page, w, h, base64 } = d;
    if (!isInt(page, 0, MAX_PAGES) || !isInt(w, 1, 10000) || !isInt(h, 1, 10000) || typeof base64 !== "string" || !base64) return;
    if (this.pics.has(page) || this.gone) return;
    let url: string;
    try {
      const bin = atob(base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      // A JPEG starts FF D8: anything else is not shown.
      if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return;
      url = URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" }));
    } catch {
      return;
    }
    await decoded(url);
    if (this.gone || this.pics.has(page)) {
      URL.revokeObjectURL(url);
      return;
    }
    this.pics.set(page, { page, w, h, url });
    this.arrived.set(page, performance.now());
    this.changed();
  }
  setPointer(d: Record<string, unknown>) {
    const { x, y, p } = d;
    if (!isInt(x, -1, 10000) || !isInt(y, -1, 10000) || !isInt(p, 0, MAX_PAGES)) return;
    this.pointer = { x, y, p };
    for (const l of this.pointerListeners) l(this.pointer);
  }
  /** Asks the presenter for a page this PC doesn't have (again after 8 s). */
  ask(session: Session, page: number) {
    if (this.pics.has(page)) return;
    const at = this.asked.get(page);
    if (at && performance.now() - at < 8000) return;
    this.asked.set(page, performance.now());
    void tell(session, "status", { want: page });
  }
  dispose() {
    if (this.gone) return;
    this.gone = true;
    for (const p of this.pics.values()) URL.revokeObjectURL(p.url);
    this.pics.clear();
    this.changed();
    this.listeners.clear();
    this.pointerListeners.clear();
  }
}

// ------------------------------------------------------------------ the sessions this PC is in

const presenters = new Map<string, Presenter>();
const watchers = new Map<string, Watcher>();
const presenterListeners = new Set<() => void>();
/** Hears when a presenter is attached or gone (the host screen waits for its deck). */
export function onPresenters(l: () => void): () => void {
  presenterListeners.add(l);
  return () => void presenterListeners.delete(l);
}
const presentersChanged = () => presenterListeners.forEach((l) => l());

/** Host: the deck goes with the session just started. */
export function attach(session: Session, deck: Deck): Presenter {
  const p = new Presenter(deck, session);
  presenters.set(session.id, p);
  presentersChanged();
  return p;
}
export const presenterOf = (sessionId: string) => presenters.get(sessionId) ?? null;
export function watcherOf(sessionId: string): Watcher {
  let w = watchers.get(sessionId);
  if (!w) watchers.set(sessionId, (w = new Watcher(sessionId)));
  return w;
}
function forget(sessionId: string) {
  const p = presenters.get(sessionId);
  if (p) {
    p.dispose();
    presenters.delete(sessionId);
    presentersChanged();
  }
  watchers.get(sessionId)?.dispose();
  watchers.delete(sessionId);
}

function onStep(e: Step, s: Session | null) {
  // "closed": this PC left (or, hosting, stopped). "end": the presenter stopped — it is
  // passed on only once the session is gone, after checking it came from the presenter.
  if (e.action === "closed" || (e.action === "end" && !s)) return forget(e.session_id);
  if (!s) return;
  if (s.role === "host") {
    const p = presenters.get(s.id);
    if (!p) return;
    if (e.action === "join") p.joined(e.from_id);
    else if (e.action === "leave" || e.action === "decline") p.left(e.from_id);
    else if (e.action === "status" && isInt(e.data?.want, 0, MAX_PAGES)) p.want(e.from_id, e.data.want as number);
    return;
  }
  // A member hears only the presenter (picture parts reach here without that check).
  if (e.from_id !== s.hostId) return;
  if (e.action === "blob") void watcherOf(s.id).addPicture(e.data ?? {});
  else if (e.action === "status") watcherOf(s.id).setPointer(e.data ?? {});
}
together.on("present", onStep);
