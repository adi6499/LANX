# LANX Games repair — changelog

The record of the games repair that follows the audit of 14 Nov 2026 (49 games; 12 serious
faults). One entry per fault: what was wrong, what changed, which test proves it. The full
checklist with every status is the document "LANX Games repair plan and checklist".

Run the tests: `npm run test:games` (Node 24 runs the rule files as they are; nothing to build).

## Sprint 3 — the smaller defects, game by game (LANX 3.18.0)

Tests: `tests/games/sprint3-rules.test.mjs` (9), `sprint3-solo.test.mjs` (11) and
`sprint3-boards.test.mjs` (2); with Sprints 1 and 2 that is 82. Checked on the games lab page
(localhost) as well: the three solo games on the flat and the 3D board, Reversi's automatic pass,
the Checkers note, a leaver in 3D Ludo. **Not yet tried between two real copies of LANX:** the
Werewolf role card sent again, the Draw & Guess picture for a returning guest.

| ID | What was wrong | What changed | Test |
|---|---|---|---|
| S3-01 | Sea Battle's "your fleet is gone" message said "Press Leave game", a button a game that has begun does not have. | It says "Press Resign". (Both pressing Ready together: S2-05. Tying a player to a fleet, so that answers need not be taken on trust: Sprint 8.) | — (wording) |
| S3-02 | Chess: after a draw by repetition, fifty moves or too few pieces the rules took one more move. | No move after the game has ended, a draw included. | sprint3-rules |
| S3-03 | Checkers: the flat board never said that you must jump; your other pieces simply would not move. | "You must jump" on the flat board too (`checkersMustJump`, used by both boards). | sprint3-boards; lab |
| S3-04 | Reversi: with no move you had to find the Pass button. | After a moment to read why, LANX passes for you (`useAutoPass`); the button stays. The rules are unchanged. | lab (passes once) |
| S3-05 | Ludo in 3D: a player leaving was animated as a move of a token that does not exist. | Their tokens fly home. **Open (a rule, for the owner):** should a six that cannot be played give another roll? | lab (no error) |
| S3-06 | Backgammon has no opening roll and no gammon scoring. | **Open (rules, for the owner).** Nothing changed. | — |
| S3-07 | Blackjack alone: you always "won", even below zero. | Alone you play the dealer: ahead wins, level is a draw, behind loses. | sprint3-rules |
| S3-08 | Trivia Night: 40 questions, the same sets again, the right answer mostly in the middle, four arguable questions. | 167 questions, shuffled for each match; the options shuffled for each round; the four replaced or reworded. | sprint3-rules |
| S3-09 | Werewolf: a wolf could not change a pick; a role card was sent once and could be lost. | A pick (and a peek) can be changed until the dawn — the rules always took the latest one, the board locked it. The night stays open, up to its clock, while the pack disagrees. A player without a card asks the host, who sends it again with the seer's peeks; the host re-deals its own after a restart. | sprint3-boards (the night); the card: not yet tried between two copies |
| S3-10 | Snake: any key restarted the game the moment you died (a held key at once); it ran on while LANX was hidden; moving into the square the tail was leaving counted as a bite. | One game for both boards (`soloHooks.ts` on `soloSnake.ts`): a held key, or one pressed within 0.7 s of the crash, starts nothing; the game pauses when LANX is hidden; the tail's square is free; two quick turns both count. | sprint3-solo; lab |
| S3-11 | Minesweeper: a first click on a flagged square left the field without any mines; a flag needed a right mouse button; the clock could show a negative number; the flag counter went below zero. | One game for both boards (`soloMines.ts`): a flagged square is left alone before anything is laid; Flags switch, F key, arrow keys; a click on a number opens around it; no more flags than mines; a clock that cannot go backwards. | sprint3-solo; lab |
| S3-12 | Draw & Guess: 60 words, the same word twice in a match; a returning guest saw a blank board until the next round. | 200 words, shuffled once per match; "apples" is right for "apple". A board that opens on a round already going asks the drawer for the picture so far. **Not covered:** a drawer whose own LANX restarted has lost their own picture. | sprint3-rules (words); the picture: not yet tried between two copies |
| S3-13 | 2048: reaching 2048 was never said; "New game" (and closing the window) threw the game away. | "You made 2048!" once, and the game goes on; the game in play is kept on this PC; "New game" in the middle of a game asks first. A kept game is counted when it ends, not each time the window closes. | sprint3-solo; lab |
| S3-14 | Wordbox: words not in the word list could score; a padded word counted twice. | A word counts as its letters and must be in the word list (asked on the sender's PC and again on the host's). | sprint3-rules |
| S3-15 | Math Rush / Trivia: a blank answer counted as 0 (or as the first option). Dots & Boxes 10-10-5 read as a draw for all three. Chain Reaction's end text was wrong. | A blank is no answer; a draw names who shares first place ("Draw between You and Asha"), in words and statistics, for every game that ends on points; Chain Reaction says how it ended. | sprint3-rules |
| S3-16 | Hold'em: the odd chip, a decimal raise refused, a lone player still asked to act. | The odd chip goes to the first winner after the button; the raise box sends whole chips; the only player who can still bet, with nothing to call, is not asked. | sprint3-rules |

Hold'em, Math Rush, Trivia Night, Wordbox and Draw & Guess need LANX 3.18.0 on every PC at the
table (`RULES_3180`): their rules changed in a way two versions would not agree on.

## Sprint 2 — multiplayer reliability (LANX 3.17.0)

Tests: `tests/games/sprint2-match.test.mjs` (29) and `tests/games/sprint2-clock-line.test.mjs` (4);
with Sprint 1's 27 that is 60. (S2-06, S2-08 and S2-10 went out with 3.16.1, see below.)

| ID | What was wrong | What changed | Test |
|---|---|---|---|
| S2-01 | The host's news to a table carried a number that nobody read; an older one arriving late replaced a newer one, and the table could wait for good. | The host numbers its news (`rev`, within one run of LANX: `boot`); a guest leaves alone an older one. | "S2-01 …" |
| S2-02 | Matches lived in memory only: a table died in silence when the host's LANX restarted. | Matches are kept on disk (pref `games_live`: the newest 30 of the last week). After a restart the host tells its table, a guest asks its host, two players ask each other. | 3 tests "S2-02 …" |
| S2-03 | Party games stopped keeping time while the host's LANX was hidden. | The host's round clock runs on `lib/steadyClock` (a worker's clock beside the page's). **Not done:** the real-time games' own loop (Sprint 4); a sleeping PC cannot be helped. | 2 tests "S2-03 …" (stand-in worker) |
| S2-04 | A player whose PC disappeared on their turn blocked the table; only the player could take themselves out. | `removePlayer`: the host takes a player out, as if they had left (a small button on the player's row, pressed twice). | "S2-04 …" |
| S2-05 | Two moves that crossed in a two-player game (both pressing Ready) were both ignored. | Moves both may make at once are merged in one fixed order on both PCs. | 3 tests "S2-05 …" |
| S2-07 | "Rematch" restarted both boards at once, and could wipe a game in progress. | Asked for and answered (`rematch({ask})`, `acceptRematch`, `declineRematch`); never wipes a game being played; with a LANX older than 3.17.0 it starts at once as before. | 5 tests "S2-07 …" |
| S2-09 | Cancel, Clear and a resignation were not remembered for two-player matches. | Remembered for every match between PCs, over a restart; whoever still sends steps for it is told it is gone; a resignation travels with the game. | 3 tests "S2-09 …" |
| S2-11 | Live games with 3+ players: the relay was used only when no line at all was open; snapshots had no order. | Per player: the line where it is open, the relay where it is not (ten a second at most); every message numbered. | 2 tests "S2-11 …" (stand-in connection) |
| S2-12 | Nothing checked that two PCs made the same game of the same moves. | Every step carries a fingerprint (turn, standing or ending, score line); a PC that differs is told, and so is its player. It does not compare every piece on the board. | 2 tests "S2-12 …" |
| S2-13 | Answers and votes carried no round number; a late one was taken for the next round. | "<player>@a#<round>:…" and "<player>@v#<day>:…", refused in any other round; marked by the match code. **These games need 3.17.0 on every PC:** Tap Roulette, Math Rush, Trivia, Wordbox, Draw & Guess, Paint Fight, Werewolf. | 2 tests "S2-13 …" |

Not done in Sprint 2, said plainly: a player is taken out by the host's hand, not by itself
after a time; the real-time games' loop still stops while the host's window is hidden.

## LANX 3.16.1 — two faults of 3.16.0, and the first of Sprint 2 (15 Nov 2026)

Tests: `tests/games/sprint2-match.test.mjs` (9). The three named "3.16.1" fail on the 3.16.0 code.

| ID | What was wrong | What changed | Test |
|---|---|---|---|
| 3.16.1-a | **Made by 3.16.0 (S1-01):** a guest's move that ended a table game was never sent to the host: the "still playing?" check was made after the move had ended the game on the guest's PC. The table hung at the end. | The move is sent whatever it did to the game here. | "3.16.1 a table: a guest's move that ends the game…" (three games played to the end) |
| 3.16.1-b | **Made by 3.16.0 (S1-01):** every move had to name its place in the game, also where everyone acts at once: of two answers given at the same moment the host threw the second away. | Every move carries a number of its own and the host plays each number once (`Match.seen`); only a move made in turn names its place. Each waiting move is filed by itself, so two quick answers do not push each other out. | "3.16.1 a party game: answers given at the same moment…", "…a move made in turn still names its place…" |
| S2-08 | A game was counted two or more times in the statistics (a table guest who made the last move; every later state; an old card pressed after a restart). A failed read of the statistics was taken for "none yet", and the next result wiped them. | Each round is counted once ("<match>#<round>", kept with the statistics, the last 400). Unreadable statistics are neither kept nor written over. An abandoned game is not a game played. | 3 tests "S2-08 …" |
| S2-06 | "Sit down at the next round" never worked: whoever was not seated was turned away before the code for it. | The table remembers whom it invited (`Match.invited`); an invited colleague who presses Play late is put down for the next round, and their PC says so. | 2 tests "S2-06 …" |
| S2-10 | A table could be invited beyond its size and then could not start. | No more invitations than the game has places (the store and the list of colleagues). | "S2-10 …" |

Lesson kept for the rest of the repair: the Sprint 1 match tests never let a guest make the last
move of a table game, and never played a party game over the pretend network. Both are covered now.

## Sprint 1 — the twelve serious faults (LANX 3.16.0)

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

### Ludo: the die is really thrown (asked for by the user, 15 Nov 2026)

The flat Ludo board drew everything the moment it arrived: a roll with no move passed the turn
at once and its number was gone before anyone could read it. Now the board shows one thing at a
time (`useLudoPlayback` in `boards/LudoBoard.tsx`): the die is thrown onto the board from the
roller's corner, bounces and comes to rest (`ThrownDie`, 950 ms), its number lies there for a
second, and only then the token moves or the turn passes. The game itself is never held back,
only its picture. Snakes & Ladders, Bankroll and Backgammon still draw their dice at once.

### Checked for LANX 3.16.0 (15 Nov 2026)

- `npm run test:games`: 27 of 27. Rust: the version gate's tests 4 of 4.
- The real app, two test copies playing Ludo against each other on Windows
  (`LANAPPLICATION-tests\snk\ludo_app.mjs`): 15 of 15. Sixteen rolls, the same numbers in the
  same order on both, every die 0.94 to 1.01 s in the air and 0.95 to 1.05 s at rest, the rolls
  with no move too.
- The real rule code in both JavaScript engines (V8 on Windows, JavaScriptCore in LANX for
  Linux; `games-audit\engines\real-webkit.sh`): 980 of 980 results the same: the 40 fixed
  Wordbox grids (17 of 40 before the repair), 300 Werewolf deals, 300 Tap Roulette draws, 100
  shuffled decks, and what Go Fish, Mahjong Duels, Dominoes, Ludo and Tap Roulette deal and roll.

### Not tested yet

- A move that is lost and sent again, and a player leaving twice, between real PCs (they are
  tested on the pretend network of the test suite only).
- The Ludo dice on a real Linux PC (the code is the same; the picture was only seen on Windows).
- 2048's score on leaving, and Bankroll's "worth" on the boards, have no test.
