// A setting's value is one line: a break that reaches the server is
// folded to a space before it is written.
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { oneLine } from "../../../src/project/project-admin/manifest-io.ts";
import { updateProjectSettings } from "../../../src/project/project-admin/update-settings.ts";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const project = () => {
  const dir = mkdtempSync(join(tmpdir(), "aide-oneline-"));
  dirs.push(dir);
  mkdirSync(join(dir, ".aide"));
  writeFileSync(join(dir, ".aide", "project.yaml"), "name: p\ndescription: d\n");
  mkdirSync(join(dir, "specs", "archive"), { recursive: true });
  return dir;
};
const run = async () => ({ code: 1, stdout: "" });
const files = (dir: string) => ({
  config: existsSync(join(dir, ".aide", "config")) ? readFileSync(join(dir, ".aide", "config"), "utf-8") : "",
  manifest: readFileSync(join(dir, ".aide", "project.yaml"), "utf-8"),
});

describe("oneLine", () => {
  test("folds a break with its spaces to one space and trims the ends (AC-3)", () => {
    expect(oneLine("a\r\nb")).toBe("a b");
    expect(oneLine(" a\nb ")).toBe("a b");
    expect(oneLine("a  \n\n  b\rc")).toBe("a b c");
    expect(oneLine("a b")).toBe("a b");
  });
});

describe("updateProjectSettings folds line breaks", () => {
  test("a break in each of the five text fields is written on one line (AC-3)", async () => {
    const dir = project();
    const specs = join(dir, "sp");
    await updateProjectSettings(run, dir, {
      specsPath: `${specs}\r\n`,
      worktreeLinks: " node_modules\n.venv ",
      installCmd: "bun\ninstall",
      previewCmd: "bun\r\nrun dev",
      testCmd: "make\ntest",
    });
    const { config, manifest } = files(dir);
    expect(config).toContain(`AIDE_SPECS_PATH=${specs}\n`);
    expect(config).toContain("AIDE_INSTALL_CMD=bun install\n");
    expect(manifest).not.toMatch(/\r/);
    for (const line of ["worktreeLinks: node_modules .venv", "previewCmd: bun run dev", "testCmd: make test"]) {
      expect(manifest).toContain(line);
    }
    expect(config.split("\n").every((l) => l === "" || /^[A-Z_]+=/.test(l))).toBe(true);
  });

  test("a save carrying only the test command leaves the other four as they were (AC-3)", async () => {
    const dir = project();
    writeFileSync(join(dir, ".aide", "config"), "AIDE_INSTALL_CMD=bun install\n");
    await updateProjectSettings(run, dir, { installCmd: "bun install", worktreeLinks: "node_modules" });
    const before = files(dir);
    await updateProjectSettings(run, dir, { testCmd: "make\ntest" });
    const after = files(dir);
    expect(after.config).toBe(before.config);
    expect(after.manifest).toContain("worktreeLinks: node_modules");
    expect(after.manifest).toContain("testCmd: make test");
  });

  test("values with no break write what they always did, and an unchanged value is not rewritten (AC-3)", async () => {
    const dir = project();
    await updateProjectSettings(run, dir, { installCmd: "bun install" });
    const first = files(dir);
    await updateProjectSettings(run, dir, { installCmd: "bun install" });
    expect(files(dir)).toEqual(first);
    expect(first.config).toBe("AIDE_INSTALL_CMD=bun install\n");
  });
});
