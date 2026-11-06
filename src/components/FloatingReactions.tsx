import { useCallback, useEffect, useRef, useState } from "react";

/** LANX 3.7.0: emoji reactions (👍…) during calls and meetings. Each one
 *  rises a little and fades over the person it came from; several can
 *  overlap. The motion is in App.css (.lanx-reaction). */

/** The only reactions LANX sends and shows (mirrors CALL_REACTIONS in protocol.rs). */
export const CALL_REACTIONS = ["👍", "❤️", "😂", "👏", "🎉", "✋", "👋"] as const;

/** How long one reaction stays on screen (the animation in App.css). */
export const REACTION_MS = 1600;
/** At most this many on screen at once (a burst of gestures can't flood it). */
const MAX_ON_SCREEN = 12;

/** The reaction when it is an allowed one (a plain ❤ counts as ❤️), otherwise null. */
export function cleanReaction(r: string | null | undefined): string | null {
  const t = (r ?? "").trim();
  const v = t === "❤" ? "❤️" : t;
  return (CALL_REACTIONS as readonly string[]).includes(v) ? v : null;
}

export interface ReactionBurst {
  id: number;
  emoji: string;
  /** Who it came from (a meeting tile's device id). */
  from?: string;
  /** Shown under the emoji when it floats over someone else's tile. */
  name?: string;
  /** Where across the area it rises (percent), so overlapping ones spread out. */
  x: number;
}

/** The reactions on screen, and a function that adds one (each leaves by itself). */
export function useReactionBursts(): [ReactionBurst[], (emoji: string, from?: string, name?: string) => void] {
  const [bursts, setBursts] = useState<ReactionBurst[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Set<number>());
  useEffect(() => {
    const t = timers.current;
    return () => {
      for (const id of t) window.clearTimeout(id);
      t.clear();
    };
  }, []);
  const add = useCallback((emoji: string, from?: string, name?: string) => {
    const id = nextId.current++;
    // Around the middle, alternating sides, so two in a row don't stack.
    const x = 50 + (id % 2 ? 1 : -1) * (3 + Math.random() * 15);
    setBursts((list) => [...list, { id, emoji, from, name, x }].slice(-MAX_ON_SCREEN));
    const timer = window.setTimeout(() => {
      timers.current.delete(timer);
      setBursts((list) => list.filter((b) => b.id !== id));
    }, REACTION_MS + 100);
    timers.current.add(timer);
  }, []);
  return [bursts, add];
}

/** Floats `bursts` over the area it is put in (that area must be positioned).
 *  `bottom`: where they start rising from (CSS, default 18% up from the bottom). */
export function FloatingReactions({
  bursts,
  size = "md",
  bottom,
}: {
  bursts: ReactionBurst[];
  size?: "sm" | "md" | "lg";
  bottom?: string;
}) {
  if (!bursts.length) return null;
  const text = size === "lg" ? "text-5xl" : size === "sm" ? "text-2xl" : "text-4xl";
  return (
    <div aria-hidden data-reactions className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
      {bursts.map((b) => (
        <span key={b.id} data-reaction={b.emoji} className="lanx-reaction flex flex-col items-center" style={{ left: `${b.x}%`, bottom }}>
          <span className={`lanx-reaction-pop leading-none select-none ${text}`}>{b.emoji}</span>
          {b.name && (
            <span className="mt-1 max-w-[120px] truncate rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-medium text-white">
              {b.name}
            </span>
          )}
        </span>
      ))}
    </div>
  );
}
