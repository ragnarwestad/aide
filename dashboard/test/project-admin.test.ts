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
import { addProject, projectNameError, removeProject } from "../src/project-admin.ts";
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
    // every other git call in the codebase.
    expect(git.calls).toEqual([
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
    expect(git.calls).toEqual([]);
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
