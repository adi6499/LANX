/** LANX 3.8.0: Listen together — the screens. The panel to play for colleagues
 *  (and see who listens, in step to the millisecond), the invite that pops up on
 *  their PCs, and the line in the little player. The work is in lib/musicSync. */
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Check, Headphones, Loader2, Radio, Users, X } from "lucide-react";
import { api, errorText } from "../../lib/api";
import { type Invite, type PartyView, type PhoneView, decline, join, leave, listenTogether, phoneListen, startListening, startListeningForInvites, stopListening } from "../../lib/musicSync";
import type { Peer } from "../../types";
import { InviteStack, presetPicked } from "../together/common";

export function useListenTogether(): { view: PartyView; invites: Invite[] } {
  const view = useSyncExternalStore(listenTogether.subscribe, listenTogether.view, listenTogether.view);
  const invites = useSyncExternalStore(listenTogether.subscribe, listenTogether.invites, listenTogether.invites);
  return { view, invites };
}

/** "In step (±0.4 ms)" — or what it's doing instead. */
export function stepText(errMs: number | null, loading: boolean): { text: string; good: boolean } {
  if (loading) return { text: "getting the song…", good: false };
  if (errMs == null) return { text: "lining up…", good: false };
  const e = Math.abs(errMs);
  return e <= 5 ? { text: `in step (±${e < 1 ? e.toFixed(1) : Math.round(e)} ms)`, good: true } : { text: `catching up (${Math.round(e)} ms)`, good: false };
}

const initials = (n: string) =>
  n
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("") || "?";

/** The panel: start playing for colleagues, or see who's listening. */
export function TogetherSheet({ onClose }: { onClose: () => void }) {
  const { view } = useListenTogether();
  const [peers, setPeers] = useState<Peer[] | null>(null);
  const [picked, setPicked] = useState<Record<string, boolean>>(presetPicked);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);
  const [myName, setMyName] = useState("");
  const [delay, setDelay] = useState(listenTogether.delay());

  useEffect(() => {
    api.listPeers().then((list) => setPeers(list.filter((p) => p.trust_state !== "blocked"))).catch(() => setPeers([]));
    api.getSettings().then((s) => setMyName(s.display_name)).catch(() => {});
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const inParty = new Set([...(view?.members.map((m) => m.id) ?? []), ...(view?.invited.map((m) => m.id) ?? [])]);
  const online = useMemo(() => (peers ?? []).filter((p) => p.status === "online" && !inParty.has(p.id)), [peers, view]);
  const chosen = online.filter((p) => picked[p.id]);
  const all = online.length > 0 && chosen.length === online.length;

  const start = async () => {
    setBusy(true);
    setFailed({});
    try {
      const f = await startListening(
        chosen.map((p) => ({ id: p.id, name: p.display_name })),
        myName || "A colleague",
      );
      setFailed(f);
      setPicked({});
      setAdding(false);
    } catch (e) {
      setFailed({ _: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  const picker = (
    <div>
      <div className="flex items-center justify-between">
        <div className="text-[12px] font-semibold text-white/70">{online.length ? "Who's online" : peers ? "Nobody else is online right now." : "Looking…"}</div>
        {online.length > 1 && (
          <button type="button" data-together-all onClick={() => setPicked(all ? {} : Object.fromEntries(online.map((p) => [p.id, true])))} className="text-[12px] font-semibold text-sky-300 hover:text-sky-200">
            {all ? "Clear" : "Everyone"}
          </button>
        )}
      </div>
      <div className="mt-2 max-h-[240px] space-y-1 overflow-y-auto lanx-music-scroll pr-1">
        {online.map((p) => (
          <label key={p.id} data-together-peer={p.id} className={`flex cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 ${picked[p.id] ? "bg-white/15" : "hover:bg-white/[0.07]"}`}>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-white" style={{ background: p.avatar_color || "#64748b" }}>
              {initials(p.display_name)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-semibold text-white">{p.display_name}</span>
              {failed[p.id] && <span className="block text-[11.5px] text-amber-300">{failed[p.id]}</span>}
            </span>
            <input type="checkbox" checked={!!picked[p.id]} onChange={(e) => setPicked((x) => ({ ...x, [p.id]: e.target.checked }))} className="h-4 w-4 accent-sky-400" />
          </label>
        ))}
      </div>
      {failed._ && <p className="mt-2 text-[12px] text-amber-300">{failed._}</p>}
      <button type="button" data-together-start disabled={!chosen.length || busy} onClick={() => void start()} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-full bg-sky-500 py-2.5 text-[13.5px] font-bold text-white hover:bg-sky-400 disabled:opacity-40">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radio className="h-4 w-4" />}
        {view?.role === "host" ? `Invite ${chosen.length || ""}`.trim() : chosen.length ? `Play for ${chosen.length === online.length && online.length > 1 ? "everyone" : chosen.length === 1 ? chosen[0].display_name : `${chosen.length} people`}` : "Play for…"}
      </button>
    </div>
  );

  const me = view && stepText(view.errMs, view.loading);
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/50 lanx-fade" onMouseDown={onClose}>
      <div data-together-sheet={view?.role ?? "start"} className="w-[420px] max-w-[94%] max-h-[90%] overflow-y-auto rounded-3xl border border-white/10 bg-[#141a2e] p-5 text-white shadow-2xl lanx-rise" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-sky-500/20 text-sky-300">
              <Headphones className="h-5 w-5" />
            </span>
            <div>
              <div className="text-[17px] font-extrabold tracking-tight">Listen together</div>
              <div className="text-[12px] text-white/60">
                {view?.role === "member" ? `You're listening with ${view.hostName}` : view?.role === "host" ? "You choose the music" : "The same moment of the song, on every PC"}
              </div>
            </div>
          </div>
          <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full text-white/60 hover:bg-white/10">
            <X className="h-4 w-4" />
          </button>
        </div>

        {!view && (
          <>
            <p className="mt-4 text-[13px] leading-snug text-white/75">
              Pick colleagues: they get an invite, and when they join, their PC plays your music in step with yours — the same second, to the
              millisecond — each on their own speakers. You choose the songs; they can change their volume or leave.
            </p>
            <div className="mt-4">{picker}</div>
          </>
        )}

        {view?.role === "host" && (
          <div className="mt-4">
            <div className="text-[12px] font-semibold text-white/70">Listening ({view.members.length + 1})</div>
            <div className="mt-2 space-y-1">
              <div className="flex items-center gap-3 rounded-xl bg-white/[0.06] px-2.5 py-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-sky-500 text-[12px] font-bold">{initials(myName || "Me")}</span>
                <span className="flex-1 text-[13.5px] font-semibold">You</span>
                {me && <span className={`text-[12px] ${me.good ? "text-emerald-300" : "text-white/60"}`}>{me.text}</span>}
              </div>
              {view.members.map((m) => {
                const st = stepText(m.errMs, m.loading);
                return (
                  <div key={m.id} data-together-member={m.id} className="flex items-center gap-3 rounded-xl bg-white/[0.06] px-2.5 py-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-[12px] font-bold">{initials(m.name)}</span>
                    <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{m.name}</span>
                    <span className={`text-[12px] ${st.good ? "text-emerald-300" : "text-white/60"}`}>{st.text}</span>
                  </div>
                );
              })}
              {view.invited.map((m) => (
                <div key={m.id} className="flex items-center gap-3 rounded-xl px-2.5 py-2 text-white/60">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full border border-dashed border-white/25 text-[12px] font-bold">{initials(m.name)}</span>
                  <span className="min-w-0 flex-1 truncate text-[13.5px]">{m.name}</span>
                  <span className="text-[12px]">invited…</span>
                </div>
              ))}
            </div>
            {adding ? (
              <div className="mt-4">{picker}</div>
            ) : (
              <button type="button" data-together-add onClick={() => setAdding(true)} className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3.5 py-2 text-[12.5px] font-semibold hover:bg-white/15">
                <Users className="h-4 w-4" /> Invite more
              </button>
            )}
            <button type="button" data-together-stop onClick={() => void stopListening().then(onClose)} className="mt-4 w-full rounded-full border border-white/20 py-2.5 text-[13px] font-semibold text-white/85 hover:bg-white/10">
              Stop listening together
            </button>
            <p className="mt-2 text-center text-[11px] text-white/45">The music carries on here; it stops on their PCs.</p>
          </div>
        )}

        {view?.role === "member" && (
          <div className="mt-4">
            <div className="rounded-2xl bg-white/[0.06] p-3.5">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-semibold">This PC</span>
                {me && <span className={`text-[12.5px] ${me.good ? "text-emerald-300" : "text-white/60"}`}>{me.text}</span>}
              </div>
              <div className="mt-1 text-[11.5px] text-white/50">
                Clocks lined up with {view.hostName}'s PC over the network ({view.delayMs.toFixed(1)} ms round trip).
              </div>
            </div>
            <div className="mt-4">
              <div className="flex items-center justify-between text-[12.5px]">
                <span className="font-semibold">My speakers sound late</span>
                <span className="tabular-nums text-white/60">{delay === 0 ? "no" : `${delay > 0 ? "+" : ""}${delay} ms`}</span>
              </div>
              <input
                type="range"
                data-together-delay
                min={-100}
                max={400}
                step={10}
                value={delay}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setDelay(v);
                  void listenTogether.setDelay(v);
                }}
                className="mt-1.5 w-full accent-sky-400"
              />
              <div className="text-[11px] leading-snug text-white/45">Only for Bluetooth or wireless speakers, which play a little later than Windows says (usually 150–250 ms). Slide until it sounds like one room.</div>
            </div>
            <button type="button" data-together-leave onClick={() => void leave().then(onClose)} className="mt-4 w-full rounded-full border border-white/20 py-2.5 text-[13px] font-semibold text-white/85 hover:bg-white/10">
              Leave
            </button>
          </div>
        )}
        {view?.problem && <p className="mt-3 text-[12px] text-amber-300">{view.problem}</p>}
      </div>
    </div>
  );
}

/** The line in the little player (and the music app's bar): who's listening. */
export function TogetherLine({ onOpen, dark = true }: { onOpen: () => void; dark?: boolean }) {
  const { view } = useListenTogether();
  if (!view) return null;
  const st = stepText(view.errMs, view.loading);
  return (
    <button type="button" data-together-line={view.role} onClick={onOpen} className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] ${dark ? "bg-sky-500/15 text-sky-100 hover:bg-sky-500/25" : ""}`}>
      <Headphones className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">
        {view.role === "host" ? `Listening together · ${view.members.length + 1} ${view.members.length ? "people" : "(waiting for colleagues)"}` : `With ${view.hostName} · ${view.hostName} chooses the music`}
      </span>
      <span className={st.good ? "text-emerald-300" : "text-white/60"}>{st.text}</span>
    </button>
  );
}

/** Always there: invites from colleagues, and short notes ("Only Asha can change the music"). */
export function ListenInvites({ onOpenMusic }: { onOpenMusic: () => void }) {
  const { view, invites } = useListenTogether();
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    startListeningForInvites();
    let t = 0;
    const say = (text: string) => {
      setNote(text);
      window.clearTimeout(t);
      t = window.setTimeout(() => setNote(null), 4000);
    };
    const follower = () => {
      const v = listenTogether.view();
      say(v ? `${v.hostName} chooses the music while you listen together. Leave to play your own.` : "Someone else chooses the music.");
    };
    const ended = (e: Event) => say(`${(e as CustomEvent<{ hostName: string }>).detail?.hostName ?? "The host"} stopped listening together.`);
    window.addEventListener("lanx:music-follower", follower);
    window.addEventListener("lanx:listen-ended", ended);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("lanx:music-follower", follower);
      window.removeEventListener("lanx:listen-ended", ended);
    };
  }, []);
  const shown = invites.filter((i) => i.partyId !== view?.id).slice(0, 2);
  if (!shown.length && !note) return null;
  return (
    <InviteStack>
      {shown.map((inv) => (
        <div key={inv.partyId} data-together-invite={inv.partyId} className="pointer-events-auto overflow-hidden rounded-2xl bg-slate-900/95 text-white shadow-2xl lanx-rise">
          <div className="flex items-center gap-3 p-3">
            <span className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-white/10">
              {inv.song?.cover ? <img src={inv.song.cover} alt="" className="h-full w-full object-cover" /> : <Headphones className="m-3.5 h-5 w-5" />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] font-semibold">🎧 {inv.hostName} is playing music for you</div>
              <div className="truncate text-[11.5px] text-white/65">{inv.song ? `${inv.song.title} — ${inv.song.artist}` : "Join to listen together, in step"}</div>
            </div>
          </div>
          <div className="flex gap-2 px-3 pb-3">
            <button
              type="button"
              data-together-join
              disabled={busy === inv.partyId}
              onClick={async () => {
                setBusy(inv.partyId);
                try {
                  await join(inv);
                  onOpenMusic();
                } finally {
                  setBusy(null);
                }
              }}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full bg-sky-500 py-2 text-[12.5px] font-bold hover:bg-sky-400"
            >
              {busy === inv.partyId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Join
            </button>
            <button type="button" data-together-decline onClick={() => decline(inv)} className="flex-1 rounded-full bg-white/10 py-2 text-[12.5px] font-semibold hover:bg-white/15">
              Not now
            </button>
          </div>
        </div>
      ))}
      {note && <div className="pointer-events-auto rounded-2xl bg-slate-900/95 px-3.5 py-2.5 text-[12.5px] text-white shadow-2xl lanx-rise">{note}</div>}
    </InviteStack>
  );
}

// ------------------------------------------------------------------ 3.9.0: on the phone

export function usePhoneListen(): PhoneView {
  return useSyncExternalStore(listenTogether.subscribe, phoneListen.view, phoneListen.view);
}

/** The phone page, always there: invites that reached its PC, and "play here too"
 *  while the PC listens together. `ask` sends "join"/"decline" to the PC. */
export function PhoneListen({ ask, onOpenMusic }: { ask: (action: "join" | "decline", partyId: string) => Promise<unknown>; onOpenMusic: () => void }) {
  const v = usePhoneListen();
  const [hidden, setHidden] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inv = v.invites.find((i) => i.party_id !== v.pc?.id && i.party_id !== hidden);
  const offer = !v.here && v.pc && hidden !== v.pc.id ? v.pc : null;
  if (!inv && !offer) return null;
  const card = "pointer-events-auto overflow-hidden rounded-2xl bg-slate-900/95 text-white shadow-2xl lanx-rise";
  return (
    <div className="pointer-events-none fixed inset-x-3 top-[calc(env(safe-area-inset-top)+10px)] z-[80] flex flex-col gap-2">
      {inv && (
        <div data-phone-together-invite={inv.party_id} className={card}>
          <div className="flex items-center gap-3 p-3">
            <span className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-white/10">{inv.song?.cover ? <img src={inv.song.cover} alt="" className="h-full w-full object-cover" /> : <Headphones className="m-3.5 h-5 w-5" />}</span>
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-semibold">🎧 {inv.host_name} is playing music for you</div>
              <div className="truncate text-[12.5px] text-white/65">{inv.song ? `${inv.song.title} — ${inv.song.artist}` : "Join to listen together, in step"}</div>
            </div>
          </div>
          <div className="flex gap-2 px-3 pb-3">
            <button
              type="button"
              data-phone-together-join
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await ask("join", inv.party_id);
                  await phoneListen.playHere(true);
                  onOpenMusic();
                } finally {
                  setBusy(false);
                }
              }}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full bg-sky-500 py-2.5 text-[14px] font-bold"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Join
            </button>
            <button type="button" onClick={() => (setHidden(inv.party_id), void ask("decline", inv.party_id))} className="flex-1 rounded-full bg-white/10 py-2.5 text-[14px] font-semibold">
              Not now
            </button>
          </div>
        </div>
      )}
      {!inv && offer && (
        <div data-phone-together-offer className={card}>
          <div className="flex items-center gap-3 p-3">
            <Headphones className="h-5 w-5 shrink-0 text-sky-300" />
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-semibold">Your PC is listening together</div>
              <div className="truncate text-[12.5px] text-white/65">{offer.role === "host" ? "Your music" : `${offer.host_name}'s music`} · {offer.people} listening</div>
            </div>
            <button type="button" aria-label="Not now" onClick={() => setHidden(offer.id)} className="flex h-8 w-8 items-center justify-center rounded-full text-white/60">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="px-3 pb-3">
            <button type="button" data-phone-together-here onClick={() => void phoneListen.playHere(true).then(onOpenMusic)} className="w-full rounded-full bg-sky-500 py-2.5 text-[14px] font-bold">
              Play on this phone too
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** In the phone's Music: playing along with the PC — how close, the Bluetooth slider, stop. */
export function PhoneListenLine() {
  const v = usePhoneListen();
  const [open, setOpen] = useState(false);
  const [delay, setDelay] = useState(listenTogether.delay());
  if (!v.here && !v.problem) return null;
  if (!v.here)
    return <div className="px-3 py-1.5 text-[12px] text-amber-300">{v.problem}</div>;
  const st = stepText(v.errMs, v.loading);
  return (
    <div data-phone-together-line className="border-t border-white/10 bg-sky-500/15 px-3 py-2 text-white">
      <div className="flex items-center gap-2 text-[12.5px]">
        <Headphones className="h-4 w-4 shrink-0 text-sky-300" />
        <span className="min-w-0 flex-1 truncate">{v.pc ? (v.pc.role === "host" ? "Your music, with your PC" : `With ${v.pc.host_name}, through your PC`) : "Listening together"}</span>
        <span className={st.good ? "text-emerald-300" : "text-white/60"}>{st.text}</span>
      </div>
      <div className="mt-1.5 flex gap-2">
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex-1 rounded-full bg-white/10 py-1.5 text-[12.5px] font-semibold">
          Sounds late?
        </button>
        <button type="button" data-phone-together-stop onClick={() => void phoneListen.playHere(false)} className="flex-1 rounded-full bg-white/10 py-1.5 text-[12.5px] font-semibold">
          Stop on this phone
        </button>
      </div>
      {open && (
        <div className="mt-2">
          <div className="flex justify-between text-[12px]">
            <span>Bluetooth earphones or speaker</span>
            <span className="tabular-nums text-white/60">{delay === 0 ? "no" : `${delay > 0 ? "+" : ""}${delay} ms`}</span>
          </div>
          <input
            type="range"
            min={-100}
            max={400}
            step={10}
            value={delay}
            onChange={(e) => {
              const n = Number(e.target.value);
              setDelay(n);
              void listenTogether.setDelay(n);
            }}
            className="mt-1 w-full accent-sky-400"
          />
          <div className="text-[11px] text-white/50">Slide until it sounds like one room (Bluetooth is usually 150–250 ms late).</div>
        </div>
      )}
    </div>
  );
}
