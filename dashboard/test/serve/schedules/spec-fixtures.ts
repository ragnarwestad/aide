// The spec folders and branch reads the schedule tests build on: a
// projects root with one spec depending on another, and a branch-file
// checker that has already read a spec's open `aide/<folder>` branch.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BranchFileStepsChecker } from "../../../src/git/workflow-history.ts";
import type { OpenBranchTarget } from "../../../src/git/branch-file.ts";
import type { GitRunner } from "../../../src/git/process/index.ts";

/** A checker that has read `aide/<folder>`, where each file named in
 *  `files` (by the end of its path) holds the given text and every other
 *  file is missing. */
export async function branchCheckerReading(
  specDir: string, folder: string, files: Record<string, string>,
): Promise<BranchFileStepsChecker> {
  const target: OpenBranchTarget = {
    root: "/root",
    branch: `aide/${folder}`,
    relPath: `aide/specs/${folder}/4-status.md`,
    archivedRelPath: `aide/specs/archive/${folder}/4-status.md`,
  };
  const run: GitRunner = async (_dir, args) => {
    const line = args.join(" ");
    if (line.startsWith("fetch")) return { code: 0, stdout: "" };
    if (line.startsWith("log -1")) return { code: 0, stdout: "deadbeef\n" };
    const file = Object.keys(files).find((name) => line.endsWith(name));
    return file === undefined ? { code: 1, stdout: "" } : { code: 0, stdout: files[file]! };
  };
  const checker = new BranchFileStepsChecker({ run });
  await checker.read(specDir, folder, target);
  return checker;
}

/** A projects root under `dir` whose `81-dependent` names `80-dependency`
 *  in its Depends on line. */
export function dependentProjectsRoot(dir: string): { root: string; specs: string } {
  const root = join(dir, "root");
  const specs = join(root, "aide", "specs");
  mkdirSync(join(root, "aide", ".aide"), { recursive: true });
  writeFileSync(join(root, "aide", ".aide", "project.yaml"), "name: aide\n");
  mkdirSync(join(specs, "80-dependency"), { recursive: true });
  writeFileSync(join(specs, "80-dependency", "1-description.md"), "# 80-dependency\n");
  mkdirSync(join(specs, "81-dependent"), { recursive: true });
  writeFileSync(
    join(specs, "81-dependent", "1-description.md"),
    "# 81-dependent\n\n## Tracking info\n\n- **Depends on:** `80-dependency`\n",
  );
  return { root, specs };
}
