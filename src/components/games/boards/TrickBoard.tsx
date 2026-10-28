import { useMemo, useState } from "react";
import { namesIn, seatFor, type BoardProps } from "../boardProps";
import { PASS_WORD, TRICK_RULES, euchre, hearts, heartsPoints, partnerOf, spades, trickPlayable, type TrickState } from "../../../lib/games/tricks.ts";
import { SUIT_SYMBOL, cardText, sortHand } from "../../../lib/games/cards.ts";
import { CardBack, CardFace } from "./CardFace";

export type TrickGame = "hearts" | "spades" | "euchre";
const DEFS = { hearts, spades, euchre };

export function useTrickState(game: TrickGame, moves: string[], seed: string) {
  return useMemo(() => DEFS[game].replay(moves, 4, seed) as TrickState | null, [game, moves, seed]);
}

/** What a click on one of your cards does right now. */
export function trickHandMode(state: TrickState, game: TrickGame, me: number, canPlay: boolean): "play" | "pass" | "discard" | null {
  if (!canPlay || state.over || state.turn !== me) return null;
  if (state.phase === 2) return "play";
  if (state.phase === 3 && game === "hearts") return "pass";
  if (state.phase === 4 && game === "euchre" && me === state.dealer) return "discard";
  return null;
}

/** The line over the table: whose turn it is, and for what. */
export function trickPrompt(state: TrickState, game: TrickGame, name: (p: number) => string): string {
  if (state.over) return "";
  const who = name(state.turn);
  if (game === "hearts" && state.phase === 3) return `${who} is choosing three cards to pass ${PASS_WORD[state.passTo]} (to ${name((state.turn + state.passTo) % 4)})`;
  if (game === "spades" && state.phase === 0) return `${who} is bidding`;
  if (game === "euchre" && state.phase === 0 && state.upcard) return `${who}: order up ${cardText(state.upcard)} or pass`;
  if (game === "euchre" && state.phase === 1) return `${who}: name trump${state.upcard ? ` (not ${SUIT_SYMBOL[state.upcard[1]]})` : ""} or pass`;
  if (game === "euchre" && state.phase === 4 && state.upcard) return `${name(state.dealer)} picked up ${cardText(state.upcard)} and puts a card away`;
  return state.trick.length ? `${who} to play` : `${who} leads`;
}

/** Who took the last trick, when there is no trick on the table. */
export const lastTrickText = (state: TrickState, name: (p: number) => string) => (!state.trick.length && state.lastTrick.length && state.lastWinner >= 0 ? `${name(state.lastWinner)} took the last trick` : "");

/** The short line under a player's name. */
export function trickSeatNote(state: TrickState, game: TrickGame, p: number): string {
  if (state.gone[p]) return "left";
  if (game === "euchre" && p === state.sitOut) return "sits this hand out";
  const parts = [`${state.won[p]} ${state.won[p] === 1 ? "trick" : "tricks"}`];
  if (game === "spades" && state.bids[p] >= 0) parts.push(`bid ${state.bids[p] === 0 ? "nil" : state.bids[p]}`);
  if (game === "hearts") {
    const now = heartsPoints(state.taken[p] ?? []);
    parts.push(`${state.scores[p]} pts${now ? ` (+${now} now)` : ""}`);
  } else parts.push(`${state.scores[p]} pts`);
  if (game === "euchre" && p === state.caller && state.trump) parts.push(state.alone ? "maker, alone" : "maker");
  return parts.join(" · ");
}

/** Trump, broken suits and the like. */
export function trickStatus(state: TrickState, game: TrickGame, name: (p: number) => string): string {
  // (Before trump is made the turned-up card is on the table, and the prompt names it.)
  if (game === "euchre") return state.trump ? `trump ${SUIT_SYMBOL[state.trump]}${state.caller >= 0 ? ` · called by ${name(state.caller)}${state.alone ? " (alone)" : ""}` : ""}` : "";
  if (game === "spades") return state.broken ? "spades are broken" : "spades are trump";
  return state.phase === 2 && state.broken ? "hearts are broken" : "";
}

const pill = "rounded-full px-4 py-1.5 text-[12.5px] font-semibold transition-[background-color,transform] duration-150 active:scale-[0.97] disabled:opacity-50";
const primaryPill = `${pill} bg-indigo-600 text-white hover:bg-indigo-700`;
const quietPill = `${pill} bg-slate-500/10 text-slate-700 dark:text-slate-200 hover:bg-slate-500/20`;
const suitBtn = (s: string) => `h-8 w-8 rounded-full bg-white text-[18px] shadow ring-1 ring-black/20 ${s === "H" || s === "D" ? "text-rose-600" : "text-slate-900"}`;

/** The buttons for bidding, ordering up, naming trump, passing cards and the dealer's discard (flat and 3D). */
export function TrickControls({ state, game, me, canPlay, name, onMove, picked, onPicked, primary = primaryPill, quiet = quietPill }: { state: TrickState; game: TrickGame; me: number; canPlay: boolean; name: (p: number) => string; onMove: (m: string) => void; picked: string[]; onPicked: (c: string[]) => void; primary?: string; quiet?: string }) {
  const [alone, setAlone] = useState(false);
  if (!canPlay || state.over || state.turn !== me) return null;
  const send = (m: string) => {
    setAlone(false);
    onPicked([]);
    onMove(m);
  };
  const aloneToggle = (
    <button type="button" data-euchre-alone aria-pressed={alone} onClick={() => setAlone((a) => !a)} className={alone ? `${pill} bg-amber-500 text-white` : quiet}>
      {alone ? "Going alone" : "Go alone"}
    </button>
  );
  if (game === "spades" && state.phase === 0)
    return (
      <div className="flex flex-wrap items-center justify-center gap-1.5 text-[12.5px]" data-spades-bid>
        <span>Your bid:</span>
        {Array.from({ length: 14 }, (_, k) => (
          <button key={k} type="button" data-spades-bid-n={k} onClick={() => send(`b:${k}`)} className="h-8 min-w-8 rounded-full bg-white px-2 text-[12.5px] font-bold text-slate-900 shadow ring-1 ring-black/20 hover:bg-indigo-600 hover:text-white">
            {k === 0 ? "nil" : k}
          </button>
        ))}
      </div>
    );
  if (game === "euchre" && state.phase === 0 && state.upcard) {
    const sitsOut = alone && partnerOf(me) === state.dealer;
    const who = state.dealer === me ? "you pick it up" : `${name(state.dealer)} picks it up`;
    return (
      <div className="flex flex-wrap items-center justify-center gap-2 text-[12.5px]" data-euchre-order>
        <button type="button" data-euchre-orderup onClick={() => send(alone ? "o:a" : "o")} className={primary}>
          Order up {cardText(state.upcard)} — {sitsOut ? `${name(state.dealer)} sits out` : who}
        </button>
        {aloneToggle}
        <button type="button" data-euchre-pass onClick={() => send("x")} className={quiet}>
          Pass
        </button>
      </div>
    );
  }
  if (game === "euchre" && state.phase === 1)
    return (
      <div className="flex flex-wrap items-center justify-center gap-2 text-[12.5px]" data-euchre-name>
        <span>Name trump:</span>
        {["S", "H", "D", "C"].filter((s) => !state.upcard || s !== state.upcard[1]).map((s) => (
          <button key={s} type="button" data-euchre-trump-pick={s} onClick={() => send(`t:${s}${alone ? ":a" : ""}`)} className={suitBtn(s)}>
            {SUIT_SYMBOL[s]}
          </button>
        ))}
        {aloneToggle}
        <button type="button" data-euchre-pass onClick={() => send("x")} className={quiet}>
          Pass
        </button>
      </div>
    );
  if (game === "euchre" && state.phase === 4 && me === state.dealer)
    return (
      <div className="text-[12.5px] font-semibold" data-euchre-discard>
        You picked up {state.upcard ? cardText(state.upcard) : "the card"} — click the card to put away
      </div>
    );
  if (game === "hearts" && state.phase === 3) {
    const to = name((me + state.passTo) % 4);
    return (
      <div className="flex flex-wrap items-center justify-center gap-2 text-[12.5px]" data-hearts-pass>
        <span>
          Choose three cards to pass {PASS_WORD[state.passTo]} to {to} ({picked.length}/3)
        </span>
        <button type="button" data-hearts-pass-send disabled={picked.length !== 3} onClick={() => send(`g:${picked.join(",")}`)} className={primary}>
          Pass {picked.length === 3 ? picked.map(cardText).join(" ") : "3 cards"}
        </button>
      </div>
    );
  }
  return null;
}

/** Picks a card for the Hearts pass (up to three). */
export const togglePick = (picked: string[], c: string) => (picked.includes(c) ? picked.filter((x) => x !== c) : picked.length < 3 ? [...picked, c] : picked);

/** Hearts, Spades and Euchre share this table: four seats, a trick in the middle, your hand below. */
function TrickTable({ game, moves, canPlay, turn, seat, seats, starter = 0, seed = "", local, onMove }: BoardProps & { game: TrickGame }) {
  const rules = TRICK_RULES[game];
  const state = useTrickState(game, moves, seed);
  const [picked, setPicked] = useState<string[]>([]);
  if (!state) return null;
  const me = local ? turn : seat;
  const name = (p: number) => seatFor(seats, starter, p, 4).name;
  const colour = (p: number) => seatFor(seats, starter, p, 4).color;
  const say = (t: string) => namesIn(t, seats, starter, 4);
  const hand = sortHand(state.hands[me] ?? []);
  const mode = trickHandMode(state, game, me, canPlay);
  const playable = mode === "play" ? trickPlayable(state, me, rules) : [];
  const chosen = picked.filter((c) => hand.includes(c));
  // The last trick stays on the table until the next card (not across a new deal: those cards are dealt again).
  const showing = state.trick.length ? state.trick : state.won.some((w) => w > 0) ? state.lastTrick : [];
  const lastText = lastTrickText(state, name);
  const prompt = trickPrompt(state, game, name);
  const status = trickStatus(state, game, name);
  const dealerBadge = game !== "hearts";
  const seatBox = (p: number) => (
    <div key={p} data-trick-seat={p} className={`flex min-w-[124px] flex-col items-center gap-1 rounded-xl px-2 py-1 ${p === state.turn && !state.over ? "bg-indigo-500/10 ring-1 ring-indigo-500/40" : ""} ${state.gone[p] || p === state.sitOut ? "opacity-50" : ""}`}>
      <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold">
        <span className="g3-token h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colour(p) }} /> {name(p)}
        {dealerBadge && p === state.dealer && (
          <span className="rounded-full bg-white px-1.5 text-[9.5px] font-bold text-slate-900 ring-1 ring-black/20" data-trick-dealer title="Dealer">
            D
          </span>
        )}
      </span>
      {game !== "hearts" && <span className="text-[10.5px] text-slate-400">Partner: {name(partnerOf(p))}</span>}
      <span className="text-[11px] text-slate-500">{trickSeatNote(state, game, p)}</span>
      {p !== me || local ? <CardBack small count={state.hands[p]?.length ?? 0} /> : null}
    </div>
  );
  const handClick = (c: string) => {
    if (mode === "play" && playable.includes(c)) return () => onMove(`p:${c}`);
    if (mode === "pass") return () => setPicked(togglePick(chosen, c));
    if (mode === "discard") return () => onMove(`d:${c}`);
    return undefined;
  };
  return (
    <div data-game-board={game} className="flex w-full max-w-[680px] flex-col items-center gap-3">
      <div className="flex flex-wrap justify-center gap-2">{[0, 1, 2, 3].map(seatBox)}</div>
      {prompt && (
        <div className="text-[12.5px] font-semibold" data-trick-prompt>
          {prompt}
        </div>
      )}
      <div className="flex min-h-[92px] min-w-[300px] flex-wrap items-center justify-center gap-2 rounded-2xl bg-emerald-800 px-4 py-2" data-trick-table>
        {!showing.length && !(game === "euchre" && state.phase === 0) && !lastText && !status && <span className="text-[12px] text-emerald-100">No cards on the table yet</span>}
        {game === "euchre" && state.upcard && !state.trump && state.phase === 0 && (
          <div className="flex flex-col items-center gap-0.5" data-euchre-upcard>
            <CardFace card={state.upcard} small testId={`upcard:${state.upcard}`} />
            <span className="text-[10px] text-emerald-100">turned up</span>
          </div>
        )}
        {showing.map((t) => (
          <div key={t.player} className={`flex flex-col items-center gap-0.5 ${state.trick.length ? "" : "opacity-80"}`}>
            <CardFace card={t.card} small lit={!state.trick.length && t.player === state.lastWinner} testId={`trick:${t.card}`} />
            <span className="text-[10px] text-emerald-100">{name(t.player)}</span>
          </div>
        ))}
        {(status || lastText) && (
          <div className="flex flex-col items-center gap-0.5 text-[11.5px] text-emerald-100">
            {lastText && <span data-trick-last>{lastText}</span>}
            {status && <span data-euchre-trump>{status}</span>}
          </div>
        )}
      </div>
      <TrickControls state={state} game={game} me={me} canPlay={canPlay} name={name} onMove={onMove} picked={chosen} onPicked={setPicked} />
      <div className="flex flex-col items-center gap-1">
        <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{local ? `${name(me)}'s cards` : "Your cards"}</div>
        <div className="flex flex-wrap justify-center gap-1" data-trick-hand>
          {hand.map((c) => {
            const click = handClick(c);
            const lit = mode === "pass" ? chosen.includes(c) : (state.received[me] ?? []).includes(c);
            return <CardFace key={c} card={c} small testId={`hand:${c}`} lit={lit} dim={mode === "play" && !playable.includes(c)} onClick={click} />;
          })}
        </div>
        {game === "hearts" && (state.received[me] ?? []).length > 0 && mode !== "pass" && <div className="text-[10.5px] text-slate-500">Raised cards were passed to you.</div>}
      </div>
      {state.log.length > 0 && (
        <div className="text-[11px] text-slate-500" data-trick-log>
          {say(state.log[state.log.length - 1])}
        </div>
      )}
    </div>
  );
}

export const HeartsBoard = (p: BoardProps) => <TrickTable {...p} game="hearts" />;
export const SpadesBoard = (p: BoardProps) => <TrickTable {...p} game="spades" />;
export const EuchreBoard = (p: BoardProps) => <TrickTable {...p} game="euchre" />;
