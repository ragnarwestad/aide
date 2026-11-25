// A test file's throwaway folders: each one made through `make` is
// removed after the test that made it, so no test sees another's files.
import { afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Registers the `afterEach` removal in the calling file, and returns
 *  `make()`, which creates a new empty folder under the system's temp
 *  folder whose name starts with `prefix`. */
export function tempDirs(prefix: string): { make: () => string } {
  const dirs: string[] = [];
  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  });
  return {
    make: () => {
      const dir = mkdtempSync(join(tmpdir(), prefix));
      dirs.push(dir);
      return dir;
    },
  };
}
