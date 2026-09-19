// Spec 173: what makes the dashboard installable — a manifest, its
// icons (SVG and, since spec 505, PNG), an apple-touch-icon and a service worker.
//
// Every one of them is a resource at a URL, which is the one thing
// `brand.ts` says this site never has ("a page that references
// /aide-mark.svg is a page that breaks the moment it is opened from a
// folder"). The way out is not a build step: they are COMPUTED
// responses, built from the same TypeScript the mark is built from and
// served by `serve.ts`, so nothing is written to disk and nothing can
// drift from the source that generated it. These tests are what says
// so — that the eight routes answer, that they answer without a token,
// and that the worker behind them caches nothing.
import { afterEach, describe, expect, test } from "bun:test";
import { appIcon, appIconMaskable } from "../../../src/render/ui/brand.ts";
import { CSS } from "../../../src/render/ui/css";
import { APPLE_TOUCH_ICON, SERVICE_WORKER, THEME_COLORS } from "../../../src/render/ui/pwa.ts";
import { barCentres, coloredBox, decodePng, hexRgb, readIconSvg } from "../../helpers/icon-image.ts";
import { queueHarness } from "../../helpers/queue-server.ts";

const harness = queueHarness("aide-pwa-");
const start = () => harness.start();

afterEach(() => harness.cleanup());

// --- the eight routes (criteria 1-3) -----------------------------------------

describe("the manifest (criterion 1)", () => {
  test("it is served, as JSON of its own media type, with no token", async () => {
    const { base } = start();
    const res = await fetch(`${base}/manifest.webmanifest`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/manifest+json");
  });

  test("it carries the fields a browser needs before it offers to install", async () => {
    const { base } = start();
    const manifest = (await (await fetch(`${base}/manifest.webmanifest`)).json()) as Record<
      string,
      unknown
    >;
    expect(manifest.name).toBe("aide -board");
    expect(typeof manifest.short_name).toBe("string");
    // An installed app opens on the spec list, and its scope is the
    // whole dashboard: a link out of scope opens a browser tab.
    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBe("/");
    // Without this it is a bookmark with an icon, not an app.
    expect(manifest.display).toBe("standalone");
    expect(manifest.background_color).toBe(THEME_COLORS.light);
    expect(manifest.theme_color).toBe(THEME_COLORS.light);
  });

  type Icon = { src: string; sizes: string; purpose: string; type: string };
  const icons = async (base: string) =>
    ((await (await fetch(`${base}/manifest.webmanifest`)).json()) as { icons: Icon[] }).icons;

  test("it lists a 192 and a 512 PNG for the launcher (AC-1)", async () => {
    const { base } = start();
    const list = await icons(base);
    for (const sizes of ["192x192", "512x512"])
      expect(list.some((i) => i.type === "image/png" && i.sizes === sizes && i.purpose === "any")).toBe(true);
  });

  test("every PNG it names answers as a well-formed PNG of the size it claims (AC-1, AC-2)", async () => {
    const { base } = start();
    const pngs = (await icons(base)).filter((i) => i.type === "image/png");
    expect(pngs).toHaveLength(3);
    for (const icon of pngs) {
      const res = await fetch(`${base}${icon.src}`);
      expect([icon.src, res.status, res.headers.get("content-type")]).toEqual([icon.src, 200, "image/png"]);
      const png = decodePng(new Uint8Array(await res.arrayBuffer()));
      expect(`${png.width}x${png.height}`).toBe(icon.sizes);
    }
  });

  test("it lists a maskable PNG of at least 512 (AC-2)", async () => {
    const { base } = start();
    const m = (await icons(base)).find((i) => i.purpose === "maskable" && i.type === "image/png");
    expect(m).toBeDefined();
    expect(Number(m!.sizes.split("x")[0])).toBeGreaterThanOrEqual(512);
  });

  test("the SVG icons are still listed and still answer (AC-4)", async () => {
    const { base } = start();
    const list = await icons(base);
    const svgs = list.filter((i) => i.type === "image/svg+xml");
    expect(svgs.map((i) => [i.src, i.sizes, i.purpose])).toEqual([
      ["/icon-512.svg", "any", "any"],
      ["/icon-512-maskable.svg", "any", "maskable"],
    ]);
    for (const icon of svgs) {
      const res = await fetch(`${base}${icon.src}`);
      expect([icon.src, res.status, res.headers.get("content-type")]).toEqual([
        icon.src,
        200,
        "image/svg+xml; charset=utf-8",
      ]);
    }
  });

  test("each PNG route serves the artwork of its own purpose (AC-3)", async () => {
    const { base } = start();
    const plain = readIconSvg(await (await fetch(`${base}/icon-512.svg`)).text());
    const maskable = readIconSvg(await (await fetch(`${base}/icon-512-maskable.svg`)).text());
    const load = async (path: string) => decodePng(new Uint8Array(await (await fetch(`${base}${path}`)).arrayBuffer()));
    const p192 = await load("/icon-192.png");
    const p512 = await load("/icon-512.png");
    const m512 = await load("/icon-512-maskable.png");
    expect(barCentres(p192, plain.bars)).toEqual(plain.bars.map((b) => hexRgb(b.fill)));
    expect(barCentres(p512, plain.bars)).toEqual(plain.bars.map((b) => hexRgb(b.fill)));
    expect(barCentres(m512, maskable.bars)).toEqual(maskable.bars.map((b) => hexRgb(b.fill)));
    const span = (png: typeof p512) => {
      const box = coloredBox(png, hexRgb(plain.canvas));
      return box.x1 - box.x0;
    };
    expect(span(m512)).toBeLessThan(span(p512));
  });
});

describe("the service worker (criterion 2)", () => {
  test("it is served with a fetch handler, a JavaScript type and no caching of its own", async () => {
    const { base } = start();
    const res = await fetch(`${base}/sw.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    // A worker the browser holds on to is a worker a fix cannot reach:
    // `no-cache` makes it revalidate before using the copy it has.
    expect(res.headers.get("cache-control")).toBe("no-cache");
    // What Chrome's install check actually looks for.
    expect(await res.text()).toContain('addEventListener("fetch"');
  });
});

describe("the icons (criterion 3)", () => {
  const cases: [string, string][] = [
    ["/icon-512.svg", "image/svg+xml; charset=utf-8"],
    ["/icon-512-maskable.svg", "image/svg+xml; charset=utf-8"],
    ["/icon-192.png", "image/png"],
    ["/icon-512.png", "image/png"],
    ["/icon-512-maskable.png", "image/png"],
    ["/apple-touch-icon.png", "image/png"],
  ];

  for (const [path, type] of cases) {
    test(`${path} answers with ${type}`, async () => {
      const { base } = start();
      const res = await fetch(`${base}${path}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe(type);
      expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(100);
    });
  }

  test("the apple-touch-icon is a real PNG, not a placeholder", async () => {
    const { base } = start();
    const bytes = new Uint8Array(await (await fetch(`${base}/apple-touch-icon.png`)).arrayBuffer());
    // \x89PNG — iOS wants a raster icon and will show nothing at all
    // for a file that only claims to be one.
    expect([...bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(bytes.length).toBe(APPLE_TOUCH_ICON.length);
  });
});

describe("the eight answer any request with a Host of the dashboard's own", () => {
  const PATHS = [
    "/manifest.webmanifest",
    "/sw.js",
    "/icon-512.svg",
    "/icon-512-maskable.svg",
    "/icon-192.png",
    "/icon-512.png",
    "/icon-512-maskable.png",
    "/apple-touch-icon.png",
  ];

  test("each answers 200 with no credential at all", async () => {
    const { base } = start();
    for (const path of PATHS) {
      expect([path, (await fetch(`${base}${path}`)).status]).toEqual([path, 200]);
    }
  });

  test("a POST to one of them is refused rather than answered", async () => {
    const { base } = start();
    const res = await fetch(`${base}/manifest.webmanifest`, { method: "POST" });
    expect(res.status).toBe(405);
  });

  test("a POST to a PNG icon is refused too (AC-1, AC-2)", async () => {
    const { base } = start();
    for (const path of ["/icon-192.png", "/icon-512.png", "/icon-512-maskable.png"])
      expect([path, (await fetch(`${base}${path}`, { method: "POST" })).status]).toEqual([path, 405]);
  });
});

// --- the maskable icon's safe zone (criterion 7) -----------------------------

/** Every bar in an icon, in the icon's OWN coordinates: the bars are
 *  drawn once, on the 64 grid `brand.ts` describes, and placed by a
 *  transform on the group around them. What a launcher crops is the
 *  transformed position, so that is what this reads. */
function barBounds(svg: string): { x0: number; y0: number; x1: number; y1: number }[] {
  const box = /viewBox="0 0 (\d+) \d+"/.exec(svg);
  expect(box).not.toBeNull();
  const g = /<g transform="translate\(([-\d.]+) ([-\d.]+)\) scale\(([\d.]+)\)">([\s\S]*)<\/g>/.exec(svg);
  expect(g).not.toBeNull();
  const [tx, ty, scale] = [Number(g![1]), Number(g![2]), Number(g![3])];
  const rects = [...g![4]!.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)];
  expect(rects.length).toBe(4);
  return rects.map((m) => {
    const [x, y, w, h] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
    return { x0: x * scale + tx, y0: y * scale + ty, x1: (x + w) * scale + tx, y1: (y + h) * scale + ty };
  });
}

const VIEWBOX = 64;

describe("the maskable icon keeps the mark inside the safe zone (criterion 7)", () => {
  const svg = appIconMaskable("#EFECE5");

  // The box the plan named — 10% in from every edge. Kept, and not
  // relied on: the mark is already inset on its own grid, so an
  // UNSHRUNK mark passes this by a tenth of a unit. The circle below
  // is what actually decides whether the icon survives a crop.
  test("every bar sits at least 10% of the canvas in from every edge", () => {
    const margin = VIEWBOX * 0.1;
    for (const bar of barBounds(svg)) {
      expect(bar.x0).toBeGreaterThanOrEqual(margin);
      expect(bar.y0).toBeGreaterThanOrEqual(margin);
      expect(bar.x1).toBeLessThanOrEqual(VIEWBOX - margin);
      expect(bar.y1).toBeLessThanOrEqual(VIEWBOX - margin);
    }
  });

  test("and inside the circle the platforms actually document", () => {
    // A maskable icon may be cropped to a circle, a squircle or a
    // rounded square, and the one region every shape keeps is the
    // circle of 40% radius on the centre. Four corners per bar,
    // because a corner is what leaves a circle first.
    const radius = VIEWBOX * 0.4;
    for (const bar of barBounds(svg)) {
      for (const [x, y] of [
        [bar.x0, bar.y0],
        [bar.x1, bar.y0],
        [bar.x0, bar.y1],
        [bar.x1, bar.y1],
      ]) {
        expect(Math.hypot(x! - VIEWBOX / 2, y! - VIEWBOX / 2)).toBeLessThanOrEqual(radius);
      }
    }
  });

  test("the canvas is filled, because a launcher decides what is behind a transparent one", () => {
    expect(svg).toContain(`<rect width="64" height="64" fill="#EFECE5"/>`);
  });

  test("the mark is centred on the canvas rather than left where the favicon has it", () => {
    // The bars run x 14..59 on a 64 grid — 14 in from the left, 5 from
    // the right. Unnoticeable at favicon size; a visible lean at 512.
    const bars = barBounds(svg);
    const left = Math.min(...bars.map((b) => b.x0));
    const right = VIEWBOX - Math.max(...bars.map((b) => b.x1));
    expect(Math.abs(left - right)).toBeLessThan(0.5);
  });

  test("the plain icon uses the same bars, just less shy of the edges", () => {
    const plain = barBounds(appIcon("#EFECE5"));
    const maskable = barBounds(svg);
    const width = (bars: { x0: number; x1: number }[]) =>
      Math.max(...bars.map((b) => b.x1)) - Math.min(...bars.map((b) => b.x0));
    expect(width(plain)).toBeGreaterThan(width(maskable));
  });
});

// --- the colours the installed window is painted in --------------------------

/** The value of one token, read out of the stylesheet the page actually
 *  ships — the same trick `css-token-guard.test.ts` uses. */
function token(selector: string, name: string): string {
  const at = CSS.indexOf(selector);
  expect(at).toBeGreaterThan(-1);
  const value = new RegExp(`${name}:\\s*([^;]+)`).exec(CSS.slice(at));
  expect(value).not.toBeNull();
  return value![1]!.trim();
}

describe("the app's colours are the page's colours", () => {
  // `theme_color` and the two `theme-color` metas paint the window's
  // title bar and a phone's status bar. Off by one shade and the
  // installed app has a seam across the top that the browser tab never
  // had — and nothing in the suite would notice, because the page
  // itself still looks right.
  test("light is the page's own background", () => {
    expect(THEME_COLORS.light).toBe(token(":root {", "--bg"));
  });

  test("dark is the dark page's own background", () => {
    expect(THEME_COLORS.dark).toBe(token(':root[data-theme="dark"] {', "--bg"));
  });
});

// --- the worker itself -------------------------------------------------------

/** The worker script, run against a fake global scope. It is a SCRIPT
 *  — no imports, no exports — so it can be run the way
 *  `theme-script.test.ts` runs the theme switcher: as a function of the
 *  globals it uses. */
function worker(networkAnswer: () => Promise<Response>) {
  const listeners: Record<string, (event: unknown) => void> = {};
  const shown: { title: string; options: { body?: string; data?: { url?: string } } }[] = [];
  const opened: string[] = [];
  const self = {
    addEventListener: (type: string, fn: (event: unknown) => void) => void (listeners[type] = fn),
    clients: { claim: () => Promise.resolve(), openWindow: async (url: string) => void opened.push(url) },
    registration: {
      showNotification: async (title: string, options: { body?: string; data?: { url?: string } }) =>
        void shown.push({ title, options }),
    },
  };
  // eslint-disable-next-line no-new-func -- the thing under test IS a script
  new Function("self", "fetch", SERVICE_WORKER)(self, networkAnswer);

  /** An event that collects what `waitUntil` was handed, so a test can
   *  wait for the work the handler started. */
  const event = (extra: object) => {
    const waits: Promise<unknown>[] = [];
    return { ev: { ...extra, waitUntil: (p: Promise<unknown>) => void waits.push(p) }, done: () => Promise.all(waits) };
  };

  return {
    types: () => Object.keys(listeners),
    shown,
    opened,
    /** A push message arriving; `data` is what `event.data.json()` does. */
    push: async (json: () => unknown) => {
      const e = event({ data: { json } });
      listeners.push!(e.ev);
      await e.done();
    },
    /** A tap on a notification. */
    tap: async (url: string | undefined) => {
      let closed = false;
      const e = event({ notification: { close: () => void (closed = true), data: url === undefined ? {} : { url } } });
      listeners.notificationclick!(e.ev);
      await e.done();
      return closed;
    },
    /** One navigation through the worker. `undefined` means the worker
     *  declined to answer, which leaves the request to the browser. */
    navigate: async (mode = "navigate"): Promise<Response | undefined> => {
      let answered: Promise<Response> | undefined;
      listeners.fetch!({
        request: { mode, url: "https://board.test/" },
        respondWith: (r: Promise<Response>) => void (answered = r),
      });
      return answered ? await answered : undefined;
    },
  };
}

describe("the worker passes everything through and caches nothing", () => {
  test("it takes over as soon as it is installed", () => {
    expect(worker(async () => new Response("ok")).types().sort()).toEqual([
      "activate",
      "fetch",
      "install",
      "notificationclick",
      "push",
    ]);
  });

  test("it never touches the cache API — a stale queue is worse than no app", () => {
    // Not a style rule: every line on this dashboard is live state, so
    // there is nothing here that is safe to serve from yesterday.
    expect(SERVICE_WORKER).not.toContain("caches");
    expect(SERVICE_WORKER).not.toContain("cache.put");
  });

  test("a page load is answered by the server, not by the worker", async () => {
    const w = worker(async () => new Response("the live page", { status: 200 }));
    expect(await (await w.navigate())!.text()).toBe("the live page");
  });

  test("a request that is not a page load is left alone entirely", async () => {
    const w = worker(async () => new Response("ok"));
    // An image or an API call that fails is the page's own business,
    // and answering one with HTML would lie about its type.
    expect(await w.navigate("no-cors")).toBeUndefined();
  });

  test("with the server unreachable it says so, rather than showing the browser's error", async () => {
    const w = worker(async () => {
      throw new Error("the tailnet is not there");
    });
    const res = (await w.navigate())!;
    expect(res.status).toBe(503);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html.toLowerCase()).toContain("reach");
    // And it offers the one thing that helps: trying again.
    expect(html).toContain("Try again");
  });
});

// --- push: what the worker does with a message and a tap (spec 501) ---------

describe("the worker shows every push and opens the spec on a tap (criterion 10)", () => {
  test("a push becomes a notification with the title, the body and the spec's path", async () => {
    const w = worker(async () => new Response("ok"));
    await w.push(() => ({ title: "aide · 81-x", body: "Implement failed.", url: "/specs/aide/81-x" }));
    expect(w.shown).toEqual([{ title: "aide · 81-x", options: expect.objectContaining({ body: "Implement failed.", data: { url: "/specs/aide/81-x" } }) }]);
  });

  test("a push with no payload, or one that is not JSON, still shows a notification", async () => {
    // iOS revokes a subscription that receives a push and shows nothing.
    const w = worker(async () => new Response("ok"));
    await w.push(() => {
      throw new SyntaxError("not json");
    });
    await w.push(() => ({}));
    expect(w.shown).toHaveLength(2);
    expect(w.shown[0]!.title).toBeTruthy();
    expect(w.shown[1]!.options.data?.url).toBe("/");
  });

  test("a tap closes the notification and opens the spec's path", async () => {
    const w = worker(async () => new Response("ok"));
    expect(await w.tap("/specs/aide/81-x")).toBe(true);
    expect(w.opened).toEqual(["/specs/aide/81-x"]);
  });

  test("the notification has no tag, so a second event about a spec does not replace the first", async () => {
    const w = worker(async () => new Response("ok"));
    await w.push(() => ({ title: "t", body: "b", url: "/" }));
    expect(w.shown[0]!.options).not.toHaveProperty("tag");
  });
});
