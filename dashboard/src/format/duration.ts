export function durationLabel(ms: number): string {
  // A genuinely positive span never rounds down to "0s" —
  // that reads as "nothing recorded", indistinguishable from a
  // phase the queue never measured at all.
  const secs = ms > 0 ? Math.max(1, Math.round(ms / 1000)) : 0;
  if (secs < 60) return `${secs}s`;
  const pad = (n: number): string => String(n).padStart(2, "0");
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${pad(secs % 60)}s`;
  return `${Math.floor(secs / 3600)}h ${pad(Math.floor((secs % 3600) / 60))}m`;
}
