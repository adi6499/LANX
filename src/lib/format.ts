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
