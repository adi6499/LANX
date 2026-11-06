/** LANX 3.7.0: the air keyboard — point at a key with a hand, pinch to press it.
 *
 *  Everything here is plain logic (no React, no page): where every key sits for
 *  a given size, which key a pointer is over, what a key press types, and the
 *  word suggestions on top. The keyboard inside the LANX window and the small
 *  always-on-top one over other apps both lay themselves out with
 *  layoutKeyboard(), so a pointer position means the same key on both. */

export type KeyKind = "char" | "shift" | "back" | "enter" | "space" | "page" | "mic" | "close" | "left" | "right" | "suggest";

export interface KeyRect {
  /** Stable across renders and pages: "k-q", "k-shift", "s-0", "e-2", "sg-0"… */
  id: string;
  kind: KeyKind;
  /** What the key shows (letters in the case they will type). */
  label: string;
  /** What a "char" key types (lower case), or the word a "suggest" chip puts in. */
  value?: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface KbState {
  page: "abc" | "123";
  /** The next letter is a capital (one letter only). */
  shift: boolean;
  /** Caps lock. */
  caps: boolean;
  /** The letters typed since the last space / enter (what the suggestions complete). */
  word: string;
  suggestions: string[];
}

export type KbOut =
  | { kind: "text"; text: string }
  | { kind: "key"; code: "Backspace" | "Enter" | "ArrowLeft" | "ArrowRight" }
  | { kind: "backspaces"; n: number }
  | { kind: "close" }
  | { kind: "mic" };

/** The size the keyboard likes to be, in CSS px. */
export const KB_SIZE: { w: number; h: number } = { w: 860, h: 310 };

/** Space between keys, and between the keys and the panel's edge. */
const GAP = 6;
const PAD = 6;
/** The suggestion bar is a little lower than a row of keys. */
const BAR_WEIGHT = 0.78;
const KEY_ROWS = 4;

// ------------------------------------------------------------------ layout

interface Spec {
  id: string;
  kind: KeyKind;
  label: string;
  value?: string;
  /** Width, relative to the other keys in its row. */
  wt: number;
}

const LETTERS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];
const DIGITS = "1234567890";
const SYMBOLS: Array<[string, string]> = [
  ["dash", "-"], ["slash", "/"], ["colon", ":"], ["semi", ";"], ["lparen", "("],
  ["rparen", ")"], ["rupee", "₹"], ["amp", "&"], ["at", "@"], ["quote", '"'],
];
const PUNCT: Array<[string, string]> = [["dot", "."], ["comma", ","], ["ask", "?"], ["bang", "!"], ["apos", "'"], ["hash", "#"]];
const EMOJI = ["👍", "❤️", "😂", "🙏", "🎉", "😊"];

function bottomRow(page: KbState["page"]): Spec[] {
  return [
    { id: "k-page", kind: "page", label: page === "abc" ? "123" : "ABC", wt: 1.25 },
    { id: "k-mic", kind: "mic", label: "Dictate", wt: 1 },
    { id: "k-comma", kind: "char", label: ",", value: ",", wt: 0.8 },
    { id: "k-space", kind: "space", label: "space", wt: 3 },
    { id: "k-period", kind: "char", label: ".", value: ".", wt: 0.8 },
    { id: "k-left", kind: "left", label: "Left", wt: 0.8 },
    { id: "k-right", kind: "right", label: "Right", wt: 0.8 },
    { id: "k-enter", kind: "enter", label: "return", wt: 1.6 },
    { id: "k-close", kind: "close", label: "Hide keyboard", wt: 1 },
  ];
}
const backKey = (wt: number): Spec => ({ id: "k-back", kind: "back", label: "Delete", wt });

function keyRows(state: KbState): Spec[][] {
  if (state.page === "123") {
    const sym = (id: string, c: string, wt = 1): Spec => ({ id: `s-${id}`, kind: "char", label: c, value: c, wt });
    return [
      [...DIGITS].map((d) => sym(d, d)),
      SYMBOLS.map(([id, c]) => sym(id, c)),
      [...PUNCT.map(([id, c]) => sym(id, c)), ...EMOJI.map((e, i): Spec => ({ id: `e-${i}`, kind: "char", label: e, value: e, wt: 1 })), backKey(1.5)],
      bottomRow("123"),
    ];
  }
  const up = state.shift || state.caps;
  const ch = (c: string, wt = 1): Spec => ({ id: `k-${c}`, kind: "char", label: up ? c.toUpperCase() : c, value: c, wt });
  const [r1, r2, r3] = LETTERS.map((r) => [...r]);
  return [
    r1.map((c) => ch(c)),
    // "a" and "l" are wider so the row fills edge to edge and still sits half a key in.
    r2.map((c, i) => ch(c, i === 0 || i === r2.length - 1 ? 1.5 : 1)),
    [{ id: "k-shift", kind: "shift", label: "Shift", wt: 1.5 }, ...r3.map((c) => ch(c)), backKey(1.5)],
    bottomRow("abc"),
  ];
}

/** Splits [from, to] into pieces sized by weight, GAP apart. */
function split(from: number, to: number, weights: number[]): Array<[number, number]> {
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const free = Math.max(0, to - from - GAP * (weights.length - 1));
  let at = from;
  return weights.map((wt) => {
    const a = at;
    const b = at + (free * wt) / total;
    at = b + GAP;
    return [a, b];
  });
}

function rowBands(height: number): Array<[number, number]> {
  return split(PAD, Math.max(PAD, height - PAD), [BAR_WEIGHT, ...Array.from({ length: KEY_ROWS }, () => 1)]);
}

/** Suggestion chip slots, left to right; the best suggestion sits in the middle (like iOS). */
const SLOT_OF_RANK = [1, 0, 2];

function rectOf(s: Pick<Spec, "id" | "kind" | "label" | "value">, x0: number, y0: number, x1: number, y1: number): KeyRect {
  const x = Math.round(x0);
  const y = Math.round(y0);
  const k: KeyRect = { id: s.id, kind: s.kind, label: s.label, x, y, w: Math.max(0, Math.round(x1) - x), h: Math.max(0, Math.round(y1) - y) };
  if (s.value !== undefined) k.value = s.value;
  return k;
}

/** Where the suggestion bar sits (the same on both pages, with or without suggestions). */
export function suggestionBar(width: number, height: number): { x: number; y: number; w: number; h: number } {
  const [y0, y1] = rowBands(height)[0];
  const x = PAD;
  const y = Math.round(y0);
  return { x, y, w: Math.max(0, Math.round(Math.max(PAD, width - PAD)) - x), h: Math.max(0, Math.round(y1) - y) };
}

/** The three chip slots of the suggestion bar, left to right. */
export function suggestionSlots(width: number, height: number): Array<{ x: number; y: number; w: number; h: number }> {
  const [y0, y1] = rowBands(height)[0];
  return split(PAD, Math.max(PAD, width - PAD), [1, 1, 1]).map(([a, b]) => {
    const r = rectOf({ id: "", kind: "suggest", label: "" }, a, y0, b, y1);
    return { x: r.x, y: r.y, w: r.w, h: r.h };
  });
}

/** Every key of the keyboard at this size, filling it edge to edge. */
export function layoutKeyboard(width: number, height: number, state: KbState): KeyRect[] {
  const W = Math.max(0, width || 0);
  const H = Math.max(0, height || 0);
  const bands = rowBands(H);
  const out: KeyRect[] = [];
  const [by0, by1] = bands[0];
  const slots = split(PAD, Math.max(PAD, W - PAD), [1, 1, 1]);
  (state.suggestions ?? []).slice(0, 3).forEach((word, rank) => {
    const [x0, x1] = slots[SLOT_OF_RANK[rank]];
    out.push(rectOf({ id: `sg-${rank}`, kind: "suggest", label: word, value: word }, x0, by0, x1, by1));
  });
  keyRows(state).forEach((row, i) => {
    const [y0, y1] = bands[i + 1];
    const xs = split(PAD, Math.max(PAD, W - PAD), row.map((k) => k.wt));
    row.forEach((k, j) => out.push(rectOf(k, xs[j][0], y0, xs[j][1], y1)));
  });
  return out;
}

/** The key under a point, else the nearest one within `slack` px (a hand in the air sways). */
export function keyAt(keys: KeyRect[], x: number, y: number, slack = 14): KeyRect | null {
  let best: KeyRect | null = null;
  let bestD = Infinity;
  for (const k of keys) {
    if (k.w <= 0 || k.h <= 0) continue;
    const dx = Math.max(k.x - x, 0, x - (k.x + k.w));
    const dy = Math.max(k.y - y, 0, y - (k.y + k.h));
    const d = Math.hypot(dx, dy);
    if (d === 0) return k;
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  return bestD <= slack ? best : null;
}

// ------------------------------------------------------------------ typing

const capFirst = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);
const isLetter = (c: string) => /^[a-z]$/i.test(c);

/** Fresh suggestions for the word being typed (capitalised when Shift is on and nothing is typed yet). */
function refresh(s: KbState): KbState {
  let list = suggest(s.word);
  if (s.caps) list = list.map((w) => w.toUpperCase());
  else if (!s.word && s.shift) list = list.map(capFirst);
  return { ...s, suggestions: list };
}

/** A finished word goes into the user's own list. */
function finish(word: string): void {
  if (word.replace(/'/g, "").length >= 2) learnWords(word);
}

/** What pressing a key types, and the keyboard after it. */
export function applyKey(state: KbState, key: KeyRect): { state: KbState; out: KbOut[] } {
  const out: KbOut[] = [];
  const s: KbState = { ...state, word: state.word ?? "", suggestions: state.suggestions ?? [] };
  switch (key.kind) {
    case "char": {
      const v = key.value ?? key.label;
      if (!v) break;
      const text = s.shift || s.caps ? v.toUpperCase() : v;
      out.push({ kind: "text", text });
      if (isLetter(v) || (v === "'" && s.word)) s.word += text;
      else {
        finish(s.word);
        s.word = "";
      }
      s.shift = false;
      break;
    }
    case "shift":
      // off → one capital → caps lock → off
      if (s.caps) {
        s.caps = false;
        s.shift = false;
      } else if (s.shift) {
        s.shift = false;
        s.caps = true;
      } else s.shift = true;
      break;
    case "back":
      out.push({ kind: "key", code: "Backspace" });
      s.word = s.word.slice(0, -1);
      break;
    case "enter":
      out.push({ kind: "key", code: "Enter" });
      finish(s.word);
      s.word = "";
      break;
    case "space":
      out.push({ kind: "text", text: " " });
      finish(s.word);
      s.word = "";
      break;
    case "left":
    case "right":
      out.push({ kind: "key", code: key.kind === "left" ? "ArrowLeft" : "ArrowRight" });
      // The caret moved: whatever comes next is not the same word.
      s.word = "";
      break;
    case "page":
      s.page = s.page === "abc" ? "123" : "abc";
      break;
    case "close":
      out.push({ kind: "close" });
      break;
    case "mic":
      out.push({ kind: "mic" });
      break;
    case "suggest": {
      const chosen = key.value ?? "";
      if (!chosen) break;
      if (s.word.length) out.push({ kind: "backspaces", n: s.word.length });
      out.push({ kind: "text", text: chosen + " " });
      learnWords(chosen);
      s.word = "";
      s.shift = false;
      break;
    }
  }
  return { state: refresh(s), out };
}

// ------------------------------------------------------------------ words

/** About 1,500 everyday English words, most used first (chat and office words near the top). */
const COMMON_WORDS = [
  "the i to you and a it is that ok of in for me my on this have be so we do not are with but what can just was it's i'm",
  "yes no if your all at get like know will up he she they about how out good there one now thanks thank please sure hi",
  "hello hey okay done sorry today tomorrow meeting call lunch office morning time see go going come coming would should",
  "could did don't can't won't didn't doesn't isn't i'll i've i'd let's you're we're they're that's there's what's here",
  "then when where why who which them their our us him her his an as by from or had has been were more some any very",
  "much also well really need want make think back right new work day night yeah yep fine great nice cool awesome",
  "welcome bye later soon wait minute minutes hour hours week weeks month year send sent check update file files message",
  "reply sir madam team boss client customer order payment invoice price quote rate report data list sheet mail email",
  "phone number address name details info share shared confirm confirmed noted received receive pending free busy",
  "available leave home ready start started finish finished complete working tonight evening afternoon yesterday",
  "monday tuesday wednesday thursday friday saturday sunday dear regards kindly asap urgent",
  "help helped helping helps look looked looking looks made does must ever those left during everybody gives knows",
  "other into over only even first last long little after before most people way say said take took give gave use used",
  "find found tell told ask asked seem feel felt try tried put mean meant keep kept let begin show shown hear heard play",
  "run move live believe hold bring brought happen write wrote written provide sit stand lose lost pay paid meet met",
  "include continue set learn change lead understand watch follow stop create speak spoke read allow add spend spent",
  "grow open walk win won offer remember love consider appear buy bought serve expect build built stay fall cut reach",
  "remain suggest raise pass sell sold require decide pull explain hope develop carry break broke thing things man men",
  "woman women child children world life hand part place case point company group problem fact eye question side kind",
  "head house service friend friends father mother power game line end member law car city community area money story",
  "issue job word business system program school country state family student water room again still never always",
  "something nothing anything everything someone anyone everyone nobody maybe actually already probably definitely",
  "exactly almost enough quite rather together around away down off through between under above below without within",
  "because while until since though although however yet both each every few many several such same different own",
  "small big large high low old young early late next best better worse worst less least much more most real true",
  "important possible sure clear easy hard simple quick quickly fast slow happy glad sad tired sick fine okay alright",
  "lol haha hmm wow oh ah oops omg btw thx pls plz congrats congratulations cheers welcome noted",
  "doing going getting making looking coming saying telling thinking trying talking waiting using having taking giving",
  "feeling sending calling checking asking leaving trying reading writing running sitting standing eating sleeping",
  "wanted needed looked worked started called asked tried liked loved happened decided planned shared updated",
  "done gone seen given taken known shown sent got gotten became become came went knew thought",
  "two three four five six seven eight nine ten twenty hundred thousand million half second third once twice first last",
  "began feet held ran am born dead fell grew led saw stood caught apple bar coat dollar chart column branch dry plain",
  "january february march april may june july august september october november december",
  "account application approve approved approval attached attachment attach battery birthday bill budget cancel",
  "cancelled cannot care cash chat coffee tea colleague computer laptop contact cost couple course deadline delay",
  "delayed delivery deliver delivered design desk discuss discussion document documents download drive emergency",
  "excel feedback final fix fixed folder forward funny guys holiday idea ideas internet item items join joined link",
  "login looks lots means mobile moment network notes online password pdf photo photos pic picture plan plans",
  "presentation print printer project projects quick reach reached regarding remind reminder request requested",
  "review salary schedule screen seen server shift shortly sign status stuff submit submitted task tasks test text",
  "ticket total train travel trip usual video voice wifi wish wonderful upload uploaded meeting meetings agenda minutes",
  "manager staff hr admin accounts sales purchase supplier vendor stock material materials quotation quantity rates",
  "dispatch dispatched transport courier parcel shipment pickup delivery challan gst tax discount advance balance",
  "pending clear cleared transfer transferred bank cheque receipt bills expenses expense claim claims approved",
  "visit visited site plant factory machine machines spare spares parts repair service servicing installation",
  "sample samples drawing drawings catalogue brochure model size sizes specification specifications technical",
  "inquiry enquiry offer offers order orders confirmed confirmation followup",
  "around about across along among against behind beside beyond near far inside outside upon toward towards",
  "whose whom whatever whenever wherever whichever whoever yourself myself himself herself itself ourselves themselves",
  "able bad black blue brown green grey gray orange pink purple red white yellow dark light bright",
  "air animal answer art baby ball bank bed bird blood board boat body book books box boy brother bus cake card cat",
  "center centre chair chance character choice church class clock cloud club cold color colour corner country cup",
  "dad daughter death dinner doctor dog door dream dress drink earth east egg energy example eyes face fan farm fire",
  "fish floor flower food foot form friend front fruit fun future garden girl glass gold grass ground guest hair",
  "health heart heat hill history hospital hotel husband ice inch island key king kitchen lady lake land language",
  "level library light list love lunch machine map market meal meat milk mind minute mom mum money moon mouth movie",
  "music nature neck news north nose note ocean oil page paper park party pen pencil person piece place plane plant",
  "player pocket police pool position post price prize queen question radio rain reason result rice river road rock",
  "roof room rule salt sand science sea season seat shape ship shirt shoe shop shoulder side sister skin sky sleep",
  "smile snow son song sound soup south space speech sport spring square star station step stone store street sugar",
  "summer sun table tail teacher teeth temperature term thing ticket top town toy tree truck uncle unit university",
  "user value village voice wall war watch weather west wheel wife wind window winter wood word world yard zone",
  "accept act add admit afford agree aim allow answer apply argue arrange arrive attack attend avoid bake beat become",
  "beg behave belong bend bite blow boil borrow bother breathe burn call carry catch cause celebrate charge chase",
  "cheat check choose clean climb close collect compare complain connect contain control cook copy correct cough count",
  "cover crash cross cry dance deal decide deliver depend describe deserve destroy die dig disagree discover divide",
  "draw dress drink drive drop earn eat enjoy enter escape exercise exist expect explain fail fear feed fight fill",
  "finish fit fix fly fold forget forgive freeze fry gather guess hang hate hide hit hug hunt hurry hurt imagine",
  "improve increase inform injure introduce invite iron jog joke jump kick kill kiss knock land laugh lay lend lie",
  "lift limit listen lock manage mark marry matter measure melt mention miss mix nod notice obey obtain occur order",
  "organise organize own pack paint park perform pick plan point pour practice practise praise pray prefer prepare",
  "press pretend prevent print produce promise protect prove punish push rain realise realize receive recognise",
  "recognize recommend record reduce refuse relax release rely remove rent repair repeat replace report rescue rest",
  "return ride ring rise rob roll rush save scream search select shake shine shoot shout shut sing sink sleep slide",
  "smell smoke solve sort spell spill split spread steal stick sting store study succeed suffer supply support",
  "suppose surprise survive swim switch talk taste teach tear test thank throw tidy tie touch train translate trust",
  "turn type unite use visit vote wake wash waste wave wear weigh welcome whisper win wipe wonder worry wrap yell",
  "absolutely accident achieve active activity actual address advice affect afraid age ago agreement ahead alone",
  "amazing amount angry announce annual another anybody anymore anyway anywhere apart apartment appointment area arm",
  "army arrival article artist aside asleep attempt attention attitude audience author average award aware awful",
  "background bag balance band base basic basically basis bath beach bear beautiful beauty beer beginning behind",
  "being benefit bit bitter blame blind block blog bottle bottom brain brand brave bread break breakfast bridge brief",
  "bring broad broken brush bunch burden button cable calm camera camp campaign cancer candidate cap capital captain",
  "career careful carefully cause ceiling cell central century certain certainly chain challenge champion channel",
  "chapter charity cheap chicken chief chocolate circle citizen civil claim classic clever click climate close closed",
  "clothes coach coast code coin collection college comfortable comment commercial common communication compete",
  "competition complete completely concept concern concerned concert condition conference confidence conflict",
  "confused consider constant contract conversation cool corporate correct cotton council count county courage court",
  "cousin crazy cream creative credit crew crime crisis critical crowd crown culture curious current currently curve",
  "customer cycle daily damage danger dangerous date deal dear debate debt decent decision deep deeply defense degree",
  "demand department depth desire detail determine device difference difficult digital direct direction directly",
  "director dirty disaster discount disease dish distance district double doubt dozen draft drama due duty eager ear",
  "easily economic economy edge edit editor education effect effective effort either elect election electric",
  "element else elsewhere employee employer empty end enemy engine engineer engineering enormous entire entirely",
  "entrance entry environment episode equal equipment error especially essential establish estate estimate evaluate",
  "event eventually evidence evil exact exam examine excellent except exchange excited exciting excuse executive",
  "exist expensive experience expert extra extreme extremely fair fairly faith false familiar famous fancy fantastic",
  "fashion fat fault favorite favourite feature fee female festival fever field figure film finally finance financial",
  "fine finger firm fit flag flat flight focus folk following force foreign forest forever formal former fortune",
  "forward frame frankly free freedom frequent fresh fridge friendly frightened full fully function fund funding",
  "funny furniture gain gap gas gate general generally generous gentle gift global goal god goes golden grab grade",
  "grand grant grateful greatly grocery gross growth guarantee guard guidance guide guilty guitar gun habit handle",
  "handsome hardly harm hat heading heavy height helpful hero highly hire historic hit hole holy honest honestly",
  "honey honor honour hope horrible horse host hot huge human humor hundred hungry hunt ideal identify identity ill",
  "illegal image immediate immediately impact impossible impression impressive income indeed independent indicate",
  "individual industry influence initial injury innocent input insert inside insist instance instead instruction",
  "insurance intelligent intend interest interested interesting international interview investment involve involved",
  "item jacket jeans joint journey judge juice junior jury justice keen kid kids kind kindly kinds knee knife",
  "knowledge label lack ladder largely laser latest latter launch lawyer layer lazy leader leadership league lean",
  "least lecture legal lemon length lesson letter liberal license licence lie lifestyle likely limit limited lip",
  "liquid listen literally loan local locate location lonely loose lord loss lot loud lovely lower lucky luggage",
  "mad magazine magic main mainly maintain major majority male mall manner manual marriage married mass massive",
  "master match mate math maths maximum meaning measure media medical medicine medium memory mental menu mess",
  "message metal method middle midnight might mild military mine minimum minister minor mirror mission mistake",
  "mixed mode modern monitor mood moreover mostly motor mountain mouse movement mrs ms mr multiple murder museum",
  "mystery narrow nation national native natural naturally nearby nearly neat necessarily necessary negative",
  "neighbour neighbor neither nervous net neutral nevertheless newly newspaper nice nobody noise none nor normal",
  "normally northern notebook novel nowhere nuclear numerous nurse object obvious obviously occasion odd offence",
  "offense officer official often oh older onion ones online opening opera operation opinion opportunity opposite",
  "option ordinary organisation organization original otherwise ought ourselves outcome output overall owner pace",
  "package pain painting pair pale pan panel parent parents partly partner passenger passion past path patient",
  "pattern peace peak pepper per perfect perfectly perform performance perhaps period permanent permission personal",
  "personally phase philosophy physical piano pilot pink pity plastic plate platform pleasant pleased pleasure plenty",
  "plus poem poet poetry poor pop popular population port portion positive possibly potato potential pound poverty",
  "powerful practical pray prayer precious precisely pregnant premium presence present president pressure pretty",
  "previous previously pride priest primary prime prince princess principle prior priority prison private",
  "probably procedure process product production professional professor profile profit progress proof proper",
  "properly property proposal propose protection proud provided public pure purpose purse quality quarter quiet",
  "quietly quit quite race railway raise range rapid rapidly rare rarely rate rather raw reaction reader reading",
  "reality really rear reasonable recent recently recipe recording recover red reference reflect reform regard",
  "region regular regularly relate related relation relationship relative relatively relevant relief religion",
  "religious remaining remarkable remote rent repeat reply represent republic reputation require research resident",
  "resource respect respond response responsibility responsible restaurant result retire reveal revenue reverse",
  "rich rid right ring risk rival role romantic rough round route routine row royal rubbish rude ruin rural sad",
  "safe safety sake salad sale sample sand satisfied sauce savings scale scared scene schedule scheme scholar score",
  "screen script seal secret secretary section sector secure security seed seek select self senior sense sensible",
  "sensitive sentence separate sequence series serious seriously session settle setting severe shadow shake",
  "shall shame share sharp sheet shelf shell shelter shock shoot shopping short shot show shower shy sight signal",
  "significant silence silent silly silver similar simply sincerely single sir site situation skill skills slight",
  "slightly slip smart smooth snack social society soft software soil soldier solid solution somebody somehow",
  "sometimes somewhat somewhere sorry soul source southern spare speaker special specific speed spend spirit split",
  "spot staff stage stair stairs standard stare statement steady steal steel stick stiff stock stomach storm",
  "straight strange stranger strategy stream strength stress strict strike string strong strongly structure struggle",
  "student studio stupid style subject substance succeed success successful suddenly sufficient suggestion suit",
  "suitable summary super supper support surely surface surgery surname surround survey suspect sweet symbol system",
  "tall tank target task tax taxi technique technology teenager telephone television temporary tend tennis tension",
  "terrible terribly thanks theatre theater theme theory therefore thick thin thirsty thus tight till tiny tip tired",
  "title toilet tomato tone tongue tonight tool tooth topic total totally tough tour tourist toward towel tower track",
  "trade tradition traditional traffic training transfer transport trap treat treatment trend trial trick trouble",
  "trousers truly truth tube tune twin typical typically ugly ultimately unable uncle unfortunately uniform union",
  "unique unit unless unlike unlikely unusual upper upset upstairs urban used useful usual usually vacation valley",
  "valuable variety various vast vegetable vehicle version via victim view village violence virtual virus vision",
  "visitor vital volume wage waiter warm warn warning wealth weapon website wedding weekend weekly weight weird well",
  "western wet whatever wheel whenever whereas whether whilst whole wide widely wild willing wine wing winner wise",
  "within wooden worker workers wound wrong yeah yellow yesterday yet yours youth zero",
  "ji bhai haan nahi acha accha theek thik kya hai hain kal aaj abhi bas chalo",
].join(" ");

let commonList: string[] | null = null;
function common(): string[] {
  if (!commonList) {
    const seen = new Set<string>();
    commonList = [];
    for (const w of COMMON_WORDS.split(/\s+/)) {
      if (!w || !/^[a-z]+(?:'[a-z]+)*$/.test(w) || seen.has(w)) continue;
      seen.add(w);
      commonList.push(w);
    }
  }
  return commonList;
}

const STARTERS = ["i", "the", "ok", "thanks", "hi", "yes"];

// The words the user has typed, with how often (newest last).
const WORDS_KEY = "lanx.kb.words";
const MAX_WORDS = 2000;
let userCounts: Map<string, number> | null = null;

function storage(): Storage | null {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    return ls && typeof ls.getItem === "function" && typeof ls.setItem === "function" ? ls : null;
  } catch {
    return null;
  }
}

function userWords(): Map<string, number> {
  if (userCounts) return userCounts;
  userCounts = new Map();
  try {
    const raw = storage()?.getItem(WORDS_KEY);
    const obj = raw ? (JSON.parse(raw) as unknown) : null;
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      for (const [w, n] of Object.entries(obj as Record<string, unknown>)) {
        if (typeof n === "number" && n > 0 && Number.isFinite(n) && /^[a-z]+(?:'[a-z]+)*$/.test(w) && w.length <= 24) userCounts.set(w, n);
      }
    }
  } catch {
    // a broken list starts again empty
  }
  return userCounts;
}

function saveUserWords(): void {
  try {
    storage()?.setItem(WORDS_KEY, JSON.stringify(Object.fromEntries(userWords())));
  } catch {
    // full or blocked storage: the words are still remembered until LANX closes
  }
}

/** Remembers the words in `text`, so they come first in suggestions next time. */
export function learnWords(text: string): void {
  const found = String(text ?? "").toLowerCase().match(/[a-z]+(?:'[a-z]+)*/g);
  if (!found) return;
  const counts = userWords();
  let changed = false;
  for (const w of found) {
    if (w.length < 2 || w.length > 24) continue;
    const n = (counts.get(w) ?? 0) + 1;
    counts.delete(w); // re-insert so it counts as the newest
    counts.set(w, n);
    changed = true;
  }
  if (!changed) return;
  if (counts.size > MAX_WORDS) {
    // keep the most used (newest first among equals)
    const keep = [...counts.entries()]
      .map(([w, n], i) => ({ w, n, i }))
      .sort((a, b) => b.n - a.n || b.i - a.i)
      .slice(0, Math.round(MAX_WORDS * 0.9))
      .sort((a, b) => a.i - b.i);
    counts.clear();
    for (const { w, n } of keep) counts.set(w, n);
  }
  saveUserWords();
}

// The big word list (about 270,000 words), loaded on demand. Sorted, a–z only.
let dict: string[] | null = null;
let dictLoading: Promise<void> | null = null;

/** Loads the big English word list for longer suggestions. Never throws. */
export function loadDictionary(): Promise<void> {
  if (dict) return Promise.resolve();
  try {
    dictLoading ??= import("../../../node_modules/word-list/words.txt?raw")
      .then((m) => {
        const raw = String((m as { default?: unknown }).default ?? "");
        const list = raw.split("\n").map((w) => w.trim()).filter((w) => w.length >= 2 && w.length <= 14 && /^[a-z]+$/.test(w));
        for (let i = 1; i < list.length; i++) {
          if (list[i - 1] > list[i]) {
            list.sort();
            break;
          }
        }
        if (list.length) dict = list;
      })
      .catch(() => {
        dictLoading = null; // try again next time
      });
    return dictLoading;
  } catch {
    return Promise.resolve();
  }
}

/** The first index in the sorted dictionary at or after `p`. */
function lowerBound(list: string[], p: string): number {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid] < p) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** A suggestion written the way the prefix is: "Hel" → "Hello", "HEL" → "HELLO", "i'm" → "I'm". */
function caseLike(prefix: string, word: string): string {
  if (prefix.length >= 2 && /[A-Z]/.test(prefix) && prefix === prefix.toUpperCase()) return word.toUpperCase();
  if (/^[A-Z]/.test(prefix)) return capFirst(word);
  if (word === "i" || word.startsWith("i'")) return capFirst(word);
  return word;
}

/** Up to `limit` words that start with `prefix`: the user's own words first, then common words, then the big list. */
export function suggest(prefix: string, limit = 3): string[] {
  const max = Math.max(0, Math.floor(limit));
  if (!max) return [];
  const raw = String(prefix ?? "");
  const p = raw.toLowerCase();
  if (p && !/^[a-z']+$/.test(p)) return [];
  const found: string[] = [];
  const seen = new Set<string>();
  const take = (w: string) => {
    if (found.length >= max || seen.has(w)) return;
    seen.add(w);
    found.push(w);
  };
  const mine = [...userWords().entries()]
    .map(([w, n], i) => ({ w, n, i }))
    .filter((e) => e.w.startsWith(p) && (p || e.n >= 2))
    .sort((a, b) => b.n - a.n || b.i - a.i);
  for (const e of mine) take(e.w);
  if (!p) {
    for (const w of STARTERS) take(w);
    return found.map((w) => caseLike(raw, w));
  }
  for (const w of common()) {
    if (found.length >= max) break;
    if (w.startsWith(p)) take(w);
  }
  if (found.length < max && p.length >= 3 && dict && !p.includes("'")) {
    // shortest first, then a–z
    const need = max - found.length;
    const best: string[] = [];
    for (let i = lowerBound(dict, p); i < dict.length && dict[i].startsWith(p); i++) {
      const w = dict[i];
      if (seen.has(w)) continue;
      if (best.length < need) best.push(w);
      else if (w.length < best[best.length - 1].length) best[best.length - 1] = w;
      else continue;
      best.sort((a, b) => a.length - b.length || (a < b ? -1 : 1));
    }
    for (const w of best) take(w);
  }
  return found.map((w) => caseLike(raw, w));
}

/** A keyboard with nothing typed yet. */
export const EMPTY_KB: KbState = { page: "abc", shift: false, caps: false, word: "", suggestions: suggest("") };

/** EMPTY_KB with suggestions as they are now (the user's words may have changed since startup). */
export function freshKb(): KbState {
  return refresh({ ...EMPTY_KB });
}
