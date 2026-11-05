// The conversion to providers applied to the board's own files, once, on the
// first start after providers came in: the mirror of the queue, the
// schedules in the queue config, then the config itself. The config's
// `providers` is the mark that it has run, so it is written last and a start
// stopped part-way converts again (the conversion keeps what a job already
// carries).

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { parse as parseJsonc } from "jsonc-parser";
import { NAME_RE } from "../../queue/parse-request.ts";
import { convertToProviders } from "../../queue/providers/convert.ts";
import { mergeQueueDefaults, persistQueueSettings } from "../../queue/persist.ts";
import { createScheduleStore } from "../../queue/schedule-store.ts";
import { loadJobs, writeJobs } from "../../queue/store/mirror.ts";
import type { Job } from "../../queue/types.ts";
import type { ServerOptions } from "../options.ts";
import { QUEUE_DEFAULTS } from "../serve-helpers/config.ts";

const readConfig = (file: string): Record<string, unknown> | undefined => {
  try {
    const raw = parseJsonc(readFileSync(file, "utf-8")) as unknown;
    return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
};

/** The Claude accounts a config held before providers: a name and a folder
 *  each; anything else in the table is not an account. */
function legacyAccounts(raw: unknown): Record<string, { configDir: string }> {
  const out: Record<string, { configDir: string }> = {};
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [name, entry] of Object.entries(raw)) {
    const dir = (entry as { configDir?: unknown } | null)?.configDir;
    if (NAME_RE.test(name) && typeof dir === "string" && dir) out[name] = { configDir: dir };
  }
  return out;
}

/** Converts when the queue config file has no `providers` key, and hands the
 *  server the defaults read back from what was written. Says why on stderr
 *  when it could not write; the board then starts on the built-in providers. */
export function convertProvidersAtBoot(
  opts: Pick<ServerOptions, "queueConfigFile" | "queueMirrorPath" | "queueDefaults">,
  home: string = homedir(),
): void {
  const file = opts.queueConfigFile;
  if (!file || !existsSync(file)) return;
  const raw = readConfig(file);
  if (!raw || "providers" in raw) return;

  const jobs = new Map<string, Job>();
  loadJobs(opts.queueMirrorPath, jobs);
  const store = createScheduleStore(file);
  const schedules = Object.fromEntries(
    Object.keys((raw.schedules as Record<string, unknown> | undefined) ?? {}).map((project) => [project, store.list(project)]),
  );
  const converted = convertToProviders({
    defaults: mergeQueueDefaults(QUEUE_DEFAULTS, raw),
    claudeAccounts: legacyAccounts(raw.claudeAccounts),
    jobs: [...jobs.values()],
    schedules,
    home,
  });

  if (jobs.size > 0) writeJobs(opts.queueMirrorPath, converted.jobs);
  for (const [project, entries] of Object.entries(converted.schedules)) {
    if (JSON.stringify(entries) === JSON.stringify(schedules[project])) continue;
    const error = store.save(project, entries);
    if (error) return void console.error(`providers: ${error} — not converted`);
  }
  const error = persistQueueSettings(file, {
    providers: converted.providers,
    provider: converted.provider,
    removeKeys: ["claudeAccounts"],
  });
  if (error) return void console.error(`providers: ${error} — not converted`);

  const after = readConfig(file);
  if (after) opts.queueDefaults = mergeQueueDefaults(QUEUE_DEFAULTS, after);
}
