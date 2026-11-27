import * as THREE from "three";
import { ATTACK_SPECS, COMBAT } from "@sekiroslop/shared";
import {
  composeBoneLocalQuaternion,
  type CanonicalBoneKey,
  type InspectedKayKitRig,
} from "../experimental/special-moves/rigInspector";

/**
 * Master toggle for Realistic Sekiro-Inspired Swordsmanship Animations on Player Gladiators.
 *
 * When `true`, player combat actions (`idle`, `block`, `light1`, `light2`, `heavy`, `thrust`,
 * `whirlwind`, `counter`, `aerial_slam`, `dodge`) play custom biomechanically-driven Three.js
 * AnimationClips built on Knight.glb's existing 41-bone skeleton (zero added bones, zero
 * mutation of original Knight.glb clips).
 *
 * Flip to `false` to instantly restore stock KayKit combat clips.
 */
export const SEKIRO_REALISTIC_ANIMATIONS = true;

export const SEKIRO_CLIP_NAMES = {
  idle: "Sekiro_Idle_Combat",
  jump: "Sekiro_Jump",
  block: "Sekiro_Block",
  light1: "Sekiro_Light1",
  light2: "Sekiro_Light2",
  heavy: "Sekiro_Heavy",
  thrust: "Sekiro_Thrust",
  whirlwind: "Sekiro_Whirlwind",
  counter: "Sekiro_Counter",
  aerial_slam: "Sekiro_Aerial_Slam",
  dodge: "Sekiro_Dodge",
  punch: "Sekiro_Punch",
} as const;

type Vec3Tuple = readonly [number, number, number];

type PhaseEasing =
  | "linear"
  | "easeIn"
  | "easeOut"
  | "easeInOut"
  | "snapCut"
  | "whip"
  | "coil"
  | "hold";

interface SekiroKeyframe {
  /** Time in seconds from clip start. */
  readonly t: number;
  /** Offset added to inspected `hips` rest position `[dx, dy, dz]` in meters. */
  readonly hipsOffset?: Vec3Tuple;
  /** Easing curve applied to the segment arriving AT this keyframe from the previous keyframe. */
  readonly ease?: PhaseEasing;
  /** Optional denser substep count for fast slashes/spins to prevent linear chord shortcuts. */
  readonly substeps?: number;
  /** Character-space Euler `[pitchXDeg, yawYDeg, rollZDeg]` (YXZ order) per bone. */
  readonly bones: Readonly<Partial<Record<CanonicalBoneKey, Vec3Tuple>>>;
}

function evalEasing(kind: PhaseEasing, u: number): number {
  const t = Math.max(0, Math.min(1, u));
  switch (kind) {
    case "linear":
      return t;
    case "easeIn":
      return t * t * t;
    case "easeOut":
      return 1 - Math.pow(1 - t, 3);
    case "easeInOut":
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    case "coil":
      return 1 - Math.pow(1 - t, 2.2);
    case "snapCut":
      // Blistering Sekiro acceleration through the cut, then hard arrest into zanshin
      return t < 0.32
        ? Math.pow(t / 0.32, 2.35) * 0.46
        : 0.46 + (1 - Math.pow(1 - (t - 0.32) / 0.68, 3.4)) * 0.54;
    case "whip":
      return t < 0.5
        ? 0.25 * Math.pow(t * 2, 2.4)
        : 0.25 + 0.75 * (1 - Math.pow(1 - (t - 0.5) * 2, 2.6));
    case "hold":
      return 0.5 - 0.5 * Math.cos(Math.PI * t);
  }
}

/**
 * Verified Knight.glb Character-Space Arm & Sword Kinematics (YXZ Euler order):
 *   +X = character's left, +Y = up, +Z = forward.
 *   In rest T-pose: right arm extends along -X, RomanGladius blade points straight +Y.
 *   - `upperarm.r`: rollZ (+Z lowers arm, -Z lifts arm overhead); yawY (+Y swings arm forward to +Z).
 *     Note: when hips/spine/chest lean forward (+X pitch), upperarm.r rollZ compensates negatively
 *     so the sword sweeps cleanly at true chest/shoulder height without ever clipping the arena sand.
 *   - `lowerarm.r`: yawY (+Y bends elbow forward/inward across chest).
 *   - `wrist.r` & `hand.r` (tenouchi): rollZ (+Z extends blade straight along the forearm line;
 *     -Z angles blade up-left across centerline for deflect guard); pitchX pronates/supinates edge angle.
 */
const CHUDAN_KAMAE_POSE: Readonly<Partial<Record<CanonicalBoneKey, Vec3Tuple>>> = {
  hips: [4, -18, 0],
  spine: [5, 8, 0],
  chest: [4, 10, 0],
  head: [-8, 0, 0],
  // Chudan-no-Kamae: right hand forward-right at chest height, blade aimed forward-up at enemy throat
  "upperarm.r": [0, 50, 18],
  "lowerarm.r": [0, 44, 0],
  "wrist.r": [0, 0, 18],
  "hand.r": [0, 0, 10],
  "handslot.r": [0, 0, 4],
  // Left off-hand / shield braced compactly at left ribs
  "upperarm.l": [0, -34, -52],
  "lowerarm.l": [0, -64, 0],
  "hand.l": [0, -10, 0],
  // Grounded staggered shinobi/gladiator footwork (left foot forward, right foot braced behind)
  "upperleg.l": [-18, -6, -4],
  "lowerleg.l": [28, 0, 0],
  "foot.l": [-10, 0, 0],
  "upperleg.r": [16, 10, 5],
  "lowerleg.r": [22, 0, 0],
  "foot.r": [-14, 0, 0],
};

function kamae(
  overrides: Readonly<Partial<Record<CanonicalBoneKey, Vec3Tuple>>>
): Readonly<Partial<Record<CanonicalBoneKey, Vec3Tuple>>> {
  return { ...CHUDAN_KAMAE_POSE, ...overrides };
}

function compileSekiroClip(
  clipName: string,
  durationSec: number,
  rig: InspectedKayKitRig,
  keyframes: readonly SekiroKeyframe[]
): THREE.AnimationClip {
  if (keyframes.length < 2) {
    return new THREE.AnimationClip(clipName, durationSec, []);
  }

  const usedBones = new Set<CanonicalBoneKey>();
  for (const kf of keyframes) {
    for (const key of Object.keys(kf.bones) as CanonicalBoneKey[]) {
      usedBones.add(key);
    }
  }

  const sampledTimes: number[] = [];
  const hipsPosValues: number[] = [];
  const boneQuatArrays = new Map<CanonicalBoneKey, number[]>();
  const prevQuatByBone = new Map<CanonicalBoneKey, THREE.Quaternion>();

  for (const key of usedBones) {
    if (rig.bones.has(key)) {
      boneQuatArrays.set(key, []);
    }
  }

  const qA = new THREE.Quaternion();
  const qB = new THREE.Quaternion();
  const qSlerp = new THREE.Quaternion();

  const pushSample = (
    t: number,
    hipsOff: readonly [number, number, number],
    bonesSample: ReadonlyMap<CanonicalBoneKey, THREE.Quaternion>
  ) => {
    sampledTimes.push(t);
    hipsPosValues.push(
      rig.hipsRestPosition.x + hipsOff[0],
      rig.hipsRestPosition.y + hipsOff[1],
      rig.hipsRestPosition.z + hipsOff[2]
    );
    for (const [key, arr] of boneQuatArrays.entries()) {
      const q = bonesSample.get(key);
      if (!q) continue;
      const prev = prevQuatByBone.get(key);
      if (prev && prev.dot(q) < 0) {
        q.set(-q.x, -q.y, -q.z, -q.w);
      }
      arr.push(q.x, q.y, q.z, q.w);
      if (prev) {
        prev.copy(q);
      } else {
        prevQuatByBone.set(key, q.clone());
      }
    }
  };

  {
    const kf0 = keyframes[0];
    const sampleMap = new Map<CanonicalBoneKey, THREE.Quaternion>();
    for (const key of boneQuatArrays.keys()) {
      const bone = rig.bones.get(key);
      if (!bone) continue;
      const q = new THREE.Quaternion();
      const delta = kf0.bones[key] ?? CHUDAN_KAMAE_POSE[key] ?? [0, 0, 0];
      composeBoneLocalQuaternion(bone, delta, q);
      sampleMap.set(key, q);
    }
    pushSample(kf0.t, kf0.hipsOffset ?? [0, 0, 0], sampleMap);
  }

  for (let i = 1; i < keyframes.length; i++) {
    const prevKf = keyframes[i - 1];
    const currKf = keyframes[i];
    const ease = currKf.ease ?? "easeInOut";
    const dt = Math.max(0.001, currKf.t - prevKf.t);
    const steps =
      currKf.substeps ??
      (ease === "snapCut" || ease === "whip" ? 6 : ease === "linear" ? 2 : 4);

    const prevOff = prevKf.hipsOffset ?? [0, 0, 0];
    const currOff = currKf.hipsOffset ?? [0, 0, 0];

    for (let s = 1; s <= steps; s++) {
      const u = s / steps;
      const e = evalEasing(ease, u);
      const t = prevKf.t + dt * u;

      const hx = prevOff[0] + (currOff[0] - prevOff[0]) * e;
      const hy = prevOff[1] + (currOff[1] - prevOff[1]) * e;
      const hz = prevOff[2] + (currOff[2] - prevOff[2]) * e;

      const sampleMap = new Map<CanonicalBoneKey, THREE.Quaternion>();

      for (const key of boneQuatArrays.keys()) {
        const bone = rig.bones.get(key);
        if (!bone) continue;
        const dA = prevKf.bones[key] ?? CHUDAN_KAMAE_POSE[key] ?? [0, 0, 0];
        const dB = currKf.bones[key] ?? CHUDAN_KAMAE_POSE[key] ?? [0, 0, 0];

        if (key === "hips" && Math.abs(dB[1] - dA[1]) > 95) {
          const rx = dA[0] + (dB[0] - dA[0]) * e;
          const ry = dA[1] + (dB[1] - dA[1]) * e;
          const rz = dA[2] + (dB[2] - dA[2]) * e;
          composeBoneLocalQuaternion(bone, [rx, ry, rz], qSlerp);
          sampleMap.set(key, qSlerp.clone());
        } else {
          composeBoneLocalQuaternion(bone, dA, qA);
          composeBoneLocalQuaternion(bone, dB, qB);
          if (qA.dot(qB) < 0) {
            qB.set(-qB.x, -qB.y, -qB.z, -qB.w);
          }
          qSlerp.copy(qA).slerp(qB, e).normalize();
          sampleMap.set(key, qSlerp.clone());
        }
      }

      pushSample(t, [hx, hy, hz], sampleMap);
    }
  }

  const tracks: THREE.KeyframeTrack[] = [];
  const hipsBone = rig.bones.get("hips");
  if (hipsBone) {
    tracks.push(
      new THREE.VectorKeyframeTrack(`${hipsBone.runtimeName}.position`, sampledTimes, hipsPosValues)
    );
  }

  for (const [key, values] of boneQuatArrays.entries()) {
    const bone = rig.bones.get(key);
    if (!bone || values.length === 0) continue;
    tracks.push(
      new THREE.QuaternionKeyframeTrack(`${bone.runtimeName}.quaternion`, sampledTimes, values)
    );
  }

  return new THREE.AnimationClip(clipName, durationSec, tracks);
}

/**
 * 1. Sekiro_Idle_Combat (2.4s loop) — Chudan-no-Kamae (Middle Guard)
 * Grounded athletic stance, blade tip aimed forward-up at enemy chest/throat.
 */
function buildSekiroIdleClip(rig: InspectedKayKitRig): THREE.AnimationClip {
  const duration = 2.4;
  return compileSekiroClip(SEKIRO_CLIP_NAMES.idle, duration, rig, [
    { t: 0.0, hipsOffset: [0, -0.04, 0], bones: kamae({}) },
    {
      t: 0.6,
      hipsOffset: [0, -0.025, 0.01],
      ease: "easeInOut",
      bones: kamae({
        spine: [3, 8, 0],
        chest: [2, 11, 0],
        head: [-6, 0, 0],
        "upperarm.r": [0, 52, 15],
        "lowerarm.r": [0, 46, 0],
        "wrist.r": [0, 0, 16],
        "upperarm.l": [0, -36, -49],
        "upperleg.l": [-16, -6, -4],
        "lowerleg.l": [25, 0, 0],
      }),
    },
    {
      t: 1.2,
      hipsOffset: [0, -0.048, -0.005],
      ease: "easeInOut",
      bones: kamae({
        spine: [6, 7, 0],
        chest: [5, 9, 0],
        head: [-9, 1, 0],
        "upperarm.r": [0, 48, 21],
        "lowerarm.r": [0, 42, 0],
        "wrist.r": [0, 0, 20],
        "upperarm.l": [0, -32, -54],
        "upperleg.l": [-20, -6, -4],
        "lowerleg.l": [31, 0, 0],
      }),
    },
    {
      t: 1.8,
      hipsOffset: [0, -0.028, 0.008],
      ease: "easeInOut",
      bones: kamae({
        spine: [4, 9, 0],
        chest: [3, 11, 0],
        "upperarm.r": [0, 51, 16],
        "lowerarm.r": [0, 45, 0],
        "wrist.r": [0, 0, 17],
      }),
    },
    { t: duration, hipsOffset: [0, -0.04, 0], ease: "easeInOut", bones: kamae({}) },
  ]);
}

/**
 * 2. Sekiro_Block (1.6s loop) — Crisp Sekiro Diagonal Steel Guard / Deflect Pose
 * Hilt held right-chest (`x ≈ -0.18, y ≈ 0.85, z ≈ 0.60`), blade angled cleanly UP-LEFT
 * across face & shoulder centerline (`tip x ≈ +0.42, y ≈ 1.75, z ≈ 0.72`) to deflect steel!
 */
function buildSekiroBlockClip(rig: InspectedKayKitRig): THREE.AnimationClip {
  const duration = 1.6;
  const guardBase = kamae({
    hips: [8, -14, 0],
    spine: [8, 6, -2],
    chest: [6, 8, -2],
    head: [-12, 2, 2],
    // Right elbow raised in front of right ribs, blade angled cleanly UP-LEFT across face/chest!
    "upperarm.r": [0, 68, 8],
    "lowerarm.r": [0, 56, 0],
    "wrist.r": [28, 0, 16],
    "hand.r": [14, 0, 8],
    "handslot.r": [6, 0, 4],
    // Left shield tucked cleanly beside blade
    "upperarm.l": [0, -56, -34],
    "lowerarm.l": [0, -78, 0],
    "hand.l": [0, -14, 0],
    // Rooted athletic knee brace
    "upperleg.l": [-26, -8, -5],
    "lowerleg.l": [42, 0, 0],
    "foot.l": [-16, 0, 0],
    "upperleg.r": [18, 12, 6],
    "lowerleg.r": [34, 0, 0],
    "foot.r": [-18, 0, 0],
  });

  const guardTense = kamae({
    hips: [10, -16, 0],
    spine: [9, 7, -3],
    chest: [7, 9, -3],
    head: [-13, 3, 2],
    "upperarm.r": [0, 70, 5],
    "lowerarm.r": [0, 58, 0],
    "wrist.r": [30, 0, 15],
    "hand.r": [15, 0, 8],
    "handslot.r": [6, 0, 4],
    "upperarm.l": [0, -58, -32],
    "lowerarm.l": [0, -80, 0],
    "hand.l": [0, -14, 0],
    "upperleg.l": [-28, -8, -5],
    "lowerleg.l": [45, 0, 0],
    "foot.l": [-17, 0, 0],
    "upperleg.r": [19, 12, 6],
    "lowerleg.r": [36, 0, 0],
    "foot.r": [-19, 0, 0],
  });

  return compileSekiroClip(SEKIRO_CLIP_NAMES.block, duration, rig, [
    { t: 0.0, hipsOffset: [0, -0.09, -0.02], bones: guardBase },
    { t: 0.8, hipsOffset: [0, -0.105, -0.03], ease: "easeInOut", bones: guardTense },
    { t: duration, hipsOffset: [0, -0.09, -0.02], ease: "easeInOut", bones: guardBase },
  ]);
}

/**
 * 3. Sekiro_Light1 (520ms = 160ms windup / 150ms active / 210ms recovery)
 * Kesa-Giri — Diagonal Right-to-Left Shoulder-to-Hip Cut:
 * High-Right (`x≈-1.1, y≈1.8`) -> Front Center (`x≈0.0, y≈1.0, z≈1.85`) -> Low-Left (`x≈+0.9, y≈0.45`).
 */
function buildSekiroLight1Clip(rig: InspectedKayKitRig): THREE.AnimationClip {
  const spec = ATTACK_SPECS.light1;
  const totalSec = (spec.windupMs + spec.activeMs + spec.recoveryMs) / 1000; // 0.52s

  return compileSekiroClip(SEKIRO_CLIP_NAMES.light1, totalSec, rig, [
    { t: 0.0, hipsOffset: [0, -0.04, 0], bones: kamae({}) },
    // 0.14s: High-right shoulder coil (sword raised high-right, wrist cocked back)
    {
      t: 0.14,
      hipsOffset: [-0.05, -0.05, -0.06],
      ease: "coil",
      substeps: 4,
      bones: kamae({
        hips: [6, -42, 4],
        spine: [4, -16, 4],
        chest: [0, -18, 4],
        head: [-6, 46, -4],
        "upperarm.r": [0, 26, -54],
        "lowerarm.r": [0, 34, 0],
        "wrist.r": [16, 0, 18],
        "hand.r": [10, 0, 10],
        "handslot.r": [4, 0, 4],
        "upperarm.l": [0, -44, -46],
        "lowerarm.l": [0, -76, 0],
        "upperleg.l": [-20, -10, -4],
        "lowerleg.l": [34, 0, 0],
        "upperleg.r": [18, 16, 6],
        "lowerleg.r": [30, 0, 0],
      }),
    },
    // 0.22s: Mid-active — blade whipping dead across front centerline (+Z, chest height ~1.0m!)
    {
      t: 0.22,
      hipsOffset: [0.02, -0.08, 0.14],
      ease: "snapCut",
      substeps: 6,
      bones: kamae({
        hips: [8, 10, -3],
        spine: [8, 14, -3],
        chest: [6, 18, -3],
        head: [-10, -16, 4],
        "upperarm.r": [0, 58, -22],
        "lowerarm.r": [0, 6, 0],
        "wrist.r": [34, 0, 42],
        "hand.r": [14, 0, 22],
        "handslot.r": [6, 0, 10],
        "upperarm.l": [0, 6, -56],
        "lowerarm.l": [0, -56, 0],
        "upperleg.l": [-32, -6, -5],
        "lowerleg.l": [46, 0, 0],
        "upperleg.r": [26, 8, 6],
        "lowerleg.r": [24, 0, 0],
      }),
    },
    // 0.31s: Low-left Kesa-Giri finish (blade swept cleanly across to low-left ABOVE sand!)
    {
      t: 0.31,
      hipsOffset: [0.06, -0.1, 0.2],
      ease: "easeOut",
      substeps: 4,
      bones: kamae({
        hips: [10, 42, -5],
        spine: [10, 18, -4],
        chest: [8, 20, -4],
        head: [-12, -40, 5],
        "upperarm.r": [0, 88, -18],
        "lowerarm.r": [0, 8, 0],
        "wrist.r": [36, 0, 42],
        "hand.r": [14, 0, 22],
        "handslot.r": [6, 0, 10],
        "upperarm.l": [0, 28, -56],
        "lowerarm.l": [0, -44, 0],
        "upperleg.l": [-36, -6, -6],
        "lowerleg.l": [50, 0, 0],
        "foot.l": [-14, 0, 0],
        "upperleg.r": [30, 8, 6],
        "lowerleg.r": [22, 0, 0],
      }),
    },
    // 0.40s: Crisp Zanshin pause holding low-left cut finish
    {
      t: 0.4,
      hipsOffset: [0.05, -0.09, 0.17],
      ease: "hold",
      substeps: 2,
      bones: kamae({
        hips: [9, 38, -4],
        spine: [9, 16, -4],
        chest: [7, 18, -4],
        head: [-11, -36, 4],
        "upperarm.r": [0, 84, -14],
        "lowerarm.r": [0, 12, 0],
        "wrist.r": [32, 0, 38],
        "hand.r": [12, 0, 20],
        "handslot.r": [4, 0, 8],
        "upperarm.l": [0, 20, -54],
        "lowerarm.l": [0, -48, 0],
        "upperleg.l": [-34, -6, -5],
        "lowerleg.l": [46, 0, 0],
        "upperleg.r": [28, 8, 6],
        "lowerleg.r": [24, 0, 0],
      }),
    },
    { t: totalSec, hipsOffset: [0, -0.04, 0], ease: "easeInOut", substeps: 4, bones: kamae({}) },
  ]);
}

/**
 * 4. Sekiro_Light2 (520ms = 150ms windup / 150ms active / 220ms recovery)
 * Gyaku-Kesa — Rising Reverse-Diagonal Cut:
 * Low-Left (`x≈+0.7, y≈0.45`) -> Front Center (`x≈0.0, y≈1.1, z≈1.85`) -> High-Right (`x≈-1.1, y≈1.85`).
 */
function buildSekiroLight2Clip(rig: InspectedKayKitRig): THREE.AnimationClip {
  const spec = ATTACK_SPECS.light2;
  const totalSec = (spec.windupMs + spec.activeMs + spec.recoveryMs) / 1000; // 0.52s

  return compileSekiroClip(SEKIRO_CLIP_NAMES.light2, totalSec, rig, [
    // 0.00s: Seamless low-left entry flowing out of Light1
    {
      t: 0.0,
      hipsOffset: [0.05, -0.09, 0.12],
      bones: kamae({
        hips: [9, 36, -4],
        spine: [9, 16, -4],
        chest: [7, 18, -4],
        head: [-11, -34, 4],
        "upperarm.r": [0, 82, -14],
        "lowerarm.r": [0, 12, 0],
        "wrist.r": [30, 0, 38],
        "hand.r": [12, 0, 18],
        "handslot.r": [4, 0, 8],
      }),
    },
    // 0.13s: Coiled low-left pocket (gathering hip spring torque, blade safely above sand!)
    {
      t: 0.13,
      hipsOffset: [0.07, -0.12, 0.06],
      ease: "coil",
      substeps: 4,
      bones: kamae({
        hips: [12, 48, -5],
        spine: [10, 20, -4],
        chest: [8, 22, -4],
        head: [-12, -46, 5],
        "upperarm.r": [0, 92, -16],
        "lowerarm.r": [0, 16, 0],
        "wrist.r": [-26, 0, 40],
        "hand.r": [-12, 0, 20],
        "handslot.r": [-6, 0, 8],
        "upperarm.l": [0, 24, -54],
        "lowerarm.l": [0, -48, 0],
        "upperleg.l": [-34, -8, -6],
        "lowerleg.l": [52, 0, 0],
        "upperleg.r": [22, 10, 6],
        "lowerleg.r": [36, 0, 0],
      }),
    },
    // 0.21s: Mid-active rising reverse slash cutting squarely across front centerline (+Z, y ≈ 1.1m!)
    {
      t: 0.21,
      hipsOffset: [0.0, -0.05, 0.18],
      ease: "snapCut",
      substeps: 6,
      bones: kamae({
        hips: [4, -4, 3],
        spine: [2, -8, 3],
        chest: [0, -10, 3],
        head: [-6, 10, -3],
        "upperarm.r": [0, 88, -24],
        "lowerarm.r": [0, 6, 0],
        "wrist.r": [-32, 0, 42],
        "hand.r": [-14, 0, 22],
        "handslot.r": [-6, 0, 10],
        "upperarm.l": [0, -24, -50],
        "lowerarm.l": [0, -66, 0],
        "upperleg.l": [-24, -6, -4],
        "lowerleg.l": [34, 0, 0],
        "upperleg.r": [22, 10, 6],
        "lowerleg.r": [20, 0, 0],
      }),
    },
    // 0.30s: High-right rising finish (blade cutting high-forward-right!)
    {
      t: 0.3,
      hipsOffset: [-0.06, -0.02, 0.22],
      ease: "easeOut",
      substeps: 4,
      bones: kamae({
        hips: [-2, -36, 5],
        spine: [-4, -14, 5],
        chest: [-6, -16, 5],
        head: [4, 34, -5],
        "upperarm.r": [0, 64, -54],
        "lowerarm.r": [0, 6, 0],
        "wrist.r": [-26, 0, 40],
        "hand.r": [-12, 0, 20],
        "handslot.r": [-6, 0, 10],
        "upperarm.l": [0, -46, -42],
        "lowerarm.l": [0, -78, 0],
        "upperleg.l": [-16, -6, -4],
        "lowerleg.l": [22, 0, 0],
        "upperleg.r": [28, 12, 6],
        "lowerleg.r": [26, 0, 0],
      }),
    },
    // 0.39s: Crisp Zanshin high-right arrest
    {
      t: 0.39,
      hipsOffset: [-0.04, -0.03, 0.18],
      ease: "hold",
      substeps: 2,
      bones: kamae({
        hips: [-1, -30, 4],
        spine: [-3, -12, 4],
        chest: [-5, -14, 4],
        head: [3, 28, -4],
        "upperarm.r": [0, 62, -44],
        "lowerarm.r": [0, 12, 0],
        "wrist.r": [-22, 0, 34],
        "hand.r": [-10, 0, 16],
        "handslot.r": [-4, 0, 8],
        "upperarm.l": [0, -40, -44],
        "lowerarm.l": [0, -72, 0],
      }),
    },
    { t: totalSec, hipsOffset: [0, -0.04, 0], ease: "easeInOut", substeps: 4, bones: kamae({}) },
  ]);
}

/**
 * 5. Sekiro_Heavy (830ms = 340ms windup / 180ms active / 310ms recovery)
 * Ichimonji-Inspired Overhead Splitting Cleave:
 * High centered overhead Jodan hold (`y ≈ 2.25m`) -> blazing vertical centerline split (`z ≈ 2.0m`)
 * -> heavy grounded arrest (`tip.y ≈ 0.30m` hovering inches above the Colosseum sand!).
 */
function buildSekiroHeavyClip(rig: InspectedKayKitRig): THREE.AnimationClip {
  const spec = ATTACK_SPECS.heavy;
  const totalSec = (spec.windupMs + spec.activeMs + spec.recoveryMs) / 1000; // 0.83s

  return compileSekiroClip(SEKIRO_CLIP_NAMES.heavy, totalSec, rig, [
    { t: 0.0, hipsOffset: [0, -0.04, 0], bones: kamae({}) },
    // 0.24s: High Jodan overhead draw (arm raised cleanly above crown!)
    {
      t: 0.24,
      hipsOffset: [0, 0.04, -0.08],
      ease: "coil",
      substeps: 5,
      bones: kamae({
        hips: [-8, -12, 0],
        spine: [-8, -6, 0],
        chest: [-10, -6, 0],
        head: [10, 12, 0],
        "upperarm.r": [0, 84, -90],
        "lowerarm.r": [0, 18, 0],
        "wrist.r": [0, 0, 30],
        "hand.r": [0, 0, 16],
        "handslot.r": [0, 0, 8],
        "upperarm.l": [0, -40, 62],
        "lowerarm.l": [0, -68, 0],
        "upperleg.l": [-14, -6, -4],
        "lowerleg.l": [22, 0, 0],
        "upperleg.r": [16, 8, 5],
        "lowerleg.r": [26, 0, 0],
      }),
    },
    // 0.33s: Tense Ichimonji apex hold (unmistakable dramatic heavy telegraph!)
    {
      t: 0.33,
      hipsOffset: [0, 0.06, -0.1],
      ease: "hold",
      substeps: 3,
      bones: kamae({
        hips: [-10, -14, 0],
        spine: [-10, -6, 0],
        chest: [-12, -6, 0],
        head: [12, 14, 0],
        "upperarm.r": [0, 86, -96],
        "lowerarm.r": [0, 22, 0],
        "wrist.r": [0, 0, 26],
        "hand.r": [0, 0, 14],
        "handslot.r": [0, 0, 6],
        "upperarm.l": [0, -44, 68],
        "lowerarm.l": [0, -74, 0],
        "upperleg.l": [-12, -6, -4],
        "lowerleg.l": [20, 0, 0],
        "upperleg.r": [18, 8, 5],
        "lowerleg.r": [30, 0, 0],
      }),
    },
    // 0.42s: Mid-active blazing vertical split straight through front centerline (+Z, y ≈ 1.15m!)
    {
      t: 0.42,
      hipsOffset: [0, -0.09, 0.18],
      ease: "snapCut",
      substeps: 6,
      bones: kamae({
        hips: [12, 4, 0],
        spine: [12, 4, 0],
        chest: [10, 4, 0],
        head: [-14, -4, 0],
        "upperarm.r": [0, 76, -34],
        "lowerarm.r": [0, 4, 0],
        "wrist.r": [0, 0, 48],
        "hand.r": [0, 0, 26],
        "handslot.r": [0, 0, 12],
        "upperarm.l": [0, -12, -52],
        "lowerarm.l": [0, -54, 0],
        "upperleg.l": [-38, -6, -5],
        "lowerleg.l": [54, 0, 0],
        "upperleg.r": [28, 8, 6],
        "lowerleg.r": [30, 0, 0],
      }),
    },
    // 0.52s: Ground-splitting low-center impact (blade tip hovering cleanly ~0.3m above sand, feet above y=0!)
    {
      t: 0.52,
      hipsOffset: [0.02, -0.14, 0.28],
      ease: "easeOut",
      substeps: 4,
      bones: kamae({
        hips: [14, 12, -2],
        spine: [12, 6, -2],
        chest: [10, 6, -2],
        head: [-18, -10, 2],
        "upperarm.r": [0, 72, -32],
        "lowerarm.r": [0, 4, 0],
        "wrist.r": [0, 0, 48],
        "hand.r": [0, 0, 26],
        "handslot.r": [0, 0, 12],
        "upperarm.l": [0, 16, -56],
        "lowerarm.l": [0, -44, 0],
        "upperleg.l": [-44, -6, -6],
        "lowerleg.l": [62, 0, 0],
        "foot.l": [-18, 0, 0],
        "upperleg.r": [32, 8, 6],
        "lowerleg.r": [38, 0, 0],
        "foot.r": [-14, 0, 0],
      }),
    },
    // 0.65s: Heavy grounded Zanshin hold absorbing impact shock
    {
      t: 0.65,
      hipsOffset: [0.02, -0.13, 0.24],
      ease: "hold",
      substeps: 3,
      bones: kamae({
        hips: [12, 10, -2],
        spine: [10, 5, -2],
        chest: [8, 5, -2],
        head: [-16, -8, 2],
        "upperarm.r": [0, 72, -30],
        "lowerarm.r": [0, 8, 0],
        "wrist.r": [0, 0, 44],
        "hand.r": [0, 0, 22],
        "handslot.r": [0, 0, 10],
        "upperarm.l": [0, 10, -56],
        "lowerarm.l": [0, -48, 0],
        "upperleg.l": [-44, -6, -6],
        "lowerleg.l": [64, 0, 0],
        "foot.l": [-18, 0, 0],
        "upperleg.r": [32, 8, 6],
        "lowerleg.r": [38, 0, 0],
      }),
    },
    { t: totalSec, hipsOffset: [0, -0.04, 0], ease: "easeInOut", substeps: 5, bones: kamae({}) },
  ]);
}

/**
 * 6. Sekiro_Thrust (700ms = 240ms windup / 200ms active / 260ms recovery)
 * Shadowrush / Imperial Piercing Lunge:
 * Low coiled sideways crouch with elbow pulled back by ribs -> blistering dead-straight
 * chest-height piercing lunge (`tip.y ≈ 1.0m, tip.z ≈ 2.4m, dir ≈ [0, 0, +1]`)!
 */
function buildSekiroThrustClip(rig: InspectedKayKitRig): THREE.AnimationClip {
  const spec = ATTACK_SPECS.thrust;
  const totalSec = (spec.windupMs + spec.activeMs + spec.recoveryMs) / 1000; // 0.70s

  return compileSekiroClip(SEKIRO_CLIP_NAMES.thrust, totalSec, rig, [
    { t: 0.0, hipsOffset: [0, -0.04, 0], bones: kamae({}) },
    // 0.22s: Coiled low sideways crouch — blade drawn back tight at right hip/ribs aimed dead-ahead (+Z)!
    {
      t: 0.22,
      hipsOffset: [-0.04, -0.15, -0.14],
      ease: "coil",
      substeps: 5,
      bones: kamae({
        hips: [12, -46, 3],
        spine: [10, -10, 2],
        chest: [8, -8, 2],
        head: [-14, 52, -3],
        "upperarm.r": [0, -34, 24],
        "lowerarm.r": [0, 118, 0],
        "wrist.r": [0, 0, 48],
        "hand.r": [0, 0, 28],
        "handslot.r": [0, 0, 12],
        "upperarm.l": [0, -46, -42],
        "lowerarm.l": [0, -72, 0],
        "upperleg.l": [-44, -14, -6],
        "lowerleg.l": [68, 0, 0],
        "foot.l": [-22, 0, 0],
        "upperleg.r": [22, 18, 6],
        "lowerleg.r": [54, 0, 0],
        "foot.r": [-24, 0, 0],
      }),
    },
    // 0.34s: Explosive straight-line lunge pierce — dead-horizontal chest-level lance (`z ≈ 2.4m`)!
    {
      t: 0.34,
      hipsOffset: [0.02, -0.11, 0.44],
      ease: "snapCut",
      substeps: 6,
      bones: kamae({
        hips: [14, 16, -2],
        spine: [12, 8, -2],
        chest: [10, 10, -2],
        head: [-18, -26, 2],
        // Upperarm compensates -38° for torso forward lean so arm & blade extend DEAD LEVEL (+Z)!
        "upperarm.r": [0, 56, -38],
        "lowerarm.r": [0, 2, 0],
        "wrist.r": [0, 0, 48],
        "hand.r": [0, 0, 28],
        "handslot.r": [0, 0, 12],
        "upperarm.l": [0, 34, -44],
        "lowerarm.l": [0, -24, 0],
        "upperleg.l": [-52, -4, -5],
        "lowerleg.l": [56, 0, 0],
        "foot.l": [-12, 0, 0],
        "upperleg.r": [48, 8, 6],
        "lowerleg.r": [12, 0, 0],
        "foot.r": [16, 0, 0],
      }),
    },
    // 0.48s: Crisp extended piercing lance hold
    {
      t: 0.48,
      hipsOffset: [0.02, -0.12, 0.42],
      ease: "hold",
      substeps: 3,
      bones: kamae({
        hips: [14, 14, -2],
        spine: [11, 8, -2],
        chest: [9, 9, -2],
        head: [-17, -24, 2],
        "upperarm.r": [0, 58, -36],
        "lowerarm.r": [0, 4, 0],
        "wrist.r": [0, 0, 46],
        "hand.r": [0, 0, 26],
        "handslot.r": [0, 0, 12],
        "upperarm.l": [0, 28, -46],
        "lowerarm.l": [0, -30, 0],
        "upperleg.l": [-50, -4, -5],
        "lowerleg.l": [54, 0, 0],
        "upperleg.r": [46, 8, 6],
        "lowerleg.r": [14, 0, 0],
      }),
    },
    { t: totalSec, hipsOffset: [0, -0.04, 0], ease: "easeInOut", substeps: 5, bones: kamae({}) },
  ]);
}

/**
 * 7. Sekiro_Whirlwind (740ms = 210ms windup / 260ms active / 270ms recovery)
 * Ashina Whirlwind 360° Cyclone Slash:
 * Level 2.0m horizontal hurricane sweep around the entire gladiator -> athletic counter-twist finish!
 */
function buildSekiroWhirlwindClip(rig: InspectedKayKitRig): THREE.AnimationClip {
  const spec = ATTACK_SPECS.whirlwind;
  const totalSec = (spec.windupMs + spec.activeMs + spec.recoveryMs) / 1000; // 0.74s

  const spinPose = (yawDeg: number) =>
    kamae({
      hips: [8, yawDeg, -3],
      spine: [6, 12, -2],
      chest: [6, 16, -2],
      head: [-8, -14, 2],
      // Blade extended dead-flat horizontally at chest height (radius ~2.0m!)
      "upperarm.r": [0, 16, -6],
      "lowerarm.r": [0, 4, 0],
      "wrist.r": [90, 0, 48],
      "hand.r": [0, 0, 28],
      "handslot.r": [0, 0, 12],
      "upperarm.l": [0, -50, -46],
      "lowerarm.l": [0, -82, 0],
      "upperleg.l": [-34, -8, -6],
      "lowerleg.l": [50, 0, 0],
      "upperleg.r": [24, 10, 6],
      "lowerleg.r": [40, 0, 0],
    });

  return compileSekiroClip(SEKIRO_CLIP_NAMES.whirlwind, totalSec, rig, [
    { t: 0.0, hipsOffset: [0, -0.04, 0], bones: kamae({}) },
    // 0.18s: Low coiled right pivot ready to whip into 360° spin
    {
      t: 0.18,
      hipsOffset: [-0.05, -0.14, -0.05],
      ease: "coil",
      substeps: 4,
      bones: kamae({
        hips: [10, -56, 4],
        spine: [8, -20, 3],
        chest: [8, -22, 3],
        head: [-12, 54, -4],
        "upperarm.r": [0, -18, 2],
        "lowerarm.r": [0, 16, 0],
        "wrist.r": [90, 0, 46],
        "hand.r": [0, 0, 26],
        "handslot.r": [0, 0, 12],
        "upperarm.l": [0, -44, -44],
        "lowerarm.l": [0, -78, 0],
        "upperleg.l": [-38, -10, -6],
        "lowerleg.l": [58, 0, 0],
        "upperleg.r": [22, 14, 6],
        "lowerleg.r": [46, 0, 0],
      }),
    },
    { t: 0.28, hipsOffset: [0.02, -0.12, 0.12], ease: "linear", substeps: 5, bones: spinPose(72) },
    { t: 0.38, hipsOffset: [0.0, -0.1, 0.16], ease: "linear", substeps: 5, bones: spinPose(212) },
    // 0.48s: Explosive 360° finish sweeping cleanly across waist/chest height (+Z, +X)!
    {
      t: 0.48,
      hipsOffset: [0.05, -0.13, 0.2],
      ease: "easeOut",
      substeps: 5,
      bones: kamae({
        hips: [10, 366, -4],
        spine: [10, 20, -3],
        chest: [8, 22, -3],
        head: [-10, -32, 4],
        "upperarm.r": [0, 82, -22],
        "lowerarm.r": [0, 10, 0],
        "wrist.r": [68, 0, 44],
        "hand.r": [14, 0, 22],
        "handslot.r": [6, 0, 10],
        "upperarm.l": [0, 22, -52],
        "lowerarm.l": [0, -46, 0],
        "upperleg.l": [-40, -8, -6],
        "lowerleg.l": [58, 0, 0],
        "upperleg.r": [28, 10, 6],
        "lowerleg.r": [34, 0, 0],
      }),
    },
    // 0.58s: Planted athletic brake & zanshin
    {
      t: 0.58,
      hipsOffset: [0.04, -0.11, 0.16],
      ease: "hold",
      substeps: 3,
      bones: kamae({
        hips: [8, 358, -3],
        spine: [8, 16, -2],
        chest: [6, 18, -2],
        head: [-8, -28, 3],
        "upperarm.r": [0, 76, -18],
        "lowerarm.r": [0, 16, 0],
        "wrist.r": [50, 0, 38],
        "hand.r": [12, 0, 18],
        "handslot.r": [4, 0, 8],
      }),
    },
    {
      t: totalSec,
      hipsOffset: [0, -0.04, 0],
      ease: "easeInOut",
      substeps: 4,
      bones: kamae({ hips: [4, 342, 0] }),
    },
  ]);
}

/**
 * 8. Sekiro_Counter (470ms = 100ms windup / 170ms active / 200ms recovery)
 * Deflect Riposte Snap — blistering chest-level horizontal-diagonal counter cut (`y ≈ 1.0m, z ≈ 2.0m`)!
 */
function buildSekiroCounterClip(rig: InspectedKayKitRig): THREE.AnimationClip {
  const spec = ATTACK_SPECS.counter;
  const totalSec = (spec.windupMs + spec.activeMs + spec.recoveryMs) / 1000; // 0.47s

  return compileSekiroClip(SEKIRO_CLIP_NAMES.counter, totalSec, rig, [
    // 0.00s: Deflect guard clash entry
    {
      t: 0.0,
      hipsOffset: [0, -0.09, -0.02],
      bones: kamae({
        hips: [8, -20, 2],
        spine: [8, -6, 2],
        chest: [6, -6, 2],
        "upperarm.r": [0, 56, -4],
        "lowerarm.r": [0, 52, 0],
        "wrist.r": [18, 0, -18],
        "hand.r": [8, 0, -10],
        "handslot.r": [4, 0, -4],
      }),
    },
    // 0.09s: Instant right-flank riposte coil (90ms!)
    {
      t: 0.09,
      hipsOffset: [-0.05, -0.11, -0.06],
      ease: "coil",
      substeps: 3,
      bones: kamae({
        hips: [10, -48, 4],
        spine: [8, -18, 3],
        chest: [6, -18, 3],
        head: [-10, 48, -4],
        "upperarm.r": [0, 8, -10],
        "lowerarm.r": [0, 28, 0],
        "wrist.r": [74, 0, 38],
        "hand.r": [12, 0, 20],
        "handslot.r": [4, 0, 8],
        "upperarm.l": [0, -44, -44],
        "lowerarm.l": [0, -76, 0],
        "upperleg.l": [-30, -8, -5],
        "lowerleg.l": [46, 0, 0],
      }),
    },
    // 0.17s: Blistering chest-height riposte slicing cleanly across center (+Z, y ≈ 1.05m!)
    {
      t: 0.17,
      hipsOffset: [0.02, -0.09, 0.24],
      ease: "snapCut",
      substeps: 6,
      bones: kamae({
        hips: [10, 16, -3],
        spine: [8, 16, -3],
        chest: [6, 20, -3],
        head: [-10, -20, 4],
        "upperarm.r": [0, 58, -24],
        "lowerarm.r": [0, 6, 0],
        "wrist.r": [74, 0, 46],
        "hand.r": [14, 0, 26],
        "handslot.r": [6, 0, 12],
        "upperarm.l": [0, 18, -50],
        "lowerarm.l": [0, -46, 0],
        "upperleg.l": [-40, -6, -5],
        "lowerleg.l": [52, 0, 0],
        "upperleg.r": [34, 8, 6],
        "lowerleg.r": [18, 0, 0],
      }),
    },
    // 0.27s: Vicious follow-through across left flank (cleanly chest/waist height!)
    {
      t: 0.27,
      hipsOffset: [0.07, -0.11, 0.3],
      ease: "easeOut",
      substeps: 4,
      bones: kamae({
        hips: [12, 50, -5],
        spine: [10, 20, -4],
        chest: [8, 22, -4],
        head: [-12, -46, 5],
        "upperarm.r": [0, 88, -26],
        "lowerarm.r": [0, 6, 0],
        "wrist.r": [70, 0, 46],
        "hand.r": [14, 0, 26],
        "handslot.r": [6, 0, 12],
        "upperarm.l": [0, 32, -52],
        "lowerarm.l": [0, -38, 0],
        "upperleg.l": [-42, -6, -6],
        "lowerleg.l": [56, 0, 0],
        "upperleg.r": [36, 8, 6],
        "lowerleg.r": [20, 0, 0],
      }),
    },
    // 0.35s: Sharp Zanshin hold
    {
      t: 0.35,
      hipsOffset: [0.05, -0.09, 0.24],
      ease: "hold",
      substeps: 2,
      bones: kamae({
        hips: [10, 42, -4],
        spine: [8, 16, -3],
        chest: [6, 18, -3],
        head: [-10, -38, 4],
        "upperarm.r": [0, 84, -20],
        "lowerarm.r": [0, 12, 0],
        "wrist.r": [58, 0, 40],
        "hand.r": [12, 0, 20],
        "handslot.r": [4, 0, 10],
      }),
    },
    { t: totalSec, hipsOffset: [0, -0.04, 0], ease: "easeInOut", substeps: 4, bones: kamae({}) },
  ]);
}

/**
 * 9. Sekiro_Aerial_Slam (650ms = 160ms windup / 210ms active / 280ms recovery)
 * Mid-Air Plunge Cleave — tucked overhead airborne arch -> violent vertical centerline plunge!
 */
function buildSekiroAerialSlamClip(rig: InspectedKayKitRig): THREE.AnimationClip {
  const spec = ATTACK_SPECS.aerial_slam;
  const totalSec = (spec.windupMs + spec.activeMs + spec.recoveryMs) / 1000; // 0.65s

  return compileSekiroClip(SEKIRO_CLIP_NAMES.aerial_slam, totalSec, rig, [
    { t: 0.0, hipsOffset: [0, 0.06, 0], bones: kamae({}) },
    // 0.16s: Airborne coiled overhead arch
    {
      t: 0.16,
      hipsOffset: [0, 0.16, -0.06],
      ease: "coil",
      substeps: 4,
      bones: kamae({
        hips: [-12, -10, 0],
        spine: [-12, -5, 0],
        chest: [-12, -5, 0],
        head: [14, 8, 0],
        "upperarm.r": [0, 84, -96],
        "lowerarm.r": [0, 22, 0],
        "wrist.r": [0, 0, 24],
        "hand.r": [0, 0, 12],
        "handslot.r": [0, 0, 6],
        "upperarm.l": [0, -40, 68],
        "lowerarm.l": [0, -68, 0],
        "upperleg.l": [-56, -6, -6],
        "lowerleg.l": [92, 0, 0],
        "foot.l": [20, 0, 0],
        "upperleg.r": [-42, 6, 6],
        "lowerleg.r": [84, 0, 0],
        "foot.r": [22, 0, 0],
      }),
    },
    // 0.25s: Mid-plunge blazing vertical front sweep (+Z!)
    {
      t: 0.25,
      hipsOffset: [0, -0.04, 0.14],
      ease: "snapCut",
      substeps: 5,
      bones: kamae({
        hips: [10, 4, 0],
        spine: [10, 4, 0],
        chest: [8, 4, 0],
        head: [-12, -4, 0],
        "upperarm.r": [0, 78, -32],
        "lowerarm.r": [0, 4, 0],
        "wrist.r": [0, 0, 48],
        "hand.r": [0, 0, 26],
        "handslot.r": [0, 0, 12],
        "upperarm.l": [0, -10, -52],
        "lowerarm.l": [0, -52, 0],
        "upperleg.l": [-48, -8, -6],
        "lowerleg.l": [78, 0, 0],
        "upperleg.r": [14, 8, 6],
        "lowerleg.r": [58, 0, 0],
      }),
    },
    // 0.35s: Grounded plunge impact (tip slammed down to ~0.22m above arena sand!)
    {
      t: 0.35,
      hipsOffset: [0, -0.15, 0.26],
      ease: "easeOut",
      substeps: 4,
      bones: kamae({
        hips: [14, 8, -2],
        spine: [12, 5, -2],
        chest: [10, 5, -2],
        head: [-20, -8, 2],
        "upperarm.r": [0, 74, -36],
        "lowerarm.r": [0, 4, 0],
        "wrist.r": [0, 0, 48],
        "hand.r": [0, 0, 26],
        "handslot.r": [0, 0, 12],
        "upperarm.l": [0, 18, -56],
        "lowerarm.l": [0, -40, 0],
        "upperleg.l": [-56, -8, -8],
        "lowerleg.l": [86, 0, 0],
        "foot.l": [-24, 0, 0],
        "upperleg.r": [30, 10, 8],
        "lowerleg.r": [62, 0, 0],
        "foot.r": [-18, 0, 0],
      }),
    },
    // 0.47s: Grounded impact kneel hold
    {
      t: 0.47,
      hipsOffset: [0, -0.13, 0.22],
      ease: "hold",
      substeps: 3,
      bones: kamae({
        hips: [12, 6, -2],
        spine: [10, 4, -2],
        chest: [8, 4, -2],
        head: [-18, -6, 2],
        "upperarm.r": [0, 72, -32],
        "lowerarm.r": [0, 8, 0],
        "wrist.r": [0, 0, 44],
        "hand.r": [0, 0, 22],
        "handslot.r": [0, 0, 10],
        "upperleg.l": [-50, -8, -6],
        "lowerleg.l": [78, 0, 0],
        "upperleg.r": [28, 10, 6],
        "lowerleg.r": [56, 0, 0],
      }),
    },
    { t: totalSec, hipsOffset: [0, -0.04, 0], ease: "easeInOut", substeps: 4, bones: kamae({}) },
  ]);
}

/**
 * 10. Sekiro_Dodge (320ms — exact COMBAT.DODGE_DURATION_MS match)
 * Low Shinobi Power Slide: drops hips low to the ground, extends lead leg forward in a
 * smooth slide with trailing knee tucked and sword swept back for balance, then snaps up.
 */
function buildSekiroDodgeClip(rig: InspectedKayKitRig): THREE.AnimationClip {
  const totalSec = COMBAT.DODGE_DURATION_MS / 1000; // 0.32s

  return compileSekiroClip(SEKIRO_CLIP_NAMES.dodge, totalSec, rig, [
    { t: 0.0, hipsOffset: [0, -0.06, 0], bones: kamae({}) },
    {
      t: 0.07,
      hipsOffset: [0, -0.44, 0.18],
      ease: "easeOut",
      substeps: 4,
      bones: kamae({
        hips: [-28, -18, 6],
        spine: [-16, 8, 4],
        chest: [-10, 10, 3],
        head: [28, 10, -4],
        "upperarm.r": [18, -62, 42],
        "lowerarm.r": [0, 16, 0],
        "wrist.r": [0, 0, 44],
        "hand.r": [0, 0, 24],
        "handslot.r": [0, 0, 10],
        "upperarm.l": [-22, 34, -48],
        "lowerarm.l": [0, -56, 0],
        "upperleg.l": [-78, -4, -6],
        "lowerleg.l": [12, 0, 0],
        "foot.l": [22, 0, 0],
        "upperleg.r": [18, 12, 10],
        "lowerleg.r": [108, 0, 0],
        "foot.r": [24, 0, 0],
      }),
    },
    {
      t: 0.25,
      hipsOffset: [0, -0.42, 0.16],
      ease: "hold",
      substeps: 4,
      bones: kamae({
        hips: [-26, -16, 5],
        spine: [-14, 8, 4],
        chest: [-8, 10, 3],
        head: [24, 8, -3],
        "upperarm.r": [16, -56, 40],
        "lowerarm.r": [0, 18, 0],
        "wrist.r": [0, 0, 42],
        "hand.r": [0, 0, 22],
        "handslot.r": [0, 0, 8],
        "upperarm.l": [-18, 30, -44],
        "lowerarm.l": [0, -52, 0],
        "upperleg.l": [-74, -4, -5],
        "lowerleg.l": [14, 0, 0],
        "foot.l": [20, 0, 0],
        "upperleg.r": [16, 10, 8],
        "lowerleg.r": [102, 0, 0],
        "foot.r": [22, 0, 0],
      }),
    },
    { t: totalSec, hipsOffset: [0, -0.04, 0], ease: "easeInOut", substeps: 4, bones: kamae({}) },
  ]);
}

/**
 * 11. Sekiro_Punch (640ms = 160ms windup / 120ms active / 360ms recovery)
 * Torso-Driven Haymaker / Palm-Uppercut Launch:
 * Deep coiled left-flank windup with right sword arm tucked cleanly back -> explosive
 * hip-and-shoulder-driven upward haymaker punch -> dramatic skyward follow-through -> crisp recovery.
 */
function buildSekiroPunchClip(rig: InspectedKayKitRig): THREE.AnimationClip {
  const spec = ATTACK_SPECS.punch;
  const totalSec = (spec.windupMs + spec.activeMs + spec.recoveryMs) / 1000;

  return compileSekiroClip(SEKIRO_CLIP_NAMES.punch, totalSec, rig, [
    { t: 0.0, hipsOffset: [0, -0.04, 0], bones: kamae({}) },
    // 0.14s: Deep coiled windup — hips twisted left, left fist/buckler cocked low-left, sword arm braced back
    {
      t: 0.14,
      hipsOffset: [0.06, -0.13, -0.1],
      ease: "coil",
      substeps: 4,
      bones: kamae({
        hips: [12, 42, -5],
        spine: [10, 18, -4],
        chest: [8, 22, -4],
        head: [-14, -44, 5],
        // Right sword arm tucked back out of the way
        "upperarm.r": [0, -28, 36],
        "lowerarm.r": [0, 52, 0],
        "wrist.r": [0, 0, 24],
        "hand.r": [0, 0, 12],
        // Left arm cocked low-back for explosive haymaker-uppercut
        "upperarm.l": [0, 34, -22],
        "lowerarm.l": [0, -96, 0],
        "hand.l": [0, -18, 0],
        "upperleg.l": [-36, -10, -6],
        "lowerleg.l": [54, 0, 0],
        "foot.l": [-18, 0, 0],
        "upperleg.r": [22, 12, 6],
        "lowerleg.r": [40, 0, 0],
        "foot.r": [-14, 0, 0],
      }),
    },
    // 0.22s: Explosive uppercut impact — hips & shoulders violently whip right as left fist drives forward-up!
    {
      t: 0.22,
      hipsOffset: [-0.04, -0.03, 0.24],
      ease: "snapCut",
      substeps: 6,
      bones: kamae({
        hips: [-4, -34, 6],
        spine: [-6, -16, 5],
        chest: [-8, -22, 6],
        head: [6, 38, -6],
        "upperarm.r": [0, -44, 42],
        "lowerarm.r": [0, 40, 0],
        "wrist.r": [0, 0, 30],
        "hand.r": [0, 0, 16],
        // Left arm punching violently forward and upward (+Z, +Y)
        "upperarm.l": [0, -86, 48],
        "lowerarm.l": [0, -18, 0],
        "hand.l": [0, 12, 0],
        "upperleg.l": [-24, -6, -4],
        "lowerleg.l": [28, 0, 0],
        "foot.l": [-8, 0, 0],
        "upperleg.r": [26, 10, 6],
        "lowerleg.r": [16, 0, 0],
        "foot.r": [8, 0, 0],
      }),
    },
    // 0.30s: Skyward haymaker follow-through apex
    {
      t: 0.3,
      hipsOffset: [-0.06, 0.02, 0.28],
      ease: "easeOut",
      substeps: 4,
      bones: kamae({
        hips: [-8, -48, 8],
        spine: [-10, -18, 6],
        chest: [-10, -22, 6],
        head: [10, 48, -7],
        "upperarm.r": [0, -50, 44],
        "lowerarm.r": [0, 36, 0],
        "wrist.r": [0, 0, 28],
        "upperarm.l": [0, -96, 78],
        "lowerarm.l": [0, -24, 0],
        "hand.l": [0, 16, 0],
        "upperleg.l": [-18, -6, -4],
        "lowerleg.l": [22, 0, 0],
        "upperleg.r": [28, 12, 6],
        "lowerleg.r": [18, 0, 0],
      }),
    },
    // 0.42s: Crisp follow-through hold before snapping back to combat guard
    {
      t: 0.42,
      hipsOffset: [-0.04, 0.0, 0.2],
      ease: "hold",
      substeps: 2,
      bones: kamae({
        hips: [-5, -38, 6],
        spine: [-6, -14, 4],
        chest: [-6, -16, 4],
        head: [6, 36, -5],
        "upperarm.r": [0, -24, 34],
        "lowerarm.r": [0, 42, 0],
        "upperarm.l": [0, -84, 62],
        "lowerarm.l": [0, -34, 0],
      }),
    },
    { t: totalSec, hipsOffset: [0, -0.04, 0], ease: "easeInOut", substeps: 4, bones: kamae({}) },
  ]);
}

/**
 * Builds all 11 realistic Sekiro-inspired swordsmanship & combat clips for an inspected KayKit rig.
 * Never mutates Knight.glb or its 76 original built-in clips.
 */
function buildSekiroJumpClip(rig: InspectedKayKitRig): THREE.AnimationClip {
  // Compact shinobi airborne tuck — sword braced low-forward, off-hand tucked at ribs (never raised overhead!)
  return compileSekiroClip(SEKIRO_CLIP_NAMES.jump, 0.72, rig, [
    {
      t: 0,
      hipsOffset: [0, 0.04, 0],
      bones: kamae({
        hips: [10, -14, 0],
        spine: [12, 6, 0],
        chest: [10, 8, 0],
        head: [-14, 0, 0],
        "upperarm.r": [0, 36, 26],
        "lowerarm.r": [0, 52, 0],
        "wrist.r": [0, 0, 14],
        "hand.r": [0, 0, 8],
        "upperarm.l": [0, -36, -54],
        "lowerarm.l": [0, -68, 0],
        "hand.l": [0, -10, 0],
        "upperleg.l": [-42, -6, -4],
        "lowerleg.l": [64, 0, 0],
        "foot.l": [12, 0, 0],
        "upperleg.r": [-22, 8, 5],
        "lowerleg.r": [50, 0, 0],
        "foot.r": [16, 0, 0],
      }),
    },
    {
      t: 0.36,
      hipsOffset: [0, 0.07, 0],
      ease: "easeInOut",
      substeps: 4,
      bones: kamae({
        hips: [12, -16, 0],
        spine: [14, 8, 0],
        chest: [11, 8, 0],
        head: [-16, 0, 0],
        "upperarm.r": [0, 40, 24],
        "lowerarm.r": [0, 50, 0],
        "wrist.r": [0, 0, 16],
        "hand.r": [0, 0, 8],
        "upperarm.l": [0, -34, -52],
        "lowerarm.l": [0, -66, 0],
        "hand.l": [0, -10, 0],
        "upperleg.l": [-46, -6, -4],
        "lowerleg.l": [68, 0, 0],
        "foot.l": [14, 0, 0],
        "upperleg.r": [-26, 8, 5],
        "lowerleg.r": [54, 0, 0],
        "foot.r": [18, 0, 0],
      }),
    },
    {
      t: 0.72,
      hipsOffset: [0, 0.04, 0],
      ease: "easeInOut",
      substeps: 4,
      bones: kamae({
        hips: [10, -14, 0],
        spine: [12, 6, 0],
        chest: [10, 8, 0],
        head: [-14, 0, 0],
        "upperarm.r": [0, 36, 26],
        "lowerarm.r": [0, 52, 0],
        "wrist.r": [0, 0, 14],
        "hand.r": [0, 0, 8],
        "upperarm.l": [0, -36, -54],
        "lowerarm.l": [0, -68, 0],
        "hand.l": [0, -10, 0],
        "upperleg.l": [-42, -6, -4],
        "lowerleg.l": [64, 0, 0],
        "foot.l": [12, 0, 0],
        "upperleg.r": [-22, 8, 5],
        "lowerleg.r": [50, 0, 0],
        "foot.r": [16, 0, 0],
      }),
    },
  ]);
}

export function buildAllSekiroCombatClips(
  rig: InspectedKayKitRig
): Record<keyof typeof SEKIRO_CLIP_NAMES, THREE.AnimationClip> {
  return {
    idle: buildSekiroIdleClip(rig),
    jump: buildSekiroJumpClip(rig),
    block: buildSekiroBlockClip(rig),
    light1: buildSekiroLight1Clip(rig),
    light2: buildSekiroLight2Clip(rig),
    heavy: buildSekiroHeavyClip(rig),
    thrust: buildSekiroThrustClip(rig),
    whirlwind: buildSekiroWhirlwindClip(rig),
    counter: buildSekiroCounterClip(rig),
    aerial_slam: buildSekiroAerialSlamClip(rig),
    dodge: buildSekiroDodgeClip(rig),
    punch: buildSekiroPunchClip(rig),
  };
}
