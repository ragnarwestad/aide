import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addProject,
  assessProjectReadiness,
  minimalManifest,
  updateProjectSettings,
  upsertManifestScalar,
} from "../../../src/project/project-admin.ts";
import { parseManifest } from "../../../src/project/parse-manifest.ts";
import { configValue, resolveWorktreeLinks } from "../../../src/project/discover.ts";
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
    readFileSync(join(import.meta.dir, "..", "..", "../../tests/fixtures/worktree-links-precedence.json"), "utf-8"),
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

// Spec 255: two more `.aide/config` keys join `specsPath` on the same
// route, gated on presence in `req` the way `codeLanding` already is —
// a caller that never mentions one of these must not blank it.
describe("saving AIDE_INSTALL_CMD and AIDE_JIRA_BASE_URL (spec 255)", () => {
  /** A project already added, with a manifest but no `.aide/config` yet
   *  — the state `checkoutFor` alone leaves a project in. */
  function withManifest(name: string): string {
    const { dir } = checkoutFor(name);
    mkdirSync(join(dir, ".aide"), { recursive: true });
    writeFileSync(join(dir, ".aide", "project.yaml"), `name: ${name}\n`);
    return dir;
  }

  test("a changed installCmd is written to .aide/config", async () => {
    const dir = withManifest("installsave");
    const result = await updateProjectSettings(fakeGit({}).run, dir, {
      specsPath: "",
      worktreeLinks: "",
      installCmd: "make install",
    });
    expect(result.ok).toBe(true);
    expect(configValue(dir, "AIDE_INSTALL_CMD")).toBe("make install");
    expect(result.steps.map((s) => s.step)).toContain("installCmd");
  });

  test("a changed jiraBaseUrl is written to .aide/config", async () => {
    const dir = withManifest("jirasave");
    const result = await updateProjectSettings(fakeGit({}).run, dir, {
      specsPath: "",
      worktreeLinks: "",
      jiraBaseUrl: "https://jira.example.com",
    });
    expect(result.ok).toBe(true);
    expect(configValue(dir, "AIDE_JIRA_BASE_URL")).toBe("https://jira.example.com");
  });

  test("an unchanged installCmd rewrites nothing", async () => {
    const dir = withManifest("installsame");
    writeFileSync(join(dir, ".aide", "config"), "AIDE_INSTALL_CMD=make install\n");
    const before = readFileSync(join(dir, ".aide", "config"), "utf-8");
    const result = await updateProjectSettings(fakeGit({}).run, dir, {
      specsPath: "",
      worktreeLinks: "",
      installCmd: "make install",
    });
    expect(result.ok).toBe(true);
    expect(result.steps.map((s) => s.step)).not.toContain("installCmd");
    expect(readFileSync(join(dir, ".aide", "config"), "utf-8")).toBe(before);
  });

  // The presence-check pattern `codeLanding` already uses: a caller that
  // never mentions `jiraBaseUrl` at all must not be read as clearing it.
  test("neither field is touched when the request never mentions them", async () => {
    const dir = withManifest("neithermentioned");
    writeFileSync(join(dir, ".aide", "config"), "AIDE_INSTALL_CMD=make install\nAIDE_JIRA_BASE_URL=https://jira.example.com\n");
    const before = readFileSync(join(dir, ".aide", "config"), "utf-8");
    const result = await updateProjectSettings(fakeGit({}).run, dir, { specsPath: "", worktreeLinks: "" });
    expect(result.ok).toBe(true);
    expect(readFileSync(join(dir, ".aide", "config"), "utf-8")).toBe(before);
  });
});
