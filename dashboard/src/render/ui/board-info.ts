// The identity of the process this server IS (spec 424): whether it is
// an ordinary board or a test one, and if so which spec/branch it
// serves. Set once, at boot, from the CLI flag that started this
// process (`ServerOptions.testBoardSpec`) — never per request, since a
// running server's own board identity is fixed for its whole process
// life. `shell.ts`'s `lastInstallWarning()` is this module's own
// precedent for reading process-lifetime state directly rather than
// threading it through `pageShell()`'s call sites.

export interface BoardInfo {
  specFolder: string;
  branch: string;
}

let current: BoardInfo | undefined;

/** Always called — including with `undefined` — by `createServer()` and
 *  `main()`'s own `generate` command. `bun test` runs many such calls in
 *  one process, and a merge/leave-if-set implementation would let an
 *  earlier test's board leak into a later, ordinary-server test. */
export function setBoardInfo(specFolder: string | undefined): void {
  current = specFolder ? { specFolder, branch: `aide/${specFolder}` } : undefined;
}

export function getBoardInfo(): BoardInfo | undefined {
  return current;
}
