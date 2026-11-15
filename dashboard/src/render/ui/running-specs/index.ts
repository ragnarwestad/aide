let read: (() => number) | undefined;

export function setRunningSpecCount(source: (() => number) | undefined): void {
  read = source;
}

export function readRunningSpecCount(): number {
  return read?.() ?? 0;
}
