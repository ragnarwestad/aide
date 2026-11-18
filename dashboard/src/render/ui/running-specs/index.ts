export interface SpecTabCounts { needsAttention: number; openSpecs: number }

let read: (() => SpecTabCounts) | undefined;

export function setSpecActivityCounts(source: (() => SpecTabCounts) | undefined): void {
  read = source;
}

export function readSpecActivityCounts(): SpecTabCounts {
  return read?.() ?? { needsAttention: 0, openSpecs: 0 };
}
