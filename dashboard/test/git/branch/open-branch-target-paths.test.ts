// The path `resolveOpenBranchTarget` hands `readStatusFromBranch` and
// `writeStatusToBranch`: a path INSIDE the specs repository, for
// `git show <ref>:<path>` to resolve against a commit.
//
// `root` is git's own answer and so has every symlink resolved; `dir`
// comes off the scan of the projects root and does not. Where the two
// reach the same place by different names — macOS `$TMPDIR` is
// `/var/folders/...`, a link to `/private/var/folders/...`, and the
// projects root holds links to the person's own folders — subtracting one
// from the other climbed out of the repo and back down an absolute path.
// `git show` then found nothing, the read came back empty, and every
// acceptance row looked gone: a tick was refused with "that check is not
// there to change any more" on a row the page had just drawn.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, symlinkSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveOpenBranchTarget } from "../../../src/git/branch-file.ts";

const FOLDER = "512-a-spec-with-checks";

/** A specs repo whose own path is reached through a symlink, and the
 *  spec folder inside it. `root` is given resolved, as git answers. */
function repoBehindALink(): { root: string; linkedDir: string } {
  const base = mkdtempSync(join(tmpdir(), "aide-branch-target-"));
  const real = join(realpathSync(base), "specs");
  mkdirSync(join(real, FOLDER), { recursive: true });
  const link = join(base, "by-another-name");
  symlinkSync(real, link);
  return { root: real, linkedDir: join(link, FOLDER) };
}

const ctxFor = (root: string) => ({
  specsRoot: async () => root,
  branchStatus: {
    openSpecBranches: async () => new Set([`aide/${FOLDER}`]),
  } as never,
});

describe("resolveOpenBranchTarget's paths are inside the repository", () => {
  test("a dir that reaches the root through a symlink still subtracts to a repo path", async () => {
    const { root, linkedDir } = repoBehindALink();

    const target = await resolveOpenBranchTarget(ctxFor(root), linkedDir, FOLDER, "4-status.md", false);

    expect(target).not.toBeNull();
    expect(target!.relPath).toBe(`${FOLDER}/4-status.md`);
    expect(target!.archivedRelPath).toBe(`archive/${FOLDER}/4-status.md`);
  });

  test("the plain case, where nothing is linked, is unchanged", async () => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), "aide-branch-target-plain-")));
    const root = join(base, "specs");
    mkdirSync(join(root, FOLDER), { recursive: true });

    const target = await resolveOpenBranchTarget(ctxFor(root), join(root, FOLDER), FOLDER, "4-status.md", false);

    expect(target!.relPath).toBe(`${FOLDER}/4-status.md`);
    expect(target!.archivedRelPath).toBe(`archive/${FOLDER}/4-status.md`);
  });
});
