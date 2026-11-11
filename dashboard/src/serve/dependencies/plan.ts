import { dependsOnIn } from "../../project/discover/depends-on.ts";
import { resolveDependencyFolderName } from "../../project/spec-folder.ts";

export type DependencyChange = { dependencies: string[]; added: string[] } | { cycle: string[] } | { error: string };

export function planDependencies(source: string, additions: string[], descriptions: ReadonlyMap<string, string>): DependencyChange {
  const resolve = (id: string): string | undefined => resolveDependencyFolderName(descriptions.keys(), id);
  const own = descriptions.get(source);
  if (own === undefined) return { error: `No description for ${source}` };
  const dependencies = dependsOnIn(own);
  const existing = new Set(dependencies.map(resolve));
  const added: string[] = [];
  for (const id of additions) {
    const folder = resolve(id);
    if (!folder) return { error: `Unknown or ambiguous dependency: ${id}` };
    if (!existing.has(folder)) {
      dependencies.push(folder);
      added.push(folder);
      existing.add(folder);
    }
  }
  const checked = new Set<string>();
  let missing: string | undefined;
  const visit = (folder: string, path: string[]): string[] | undefined => {
    if (path.includes(folder)) return [...path, folder];
    if (checked.has(folder)) return undefined;
    const ids = folder === source ? dependencies : dependsOnIn(descriptions.get(folder)!);
    for (const id of ids) {
      const next = resolve(id);
      if (!next) { missing = `Unknown or ambiguous dependency: ${id}`; return undefined; }
      const cycle = visit(next, [...path, folder]);
      if (cycle) return cycle;
      if (missing) return undefined;
    }
    checked.add(folder);
    return undefined;
  };
  const cycle = visit(source, []);
  if (cycle) return { cycle };
  if (missing) return { error: missing };
  return { dependencies, added };
}
