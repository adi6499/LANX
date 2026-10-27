// LANX 2.16.0: what each copy of LANX at a table can do. A board tells the
// others once (a light "delta" step, ignored by older copies); a new kind of
// move — pool spin, say — is offered only when everyone at the table has
// said they understand it, so an older LANX never receives a move it would
// refuse.

import { useEffect } from "react";
import type { BoardProps } from "./boardProps";

interface CapsDelta {
  kind: "caps";
  id: string;
  v: number;
  spin?: number;
}

const isCaps = (d: unknown): d is CapsDelta => !!d && typeof d === "object" && (d as { kind?: unknown }).kind === "caps" && typeof (d as { id?: unknown }).id === "string";

/** True when every player at the table understands `feature` (always at one PC). */
export function useTableCaps(p: BoardProps, feature: "spin"): boolean {
  const n = Math.max(1, p.seats?.length ?? 2);
  const myId = p.seats?.[((p.starter ?? 0) + Math.max(0, p.seat)) % n]?.id ?? "";
  const deltas = p.deltas ?? [];
  const told = deltas.some((d) => isCaps(d) && d.id === myId);
  const onDelta = p.onDelta;
  useEffect(() => {
    if (p.local || !onDelta || !myId || told) return;
    onDelta({ kind: "caps", id: myId, v: 2160, spin: 1 } satisfies CapsDelta);
  }, [p.local, onDelta, myId, told]);
  if (p.local) return true;
  const able = new Set(deltas.filter(isCaps).filter((d) => d[feature]).map((d) => d.id));
  return (p.seats ?? []).every((s) => s.id === myId || able.has(s.id));
}
