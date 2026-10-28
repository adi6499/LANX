// LANX 2.16.0: the nine card games on the 3D card table (three/cardTable.ts).
// Each game only lays out its cards — your hand, the others' face-down
// hands, the stock, the pile, the trick, the dealer, the chips — and keeps
// the buttons it always had (bids, suits, raises) under the table. The
// moves are exactly the flat boards' moves. LANX 2.17.0: the same words,
// buttons and result panels as the flat boards (they share them).

import * as THREE from "three";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { namesIn, seatFor, type BoardProps } from "../../boardProps";
import { RANK_NAME, RANKS, SUIT_SYMBOL, cardText, rankOf, sortHand } from "../../../../lib/games/cards.ts";
import { crazy8, crazy8Playable } from "../../../../lib/games/crazy8.ts";
import { OCHO_COLOUR_NAME, ocho, ochoCardName, ochoPlayable } from "../../../../lib/games/ocho.ts";
import { gofish } from "../../../../lib/games/gofish.ts";
import { BJ_ROUNDS, bjValue, blackjack } from "../../../../lib/games/blackjack.ts";
import { TRICK_RULES, partnerOf, trickPlayable } from "../../../../lib/games/tricks.ts";
import { deadwood, ginrummy } from "../../../../lib/games/ginrummy.ts";
import { HOLDEM_HANDS, holdem } from "../../../../lib/games/holdem.ts";
import { TrickControls, lastTrickText, togglePick, trickHandMode, trickPrompt, trickSeatNote, trickStatus, useTrickState, type TrickGame } from "../../boards/TrickBoard";
import { BlackjackActions, BlackjackLast, bjDealerLine } from "../../boards/BlackjackBoard";
import { HoldemActions, HoldemLastHand } from "../../boards/HoldemBoard";
import { GinKnockPanel } from "../../boards/GinBoard";
import { CardTableScene, TOP, backFan, handSpots, pileSpots, seatPlaces, towardMiddle, type CardSpot, type ChipStack, type FacePainter } from "../cardTable";
import { FONT, roundRect } from "../kit";
import { SceneBox, useScene } from "../Board3D";
import { BoardBar, HiddenActions, primary3, quiet3, type Action } from "../ui";

const STOCK_AT = new THREE.Vector3(-1.1, 0, 0);
const PILE_AT = new THREE.Vector3(0.6, 0, 0);

/** Who sits where: me (or, at one PC, whoever's turn it is) at the near edge; the others round the far side. */
function useSeating(p: BoardProps, n: number) {
  const me = p.local ? Math.max(0, p.turn) : p.seat;
  return useMemo(() => {
    const others: number[] = [];
    for (let k = 1; k < n; k++) others.push((me + k) % n);
    const places = seatPlaces(others.length);
    const at = new Map<number, THREE.Vector3>();
    others.forEach((q, i) => at.set(q, places[i]));
    at.set(me, new THREE.Vector3(0, TOP, 3.9));
    return { me, others, at };
  }, [me, n]);
}

function stockSpots(count: number, at = STOCK_AT): CardSpot[] {
  return pileSpots(at, Math.min(6, Math.ceil(count / 8)), 0.01).map((s, k) => ({ key: `stock:${k}`, card: null, faceUp: false, pos: s.pos, yaw: s.yaw }));
}

function backSpots(p: number, at: THREE.Vector3, count: number): CardSpot[] {
  return backFan(at, count).map((s, k) => ({ key: `b:${p}:${k}`, card: null, faceUp: false, pos: s.pos, yaw: s.yaw, from: STOCK_AT.clone().setY(TOP + 0.1) }));
}

function useTable(painter?: FacePainter, colour?: string) {
  return useScene((el) => {
    const s = new CardTableScene(el, colour);
    if (painter) s.setPainter(painter);
    return s;
  });
}

function Frame({ testId, children, under, hostRef }: { testId: string; children?: ReactNode; under?: ReactNode; hostRef: React.RefObject<HTMLDivElement | null> }) {
  return (
    <div data-game-board={testId} data-g3-board={testId} className="flex w-full max-w-[860px] flex-col items-center gap-2">
      {children}
      <SceneBox hostRef={hostRef} aspect={1.5} maxH={540} testId={testId} />
      {under}
    </div>
  );
}

/** The hand at the near edge: playable cards can be clicked. */
function handCards(cards: string[], playable: (c: string) => boolean, onPick: (c: string) => void, canPlay: boolean, lit?: (c: string) => boolean, key = (c: string, i: number) => `c:${c}#${i}`): CardSpot[] {
  const spots = handSpots(cards.length);
  return cards.map((c, i) => {
    const ok = canPlay && playable(c);
    return { key: key(c, i), card: c, faceUp: true, pos: spots[i].pos, yaw: spots[i].yaw, tilt: spots[i].tilt, dim: canPlay && !ok, lit: lit?.(c), from: STOCK_AT.clone().setY(TOP + 0.1), onClick: ok ? () => onPick(c) : undefined };
  });
}

const occ = (cards: string[]) => {
  const seen = new Map<string, number>();
  return cards.map((c) => {
    const k = seen.get(c) ?? 0;
    seen.set(c, k + 1);
    return k;
  });
};

const Note = ({ children, testId }: { children: ReactNode; testId: string }) => (
  <span className="font-normal text-slate-500" {...{ [`data-${testId}`]: "" }}>
    {children}
  </span>
);

// ============================================================ Crazy Eights

export function Crazy83D(p: BoardProps) {
  const n = Math.max(2, p.seats?.length ?? 2);
  const seed = p.seed ?? "";
  const state = useMemo(() => crazy8.replay(p.moves, n, seed), [p.moves, n, seed]);
  const { me, others, at } = useSeating(p, n);
  const [eight, setEight] = useState<string | null>(null);
  const send = useRef(p.onMove);
  send.current = p.onMove;
  const [hostRef, scene] = useTable();
  const name = (q: number) => seatFor(p.seats, p.starter ?? 0, q, n).name;
  const colour = (q: number) => seatFor(p.seats, p.starter ?? 0, q, n).color;
  useEffect(() => {
    if (!scene || !state) return;
    const hand = sortHand(state.hands[me] ?? []);
    const pick = (c: string) => (rankOf(c) === "8" ? setEight(c) : send.current(`p:${c}`));
    const stuck = p.canPlay && !hand.some((c) => crazy8Playable(state, c));
    const spots: CardSpot[] = [
      ...stockSpots(state.stock.length).map((s, k, all) => (k === all.length - 1 && stuck && state.stock.length ? { ...s, onClick: () => send.current("d") } : s)),
      ...pileSpots(PILE_AT, Math.min(state.pile.length, 6)).map((s, k) => {
        const c = state.pile[state.pile.length - Math.min(state.pile.length, 6) + k];
        return { key: `c:${c}#0`, card: c, faceUp: true, pos: s.pos, yaw: s.yaw, from: at.get((state.turn - 1 + n) % n)?.clone() };
      }),
      ...handCards(hand, (c) => crazy8Playable(state, c), pick, p.canPlay, undefined, (c) => `c:${c}#0`),
      ...others.flatMap((q) => (state.gone[q] ? [] : backSpots(q, at.get(q)!, state.hands[q].length))),
    ];
    scene.setCards(spots);
    scene.setSeats(others.map((q) => ({ name: name(q), colour: colour(q), at: at.get(q)!, active: q === state.turn && !state.gone[q], note: state.gone[q] ? "left" : `${state.hands[q].length} cards` })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, state, me, p.canPlay, others, at]);
  if (!state) return null;
  const hand = state.hands[me] ?? [];
  const stuck = p.canPlay && !hand.some((c) => crazy8Playable(state, c));
  const actions: Action[] = p.canPlay ? hand.filter((c) => crazy8Playable(state, c)).map((c) => ({ key: c, label: `Play ${cardText(c)}`, run: () => (rankOf(c) === "8" ? setEight(c) : p.onMove(`p:${c}`)), attrs: { "data-card": `hand:${c}` } })) : [];
  return (
    <Frame
      testId="crazy8"
      hostRef={hostRef}
      under={
        <>
          {eight && (
            <div className="flex items-center gap-2 text-[12.5px]" data-crazy8-pick-suit>
              <span>Name the suit:</span>
              {["S", "H", "D", "C"].map((s) => (
                <button key={s} type="button" data-crazy8-suit-pick={s} onClick={() => { p.onMove(`p:${eight}:${s}`); setEight(null); }} className={`h-8 w-8 rounded-full bg-white text-[18px] shadow ring-1 ring-black/20 ${s === "H" || s === "D" ? "text-rose-600" : "text-slate-900"}`}>
                  {SUIT_SYMBOL[s]}
                </button>
              ))}
            </div>
          )}
          {stuck && state.stock.length === 0 && state.passes > 0 && <div className="text-[11px] text-slate-500">If everyone passes in a row the game is blocked: fewest card points wins (8 = 50, pictures 10, ace 1).</div>}
          <HiddenActions actions={actions} label="Cards you can play" />
        </>
      }
    >
      <BoardBar>
        <span data-crazy8-suit>suit to follow: {SUIT_SYMBOL[state.suit]}</span>
        {stuck && state.stock.length > 0 && (
          <button type="button" data-crazy8-draw onClick={() => p.onMove("d")} className={primary3}>
            Draw a card
          </button>
        )}
        {stuck && state.stock.length === 0 && (
          <button type="button" data-crazy8-pass onClick={() => p.onMove("x")} className="rounded-full bg-amber-500 px-4 py-1.5 text-white">
            Pass
          </button>
        )}
        {state.event ? <Note testId="crazy8-event">{namesIn(state.event, p.seats, p.starter ?? 0, n)}</Note> : <Note testId="crazy8-front">{p.local ? `${name(me)}'s cards` : "Your cards"} at the front</Note>}
      </BoardBar>
    </Frame>
  );
}

// ============================================================ Ocho

const OBG: Record<string, string> = { R: "#dc2626", G: "#16a34a", B: "#2563eb", Y: "#eab308", W: "#111827", F: "#111827" };
const OFACE: Record<string, string> = { S: "⊘", V: "⇄", D: "+2", W: "★", F: "+4" };

const paintOcho: FacePainter = (card, ctx, w, h) => {
  ctx.fillStyle = "#fdfdfb";
  roundRect(ctx, 0, 0, w, h, 26);
  ctx.fill();
  ctx.fillStyle = OBG[card[0]] ?? "#111827";
  roundRect(ctx, 12, 12, w - 24, h - 24, 18);
  ctx.fill();
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(-0.5);
  ctx.beginPath();
  ctx.ellipse(0, 0, w * 0.34, h * 0.4, 0, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.restore();
  const face = card.length === 2 ? (OFACE[card[1]] ?? card[1]) : OFACE[card];
  if (card === "W" || card === "F") {
    const cols = ["#dc2626", "#2563eb", "#eab308", "#16a34a"];
    cols.forEach((c, k) => {
      ctx.beginPath();
      ctx.moveTo(w / 2, h / 2);
      ctx.arc(w / 2, h / 2, w * 0.24, (k * Math.PI) / 2, ((k + 1) * Math.PI) / 2);
      ctx.fillStyle = c;
      ctx.fill();
    });
  }
  ctx.fillStyle = card === "W" || card === "F" ? "#ffffff" : OBG[card[0]];
  ctx.font = `900 ${face.length > 1 ? w * 0.3 : w * 0.42}px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (card === "W" || card === "F") {
    ctx.strokeStyle = "#111827";
    ctx.lineWidth = 6;
    ctx.strokeText(face, w / 2, h / 2 + 4);
  }
  ctx.fillText(face, w / 2, h / 2 + 4);
  ctx.fillStyle = "#ffffff";
  ctx.font = `800 ${w * 0.15}px ${FONT}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(face, 22, 20);
};

export function Ocho3D(p: BoardProps) {
  const n = Math.max(2, p.seats?.length ?? 2);
  const seed = p.seed ?? "";
  const state = useMemo(() => ocho.replay(p.moves, n, seed), [p.moves, n, seed]);
  const { me, others, at } = useSeating(p, n);
  const [wild, setWild] = useState<string | null>(null);
  const send = useRef(p.onMove);
  send.current = p.onMove;
  const [hostRef, scene] = useTable(paintOcho);
  const name = (q: number) => seatFor(p.seats, p.starter ?? 0, q, n).name;
  const colour = (q: number) => seatFor(p.seats, p.starter ?? 0, q, n).color;
  useEffect(() => {
    if (!scene || !state) return;
    const hand = state.hands[me] ?? [];
    const playable = (c: string) => ochoPlayable(state, c) && (!state.drawn || c === state.drawn);
    const pick = (c: string) => (c === "W" || c === "F" ? setWild(c) : send.current(`p:${c}`));
    const stuck = p.canPlay && !state.drawn && !hand.some((c) => ochoPlayable(state, c));
    const ho = occ(hand);
    const spots: CardSpot[] = [
      ...stockSpots(state.stock.length).map((s, k, all) => (k === all.length - 1 && stuck ? { ...s, onClick: () => send.current("d") } : s)),
      ...pileSpots(PILE_AT, Math.min(state.pile.length, 6)).map((s, k) => {
        const idx = state.pile.length - Math.min(state.pile.length, 6) + k;
        const c = state.pile[idx];
        return { key: `pile:${idx}:${c}`, card: c, faceUp: true, pos: s.pos, yaw: s.yaw, from: (at.get((state.turn - state.dir + n) % n) ?? at.get(me)!).clone().setY(TOP + 0.3) };
      }),
      ...handCards(hand, playable, pick, p.canPlay, (c) => c === state.drawn, (c, i) => `h:${c}#${ho[i]}`),
      ...others.flatMap((q) => (state.gone[q] ? [] : backSpots(q, at.get(q)!, state.hands[q].length))),
    ];
    scene.setCards(spots);
    scene.setSeats(others.map((q) => ({ name: name(q), colour: colour(q), at: at.get(q)!, active: q === state.turn && !state.gone[q], note: state.gone[q] ? "left" : `${state.hands[q].length} cards` })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, state, me, p.canPlay, others, at]);
  if (!state) return null;
  const hand = state.hands[me] ?? [];
  const playable = (c: string) => p.canPlay && ochoPlayable(state, c) && (!state.drawn || c === state.drawn);
  const stuck = p.canPlay && !state.drawn && !hand.some((c) => ochoPlayable(state, c));
  const actions: Action[] = hand.filter(playable).map((c, i) => ({ key: `${c}${i}`, label: `Play ${ochoCardName(c)}`, run: () => (c === "W" || c === "F" ? setWild(c) : p.onMove(`p:${c}`)), attrs: { "data-ocho-card": `hand:${c}` } }));
  return (
    <Frame
      testId="ocho"
      hostRef={hostRef}
      under={
        <>
          {wild && (
            <div className="flex items-center gap-2 text-[12.5px]" data-ocho-pick-colour>
              <span>Name the colour:</span>
              {["R", "G", "B", "Y"].map((c) => (
                <button key={c} type="button" data-ocho-colour-pick={c} aria-label={OCHO_COLOUR_NAME[c]} onClick={() => { p.onMove(`p:${wild}:${c}`); setWild(null); }} className="h-8 w-8 rounded-full shadow ring-2 ring-white" style={{ backgroundColor: OBG[c] }} />
              ))}
            </div>
          )}
          <HiddenActions actions={actions} label="Cards you can play" />
        </>
      }
    >
      <BoardBar>
        <span className="inline-flex items-center gap-1.5" data-ocho-colour>
          <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: OBG[state.colour] }} /> {OCHO_COLOUR_NAME[state.colour]} {state.dir === -1 ? "· ↺" : ""}
        </span>
        {stuck && (
          <button type="button" data-ocho-draw onClick={() => p.onMove("d")} className={primary3}>
            Draw a card
          </button>
        )}
        {state.drawn && p.canPlay && (
          <button type="button" data-ocho-keep onClick={() => p.onMove("k")} className={quiet3}>
            Keep it, pass
          </button>
        )}
        {state.event && <Note testId="ocho-event">{namesIn(state.event, p.seats, p.starter ?? 0, n)}</Note>}
      </BoardBar>
    </Frame>
  );
}

// ============================================================ Go Fish

export function GoFish3D(p: BoardProps) {
  const n = Math.max(2, p.seats?.length ?? 2);
  const seed = p.seed ?? "";
  const state = useMemo(() => gofish.replay(p.moves, n, seed), [p.moves, n, seed]);
  const { me, others, at } = useSeating(p, n);
  const [rank, setRank] = useState<string | null>(null);
  const [hostRef, scene] = useTable();
  const name = (q: number) => seatFor(p.seats, p.starter ?? 0, q, n).name;
  const colour = (q: number) => seatFor(p.seats, p.starter ?? 0, q, n).color;
  useEffect(() => {
    if (!scene || !state) return;
    const hand = sortHand(state.hands[me] ?? []);
    const spots: CardSpot[] = [
      ...stockSpots(state.stock.length, new THREE.Vector3(0, 0, 0)),
      ...handCards(hand, () => p.canPlay, (c) => setRank((r) => (r === rankOf(c) ? null : rankOf(c))), p.canPlay, (c) => rank !== null && rankOf(c) === rank, (c) => `c:${c}#0`),
      ...others.flatMap((q) => backSpots(q, at.get(q)!, state.hands[q].length)),
    ];
    scene.setCards(spots);
    scene.setSeats(others.map((q) => ({ name: name(q), colour: colour(q), at: at.get(q)!, active: q === state.turn && !state.gone[q], note: state.gone[q] ? `left · ${state.books[q]} books` : `${state.hands[q].length} cards · ${state.books[q]} books` })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, state, me, p.canPlay, others, at, rank]);
  if (!state) return null;
  const hand = sortHand(state.hands[me] ?? []);
  const ranksHeld = RANKS.filter((r) => hand.some((c) => rankOf(c) === r));
  return (
    <Frame
      testId="gofish"
      hostRef={hostRef}
      under={
        p.canPlay && (
          <div className="flex flex-col items-center gap-2 text-[12.5px]" data-gofish-ask>
            <div className="flex flex-wrap items-center justify-center gap-1.5">
              <span>Ask for (or click a card):</span>
              {ranksHeld.map((r) => (
                <button key={r} type="button" data-gofish-rank={r} onClick={() => setRank(rank === r ? null : r)} className={`h-8 min-w-8 rounded-full px-2 text-[13px] font-bold ${rank === r ? "bg-indigo-600 text-white" : "bg-white text-slate-900 shadow ring-1 ring-black/20"}`}>
                  {RANK_NAME[r] ?? r}
                </button>
              ))}
            </div>
            {rank && (
              <div className="flex flex-wrap items-center justify-center gap-1.5">
                <span>from:</span>
                {state.hands.map((h, q) =>
                  q === me || h.length === 0 || state.gone[q] ? null : (
                    <button key={q} type="button" data-gofish-ask-player={q} onClick={() => { p.onMove(`a:${q}:${rank}`); setRank(null); }} className={primary3}>
                      {name(q)}
                    </button>
                  ),
                )}
              </div>
            )}
          </div>
        )
      }
    >
      <BoardBar>
        <span data-gofish-books>
          Your books: {state.books[me]} · stock {state.stock.length}
        </span>
        {state.event && (
          <span className="rounded-full bg-sky-500/15 px-3 py-0.5 font-normal text-sky-800 dark:text-sky-200" data-gofish-event>
            {namesIn(state.event, p.seats, p.starter ?? 0, n)}
          </span>
        )}
      </BoardBar>
    </Frame>
  );
}

// ============================================================ Blackjack

export function Blackjack3D(p: BoardProps) {
  const n = Math.max(1, p.seats?.length ?? 1);
  const seed = p.seed ?? "";
  const state = useMemo(() => blackjack.replay(p.moves, n, seed), [p.moves, n, seed]);
  const me = p.local ? Math.max(0, p.turn) : p.seat;
  const [hostRef, scene] = useTable(undefined, "#155e4b");
  const name = (q: number) => seatFor(p.seats, p.starter ?? 0, q, n).name;
  const colour = (q: number) => seatFor(p.seats, p.starter ?? 0, q, n).color;
  // Everyone sits along the near edge, facing the dealer across the table.
  const places = useMemo(() => Array.from({ length: n }, (_, q) => new THREE.Vector3((q - (n - 1) / 2) * Math.min(3, 10 / Math.max(1, n)), TOP, 2.2)), [n]);
  useEffect(() => {
    if (!scene || !state) return;
    const dealerDone = state.settled || !state.active.some(Boolean);
    const shoe = new THREE.Vector3(4.6, TOP, -2.4);
    const spots: CardSpot[] = [];
    state.dealer.forEach((c, i) => {
      const hidden = i === 1 && !dealerDone;
      spots.push({ key: `d:${state.round}:${i}`, card: hidden ? null : c, faceUp: !hidden, pos: new THREE.Vector3((i - (state.dealer.length - 1) / 2) * 0.8, TOP + 0.01 + i * 0.002, -2.3), from: shoe });
    });
    const width = Math.min(3, 10 / Math.max(1, n));
    state.boxes.forEach((box, q) => {
      const seen = new Map<string, number>();
      box.forEach((h, b) => {
        const centre = places[q].clone().add(new THREE.Vector3(box.length > 1 ? (b - 0.5) * Math.min(1.35, width * 0.48) : 0, 0, 0));
        h.cards.forEach((c, i) => {
          const k = seen.get(c) ?? 0;
          seen.set(c, k + 1);
          const on = q === state.turn && state.active[q] && state.hand === b && box.length > 1;
          spots.push({ key: `p:${state.round}:${q}:${c}#${k}`, card: c, faceUp: true, lit: on, pos: centre.clone().add(new THREE.Vector3((i - (h.cards.length - 1) / 2) * 0.3, 0.01 + i * 0.004, -0.1 * i)), yaw: (i - (h.cards.length - 1) / 2) * 0.05, from: shoe });
        });
      });
    });
    scene.setCards(spots);
    scene.setChips(state.points.map((pt, q) => ({ key: `bj${q}`, amount: Math.max(0, pt) + 25, pos: places[q].clone().add(new THREE.Vector3(0.9, 0, 0.7)) } satisfies ChipStack)));
    scene.setSeats(
      state.boxes.map((box, q) => ({
        name: `${name(q)}${q === me && !p.local ? " (you)" : ""}`,
        colour: colour(q),
        at: places[q].clone().add(new THREE.Vector3(0, 0, 1.2)),
        active: q === state.turn && state.active[q] && !state.over,
        note: state.gone[q]
          ? "left"
          : `${box.map((h) => `${bjValue(h.cards)}${bjValue(h.cards) > 21 ? " bust" : ""}${h.stake > 1 ? " ×2" : ""}`).join(" / ")} · ${state.points[q] >= 0 ? "+" : ""}${state.points[q]} pts`,
      })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, state, places, me]);
  if (!state) return null;
  return (
    <Frame
      testId="blackjack"
      hostRef={hostRef}
      under={
        <>
          {p.canPlay && <BlackjackActions state={state} onMove={p.onMove} primary={primary3} quiet={quiet3} />}
          <BlackjackLast rounds={state.lastRounds} name={name} />
        </>
      }
    >
      <BoardBar>
        <span>
          Round {state.round} of {BJ_ROUNDS} · {bjDealerLine(state)}
        </span>
        {state.boxes[state.turn]?.length > 1 && state.active[state.turn] && <Note testId="bj-split">{name(state.turn)}: hand {state.hand + 1} of 2</Note>}
      </BoardBar>
    </Frame>
  );
}

// ============================================================ Hearts, Spades, Euchre

function Tricks3D(p: BoardProps & { game: TrickGame }) {
  const rules = TRICK_RULES[p.game];
  const seed = p.seed ?? "";
  const state = useTrickState(p.game, p.moves, seed);
  const { me, others, at } = useSeating(p, 4);
  const [picked, setPicked] = useState<string[]>([]);
  const send = useRef(p.onMove);
  send.current = p.onMove;
  const [hostRef, scene] = useTable();
  const name = (q: number) => seatFor(p.seats, p.starter ?? 0, q, 4).name;
  const colour = (q: number) => seatFor(p.seats, p.starter ?? 0, q, 4).color;
  const teams = p.game !== "hearts";
  useEffect(() => {
    if (!scene || !state) return;
    const hand = sortHand(state.hands[me] ?? []);
    const mode = trickHandMode(state, p.game, me, p.canPlay);
    const playable = mode === "play" ? trickPlayable(state, me, rules) : [];
    const chosen = picked.filter((c) => hand.includes(c));
    // The last trick stays on the table until the next card (not across a new deal: those cards are dealt again).
    const thisRound = state.won.some((w) => w > 0);
    const showing = state.trick.length ? state.trick : thisRound ? state.lastTrick : [];
    const onPick = (c: string) => {
      if (mode === "play") send.current(`p:${c}`);
      else if (mode === "pass") setPicked((cur) => togglePick(cur.filter((x) => hand.includes(x)), c));
      else if (mode === "discard") send.current(`d:${c}`);
    };
    const clickable = (c: string) => (mode === "play" ? playable.includes(c) : mode !== null);
    const lit = (c: string) => (mode === "pass" ? chosen.includes(c) : (state.received[me] ?? []).includes(c));
    const spots: CardSpot[] = [
      ...handCards(hand, clickable, onPick, mode !== null, lit, (c) => `c:${c}#0`),
      ...others.flatMap((q) => backSpots(q, at.get(q)!, state.hands[q].length)),
      ...showing.map((t, k) => ({ key: `c:${t.card}#0`, card: t.card, faceUp: true, lit: !state.trick.length && t.player === state.lastWinner, pos: towardMiddle(at.get(t.player)!, 0.62).setY(TOP + 0.01 + k * 0.004), yaw: (t.player - me) * 0.2, from: at.get(t.player)!.clone().setY(TOP + 0.3) })),
    ];
    if (p.game === "euchre" && state.upcard && !state.trump && state.phase === 0) spots.push({ key: `c:${state.upcard}#0`, card: state.upcard, faceUp: true, pos: new THREE.Vector3(0, TOP + 0.01, -0.2) });
    scene.setCards(spots);
    scene.setSeats(
      others.map((q) => ({
        name: `${name(q)}${teams && q === state.dealer ? " · dealer" : ""}`,
        colour: colour(q),
        at: at.get(q)!,
        active: q === state.turn && !state.over,
        note: `${teams && q === partnerOf(me) ? "your partner · " : ""}${trickSeatNote(state, p.game, q)}`,
      })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, state, me, p.canPlay, others, at, picked]);
  if (!state) return null;
  const hand = sortHand(state.hands[me] ?? []);
  const mode = trickHandMode(state, p.game, me, p.canPlay);
  const playable = mode === "play" ? trickPlayable(state, me, rules) : [];
  const chosen = picked.filter((c) => hand.includes(c));
  const actions: Action[] =
    mode === "play"
      ? playable.map((c) => ({ key: c, label: `Play ${cardText(c)}`, run: () => p.onMove(`p:${c}`), attrs: { "data-card": `hand:${c}` } }))
      : mode === "pass"
        ? hand.map((c) => ({ key: c, label: `${chosen.includes(c) ? "Keep" : "Pass"} ${cardText(c)}`, run: () => setPicked(togglePick(chosen, c)), attrs: { "data-card": `hand:${c}` } }))
        : mode === "discard"
          ? hand.map((c) => ({ key: c, label: `Put away ${cardText(c)}`, run: () => p.onMove(`d:${c}`), attrs: { "data-card": `hand:${c}` } }))
          : [];
  const prompt = trickPrompt(state, p.game, name);
  const lastText = lastTrickText(state, name);
  const status = trickStatus(state, p.game, name);
  return (
    <Frame
      testId={p.game}
      hostRef={hostRef}
      under={
        <>
          <TrickControls state={state} game={p.game} me={me} canPlay={p.canPlay} name={name} onMove={p.onMove} picked={chosen} onPicked={setPicked} primary={primary3} quiet={quiet3} />
          <HiddenActions actions={actions} label={mode === "pass" ? "Cards to pass" : mode === "discard" ? "The card to put away" : "Cards you can play"} />
          {state.log.length > 0 && (
            <div className="text-[11px] text-slate-500" data-trick-log>
              {namesIn(state.log[state.log.length - 1], p.seats, p.starter ?? 0, 4)}
            </div>
          )}
        </>
      }
    >
      <BoardBar>
        <span data-trick-me>
          {p.local ? name(me) : "You"}
          {teams && me === state.dealer ? " (dealer)" : ""}: {trickSeatNote(state, p.game, me)}
          {teams ? ` · Partner: ${name(partnerOf(me))}` : ""}
        </span>
        {prompt && <span data-trick-prompt>{prompt}</span>}
        {lastText && <Note testId="trick-last">{lastText}</Note>}
        {status && <Note testId="euchre-trump">{status}</Note>}
      </BoardBar>
    </Frame>
  );
}

export const Hearts3D = (p: BoardProps) => <Tricks3D {...p} game="hearts" />;
export const Spades3D = (p: BoardProps) => <Tricks3D {...p} game="spades" />;
export const Euchre3D = (p: BoardProps) => <Tricks3D {...p} game="euchre" />;

// ============================================================ Gin Rummy

export function Gin3D(p: BoardProps) {
  const seed = p.seed ?? "";
  const state = useMemo(() => ginrummy.replay(p.moves, 2, seed), [p.moves, seed]);
  const { me, others, at } = useSeating(p, 2);
  const [knocking, setKnocking] = useState(false);
  const send = useRef(p.onMove);
  send.current = p.onMove;
  const [hostRef, scene] = useTable();
  const name = (q: number) => seatFor(p.seats, p.starter ?? 0, q, 2).name;
  const colour = (q: number) => seatFor(p.seats, p.starter ?? 0, q, 2).color;
  useEffect(() => {
    if (!scene || !state) return;
    const hand = sortHand(state.hands[me] ?? []);
    const dw = deadwood(hand);
    const melded = new Set(dw.melds.flat());
    const drawing = p.canPlay && state.phase === "draw";
    const discarding = p.canPlay && state.phase === "discard";
    const canKnockWith = (c: string) => deadwood(hand.filter((x) => x !== c)).points <= 10;
    const spots: CardSpot[] = [
      ...stockSpots(state.stock.length).map((s, k, all) => (k === all.length - 1 && drawing ? { ...s, onClick: () => send.current("ds") } : s)),
      ...pileSpots(PILE_AT, Math.min(state.discard.length, 5)).map((s, k, all) => {
        const c = state.discard[state.discard.length - all.length + k];
        return { key: `c:${c}#0`, card: c, faceUp: true, pos: s.pos, yaw: s.yaw, from: at.get(others[0])!.clone().setY(TOP + 0.3), onClick: drawing && k === all.length - 1 ? () => send.current("dd") : undefined };
      }),
      ...handCards(hand, (c) => discarding && c !== state.tookDiscard && (!knocking || canKnockWith(c)), (c) => { send.current(`${knocking ? "k" : "x"}:${c}`); setKnocking(false); }, discarding, (c) => melded.has(c), (c) => `c:${c}#0`),
      ...others.flatMap((q) => backSpots(q, at.get(q)!, state.hands[q].length)),
    ];
    scene.setCards(spots);
    scene.setSeats(others.map((q) => ({ name: name(q), colour: colour(q), at: at.get(q)!, active: q === state.turn, note: `${state.scores[q]} points` })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, state, me, p.canPlay, others, at, knocking]);
  if (!state) return null;
  const hand = sortHand(state.hands[me] ?? []);
  const dw = deadwood(hand);
  const drawing = p.canPlay && state.phase === "draw";
  const discarding = p.canPlay && state.phase === "discard";
  const canKnockWith = (c: string) => deadwood(hand.filter((x) => x !== c)).points <= 10;
  const actions: Action[] = [
    ...(drawing ? [{ key: "ds", label: "Draw from the stock", run: () => p.onMove("ds"), attrs: { "data-gin-stock": "1" } }, { key: "dd", label: "Take the discard", run: () => p.onMove("dd"), attrs: { "data-gin-discard": "1" } }] : []),
    ...(discarding ? hand.filter((c) => c !== state.tookDiscard).map((c) => ({ key: c, label: `Discard ${cardText(c)}`, run: () => p.onMove(`x:${c}`), attrs: { "data-card": `hand:${c}` } })) : []),
  ];
  return (
    <Frame
      testId="ginrummy"
      hostRef={hostRef}
      under={
        <>
          <HiddenActions actions={actions} label="Your moves" />
          <GinKnockPanel knock={state.lastKnock} name={name} />
          {state.notice && (
            <div className="text-[11px] text-slate-500" data-gin-notice>
              {namesIn(state.notice, p.seats, p.starter ?? 0, 2)}
            </div>
          )}
        </>
      }
    >
      <BoardBar>
        <span data-gin-scores>
          {name(0)} {state.scores[0]} · {name(1)} {state.scores[1]} · round {state.round}
        </span>
        <span className="font-normal text-slate-500">
          deadwood {dw.points} {drawing ? "— draw from the stock or the discard" : discarding ? (knocking ? "— pick the card to discard and knock" : "— click a card to discard") : ""}
        </span>
        {discarding && (
          <button type="button" data-gin-knock-toggle onClick={() => setKnocking((k) => !k)} disabled={!hand.some(canKnockWith)} className={knocking ? "rounded-full bg-amber-500 px-4 py-1.5 text-white" : quiet3}>
            {knocking ? "Knocking…" : "Knock"}
          </button>
        )}
      </BoardBar>
    </Frame>
  );
}

// ============================================================ Texas Hold'em

export function Holdem3D(p: BoardProps) {
  const n = Math.max(2, p.seats?.length ?? 2);
  const seed = p.seed ?? "";
  const state = useMemo(() => holdem.replay(p.moves, n, seed), [p.moves, n, seed]);
  const { me, others, at } = useSeating(p, n);
  const [hostRef, scene] = useTable(undefined, "#14532d");
  const name = (q: number) => seatFor(p.seats, p.starter ?? 0, q, n).name;
  const colour = (q: number) => seatFor(p.seats, p.starter ?? 0, q, n).color;
  const say = (t: string) => namesIn(t, p.seats, p.starter ?? 0, n);
  useEffect(() => {
    if (!scene || !state) return;
    const deck = new THREE.Vector3(-3.2, TOP, -0.4);
    const spots: CardSpot[] = [];
    state.board.forEach((c, i) => spots.push({ key: `c:${c}#0`, card: c, faceUp: true, pos: new THREE.Vector3((i - 2) * 1.0, TOP + 0.01, -0.4), from: deck }));
    for (let q = 0; q < n; q++) {
      const hole = state.hole[q] ?? [];
      if (!hole.length || state.out[q]) continue;
      // Only your own hole cards are face up; the showdown is in the panel above.
      if (q === me) {
        const hs = handSpots(2);
        hole.forEach((c, i) => spots.push({ key: `c:${c}#0`, card: c, faceUp: true, pos: hs[i].pos.clone().setX((i - 0.5) * 1.0), yaw: (0.5 - i) * 0.1, tilt: 0.3, dim: state.folded[q], from: deck }));
      } else {
        const base = towardMiddle(at.get(q)!, 0.18);
        hole.forEach((_, i) => spots.push({ key: `h:${state.hand}:${q}:${i}`, card: null, faceUp: false, pos: base.clone().add(new THREE.Vector3((i - 0.5) * 0.5, 0.01 + i * 0.004, 0)), yaw: (i - 0.5) * 0.15, dim: state.folded[q], from: deck }));
      }
    }
    scene.setCards(spots);
    const pot = state.contributed.reduce((a, b) => a + b, 0) - state.bets.reduce((a, b) => a + b, 0);
    scene.setChips([
      { key: "pot", amount: pot, pos: new THREE.Vector3(0, TOP, 0.9) },
      ...state.bets.map((b, q) => ({ key: `bet${q}`, amount: b, pos: towardMiddle(at.get(q)!, 0.45).add(new THREE.Vector3(0.7, 0, 0)) })),
    ]);
    scene.setSeats(
      others.map((q) => ({
        name: `${name(q)}${q === state.button ? " · D" : ""}`,
        colour: colour(q),
        at: at.get(q)!,
        active: q === state.turn && state.street < 4,
        note: state.gone[q] ? "left" : state.out[q] ? "out" : `${state.chips[q]} chips${state.folded[q] ? " · folded" : state.allin[q] ? " · all in" : ""}`,
      })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, state, me, others, at]);
  if (!state) return null;
  const pot = state.contributed.reduce((a, b) => a + b, 0);
  return (
    <Frame
      testId="holdem"
      hostRef={hostRef}
      under={
        <>
          {p.canPlay && <HoldemActions state={state} onMove={p.onMove} quiet={quiet3} primary={primary3} range />}
          <HoldemLastHand last={state.last} name={name} say={say} />
          {state.log.length > 0 && !state.last && (
            <div className="max-w-full text-center text-[11px] text-slate-500" data-holdem-log>
              {state.log.slice(-2).map((l, i) => (
                <div key={i}>{say(l)}</div>
              ))}
            </div>
          )}
        </>
      }
    >
      <BoardBar>
        <span>
          Hand {state.hand} of {HOLDEM_HANDS} · pot {pot} · {["pre-flop", "flop", "turn", "river", "showdown"][state.street]}
        </span>
        <span className="font-normal text-slate-500" data-holdem-me>
          {p.local ? name(me) : "You"}: {state.gone[me] ? "left" : `${state.chips[me]} chips`}
          {state.bets[me] ? ` · bet ${state.bets[me]}` : ""}
          {me === state.button ? " · dealer" : ""}
        </span>
      </BoardBar>
    </Frame>
  );
}
