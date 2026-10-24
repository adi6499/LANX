import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Copy, Heart, Loader2, MessageCircle, RefreshCw, Search, Send, Sparkles, X } from "lucide-react";
import { api, errorText } from "../../lib/api";
import {
  type Caption,
  type MemeItem,
  type MemePrefs,
  DEFAULT_MEME_PREFS,
  FRESH_FEEDS,
  captionTemplate,
  isTemplate,
  loadFavourites,
  loadFresh,
  searchFresh,
  loadMemePrefs,
  loadRecent,
  loadTemplates,
  materialize,
  mineItem,
  rememberRecent,
  saveMeme,
  saveMemePrefs,
  tenorCategories,
  tenorSearch,
  toggleFavourite,
} from "../../lib/memes";

type Tab = "fresh" | "templates" | "gifs" | "favs" | "recent";
type Act = "send" | "copy" | "wa";

/** LANX 2.6.0: the hidden meme & GIF picker. Opened by typing `/meme` (or
 *  `/gif`) in a chat; nothing in the menus. */
export function MemePanel({
  initialQuery,
  chatName,
  onClose,
  onError,
  onSendToChat,
}: {
  initialQuery?: string;
  /** The chat the picker was opened from (where "Send" goes). */
  chatName?: string | null;
  onClose: () => void;
  onError: (t: string) => void;
  onSendToChat: (path: string) => Promise<void> | void;
}) {
  const [tab, setTab] = useState<Tab>("fresh");
  const [feed, setFeed] = useState(FRESH_FEEDS[0].id);
  const [freshItems, setFreshItems] = useState<MemeItem[]>([]);
  const [query, setQuery] = useState(initialQuery ?? "");
  const [templates, setTemplates] = useState<MemeItem[]>([]);
  const [gifs, setGifs] = useState<MemeItem[]>([]);
  const [favs, setFavs] = useState<MemeItem[]>([]);
  const [recent, setRecent] = useState<MemeItem[]>([]);
  const [cats, setCats] = useState<string[]>([]);
  const [prefs, setPrefs] = useState<MemePrefs>(DEFAULT_MEME_PREFS);
  const [keyDraft, setKeyDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // The caption editor.
  const [editing, setEditing] = useState<MemeItem | null>(null);
  const [caption, setCaption] = useState<Caption>({ top: "", bottom: "", size: 1 });
  const [made, setMade] = useState<{ bytes: Uint8Array; previewUrl: string } | null>(null);
  const makeTimer = useRef<number | null>(null);

  useEffect(() => {
    loadMemePrefs().then((p) => {
      setPrefs(p);
      setKeyDraft(p.tenorKey);
      if (initialQuery && p.tenorKey) setTab("gifs");
    });
    loadFavourites().then(setFavs);
    loadRecent().then(setRecent);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fresh: a batch from the chosen feed (and "More" adds another); with words
  // in the search box, a real search across every feed (hundreds of memes).
  const merge = (replace: boolean, batch: MemeItem[]) =>
    setFreshItems((old) => {
      const base = replace ? [] : old;
      const seen = new Set(base.map((m) => m.id));
      return [...base, ...batch.filter((m) => !seen.has(m.id))];
    });
  const loadMore = (replace: boolean) => {
    setLoading(true);
    setProblem(null);
    const q = query.trim();
    (q ? searchFresh(q, replace ? 2 : 1) : loadFresh(feed))
      .then((batch) => merge(replace, batch))
      .catch((e) => setProblem(`Fresh memes could not be loaded (is the internet on?): ${errorText(e)}`))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    if (tab !== "fresh") return;
    const t = window.setTimeout(() => loadMore(true), query.trim() ? 450 : 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, feed, query]);

  // Templates: the classic pictures (cached for a week).
  useEffect(() => {
    if (tab !== "templates" || templates.length) return;
    setLoading(true);
    setProblem(null);
    loadTemplates()
      .then(setTemplates)
      .catch((e) => setProblem(`The templates could not be loaded (is the internet on?): ${errorText(e)}`))
      .finally(() => setLoading(false));
  }, [tab, templates.length]);

  // GIFs: Tenor search / trending, a moment after typing stops.
  useEffect(() => {
    if (tab !== "gifs" || !prefs.tenorKey) return;
    const t = window.setTimeout(() => {
      setLoading(true);
      setProblem(null);
      tenorSearch(prefs.tenorKey, query)
        .then(setGifs)
        .catch((e) => setProblem(errorText(e)))
        .finally(() => setLoading(false));
    }, 350);
    return () => window.clearTimeout(t);
  }, [tab, query, prefs.tenorKey]);
  useEffect(() => {
    if (tab === "gifs" && prefs.tenorKey && !cats.length) tenorCategories(prefs.tenorKey).then(setCats);
  }, [tab, prefs.tenorKey, cats.length]);

  // The caption preview, a moment after typing stops.
  useEffect(() => {
    if (!editing) return;
    if (makeTimer.current) window.clearTimeout(makeTimer.current);
    makeTimer.current = window.setTimeout(() => {
      captionTemplate(editing.full, caption)
        .then((m) => setMade((old) => {
          if (old) URL.revokeObjectURL(old.previewUrl);
          return m;
        }))
        .catch((e) => onError(errorText(e)));
    }, 300);
    return () => {
      if (makeTimer.current) window.clearTimeout(makeTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, caption]);

  const saveKey = async () => {
    const next = { ...prefs, tenorKey: keyDraft.trim() };
    setPrefs(next);
    try {
      await saveMemePrefs(next);
      setGifs([]);
      setCats([]);
      onError(next.tenorKey ? "GIF key saved. Search away." : "GIF key removed.");
    } catch (e) {
      onError(errorText(e));
    }
  };

  /** The item (or the captioned picture) as a file, then the action. */
  const act = useCallback(
    async (kind: Act, item: MemeItem, bytes?: Uint8Array) => {
      setBusy(`${kind}:${item.id}`);
      try {
        const path = bytes ? await saveMeme(bytes, "png", item.title) : await materialize(item);
        if (kind === "send") {
          await onSendToChat(path);
          onError(chatName ? `Sent to ${chatName}.` : "Choose who gets it.");
        } else if (kind === "copy") {
          await api.copyFileToClipboard(path);
          onError("Copied. Paste it with Ctrl + V — in WhatsApp, Outlook, Word…");
        } else {
          await api.shareWhatsApp({ file: path });
          onError("WhatsApp is opening. Pick the chat there and paste with Ctrl + V.");
        }
        void rememberRecent(item).then(() => loadRecent().then(setRecent));
      } catch (e) {
        onError(errorText(e));
      } finally {
        setBusy(null);
      }
    },
    [chatName, onError, onSendToChat],
  );

  const fav = async (item: MemeItem) => {
    try {
      setFavs(await toggleFavourite(item));
    } catch (e) {
      onError(errorText(e));
    }
  };
  const isFav = (item: MemeItem) => favs.some((f) => f.id === item.id);

  const shown: MemeItem[] =
    tab === "fresh"
      ? freshItems
      : tab === "templates"
      ? templates.filter((t) => !query.trim() || t.title.toLowerCase().includes(query.trim().toLowerCase()))
      : tab === "gifs"
        ? gifs
        : tab === "favs"
          ? favs.filter((t) => !query.trim() || t.title.toLowerCase().includes(query.trim().toLowerCase()))
          : recent.filter((t) => !query.trim() || t.title.toLowerCase().includes(query.trim().toLowerCase()));

  const tabBtn = (id: Tab, label: string) => (
    <button
      type="button"
      data-meme-tab={id}
      onClick={() => {
        setTab(id);
        setEditing(null);
      }}
      className={`px-3 py-1.5 rounded-full text-[12.5px] font-semibold ${tab === id ? "bg-sky-500 text-white" : "lanx-group text-slate-600 dark:text-slate-300"}`}
    >
      {label}
    </button>
  );

  const actionBtn = (kind: Act, item: MemeItem, Icon: typeof Send, title: string, bytes?: Uint8Array) => (
    <button
      type="button"
      data-meme-action={kind}
      title={title}
      disabled={!!busy}
      onClick={(e) => {
        e.stopPropagation();
        void act(kind, item, bytes);
      }}
      className="h-7 w-7 rounded-full bg-white/90 text-slate-800 hover:bg-white flex items-center justify-center disabled:opacity-50"
    >
      {busy === `${kind}:${item.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
    </button>
  );

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 backdrop-blur-sm lanx-fade" onMouseDown={onClose}>
      <div data-meme-panel className="w-[900px] max-w-[96vw] h-[640px] max-h-[92vh] flex flex-col rounded-[22px] lanx-sheet p-4 lanx-rise" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          {editing ? (
            <button type="button" data-meme-back onClick={() => { setEditing(null); setMade(null); }} className="lanx-tool p-1.5 text-slate-500"><ArrowLeft className="h-4 w-4" /></button>
          ) : (
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-500 text-white"><Sparkles className="h-4 w-4" /></span>
          )}
          <h3 className="text-[15px] font-bold text-slate-900 dark:text-white">{editing ? `Caption: ${editing.title}` : "Memes & GIFs"}</h3>
          {!editing && <span className="text-[11px] text-slate-400">hidden tool · type /meme in any chat</span>}
          <div className="ml-auto flex items-center gap-1.5">
            {!editing && tabBtn("fresh", "Fresh")}
            {!editing && tabBtn("templates", `Templates${templates.length ? ` · ${templates.length}` : ""}`)}
            {!editing && tabBtn("gifs", "GIFs")}
            {!editing && tabBtn("favs", `Favourites${favs.length ? ` · ${favs.length}` : ""}`)}
            {!editing && tabBtn("recent", "Recent")}
            <button type="button" onClick={onClose} className="lanx-tool p-1 text-slate-400 ml-1"><X className="h-4 w-4" /></button>
          </div>
        </div>

        {editing ? (
          <div className="mt-3 flex-1 min-h-0 grid grid-cols-[1fr_280px] gap-4">
            <div className="min-h-0 flex items-center justify-center rounded-xl lanx-group overflow-hidden">
              {made ? <img data-meme-preview src={made.previewUrl} alt="" className="max-w-full max-h-full object-contain" /> : <Loader2 className="h-5 w-5 animate-spin text-slate-400" />}
            </div>
            <div className="flex flex-col gap-3 text-[12.5px]">
              <label className="font-semibold text-slate-500 text-[11.5px]">
                Top text
                <input data-meme-caption-top value={caption.top} onChange={(e) => setCaption({ ...caption, top: e.target.value })} placeholder="WHEN THE CLIENT SAYS…" className="lanx-field mt-1 w-full rounded-[10px] px-3 py-1.5 text-[12.5px] font-normal text-slate-900 dark:text-white" />
              </label>
              <label className="font-semibold text-slate-500 text-[11.5px]">
                Bottom text
                <input data-meme-caption-bottom value={caption.bottom} onChange={(e) => setCaption({ ...caption, bottom: e.target.value })} placeholder="…AND THEN THE DEADLINE" className="lanx-field mt-1 w-full rounded-[10px] px-3 py-1.5 text-[12.5px] font-normal text-slate-900 dark:text-white" />
              </label>
              <label className="font-semibold text-slate-500 text-[11.5px]">
                Text size
                <input type="range" min={0.6} max={1.6} step={0.1} value={caption.size} onChange={(e) => setCaption({ ...caption, size: Number(e.target.value) })} className="mt-1 w-full" />
              </label>
              <div className="mt-auto flex flex-col gap-2">
                <button type="button" data-meme-make="send" disabled={!made || !!busy} onClick={() => made && act("send", mineItem(made.previewUrl, `${editing.title} ${caption.top}`.trim()), made.bytes)} className="px-4 py-2 rounded-full bg-sky-500 hover:bg-sky-600 disabled:opacity-40 text-white font-semibold inline-flex items-center justify-center gap-1.5"><Send className="h-3.5 w-3.5" /> {chatName ? `Send to ${chatName}` : "Send to…"}</button>
                <button type="button" data-meme-make="copy" disabled={!made || !!busy} onClick={() => made && act("copy", mineItem(made.previewUrl, `${editing.title} ${caption.top}`.trim()), made.bytes)} className="px-4 py-2 rounded-full lanx-group text-slate-700 dark:text-slate-200 font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-40"><Copy className="h-3.5 w-3.5" /> Copy (paste anywhere)</button>
                <button type="button" data-meme-make="wa" disabled={!made || !!busy} onClick={() => made && act("wa", mineItem(made.previewUrl, `${editing.title} ${caption.top}`.trim()), made.bytes)} className="px-4 py-2 rounded-full bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 text-white font-semibold inline-flex items-center justify-center gap-1.5"><MessageCircle className="h-3.5 w-3.5" /> Share on WhatsApp</button>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="mt-3 flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <input
                  data-meme-search
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={tab === "gifs" ? "Search GIFs (e.g. monday, deadline, thank you)…" : tab === "templates" ? "Search templates (e.g. drake, distracted, cat)…" : tab === "fresh" ? "Search fresh memes (e.g. monday, boss, work from home)…" : "Search…"}
                  className="lanx-field w-full rounded-[12px] pl-9 pr-3 py-2 text-[13px] text-slate-900 dark:text-white"
                />
              </div>
              {tab === "templates" && (
                <button type="button" title="Refresh the template list" onClick={() => { setTemplates([]); loadTemplates(true).then(setTemplates).catch((e) => onError(errorText(e))); }} className="lanx-tool p-2 text-slate-500"><RefreshCw className="h-4 w-4" /></button>
              )}
            </div>
            {tab === "fresh" && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {FRESH_FEEDS.map((f) => (
                  <button key={f.id} type="button" data-meme-feed={f.id} onClick={() => setFeed(f.id)} className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${feed === f.id ? "bg-sky-500 text-white" : "lanx-group text-slate-600 dark:text-slate-300"}`}>{f.name}</button>
                ))}
                <span className="ml-auto text-[11px] text-slate-400">{freshItems.length ? `${freshItems.length} memes` : ""}</span>
                <button type="button" data-meme-more disabled={loading} onClick={() => loadMore(false)} className="px-2.5 py-1 rounded-full lanx-group text-[11px] font-semibold text-slate-600 dark:text-slate-300 disabled:opacity-50 inline-flex items-center gap-1"><RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} /> More memes</button>
              </div>
            )}
            {tab === "gifs" && !prefs.tenorKey && (
              <div data-meme-key-box className="mt-3 rounded-xl lanx-group p-4 text-[12.5px] text-slate-600 dark:text-slate-300">
                <b>Only GIFs need a key — Fresh memes and the templates work without one.</b><br />
                <b>GIFs need a free Tenor key (one time, about five minutes).</b>
                <ol className="mt-1.5 list-decimal pl-5 space-y-0.5 text-[12px]">
                  <li>Open console.cloud.google.com and sign in with a Google account.</li>
                  <li>Create a project (any name), then search for <b>Tenor API</b> and press Enable.</li>
                  <li>Go to Credentials → Create credentials → <b>API key</b>, and copy the key here.</li>
                </ol>
                <div className="mt-2 flex items-center gap-2">
                  <input data-meme-key value={keyDraft} onChange={(e) => setKeyDraft(e.target.value)} placeholder="Paste the key (starts with AIza…)" className="lanx-field flex-1 rounded-[10px] px-3 py-1.5 text-[12.5px] text-slate-900 dark:text-white" />
                  <button type="button" data-meme-key-save onClick={saveKey} className="px-3 py-1.5 rounded-full bg-sky-500 hover:bg-sky-600 text-white text-[12px] font-semibold">Save</button>
                </div>
                <p className="mt-2 text-[11px] text-slate-400">Searches go to Google's Tenor service with the strictest content filter. Templates, favourites and recent memes work without the key.</p>
              </div>
            )}
            {tab === "gifs" && prefs.tenorKey && cats.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {cats.map((c) => (
                  <button key={c} type="button" onClick={() => setQuery(c)} className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${query === c ? "bg-sky-500 text-white" : "lanx-group text-slate-600 dark:text-slate-300"}`}>{c}</button>
                ))}
              </div>
            )}
            <div className="mt-3 flex-1 min-h-0 overflow-y-auto">
              {problem && <p className="text-[12.5px] text-amber-600 px-1">{problem}</p>}
              {loading && !shown.length && <div className="flex items-center justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>}
              {!loading && !shown.length && !problem && tab !== "gifs" && (
                <p className="px-1 py-10 text-center text-[12.5px] text-slate-400">
                  {tab === "favs" ? "No favourites yet — press the heart on any meme." : tab === "recent" ? "Nothing sent, copied or shared yet." : tab === "fresh" ? (query.trim() ? "No fresh meme matches those words right now — try other words or press More memes (each round brings new ones)." : "No memes in this feed right now — try another feed or More memes.") : "No template matches that."}
                </p>
              )}
              <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}>
                {shown.map((item) => (
                  <div
                    key={item.id}
                    data-meme-item={item.id}
                    title={isTemplate(item) ? `${item.title} — click to add your own text` : item.title}
                    onClick={() => {
                      if (isTemplate(item)) {
                        setEditing(item);
                        setMade(null);
                        setCaption({ top: "", bottom: "", size: 1 });
                      }
                    }}
                    className={`group relative aspect-square rounded-xl overflow-hidden lanx-group ${isTemplate(item) ? "cursor-pointer" : ""}`}
                  >
                    <img src={item.preview} alt={item.title} loading="lazy" className="h-full w-full object-cover" />
                    <div className="absolute inset-x-0 bottom-0 p-1.5 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition flex items-center gap-1">
                      {actionBtn("send", item, Send, chatName ? `Send to ${chatName}` : "Send to…")}
                      {actionBtn("copy", item, Copy, "Copy — paste anywhere")}
                      {actionBtn("wa", item, MessageCircle, "Share on WhatsApp")}
                      <button type="button" data-meme-fav title={isFav(item) ? "Remove from favourites" : "Add to favourites"} onClick={(e) => { e.stopPropagation(); void fav(item); }} className={`ml-auto h-7 w-7 rounded-full flex items-center justify-center ${isFav(item) ? "bg-rose-500 text-white" : "bg-white/90 text-slate-800 hover:bg-white"}`}>
                        <Heart className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {item.kind === "gif" && <span className="absolute left-1.5 top-1.5 rounded bg-black/60 px-1 text-[9px] font-bold text-white">GIF</span>}
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-2 flex items-center justify-between text-[10.5px] text-slate-400">
              <span>{tab === "templates" ? "Templates: Imgflip and memegen.link · captions drawn by LANX" : tab === "fresh" ? "Fresh memes: Reddit, through meme-api.com · adult or spoiler posts are left out" : tab === "gifs" ? (prefs.tenorKey ? "Powered by Tenor" : "") : ""}</span>
              {tab === "gifs" && prefs.tenorKey && (
                <button type="button" onClick={() => { setPrefs({ ...prefs, tenorKey: "" }); void saveMemePrefs({ ...prefs, tenorKey: "" }); }} className="underline">change key</button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
