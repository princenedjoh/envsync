export { parseEnv, findDuplicates, type EnvEntry } from "./parse.js";
export { checkEnv, hasFailures, isKnownType, WARNINGS, type Issue, type IssueKind } from "./check.js";
export { buildExample, fillMissing, diffKeys, type KeyDiff } from "./sync.js";
export { findTargets, gitExposure, type EnvTarget, type GitExposure } from "./scan.js";
