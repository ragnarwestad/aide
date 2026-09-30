// The spec page draws the description the way a Save writes it: off the
// spec's own branch when it has one. Real git and the real server, since
// the defect is a page that kept the default branch's copy of a stamp and
// of the banner's two facts while a Save moved the branch — a fake git
// answering by command string cannot tell the two copies apart.

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { queueHarness } from "../helpers/queue-server.ts";
import { onOrigin, rootWithOrigin, specBranchAhead, specRelPath, type BranchFixture } from "../helpers/branch-fixture.ts";
import { DESCRIPTION_TAB, ANALYSIS_TAB, SAVE, SPEC, TRACKING, descriptionPath, post, answer } from "./spec-save-fixtures.ts";

const OTHER = "82-another-spec";
const harness = queueHarness("aide-spec-page-branch-");
afterEach(() => harness.cleanup());

const tracked = (prose: string, extra = "") =>
  "# Queue and runner - Description\n\n## Tracking info\n\n" +
  `- **Task:** \`${SPEC}/\`\n- **Created:** \`2026-08-21\`\n${extra}\n---\n\n## Description\n\n${prose}\n`;
const ON_MAIN = tracked("As it was on main.");
const ON_BRANCH = tracked("As the branch has it.");
const NOT_REQUIRED = "- **Acceptance:** not required\n";

function git(cwd: string, ...args: string[]): string {
  const out = Bun.spawnSync({ cmd: ["git", "-C", cwd, ...args], stdout: "pipe", stderr: "pipe" });
  if (out.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${out.stderr.toString()}`);
  return out.stdout.toString().trim();
}

/** The page, once the server's own caches have seen the repository that
 *  was made after it started (its poll runs every 40 ms in a test). */
async function draw(base: string, tab: string): Promise<string> {
  await Bun.sleep(300);
  return (await fetch(`${base}${tab}`)).text();
}

// What the page holds, read out of the html: the textarea's text, the
// version the form will save against, the version the heading names, and
// the banner's two facts.
const unescape = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const textareaText = (html: string) => unescape(html.match(/<textarea name="text"[^>]*>([\s\S]*?)<\/textarea>/)![1]!);
const baseShaOf = (html: string) => html.match(/name="baseSha" value="([0-9a-f]*)"/)![1]!;
const stampedSha7 = (html: string) => html.match(/committed[\s\S]{0,120}? · ([0-9a-f]{7})</)?.[1];
const inputTag = (html: string, name: string, value?: string) =>
  [...html.matchAll(/<input [^>]*>/g)].map((m) => m[0]).find(
    (tag) => tag.includes(`name="${name}"`) && (value === undefined || tag.includes(`value="${value}"`)),
  );
const acceptanceRequiredShown = (html: string) => inputTag(html, "acceptanceRequired")!.includes(" checked");
const dependencyShown = (html: string, folder: string) => inputTag(html, "dependsOn", folder)?.includes(" checked") ?? false;

const failed = async (res: Response) => {
  const { status, body } = await answer(res);
  return status !== 200 || body.ok !== true;
};
const branchTip = (fx: BranchFixture) => git(fx.origin, "rev-parse", fx.branch);
const lastTouch = (fx: BranchFixture, ref: string, file = "1-description.md") =>
  git(fx.origin, "log", "-1", "--format=%H", ref, "--", specRelPath(SPEC, file));

/** A spec whose branch holds `onBranch`, one commit ahead of main's copy. */
function withBranch(onBranch: string, onMain = ON_MAIN) {
  const started = harness.start({ description: onMain, alsoSpecs: [OTHER] });
  return { ...started, fx: specBranchAhead(started.dir, SPEC, { "1-description.md": onBranch }) };
}

describe("a spec with a branch of its own", () => {
  test("the Description tab shows the branch's text and names the branch's commit, not main's (AC-1)", async () => {
    const { base, fx } = withBranch(ON_BRANCH);

    const html = await draw(base, DESCRIPTION_TAB);

    expect(textareaText(html)).toContain("As the branch has it.");
    expect(stampedSha7(html)).toBe(branchTip(fx).slice(0, 7));
    expect(stampedSha7(html)).not.toBe(lastTouch(fx, "main").slice(0, 7));
  });

  test("after a Save the page holds the saved text and the Save's commit, and a second Save from it keeps the first (AC-1, AC-2)", async () => {
    const { base, fx } = withBranch(ON_BRANCH);
    const first = await draw(base, DESCRIPTION_TAB);

    const firstSave = await post(base, { text: `${textareaText(first)}First change.\n`, baseSha: baseShaOf(first) });
    expect(await failed(firstSave)).toBe(false);

    const second = await draw(base, DESCRIPTION_TAB);
    expect(textareaText(second)).toContain("First change.");
    expect(stampedSha7(second)).toBe(branchTip(fx).slice(0, 7));
    expect(stampedSha7(second)).not.toBe(stampedSha7(first));

    const secondSave = await post(base, { text: `${textareaText(second)}Second change.\n`, baseSha: baseShaOf(second) });
    expect(await failed(secondSave)).toBe(false);
    const onBranch = onOrigin(fx, fx.branch, SPEC, "1-description.md");
    expect(onBranch).toContain("As the branch has it.");
    expect(onBranch).toContain("First change.");
    expect(onBranch).toContain("Second change.");
    expect(onOrigin(fx, "main", SPEC, "1-description.md")).toBe(ON_MAIN);
  });

  test("the banner shows what its own Save wrote to the branch, on the Analysis tab and the Description tab alike (AC-1)", async () => {
    const { base } = withBranch(tracked("As the branch has it."));
    expect(acceptanceRequiredShown(await draw(base, ANALYSIS_TAB))).toBe(true);

    const saved = await post(base, { acceptanceEditable: "1" }, TRACKING);
    expect(await failed(saved)).toBe(false);

    expect(acceptanceRequiredShown(await draw(base, ANALYSIS_TAB))).toBe(false);
    expect(acceptanceRequiredShown(await draw(base, DESCRIPTION_TAB))).toBe(false);
  });

  test("a second banner Save, with the switch as the page shows it, keeps the Acceptance line (AC-2)", async () => {
    const { base, fx } = withBranch(tracked("As the branch has it."));
    await draw(base, ANALYSIS_TAB);
    expect(await failed(await post(base, { acceptanceEditable: "1" }, TRACKING))).toBe(false);

    const page = await draw(base, ANALYSIS_TAB);
    const again = await post(
      base,
      { acceptanceEditable: "1", ...(acceptanceRequiredShown(page) ? { acceptanceRequired: "1" } : {}) },
      TRACKING,
    );

    expect(await failed(again)).toBe(false);
    expect(onOrigin(fx, fx.branch, SPEC, "1-description.md")).toContain("- **Acceptance:** not required");
  });

  test("the banner shows the dependencies the branch has, and none when the branch has dropped the line (AC-1)", async () => {
    const onMain = tracked("As it was on main.", `- **Depends on:** \`${OTHER}\`\n`);
    const { base } = withBranch(tracked("As the branch has it."), onMain);

    expect(dependencyShown(await draw(base, ANALYSIS_TAB), OTHER)).toBe(false);
  });
});

describe("a spec with no branch of its own", () => {
  test("the text, the stamp and the banner are the default branch's, and a Save writes to it (AC-3)", async () => {
    const { base, dir } = harness.start({ description: tracked("As it was on main.", NOT_REQUIRED), alsoSpecs: [OTHER] });
    const fx = rootWithOrigin(dir);

    const html = await draw(base, DESCRIPTION_TAB);

    expect(textareaText(html)).toContain("As it was on main.");
    expect(stampedSha7(html)).toBe(git(fx.root, "log", "-1", "--format=%H", "--", specRelPath(SPEC, "1-description.md")).slice(0, 7));
    expect(acceptanceRequiredShown(html)).toBe(false);

    const saved = await post(base, { text: `${textareaText(html)}Saved on main.\n`, baseSha: baseShaOf(html) }, SAVE);
    expect(await failed(saved)).toBe(false);
    expect(git(fx.origin, "show", `main:${specRelPath(SPEC, "1-description.md")}`)).toContain("Saved on main.");
    expect(readFileSync(descriptionPath(dir), "utf-8")).toContain("Saved on main.");
  });
});
