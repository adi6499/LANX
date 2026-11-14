import { useEffect, useState } from "react";
import {
  BatteryCharging,
  BatteryFull,
  BatteryLow,
  BatteryMedium,
  BatteryWarning,
  Cake,
  CalendarDays,
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudMoon,
  CloudRain,
  CloudSnow,
  CloudSun,
  Loader2,
  MapPin,
  Moon,
  Music,
  Pause,
  Play,
  SkipForward,
  Sun,
  Users,
} from "lucide-react";
import { api, errorText } from "../lib/api";
import { type Battery, type KeptWeather, type Place, type Sky, WIDGETS, birthdayLine, degrees, entryLine, nextEntry, weatherFor, weatherWords } from "../lib/glance";
import { player } from "../lib/music";
import type { WallScreenPrefs } from "../lib/wallscreen";
import type { Occurrence } from "../types";

/** LANX 3.15.0: the small things under the wallpaper screen's clock, like the widgets of a
 *  phone's lock screen: battery, weather, the next calendar entry, colleagues online, the
 *  song playing, birthdays. Each can be switched off; one that has nothing to say (no
 *  battery in this PC, no entry this week, nothing playing) simply is not there.
 *  Plain, even panels: no glow, no bands. */

const CHIP: React.CSSProperties = { background: "rgba(20, 20, 26, 0.52)", border: "1px solid rgba(255, 255, 255, 0.13)" };
const ICON = "h-[1.25em] w-[1.25em] shrink-0";

function Chip({ id, title, children, onClick }: { id: string; title?: string; children: React.ReactNode; onClick?: () => void }) {
  const cls = "flex max-w-[min(440px,86vw)] items-center gap-[0.55em] rounded-[1.05em] px-[0.95em] py-[0.55em] font-semibold";
  if (onClick)
    return (
      <button type="button" data-wall-widget={id} title={title} onClick={onClick} className={`${cls} pointer-events-auto text-left hover:brightness-125`} style={CHIP}>
        {children}
      </button>
    );
  return (
    <div data-wall-widget={id} title={title} className={cls} style={CHIP}>
      {children}
    </div>
  );
}

function SkyIcon({ sky, day }: { sky: Sky; day: boolean }) {
  if (sky === "clear") return day ? <Sun className={ICON} /> : <Moon className={ICON} />;
  if (sky === "partly") return day ? <CloudSun className={ICON} /> : <CloudMoon className={ICON} />;
  if (sky === "fog") return <CloudFog className={ICON} />;
  if (sky === "drizzle") return <CloudDrizzle className={ICON} />;
  if (sky === "rain") return <CloudRain className={ICON} />;
  if (sky === "snow") return <CloudSnow className={ICON} />;
  if (sky === "storm") return <CloudLightning className={ICON} />;
  return <Cloud className={ICON} />;
}

function BatteryIcon({ b }: { b: Battery }) {
  if (b.charging) return <BatteryCharging className={ICON} />;
  if (b.percent <= 10) return <BatteryWarning className={ICON} />;
  if (b.percent <= 35) return <BatteryLow className={ICON} />;
  if (b.percent <= 75) return <BatteryMedium className={ICON} />;
  return <BatteryFull className={ICON} />;
}

const timeOf = (ms: number, hour12: boolean) => {
  const d = new Date(ms);
  const m = String(d.getMinutes()).padStart(2, "0");
  return hour12 ? `${d.getHours() % 12 || 12}:${m} ${d.getHours() < 12 ? "AM" : "PM"}` : `${String(d.getHours()).padStart(2, "0")}:${m}`;
};

export function WallWidgets({ prefs, now, online, birthdays, onChoosePlace }: { prefs: WallScreenPrefs; now: Date; online: number; birthdays: string[]; onChoosePlace: () => void }) {
  const w = prefs.widgets;
  const [battery, setBattery] = useState<Battery | null>(null);
  const [weather, setWeather] = useState<KeptWeather | null>(null);
  const [entries, setEntries] = useState<Occurrence[]>([]);
  const [song, setSong] = useState<{ title: string; artist: string; playing: boolean } | null>(null);

  // The battery: now, and once a minute.
  useEffect(() => {
    if (!w.battery) return setBattery(null);
    let alive = true;
    const read = () => void api.batteryStatus().then((b) => alive && setBattery(b), () => alive && setBattery(null));
    read();
    const id = window.setInterval(read, 60000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [w.battery]);

  // The weather: kept for half an hour; looked at again every ten minutes (and at once for a new place).
  const place = prefs.place;
  const placeKey = place ? `${place.lat},${place.lon},${prefs.fahrenheit}` : "";
  useEffect(() => {
    setWeather(null);
    if (!w.weather || !place) return;
    let alive = true;
    const read = () => void weatherFor(place, prefs.fahrenheit).then((k) => alive && setWeather(k));
    read();
    const id = window.setInterval(read, 600000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [w.weather, placeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // The calendar: the week ahead, read again every five minutes.
  useEffect(() => {
    if (!w.calendar) return setEntries([]);
    let alive = true;
    const read = () => {
      const t = Math.floor(Date.now() / 1000);
      void api.listEvents(t - 86400, t + 7 * 86400).then((list) => alive && setEntries(list), () => {});
    };
    read();
    const id = window.setInterval(read, 300000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [w.calendar]);

  // The song playing (told only when the song or play/pause changes, not every second of it).
  useEffect(() => {
    if (!w.music) return setSong(null);
    return player.subscribe((s) => {
      const next = s.song ? { title: s.song.title, artist: s.song.artist, playing: s.playing } : null;
      setSong((cur) => (cur?.title === next?.title && cur?.artist === next?.artist && cur?.playing === next?.playing ? cur : next));
    });
  }, [w.music]);

  const entry = w.calendar ? nextEntry(entries, now) : null;
  const words = weather ? weatherWords(weather.weather.code) : null;
  const stale = weather ? now.getTime() - weather.at > 45 * 60000 : false;
  const bday = w.birthdays ? birthdayLine(birthdays) : "";

  const chips: React.ReactNode[] = [];
  if (w.weather && place && weather && words)
    chips.push(
      <Chip key="weather" id="weather" title={`${place.name}${place.region ? `, ${place.region}` : ""} · weather from Open-Meteo.com`}>
        <SkyIcon sky={words.sky} day={weather.weather.day} />
        <span data-wall-weather-temp>{degrees(weather.weather.temp)}</span>
        <span className="truncate font-medium opacity-85">
          {words.text} · {place.name}
          {weather.weather.high !== null && weather.weather.low !== null ? ` · ${degrees(weather.weather.high)} / ${degrees(weather.weather.low)}` : ""}
          {stale ? ` · as of ${timeOf(weather.at, prefs.hour12)}` : ""}
        </span>
      </Chip>,
    );
  else if (w.weather && !place)
    chips.push(
      <Chip key="weather" id="weather-ask" title="Choose the place the weather is shown for" onClick={onChoosePlace}>
        <MapPin className={ICON} />
        <span className="font-medium opacity-90">Choose a place for the weather</span>
      </Chip>,
    );
  if (entry)
    chips.push(
      <Chip key="calendar" id="calendar" title={entry.event.location || undefined}>
        <CalendarDays className={ICON} />
        <span className="truncate">{entryLine(entry, now, prefs.hour12)}</span>
      </Chip>,
    );
  if (w.battery && battery)
    chips.push(
      <Chip key="battery" id="battery" title={battery.charging ? "Charging" : battery.plugged ? "Plugged in" : "On battery"}>
        <BatteryIcon b={battery} />
        <span>{battery.percent}%</span>
        {battery.charging && <span className="font-medium opacity-85">charging</span>}
      </Chip>,
    );
  if (w.people)
    chips.push(
      <Chip key="people" id="people">
        <Users className={ICON} />
        <span>{online === 0 ? "No colleagues online" : `${online} colleague${online === 1 ? "" : "s"} online`}</span>
      </Chip>,
    );
  if (bday)
    chips.push(
      <Chip key="birthdays" id="birthdays">
        <Cake className={ICON} />
        <span className="truncate">{bday}</span>
      </Chip>,
    );
  if (w.music && song)
    chips.push(
      <div key="music" data-wall-widget="music" className="pointer-events-auto flex max-w-[min(480px,86vw)] items-center gap-[0.55em] rounded-[1.05em] py-[0.3em] pl-[0.95em] pr-[0.35em] font-semibold" style={CHIP}>
        <Music className={ICON} />
        <span className="truncate">
          {song.title}
          <span className="font-medium opacity-80"> · {song.artist}</span>
        </span>
        <button type="button" data-wall-music-toggle title={song.playing ? "Pause" : "Play"} onClick={() => player.toggle()} className="flex h-[2.1em] w-[2.1em] shrink-0 items-center justify-center rounded-full hover:bg-white/15">
          {song.playing ? <Pause className="h-[1.05em] w-[1.05em]" /> : <Play className="h-[1.05em] w-[1.05em]" />}
        </button>
        <button type="button" data-wall-music-next title="Next song" onClick={() => player.next()} className="flex h-[2.1em] w-[2.1em] shrink-0 items-center justify-center rounded-full hover:bg-white/15">
          <SkipForward className="h-[1.05em] w-[1.05em]" />
        </button>
      </div>,
    );

  if (!chips.length) return null;
  return (
    <div data-wall-widgets className="flex max-w-[1100px] flex-wrap items-center justify-center gap-[0.6em]" style={{ marginTop: "3.4vh", fontSize: "clamp(13px, 1.95vh, 20px)", textShadow: "none" }}>
      {chips}
    </div>
  );
}

// ------------------------------------------------------------------ the sheet

const PANEL: React.CSSProperties = { background: "rgba(20, 20, 26, 0.86)", border: "1px solid rgba(255, 255, 255, 0.12)" };

export function WidgetsSheet({ prefs, onPick }: { prefs: WallScreenPrefs; onPick: (p: WallScreenPrefs) => void }) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<Place[] | null>(null);
  const [problem, setProblem] = useState("");

  const find = async () => {
    if (busy || query.trim().length < 2) return;
    setBusy(true);
    setProblem("");
    setFound(null);
    try {
      setFound(await api.weatherPlaces(query));
    } catch (e) {
      setProblem(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const choose = (place: Place | null) => {
    onPick({ ...prefs, place, widgets: place ? { ...prefs.widgets, weather: true } : prefs.widgets });
    setFound(null);
    setQuery("");
    setProblem("");
  };

  return (
    <div data-wallscreen-sheet="widgets" className="absolute left-1/2 max-h-[calc(100vh-120px)] -translate-x-1/2 overflow-y-auto rounded-[22px] p-5 lanx-wallscreen-rise" style={{ ...PANEL, bottom: 88, width: "min(480px, calc(100vw - 48px))" }} onClick={(e) => e.stopPropagation()}>
      <div className="mb-1 text-[13px] font-semibold text-white/90">Under the clock</div>
      <div>
        {WIDGETS.map((wd) => (
          <div key={wd.id} className="flex min-h-10 items-center justify-between gap-4 py-1 text-[13px] text-white/85" title={wd.hint}>
            <span>{wd.name}</span>
            <button
              type="button"
              role="switch"
              aria-checked={prefs.widgets[wd.id]}
              data-wallscreen-switch={`widget-${wd.id}`}
              data-on={prefs.widgets[wd.id] ? "yes" : "no"}
              onClick={() => onPick({ ...prefs, widgets: { ...prefs.widgets, [wd.id]: !prefs.widgets[wd.id] } })}
              className="relative h-6 w-10 shrink-0 rounded-full transition-colors"
              style={{ background: prefs.widgets[wd.id] ? "#34c759" : "rgba(255, 255, 255, 0.22)" }}
            >
              <span className="absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all" style={{ left: prefs.widgets[wd.id] ? 18 : 2 }} />
            </button>
          </div>
        ))}
      </div>

      <div className="mt-3 border-t border-white/10 pt-3">
        <div className="flex items-center justify-between gap-3 text-[13px] text-white/85">
          <span>
            Weather for{" "}
            <b data-wall-place className="font-semibold text-white">
              {prefs.place ? `${prefs.place.name}${prefs.place.region ? `, ${prefs.place.region}` : ""}` : "no place yet"}
            </b>
          </span>
          <div className="flex shrink-0 rounded-[10px] p-0.5" style={{ background: "rgba(255, 255, 255, 0.08)" }}>
            {[false, true].map((f) => (
              <button key={String(f)} type="button" data-wall-unit={f ? "f" : "c"} onClick={() => onPick({ ...prefs, fahrenheit: f })} className="rounded-[8px] px-2.5 py-1 text-[12px] font-semibold" style={prefs.fahrenheit === f ? { background: "#fff", color: "#0f172a" } : { color: "rgba(255, 255, 255, 0.75)" }}>
                {f ? "°F" : "°C"}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-2 flex gap-2">
          <input
            data-wall-place-input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void find();
            }}
            placeholder="Town or city"
            spellCheck={false}
            className="h-10 min-w-0 flex-1 rounded-[12px] px-3 text-[13px] text-white outline-none placeholder:text-white/40"
            style={{ background: "rgba(255, 255, 255, 0.08)", border: "1px solid rgba(255, 255, 255, 0.12)" }}
          />
          <button type="button" data-wall-place-find onClick={() => void find()} disabled={busy || query.trim().length < 2} className="flex h-10 items-center gap-2 rounded-[12px] bg-white px-4 text-[13px] font-semibold text-slate-900 disabled:opacity-40">
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Find
          </button>
        </div>
        {found && (
          <div className="mt-2 space-y-1">
            {found.map((pl) => (
              <button key={`${pl.lat},${pl.lon}`} type="button" data-wall-place-pick onClick={() => choose(pl)} className="flex w-full items-center gap-2 rounded-[11px] px-3 py-2 text-left text-[13px] text-white hover:bg-white/10" style={{ background: "rgba(255, 255, 255, 0.06)" }}>
                <MapPin className="h-3.5 w-3.5 shrink-0 opacity-70" />
                <span className="truncate">
                  <b className="font-semibold">{pl.name}</b>
                  {pl.region && <span className="text-white/65"> · {pl.region}</span>}
                </span>
              </button>
            ))}
          </div>
        )}
        {problem && (
          <p data-wall-place-problem className="mt-2 text-[12px] text-rose-300">
            {problem}
          </p>
        )}
        {prefs.place && !found && (
          <button type="button" data-wall-place-clear onClick={() => choose(null)} className="mt-2 text-[12px] font-semibold text-white/60 hover:text-white">
            Forget this place
          </button>
        )}
        <p className="mt-3 text-[11.5px] leading-relaxed text-white/50">
          The weather is the only thing here that uses the internet. LANX asks Open-Meteo.com (a free weather service, no account) for the place you choose, and sends it nothing else. Weather data by Open-Meteo.com.
        </p>
      </div>
    </div>
  );
}
