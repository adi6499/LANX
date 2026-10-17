import React from "react";
import type { Profile } from "../types";
import { effective, statusPreset } from "../lib/profile";

interface AvatarProps {
  name: string;
  color: string;
  profile?: Profile | null;
  /** Diameter in pixels. */
  size: number;
  /** Rounded square (groups) instead of a circle. */
  square?: boolean;
  /** Show the status emoji as a small badge (bottom-right). */
  showStatus?: boolean;
  className?: string;
  children?: React.ReactNode;
}

/** A person's picture: their photo, their character on a gradient of their
 *  colour, or their initial — the same everywhere in LANX. */
export const Avatar: React.FC<AvatarProps> = ({ name, color, profile, size, square, showStatus, className = "", children }) => {
  const p = effective(profile);
  const radius = square ? Math.round(size * 0.3) : size / 2;
  const emoji = p?.avatar?.startsWith("emoji:") ? p.avatar.slice(6) : null;
  const photo = p?.avatar === "photo" && p.photo ? p.photo : null;
  const status = showStatus ? statusPreset(p?.status) : null;
  const badge = Math.max(14, Math.round(size * 0.38));
  return (
    <span className={`relative inline-flex shrink-0 ${className}`} style={{ width: size, height: size }} data-avatar={photo ? "photo" : emoji ? "character" : "initials"}>
      {photo ? (
        <img src={photo} alt={name} draggable={false} className="h-full w-full object-cover shadow-sm" style={{ borderRadius: radius }} />
      ) : emoji ? (
        <span
          className="h-full w-full flex items-center justify-center shadow-sm select-none"
          style={{
            borderRadius: radius,
            background: `radial-gradient(circle at 30% 25%, color-mix(in srgb, ${color} 35%, white), ${color} 70%, color-mix(in srgb, ${color} 75%, black))`,
            fontSize: Math.round(size * 0.56),
            lineHeight: 1,
          }}
        >
          <span style={{ filter: "drop-shadow(0 1px 1px rgb(0 0 0 / 0.25))" }}>{emoji}</span>
        </span>
      ) : (
        <span
          className="h-full w-full flex items-center justify-center text-white font-bold shadow-sm select-none"
          style={{ borderRadius: radius, backgroundColor: color, fontSize: Math.round(size * 0.36) }}
        >
          {children ?? (name.trim().charAt(0).toUpperCase() || "?")}
        </span>
      )}
      {status && (
        <span
          title={status.label}
          className="absolute -bottom-0.5 -right-1 flex items-center justify-center rounded-full bg-white dark:bg-[#1c1e24] shadow ring-1 ring-black/5"
          style={{ width: badge, height: badge, fontSize: Math.round(badge * 0.62), lineHeight: 1 }}
          data-status-badge={status.id}
        >
          {status.emoji}
        </span>
      )}
    </span>
  );
};
