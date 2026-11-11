// What more than one of the spec's own route families needs.
import { dirname, join } from "node:path";
import { STATE_FILE } from "../../../project/spec-names.ts";

/** The state file beside the status file path given. */
export const stateRelPath = (statusRelPath: string): string => join(dirname(statusRelPath), STATE_FILE);
