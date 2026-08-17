// The escaping and formatting every page needs. Nothing here knows
// about a page, a job or a project — that is the point of it living
// apart from them.

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function linkOrText(s: string): string {
  return /^https?:\/\/\S+$/.test(s)
    ? `<a href="${esc(s)}">${esc(s)}</a>`
    : esc(s);
}

export function money(n: number | null | undefined): string {
  return typeof n === "number" ? `$${n.toFixed(2)}` : "–";
}

// "4 min ago" beats an ISO timestamp for the question actually being
// asked, which is "is this recent?". The exact stamp stays in the
// tooltip.
export function relTime(iso: string, now: number): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return esc(iso);
  const secs = Math.max(0, Math.round((now - then) / 1000));
  const label =
    secs < 45 ? "just now"
    : secs < 5400 ? `${Math.round(secs / 60)} min ago`
    : secs < 172800 ? `${Math.round(secs / 3600)} h ago`
    : `${Math.round(secs / 86400)} d ago`;
  return `<span title="${esc(iso)}">${label}</span>`;
}
