// The New spec page's Spec and Options tabs in a real browser: what each
// shows, Create pressed from either, the switch back to Spec when the
// browser finds a required field there empty, and one post carrying both
// tabs' values.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { browserDeadline, withBrowser } from "../../helpers/browser-deadline.ts";
import { queueHarness } from "../../helpers/queue-server.ts";

browserDeadline();

const harness = queueHarness("aide-e2e-new-spec-tabs-");
let browser: Browser;
let base: string;

// Model choices, so the phase table draws its AI and model pickers.
const QUEUE_DEFAULTS = {
  timeoutSec: { default: 1200 },
  permissionMode: { default: "acceptEdits" },
  model: { default: "sonnet" },
  modelChoices: { sonnet: {}, fable: {} },
};

beforeAll(async () => {
  browser = await withBrowser(chromium.launch(), "chromium.launch()");
  base = harness.start({ extra: { queueDefaults: QUEUE_DEFAULTS } }).base;
});

afterAll(async () => {
  await browser.close();
  harness.cleanup();
});

interface Opened {
  page: Page;
  /** The body of every create post, in order. */
  posts: URLSearchParams[];
  /** Lets the create post that is being held answer. */
  release: () => void;
}

/** `/new` with every create post recorded and answered as accepted —
 *  once `release()` is called when `hold` is set. */
async function open(o: { hold?: boolean; query?: string } = {}): Promise<Opened> {
  const page = await (await browser.newContext()).newPage();
  const posts: URLSearchParams[] = [];
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/queue/create", async (route) => {
    posts.push(new URLSearchParams(route.request().postData() ?? ""));
    if (o.hold) await held;
    await route.fulfill({ status: 200, json: { ok: true, job: { id: "j1" } } });
  });
  await withBrowser(page.goto(`${base}/new?live=0${o.query ?? ""}`), "page.goto(/new)");
  return { page, posts, release };
}

const tab = (page: Page, name: string) => page.locator("nav[data-new-spec-tabs]").getByRole("link", { name, exact: true });
const create = (page: Page) => page.getByRole("button", { name: "Create", exact: true });
const title = (page: Page) => page.locator('#new-spec-form input[name="title"]');
const focusedName = (page: Page) =>
  page.evaluate(() => (document.activeElement as HTMLElement | null)?.getAttribute("name") ?? null);

/** Two animation frames, so a focus the browser moves after a press has landed. */
function settle(p: Page): Promise<void> {
  return p.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
}

/** Project, title and description filled in on the Spec tab. */
async function fillSpec(page: Page): Promise<void> {
  await page.locator('#new-spec-form select[name="project"]').selectOption("aide");
  await title(page).fill("A title");
  await page.locator('#new-spec-form textarea[name="description"]').fill("A description");
}

describe("the New spec page's two tabs", () => {
  test("it opens on Spec, with Title shown and the Options settings not (AC-1)", async () => {
    const { page } = await open();
    expect(await tab(page, "Spec").getAttribute("aria-current")).toBe("page");
    expect(await title(page).isVisible()).toBe(true);
    expect(await page.locator("#new-spec-criteria-checks").isVisible()).toBe(false);
  });

  test("Spec holds the Project picker, Title, Description and Depends on (AC-2)", async () => {
    const { page } = await open();
    await page.locator('#new-spec-form select[name="project"]').selectOption("aide");
    expect(await page.locator('#new-spec-form select[name="project"]').isVisible()).toBe(true);
    expect(await title(page).isVisible()).toBe(true);
    expect(await page.locator('#new-spec-form textarea[name="description"]').isVisible()).toBe(true);
    expect(await page.locator('#new-spec-form label[data-depends="81-queue-and-runner"]').isVisible()).toBe(true);
  });

  test("Options holds the four settings and every phase's box, AI and model, and keeps what Spec holds (AC-3)", async () => {
    const { page } = await open();
    await title(page).fill("Kept across tabs");
    await tab(page, "Options").click();
    for (const name of ["acceptanceRequired", "aiFormulateAcceptance", "chooseApproach"]) {
      expect(await page.locator(`#new-spec-form label:has(> input[name="${name}"])`).isVisible()).toBe(true);
    }
    expect(await page.locator("#new-spec-criteria-checks").isVisible()).toBe(true);
    for (const step of ["create", "analyze", "implement", "archive"]) {
      const line = page.locator(`#new-spec-form tr[data-step="${step}"]`);
      expect(await line.locator(`label[data-phase="${step}"]`).isVisible()).toBe(true);
      expect(await line.locator(`select[data-ai="model.${step}"]`).isVisible()).toBe(true);
      expect(await line.locator(`select[name="model.${step}"]`).isVisible()).toBe(true);
    }
    expect(await title(page).isVisible()).toBe(false);
    expect(await page.locator("#leaveapp").isVisible()).toBe(false);
    await tab(page, "Spec").click();
    expect(await title(page).isVisible()).toBe(true);
    expect(await title(page).inputValue()).toBe("Kept across tabs");
  });

  test("Create is shown on either tab (AC-4)", async () => {
    const { page } = await open();
    expect(await create(page).isVisible()).toBe(true);
    await tab(page, "Options").click();
    expect(await create(page).isVisible()).toBe(true);
  });

  test("Create reads Creating… and is locked while its request is out, and Enter in Title presses it (AC-4, AC-6)", async () => {
    const held = await open({ hold: true });
    await fillSpec(held.page);
    await create(held.page).click();
    await held.page.waitForFunction(() => document.querySelector('button[form="new-spec-form"]')?.textContent === "Creating…");
    expect(await create(held.page).count()).toBe(0);
    const busy = held.page.getByRole("button", { name: "Creating…" });
    expect(await busy.isDisabled()).toBe(true);
    held.release();

    const entered = await open();
    await fillSpec(entered.page);
    await Promise.all([
      entered.page.waitForRequest("**/api/queue/create"),
      title(entered.page).press("Enter"),
    ]);
    expect(entered.posts.length).toBe(1);
  });
});

describe("Create pressed with a required field on Spec empty", () => {
  test("from Options with Title empty, Spec is shown with Title focused and its message, and nothing is sent (AC-5)", async () => {
    const { page, posts } = await open({ query: "&tab=options" });
    await tab(page, "Spec").click();
    await page.locator('#new-spec-form select[name="project"]').selectOption("aide");
    await page.locator('#new-spec-form textarea[name="description"]').fill("A description");
    await tab(page, "Options").click();
    await create(page).click();
    await settle(page);
    expect(await title(page).isVisible()).toBe(true);
    expect(await tab(page, "Spec").getAttribute("aria-current")).toBe("page");
    expect(await focusedName(page)).toBe("title");
    expect(await title(page).evaluate((el) => (el as HTMLInputElement).validationMessage)).not.toBe("");
    expect(posts.length).toBe(0);
  });

  test("from Options with everything empty, Spec is shown with the Project picker focused (AC-5)", async () => {
    const { page, posts } = await open({ query: "&tab=options" });
    await create(page).click();
    await settle(page);
    expect(await title(page).isVisible()).toBe(true);
    expect(await focusedName(page)).toBe("project");
    expect(posts.length).toBe(0);
  });
});

describe("Create pressed with Spec filled in", () => {
  /** Spec filled in, Stop chosen and the approach box ticked on Options,
   *  then Create pressed from `from`: what was posted, and whether the
   *  tab shown when the request went out was still `from`. */
  async function pressFrom(from: "Spec" | "Options"): Promise<{ body: URLSearchParams; stayed: boolean }> {
    const { page, posts, release } = await open({ hold: true });
    await fillSpec(page);
    await tab(page, "Options").click();
    await page.locator("#new-spec-criteria-checks").selectOption("stop");
    await page.locator('#new-spec-form label:has(> input[name="chooseApproach"])').click();
    if (from === "Spec") await tab(page, "Spec").click();
    await Promise.all([page.waitForRequest("**/api/queue/create"), create(page).click()]);
    const stayed = (await tab(page, from).getAttribute("aria-current")) === "page";
    release();
    return { body: posts[0]!, stayed };
  }

  test.each(["Options", "Spec"] as const)("from %s, it sends both tabs' values without switching tabs (AC-5, AC-6)", async (from) => {
    const { body, stayed } = await pressFrom(from);
    expect(stayed).toBe(true);
    expect(body.get("project")).toBe("aide");
    expect(body.get("title")).toBe("A title");
    expect(body.get("description")).toBe("A description");
    expect(body.get("criteriaChecks")).toBe("stop");
    expect(body.get("chooseApproach")).toBe("1");
    expect(body.getAll("steps")).toEqual(["analyze", "implement", "archive"]);
  });
});

describe("where the Options tab's controls sit", () => {
  interface Box { left: number; right: number; top: number; bottom: number }
  interface Measured { table: Box; controls: Box[]; scrollWidth: number; innerWidth: number }

  /** The phase table's box and each option's control box, in the order
   *  the options are listed: found by name or id, read in one pass. */
  function measure(page: Page): Promise<Measured> {
    return page.evaluate(() => {
      const box = (els: Element[]) => {
        const rects = els.map((el) => el.getBoundingClientRect());
        return {
          left: Math.min(...rects.map((r) => r.left)),
          right: Math.max(...rects.map((r) => r.right)),
          top: Math.min(...rects.map((r) => r.top)),
          bottom: Math.max(...rects.map((r) => r.bottom)),
        };
      };
      const one = (sel: string) => document.querySelector(sel) as Element;
      const form = "#new-spec-form";
      return {
        table: box([one(`${form} tr[data-step="create"]`).closest("table")!]),
        controls: [
          box([one(`${form} label:has(> input[name="acceptanceRequired"])`)]),
          box([one(`${form} label:has(> input[name="aiFormulateAcceptance"])`)]),
          box([one('label[for="new-spec-criteria-checks"]'), one("#new-spec-criteria-checks")]),
          box([one(`${form} label:has(> input[name="chooseApproach"])`)]),
        ],
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      };
    });
  }

  /** The four controls in two lines of two: each pair shares a line, the
   *  first of a pair left of the second, and the first line above the second. */
  function twoToALine(m: Measured): void {
    const [a, b, c, d] = m.controls as [Box, Box, Box, Box];
    for (const [x, y] of [[a, b], [c, d]] as const) {
      expect(x.top).toBeLessThan(y.bottom);
      expect(y.top).toBeLessThan(x.bottom);
      expect(x.right).toBeLessThanOrEqual(y.left);
    }
    expect(Math.max(a.bottom, b.bottom)).toBeLessThanOrEqual(Math.min(c.top, d.top));
  }

  /** The Options tab opened, then the window set to `width` x 800. */
  async function measuredAt(width: number): Promise<Measured> {
    const { page } = await open({ query: "&tab=options" });
    await page.setViewportSize({ width, height: 800 });
    return measure(page);
  }

  test("on a desktop window the four options sit beside the phase table (AC-1)", async () => {
    const m = await measuredAt(1280);
    for (const c of m.controls) expect(c.left).toBeGreaterThanOrEqual(m.table.right);
    const firstLineTop = Math.min(m.controls[0]!.top, m.controls[1]!.top);
    expect(firstLineTop).toBeLessThan(m.table.bottom);
  });

  test("the four options stand two to a line (AC-2)", async () => {
    twoToALine(await measuredAt(1280));
  });

  test("on a phone the options sit below the phase table, still two to a line (AC-3)", async () => {
    const m = await measuredAt(375);
    for (const c of m.controls) expect(c.top).toBeGreaterThanOrEqual(m.table.bottom);
    twoToALine(m);
    expect(m.scrollWidth).toBeLessThanOrEqual(m.innerWidth);
  });
});
