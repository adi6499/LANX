# LANX games in 3D — implementation tracker (2.16.0)

Every game in LANX (49 in `src/lib/games.ts`) has a 3D version. Turning the
**3D** switch off in the games window brings back the flat board, which is
unchanged. If a PC cannot run WebGL, or a 3D board fails, LANX quietly falls
back to the flat board (`three/support.ts`, `Fallback` in `three/Board3D.tsx`).

## The rules did not move

The 3D boards only **draw** the game. The rules stay in `src/lib/games/*` and
`src/lib/gameRules.ts`: a match is still a list of move strings replayed from a
seed, and a 3D board sends exactly the same move strings as the flat board. So:

- a 3D player and a flat player, or a PC on an older LANX, can play the same match;
- scores, turns, winners and the network protocol are exactly as before;
- anything random (dice, deals, the roulette loser, bowling pins, wind) is decided
  by the rules from the match seed, so every PC gets the same result. Physics
  in the picture is then *steered* to that result. It never decides it.

## Physics: what is real and what is shown

| Kind | Games | How it works |
|---|---|---|
| Rapier rigid bodies (cosmetic, steered) | Ludo, Snakes & Ladders, Backgammon, Bankroll (dice); Bowling (pins) | Dice are thrown in Rapier; then the faces inside the die are turned so the number the rules rolled ends on top. Bowling: only the pins the rules knocked down are free to move; the standing pins are fixed bodies. Rapier loads only when one of these games opens. |
| The rules' own billiard physics, played back in 3D | 8-Ball Pool, Carrom, Mini Golf | `lib/games/physics2d.ts` (whole numbers, the same on every PC) works out the shot; the 3D table plays back that exact path, with rolling balls and spin. What you see is what scored. |
| Scripted flight to the rules' answer | Darts, Archery, Cup Pong | The rules decide where it lands (with the sight's wobble or the wind); the 3D shows the arc to that spot. |
| The host's live simulation, drawn in 3D | Air Hockey, Table Soccer, Spinner Wars | The host PC runs the game and streams snapshots, as before; the 3D board smooths between them at the screen's own frame rate. |
| No physics (animated pieces) | All the other games | Pieces slide, hop, flip and pop, but the positions come straight from the rules. |

## Fairness changes made alongside (2.16.0)

- **Who sent a message.** Light game messages (deltas) are now stamped with the
  sender (`__from`) by whoever received them from the sender; a guest trusts
  only the host's stamp (`src/lib/games.ts`). Data-channel messages count for
  the player on that line, not whoever the message claims to be (`gameChannel.ts`).
- **Turn ownership in two-player games.** A new move list must keep every
  earlier move unchanged, and each new move must belong to the other player
  (`duoStep` in `src/lib/games.ts`).
- **Werewolf.** A night action counts only if it really came from the player it
  names (`__from === from`).
- **Draw & Guess.** Only the drawer's strokes are drawn.
- **Hidden information stays hidden in the 3D scene.**
  - Memory card faces get a picture only while shown.
  - Minesweeper (Versus and solo) mines appear only once revealed.
  - Other players' cards and domino tiles are drawn as backs.
  - The blackjack hole card has no face until it is turned.
  - Your Sea Battle fleet never leaves your PC.
- **Pool spin** (new) is offered only when every PC at the table understands it
  (`games/caps.ts`), so an older LANX never receives a shot it can't replay.

## Per-game tracker

Status key: **Done** = 3D board built, plays the real rules, and passed its
headless-Edge lab test (moves go through, picture matches the rules, light and
dark, one live 3D scene, no page errors). The lab test column names the
scenario in the test lab (dev-only `lab.html`).

| # | Game | id | Category | Players | 3D board | What is 3D | Physics | Lab test | Status |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Tic-tac-toe | tictactoe | grid | 2 | Grid3D | Real X and O pieces on a wooden board | none | generic | Done |
| 2 | Connect Four | connect4 | grid | 2 | Classic3D | Upright frame; discs drop down the column and bounce | none | generic | Done |
| 3 | Gomoku | gomoku | grid | 2 | Grid3D | Wooden goban, slate and shell stones | none | generic | Done |
| 4 | Dots & Boxes | dots | grid | 2–4 | Tiles3D | Pegs, rails, claimed squares | none | generic | Done |
| 5 | Hex | hex | grid | 2 | Grid3D | Field of hexagonal tiles on a rhombus base | none | generic | Done |
| 6 | Sea Battle | battleship | grid | 2 | Sea3D | Two seas, your fleet afloat, pegs for shots | none | sea | Done (fleet stays local) |
| 7 | Minesweeper Versus | minesvs | grid | 2–4 | Tiles3D | Raised tiles that sink as they open | none | generic | Done (mines hidden) |
| 8 | Memory | memory | grid | 2–8 | Tiles3D | Cards that turn over | none | generic | Done (faces hidden) |
| 9 | Chain Reaction | chainreaction | grid | 2–32 | Tiles3D | Orbs that burst across the board | none | generic | Done |
| 10 | Paint Fight | paintfight | grid | 2–8 | Tiles3D | Tiles pop up in your colour; a press paints | none | paint | Done |
| 11 | Chess | chess | board | 2 | Classic3D | Turned Staunton set; slides, knight jumps, castling, promotion | none | generic | Done |
| 12 | Checkers | checkers | board | 2 | Classic3D | Hops through multi-jumps, stacked kings | none | generic | Done |
| 13 | Reversi | reversi | board | 2 | Grid3D | Discs that flip over | none | generic | Done |
| 14 | Go | go | board | 2 | Grid3D | Goban, stones, captures lift away | none | generic | Done |
| 15 | Mancala | mancala | board | 2 | Mancala3D | Carved board, seeds sown one by one | none | generic | Done |
| 16 | Mahjong Duels | mahjong | board | 2–4 | Tiles3D | Thick tiles lift away in pairs | none | generic | Done |
| 17 | Ludo | ludo | dice | 2–4 | Ludo3D | Wooden board, pawns hop square by square, knocked pawns fly home. 2.16.1: the flat board hops too, with a classic look | Rapier die | ludo, ludoflat, ludoknock | Done |
| 18 | Snakes & Ladders | snakes | dice | 2–8 | Snakes3D | Ladders, curling snakes, pawns climb and slide | Rapier die | snakes | Done |
| 19 | Bankroll | bankroll | dice | 2–6 | DiceBoards3D | Ring of streets, pawns walk, houses in owner's colour | Rapier dice | dicegames | Done |
| 20 | Backgammon | backgammon | dice | 2 | DiceBoards3D | Wooden case, stacked checkers, bar and bear-off tray | Rapier dice | dicegames | Done |
| 21 | Dominoes | dominoes | dice | 2–4 | Dominoes3D | Ivory tiles with pips; the line snakes across the felt | none | shots1 | Done (others' tiles face down) |
| 22 | Ocho | ocho | cards | 2–8 | Cards3D | 3D card table, hand, pile, others' backs | none | generic | Done |
| 23 | Crazy Eights | crazy8 | cards | 2–6 | Cards3D | Same card table | none | generic | Done |
| 24 | Texas Hold'em | holdem | cards | 2–8 | Cards3D | Card table with chips and the board cards | none | generic | Done |
| 25 | Spades | spades | cards | 4 | Cards3D | Card table, tricks to the middle | none | generic | Done |
| 26 | Hearts | hearts | cards | 4 | Cards3D | Card table, tricks to the middle | none | generic | Done |
| 27 | Euchre | euchre | cards | 4 | Cards3D | Card table, tricks to the middle | none | generic | Done |
| 28 | Gin Rummy | ginrummy | cards | 2 | Cards3D | Stock, discard pile, hands | none | generic | Done |
| 29 | Go Fish | gofish | cards | 2–6 | Cards3D | Hands, books laid down | none | generic | Done |
| 30 | Blackjack 21 | blackjack | cards | 1–6 | Cards3D | Dealer, hands, chips; hole card turns over | none | generic | Done (hole card hidden) |
| 31 | Draw & Guess | drawguess | party | 3–8 | Party3D | Drawing on an easel, word as letter boxes | none | party | Done — **CSS 3D, not WebGL** |
| 32 | Trivia Night | trivia | party | 2–8 | Party3D | Question card swings in, answer tiles press down, countdown ring | none | party | Done — **CSS 3D, not WebGL** |
| 33 | Werewolf | werewolf | party | 5–12 | Party3D | Sky turns day/night, role cards flip, votes on players | none | party | Done — **CSS 3D, not WebGL** |
| 34 | Wordbox | wordbox | party | 2–8 | PartyScenes3D | Wooden letter tiles; drag across them to spell | none | party | Done |
| 35 | Math Rush | mathrush | party | 2–8 | Party3D | Question card, keypad, score bars | none | party | Done — **CSS 3D, not WebGL** |
| 36 | Tap Roulette | taproulette | party | 2–8 | PartyScenes3D | Prize wheel that stops on the loser the rules drew | none | party | Done |
| 37 | Carrom | carrom | shots | 2 | TableShots3D | Plywood board, netted pockets, slide and flick the striker | rules' 2D physics | shots1 | Done |
| 38 | 8-Ball Pool | pool | shots | 2 | Pool3D | Full table, numbered balls, cue with pull-back, aim guide, spin | rules' 2D physics | pool | Done |
| 39 | Cup Pong | cuppong | shots | 2–4 | Throw3D | Long table, cup triangles, arcing ball | scripted flight | throws | Done |
| 40 | Mini Golf | minigolf | shots | 1–8 | TableShots3D | Nine little courses, cup and flag, putter pull-back | rules' 2D physics | shots1 | Done |
| 41 | Bowling | bowling | shots | 1–8 | Bowling3D | Maple lane, gutters, camera follows the ball, sweep and pinsetter | Rapier pins | bowl | Done |
| 42 | Darts | darts | shots | 1–8 | Throw3D | Board on the wall, wobbling sight, darts arc and stick | scripted flight | throws, dartcheck | Done |
| 43 | Archery | archery | shots | 1–8 | Throw3D | Range, wind flag, hold to draw, arrows drift | scripted flight | throws | Done |
| 44 | Air Hockey | airhockey | live | 2 | Live3D | Table, sliding puck, two mallets | host's live sim | live | Done |
| 45 | Table Soccer | foosball | live | 2 | Live3D | Rods of players that swing when they kick | host's live sim | live | Done |
| 46 | Spinner Wars | spinnerwars | live | 2–8 | Live3D | Spinning-top arena | host's live sim | live | Done |
| 47 | 2048 | 2048 | solo | 1 | Solo3D | Thick tiles slide and merge; keys, buttons or swipe | none | solo | Done |
| 48 | Snake | snake | solo | 1 | Solo3D | Rounded segments glide from square to square | none | solo | Done |
| 49 | Minesweeper | mines | solo | 1 | Solo3D | Tiles sink as they open, real flags (right-click) | none | solo | Done |

## Shared 3D building blocks (`src/components/games/three/`)

| File | What it does |
|---|---|
| `stage.ts` | One three.js scene per board: renders only when something changes (turn-based boards cost nothing at rest), picking, camera framing, drag the empty table to tilt or turn the view (double-click resets), and `dispose()` frees GPU memory, listeners and the render loop. |
| `turnScene.ts` | Turns a move list into animation: new moves animate one by one, anything else snaps. |
| `boardScene.ts` | Keyed pieces that appear, move and vanish; clickable cells with a hover marker. |
| `cardTable.ts`, `chessPieces.ts`, `dice.ts`, `kit.ts`, `physics.ts` | Card table, Staunton pieces, Rapier dice, shared materials and shapes, lazy Rapier loading. |
| `ui.tsx` | The buttons that stay under each board, plus screen-reader action buttons (also used by tests). |
| `index.ts` | `BOARDS3D` (46 multiplayer games) and `SOLO3D` (3 solo games), each loaded only when opened. |

## Test results (27 Oct 2026)

**Lab (headless Edge, the dev-only `lab.html`), every game in 3D:**
38 test runs covering all 49 games, **181 of 181 checks passed**. The checks:

- **Every board:** moves go through, light and dark, exactly one live 3D scene, no page errors.
- **Dice:** they land on the rolled number (Ludo, Snakes & Ladders, Backgammon, Bankroll).
- **Shots:** pool, carrom and golf balls end where the rules put them.
- **Bowling:** the pins left standing are the rules' pins.
- **Darts:** the board's orientation matches the scoring.
- **Tap Roulette:** the wheel stops on the rules' loser.
- **Wordbox:** a word not on the grid or not in the word list is refused.
- **2048:** the tiles match the grid after 24 slow moves and after 20 key presses mashed mid-slide.
- **Minesweeper:** a right-click flags and a left-click opens; mines appear only once the game is lost.
- **Paint Fight:** after a burst of 60 taps, every square shows its last painter.
- **Switching:** clicking through all 49 games twice in one page never leaves a 3D scene behind (about 90 MB of memory after 98 switches), and turning 3D off frees the scene.

**Production build:** `tsc` is clean and `vite build` succeeds. three.js (~600 KB),
Rapier (~4 MB) and the word list (~2.8 MB) load only when a game needs them; the
main bundle is the same size as 2.15.1.

**Rapier inside the app's security policy:** fails without `'wasm-unsafe-eval'`
and works with it (added to `tauri.conf.json` in 2.16.0).

**Two PCs (two LANX copies):** see the 2.16.0 end-to-end run in the release notes
of this session (`run2160`).

## Known limitations

- Rapier is used for looks only (dice and bowling pins), always steered to the
  rules' result. Pool, Carrom and Mini Golf keep the rules' own 2D physics on
  purpose, so every PC agrees to the last ball.
- Trivia Night, Math Rush, Werewolf and Draw & Guess use CSS 3D: cards that
  swing and flip, a perspective easel, a day/night sky. They are not WebGL
  scenes, because they are question-and-answer screens with no table to show.
- The live arcade games still run the host's 2D simulation; the 3D board draws
  its snapshots smoothly, but a slow network still shows as the host's lag.
- 3D needs WebGL. On a PC without it (or if a 3D board ever fails), LANX falls
  back to the flat board automatically.
- The first 3D game opened downloads nothing (everything is inside the app),
  but it does load three.js (~600 KB) and, for dice or bowling, Rapier (~4 MB)
  into memory.
