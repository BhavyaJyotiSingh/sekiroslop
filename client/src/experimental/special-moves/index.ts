/**
 * Experimental Combat Arts — Public Barrel Export
 *
 * Completely isolated from core game files. To disable, set
 * `EXPERIMENTAL_SPECIAL_MOVES = false` in `./config.ts` or delete this folder.
 */

export {
  EXPERIMENTAL_SPECIAL_MOVES,
  EXPERIMENTAL_ARTS,
  EXPERIMENTAL_ART_ORDER,
  EXPERIMENTAL_ART_TREES,
  EXPERIMENTAL_PANEL_TOGGLE_KEY,
  EXPERIMENTAL_PANEL_TOGGLE_CODE,
  EXPERIMENTAL_CYCLE_PREV_CODE,
  EXPERIMENTAL_CYCLE_NEXT_CODE,
  EXPERIMENTAL_CAST_SELECTED_CODE,
  matchExperimentalArtKey,
  type ExperimentalArtTree,
  type ExperimentalArtKind,
  type ExperimentalArtSpec,
  type ExperimentalArtHitWindow,
} from "./config";

export {
  inspectKayKitRig,
  composeBoneLocalQuaternion,
  REQUIRED_BONES,
  ALL_TRACKED_BONES,
  type CanonicalBoneKey,
  type InspectedBone,
  type InspectedRigStatus,
  type InspectedKayKitRig,
} from "./rigInspector";

export {
  buildSakuraDanceClip,
  buildMortalDrawClip,
  buildAllExperimentalClips,
} from "./proceduralClips";

export {
  ExperimentalVFX,
  type ExperimentalVfxEvent,
  type ExperimentalVFXProps,
} from "./ExperimentalVFX";
