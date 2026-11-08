// A kept round's directory outlives the round, and before this nothing
// removed it once its server was gone: eleven of them sat in the temp
// directory. The next round now removes every earlier round's directory
// that no process names any more, and leaves everything else alone.
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(import.meta.dir, "clean-earlier-rounds.sh");
const AIDE_CHECKOUT = join(import.meta.dir, "..", "..", "..");

let tmp = "";
afterEach(() => { if (tmp) rmSync(tmp, { recursive: true, force: true }); });

/** A directory shaped the way `run` leaves one behind. */
function roundDir(name: string): string {
  const d = join(tmp, name);
  mkdirSync(join(d, "specs-origin.git"), { recursive: true });
  writeFileSync(join(d, "queue-config.json"), "{}");
  writeFileSync(join(d, "serve.log"), "");
  return d;
}

function clean(): void {
  const r = Bun.spawnSync(["bash", "-c", `source "${SCRIPT}" && clean_earlier_rounds "$1" "$2"`, "_", tmp, AIDE_CHECKOUT]);
  expect(r.exitCode).toBe(0);
}

describe("a round removes what earlier rounds left behind", () => {
  test("an earlier round whose server is gone is removed", () => {
    tmp = mkdtempSync(join(tmpdir(), "clean-rounds-"));
    const gone = roundDir("tmp.gone123");
    clean();
    expect(existsSync(gone)).toBe(false);
  });

  test("a round whose server still runs is kept", () => {
    tmp = mkdtempSync(join(tmpdir(), "clean-rounds-"));
    const live = roundDir("tmp.live456");
    // Stands in for `serve.ts --root <dir>/root`: a process that names
    // the directory on its command line.
    const server = Bun.spawn(["bash", "-c", "sleep 30; :", "serve", "--root", `${live}/root`]);
    try {
      clean();
      expect(existsSync(live)).toBe(true);
    } finally {
      server.kill();
    }
  });

  test("a directory that is not a round's is left alone", () => {
    tmp = mkdtempSync(join(tmpdir(), "clean-rounds-"));
    const other = join(tmp, "tmp.other789");
    mkdirSync(other);
    writeFileSync(join(other, "serve.log"), "");
    clean();
    expect(existsSync(other)).toBe(true);
  });
});
