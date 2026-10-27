// Playing-card faces shared by the card games.
import { cardText, isRed } from "../../../lib/games/cards.ts";

export function CardFace({ card, onClick, lit, small, testId, dim }: { card: string; onClick?: () => void; lit?: boolean; small?: boolean; testId?: string; dim?: boolean }) {
  const red = isRed(card);
  // LANX 2.16.0: a card you cannot click is not a button (it often sits inside one, e.g. the discard pile).
  const Tag = onClick ? "button" : "span";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      data-card={testId ?? card}
      onClick={onClick}
      disabled={onClick ? undefined : true}
      className={`g3-card inline-flex ${small ? "h-12 w-9 text-[13px]" : "h-16 w-12 text-[16px]"} flex-col items-start justify-between rounded-md bg-white px-1 py-0.5 font-bold shadow ring-1 ring-black/20 ${red ? "text-rose-600" : "text-slate-900"} ${lit ? "ring-2 ring-indigo-500 -translate-y-1.5" : ""} ${onClick ? "cursor-pointer hover:-translate-y-1" : "cursor-default"} ${dim ? "opacity-50" : ""} transition-transform`}
    >
      <span>{cardText(card)}</span>
      <span className="self-end rotate-180">{cardText(card)}</span>
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

/** Other players' hands as face-down counts. */
export function OtherHands({ counts, names, colours, turn, exclude }: { counts: number[]; names: (p: number) => string; colours: (p: number) => string; turn: number; exclude?: number }) {
  return (
    <div className="flex flex-wrap justify-center gap-3" data-other-hands>
      {counts.map((c, p) =>
        p === exclude ? null : (
          <div key={p} className={`flex flex-col items-center gap-1 rounded-xl px-2 py-1 ${p === turn ? "bg-indigo-500/10 ring-1 ring-indigo-500/40" : ""}`} data-other-hand={p}>
            <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold">
              <span className="g3-token h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colours(p) }} /> {names(p)}
            </span>
            <CardBack small count={c} />
          </div>
        ),
      )}
    </div>
  );
}
