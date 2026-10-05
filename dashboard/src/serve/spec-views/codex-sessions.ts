// Where Codex keeps a thread's session file: `rollout-<time>-<thread>.jsonl`
// under `sessions/` in CODEX_HOME, else in `.codex` in the home folder. The
// rule `codex_provider_limit` follows in bash
// (`core/scripts/lib/run-spec/turn/provider-limit.sh`), pinned by
// `test/serve/spec-views/codex-sessions.test.ts`, which reads both sides.
import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { tailFile } from "../serve-helpers";

const THREAD = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){4}[0-9a-f]{8}$/;

export function codexHome(env: Record<string, string | undefined> = process.env): string {
  return env.CODEX_HOME || join(env.HOME || homedir(), ".codex");
}

/** A thread's session file as text, or undefined when there is no such file,
 *  it cannot be read, or it is empty. Never throws. */
export function readCodexSession(thread: string, home: string = codexHome()): string | undefined {
  if (!THREAD.test(thread)) return undefined;
  const sessions = join(home, "sessions");
  try {
    const found = (readdirSync(sessions, { recursive: true }) as string[]).find((path) => {
      const name = basename(path);
      return name.startsWith("rollout-") && name.endsWith(`-${thread}.jsonl`) && statSync(join(sessions, path)).isFile();
    });
    const text = found === undefined ? "" : tailFile(join(sessions, found), Infinity);
    return text.trim() ? text : undefined;
  } catch {
    return undefined;
  }
}
