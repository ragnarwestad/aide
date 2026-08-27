// Everything location-based lives here: the manifest scan, specs-root
// resolution (.aide/config AIDE_SPECS_PATH, else <project>/specs),
// walking the specs root AND archive/ (archived-ness is a directory
// fact), and each spec's title from 1-description.md's H1.
//
// Split by theme into discover/ (split discover.ts by theme):
// config.ts (a project's own config/manifest values), spec-files.ts
// (reading one spec's own files), depends-on.ts (the `Depends on:`
// line) and scan.ts (walking a projects root, and the types it
// produces). Kept as a barrel at this path because most of the server
// and the static generator import from it.

export {
  configValue, resolveWorktreeLinks, resolveCodeLanding, resolveSchedule,
  type WorktreeLinksSource, type CodeLanding,
} from "./discover/config.ts";

export {
  SPEC_FILES, specFileText, markdownSection, specDescription, specPhaseFile, specArchivedDate,
  specDurationMs, stampDuration,
} from "./discover/spec-files.ts";

export { specDependsOn, stripDependsOnLine, withDependsOnLine } from "./discover/depends-on.ts";

export {
  discoverProjects, discoverUnclaimedDirectories, gitignoreCandidates, buildProjectViews,
  type SpecRef, type DiscoveredProject, type OwnedSpecsRoot,
} from "./discover/scan.ts";
