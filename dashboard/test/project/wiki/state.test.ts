// A page's state — Current, Files changed, Unknown, By hand — judged by the
// dashboard, and held to the answer `aide-wiki status` gives on the same
// repository. The two are a pair: one rule written in bash and in TypeScript.

import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { createGitRunner, type GitRunner } from "../../../src/git/branch-status.ts";
import { splitPage } from "../../../src/project/wiki/parse.ts";
import { pageStates } from "../../../src/project/wiki/state.ts";
import { cleanup, commitAll, generatedPage, initRepo, scratch, write } from "./wiki-fixtures.ts";

const SCRIPT = join(import.meta.dir, "../../../../core/scripts/aide-wiki");
const dirs: string[] = [];
afterEach(() => cleanup(dirs));

/** A project whose second commit changes a file, renames one and changes a
 *  file with a non-ASCII name, and pages written from its first commit. */
function fixture() {
  const root = scratch(dirs);
  const project = join(root, "project");
  const specs = join(root, "specs");
  initRepo(project);
  for (const f of ["a.ts", "b.ts", "old.ts", "ünï.ts"]) write(project, f, `${f} one\n${"x".repeat(200)}\n`);
  const first = commitAll(project, "first");
  write(project, "a.ts", "a two\n");
  write(project, "ünï.ts", "u two\n");
  write(project, "new.ts", `old.ts one\n${"x".repeat(200)}\n`);
  git_rm(project, "old.ts");
  commitAll(project, "second");
  const pages: Record<string, string> = {
    "changed.md": generatedPage(first, ["a.ts"], "Changed", "Names a changed file."),
    "renamed.md": generatedPage(first, ["old.ts"], "Renamed", "Names a renamed file."),
    "current.md": generatedPage(first, ["b.ts"], "Current", "Names an untouched file."),
    "unicode.md": generatedPage(first, ["ünï.ts"], "Unicode", "Names a non-ASCII file."),
    "unknown.md": generatedPage("deadbeefdeadbeefdeadbeefdeadbeefdeadbeef", ["a.ts"], "Unknown", "From a commit the project lacks."),
    "hand.md": "# By hand\n\nNo mark.\n",
  };
  for (const [name, text] of Object.entries(pages)) write(specs, `wiki/${name}`, text);
  return { project, specs, pages };
}

function git_rm(dir: string, file: string): void {
  Bun.spawnSync({ cmd: ["git", "-C", dir, "rm", "-q", file] });
}

const marks = (pages: Record<string, string>) =>
  new Map(Object.entries(pages).map(([name, text]) => [name, splitPage(text).mark]));

describe("a page's state (AC-4)", () => {
  test("Files changed for a changed, a renamed and a non-ASCII file; Current, Unknown and By hand otherwise", async () => {
    const { project, pages } = fixture();
    const states = await pageStates(createGitRunner(), project, marks(pages));
    expect(Object.fromEntries(states)).toEqual({
      "changed.md": "changed",
      "renamed.md": "changed",
      "current.md": "current",
      "unicode.md": "changed",
      "unknown.md": "unknown",
      "hand.md": "hand-written",
    });
  });

  test("is what `aide-wiki status` answers for the same repository (AC-4)", async () => {
    const { project, specs, pages } = fixture();
    const ran = Bun.spawnSync({
      cmd: ["bash", SCRIPT, "status", "--specs-root", specs, "--project-dir", project],
      stdout: "pipe", stderr: "pipe",
    });
    expect(ran.exitCode).toBe(0);
    const said = JSON.parse(ran.stdout.toString()) as { pages: { page: string; state: string }[] };
    const theirs = Object.fromEntries(said.pages.map((p) => [p.page, p.state]));
    const ours = Object.fromEntries(await pageStates(createGitRunner(), project, marks(pages)));
    expect(ours as Record<string, string>).toEqual(theirs);
  });

  test("a git that cannot answer the diff reads Unknown, never Current (AC-4)", async () => {
    const { project, pages } = fixture();
    const real = createGitRunner();
    const failing: GitRunner = (dir, args, ...rest) =>
      args[0] === "diff" ? Promise.resolve({ code: 128, stdout: "" }) : real(dir, args, ...rest);
    const states = await pageStates(failing, project, marks(pages));
    expect(states.get("current.md")).toBe("unknown");
    expect(states.get("changed.md")).toBe("unknown");
    expect(states.get("hand.md")).toBe("hand-written");
  });

  test("a commit that could be read as an option never reaches git (AC-4)", async () => {
    const { project } = fixture();
    const seen: string[][] = [];
    const real = createGitRunner();
    const run: GitRunner = (dir, args, ...rest) => {
      seen.push(args);
      return real(dir, args, ...rest);
    };
    const bad = generatedPage("--all", ["a.ts"], "Bad", "x");
    const states = await pageStates(run, project, marks({ "bad.md": bad }));
    expect(states.get("bad.md")).toBe("unknown");
    expect(seen).toEqual([]);
  });

  test("one diff per distinct commit, not one per page", async () => {
    const { project, pages } = fixture();
    const diffs: string[][] = [];
    const real = createGitRunner();
    const run: GitRunner = (dir, args, ...rest) => {
      if (args[0] === "diff") diffs.push(args);
      return real(dir, args, ...rest);
    };
    await pageStates(run, project, marks(pages));
    expect(diffs).toHaveLength(1); // five pages name the first commit; the one the project lacks is never diffed
  });
});
