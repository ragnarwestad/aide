import { dashboardSettingsFile } from "../../../src/git/dashboard-checkout.ts";
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
} from "../../../src/project/project-admin";
import { manifestWithScalar, oneLine } from "../../../src/project/project-admin/manifest-io.ts";
import { parseManifest } from "../../../src/project/parse-manifest.ts";
import { configValue, resolveWorktreeLinks } from "../../../src/project/discover";
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

  // Criterion 7. A manifest is a file a person wrote
  // by hand — comments, key order, multi-line blocks and all. A
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

describe("writing one key inside a block of the manifest", () => {
  const KEY = "deployment.previewFrom";
  const write = (text: string, value = "cloudflare-pages"): string => manifestWithScalar(text, KEY, value, "project.yaml");
  const read = (text: string) => {
    const parsed = parseManifest(text);
    return parsed.ok ? parsed.data.deployment?.previewFrom : undefined;
  };
  const LONG = "  command: " + "bun run build && ".repeat(12) + "bun run preview";

  test("an existing line is replaced and every other byte stays (AC-3, AC-5)", () => {
    const before = [
      "name: demo",
      "deployment:",
      "  host: Cloudflare Pages",
      LONG,
      "  # How a branch is tried.",
      "  previewFrom: command",
      "logging:",
      "  where: Cloudflare dashboard",
      "",
    ].join("\n");
    const after = write(before);
    expect(after).toBe(before.replace("previewFrom: command", "previewFrom: cloudflare-pages"));
    expect(read(after)).toBe("cloudflare-pages");
  });

  test("a block without the key gets the line at the block's own indentation (AC-3, AC-4)", () => {
    const before = "name: demo\ndeployment:\n    host: Cloudflare Pages\n    # a note\n\nlogging:\n  where: x\n";
    const after = write(before, "command");
    expect(after).toBe(
      "name: demo\ndeployment:\n    host: Cloudflare Pages\n    # a note\n    previewFrom: command\n\nlogging:\n  where: x\n",
    );
    expect(read(after)).toBe("command");
  });

  test("a bare header gets the line right after it (AC-3)", () => {
    const after = write("name: demo\ndeployment:\nlogging:\n  where: x\n", "command");
    expect(after).toBe("name: demo\ndeployment:\n  previewFrom: command\nlogging:\n  where: x\n");
    expect(read(after)).toBe("command");
  });

  test("a comment at column 0 inside the block does not end it, and no second key appears (AC-3, AC-5)", () => {
    const before = "deployment:\n  host: x\n# written by hand\n  previewFrom: command\n";
    const after = write(before);
    expect(after).toBe("deployment:\n  host: x\n# written by hand\n  previewFrom: cloudflare-pages\n");
    expect(after.match(/previewFrom/g)).toHaveLength(1);
    expect(read(after)).toBe("cloudflare-pages");
  });

  test("a column-0 comment after the block's last key stays where it was (AC-3)", () => {
    const after = write("deployment:\n  host: x\n# next part\nlogging:\n  where: y\n", "command");
    expect(after).toBe("deployment:\n  host: x\n  previewFrom: command\n# next part\nlogging:\n  where: y\n");
  });

  test("no block at all appends one at the end (AC-3, AC-4)", () => {
    const after = write("name: demo\ndescription: the demo app\n", "command");
    expect(after).toBe("name: demo\ndescription: the demo app\ndeployment:\n  previewFrom: command\n");
    expect(read(after)).toBe("command");
  });

  test("an empty value removes the line, and has nothing to do without a block (AC-3)", () => {
    expect(write("deployment:\n  host: x\n  previewFrom: command\n", "")).toBe("deployment:\n  host: x\n");
    expect(write("name: demo\n", "")).toBe("name: demo\n");
  });

  test("a block that is not a block of keys is refused and the text is unchanged (AC-3, AC-4)", () => {
    for (const before of [
      "name: demo\ndeployment: {}\n",
      "name: demo\ndeployment: Cloudflare Pages\n",
      "name: demo\ndeployment:\n  - Cloudflare Pages\n",
      "name: demo\ndeployment:\n- Cloudflare Pages\n",
    ]) {
      expect(() => write(before)).toThrow(/deployment in project\.yaml is not a block of keys/);
    }
  });

  test("a previewFrom that continues over several lines is refused (AC-3, AC-4)", () => {
    for (const before of [
      "deployment:\n  previewFrom:\n    - command\n",
      "deployment:\n  previewFrom: command\n    and more\n",
      "deployment:\n  previewFrom:\n    nested: key\n",
    ]) {
      expect(() => write(before)).toThrow(/previewFrom/);
    }
  });
});

describe("where the worktree links are read from (spec 184)", () => {
  const CASES: {
    cases: { name: string; manifest: string | null; links: string }[];
  } = JSON.parse(
    readFileSync(join(import.meta.dir, "..", "..", "../../core/tests/fixtures/worktree-links-precedence.json"), "utf-8"),
  );

  /** The same combinations `aide-run-spec`'s own test iterates over,
   *  out of the same file. The two implementations are written
   *  independently — one anchored `sed` in bash, `parseManifest` here —
   *  so what pins them together is this table, the
   *  way `WORKFLOW_STEPS` and `DEPENDENCY_GATED_STEPS` are pinned by a
   *  test that reads both sides. The `source` column is the shell's
   *  alone: only the run has a source to report. */
  for (const c of CASES.cases) {
    test(`${c.name}: the links resolve to "${c.links}"`, async () => {
      const { projectsRoot, dir } = checkoutFor(c.name.toLowerCase().replace(/[^a-z]/g, ""));
      for (const entry of (c.manifest ?? "").split(/\s+/).filter(Boolean)) {
        mkdirSync(join(dir, entry), { recursive: true });
      }
      mkdirSync(join(dir, ".aide"), { recursive: true });
      writeFileSync(
        join(dir, ".aide", "project.yaml"),
        `name: x\n${c.manifest ? `worktreeLinks: ${c.manifest}\n` : ""}`,
      );
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
  // The manifest's `worktreeLinks` is the one spelling to refuse over;
  // `test_aide_run_spec.py` is the bash half of the same rule.
  test("a manifest value is refused in the manifest's own words", async () => {
    const { projectsRoot, dir } = checkoutFor("frommanifest");
    mkdirSync(join(dir, ".aide"), { recursive: true });
    writeFileSync(join(dir, ".aide", "project.yaml"), "name: x\nworktreeLinks: ../escape\n");
    const readiness = await assessProjectReadiness(fakeGit({}).run, dir);
    const check = readiness.checks.find((c) => c.check === "worktreeLinks")!;
    expect(check.blocking).toBe(true);
    expect(check.detail).toContain("worktreeLinks must not escape the root");
    expect(projectsRoot).toBeTruthy();
  });
});

describe("adding a project keeps its links in the dashboard's settings file (spec 184, 512)", () => {
  const settingsOf = (base: string, name: string) => readFileSync(dashboardSettingsFile(base, name), "utf-8");

  test("worktree links go into the settings file, not .aide/config and not the checkout", async () => {
    const projectsRoot = root();
    const base = root();
    const dir = join(projectsRoot, "travels");
    const result = await addProject(cloningGit().run, projectsRoot, {
      name: "travels",
      gitUrl: "git@example.com:me/travels.git",
      codeLanding: "merge",
      worktreeLinks: ".venv dashboard/node_modules",
    }, base);
    expect(result.ok).toBe(true);
    const parsed = parseManifest(settingsOf(base, "travels"));
    expect(parsed.ok && parsed.data.worktreeLinks).toBe(".venv dashboard/node_modules");
    expect(existsSync(join(dir, ".aide", "project.yaml"))).toBe(false);
  });

  // A checkout that already came with a full, untracked manifest keeps
  // it untouched; the settings file starts from it, so nothing it said
  // is lost.
  test("an existing untracked manifest seeds the settings file and stays as it was", async () => {
    const projectsRoot = root();
    const base = root();
    const dir = join(projectsRoot, "hasmanifest");
    const drafted = "name: hasmanifest\ndescription: written by hand\nstack:\n  backend: none\n";
    const result = await addProject(cloningGit({}, { ".aide/project.yaml": drafted }).run, projectsRoot, {
      name: "hasmanifest",
      gitUrl: "git@example.com:me/hasmanifest.git",
      codeLanding: "merge",
      worktreeLinks: "node_modules",
    }, base);
    expect(result.ok).toBe(true);
    const text = settingsOf(base, "hasmanifest");
    expect(text).toContain("description: written by hand");
    expect(text).toContain("  backend: none");
    expect(text).toContain("worktreeLinks: node_modules");
    expect(readFileSync(join(dir, ".aide", "project.yaml"), "utf-8")).toBe(drafted);
  });

  test("the specs path still goes to .aide/config, and the settings file has no links", async () => {
    const projectsRoot = root();
    const base = root();
    const dir = join(projectsRoot, "specsonly");
    const result = await addProject(cloningGit().run, projectsRoot, {
      name: "specsonly",
      gitUrl: "git@example.com:me/specsonly.git",
      codeLanding: "merge",
      specsPath: join(root(), "aide-specs", "specsonly"),
    }, base);
    expect(result.ok).toBe(true);
    expect(configValue(dir, "AIDE_SPECS_PATH")).toBeTruthy();
    expect(settingsOf(base, "specsonly")).not.toContain("worktreeLinks");
  });

  test("an unusable links value is still refused before anything is written", async () => {
    const projectsRoot = root();
    const base = root();
    const dir = join(projectsRoot, "stillrefused");
    const result = await addProject(cloningGit().run, projectsRoot, {
      name: "stillrefused",
      gitUrl: "git@example.com:me/stillrefused.git",
      codeLanding: "merge",
      worktreeLinks: "/etc",
    }, base);
    expect(result.ok).toBe(false);
    // The settings file IS written — registering the project is what
    // makes it — but nothing about the links reached it, and the config
    // was never opened.
    expect(settingsOf(base, "stillrefused")).not.toContain("worktreeLinks");
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
    const links = result.readiness!.checks.find((c) => c.check === "worktreeLinks")!;
    expect(links.ok).toBe(true);
    expect(links.blocking).toBe(false);
  });

  // A save that read the fields it never sent as empty cleared the
  // specs path and the links along with it.
  test("a test command saved alone lands in the manifest as AIDE_TEST_CMD and touches nothing else", async () => {
    const { dir } = added("testcmd", { specsPath: "/kept/specs" });
    mkdirSync(join(dir, "node_modules"), { recursive: true });
    await updateProjectSettings(fakeGit({}).run, dir, { worktreeLinks: "node_modules" });
    const result = await updateProjectSettings(fakeGit({}).run, dir, { testCmd: "pnpm test" });
    expect(result.ok).toBe(true);
    expect(readFileSync(join(dir, ".aide", "project.yaml"), "utf-8")).toContain("AIDE_TEST_CMD: pnpm test\n");
    expect(configValue(dir, "AIDE_TEST_CMD")).toBeNull();
    expect(configValue(dir, "AIDE_SPECS_PATH")).toBe("/kept/specs");
    expect(resolveWorktreeLinks(dir).links).toBe("node_modules");
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

  test("an install command read from the manifest is saved to .aide/config instead", async () => {
    const { dir } = added("from-manifest");
    const file = join(dir, ".aide", "project.yaml");
    writeFileSync(file, `${readFileSync(file, "utf-8")}installCmd: ./old.sh\n`);
    const before = readFileSync(file, "utf-8");
    const result = await updateProjectSettings(fakeGit({}).run, dir, { installCmd: "./new.sh" });
    expect(result.ok).toBe(true);
    expect(configValue(dir, "AIDE_INSTALL_CMD")).toBe("./new.sh");
    expect(readFileSync(file, "utf-8")).toBe(before);
  });
});

// Spec 255: two more `.aide/config` keys join `specsPath` on the same
// route, gated on presence in `req` the way `codeLanding` already is —
// a caller that never mentions one of these must not blank it.
describe("saving AIDE_INSTALL_CMD (spec 255)", () => {
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
  // never mentions `installCmd` at all must not be read as clearing it.
  test("the field is not touched when the request never mentions it", async () => {
    const dir = withManifest("neithermentioned");
    writeFileSync(join(dir, ".aide", "config"), "AIDE_INSTALL_CMD=make install\n");
    const before = readFileSync(join(dir, ".aide", "config"), "utf-8");
    const result = await updateProjectSettings(fakeGit({}).run, dir, { specsPath: "", worktreeLinks: "" });
    expect(result.ok).toBe(true);
    expect(readFileSync(join(dir, ".aide", "config"), "utf-8")).toBe(before);
  });
});

// A description is the one manifest key only the YAML parser reads, so it is
// written whole: on one line, quoted where a plain line would not read back,
// and in place of every line a folded or block form took.
describe("saving a description over every form it can be stored in (AC-2)", () => {
  const typed = "Aide: the board for specs # not a comment, and long enough to pass the eighty character mark";
  const forms: { form: string; description: string[]; tail: string[] }[] = [
    { form: "folded over two lines", description: ["description: a board for", "  specs and jobs"], tail: ["", "# note", "AIDE_TEST_CMD: make test"] },
    { form: "folded so its second line starts with a dash", description: ["description: a board", "  - for specs"], tail: ["", "# note", "AIDE_TEST_CMD: make test"] },
    { form: "a block", description: ["description: |-", "  a board", "  for specs"], tail: ["", "# note", "AIDE_TEST_CMD: make test"] },
    { form: "absent", description: [], tail: ["AIDE_TEST_CMD: make test"] },
  ];
  const run = async () => ({ code: 1, stdout: "" });
  const setup = (description: string[], tail: string[]): { dir: string; file: string; text: string } => {
    const dir = root();
    mkdirSync(join(dir, ".aide"), { recursive: true });
    const file = join(dir, ".aide", "project.yaml");
    const text = `${["name: p", ...description, ...tail].join("\n")}\n`;
    writeFileSync(file, text);
    return { dir, file, text };
  };
  const parsed = (file: string) => {
    const result = parseManifest(readFileSync(file, "utf-8"));
    if (!result.ok) throw new Error(`the manifest no longer parses: ${result.error}`);
    return result.data;
  };

  for (const { form, description, tail } of forms) {
    test(`a description of over 80 characters reads back as typed over a description ${form} (AC-2)`, async () => {
      const { dir, file } = setup(description, tail);
      const result = await updateProjectSettings(run, dir, { description: typed });
      expect(result.steps.find((s) => s.step === "description")).toEqual({ step: "description", ok: true });
      const data = parsed(file);
      expect(data.description).toBe(typed);
      expect(data.name).toBe("p");
      expect(data.AIDE_TEST_CMD).toBe("make test");
      const text = readFileSync(file, "utf-8");
      for (const line of tail) expect(text.split("\n")).toContain(line);

      const saved = text;
      const again = await updateProjectSettings(run, dir, { description: typed });
      expect(again.steps.map((s) => s.step)).not.toContain("description");
      expect(readFileSync(file, "utf-8")).toBe(saved);
    });

    test(`a stored description ${form} posted back on one line writes nothing (AC-2)`, async () => {
      const { dir, file, text } = setup(description, tail);
      const stored = parsed(file).description ?? "";
      const result = await updateProjectSettings(run, dir, { description: oneLine(stored) });
      expect(result.steps.map((s) => s.step)).not.toContain("description");
      expect(readFileSync(file, "utf-8")).toBe(text);
    });

    test(`an empty description removes the key and its continuation lines ${form}, and nothing else (AC-2)`, async () => {
      const { dir, file } = setup(description, tail);
      await updateProjectSettings(run, dir, { description: "" });
      expect(readFileSync(file, "utf-8")).toBe(`${["name: p", ...tail].join("\n")}\n`);
    });
  }
});
