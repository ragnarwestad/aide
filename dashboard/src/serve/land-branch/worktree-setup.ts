// The worktree the Merge tests the merged result in: made from the
// merge, given the checkout's `.aide/config`, manifest and worktree links,
// then set up with the project's `worktreeSetup` through
// `aide-worktree-setup` — the one place that rule lives, as the runner
// and the test server run it too.

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { resolveWorktreeLinks, resolveWorktreeSetup } from "../../project/discover";
import { NO_GIT_HOOKS } from "../../integrations/no-git-hooks.ts";
import { runScript, scriptFor } from "./run-script.ts";

export const LANDING_GATE_TEMP_PREFIX = "aide-landing-gate-tree-";

/** How long the command itself may take, in seconds; it stops itself. */
export const WORKTREE_SETUP_TIMEOUT_SEC = 900;
/** A backstop a minute above the command's own limit. */
const WORKTREE_SETUP_TIMEOUT_MS = (WORKTREE_SETUP_TIMEOUT_SEC + 60) * 1000;

/** `aide-worktree-setup`'s answer: `ran: false` when the project sets no
 *  `worktreeSetup`. */
export interface WorktreeSetup {
  ok: boolean;
  ran: boolean;
  command?: string;
  seconds?: number;
  exitCode?: number;
  timedOut?: boolean;
  tail?: string;
}

/** Runs the setup at `dir`'s root, reading the key from `dir`'s own
 *  manifest. A project without the key spawns nothing. Every line the
 *  command writes goes to `log`, its failure line marked as an error;
 *  `owner` lets Cancel reach the process. */
export async function runWorktreeSetup(
  dir: string,
  opts: { scriptDir?: string; owner?: string; log: (line: string, error?: boolean) => void },
): Promise<WorktreeSetup> {
  const command = resolveWorktreeSetup(dir).value;
  if (!command) return { ok: true, ran: false };
  const bin = scriptFor("aide-worktree-setup", { beside: opts.scriptDir, override: process.env.AIDE_WORKTREE_SETUP_BIN });
  const out = await runScript(
    [bin, "--dir", dir, "--manifest-dir", dir, "--timeout", String(WORKTREE_SETUP_TIMEOUT_SEC)],
    dir,
    WORKTREE_SETUP_TIMEOUT_MS,
    opts.owner,
  );
  for (const line of out.stderr.split("\n").filter((l) => l.trim())) {
    const failed = line.startsWith("worktree setup failed: ");
    opts.log(failed || line.startsWith("worktree setup: ") ? line : `worktree setup: ${line}`, failed);
  }
  try {
    const answer = JSON.parse(out.stdout.trim().split("\n").pop() ?? "{}") as Partial<WorktreeSetup>;
    if (typeof answer.ok === "boolean") return { ...answer, ok: answer.ok, ran: answer.ran ?? true, command: answer.command ?? command };
  } catch {
    // Read below as a failure: an answer nobody can read is no setup.
  }
  const tail = out.timedOut ? `did not finish within ${WORKTREE_SETUP_TIMEOUT_SEC + 60}s` : out.stderr.trim().split("\n").slice(-20).join("\n");
  return { ok: false, ran: true, command, timedOut: out.timedOut, tail };
}

/** A detached worktree of `root`'s HEAD, with the project's
 *  `worktreeLinks` (the gitignored directories its commands need —
 *  `.venv`, `node_modules`) linked in the same way `aide-run-spec` links
 *  them for a run, and `.aide/config` copied so the test command
 *  resolves, then `setup` run in it. Falls back to the live checkout when a
 *  worktree cannot be made, saying so in the log; no setup runs there. */
export async function checkoutForGate(
  root: string,
  ref = "HEAD",
  setup?: (dir: string) => Promise<WorktreeSetup>,
): Promise<{ dir: string; remove: () => Promise<void>; setup?: WorktreeSetup }> {
  const dir = mkdtempSync(join(tmpdir(), LANDING_GATE_TEMP_PREFIX));
  const added = await runScript(["git", ...NO_GIT_HOOKS, "worktree", "add", "--detach", "--quiet", dir, ref], root, 60_000);
  if (added.code !== 0) {
    rmSync(dir, { recursive: true, force: true });
    console.error(`queue: the landing's test run could not make a worktree in ${root} — testing in the live checkout: ${(added.stderr ?? "").trim().slice(-200)}`);
    return { dir: root, remove: async () => {} };
  }
  // Where the gitignored directories actually live. `root` is a
  // worktree of its own while a landing is merging, and `.venv` and
  // `node_modules` are in the MAIN checkout — linked from `root` they
  // linked nothing, and the project's own test command came back
  // "No such file or directory". `.aide/config` is gitignored in this
  // repo for the same reason and is read the same way.
  const owner = await mainCheckoutOf(root);
  const config = [join(root, ".aide", "config"), join(owner, ".aide", "config")].find((p) => existsSync(p));
  if (config) {
    mkdirSync(join(dir, ".aide"), { recursive: true });
    copyFileSync(config, join(dir, ".aide", "config"));
  }
  // A project that keeps its settings in the dashboard has an
  // untracked `.aide/project.yaml` in the checkout, which a worktree of
  // HEAD does not carry — and a tree with none finds no test command,
  // which is "nothing to run", a landing merged untested. Copied in
  // under the runner's rule (`carry_manifest_into_worktree`): tracked in
  // the tree or git unable to say → leave it alone; untracked with a
  // source → copy it. The links are read from the tree afterwards, so
  // the ones the copy names are made too.
  const manifestSource = [join(root, ".aide", "project.yaml"), join(owner, ".aide", "project.yaml")].find((p) => existsSync(p));
  if (manifestSource) {
    const tracked = await runScript(["git", ...NO_GIT_HOOKS, "ls-files", "--error-unmatch", "--", ".aide/project.yaml"], dir, 30_000);
    if (tracked.code === 1) {
      mkdirSync(join(dir, ".aide"), { recursive: true });
      copyFileSync(manifestSource, join(dir, ".aide", "project.yaml"));
    }
  }
  for (const entry of resolveWorktreeLinks(dir).links.split(/[\s,]+/).filter(Boolean)) {
    const source = [join(root, entry), join(owner, entry)].find((p) => existsSync(p));
    const target = join(dir, entry);
    if (!source || existsSync(target)) continue;
    try {
      mkdirSync(dirname(target), { recursive: true });
      symlinkSync(source, target);
    } catch {
      // A link that cannot be made leaves the command to say what is
      // missing, exactly as a run's worktree would.
    }
  }
  const remove = async () => {
    await runScript(["git", ...NO_GIT_HOOKS, "worktree", "remove", "--force", dir], root, 60_000);
    rmSync(dir, { recursive: true, force: true });
  };
  try {
    return { dir, remove, ...(setup && { setup: await setup(dir) }) };
  } catch (err) {
    await remove();
    throw err;
  }
}

/** The checkout that owns this repository's working files. For a
 *  worktree, `git rev-parse --git-common-dir` names the main checkout's
 *  own `.git`; for the main checkout it answers `.git` itself, and the
 *  answer is `root` unchanged. */
async function mainCheckoutOf(root: string): Promise<string> {
  const common = await runScript(["git", ...NO_GIT_HOOKS, "rev-parse", "--git-common-dir"], root, 30_000);
  const out = common.stdout.trim();
  if (common.code !== 0 || !out) return root;
  const abs = isAbsolute(out) ? out : join(root, out);
  return abs.endsWith("/.git") ? dirname(abs) : root;
}
