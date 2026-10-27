// LANX 2.16.0: what every turn-based 3D board shares. The board is handed
// the match's move list; new moves at the end are animated one by one (a
// die thrown, a token hopping, a ball rolling); anything else — a rematch,
// a reconnect that rewrote the list, a long backlog — snaps straight to the
// position. The position always comes from the game's own rules, so the
// picture can never disagree with the score.

import { Stage, type StageOptions } from "./stage";

export abstract class TurnScene<S> {
  readonly stage: Stage;
  /** The moves on screen (after the animations queued so far). */
  protected shown: string[] = [];
  private chain: Promise<void> = Promise.resolve();
  private queued = 0;
  private gen = 0;
  protected n = 2;
  protected seed = "";

  constructor(host: HTMLElement, opts?: StageOptions) {
    this.stage = new Stage(host, opts);
    // For the games lab and the app's tests: the scene on screen.
    try {
      (window as unknown as { __g3scene?: unknown }).__g3scene = this;
    } catch {
      /* fine */
    }
  }

  /** The position after these moves (the game's rules), or null when they are not allowed. */
  protected abstract replay(moves: string[]): S | null;
  /** Puts everything where the position says, at once. */
  protected abstract snap(s: S, moves: string[]): void;
  /** Animates one move; must end with the scene showing `after` (snap is called afterwards anyway). */
  protected abstract animateStep(before: S, after: S, move: string, index: number): Promise<void>;
  /** Called whenever the scene is idle again (to show what can be clicked). */
  protected idle(): void {}

  private primed = false;

  /** The match as it stands: players, the round's seed and the moves. New moves animate; anything else snaps. */
  sync(n: number, seed: string, moves: string[]) {
    if (!this.primed || n !== this.n || seed !== this.seed) {
      this.primed = true;
      this.n = n;
      this.seed = seed;
      this.resnap(moves);
      return;
    }
    this.update(moves);
  }

  /** The match's moves now. */
  private update(moves: string[]) {
    const prev = this.shown;
    const extends_ = moves.length >= prev.length && prev.every((m, i) => moves[i] === m);
    if (!extends_ || moves.length - prev.length > 4 || this.stage.isDisposed) {
      this.resnap(moves);
      return;
    }
    if (moves.length === prev.length) return;
    this.shown = [...moves];
    const gen = this.gen;
    for (let k = prev.length; k < moves.length; k++) {
      const before = moves.slice(0, k);
      const after = moves.slice(0, k + 1);
      this.queued++;
      this.chain = this.chain
        .then(async () => {
          if (gen !== this.gen || this.stage.isDisposed) return;
          // Falling behind (several moves at once): hurry the earlier ones.
          if (this.queued > 2) this.stage.finishAll();
          const a = this.replay(before);
          const b = this.replay(after);
          if (!a || !b) return;
          try {
            await this.animateStep(a, b, after[after.length - 1], k);
          } catch {
            /* an animation failed: the snap below puts it right */
          }
          if (gen !== this.gen || this.stage.isDisposed) return;
          this.snap(b, after);
        })
        .finally(() => {
          this.queued--;
          if (this.queued === 0 && gen === this.gen && !this.stage.isDisposed) this.idle();
          this.stage.invalidate();
        });
    }
  }

  /** Shows the position at once (no animation). */
  resnap(moves: string[]) {
    this.gen++;
    this.stage.finishAll();
    this.shown = [...moves];
    const s = this.replay(moves);
    if (s) this.snap(s, moves);
    if (this.queued === 0) this.idle();
    this.stage.invalidate();
  }

  /** Nothing is moving and nothing is queued: the player may act. */
  get settled() {
    return this.queued === 0 && !this.stage.animating;
  }

  /** Runs after the animations queued so far. */
  afterQueue(fn: () => void) {
    this.chain = this.chain.then(fn, fn);
  }

  dispose() {
    this.gen++;
    this.stage.dispose();
  }
}
