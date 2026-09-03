// One fact per line. A spec's implement step appends a line here and a
// test under test/ that looks for it; two specs that both append make the
// merge conflict the archive step has to resolve.
export const facts: string[] = [
  "aide-test exists to exercise the machinery, not the model",
];
