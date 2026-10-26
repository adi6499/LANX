import { useMemo, useState } from "react";
import { seatFor, type BoardProps } from "../boardProps";
import { OCHO_COLOUR_NAME, ocho, ochoPlayable } from "../../../lib/games/ocho.ts";
import { CardBack, OtherHands } from "./CardFace";

const BG: Record<string, string> = { R: "#dc2626", G: "#16a34a", B: "#2563eb", Y: "#eab308", W: "#0f172a", F: "#0f172a" };
const FACE: Record<string, string> = { S: "⊘", V: "⇄", D: "+2", W: "★", F: "+4" };

function OchoCard({ card, onClick, dim, testId }: { card: string; onClick?: () => void; dim?: boolean; testId?: string }) {
  const colour = card[0];
  const face = card.length === 2 ? FACE[card[1]] ?? card[1] : FACE[card];
  return (
    <button type="button" data-ocho-card={testId ?? card} onClick={onClick} disabled={!onClick} className={`inline-flex h-16 w-11 items-center justify-center rounded-md text-[18px] font-black text-white shadow ring-2 ring-white/70 ${onClick ? "cursor-pointer hover:-translate-y-1" : "cursor-default"} ${dim ? "opacity-40" : ""} transition-transform`} style={{ backgroundColor: BG[colour] ?? "#0f172a" }}>
      {face}
    </button>
  );
}

/** Ocho: match the colour or the symbol; wilds ask for a colour. */
export function OchoBoard({ moves, canPlay, turn, seat, seats, starter = 0, seed = "", local, onMove }: BoardProps) {
  const n = Math.max(2, seats?.length ?? 2);
  const state = useMemo(() => ocho.replay(moves, n, seed), [moves, n, seed]);
  const [wild, setWild] = useState<string | null>(null);
  if (!state) return null;
  const me = local ? turn : seat;
  const hand = state.hands[me] ?? [];
  const top = state.pile[state.pile.length - 1];
  const name = (p: number) => seatFor(seats, starter, p, n).name;
  const colour = (p: number) => seatFor(seats, starter, p, n).color;
  const playable = (c: string) => canPlay && ochoPlayable(state, c) && (!state.drawn || c === state.drawn);
  const stuck = canPlay && !state.drawn && !hand.some((c) => ochoPlayable(state, c));
  const play = (c: string) => (c === "W" || c === "F" ? setWild(c) : onMove(`p:${c}`));
  return (
    <div data-game-board="ocho" className="flex w-full max-w-[640px] flex-col items-center gap-3">
      <OtherHands counts={state.hands.map((h) => h.length)} names={name} colours={colour} turn={turn} exclude={local ? undefined : me} />
      <div className="flex items-center gap-4">
        <div className="flex flex-col items-center gap-1">
          <CardBack count={state.stock.length} />
          <span className="text-[10.5px] text-slate-500">stock</span>
        </div>
        <div className="flex flex-col items-center gap-1">
          <OchoCard card={top} testId={`pile:${top}`} />
          <span className="inline-flex items-center gap-1 text-[10.5px] text-slate-500" data-ocho-colour>
            <span className="g3-token h-3 w-3 rounded-full" style={{ backgroundColor: BG[state.colour] }} /> {OCHO_COLOUR_NAME[state.colour]} {state.dir === -1 ? "· ↺" : ""}
          </span>
        </div>
        {stuck && (
          <button type="button" data-ocho-draw onClick={() => onMove("d")} className="rounded-full bg-indigo-600 px-4 py-1.5 text-[12.5px] font-semibold text-white">
            Draw a card
          </button>
        )}
        {state.drawn && canPlay && (
          <button type="button" data-ocho-keep onClick={() => onMove("k")} className="rounded-full bg-slate-500/10 px-4 py-1.5 text-[12.5px] font-semibold">
            Keep it, pass
          </button>
        )}
        {state.event && <span className="text-[11.5px] text-slate-500" data-ocho-event>{state.event}</span>}
      </div>
      {wild && (
        <div className="flex items-center gap-2 text-[12.5px]" data-ocho-pick-colour>
          <span>Name the colour:</span>
          {["R", "G", "B", "Y"].map((c) => (
            <button key={c} type="button" data-ocho-colour-pick={c} onClick={() => { onMove(`p:${wild}:${c}`); setWild(null); }} className="h-8 w-8 rounded-full shadow ring-2 ring-white" style={{ backgroundColor: BG[c] }} />
          ))}
        </div>
      )}
      <div className="flex flex-col items-center gap-1">
        <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{local ? `${name(turn)}'s cards` : "Your cards"}</div>
        <div className="flex flex-wrap justify-center gap-1.5" data-ocho-hand>
          {hand.map((c, i) => (
            <OchoCard key={`${c}-${i}`} card={c} testId={`hand:${c}`} dim={canPlay && !playable(c)} onClick={playable(c) ? () => play(c) : undefined} />
          ))}
        </div>
      </div>
    </div>
  );
}
