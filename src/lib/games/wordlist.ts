// LANX 3.18.0: Wordbox's English word list (about 270,000 words), in one place: the boards show
// from it why a word cannot be sent, and the match code asks it before a word is played — on the
// PC of whoever sends the word, and again on the host's PC for a guest's word. (Only the sender's
// board used to look, and not while the list was still loading: "DET" could score.)
//
// The rules themselves stay a pure replay of the moves and never see the list: they check the
// letters on the grid, the length, and that a player has not had the word before.

let dictionary: Set<string> | null = null;
let loading: Promise<Set<string> | null> | null = null;

/** The list, loaded the first time it is asked for; null when it cannot be loaded. */
export function loadWordList(): Promise<Set<string> | null> {
  if (dictionary) return Promise.resolve(dictionary);
  loading ??= import("../../../node_modules/word-list/words.txt?raw")
    .then((m) => {
      dictionary = new Set((m.default as string).split("\n").map((w) => w.trim().toUpperCase()));
      return dictionary;
    })
    .catch(() => null);
  return loading;
}
/** The list if it is loaded already. */
export const wordListNow = (): Set<string> | null => dictionary;

/** For the tests: a list of their own (or null to forget it). */
export function setWordList(words: Iterable<string> | null) {
  dictionary = words ? new Set([...words].map((w) => w.trim().toUpperCase())) : null;
  loading = dictionary ? Promise.resolve(dictionary) : null;
}

/** Whether `word` is in the list. True as well when the list cannot be had at all (then there is
 *  nothing to check against, as before). */
export async function inWordList(word: string): Promise<boolean> {
  const list = await loadWordList();
  return !list || list.has(word.trim().toUpperCase());
}

/** A Wordbox answer ("<player>@a:<word>", with or without its round): is the word in the list? Any other move: yes. */
export async function wordboxMoveAllowed(move: string): Promise<boolean> {
  const mm = /^\d+@a(?:#\d+)?:(.*)$/s.exec(move);
  return !mm || inWordList(mm[1]);
}
