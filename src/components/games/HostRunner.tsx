// LANX 2.17.0: a hosted game (the party games, the live arcade) is run by the host's board: its round
// clock, Werewolf's nights and days, the puck. When the host looks away (Back, another game, the games
// window closed), a hidden copy of the flat board keeps running it here, so the table never stalls.

import { Suspense, lazy, useSyncExternalStore, type ComponentType, type LazyExoticComponent } from "react";
import * as games from "../../lib/games";
import { HostAway, type BoardProps } from "./boardProps";

const loaded = new Map<string, LazyExoticComponent<ComponentType<BoardProps>>>();
const boardFor = (game: string) => {
  let b = loaded.get(game);
  if (!b) {
    b = lazy(() => import("./boards/index").then((m) => ({ default: (m.BOARDS[game] ?? (() => null)) as ComponentType<BoardProps> })));
    loaded.set(game, b);
  }
  return b;
};

/** The hosted games this PC runs while nobody is looking at them. */
export function HostRunner() {
  useSyncExternalStore(games.subscribe, games.snapshot, games.snapshot);
  const showing = games.showingMatch();
  const run = games.allMatches().filter((m) => m.mode === "multi" && m.status === "playing" && games.isHost(m) && games.gameMeta(m.game)?.hosted && m.id !== showing);
  if (!run.length) return null;
  return (
    <div hidden aria-hidden data-host-runner>
      <HostAway.Provider value={true}>
        <Suspense fallback={null}>
          {run.map((m) => {
            const Board = boardFor(m.game);
            const mine = games.mySeat(m);
            const props: BoardProps = {
              moves: m.moves,
              canPlay: games.myTurn(m),
              turn: m.turn,
              seat: mine < 0 ? 0 : games.playerOf(m, mine),
              seats: m.seats,
              starter: games.starterSeat(m),
              seed: games.seedOf(m),
              secret: games.secretOf(m),
              onSecret: (v) => games.setSecret(m.id, v),
              local: false,
              deltas: m.deltas,
              onDelta: (d) => games.sendDelta(m.id, d),
              host: true,
              onMove: (mv) => void games.play(m.id, mv),
            };
            return <Board key={`${m.id}#${m.round}`} {...props} />;
          })}
        </Suspense>
      </HostAway.Provider>
    </div>
  );
}
