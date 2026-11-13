// The table of facts: a label and its value, one row each.
// `index.ts` re-exports every name here; the pages import it from there.

import { esc } from "../html.ts";

/** Label and value are trusted HTML, the convention `rowMessage()`'s `html`
 *  and `field()`'s `control` follow: a label can be two spans (the Cost
 *  label flips with the unit), and every caller escapes what it hands in.
 *  `num` sets the value as a figure. */
export function facts(rows: { label: string; value: string; num?: boolean }[]): string {
  return (
    `<table class="facts"><tbody>` +
    rows.map((r) => `<tr><td class="label">${r.label}</td><td${r.num ? ` class="num"` : ""}>${r.value}</td></tr>`).join("") +
    `</tbody></table>`
  );
}

/** Commits as a table of facts, newest first: the short sha, a link to the
 *  commit's page where there is one, beside its subject; `none` when there
 *  are none. */
export function commitFacts(commits: readonly { sha: string; subject: string; url?: string }[], none: string): string {
  if (!commits.length) return `<p class="muted small">${esc(none)}</p>`;
  const sha = (c: { sha: string; url?: string }): string => {
    const short = esc(c.sha.slice(0, 7));
    return c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noopener">${short}</a>` : short;
  };
  return facts(commits.map((c) => ({ label: sha(c), value: esc(c.subject) })));
}
