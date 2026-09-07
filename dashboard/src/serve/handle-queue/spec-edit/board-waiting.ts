// The page a reader waits on while a test server starts (spec 411,
// REQ-4). A board is a full round: minutes, not seconds. The link that
// starts one used to send the reader back to the spec page to find the
// address for themselves — this holds the tab they opened and carries
// them to the board the moment it has one.
//
// A meta refresh, not a script: it reloads onto the SAME `?startBoard=1`
// URL, and that route redirects to the board as soon as the round has
// reported it. So the waiting and the arriving are the same request,
// asked again — nothing here has to know what a board's address looks
// like, and it works with JavaScript switched off.

import { esc } from "../../../render/ui/html.ts";

const EVERY_SECONDS = 5;

/** One page, two states. Waiting refreshes onto the same URL until the
 *  board is there; a board that failed to start says so and STOPS —
 *  refreshing for ever in front of a reader who can do nothing about it
 *  is worse than saying what happened and leaving the tab to them.
 *
 *  No way back to the spec on either: this tab was opened from the spec
 *  page, which is still standing in the one behind it. */
export function boardFailedPage(specFolder: string, why?: string): Response {
  return htmlPage(
    `Could not start a test server for "${esc(specFolder)}"`,
    why ? `<p>${esc(why)}</p>` : "<p>The round did not report an address.</p>",
    { refresh: false },
  );
}

export function waitingForBoardPage(_project: string, specFolder: string): Response {
  return htmlPage(
    `Starting a test server for "${esc(specFolder)}"`,
    `<p>It runs this branch's own code, and takes a few minutes. This page
        goes there by itself when it is up — leave it open.</p>`,
    { refresh: true },
  );
}

/** The frame both share: centred, self-contained, no navigation of its
 *  own. A spinner only while something is actually coming. */
function htmlPage(heading: string, body: string, o: { refresh: boolean }): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${o.refresh ? `<meta http-equiv="refresh" content="${EVERY_SECONDS}">` : ""}
<title>aide -board · ${o.refresh ? "starting a test server" : "test server"}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
  .box { text-align: center; max-width: 30rem; padding: 2rem; }
  h1 { font-size: 1.1rem; margin: 0 0 .5rem; }
  p { margin: 0 0 .5rem; opacity: .75; }
  .spin { width: 28px; height: 28px; margin: 0 auto 1.25rem; border-radius: 50%;
    border: 3px solid currentColor; border-top-color: transparent; opacity: .5;
    animation: turn 1s linear infinite; }
  @keyframes turn { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .spin { animation: none; } }
</style>
</head>
<body>
<div class="box">
  ${o.refresh ? `<div class="spin" role="img" aria-label="starting"></div>` : ""}
  <h1>${heading}</h1>
  ${body}
</div>
</body>
</html>
`;
  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
