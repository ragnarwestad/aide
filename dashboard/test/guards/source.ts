// The sources a guard scans, read once each, with their comment lines left
// out: a comment that names a hook or a class draws nothing.
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The dashboard's root, where the globs below are rooted. */
export const ROOT = join(import.meta.dir, "..", "..");

/** A source's code, without the lines that are only a comment. */
export const code = (text: string): string =>
  text
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
    .join("\n");

/** Every file under `glob` (from the dashboard's root), as its code. */
export const read = (glob: string): { file: string; text: string }[] =>
  [...new Bun.Glob(glob).scanSync(ROOT)].map((file) => ({ file, text: code(readFileSync(join(ROOT, file), "utf8")) }));

/** The sources that write a page: the server's renderers and routes and
 *  the specs list's browser script, each set on its own and all three. */
export const pageSources = () => {
  const render = read("src/render/**/*.ts");
  const serve = read("src/serve/**/*.ts");
  const client = read("src/specs-client/**/*.ts");
  return { render, serve, client, all: [...render, ...serve, ...client] };
};
