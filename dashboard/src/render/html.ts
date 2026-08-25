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

// The same figure in the unit a subscription actually meters. Rounded on
// purpose, like `relTime()` below: nobody compares two runs on the last
// hundred tokens, and an exact 4 943 100 is harder to read at a glance
// than 4.9M. A missing count is a dash — never a zero, which would say
// the step used nothing.
export function tokens(n: number | null | undefined): string {
  if (typeof n !== "number") return "–";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M tok`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k tok`;
  return `${n} tok`;
}

/** Both units, in one cell. The reader's choice is applied by CSS from
 *  the `data-unit` attribute on `<html>` (`unit-script.ts`), so a page
 *  can be a FILE opened from a folder and still honour it — the same
 *  mechanism, and the same reason, as the theme.
 *
 *  Every consumption figure on the site goes through here. There used to
 *  be two dollar formatters — this one and `queue-list.ts`'s `costCell`
 *  — and both needed the identical new capability, so they are one. */
export function usdOrTokens(
  usd: number | null | undefined,
  tok: number | null | undefined,
): string {
  return `<span class="u-usd">${money(usd)}</span><span class="u-tok">${tokens(tok)}</span>`;
}

// "4 min ago" beats an ISO timestamp for the question actually being
// asked, which is "is this recent?". The exact stamp stays in the
// tooltip.
export function relTime(iso: string, now: number): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return esc(iso);
  return `<span title="${esc(iso)}">${relTimeLabel(iso, now)}</span>`;
}

/** The same words without the markup, for a caller whose text is
 *  escaped on its way out (spec 203: the drift note goes through
 *  `rowMessage`, which would show a literal <span>). One ladder, two
 *  wrappers — two copies of these thresholds would one day disagree
 *  about when "min" becomes "h". */
export function relTimeLabel(iso: string, now: number): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso;
  const secs = Math.max(0, Math.round((now - then) / 1000));
  return (
    secs < 45 ? "just now"
    : secs < 5400 ? `${Math.round(secs / 60)} min ago`
    : secs < 172800 ? `${Math.round(secs / 3600)} h ago`
    : `${Math.round(secs / 86400)} d ago`
  );
}

/** The exact stamp, for the one place relative time is not enough to
 *  tell two of something apart (spec 240): the attempt picker's pills
 *  used to share this problem with every other timestamp on the site,
 *  which only ever needed "is this recent?" — an attempt needs to be
 *  IDENTIFIED, not just dated. Local time, plain digits, no zone marker
 *  — the SERVER's local time, not UTC. That is a genuine departure from
 *  every other exact stamp on the site: `relTime()`'s `title=` is the
 *  raw stored ISO-8601 string, which is UTC (`new Date().toISOString()`,
 *  `queue.ts:521,659`). This is the first UTC-to-local conversion here,
 *  not a passthrough — an acceptable tradeoff for a single-operator
 *  dashboard where the server and the reader share a timezone, but a
 *  real one, not "no timezone handling anywhere" repeated unchanged. */
export function absTimeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
