// Playing-card faces shared by the card games.
import type { ReactNode } from "react";
import { cardText, isRed } from "../../../lib/games/cards.ts";

export function CardFace({ card, onClick, lit, small, tiny, testId, dim }: { card: string; onClick?: () => void; lit?: boolean; small?: boolean; tiny?: boolean; testId?: string; dim?: boolean }) {
  const red = isRed(card);
  // LANX 2.16.0: a card you cannot click is not a button (it often sits inside one, e.g. the discard pile).
  const Tag = onClick ? "button" : "span";
  const size = tiny ? "h-9 w-7 text-[11px]" : small ? "h-12 w-9 text-[13px]" : "h-16 w-12 text-[16px]";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      data-card={testId ?? card}
      onClick={onClick}
      disabled={onClick ? undefined : true}
      className={`g3-card inline-flex ${size} flex-col items-start justify-between rounded-md bg-white px-1 py-0.5 font-bold shadow ring-1 ring-black/20 ${red ? "text-rose-600" : "text-slate-900"} ${lit ? "ring-2 ring-indigo-500 -translate-y-1.5" : ""} ${onClick ? "cursor-pointer hover:-translate-y-1" : "cursor-default"} ${dim ? "opacity-50" : ""} transition-transform`}
    >
      <span>{cardText(card)}</span>
      {!tiny && <span className="self-end rotate-180">{cardText(card)}</span>}
    </Tag>
  );
}

export function CardBack({ small, count }: { small?: boolean; count?: number }) {
  return (
    <span className={`g3-card inline-flex ${small ? "h-12 w-9" : "h-16 w-12"} items-center justify-center rounded-md bg-indigo-700 text-[11px] font-bold text-white shadow ring-1 ring-black/20`} style={{ backgroundImage: "repeating-linear-gradient(45deg, rgba(255,255,255,.12) 0 4px, transparent 4px 8px)" }}>
      {count ?? ""}
    </span>
  );
}

/** Other players' hands as face-down counts (LANX 2.17.0: a player who left says so). */
export function OtherHands({ counts, names, colours, turn, exclude, gone, note }: { counts: number[]; names: (p: number) => string; colours: (p: number) => string; turn: number; exclude?: number; gone?: boolean[]; note?: (p: number) => string }) {
  return (
    <div className="flex flex-wrap justify-center gap-3" data-other-hands>
      {counts.map((c, p) =>
        p === exclude ? null : (
          <div key={p} className={`flex flex-col items-center gap-1 rounded-xl px-2 py-1 ${p === turn && !gone?.[p] ? "bg-indigo-500/10 ring-1 ring-indigo-500/40" : ""} ${gone?.[p] ? "opacity-45" : ""}`} data-other-hand={p}>
            <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold">
              <span className="g3-token h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colours(p) }} /> {names(p)}
            </span>
            {gone?.[p] ? <span className="text-[11px] text-slate-500">left</span> : <CardBack small count={c} />}
            {note && !gone?.[p] && note(p) ? <span className="text-[10.5px] text-slate-500">{note(p)}</span> : null}
          </div>
        ),
      )}
    </div>
  );
}

/** LANX 2.17.0: a few small face-up cards in a row (a result, a meld). */
export function CardRow({ cards, lit, testId }: { cards: string[]; lit?: (c: string) => boolean; testId?: string }) {
  return (
    <span className="inline-flex gap-0.5 align-middle" data-card-row={testId}>
      {cards.map((c, i) => (
        <CardFace key={`${c}${i}`} card={c} tiny lit={lit?.(c)} testId={testId ? `${testId}:${c}` : undefined} />
      ))}
    </span>
  );
}

/** LANX 2.17.0: a plain panel for what just happened (the last hand, round or knock). */
export function ResultPanel({ title, children, testId }: { title: string; children: ReactNode; testId: string }) {
  return (
    <div data-result-panel={testId} className="w-full max-w-[680px] rounded-2xl bg-white/80 px-3 py-2 text-[12px] text-slate-700 shadow-sm ring-1 ring-slate-900/10 dark:bg-slate-900/70 dark:text-slate-200 dark:ring-white/10">
      <div className="mb-1 text-[10.5px] font-bold uppercase tracking-wide text-slate-500">{title}</div>
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  );
}
