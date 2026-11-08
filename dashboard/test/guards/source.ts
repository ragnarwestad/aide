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
