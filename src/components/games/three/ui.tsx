// LANX 2.16.0: small HTML pieces the 3D boards share — the buttons above a
// board, and a hidden list of the moves you can make right now (for the
// keyboard, screen readers and the app's automatic tests), since the pieces
// themselves are drawn in WebGL.

import type { ReactNode } from "react";

export const btn3 = "rounded-full px-4 py-1.5 text-[12.5px] font-semibold transition-[background-color,transform] duration-150 active:scale-[0.97] disabled:opacity-50 disabled:active:scale-100";
export const primary3 = `${btn3} bg-indigo-600 text-white hover:bg-indigo-700`;
export const quiet3 = `${btn3} bg-slate-500/10 text-slate-700 dark:text-slate-200 hover:bg-slate-500/20`;

export interface Action {
  key: string;
  label: string;
  run: () => void;
  /** data-* attributes for tests (e.g. { "data-ludo-token": "0:1" }). */
  attrs?: Record<string, string>;
}

/** The moves you can make, as real buttons that are visually hidden (Tab reaches them). */
export function HiddenActions({ actions, label }: { actions: Action[]; label: string }) {
  if (!actions.length) return null;
  return (
    <div className="sr-only" role="group" aria-label={label} data-g3-actions>
      {actions.map((a) => (
        <button key={a.key} type="button" onClick={a.run} {...a.attrs}>
          {a.label}
        </button>
      ))}
    </div>
  );
}

/** A coloured dot for a seat. */
export function SeatDot({ color, size = 12 }: { color: string; size?: number }) {
  return <span className="inline-block rounded-full shadow-[inset_0_-1px_0_rgba(0,0,0,0.2)]" style={{ width: size, height: size, backgroundColor: color }} />;
}

/** The line over a 3D board: what happened, whose turn, and the buttons. */
export function BoardBar({ children }: { children: ReactNode }) {
  return <div className="flex min-h-[34px] flex-wrap items-center justify-center gap-x-3 gap-y-1.5 text-[12.5px] font-semibold">{children}</div>;
}
