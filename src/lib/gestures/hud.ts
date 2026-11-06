/** LANX 3.7.0: what the main window sends the hands window (HudApp). */
import type { KbState } from "./keyboard";

export interface HudState {
  kb: KbState | null;
  hover: string | null;
  pressed: string | null;
  listening: boolean;
  note: string | null;
  noteTone?: "red" | "plain";
  dark: boolean;
}
export const HUD_EVENT = "lanx:hud";
/** The note row above the keyboard (CSS px). */
export const HUD_NOTE_H = 44;
/** The window's width with only a note. */
export const HUD_NOTE_W = 460;
