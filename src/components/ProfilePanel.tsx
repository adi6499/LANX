import React, { useEffect, useRef, useState } from "react";
import { Camera, Check, Copy, ImagePlus, Mail, Phone, Sparkles, Trash2, Type, X } from "lucide-react";
import type { Profile, UserSettings } from "../types";
import { Avatar } from "./Avatar";
import { CHARACTERS, CLEAR_AFTER, EMPTY_PROFILE, STATUS_PRESETS, cropToAvatar, roleLine, statusLine } from "../lib/profile";

const AVATAR_COLORS = [
  "#0284c7", "#6366f1", "#8b5cf6", "#ec4899", "#ef4444", "#f97316",
  "#f59e0b", "#84cc16", "#10b981", "#14b8a6", "#06b6d4", "#64748b",
];

const fieldCls =
  "lanx-field w-full rounded-[10px] px-3 py-2 text-xs text-slate-900 dark:text-white placeholder:text-slate-400 select-text";
const labelCls = "block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1";

const Section: React.FC<{ title: string; hint?: string; children: React.ReactNode }> = ({ title, hint, children }) => (
  <section>
    <div className="mb-2 px-1 flex items-baseline justify-between gap-3">
      <h4 className="text-[13px] font-semibold text-slate-900 dark:text-white">{title}</h4>
      {hint && <span className="text-[11px] text-slate-500 dark:text-slate-400">{hint}</span>}
    </div>
    <div className="rounded-[14px] lanx-group p-3.5">{children}</div>
  </section>
);

/** Zoom and drag a picture inside the circle, then keep a small copy. */
const PhotoCropper: React.FC<{ src: string; onDone: (photo: string) => void; onCancel: () => void }> = ({ src, onDone, onCancel }) => {
  const SIZE = 240;
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);

  const dims = nat
    ? { w: (SIZE * nat.w) / Math.min(nat.w, nat.h) * zoom, h: (SIZE * nat.h) / Math.min(nat.w, nat.h) * zoom }
    : { w: SIZE, h: SIZE };
  const clamp = (o: { x: number; y: number }) => {
    const mx = Math.max(0, (dims.w - SIZE) / 2 / SIZE);
    const my = Math.max(0, (dims.h - SIZE) / 2 / SIZE);
    return { x: Math.min(mx, Math.max(-mx, o.x)), y: Math.min(my, Math.max(-my, o.y)) };
  };
  useEffect(() => setOff((o) => clamp(o)), [zoom, nat]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      onDone(await cropToAvatar(src, zoom, off.x, off.y));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center lanx-scrim p-4" data-photo-cropper>
      <div className="w-full max-w-sm rounded-[22px] lanx-sheet lanx-sheet-in p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[15px] font-semibold text-slate-900 dark:text-white">Your photo</h3>
          <button type="button" onClick={onCancel} className="lanx-tool p-1.5 text-slate-400" title="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-4">Drag to move it, and use the slider to zoom.</p>
        <div
          className="relative mx-auto overflow-hidden rounded-full bg-slate-900/10 cursor-grab active:cursor-grabbing touch-none ring-4 ring-white/70 dark:ring-white/10 shadow-xl"
          style={{ width: SIZE, height: SIZE }}
          onPointerDown={(e) => {
            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
            drag.current = { x: e.clientX, y: e.clientY };
          }}
          onPointerMove={(e) => {
            if (!drag.current) return;
            const dx = (e.clientX - drag.current.x) / SIZE;
            const dy = (e.clientY - drag.current.y) / SIZE;
            drag.current = { x: e.clientX, y: e.clientY };
            setOff((o) => clamp({ x: o.x + dx, y: o.y + dy }));
          }}
          onPointerUp={() => (drag.current = null)}
          onWheel={(e) => setZoom((z) => Math.min(3, Math.max(1, z - e.deltaY / 600)))}
        >
          <img
            src={src}
            alt=""
            draggable={false}
            onLoad={(e) => setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            className="absolute max-w-none select-none pointer-events-none"
            style={{
              width: dims.w,
              height: dims.h,
              left: SIZE / 2 - dims.w / 2 + off.x * SIZE,
              top: SIZE / 2 - dims.h / 2 + off.y * SIZE,
            }}
          />
        </div>
        <label className="mt-5 flex items-center gap-3 text-[11px] text-slate-500">
          <span>Zoom</span>
          <input
            type="range"
            min={1}
            max={3}
            step={0.01}
            value={zoom}
            aria-label="Zoom"
            onChange={(e) => setZoom(Number(e.target.value))}
            className="lanx-range flex-1"
            style={{ ["--fill" as string]: `${((zoom - 1) / 2) * 100}%` }}
          />
        </label>
        {error && <p className="mt-3 text-[11px] text-red-600 dark:text-red-400">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="lanx-btn px-4 py-1.5 rounded-full text-xs font-medium text-slate-700 dark:text-slate-200">
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || !nat}
            onClick={() => void save()}
            className="px-4 py-1.5 rounded-full bg-sky-500 hover:bg-sky-600 text-white text-xs font-semibold shadow-md shadow-sky-500/25 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Use this photo"}
          </button>
        </div>
      </div>
    </div>
  );
};

interface ProfilePanelProps {
  form: UserSettings;
  onChange: (patch: Partial<UserSettings>) => void;
  copied: string | null;
  onCopy: (key: string, text: string) => void;
}

/** Settings → Profile: name, avatar, status, about me, and a preview of
 *  how colleagues see it all. Saved with "Save changes". */
export const ProfilePanel: React.FC<ProfilePanelProps> = ({ form, onChange, copied, onCopy }) => {
  const p: Profile = { ...EMPTY_PROFILE, ...(form.profile ?? {}) };
  const setP = (patch: Partial<Profile>) => onChange({ profile: { ...p, ...patch } });
  const [tab, setTab] = useState<"photo" | "character" | "initials">(
    p.avatar === "photo" ? "photo" : p.avatar.startsWith("emoji:") ? "character" : "initials"
  );
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [clearAfter, setClearAfter] = useState(p.status_until ? "keep" : "never");
  const fileRef = useRef<HTMLInputElement>(null);

  const pickFile = (f: File | undefined) => {
    if (!f) return;
    const r = new FileReader();
    r.onload = () => setCropSrc(String(r.result));
    r.readAsDataURL(f);
  };
  const setStatus = (status: string) => {
    const opt = CLEAR_AFTER.find((c) => c.id === clearAfter);
    setP({ status, status_until: status && opt ? opt.until() : status ? p.status_until : 0, status_text: status ? p.status_text : "" });
  };
  const line = statusLine(p);
  const role = roleLine(p);

  return (
    <div className="space-y-5" data-profile-panel>
      {/* Header: the avatar, your name and status */}
      <div className="flex items-center gap-4 rounded-[18px] lanx-group p-4">
        <button
          type="button"
          onClick={() => {
            setTab("photo");
            fileRef.current?.click();
          }}
          className="group relative rounded-full"
          title="Change your photo"
        >
          <Avatar name={form.display_name} color={form.avatar_color} profile={p} size={84} showStatus />
          <span className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white">
            <Camera className="h-6 w-6" />
          </span>
        </button>
        <div className="min-w-0 flex-1">
          <label className={labelCls}>Your name (what colleagues see)</label>
          <input
            type="text"
            value={form.display_name}
            maxLength={60}
            onChange={(e) => onChange({ display_name: e.target.value })}
            className={`${fieldCls} text-[14px] font-semibold`}
          />
          <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400 truncate">
            {line ? `${line.emoji} ${line.text}` : "No status set"}
            {role ? ` · ${role}` : ""}
          </p>
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/bmp"
        className="hidden"
        aria-label="Choose a photo"
        onChange={(e) => {
          pickFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />

      <Section title="Avatar" hint="What your colleagues see next to your name">
        <div className="flex rounded-[10px] bg-[var(--lanx-fill)] p-[3px] mb-4" data-avatar-tabs>
          {(
            [
              ["photo", "Photo", ImagePlus],
              ["character", "Character", Sparkles],
              ["initials", "Initials", Type],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setTab(id);
                if (id === "initials") setP({ avatar: "initials" });
                if (id === "photo" && p.photo) setP({ avatar: "photo" });
              }}
              className={`flex-1 inline-flex items-center justify-center gap-1.5 py-1.5 rounded-[8px] text-[11px] font-semibold transition-all ${
                tab === id
                  ? "bg-white dark:bg-white/15 text-slate-900 dark:text-white shadow-[0_1px_3px_rgb(0_0_0/0.12)]"
                  : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
              }`}
            >
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </div>

        {tab === "photo" && (
          <div className="flex items-center gap-4">
            {p.photo ? (
              <img src={p.photo} alt="" className="h-16 w-16 rounded-full object-cover shadow" />
            ) : (
              <span className="h-16 w-16 rounded-full border-2 border-dashed border-slate-300 dark:border-slate-600 flex items-center justify-center text-slate-400">
                <Camera className="h-6 w-6" />
              </span>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-sky-500 hover:bg-sky-600 text-white text-xs font-semibold shadow-md shadow-sky-500/25"
              >
                <ImagePlus className="h-3.5 w-3.5" /> {p.photo ? "Choose another picture" : "Choose a picture…"}
              </button>
              {p.photo && (
                <button
                  type="button"
                  onClick={() => {
                    setP({ avatar: "initials", photo: "" });
                    setTab("initials");
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full lanx-btn text-xs font-medium text-slate-700 dark:text-slate-200"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Remove
                </button>
              )}
              <p className="w-full text-[11px] text-slate-500 dark:text-slate-400">A small copy is shared with colleagues on your network only.</p>
            </div>
          </div>
        )}

        {tab === "character" && (
          <div className="grid grid-cols-9 gap-2" data-character-picker>
            {CHARACTERS.map((c) => {
              const on = p.avatar === `emoji:${c}`;
              return (
                <button
                  key={c}
                  type="button"
                  title={c}
                  onClick={() => setP({ avatar: `emoji:${c}` })}
                  className={`rounded-full transition-transform hover:scale-110 active:scale-95 ${on ? "ring-[3px] ring-sky-500 ring-offset-2 ring-offset-transparent" : ""}`}
                >
                  <Avatar name="" color={form.avatar_color} profile={{ ...p, avatar: `emoji:${c}`, status: "" }} size={36} />
                </button>
              );
            })}
          </div>
        )}

        {tab !== "photo" && (
          <div className="mt-4">
            <span className={labelCls}>Colour</span>
            <div className="flex flex-wrap items-center gap-2.5">
              {AVATAR_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  title={c}
                  onClick={() => onChange({ avatar_color: c })}
                  className={`h-7 w-7 rounded-full transition-transform hover:scale-110 shadow-[inset_0_0_0_1px_rgb(0_0_0/0.12)] ${
                    form.avatar_color === c ? "ring-2 ring-offset-2 ring-offset-white dark:ring-offset-[#24262c] scale-110" : ""
                  }`}
                  style={{ backgroundColor: c, ["--tw-ring-color" as string]: c }}
                />
              ))}
            </div>
          </div>
        )}
      </Section>

      <Section title="Status" hint={line ? `${line.emoji} ${line.text}` : "Let colleagues know what you're up to"}>
        <div className="flex flex-wrap gap-1.5" data-status-picker>
          <button
            type="button"
            onClick={() => setStatus("")}
            className={`px-3 py-1.5 rounded-full text-[11px] font-semibold transition-colors ${
              !p.status ? "bg-slate-800 text-white dark:bg-white dark:text-slate-900" : "lanx-btn text-slate-600 dark:text-slate-300"
            }`}
          >
            None
          </button>
          {STATUS_PRESETS.map((s) => {
            const on = p.status === s.id;
            return (
              <button
                key={s.id}
                type="button"
                title={s.label}
                onClick={() => setStatus(s.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold transition-all ${
                  on ? "text-white shadow-md" : "lanx-btn text-slate-700 dark:text-slate-200"
                }`}
                style={on ? { backgroundColor: s.color } : undefined}
              >
                <span>{s.emoji}</span> {s.label}
              </button>
            );
          })}
        </div>
        <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
          <input
            type="text"
            value={p.status_text}
            maxLength={80}
            placeholder="What are you up to? e.g. At Dolvi site till 4 pm"
            aria-label="Status message"
            onChange={(e) => setP({ status_text: e.target.value, status: p.status || (e.target.value ? "available" : "") })}
            className={fieldCls}
          />
          <select
            value={clearAfter}
            aria-label="Clear status after"
            onChange={(e) => {
              setClearAfter(e.target.value);
              const opt = CLEAR_AFTER.find((c) => c.id === e.target.value);
              if (opt && p.status) setP({ status_until: opt.until() });
            }}
            className={`${fieldCls} w-auto pr-7`}
          >
            {p.status_until > 0 && clearAfter === "keep" && <option value="keep">{statusLine({ ...p, status_text: "" })?.text.split(" · ").pop()}</option>}
            {CLEAR_AFTER.map((c) => (
              <option key={c.id} value={c.id}>
                {c.id === "never" ? "Don't clear" : `Clear after ${c.label.toLowerCase()}`}
              </option>
            ))}
          </select>
        </div>
        {p.status === "dnd" && (
          <p className="mt-2 text-[11px] text-indigo-600 dark:text-indigo-300">
            🌙 While this is on, LANX stays quiet: no sounds, pop-ups or cat. Messages still arrive.
          </p>
        )}
      </Section>

      <Section title="About me" hint="Optional — only colleagues on your network see it">
        <div className="grid grid-cols-2 gap-3">
          <label>
            <span className={labelCls}>Job title</span>
            <input className={fieldCls} maxLength={60} value={p.title} placeholder="e.g. Accountant" onChange={(e) => setP({ title: e.target.value })} />
          </label>
          <label>
            <span className={labelCls}>Department</span>
            <input className={fieldCls} maxLength={60} value={p.department} placeholder="e.g. Accounts" onChange={(e) => setP({ department: e.target.value })} />
          </label>
          <label>
            <span className={labelCls}>Phone / extension</span>
            <input className={fieldCls} maxLength={30} value={p.phone} placeholder="e.g. Ext. 112" onChange={(e) => setP({ phone: e.target.value })} />
          </label>
          <label>
            <span className={labelCls}>Email</span>
            <input className={fieldCls} maxLength={80} value={p.email} placeholder="name@company.com" onChange={(e) => setP({ email: e.target.value })} />
          </label>
          <label className="col-span-2">
            <span className={`${labelCls} flex justify-between`}>
              A line about you <span className="font-normal text-slate-400">{p.bio.length}/160</span>
            </span>
            <textarea
              rows={2}
              maxLength={160}
              value={p.bio}
              placeholder="e.g. Ask me about invoices and payments."
              onChange={(e) => setP({ bio: e.target.value })}
              className={`${fieldCls} resize-none`}
            />
          </label>
        </div>
      </Section>

      <Section title="How colleagues see you">
        <div className="flex items-start gap-4" data-profile-preview>
          <Avatar name={form.display_name} color={form.avatar_color} profile={p} size={56} showStatus />
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold text-slate-900 dark:text-white truncate">{form.display_name || "Your name"}</div>
            {role && <div className="text-[11.5px] text-slate-500 dark:text-slate-400 truncate">{role}</div>}
            {line && (
              <div
                className="mt-1.5 inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
                style={{ backgroundColor: `color-mix(in srgb, ${line.color} 14%, transparent)`, color: line.color }}
              >
                <span>{line.emoji}</span> <span className="truncate">{line.text}</span>
              </div>
            )}
            {p.bio && <p className="mt-2 text-[12px] text-slate-600 dark:text-slate-300 leading-snug">{p.bio}</p>}
            {(p.phone || p.email) && (
              <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                {p.phone && (
                  <span className="inline-flex items-center gap-1 rounded-full lanx-chip px-2 py-0.5 text-slate-600 dark:text-slate-300">
                    <Phone className="h-3 w-3" /> {p.phone}
                  </span>
                )}
                {p.email && (
                  <span className="inline-flex items-center gap-1 rounded-full lanx-chip px-2 py-0.5 text-slate-600 dark:text-slate-300">
                    <Mail className="h-3 w-3" /> {p.email}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
        <p className="mt-3 text-[10.5px] text-slate-400">Colleagues on LANX 1.2.9 or newer see this; older versions show your initials.</p>
      </Section>

      <Section title="This computer">
        <div className="grid grid-cols-2 gap-3">
          <label>
            <span className={labelCls}>Computer name</span>
            <input type="text" readOnly value={form.hostname} className={`${fieldCls} text-slate-500 dark:text-slate-400`} />
          </label>
          <label>
            <span className={labelCls}>Device ID</span>
            <span className="flex items-center gap-1.5">
              <input type="text" readOnly value={form.device_id} className={`${fieldCls} font-mono text-[10.5px] text-slate-500 dark:text-slate-400`} />
              <button type="button" onClick={() => onCopy("id", form.device_id)} title="Copy" className="lanx-btn shrink-0 p-2 rounded-[10px] text-slate-600 dark:text-slate-300">
                {copied === "id" ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            </span>
          </label>
        </div>
      </Section>

      {cropSrc && (
        <PhotoCropper
          src={cropSrc}
          onCancel={() => setCropSrc(null)}
          onDone={(photo) => {
            setCropSrc(null);
            setTab("photo");
            setP({ avatar: "photo", photo });
          }}
        />
      )}
    </div>
  );
};
