import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assessProjectReadiness,
  suggestSpecsPath,
  suggestWorktreeLinksFromLockfile,
  updateProjectSettings,
} from "../../../src/project/project-admin.ts";
import type { GitRunner } from "../../../src/git/branch-status.ts";
import { configValue, resolveCodeLanding } from "../../../src/project/discover.ts";
import { fakeGit } from "../../helpers/fake-git.ts";

const dirs: string[] = [];
const root = (): string => {
  const d = mkdtempSync(join(tmpdir(), "aide-project-admin-"));
  dirs.push(d);
  return d;
};

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

/** A checkout under a projects root of its own — the same shape the
 *  readiness tests above build, at module scope because spec 184's tests
 *  want it too. */
function checkoutFor(name: string): { projectsRoot: string; dir: string } {
  const projectsRoot = root();
  const dir = join(projectsRoot, name);
  mkdirSync(join(dir, "specs"), { recursive: true });
  return { projectsRoot, dir };
}


// --- spec 184: the form stops asking for what can be worked out --------------
describe("proposing the worktree links from a checkout's own lockfile", () => {
  const withFiles = (...files: string[]): string => {
    const dir = root();
    for (const f of files) writeFileSync(join(dir, f), "");
    return dir;
  };

  // Criterion 5. Not a guess: a lockfile at the root IS the project
  // saying its dependency tree lives in the directory beside it, and
  // that directory is gitignored in every one of these ecosystems.
  test.each([
    ["bun.lock", "node_modules"],
    ["package-lock.json", "node_modules"],
    ["pnpm-lock.yaml", "node_modules"],
    ["yarn.lock", "node_modules"],
    ["package.json", "node_modules"],
    ["requirements.txt", ".venv"],
    ["pyproject.toml", ".venv"],
  ])("%s proposes %s", (file, expected) => {
    expect(suggestWorktreeLinksFromLockfile(withFiles(file))).toBe(expected);
  });

  test("a project with both toolchains proposes both, in the shape the config takes", () => {
    expect(suggestWorktreeLinksFromLockfile(withFiles("package.json", "pyproject.toml"))).toBe(
      "node_modules .venv",
    );
  });

  test("two node lockfiles propose node_modules once", () => {
    expect(suggestWorktreeLinksFromLockfile(withFiles("bun.lock", "package.json"))).toBe("node_modules");
  });

  // A proposal that cannot be made is left empty rather than guessed.
  test("a checkout with no lockfile at all proposes nothing", () => {
    expect(suggestWorktreeLinksFromLockfile(withFiles("README.md"))).toBe("");
  });

  test("a directory that is not there proposes nothing rather than throwing", () => {
    expect(suggestWorktreeLinksFromLockfile(join(root(), "gone"))).toBe("");
  });
});

describe("proposing the specs root from how the other projects are laid out", () => {
  // Criterion 10: a shared specs repository with a directory per project
  // is a pattern, and the pattern is what proposes the path.
  test("a shared parent across two projects proposes the same shape for a new name", () => {
    expect(
      suggestSpecsPath("skjer", [
        { name: "aide", specsPath: "/repos/aide-specs/aide" },
        { name: "atlasaurus", specsPath: "/repos/aide-specs/atlasaurus" },
      ]),
    ).toBe("/repos/aide-specs/skjer");
  });

  // Criterion 6: one project is an example, not a pattern.
  test("a single existing project is not enough to infer a pattern from", () => {
    expect(suggestSpecsPath("skjer", [{ name: "aide", specsPath: "/repos/aide-specs/aide" }])).toBe("");
  });

  test("projects whose specs roots share no parent propose nothing", () => {
    expect(
      suggestSpecsPath("skjer", [
        { name: "aide", specsPath: "/repos/aide-specs/aide" },
        { name: "atlasaurus", specsPath: "/elsewhere/atlas-specs/atlasaurus" },
      ]),
    ).toBe("");
  });

  // The pattern is `<parent>/<projectName>`. A specs root whose last
  // segment is something else says nothing about where a project named
  // `skjer` would put its own.
  test("specs roots that are not named after their project are not a pattern", () => {
    expect(
      suggestSpecsPath("skjer", [
        { name: "aide", specsPath: "/repos/specs/todo" },
        { name: "atlasaurus", specsPath: "/repos/specs/todo" },
      ]),
    ).toBe("");
  });

  test("a project with no specs root configured contributes nothing", () => {
    expect(
      suggestSpecsPath("skjer", [
        { name: "aide", specsPath: "/repos/aide-specs/aide" },
        { name: "atlasaurus", specsPath: null },
      ]),
    ).toBe("");
  });

  // Never over an existing project: the proposal is for a name that is
  // about to be added, and one already there has its own answer.
  test("the majority pattern wins where the roots disagree", () => {
    expect(
      suggestSpecsPath("skjer", [
        { name: "aide", specsPath: "/repos/aide-specs/aide" },
        { name: "atlasaurus", specsPath: "/repos/aide-specs/atlasaurus" },
        { name: "odd", specsPath: "/somewhere/else/odd" },
      ]),
    ).toBe("/repos/aide-specs/skjer");
  });
});

// Spec 205: the checks answer for the checkout a RUN will use.
//
// Until now that was the person's own checkout, so the readiness check
// asked whether THAT could be put on its default branch. A run is cut
// from a clone the dashboard owns instead, so the same question is
// asked of that clone — and the person's branch, which decides nothing
// any more, is not asked about at all. Spec 144 did exactly this to the
// clean-tree check when it stopped mattering.
describe("readiness answers for the checkout a run uses (spec 205)", () => {
  const READY: Record<string, { code: number; stdout?: string }> = {
    "symbolic-ref --short refs/remotes/origin/HEAD": { code: 0, stdout: "origin/main\n" },
    "show-ref --verify --quiet refs/heads/main": { code: 0 },
    "rev-parse --abbrev-ref HEAD": { code: 0, stdout: "main\n" },
    "worktree list --porcelain": { code: 0, stdout: "" },
    "remote get-url origin": { code: 0, stdout: "https://example.test/aide.git\n" },
  };

  /** `answers` is layered over a ready checkout, and `only` narrows a
   *  layer to ONE directory — which is how a test can put the person's
   *  checkout on a branch of their own while the dashboard's stands on
   *  main, and see which of the two the checks report. */
  const runner = (
    answers: Record<string, { code: number; stdout?: string }> = {},
    only?: string,
  ): GitRunner => {
    const table = { ...READY, ...answers };
    return async (at, args) => {
      const joined = args.join(" ");
      if (only === undefined || at === only) {
        for (const [prefix, answer] of Object.entries(answers)) {
          if (joined.startsWith(prefix)) return { code: answer.code, stdout: answer.stdout ?? "" };
        }
      }
      if (joined.startsWith("rev-parse --show-toplevel")) return { code: 0, stdout: `${at}\n` };
      for (const [prefix, answer] of Object.entries(only === undefined ? table : READY)) {
        if (joined.startsWith(prefix)) return { code: answer.code, stdout: answer.stdout ?? "" };
      }
      return { code: 1, stdout: "" };
    };
  };

  /** A person's checkout with a specs/ beside it, and a place for the
   *  dashboard's own clone that may or may not exist yet. */
  function pair(opts: { owned?: boolean } = {}): { person: string; owned: string } {
    const base = root();
    const person = join(base, "aide");
    mkdirSync(join(person, "specs"), { recursive: true });
    const owned = join(base, "owned", "aide", "code");
    if (opts.owned) mkdirSync(join(owned, ".git"), { recursive: true });
    return { person, owned };
  }

  const named = (r: Awaited<ReturnType<typeof assessProjectReadiness>>, name: string) =>
    r.checks.filter((c) => c.check === name);
  const blockers = (r: Awaited<ReturnType<typeof assessProjectReadiness>>) =>
    r.checks.filter((c) => c.blocking).map((c) => c.detail).join(" | ");

  test("the person's branch is not asked about at all any more", async () => {
    const { person, owned } = pair({ owned: true });
    const result = await assessProjectReadiness(
      runner({ "rev-parse --abbrev-ref HEAD": { code: 0, stdout: "wip/mine\n" } }, person),
      person,
      owned,
    );
    expect(result.canRun).toBe(true);
    expect(result.note).not.toContain("wip/mine");
    expect(named(result, "defaultBranch").map((c) => c.subject)).not.toContain(person);
  });

  test("the dashboard's own checkout is the one asked whether it can reach its default branch", async () => {
    const { person, owned } = pair({ owned: true });
    const result = await assessProjectReadiness(
      runner({
        "rev-parse --abbrev-ref HEAD": { code: 0, stdout: "aide/99-old\n" },
        "show-ref --verify --quiet refs/heads/main": { code: 1 },
        "show-ref --verify --quiet refs/remotes/origin/main": { code: 1 },
      }),
      person,
      owned,
    );
    expect(result.canRun).toBe(false);
    // The subject says WHICH checkout answered; the wording says whose
    // it is. Both, because a path alone reads as an accident.
    expect(named(result, "defaultBranch").map((c) => c.subject)).toEqual([owned]);
    expect(blockers(result)).toContain("dashboard's own");
  });

  // The one thing a lazy clone cannot work around, and the reason it is
  // a named readiness failure rather than a run that refuses with
  // nobody there.
  // Said, not refused. Without an origin there is nothing to clone
  // from, and the run falls back to the checkout it was pointed at —
  // which is what every run did before this spec, so it works. What the
  // reader is told is that this is the project where a run and their own
  // editing can still meet.
  test("a person's checkout with no origin is reported, and does not refuse the run", async () => {
    const { person, owned } = pair();
    const result = await assessProjectReadiness(runner({ "remote get-url origin": { code: 1 } }), person, owned);
    expect(result.canRun).toBe(true);
    const said = named(result, "dashboardCheckout")[0]!;
    expect(said.ok).toBe(false);
    expect(said.blocking).toBe(false);
    expect(said.detail).toContain("no origin remote");
    expect(result.note).toContain("collide");
  });

  test("a checkout the dashboard has not made yet is not a refusal — it says where it will go", async () => {
    const { person, owned } = pair();
    const result = await assessProjectReadiness(runner(), person, owned);
    expect(result.canRun).toBe(true);
    expect(named(result, "dashboardCheckout")[0]!.detail).toContain(owned);
  });

  // Nothing was passed, so nothing changed: every caller that asks
  // about one checkout keeps the answer it always got.
  test("asked without one, the checks are the checkout's own, exactly as before", async () => {
    const { person } = pair();
    const result = await assessProjectReadiness(
      runner({ "rev-parse --abbrev-ref HEAD": { code: 0, stdout: "wip/mine\n" } }),
      person,
    );
    expect(named(result, "defaultBranch").map((c) => c.subject)).toContain(person);
    expect(result.note).toContain("wip/mine");
  });
});

// --- spec 220: merge the code, or open a pull request ------------------------
//
// Whether a project's archived code goes straight onto its default
// branch or waits for a review is a TEAM policy, so it is read from the
// committed manifest and from nowhere else. The worktree links have a
// `.aide/config` fallback because they had a spelling to migrate from;
// this has none, and giving it one would let a gitignored file on one
// machine quietly overrule what the repo says.
describe("where a project's code-landing choice is read from (spec 220)", () => {
  const CASES: {
    cases: { name: string; manifest: string | null; config: string | null; landing: "merge" | "pr" }[];
  } = JSON.parse(
    readFileSync(join(import.meta.dir, "..", "..", "../../tests/fixtures/code-landing-precedence.json"), "utf-8"),
  );

  /** The same table `aide-run-spec`'s own test iterates over, out of the
   *  same file — the way `WORKFLOW_STEPS` and the worktree links are
   *  pinned. The `push` column is the shell's alone: only the run has a
   *  `--push` flag to default. */
  for (const c of CASES.cases) {
    test(`${c.name}: the landing resolves to "${c.landing}"`, () => {
      const { dir } = checkoutFor(c.name.toLowerCase().replace(/[^a-z]/g, ""));
      mkdirSync(join(dir, ".aide"), { recursive: true });
      writeFileSync(
        join(dir, ".aide", "project.yaml"),
        `name: x\n${c.manifest ? `codeLanding: ${c.manifest}\n` : ""}`,
      );
      if (c.config) writeFileSync(join(dir, ".aide", "config"), `AIDE_CODE_LANDING=${c.config}\n`);
      expect(resolveCodeLanding(dir)).toBe(c.landing);
    });
  }

  test("a project with no manifest at all merges, as it always has", () => {
    const { dir } = checkoutFor("nomanifest");
    expect(resolveCodeLanding(dir)).toBe("merge");
  });

  test("an unparseable manifest merges rather than guessing", () => {
    const { dir } = checkoutFor("brokenmanifest");
    mkdirSync(join(dir, ".aide"), { recursive: true });
    writeFileSync(join(dir, ".aide", "project.yaml"), "name: [x\n  - broken\n");
    expect(resolveCodeLanding(dir)).toBe("merge");
  });
});

describe("saving the code-landing choice (spec 220)", () => {
  /** The manifest is where it goes — never `.aide/config`, which is
   *  gitignored: a policy nobody can read out of a fresh clone is not a
   *  policy the project has. */
  test("a save writes the manifest and leaves .aide/config alone", async () => {
    const { dir } = checkoutFor("savespr");
    mkdirSync(join(dir, ".aide"), { recursive: true });
    writeFileSync(join(dir, ".aide", "project.yaml"), "name: x\n");
    await updateProjectSettings(fakeGit({}).run, dir, { codeLanding: "pr" });
    expect(readFileSync(join(dir, ".aide", "project.yaml"), "utf-8")).toContain("codeLanding: pr");
    expect(configValue(dir, "AIDE_CODE_LANDING")).toBeNull();
    expect(resolveCodeLanding(dir)).toBe("pr");
  });

  test("saving it back to merge takes the key out again", async () => {
    const { dir } = checkoutFor("savesmerge");
    mkdirSync(join(dir, ".aide"), { recursive: true });
    writeFileSync(join(dir, ".aide", "project.yaml"), "name: x\ncodeLanding: pr\n");
    await updateProjectSettings(fakeGit({}).run, dir, { codeLanding: "merge" });
    // `merge` is the default, so the manifest says nothing rather than
    // spelling out today's behaviour — the same shape an empty worktree
    // links value leaves behind.
    expect(readFileSync(join(dir, ".aide", "project.yaml"), "utf-8")).not.toContain("codeLanding");
    expect(resolveCodeLanding(dir)).toBe("merge");
  });

  test("a value neither side recognizes is refused, not written", async () => {
    const { dir } = checkoutFor("savesgarbage");
    mkdirSync(join(dir, ".aide"), { recursive: true });
    writeFileSync(join(dir, ".aide", "project.yaml"), "name: x\n");
    const result = await updateProjectSettings(fakeGit({}).run, dir, { codeLanding: "rebase" });
    expect(result.ok).toBe(false);
    expect(result.steps.some((s) => s.step === "codeLanding" && !s.ok)).toBe(true);
    expect(readFileSync(join(dir, ".aide", "project.yaml"), "utf-8")).not.toContain("codeLanding");
  });
});
