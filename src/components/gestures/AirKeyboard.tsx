import { type CSSProperties, type JSX, type ReactNode, useMemo } from "react";
import { ArrowBigUp, ArrowBigUpDash, ArrowLeft, ArrowRight, CornerDownLeft, Delete, Mic, X } from "lucide-react";
import { type KbState, type KeyRect, layoutKeyboard, suggestionSlots } from "../../lib/gestures/keyboard";

/** LANX 3.7.0: the air keyboard — a plain, Apple-like system keyboard that a
 *  hand pointer types on. Every key sits exactly where layoutKeyboard() says,
 *  so the gesture code can hit-test the pointer against the same layout.
 *
 *  interactive (inside the LANX window): keys are real buttons that never take
 *  the focus away from the text box being typed into.
 *  not interactive (the small always-on-top window): nothing here can be
 *  clicked; the gesture code says which key is lit (`hover`) and pressed. */

export interface AirKeyboardProps {
  state: KbState;
  width: number;
  height: number;
  /** The key the pointer is over (its id). */
  hover?: string | null;
  /** The key being pressed right now (its id). */
  pressed?: string | null;
  /** Dictation is on: the mic key says so. */
  listening?: boolean;
  /** Real buttons (inside LANX) instead of a picture of the keys. */
  interactive?: boolean;
  onKey?: (k: KeyRect) => void;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Colours, one set per look (exclusive, so no two background classes ever fight). */
const TONE = {
  letter: "bg-white text-slate-900 shadow-[0_1px_0_rgb(0_0_0/0.28)] dark:bg-[#4b4d53] dark:text-white dark:shadow-[0_1px_0_rgb(0_0_0/0.6)]",
  special: "bg-[#adb2bc] text-slate-900 shadow-[0_1px_0_rgb(0_0_0/0.28)] dark:bg-[#323439] dark:text-white dark:shadow-[0_1px_0_rgb(0_0_0/0.6)]",
  on: "bg-white text-slate-900 shadow-[0_1px_0_rgb(0_0_0/0.28)] dark:bg-white dark:text-slate-900 dark:shadow-[0_1px_0_rgb(0_0_0/0.6)]",
  listening: "bg-red-50 text-red-600 shadow-[0_1px_0_rgb(0_0_0/0.28)] dark:bg-[#4a2a2d] dark:text-red-300 dark:shadow-[0_1px_0_rgb(0_0_0/0.6)]",
  chip: "bg-transparent text-slate-900 dark:text-white",
  lit: "bg-sky-100 text-sky-950 ring-2 ring-sky-500 shadow-[0_6px_14px_-6px_rgb(15_23_42/0.45)] dark:bg-[#1f4a66] dark:text-white dark:ring-sky-400 dark:shadow-[0_6px_14px_-6px_rgb(0_0_0/0.8)]",
  down: "bg-sky-300 text-sky-950 ring-2 ring-sky-600 dark:bg-sky-700 dark:text-white dark:ring-sky-400",
} as const;

function toneOf(k: KeyRect, state: KbState, listening: boolean, lit: boolean, down: boolean): string {
  if (down) return TONE.down;
  if (lit) return TONE.lit;
  switch (k.kind) {
    case "char":
    case "space":
      return TONE.letter;
    case "suggest":
      return TONE.chip;
    case "shift":
      return state.shift || state.caps ? TONE.on : TONE.special;
    case "mic":
      return listening ? TONE.listening : TONE.special;
    default:
      return TONE.special;
  }
}

const ARIA: Partial<Record<KeyRect["kind"], string>> = {
  shift: "Shift",
  back: "Delete",
  enter: "Return",
  space: "Space",
  mic: "Dictate",
  close: "Hide keyboard",
  left: "Move left",
  right: "Move right",
};

function face(k: KeyRect, state: KbState, listening: boolean): ReactNode {
  const icon = Math.round(clamp(k.h * 0.4, 16, 24));
  const small = Math.round(clamp(k.h * 0.3, 12, 16));
  const stroke = 1.9;
  switch (k.kind) {
    case "char": {
      const emoji = /\p{Extended_Pictographic}/u.test(k.label);
      return <span style={{ fontSize: Math.round(clamp(k.h * (emoji ? 0.46 : 0.44), 15, 26)), lineHeight: 1 }}>{k.label}</span>;
    }
    case "shift":
      return state.caps ? (
        <ArrowBigUpDash size={icon} strokeWidth={stroke} fill="currentColor" />
      ) : (
        <ArrowBigUp size={icon} strokeWidth={stroke} fill={state.shift ? "currentColor" : "none"} />
      );
    case "back":
      return <Delete size={icon} strokeWidth={stroke} />;
    case "enter":
      return <CornerDownLeft size={icon} strokeWidth={stroke} />;
    case "left":
      return <ArrowLeft size={icon} strokeWidth={stroke} />;
    case "right":
      return <ArrowRight size={icon} strokeWidth={stroke} />;
    case "close":
      return <X size={icon} strokeWidth={stroke} />;
    case "space":
    case "page":
      return <span style={{ fontSize: small }}>{k.label}</span>;
    case "mic":
      if (!listening) return <Mic size={icon} strokeWidth={stroke} />;
      return (
        <span className={`flex items-center justify-center gap-1 ${k.w >= 96 ? "flex-row" : "flex-col"}`}>
          <span className="block rounded-full bg-red-500" style={{ width: 8, height: 8 }} />
          <span className="whitespace-nowrap font-medium" style={{ fontSize: Math.round(clamp(k.h * 0.2, 10, 13)) }}>
            Listening…
          </span>
        </span>
      );
    case "suggest":
      return (
        <span className="block min-w-0 truncate px-2" style={{ fontSize: Math.round(clamp(k.h * 0.38, 13, 18)) }}>
          {k.label}
        </span>
      );
  }
}

export function AirKeyboard({ state, width, height, hover = null, pressed = null, listening = false, interactive = false, onKey }: AirKeyboardProps): JSX.Element {
  const keys = useMemo(() => layoutKeyboard(width, height, state), [width, height, state]);
  const slots = useMemo(() => suggestionSlots(width, height), [width, height]);
  const hasChips = keys.some((k) => k.kind === "suggest");
  const bar = slots[1];

  return (
    <div
      data-gesture-ui
      data-air-keyboard
      role={interactive ? "group" : undefined}
      aria-label={interactive ? "Air keyboard" : undefined}
      aria-hidden={interactive ? undefined : true}
      className={`relative select-none overflow-hidden rounded-[14px] bg-[#d2d5db] ring-1 ring-inset ring-black/10 dark:bg-[#1f2024] dark:ring-white/10 ${
        interactive ? "shadow-[0_12px_32px_-14px_rgb(15_23_42/0.45)]" : "pointer-events-none"
      }`}
      style={{ width, height }}
      onMouseDown={interactive ? (e) => e.preventDefault() : undefined}
    >
      {/* QuickType-style hairlines between the three suggestion slots */}
      {slots.slice(0, 2).map((s, i) => {
        const next = slots[i + 1];
        const x = (s.x + s.w + next.x) / 2;
        return <span key={`div-${i}`} aria-hidden className="pointer-events-none absolute w-px bg-black/15 dark:bg-white/15" style={{ left: Math.round(x - 0.5), top: s.y + s.h * 0.25, height: s.h * 0.5 }} />;
      })}
      {/* No suggestions: the word being typed, faintly */}
      {!hasChips && state.word && bar && (
        <span
          aria-hidden
          className="pointer-events-none absolute flex items-center justify-center truncate px-2 text-black/35 dark:text-white/35"
          style={{ left: bar.x, top: bar.y, width: bar.w, height: bar.h, fontSize: Math.round(clamp(bar.h * 0.38, 13, 18)) }}
        >
          “{state.word}”
        </span>
      )}
      {keys.map((k) => {
        const down = pressed === k.id;
        const lit = !down && hover === k.id;
        const style: CSSProperties = {
          left: k.x,
          top: k.y,
          width: k.w,
          height: k.h,
          transform: down ? "scale(0.95)" : lit ? "translateY(-2px) scale(1.03)" : undefined,
          zIndex: lit || down ? 2 : undefined,
        };
        const cls = `absolute flex items-center justify-center overflow-hidden rounded-[8px] outline-none transition-[transform,scale,background-color,box-shadow,color] duration-[120ms] ease-out ${toneOf(
          k,
          state,
          listening,
          lit,
          down,
        )}`;
        const content = face(k, state, listening);
        if (!interactive) {
          return (
            <div key={k.id} data-kb-key={k.id} className={`${cls} pointer-events-none`} style={style}>
              {content}
            </div>
          );
        }
        const label = ARIA[k.kind] ?? (k.kind === "page" ? (state.page === "abc" ? "Numbers and symbols" : "Letters") : k.label);
        return (
          <button
            key={k.id}
            type="button"
            tabIndex={-1}
            data-gesture-nofocus
            data-kb-key={k.id}
            aria-label={label}
            aria-pressed={k.kind === "shift" ? state.shift || state.caps : k.kind === "mic" ? listening : undefined}
            className={`${cls} cursor-default active:scale-[0.95]`}
            style={style}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onKey?.(k)}
          >
            {content}
          </button>
        );
      })}
    </div>
  );
}
