/** LANX 3.5.0: spoken commands. The words come from LANX's own speech engine
 *  (on this PC); these rules turn them into something to do. Plain rules, no
 *  internet. English, and a little Hinglish ("Bharat ko call karo"). */

export type ToolId = "music" | "notes" | "calendar" | "games" | "calculator" | "pdf" | "memes" | "settings" | "voice" | "gestures" | "organiser" | "starred" | "help-desk";
export type TabId = "messages" | "people" | "transfers" | "history";
export type Intent =
  | { kind: "call"; who: string; video: boolean }
  /** `rest` = "<name> <words>" still to be split by splitWho. */
  | { kind: "message"; who: string; text: string; rest?: string }
  | { kind: "open-chat"; who: string }
  | { kind: "open"; what: ToolId }
  | { kind: "tab"; tab: TabId }
  | { kind: "music"; action: "play" | "pause" | "next" | "prev" | "louder" | "quieter" | "stop"; query?: string }
  | { kind: "call-control"; action: "answer" | "answer-video" | "decline" | "hangup" | "mute" | "unmute" | "camera-on" | "camera-off" }
  | { kind: "hand"; up: boolean }
  | { kind: "meeting"; who: string | null; video: boolean }
  | { kind: "theme"; theme: "dark" | "light" | "system" }
  | { kind: "search"; query: string }
  | { kind: "note"; text: string }
  /** On the last message, or the one the hand points at. */
  | { kind: "react"; emoji: string; messageId?: string }
  | { kind: "scroll"; dir: "up" | "down" | "top" | "bottom" }
  | { kind: "back" }
  | { kind: "gestures-off" }
  | { kind: "help" }
  /** LANX 3.7.0: the air keyboard (null: open if closed, close if open). */
  | { kind: "keyboard"; open: boolean | null }
  | { kind: "screenshot" }
  | { kind: "lock" }
  | { kind: "show-lanx" }
  /** Types the words into whatever is in front. */
  | { kind: "type"; text: string }
  /** Keys pressed together, by place ("ControlLeft", "KeyC"); `label` as said. */
  | { kind: "keys"; keys: string[]; label: string }
  | { kind: "mute-toggle" }
  | { kind: "hand-toggle" }
  | { kind: "unknown"; text: string };

/** Key names people say → keys by place (as the browser names them). */
const KEY_NAMES: Record<string, string> = {
  ctrl: "ControlLeft", control: "ControlLeft", alt: "AltLeft", shift: "ShiftLeft", windows: "MetaLeft", win: "MetaLeft", start: "MetaLeft",
  enter: "Enter", return: "Enter", escape: "Escape", esc: "Escape", tab: "Tab", space: "Space", spacebar: "Space", backspace: "Backspace",
  delete: "Delete", del: "Delete", up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight", home: "Home", end: "End",
  pageup: "PageUp", pagedown: "PageDown", printscreen: "PrintScreen", prtsc: "PrintScreen", minus: "Minus", equals: "Equal",
};
/** "ctrl c", "alt f4", "page down" → the keys, or null when a word isn't a key. */
export function parseKeys(words: string): string[] | null {
  const parts = words
    .replace(/\b(page) (up|down)\b/g, "$1$2")
    .replace(/\bprint screen\b/g, "printscreen")
    .split(/\s+|\+/)
    .filter((w) => w && !/^(and|plus|then|the|key|keys|button|arrow)$/.test(w));
  const keys: string[] = [];
  for (const w of parts) {
    const k = KEY_NAMES[w] ?? (/^[a-z]$/.test(w) ? `Key${w.toUpperCase()}` : /^[0-9]$/.test(w) ? `Digit${w}` : /^f([1-9]|1[0-2])$/.test(w) ? w.toUpperCase() : null);
    if (!k) return null;
    keys.push(k);
  }
  return keys.length && keys.length <= 4 ? keys : null;
}

const TOOLS: [RegExp, ToolId][] = [
  [/^(the )?(music|songs?|music player|gaane?|gana)$/, "music"],
  [/^(my )?(notes?|notepad)$/, "notes"],
  [/^(the |my )?(calendar|schedule|diary)$/, "calendar"],
  [/^(the )?(games?|game centre|game center)$/, "games"],
  [/^(the )?(calculator|calc|gst calculator)$/, "calculator"],
  [/^(the )?(pdf|pdfs|pdf tools?|pdf editor)$/, "pdf"],
  [/^(the )?(memes?|stickers?|gifs?)$/, "memes"],
  [/^(the )?settings$/, "settings"],
  [/^(the )?voice settings$/, "voice"],
  [/^(the )?gesture(s| settings)?$/, "gestures"],
  [/^(the )?(organi[sz]er|tasks|notices|approvals|polls)$/, "organiser"],
  [/^(the )?starred( messages)?$/, "starred"],
  [/^(the )?(help ?desk|it help|it support)$/, "help-desk"],
];
const TABS: [RegExp, TabId][] = [
  [/^(the )?(chats?|messages|inbox)$/, "messages"],
  [/^(the )?(people|contacts|network|directory)$/, "people"],
  [/^(the )?(files|transfers|downloads)$/, "transfers"],
  [/^(the )?(history|activity)$/, "history"],
];

const NUMBERS: Record<string, string> = { one: "1", two: "2", three: "3", four: "4", five: "5" };

/** Lower case, no punctuation, no "hey LANX", "please", "can you"… */
export function normalise(text: string): string {
  let s = text
    .toLowerCase()
    .replace(/[“”"'’`]/g, "")
    .replace(/[^\p{L}\p{N}\s@.-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.]+$/, "");
  const fillers = [
    /^(hey|hi|ok|okay|hello|yo)\s+/, /^(lanx|lynx|links|lanks|jarvis)\s*,?\s*/, /^(please|kindly|can you|could you|would you|will you|i want to|i wanna|i would like to|lets|let s|let us)\s+/,
    /\s+(please|now|for me|right now|jaldi)$/,
  ];
  for (let again = true; again; ) {
    again = false;
    for (const f of fillers) {
      const n = s.replace(f, "");
      if (n !== s) {
        s = n.trim();
        again = true;
      }
    }
  }
  return s.replace(/\b(one|two|three|four|five)\b/g, (w) => NUMBERS[w] ?? w);
}

const strip = (who: string) => who.replace(/^(to|with|on|the|my|mr|mrs|ms|sir|madam)\s+/, "").replace(/\s+(ji|sir|madam|bhai)$/, "").trim();

export function parseCommand(raw: string): Intent {
  const s = normalise(raw);
  if (!s) return { kind: "unknown", text: raw };
  let m: RegExpMatchArray | null;

  // Calls already ringing or going on.
  if (/^(answer|pick up|accept|receive|attend)( it| the call| call| this call)?( with video)?$/.test(s) || /^(call )?(utha(o|lo)|uthao)$/.test(s))
    return { kind: "call-control", action: /video/.test(s) ? "answer-video" : "answer" };
  if (/^(decline|reject|ignore|dont answer|do not answer|cut( it| the call)?)( it| the call| call)?$/.test(s) || /^(call )?kaat (do|de)$/.test(s)) return { kind: "call-control", action: "decline" };
  if (/^(hang up|end( the)? call|stop( the)? call|leave( the)? (call|meeting)|end( the)? meeting|bye|goodbye)$/.test(s) || /^(call )?(band|khatam) karo$/.test(s))
    return { kind: "call-control", action: "hangup" };
  if (/^(mute|mute me|mute myself|mute (my )?(mic|microphone)|turn off (my )?(mic|microphone)|(mic|microphone) off)$/.test(s)) return { kind: "call-control", action: "mute" };
  if (/^(unmute|unmute me|unmute myself|unmute (my )?(mic|microphone)|turn on (my )?(mic|microphone)|(mic|microphone) on)$/.test(s)) return { kind: "call-control", action: "unmute" };
  if (/^(turn on (my )?(camera|video)|(camera|video) on|start (my )?(camera|video)|show my face)$/.test(s)) return { kind: "call-control", action: "camera-on" };
  if (/^(turn off (my )?(camera|video)|(camera|video) off|stop (my )?(camera|video)|hide my face)$/.test(s)) return { kind: "call-control", action: "camera-off" };
  if (/^(raise|put up) (my )?hand$|^hand (up|raise)$/.test(s)) return { kind: "hand", up: true };
  if (/^(lower|put down|drop) (my )?hand$|^hand down$/.test(s)) return { kind: "hand", up: false };
  if (/^(mute or unmute|unmute or mute|toggle (the )?(mute|mic|microphone)|mute toggle)$/.test(s)) return { kind: "mute-toggle" };
  if (/^(raise or lower (my )?hand|lower or raise (my )?hand|toggle (my )?hand|hand)$/.test(s)) return { kind: "hand-toggle" };

  // LANX 3.7.0: the keyboard, the PC itself, typing and keys.
  if (/^((open|show|bring up|start|use)( the| my)?( air| on ?screen)? keyboard|keyboard( on)?|type with (my )?hands?)$/.test(s)) return { kind: "keyboard", open: true };
  if (/^((close|hide|put away)( the)?( air| on ?screen)? keyboard|keyboard (off|away))$/.test(s)) return { kind: "keyboard", open: false };
  if (/^((take|grab|capture)( a)? (screenshot|screen ?shot|snapshot|screen grab)|screenshot|capture (the )?screen)$/.test(s)) return { kind: "screenshot" };
  if (/^lock( (the|my|this))?( (pc|computer|screen|laptop|system))?$/.test(s)) return { kind: "lock" };
  if (/^(show|open|bring( up| back)?|switch to|go to)( the)? (lanx|lynx|links)$/.test(s)) return { kind: "show-lanx" };
  if ((m = s.match(/^type (.+)$/))) return { kind: "type", text: m[1] };
  if ((m = s.match(/^press (.+)$/))) {
    const keys = parseKeys(m[1]);
    if (keys) return { kind: "keys", keys, label: m[1] };
  }

  // Music.
  if (/^(pause|pause (the )?(music|song|it)|stop (the )?(music|song)|stop playing|music (band|stop)|gaana band karo|band karo)$/.test(s)) return { kind: "music", action: "pause" };
  if (/^(next|next (song|track|one)|skip( (it|this|song|this song))?|agla gaana|agla)$/.test(s)) return { kind: "music", action: "next" };
  if (/^(previous|previous (song|track|one)|go back a song|last song|pichla gaana|pichla)$/.test(s)) return { kind: "music", action: "prev" };
  if (/^(volume up|louder|turn it up|increase (the )?volume|awaaz badhao)$/.test(s)) return { kind: "music", action: "louder" };
  if (/^(volume down|quieter|softer|turn it down|decrease (the )?volume|lower (the )?volume|awaaz kam karo)$/.test(s)) return { kind: "music", action: "quieter" };
  if (/^(resume|continue|play|play music|play (the )?song|play something|unpause|start (the )?music|gaana chalao|music chalao)$/.test(s)) return { kind: "music", action: "play" };
  if ((m = s.match(/^play (.+?)( song| songs| music)?( on lanx)?$/))) return { kind: "music", action: "play", query: m[1] };
  if ((m = s.match(/^(.+?) (bajao|chalao|lagao)$/)) && !/call|phone/.test(m[1])) return { kind: "music", action: "play", query: m[1].replace(/^(gaana|song) /, "") };

  // Calls and messages.
  if ((m = s.match(/^(video call|videocall|face ?time|video chat with) (.+)$/))) return { kind: "call", who: strip(m[2]), video: true };
  if ((m = s.match(/^(call|phone|ring|dial|voice call|audio call) (.+?)( on video| with video)?$/))) return { kind: "call", who: strip(m[2]), video: !!m[3] };
  if ((m = s.match(/^(.+?) ko (video )?(call|phone) (karo|lagao|kar do|laga do|kar)$/))) return { kind: "call", who: strip(m[1]), video: !!m[2] };
  if ((m = s.match(/^(start|begin|have) (a )?(video |voice )?meeting( with (.+))?$/))) return { kind: "meeting", who: m[5] ? strip(m[5]) : null, video: m[3] !== "voice " };
  if ((m = s.match(/^send (.+) to (\S+(?: \S+)?)$/)) && !/^(a )?(message|text|msg)$/.test(m[1])) return { kind: "message", who: strip(m[2]), text: m[1] };
  // "Message Bharat I'm on my way": where the name ends is decided against the contacts (splitWho).
  if ((m = s.match(/^(?:send (?:a )?(?:message|text|msg) to|send (?:a )?(?:message|text|msg)|message|text|msg|tell|write to|ping) (.+)$/))) return { kind: "message", who: "", text: "", rest: strip(m[1]) };
  if ((m = s.match(/^(.+?) ko (message|msg) (bhejo|karo) (.+)$/))) return { kind: "message", who: strip(m[1]), text: m[4] };

  // Reactions on the last message.
  if (/^(like it|like (that|this)|thumbs up|like the last message)$/.test(s)) return { kind: "react", emoji: "👍" };
  if (/^(love it|love (that|this)|heart it)$/.test(s)) return { kind: "react", emoji: "❤️" };

  // Opening things.
  if ((m = s.match(/^(open up|open|show me|show|go to|switch to|take me to|launch|start) (.+)$/))) {
    const what = m[2].replace(/\s+(app|tab|page|screen|window)$/, "");
    for (const [re, id] of TOOLS) if (re.test(what)) return { kind: "open", what: id };
    for (const [re, id] of TABS) if (re.test(what)) return { kind: "tab", tab: id };
    if (/^(who is|whos) (in|online|here)$/.test(what)) return { kind: "tab", tab: "people" };
    const who = what.replace(/^(the )?(chat|conversation|messages) (with |from |of )?/, "").replace(/^(my )?(chat|conversation) with /, "").replace(/(s)? chat$/, "");
    return { kind: "open-chat", who: strip(who) };
  }
  for (const [re, id] of TOOLS) if (re.test(s)) return { kind: "open", what: id };
  if ((m = s.match(/^(chat|talk) (with|to) (.+)$/))) return { kind: "open-chat", who: strip(m[3]) };
  if (/^(who is|whos|who all are) (in|online|here|in the office)$/.test(s)) return { kind: "tab", tab: "people" };

  // The rest.
  if ((m = s.match(/^(search|find|look) (for |up )?(.+)$/))) return { kind: "search", query: m[3] };
  if ((m = s.match(/^(new note|take a note|make a note|note down|write down|note)( that)? (.+)$/))) return { kind: "note", text: m[3] };
  if (/^(new note|take a note|make a note)$/.test(s)) return { kind: "note", text: "" };
  if (/^(dark mode|dark theme|go dark|switch to dark( mode)?|night mode)$/.test(s)) return { kind: "theme", theme: "dark" };
  if (/^(light mode|light theme|go light|switch to light( mode)?|day mode)$/.test(s)) return { kind: "theme", theme: "light" };
  if (/^(scroll|go) (up|down)$/.test(s)) return { kind: "scroll", dir: s.endsWith("up") ? "up" : "down" };
  if (/^(go to |scroll to )?(the )?top$/.test(s)) return { kind: "scroll", dir: "top" };
  if (/^(go to |scroll to )?(the )?bottom$/.test(s)) return { kind: "scroll", dir: "bottom" };
  if (/^(go back|back|close( it| this| that)?|cancel|never ?mind|wapas)$/.test(s)) return { kind: "back" };
  if (/^(stop|turn off|switch off|disable) (the )?(gestures?|hand control|camera)$/.test(s)) return { kind: "gestures-off" };
  if (/^(help|what can i say|what can you do|commands|show (the )?commands)$/.test(s)) return { kind: "help" };
  return { kind: "unknown", text: raw.trim() };
}

/** Edit distance, for names the speech engine spells a little differently ("Bharath"). */
function lev(a: string, b: string): number {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0];
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = t;
    }
  }
  return d[b.length];
}
const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);

/** A word without its vowels and doubled letters: "mahek" → "mhk", "jinn" → "jn". */
const skeleton = (w: string) => w.replace(/[aeiouy]/g, "").replace(/(.)\1+/g, "$1");

/** How well a spoken name fits a contact's name (0..1). */
export function nameScore(spoken: string, name: string): number {
  const said = words(spoken);
  const have = words(name);
  if (!said.length || !have.length) return 0;
  const joined = have.join(" ");
  if (said.join(" ") === joined) return 1;
  let total = 0;
  for (const w of said) {
    let best = 0;
    for (const h of have) {
      if (h === w) best = 1;
      else if (h.startsWith(w) && w.length >= 3) best = Math.max(best, 0.9);
      // The same consonants ("Jean" / "Jin", "Mehak" / "Mahek"): names the speech engine spells its own way.
      else if (skeleton(w).length >= 2 && skeleton(w) === skeleton(h)) best = Math.max(best, 0.82);
      else {
        const sim = 1 - lev(w, h) / Math.max(w.length, h.length);
        best = Math.max(best, sim);
      }
    }
    total += best;
  }
  return total / said.length;
}

/** The best-fitting name, if it fits well enough. */
export function bestMatch<T>(spoken: string, items: T[], nameOf: (t: T) => string): T | null {
  let best: T | null = null;
  let score = 0.68;
  for (const it of items) {
    const sc = nameScore(spoken, nameOf(it));
    if (sc > score) {
      score = sc;
      best = it;
    }
  }
  return best;
}

/** "bharat im on my way" → who "bharat", text "im on my way": the longest
 *  start that is somebody's name (up to three words). */
export function splitWho(rest: string, names: string[]): { who: string; text: string } {
  const w = rest.split(/\s+/).filter(Boolean);
  let pick = 1;
  let score = 0;
  for (let n = Math.min(3, w.length - 1); n >= 1; n--) {
    const said = w.slice(0, n).join(" ");
    const sc = Math.max(0, ...names.map((nm) => nameScore(said, nm)));
    if (sc >= 0.68 && sc > score + 0.05) {
      score = sc;
      pick = n;
    }
  }
  const text = w
    .slice(pick)
    .join(" ")
    .replace(/^(that|saying|to say|say|ki)\s+/, "");
  return { who: w.slice(0, pick).join(" "), text };
}

/** The end of a command as the speech engine wrote it (capitals, commas):
 *  "message Bharat I'm on my way." → "I'm on my way." for the message itself. */
export function restoreCase(raw: string, text: string): string {
  // Word by word, plainly: no "hey LANX" stripping here ("Jarvis" can be a word of the message).
  const plain = (w: string) => {
    const s = w.toLowerCase().replace(/[“”"'’`]/g, "").replace(/[^\p{L}\p{N}@.-]/gu, "").replace(/[.]+$/, "");
    return NUMBERS[s] ?? s;
  };
  const want = text.split(/\s+/).filter(Boolean);
  const said = raw.trim().split(/\s+/).filter((w) => plain(w) !== "");
  for (let end = said.length; end >= want.length && end >= said.length - 3; end--) {
    const tail = said.slice(end - want.length, end);
    if (want.length && tail.every((w, i) => plain(w) === want[i])) return tail.join(" ");
  }
  return text;
}

/** What the help card lists. */
export const EXAMPLES: string[] = [
  "Call Bharat", "Video call Asha", "Message Bharat I'm on my way", "Open chat with Asha", "Play Kesariya", "Pause", "Next song", "Louder",
  "Answer", "Decline", "Mute", "Hang up", "Raise my hand", "Open notes", "Open calendar", "Open games", "Who's in", "Dark mode", "Search invoice", "Take a note call the bank",
  "Open keyboard", "Type see you at 5", "Press ctrl c", "Take a screenshot", "Lock this PC", "Show LANX", "Mute or unmute",
];
