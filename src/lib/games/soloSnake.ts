// Snake: the rules, apart from the board that draws them (so they can be tested by themselves).
// LANX 3.18.0 (Sprint 3, S3-10):
//  - moving into the square the tail is leaving is not a bite (the tail moves out as the head
//    moves in; it was counted as a crash);
//  - two quick turns both count (the second used to replace the first);
//  - the food is put on a free square by counting the free ones (the old way guessed squares
//    until one was free, which never ends on a full board);
//  - a key that is still held down, or pressed in the moment of the crash, does not start the
//    next game at once (`snakeMayRestart`).

export type SnakeDir = "U" | "D" | "L" | "R";
export type SnakePt = [number, number];
/** The board is this many squares each way. */
export const SNAKE_N = 20;

export interface SnakeState {
  /** Head first. */
  snake: SnakePt[];
  dir: SnakeDir;
  /** Turns that wait for their step (two at most). */
  turns: SnakeDir[];
  /** Nothing when the snake fills the whole board. */
  food: SnakePt | null;
  eaten: number;
  dead: boolean;
  /** The snake filled the board: the game is over, and won. */
  full: boolean;
}

const OPPOSITE: Record<SnakeDir, SnakeDir> = { U: "D", D: "U", L: "R", R: "L" };

/** A free square for the food, each free square as likely as any other. `random`: 0 up to 1. */
export function snakeFood(snake: SnakePt[], random: () => number = Math.random): SnakePt | null {
  const taken = new Set(snake.map(([x, y]) => y * SNAKE_N + x));
  const free = SNAKE_N * SNAKE_N - taken.size;
  if (free <= 0) return null;
  let k = Math.min(free - 1, Math.floor(random() * free));
  for (let i = 0; i < SNAKE_N * SNAKE_N; i++) {
    if (taken.has(i)) continue;
    if (k-- === 0) return [i % SNAKE_N, Math.floor(i / SNAKE_N)];
  }
  return null;
}

export function snakeStart(random: () => number = Math.random): SnakeState {
  const snake: SnakePt[] = [[10, 10], [9, 10], [8, 10]];
  return { snake, dir: "R", turns: [], food: snakeFood(snake, random), eaten: 0, dead: false, full: false };
}

/** A press of a steering key. Straight back into itself is refused; so is a third waiting turn. */
export function snakeTurn(s: SnakeState, d: SnakeDir): SnakeState {
  if (s.dead) return s;
  const last = s.turns.length ? s.turns[s.turns.length - 1] : s.dir;
  if (d === last || OPPOSITE[last] === d || s.turns.length >= 2) return s;
  return { ...s, turns: [...s.turns, d] };
}

/** One step forward. */
export function snakeStep(s: SnakeState, random: () => number = Math.random): SnakeState {
  if (s.dead) return s;
  const dir = s.turns.length ? s.turns[0] : s.dir;
  const turns = s.turns.slice(1);
  const [hx, hy] = s.snake[0];
  const head: SnakePt = [hx + (dir === "R" ? 1 : dir === "L" ? -1 : 0), hy + (dir === "D" ? 1 : dir === "U" ? -1 : 0)];
  const grows = !!s.food && head[0] === s.food[0] && head[1] === s.food[1];
  // Without food the tail leaves its square in this same step, so that square is free.
  const body = grows ? s.snake : s.snake.slice(0, -1);
  const hit = head[0] < 0 || head[1] < 0 || head[0] >= SNAKE_N || head[1] >= SNAKE_N || body.some(([x, y]) => x === head[0] && y === head[1]);
  if (hit) return { ...s, dir, turns: [], dead: true };
  const snake = [head, ...body];
  if (!grows) return { ...s, snake, dir, turns };
  const food = snakeFood(snake, random);
  return { ...s, snake, dir, turns, eaten: s.eaten + 1, food, dead: food === null, full: food === null };
}

/** The wait before the next step: quicker with every bite. */
export const snakeDelay = (eaten: number) => Math.max(60, 140 - eaten * 4);

/** May this key press start the next game after a crash? Not a key that is still held down
 *  (it repeats), and not one pressed within a moment of the crash (it was meant for steering). */
export const snakeMayRestart = (repeat: boolean, msSinceCrash: number) => !repeat && msSinceCrash >= 700;
