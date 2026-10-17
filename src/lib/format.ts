export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

export function formatSpeed(bytesPerSec: number): string {
  if (!bytesPerSec) return "";
  return `${formatSize(bytesPerSec)}/s`;
}

export function formatEta(remainingBytes: number, bytesPerSec: number): string {
  if (!bytesPerSec || remainingBytes <= 0) return "";
  const secs = Math.ceil(remainingBytes / bytesPerSec);
  if (secs < 60) return `${secs}s left`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} min left`;
  const hours = Math.floor(mins / 60);
  return `${hours} h ${mins % 60} min left`;
}

/**
 * Short "security code" for a peer's public key, identical to the one the
 * other computer shows in Settings → Diagnostics. Compare them to verify.
 */
export async function keyFingerprint(publicKeyHex: string): Promise<string> {
  try {
    const data = new TextEncoder().encode(publicKeyHex);
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
    return Array.from(hash.slice(0, 8))
      .map((b) => b.toString(16).padStart(2, "0").toUpperCase())
      .join(":");
  } catch {
    return "";
  }
}

export function fileExtension(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

/** "0.8 s", "3.2 s", "1 min 12 s", "1 h 3 min". */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  if (ms < 10_000) return `${Math.max(0.1, ms / 1000).toFixed(1)} s`;
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs} s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} min ${secs % 60} s`;
  return `${Math.floor(mins / 60)} h ${mins % 60} min`;
}

/** How long a finished transfer took: "40.1 MB in 3.2 s · 12.5 MB/s" (LANX 1.2.7+). */
export function transferTiming(t: { status: string; file_size: number; duration_ms?: number | null; started_bytes?: number | null }): string | null {
  if (t.status !== "completed" || !t.duration_ms || t.duration_ms <= 0) return null;
  const moved = Math.max(0, t.file_size - (t.started_bytes ?? 0));
  const speed = moved > 0 ? (moved * 1000) / t.duration_ms : 0;
  const resumed = (t.started_bytes ?? 0) > 0;
  return `${formatSize(t.file_size)} in ${formatDuration(t.duration_ms)}${speed > 0 ? ` · ${formatSpeed(speed)}` : ""}${resumed ? " (after resuming)" : ""}`;
}
