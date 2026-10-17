import React from "react";
import { fileExtension, formatSize } from "../lib/format";

/** Funny lines the cat says (picked per alert, so they don't change while shown). */
const FILE_LINES = [
  (who: string) => `Meow! Special delivery from ${who} 📦`,
  (who: string) => `Psst… ${who} sent you a file! 🐾`,
  () => `This box is heavy — please accept it 😹`,
  () => `I won't nap until you open this 😼`,
  (who: string) => `${who} packed this just for you 💌`,
  () => `Knock knock! A file for you 🐱`,
];
const MESSAGE_LINES = [
  (who: string) => `New message from ${who}! 💌`,
  (who: string) => `Mew! ${who} wrote to you ✉️`,
  (who: string) => `Letter from ${who}, fresh off the LAN 🐾`,
  (who: string) => `${who} says hi — read it? 😺`,
];

function pick<T>(list: T[], id: string): T {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return list[h % list.length];
}

export type CatMood = "hello" | "happy" | "bye";

interface DeliveryCatProps {
  /** Changes the funny line. */
  alertId: string;
  /** "box": a file in a parcel; "letter": a message in an envelope. */
  variant?: "box" | "letter";
  from: string;
  fileName?: string;
  fileSize?: number;
  /** "hello" while waiting; "happy" after Accept/Open; "bye" after Later. */
  mood: CatMood;
}

/** A soft "3D" cartoon cat (shaded with gradients) hanging from the Dynamic
 *  Island on two strings, in a parcel box (files) or holding an envelope
 *  (messages). It drops in, swings, blinks, looks around, waves and wags;
 *  after Accept it cheers and climbs back up, after Later it waves bye. */
export const DeliveryCat: React.FC<DeliveryCatProps> = ({ alertId, variant = "box", from, fileName = "", fileSize = 0, mood }) => {
  const who = from.split(" ")[0] || "Someone";
  const ext = (fileExtension(fileName) || "file").slice(0, 4).toUpperCase();
  const line =
    mood === "happy"
      ? variant === "box"
        ? "Yay! Bringing it in… 🐾"
        : "Opening it for you… 😺"
      : mood === "bye"
        ? variant === "box"
          ? "Okay, later! It's waiting in your chat 👋"
          : "Okay, later! 👋"
        : pick(variant === "box" ? FILE_LINES : MESSAGE_LINES, alertId)(who);
  const anchorL = variant === "box" ? "26 88" : "22 98";
  const anchorR = variant === "box" ? "136 86" : "138 98";

  return (
    <div
      className={`lanx-cat ${mood === "hello" ? "lanx-cat-drop" : mood === "happy" ? "lanx-cat-happy" : "lanx-cat-bye"}`}
      data-cat={mood}
      data-cat-variant={variant}
      aria-hidden="true"
    >
      <div className="lanx-cat-swing">
        <svg viewBox="0 0 160 190" width="150" height="178" className="overflow-visible lanx-cat-svg">
          <defs>
            <radialGradient id="lanxcat-fur" cx="0.36" cy="0.3" r="0.8">
              <stop offset="0" stopColor="#ffdcaa" />
              <stop offset="0.55" stopColor="#f7ab58" />
              <stop offset="1" stopColor="#d97f2b" />
            </radialGradient>
            <radialGradient id="lanxcat-paw" cx="0.4" cy="0.3" r="0.8">
              <stop offset="0" stopColor="#ffe2b8" />
              <stop offset="1" stopColor="#e9963f" />
            </radialGradient>
            <linearGradient id="lanxcat-ear" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#e88f3c" />
              <stop offset="1" stopColor="#f7ab58" />
            </linearGradient>
            <radialGradient id="lanxcat-eye" cx="0.4" cy="0.35" r="0.75">
              <stop offset="0" stopColor="#ffffff" />
              <stop offset="1" stopColor="#dfe7f1" />
            </radialGradient>
            <radialGradient id="lanxcat-pupil" cx="0.35" cy="0.3" r="0.8">
              <stop offset="0" stopColor="#5a4632" />
              <stop offset="0.6" stopColor="#1f1a16" />
              <stop offset="1" stopColor="#000" />
            </radialGradient>
            <linearGradient id="lanxcat-box" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#dca46b" />
              <stop offset="1" stopColor="#b8773d" />
            </linearGradient>
            <linearGradient id="lanxcat-side" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#a8682f" />
              <stop offset="1" stopColor="#8d5524" />
            </linearGradient>
            <linearGradient id="lanxcat-env" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#ffffff" />
              <stop offset="1" stopColor="#e9edf3" />
            </linearGradient>
            <radialGradient id="lanxcat-seal" cx="0.35" cy="0.3" r="0.8">
              <stop offset="0" stopColor="#ff8aa5" />
              <stop offset="1" stopColor="#e11d48" />
            </radialGradient>
          </defs>

          {/* strings up to the island */}
          <path d={`M80 0 L${anchorL} M80 0 L${anchorR}`} stroke="#7c5a3a" strokeWidth="2.4" strokeLinecap="round" fill="none" opacity="0.85" />
          <circle cx="80" cy="2" r="3.5" fill="#5b3f26" />

          {/* tail, wagging */}
          <g className="lanx-cat-tail">
            <path d="M136 146 C 160 142, 166 116, 152 100" stroke="url(#lanxcat-fur)" strokeWidth="12" strokeLinecap="round" fill="none" />
            <path d="M156 108 C 160 104, 157 98, 152 100" stroke="#c46f22" strokeWidth="12" strokeLinecap="round" fill="none" />
          </g>

          {/* inside of the box, behind the cat */}
          {variant === "box" && <path d="M16 92 L126 92 L142 84 L32 84 Z" fill="#5e3a1c" />}

          {/* head */}
          <g className="lanx-cat-head">
            <path d="M44 46 L52 10 L74 33 Z" fill="url(#lanxcat-ear)" />
            <path d="M51 39 L55 21 L67 33 Z" fill="#ffb3c1" />
            <path d="M112 46 L104 10 L82 33 Z" fill="url(#lanxcat-ear)" />
            <path d="M105 39 L101 21 L89 33 Z" fill="#ffb3c1" />
            <ellipse cx="78" cy="61" rx="43" ry="36" fill="url(#lanxcat-fur)" />
            {/* soft rim light and shading for volume */}
            <ellipse cx="64" cy="40" rx="18" ry="9" fill="#fff" opacity="0.28" />
            <path d="M80 28 v9 M69 30 q2 5 0 9 M91 30 q-2 5 0 9" stroke="#c97a2f" strokeWidth="3.5" strokeLinecap="round" fill="none" opacity="0.8" />
            {mood === "happy" ? (
              <g stroke="#2b2118" strokeWidth="4.2" strokeLinecap="round" fill="none">
                <path d="M55 60 q8 -9 16 0" />
                <path d="M85 60 q8 -9 16 0" />
              </g>
            ) : (
              <g className="lanx-cat-eyes">
                <ellipse cx="63" cy="59" rx="10.5" ry="12" fill="url(#lanxcat-eye)" />
                <ellipse cx="93" cy="59" rx="10.5" ry="12" fill="url(#lanxcat-eye)" />
                <g className="lanx-cat-look">
                  <circle cx="64" cy="61" r="7" fill="url(#lanxcat-pupil)" />
                  <circle cx="94" cy="61" r="7" fill="url(#lanxcat-pupil)" />
                  <circle cx="66.5" cy="57.5" r="2.6" fill="#fff" />
                  <circle cx="96.5" cy="57.5" r="2.6" fill="#fff" />
                  <circle cx="61.5" cy="64" r="1.2" fill="#fff" opacity="0.8" />
                  <circle cx="91.5" cy="64" r="1.2" fill="#fff" opacity="0.8" />
                </g>
              </g>
            )}
            <ellipse cx="53" cy="76" rx="8" ry="4.5" fill="#ff8fa3" opacity="0.5" />
            <ellipse cx="103" cy="76" rx="8" ry="4.5" fill="#ff8fa3" opacity="0.5" />
            <path d="M73.5 71.5 h9 l-4.5 5 z" fill="#ff6f91" />
            <ellipse cx="76.5" cy="72.3" rx="1.6" ry="0.9" fill="#fff" opacity="0.7" />
            <path d="M70 79 q4 5 8 0 q4 5 8 0" stroke="#2b2118" strokeWidth="2.3" strokeLinecap="round" fill="none" />
            {mood === "happy" && <path d="M74 83 q4 8 8 0 z" fill="#ff6f91" />}
            <g stroke="#7a5230" strokeWidth="1.6" strokeLinecap="round" opacity="0.65">
              <path d="M50 76 L26 71 M50 80 L26 83" />
              <path d="M106 76 L130 71 M106 80 L130 83" />
            </g>
          </g>

          {/* waving paw */}
          <g className="lanx-cat-wave">
            <path d="M108 94 Q 116 76 124 62" stroke="url(#lanxcat-fur)" strokeWidth="14" strokeLinecap="round" fill="none" />
            <circle cx="125" cy="58" r="10" fill="url(#lanxcat-paw)" />
            <path d="M120 53 v4 M125 51 v4 M130 53 v4" stroke="#c97a2f" strokeWidth="1.6" strokeLinecap="round" />
          </g>

          {variant === "box" ? (
            <>
              {/* parcel: front, side and rim, shaded like a real box */}
              <path d="M126 92 L142 84 L142 168 L126 176 Z" fill="url(#lanxcat-side)" />
              <rect x="16" y="92" width="110" height="84" rx="5" fill="url(#lanxcat-box)" />
              <rect x="64" y="92" width="16" height="84" fill="#efcf9d" opacity="0.8" />
              <path d="M16 92 L126 92 L142 84" stroke="#f3d6a8" strokeWidth="2.5" strokeLinecap="round" fill="none" opacity="0.9" />
              <ellipse cx="50" cy="91" rx="12" ry="8" fill="url(#lanxcat-paw)" />
              <path d="M45 88 v4 M50 87 v4 M55 88 v4" stroke="#c97a2f" strokeWidth="1.5" strokeLinecap="round" />
              <g transform="rotate(-4 46 138)">
                <rect x="24" y="117" width="46" height="40" rx="5" fill="#fffaf0" />
                <rect x="24" y="117" width="46" height="9" rx="4" fill="#f59e0b" opacity="0.9" />
                <text x="47" y="140" textAnchor="middle" fontSize="12" fontWeight="800" fill="#7a4b1f" fontFamily="inherit">
                  {ext}
                </text>
                <text x="47" y="152" textAnchor="middle" fontSize="8" fontWeight="600" fill="#a0703f" fontFamily="inherit">
                  {formatSize(fileSize)}
                </text>
              </g>
              <text x="104" y="150" textAnchor="middle" fontSize="19" opacity="0.5">
                🐾
              </text>
            </>
          ) : (
            <>
              {/* envelope with a heart seal */}
              <rect x="14" y="94" width="132" height="78" rx="9" fill="url(#lanxcat-env)" stroke="#d6dde7" strokeWidth="1.5" />
              <path d="M16 98 L80 138 L144 98" stroke="#cdd5e0" strokeWidth="2" fill="none" strokeLinejoin="round" />
              <path d="M16 170 L64 128 M144 170 L96 128" stroke="#e3e8ef" strokeWidth="1.6" fill="none" />
              <circle cx="80" cy="138" r="13" fill="url(#lanxcat-seal)" />
              <text x="80" y="143" textAnchor="middle" fontSize="13" fontWeight="800" fill="#fff" fontFamily="inherit">
                {who.charAt(0).toUpperCase()}
              </text>
              <ellipse cx="46" cy="95" rx="12" ry="8" fill="url(#lanxcat-paw)" />
              <path d="M41 92 v4 M46 91 v4 M51 92 v4" stroke="#c97a2f" strokeWidth="1.5" strokeLinecap="round" />
            </>
          )}
        </svg>

        {mood === "happy" && (
          <div className="lanx-cat-hearts">
            <span>💖</span>
            <span>✨</span>
            <span>💛</span>
          </div>
        )}
      </div>

      <div className="lanx-cat-bubble">{line}</div>
    </div>
  );
};
