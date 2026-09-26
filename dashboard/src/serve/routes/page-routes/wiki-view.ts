// The Wiki tab's pages: found through the route context and read from the
// specs repository's default branch (`project/wiki/read.ts`). Called only
// when the tab is the one open, so no other tab pays for a git call.

import { refreshedRef } from "../../../git/branch-file.ts";
import { readWiki } from "../../../project/wiki/read.ts";
import type { WikiView } from "../../../project/wiki/types.ts";
import type { RoutesContext } from "..";

/** The wiki's list and the page the address names, or undefined when the
 *  project has no wiki on its default branch or the branch cannot be read —
 *  the tab is then drawn as it is without one. */
export async function wikiView(ctx: RoutesContext, project: string, requested: string | null): Promise<WikiView | undefined> {
  const dir = ctx.ownedSpecsRoot(project);
  if (!dir) return undefined;
  const top = await ctx.specsRoot(dir);
  const branch = await ctx.branchStatus.defaultBranch(top);
  if (!branch) {
    console.error(`wiki: ${project}'s specs repository has no default branch to read the wiki from`);
    return undefined;
  }
  const { ref } = await refreshedRef(ctx.gitRun, top, branch);
  if (!ref) return undefined;
  const view = await readWiki(ctx.gitRun, { project, top, dir, ref, projectDir: ctx.machineryProjectDir(project) }, requested);
  return view ?? undefined;
}
