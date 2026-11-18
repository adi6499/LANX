// LANX 3.19.0: the six-sided Ludo board, for five and six players — where every square is.
// Pure numbers (no drawing), shared by the flat board, the 3D board and the tests.
//
// The board is the usual Ludo cross with six arms instead of four. An arm is three squares wide
// and six long; the arms stand on the six sides of a six-sided field in the middle (each side as
// long as an arm is wide), and the yards lie in the six gaps between the arms. Everything is
// counted in squares from the middle of the board, x to the right and y DOWN (as on screen), so
// "clockwise" is clockwise as you look at it.
//
// Unturned, arm 0 points left and the arms follow clockwise: upper left, upper right, right, lower
// right, lower left. Yard c lies between arm c and arm c + 1: upper left, top, upper right, lower
// right, bottom, lower left. A colour's start square, home squares and centre field are on ITS arm
// (arm c for corner c), as on the four-sided board.

import { ARM, HOME_COL } from "./ludo.ts";

export const HEX_ARMS = 6;
/** From the middle to where an arm begins: the middle field's sides are one arm (3 squares) wide. */
export const HEX_INNER = (3 * Math.sqrt(3)) / 2;
/** An arm's length in squares. */
export const HEX_ARM_LEN = 6;
/** From the middle to the board's straight edges (a little past the arms' ends) and to its corners. */
export const HEX_EDGE = HEX_INNER + HEX_ARM_LEN + 0.22;
export const HEX_CORNER = HEX_EDGE / Math.cos(Math.PI / 6);
/** The yards: a round court between two arms, with four spots. */
export const HEX_YARD_AT = 7.36;
export const HEX_YARD_R = 2.08;
const SPOT_AT = 1.12;

export interface HexSquare {
  x: number;
  y: number;
  /** The way its arm points (radians, clockwise on screen): the square is turned with its arm. */
  angle: number;
}

/** The way arm `j` points. */
export const armAngle = (j: number) => Math.PI + (((j % HEX_ARMS) + HEX_ARMS) % HEX_ARMS) * (Math.PI / 3);
/** The way yard `c` lies (between arm c and the next one). */
export const yardAngle = (c: number) => armAngle(c) + Math.PI / 6;

/** A square of an arm: `lane` -1 (the side you reach first going clockwise), 0 (the middle), 1;
 *  `depth` 0 at the arm's far end … 5 next to the middle field. */
function square(arm: number, lane: number, depth: number): HexSquare {
  const a = armAngle(arm);
  const out = HEX_INNER + (HEX_ARM_LEN - 1 - depth) + 0.5;
  const [dx, dy] = [Math.cos(a), Math.sin(a)];
  // (the clockwise side of the arm: its direction turned a quarter clockwise)
  return { x: dx * out - dy * lane, y: dy * out + dx * lane, angle: a };
}

/** The 78 squares of the shared track, clockwise from corner 0's start square. Per corner, as on
 *  the four-sided board: five squares in along its own arm, six out along the next arm, round that
 *  arm's end (two squares), and there the next colour starts. */
export const HEX_LOOP: HexSquare[] = (() => {
  const out: HexSquare[] = [];
  for (let c = 0; c < HEX_ARMS; c++) {
    for (let i = 0; i < ARM; i++) {
      if (i < 5) out.push(square(c, 1, i + 1));
      else if (i < 11) out.push(square(c + 1, -1, 10 - i));
      else if (i === 11) out.push(square(c + 1, 0, 0));
      else out.push(square(c + 1, 1, 0));
    }
  }
  return out;
})();

/** Each corner's five home squares, from the arm's end towards the middle. */
export const HEX_HOME: HexSquare[][] = Array.from({ length: HEX_ARMS }, (_, c) => Array.from({ length: HOME_COL }, (_, h) => square(c, 0, h + 1)));

/** The middle of a yard. */
export function hexYard(c: number): { x: number; y: number } {
  const a = yardAngle(c);
  return { x: Math.cos(a) * HEX_YARD_AT, y: Math.sin(a) * HEX_YARD_AT };
}
/** A token's spot in its yard: four in a square that faces the middle of the board. */
export function hexSpot(c: number, token: number): { x: number; y: number } {
  const y0 = hexYard(c);
  const a = yardAngle(c) + Math.PI / 4 + token * (Math.PI / 2);
  return { x: y0.x + Math.cos(a) * SPOT_AT, y: y0.y + Math.sin(a) * SPOT_AT };
}
/** Where a token that is in stands: on its colour's field in the middle, the four side by side. */
export function hexIn(c: number, token: number): { x: number; y: number } {
  const a = armAngle(c);
  const out = HEX_INNER * 0.6;
  const side = (token - 1.5) * 0.42;
  return { x: Math.cos(a) * out - Math.sin(a) * side, y: Math.sin(a) * out + Math.cos(a) * side };
}

/** Where a corner's token stands, by its own count of the squares (`rel`: -1 the yard, the track,
 *  the home squares, home). */
export function hexPlace(corner: number, rel: number, token: number): { x: number; y: number } {
  const track = HEX_ARMS * ARM;
  if (rel < 0) return hexSpot(corner, token);
  if (rel >= track + HOME_COL - 1) return hexIn(corner, token);
  if (rel >= track - 1) return HEX_HOME[corner][rel - (track - 1)];
  return HEX_LOOP[(corner * ARM + rel) % track];
}

/** The four corners of a square (for drawing it turned with its arm). */
export function hexCorners(s: HexSquare, size = 1): [number, number][] {
  const h = size / 2;
  const [c, sn] = [Math.cos(s.angle), Math.sin(s.angle)];
  return ([[-h, -h], [h, -h], [h, h], [-h, h]] as const).map(([u, v]) => [s.x + c * u - sn * v, s.y + sn * u + c * v]);
}
/** A point at `r` from the middle, the way `angle` points. */
export const hexPoint = (angle: number, r: number): [number, number] => [Math.cos(angle) * r, Math.sin(angle) * r];
/** The board's six corners (they lie where the yards are). */
export const hexOutline = (r = HEX_CORNER): [number, number][] => Array.from({ length: HEX_ARMS }, (_, c) => hexPoint(yardAngle(c), r));
/** A yard's coloured ground: from the middle field's corner out to the board's corner, between its two arms. */
export function hexYardGround(c: number): [number, number][] {
  const a = armAngle(c);
  const b = armAngle(c + 1);
  const side = (ang: number, lane: number): [number, number] => [Math.cos(ang) * HEX_EDGE - Math.sin(ang) * lane * 1.5, Math.sin(ang) * HEX_EDGE + Math.cos(ang) * lane * 1.5];
  return [hexPoint(yardAngle(c), 3), side(a, 1), hexPoint(yardAngle(c), HEX_CORNER), side(b, -1)];
}
/** A colour's field in the middle: the triangle between the middle and its arm. */
export const hexField = (c: number): [number, number][] => [[0, 0], hexPoint(armAngle(c) - Math.PI / 6, 3), hexPoint(armAngle(c) + Math.PI / 6, 3)];
