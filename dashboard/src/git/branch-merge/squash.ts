// A code root's landing puts ONE commit on the default branch per branch
// it lands. The merge is still built, repaired and tested as a real
// merge — the repairs push that merge to the source branch, and the gate
// tests its tree — and only then is it replaced by a single commit with
// the very same tree, parented on the base alone. What was tested is
// exactly what is pushed.

import type { GitRunner } from "../process/index.ts";

/** Builds the squash commit's message from the commits being squashed,
 *  oldest first. */
export type SquashMessage = (subjects: string[]) => string;

/** The message for a landing: the title (a spec's) or, without one, the
 *  only commit's subject or else the branch name; then, when that subject
 *  is not already the whole story, every squashed commit's subject. */
export function squashMessage(branch: string, title?: string): SquashMessage {
  return (subjects) => {
    const subject = title || (subjects.length === 1 ? subjects[0] : branch);
    const listed = subjects.length > 1 || (title && subjects.length > 0 && subjects[0] !== title);
    return listed ? `${subject}\n\n${subjects.map((s) => `- ${s}`).join("\n")}\n` : `${subject}\n`;
  };
}

/** Replace HEAD in `work` — `onto` with the branch merged in — by one
 *  commit with HEAD's tree whose only parent is `onto`. A HEAD that is
 *  already one ordinary commit on `onto` is left as it is, and so is a
 *  merge that added nothing. The author is the branch's latest commit's.
 *  Returns git's words when it could not be done. */
export async function squashOnto(
  run: GitRunner,
  work: string,
  onto: string,
  message: SquashMessage,
): Promise<string | undefined> {
  const head = (await run(work, ["rev-parse", "HEAD"])).stdout.trim();
  if (!head || head === onto) return undefined;
  const parents = (await run(work, ["rev-list", "--parents", "-n", "1", "HEAD"])).stdout.trim().split(" ").slice(1);
  if (parents.length === 1 && parents[0] === onto) return undefined;
  const log = await run(work, ["log", "--no-merges", "--reverse", "--format=%s", `${onto}..HEAD`]);
  if (log.code !== 0) return (log.stderr ?? "").trim() || "git log failed";
  const subjects = log.stdout.split("\n").filter(Boolean);
  const who = await run(work, ["log", "--no-merges", "-n", "1", "--format=%an%n%ae", `${onto}..HEAD`]);
  const [name, email] = who.stdout.split("\n");
  const env: Record<string, string> = name && email ? { GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email } : {};
  const made = await run(work, ["commit-tree", "HEAD^{tree}", "-p", onto, "-m", message(subjects)], undefined, env);
  const sha = made.stdout.trim();
  if (made.code !== 0 || !sha) return (made.stderr ?? "").trim() || "git commit-tree failed";
  const moved = await run(work, ["reset", "-q", "--hard", sha]);
  if (moved.code !== 0) return (moved.stderr ?? "").trim() || "git reset failed";
  return undefined;
}
