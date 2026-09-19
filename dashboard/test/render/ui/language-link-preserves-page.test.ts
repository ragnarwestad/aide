// Spec 435, AC-1/AC-2: choosing the other language must not jump the
// reader to the Specs list — it must keep them on the same page, tab,
// sort and filter, only translated. `shell.test.ts` covers the
// mechanism (`pageShell`'s `currentUrl` opt) directly; this file is the
// route-level proof that every one of AC-2's named pages actually wires
// it in, one test per page.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setupQueueRoutesHarness } from "../../queue-routes/fixtures.ts";

const { harness, start } = setupQueueRoutesHarness("aide-language-link-");
const configDirs: string[] = [];
afterEach(() => {
  harness.cleanup();
  while (configDirs.length) rmSync(configDirs.pop()!, { recursive: true, force: true });
});

const FOLDER = "81-queue-and-runner";

/** A queue config file holding one scheduled job for `aide`. */
function scheduleConfig(): string {
  const dir = mkdtempSync(join(tmpdir(), "aide-language-link-cfg-"));
  configDirs.push(dir);
  const file = join(dir, "queue-config.json");
  writeFileSync(file, JSON.stringify({
    schedules: { aide: [{ name: "nightly-report", cron: "0 3 * * *", prompt: "docs/nightly.md" }] },
  }));
  return file;
}

describe("spec 435: the language links preserve the page, tab, sort and filter", () => {
  test("Specs list — ?sort=title&dir=desc&state=archived", async () => {
    const { base } = start();
    const res = await fetch(`${base}/?sort=title&dir=desc&state=archived`);
    const html = await res.text();
    expect(html).toContain('href="/?sort=title&amp;dir=desc&amp;state=archived&amp;lang=en"');
    expect(html).toContain('href="/?sort=title&amp;dir=desc&amp;state=archived&amp;lang=nb"');
  });

  test("the spec page, on a given tab — ?tab=solution", async () => {
    const { base } = start();
    const res = await fetch(`${base}/specs/aide/${FOLDER}?tab=solution`);
    const html = await res.text();
    expect(html).toContain(`href="/specs/aide/${FOLDER}?tab=solution&amp;lang=en"`);
    expect(html).toContain(`href="/specs/aide/${FOLDER}?tab=solution&amp;lang=nb"`);
  });

  test("New spec — bare path, no query to preserve", async () => {
    const { base } = start();
    const res = await fetch(`${base}/new`);
    const html = await res.text();
    expect(html).toContain('href="/new?lang=en"');
    expect(html).toContain('href="/new?lang=nb"');
  });

  test("Projects list", async () => {
    const { base } = start();
    const res = await fetch(`${base}/projects`);
    const html = await res.text();
    expect(html).toContain('href="/projects?lang=en"');
    expect(html).toContain('href="/projects?lang=nb"');
  });

  test("a project's own page, on a given tab — ?tab=deploy", async () => {
    const { base } = start();
    const res = await fetch(`${base}/projects/aide?tab=deploy`);
    const html = await res.text();
    expect(html).toContain('href="/projects/aide?tab=deploy&amp;lang=en"');
    expect(html).toContain('href="/projects/aide?tab=deploy&amp;lang=nb"');
  });

  test("Schedule list — ?q=foo&sort=name", async () => {
    const { base } = start();
    const res = await fetch(`${base}/schedule?q=foo&sort=name`);
    const html = await res.text();
    expect(html).toContain('href="/schedule?q=foo&amp;sort=name&amp;lang=en"');
    expect(html).toContain('href="/schedule?q=foo&amp;sort=name&amp;lang=nb"');
  });

  test("a Schedule entry's detail page, on a given tab — ?tab=history", async () => {
    const { base } = start({ queueConfigFile: scheduleConfig() });
    const res = await fetch(`${base}/schedule/aide/nightly-report?tab=history`);
    const html = await res.text();
    expect(html).toContain('href="/schedule/aide/nightly-report?tab=history&amp;lang=en"');
    expect(html).toContain('href="/schedule/aide/nightly-report?tab=history&amp;lang=nb"');
  });

  test("the job page, on a given tab — ?tab=steps", async () => {
    const { base } = start();
    const created = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ project: "aide", specFolder: FOLDER, steps: ["analyze"] }),
    });
    const { job } = (await created.json()) as { job: { id: string } };
    const res = await fetch(`${base}/specs/${job.id}?tab=steps`);
    const html = await res.text();
    expect(html).toContain(`href="/specs/${job.id}?tab=steps&amp;lang=en"`);
    expect(html).toContain(`href="/specs/${job.id}?tab=steps&amp;lang=nb"`);
  });

  test("the Reset confirmation page", async () => {
    const { base } = start();
    const res = await fetch(`${base}/specs/aide/${FOLDER}/reset`);
    const html = await res.text();
    expect(html).toContain(`href="/specs/aide/${FOLDER}/reset?lang=en"`);
    expect(html).toContain(`href="/specs/aide/${FOLDER}/reset?lang=nb"`);
  });

  test("the Close confirmation page", async () => {
    const { base } = start();
    const res = await fetch(`${base}/specs/aide/${FOLDER}/close`);
    const html = await res.text();
    expect(html).toContain(`href="/specs/aide/${FOLDER}/close?lang=en"`);
    expect(html).toContain(`href="/specs/aide/${FOLDER}/close?lang=nb"`);
  });
});
