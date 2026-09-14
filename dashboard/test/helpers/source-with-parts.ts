import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** A module's `index.ts` and, beside it, every other part in its
 *  directory — as one text.
 *
 *  Several of this repo's modules have grown past what a reader can hold
 *  and been split into several files under one directory (`spec-views/`,
 *  `routes/page-routes/`). A test that reads the SOURCE — where a
 *  function is called from, and from nowhere else — reads it through
 *  here, so a part moving between files is not a failure while a call
 *  appearing somewhere new still is. */
export function sourceWithParts(pathUnderSrc: string): string {
  const src = new URL("../../src", import.meta.url).pathname;
  const dir = join(src, pathUnderSrc);
  const parts = readdirSync(dir).filter((f) => f.endsWith(".ts") && f !== "index.ts").sort();
  return [readFileSync(join(dir, "index.ts"), "utf-8"), ...parts.map((f) => readFileSync(join(dir, f), "utf-8"))].join("\n");
}
