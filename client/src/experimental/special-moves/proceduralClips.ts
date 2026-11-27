import * as THREE from "three";
import { EXPERIMENTAL_ARTS, type ExperimentalArtKind } from "./config";
import {
  composeBoneLocalQuaternion,
  type CanonicalBoneKey,
  type InspectedKayKitRig,
} from "./rigInspector";
import { buildExtraSekiroArtClips } from "./sekiroArtClips";

type Vec3Tuple = readonly [number, number, number];

interface PoseKeyframe {
  /** Time in seconds from clip start. */
  readonly t: number;
  /** Offset added to inspected `hips` rest position `[dx, dy, dz]` in meters. */
  readonly hipsOffset?: Vec3Tuple;
  /**
   * Optional explicit hips spin/tilt `[pitchXDeg, yawYDeg, rollZDeg]` in degrees.
   * For multi-revolution spins (> 180°), keyframes are spaced <= 140° apart so quaternion
   * slerp always advances smoothly in the intended spin direction without flipping.
   */
  readonly bones: Readonly<Partial<Record<CanonicalBoneKey, Vec3Tuple>>>;
}

/**
 * Neutral athletic sword-fighting stance relative to Knight.glb's T-pose rest pose.
 * Used as clean entry and recovery keyframes so crossFades to/from Idle and Running look natural.
 */
const MARTIAL_READY_POSE: Readonly<Partial<Record<CanonicalBoneKey, Vec3Tuple>>> = {
  hips: [0, 6, 0],
  spine: [6, 4, 0],
  chest: [4, -4, 0],
  head: [-6, -4, 0],
  "upperarm.r": [16, 12, 46],
  "lowerarm.r": [0, 52, 0],
  "hand.r": [0, 12, 0],
  "handslot.r": [0, 0, 0],
  "upperarm.l": [14, -18, -42],
  "lowerarm.l": [0, -56, 0],
  "hand.l": [0, -10, 0],
  "upperleg.l": [-12, -8, -4],
  "lowerleg.l": [20, 0, 0],
  "foot.l": [-8, 0, 0],
  "upperleg.r": [10, 6, 4],
  "lowerleg.r": [18, 0, 0],
  "foot.r": [-10, 0, 0],
};

function mergePose(
  overrides: Readonly<Partial<Record<CanonicalBoneKey, Vec3Tuple>>>
): Readonly<Partial<Record<CanonicalBoneKey, Vec3Tuple>>> {
  return { ...MARTIAL_READY_POSE, ...overrides };
}

/**
 * Builds a THREE.AnimationClip from character-space keyframe poses without ever mutating
 * any existing Knight.glb AnimationClip.
 *
 * Enforces quaternion hemisphere continuity (`dot(qPrev, qCurr) >= 0`) on every track
 * so cubic `THREE.InterpolateSmooth` never takes a spurious long-way-around flip.
 */
function compileProceduralClip(
  clipName: string,
  durationSec: number,
  rig: InspectedKayKitRig,
  keyframes: readonly PoseKeyframe[]
): THREE.AnimationClip {
  const tracks: THREE.KeyframeTrack[] = [];
  const times = keyframes.map((k) => k.t);

  // 1. Hips root translation track (relative to inspected rest pose)
  const hipsBone = rig.bones.get("hips");
  if (hipsBone) {
    const posValues: number[] = [];
    for (const kf of keyframes) {
      const off = kf.hipsOffset ?? [0, 0, 0];
      posValues.push(
        rig.hipsRestPosition.x + off[0],
        rig.hipsRestPosition.y + off[1],
        rig.hipsRestPosition.z + off[2]
      );
    }
    const posTrack = new THREE.VectorKeyframeTrack(
      `${hipsBone.runtimeName}.position`,
      times,
      posValues
    );
    if (times.length >= 3) {
      posTrack.setInterpolation(THREE.InterpolateSmooth);
    }
    tracks.push(posTrack);
  }

  // 2. Collect every canonical bone touched by any keyframe
  const usedBones = new Set<CanonicalBoneKey>();
  for (const kf of keyframes) {
    for (const key of Object.keys(kf.bones) as CanonicalBoneKey[]) {
      usedBones.add(key);
    }
  }

  // Always keep handslot.r locked to its inspected rest quaternion so sword grip stays rock solid
  if (rig.bones.has("handslot.r")) {
    usedBones.add("handslot.r");
  }

  const prevQuat = new THREE.Quaternion();
  const currQuat = new THREE.Quaternion();

  for (const canonicalKey of usedBones) {
    const bone = rig.bones.get(canonicalKey);
    if (!bone) continue;

    const quatValues: number[] = [];
    let hasPrev = false;

    for (const kf of keyframes) {
      const delta = kf.bones[canonicalKey] ?? MARTIAL_READY_POSE[canonicalKey] ?? [0, 0, 0];
      composeBoneLocalQuaternion(bone, delta, currQuat);

      // Keep consecutive quaternions in the same hemisphere to avoid 300-deg slerp flips
      if (hasPrev && prevQuat.dot(currQuat) < 0) {
        currQuat.set(-currQuat.x, -currQuat.y, -currQuat.z, -currQuat.w);
      }

      quatValues.push(currQuat.x, currQuat.y, currQuat.z, currQuat.w);
      prevQuat.copy(currQuat);
      hasPrev = true;
    }

    const qTrack = new THREE.QuaternionKeyframeTrack(
      `${bone.runtimeName}.quaternion`,
      times,
      quatValues
    );
    if (times.length >= 3) {
      qTrack.setInterpolation(THREE.InterpolateSmooth);
    }
    tracks.push(qTrack);
  }

  return new THREE.AnimationClip(clipName, durationSec, tracks);
}

/**
 * A. Sakura Dance (~1.65s)
 * Coiled momentum spin -> 3 consecutive leaping & spinning aerial sword slashes with distinct
 * blade trajectories (rising diagonal -> high inverted cross -> descending crescent) ->
 * controlled athletic landing & martial recovery.
 */
export function buildSakuraDanceClip(rig: InspectedKayKitRig): THREE.AnimationClip {
  const durationSec = EXPERIMENTAL_ARTS.sakura_dance.durationMs / 1000;

  const keyframes: PoseKeyframe[] = [
    // 0.00s: Ready stance entry
    {
      t: 0.0,
      hipsOffset: [0, -0.02, 0],
      bones: mergePose({}),
    },
    // 0.14s: Deep coiled momentum crouch before liftoff (wound right, blade low-right)
    {
      t: 0.14,
      hipsOffset: [0, -0.15, -0.06],
      bones: mergePose({
        hips: [14, -44, 6],
        spine: [18, -22, 4],
        chest: [12, -18, 4],
        head: [-16, 42, -4],
        "upperarm.r": [-10, -48, 56],
        "lowerarm.r": [0, 42, 0],
        "hand.r": [10, -18, -12],
        "upperarm.l": [22, -44, -22],
        "lowerarm.l": [0, -78, 0],
        "upperleg.l": [-48, -10, -6],
        "lowerleg.l": [68, 0, 0],
        "foot.l": [-20, 0, 0],
        "upperleg.r": [-32, 12, 8],
        "lowerleg.r": [58, 0, 0],
        "foot.r": [-22, 0, 0],
      }),
    },
    // 0.28s: Explosive upward spring + Slash 1 ignition (rising diagonal from low-right)
    {
      t: 0.28,
      hipsOffset: [0, 0.58, 0.14],
      bones: mergePose({
        hips: [-8, 72, -10],
        spine: [-6, 18, -6],
        chest: [-6, 22, -6],
        head: [4, -18, 6],
        "upperarm.r": [-24, 24, 18],
        "lowerarm.r": [0, 22, 0],
        "hand.r": [-18, 16, 12],
        "upperarm.l": [12, 24, -18],
        "lowerarm.l": [0, -58, 0],
        "upperleg.l": [-54, 0, -8],
        "lowerleg.l": [78, 0, 0],
        "foot.l": [24, 0, 0],
        "upperleg.r": [22, 0, 8],
        "lowerleg.r": [42, 0, 0],
        "foot.r": [28, 0, 0],
      }),
    },
    // 0.44s: Slash 1 follow-through (blade sweeping high-left across rising diagonal)
    {
      t: 0.44,
      hipsOffset: [0, 1.08, 0.22],
      bones: mergePose({
        hips: [-10, 192, -12],
        spine: [-4, 26, -8],
        chest: [-6, 28, -8],
        head: [8, -22, 8],
        "upperarm.r": [14, 72, -96],
        "lowerarm.r": [0, 18, 0],
        "hand.r": [-22, 28, 18],
        "upperarm.l": [-8, 38, -56],
        "lowerarm.l": [0, -44, 0],
        "upperleg.l": [-42, 0, -10],
        "lowerleg.l": [86, 0, 0],
        "foot.l": [26, 0, 0],
        "upperleg.r": [-62, 0, 10],
        "lowerleg.r": [74, 0, 0],
        "foot.r": [22, 0, 0],
      }),
    },
    // 0.62s: Peak airborne apex + Slash 2 launch (high inverted cross-slash)
    {
      t: 0.62,
      hipsOffset: [0, 1.46, 0.28],
      bones: mergePose({
        hips: [10, 312, 12],
        spine: [10, -16, 8],
        chest: [12, -24, 10],
        head: [-10, 16, -8],
        "upperarm.r": [-38, 42, -124],
        "lowerarm.r": [0, 26, 0],
        "hand.r": [18, -26, -14],
        "upperarm.l": [24, -46, 18],
        "lowerarm.l": [0, -64, 0],
        "upperleg.l": [-66, -8, -12],
        "lowerleg.l": [92, 0, 0],
        "foot.l": [28, 0, 0],
        "upperleg.r": [-28, 8, 12],
        "lowerleg.r": [82, 0, 0],
        "foot.r": [28, 0, 0],
      }),
    },
    // 0.80s: Slash 2 follow-through (wide horizontal-inverted arc out to right)
    {
      t: 0.8,
      hipsOffset: [0, 1.42, 0.32],
      bones: mergePose({
        hips: [14, 438, -8],
        spine: [12, 24, -6],
        chest: [14, 34, -8],
        head: [-12, -18, 6],
        "upperarm.r": [28, -32, -28],
        "lowerarm.r": [0, 14, 0],
        "hand.r": [12, 24, 16],
        "upperarm.l": [-18, 44, -38],
        "lowerarm.l": [0, -48, 0],
        "upperleg.l": [-36, 0, -10],
        "lowerleg.l": [84, 0, 0],
        "foot.l": [24, 0, 0],
        "upperleg.r": [-58, 0, 10],
        "lowerleg.r": [94, 0, 0],
        "foot.r": [26, 0, 0],
      }),
    },
    // 1.00s: Descending windup for Slash 3 (overhead crescent coil)
    {
      t: 1.0,
      hipsOffset: [0, 0.94, 0.36],
      bones: mergePose({
        hips: [-8, 566, -10],
        spine: [-10, -24, -6],
        chest: [-12, -26, -6],
        head: [10, 20, 6],
        "upperarm.r": [-26, 12, -138],
        "lowerarm.r": [0, 32, 0],
        "hand.r": [-24, 12, 0],
        "upperarm.l": [16, -34, -18],
        "lowerarm.l": [0, -68, 0],
        "upperleg.l": [-48, 0, -8],
        "lowerleg.l": [74, 0, 0],
        "foot.l": [14, 0, 0],
        "upperleg.r": [-20, 0, 8],
        "lowerleg.r": [54, 0, 0],
        "foot.r": [18, 0, 0],
      }),
    },
    // 1.18s: Slash 3 — Descending Crescent Cleave finishing low-left
    {
      t: 1.18,
      hipsOffset: [0, 0.22, 0.42],
      bones: mergePose({
        hips: [18, 694, 10],
        spine: [20, 26, 8],
        chest: [18, 32, 8],
        head: [-18, -32, -8],
        "upperarm.r": [22, 68, 52],
        "lowerarm.r": [0, 16, 0],
        "hand.r": [18, 22, -14],
        "upperarm.l": [-12, 42, -52],
        "lowerarm.l": [0, -36, 0],
        "upperleg.l": [-46, -12, -10],
        "lowerleg.l": [56, 0, 0],
        "foot.l": [-10, 0, 0],
        "upperleg.r": [16, 10, 10],
        "lowerleg.r": [46, 0, 0],
        "foot.r": [-12, 0, 0],
      }),
    },
    // 1.36s: Controlled landing absorption (720° = exact forward facing!)
    {
      t: 1.36,
      hipsOffset: [0, -0.14, 0.3],
      bones: mergePose({
        hips: [14, 728, 4],
        spine: [16, 14, 4],
        chest: [12, 16, 4],
        head: [-14, -18, -4],
        "upperarm.r": [14, 48, 58],
        "lowerarm.r": [0, 28, 0],
        "hand.r": [8, 14, -8],
        "upperarm.l": [12, -26, -34],
        "lowerarm.l": [0, -62, 0],
        "upperleg.l": [-44, -12, -10],
        "lowerleg.l": [64, 0, 0],
        "foot.l": [-18, 0, 0],
        "upperleg.r": [18, 12, 10],
        "lowerleg.r": [52, 0, 0],
        "foot.r": [-18, 0, 0],
      }),
    },
    // 1.65s: Martial recovery to neutral fighting stance
    {
      t: durationSec,
      hipsOffset: [0, -0.02, 0],
      bones: mergePose({
        hips: [0, 726, 0],
      }),
    },
  ];

  return compileProceduralClip(
    EXPERIMENTAL_ARTS.sakura_dance.clipName,
    durationSec,
    rig,
    keyframes
  );
}

/**
 * B. Mortal Draw / Empowered Mortal Draw (~1.35s normal / ~1.95s empowered)
 * Grounded charged sword-drawing stance with anticipation hold -> violent horizontal/diagonal
 * Mortal Blade draw -> (when empowered) rapid reverse coil + second massive follow-up draw ->
 * dramatic finishing hold & smooth recovery.
 */
export function buildMortalDrawClip(
  rig: InspectedKayKitRig,
  empowered = false
): THREE.AnimationClip {
  const spec = empowered && arguments.length > 1 && EXPERIMENTAL_ARTS.mortal_draw.clipName !== "Experimental_Mortal_Draw"
    ? EXPERIMENTAL_ARTS.mortal_draw_empowered
    : EXPERIMENTAL_ARTS.mortal_draw;
  const durationSec = spec.durationMs / 1000;

  if (!empowered) {
    const keyframes: PoseKeyframe[] = [
      // 0.00s: Ready stance entry
      {
        t: 0.0,
        hipsOffset: [0, -0.02, 0],
        bones: mergePose({}),
      },
      // 0.18s: Drop into grounded sword-drawing stance (hips low, coiled far right)
      {
        t: 0.18,
        hipsOffset: [-0.04, -0.14, -0.08],
        bones: mergePose({
          hips: [12, -42, 4],
          spine: [16, -24, 4],
          chest: [14, -22, 4],
          head: [-16, 48, -4],
          "upperarm.r": [-18, -56, 44],
          "lowerarm.r": [0, 68, 0],
          "hand.r": [16, -24, -14],
          "upperarm.l": [24, -52, -32],
          "lowerarm.l": [0, -82, 0],
          "upperleg.l": [-42, -14, -10],
          "lowerleg.l": [62, 0, 0],
          "foot.l": [-18, 0, 0],
          "upperleg.r": [14, 18, 12],
          "lowerleg.r": [54, 0, 0],
          "foot.r": [-18, 0, 0],
        }),
      },
      // 0.44s: Taut charged anticipation hold (maximum crimson coil)
      {
        t: 0.44,
        hipsOffset: [-0.06, -0.18, -0.12],
        bones: mergePose({
          hips: [16, -54, 6],
          spine: [20, -28, 6],
          chest: [18, -28, 6],
          head: [-22, 62, -6],
          "upperarm.r": [-24, -68, 48],
          "lowerarm.r": [0, 76, 0],
          "hand.r": [20, -30, -16],
          "upperarm.l": [28, -58, -36],
          "lowerarm.l": [0, -88, 0],
          "upperleg.l": [-48, -16, -12],
          "lowerleg.l": [70, 0, 0],
          "foot.l": [-20, 0, 0],
          "upperleg.r": [18, 22, 14],
          "lowerleg.r": [62, 0, 0],
          "foot.r": [-20, 0, 0],
        }),
      },
      // 0.54s: Explosive mid-draw whip across front (+Z)
      {
        t: 0.54,
        hipsOffset: [0.02, -0.09, 0.24],
        bones: mergePose({
          hips: [12, 18, -4],
          spine: [10, 22, -4],
          chest: [8, 28, -4],
          head: [-10, -24, 4],
          "upperarm.r": [8, 38, 4],
          "lowerarm.r": [0, 14, 0],
          "hand.r": [-12, 18, 10],
          "upperarm.l": [8, 28, -46],
          "lowerarm.l": [0, -48, 0],
          "upperleg.l": [-36, -8, -8],
          "lowerleg.l": [46, 0, 0],
          "foot.l": [-12, 0, 0],
          "upperleg.r": [28, 10, 10],
          "lowerleg.r": [38, 0, 0],
          "foot.r": [-12, 0, 0],
        }),
      },
      // 0.68s: Full violent Mortal Blade follow-through (blade swept wide far-left)
      {
        t: 0.68,
        hipsOffset: [0.06, -0.11, 0.34],
        bones: mergePose({
          hips: [14, 58, -8],
          spine: [12, 26, -6],
          chest: [10, 32, -8],
          head: [-14, -56, 6],
          "upperarm.r": [18, 86, -24],
          "lowerarm.r": [0, 12, 0],
          "hand.r": [-18, 32, 16],
          "upperarm.l": [-18, 48, -56],
          "lowerarm.l": [0, -34, 0],
          "upperleg.l": [-42, -10, -10],
          "lowerleg.l": [56, 0, 0],
          "foot.l": [-16, 0, 0],
          "upperleg.r": [34, 14, 12],
          "lowerleg.r": [40, 0, 0],
          "foot.r": [-14, 0, 0],
        }),
      },
      // 0.94s: Dramatic finishing hold (lingering heavy blade weight)
      {
        t: 0.94,
        hipsOffset: [0.04, -0.12, 0.3],
        bones: mergePose({
          hips: [12, 54, -6],
          spine: [10, 22, -4],
          chest: [8, 26, -6],
          head: [-12, -50, 4],
          "upperarm.r": [16, 78, -12],
          "lowerarm.r": [0, 18, 0],
          "hand.r": [-14, 24, 12],
          "upperarm.l": [-12, 38, -50],
          "lowerarm.l": [0, -42, 0],
          "upperleg.l": [-38, -10, -10],
          "lowerleg.l": [52, 0, 0],
          "foot.l": [-16, 0, 0],
          "upperleg.r": [28, 12, 10],
          "lowerleg.r": [38, 0, 0],
          "foot.r": [-14, 0, 0],
        }),
      },
      // 1.35s: Smooth recovery back to martial ready stance
      {
        t: durationSec,
        hipsOffset: [0, -0.02, 0],
        bones: mergePose({}),
      },
    ];

    return compileProceduralClip(spec.clipName, durationSec, rig, keyframes);
  }

  // Empowered Mortal Draw (~1.95s): Deep coil -> First colossal draw -> Rapid reverse coil -> Second colossal follow-up draw -> Hold -> Recovery
  const empoweredKeyframes: PoseKeyframe[] = [
    // 0.00s: Entry stance
    {
      t: 0.0,
      hipsOffset: [0, -0.02, 0],
      bones: mergePose({}),
    },
    // 0.18s: Drop into deep empowered draw coil
    {
      t: 0.18,
      hipsOffset: [-0.05, -0.16, -0.1],
      bones: mergePose({
        hips: [14, -48, 6],
        spine: [18, -26, 6],
        chest: [16, -26, 6],
        head: [-18, 54, -6],
        "upperarm.r": [-22, -62, 46],
        "lowerarm.r": [0, 72, 0],
        "hand.r": [18, -28, -16],
        "upperarm.l": [26, -56, -34],
        "lowerarm.l": [0, -86, 0],
        "upperleg.l": [-46, -16, -12],
        "lowerleg.l": [68, 0, 0],
        "foot.l": [-20, 0, 0],
        "upperleg.r": [16, 20, 14],
        "lowerleg.r": [60, 0, 0],
        "foot.r": [-20, 0, 0],
      }),
    },
    // 0.44s: Maximum Empowered Charge Hold
    {
      t: 0.44,
      hipsOffset: [-0.08, -0.2, -0.14],
      bones: mergePose({
        hips: [18, -60, 8],
        spine: [22, -30, 8],
        chest: [20, -32, 8],
        head: [-24, 68, -8],
        "upperarm.r": [-28, -74, 52],
        "lowerarm.r": [0, 80, 0],
        "hand.r": [22, -32, -18],
        "upperarm.l": [30, -64, -38],
        "lowerarm.l": [0, -92, 0],
        "upperleg.l": [-52, -18, -14],
        "lowerleg.l": [76, 0, 0],
        "foot.l": [-22, 0, 0],
        "upperleg.r": [22, 24, 16],
        "lowerleg.r": [68, 0, 0],
        "foot.r": [-22, 0, 0],
      }),
    },
    // 0.56s: First Massive Draw — mid-whip
    {
      t: 0.56,
      hipsOffset: [0.02, -0.09, 0.24],
      bones: mergePose({
        hips: [12, 22, -6],
        spine: [10, 26, -6],
        chest: [8, 32, -6],
        head: [-10, -28, 6],
        "upperarm.r": [10, 44, -4],
        "lowerarm.r": [0, 12, 0],
        "hand.r": [-14, 22, 12],
        "upperarm.l": [6, 32, -48],
        "lowerarm.l": [0, -44, 0],
        "upperleg.l": [-38, -8, -8],
        "lowerleg.l": [48, 0, 0],
        "foot.l": [-12, 0, 0],
        "upperleg.r": [30, 10, 10],
        "lowerleg.r": [38, 0, 0],
        "foot.r": [-12, 0, 0],
      }),
    },
    // 0.72s: First Massive Draw follow-through (blade sweeping high-left)
    {
      t: 0.72,
      hipsOffset: [0.08, -0.11, 0.34],
      bones: mergePose({
        hips: [14, 64, -10],
        spine: [12, 28, -8],
        chest: [10, 34, -10],
        head: [-14, -60, 8],
        "upperarm.r": [18, 92, -42],
        "lowerarm.r": [0, 14, 0],
        "hand.r": [-20, 34, 18],
        "upperarm.l": [-20, 52, -56],
        "lowerarm.l": [0, -32, 0],
        "upperleg.l": [-44, -10, -10],
        "lowerleg.l": [58, 0, 0],
        "foot.l": [-16, 0, 0],
        "upperleg.r": [36, 14, 12],
        "lowerleg.r": [42, 0, 0],
        "foot.r": [-14, 0, 0],
      }),
    },
    // 0.96s: Rapid Reverse Coil (blade lifted high over left shoulder, stepping into second lunge)
    {
      t: 0.96,
      hipsOffset: [0.1, -0.17, 0.28],
      bones: mergePose({
        hips: [10, 74, -12],
        spine: [6, 26, -10],
        chest: [4, 32, -10],
        head: [-10, -68, 10],
        "upperarm.r": [-28, 76, -118],
        "lowerarm.r": [0, 44, 0],
        "hand.r": [-24, 20, 14],
        "upperarm.l": [22, 34, -22],
        "lowerarm.l": [0, -74, 0],
        "upperleg.l": [-48, -14, -12],
        "lowerleg.l": [68, 0, 0],
        "foot.l": [-18, 0, 0],
        "upperleg.r": [24, 18, 14],
        "lowerleg.r": [56, 0, 0],
        "foot.r": [-16, 0, 0],
      }),
    },
    // 1.14s: Second Colossal Follow-Up Draw — mid-cleave right-to-left reversed (left-to-right sweep!)
    {
      t: 1.14,
      hipsOffset: [0.0, -0.08, 0.44],
      bones: mergePose({
        hips: [16, -6, 6],
        spine: [16, -18, 6],
        chest: [14, -24, 6],
        head: [-14, 18, -6],
        "upperarm.r": [24, 14, -18],
        "lowerarm.r": [0, 10, 0],
        "hand.r": [16, -16, -12],
        "upperarm.l": [12, -38, -28],
        "lowerarm.l": [0, -64, 0],
        "upperleg.l": [24, -12, -10],
        "lowerleg.l": [42, 0, 0],
        "foot.l": [-14, 0, 0],
        "upperleg.r": [-44, 12, 10],
        "lowerleg.r": [54, 0, 0],
        "foot.r": [-14, 0, 0],
      }),
    },
    // 1.32s: Second Colossal Draw — full brutal follow-through far right-low
    {
      t: 1.32,
      hipsOffset: [-0.08, -0.14, 0.52],
      bones: mergePose({
        hips: [18, -64, 12],
        spine: [18, -32, 10],
        chest: [16, -36, 10],
        head: [-18, 64, -10],
        "upperarm.r": [26, -74, 38],
        "lowerarm.r": [0, 12, 0],
        "hand.r": [24, -30, -18],
        "upperarm.l": [20, -62, -16],
        "lowerarm.l": [0, -76, 0],
        "upperleg.l": [38, -14, -12],
        "lowerleg.l": [46, 0, 0],
        "foot.l": [-14, 0, 0],
        "upperleg.r": [-50, 14, 12],
        "lowerleg.r": [66, 0, 0],
        "foot.r": [-18, 0, 0],
      }),
    },
    // 1.62s: Dramatic low finishing hold (sword trailing low-right)
    {
      t: 1.62,
      hipsOffset: [-0.06, -0.14, 0.44],
      bones: mergePose({
        hips: [14, -54, 8],
        spine: [14, -24, 6],
        chest: [12, -26, 6],
        head: [-14, 52, -6],
        "upperarm.r": [20, -62, 46],
        "lowerarm.r": [0, 18, 0],
        "hand.r": [16, -22, -12],
        "upperarm.l": [16, -48, -24],
        "lowerarm.l": [0, -68, 0],
        "upperleg.l": [30, -12, -10],
        "lowerleg.l": [44, 0, 0],
        "foot.l": [-14, 0, 0],
        "upperleg.r": [-42, 12, 10],
        "lowerleg.r": [58, 0, 0],
        "foot.r": [-16, 0, 0],
      }),
    },
    // 1.95s: Controlled martial recovery
    {
      t: durationSec,
      hipsOffset: [0, -0.02, 0],
      bones: mergePose({}),
    },
  ];

  return compileProceduralClip(spec.clipName, durationSec, rig, empoweredKeyframes);
}

/**
 * Convenience builder producing all 14 Sekiro Combat Art clips for a single inspected Knight rig.
 */
export function buildAllExperimentalClips(
  rig: InspectedKayKitRig
): Record<ExperimentalArtKind, THREE.AnimationClip> {
  return {
    sakura_dance: buildSakuraDanceClip(rig),
    mortal_draw: buildMortalDrawClip(rig, true),
    mortal_draw_empowered: buildMortalDrawClip(rig, true),
    ...buildExtraSekiroArtClips(rig),
  };
}
