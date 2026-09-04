import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** A source file and, beside it, every part in the directory of the same
 *  name — as one text.
 *
 *  Several of this repo's files have grown past what a reader can hold
 *  and been split into a directory beside them (`spec-views.ts` +
 *  `spec-views/`, `page-routes.ts` + `page-routes/`). A test that reads
 *  the SOURCE — where a function is called from, and from nowhere else —
 *  reads it through here, so a part moving between files is not a
 *  failure while a call appearing somewhere new still is. */
export function sourceWithParts(pathUnderSrc: string): string {
  const src = new URL("../../src/", import.meta.url).pathname;
  const file = join(src, `${pathUnderSrc}.ts`);
  const dir = join(src, pathUnderSrc);
  const parts = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".ts")).sort() : [];
  return [readFileSync(file, "utf-8"), ...parts.map((f) => readFileSync(join(dir, f), "utf-8"))].join("\n");
}
