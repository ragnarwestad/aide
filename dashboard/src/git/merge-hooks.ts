/** What `mergeBranchIntoDefault` lets its caller do once the merge has
 *  reached origin and before the shared checkout is fast-forwarded to
 *  it. That fast-forward is what makes a landed folder visible — the
 *  page's watcher rescans on it — so whatever a reader must find already
 *  true at that moment is the caller's to settle in here. */
export interface MergeHooks {
  beforeCheckoutMoves?: (info: { assignedSpecFolder?: string }) => void | Promise<void>;
}
