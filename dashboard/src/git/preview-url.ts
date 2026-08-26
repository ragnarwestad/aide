// Where a pushed branch can be TRIED, as opposed to compared. A host
// that builds every branch serves each on an address of its own, and
// the rule for forming it is the project's own knowledge — it arrives
// as a template in `.aide/project.yaml`'s `deployment.preview`, with a
// literal `{branch}` in it. Only the substitution lives here.

/** A git branch name as a hostname label: `aide/95-x` is a name a
 *  person types, and `/` is not a character a label may carry. Lowercase
 *  (labels are case-insensitive, and a mixed-case one reads as two
 *  different addresses), every run of anything that is not a letter or a
 *  digit collapsed to ONE dash, cut at 28 characters (Cloudflare Pages'
 *  limit for a branch alias — a spec branch is longer, and a link built
 *  from the whole name points at nothing), and no dash at either end. */
const MAX_LABEL = 28;
function slug(branch: string): string {
  return branch
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, MAX_LABEL)
    .replace(/-+$/, "");
}

/** The preview address for `branch`, or `undefined` when there is none
 *  to give: a project that declares no template, or a branch name that
 *  slugs away to nothing (an address with an empty label is worse than
 *  no link at all).
 *
 *  A template WITHOUT `{branch}` is returned unchanged rather than
 *  refused. The manifest is reviewed team knowledge, so the failure to
 *  guard against is a page that breaks, not a link that always points
 *  at the same place. */
export function previewUrlFor(template: string | undefined, branch: string): string | undefined {
  if (!template) return undefined;
  const alias = slug(branch);
  if (!alias) return undefined;
  return template.replaceAll("{branch}", alias);
}
