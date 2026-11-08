// What makes the dashboard installable — a manifest, its
// icons (SVG and PNG), an apple-touch-icon and a service worker.
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
import { t } from "../../../src/i18n";
import { LOADING_CSS, TOKENS_CSS } from "../../../src/render/ui/css";
import { NEW_SPEC_ROUTE } from "../../../src/render/pages/projects-page/routes.ts";
import { APP_START_ROUTE, PWA_FILES, SERVICE_WORKER, THEME_COLORS, WAIT_SCRIPT } from "../../../src/render/ui/pwa.ts";
import { queueHarness } from "../../helpers/queue-server.ts";

const harness = queueHarness("aide-pwa-");
const start = () => harness.start();

afterEach(() => harness.cleanup());

// --- the eight routes --------------------------------------------------------

describe("the manifest", () => {
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
    // An installed app opens on the address that picks the tab or the
    // list, under the same `id` as ever, and its scope is the whole
    // dashboard: a link out of scope opens a browser tab.
    expect(manifest.id).toBe("/");
    expect(manifest.start_url).toBe(APP_START_ROUTE);
    expect(manifest.scope).toBe("/");
    // Without this it is a bookmark with an icon, not an app.
    expect(manifest.display).toBe("standalone");
    expect(manifest.background_color).toBe(THEME_COLORS.light);
    expect(manifest.theme_color).toBe(THEME_COLORS.light);
  });

  type Icon = { src: string; sizes: string; purpose: string; type: string };
  const icons = async (base: string) =>
    ((await (await fetch(`${base}/manifest.webmanifest`)).json()) as { icons: Icon[] }).icons;

  test("it lists a 192 and a 512 PNG for the launcher", async () => {
    const { base } = start();
    const list = await icons(base);
    for (const sizes of ["192x192", "512x512"])
      expect(list.some((i) => i.type === "image/png" && i.sizes === sizes && i.purpose === "any")).toBe(true);
  });

  test("it lists a maskable PNG of at least 512", async () => {
    const { base } = start();
    const m = (await icons(base)).find((i) => i.purpose === "maskable" && i.type === "image/png");
    expect(m).toBeDefined();
    expect(Number(m!.sizes.split("x")[0])).toBeGreaterThanOrEqual(512);
  });

  test("the SVG icons are still listed and still answer", async () => {
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
});

describe("the manifest's shortcuts", () => {
  type Shortcut = { name: string; url: string; icons: { src: string; type: string }[] };
  const shortcuts = async (base: string) =>
    ((await (await fetch(`${base}/manifest.webmanifest`)).json()) as { shortcuts: Shortcut[] }).shortcuts;

  test("it lists Running, Specs and New spec, in that order", async () => {
    const { base } = start();
    expect((await shortcuts(base)).map((s) => s.url)).toEqual(["/", "/specs", NEW_SPEC_ROUTE]);
  });

  test("each is named for its page and carries an icon the board serves as a PNG", async () => {
    const { base } = start();
    const list = await shortcuts(base);
    expect(list[0]!.name).toBe(t("en", "shell.tabRunning"));
    expect(list[1]!.name).toBe(t("en", "shell.tabSpecs"));
    for (const shortcut of list) {
      expect(shortcut.icons.length).toBeGreaterThan(0);
      for (const icon of shortcut.icons) {
        expect(icon.type).toBe("image/png");
        expect((await fetch(`${base}${icon.src}`)).headers.get("content-type")).toBe("image/png");
      }
    }
  });
});

describe("the service worker", () => {
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

describe("the icons", () => {
  const cases: [string, string][] = [
    ["/icon-512.svg", "image/svg+xml; charset=utf-8"],
    ["/icon-512-maskable.svg", "image/svg+xml; charset=utf-8"],
    ["/icon-192.png", "image/png"],
    ["/icon-512.png", "image/png"],
    ["/icon-512-maskable.png", "image/png"],
    ["/apple-touch-icon.png", "image/png"],
    // Not an app icon and not in the manifest: the notification badge,
    // which only the service worker asks for.
    ["/badge-96.png", "image/png"],
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

  test("a POST to a PNG icon is refused too", async () => {
    const { base } = start();
    for (const path of ["/icon-192.png", "/icon-512.png", "/icon-512-maskable.png"])
      expect([path, (await fetch(`${base}${path}`, { method: "POST" })).status]).toEqual([path, 405]);
  });
});

// --- the worker itself -------------------------------------------------------

/** A window of the board the worker can find, recording what it was asked. */
function fakeWindow(refuseNavigate = false) {
  const calls: string[] = [];
  return {
    calls,
    focus: async () => void calls.push("focus"),
    navigate: async (url: string) => {
      calls.push(`navigate ${url}`);
      if (refuseNavigate) throw new TypeError("not controlled");
    },
  };
}

/** The worker script, run against a fake global scope. It is a SCRIPT
 *  — no imports, no exports — so it is run as a function of the
 *  globals it uses, timers and clock included: a test decides whether
 *  the half-second timer or the server comes first, with no waiting. */
function worker(networkAnswer: (request: { method: string; url: string }) => Promise<Response>, windows: ReturnType<typeof fakeWindow>[] = [], navigator?: object) {
  const listeners: Record<string, (event: unknown) => void> = {};
  const shown: {
    title: string;
    options: { body?: string; icon?: string; badge?: string; data?: { url?: string } };
  }[] = [];
  const opened: string[] = [];
  const clock = fakeClock();
  const self = {
    navigator,
    addEventListener: (type: string, fn: (event: unknown) => void) => void (listeners[type] = fn),
    clients: {
      claim: () => Promise.resolve(),
      openWindow: async (url: string) => void opened.push(url),
      matchAll: async () => windows,
    },
    registration: {
      showNotification: async (
        title: string,
        options: { body?: string; icon?: string; badge?: string; data?: { url?: string } },
      ) =>
        void shown.push({ title, options }),
    },
  };
  // eslint-disable-next-line no-new-func -- the thing under test IS a script
  new Function("self", "fetch", "setTimeout", "clearTimeout", "Date", SERVICE_WORKER)(
    self,
    networkAnswer,
    clock.setTimeout,
    clock.clearTimeout,
    { now: clock.now },
  );

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
    advance: clock.advance,
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
    /** One navigation through the worker; it answers when the worker does,
     *  so a slow one is awaited after `advance`. `undefined` means the
     *  worker declined to answer, which leaves the request to the browser. */
    navigate: async (mode = "navigate", method = "GET", url = "https://board.test/"): Promise<Response | undefined> => {
      let answered: Promise<Response> | undefined;
      listeners.fetch!({
        request: { mode, method, url },
        respondWith: (r: Promise<Response>) => void (answered = r),
      });
      return answered ? await answered : undefined;
    },
  };
}

/** Timers and a clock that move only when a test says so. */
function fakeClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { due: number; fn: () => void }>();
  const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
  return {
    now: () => now,
    setTimeout: (fn: () => void, ms: number) => {
      const id = nextId++;
      timers.set(id, { due: now + ms, fn });
      return id;
    },
    clearTimeout: (id: number) => void timers.delete(id),
    advance: async (ms: number) => {
      // Let an answer the test just handed over reach the code waiting on it.
      await settle();
      const target = now + ms;
      for (;;) {
        const next = [...timers.entries()].filter(([, t]) => t.due <= target).sort((a, b) => a[1].due - b[1].due)[0];
        if (!next) break;
        now = next[1].due;
        timers.delete(next[0]);
        next[1].fn();
        await settle();
      }
      now = target;
      await settle();
    },
  };
}

/** A request the test answers by hand, later. */
function pending() {
  let answer!: (r: Response) => void;
  let fail!: (e: Error) => void;
  const promise = new Promise<Response>((resolve, reject) => {
    answer = resolve;
    fail = reject;
  });
  return { promise, answer, fail };
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

  test("a page load posted to an unreachable server gets the not reachable page at once", async () => {
    const w = worker(async () => {
      throw new Error("the tailnet is not there");
    });
    const res = (await w.navigate("navigate", "POST"))!;
    expect(res.status).toBe(503);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html.toLowerCase()).toContain("reach");
    // And it offers the one thing that helps: trying again.
    expect(html).toContain("Try again");
  });
});

// --- the wait page: what the worker answers while the server is slow ---------

/** The worker with a server that answers when the test says. */
function slowServer() {
  const requests: { method: string; url: string; answer: (r: Response) => void; fail: (e: Error) => void }[] = [];
  const w = worker((request) => {
    const p = pending();
    requests.push({ ...request, answer: p.answer, fail: p.fail });
    return p.promise;
  });
  return { w, requests };
}

describe("a slow page load gets a wait page", () => {
  test("after half a second it is the moving mark and the host the app waits for", async () => {
    const { w } = slowServer();
    const answer = w.navigate("navigate", "GET", "https://board.test/specs");
    await w.advance(499);
    await w.advance(1);
    const res = (await answer)!;
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("pageloading");
    expect(html).toContain("Connecting to board.test…");
  });

  test("a request that fails outright gets the wait page, not the not reachable page", async () => {
    const { w, requests } = slowServer();
    const answer = w.navigate();
    await w.advance(200);
    requests[0]!.fail(new Error("the tailnet is not there"));
    const res = (await answer)!;
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Connecting to board.test…");
  });

  test("it gives the page the time left of 30 seconds after the page load", async () => {
    const { w } = slowServer();
    const answer = w.navigate();
    await w.advance(500);
    expect(await (await answer)!.text()).toContain("29500");
  });

  test("a failure at 200 ms leaves 29800 ms of the 30 seconds", async () => {
    const { w, requests } = slowServer();
    const answer = w.navigate();
    await w.advance(200);
    requests[0]!.fail(new Error("down"));
    expect(await (await answer)!.text()).toContain("29800");
  });

  test("a server that answers within half a second is shown with no wait page", async () => {
    const { w, requests } = slowServer();
    const answer = w.navigate();
    await w.advance(100);
    requests[0]!.answer(new Response("the live page"));
    await w.advance(1000);
    expect(await (await answer)!.text()).toBe("the live page");
  });

  test("a page load that is not a GET goes to the server once and never gets the wait page", async () => {
    const { w, requests } = slowServer();
    const answer = w.navigate("navigate", "POST");
    await w.advance(5000);
    expect(requests.map((r) => r.method)).toEqual(["POST"]);
    requests[0]!.answer(new Response("saved"));
    expect(await (await answer)!.text()).toBe("saved");
    expect(requests).toHaveLength(1);
  });

  test("the reload the wait page makes goes through with no timer, once", async () => {
    const { w, requests } = slowServer();
    const first = w.navigate();
    await w.advance(500);
    await first;
    const reload = w.navigate();
    await w.advance(3000);
    requests[1]!.answer(new Response("the live page"));
    expect(await (await reload)!.text()).toBe("the live page");
    // The pass-through is used up: the next load of the address is raced again.
    const next = w.navigate();
    await w.advance(500);
    expect(await (await next)!.text()).toContain("Connecting to");
  });

  test("a server answer that arrives after the wait page is dropped, and a later load asks again", async () => {
    const { w, requests } = slowServer();
    const first = w.navigate();
    await w.advance(500);
    await first;
    requests[0]!.answer(new Response("too late"));
    await w.advance(1);
    const later = w.navigate();
    requests[1]!.answer(new Response("fresh"));
    expect(requests).toHaveLength(2);
    expect(await (await later)!.text()).toBe("fresh");
  });
});

describe("the wait page itself", () => {
  const waitPage = async () => {
    const { w } = slowServer();
    const answer = w.navigate();
    await w.advance(500);
    return (await (await answer)!.text());
  };

  test("it carries the board's tokens and the loading stylesheet, and asks the network for nothing", async () => {
    const html = await waitPage();
    expect(html).toContain(TOKENS_CSS);
    expect(html).toContain(LOADING_CSS);
    expect(html).not.toMatch(/\ssrc=|<link|@import/);
    for (const match of html.matchAll(/url\(([^)]{0,6})/g)) expect(match[1]).toMatch(/^["']?data:/);
  });
});

/** The wait page's script, run against fakes the way restart-watch's is. */
function waitScript(asks: (n: number) => Promise<unknown>, leftMs = 29500) {
  const clock = fakeClock();
  let fetches = 0;
  let reloads = 0;
  const written: string[] = [];
  const location = { href: "https://board.test/specs", reload: () => void reloads++ };
  const document = { open: () => {}, write: (html: string) => void written.push(html), close: () => {} };
  const fetchFake = (url: string) => {
    expect(url).toBe(location.href);
    return asks(++fetches);
  };
  // eslint-disable-next-line no-new-func -- the thing under test IS a script
  new Function("fetch", "location", "document", "setTimeout", "clearTimeout", "OFFLINE_PAGE", "LEFT_MS", WAIT_SCRIPT)(
    fetchFake,
    location,
    document,
    clock.setTimeout,
    clock.clearTimeout,
    "<p>offline</p>",
    leftMs,
  );
  return { advance: clock.advance, fetches: () => fetches, reloads: () => reloads, written };
}

describe("the wait page's script", () => {
  test("it asks for its own address again a second after a failure, and keeps doing so", async () => {
    const s = waitScript(async () => {
      throw new TypeError("down");
    });
    await s.advance(0);
    expect(s.fetches()).toBe(1);
    await s.advance(999);
    expect(s.fetches()).toBe(1);
    await s.advance(1);
    expect(s.fetches()).toBe(2);
    await s.advance(1000);
    expect(s.fetches()).toBe(3);
  });

  test("it reloads once at the first answer, whatever its status, and asks no more", async () => {
    const s = waitScript(async () => new Response("", { status: 500 }));
    await s.advance(0);
    expect(s.reloads()).toBe(1);
    await s.advance(5000);
    expect(s.reloads()).toBe(1);
    expect(s.fetches()).toBe(1);
  });

  test("at the deadline it shows the not reachable page and asks no more", async () => {
    const s = waitScript(async () => {
      throw new TypeError("down");
    });
    await s.advance(29499);
    expect(s.written).toEqual([]);
    await s.advance(1);
    expect(s.written).toEqual(["<p>offline</p>"]);
    const asked = s.fetches();
    await s.advance(10000);
    expect(s.fetches()).toBe(asked);
    expect(s.reloads()).toBe(0);
  });

  test("an answer that comes after the deadline does not reload over the not reachable page", async () => {
    let answer!: () => void;
    const s = waitScript(() => new Promise<void>((resolve) => void (answer = resolve)));
    await s.advance(29500);
    answer();
    await s.advance(0);
    expect(s.reloads()).toBe(0);
  });
});

// --- push: what the worker does with a message and a tap ---------

describe("the worker shows every push and opens the spec on a tap", () => {
  test("a push becomes a notification with the title, the body and the spec's path", async () => {
    const w = worker(async () => new Response("ok"));
    await w.push(() => ({ title: "aide · 81-x", body: "Implement failed.", url: "/specs/aide/81-x" }));
    expect(w.shown).toEqual([{ title: "aide · 81-x", options: expect.objectContaining({ body: "Implement failed.", data: { url: "/specs/aide/81-x" } }) }]);
  });

  test("the badge it names is a file the board actually serves", () => {
    expect(Object.keys(PWA_FILES)).toContain("badge-96.png");
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

  test("a tap with no window of the board open closes the notification and opens the spec's path", async () => {
    const w = worker(async () => new Response("ok"));
    expect(await w.tap("/specs/aide/81-x")).toBe(true);
    expect(w.opened).toEqual(["/specs/aide/81-x"]);
  });

  test("a notification with no address opens the Running tab", async () => {
    const w = worker(async () => new Response("ok"));
    await w.tap(undefined);
    expect(w.opened).toEqual(["/"]);
  });

  test("a tap with a window open brings it to the front and loads the spec in it", async () => {
    const open = fakeWindow();
    const w = worker(async () => new Response("ok"), [open]);
    await w.tap("/specs/aide/81-x");
    expect(open.calls).toEqual(["focus", "navigate /specs/aide/81-x"]);
    expect(w.opened).toEqual([]);
  });

  test("a window that refuses to navigate stays in front and no second window opens", async () => {
    const open = fakeWindow(true);
    const w = worker(async () => new Response("ok"), [open]);
    await w.tap("/specs/aide/81-x");
    expect(open.calls[0]).toBe("focus");
    expect(w.opened).toEqual([]);
  });

  test("the notification has no tag, so a second event about a spec does not replace the first", async () => {
    const w = worker(async () => new Response("ok"));
    await w.push(() => ({ title: "t", body: "b", url: "/" }));
    expect(w.shown[0]!.options).not.toHaveProperty("tag");
  });
});

// --- push: the number on the app's icon --------------------------------------

describe("the worker sets the number on the app's icon when a push arrives", () => {
  /** A worker whose `self.navigator` records the badge calls. `refuses`:
   *  the call rejects, as an uninstalled tab's does. */
  function badged(refuses = false) {
    const calls: string[] = [];
    const answer = () => (refuses ? Promise.reject(new Error("not installed")) : Promise.resolve());
    const navigator = {
      setAppBadge: (n: number) => (calls.push(`set ${n}`), answer()),
      clearAppBadge: () => (calls.push("clear"), answer()),
    };
    return { calls, w: worker(async () => new Response("ok"), [], navigator) };
  }

  test("a push carrying a count sets it and still shows the notification", async () => {
    const { calls, w } = badged();
    await w.push(() => ({ title: "t", body: "b", url: "/", waiting: 2 }));
    expect(calls).toEqual(["set 2"]);
    expect(w.shown).toHaveLength(1);
  });

  test("a push carrying 0 clears the icon and sets no number", async () => {
    const { calls, w } = badged();
    await w.push(() => ({ title: "t", body: "b", url: "/", waiting: 0 }));
    expect(calls).toEqual(["clear"]);
  });

  test("a push with no count leaves the icon as it was and still shows the notification", async () => {
    const { calls, w } = badged();
    await w.push(() => ({ title: "t", body: "b", url: "/" }));
    await w.push(() => {
      throw new SyntaxError("not json");
    });
    expect(calls).toEqual([]);
    expect(w.shown).toHaveLength(2);
  });

  test("a device without the Badging API still gets its notification", async () => {
    for (const navigator of [undefined, {}]) {
      const w = worker(async () => new Response("ok"), [], navigator);
      await w.push(() => ({ title: "t", body: "b", url: "/", waiting: 2 }));
      expect(w.shown).toHaveLength(1);
    }
  });

  test("a refused badge is caught and the notification is still shown", async () => {
    const { calls, w } = badged(true);
    await w.push(() => ({ title: "t", body: "b", url: "/", waiting: 2 }));
    expect(calls).toEqual(["set 2"]);
    expect(w.shown).toHaveLength(1);
  });
});
