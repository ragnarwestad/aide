/** The selected job may move up or down past the work that was waiting when
 *  the editor opened; every other entry keeps its order, and work that
 *  arrived since stays behind it. */
export function legalMove(issued: readonly string[], ids: readonly string[], target: string, opening: readonly string[]): boolean {
  if (!issued.includes(target) || ids.length !== issued.length || new Set(ids).size !== ids.length) return false;
  const others = issued.filter(id => id !== target);
  if (ids.filter(id => id !== target).some((id, i) => id !== others[i])) return false;
  const waiting = new Set(opening);
  return ids.slice(0, ids.indexOf(target)).every(id => waiting.has(id));
}
