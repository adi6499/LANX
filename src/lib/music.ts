/** LANX 2.7.0: music — the `/music` app (browse, search, artists, albums,
 *  playlists), the player and the song card. Songs come from the same
 *  JioSaavn service as the MusicFlow app (search, browse, 320 kbps streams,
 *  cover art); favourites, playlists, followed artists, play counts, recent
 *  and the queue stay on this PC. */
import { api } from "./api";

export interface Song {
  id: string;
  title: string;
  artist: string;
  album: string;
  albumId: string;
  cover: string;
  /** The song's page (for WhatsApp and old LANX versions). */
  url: string;
  /** The audio stream (320 kbps when the service has it). */
  stream: string;
  /** Seconds. */
  duration: number;
  language: string;
  year: string;
  /** Primary artist ids, for the artist page. */
  artistIds: string[];
}

/** An album, a playlist (chart) or an artist as the browse pages list them. */
export interface Collection {
  id: string;
  type: "album" | "playlist" | "artist";
  title: string;
  subtitle: string;
  image: string;
  language: string;
  url: string;
  year: string;
  songCount: number;
}

export interface Playlist {
  id: string;
  name: string;
  songs: Song[];
  createdAt: number;
}

export const API = "https://spoton-sigma.vercel.app/api";
const RECENT_MAX = 60;
export const LANGUAGES: { id: string; name: string }[] = [
  { id: "hindi", name: "Hindi" },
  { id: "english", name: "English" },
  { id: "marathi", name: "Marathi" },
  { id: "punjabi", name: "Punjabi" },
  { id: "tamil", name: "Tamil" },
  { id: "telugu", name: "Telugu" },
  { id: "gujarati", name: "Gujarati" },
  { id: "bengali", name: "Bengali" },
];

const entities: Record<string, string> = { "&amp;": "&", "&quot;": '"', "&#039;": "'", "&apos;": "'", "&lt;": "<", "&gt;": ">" };
export const clean = (s: unknown) => String(s ?? "").replace(/&(amp|quot|#039|apos|lt|gt);/g, (m) => entities[m] ?? m).trim();
const https = (u: unknown) => String(u ?? "").replace(/^http:\/\//, "https://");

type Img = { quality?: string; url?: string; link?: string }[] | string | undefined;
export function pickImage(image: Img, want = "500x500"): string {
  if (!image) return "";
  if (typeof image === "string") return https(image);
  const hit = image.find((i) => i.quality === want) ?? image[image.length - 1];
  return https(hit?.url ?? hit?.link ?? "");
}

interface RawSong {
  id: string;
  name?: string;
  title?: string;
  duration?: number | string;
  language?: string;
  year?: string | number;
  url?: string;
  album?: { id?: string; name?: string; url?: string } | string;
  artists?: { primary?: { id?: string; name: string }[] };
  primaryArtists?: string;
  image?: Img;
  downloadUrl?: { quality?: string; url?: string; link?: string }[];
}
interface RawCollection {
  id: string;
  name?: string;
  title?: string;
  type?: string;
  subtitle?: string;
  image?: Img;
  language?: string;
  url?: string;
  year?: string | number;
  songCount?: number | string;
  artists?: { primary?: { name: string }[] };
  artist?: string;
  role?: string;
}

export function toSong(r: RawSong): Song | null {
  const title = clean(r.name ?? r.title);
  if (!r.id || !title) return null;
  const primary = r.artists?.primary ?? [];
  const artist = clean(primary.length ? primary.map((a) => a.name).join(", ") : (r.primaryArtists ?? "")) || "Unknown artist";
  const dl = Array.isArray(r.downloadUrl) ? r.downloadUrl : [];
  const pick = dl.find((d) => d.quality === "320kbps") ?? dl.find((d) => d.quality === "160kbps") ?? dl[dl.length - 1];
  const stream = https(pick?.url ?? pick?.link ?? "");
  if (!stream) return null;
  const album = typeof r.album === "string" ? { name: r.album } : (r.album ?? {});
  return {
    id: String(r.id),
    title,
    artist,
    album: clean(album.name),
    albumId: String(album.id ?? ""),
    cover: pickImage(r.image),
    url: https(r.url ?? ""),
    stream,
    duration: Number(r.duration) || 0,
    language: clean(r.language),
    year: clean(r.year),
    artistIds: primary.map((a) => String(a.id ?? "")).filter(Boolean),
  };
}

function toCollection(r: RawCollection, fallback: Collection["type"]): Collection | null {
  const title = clean(r.name ?? r.title);
  if (!r.id || !title) return null;
  const t = r.type === "album" || r.type === "playlist" || r.type === "artist" ? r.type : fallback;
  const by = r.artists?.primary?.map((a) => a.name).join(", ") ?? r.artist ?? "";
  return {
    id: String(r.id),
    type: t,
    title,
    subtitle: clean(r.subtitle ?? by ?? ""),
    image: pickImage(r.image),
    language: clean(r.language),
    url: https(r.url ?? ""),
    year: clean(r.year),
    songCount: Number(r.songCount) || 0,
  };
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API}/${path}`);
  if (!res.ok) throw new Error(`The music service answered ${res.status}.`);
  const data = (await res.json()) as { data?: T } & T;
  return (data.data ?? data) as T;
}
const results = <T,>(d: { results?: T[] } | T[]): T[] => (Array.isArray(d) ? d : (d.results ?? []));

// ------------------------------------------------------------ search

export async function searchSongs(query: string, limit = 30): Promise<Song[]> {
  const q = query.trim();
  if (!q) return [];
  const d = await get<{ results?: RawSong[] }>(`search/songs?query=${encodeURIComponent(q)}&limit=${limit}`);
  return results(d).map(toSong).filter((s): s is Song => !!s);
}
export async function searchAll(query: string): Promise<{ songs: Song[]; artists: Collection[]; albums: Collection[]; playlists: Collection[] }> {
  const q = encodeURIComponent(query.trim());
  const [s, a, al, p] = await Promise.allSettled([
    get<{ results?: RawSong[] }>(`search/songs?query=${q}&limit=30`),
    get<{ results?: RawCollection[] }>(`search/artists?query=${q}&limit=12`),
    get<{ results?: RawCollection[] }>(`search/albums?query=${q}&limit=12`),
    get<{ results?: RawCollection[] }>(`search/playlists?query=${q}&limit=12`),
  ]);
  const ok = <T,>(r: PromiseSettledResult<T>, empty: T): T => (r.status === "fulfilled" ? r.value : empty);
  if (s.status === "rejected" && a.status === "rejected") throw s.reason;
  return {
    songs: results(ok(s, {})).map(toSong).filter((x): x is Song => !!x),
    artists: results(ok(a, {})).map((r) => toCollection(r, "artist")).filter((x): x is Collection => !!x),
    albums: results(ok(al, {})).map((r) => toCollection(r, "album")).filter((x): x is Collection => !!x),
    playlists: results(ok(p, {})).map((r) => toCollection(r, "playlist")).filter((x): x is Collection => !!x),
  };
}

// ------------------------------------------------------------ browse

export interface Home {
  trending: Collection[];
  charts: Collection[];
  playlists: Collection[];
  newAlbums: Collection[];
  newSongs: Song[];
}
export async function browseHome(languages: string[]): Promise<Home> {
  const d = await get<{ new_trending?: (RawCollection & RawSong)[]; charts?: RawCollection[]; top_playlists?: RawCollection[]; new_albums?: (RawCollection & RawSong)[] }>(
    `modules?language=${encodeURIComponent(languages.join(","))}`,
  );
  const trending: Collection[] = [];
  const newSongs: Song[] = [];
  for (const r of d.new_trending ?? []) {
    if (r.type === "song") {
      const s = toSong(r);
      if (s) newSongs.push(s);
    } else {
      const c = toCollection(r, "album");
      if (c) trending.push(c);
    }
  }
  const newAlbums: Collection[] = [];
  for (const r of d.new_albums ?? []) {
    if (r.type === "song") {
      const s = toSong(r);
      if (s) newSongs.push(s);
    } else {
      const c = toCollection(r, "album");
      if (c) newAlbums.push(c);
    }
  }
  return {
    trending,
    charts: (d.charts ?? []).map((r) => toCollection(r, "playlist")).filter((x): x is Collection => !!x),
    playlists: (d.top_playlists ?? []).map((r) => toCollection(r, "playlist")).filter((x): x is Collection => !!x),
    newAlbums,
    newSongs,
  };
}

/** Well-known singers per language — the Artists page offers them to browse
 *  (the service has no "all artists" list). Looked up once a day. */
const POPULAR_ARTISTS: Record<string, string[]> = {
  hindi: ["Arijit Singh", "Shreya Ghoshal", "Atif Aslam", "Kishore Kumar", "Lata Mangeshkar", "Sonu Nigam", "Neha Kakkar", "A.R. Rahman", "Pritam", "Jubin Nautiyal", "Udit Narayan", "Alka Yagnik", "Kumar Sanu", "Mohammed Rafi", "Badshah", "Shaan"],
  english: ["Ed Sheeran", "Taylor Swift", "The Weeknd", "Dua Lipa", "Billie Eilish", "Imagine Dragons", "Coldplay", "Adele", "Bruno Mars", "Justin Bieber"],
  marathi: ["Ajay-Atul", "Shankar Mahadevan", "Adarsh Shinde", "Vaishali Samant", "Swapnil Bandodkar", "Avadhoot Gupte", "Anand Shinde", "Kailash Kher"],
  punjabi: ["Diljit Dosanjh", "AP Dhillon", "Sidhu Moose Wala", "Guru Randhawa", "Karan Aujla", "Jass Manak", "Gurdas Maan"],
  tamil: ["Anirudh Ravichander", "Sid Sriram", "Yuvan Shankar Raja", "Ilaiyaraaja", "Harris Jayaraj"],
  telugu: ["Devi Sri Prasad", "S. P. Balasubrahmanyam", "Sid Sriram", "Thaman S"],
  gujarati: ["Kinjal Dave", "Jigardan Gadhavi", "Kirtidan Gadhvi", "Aditya Gadhvi"],
  bengali: ["Anupam Roy", "Arijit Singh", "Shreya Ghoshal", "Kumar Sanu"],
};
export async function popularArtists(languages: string[]): Promise<Collection[]> {
  const key = languages.slice().sort().join(",");
  const cache = await readJson<{ at: number; key: string; items: Collection[] }>("music_cache", { at: 0, key: "", items: [] });
  if (cache.key === key && Date.now() - cache.at < 86_400_000 && cache.items.length) return cache.items;
  const names: string[] = [];
  for (const l of languages) for (const n of POPULAR_ARTISTS[l] ?? []) if (!names.includes(n)) names.push(n);
  const found = await Promise.allSettled(names.slice(0, 24).map((n) => get<{ results?: RawCollection[] }>(`search/artists?query=${encodeURIComponent(n)}&limit=1`)));
  const items: Collection[] = [];
  found.forEach((r, i) => {
    if (r.status !== "fulfilled") return;
    const c = results(r.value).map((x) => toCollection(x, "artist")).find((x): x is Collection => !!x);
    if (c && !items.some((x) => x.id === c.id)) items.push({ ...c, subtitle: names[i] === c.title ? "Artist" : c.subtitle || "Artist" });
  });
  if (items.length) await writeJson("music_cache", { at: Date.now(), key, items }).catch(() => {});
  return items;
}

export interface ArtistPage {
  id: string;
  name: string;
  image: string;
  topSongs: Song[];
  albums: Collection[];
}
export async function getArtist(id: string): Promise<ArtistPage> {
  const d = await get<{ id: string; name?: string; image?: Img; topSongs?: RawSong[]; topAlbums?: RawCollection[] }>(`artists?id=${encodeURIComponent(id)}`);
  return {
    id: String(d.id ?? id),
    name: clean(d.name) || "Artist",
    image: pickImage(d.image),
    topSongs: (d.topSongs ?? []).map(toSong).filter((x): x is Song => !!x),
    albums: (d.topAlbums ?? []).map((r) => toCollection(r, "album")).filter((x): x is Collection => !!x),
  };
}
export async function getCollectionSongs(c: Collection): Promise<{ collection: Collection; songs: Song[] }> {
  if (c.type === "artist") {
    const a = await getArtist(c.id);
    return { collection: { ...c, title: a.name, image: a.image || c.image }, songs: a.topSongs };
  }
  const d = await get<RawCollection & { songs?: RawSong[] }>(`${c.type === "album" ? "albums" : "playlists"}?id=${encodeURIComponent(c.id)}`);
  const col = toCollection(d, c.type) ?? c;
  return { collection: { ...col, image: col.image || c.image }, songs: (d.songs ?? []).map(toSong).filter((x): x is Song => !!x) };
}

export const fmtTime = (s: number) => {
  const n = Math.max(0, Math.round(s));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
};
export const fmtAgo = (at: number) => {
  const m = Math.max(0, Math.round((Date.now() - at) / 60000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  return `${Math.round(h / 24)} d ago`;
};

/** The song as a chat card (what `send_card` gets). */
export function songCard(s: Song) {
  return { kind: "music", id: s.id, title: s.title, artist: s.artist, cover: s.cover, url: s.url, stream: s.stream, duration: s.duration };
}
/** The WhatsApp text for a song. */
export const songText = (s: Song) => `🎵 ${s.title} — ${s.artist}${s.url ? `\n${s.url}` : ""}`;

// ------------------------------------------------------------ what stays on this PC

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const v = await api.getPref(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
const writeJson = (key: string, v: unknown) => api.setPref(key, JSON.stringify(v));
const validSongs = (list: unknown): Song[] => (Array.isArray(list) ? (list as Song[]).filter((s) => s && typeof s.id === "string" && typeof s.stream === "string") : []);

export const loadMusicFavourites = async () => validSongs(await readJson("music_fav", []));
export async function toggleMusicFavourite(song: Song): Promise<Song[]> {
  const favs = await loadMusicFavourites();
  const next = favs.some((f) => f.id === song.id) ? favs.filter((f) => f.id !== song.id) : [song, ...favs];
  await writeJson("music_fav", next);
  return next;
}

export interface Played {
  song: Song;
  at: number;
  count: number;
}
/** Recent (newest first) and most listened come from the same record. */
export const loadPlayed = async (): Promise<Played[]> => {
  const list = await readJson<Played[]>("music_recent", []);
  return Array.isArray(list) ? list.filter((p) => p && p.song && typeof p.song.id === "string") : [];
};
export async function rememberPlayed(song: Song): Promise<void> {
  const list = await loadPlayed();
  const old = list.find((p) => p.song.id === song.id);
  const next = [{ song, at: Date.now(), count: (old?.count ?? 0) + 1 }, ...list.filter((p) => p.song.id !== song.id)].slice(0, RECENT_MAX);
  await writeJson("music_recent", next).catch(() => {});
}

export const loadFollowed = async () => (await readJson<Collection[]>("music_artists", [])).filter((c) => c && typeof c.id === "string");
export async function toggleFollowed(c: Collection): Promise<Collection[]> {
  const list = await loadFollowed();
  const next = list.some((x) => x.id === c.id) ? list.filter((x) => x.id !== c.id) : [c, ...list];
  await writeJson("music_artists", next);
  return next;
}
export const loadSavedAlbums = async () => (await readJson<Collection[]>("music_albums", [])).filter((c) => c && typeof c.id === "string");
export async function toggleSavedAlbum(c: Collection): Promise<Collection[]> {
  const list = await loadSavedAlbums();
  const next = list.some((x) => x.id === c.id) ? list.filter((x) => x.id !== c.id) : [c, ...list];
  await writeJson("music_albums", next);
  return next;
}

export const loadPlaylists = async () => (await readJson<Playlist[]>("music_playlists", [])).filter((p) => p && typeof p.id === "string").map((p) => ({ ...p, songs: validSongs(p.songs) }));
export async function savePlaylists(list: Playlist[]): Promise<void> {
  await writeJson("music_playlists", list);
}
export async function createPlaylist(name: string, songs: Song[] = []): Promise<Playlist[]> {
  const list = await loadPlaylists();
  const p: Playlist = { id: `pl-${Date.now()}`, name: name.trim() || "My playlist", songs, createdAt: Date.now() };
  const next = [...list, p];
  await savePlaylists(next);
  return next;
}
export async function addToPlaylist(id: string, song: Song): Promise<Playlist[]> {
  const list = await loadPlaylists();
  const next = list.map((p) => (p.id === id && !p.songs.some((s) => s.id === song.id) ? { ...p, songs: [...p.songs, song] } : p));
  await savePlaylists(next);
  return next;
}
export async function removeFromPlaylist(id: string, songId: string): Promise<Playlist[]> {
  const list = await loadPlaylists();
  const next = list.map((p) => (p.id === id ? { ...p, songs: p.songs.filter((s) => s.id !== songId) } : p));
  await savePlaylists(next);
  return next;
}
export async function deletePlaylist(id: string): Promise<Playlist[]> {
  const next = (await loadPlaylists()).filter((p) => p.id !== id);
  await savePlaylists(next);
  return next;
}

// ------------------------------------------------------------ the player (one for the whole app)

export type Repeat = "off" | "all" | "one";
export interface PlayerState {
  song: Song | null;
  queue: Song[];
  index: number;
  playing: boolean;
  position: number;
  duration: number;
  volume: number;
  shuffle: boolean;
  repeat: Repeat;
  error: string | null;
}

const audio = typeof Audio !== "undefined" ? new Audio() : null;
if (audio) {
  audio.preload = "auto";
  audio.crossOrigin = "anonymous";
}
const state: PlayerState = { song: null, queue: [], index: -1, playing: false, position: 0, duration: 0, volume: 0.9, shuffle: false, repeat: "off", error: null };
const listeners = new Set<(s: PlayerState) => void>();
const emit = () => {
  for (const l of listeners) l({ ...state });
};
function nextIndex(): number {
  if (state.repeat === "one") return state.index;
  if (state.shuffle && state.queue.length > 1) {
    let i = state.index;
    while (i === state.index) i = Math.floor(Math.random() * state.queue.length);
    return i;
  }
  if (state.index + 1 < state.queue.length) return state.index + 1;
  return state.repeat === "all" ? 0 : -1;
}
if (audio) {
  audio.volume = state.volume;
  audio.addEventListener("timeupdate", () => {
    state.position = audio.currentTime;
    state.duration = audio.duration || state.song?.duration || 0;
    emit();
  });
  audio.addEventListener("play", () => {
    state.playing = true;
    emit();
  });
  audio.addEventListener("pause", () => {
    state.playing = false;
    emit();
  });
  audio.addEventListener("ended", () => {
    const n = nextIndex();
    if (n >= 0) void playAt(n);
    else {
      state.playing = false;
      emit();
    }
  });
  audio.addEventListener("error", () => {
    state.error = "This song could not be played (no internet, or the stream is gone).";
    state.playing = false;
    emit();
  });
}

export const player = {
  subscribe(l: (s: PlayerState) => void): () => void {
    listeners.add(l);
    l({ ...state });
    return () => listeners.delete(l);
  },
  /** Plays a song now; `queue` (optional) becomes the list it plays through. */
  async play(song: Song, queue?: Song[]) {
    if (queue && queue.length) {
      state.queue = queue;
      state.index = Math.max(0, queue.findIndex((s) => s.id === song.id));
    } else {
      const i = state.queue.findIndex((s) => s.id === song.id);
      if (i >= 0) state.index = i;
      else {
        state.queue = [...state.queue.slice(0, state.index + 1), song, ...state.queue.slice(state.index + 1)];
        state.index += 1;
      }
    }
    await playAt(state.index);
  },
  /** Plays a whole list from its first song (or a random one when shuffling). */
  async playAll(songs: Song[]) {
    if (!songs.length) return;
    const start = state.shuffle ? Math.floor(Math.random() * songs.length) : 0;
    await player.play(songs[start], songs);
  },
  enqueue(song: Song) {
    if (state.queue.some((s) => s.id === song.id)) return;
    state.queue = [...state.queue, song];
    if (!state.song) void playAt(0);
    else emit();
  },
  toggle() {
    if (!audio || !state.song) return;
    if (audio.paused) void audio.play().catch(() => {});
    else audio.pause();
  },
  next() {
    const n = state.repeat === "one" ? (state.index + 1 < state.queue.length ? state.index + 1 : state.repeat === "one" ? state.index : -1) : nextIndex();
    if (n >= 0) void playAt(n);
  },
  prev() {
    if (audio && audio.currentTime > 4) {
      audio.currentTime = 0;
      return;
    }
    if (state.index > 0) void playAt(state.index - 1);
    else if (state.repeat === "all" && state.queue.length) void playAt(state.queue.length - 1);
  },
  seek(seconds: number) {
    if (audio && state.song) audio.currentTime = Math.max(0, Math.min(seconds, state.duration || seconds));
  },
  setVolume(v: number) {
    state.volume = Math.max(0, Math.min(1, v));
    if (audio) audio.volume = state.volume;
    emit();
  },
  setShuffle(on: boolean) {
    state.shuffle = on;
    emit();
  },
  setRepeat(mode: Repeat) {
    state.repeat = mode;
    emit();
  },
  stop() {
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    state.song = null;
    state.playing = false;
    state.position = 0;
    state.duration = 0;
    state.index = -1;
    state.queue = [];
    state.error = null;
    emit();
  },
  removeFromQueue(id: string) {
    const i = state.queue.findIndex((s) => s.id === id);
    if (i < 0) return;
    state.queue = state.queue.filter((s) => s.id !== id);
    if (i < state.index) state.index -= 1;
    emit();
  },
  state: () => ({ ...state }),
};

async function playAt(index: number) {
  if (!audio) return;
  const song = state.queue[index];
  if (!song) return;
  state.index = index;
  state.song = song;
  state.error = null;
  state.position = 0;
  state.duration = song.duration;
  audio.src = song.stream;
  emit();
  try {
    await audio.play();
    void rememberPlayed(song);
  } catch {
    state.error = "This song could not be played.";
    emit();
  }
}

/** Something elsewhere (a song card in a chat) asks for a song to play. */
export function requestPlay(song: Song) {
  window.dispatchEvent(new CustomEvent("lanx:play-song", { detail: song }));
}
