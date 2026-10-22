/** Superficie publica do engine. */

export { availableEncoders, resolveBinaries, type Binaries } from "./binaries";
export { familyFor, nearestAllowed, recommendVideoBitrate } from "./bitrate";
export {
  buildCommand,
  commandToString,
  type BuildOptions,
  type BuiltCommand,
  type FitMode,
} from "./command";
export {
  findDataDir,
  linkProfile,
  loadDatabase,
  type LinkPath,
  type PresetDatabase,
  type ProfileLink,
} from "./data";
export {
  baseConstraints,
  canonicalResolution,
  effectiveConstraints,
  formatResolution,
  limitMatches,
  parseResolution,
  type Constraints,
  type Selection,
} from "./limits";
export { decidePassthrough, type PassthroughDecision } from "./passthrough";
export { probeFile, type ProbeResult } from "./probe";
export {
  resolvePreset,
  type Note,
  type ResolvedPreset,
  type ResolveRequest,
  type SourceInfo,
  type UserChoices,
} from "./resolver";
export {
  runConversion,
  ConversionRun,
  type Progress,
  type RunOptions,
  type RunResult,
} from "./runner";
export type * from "./types";
