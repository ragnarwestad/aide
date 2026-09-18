// A script is started through the interpreter its own first line names,
// never exec'd directly. macOS checks a freshly written executable the
// first time it is exec'd — 10 to 13 seconds on this host for a
// two-line script, for every new copy — while the same file read by
// `/bin/sh` starts at once. Every install and every test stub is a new
// file, so a landing's first run of each script, and every test that
// writes one, paid that wait.

import { closeSync, openSync, readSync } from "node:fs";

/** `argv` with its script's interpreter in front, when `argv[0]` is a
 *  file starting with `#!` — a bare name is looked up on `path` first,
 *  the PATH the spawn itself will get. Unchanged for a binary, a name
 *  PATH does not hold, or a file that cannot be read. The line is split
 *  the way the kernel splits it: the interpreter, then at most one
 *  argument (`/usr/bin/env bash`). */
export function scriptArgv(argv: string[], path: string | undefined = process.env.PATH): string[] {
  const [name, ...rest] = argv;
  if (!name) return argv;
  const file = name.includes("/") ? name : Bun.which(name, { PATH: path ?? "" });
  if (!file) return argv;
  let head = "";
  try {
    const fd = openSync(file, "r");
    try {
      const buf = Buffer.alloc(256);
      head = buf.subarray(0, readSync(fd, buf, 0, 256, 0)).toString("utf8");
    } finally {
      closeSync(fd);
    }
  } catch {
    return argv;
  }
  if (!head.startsWith("#!")) return argv;
  const line = (head.slice(2).split("\n")[0] ?? "").trim();
  if (!line) return argv;
  const gap = line.search(/\s/);
  const interpreter = gap < 0 ? [line] : [line.slice(0, gap), line.slice(gap).trim()];
  return [...interpreter, file, ...rest];
}
