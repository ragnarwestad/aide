// Spec 112: adding a project used to be four hand steps on the serving
// host. This is the half of them that is filesystem work — clone or
// register a checkout, give it a manifest if it has none, point it at
// its specs root — tested in complete isolation from HTTP and from git:
// the runner is injected (`test/helpers/fake-git.ts`), so no subprocess
// and no network is involved in any of it.
//
// The other half — the allowlist, and persisting it — is the server's
// (`queue-routes.test.ts`) and the config's (`queue.test.ts`).
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addProject,
  projectNameError,
  removeProject,
  type AddProjectRequest,
  type ProjectAdminResult,
} from "../src/project-admin.ts";
import type { GitRunner } from "../src/branch-status.ts";
import { parseManifest } from "../src/parse-manifest.ts";
import { configValue } from "../src/discover.ts";
import { fakeGit } from "./helpers/fake-git.ts";

const dirs: string[] = [];
const root = (): string => {
  const d = mkdtempSync(join(tmpdir(), "aide-project-admin-"));
  dirs.push(d);
  return d;
};

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

/** A git that answers a clone by making the directory the real one
 *  would have made — everything after the clone step reads that
 *  directory, so a fake that leaves nothing behind would test only the
 *  first step. */
function cloningGit(projectsRoot: string, files: Record<string, string> = {}) {
  const calls: { dir: string; args: string[] }[] = [];
  return {
    calls,
    run: async (dir: string, args: string[]) => {
      calls.push({ dir, args });
      if (args[0] === "clone") {
        const dest = join(projectsRoot, args[2]!);
        mkdirSync(dest, { recursive: true });
        for (const [path, text] of Object.entries(files)) {
          mkdirSync(join(dest, path).replace(/\/[^/]+$/, ""), { recursive: true });
          writeFileSync(join(dest, path), text);
        }
        return { code: 0, stdout: "" };
      }
      return { code: 1, stdout: "" };
    },
  };
}

describe("a project name has to be safe before anything is touched", () => {
  // Criterion 3. The name becomes a directory under the projects root
  // and a `git clone` argument, so it is checked FIRST — a refusal that
  // happens after the clone is not a refusal.
  test.each([["../escape"], ["a/b"], [".hidden"], [""], ["  "], ["a b"]])(
    "%p is refused",
    (name) => {
      expect(projectNameError(name)).toMatch(/name/i);
    },
  );

  test.each([["aide"], ["aide-dashboard"], ["Atlasaurus"], ["a.b_c-1"]])("%p is accepted", (name) => {
    expect(projectNameError(name)).toBeNull();
  });

  test("an unsafe name reaches neither git nor the filesystem", async () => {
    const projectsRoot = root();
    const git = fakeGit({});
    const result = await addProject(git.run, projectsRoot, {
      name: "../escape",
      gitUrl: "https://example.com/repo.git",
    });
    expect(result.ok).toBe(false);
    expect(result.steps[0]!.step).toBe("name");
    expect(result.steps[0]!.error).toMatch(/name/i);
    // Nothing was asked of git, and nothing was written anywhere.
    expect(git.calls).toEqual([]);
    expect(existsSync(join(projectsRoot, "..", "escape"))).toBe(false);
  });

  test("a request that names no source is refused too", async () => {
    const git = fakeGit({});
    const result = await addProject(git.run, root(), { name: "fine" });
    expect(result.ok).toBe(false);
    expect(git.calls).toEqual([]);
    expect(result.steps.map((s) => s.step)).toEqual(["name"]);
  });
});

describe("adding a project by cloning it", () => {
  // Criterion 1.
  test("clones into <root>/<name>, writes a minimal manifest, reports every step", async () => {
    const projectsRoot = root();
    const git = cloningGit(projectsRoot);
    const result = await addProject(git.run, projectsRoot, {
      name: "newproj",
      gitUrl: "https://example.com/newproj.git",
      description: "What it is for",
    });
    expect(result.ok).toBe(true);
    expect(result.steps.map((s) => s.step)).toEqual(["name", "clone", "manifest"]);
    expect(result.steps.every((s) => s.ok)).toBe(true);
    // `cwd` is the projects root, not the destination: the destination
    // does not exist yet, which is what makes this call different from
    // every other git call in the codebase. The CLONE calls alone —
    // since spec 138 the same runner is asked the readiness questions
    // too, and those are that spec's to assert.
    expect(git.calls.filter((c) => c.args[0] === "clone")).toEqual([
      { dir: projectsRoot, args: ["clone", "https://example.com/newproj.git", "newproj"] },
    ]);
    const manifest = join(projectsRoot, "newproj", ".aide", "project.yaml");
    expect(existsSync(manifest)).toBe(true);
    const parsed = parseManifest(readFileSync(manifest, "utf-8"));
    expect(parsed).toEqual({ ok: true, data: { name: "newproj", description: "What it is for" } });
  });

  // Criterion 2.
  test("a name already taken under the projects root is refused before the clone", async () => {
    const projectsRoot = root();
    mkdirSync(join(projectsRoot, "taken"));
    const git = cloningGit(projectsRoot);
    const result = await addProject(git.run, projectsRoot, {
      name: "taken",
      gitUrl: "https://example.com/taken.git",
    });
    expect(result.ok).toBe(false);
    const clone = result.steps.find((s) => s.step === "clone")!;
    expect(clone.ok).toBe(false);
    expect(clone.error).toContain("taken");
    expect(git.calls).toEqual([]);
  });

  test("a clone that fails is reported with what git said, and nothing else runs", async () => {
    const projectsRoot = root();
    const git = fakeGit({ clone: { code: 128, stderr: "repository not found" } });
    const result = await addProject(git.run, projectsRoot, {
      name: "nope",
      gitUrl: "https://example.com/nope.git",
    });
    expect(result.ok).toBe(false);
    expect(result.steps.map((s) => s.step)).toEqual(["name", "clone"]);
    expect(result.steps[1]!.error).toContain("repository not found");
  });
});

describe("adding a checkout that is already on the host", () => {
  // Criterion 5.
  test("an existing manifest is kept, not overwritten", async () => {
    const projectsRoot = root();
    const dir = join(projectsRoot, "already");
    mkdirSync(join(dir, ".aide"), { recursive: true });
    const manifest = join(dir, ".aide", "project.yaml");
    writeFileSync(manifest, "name: already\ndescription: written by /aide-manifest\nstack:\n  api: Go\n");
    const git = fakeGit({});
    const result = await addProject(git.run, projectsRoot, {
      name: "already",
      existingPath: dir,
      description: "ignored, because there is a manifest already",
    });
    expect(result.ok).toBe(true);
    // Nothing was CLONED: the checkout was already there. (Readiness
    // asks the same runner its own read-only questions afterwards.)
    expect(git.calls.filter((c) => c.args[0] === "clone")).toEqual([]);
    expect(readFileSync(manifest, "utf-8")).toContain("api: Go");
    expect(readFileSync(manifest, "utf-8")).not.toContain("ignored");
  });

  // Criterion 6: the same registration, with no manifest there. It
  // succeeds — and SAYS a manifest had to be made, because the operator
  // has a `/aide-manifest` run to do afterwards.
  test("a checkout with no manifest gets a minimal one, and the answer says so", async () => {
    const projectsRoot = root();
    const dir = join(projectsRoot, "bare");
    mkdirSync(dir, { recursive: true });
    const result = await addProject(fakeGit({}).run, projectsRoot, {
      name: "bare",
      existingPath: dir,
      description: "A checkout that predates its manifest",
    });
    expect(result.ok).toBe(true);
    const manifest = result.steps.find((s) => s.step === "manifest")!;
    expect(manifest.ok).toBe(true);
    expect(manifest.note).toMatch(/aide-manifest/);
    expect(parseManifest(readFileSync(join(dir, ".aide", "project.yaml"), "utf-8"))).toEqual({
      ok: true,
      data: { name: "bare", description: "A checkout that predates its manifest" },
    });
  });

  test("a path that is not <root>/<name> is refused, because nothing would discover it", async () => {
    const projectsRoot = root();
    const elsewhere = root();
    const result = await addProject(fakeGit({}).run, projectsRoot, {
      name: "outside",
      existingPath: elsewhere,
    });
    expect(result.ok).toBe(false);
    expect(result.steps.find((s) => s.step === "register")!.error).toContain(projectsRoot);
  });

  test("a path that is not there at all is refused", async () => {
    const projectsRoot = root();
    const result = await addProject(fakeGit({}).run, projectsRoot, {
      name: "ghost",
      existingPath: join(projectsRoot, "ghost"),
    });
    expect(result.ok).toBe(false);
    expect(result.steps.find((s) => s.step === "register")!.ok).toBe(false);
  });

  // Spec 131: the form picks a directory NAME now, not a path — so a
  // value with no separator in it means "the checkout of that name
  // directly under the projects root", and the name of the project
  // follows from the pick rather than being typed a second time.
  test("a picked directory name settles the path and the name together", async () => {
    const projectsRoot = root();
    const dir = join(projectsRoot, "atlasaurus");
    mkdirSync(dir, { recursive: true });
    const result = await addProject(fakeGit({}).run, projectsRoot, {
      name: "",
      existingPath: "atlasaurus",
      description: "picked, not typed",
    });
    expect(result.ok).toBe(true);
    // The manifest is where criterion 5 actually bites: the name written
    // there has to be the picked one, not the blank the reader left.
    expect(parseManifest(readFileSync(join(dir, ".aide", "project.yaml"), "utf-8"))).toEqual({
      ok: true,
      data: { name: "atlasaurus", description: "picked, not typed" },
    });
  });

  // A typed name still wins, so a mismatch is the same refusal it was —
  // never a silent override of what the reader wrote.
  test("a typed name that does not match the picked directory is still refused", async () => {
    const projectsRoot = root();
    mkdirSync(join(projectsRoot, "atlasaurus"), { recursive: true });
    const result = await addProject(fakeGit({}).run, projectsRoot, {
      name: "foo",
      existingPath: "atlasaurus",
    });
    expect(result.ok).toBe(false);
    const register = result.steps.find((s) => s.step === "register")!;
    expect(register.error).toContain(join(projectsRoot, "foo"));
    expect(register.error).toContain(join(projectsRoot, "atlasaurus"));
  });

  test("nothing picked and nothing typed is still refused for saying neither", async () => {
    const result = await addProject(fakeGit({}).run, root(), { name: "", existingPath: "" });
    expect(result.ok).toBe(false);
    expect(result.steps[0]!.step).toBe("name");
  });
});

describe("where the project's specs live", () => {
  test("a specs path is written in the format .aide/config is read in", async () => {
    const projectsRoot = root();
    const git = cloningGit(projectsRoot);
    const result = await addProject(git.run, projectsRoot, {
      name: "withspecs",
      gitUrl: "https://example.com/withspecs.git",
      specsPath: "/repos/aide-specs/withspecs",
    });
    expect(result.ok).toBe(true);
    expect(result.steps.map((s) => s.step)).toEqual(["name", "clone", "manifest", "specsConfig"]);
    // Read back through the dashboard's OWN reader, not by string match:
    // the two would otherwise be free to disagree about the format.
    expect(configValue(join(projectsRoot, "withspecs"), "AIDE_SPECS_PATH")).toBe(
      "/repos/aide-specs/withspecs",
    );
  });

  test("an existing .aide/config keeps its other keys", async () => {
    const projectsRoot = root();
    const dir = join(projectsRoot, "hasconfig");
    mkdirSync(join(dir, ".aide"), { recursive: true });
    writeFileSync(
      join(dir, ".aide", "config"),
      "# personal\nAIDE_INSTALL_CMD=./install.sh\nAIDE_SPECS_PATH=/old/place\n",
    );
    const result = await addProject(fakeGit({}).run, projectsRoot, {
      name: "hasconfig",
      existingPath: dir,
      specsPath: "/new/place",
    });
    expect(result.ok).toBe(true);
    expect(configValue(dir, "AIDE_INSTALL_CMD")).toBe("./install.sh");
    expect(configValue(dir, "AIDE_SPECS_PATH")).toBe("/new/place");
    // Replaced, not appended twice: two lines for one key is a file
    // whose meaning depends on which reader you ask.
    const text = readFileSync(join(dir, ".aide", "config"), "utf-8");
    expect(text.match(/^AIDE_SPECS_PATH=/gm)!.length).toBe(1);
  });

  test("no specs path means no config is written at all", async () => {
    const projectsRoot = root();
    const dir = join(projectsRoot, "nospecs");
    mkdirSync(dir, { recursive: true });
    const result = await addProject(fakeGit({}).run, projectsRoot, { name: "nospecs", existingPath: dir });
    expect(result.ok).toBe(true);
    expect(result.steps.some((s) => s.step === "specsConfig")).toBe(false);
    expect(existsSync(join(dir, ".aide", "config"))).toBe(false);
  });
});

describe("removing a project is a typed confirmation and nothing else", () => {
  // Criteria 7-8, at the level below HTTP: the mechanic itself.
  test("the name typed back exactly is what takes it off the allowlist", () => {
    const allowed = new Set(["aide", "atlasaurus"]);
    const result = removeProject(allowed, { name: "atlasaurus", confirm: "atlasaurus" });
    expect(result.ok).toBe(true);
    expect(result.steps.map((s) => s.step)).toEqual(["confirm", "allowlist"]);
    expect([...allowed]).toEqual(["aide"]);
  });

  test.each([["Atlasaurus"], ["atlasaurus "], [""], ["aide"]])(
    "%p is not the name, so nothing is removed",
    (confirm) => {
      const allowed = new Set(["aide", "atlasaurus"]);
      const result = removeProject(allowed, { name: "atlasaurus", confirm });
      expect(result.ok).toBe(false);
      expect(result.steps[0]!.step).toBe("confirm");
      expect([...allowed].sort()).toEqual(["aide", "atlasaurus"]);
    },
  );

  test("a project that is not on the allowlist is refused, confirmation or not", () => {
    const allowed = new Set(["aide"]);
    const result = removeProject(allowed, { name: "never-added", confirm: "never-added" });
    expect(result.ok).toBe(false);
    expect(result.steps.find((s) => s.step === "allowlist")!.error).toContain("never-added");
  });
});

// --- spec 138: whether a run can actually start there -------------------------
//
// Adding a project answered "added" and nothing else. Skjer was added on
// 2026-08-20 and looked added: it was on the allowlist, its checkout was
// where the form said, and a minimal manifest had been written for it.
// A run there refused before it started — the tree was dirty (the `.aide`
// the Add itself had just written was untracked), the checkout stood on a
// feature branch whose upstream was gone, no specs root had been named,
// and no worktree links were configured, so the project's own test command
// would have failed for a reason that had nothing to do with the change.
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
    const result = await addProject(run, projectsRoot, {
      name: dir.split("/").pop()!,
      existingPath: dir,
      ...req,
    });
    return result;
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

  // Criterion 2: the Add's OWN files are in the answer. This is Skjer
  // exactly — `.aide/project.yaml` was written by the Add a moment
  // earlier and is untracked, so the runner's dirty-tree refusal applies
  // to it. Registration still succeeded, and says so.
  test("files the Add itself wrote make the tree dirty, and registration still succeeded", async () => {
    const { projectsRoot, dir } = checkout("dirty");
    const result = await assess(dir, projectsRoot, {
      "status --porcelain": { code: 0, stdout: "?? .aide/\n M README.md\n" },
    });
    expect(result.ok).toBe(true);
    expect(result.steps.every((s) => s.ok)).toBe(true);
    expect(result.readiness!.canRun).toBe(false);
    const dirty = check(result, "clean").find((c) => c.blocking)!;
    expect(dirty.detail).toContain(".aide/");
    expect(dirty.detail).toContain("README.md");
  });

  // The sentence this becomes travels in a redirect's `Location` header
  // for a browser with no script, so a checkout with a thousand
  // untracked files must not build one no proxy is obliged to carry.
  test("a very long dirty list is cut short, and says how much it cut", async () => {
    const { projectsRoot, dir } = checkout("verydirty");
    const files = Array.from({ length: 40 }, (_, i) => `?? file-${i}.txt`).join("\n");
    const result = await assess(dir, projectsRoot, {
      "status --porcelain": { code: 0, stdout: `${files}\n` },
    });
    const dirty = check(result, "clean").find((c) => c.blocking)!;
    expect(dirty.detail).toContain("file-0.txt");
    expect(dirty.detail).toContain("and 30 more");
    expect(dirty.detail).not.toContain("file-39.txt");
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
  // where analyze and review-plan actually write — so it is checked for
  // the same two things the project is.
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
    const cleanliness = check(result, "clean");
    expect(cleanliness.map((c) => c.subject).sort()).toEqual([dir, specs].sort());
    expect(check(result, "defaultBranch").map((c) => c.subject).sort()).toEqual([dir, specs].sort());
  });

  test("a dirty specs repository blocks the run, and is named as the specs root", async () => {
    const { projectsRoot, dir } = checkout("dirtyspecs", { specs: false });
    const specs = root();
    const run: GitRunner = async (at, args) => {
      const joined = args.join(" ");
      if (joined.startsWith("rev-parse --show-toplevel")) return { code: 0, stdout: `${at}\n` };
      if (joined.startsWith("status --porcelain")) {
        return { code: 0, stdout: at === specs ? "?? 138-new/\n" : "" };
      }
      for (const [prefix, answer] of Object.entries(READY)) {
        if (joined.startsWith(prefix)) return { code: answer.code, stdout: answer.stdout ?? "" };
      }
      return { code: 1, stdout: "" };
    };
    const result = await addProject(run, projectsRoot, {
      name: "dirtyspecs",
      existingPath: dir,
      specsPath: specs,
    });
    expect(result.ok).toBe(true);
    expect(result.readiness!.canRun).toBe(false);
    const dirty = result.readiness!.checks.find((c) => c.blocking)!;
    expect(dirty.subject).toBe(specs);
    expect(dirty.detail).toContain("138-new/");
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
});

// Criterion 9: both fields land in the same personal file, and neither
// may take the other — or a hand-written key, or a comment — with it.
describe("writing .aide/config (spec 138)", () => {
  test("worktree links are written in the format the runner reads them in", async () => {
    const projectsRoot = root();
    const dir = join(projectsRoot, "links");
    mkdirSync(dir, { recursive: true });
    const result = await addProject(fakeGit({}).run, projectsRoot, {
      name: "links",
      existingPath: dir,
      worktreeLinks: ".venv dashboard/node_modules",
    });
    expect(result.ok).toBe(true);
    expect(configValue(dir, "AIDE_WORKTREE_LINKS")).toBe(".venv dashboard/node_modules");
  });

  test("both keys at once, over a config that already has comments and other keys", async () => {
    const projectsRoot = root();
    const dir = join(projectsRoot, "both");
    mkdirSync(join(dir, ".aide"), { recursive: true });
    writeFileSync(
      join(dir, ".aide", "config"),
      "# personal — kept out of git\nAIDE_INSTALL_CMD=./install.sh\nAIDE_WORKTREE_LINKS=old\n",
    );
    const result = await addProject(fakeGit({}).run, projectsRoot, {
      name: "both",
      existingPath: dir,
      specsPath: "/repos/aide-specs/both",
      worktreeLinks: ".venv",
    });
    expect(result.ok).toBe(true);
    const text = readFileSync(join(dir, ".aide", "config"), "utf-8");
    expect(text).toContain("# personal — kept out of git");
    expect(configValue(dir, "AIDE_INSTALL_CMD")).toBe("./install.sh");
    expect(configValue(dir, "AIDE_SPECS_PATH")).toBe("/repos/aide-specs/both");
    expect(configValue(dir, "AIDE_WORKTREE_LINKS")).toBe(".venv");
    // Once each: two lines for one key is a file whose meaning depends
    // on which reader you ask.
    expect(text.match(/^AIDE_WORKTREE_LINKS=/gm)!.length).toBe(1);
    expect(text.match(/^AIDE_SPECS_PATH=/gm)!.length).toBe(1);
  });

  test("an unusable worktree-links value is refused before it is written", async () => {
    const projectsRoot = root();
    const dir = join(projectsRoot, "refused");
    mkdirSync(dir, { recursive: true });
    const result = await addProject(fakeGit({}).run, projectsRoot, {
      name: "refused",
      existingPath: dir,
      worktreeLinks: "/etc",
    });
    expect(result.ok).toBe(false);
    const step = result.steps.find((s) => s.step === "worktreeLinks")!;
    expect(step.ok).toBe(false);
    expect(step.error).toContain("/etc");
    expect(existsSync(join(dir, ".aide", "config"))).toBe(false);
  });

  test("no worktree links means no key is written for them", async () => {
    const projectsRoot = root();
    const dir = join(projectsRoot, "quiet");
    mkdirSync(dir, { recursive: true });
    await addProject(fakeGit({}).run, projectsRoot, {
      name: "quiet",
      existingPath: dir,
      specsPath: "/somewhere",
    });
    expect(configValue(dir, "AIDE_WORKTREE_LINKS")).toBeNull();
  });
});
