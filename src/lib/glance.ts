/** LANX 3.15.0: the small things the wallpaper screen shows under its clock — the battery,
 *  the weather, the next calendar entry, colleagues online, the song playing, birthdays.
 *  This file holds what they are and how they read; the screen draws them
 *  (components/WallWidgets.tsx). Only the weather uses the internet, and only once a
 *  place has been chosen. */
import { api } from "./api";
import type { Occurrence } from "../types";

export interface Battery {
  percent: number;
  charging: boolean;
  plugged: boolean;
}
export interface Place {
  name: string;
  region: string;
  lat: number;
  lon: number;
}
export interface Weather {
  temp: number;
  code: number;
  day: boolean;
  high: number | null;
  low: number | null;
}

export type WidgetId = "battery" | "weather" | "calendar" | "people" | "music" | "birthdays";
export const WIDGETS: { id: WidgetId; name: string; hint: string }[] = [
  { id: "battery", name: "Battery", hint: "How full it is and whether it is charging. Hidden on a PC without a battery." },
  { id: "weather", name: "Weather", hint: "For a place you choose. The only one that uses the internet." },
  { id: "calendar", name: "Next in your calendar", hint: "Your next entry in LANX’s calendar, up to a week ahead." },
  { id: "people", name: "Colleagues online", hint: "How many colleagues LANX sees right now." },
  { id: "music", name: "Music", hint: "The song that is playing in LANX, with pause and next." },
  { id: "birthdays", name: "Birthdays today", hint: "Colleagues whose birthday is today." },
];
export type WidgetChoice = Record<WidgetId, boolean>;
export const DEFAULT_WIDGETS: WidgetChoice = { battery: true, weather: true, calendar: true, people: true, music: true, birthdays: true };

export function cleanWidgets(v: unknown): WidgetChoice {
  const o = (v && typeof v === "object" ? v : {}) as Partial<WidgetChoice>;
  const out = { ...DEFAULT_WIDGETS };
  for (const w of WIDGETS) if (typeof o[w.id] === "boolean") out[w.id] = o[w.id] as boolean;
  return out;
}
export function cleanPlace(v: unknown): Place | null {
  const o = (v && typeof v === "object" ? v : null) as Partial<Place> | null;
  if (!o || typeof o.name !== "string" || !o.name.trim()) return null;
  const lat = Number(o.lat);
  const lon = Number(o.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { name: o.name.slice(0, 60), region: typeof o.region === "string" ? o.region.slice(0, 80) : "", lat, lon };
}

// ------------------------------------------------------------------ the weather in words

export type Sky = "clear" | "partly" | "cloudy" | "fog" | "drizzle" | "rain" | "snow" | "storm";
/** A weather code of the World Meteorological Organization as a few plain words. */
export function weatherWords(code: number): { text: string; sky: Sky } {
  if (code === 0) return { text: "Clear", sky: "clear" };
  if (code === 1) return { text: "Mostly clear", sky: "partly" };
  if (code === 2) return { text: "Partly cloudy", sky: "partly" };
  if (code === 3) return { text: "Cloudy", sky: "cloudy" };
  if (code === 45 || code === 48) return { text: "Fog", sky: "fog" };
  if (code >= 51 && code <= 57) return { text: "Drizzle", sky: "drizzle" };
  if (code >= 61 && code <= 67) return { text: code >= 65 ? "Heavy rain" : "Rain", sky: "rain" };
  if (code >= 71 && code <= 77) return { text: "Snow", sky: "snow" };
  if (code >= 80 && code <= 82) return { text: "Showers", sky: "rain" };
  if (code === 85 || code === 86) return { text: "Snow showers", sky: "snow" };
  if (code >= 95 && code <= 99) return { text: "Thunderstorm", sky: "storm" };
  return { text: "Cloudy", sky: "cloudy" };
}
export const degrees = (v: number) => `${Math.round(v)}°`;

/** The weather kept from the last time it could be fetched, with when that was. */
export interface KeptWeather {
  key: string;
  at: number;
  weather: Weather;
}
export const weatherKey = (p: Place, fahrenheit: boolean) => `${p.lat.toFixed(3)},${p.lon.toFixed(3)},${fahrenheit ? "f" : "c"}`;
/** How long a kept answer is fresh, and how long it may still be shown ("as of 14:20"). */
export const WEATHER_FRESH_MS = 30 * 60000;
export const WEATHER_SHOWN_MS = 3 * 3600000;

export async function loadKeptWeather(): Promise<KeptWeather | null> {
  try {
    const raw = await api.getPref("glance_weather");
    const k = raw ? (JSON.parse(raw) as KeptWeather) : null;
    return k && typeof k.key === "string" && Number.isFinite(k.at) && k.weather && Number.isFinite(k.weather.temp) ? k : null;
  } catch {
    return null;
  }
}
/** The weather for a place: the kept answer while it is fresh, else a new one (kept for next time).
 *  When it cannot be fetched, the kept one if it is not too old, else nothing. */
export async function weatherFor(place: Place, fahrenheit: boolean, now = Date.now()): Promise<KeptWeather | null> {
  const key = weatherKey(place, fahrenheit);
  const kept = await loadKeptWeather();
  const mine = kept && kept.key === key ? kept : null;
  if (mine && now - mine.at < WEATHER_FRESH_MS) return mine;
  try {
    const weather = await api.weatherNow(place.lat, place.lon, fahrenheit);
    const fresh: KeptWeather = { key, at: now, weather };
    void api.setPref("glance_weather", JSON.stringify(fresh)).catch(() => {});
    return fresh;
  } catch {
    return mine && now - mine.at < WEATHER_SHOWN_MS ? mine : null;
  }
}

// ------------------------------------------------------------------ the calendar

const clockOf = (secs: number, hour12: boolean) => {
  const d = new Date(secs * 1000);
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  return hour12 ? `${h % 12 || 12}:${m} ${h < 12 ? "AM" : "PM"}` : `${String(h).padStart(2, "0")}:${m}`;
};
const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** The entry to show: one going on now, else the next to start; nothing when the week is empty. */
export function nextEntry(list: Occurrence[], now: Date): Occurrence | null {
  const t = now.getTime() / 1000;
  const left = list.filter((o) => o.end > t).sort((a, b) => a.start - b.start || a.end - b.end);
  // (An all-day entry of today gives way to one with a time that is still to come today.)
  const timed = left.find((o) => !o.event.all_day);
  const allDay = left.find((o) => o.event.all_day && o.start <= t);
  if (timed && timed.start * 1000 < dayStart(now) + 86400000) return timed;
  return allDay ?? left[0] ?? null;
}
/** "Stand-up · 11:00", "Now: Stand-up until 11:30", "Tomorrow 09:30 · Review", "Today: Stock count". */
export function entryLine(o: Occurrence, now: Date, hour12: boolean): string {
  const t = now.getTime() / 1000;
  const title = o.event.title.trim() || "Untitled";
  const days = Math.round((dayStart(new Date(o.start * 1000)) - dayStart(now)) / 86400000);
  const day = days <= 0 ? "" : days === 1 ? "Tomorrow" : new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(new Date(o.start * 1000));
  if (o.event.all_day) return `${day || "Today"}: ${title}`;
  if (o.start <= t) return `Now: ${title} until ${clockOf(o.end, hour12)}`;
  return day ? `${day} ${clockOf(o.start, hour12)} · ${title}` : `${title} · ${clockOf(o.start, hour12)}`;
}

/** "Sarah’s birthday today", "Sarah and Marcus have birthdays today", "Sarah, Marcus and 2 more have birthdays today". */
export function birthdayLine(names: string[]): string {
  const first = names.map((n) => n.split(" ")[0]).filter(Boolean);
  if (!first.length) return "";
  if (first.length === 1) return `${first[0]}’s birthday today`;
  if (first.length === 2) return `${first[0]} and ${first[1]} have birthdays today`;
  return `${first[0]}, ${first[1]} and ${first.length - 2} more have birthdays today`;
}
