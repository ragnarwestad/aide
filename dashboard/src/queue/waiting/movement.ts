/** One Deploy may cross predecessors, never its original successors or new arrivals. */
export function legalMove(issued: readonly string[], ids: readonly string[], target: string, opening: readonly string[]): boolean {
  if (!issued.includes(target) || ids.length !== issued.length || new Set(ids).size !== ids.length) return false;
  const others = issued.filter(id => id !== target);
  if (ids.filter(id => id !== target).some((id, i) => id !== others[i])) return false;
  const predecessors = new Set(opening.slice(0, opening.indexOf(target)));
  return ids.slice(0, ids.indexOf(target)).every(id => predecessors.has(id));
}
