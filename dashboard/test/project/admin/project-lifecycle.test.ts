import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addProject,
  addProjectTarget,
  projectNameError,
  removeProject,
} from "../../../src/project/project-admin.ts";
import { parseManifest } from "../../../src/project/parse-manifest.ts";
import { configValue } from "../../../src/project/discover.ts";
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
