// Reopen asks in a dialog, from the Actions cell of the spec's row, and its OK
// posts the reopen with the files reset only when that box is ticked.
//
// `make test` runs it, and by hand:
// `cd dashboard && bun test --timeout 20000 test/e2e/reopen-in-a-dialog.test.ts`.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { browserDeadline } from "../helpers/browser-deadline.ts";
import { ARCHIVED, STAMPED, harness, start } from "../archived/archived-specs-fixtures.ts";

browserDeadline();

let browser: Browser;
let base: string;

beforeAll(async () => {
  browser = await chromium.launch();
  base = start({}, ARCHIVED).base;
});

afterAll(async () => { await browser.close(); harness.cleanup(); });

const SPEC = `/specs/aide/${STAMPED}`;
const ACCEPTED = { status: 200, json: { ok: true, job: { id: "j1", project: "aide", specFolder: STAMPED, steps: ["reopen"], stepIndex: 0 } } };

interface Opened {
  page: Page;
  /** The body of every post to the queue, in order. */
  posts: string[];
}

/** `path` with the post answered by `post`, and the job it names in `state` on every poll. */
async function open(path: string, post: { status: number; json: unknown } = ACCEPTED, state = "running"): Promise<Opened> {
  const page = await (await browser.newContext()).newPage();
  const posts: string[] = [];
  await page.route(
    (url) => url.pathname.startsWith("/api/queue"),
    (route) => {
      const request = route.request();
      if (request.method() === "POST") {
        posts.push(request.postData() ?? "");
        return route.fulfill(post);
      }
      return route.fulfill({ json: { job: { id: "j1", state } } });
    },
  );
  await page.goto(`${base}${path}${path.includes("?") ? "&" : "?"}live=0`);
  return { page, posts };
}

const dialog = (page: Page) => page.locator("dialog[data-progress-dialog]:visible");

/** Presses OK and waits for the post's answer, which comes after it is recorded. */
async function ok(page: Page): Promise<void> {
  await Promise.all([
    page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/queue"),
    dialog(page).getByRole("button", { name: "OK" }).click(),
  ]);
}

async function ask(page: Page): Promise<void> {
  await page.locator(`tr.specstate[data-folder="${STAMPED}"]`).getByRole("button", { name: "Reopen" }).click();
  await dialog(page).waitFor({ state: "visible" });
}

describe("Reopen asks in a dialog from the spec in its row", () => {
  test("OK posts resetFiles=1 only with the box ticked", async () => {
    for (const tick of [true, false]) {
      const { page, posts } = await open(SPEC);
      await ask(page);
      if (tick) await dialog(page).locator("input[name=resetFiles]").check();
      await ok(page);
      expect(posts).toHaveLength(1);
      const body = new URLSearchParams(posts[0]);
      expect(body.get("steps")).toBe("reopen");
      expect(body.get("specFolder")).toBe(STAMPED);
      expect(body.get("resetFiles")).toBe(tick ? "1" : null);
    }
  });
});
