// A file's bytes off a ref, as git holds them. `GitRunner` decodes what git
// prints as text, which would corrupt an image; this reads it as bytes.

import { NO_GIT_HOOKS } from "../../integrations/no-git-hooks.ts";

const TIMEOUT_MS = 4000;

/** The bytes of `path` at `ref` in the repository at `dir`, or null when
 *  git has no such file there or could not answer. */
export async function readBlob(dir: string, ref: string, path: string): Promise<Uint8Array | null> {
  let proc;
  try {
    proc = Bun.spawn({
      cmd: ["git", ...NO_GIT_HOOKS, "cat-file", "blob", `${ref}:${path}`],
      cwd: dir,
      stdout: "pipe",
      stderr: "ignore",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
  } catch {
    return null;
  }
  const killer = setTimeout(() => proc.kill(), TIMEOUT_MS);
  try {
    const bytes = new Uint8Array(await new Response(proc.stdout).arrayBuffer());
    return (await proc.exited) === 0 ? bytes : null;
  } finally {
    clearTimeout(killer);
  }
}
