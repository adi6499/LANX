import React, { useEffect, useRef, useState } from "react";
import { Check, Laptop, Moon, Sparkles, Sun } from "lucide-react";
import { UserSettings } from "../types";
import {
  ACCENT_PRESETS,
  BACKGROUND_PRESETS,
  GLASS_PRESETS,
  accentSwatch,
  applyAppearance,
  isCustomColor,
  backgroundCss,
} from "../lib/background";
import { Origin, originOf, revealChange, setMotion } from "../lib/motion";

type Patch = Partial<Pick<UserSettings, "chat_background" | "accent_color" | "glass_level" | "frost_level" | "reduce_motion" | "cat_alerts">>;

interface AppearancePanelProps {
  form: UserSettings;
  onTheme: (theme: "system" | "dark" | "light", origin: Origin) => void;
  /** Saves at once; the whole app follows. */
  onChange: (patch: Patch) => void;
}

const Section: React.FC<{ title: string; hint?: string; children: React.ReactNode }> = ({ title, hint, children }) => (
  <section>
    <div className="mb-2 px-1 flex items-baseline justify-between gap-3">
      <h4 className="text-[13px] font-semibold text-slate-900 dark:text-white">{title}</h4>
      {hint && <span className="text-[11px] text-slate-500 dark:text-slate-400">{hint}</span>}
    </div>
    <div className="rounded-[14px] lanx-group p-3.5">{children}</div>
  </section>
);

/** A miniature LANX that uses the real theme, so every change shows here at once. */
const LivePreview: React.FC = () => (
  <div className="relative h-44 rounded-[16px] overflow-hidden lanx-window ring-1 ring-black/5 dark:ring-white/10" data-appearance-preview>
    {/* shapes behind the glass, so you can see the frost */}
    <span className="absolute left-[20%] top-[22%] h-16 w-16 rounded-full bg-sky-500" />
    <span className="absolute left-[3%] bottom-[8%] h-12 w-12 rounded-full" style={{ background: "var(--lanx-tint)" }} />
    <span className="absolute right-[12%] top-[-12%] h-14 w-24 rounded-full bg-sky-300/80" />

    <div className="absolute inset-y-2 left-2 w-[34%] rounded-[12px] lanx-glass p-2 space-y-1.5">
      <div className="h-2.5 w-12 rounded-full bg-slate-400/40" />
      <div className="h-5 rounded-[7px] bg-[var(--lanx-fill)]" />
      {[0, 1, 2].map((i) => (
        <div key={i} className={`flex items-center gap-1.5 rounded-[8px] p-1 ${i === 0 ? "bg-sky-500" : ""}`}>
          <span className={`h-5 w-5 rounded-full shrink-0 ${i === 0 ? "bg-white/80" : ["", "bg-emerald-400", "bg-amber-400"][i]}`} />
          <span className="flex-1 space-y-1">
            <span className={`block h-1.5 w-10 rounded-full ${i === 0 ? "bg-white/90" : "bg-slate-400/60"}`} />
            <span className={`block h-1.5 w-14 rounded-full ${i === 0 ? "bg-white/60" : "bg-slate-400/35"}`} />
          </span>
        </div>
      ))}
    </div>

    <div className="absolute left-[38%] right-0 top-0 h-9 lanx-bar border-b lanx-line flex items-center gap-1.5 px-2.5">
      <span className="h-5 w-5 rounded-full bg-indigo-400" />
      <span className="h-2 w-16 rounded-full bg-slate-400/60" />
    </div>
    <div className="absolute left-[40%] right-3 top-12 space-y-1.5">
      <div className="w-24 h-6 rounded-[10px] rounded-bl-[4px] lanx-bubble-in" />
      <div className="ml-auto w-28 h-6 rounded-[10px] rounded-br-[4px] bg-sky-500" />
      <div className="w-16 h-6 rounded-[10px] rounded-bl-[4px] lanx-bubble-in" />
    </div>
    <div className="absolute left-[38%] right-0 bottom-0 h-10 lanx-bar border-t lanx-line flex items-center px-2.5 gap-2">
      <span className="flex-1 h-5 rounded-full bg-[color-mix(in_srgb,var(--lanx-surface)_70%,transparent)] shadow-[inset_0_0_0_1px_var(--lanx-line)]" />
      <span className="h-5 w-5 rounded-full bg-sky-500" />
    </div>
  </div>
);

const ThemeThumb: React.FC<{ mode: "light" | "dark" }> = ({ mode }) => {
  const dark = mode === "dark";
  return (
    <span className={`absolute inset-0 ${dark ? "bg-[#15171c]" : "bg-[#eef1f6]"}`}>
      <span className={`absolute inset-y-1.5 left-1.5 w-[34%] rounded-[6px] ${dark ? "bg-white/10" : "bg-white/90"}`} />
      <span className={`absolute left-[42%] top-3 h-2.5 w-[34%] rounded-full ${dark ? "bg-white/15" : "bg-white"}`} />
      <span className="absolute right-2 top-7 h-2.5 w-[30%] rounded-full bg-sky-500" />
      <span className={`absolute left-[42%] top-11 h-2.5 w-[26%] rounded-full ${dark ? "bg-white/15" : "bg-white"}`} />
    </span>
  );
};

export const AppearancePanel: React.FC<AppearancePanelProps> = ({ form, onTheme, onChange }) => {
  const [glass, setGlass] = useState(form.glass_level);
  const [frost, setFrost] = useState(form.frost_level);
  const timer = useRef<number | undefined>(undefined);
  const dark = typeof document !== "undefined" && document.documentElement.classList.contains("dark");

  useEffect(() => {
    setGlass(form.glass_level);
    setFrost(form.frost_level);
  }, [form.glass_level, form.frost_level]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  // Sliders: the app follows while you drag; saved once you stop.
  const liveGlass = (g: number, f: number) => {
    setGlass(g);
    setFrost(f);
    applyAppearance({ ...form, glass_level: g, frost_level: f });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => onChange({ glass_level: g, frost_level: f }), 350);
  };

  /** Background, accent and glass presets change with the glass reveal
   *  (from the tile you pressed) or a soft cross-fade. */
  const pick = (patch: Patch, origin: Origin) => {
    revealChange(() => applyAppearance({ ...form, ...patch }), origin);
    onChange(patch);
  };
  const pickGlass = (g: number, f: number) => {
    setGlass(g);
    setFrost(f);
    window.clearTimeout(timer.current);
    pick({ glass_level: g, frost_level: f }, null);
  };

  const background = form.chat_background || "default";
  const accent = form.accent_color || "default";
  const preset = GLASS_PRESETS.find((p) => p.glass === glass && p.frost === frost)?.id;

  return (
    <div className="space-y-5" data-appearance>
      <LivePreview />

      <Section title="Appearance">
        <div className="grid grid-cols-3 gap-3">
          {(
            [
              ["system", "Auto", Laptop],
              ["light", "Light", Sun],
              ["dark", "Dark", Moon],
            ] as const
          ).map(([key, label, Icon]) => {
            const on = form.theme === key;
            return (
              <button key={key} type="button" onClick={(e) => onTheme(key, originOf(e))} title={key === "system" ? "Match Windows" : label} className="group flex flex-col items-center gap-1.5">
                <span
                  className={`relative block h-16 w-full rounded-[10px] overflow-hidden transition-all ${
                    on ? "ring-[3px] ring-sky-500 ring-offset-2 ring-offset-transparent" : "ring-1 ring-black/10 dark:ring-white/10 group-hover:ring-black/20"
                  }`}
                >
                  {key === "system" ? (
                    <>
                      <ThemeThumb mode="light" />
                      <span className="absolute inset-0 [clip-path:polygon(100%_0,100%_100%,0_100%)]">
                        <ThemeThumb mode="dark" />
                      </span>
                    </>
                  ) : (
                    <ThemeThumb mode={key} />
                  )}
                </span>
                <span className={`flex items-center gap-1 text-[11px] font-medium ${on ? "text-slate-900 dark:text-white" : "text-slate-500 dark:text-slate-400"}`}>
                  <Icon className="h-3 w-3" /> {label}
                </span>
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Accent colour" hint={isCustomColor(accent) ? "Your colour" : ACCENT_PRESETS.find((p) => p.id === accent)?.label}>
        <div className="flex flex-wrap items-center gap-3" data-accent-picker>
          {ACCENT_PRESETS.map((p) => {
            const on = accent === p.id;
            return (
              <button
                key={p.id}
                type="button"
                title={p.label}
                onClick={() => pick({ accent_color: p.id }, null)}
                className={`relative h-[26px] w-[26px] rounded-full transition-transform hover:scale-110 active:scale-95 shadow-[inset_0_0_0_1px_rgb(0_0_0/0.12)] ${
                  on ? "ring-2 ring-offset-2 ring-offset-white dark:ring-offset-[#24262c]" : ""
                }`}
                style={{ background: p.color, ["--tw-ring-color" as string]: p.color }}
              >
                {on && <span className="absolute inset-0 m-auto h-2 w-2 rounded-full bg-white" />}
              </button>
            );
          })}
          <label
            title="Pick any colour"
            className={`relative h-[26px] w-[26px] rounded-full cursor-pointer transition-transform hover:scale-110 ${
              isCustomColor(accent) ? "ring-2 ring-offset-2 ring-offset-white dark:ring-offset-[#24262c]" : ""
            }`}
            style={{
              background: isCustomColor(accent)
                ? accent
                : "conic-gradient(#ef4444, #f59e0b, #22c55e, #06b6d4, #3b82f6, #a855f7, #ef4444)",
              ["--tw-ring-color" as string]: accentSwatch(accent),
            }}
          >
            {isCustomColor(accent) && <span className="absolute inset-0 m-auto h-2 w-2 rounded-full bg-white" />}
            <input
              type="color"
              aria-label="Pick any accent colour"
              value={isCustomColor(accent) ? accent : "#0ea5e9"}
              onChange={(e) => onChange({ accent_color: e.target.value })}
              className="absolute inset-0 opacity-0 cursor-pointer"
            />
          </label>
        </div>
        <p className="mt-3 text-[11px] text-slate-500 dark:text-slate-400">Your message bubbles, buttons, switches and highlights.</p>
      </Section>

      <Section title="Background" hint={isCustomColor(background) ? "Your colour" : BACKGROUND_PRESETS.find((p) => p.id === background)?.label}>
        <div className="grid grid-cols-6 gap-2.5" data-bg-picker>
          {BACKGROUND_PRESETS.map((p) => {
            const on = background === p.id;
            return (
              <button key={p.id} type="button" title={p.label} onClick={(e) => pick({ chat_background: p.id }, originOf(e))} className="group flex flex-col items-center gap-1">
                <span
                  className={`relative block h-12 w-full rounded-[11px] transition-all ${
                    on ? "ring-[3px] ring-sky-500 ring-offset-2 ring-offset-transparent" : "ring-1 ring-black/10 dark:ring-white/10 group-hover:scale-[1.04]"
                  }`}
                  style={{ background: backgroundCss(p.id, dark) }}
                >
                  {on && (
                    <span className="absolute inset-0 m-auto h-5 w-5 rounded-full bg-white/90 shadow flex items-center justify-center">
                      <Check className="h-3 w-3 text-slate-800" strokeWidth={3} />
                    </span>
                  )}
                </span>
                <span className="text-[10px] font-medium text-slate-600 dark:text-slate-300">{p.label}</span>
              </button>
            );
          })}
        </div>
        <label
          className={`mt-3 flex items-center justify-between gap-3 rounded-[12px] px-3 py-2.5 cursor-pointer transition-colors ${
            isCustomColor(background) ? "bg-sky-500/10 shadow-[inset_0_0_0_1.5px_var(--color-sky-500)]" : "hover:bg-[var(--lanx-fill)]"
          }`}
        >
          <span>
            <span className="block text-xs font-semibold text-slate-800 dark:text-slate-200">Pick any colour</span>
            <span className="block text-[11px] text-slate-500 dark:text-slate-400">LANX turns it into a soft background so text stays easy to read.</span>
          </span>
          <input
            type="color"
            aria-label="Pick any background colour"
            value={isCustomColor(background) ? background : "#38bdf8"}
            onChange={(e) => onChange({ chat_background: e.target.value })}
            className="h-9 w-14 shrink-0 cursor-pointer rounded-lg border-0 bg-transparent"
          />
        </label>
      </Section>

      <Section title="Glass" hint="How the panels let your background through">
        <div className="flex rounded-[10px] bg-[var(--lanx-fill)] p-[3px] mb-4" data-glass-presets>
          {GLASS_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => pickGlass(p.glass, p.frost)}
              className={`flex-1 py-1.5 rounded-[8px] text-[11px] font-semibold transition-all ${
                preset === p.id
                  ? "bg-white dark:bg-white/15 text-slate-900 dark:text-white shadow-[0_1px_3px_rgb(0_0_0/0.12)]"
                  : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <label className="block">
          <span className="flex items-center justify-between text-xs font-semibold text-slate-800 dark:text-slate-200">
            Transparency <span className="tabular-nums text-[11px] font-medium text-slate-500">{glass === 0 ? "Solid" : `${glass}%`}</span>
          </span>
          <input
            type="range"
            min={0}
            max={100}
            value={glass}
            aria-label="Glass transparency"
            onChange={(e) => liveGlass(Number(e.target.value), frost)}
            className="lanx-range mt-2.5 w-full"
            style={{ ["--fill" as string]: `${glass}%` }}
          />
          <span className="mt-1 flex justify-between text-[10px] text-slate-400">
            <span>Solid</span>
            <span>Clear</span>
          </span>
        </label>

        <label className={`block mt-4 transition-opacity ${glass === 0 ? "opacity-40" : ""}`}>
          <span className="flex items-center justify-between text-xs font-semibold text-slate-800 dark:text-slate-200">
            Frost <span className="tabular-nums text-[11px] font-medium text-slate-500">{frost}%</span>
          </span>
          <input
            type="range"
            min={0}
            max={100}
            value={frost}
            disabled={glass === 0}
            aria-label="Frost amount"
            onChange={(e) => liveGlass(glass, Number(e.target.value))}
            className="lanx-range mt-2.5 w-full disabled:cursor-not-allowed"
            style={{ ["--fill" as string]: `${frost}%` }}
          />
          <span className="mt-1 flex justify-between text-[10px] text-slate-400">
            <span>Clear glass</span>
            <span>Frosted</span>
          </span>
        </label>
        <p className="mt-3 text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
          {glass === 0
            ? "Solid panels: no see-through effect. Easiest to read and lightest on older computers."
            : "Slide Transparency to the left for solid panels, or press Solid, if LANX ever feels slow on an older computer."}
        </p>
      </Section>

      <Section title="Motion">
        <label className="flex items-start justify-between gap-4 cursor-pointer" data-motion-toggle>
          <span className="flex items-start gap-2.5">
            <span className="mt-0.5 h-7 w-7 shrink-0 rounded-[8px] bg-gradient-to-br from-sky-400 to-indigo-500 text-white flex items-center justify-center shadow-sm">
              <Sparkles className="h-3.5 w-3.5" />
            </span>
            <span>
              <span className="block text-xs font-semibold text-slate-800 dark:text-slate-200">Animations</span>
              <span className="block text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
                Windows spring open, messages glide in and colours change with a glass reveal. Turn off on a slower computer.
              </span>
            </span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={!form.reduce_motion}
            aria-label="Animations"
            onClick={() => {
              setMotion(!form.reduce_motion);
              onChange({ reduce_motion: !form.reduce_motion });
            }}
            className={`relative mt-0.5 h-[22px] w-[38px] shrink-0 rounded-full transition-colors duration-200 ${
              !form.reduce_motion ? "bg-sky-500" : "bg-[var(--lanx-fill-2)]"
            }`}
          >
            <span
              className={`absolute top-[2px] h-[18px] w-[18px] rounded-full bg-white shadow-[0_2px_4px_rgb(0_0_0/0.2),0_0_0_0.5px_rgb(0_0_0/0.04)] transition-all duration-200 ease-[cubic-bezier(.3,.7,.3,1)] ${
                !form.reduce_motion ? "left-[18px]" : "left-[2px]"
              }`}
            />
          </button>
        </label>
        <label className="mt-3 pt-3 border-t lanx-line flex items-start justify-between gap-4 cursor-pointer" data-cat-toggle>
          <span className="flex items-start gap-2.5">
            <span className="mt-0.5 h-7 w-7 shrink-0 rounded-[8px] bg-gradient-to-br from-amber-300 to-orange-500 text-[15px] flex items-center justify-center shadow-sm">
              🐱
            </span>
            <span>
              <span className="block text-xs font-semibold text-slate-800 dark:text-slate-200">Delivery cat</span>
              <span className="block text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
                When someone sends you a file, a cat in a parcel box drops down from the top to ask you to accept it.
              </span>
            </span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={form.cat_alerts}
            aria-label="Delivery cat"
            onClick={() => onChange({ cat_alerts: !form.cat_alerts })}
            className={`relative mt-0.5 h-[22px] w-[38px] shrink-0 rounded-full transition-colors duration-200 ${
              form.cat_alerts ? "bg-sky-500" : "bg-[var(--lanx-fill-2)]"
            }`}
          >
            <span
              className={`absolute top-[2px] h-[18px] w-[18px] rounded-full bg-white shadow-[0_2px_4px_rgb(0_0_0/0.2),0_0_0_0.5px_rgb(0_0_0/0.04)] transition-all duration-200 ease-[cubic-bezier(.3,.7,.3,1)] ${
                form.cat_alerts ? "left-[18px]" : "left-[2px]"
              }`}
            />
          </button>
        </label>
      </Section>

      <p className="px-1 text-[11px] text-slate-500 dark:text-slate-400">Changes apply at once, everywhere in LANX, and are saved automatically.</p>
    </div>
  );
};
