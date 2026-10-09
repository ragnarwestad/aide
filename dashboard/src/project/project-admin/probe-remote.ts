// Which test command a git address's root files point at, answered
// without making a checkout the dashboard keeps. The Add form asks for it
// while the Git URL is being typed.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GitRunner } from "../../git/branch-status.ts";
import { detectCommandsIn } from "../detect-commands.ts";

const PROBE_TIMEOUT_MS = 20_000;

/** The test command the root files of `gitUrl` point at, or `null` when
 *  there is none or it cannot be told.
 *
 *  Add's own clone, made shallow, blob-less and without a checkout, in a
 *  scratch directory that is removed afterwards: the trees of one commit
 *  are fetched and no file contents, and nothing is left on the machine.
 *  Every failure — an address that cannot be cloned, an empty repository,
 *  a timeout — answers `null`, so a form asking never waits on this and
 *  never breaks because of it. */
export async function detectRemoteTestCommand(
  run: GitRunner,
  gitUrl: string,
  scratchParent: string = tmpdir(),
): Promise<string | null> {
  const url = gitUrl.trim();
  if (!url) return null;
  const scratch = mkdtempSync(join(scratchParent, "aide-probe-"));
  try {
    // `credential.helper=` as on Add's clone: nobody is there to ask. The
    // `--` keeps an address that starts with a dash from being read as an
    // option.
    const cloned = await run(
      scratch,
      ["-c", "credential.helper=", "clone", "--depth", "1", "--filter=blob:none", "--no-checkout", "--quiet", "--", url, "probe"],
      PROBE_TIMEOUT_MS,
    );
    if (cloned.code !== 0) return null;
    const listed = await run(join(scratch, "probe"), ["ls-tree", "--name-only", "HEAD"], PROBE_TIMEOUT_MS);
    if (listed.code !== 0) return null;
    const names = new Set(listed.stdout.split("\n").map((name) => name.trim()).filter(Boolean));
    return detectCommandsIn((file) => names.has(file)).test?.cmd ?? null;
  } catch {
    return null;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
