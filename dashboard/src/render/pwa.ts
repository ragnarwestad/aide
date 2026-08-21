// What makes the dashboard installable: a web app manifest, the icons
// it names, the one icon iOS insists on, and a service worker.
//
// `pwa.ts` and not `manifest.ts` on purpose — "the manifest" in this
// codebase is a project's `.aide/project.yaml` (`parse-manifest.ts`,
// `ManifestData`, `projectManifest`), and two things called the
// manifest is one too many.
//
// Everything here is a string or a few bytes held in memory and served
// by `serve.ts`. `brand.ts` opens by saying why: nothing this site
// hands a browser is a file kept in sync by hand. A web app manifest
// cannot honour that literally — it is a resource at a URL by
// definition, and so are its icons and the worker's script. Computing
// them keeps what the rule is FOR (no build step, no asset pipeline,
// nothing that can drift from the source that generated it) while
// giving the browser the real URL and the real Content-Type it needs.
// The generated static site gets no manifest of its own: installing is
// something you do to the SERVED dashboard, which is where a reader
// who wants it already is.
import { Buffer } from "node:buffer";

import { appIcon, appIconMaskable } from "./brand.ts";

/** The window's own colour, light and dark: what paints the title bar
 *  of an installed desktop app and the status bar on a phone. Both are
 *  `--bg` from `css.ts` — the page's background — written out again
 *  here because neither a `<meta>` tag nor a JSON field can read a CSS
 *  custom property. `test/pwa.test.ts` pins them to those tokens, so a
 *  palette change that forgets this file fails there rather than
 *  turning up as a seam across the top of the installed app. */
export const THEME_COLORS = { light: "#EFECE5", dark: "#16181C" };

/** The two icons the manifest names. One SVG per purpose rather than
 *  the three fixed PNG sizes a Vite app ships: the mark is genuinely
 *  vector, so `"sizes": "any"` lets a launcher scale the one file to
 *  whatever size it is drawing. */
export const APP_ICON = appIcon(THEME_COLORS.light);
export const APP_ICON_MASKABLE = appIconMaskable(THEME_COLORS.light);

/** The manifest itself. `start_url` carries no token: an installed app
 *  is launched without whatever query string a bookmark had, so the
 *  first launch is a 401 unless the cookie is already on the origin.
 *  That is the documented order — sign in once in the browser, then
 *  install — and not something a second secret should be invented for. */
export const WEBMANIFEST =
  JSON.stringify(
    {
      // The app's identity to the browser, so a later change of scope
      // does not read as a different app that has to be reinstalled.
      id: "/",
      name: "aide -board",
      short_name: "aide -board",
      description: "from spec to merge",
      start_url: "/",
      scope: "/",
      // Without this it is a bookmark with an icon, not an app.
      display: "standalone",
      background_color: THEME_COLORS.light,
      theme_color: THEME_COLORS.light,
      icons: [
        { src: "/icon-512.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
        { src: "/icon-512-maskable.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
      ],
    },
    null,
    2,
  ) + "\n";

// iOS's home-screen icon: the one thing this site serves that is a
// file's BYTES rather than a string built from the source above.
// Safari will not rasterize an SVG for `apple-touch-icon` the way it
// accepts one as a favicon, and nothing in this toolchain turns an SVG
// into a PNG — Bun has no rasterizer and the project's only dependency
// is `yaml`. So it was rendered once, at 180×180, from `appIcon()`
// itself, in a scratch directory rather than as a dependency here:
//
//     bun add @resvg/resvg-js
//     new Resvg(appIcon("#EFECE5"), { fitTo: { mode: "width", value: 180 } })
//         .render().asPng()
//
// It is therefore the one icon that cannot regenerate itself: change
// `LIGHT` in `brand.ts` or `--bg` in `css.ts` and these bytes have to
// be re-rendered with the command above. No test can see that they
// have drifted — this comment is the whole of the warning.
const APPLE_TOUCH_ICON_BASE64 = [
  "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",
  "W37/W+88PCIAAAAASUVORK5CYII=",
].join("");

export const APPLE_TOUCH_ICON = Buffer.from(APPLE_TOUCH_ICON_BASE64, "base64");

/** What the worker answers a page load with when the server cannot be
 *  reached. Deliberately not the dashboard: the point is to say the
 *  tailnet is not there, not to imitate a page whose every line is
 *  live state. */
const OFFLINE_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>aide -board — not reachable</title>
<style>
:root { color-scheme: light dark; background: ${THEME_COLORS.light}; }
@media (prefers-color-scheme: dark) { :root { background: ${THEME_COLORS.dark}; } }
body { font: 16px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  margin: 0; padding: 3rem 1.5rem; max-width: 32rem; }
</style>
</head>
<body>
<h1>Not reachable</h1>
<p>The dashboard is on the tailnet, and this device cannot reach it right now.</p>
<p><a href="/">Try again</a></p>
</body>
</html>
`;

/** The service worker, as the browser will receive it.
 *
 *  It exists for two things: so the browser offers to install the page
 *  at all, and so an installed app says something honest when the
 *  server is not there. It caches NOTHING, and that is the design
 *  rather than an omission — every line of this dashboard is live
 *  state, and a queue served out of yesterday's storage would be worse
 *  than no app at all. */
export const SERVICE_WORKER = `// Served from /sw.js — built in src/render/pwa.ts, never a file on disk.
const OFFLINE_PAGE = ${JSON.stringify(OFFLINE_PAGE)};

// Take over at once: there is no cached anything for an older copy to
// be holding on to, so nothing is gained by waiting for the old worker.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  // Page loads only. An image or an API call that fails is the page's
  // own business, and answering one with HTML would lie about its type.
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(
      () =>
        new Response(OFFLINE_PAGE, {
          status: 503,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
    ),
  );
});
`;

/** The four elements that turn a page into something a browser offers
 *  to install. They go in every `<head>` the shell builds, beside
 *  `ICON_LINKS` and for the same reason: one place, every page. */
export const PWA_LINKS =
  `<link rel="manifest" href="/manifest.webmanifest">\n` +
  // iOS reads this and not the manifest's icons for "Add to Home Screen".
  `<link rel="apple-touch-icon" href="/apple-touch-icon.png">\n` +
  `<meta name="theme-color" content="${THEME_COLORS.light}" media="(prefers-color-scheme: light)">\n` +
  `<meta name="theme-color" content="${THEME_COLORS.dark}" media="(prefers-color-scheme: dark)">`;
