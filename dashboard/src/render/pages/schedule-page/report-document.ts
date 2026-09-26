// Spec 495: a scheduled run's report, turned into the document its
// sandboxed frame shows. The report's own styling, scripts and event
// attributes are removed and the board's tokens and element rules put in
// their place, so it reads in the board's look whatever it carries.
//
// Security does not rest on this filter: the frame's `sandbox` runs
// nothing (`report.ts`). What the filter buys is the board's look, and
// links that cannot open a `javascript:` address in an unsandboxed tab.
import { REPORT_FRAME_CSS, TOKENS_CSS } from "../../ui/css";
import { esc } from "../../ui/html.ts";

const REMOVED_WITH_CONTENT = "script, style, link, meta, base, object, embed, iframe";
const UNWRAPPED = "form, font";
const STYLING_ATTRIBUTES = new Set(["style", "bgcolor", "background", "color", "face", "size"]);
const SAFE_LINK = /^(https?:|mailto:|#|[^:]*$)/i;

function cleanAttributes(el: HTMLRewriterTypes.Element): void {
  // A copy first: removing from `attributes` while iterating skips entries.
  for (const [name, value] of [...el.attributes]) {
    const lower = name.toLowerCase();
    if (lower.startsWith("on") || STYLING_ATTRIBUTES.has(lower)) el.removeAttribute(name);
    else if (lower === "href" && !SAFE_LINK.test(value.trim())) el.removeAttribute(name);
    else if (lower === "src" && /^\s*(javascript|vbscript):/i.test(value)) el.removeAttribute(name);
  }
}

/** A table cell holding one short word — a date, a version, a link's one
 *  word — is kept on one line (`data-short`, report-frame.css): a table
 *  that may break anywhere hands a long cell beside it all the room and
 *  cuts "2026-09-25" in two. */
const SHORT_CELL = /^\S{1,24}$/;

/** Which table cells, in document order, hold one short word. A cell's
 *  text reaches a rewriter only after its start tag has gone, so it is
 *  read in a pass of its own. */
async function shortCells(html: string): Promise<boolean[]> {
  const texts: string[] = [];
  let open: number[] = [];
  await new HTMLRewriter()
    .on("td, th", {
      element(el) {
        texts.push("");
        const i = texts.length - 1;
        open = [...open, i];
        el.onEndTag(() => {
          open = open.filter((j) => j !== i);
        });
      },
      text(t) {
        const i = open[open.length - 1];
        if (i !== undefined) texts[i] += t.text;
      },
    })
    .transform(new Response(html))
    .text();
  return texts.map((t) => SHORT_CELL.test(t.trim()));
}

/** `baseHref` is the run's own directory, so a relative link written next
 *  to the report resolves there and opens in a new tab. */
export async function buildReportDocument(reportHtml: string, baseHref: string): Promise<string> {
  const short = await shortCells(reportHtml);
  let cell = 0;
  const body = await new HTMLRewriter()
    .on(REMOVED_WITH_CONTENT, { element: (el) => void el.remove() })
    .on(UNWRAPPED, { element: (el) => void el.removeAndKeepContent() })
    .on("*", { element: cleanAttributes })
    .on("a", {
      element(el) {
        el.setAttribute("target", "_blank");
        el.setAttribute("rel", "noopener noreferrer");
      },
    })
    .on("td, th", {
      element(el) {
        if (short[cell++]) el.setAttribute("data-short", "");
      },
    })
    .transform(new Response(reportHtml))
    .text();
  return (
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<base href="${esc(baseHref)}" target="_blank">` +
    `<style>${TOKENS_CSS}${REPORT_FRAME_CSS}</style></head><body>${body}</body></html>`
  );
}
