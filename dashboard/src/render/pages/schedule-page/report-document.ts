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

/** `baseHref` is the run's own directory, so a relative link written next
 *  to the report resolves there and opens in a new tab. */
export async function buildReportDocument(reportHtml: string, baseHref: string): Promise<string> {
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
    .transform(new Response(reportHtml))
    .text();
  return (
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<base href="${esc(baseHref)}" target="_blank">` +
    `<style>${TOKENS_CSS}${REPORT_FRAME_CSS}</style></head><body>${body}</body></html>`
  );
}
