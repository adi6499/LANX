// Wordbox — the letter-grid word hunt. A 4×4 grid of letters for 90
// seconds; make words of three letters or more by moving to a touching
// letter each time (no square twice). Three rounds. A word scores by
// length (3–4: 1, 5: 2, 6: 3, 7+: 5); a word two or more people found
// scores nobody. There is no dictionary on board: play fair, as among
// colleagues — nonsense is for the others to call out.
// Moves: "<player>@a:<word>" as you find them; the host opens and closes rounds.

import { partyDef, type PartyState } from "./party.ts";
import { rng } from "./core.ts";

/** The sixteen dice of the classic game. */
const DICE = ["AAEEGN", "ABBJOO", "ACHOPS", "AFFKPS", "AOOTTW", "CIMOTU", "DEILRX", "DELRVY", "DISTTY", "EEGHNW", "EEINSU", "EHRTVW", "EIOSST", "ELRTTY", "HIMNQU", "HLNNRZ"];

export interface WordboxExtra {
  grid: string[];
}

export function wordboxGrid(seed: string, round: number): string[] {
  const next = rng(`${seed}#wordbox${round}`);
  const order = [...DICE].sort(() => next() - 0.5);
  return order.map((d) => d[Math.floor(next() * 6)]);
}

/** Can the word be traced on the grid, each letter touching the last, no square twice? ("Q" counts as "QU".) */
export function wordOnGrid(grid: string[], word: string): boolean {
  const w = word.toUpperCase().replace(/QU/g, "Q");
  if (w.length < 3 && word.length < 3) return false;
  const walk = (pos: number, k: number, used: Set<number>): boolean => {
    if (k === w.length) return true;
    const r = Math.floor(pos / 4);
    const c = pos % 4;
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const rr = r + dr;
        const cc = c + dc;
        if (rr < 0 || rr > 3 || cc < 0 || cc > 3) continue;
        const i = rr * 4 + cc;
        if (used.has(i) || grid[i] !== w[k]) continue;
        const u = new Set(used);
        u.add(i);
        if (walk(i, k + 1, u)) return true;
      }
    return false;
  };
  for (let i = 0; i < 16; i++) if (grid[i] === w[0] && walk(i, 1, new Set([i]))) return true;
  return false;
}

export const wordPoints = (word: string) => (word.length >= 7 ? 5 : word.length === 6 ? 3 : word.length === 5 ? 2 : word.length >= 3 ? 1 : 0);

export const wordbox = partyDef<WordboxExtra>(
  "wordbox",
  "Wordbox",
  "Find words on a 4×4 letter grid against the clock.",
  "🔤",
  8,
  {
    rounds: 3,
    multi: true,
    seconds: 90,
    setup: (seed, round) => ({ grid: wordboxGrid(seed, round) }),
    accept: (s, player, text, extra) => {
      const w = text.trim().toUpperCase();
      if (!/^[A-Z]{3,16}$/.test(w) || !wordOnGrid(extra.grid, w)) return false;
      return !s.answers.some((a) => a.player === player && a.text.toUpperCase() === w);
    },
    score: (s, _extra, n) => {
      const byWord = new Map<string, number[]>();
      for (const a of s.answers) {
        const w = a.text.toUpperCase();
        byWord.set(w, [...(byWord.get(w) ?? []), a.player]);
      }
      const gained = Array(n).fill(0);
      for (const [w, players] of byWord) if (players.length === 1) gained[players[0]] += wordPoints(w);
      for (let p = 0; p < n; p++) s.scores[p] += gained[p];
      return `Round ${s.round}: ` + gained.map((g, p) => `P${p + 1} +${g}`).join(", ");
    },
  },
);

export type WordboxState = PartyState<WordboxExtra>;
