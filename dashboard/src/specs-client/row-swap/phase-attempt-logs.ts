const phaseLogDetails = (root: Element, selector: string): Element[] => {
  const query = (root as Element & { querySelectorAll?: (selector: string) => Iterable<Element> }).querySelectorAll;
  return query ? Array.from(query.call(root, selector)) : [];
};

export const openPhaseAttemptLogs = (roots: Element[]): Set<string> =>
  new Set(
    roots.flatMap((root) => phaseLogDetails(root, "details[data-phase-attempt-log][open]"))
      .map((details) => details.getAttribute("data-phase-attempt-log"))
      .filter((key): key is string => key !== null),
  );

export function reopenPhaseAttemptLogs(roots: Element[], open: ReadonlySet<string>): void {
  for (const details of roots.flatMap((root) => phaseLogDetails(root, "details[data-phase-attempt-log]"))) {
    if (open.has(details.getAttribute("data-phase-attempt-log") ?? "")) details.setAttribute("open", "");
  }
}

