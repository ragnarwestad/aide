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

/** The board's address as the READER can reach it. The round only ever
 *  knows loopback — it started the board on this machine and says
 *  `http://127.0.0.1:<port>/` — and sending a browser there sends it to
 *  its OWN machine, which has nothing on that port. The host the reader
 *  used to reach the dashboard is the one that works, and the port is
 *  the board's own; `tailscale serve` puts the pool's ports behind that
 *  same host.
 *
 *  The SCHEME comes off `x-forwarded-proto` before the request's own
 *  URL: `tailscale serve` terminates TLS and proxies plain HTTP to
 *  loopback, so the request arriving here says `http:` while the reader
 *  is on `https:` — and the pool's ports are TLS listeners too, which
 *  answer a plain-HTTP request with 400.
 *
 *  Unparseable, or a request with no host: the round's own address, so
 *  a reader sitting at the serving machine still gets there. */
export function boardUrlFor(reader: Request, boardUrl: string): string {
  try {
    const board = new URL(boardUrl);
    const host = reader.headers.get("host");
    if (!host) return boardUrl;
    const forwarded = reader.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    board.protocol = forwarded ? `${forwarded}:` : new URL(reader.url).protocol;
    board.hostname = host.split(":")[0]!;
    return board.toString();
  } catch {
    return boardUrl;
  }
}

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
    // The folder name on its own line: it is long, and it reads apart
    // from the sentence rather than wrapping somewhere inside it.
    `Starting a test server for<br>"${esc(specFolder)}"`,
    `<p>It runs this branch's own code, and takes a few minutes. This page
        goes there by itself when it is up — leave it open.</p>`,
    { refresh: true },
  );
}

/** REQ-4 (spec 424): what the self-stop route hands back once it has
 *  scheduled its own exit. A third state beside waiting/failed, in the
 *  same frame — no refresh (nothing is coming back to poll for) and no
 *  navigation of its own, the same as `boardFailedPage`. */
export function stoppedPage(): Response {
  return htmlPage(
    "Test server stopped",
    `<p>Its worktree, log and port are freed as this process ends.</p>`,
    { refresh: false },
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
