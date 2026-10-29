/** LANX 3.0: a QR code drawn from the modules the engine computes (phone_qr),
 *  so the desktop needs no QR library. */
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import type { QrData } from "../../types";

export function QrCode({ text, size = 176, className = "" }: { text: string; size?: number; className?: string }) {
  const [qr, setQr] = useState<QrData | null>(null);
  useEffect(() => {
    let on = true;
    api
      .phoneQr(text)
      .then((q) => on && setQr(q))
      .catch(() => on && setQr(null));
    return () => {
      on = false;
    };
  }, [text]);
  if (!qr) return <div style={{ width: size, height: size }} className={`rounded-xl bg-white ${className}`} data-phone-qr="loading" />;
  const quiet = 2;
  const total = qr.size + quiet * 2;
  let d = "";
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (qr.modules[y * qr.size + x] === "1") d += `M${x + quiet} ${y + quiet}h1v1h-1z`;
    }
  }
  return (
    <svg
      data-phone-qr="ready"
      viewBox={`0 0 ${total} ${total}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className={`rounded-xl bg-white ${className}`}
      role="img"
      aria-label="QR code"
    >
      <path d={d} fill="#0f172a" />
    </svg>
  );
}
