// The dashboard's TypeScript files, walked the same way by every check
// that reads the code itself.
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export function tsFilesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return tsFilesUnder(full);
    return name.endsWith(".ts") ? [full] : [];
  });
}
