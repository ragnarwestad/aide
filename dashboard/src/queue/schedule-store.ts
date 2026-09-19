// Where a project's scheduled jobs are kept: the `schedules` key of the
// serving host's own `queue-config.json`, `{ "<project>": [entry, ...] }`.
// A job belongs to the installation that fires it, never to the project's
// committed manifest, so nothing here touches git.
//
// Everything is synchronous, so a read-modify-write cannot interleave with
// `persistQueueProjects` or `persistQueueSettings` on one JS thread. The
// file is read fresh on every call: a hand edit takes effect at the next
// tick, not the next restart.

import { CronExpressionParser } from "cron-parser";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser";
import { escapesRoot, SCHEDULE_NAME_RE, type ScheduleEntry } from "./schedule.ts";

export interface ScheduleStore {
  /** This project's entries, read fresh; [] for no file, an unreadable file or no key. */
  list(project: string): ScheduleEntry[];
  /** Replace this project's entries. Returns why it could not, or null. */
  save(project: string, entries: readonly ScheduleEntry[]): string | null;
}

/** The entries in one project's list. Each is validated on its own and a
 *  bad one is dropped rather than carried through with a guess: a name
 *  that is not usable, a cron that does not parse, a prompt path that
 *  would leave the project root. An unusable `model` or `since` drops
 *  that field, not the entry — the fire is what the entry is for. */
export function parseScheduleEntries(raw: unknown): ScheduleEntry[] {
  if (!Array.isArray(raw)) return [];
  const entries: ScheduleEntry[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== "object") continue;
    const e = item as Record<string, unknown>;
    const name = str(e.name);
    const cron = str(e.cron);
    const prompt = str(e.prompt);
    if (!name || !cron || !prompt) continue;
    if (!SCHEDULE_NAME_RE.test(name)) continue;
    if (escapesRoot(prompt)) continue;
    try {
      CronExpressionParser.parse(cron);
    } catch {
      continue;
    }
    // The name's shape is all that can be checked here — whether the
    // queue config grants the model is the queue's own answer, given at
    // enqueue time.
    const model = str(e.model);
    const since = str(e.since);
    entries.push({
      name, cron, prompt, enabled: e.enabled !== false,
      ...(model && SCHEDULE_NAME_RE.test(model) ? { model } : {}),
      ...(since && !isNaN(Date.parse(since)) ? { since } : {}),
    });
  }
  return entries;
}

const str = (v: unknown): string | undefined => (v == null ? undefined : String(v).trim() || undefined);

/** An entry as it is written: `enabled` only when it is `false`, the
 *  optional fields only when present. */
function serialize(entry: ScheduleEntry): Record<string, unknown> {
  return {
    name: entry.name, cron: entry.cron, prompt: entry.prompt,
    ...(entry.model ? { model: entry.model } : {}),
    ...(entry.since ? { since: entry.since } : {}),
    ...(entry.enabled ? {} : { enabled: false }),
  };
}

type Read = { ok: true; source: string; root: Record<string, unknown> } | { ok: false; error: string };

function read(file: string): Read {
  let source = "";
  try {
    if (existsSync(file)) source = readFileSync(file, "utf-8");
  } catch (err) {
    return { ok: false, error: `cannot read ${file}: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (source.trim() === "") return { ok: true, source, root: {} };
  const errors: ParseError[] = [];
  const raw = parse(source, errors, { allowTrailingComma: true }) as unknown;
  if (errors.length) return { ok: false, error: `${file} is not valid JSON, so its scheduled jobs cannot be read` };
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: `${file} is not a JSON object` };
  }
  return { ok: true, source, root: raw as Record<string, unknown> };
}

export function createScheduleStore(file: string | undefined): ScheduleStore {
  const said = new Set<string>();
  return {
    list(project) {
      if (!file) return [];
      const got = read(file);
      if (!got.ok) {
        const message = `${got.error} — no scheduled jobs`;
        if (!said.has(message)) {
          said.add(message);
          console.error(`schedule: ${message}`);
        }
        return [];
      }
      const schedules = got.root.schedules;
      if (schedules === null || typeof schedules !== "object" || Array.isArray(schedules)) return [];
      return parseScheduleEntries((schedules as Record<string, unknown>)[project]);
    },

    save(project, entries) {
      if (!file) return "this server has no --queue-config file, so scheduled jobs cannot be stored";
      const got = read(file);
      if (!got.ok) return got.error;
      const schedules = got.root.schedules;
      if (schedules !== undefined && (schedules === null || typeof schedules !== "object" || Array.isArray(schedules))) {
        return `${file} has a "schedules" key that is not an object, so a job cannot be stored in it`;
      }
      try {
        let source = got.source.trim() === "" ? "{}\n" : got.source;
        const value = entries.length > 0 ? entries.map(serialize) : undefined;
        source = applyEdits(source, modify(source, ["schedules", project], value, {
          formattingOptions: { insertSpaces: true, tabSize: 2 },
        }));
        mkdirSync(dirname(file), { recursive: true });
        const tmp = `${file}.tmp`;
        writeFileSync(tmp, source);
        renameSync(tmp, file);
        return null;
      } catch (err) {
        return `could not write ${file}: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
}
