// A Codex provider's shadow home: a folder of its own login that links the
// rest of a shared `CODEX_HOME`, so providers on one `CODEX_HOME` keep their
// sessions and settings in common while each stays logged in as itself.
// Everything but `auth.json` is linked in, when the shadow home lacks it.

import { existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, symlinkSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";

/** Entries a shadow home must share. One it already holds as its own (a
 *  copied Codex setup) would give it sessions or settings nobody else sees. */
const SHARED_BY_LINK = ["sessions", "config.toml"] as const;

/** Links the entries of `codexHome` into `shadowHome`, `auth.json` excepted.
 *  Returns the sentence saying why it cannot, or null when it is prepared. */
export function prepareShadowHome(codexHome: string, shadowHome: string): string | null {
  if (resolve(codexHome) === resolve(shadowHome)) {
    return `The shadow home ${shadowHome} must differ from the CODEX_HOME`;
  }
  if (!existsSync(codexHome)) return `${codexHome} is not there on the serving host`;
  try {
    mkdirSync(shadowHome, { recursive: true });
    // Made when missing, so the first session either provider starts lands
    // in the shared folder and not in one shadow home's own.
    mkdirSync(join(codexHome, "sessions"), { recursive: true });
    for (const name of SHARED_BY_LINK) {
      const own = join(shadowHome, name);
      if (existsSync(own) && !lstatSync(own).isSymbolicLink()) {
        return name === "sessions"
          ? `${shadowHome} has a sessions folder of its own — start from an empty folder and log in there again`
          : `${shadowHome} has a config.toml of its own — start from an empty folder and log in there again`;
      }
    }
    for (const name of readdirSync(codexHome)) {
      if (name === "auth.json") continue;
      const target = join(shadowHome, name);
      const wanted = join(codexHome, name);
      try {
        if (!lstatSync(target).isSymbolicLink() || readlinkSync(target) === wanted) continue;
        // A link left from another CODEX_HOME is pointed at this one.
        unlinkSync(target);
      } catch {
        // Not there yet.
      }
      symlinkSync(wanted, target);
    }
    return null;
  } catch (e) {
    return `${shadowHome} could not be prepared: ${(e as Error).message}`;
  }
}
