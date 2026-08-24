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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addProject,
  addProjectTarget,
  assessProjectReadiness,
  minimalManifest,
  projectNameError,
  removeProject,
  suggestSpecsPath,
  suggestWorktreeLinksFromLockfile,
  updateProjectSettings,
  upsertManifestScalar,
  type AddProjectRequest,
  type ProjectAdminResult,
} from "../src/project-admin.ts";
import type { GitRunner } from "../src/branch-status.ts";
import { parseManifest } from "../src/parse-manifest.ts";
import { configValue, resolveCodeLanding, resolveWorktreeLinks } from "../src/discover.ts";
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
      const clone = args.indexOf("clone");
      if (clone !== -1) {
        const dest = join(projectsRoot, args[clone + 2]!);
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
    expect(git.calls.filter((c) => c.args.includes("clone"))).toEqual([
      {
        dir: projectsRoot,
        args: ["-c", "credential.helper=", "clone", "https://example.com/newproj.git", "newproj"],
      },
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
    const git = fakeGit({ "-c credential.helper= clone": { code: 128, stderr: "repository not found" } });
    const result = await addProject(git.run, projectsRoot, {
      name: "nope",
      gitUrl: "https://example.com/nope.git",
    });
    expect(result.ok).toBe(false);
    expect(result.steps.map((s) => s.step)).toEqual(["name", "clone"]);
    expect(result.steps[1]!.error).toContain("repository not found");
  });
});

// Spec 183: a clone of a private HTTPS repository hung for eleven
// minutes on the serving host, because git handed the question to the
// machine's credential helper and a background service has nobody to
// answer it. The clone now runs with the helper list cleared for that
// one invocation, so git gives up in seconds instead — and the answer
// has to say what to do about it, since the reader is looking at the
// HTTPS address they just pasted.
describe("a clone that cannot authenticate", () => {
  const PROMPTS_DISABLED =
    "fatal: could not read Username for 'https://example.com/owner/private.git': terminal prompts disabled";

  // Criterion 2: the override rides on the clone call's own args, not
  // on the shared runner — every OTHER git call this dashboard makes
  // still consults the helper, which is what an already-added project
  // holding an HTTPS token depends on.
  test("the clone clears the credential helper for that one call", async () => {
    const projectsRoot = root();
    const git = cloningGit(projectsRoot);
    await addProject(git.run, projectsRoot, {
      name: "newproj",
      gitUrl: "https://example.com/newproj.git",
    });
    const clone = git.calls.find((c) => c.args.includes("clone"))!;
    expect(clone.args.slice(0, 3)).toEqual(["-c", "credential.helper=", "clone"]);
  });

  // Criterion 1.
  test("names the credentials problem and suggests the SSH address", async () => {
    const git = fakeGit({ "-c credential.helper= clone": { code: 128, stderr: PROMPTS_DISABLED } });
    const result = await addProject(git.run, root(), {
      name: "private",
      gitUrl: "https://example.com/owner/private.git",
    });
    const clone = result.steps.find((s) => s.step === "clone")!;
    expect(clone.ok).toBe(false);
    expect(clone.error).toContain("credentials");
    expect(clone.error).toContain("git@example.com:owner/private.git");
  });

  // Criterion 5: the address is derived, not echoed — an HTTPS one
  // without the suffix still gets an SSH one with it.
  test("an address with no .git suffix still gets one in the suggestion", async () => {
    const git = fakeGit({ "-c credential.helper= clone": { code: 128, stderr: PROMPTS_DISABLED } });
    const result = await addProject(git.run, root(), {
      name: "private",
      gitUrl: "https://example.com/owner/private",
    });
    expect(result.steps.find((s) => s.step === "clone")!.error).toContain(
      "git@example.com:owner/private.git",
    );
  });

  // Criterion 3: every other reason a clone fails keeps its own words.
  // The classifier reads git's stderr, so an over-matching one would
  // fold "no such repository" into a message about credentials.
  test("an unrelated failure keeps today's plain message", async () => {
    const git = fakeGit({ "-c credential.helper= clone": { code: 128, stderr: "repository not found" } });
    const result = await addProject(git.run, root(), {
      name: "nope",
      gitUrl: "https://example.com/nope.git",
    });
    const clone = result.steps.find((s) => s.step === "clone")!;
    expect(clone.error).toContain("repository not found");
    expect(clone.error).not.toContain("credentials");
    expect(clone.error).not.toContain("git@");
  });

  // Criterion 7: an SSH address authenticates by key, never through
  // `credential.helper`, so clearing the helper changes nothing for it.
  test("an SSH address still clones", async () => {
    const projectsRoot = root();
    const git = cloningGit(projectsRoot);
    const result = await addProject(git.run, projectsRoot, {
      name: "bykey",
      gitUrl: "git@example.com:owner/bykey.git",
    });
    expect(result.ok).toBe(true);
    expect(result.steps.map((s) => s.step)).toEqual(["name", "clone", "manifest"]);
    expect(existsSync(join(projectsRoot, "bykey", ".aide", "project.yaml"))).toBe(true);
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
    expect(git.calls.filter((c) => c.args.includes("clone"))).toEqual([]);
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

  // Spec 140, criterion 1: a project's name IS its directory name —
  // `discoverProjects` reads it off the entry under the projects root
  // and nowhere else, so a project registered under a typed name that
  // differs could never be found again. The pick therefore wins over
  // the typed Name, where before the mismatch was refused with a
  // message naming a path that does not exist.
  test("a typed name that does not match the picked directory loses to the pick", async () => {
    const projectsRoot = root();
    const dir = join(projectsRoot, "skjer");
    mkdirSync(dir, { recursive: true });
    const result = await addProject(fakeGit({}).run, projectsRoot, {
      name: "Skjer",
      existingPath: "skjer",
      description: "picked as skjer, typed as Skjer",
    });
    expect(result.ok).toBe(true);
    // The directory's own name is what the manifest — and so the
    // allowlist, and `discoverProjects` — ends up carrying.
    expect(parseManifest(readFileSync(join(dir, ".aide", "project.yaml"), "utf-8"))).toEqual({
      ok: true,
      data: { name: "skjer", description: "picked as skjer, typed as Skjer" },
    });
    // The entry under the projects root is what `discoverProjects`
    // reads a project's name off, and there is exactly one of it —
    // asked by listing, because a case-insensitive filesystem answers
    // `existsSync(<root>/Skjer)` with a yes it does not mean.
    expect(readdirSync(projectsRoot)).toEqual(["skjer"]);
  });

  // The rule itself, at the level the route asks it too: the same
  // question `serve.ts` puts to `addProjectTarget` for the allowlist.
  test("a bare existingPath settles the name, and a typed Name only names a clone", () => {
    const projectsRoot = root();
    expect(addProjectTarget(projectsRoot, { name: "Skjer", existingPath: "skjer" })).toEqual({
      name: "skjer",
      existingPath: join(projectsRoot, "skjer"),
    });
    // Nothing picked: the typed Name is all there is, and it is what
    // the clone's destination directory gets called.
    expect(addProjectTarget(projectsRoot, { name: "fresh" })).toEqual({
      name: "fresh",
      existingPath: undefined,
    });
    // A full path is not the picker, so the typed Name still names it —
    // and the mismatch below is still refused, as it always was.
    expect(addProjectTarget(projectsRoot, { name: "typed", existingPath: "/elsewhere/typed" })).toEqual({
      name: "typed",
      existingPath: "/elsewhere/typed",
    });
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

  // Spec 140, criterion 2: the form accepted a path that did not exist,
  // wrote it into .aide/config, and then reported the project as not
  // ready BECAUSE it does not exist — a refusal loop over a path that
  // was known the moment it was written. Add makes it instead, with the
  // `archive/` a run walks beside it.
  test("a specs root that is not there yet is created, archive and all", async () => {
    const projectsRoot = root();
    const dir = join(projectsRoot, "makesspecs");
    mkdirSync(dir, { recursive: true });
    const specs = join(root(), "aide-specs", "makesspecs");
    const result = await addProject(fakeGit({}).run, projectsRoot, {
      name: "makesspecs",
      existingPath: dir,
      specsPath: specs,
    });
    expect(result.ok).toBe(true);
    expect(existsSync(specs)).toBe(true);
    expect(existsSync(join(specs, "archive"))).toBe(true);
    // And the readiness taken right afterwards reads it as there —
    // which is the whole point: no hand `mkdir` between Add and Run.
    const specsRoot = result.readiness!.checks.find((c) => c.check === "specsRoot")!;
    expect(specsRoot.ok).toBe(true);
    expect(specsRoot.blocking).toBe(false);
  });

  test("a specs root that already exists is left exactly as it is", async () => {
    const projectsRoot = root();
    const dir = join(projectsRoot, "hasspecs");
    mkdirSync(dir, { recursive: true });
    const specs = join(root(), "already-there");
    mkdirSync(join(specs, "07-something"), { recursive: true });
    const result = await addProject(fakeGit({}).run, projectsRoot, {
      name: "hasspecs",
      existingPath: dir,
      specsPath: specs,
    });
    expect(result.ok).toBe(true);
    expect(existsSync(join(specs, "07-something"))).toBe(true);
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
});

// Criterion 9: both fields land in the same personal file, and neither
// may take the other — or a hand-written key, or a comment — with it.
describe("writing .aide/config (spec 138)", () => {
  // Spec 184 moved the links out of this file and into the committed
  // manifest — so what this asserts now is that the value still comes
  // back in the shape the runner reads, from wherever it is kept.
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
    expect(resolveWorktreeLinks(dir).links).toBe(".venv dashboard/node_modules");
  });

  test("both fields at once, over a config that already has comments and other keys", async () => {
    const projectsRoot = root();
    const dir = join(projectsRoot, "both");
    mkdirSync(join(dir, ".aide"), { recursive: true });
    writeFileSync(
      join(dir, ".aide", "config"),
      "# personal — kept out of git\nAIDE_INSTALL_CMD=./install.sh\n",
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
    expect(resolveWorktreeLinks(dir).source).toBe("project.yaml");
    // Once each: two lines for one key is a file whose meaning depends
    // on which reader you ask.
    expect(text.match(/^AIDE_SPECS_PATH=/gm)!.length).toBe(1);
    expect(
      readFileSync(join(dir, ".aide", "project.yaml"), "utf-8").match(/^worktreeLinks:/gm)!.length,
    ).toBe(1);
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

  test("a worktree-links value naming a build output is refused before it is written", async () => {
    const projectsRoot = root();
    const dir = join(projectsRoot, "buildrefused");
    mkdirSync(join(dir, "build"), { recursive: true });
    const result = await addProject(fakeGit({}).run, projectsRoot, {
      name: "buildrefused",
      existingPath: dir,
      worktreeLinks: "build",
    });
    expect(result.ok).toBe(false);
    const step = result.steps.find((s) => s.step === "worktreeLinks")!;
    expect(step.ok).toBe(false);
    expect(step.error).toContain("build");
    expect(step.error).toContain("build output");
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

/** A checkout under a projects root of its own — the same shape the
 *  readiness tests above build, at module scope because spec 184's tests
 *  want it too. */
function checkoutFor(name: string): { projectsRoot: string; dir: string } {
  const projectsRoot = root();
  const dir = join(projectsRoot, name);
  mkdirSync(join(dir, "specs"), { recursive: true });
  return { projectsRoot, dir };
}

// --- spec 184: the settings that travel with the repo ------------------------
//
// `.aide/config` is gitignored, so everything written there is lost the
// moment the project meets a new machine — and one of the two keys it
// held is true of the PROJECT rather than of the machine. The worktree
// links live in the committed `.aide/project.yaml` now.

describe("upserting one scalar into a manifest (spec 184)", () => {
  const manifest = (text?: string): string => {
    const dir = root();
    const file = join(dir, "project.yaml");
    if (text !== undefined) writeFileSync(file, text);
    return file;
  };

  test("a key that is not there yet is appended", () => {
    const file = manifest("name: alpha\ndescription: the first one\n");
    upsertManifestScalar(file, "worktreeLinks", "node_modules");
    expect(readFileSync(file, "utf-8")).toBe(
      "name: alpha\ndescription: the first one\nworktreeLinks: node_modules\n",
    );
  });

  test("a key that IS there has its value replaced, once", () => {
    const file = manifest("name: alpha\nworktreeLinks: old\ndocs:\n  - README.md\n");
    upsertManifestScalar(file, "worktreeLinks", "new one");
    const text = readFileSync(file, "utf-8");
    expect(text).toBe("name: alpha\nworktreeLinks: new one\ndocs:\n  - README.md\n");
    expect(text.match(/^worktreeLinks:/gm)!.length).toBe(1);
  });

  test("an empty value removes the key rather than writing an empty one", () => {
    const file = manifest("name: alpha\nworktreeLinks: old\n");
    upsertManifestScalar(file, "worktreeLinks", "");
    expect(readFileSync(file, "utf-8")).toBe("name: alpha\n");
  });

  test("an empty value for a key that was never there writes nothing", () => {
    const file = manifest("name: alpha\n");
    upsertManifestScalar(file, "worktreeLinks", "");
    expect(readFileSync(file, "utf-8")).toBe("name: alpha\n");
  });

  // Criterion 7. A manifest is a file a person wrote through
  // /aide-manifest — comments, key order, multi-line blocks and all. A
  // parse-mutate-stringify round trip promises none of that back.
  test("every other line of a real manifest is byte-identical afterwards", () => {
    const before =
      "# .aide/project.yaml — the project's identity card.\n" +
      "name: alpha\n" +
      "stack:\n" +
      "  frontend: TypeScript/Vite\n" +
      "  backend: none                # e.g. Kotlin/Spring\n" +
      "deployment:\n" +
      "  host: Cloudflare Pages\n" +
      "docs:\n" +
      "  - README.md\n";
    const file = manifest(before);
    upsertManifestScalar(file, "worktreeLinks", ".venv node_modules");
    const after = readFileSync(file, "utf-8");
    expect(after.split("\n").filter((l) => !l.startsWith("worktreeLinks:")).join("\n")).toBe(
      before.split("\n").join("\n"),
    );
    expect(after).toContain("worktreeLinks: .venv node_modules");
  });

  test("a manifest that does not exist yet is created with the one key", () => {
    const file = manifest();
    upsertManifestScalar(file, "worktreeLinks", "node_modules");
    expect(readFileSync(file, "utf-8")).toBe("worktreeLinks: node_modules\n");
  });

  // A single-line replace over a list-shaped key would leave its `- `
  // children orphaned under whatever key came before — invalid YAML,
  // written silently. Refused instead of guessed at.
  test("a key that is already list-shaped is refused, and the file is left alone", () => {
    const before = "name: alpha\nworktreeLinks:\n  - node_modules\n  - .venv\n";
    const file = manifest(before);
    expect(() => upsertManifestScalar(file, "worktreeLinks", "deps")).toThrow(/worktreeLinks/);
    expect(readFileSync(file, "utf-8")).toBe(before);
  });

  // The shell reads this line with one anchored `sed` and no YAML
  // parser, so the writer has to produce the plain, unquoted form: a
  // quoted value would read back there as empty, which is
  // indistinguishable from "no links configured" — a worktree that
  // comes up without them, and nothing said about it.
  //
  // And this is the ONE writer of the key. `minimalManifest` (which
  // goes through `yaml.stringify()`) never writes it, so there is no
  // second spelling that could disagree with this one; the assertion
  // below is what keeps that true.
  const SHELL_READS = /^worktreeLinks:[ \t]*(.*)$/m;

  test("the line it writes is one the shell's own reader can read", () => {
    const value = ".venv dashboard/node_modules";
    const written = manifest();
    upsertManifestScalar(written, "worktreeLinks", value);
    expect(readFileSync(written, "utf-8").match(SHELL_READS)![1]!.trimEnd()).toBe(value);
    expect(minimalManifest("alpha", "a description")).not.toContain("worktreeLinks");
  });
});

describe("where the worktree links are read from (spec 184)", () => {
  const CASES: {
    cases: { name: string; manifest: string | null; config: string | null; links: string }[];
  } = JSON.parse(
    readFileSync(join(import.meta.dir, "../../tests/fixtures/worktree-links-precedence.json"), "utf-8"),
  );

  /** The same four combinations `aide-run-spec`'s own test iterates over,
   *  out of the same file. The two implementations are written
   *  independently — one anchored `sed` in bash, `parseManifest` plus
   *  `configValue` here — so what pins them together is this table, the
   *  way `WORKFLOW_STEPS` and `DEPENDENCY_GATED_STEPS` are pinned by a
   *  test that reads both sides. The `source` column is the shell's
   *  alone: only the run has a source to report. */
  for (const c of CASES.cases) {
    test(`${c.name}: the links resolve to "${c.links}"`, async () => {
      const { projectsRoot, dir } = checkoutFor(c.name.toLowerCase().replace(/[^a-z]/g, ""));
      for (const entry of `${c.manifest ?? ""} ${c.config ?? ""}`.split(/\s+/).filter(Boolean)) {
        mkdirSync(join(dir, entry), { recursive: true });
      }
      mkdirSync(join(dir, ".aide"), { recursive: true });
      writeFileSync(
        join(dir, ".aide", "project.yaml"),
        `name: x\n${c.manifest ? `worktreeLinks: ${c.manifest}\n` : ""}`,
      );
      if (c.config) writeFileSync(join(dir, ".aide", "config"), `AIDE_WORKTREE_LINKS=${c.config}\n`);
      expect(resolveWorktreeLinks(dir).links).toBe(c.links);
      // And the readiness check reads it the same way: a value it cannot
      // see is a project it reports as unconfigured while a run links it.
      const readiness = await assessProjectReadiness(fakeGit({}).run, dir);
      const links = readiness.checks.find((ch) => ch.check === "worktreeLinks")!;
      if (c.links) {
        expect(links.ok).toBe(true);
        expect(links.detail).toContain(c.links);
      } else {
        expect(links.ok).toBe(false);
        expect(links.blocking).toBe(false);
      }
      expect(projectsRoot).toBeTruthy();
    });
  }
});

describe("a refused link names the file it came out of (spec 184)", () => {
  // Two spellings exist now, and a refusal is read as an instruction to
  // go and edit one of them. The runner does exactly this, with the same
  // two strings — `test_aide_run_spec.py` is the other half.
  test("a manifest value is refused in the manifest's own words", async () => {
    const { projectsRoot, dir } = checkoutFor("frommanifest");
    mkdirSync(join(dir, ".aide"), { recursive: true });
    writeFileSync(join(dir, ".aide", "project.yaml"), "name: x\nworktreeLinks: ../escape\n");
    const readiness = await assessProjectReadiness(fakeGit({}).run, dir);
    const check = readiness.checks.find((c) => c.check === "worktreeLinks")!;
    expect(check.blocking).toBe(true);
    expect(check.detail).toContain("worktreeLinks must not escape the root");
    expect(check.detail).not.toContain("AIDE_WORKTREE_LINKS");
    expect(projectsRoot).toBeTruthy();
  });

  test("a legacy config value is refused in the config's own words", async () => {
    const { dir } = checkoutFor("fromconfig");
    mkdirSync(join(dir, ".aide"), { recursive: true });
    writeFileSync(join(dir, ".aide", "config"), "AIDE_WORKTREE_LINKS=/etc\n");
    const readiness = await assessProjectReadiness(fakeGit({}).run, dir);
    const check = readiness.checks.find((c) => c.check === "worktreeLinks")!;
    expect(check.blocking).toBe(true);
    expect(check.detail).toContain("AIDE_WORKTREE_LINKS must name repo-relative paths");
  });
});

describe("adding a project writes its links to the committed file (spec 184)", () => {
  test("worktree links go into .aide/project.yaml, not .aide/config", async () => {
    const projectsRoot = root();
    const dir = join(projectsRoot, "travels");
    mkdirSync(dir, { recursive: true });
    const result = await addProject(fakeGit({}).run, projectsRoot, {
      name: "travels",
      existingPath: dir,
      worktreeLinks: ".venv dashboard/node_modules",
    });
    expect(result.ok).toBe(true);
    const parsed = parseManifest(readFileSync(join(dir, ".aide", "project.yaml"), "utf-8"));
    expect(parsed.ok && parsed.data.worktreeLinks).toBe(".venv dashboard/node_modules");
    expect(configValue(dir, "AIDE_WORKTREE_LINKS")).toBeNull();
  });

  // A checkout that already came with a full manifest keeps it: the key
  // is upserted into the file that is there, never written over it.
  test("an existing manifest keeps every key it had", async () => {
    const projectsRoot = root();
    const dir = join(projectsRoot, "hasmanifest");
    mkdirSync(join(dir, ".aide"), { recursive: true });
    writeFileSync(
      join(dir, ".aide", "project.yaml"),
      "name: hasmanifest\ndescription: written by /aide-manifest\nstack:\n  backend: none\n",
    );
    const result = await addProject(fakeGit({}).run, projectsRoot, {
      name: "hasmanifest",
      existingPath: dir,
      worktreeLinks: "node_modules",
    });
    expect(result.ok).toBe(true);
    const text = readFileSync(join(dir, ".aide", "project.yaml"), "utf-8");
    expect(text).toContain("description: written by /aide-manifest");
    expect(text).toContain("  backend: none");
    expect(text).toContain("worktreeLinks: node_modules");
  });

  test("the specs path still goes to .aide/config, and the manifest is left alone", async () => {
    const projectsRoot = root();
    const dir = join(projectsRoot, "specsonly");
    mkdirSync(dir, { recursive: true });
    const result = await addProject(fakeGit({}).run, projectsRoot, {
      name: "specsonly",
      existingPath: dir,
      specsPath: join(root(), "aide-specs", "specsonly"),
    });
    expect(result.ok).toBe(true);
    expect(configValue(dir, "AIDE_SPECS_PATH")).toBeTruthy();
    expect(readFileSync(join(dir, ".aide", "project.yaml"), "utf-8")).not.toContain("worktreeLinks");
  });

  test("an unusable links value is still refused before anything is written", async () => {
    const projectsRoot = root();
    const dir = join(projectsRoot, "stillrefused");
    mkdirSync(dir, { recursive: true });
    const result = await addProject(fakeGit({}).run, projectsRoot, {
      name: "stillrefused",
      existingPath: dir,
      worktreeLinks: "/etc",
    });
    expect(result.ok).toBe(false);
    // The manifest itself IS written — registering the project is what
    // makes it — but nothing about the links reached it, and the config
    // was never opened.
    expect(readFileSync(join(dir, ".aide", "project.yaml"), "utf-8")).not.toContain("worktreeLinks");
    expect(existsSync(join(dir, ".aide", "config"))).toBe(false);
  });
});

describe("changing a project's settings after it was added (spec 184)", () => {
  /** A project already on the dashboard: a checkout, a manifest, and
   *  whichever of the two settings it was added with. */
  function added(name: string, opts: { specsPath?: string; worktreeLinks?: string } = {}) {
    const { projectsRoot, dir } = checkoutFor(name);
    mkdirSync(join(dir, ".aide"), { recursive: true });
    writeFileSync(
      join(dir, ".aide", "project.yaml"),
      `name: ${name}\ndescription: added earlier\n` +
        (opts.worktreeLinks ? `worktreeLinks: ${opts.worktreeLinks}\n` : ""),
    );
    if (opts.specsPath) writeFileSync(join(dir, ".aide", "config"), `AIDE_SPECS_PATH=${opts.specsPath}\n`);
    return { projectsRoot, dir };
  }

  // Criterion 4: a project added with the field left blank could only be
  // fixed by removing and re-adding it, or by opening a terminal.
  test("worktree links can be filled in afterwards, and land in the manifest", async () => {
    const { dir } = added("later");
    mkdirSync(join(dir, "node_modules"), { recursive: true });
    const before = readFileSync(join(dir, ".aide", "project.yaml"), "utf-8");
    const result = await updateProjectSettings(fakeGit({}).run, dir, {
      worktreeLinks: "node_modules",
      specsPath: "",
    });
    expect(result.ok).toBe(true);
    expect(resolveWorktreeLinks(dir)).toEqual({ links: "node_modules", source: "project.yaml" });
    expect(readFileSync(join(dir, ".aide", "project.yaml"), "utf-8")).toBe(
      `${before}worktreeLinks: node_modules\n`,
    );
    // `.aide/config` is not the place for this key any more, and a save
    // that wrote it there would put the two files at odds.
    expect(configValue(dir, "AIDE_WORKTREE_LINKS")).toBeNull();
    const links = result.readiness!.checks.find((c) => c.check === "worktreeLinks")!;
    expect(links.ok).toBe(true);
    expect(links.blocking).toBe(false);
  });

  // Criterion 8: the other half of the same form, and it goes to the
  // other file — the specs path names a directory on THIS machine.
  test("the specs path can be changed afterwards, and the manifest is untouched", async () => {
    const { dir } = added("respec", { specsPath: "/old/specs" });
    const manifestBefore = readFileSync(join(dir, ".aide", "project.yaml"), "utf-8");
    const specs = join(root(), "aide-specs", "respec");
    const result = await updateProjectSettings(fakeGit({}).run, dir, {
      specsPath: specs,
      worktreeLinks: "",
    });
    expect(result.ok).toBe(true);
    expect(configValue(dir, "AIDE_SPECS_PATH")).toBe(specs);
    expect(readFileSync(join(dir, ".aide", "project.yaml"), "utf-8")).toBe(manifestBefore);
    // Made, with the archive/ a run walks — the same thing Add does, for
    // the same reason: a path configured and not there is a refusal over
    // something known at the moment it was written.
    expect(existsSync(join(specs, "archive"))).toBe(true);
    const specsRoot = result.readiness!.checks.find((c) => c.check === "specsRoot")!;
    expect(specsRoot.subject).toBe(specs);
    expect(specsRoot.ok).toBe(true);
  });

  test("a field submitted unchanged rewrites nothing", async () => {
    const { dir } = added("same", { specsPath: "/old/specs", worktreeLinks: "node_modules" });
    mkdirSync(join(dir, "node_modules"), { recursive: true });
    const manifestBefore = readFileSync(join(dir, ".aide", "project.yaml"), "utf-8");
    const configBefore = readFileSync(join(dir, ".aide", "config"), "utf-8");
    const result = await updateProjectSettings(fakeGit({}).run, dir, {
      specsPath: "/old/specs",
      worktreeLinks: "node_modules",
    });
    expect(result.ok).toBe(true);
    expect(result.steps.map((s) => s.step)).not.toContain("specsConfig");
    expect(result.steps.map((s) => s.step)).not.toContain("worktreeLinks");
    expect(readFileSync(join(dir, ".aide", "project.yaml"), "utf-8")).toBe(manifestBefore);
    expect(readFileSync(join(dir, ".aide", "config"), "utf-8")).toBe(configBefore);
  });

  test("clearing the worktree links takes the key out rather than writing an empty one", async () => {
    const { dir } = added("cleared", { worktreeLinks: "node_modules" });
    const result = await updateProjectSettings(fakeGit({}).run, dir, { worktreeLinks: "", specsPath: "" });
    expect(result.ok).toBe(true);
    expect(readFileSync(join(dir, ".aide", "project.yaml"), "utf-8")).not.toContain("worktreeLinks");
    expect(resolveWorktreeLinks(dir).source).toBeNull();
  });

  // The same rule the Add form is refused by, in the same words — asked
  // of the same function, so the two can never come apart.
  test("an unusable links value is refused before either file is opened", async () => {
    const { dir } = added("badsave", { worktreeLinks: "node_modules" });
    const before = readFileSync(join(dir, ".aide", "project.yaml"), "utf-8");
    const result = await updateProjectSettings(fakeGit({}).run, dir, {
      worktreeLinks: "../escape",
      specsPath: "/wanted",
    });
    expect(result.ok).toBe(false);
    expect(result.steps.find((s) => s.step === "worktreeLinks")!.error).toContain("../escape");
    expect(readFileSync(join(dir, ".aide", "project.yaml"), "utf-8")).toBe(before);
    expect(existsSync(join(dir, ".aide", "config"))).toBe(false);
  });

  // A project migrated the old way is brought across by a save: the
  // manifest has nothing, the config does, and what the page showed is
  // what gets written where it now belongs.
  test("a legacy links value saved from the form moves into the manifest", async () => {
    const { dir } = added("legacy");
    mkdirSync(join(dir, "deps"), { recursive: true });
    writeFileSync(join(dir, ".aide", "config"), "AIDE_WORKTREE_LINKS=deps\n");
    expect(resolveWorktreeLinks(dir).source).toBe(".aide/config");
    const result = await updateProjectSettings(fakeGit({}).run, dir, { worktreeLinks: "deps", specsPath: "" });
    expect(result.ok).toBe(true);
    expect(resolveWorktreeLinks(dir).source).toBe("project.yaml");
  });
});

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
    readFileSync(join(import.meta.dir, "../../tests/fixtures/code-landing-precedence.json"), "utf-8"),
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
