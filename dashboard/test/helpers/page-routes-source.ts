import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** `page-routes.ts` and the three route families it asks in turn, as one
 *  text.
 *
 *  The file was one 594-line function until 2026-09-04, when its route
 *  families moved into `handle-queue/page-routes/`. A test that reads
 *  the routes' own source — where a function is called from, and from
 *  nowhere else — reads it through here, so a family moving between
 *  files is not a failure while a call appearing somewhere new still is. */
export function pageRoutesSource(): string {
  const dir = new URL("../../src/serve/handle-queue/", import.meta.url).pathname;
  const parts = readdirSync(join(dir, "page-routes")).filter((f) => f.endsWith(".ts"));
  return [
    readFileSync(join(dir, "page-routes.ts"), "utf-8"),
    ...parts.map((f) => readFileSync(join(dir, "page-routes", f), "utf-8")),
  ].join("\n");
}
