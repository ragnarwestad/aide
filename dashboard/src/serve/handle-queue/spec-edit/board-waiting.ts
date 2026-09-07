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
import { specTabPath } from "../../../render.ts";

const EVERY_SECONDS = 5;

export function waitingForBoardPage(project: string, specFolder: string): Response {
  const back = specTabPath(project, specFolder, "steps");
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="${EVERY_SECONDS}">
<title>aide -board · starting a test server</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
  .box { text-align: center; max-width: 30rem; padding: 2rem; }
  h1 { font-size: 1.1rem; margin: 0 0 .5rem; }
  p { margin: 0 0 .5rem; opacity: .75; }
  a { color: inherit; }
  .spin { width: 28px; height: 28px; margin: 0 auto 1.25rem; border-radius: 50%;
    border: 3px solid currentColor; border-top-color: transparent; opacity: .5;
    animation: turn 1s linear infinite; }
  @keyframes turn { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .spin { animation: none; } }
</style>
</head>
<body>
<div class="box">
  <div class="spin" role="img" aria-label="starting"></div>
  <h1>Starting a test server for ${esc(specFolder)}</h1>
  <p>It runs this branch's own code, and takes a few minutes. This page
     goes there by itself when it is up — leave it open.</p>
  <p><a href="${esc(back)}">Back to the spec</a></p>
</div>
</body>
</html>
`;
  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
