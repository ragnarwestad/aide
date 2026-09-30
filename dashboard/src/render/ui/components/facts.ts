// The table of facts: a label and its value, one row each.
// `index.ts` re-exports every name here; the pages import it from there.

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
