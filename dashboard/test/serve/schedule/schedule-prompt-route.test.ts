// GET /schedule/<project>/<name>/prompt: a scheduled job's prompt file,
// as the default branch of the board's checkout has it. The HTTP-level
// test — the page's own markup is drawn by `renderSchedulePromptPage`, and
// only this proves the route reads git, names the job and refuses every
// address that is not a job's prompt page.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Window } from "happy-dom";
import { projectWithOrigin } from "../../helpers/branch-fixture.ts";
import { queueHarness } from "../../helpers/queue-server.ts";

const harness = queueHarness("aide-schedule-prompt-route-");
afterEach(() => harness.cleanup());

let cfgDir: string;
let cfg: string;
beforeEach(() => {
  cfgDir = mkdtempSync(join(tmpdir(), "aide-schedule-prompt-cfg-"));
  cfg = join(cfgDir, "queue-config.json");
  // Stamped in the future, so the board's own tick does not find the job due.
  const since = new Date(Date.now() + 3_600_000).toISOString();
  writeFileSync(
    cfg,
    JSON.stringify({ schedules: { aide: [{ name: "nightly-report", cron: "0 3 * * *", prompt: "docs/nightly.md", since }] } }),
  );
});
afterEach(() => rmSync(cfgDir, { recursive: true, force: true }));

const PROMPT = "docs/nightly.md";
const COMMITTED = "# Nightly\n\nThe committed text.\n";
const OTHER = "# Other\n\nA second committed file.\n";

/** Rewrites the job's prompt in the config the store reads fresh on every call. */
function setPrompt(prompt: string): void {
  const since = new Date(Date.now() + 3_600_000).toISOString();
  writeFileSync(cfg, JSON.stringify({ schedules: { aide: [{ name: "nightly-report", cron: "0 3 * * *", prompt, since }] } }));
}

const start = () => harness.start({ extra: { queueConfigFile: cfg } });

function parse(html: string): Document {
  const window = new Window();
  window.document.body.innerHTML = html;
  return window.document as unknown as Document;
}

function writeInTree(dir: string, file: string, text: string): void {
  const path = join(dir, "root", "aide", file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

describe("GET /schedule/<project>/<name>/prompt", () => {
  test("shows the default branch's text, not the working tree's, and asks for the viewer", async () => {
    const { base, dir } = start();
    projectWithOrigin(dir, "aide", { [PROMPT]: COMMITTED, "docs/other.md": OTHER });
    writeInTree(dir, PROMPT, "# Nightly\n\nUncommitted, only in the working tree.\n");
    const res = await fetch(`${base}/schedule/aide/nightly-report/prompt`);
    expect(res.status).toBe(200);
    const html = await res.text();
    const doc = parse(html);
    expect(doc.querySelector("pre.spec-editor-raw")?.textContent).toBe(COMMITTED);
    expect(doc.querySelector("#spec-editor-host")).not.toBeNull();
    expect(html).not.toContain("Uncommitted");
    expect(html).toContain("/spec-viewer.js");
  });

  test("shows the file whichever way its path was typed when saved (AC-3)", async () => {
    const { base, dir } = start();
    projectWithOrigin(dir, "aide", { [PROMPT]: COMMITTED });
    setPrompt("docs//nightly.md");
    const doc = parse(await (await fetch(`${base}/schedule/aide/nightly-report/prompt`)).text());
    expect(doc.querySelector("pre.spec-editor-raw")?.textContent).toBe(COMMITTED);
  });

  test("a prompt that names a directory gives the cannot-be-read sentence, never a listing (AC-4)", async () => {
    const { base, dir } = start();
    projectWithOrigin(dir, "aide", { [PROMPT]: COMMITTED });
    setPrompt("docs");
    const res = await fetch(`${base}/schedule/aide/nightly-report/prompt`);
    expect(res.status).toBe(200);
    const doc = parse(await res.text());
    expect(doc.body.textContent).toContain("The prompt file docs cannot be read");
    expect(doc.querySelector("pre.spec-editor-raw")).toBeNull();
    expect(doc.querySelector("#spec-editor-host")).toBeNull();
  });

  test("names the file and the job, and links back to the job's Settings tab", async () => {
    const { base, dir } = start();
    projectWithOrigin(dir, "aide", { [PROMPT]: COMMITTED });
    const doc = parse(await (await fetch(`${base}/schedule/aide/nightly-report/prompt`)).text());
    const text = doc.body.textContent ?? "";
    expect(text).toContain(PROMPT);
    expect(text).toContain("aide:nightly-report");
    const back = [...doc.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(back).toContain("/schedule/aide/nightly-report?tab=settings");
  });

  test("a file that never reached the default branch gives one sentence naming it, and no viewer", async () => {
    const { base, dir } = start();
    projectWithOrigin(dir, "aide", { "docs/other.md": OTHER });
    writeInTree(dir, PROMPT, COMMITTED);
    const res = await fetch(`${base}/schedule/aide/nightly-report/prompt`);
    expect(res.status).toBe(200);
    const html = await res.text();
    const doc = parse(html);
    expect(doc.body.textContent).toContain(`The prompt file ${PROMPT} cannot be read`);
    expect(doc.querySelector("#spec-editor-host")).toBeNull();
    expect(doc.querySelector("pre.spec-editor-raw")).toBeNull();
    expect(html).not.toContain("/spec-viewer.js");
    expect(html).not.toContain("The committed text");
  });

  test("a directory that is not a git repository gives the same sentence", async () => {
    const { base } = start();
    const res = await fetch(`${base}/schedule/aide/nightly-report/prompt`);
    expect(res.status).toBe(200);
    const doc = parse(await res.text());
    expect(doc.body.textContent).toContain(`The prompt file ${PROMPT} cannot be read`);
    expect(doc.querySelector("#spec-editor-host")).toBeNull();
  });

  test("refuses every address that is not an existing job's prompt page, and any method but GET", async () => {
    const { base, dir } = start();
    projectWithOrigin(dir, "aide", { [PROMPT]: COMMITTED, "docs/other.md": OTHER });
    for (const path of [
      "/schedule/elsewhere/nightly-report/prompt",
      "/schedule/aide/no-such-job/prompt",
      "/schedule/aide/nightly-report/prompt/docs/other.md",
      "/schedule/aide/nightly-report/prompt/",
    ]) {
      const res = await fetch(`${base}${path}`);
      expect(res.status).toBe(404);
      expect(await res.text()).not.toContain("A second committed file");
    }
    const post = await fetch(`${base}/schedule/aide/nightly-report/prompt`, { method: "POST" });
    expect(post.status).toBe(405);
  });
});
