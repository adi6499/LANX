// A fake office network: who is online, which sends fail, and in which order steps arrive.
const GAMES = new URL("../../../src/lib/games.ts", import.meta.url).href;
export const tick = (n = 6) => new Promise((r) => { const go = (k) => (k ? setImmediate(() => go(k - 1)) : r()); go(n); });
export function makeNet() {
  const net = { pcs: {}, prefs: {}, log: [], fail: null, hold: null, held: [], run: 0 };
  net.send = async (from, to, step) => {
    net.log.push({ from, to, action: step.action, seq: step.seq, data: step.data });
    if (net.fail && net.fail(from, to, step)) throw new Error(`${to} is offline right now.`);
    const ev = { ...JSON.parse(JSON.stringify(step)), from_id: from, from_name: `Name-${from}`, at: 1 };
    const deliver = () => net.pcs[to]?.receive(ev);
    if (net.hold && net.hold(from, to, step)) { net.held.push(deliver); return true; }
    await tick(1);
    deliver();
    return true;
  };
  net.boot = async (id) => {
    // A fresh copy of games.ts = LANX (re)started on that PC; the preferences on disk stay.
    const mod = await import(`${GAMES}?pc=${id}&run=${(globalThis.RUN = (globalThis.RUN ?? 0) + 1)}`);
    mod.setMe(id, `Name-${id}`);
    net.pcs[id] = mod;
    return mod;
  };
  net.release = async (order) => { const h = net.held.splice(0); for (const i of order ?? h.map((_, k) => k)) h[i](); await tick(); };
  net.stats = (id) => JSON.parse(net.prefs[id]?.games_stats ?? "{}");
  globalThis.NET = net;
  return net;
}
export const peer = (id) => ({ id, display_name: `Name-${id}`, status: "online", trust_state: "trusted" });
export const cardMsg = (from, old = false) => ({ is_outgoing: false, sender_id: from, timestamp: old ? 1000 : Date.now() / 1000 + 5, message_type: "card", content: "" });
