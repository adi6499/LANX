// One fake "LANX backend" per PC (the PC's id is in the module URL's query string).
const pc = new URL(import.meta.url).searchParams.get("pc");
const net = globalThis.NET;
export const errorText = (e) => String(e?.message ?? e);
export const api = {
  sendGame: (peerId, step) => net.send(pc, peerId, step),
  getPref: async (k) => net.prefs[pc]?.[k] ?? null,
  setPref: async (k, v) => { (net.prefs[pc] ??= {})[k] = v; },
  getConversations: async () => [],
  getMessages: async () => [],
};
