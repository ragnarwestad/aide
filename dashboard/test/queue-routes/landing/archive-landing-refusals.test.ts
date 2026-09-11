// What a landing refuses, and what it says when it does: code before
// specs for archive, a branch left behind after a successful merge, and
// one error naming one path for one checkout.
//
// Split out of archive-landing.test.ts 2026-09-04 (777 lines); the
// tests are unchanged and keep their names.

import { repoOf } from "./every-step-lands-fixtures.ts";
import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ARCHIVE_RESULT, BRANCH, SPECS_REPO, gitFor, merges, runStep, sentence, serverWithRunner, settle, start } from "./archive-landing-fixtures.ts";

describe("code lands before specs for archive (spec 280)", () => {
  const CODE_REPO = "/repos/aide";
  const TWO_REPOS = [
    { root: SPECS_REPO, url: "https://example.test/aide-specs" },
    { root: CODE_REPO, url: "https://example.test/aide" },
  ];

  test("AC8: a failing code root stops the loop before the specs root is attempted", async () => {
    const git = gitFor({ conflicting: [CODE_REPO] });
    const { base, results } = serverWithRunner(start, "aide-archive-results-", git, {
      queueProjectRoot: "/repos",
    });
    const job = await runStep(base, "archive");
    writeFileSync(
      join(results, `${job.id}.json`),
      JSON.stringify({ ...ARCHIVE_RESULT, branchUrls: TWO_REPOS }),
    );
    const failed = await settle(base, job.id, (j) => !!j.error);

    expect(sentence(failed.error)).toContain(CODE_REPO);
    expect(sentence(failed.error)).toContain("conflict");
    expect(failed.errorReason).toBe("conflict");
    // The code root was attempted (and failed) — the specs root, which
    // carries the "completed" stamp, was never attempted at all.
    expect(merges(git.calls).some((c) => repoOf(c.dir) === CODE_REPO)).toBe(true);
    expect(merges(git.calls).some((c) => repoOf(c.dir) === SPECS_REPO)).toBe(false);
  });

  // The origin check after the loop exists for a landing that reported
  // ok while a branch stayed on origin. A landing that already said
  // WHY it failed leaves the row one reason: adding "still on origin —
  // run archive again" once per root beside a conflict told the reader
  // two contradicting things, and the second one twice.
  test("a conflict the loop reported is the row's one reason, not joined by the origin check per root", async () => {
    let specsRoot = "";
    let codeRoot = "";
    // Filled once the roots are known: the fixture reads it per call.
    const conflicting: string[] = [];
    const inner = gitFor({ conflicting });
    const git = {
      calls: inner.calls,
      run: async (dir: string, args: string[]) => {
        const a = args.join(" ");
        if ((dir === specsRoot || dir === codeRoot) && a.startsWith("ls-remote --heads")) {
          inner.calls.push({ dir, args });
          return { code: 0, stdout: `abc123\trefs/heads/${BRANCH}\n` };
        }
        return inner.run(dir, args);
      },
    };
    const { base, dir, results } = serverWithRunner(start, "aide-archive-results-", git as never);
    specsRoot = join(dir, "root", "aide", "specs");
    codeRoot = join(dir, "root", "aide");
    conflicting.push(codeRoot);
    const job = await runStep(base, "archive");
    writeFileSync(
      join(results, `${job.id}.json`),
      JSON.stringify({
        ...ARCHIVE_RESULT,
        branchUrls: [
          { root: specsRoot, url: "https://example.test/aide-specs" },
          { root: codeRoot, url: "https://example.test/aide" },
        ],
      }),
    );
    const failed = await settle(base, job.id, (j) => !!j.error);

    const text = sentence(failed.error);
    expect(text).toContain("conflict");
    expect(text).not.toContain("still on origin");
    expect(failed.errorReason).toBe("conflict");
  });

  test("AC9: a successful code root is followed by the specs root, unaffected", async () => {
    const git = gitFor();
    const { base, results } = serverWithRunner(start, "aide-archive-results-", git, {
      queueProjectRoot: "/repos",
    });
    const job = await runStep(base, "archive");
    writeFileSync(
      join(results, `${job.id}.json`),
      JSON.stringify({ ...ARCHIVE_RESULT, branchUrls: TWO_REPOS }),
    );
    const landed = await settle(base, job.id, (j) => j.state === "done" && !j.landing);

    expect(landed.error).toBeFalsy();
    const merged = merges(git.calls);
    const codeIndex = merged.findIndex((c) => repoOf(c.dir) === CODE_REPO);
    const specsIndex = merged.findIndex((c) => repoOf(c.dir) === SPECS_REPO);
    expect(codeIndex).toBeGreaterThanOrEqual(0);
    expect(specsIndex).toBeGreaterThan(codeIndex);
    expect(git.calls.some((c) => repoOf(c.dir) === SPECS_REPO && c.args[0] === "push")).toBe(true);
    expect(git.calls.some((c) => repoOf(c.dir) === CODE_REPO && c.args[0] === "push")).toBe(true);
    expect(landed.branchUrls).toEqual([]);
  });
});
describe("a branch left behind after a successful merge (spec 319)", () => {
  test("settles as done, with no error, and carries the reason on the job", async () => {
    let specsRoot = "";
    const inner = gitFor();
    const git = {
      calls: inner.calls,
      run: async (dir: string, args: string[]) => {
        if (dir === specsRoot) {
          const a = args.join(" ");
          if (a === `push -q origin --delete ${BRANCH}`) {
            inner.calls.push({ dir, args });
            return { code: 1, stdout: "", stderr: "remote rejected: hook declined" };
          }
          if (a.startsWith("ls-remote --heads")) {
            inner.calls.push({ dir, args });
            return { code: 0, stdout: `abc123\trefs/heads/${BRANCH}\n` };
          }
        }
        return inner.run(dir, args);
      },
    };
    const { base, dir, results } = serverWithRunner(start, "aide-archive-results-", git as never);
    specsRoot = join(dir, "root", "aide", "specs");
    const job = await runStep(base, "archive");
    writeFileSync(
      join(results, `${job.id}.json`),
      JSON.stringify({ ...ARCHIVE_RESULT, branchUrls: [{ root: specsRoot, url: "https://example.test/aide-specs" }] }),
    );
    const landed = await settle(base, job.id, (j) => j.state === "done" && !j.landing);

    expect(landed.error).toBeFalsy();
    expect(landed.errorReason).toBeFalsy();
    expect(git.calls.some((c) => repoOf(c.dir) === specsRoot && c.args[0] === "push")).toBe(true);
    expect(sentence(landed.branchDeleteError)).toContain(specsRoot);
    expect(sentence(landed.branchDeleteError)).toContain(BRANCH);
    expect(sentence(landed.branchDeleteError)).toContain("remote rejected: hook declined");
  });

  // Risk mitigation from the plan: the guard must skip only the root
  // its OWN loop just recorded a delete failure for — a root the
  // landing never touched at all, still open for a genuinely
  // different reason, has to keep failing the job exactly as before.
  test("does not silence a genuinely unlanded root beside it", async () => {
    let specsRoot = "";
    let codeRoot = "";
    const inner = gitFor();
    const git = {
      calls: inner.calls,
      run: async (dir: string, args: string[]) => {
        if (dir === specsRoot) {
          const a = args.join(" ");
          if (a === `push -q origin --delete ${BRANCH}`) {
            inner.calls.push({ dir, args });
            return { code: 1, stdout: "", stderr: "remote rejected: hook declined" };
          }
        }
        if ((dir === specsRoot || dir === codeRoot) && args.join(" ").startsWith("ls-remote --heads")) {
          inner.calls.push({ dir, args });
          return { code: 0, stdout: `abc123\trefs/heads/${BRANCH}\n` };
        }
        return inner.run(dir, args);
      },
    };
    const { base, dir, results } = serverWithRunner(start, "aide-archive-results-", git as never);
    specsRoot = join(dir, "root", "aide", "specs");
    codeRoot = join(dir, "root", "aide");
    const job = await runStep(base, "archive");
    // Only the specs root is in THIS landing's own branchUrls — the
    // code root is never merged by it, exactly the shape a job the
    // LRU cap evicted or a step run by hand would leave behind.
    writeFileSync(
      join(results, `${job.id}.json`),
      JSON.stringify({ ...ARCHIVE_RESULT, branchUrls: [{ root: specsRoot, url: "https://example.test/aide-specs" }] }),
    );
    const failed = await settle(base, job.id, (j) => !!j.error);

    expect(sentence(failed.error)).toContain(codeRoot);
    expect(sentence(failed.error)).not.toContain(specsRoot);
    expect(failed.errorReason).toBe("unlanded");
  });
});
describe("one landing error names one path for one checkout (spec 330)", () => {
  test("the post-loop sentence names the same resolved root the merge loop already failed for", async () => {
    const resolvedRoot = "/repos/aide-specs-real-root";
    let specsRoot = "";
    const inner = gitFor({ conflicting: [resolvedRoot] });
    const git = {
      calls: inner.calls,
      run: async (dir: string, args: string[]) => {
        if (dir === specsRoot) {
          const a = args.join(" ");
          if (a === "rev-parse --show-toplevel") {
            inner.calls.push({ dir, args });
            return { code: 0, stdout: `${resolvedRoot}\n` };
          }
          if (a.startsWith("ls-remote --heads")) {
            inner.calls.push({ dir, args });
            return { code: 0, stdout: `abc123\trefs/heads/${BRANCH}\n` };
          }
        }
        return inner.run(dir, args);
      },
    };
    const { base, dir, results } = serverWithRunner(start, "aide-archive-results-", git as never);
    specsRoot = join(dir, "root", "aide", "specs");
    const job = await runStep(base, "archive");
    writeFileSync(
      join(results, `${job.id}.json`),
      JSON.stringify({ ...ARCHIVE_RESULT, branchUrls: [{ root: resolvedRoot, url: "https://example.test/aide-specs" }] }),
    );
    const failed = await settle(base, job.id, (j) => !!j.error);

    const errorText = sentence(failed.error);
    expect(errorText).toContain(resolvedRoot);
    expect(errorText).not.toContain(specsRoot);
  });

  // A project whose specs live inside its own code repository:
  // `specRoots()` returns the code root and a subdirectory of that same
  // repo as two separate entries. Both still holding the branch must
  // read as one repository, not two.
  test("two specRoots entries resolving to one repo produce one still-on-origin sentence", async () => {
    let specsRoot = "";
    let codeRoot = "";
    const inner = gitFor();
    const git = {
      calls: inner.calls,
      run: async (dir: string, args: string[]) => {
        const a = args.join(" ");
        if ((dir === specsRoot || dir === codeRoot) && a === "rev-parse --show-toplevel") {
          inner.calls.push({ dir, args });
          return { code: 0, stdout: `${codeRoot}\n` };
        }
        if ((dir === specsRoot || dir === codeRoot) && a.startsWith("ls-remote --heads")) {
          inner.calls.push({ dir, args });
          return { code: 0, stdout: `abc123\trefs/heads/${BRANCH}\n` };
        }
        return inner.run(dir, args);
      },
    };
    const { base, dir, results } = serverWithRunner(start, "aide-archive-results-", git as never);
    specsRoot = join(dir, "root", "aide", "specs");
    codeRoot = join(dir, "root", "aide");
    const job = await runStep(base, "archive");
    writeFileSync(join(results, `${job.id}.json`), JSON.stringify(ARCHIVE_RESULT));
    const failed = await settle(base, job.id, (j) => !!j.error);

    const errorText = sentence(failed.error);
    const stillOnOrigin = errorText.split("still on origin").length - 1;
    expect(stillOnOrigin).toBe(1);
    expect(errorText).toContain(codeRoot);
  });
});
