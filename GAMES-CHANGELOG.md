# LANX Games repair — changelog

The record of the games repair that follows the audit of 14 Nov 2026 (49 games; 12 serious
faults). One entry per fault: what was wrong, what changed, which test proves it. The full
checklist with every status is the document "LANX Games repair plan and checklist".

Run the tests: `npm run test:games` (Node 24 runs the rule files as they are; nothing to build).

## Sprint 1 — the twelve serious faults (LANX 3.16.0, in work)

Tests: `tests/games/sprint1-rules.test.mjs` (12) and `tests/games/sprint1-match.test.mjs` (15).
The match tests run the real match code (`src/lib/games.ts`) once per pretend PC over a pretend
office network on which a send can fail (`tests/games/harness`).

| ID | Game(s) | What was wrong | What changed | Test |
|---|---|---|---|---|
| S1-01 | all games between PCs | A move that could not be sent at that moment (the colleague's LANX locked, or off the network) was never sent again: both PCs waited for each other for good. | A move, the host's news and "another round" are sent until they have arrived: after 1.5, 3, 6, 12 and then every 20 seconds for 15 minutes; at once when anything arrives from that colleague, and when you press Play on the card. A guest's move names its place in the game, so one that arrives twice is played once. (`games.ts`: `sendSure`, `resendPending`) | match: 5 tests "S1-01 …" |
| S1-02 | every game for 3+ players | Someone who was out already (gave up, bankrupt, knocked out) pressed Resign or Leave table again: the game ended for everyone, with no winner. | The store asks the rules: the game knows players leaving and refuses it now, and it is not that player's turn → nothing changes for the others. (`games.ts`: `dropOut`) | match: 9 games "S1-02 …", and "every game for three or more players knows a player leaving" |
| S1-03 | Wordbox, Werewolf | Mixing by sorting with a random comparison. Wordbox: Windows and Linux/iPhone got different letter grids. Werewolf: the host was a wolf 32% of the time instead of 20%. | The shared whole-number shuffle (Wordbox) and a fair shuffle (Werewolf). | rules: 3 tests "S1-03 …" (40 fixed grids in `wordbox-grids.json`) |
| S1-04 | Go Fish | A book that emptied your hand left you with nothing; the board shows nobody to ask who holds nothing; a two-player game could not be finished. | Nobody sits with an empty hand while the stock has cards. | rules: "S1-04 …" (1,000 games) |
| S1-05 | Dominoes | After someone who had passed left, the game was called blocked while the player to move could play; the wrong player could win. | Blocked means: nobody still at the table can play. | rules: "S1-05 …" |
| S1-06 | Draw & Guess | When everyone who still had a drawing turn left between rounds, the game waited for a round that could never open. | The game ends then. | rules: "S1-06 …" |
| S1-07 | Mahjong Duels | Every pair counted the same and the game stopped when stuck, so only the first player could win (or a draw). | **A rule change:** a pair of winds or dragons counts two points, any other pair one; the table is shuffled again whenever no pair is free, until it is cleared. A tile number far off the table is refused (it made every PC work for minutes). | rules: "S1-07 …" (300 games: first player 35–65%, no draw) |
| S1-08 | Bankroll | "The creditor gets what is left" was said and not done; the winner often showed less than someone else. | The cash is paid over; the result shows cash plus streets and houses, and so do both boards ("worth ₹…"). | rules: "S1-08 …" |
| S1-09 | Tap Roulette | The wheel was not random between rounds (two players: the loser simply alternated; four: always a three-way draw). | A well-mixed draw from the seed for every round. | rules: "S1-09 …" (4,000 matches per table size) |
| S1-10 | Werewolf at 11–12, any big table | "x10" and "x11" (players 11 and 12 leaving) were not understood: the game ended for everyone. | The leaver move reads one or two digits. | rules: "S1-10 …" |
| S1-11 | 2048 | Up sent the tiles down and Down sent them up; in 3D those moves did not animate. A score counted only at "game over". | The turn table put right; the moves live in `solo2048.ts`; a score also counts when you leave a game or start a new one. | rules: "S1-11 …" (2,000 boards against a second way of working it out) |
| S1-12 | Hold'em | Chips vanished when a side-pot level belonged only to players who had folded or left. | Levels come from the players still in the hand; the highest takes in everything paid above it. | rules: "S1-12 …" (400 tables, chips counted after every move) |

### Every PC at the table needs LANX 3.16.0 for these games

Go Fish, Dominoes, Bankroll, Hold'em, Mahjong Duels, Tap Roulette, Wordbox, Draw & Guess and
Werewolf replay the same moves differently now, so an older LANX would show a different board.
LANX says so when you challenge someone on an older version (`RULES_3160` in `src/lib/games.ts`,
`RULES_3160_GAMES` in `src-tauri/src/networking/protocol.rs`).

### Known and not changed (needs a decision)

- **Tap Roulette with 7 or 8 players always ends with first place shared.** Five rounds with one
  loser each leave at least two players unbeaten. That is how the game is laid out, not the
  wheel. Changing it (more rounds for big tables, or playing on until one is left) is a rule
  change and waits for a yes.
- **Dominoes:** when nobody can play, the game ends as soon as the player to move passes (it
  used to need a pass from everyone). It does not end by itself before that pass.

### Not tested yet

- The same 40 Wordbox grids in the Linux/iPhone engine (WebKit). The file is ready; the run is
  part of Sprint 9.
- Nothing of Sprint 1 has been tried in the running app or between two real PCs yet.
