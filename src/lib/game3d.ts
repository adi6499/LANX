// LANX 2.13.0: the games' 3D look (a tilted table that leans towards the
// mouse, raised pieces, dice that tumble, cards that flip). On unless the
// "3D" button in the games window turned it off on this PC.

const KEY = "lanx_game_3d";
let on = true;
try {
  on = localStorage.getItem(KEY) !== "off";
} catch {
  /* no storage: stays on */
}

export const game3dOn = () => on;
export function setGame3d(v: boolean) {
  on = v;
  try {
    localStorage.setItem(KEY, v ? "on" : "off");
  } catch {
    /* fine */
  }
}
