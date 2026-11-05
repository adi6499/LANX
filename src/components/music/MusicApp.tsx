import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronRight,
  Clock,
  Disc3,
  Flame,
  Heart,
  Home,
  ListMusic,
  ListPlus,
  Loader2,
  Maximize2,
  MessageCircle,
  Mic2,
  Minimize2,
  Music2,
  Pause,
  Play,
  Plus,
  Repeat,
  Repeat1,
  Search,
  Send,
  Shuffle,
  SkipBack,
  SkipForward,
  Square,
  Trash2,
  Users,
  Volume2,
  X,
} from "lucide-react";
import { api, errorText } from "../../lib/api";
import {
  type ArtistPage,
  type Collection,
  type Home as HomeData,
  type Played,
  type PlayerState,
  type Playlist,
  type Song,
  LANGUAGES,
  addToPlaylist,
  browseHome,
  createPlaylist,
  deletePlaylist,
  fmtAgo,
  fmtTime,
  getArtist,
  getCollectionSongs,
  loadFollowed,
  loadMusicFavourites,
  loadPlayed,
  loadPlaylists,
  loadSavedAlbums,
  player,
  popularArtists,
  removeFromPlaylist,
  searchAll,
  songCard,
  songText,
  toggleFollowed,
  toggleMusicFavourite,
  toggleSavedAlbum,
} from "../../lib/music";

type View =
  | { kind: "home" }
  | { kind: "search" }
  | { kind: "artist"; c: Collection }
  | { kind: "collection"; c: Collection }
  | { kind: "favs" }
  | { kind: "artists" }
  | { kind: "albums" }
  | { kind: "playlists" }
  | { kind: "playlist"; id: string }
  | { kind: "recent" }
  | { kind: "most" }
  | { kind: "queue" };

interface LyricLine {
  t: number;
  text: string;
}

/** Synced lyrics from lrclib.net (free, no key); [] when there are none. */
async function fetchLyrics(s: Song): Promise<LyricLine[]> {
  try {
    const q = new URLSearchParams({ track_name: s.title, artist_name: s.artist.split(",")[0].trim() });
    const res = await fetch(`https://lrclib.net/api/search?${q.toString()}`);
    if (!res.ok) return [];
    const list = (await res.json()) as { syncedLyrics?: string | null; plainLyrics?: string | null; duration?: number }[];
    const best = list.find((l) => l.syncedLyrics && Math.abs((l.duration ?? s.duration) - s.duration) < 12) ?? list.find((l) => l.syncedLyrics) ?? list.find((l) => l.plainLyrics);
    if (!best) return [];
    if (best.syncedLyrics) {
      return best.syncedLyrics
        .split("\n")
        .map((line) => {
          const m = /^\[(\d+):(\d+(?:\.\d+)?)\](.*)$/.exec(line.trim());
          return m ? { t: Number(m[1]) * 60 + Number(m[2]), text: m[3].trim() } : null;
        })
        .filter((l): l is LyricLine => !!l && l.text.length > 0);
    }
    return (best.plainLyrics ?? "").split("\n").filter(Boolean).map((text, i) => ({ t: i * 4, text }));
  } catch {
    return [];
  }
}

const card = "rounded-2xl bg-white/[0.06] hover:bg-white/[0.12] transition cursor-pointer";

// (Outside MusicApp: defined inside, every refresh would rebuild them and reload the covers.)
function Cover({ src, className = "" }: { src: string; className?: string }) {
  return (
    <div className={`overflow-hidden bg-white/10 flex items-center justify-center ${className}`}>{src ? <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" /> : <Music2 className="h-1/3 w-1/3 text-white/40" />}</div>
  );
}

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="mt-6">
      <div className="flex items-center justify-between mb-2.5">
        <h3 className="text-[16px] font-bold text-white">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Hero({ image, kicker, title, subtitle, onPlay, extra }: { image: string; kicker: string; title: string; subtitle?: string; onPlay: () => void; extra?: React.ReactNode }) {
  return (
    <div className="relative h-60 rounded-3xl overflow-hidden">
      {image && <img src={image} alt="" className="absolute inset-0 h-full w-full object-cover" />}
      <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/40 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
      <div className="relative h-full flex flex-col justify-end p-6">
        <div className="text-[11px] font-semibold uppercase tracking-widest text-white/60">{kicker}</div>
        <h2 className="mt-1 text-[32px] leading-tight font-extrabold text-white drop-shadow">{title}</h2>
        {subtitle && <div className="text-[13px] text-white/70">{subtitle}</div>}
        <div className="mt-3 flex items-center gap-2">
          <button type="button" data-music-hero-play onClick={onPlay} className="px-6 py-2 rounded-full bg-sky-500 hover:bg-sky-400 text-white text-[13px] font-bold inline-flex items-center gap-1.5"><Play className="h-4 w-4" /> Play</button>
          {extra}
        </div>
      </div>
    </div>
  );
}

/** LANX 2.7.0: the music app — opened with /music (or the wrench menu). Browse what's
 *  trending, search songs / singers / films / albums / playlists, open an artist or album,
 *  keep favourites, playlists and a queue, and a full-screen "Now playing" with the
 *  covers fanned out, the lyrics and a floating player. */
export function MusicApp({
  initialQuery,
  chatName,
  onClose,
  onError,
  onSendCard,
  compact = false,
}: {
  initialQuery?: string;
  chatName?: string | null;
  onClose: () => void;
  onError: (t: string) => void;
  onSendCard: (card: Record<string, unknown>, preview: string) => Promise<void> | void;
  /** LANX 3.4.1 (the phone page): a phone layout — top bar with search and
   *  library chips, a slim player bar, a simple Now playing. */
  compact?: boolean;
}) {
  const [view, setView] = useState<View>({ kind: "home" });
  const [stack, setStack] = useState<View[]>([]);
  const [query, setQuery] = useState(initialQuery ?? "");
  const [langs, setLangs] = useState<string[]>(["hindi", "english", "marathi"]);
  const [home, setHome] = useState<HomeData | null>(null);
  const [popular, setPopular] = useState<Collection[]>([]);
  const [found, setFound] = useState<Awaited<ReturnType<typeof searchAll>> | null>(null);
  const [artist, setArtist] = useState<ArtistPage | null>(null);
  const [colSongs, setColSongs] = useState<{ collection: Collection; songs: Song[] } | null>(null);
  const [favs, setFavs] = useState<Song[]>([]);
  const [played, setPlayed] = useState<Played[]>([]);
  const [followed, setFollowed] = useState<Collection[]>([]);
  const [savedAlbums, setSavedAlbums] = useState<Collection[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [ps, setPs] = useState<PlayerState>(player.state());
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [addMenu, setAddMenu] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [nowPlaying, setNowPlaying] = useState(false);
  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const [showLyrics, setShowLyrics] = useState(false);
  const lyricsFor = useRef<string>("");

  const go = useCallback((v: View) => {
    setStack((s) => [...s, view].slice(-20));
    setView(v);
    setProblem(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);
  const back = () => {
    const prev = stack[stack.length - 1];
    if (!prev) return;
    setStack((s) => s.slice(0, -1));
    setView(prev);
  };
  const refreshLocal = useCallback(() => {
    loadMusicFavourites().then(setFavs);
    loadPlayed().then(setPlayed);
    loadFollowed().then(setFollowed);
    loadSavedAlbums().then(setSavedAlbums);
    loadPlaylists().then(setPlaylists);
  }, []);

  useEffect(() => {
    refreshLocal();
    const un = player.subscribe((s) => {
      setPs(s);
      if (s.song && lyricsFor.current !== s.song.id) {
        lyricsFor.current = s.song.id;
        setLyrics([]);
        void fetchLyrics(s.song).then((l) => {
          if (lyricsFor.current === s.song?.id) setLyrics(l);
        });
      }
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        if (nowPlaying) setNowPlaying(false);
        else onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      un();
      window.removeEventListener("keydown", onKey, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nowPlaying]);

  // Home: what's trending for the chosen languages; and the well-known singers.
  useEffect(() => {
    setLoading(true);
    setProblem(null);
    browseHome(langs)
      .then(setHome)
      .catch((e) => setProblem(`Could not load what's trending (is the internet on?): ${errorText(e)}`))
      .finally(() => setLoading(false));
    popularArtists(langs).then(setPopular).catch(() => {});
  }, [langs]);

  // Search, a moment after typing stops.
  useEffect(() => {
    if (!query.trim()) {
      setFound(null);
      if (view.kind === "search") setView({ kind: "home" });
      return;
    }
    const t = window.setTimeout(() => {
      setLoading(true);
      setProblem(null);
      if (view.kind !== "search") go({ kind: "search" });
      searchAll(query)
        .then(setFound)
        .catch((e) => setProblem(`Search failed (is the internet on?): ${errorText(e)}`))
        .finally(() => setLoading(false));
    }, 350);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const openArtist = (c: Collection) => {
    go({ kind: "artist", c });
    setArtist(null);
    setLoading(true);
    getArtist(c.id)
      .then(setArtist)
      .catch((e) => setProblem(errorText(e)))
      .finally(() => setLoading(false));
  };
  const openCollection = (c: Collection) => {
    if (c.type === "artist") return openArtist(c);
    go({ kind: "collection", c });
    setColSongs(null);
    setLoading(true);
    getCollectionSongs(c)
      .then(setColSongs)
      .catch((e) => setProblem(errorText(e)))
      .finally(() => setLoading(false));
  };

  const isFav = (s: Song) => favs.some((f) => f.id === s.id);
  const fav = async (s: Song) => setFavs(await toggleMusicFavourite(s).catch(() => favs));
  const send = async (s: Song) => {
    setBusy(`send:${s.id}`);
    try {
      await onSendCard(songCard(s), `🎵 ${s.title} — ${s.artist}`);
      onError(chatName ? `Sent to ${chatName}.` : "Choose who gets it.");
    } catch (e) {
      onError(errorText(e));
    } finally {
      setBusy(null);
    }
  };
  const whatsapp = async (s: Song) => {
    setBusy(`wa:${s.id}`);
    try {
      await api.shareWhatsApp({ text: songText(s) });
    } catch (e) {
      onError(errorText(e));
    } finally {
      setBusy(null);
    }
  };
  const mostListened = useMemo(() => [...played].sort((a, b) => b.count - a.count).slice(0, 50).map((p) => p.song), [played]);
  const recent = useMemo(() => played.map((p) => p.song), [played]);

  // ---------------------------------------------------------------- pieces


  // Called as functions, not <Components>: the rows stay the same elements between refreshes.
  const songList = ({ songs, numbered = true, showAlbum = true, onRemove }: { songs: Song[]; numbered?: boolean; showAlbum?: boolean; onRemove?: (s: Song) => void }) => (
    <div className="space-y-0.5">
      {songs.map((s, i) => {
        const current = ps.song?.id === s.id;
        return (
          <div key={`${s.id}-${i}`} data-music-item={s.id} className={`group grid grid-cols-[32px_44px_1fr_auto] items-center gap-3 rounded-xl px-2 py-1.5 ${current ? "bg-white/15" : "hover:bg-white/[0.07]"}`}>
            <button type="button" data-music-play onClick={() => (current ? player.toggle() : void player.play(s, songs))} className="h-8 w-8 flex items-center justify-center text-white/60 hover:text-white">
              {current && ps.playing ? <Pause className="h-4 w-4 text-sky-300" /> : current ? <Play className="h-4 w-4 text-sky-300" /> : numbered ? <span className="text-[12px] tabular-nums group-hover:hidden">{i + 1}</span> : <Play className="h-4 w-4" />}
              {!current && numbered && <Play className="h-4 w-4 hidden group-hover:block" />}
            </button>
            <Cover src={s.cover} className="h-11 w-11 rounded-lg" />
            <div className="min-w-0">
              <div className={`truncate text-[13px] font-semibold ${current ? "text-sky-200" : "text-white"}`}>{s.title}</div>
              <div className="truncate text-[11.5px] text-white/60">
                {s.artistIds.length ? <button type="button" onClick={() => openArtist({ id: s.artistIds[0], type: "artist", title: s.artist.split(",")[0], subtitle: "", image: "", language: s.language, url: "", year: "", songCount: 0 })} className="hover:underline">{s.artist}</button> : s.artist}
                {showAlbum && s.album ? ` · ${s.album}` : ""}
              </div>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[11px] text-white/50 tabular-nums mr-2">{fmtTime(s.duration)}</span>
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition">
                <button type="button" data-music-action="queue" title="Play next" onClick={() => { player.enqueue(s); onError("Added to the queue."); }} className="h-7 w-7 rounded-full hover:bg-white/15 flex items-center justify-center text-white/80"><ListPlus className="h-4 w-4" /></button>
                <button type="button" data-music-action="send" title={chatName ? `Send to ${chatName}` : "Send to…"} disabled={!!busy} onClick={() => void send(s)} className="h-7 w-7 rounded-full hover:bg-white/15 flex items-center justify-center text-white/80">{busy === `send:${s.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}</button>
                <button type="button" data-music-action="wa" title="Share on WhatsApp" disabled={!!busy} onClick={() => void whatsapp(s)} className="h-7 w-7 rounded-full hover:bg-white/15 flex items-center justify-center text-white/80"><MessageCircle className="h-4 w-4" /></button>
                <div className="relative">
                  <button type="button" title="Add to a playlist" onClick={() => setAddMenu(addMenu === s.id ? null : s.id)} className="h-7 w-7 rounded-full hover:bg-white/15 flex items-center justify-center text-white/80"><Plus className="h-4 w-4" /></button>
                  {addMenu === s.id && (
                    <div className="absolute right-0 top-8 z-20 w-52 rounded-xl bg-slate-900/95 border border-white/10 p-1.5 shadow-2xl" onMouseLeave={() => setAddMenu(null)}>
                      {playlists.map((p) => (
                        <button key={p.id} type="button" onClick={async () => { setPlaylists(await addToPlaylist(p.id, s)); setAddMenu(null); onError(`Added to ${p.name}.`); }} className="w-full text-left px-2.5 py-1.5 rounded-lg text-[12px] text-white/90 hover:bg-white/10 truncate">{p.name}</button>
                      ))}
                      <button type="button" onClick={async () => { setPlaylists(await createPlaylist("My playlist", [s])); setAddMenu(null); onError("New playlist made."); }} className="w-full text-left px-2.5 py-1.5 rounded-lg text-[12px] text-sky-300 hover:bg-white/10">+ New playlist with this song</button>
                    </div>
                  )}
                </div>
                {onRemove && <button type="button" title="Remove" onClick={() => onRemove(s)} className="h-7 w-7 rounded-full hover:bg-white/15 flex items-center justify-center text-white/60"><X className="h-3.5 w-3.5" /></button>}
              </div>
              <button type="button" data-music-fav title={isFav(s) ? "Remove from favourites" : "Add to favourites"} onClick={() => void fav(s)} className={`h-7 w-7 rounded-full flex items-center justify-center ${isFav(s) ? "text-rose-400" : "text-white/40 hover:text-white"}`}><Heart className="h-4 w-4" fill={isFav(s) ? "currentColor" : "none"} /></button>
            </div>
          </div>
        );
      })}
    </div>
  );

  const grid = ({ items, round = false }: { items: Collection[]; round?: boolean }) => (
    <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}>
      {items.map((c) => (
        <button key={`${c.type}-${c.id}`} type="button" data-music-collection={c.id} data-music-type={c.type} onClick={() => openCollection(c)} className={`${card} p-2.5 text-left`}>
          <Cover src={c.image} className={`aspect-square w-full ${round ? "rounded-full" : "rounded-xl"}`} />
          <div className="mt-2 truncate text-[12.5px] font-semibold text-white">{c.title}</div>
          <div className="truncate text-[11px] text-white/55">{c.subtitle || (c.type === "artist" ? "Artist" : c.year || c.type)}</div>
        </button>
      ))}
    </div>
  );



  // ---------------------------------------------------------------- views

  let main: React.ReactNode = null;
  let title = "";
  if (view.kind === "home") {
    title = "Discover";
    const heroCol = home?.trending[0] ?? home?.charts[0] ?? null;
    main = (
      <>
        <div className="flex flex-wrap gap-1.5 mb-4">
          {LANGUAGES.map((l) => {
            const on = langs.includes(l.id);
            return (
              <button key={l.id} type="button" onClick={() => setLangs(on ? (langs.length > 1 ? langs.filter((x) => x !== l.id) : langs) : [...langs, l.id])} className={`px-3 py-1 rounded-full text-[11.5px] font-semibold ${on ? "bg-white text-slate-900" : "bg-white/10 text-white/80 hover:bg-white/20"}`}>{l.name}</button>
            );
          })}
        </div>
        {heroCol && <Hero image={heroCol.image} kicker="Trending now" title={heroCol.title} subtitle={heroCol.subtitle || heroCol.language} onPlay={() => void getCollectionSongs(heroCol).then((r) => player.playAll(r.songs)).catch((e) => onError(errorText(e)))} extra={<button type="button" onClick={() => openCollection(heroCol)} className="px-5 py-2 rounded-full border border-white/40 text-white text-[13px] font-semibold hover:bg-white/10">Open</button>} />}
        {home && home.trending.length > 1 && <Section title="Trending now">{grid({ items: home.trending.slice(1, 13) })}</Section>}
        {home && home.charts.length > 0 && <Section title="Charts">{grid({ items: home.charts.slice(0, 12) })}</Section>}
        {home && home.newSongs.length > 0 && <Section title="New songs">{songList({ songs: home.newSongs.slice(0, 15) })}</Section>}
        {home && home.newAlbums.length > 0 && <Section title="New albums">{grid({ items: home.newAlbums.slice(0, 12) })}</Section>}
      </>
    );
  } else if (view.kind === "search") {
    title = `Results for “${query.trim()}”`;
    main = found ? (
      <>
        {found.songs.length > 0 && <Section title="Songs">{songList({ songs: found.songs })}</Section>}
        {found.artists.length > 0 && <Section title="Artists">{grid({ items: found.artists, round: true })}</Section>}
        {found.albums.length > 0 && <Section title="Albums">{grid({ items: found.albums })}</Section>}
        {found.playlists.length > 0 && <Section title="Playlists">{grid({ items: found.playlists })}</Section>}
        {!found.songs.length && !found.artists.length && !found.albums.length && !found.playlists.length && <p className="py-10 text-center text-white/50 text-[13px]">Nothing found for that.</p>}
      </>
    ) : null;
  } else if (view.kind === "artist") {
    title = artist?.name ?? view.c.title;
    const following = followed.some((f) => f.id === view.c.id);
    main = artist ? (
      <>
        <Hero image={artist.image || view.c.image} kicker="Artist" title={artist.name} onPlay={() => void player.playAll(artist.topSongs)} extra={<button type="button" data-music-follow onClick={async () => setFollowed(await toggleFollowed({ ...view.c, title: artist.name, image: artist.image || view.c.image }))} className={`px-5 py-2 rounded-full border text-[13px] font-semibold ${following ? "bg-white text-slate-900 border-white" : "border-white/40 text-white hover:bg-white/10"}`}>{following ? "Following" : "Follow"}</button>} />
        <Section title="Top songs">{songList({ songs: artist.topSongs, showAlbum: true })}</Section>
        {artist.albums.length > 0 && <Section title="Albums">{grid({ items: artist.albums })}</Section>}
      </>
    ) : null;
  } else if (view.kind === "collection") {
    const c = colSongs?.collection ?? view.c;
    title = c.title;
    const saved = savedAlbums.some((a) => a.id === c.id);
    main = (
      <>
        <div className="flex items-end gap-5">
          <Cover src={c.image} className="h-44 w-44 rounded-2xl shadow-2xl shrink-0" />
          <div className="min-w-0 pb-1">
            <div className="text-[11px] font-semibold uppercase tracking-widest text-white/60">{c.type === "album" ? "Album" : "Playlist"}</div>
            <h2 className="mt-1 text-[30px] leading-tight font-extrabold text-white">{c.title}</h2>
            <div className="text-[13px] text-white/70">{[c.subtitle, c.year, colSongs ? `${colSongs.songs.length} songs` : c.songCount ? `${c.songCount} songs` : ""].filter(Boolean).join(" · ")}</div>
            <div className="mt-3 flex items-center gap-2">
              <button type="button" data-music-hero-play onClick={() => colSongs && void player.playAll(colSongs.songs)} className="px-6 py-2 rounded-full bg-sky-500 hover:bg-sky-400 text-white text-[13px] font-bold inline-flex items-center gap-1.5"><Play className="h-4 w-4" /> Play</button>
              <button type="button" onClick={() => colSongs && void player.playAll(colSongs.songs.slice().sort(() => Math.random() - 0.5))} className="px-5 py-2 rounded-full border border-white/40 text-white text-[13px] font-semibold hover:bg-white/10 inline-flex items-center gap-1.5"><Shuffle className="h-4 w-4" /> Shuffle</button>
              {c.type === "album" && <button type="button" data-music-save-album onClick={async () => setSavedAlbums(await toggleSavedAlbum(c))} className={`h-9 w-9 rounded-full flex items-center justify-center ${saved ? "bg-rose-500 text-white" : "border border-white/40 text-white hover:bg-white/10"}`} title={saved ? "Remove from your albums" : "Save to your albums"}><Heart className="h-4 w-4" fill={saved ? "currentColor" : "none"} /></button>}
            </div>
          </div>
        </div>
        <div className="mt-5">{colSongs && songList({ songs: colSongs.songs, showAlbum: c.type !== "album" })}</div>
      </>
    );
  } else if (view.kind === "favs") {
    title = "Songs";
    main = (
      <>
        {favs.length ? <Section title="Songs you love">{songList({ songs: favs })}</Section> : <p className="text-white/50 text-[13px]">Press the heart on any song and it lands here. Meanwhile, something new:</p>}
        {home && home.newSongs.length > 0 && <Section title="New songs">{songList({ songs: home.newSongs.slice(0, 20) })}</Section>}
        {home && home.charts.length > 0 && <Section title="Charts">{grid({ items: home.charts.slice(0, 12) })}</Section>}
      </>
    );
  } else if (view.kind === "artists") {
    title = "Artists";
    main = (
      <>
        {followed.length > 0 && <Section title="Artists you follow">{grid({ items: followed, round: true })}</Section>}
        <Section title={followed.length ? "Popular artists" : "Popular artists — open one and press Follow"}>
          {popular.length ? grid({ items: popular, round: true }) : <div className="flex items-center gap-2 text-white/50 text-[13px]"><Loader2 className="h-4 w-4 animate-spin" /> Looking up the well-known singers for your languages…</div>}
        </Section>
      </>
    );
  } else if (view.kind === "albums") {
    title = "Albums";
    main = (
      <>
        {savedAlbums.length > 0 && <Section title="Your albums">{grid({ items: savedAlbums })}</Section>}
        {home && home.newAlbums.length > 0 && <Section title="New albums">{grid({ items: home.newAlbums })}</Section>}
        {home && home.trending.length > 0 && <Section title="Trending">{grid({ items: home.trending })}</Section>}
        {!savedAlbums.length && <p className="mt-4 text-white/50 text-[12.5px]">Open an album and press the heart to keep it under Your albums.</p>}
      </>
    );
  } else if (view.kind === "playlists") {
    title = "Playlists";
    main = (
      <>
        <div className="flex items-center gap-2 mb-4">
          <input data-music-new-playlist value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New playlist name…" className="rounded-full bg-white/10 px-4 py-2 text-[13px] text-white placeholder:text-white/40 outline-none focus:bg-white/15 w-72" />
          <button type="button" onClick={async () => { setPlaylists(await createPlaylist(newName)); setNewName(""); }} className="px-4 py-2 rounded-full bg-sky-500 hover:bg-sky-400 text-white text-[12.5px] font-bold">Create</button>
        </div>
        {playlists.length ? (
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))" }}>
            {playlists.map((p) => (
              <button key={p.id} type="button" data-music-playlist={p.id} onClick={() => go({ kind: "playlist", id: p.id })} className={`${card} p-3 text-left`}>
                <div className="grid grid-cols-2 gap-0.5 rounded-xl overflow-hidden aspect-square">
                  {[0, 1, 2, 3].map((i) => <Cover key={i} src={p.songs[i]?.cover ?? ""} className="h-full w-full" />)}
                </div>
                <div className="mt-2 truncate text-[12.5px] font-semibold text-white">{p.name}</div>
                <div className="text-[11px] text-white/55">{p.songs.length} songs</div>
              </button>
            ))}
          </div>
        ) : (
          <p className="py-2 text-white/50 text-[13px]">Make a playlist, then use + on any song to add it.</p>
        )}
        {home && (home.playlists.length > 0 || home.charts.length > 0) && (
          <Section title="Playlists and charts from the service">{grid({ items: [...home.charts, ...home.playlists].filter((c, i, a) => a.findIndex((x) => x.id === c.id) === i).slice(0, 24) })}</Section>
        )}
      </>
    );
  } else if (view.kind === "playlist") {
    const p = playlists.find((x) => x.id === view.id);
    title = p?.name ?? "Playlist";
    main = p ? (
      <>
        <div className="flex items-center gap-2 mb-4">
          <button type="button" onClick={() => void player.playAll(p.songs)} disabled={!p.songs.length} className="px-6 py-2 rounded-full bg-sky-500 hover:bg-sky-400 disabled:opacity-40 text-white text-[13px] font-bold inline-flex items-center gap-1.5"><Play className="h-4 w-4" /> Play</button>
          <button type="button" onClick={async () => { setPlaylists(await deletePlaylist(p.id)); back(); }} className="px-4 py-2 rounded-full border border-white/30 text-white/80 text-[12.5px] font-semibold hover:bg-white/10 inline-flex items-center gap-1.5"><Trash2 className="h-4 w-4" /> Delete playlist</button>
        </div>
        {p.songs.length ? songList({ songs: p.songs, onRemove: async (s) => setPlaylists(await removeFromPlaylist(p.id, s.id)) }) : <p className="py-6 text-white/50 text-[13px]">Empty — use + on any song to add it here.</p>}
      </>
    ) : null;
  } else if (view.kind === "recent") {
    title = "Recently played";
    main = recent.length ? songList({ songs: recent }) : (
      <>
        <p className="text-white/50 text-[13px]">Nothing played yet. Start with what's new:</p>
        {home && home.newSongs.length > 0 && <Section title="New songs">{songList({ songs: home.newSongs.slice(0, 15) })}</Section>}
      </>
    );
  } else if (view.kind === "most") {
    title = "Most listened";
    main = mostListened.length ? songList({ songs: mostListened }) : (
      <>
        <p className="text-white/50 text-[13px]">Play a few songs and your favourites show up here by how often they played. Meanwhile, the charts:</p>
        {home && home.charts.length > 0 && <Section title="Charts">{grid({ items: home.charts.slice(0, 12) })}</Section>}
      </>
    );
  } else if (view.kind === "queue") {
    title = "Up next";
    main = ps.queue.length ? songList({ songs: ps.queue, onRemove: (s) => player.removeFromQueue(s.id) }) : (
      <>
        <p className="text-white/50 text-[13px]">The queue is empty — press the + next to a song, or play an album or a chart and it fills up.</p>
        {home && home.trending.length > 0 && <Section title="Trending now">{grid({ items: home.trending.slice(0, 12) })}</Section>}
      </>
    );
  }

  const nav = (kind: View["kind"], label: string, Icon: typeof Home, count?: number) => {
    const on = view.kind === kind;
    return (
      <button type="button" data-music-tab={kind} onClick={() => go({ kind } as View)} className={`w-full flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] font-semibold ${on ? "bg-white/15 text-white" : "text-white/70 hover:bg-white/10 hover:text-white"}`}>
        <Icon className="h-4 w-4" /> <span className="truncate">{label}</span>
        {count ? <span className="ml-auto text-[10.5px] text-white/50">{count}</span> : null}
      </button>
    );
  };

  const pct = ps.duration ? Math.min(100, (ps.position / ps.duration) * 100) : 0;
  const currentLine = useMemo(() => {
    let idx = -1;
    for (let i = 0; i < lyrics.length; i++) if (lyrics[i].t <= ps.position + 0.3) idx = i;
    return idx;
  }, [lyrics, ps.position]);
  // Only when the line changes (not four times a second, which made the lyrics jitter).
  const lyricEls = useRef<(HTMLDivElement | null)[]>([]);
  useEffect(() => {
    if (currentLine >= 0 && showLyrics && nowPlaying) lyricEls.current[currentLine]?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [currentLine, showLyrics, nowPlaying]);

  /** Phone: a library section as a chip. */
  const chip = (kind: View["kind"], label: string, count?: number) => (
    <button key={kind} type="button" data-music-tab={kind} onClick={() => go({ kind } as View)} className={`shrink-0 rounded-full px-3 py-1.5 text-[12.5px] font-semibold ${view.kind === kind ? "bg-white text-slate-900" : "bg-white/10 text-white/80"}`}>
      {label}
      {count ? <span className="ml-1 opacity-60">{count}</span> : null}
    </button>
  );

  return (
    <div className={compact ? "fixed inset-0 z-[60]" : "fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm lanx-fade"} onMouseDown={compact ? undefined : onClose}>
      <style>{`
        @keyframes lanx-music-drift { 0% { transform: scale(1.15) translate(0, 0); } 50% { transform: scale(1.25) translate(-2%, 2%); } 100% { transform: scale(1.15) translate(0, 0); } }
        .lanx-cf-card { transition: transform .55s cubic-bezier(.2,.8,.2,1), opacity .45s ease, filter .45s ease; will-change: transform; }
        .lanx-music-scroll::-webkit-scrollbar { width: 8px; } .lanx-music-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,.18); border-radius: 8px; }
      `}</style>
      <div
        data-music-panel
        className={compact ? "absolute inset-0 overflow-hidden flex flex-col text-white pt-[env(safe-area-inset-top)]" : "absolute inset-3 mx-auto max-w-[1500px] rounded-[26px] overflow-hidden flex flex-col text-white shadow-2xl"}
        style={{ background: "linear-gradient(160deg, #1e1b4b 0%, #0b1020 42%, #2e1065 100%)" }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {compact && (
          <div data-music-top className="shrink-0 border-b border-white/10 px-3 pb-2 pt-2">
            <div className="flex items-center gap-2">
              <button type="button" data-music-close-nav onClick={onClose} aria-label="Back to chats" className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10">
                <ArrowLeft className="h-5 w-5" />
              </button>
              <div className="text-[18px] font-extrabold tracking-tight">Music</div>
              {loading && <Loader2 className="h-4 w-4 animate-spin text-white/60" />}
              <button type="button" disabled={!ps.song} onClick={() => setNowPlaying(true)} className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-full bg-white/10 px-3 text-[12.5px] font-semibold disabled:opacity-30">
                <Maximize2 className="h-3.5 w-3.5" /> Now playing
              </button>
            </div>
            <div className="relative mt-2">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
              <input data-music-search value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search songs, singers, films…" enterKeyHint="search" className="w-full rounded-full bg-white/10 py-2 pl-9 pr-3 text-[16px] text-white placeholder:text-white/40 focus:outline-none" />
            </div>
            <div className="-mx-3 mt-2 flex gap-1.5 overflow-x-auto px-3 [scrollbar-width:none]" data-music-chips>
              {chip("home", "Discover")}
              {query.trim() ? chip("search", "Results") : null}
              {chip("favs", "Songs", favs.length)}
              {chip("artists", "Artists", followed.length)}
              {chip("albums", "Albums", savedAlbums.length)}
              {chip("playlists", "Playlists", playlists.length)}
              {chip("recent", "Recent")}
              {chip("most", "Most played")}
              {chip("queue", ps.queue.length ? `Queue · ${ps.queue.length}` : "Queue")}
            </div>
          </div>
        )}
        <div className="flex flex-1 min-h-0">
          {/* ---- left: search + library */}
          <aside className={`${compact ? "hidden" : "flex"} w-60 shrink-0 border-r border-white/10 p-4 flex-col gap-1 overflow-y-auto lanx-music-scroll`}>
            <div className="flex items-center gap-2 px-1 mb-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-pink-500 to-violet-500"><Music2 className="h-4 w-4" /></span>
              <div className="text-[17px] font-extrabold tracking-tight">Music</div>
              <span className="ml-auto text-[10px] text-white/40">Esc closes</span>
            </div>
            <div className="relative mb-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
              <input data-music-search autoFocus={!compact} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search songs, singers, films…" className="w-full rounded-full bg-white/10 pl-9 pr-3 py-2 text-[13px] text-white placeholder:text-white/40 outline-none focus:bg-white/15" />
            </div>
            {nav("home", "Discover", Home)}
            {query.trim() ? nav("search", "Search results", Search) : null}
            <div className="mt-3 mb-1 px-3 text-[10.5px] font-bold uppercase tracking-widest text-white/40">Library</div>
            {nav("favs", "Songs", Heart, favs.length)}
            {nav("artists", "Artists", Users, followed.length)}
            {nav("albums", "Albums", Disc3, savedAlbums.length)}
            {nav("playlists", "Playlists", ListMusic, playlists.length)}
            {playlists.slice(0, 6).map((p) => (
              <button key={p.id} type="button" onClick={() => go({ kind: "playlist", id: p.id })} className={`w-full flex items-center gap-2.5 rounded-xl pl-9 pr-3 py-1.5 text-[12.5px] ${view.kind === "playlist" && view.id === p.id ? "text-white bg-white/10" : "text-white/60 hover:text-white"}`}><span className="truncate">{p.name}</span></button>
            ))}
            <div className="mt-3 mb-1 px-3 text-[10.5px] font-bold uppercase tracking-widest text-white/40">Listening</div>
            {nav("recent", "Recently played", Clock)}
            {nav("most", "Most listened", Flame)}
            {nav("queue", `Queue${ps.queue.length ? ` · ${ps.queue.length}` : ""}`, ListPlus)}
            <button type="button" data-music-close-nav onClick={onClose} className="mt-auto w-full flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] font-semibold bg-white/10 text-white hover:bg-white/20">
              <ArrowLeft className="h-4 w-4" /> Back to chats
            </button>
          </aside>

          {/* ---- middle: the page */}
          <main className={`flex-1 min-w-0 overflow-y-auto lanx-music-scroll ${compact ? "px-3 py-3" : "px-6 py-5"}`}>
            <div className="flex items-center gap-2 mb-4">
              <button type="button" onClick={back} disabled={!stack.length} className="h-8 w-8 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-30 flex items-center justify-center"><ArrowLeft className="h-4 w-4" /></button>
              <h2 className="text-[20px] font-extrabold tracking-tight truncate">{title}</h2>
              {loading && <Loader2 className="h-4 w-4 animate-spin text-white/60" />}
              <div className={`ml-auto items-center gap-1.5 ${compact ? "hidden" : "flex"}`}>
                <button type="button" title="Now playing (full screen)" disabled={!ps.song} onClick={() => setNowPlaying(true)} className="h-8 px-3 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-30 text-[12px] font-semibold inline-flex items-center gap-1.5"><Maximize2 className="h-3.5 w-3.5" /> Now playing</button>
                <button type="button" data-music-close onClick={onClose} title="Close the music app (Esc) — the song keeps playing" className="h-8 px-3.5 rounded-full bg-white text-slate-900 hover:bg-white/90 text-[12px] font-bold inline-flex items-center gap-1.5"><X className="h-4 w-4" /> Close</button>
              </div>
            </div>
            {problem && <p className="mb-3 text-[12.5px] text-amber-300">{problem}</p>}
            {main}
            {!home && loading && view.kind === "home" && <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-white/50" /></div>}
          </main>

          {/* ---- right: now playing + played */}
          <aside className={`hidden ${compact ? "" : "xl:flex"} w-72 shrink-0 border-l border-white/10 p-4 flex-col gap-4 overflow-y-auto lanx-music-scroll`}>
            <div>
              <div className="text-[10.5px] font-bold uppercase tracking-widest text-white/40 mb-2">Now playing</div>
              {ps.song ? (
                <button type="button" onClick={() => setNowPlaying(true)} className="w-full text-left">
                  <Cover src={ps.song.cover} className="w-full aspect-square rounded-2xl shadow-2xl" />
                  <div className="mt-2 truncate text-[14px] font-bold">{ps.song.title}</div>
                  <div className="truncate text-[12px] text-white/60">{ps.song.artist}</div>
                </button>
              ) : (
                <div className="rounded-2xl bg-white/5 p-6 text-center text-[12px] text-white/40">Pick a song to start.</div>
              )}
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-[10.5px] font-bold uppercase tracking-widest text-white/40">Played</div>
                <button type="button" onClick={() => go({ kind: "recent" })} className="text-[11px] text-white/50 hover:text-white inline-flex items-center">See all <ChevronRight className="h-3 w-3" /></button>
              </div>
              <div className="space-y-1.5">
                {played.slice(0, 6).map((p) => (
                  <button key={p.song.id} type="button" onClick={() => void player.play(p.song)} className="w-full flex items-center gap-2.5 rounded-xl p-1.5 hover:bg-white/10 text-left">
                    <Cover src={p.song.cover} className="h-10 w-10 rounded-lg shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12.5px] font-semibold">{p.song.title}</div>
                      <div className="truncate text-[11px] text-white/55">{p.song.artist}</div>
                    </div>
                    <span className="text-[10.5px] text-white/40 whitespace-nowrap">{fmtAgo(p.at)}</span>
                  </button>
                ))}
                {!played.length && <div className="text-[12px] text-white/40">Nothing yet.</div>}
              </div>
            </div>
          </aside>
        </div>

        {/* ---- bottom: the player bar (slim on the phone) */}
        {compact ? (
          <div data-music-bar className="shrink-0 border-t border-white/10 bg-[#0b1020] px-3 pb-[calc(env(safe-area-inset-bottom)+8px)] pt-1.5">
            <div className="mb-1.5 h-0.5 overflow-hidden rounded-full bg-white/15">
              <div className="h-full bg-white" style={{ width: `${pct}%` }} />
            </div>
            <div className="flex items-center gap-2.5">
              <button type="button" onClick={() => ps.song && setNowPlaying(true)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
                <Cover src={ps.song?.cover ?? ""} className="h-11 w-11 shrink-0 rounded-lg" />
                <span className="min-w-0">
                  <span className="block truncate text-[13.5px] font-semibold">{ps.song?.title ?? "Nothing playing"}</span>
                  <span className="block truncate text-[11.5px] text-white/60">{ps.error ?? ps.song?.artist ?? "Pick a song or an album"}</span>
                </span>
              </button>
              {ps.song && (
                <button type="button" aria-label="Favourite" onClick={() => ps.song && void fav(ps.song)} className={`flex h-9 w-9 items-center justify-center rounded-full ${isFav(ps.song) ? "text-rose-400" : "text-white/60"}`}>
                  <Heart className="h-5 w-5" fill={isFav(ps.song) ? "currentColor" : "none"} />
                </button>
              )}
              <button type="button" data-music-bar-toggle aria-label={ps.playing ? "Pause" : "Play"} onClick={() => player.toggle()} disabled={!ps.song} className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-slate-900 disabled:opacity-40">
                {ps.playing ? <Pause className="h-5 w-5" /> : <Play className="ml-0.5 h-5 w-5" />}
              </button>
              <button type="button" data-music-bar-next aria-label="Next" onClick={() => player.next()} disabled={!ps.song} className="flex h-9 w-9 items-center justify-center rounded-full disabled:opacity-40">
                <SkipForward className="h-5 w-5" />
              </button>
            </div>
          </div>
        ) : (
        <div data-music-bar className="shrink-0 border-t border-white/10 bg-black/30 backdrop-blur px-4 py-2.5 grid grid-cols-[1fr_minmax(320px,2fr)_1fr] items-center gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button type="button" onClick={() => ps.song && setNowPlaying(true)} className="shrink-0"><Cover src={ps.song?.cover ?? ""} className="h-12 w-12 rounded-lg" /></button>
            <div className="min-w-0">
              <div className="truncate text-[13px] font-semibold">{ps.song?.title ?? "Nothing playing"}</div>
              <div className="truncate text-[11.5px] text-white/60">{ps.song?.artist ?? "Pick a song or an album"}</div>
              {ps.error && <div className="text-[10.5px] text-amber-300">{ps.error}</div>}
            </div>
            {ps.song && <button type="button" onClick={() => ps.song && void fav(ps.song)} className={`h-8 w-8 rounded-full flex items-center justify-center ${ps.song && isFav(ps.song) ? "text-rose-400" : "text-white/50 hover:text-white"}`}><Heart className="h-4 w-4" fill={ps.song && isFav(ps.song) ? "currentColor" : "none"} /></button>}
          </div>
          <div className="flex flex-col items-center gap-1">
            <div className="flex items-center gap-2">
              <button type="button" data-music-shuffle onClick={() => player.setShuffle(!ps.shuffle)} title="Shuffle" className={`h-8 w-8 rounded-full flex items-center justify-center ${ps.shuffle ? "text-sky-300" : "text-white/60 hover:text-white"}`}><Shuffle className="h-4 w-4" /></button>
              <button type="button" data-music-bar-prev onClick={() => player.prev()} className="h-9 w-9 rounded-full hover:bg-white/15 flex items-center justify-center"><SkipBack className="h-5 w-5" /></button>
              <button type="button" data-music-bar-toggle onClick={() => player.toggle()} disabled={!ps.song} className="h-11 w-11 rounded-full bg-white text-slate-900 disabled:opacity-40 flex items-center justify-center">{ps.playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 ml-0.5" />}</button>
              <button type="button" data-music-bar-next onClick={() => player.next()} className="h-9 w-9 rounded-full hover:bg-white/15 flex items-center justify-center"><SkipForward className="h-5 w-5" /></button>
              <button type="button" data-music-repeat onClick={() => player.setRepeat(ps.repeat === "off" ? "all" : ps.repeat === "all" ? "one" : "off")} title={ps.repeat === "off" ? "Repeat off" : ps.repeat === "all" ? "Repeat all" : "Repeat this song"} className={`h-8 w-8 rounded-full flex items-center justify-center ${ps.repeat !== "off" ? "text-sky-300" : "text-white/60 hover:text-white"}`}>{ps.repeat === "one" ? <Repeat1 className="h-4 w-4" /> : <Repeat className="h-4 w-4" />}</button>
            </div>
            <div className="w-full flex items-center gap-2 text-[10.5px] text-white/60 tabular-nums">
              <span>{fmtTime(ps.position)}</span>
              <input type="range" min={0} max={Math.max(1, Math.round(ps.duration))} value={Math.round(ps.position)} onChange={(e) => player.seek(Number(e.target.value))} className="flex-1 accent-sky-400 h-1" style={{ background: `linear-gradient(to right, #38bdf8 ${pct}%, rgba(255,255,255,0.2) ${pct}%)` }} />
              <span>{fmtTime(ps.duration)}</span>
            </div>
          </div>
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => go({ kind: "queue" })} title="Up next" className={`h-8 w-8 rounded-full flex items-center justify-center ${view.kind === "queue" ? "text-sky-300" : "text-white/60 hover:text-white"}`}><ListMusic className="h-4 w-4" /></button>
            <button type="button" onClick={() => { setShowLyrics(true); setNowPlaying(true); }} title="Lyrics" disabled={!ps.song} className="h-8 w-8 rounded-full flex items-center justify-center text-white/60 hover:text-white disabled:opacity-30"><Mic2 className="h-4 w-4" /></button>
            <Volume2 className="h-4 w-4 text-white/60" />
            <input type="range" min={0} max={100} value={Math.round(ps.volume * 100)} onChange={(e) => player.setVolume(Number(e.target.value) / 100)} className="w-24 accent-sky-400" />
            <button type="button" data-music-bar-stop onClick={() => player.stop()} title="Stop and clear the queue" disabled={!ps.song} className="h-8 w-8 rounded-full flex items-center justify-center text-white/60 hover:text-white disabled:opacity-30"><Square className="h-3.5 w-3.5" fill="currentColor" /></button>
          </div>
        </div>

        )}

        {/* ---- Now playing on the phone: one big cover, the controls under it, no moving blur */}
        {compact && nowPlaying && ps.song && (
          <div data-music-now className="absolute inset-0 z-10 flex flex-col overflow-hidden bg-[#0b1020] text-white">
            {ps.song.cover && <img src={ps.song.cover} alt="" className="lanx-cover-blur absolute inset-0 h-full w-full scale-125 object-cover opacity-50" style={{ filter: "blur(40px) saturate(1.3)" }} />}
            <div className="absolute inset-0 bg-black/40" />
            <div className="relative flex items-center justify-between px-3 pt-[calc(env(safe-area-inset-top)+8px)]">
              <button type="button" aria-label="Close" onClick={() => setNowPlaying(false)} className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15">
                <Minimize2 className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => setShowLyrics((v) => !v)} className={`inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-[13px] font-semibold ${showLyrics ? "bg-white text-slate-900" : "bg-white/15"}`}>
                <Mic2 className="h-4 w-4" /> Lyrics
              </button>
            </div>
            <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center px-6">
              {!showLyrics ? (
                <>
                  <Cover src={ps.song.cover} className="aspect-square w-[min(78vw,340px)] rounded-3xl shadow-2xl" />
                  <div className="mt-5 w-full text-center">
                    <div className="truncate text-[20px] font-bold">{ps.song.title}</div>
                    <div className="truncate text-[14px] text-white/70">{ps.song.artist}</div>
                  </div>
                </>
              ) : (
                <div className="h-full w-full space-y-2 overflow-y-auto py-6 text-center" style={{ maskImage: "linear-gradient(to bottom, transparent, black 12%, black 88%, transparent)" }}>
                  {lyrics.length ? (
                    lyrics.map((l, i) => (
                      <div key={i} ref={(el) => { lyricEls.current[i] = el; }} onClick={() => player.seek(l.t)} className={`text-[18px] leading-snug ${i === currentLine ? "font-bold text-white" : i < currentLine ? "text-white/40" : "text-white/60"}`}>
                        {l.text}
                      </div>
                    ))
                  ) : (
                    <div className="pt-20 text-[14px] text-white/50">No lyrics found for this song.</div>
                  )}
                </div>
              )}
            </div>
            <div className="relative px-6 pb-[calc(env(safe-area-inset-bottom)+20px)]">
              <input type="range" min={0} max={Math.max(1, Math.round(ps.duration))} value={Math.round(ps.position)} onChange={(e) => player.seek(Number(e.target.value))} className="w-full accent-white" aria-label="Position" />
              <div className="flex justify-between text-[11px] tabular-nums text-white/60">
                <span>{fmtTime(ps.position)}</span>
                <span>{fmtTime(ps.duration)}</span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <button type="button" aria-label="Shuffle" onClick={() => player.setShuffle(!ps.shuffle)} className={`flex h-11 w-11 items-center justify-center rounded-full ${ps.shuffle ? "text-sky-300" : "text-white/70"}`}>
                  <Shuffle className="h-5 w-5" />
                </button>
                <button type="button" aria-label="Previous" onClick={() => player.prev()} className="flex h-12 w-12 items-center justify-center rounded-full">
                  <SkipBack className="h-6 w-6" />
                </button>
                <button type="button" data-music-now-toggle aria-label={ps.playing ? "Pause" : "Play"} onClick={() => player.toggle()} className="flex h-16 w-16 items-center justify-center rounded-full bg-white text-slate-900">
                  {ps.playing ? <Pause className="h-7 w-7" /> : <Play className="ml-1 h-7 w-7" />}
                </button>
                <button type="button" aria-label="Next" onClick={() => player.next()} className="flex h-12 w-12 items-center justify-center rounded-full">
                  <SkipForward className="h-6 w-6" />
                </button>
                <button type="button" aria-label="Repeat" onClick={() => player.setRepeat(ps.repeat === "off" ? "all" : ps.repeat === "all" ? "one" : "off")} className={`flex h-11 w-11 items-center justify-center rounded-full ${ps.repeat !== "off" ? "text-sky-300" : "text-white/70"}`}>
                  {ps.repeat === "one" ? <Repeat1 className="h-5 w-5" /> : <Repeat className="h-5 w-5" />}
                </button>
              </div>
              <div className="mt-2 flex items-center justify-center gap-3">
                <button type="button" onClick={() => void fav(ps.song!)} className={`inline-flex h-9 items-center gap-1.5 rounded-full bg-white/10 px-3 text-[12.5px] font-semibold ${isFav(ps.song) ? "text-rose-300" : ""}`}>
                  <Heart className="h-4 w-4" fill={isFav(ps.song) ? "currentColor" : "none"} /> {isFav(ps.song) ? "Loved" : "Love"}
                </button>
                <button type="button" onClick={() => { setNowPlaying(false); go({ kind: "queue" }); }} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-white/10 px-3 text-[12.5px] font-semibold">
                  <ListMusic className="h-4 w-4" /> Up next
                </button>
                <button type="button" disabled={!!busy} onClick={() => void send(ps.song!)} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-white/10 px-3 text-[12.5px] font-semibold disabled:opacity-40">
                  <Send className="h-4 w-4" /> Send
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ---- Now playing: the covers fanned out, lyrics, floating player */}
        {!compact && nowPlaying && ps.song && (
          <div data-music-now className="absolute inset-0 z-10 overflow-hidden text-white" onMouseDown={(e) => e.stopPropagation()}>
            {ps.song.cover && <img src={ps.song.cover} alt="" className="lanx-cover-blur absolute inset-0 h-full w-full object-cover" style={{ filter: "blur(70px) saturate(1.4)", animation: "lanx-music-drift 24s ease-in-out infinite" }} />}
            <div className="absolute inset-0 bg-black/35" />
            <button type="button" onClick={() => setNowPlaying(false)} className="absolute top-4 right-4 h-9 w-9 rounded-full bg-white/15 hover:bg-white/25 backdrop-blur flex items-center justify-center"><Minimize2 className="h-4 w-4" /></button>
            <button type="button" onClick={() => setShowLyrics((v) => !v)} className={`absolute top-4 right-16 h-9 px-3 rounded-full backdrop-blur text-[12px] font-semibold inline-flex items-center gap-1.5 ${showLyrics ? "bg-white text-slate-900" : "bg-white/15 hover:bg-white/25"}`}><Mic2 className="h-3.5 w-3.5" /> Lyrics</button>
            <div className="absolute inset-x-0 top-0 bottom-28 flex items-center justify-center" style={{ perspective: "1400px" }}>
              {!showLyrics ? (
                <div className="relative h-[420px] w-full max-w-[1100px]">
                  {(ps.queue.length ? ps.queue : [ps.song]).map((s, i) => {
                    const idx = ps.queue.length ? ps.index : 0;
                    const off = i - idx;
                    if (Math.abs(off) > 3) return null;
                    const dir = Math.sign(off);
                    const x = off * 270 + dir * 20;
                    const rot = -off * 32;
                    const scale = off === 0 ? 1 : 0.86 - Math.abs(off) * 0.05;
                    return (
                      <button
                        key={`${s.id}-${i}`}
                        type="button"
                        data-music-cf={off}
                        onClick={() => (off === 0 ? player.toggle() : void player.play(s))}
                        className="lanx-cf-card absolute left-1/2 top-1/2 w-[300px] rounded-[28px] overflow-hidden bg-white/10 backdrop-blur-xl border border-white/20 shadow-2xl text-left"
                        style={{ transform: `translate(-50%, -50%) translateX(${x}px) rotateY(${rot}deg) scale(${scale})`, zIndex: 10 - Math.abs(off), opacity: off === 0 ? 1 : 0.75 - Math.abs(off) * 0.12, filter: off === 0 ? "none" : `brightness(${0.75 - Math.abs(off) * 0.08})` }}
                      >
                        <Cover src={s.cover} className="aspect-square w-full" />
                        <div className="p-4 text-center">
                          <div className="truncate text-[19px] font-bold">{s.title}</div>
                          <div className="truncate text-[14px] text-white/70">{s.artist}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="w-full max-w-[760px] h-full flex flex-col items-center justify-center px-8">
                  <div className="flex items-center gap-4 mb-5">
                    <Cover src={ps.song.cover} className="h-16 w-16 rounded-xl shadow-xl" />
                    <div className="min-w-0">
                      <div className="truncate text-[18px] font-bold">{ps.song.title}</div>
                      <div className="truncate text-[13px] text-white/70">{ps.song.artist}</div>
                    </div>
                  </div>
                  <div className="w-full max-h-[300px] overflow-y-auto lanx-music-scroll text-center space-y-2 py-4 px-2" style={{ maskImage: "linear-gradient(to bottom, transparent, black 15%, black 85%, transparent)" }}>
                    {lyrics.length ? (
                      lyrics.map((l, i) => (
                        <div key={i} ref={(el) => { lyricEls.current[i] = el; }} onClick={() => player.seek(l.t)} className={`cursor-pointer transition text-[18px] leading-snug ${i === currentLine ? "text-white font-bold scale-105" : i < currentLine ? "text-white/40" : "text-white/60"}`}>{l.text}</div>
                      ))
                    ) : (
                      <div className="text-white/50 text-[14px]">No lyrics found for this song.</div>
                    )}
                  </div>
                </div>
              )}
            </div>
            <div className="absolute bottom-7 left-1/2 -translate-x-1/2 flex items-center gap-3 rounded-full bg-white/12 backdrop-blur-2xl border border-white/20 shadow-2xl pl-4 pr-3 py-2.5">
              <button type="button" onClick={() => player.prev()} className="h-9 w-9 rounded-full hover:bg-white/15 flex items-center justify-center"><SkipBack className="h-5 w-5" /></button>
              <button type="button" data-music-now-toggle onClick={() => player.toggle()} className="h-10 w-10 rounded-full bg-white text-slate-900 flex items-center justify-center">{ps.playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 ml-0.5" />}</button>
              <button type="button" onClick={() => player.next()} className="h-9 w-9 rounded-full hover:bg-white/15 flex items-center justify-center"><SkipForward className="h-5 w-5" /></button>
              <div className="flex items-center gap-3 rounded-full bg-black/25 pl-1.5 pr-4 py-1 min-w-[280px]">
                <Cover src={ps.song.cover} className="h-10 w-10 rounded-lg" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold">{ps.song.title}</div>
                  <div className="truncate text-[11px] text-white/70">{ps.song.artist}</div>
                  <div className="mt-1 h-1 rounded-full bg-white/20 overflow-hidden"><div className="h-full bg-white" style={{ width: `${pct}%` }} /></div>
                </div>
                <span className="text-[10.5px] text-white/70 tabular-nums">{fmtTime(ps.position)}</span>
              </div>
              <button type="button" onClick={() => setShowLyrics((v) => !v)} title="Lyrics" className={`h-9 w-9 rounded-full flex items-center justify-center ${showLyrics ? "bg-white text-slate-900" : "hover:bg-white/15"}`}><Mic2 className="h-4 w-4" /></button>
              <button type="button" onClick={() => { setNowPlaying(false); go({ kind: "queue" }); }} title="Up next" className="h-9 w-9 rounded-full hover:bg-white/15 flex items-center justify-center"><ListMusic className="h-4 w-4" /></button>
              <div className="flex items-center gap-1.5 pr-1">
                <Volume2 className="h-4 w-4 text-white/70" />
                <input type="range" min={0} max={100} value={Math.round(ps.volume * 100)} onChange={(e) => player.setVolume(Number(e.target.value) / 100)} className="w-20 accent-white" />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
