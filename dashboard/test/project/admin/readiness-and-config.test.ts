import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { addProject, type AddProjectRequest, type ProjectAdminResult } from "../../../src/project/project-admin.ts";
import type { GitRunner } from "../../../src/git/branch-status.ts";
import { SETTING_LABELS } from "../../../src/project/setting-labels.ts";

const dirs: string[] = [];
const root = (): string => {
  const d = mkdtempSync(join(tmpdir(), "aide-project-admin-"));
  dirs.push(d);
  return d;
};

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});


// --- spec 138: whether a run can actually start there -------------------------
//
// Adding a project answered "added" and nothing else. Skjer was added on
// 2026-08-20 and looked added: it was on the allowlist, its checkout was
// where the form said, and a minimal manifest had been written for it.
// A run there refused before it started — the checkout stood on a
// feature branch whose upstream was gone, no specs root had been named,
// and no worktree links were configured, so the project's own test command
// would have failed for a reason that had nothing to do with the change.
// (Its untracked `.aide/` was a fourth refusal then; spec 144 removed
// that one from the runner, and this preflight with it.)
//
// None of that was visible until Run was pressed. So the answer now says
// both things: registration completed, AND whether `aide-run-spec` would
// start. The rules mirrored here are the runner's own, read-only: nothing
// below switches a branch, commits a file or creates a directory.
describe("whether a run could start there (spec 138)", () => {
  /** A git that answers the readiness questions the way a clean checkout
   *  on its default branch would. Keyed by argv prefix like `fakeGit`,
   *  and overridable one answer at a time — every test below is "this
   *  one thing is wrong, and everything else is fine". */
  const READY: Record<string, { code: number; stdout?: string; stderr?: string }> = {
    "rev-parse --show-toplevel": { code: 0, stdout: "" }, // filled in per test
    "status --porcelain": { code: 0, stdout: "" },
    "symbolic-ref --short refs/remotes/origin/HEAD": { code: 0, stdout: "origin/main\n" },
    "show-ref --verify --quiet refs/heads/main": { code: 0, stdout: "" },
    "rev-parse --abbrev-ref HEAD": { code: 0, stdout: "main\n" },
    "worktree list --porcelain": { code: 0, stdout: "" },
  };

  /** The readiness of a project that was just added, with `answers`
   *  layered over a ready checkout. `--show-toplevel` answers with the
   *  directory it was asked in, which is what a real git says for a
   *  checkout that IS its own root. */
  async function assess(
    dir: string,
    projectsRoot: string,
    answers: Record<string, { code: number; stdout?: string; stderr?: string }> = {},
    req: Partial<AddProjectRequest> = {},
  ) {
    const table = { ...READY, ...answers };
    const run: GitRunner = async (at, args) => {
      const joined = args.join(" ");
      for (const [prefix, answer] of Object.entries(answers)) {
        if (joined.startsWith(prefix)) return { code: answer.code, stdout: answer.stdout ?? "", stderr: answer.stderr };
      }
      // Every root answers `--show-toplevel` with ITSELF unless a test
      // says otherwise: that is what a checkout of its own is.
      if (joined.startsWith("rev-parse --show-toplevel")) return { code: 0, stdout: `${at}\n` };
      for (const [prefix, answer] of Object.entries(table)) {
        if (joined.startsWith(prefix)) return { code: answer.code, stdout: answer.stdout ?? "", stderr: answer.stderr };
      }
      return { code: 1, stdout: "" };
    };
    return await addProject(run, projectsRoot, {
      name: dir.split("/").pop()!,
      existingPath: dir,
      ...req,
    });
  }

  /** A checkout under a projects root, with a specs directory beside it
   *  so the fallback specs root exists. */
  function checkout(name: string, opts: { specs?: boolean } = {}): { projectsRoot: string; dir: string } {
    const projectsRoot = root();
    const dir = join(projectsRoot, name);
    mkdirSync(dir, { recursive: true });
    if (opts.specs !== false) mkdirSync(join(dir, "specs"), { recursive: true });
    return { projectsRoot, dir };
  }

  const check = (r: ProjectAdminResult, name: string) =>
    r.readiness!.checks.filter((c) => c.check === name);
  const blockers = (r: ProjectAdminResult) =>
    r.readiness!.checks.filter((c) => c.blocking).map((c) => c.detail).join(" | ");

  // Criterion 1.
  test("a clean checkout on its default branch, with a specs root, can run", async () => {
    const { projectsRoot, dir } = checkout("ready");
    const result = await assess(dir, projectsRoot);
    expect(result.ok).toBe(true);
    expect(blockers(result)).toBe("");
    expect(result.readiness!.canRun).toBe(true);
  });

  // Criterion 3: the fallback is named, not assumed. A blank Specs root
  // field selects `<project>/specs`, and the runner refuses when that
  // directory is not there.
  test("no specs path and no specs/ directory blocks, naming the path it looked for", async () => {
    const { projectsRoot, dir } = checkout("nospecs", { specs: false });
    const result = await assess(dir, projectsRoot);
    expect(result.ok).toBe(true);
    expect(result.readiness!.canRun).toBe(false);
    expect(blockers(result)).toContain(join(dir, "specs"));
  });

  // Criterion 4: the specs repo is a participating repository — it is
  // where analyze actually writes — so it is checked for the same two
  // things the project is.
  test("a configured specs root brings its own repository under the same checks", async () => {
    const { projectsRoot, dir } = checkout("external", { specs: false });
    const specs = root();
    const result = await assess(
      dir,
      projectsRoot,
      {
        // Dirty in the SPECS repo alone: the project answers clean.
        [`status --porcelain`]: { code: 0, stdout: "" },
      },
      { specsPath: specs },
    );
    expect(result.readiness!.canRun).toBe(true);
    // Both roots were asked, and the answer says which is which.
    expect(check(result, "defaultBranch").map((c) => c.subject).sort()).toEqual([dir, specs].sort());
  });

  // Spec 144: the runner stopped caring whether a checkout is dirty —
  // it works in a worktree cut from origin's default branch, so nothing
  // uncommitted in the main checkout reaches it. A preflight that still
  // predicted that refusal would be warning about something that no
  // longer happens, which is the exact drift the union above is written
  // to prevent ("a check the runner does not make would refuse a
  // project that runs perfectly well").
  //
  // Two scenarios, asserted independently rather than once at the end:
  // the removal is unconditional, and a shared assertion would under-
  // test whichever case ran first if the two ever came apart.
  test("a dirty tree decides nothing, whether it is Add's own doing or not", async () => {
    // Add's own output — the `.aide/` written a second earlier, which
    // is what refused Skjer.
    const add = checkout("addsowndirt");
    const own = await assess(add.dir, add.projectsRoot, {
      "status --porcelain": { code: 0, stdout: "?? .aide/\n" },
    });
    // Cast: `"clean"` is not in the union any more, which is half of
    // what this asserts — the other half is that no check answers to
    // that name at runtime either.
    expect(own.readiness!.checks.map((c) => c.check as string)).not.toContain("clean");
    expect(own.readiness!.canRun).toBe(true);
    expect(own.readiness!.note).not.toContain("dirty");

    // And dirt that has nothing to do with the Add: somebody else's
    // work-in-progress, and a stray backup file in an unrelated folder.
    const else_ = checkout("someoneelsesdirt");
    const other = await assess(else_.dir, else_.projectsRoot, {
      "status --porcelain": { code: 0, stdout: " M README.md\n?? 141-old/4-status.md.bak\n" },
    });
    expect(other.readiness!.checks.map((c) => c.check as string)).not.toContain("clean");
    expect(other.readiness!.canRun).toBe(true);
    expect(other.readiness!.note).not.toContain("dirty");
  });

  // Criterion 5. The runner MOVES a clean checkout onto its default
  // branch, so standing on a feature branch is not a refusal — it is
  // worth saying and nothing more. Skjer stood on `feature/248-meta-tagger`.
  test("a feature branch is reported and does not block, because the run switches it", async () => {
    const { projectsRoot, dir } = checkout("onfeature");
    const result = await assess(dir, projectsRoot, {
      "rev-parse --abbrev-ref HEAD": { code: 0, stdout: "feature/248-meta-tagger\n" },
    });
    expect(result.readiness!.canRun).toBe(true);
    const branch = check(result, "defaultBranch")[0]!;
    expect(branch.blocking).toBe(false);
    expect(branch.detail).toContain("feature/248-meta-tagger");
    expect(branch.detail).toContain("main");
  });

  test("a default branch that is nowhere — no local ref and no remote one — blocks", async () => {
    const { projectsRoot, dir } = checkout("nobase");
    const result = await assess(dir, projectsRoot, {
      "rev-parse --abbrev-ref HEAD": { code: 0, stdout: "feature/248-meta-tagger\n" },
      "show-ref --verify --quiet refs/heads/main": { code: 1 },
      "show-ref --verify --quiet refs/remotes/origin/main": { code: 1 },
    });
    expect(result.readiness!.canRun).toBe(false);
    expect(blockers(result)).toContain("main");
  });

  test("a default branch another worktree already has checked out blocks", async () => {
    const { projectsRoot, dir } = checkout("taken");
    const result = await assess(dir, projectsRoot, {
      "rev-parse --abbrev-ref HEAD": { code: 0, stdout: "aide/99-old\n" },
      "worktree list --porcelain": {
        code: 0,
        stdout: `worktree ${join(projectsRoot, "taken")}\nbranch refs/heads/aide/99-old\n\nworktree /elsewhere/wt\nbranch refs/heads/main\n`,
      },
    });
    expect(result.readiness!.canRun).toBe(false);
    expect(blockers(result)).toContain("/elsewhere/wt");
  });

  // Criterion 6.
  test("a directory inside a bigger repository is not its own git root, and blocks", async () => {
    const { projectsRoot, dir } = checkout("inner");
    const result = await assess(dir, projectsRoot, {
      "rev-parse --show-toplevel": { code: 0, stdout: "/repos/monorepo\n" },
    });
    expect(result.readiness!.canRun).toBe(false);
    expect(blockers(result)).toContain("/repos/monorepo");
  });

  test("a project listed through a symlink to its checkout is its own git root", async () => {
    // The serving host's projects root is a directory of links to the
    // dashboard's own checkouts (2026-09-03); git answers with the real
    // path, and comparing that to the link's path read every project as
    // "inside another repository".
    const { projectsRoot, dir } = checkout("real-aide");
    const link = join(projectsRoot, "aide");
    symlinkSync(dir, link);
    const result = await assess(link, projectsRoot, {
      "rev-parse --show-toplevel": { code: 0, stdout: `${realpathSync(dir)}\n` },
    });
    expect(check(result, "gitRoot")[0]!.ok).toBe(true);
    expect(blockers(result)).not.toContain("inside the one at");
  });

  test("a directory that is no git repository at all blocks", async () => {
    const { projectsRoot, dir } = checkout("norepo");
    const result = await assess(dir, projectsRoot, {
      "rev-parse --show-toplevel": { code: 128, stdout: "" },
    });
    expect(result.readiness!.canRun).toBe(false);
    expect(check(result, "gitRoot")[0]!.blocking).toBe(true);
  });

  test("a specs root outside any git repository blocks, because nothing would commit the spec", async () => {
    const { projectsRoot, dir } = checkout("looserspecs", { specs: false });
    const specs = root();
    const run: GitRunner = async (at, args) => {
      const joined = args.join(" ");
      // The specs root answers the way a directory outside any
      // repository does: git refuses the question.
      if (joined.startsWith("rev-parse --show-toplevel")) {
        return at === specs ? { code: 128, stdout: "" } : { code: 0, stdout: `${at}\n` };
      }
      for (const [prefix, answer] of Object.entries(READY)) {
        if (joined.startsWith(prefix)) return { code: answer.code, stdout: answer.stdout ?? "" };
      }
      return { code: 1, stdout: "" };
    };
    const result = await addProject(run, projectsRoot, {
      name: "looserspecs",
      existingPath: dir,
      specsPath: specs,
    });
    expect(result.readiness!.canRun).toBe(false);
    expect(check(result, "specsRepo")[0]!.blocking).toBe(true);
  });

  // Criterion 7, the dashboard half. The runner half is in
  // tests/specs/unit/core/scripts/test_aide_run_spec.py — one rule, two
  // places that have to agree about it.
  test.each([["/etc"], ["../escape"], ["deps/../../escape"]])(
    "a worktree link that escapes the root (%p) blocks and is named",
    async (entry) => {
      const { projectsRoot, dir } = checkout("badlink");
      // Hand-written into the config, not posted at the form: the form's
      // own value is refused before it is ever written (below). This is
      // the file as `aide-run-spec` would find it.
      mkdirSync(join(dir, ".aide"), { recursive: true });
      writeFileSync(join(dir, ".aide", "config"), `AIDE_WORKTREE_LINKS=${entry}\n`);
      const result = await assess(dir, projectsRoot);
      expect(result.readiness!.canRun).toBe(false);
      expect(blockers(result)).toContain(entry);
    },
  );

  // The note about an unset key is the one readiness answer a person can
  // act on directly, and it used to describe the gap without naming the
  // place to close it: the reader was left hunting for a field whose
  // label (`AIDE_WORKTREE_LINKS`) matches neither the manifest key
  // (`worktreeLinks`) nor the words in the note.
  test("the unset note names the setting and the tab that holds it", async () => {
    const { projectsRoot, dir } = checkout("nolinks");
    const result = await assess(dir, projectsRoot);
    const note = check(result, "worktreeLinks")[0]!;
    expect(note.blocking).toBe(false);
    // The label the Config row shows, from the shared table (spec 318),
    // and the tab it is on.
    expect(note.detail).toContain(SETTING_LABELS.AIDE_WORKTREE_LINKS);
    expect(note.detail).toContain("Config tab");
  });

  // Spec 186. A worktree link is a symlink into the ONE main checkout
  // that every concurrent run shares — cheap for a dependency cache
  // nobody writes to, ruinous for anything a build writes into. The
  // source directory is created here on purpose, so the existence check
  // above cannot be what refuses it: the name alone has to.
  test.each([["build"], ["target"], ["dist"], [".gradle"], ["backend/build"]])(
    "a worktree link naming a build output (%p) blocks, and says why",
    async (entry) => {
      const { projectsRoot, dir } = checkout("buildlink");
      mkdirSync(join(dir, entry), { recursive: true });
      mkdirSync(join(dir, ".aide"), { recursive: true });
      writeFileSync(join(dir, ".aide", "config"), `AIDE_WORKTREE_LINKS=${entry}\n`);
      const result = await assess(dir, projectsRoot);
      expect(result.readiness!.canRun).toBe(false);
      expect(blockers(result)).toContain(entry);
      expect(blockers(result)).toContain("build output");
    },
  );

  // Criterion 4: this repo's own setting, unaffected by the new check.
  test("the dependency caches a build only reads are not refused", async () => {
    const { projectsRoot, dir } = checkout("readonlylinks");
    mkdirSync(join(dir, ".venv"), { recursive: true });
    mkdirSync(join(dir, "dashboard", "node_modules"), { recursive: true });
    const result = await assess(dir, projectsRoot, {}, { worktreeLinks: ".venv dashboard/node_modules" });
    expect(result.readiness!.canRun).toBe(true);
    expect(check(result, "worktreeLinks")[0]!.ok).toBe(true);
  });

  test("a worktree link whose source is not there blocks, and is named", async () => {
    const { projectsRoot, dir } = checkout("missinglink");
    const result = await assess(dir, projectsRoot, {}, { worktreeLinks: "node_modules .venv" });
    expect(result.readiness!.canRun).toBe(false);
    expect(blockers(result)).toContain("node_modules");
    expect(blockers(result)).toContain(".venv");
  });

  test("worktree links that are all there do not block", async () => {
    const { projectsRoot, dir } = checkout("goodlinks");
    mkdirSync(join(dir, "node_modules"), { recursive: true });
    const result = await assess(dir, projectsRoot, {}, { worktreeLinks: "node_modules" });
    expect(result.readiness!.canRun).toBe(true);
    expect(check(result, "worktreeLinks")[0]!.ok).toBe(true);
  });

  // Criterion 8: the dashboard cannot know which gitignored paths a
  // project's own test command needs, so it never invents one — but it
  // says the field is empty, because that is what made Skjer's suite
  // fail for a reason that had nothing to do with the change.
  test("no worktree links at all is said in words, and blocks nothing", async () => {
    const { projectsRoot, dir } = checkout("nolinks");
    const result = await assess(dir, projectsRoot);
    expect(result.readiness!.canRun).toBe(true);
    const links = check(result, "worktreeLinks")[0]!;
    expect(links.blocking).toBe(false);
    expect(links.detail.toLowerCase()).toContain("worktree");
  });

  // --- Spec 316: the same fixture the bash side reads, read here too ---------
  //
  // tests/fixtures/project-readiness-prerequisites.json is the one place
  // this list of prerequisites lives; test_aide_run_spec.py reads it for
  // the bash half of the same pin. A fixture entry with no matching
  // answer set below fails loudly (`toBeDefined()`), which is what makes
  // "added to the fixture, forgotten here" a red test rather than a
  // silent skip.
  const READINESS_FIXTURE: {
    prerequisites: { check: string; failsWhen: string; blocking: boolean }[];
  } = JSON.parse(
    readFileSync(
      join(import.meta.dir, "..", "..", "..", "..", "tests", "fixtures", "project-readiness-prerequisites.json"),
      "utf-8",
    ),
  );

  const READINESS_ANSWERS: Record<string, Record<string, { code: number; stdout?: string }>> = {
    "gitRoot: the project directory is not a git repository": {
      "rev-parse --show-toplevel": { code: 128, stdout: "" },
    },
    "specsRoot: the specs root does not exist as a directory": {}, // built via checkout(name, { specs: false })
    "defaultBranch: the default branch cannot be resolved in a root the run touches": {
      // Every strategy defaultBranchOf() tries comes back empty, so base
      // itself is "" — the one scenario the bash side cannot reach.
      "symbolic-ref --short refs/remotes/origin/HEAD": { code: 1, stdout: "" },
      "show-ref --verify --quiet refs/heads/main": { code: 1, stdout: "" },
      "show-ref --verify --quiet refs/heads/master": { code: 1, stdout: "" },
      "rev-parse --abbrev-ref HEAD": { code: 1, stdout: "" },
    },
    "defaultBranch: another worktree already has the default branch checked out": {
      "rev-parse --abbrev-ref HEAD": { code: 0, stdout: "aide/other\n" },
      "worktree list --porcelain": {
        code: 0,
        stdout: "worktree /elsewhere\nbranch refs/heads/main\n",
      },
    },
    "worktreeLinks: a configured worktree-link entry names a path that is not on disk": {}, // built via req.worktreeLinks
  };

  describe("the readiness fixture's prerequisites (spec 316)", () => {
    for (const c of READINESS_FIXTURE.prerequisites) {
      const id = `${c.check}: ${c.failsWhen}`;
      test(id, async () => {
        const answers = READINESS_ANSWERS[id];
        expect(answers).toBeDefined(); // no scenario wired up for this fixture entry
        const noSpecs = id.startsWith("specsRoot");
        const { projectsRoot, dir } = checkout(id.replace(/[^a-z]/gi, ""), { specs: !noSpecs });
        const req = id.startsWith("worktreeLinks") ? { worktreeLinks: "nowhere" } : {};
        const result = await assess(dir, projectsRoot, answers!, req);
        const found = check(result, c.check).find((ch) => !ch.ok);
        expect(found?.blocking).toBe(c.blocking);
      });
    }
  });

  describe("readiness identifiers agree with the fixture (spec 316)", () => {
    const KNOWN_EXCLUSIONS: Record<string, string> = {
      specsRepo: "TypeScript treats a specs root outside git as blocking; aide-run-spec does not refuse on it today (2-analysis.md)",
      dashboardCheckout: "has no aide-run-spec counterpart at all — mirrors the dashboard's own clone machinery, always non-blocking",
    };

    test("every ReadinessCheckName is either in the fixture or a named exclusion", () => {
      const ts = readFileSync(
        join(import.meta.dir, "..", "..", "..", "src", "project", "project-admin", "types.ts"),
        "utf-8",
      );
      const m = ts.match(/export type ReadinessCheckName =\s*([\s\S]*?);/);
      expect(m).toBeTruthy();
      const declared = new Set([...m![1]!.matchAll(/"([a-zA-Z]+)"/g)].map((x) => x[1]));
      const covered = new Set([
        ...READINESS_FIXTURE.prerequisites.map((c) => c.check),
        ...Object.keys(KNOWN_EXCLUSIONS),
      ]);
      expect([...declared].sort()).toEqual([...covered].sort());
    });
  });
});
