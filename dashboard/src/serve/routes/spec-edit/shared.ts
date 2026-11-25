// What more than one of the spec's own route families needs.
import { dirname, join } from "node:path";
import { STATE_FILE } from "../../../project/spec-names.ts";
import { writeStatusToBranch, type OpenBranchTarget } from "../../../git/branch-file.ts";
import { saveSpecFiles } from "../../../git/specs-pull.ts";
import { editMessage } from "../../serve-helpers";
import type { RoutesContext } from "..";
import { afterTick } from "./checks.ts";

/** The state file beside the status file path given. */
export const stateRelPath = (statusRelPath: string): string => join(dirname(statusRelPath), STATE_FILE);

/** Writes one of a spec's files as a commit: to the spec's open branch when
 *  it has one, else to the specs root's default branch, each under its
 *  root's merge lock. `baseSha` is the commit the text was edited from.
 *  A save that went through drops the cached answers about the spec, so
 *  they read what was just saved. */
export async function writeSpecFile(
  ctx: RoutesContext,
  target: { dir: string; specFolder: string; file: string; branch: OpenBranchTarget | null },
  text: string,
  baseSha: string | null,
) {
  const { dir, specFolder, file, branch } = target;
  const message = editMessage(specFolder, file);
  const result = branch
    ? await ctx.mergeLock.run(branch.root, () =>
        writeStatusToBranch(ctx.gitRun, branch.root, branch.branch, [{ relPath: branch.relPath, text }], baseSha, message),
      )
    : await ctx.mergeLock.run(await ctx.specsRoot(dir), () =>
        saveSpecFiles(
          ctx.gitRun,
          dir,
          (root) => ctx.branchStatus.defaultBranch(root),
          [{ file, text, baseSha }],
          { specLabel: specFolder, message },
        ),
      );
  if (result.ok) await afterTick(ctx, dir, specFolder);
  return result;
}
