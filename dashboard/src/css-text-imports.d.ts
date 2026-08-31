// TypeScript has no ambient type for a CSS module imported with Bun's
// `with { type: "text" }` attribute (`spec-editor-client.ts`) — without
// this, tsc sees an unresolvable module rather than the plain string
// Bun's bundler actually produces.
declare module "*.css" {
  const text: string;
  export default text;
}
