/** LANX 3.15.0: the walkie-talkie — what travels between the window and LANX's network part. */

/** Why a colleague's PC does not hear a transmission. */
export interface TalkRefusal {
  peer_id: string;
  name: string;
  /** old: their LANX is too old · off: they switched the walkie-talkie off · muted: they
   *  muted this channel · locked: their LANX is locked · busy: someone is talking there ·
   *  call: they are in a call or a meeting · dnd: "Do not disturb" or quiet hours · unreachable · group: not in that group · other */
  why: "old" | "off" | "muted" | "locked" | "busy" | "call" | "dnd" | "unreachable" | "group" | "other";
  /** busy: who is talking there. */
  who?: string | null;
  /** old: their LANX version. */
  version?: string | null;
}

export interface TalkStarted {
  talk_id: string;
  /** The colleagues who hear it (device ids). */
  listeners: string[];
  refused: TalkRefusal[];
}

/** `lanx://talk`. */
export interface TalkEvent {
  talk_id: string;
  /** From a colleague: start | audio | end. About our own transmission: gave_way (someone
   *  else had the word first), joined (a colleague who was busy now hears us), stopped. */
  action: "start" | "audio" | "end" | "gave_way" | "joined" | "stopped";
  from_id: string;
  from_name: string;
  /** direct | all | group:<group id> */
  channel: string;
  seq: number;
  /** Opus pieces of 20 ms each, base64. */
  frames: string[];
}
