// The Deploy dialog's layout, measured in a browser: it is as tall as its
// steps and the line under them from the press to the end (AC-1), the
// running step's line is drawn in the accent colour with the running
// badge's spinner and no other line is (AC-2, AC-3), and the spinner
// stands still with reduced motion (AC-4). The four step requests and the
// version probe are answered by the test, so nothing is installed and no
// service is restarted.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { browserDeadline, withBrowser } from "../helpers/browser-deadline.ts";
import { fakeGit } from "../helpers/fake-git.ts";
import { queueHarness } from "../helpers/queue-server.ts";

browserDeadline();

const harness = queueHarness("aide-e2e-deploy-size-");
let browser: Browser;
let base: string;
const open: BrowserContext[] = [];

/** Two commits behind origin on the default branch: the state in which
 *  the Deploy button is live. */
const behind = fakeGit({
  "symbolic-ref": { code: 0, stdout: "refs/remotes/origin/main\n" },
  "rev-parse --abbrev-ref HEAD": { code: 0, stdout: "main\n" },
  "rev-list --count": { code: 0, stdout: "2\n" },
});

beforeAll(async () => {
  browser = await withBrowser(chromium.launch(), "chromium.launch()");
  const started = harness.start({ extra: { gitRun: behind.run, driftPollMs: 40 } });
  base = started.base;
  const project = join(started.dir, "root", "aide");
  mkdirSync(join(project, ".aide"), { recursive: true });
  writeFileSync(join(project, ".aide", "config"), "AIDE_INSTALL_CMD=/usr/bin/true\n");
  // The button is live only once the background poll has counted origin.
  const deadline = Date.now() + 10_000;
  for (;;) {
    const html = await (await fetch(`${base}/projects/aide?tab=deploy`)).text();
    if (/<form[^>]*class="deployform"[\s\S]*?<button type="submit" class="btn primary"(?![^>]*disabled)/.test(html)) break;
    if (Date.now() > deadline) throw new Error("the Deploy button never went live");
    await new Promise((r) => setTimeout(r, 50));
  }
});

afterAll(async () => {
  for (const context of open) await context.close().catch(() => {});
  await browser.close();
  harness.cleanup();
});


const URL_PATH = "/projects/aide?tab=deploy&live=0";

/** A page in a context of its own (a language sets a cookie), with the
 *  step requests answered after a beat, so a step is `running` long
 *  enough to be measured. `fail` names the step that answers 400 with a
 *  long error; `hold` names one that is not answered until `release()`. */
async function deployPage(
  o: { lang?: string; reducedMotion?: "reduce"; fail?: string; hold?: string } = {},
): Promise<{ page: Page; release: () => void }> {
  const context = await browser.newContext({ reducedMotion: o.reducedMotion ?? "no-preference" });
  open.push(context);
  const page = await context.newPage();
  let release = (): void => {};
  const gate = new Promise<void>((r) => (release = r));
  await page.route("**/api/queue/projects/aide/deploy/*", async (route) => {
    const step = route.request().url().split("/").pop()!;
    if (step === o.hold) await gate;
    else await new Promise((r) => setTimeout(r, 500));
    if (step === o.fail) {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "the install command failed — ".repeat(30) }),
      });
      return;
    }
    const body = step === "restart" ? { ok: true, restart: "fired", startedAt: "old" } : { ok: true };
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.route("**/api/version", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ sha: "abc", startedAt: "new" }) }),
  );
  await withBrowser(page.goto(`${base}${URL_PATH}${o.lang ? `&lang=${o.lang}` : ""}`), "page.goto(deploy)");
  return { page, release };
}

const press = async (page: Page): Promise<void> => {
  await page.locator("form.deployform button.btn.primary").click();
  await page.locator("dialog[data-deploy-dialog]").waitFor({ state: "visible" });
};

const size = async (page: Page): Promise<{ width: number; height: number }> => {
  const box = await page.locator("dialog[data-deploy-dialog]").boundingBox();
  expect(box).not.toBeNull();
  return { width: box!.width, height: box!.height };
};

/** What a step line's look is made of, read from computed style: its
 *  text colour, and what its slot before the name paints and animates. */
const lookOf = (page: Page, step: string) =>
  page.evaluate((s) => {
    const li = document.querySelector(`[data-step="${s}"]`)!;
    const slot = getComputedStyle(li, "::before");
    return {
      color: getComputedStyle(li).color,
      mask: slot.getPropertyValue("mask-image") || slot.getPropertyValue("-webkit-mask-image"),
      animation: slot.animationName,
      slotWidth: slot.width,
    };
  }, step);

/** The colour `--accent-strong` resolves to, and the badge's own
 *  spinner, added to the page so the two are compared like for like. */
const references = (page: Page) =>
  page.evaluate(() => {
    const probe = document.createElement("i");
    probe.style.color = "var(--accent-strong)";
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.dataset.icon = "loader";
    document.body.append(probe, badge);
    const slot = getComputedStyle(badge, "::before");
    return {
      accent: getComputedStyle(probe).color,
      mask: slot.getPropertyValue("mask-image") || slot.getPropertyValue("-webkit-mask-image"),
      animation: slot.animationName,
    };
  });

describe("the Deploy dialog's size", () => {
  test("is as tall as its steps and one line, and that line has its height before any step has run (AC-1)", async () => {
    const { page } = await deployPage();
    await press(page);
    const m = await page.evaluate(() => {
      const dialog = document.querySelector("dialog[data-deploy-dialog]")!;
      const message = dialog.querySelector(".deploymessage")!;
      const panel = dialog.querySelector(".confirmpanel")!;
      const pad = parseFloat(getComputedStyle(panel).paddingBottom);
      const border = parseFloat(getComputedStyle(dialog).borderBottomWidth);
      const lh = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--lh"));
      return {
        dialogBottom: dialog.getBoundingClientRect().bottom,
        messageBottom: message.getBoundingClientRect().bottom,
        messageHeight: message.getBoundingClientRect().height,
        oneLine: parseFloat(getComputedStyle(message).fontSize) * lh,
        pad,
        border,
        anyStepRan: [...document.querySelectorAll("[data-step]")].some((li) => (li as HTMLElement).dataset.state === "done"),
      };
    });
    expect(m.anyStepRan).toBe(false);
    expect(Math.abs(m.messageHeight - m.oneLine)).toBeLessThanOrEqual(1);
    expect(Math.abs(m.dialogBottom - (m.messageBottom + m.pad + m.border))).toBeLessThanOrEqual(1);
  });

  test("is the same at the press, at every step and when it is done (AC-1)", async () => {
    const { page } = await deployPage();
    await press(page);
    const atPress = await size(page);
    for (const step of ["fetch", "install", "restart", "wait", "check"]) {
      // Left `waiting`: running or already done, so a step that flashes by
      // between two polls is still measured.
      await page.waitForSelector(`[data-step="${step}"]:not([data-state="waiting"])`, { timeout: 15_000 });
      expect(await size(page)).toEqual(atPress);
    }
    await page.waitForSelector(".deploymessage:not(:empty)", { timeout: 15_000 });
    expect(await size(page)).toEqual(atPress);
  });

  test("is the same after a failure in German, whose failed state word is the widest (AC-1)", async () => {
    const { page } = await deployPage({ lang: "de", fail: "install" });
    await press(page);
    const atPress = await size(page);
    await page.waitForSelector('[data-step="install"][data-state="failed"]', { timeout: 15_000 });
    expect(await size(page)).toEqual(atPress);
  });
});

describe("the step lines", () => {
  test("the running line is in the accent colour with the running badge's spinner in front of its name (AC-2)", async () => {
    const { page, release } = await deployPage({ hold: "install" });
    await press(page);
    await page.waitForSelector('[data-step="install"][data-state="running"]', { timeout: 15_000 });
    const look = await lookOf(page, "install");
    const reference = await references(page);
    expect(look.color).toBe(reference.accent);
    expect(reference.animation).toBe("badgespin");
    expect(look.animation).toBe(reference.animation);
    expect(look.mask).not.toBe("none");
    expect(look.mask).toBe(reference.mask);
    release();
  });

  test("a waiting, a done and a failed line have no spinner and are not in the accent colour, and only one line at a time is (AC-3)", async () => {
    const running = await deployPage({ hold: "install" });
    await press(running.page);
    await running.page.waitForSelector('[data-step="install"][data-state="running"]', { timeout: 15_000 });
    const accent = (await references(running.page)).accent;
    const states: Record<string, string> = { fetch: "done", restart: "waiting", wait: "waiting", check: "waiting" };
    let accented = 0;
    for (const step of ["fetch", "install", "restart", "wait", "check"]) {
      const look = await lookOf(running.page, step);
      if (look.color === accent) accented += 1;
      if (step === "install") continue;
      expect(await running.page.locator(`[data-step="${step}"]`).getAttribute("data-state")).toBe(states[step]!);
      expect(look.mask).toBe("none");
      expect(look.animation).toBe("none");
      expect(look.color).not.toBe(accent);
    }
    expect(accented).toBe(1);
    running.release();

    const failed = await deployPage({ fail: "install" });
    await press(failed.page);
    await failed.page.waitForSelector('[data-step="install"][data-state="failed"]', { timeout: 15_000 });
    const look = await lookOf(failed.page, "install");
    expect(look.mask).toBe("none");
    expect(look.animation).toBe("none");
    expect(look.color).not.toBe((await references(failed.page)).accent);
  });

  test("every line holds the same 12px slot before its name, so a name never moves (AC-2)", async () => {
    const { page, release } = await deployPage({ hold: "install" });
    await press(page);
    await page.waitForSelector('[data-step="install"][data-state="running"]', { timeout: 15_000 });
    const nameLeft = () =>
      page.evaluate(() =>
        [...document.querySelectorAll("[data-step]")].map((li) => {
          const range = document.createRange();
          range.selectNodeContents(li.firstChild!);
          return range.getBoundingClientRect().left;
        }),
      );
    const running = await nameLeft();
    expect(new Set(running).size).toBe(1);
    expect((await lookOf(page, "install")).slotWidth).toBe("12px");
    expect((await lookOf(page, "check")).slotWidth).toBe("12px");
    release();
  });

  test("with reduced motion the spinner stands still and the running line keeps its colour (AC-4)", async () => {
    const { page, release } = await deployPage({ reducedMotion: "reduce", hold: "install" });
    await press(page);
    await page.waitForSelector('[data-step="install"][data-state="running"]', { timeout: 15_000 });
    const look = await lookOf(page, "install");
    const reference = await references(page);
    expect(look.animation).toBe("none");
    expect(look.mask).not.toBe("none");
    expect(look.color).toBe(reference.accent);
    release();
  });
});
