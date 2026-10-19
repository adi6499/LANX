import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Check, Copy, Crop, Download, Grid3x3, Highlighter, Pencil, Redo2, Send, Square, Type, Undo2, X } from "lucide-react";
import type { Conversation } from "../../types";
import { api, errorText } from "../../lib/api";

/** LANX 1.7.0: the screenshot tool — choose an area, mark it up (pen,
 *  highlighter, arrows, boxes, text, blur) and send, copy or save it. */

type Tool = "crop" | "pen" | "highlight" | "arrow" | "rect" | "text" | "blur";
type Pt = [number, number];
type Shape =
  | { t: "pen" | "highlight"; pts: Pt[]; color: string; w: number }
  | { t: "arrow" | "rect" | "blur"; a: Pt; b: Pt; color: string; w: number }
  | { t: "text"; a: Pt; text: string; color: string; size: number };
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const COLORS = ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#111827", "#ffffff"];
const WIDTHS: [number, string][] = [
  [3, "Thin"],
  [6, "Medium"],
  [11, "Thick"],
];

/** The bytes from the app: width, height (little-endian) then BGRA pixels. */
export function decodeCapture(buf: ArrayBuffer): HTMLCanvasElement {
  const view = new DataView(buf);
  const w = view.getUint32(0, true);
  const h = view.getUint32(4, true);
  const src = new Uint8Array(buf, 8);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let i = 0, n = w * h * 4; i < n; i += 4) {
    d[i] = src[i + 2];
    d[i + 1] = src[i + 1];
    d[i + 2] = src[i];
    d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

const norm = (a: Pt, b: Pt): Rect => ({ x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(a[0] - b[0]), h: Math.abs(a[1] - b[1]) });

function drawShape(g: CanvasRenderingContext2D, s: Shape, base: HTMLCanvasElement) {
  g.save();
  g.lineCap = "round";
  g.lineJoin = "round";
  if (s.t === "pen" || s.t === "highlight") {
    g.strokeStyle = s.color;
    g.lineWidth = s.t === "highlight" ? s.w * 3.2 : s.w;
    if (s.t === "highlight") {
      g.globalAlpha = 0.35;
      g.lineCap = "square";
    }
    g.beginPath();
    s.pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    if (s.pts.length === 1) g.lineTo(s.pts[0][0] + 0.1, s.pts[0][1]);
    g.stroke();
  } else if (s.t === "rect") {
    const r = norm(s.a, s.b);
    g.strokeStyle = s.color;
    g.lineWidth = s.w;
    g.strokeRect(r.x, r.y, r.w, r.h);
  } else if (s.t === "arrow") {
    const [x1, y1] = s.a;
    const [x2, y2] = s.b;
    const ang = Math.atan2(y2 - y1, x2 - x1);
    const head = Math.max(14, s.w * 4);
    g.strokeStyle = s.color;
    g.fillStyle = s.color;
    g.lineWidth = s.w;
    g.beginPath();
    g.moveTo(x1, y1);
    g.lineTo(x2 - Math.cos(ang) * head * 0.6, y2 - Math.sin(ang) * head * 0.6);
    g.stroke();
    g.beginPath();
    g.moveTo(x2, y2);
    g.lineTo(x2 - head * Math.cos(ang - 0.45), y2 - head * Math.sin(ang - 0.45));
    g.lineTo(x2 - head * Math.cos(ang + 0.45), y2 - head * Math.sin(ang + 0.45));
    g.closePath();
    g.fill();
  } else if (s.t === "blur") {
    const r = norm(s.a, s.b);
    if (r.w >= 2 && r.h >= 2) {
      // Pixelate: shrink the area a lot, then draw it back big and blocky.
      const cell = Math.max(8, Math.round(Math.min(r.w, r.h) / 10));
      const tiny = document.createElement("canvas");
      tiny.width = Math.max(1, Math.round(r.w / cell));
      tiny.height = Math.max(1, Math.round(r.h / cell));
      tiny.getContext("2d")!.drawImage(base, r.x, r.y, r.w, r.h, 0, 0, tiny.width, tiny.height);
      g.imageSmoothingEnabled = false;
      g.drawImage(tiny, 0, 0, tiny.width, tiny.height, r.x, r.y, r.w, r.h);
    }
  } else if (s.t === "text") {
    g.font = `600 ${s.size}px "Segoe UI", system-ui, sans-serif`;
    g.textBaseline = "top";
    g.lineWidth = Math.max(2, s.size / 8);
    g.strokeStyle = s.color === "#ffffff" ? "#111827" : "#ffffff";
    s.text.split("\n").forEach((line, i) => {
      g.strokeText(line, s.a[0], s.a[1] + i * s.size * 1.2);
      g.fillStyle = s.color;
      g.fillText(line, s.a[0], s.a[1] + i * s.size * 1.2);
    });
  }
  g.restore();
}

export function ScreenshotEditor({
  capture,
  conversations,
  defaultConversationId,
  onSend,
  onClose,
  onNotice,
}: {
  capture: ArrayBuffer;
  conversations: Conversation[];
  defaultConversationId: string | null;
  onSend: (conversationId: string, dataUrl: string) => Promise<void>;
  onClose: () => void;
  onNotice: (text: string) => void;
}) {
  const base = useMemo(() => decodeCapture(capture), [capture]);
  const full: Rect = useMemo(() => ({ x: 0, y: 0, w: base.width, h: base.height }), [base]);
  const [tool, setTool] = useState<Tool>("crop");
  const [color, setColor] = useState(COLORS[0]);
  const [width, setWidth] = useState(6);
  const [crop, setCrop] = useState<Rect | null>(null);
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [redo, setRedo] = useState<Shape[]>([]);
  const [draft, setDraft] = useState<Shape | null>(null);
  const [cropDraft, setCropDraft] = useState<Rect | null>(null);
  const [textAt, setTextAt] = useState<{ a: Pt; left: number; top: number } | null>(null);
  const [textValue, setTextValue] = useState("");
  const [box, setBox] = useState({ w: 800, h: 500 });
  const [target, setTarget] = useState<string>(defaultConversationId ?? conversations[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const start = useRef<Pt | null>(null);

  const view: Rect = tool === "crop" || !crop ? full : crop;
  const scale = Math.min(box.w / view.w, box.h / view.h, 2);
  const dw = Math.max(1, Math.round(view.w * scale));
  const dh = Math.max(1, Math.round(view.h * scale));

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: Math.max(200, el.clientWidth - 24), h: Math.max(150, el.clientHeight - 24) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Draw the picture, the marks and (while choosing) the chosen area.
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(dw * dpr);
    c.height = Math.round(dh * dpr);
    const g = c.getContext("2d")!;
    const k = scale * dpr;
    g.setTransform(k, 0, 0, k, -view.x * k, -view.y * k);
    g.imageSmoothingQuality = "high";
    g.drawImage(base, 0, 0);
    for (const s of shapes) drawShape(g, s, base);
    if (draft) drawShape(g, draft, base);
    const sel = tool === "crop" ? cropDraft ?? crop : null;
    if (sel) {
      g.save();
      g.fillStyle = "rgba(0,0,0,0.45)";
      g.beginPath();
      g.rect(0, 0, base.width, base.height);
      g.rect(sel.x, sel.y + sel.h, sel.w, -sel.h); // hole (opposite winding)
      g.fill("evenodd");
      g.strokeStyle = "#38bdf8";
      g.lineWidth = 2 / scale;
      g.setLineDash([8 / scale, 5 / scale]);
      g.strokeRect(sel.x, sel.y, sel.w, sel.h);
      g.restore();
    }
  }, [base, shapes, draft, crop, cropDraft, tool, view.x, view.y, scale, dw, dh]);

  const toImage = (e: React.PointerEvent): Pt => {
    const r = canvasRef.current!.getBoundingClientRect();
    const x = view.x + (e.clientX - r.left) / scale;
    const y = view.y + (e.clientY - r.top) / scale;
    return [Math.max(0, Math.min(base.width, x)), Math.max(0, Math.min(base.height, y))];
  };

  const commit = useCallback((s: Shape) => {
    setShapes((prev) => [...prev, s]);
    setRedo([]);
  }, []);

  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    // The whole area around the picture listens, so a drag that starts on its
    // rounded corner or just outside its edge still works (clamped to the edge).
    if ((e.target as Element).closest("textarea")) return;
    const r = canvasRef.current!.getBoundingClientRect();
    const slack = 32;
    if (e.clientX < r.left - slack || e.clientX > r.right + slack || e.clientY < r.top - slack || e.clientY > r.bottom + slack) return;
    const p = toImage(e);
    if (tool === "text") {
      // Keep the click from taking the keyboard away from the new text box.
      e.preventDefault();
      if (textAt) placeText();
      const wr = wrapRef.current!.getBoundingClientRect();
      setTextAt({ a: p, left: e.clientX - wr.left, top: e.clientY - wr.top });
      setTextValue("");
      return;
    }
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    start.current = p;
    const w = width / scale;
    if (tool === "crop") setCropDraft({ x: p[0], y: p[1], w: 0, h: 0 });
    else if (tool === "pen" || tool === "highlight") setDraft({ t: tool, pts: [p], color, w });
    else setDraft({ t: tool, a: p, b: p, color, w });
  };

  const onMove = (e: React.PointerEvent) => {
    if (!start.current) return;
    const p = toImage(e);
    if (tool === "crop") setCropDraft(norm(start.current, p));
    else
      setDraft((d) => {
        if (!d) return d;
        if (d.t === "pen" || d.t === "highlight") return { ...d, pts: [...d.pts, p] };
        if (d.t === "text") return d;
        return { ...d, b: p };
      });
  };

  const onUp = () => {
    if (!start.current) return;
    start.current = null;
    if (tool === "crop") {
      if (cropDraft && cropDraft.w > 8 && cropDraft.h > 8) {
        setCrop({ x: Math.round(cropDraft.x), y: Math.round(cropDraft.y), w: Math.round(cropDraft.w), h: Math.round(cropDraft.h) });
        setTool("arrow"); // chosen: on to marking it up
      }
      setCropDraft(null);
      return;
    }
    if (draft) {
      const tiny = (draft.t === "arrow" || draft.t === "rect" || draft.t === "blur") && Math.hypot(draft.a[0] - draft.b[0], draft.a[1] - draft.b[1]) < 3;
      if (!tiny) commit(draft);
    }
    setDraft(null);
  };

  const placeText = () => {
    if (textAt && textValue.trim()) commit({ t: "text", a: textAt.a, text: textValue.trim(), color, size: Math.round((14 + width * 2) / scale) });
    setTextAt(null);
    setTextValue("");
  };

  const undo = useCallback(() => {
    setShapes((prev) => {
      if (!prev.length) return prev;
      setRedo((r) => [...r, prev[prev.length - 1]]);
      return prev.slice(0, -1);
    });
  }, []);
  const redoOne = useCallback(() => {
    setRedo((r) => {
      if (!r.length) return r;
      setShapes((prev) => [...prev, r[r.length - 1]]);
      return r.slice(0, -1);
    });
  }, []);

  /** The finished picture (the chosen area, with the marks). */
  const render = useCallback((): HTMLCanvasElement => {
    const area = crop ?? full;
    const out = document.createElement("canvas");
    out.width = area.w;
    out.height = area.h;
    const g = out.getContext("2d")!;
    g.translate(-area.x, -area.y);
    g.drawImage(base, 0, 0);
    for (const s of shapes) drawShape(g, s, base);
    return out;
  }, [base, crop, full, shapes]);

  const dataUrl = () => {
    const c = render();
    const png = c.toDataURL("image/png");
    // Very big pictures go as high-quality JPEG (LANX takes up to 25 MB).
    return png.length > 20_000_000 ? c.toDataURL("image/jpeg", 0.92) : png;
  };

  const send = async () => {
    if (!target) return;
    setBusy(true);
    try {
      await onSend(target, dataUrl());
      onClose();
    } catch (e) {
      onNotice(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      const blob = await new Promise<Blob | null>((r) => render().toBlob(r, "image/png"));
      if (!blob) throw new Error("Could not make the picture");
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      onNotice("Screenshot copied — paste it anywhere with Ctrl+V.");
    } catch (e) {
      onNotice(`Could not copy: ${errorText(e)}`);
    }
  };

  const save = async () => {
    try {
      const where = await api.saveScreenshot(dataUrl());
      onNotice(`Screenshot saved: ${where}`);
    } catch (e) {
      onNotice(errorText(e));
    }
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (textAt) return;
      if (e.key === "Escape") onClose();
      else if (e.ctrlKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undo();
      } else if (e.ctrlKey && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redoOne();
      } else if (e.ctrlKey && e.key.toLowerCase() === "c") {
        e.preventDefault();
        void copy();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textAt, onClose, undo, redoOne, shapes, crop]);

  const tools: [Tool, React.ElementType, string][] = [
    ["crop", Crop, "Choose area"],
    ["arrow", ArrowUpRight, "Arrow"],
    ["rect", Square, "Box"],
    ["pen", Pencil, "Pen"],
    ["highlight", Highlighter, "Highlighter"],
    ["text", Type, "Text"],
    ["blur", Grid3x3, "Blur (hide private things)"],
  ];
  const chats = conversations.filter((c) => c.membership !== "left" && c.membership !== "removed");

  return (
    <div data-screenshot-editor className="fixed inset-0 z-[60] flex flex-col bg-slate-950/85 backdrop-blur-md lanx-fade text-white select-none">
      {/* Tools */}
      <div className="flex flex-wrap items-center gap-1.5 px-4 py-2.5 border-b border-white/10">
        <span className="text-[13px] font-bold mr-2">Screenshot</span>
        {tools.map(([t, I, label]) => (
          <button
            key={t}
            type="button"
            data-shot-tool={t}
            title={label}
            onClick={() => setTool(t)}
            className={`h-8 px-2.5 rounded-lg flex items-center gap-1.5 text-[12px] font-semibold transition-colors ${tool === t ? "bg-sky-500 text-white" : "hover:bg-white/10 text-white/85"}`}
          >
            <I className="h-4 w-4" />
            <span className="hidden lg:inline">{label.split(" (")[0]}</span>
          </button>
        ))}
        <span className="w-px h-6 bg-white/15 mx-1" />
        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            title="Colour"
            onClick={() => setColor(c)}
            className={`h-6 w-6 rounded-full border-2 transition-transform ${color === c ? "border-white scale-110" : "border-white/20"}`}
            style={{ backgroundColor: c }}
          />
        ))}
        <span className="w-px h-6 bg-white/15 mx-1" />
        {WIDTHS.map(([w, label]) => (
          <button
            key={w}
            type="button"
            title={label}
            onClick={() => setWidth(w)}
            className={`h-8 w-8 rounded-lg flex items-center justify-center ${width === w ? "bg-white/15" : "hover:bg-white/10"}`}
          >
            <span className="rounded-full bg-white" style={{ width: w + 2, height: w + 2 }} />
          </button>
        ))}
        <span className="w-px h-6 bg-white/15 mx-1" />
        <button type="button" title="Undo (Ctrl+Z)" disabled={!shapes.length} onClick={undo} className="h-8 w-8 rounded-lg flex items-center justify-center hover:bg-white/10 disabled:opacity-30">
          <Undo2 className="h-4 w-4" />
        </button>
        <button type="button" title="Redo (Ctrl+Y)" disabled={!redo.length} onClick={redoOne} className="h-8 w-8 rounded-lg flex items-center justify-center hover:bg-white/10 disabled:opacity-30">
          <Redo2 className="h-4 w-4" />
        </button>
        <button type="button" title="Close (Esc)" onClick={onClose} className="ml-auto h-8 w-8 rounded-lg flex items-center justify-center hover:bg-white/10">
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Picture */}
      <div
        ref={wrapRef}
        className="relative flex-1 min-h-0 flex items-center justify-center overflow-hidden touch-none"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <canvas
          ref={canvasRef}
          data-shot-canvas
          style={{ width: dw, height: dh, cursor: tool === "text" ? "text" : "crosshair" }}
          className="rounded-md shadow-2xl ring-1 ring-white/10"
        />
        {tool === "crop" && (
          <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1.5 text-[12px] font-medium">
            {crop ? "Drag again to choose another area, or pick a tool above" : "Drag to choose the part you want — or pick a tool to use the whole screen"}
          </div>
        )}
        {textAt && (
          <div className="absolute z-10" style={{ left: textAt.left, top: textAt.top }}>
            <textarea
              data-shot-text
              ref={(el) => {
                if (el && document.activeElement !== el) el.focus();
              }}
              value={textValue}
              onChange={(e) => setTextValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  placeText();
                } else if (e.key === "Escape") setTextAt(null);
              }}
              onBlur={placeText}
              placeholder="Type, then Enter"
              rows={1}
              className="min-w-[180px] rounded-md bg-black/70 px-2 py-1 text-[14px] font-semibold outline-none ring-2 ring-sky-400 resize"
              style={{ color }}
            />
          </div>
        )}
      </div>

      {/* Send / copy / save */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-t border-white/10">
        <span className="text-[11.5px] text-white/60">
          {crop ? `${crop.w} × ${crop.h}` : `${base.width} × ${base.height}`} px{crop ? " (chosen area)" : " (whole screen)"}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button type="button" data-shot-copy onClick={copy} className="h-9 px-3 rounded-full bg-white/10 hover:bg-white/15 flex items-center gap-1.5 text-[12.5px] font-semibold">
            <Copy className="h-4 w-4" /> Copy
          </button>
          <button type="button" data-shot-save onClick={save} className="h-9 px-3 rounded-full bg-white/10 hover:bg-white/15 flex items-center gap-1.5 text-[12.5px] font-semibold">
            <Download className="h-4 w-4" /> Save
          </button>
          <select
            data-shot-target
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="h-9 max-w-[220px] rounded-full bg-white/10 px-3 text-[12.5px] font-semibold outline-none [&>option]:text-slate-900"
          >
            {chats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.kind === "group" ? `👥 ${c.peer_name}` : c.peer_name}
              </option>
            ))}
          </select>
          <button
            type="button"
            data-shot-send
            disabled={!target || busy}
            onClick={send}
            className="h-9 px-4 rounded-full bg-sky-500 hover:bg-sky-600 disabled:opacity-50 flex items-center gap-1.5 text-[12.5px] font-bold"
          >
            {busy ? <Check className="h-4 w-4 animate-pulse" /> : <Send className="h-4 w-4" />} Send
          </button>
        </div>
      </div>
    </div>
  );
}
