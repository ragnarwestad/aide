import { dashboardSettingsFile } from "../../../src/git/dashboard-checkout.ts";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addProject,
  projectNameError,
  removeProject,
} from "../../../src/project/project-admin";
import { parseManifest } from "../../../src/project/parse-manifest.ts";
import { configValue } from "../../../src/project/discover";
import { cloningGit, fakeGit } from "../../helpers/fake-git.ts";

const dirs: string[] = [];
const root = (): string => {
  const d = mkdtempSync(join(tmpdir(), "aide-project-admin-"));
  dirs.push(d);
  return d;
};

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

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
  test("clones into <root>/<name>, keeps a minimal manifest in the dashboard's settings file, reports every step", async () => {
    const projectsRoot = root();
    const base = root();
    const git = cloningGit();
    const result = await addProject(git.run, projectsRoot, {
      name: "newproj",
      gitUrl: "https://example.com/newproj.git",
      description: "What it is for",
    }, base);
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
    // Spec 512: nothing of Aide's is written into the clone.
    expect(existsSync(join(projectsRoot, "newproj", ".aide", "project.yaml"))).toBe(false);
    const manifest = dashboardSettingsFile(base, "newproj");
    expect(existsSync(manifest)).toBe(true);
    const parsed = parseManifest(readFileSync(manifest, "utf-8"));
    expect(parsed).toEqual({ ok: true, data: { name: "newproj", description: "What it is for" } });
  });

  // Criterion 2.
  test("a name already taken under the projects root is refused before the clone", async () => {
    const projectsRoot = root();
    mkdirSync(join(projectsRoot, "taken"));
    const git = cloningGit();
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

describe("adding a project on a host whose projects root holds links", () => {
  // The projects root beside the dashboard's own checkouts is a
  // directory of links: the clone goes into the checkout, and the
  // project is listed through a link to it — never a second copy.
  const layout = () => {
    const home = root();
    const base = join(home, "checkouts");
    const projectsRoot = join(home, "projects");
    mkdirSync(projectsRoot);
    return { base, projectsRoot };
  };

  test("clones into the dashboard's own checkout and links the projects root to it", async () => {
    const { base, projectsRoot } = layout();
    const git = cloningGit();
    const result = await addProject(git.run, projectsRoot, {
      name: "newproj",
      gitUrl: "https://example.com/newproj.git",
    }, base);
    expect(result.ok).toBe(true);
    expect(git.calls.filter((c) => c.args.includes("clone"))).toEqual([
      {
        dir: join(base, "newproj"),
        args: ["-c", "credential.helper=", "clone", "https://example.com/newproj.git", "code"],
      },
    ]);
    const link = join(projectsRoot, "newproj");
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readlinkSync(link)).toBe(join(base, "newproj", "code"));
    expect(existsSync(join(base, "newproj", "code", ".aide", "project.yaml"))).toBe(false);
    expect(existsSync(dashboardSettingsFile(base, "newproj"))).toBe(true);
  });

  test("a checkout the dashboard already has is linked, not cloned again", async () => {
    const { base, projectsRoot } = layout();
    mkdirSync(join(base, "aide", "code", ".git"), { recursive: true });
    const git = cloningGit();
    const result = await addProject(git.run, projectsRoot, {
      name: "aide",
      gitUrl: "https://example.com/aide.git",
    }, base);
    expect(result.ok).toBe(true);
    expect(git.calls.filter((c) => c.args.includes("clone"))).toEqual([]);
    expect(readlinkSync(join(projectsRoot, "aide"))).toBe(join(base, "aide", "code"));
  });

  test("any other projects root keeps the clone itself", async () => {
    const { base } = layout();
    const projectsRoot = root();
    const git = cloningGit();
    const result = await addProject(git.run, projectsRoot, {
      name: "newproj",
      gitUrl: "https://example.com/newproj.git",
    }, base);
    expect(result.ok).toBe(true);
    expect(lstatSync(join(projectsRoot, "newproj")).isDirectory()).toBe(true);
    expect(existsSync(join(base, "newproj", "code"))).toBe(false);
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
    const git = cloningGit();
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
    const base = root();
    const git = cloningGit();
    const result = await addProject(git.run, projectsRoot, {
      name: "bykey",
      gitUrl: "git@example.com:owner/bykey.git",
    }, base);
    expect(result.ok).toBe(true);
    expect(result.steps.map((s) => s.step)).toEqual(["name", "clone", "manifest"]);
    expect(existsSync(dashboardSettingsFile(base, "bykey"))).toBe(true);
  });
});

describe("adding a checkout that is already on the host", () => {
  // Criterion 5.
  test("an existing manifest is kept, not overwritten", async () => {
    const projectsRoot = root();
    const dir = join(projectsRoot, "already");
    const manifest = join(dir, ".aide", "project.yaml");
    const git = cloningGit({}, {
      ".aide/project.yaml": "name: already\ndescription: written by /aide-manifest\nstack:\n  api: Go\n",
    });
    const result = await addProject(git.run, projectsRoot, {
      name: "already",
      gitUrl: "git@example.com:me/already.git",
      description: "ignored, because there is a manifest already",
    });
    expect(result.ok).toBe(true);
    // The manifest the clone brought is the one that stays.
    expect(git.calls.filter((c) => c.args.includes("clone")).length).toBe(1);
    expect(readFileSync(manifest, "utf-8")).toContain("api: Go");
    expect(readFileSync(manifest, "utf-8")).not.toContain("ignored");
  });

  // Criterion 6: the same registration, with no manifest there. It
  // succeeds — and SAYS a manifest had to be made, because the operator
  // has a `/aide-manifest` run to do afterwards.
  test("a checkout with no manifest gets a minimal one in the dashboard's settings file, and the answer says so", async () => {
    const projectsRoot = root();
    const base = root();
    const dir = join(projectsRoot, "bare");
    const result = await addProject(cloningGit().run, projectsRoot, {
      name: "bare",
      gitUrl: "git@example.com:me/bare.git",
      description: "A checkout that predates its manifest",
    }, base);
    expect(result.ok).toBe(true);
    const manifest = result.steps.find((s) => s.step === "manifest")!;
    expect(manifest.ok).toBe(true);
    expect(manifest.note).toMatch(/aide-manifest/);
    expect(existsSync(join(dir, ".aide", "project.yaml"))).toBe(false);
    expect(parseManifest(readFileSync(dashboardSettingsFile(base, "bare"), "utf-8"))).toEqual({
      ok: true,
      data: { name: "bare", description: "A checkout that predates its manifest" },
    });
  });






  // 2026-09-21: a git address is the only way in. A project used to be
  // addable by naming a directory already on the host, which left the
  // dashboard with two layouts — for a cloned project the entry under
  // the projects root IS its own checkout, for a registered one it was
  // the person's — and a delete in `ensureDashboardCheckout` that was
  // right about one of them removed woodstack.
  test("a name with no git address is refused, because there is nothing to clone", async () => {
    const result = await addProject(fakeGit({}).run, root(), { name: "urlless" });
    expect(result.ok).toBe(false);
    const step = result.steps[0]!;
    expect(step.step).toBe("name");
    expect(step.error).toContain("git address");
  });

  test("nothing picked and nothing typed is still refused for saying neither", async () => {
    const result = await addProject(fakeGit({}).run, root(), { name: "", gitUrl: "" });
    expect(result.ok).toBe(false);
    expect(result.steps[0]!.step).toBe("name");
  });
});

describe("where the project's specs live", () => {
  test("a specs path is written in the format .aide/config is read in", async () => {
    const projectsRoot = root();
    const git = cloningGit();
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
    const result = await addProject(
      cloningGit({}, { ".aide/config": "# personal\nAIDE_INSTALL_CMD=./install.sh\nAIDE_SPECS_PATH=/old/place\n" }).run,
      projectsRoot,
      {
      name: "hasconfig",
      gitUrl: "git@example.com:me/hasconfig.git",
      specsPath: "/new/place",
      },
    );
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
    const specs = join(root(), "aide-specs", "makesspecs");
    const result = await addProject(cloningGit().run, projectsRoot, {
      name: "makesspecs",
      gitUrl: "git@example.com:me/makesspecs.git",
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
    const specs = join(root(), "already-there");
    mkdirSync(join(specs, "07-something"), { recursive: true });
    const result = await addProject(cloningGit().run, projectsRoot, {
      name: "hasspecs",
      gitUrl: "git@example.com:me/hasspecs.git",
      specsPath: specs,
    });
    expect(result.ok).toBe(true);
    expect(existsSync(join(specs, "07-something"))).toBe(true);
  });

  test("no specs path means no config is written at all", async () => {
    const projectsRoot = root();
    const dir = join(projectsRoot, "nospecs");
    const result = await addProject(cloningGit().run, projectsRoot, {
      name: "nospecs",
      gitUrl: "git@example.com:me/nospecs.git",
    });
    expect(result.ok).toBe(true);
    expect(result.steps.some((s) => s.step === "specsConfig")).toBe(false);
    expect(existsSync(join(dir, ".aide", "config"))).toBe(false);
  });
});

describe("removing a project touches the allowlist and nothing else", () => {
  // Criteria 7-8, at the level below HTTP: the mechanic itself. The
  // name had to be typed back here until 2026-09-08 — the page asks the
  // question in a sentence now, and the press is the answer.
  test("the press takes it off the allowlist, and touches nothing else", () => {
    const allowed = new Set(["aide", "atlasaurus"]);
    const result = removeProject(allowed, { name: "atlasaurus" });
    expect(result.ok).toBe(true);
    expect(result.steps.map((s) => s.step)).toEqual(["confirm", "allowlist"]);
    expect([...allowed]).toEqual(["aide"]);
  });

  test("a project that is not on the allowlist is refused", () => {
    const allowed = new Set(["aide"]);
    const result = removeProject(allowed, { name: "never-added" });
    expect(result.ok).toBe(false);
    expect(result.steps.find((s) => s.step === "allowlist")!.error).toContain("never-added");
    expect([...allowed]).toEqual(["aide"]);
  });
});
