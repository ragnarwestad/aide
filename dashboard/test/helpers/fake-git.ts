// A git that runs no git. Both the read path (branch-status) and the
// write path (branch-merge) ask their questions of the LOGIC — which
// refs are consulted, in what order, and what an unresolvable answer
// degrades to — so a harness kept in two copies would be a harness that
// one day disagrees with itself about what git said.

import type { GitRunner } from "../../src/git/branch-status.ts";

export interface GitCall {
  dir: string;
  args: string[];
}

export interface Answer {
  code: number;
  stdout?: string;
  stderr?: string;
}

/** A runner that answers from a table of `argv` prefixes and records
 *  everything it was asked. The first matching prefix wins, so a table
 *  can put a specific case above a general one. A prefix's answer can
 *  also be an ARRAY: one entry consumed per call to that prefix (the
 *  last entry sticks once exhausted), so a test can say "the first push
 *  fails, the second succeeds" directly — the same idea `flippingGit`'s
 *  `schedule` already applies to `ls-remote` alone, generalized to any
 *  prefix (spec 359). */
export function fakeGit(answers: Record<string, Answer | Answer[]>) {
  const calls: GitCall[] = [];
  const counts = new Map<string, number>();
  const run: GitRunner = async (dir, args) => {
    calls.push({ dir, args });
    for (const [prefix, entry] of Object.entries(answers)) {
      if (args.join(" ").startsWith(prefix)) {
        let answer: Answer;
        if (Array.isArray(entry)) {
          const n = counts.get(prefix) ?? 0;
          counts.set(prefix, n + 1);
          answer = entry[Math.min(n, entry.length - 1)];
        } else {
          answer = entry;
        }
        // `stderr` only where a table says so: the one code path that
        // reads it (branch-merge's index.lock retry) must behave for an
        // absent field exactly as it did before the field existed.
        return { code: answer.code, stdout: answer.stdout ?? "", stderr: answer.stderr };
      }
    }
    return { code: 1, stdout: "" };
  };
  return { run, calls };
}

/** What a clean checkout on its default branch answers before anything
 *  is merged into it: origin/HEAD resolves, the tree is clean, and
 *  every plumbing call succeeds. */
export const CLEAN_MASTER = {
  "symbolic-ref": { code: 0, stdout: "refs/remotes/origin/master\n" },
  "status --porcelain": { code: 0, stdout: "" },
};

/** A runner whose `ls-remote --heads` answer for a spec root moves
 *  through `schedule` one ask at a time — `schedule[0]` on the first ask
 *  of that root, `schedule[1]` on the second, and `schedule`'s last entry
 *  from then on. Tracked per DIRECTORY rather than globally, so two roots
 *  asked inside the same `Promise.all` sweep each start their own count
 *  at 0 rather than sharing one. `hold` lets a test pin a call in flight
 *  — a ONE-SHOT gate (a plain `Promise` a test resolves once) holds every
 *  call, including ones chained off another call's own resolution, until
 *  release; a re-armed one distinguishes calls before/after that point.
 *  `branch` names which `aide/<folder>` the reported ref belongs to — the
 *  archived spec whose row a test is about — defaulting to the harness's
 *  own live spec. */
export function flippingGit(
  schedule: boolean[],
  opts: { hold?: () => Promise<void>; branch?: string } = {},
) {
  const branch = opts.branch ?? "aide/81-queue-and-runner";
  const calls: GitCall[] = [];
  const asked = new Map<string, number>();
  const run: GitRunner = async (dir, args) => {
    calls.push({ dir, args });
    if (opts.hold) await opts.hold();
    const line = args.join(" ");
    if (args[0] === "ls-remote") {
      const n = asked.get(dir) ?? 0;
      asked.set(dir, n + 1);
      const open = schedule[Math.min(n, schedule.length - 1)];
      return {
        code: 0,
        stdout: open ? `a3f9c21deadbeef0000000000000000000000000\trefs/heads/${branch}\n` : "",
      };
    }
    if (line.startsWith("log --format=%aI")) return { code: 0, stdout: "2026-08-17T09:00:00+02:00\n" };
    if (line.startsWith("log -1 --format=%H")) {
      return { code: 0, stdout: "deadbee\t2026-08-18T09:10:36+02:00\n" };
    }
    // A REAL match, like `recordingGit`'s — an empty one sends
    // `WorkflowHistoryChecker` chasing a second, differently-shaped
    // query for the same spec, which is a further call this fake would
    // then have to answer too (and a further tick of `hold`, if held).
    if (line.startsWith("log --all")) {
      return { code: 0, stdout: "Run /aide-analyze for 81-queue-and-runner (headless)\n" };
    }
    return { code: 1, stdout: "" };
  };
  return { run, calls };
}
