// The Specs list links each approach a ticked spec's analysis found to
// its place on the Solution tab, as `#approach-<letter>`. Neither the
// Viewer nor the Editor gives a paragraph an id, so the address alone
// lands on the top of the tab: this scrolls to the lead instead — the
// bold text that starts `Approach <LETTER>:`.

/** Scroll the approach the address names into view, once the document is
 *  drawn in `host`. Answers whether there was one to scroll to. */
export function scrollToApproach(host: Element, hash: string): boolean {
  const m = hash.match(/^#approach-([a-z])$/i);
  if (!m) return false;
  const prefix = `Approach ${m[1]!.toUpperCase()}:`;
  // The editor keeps its other mode's copy of the document hidden beside
  // the one shown, and its Markdown mode draws bold as a span: the lead
  // is the first one on screen.
  const lead = Array.from(host.querySelectorAll("strong, .toastui-editor-md-strong")).find(
    (el) => el.getClientRects().length > 0 && !!el.textContent?.trim().startsWith(prefix),
  );
  if (!lead) return false;
  lead.scrollIntoView({ block: "center" });
  return true;
}
