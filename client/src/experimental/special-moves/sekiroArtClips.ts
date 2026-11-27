import * as THREE from "three";
import { EXPERIMENTAL_ARTS } from "./config";
import {
  composeBoneLocalQuaternion,
  type CanonicalBoneKey,
  type InspectedKayKitRig,
} from "./rigInspector";

type Vec3Tuple = readonly [number, number, number];

type PhaseEasing =
  | "linear"
  | "easeIn"
  | "easeOut"
  | "easeInOut"
  | "snapCut"
  | "coil"
  | "hold";

interface ArtKeyframe {
  readonly t: number;
  readonly hipsOffset?: Vec3Tuple;
  readonly ease?: PhaseEasing;
  readonly substeps?: number;
  readonly bones: Readonly<Partial<Record<CanonicalBoneKey, Vec3Tuple>>>;
}

const ART_READY_POSE: Readonly<Partial<Record<CanonicalBoneKey, Vec3Tuple>>> = {
  hips: [4, -18, 0],
  spine: [5, 8, 0],
  chest: [4, 10, 0],
  head: [-8, 0, 0],
  "upperarm.r": [0, 50, 18],
  "lowerarm.r": [0, 44, 0],
  "wrist.r": [0, 0, 18],
  "hand.r": [0, 0, 10],
  "handslot.r": [0, 0, 4],
  "upperarm.l": [0, -34, -52],
  "lowerarm.l": [0, -64, 0],
  "hand.l": [0, -10, 0],
  "upperleg.l": [-18, -6, -4],
  "lowerleg.l": [28, 0, 0],
  "foot.l": [-10, 0, 0],
  "upperleg.r": [16, 10, 5],
  "lowerleg.r": [22, 0, 0],
  "foot.r": [-14, 0, 0],
};

function artPose(
  overrides: Readonly<Partial<Record<CanonicalBoneKey, Vec3Tuple>>>
): Readonly<Partial<Record<CanonicalBoneKey, Vec3Tuple>>> {
  return { ...ART_READY_POSE, ...overrides };
}

function evalArtEasing(kind: PhaseEasing, u: number): number {
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
      return t < 0.35
        ? Math.pow(t / 0.35, 2.1) * 0.44
        : 0.44 + (1 - Math.pow(1 - (t - 0.35) / 0.65, 3.2)) * 0.56;
    case "hold":
      return 0.5 - 0.5 * Math.cos(Math.PI * t);
  }
}

function compileArtClip(
  clipName: string,
  durationSec: number,
  rig: InspectedKayKitRig,
  keyframes: readonly ArtKeyframe[]
): THREE.AnimationClip {
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
    if (rig.bones.has(key)) boneQuatArrays.set(key, []);
  }

  const qA = new THREE.Quaternion();
  const qB = new THREE.Quaternion();
  const qSlerp = new THREE.Quaternion();

  const pushSample = (
    t: number,
    hipsOff: readonly [number, number, number],
    sampleMap: ReadonlyMap<CanonicalBoneKey, THREE.Quaternion>
  ) => {
    sampledTimes.push(t);
    hipsPosValues.push(
      rig.hipsRestPosition.x + hipsOff[0],
      rig.hipsRestPosition.y + hipsOff[1],
      rig.hipsRestPosition.z + hipsOff[2]
    );
    for (const [key, arr] of boneQuatArrays.entries()) {
      const q = sampleMap.get(key);
      if (!q) continue;
      const prev = prevQuatByBone.get(key);
      if (prev && prev.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
      arr.push(q.x, q.y, q.z, q.w);
      if (prev) prev.copy(q);
      else prevQuatByBone.set(key, q.clone());
    }
  };

  {
    const kf0 = keyframes[0];
    const map0 = new Map<CanonicalBoneKey, THREE.Quaternion>();
    for (const key of boneQuatArrays.keys()) {
      const bone = rig.bones.get(key);
      if (!bone) continue;
      const q = new THREE.Quaternion();
      composeBoneLocalQuaternion(bone, kf0.bones[key] ?? ART_READY_POSE[key] ?? [0, 0, 0], q);
      map0.set(key, q);
    }
    pushSample(kf0.t, kf0.hipsOffset ?? [0, 0, 0], map0);
  }

  for (let i = 1; i < keyframes.length; i++) {
    const prevKf = keyframes[i - 1];
    const currKf = keyframes[i];
    const ease = currKf.ease ?? "easeInOut";
    const dt = Math.max(0.001, currKf.t - prevKf.t);
    const steps = currKf.substeps ?? (ease === "snapCut" ? 6 : ease === "linear" ? 2 : 4);
    const prevOff = prevKf.hipsOffset ?? [0, 0, 0];
    const currOff = currKf.hipsOffset ?? [0, 0, 0];

    for (let s = 1; s <= steps; s++) {
      const u = s / steps;
      const e = evalArtEasing(ease, u);
      const t = prevKf.t + dt * u;
      const hx = prevOff[0] + (currOff[0] - prevOff[0]) * e;
      const hy = prevOff[1] + (currOff[1] - prevOff[1]) * e;
      const hz = prevOff[2] + (currOff[2] - prevOff[2]) * e;
      const sampleMap = new Map<CanonicalBoneKey, THREE.Quaternion>();

      for (const key of boneQuatArrays.keys()) {
        const bone = rig.bones.get(key);
        if (!bone) continue;
        const dA = prevKf.bones[key] ?? ART_READY_POSE[key] ?? [0, 0, 0];
        const dB = currKf.bones[key] ?? ART_READY_POSE[key] ?? [0, 0, 0];
        // Support multi-revolution hips spins (yaw) and Nightjar front flips (pitch) cleanly!
        if (key === "hips" && (Math.abs(dB[1] - dA[1]) > 95 || Math.abs(dB[0] - dA[0]) > 95)) {
          composeBoneLocalQuaternion(
            bone,
            [dA[0] + (dB[0] - dA[0]) * e, dA[1] + (dB[1] - dA[1]) * e, dA[2] + (dB[2] - dA[2]) * e],
            qSlerp
          );
          sampleMap.set(key, qSlerp.clone());
        } else {
          composeBoneLocalQuaternion(bone, dA, qA);
          composeBoneLocalQuaternion(bone, dB, qB);
          if (qA.dot(qB) < 0) qB.set(-qB.x, -qB.y, -qB.z, -qB.w);
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
    tracks.push(new THREE.VectorKeyframeTrack(`${hipsBone.runtimeName}.position`, sampledTimes, hipsPosValues));
  }
  for (const [key, values] of boneQuatArrays.entries()) {
    const bone = rig.bones.get(key);
    if (!bone || values.length === 0) continue;
    tracks.push(new THREE.QuaternionKeyframeTrack(`${bone.runtimeName}.quaternion`, sampledTimes, values));
  }
  return new THREE.AnimationClip(clipName, durationSec, tracks);
}

const JODAN_COIL = artPose({
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
  "upperleg.l": [-14, -6, -4],
  "lowerleg.l": [22, 0, 0],
  "upperleg.r": [18, 8, 5],
  "lowerleg.r": [28, 0, 0],
});

const JODAN_SPLIT = artPose({
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
  "lowerleg.l": [64, 0, 0],
  "foot.l": [-18, 0, 0],
  "upperleg.r": [32, 8, 6],
  "lowerleg.r": [40, 0, 0],
  "foot.r": [-14, 0, 0],
});

const SHEATHE_CROUCH = artPose({
  hips: [20, 44, -4],
  spine: [16, 18, -3],
  chest: [14, 20, -3],
  head: [-22, -52, 4],
  // Hilt tucked cleanly by left hip in iaijutsu draw stance
  "upperarm.r": [0, 96, -12],
  "lowerarm.r": [0, 62, 0],
  "wrist.r": [18, 0, -24],
  "hand.r": [8, 0, -14],
  "handslot.r": [4, 0, -6],
  "upperarm.l": [0, -48, -38],
  "lowerarm.l": [0, -80, 0],
  "upperleg.l": [-46, -10, -6],
  "lowerleg.l": [70, 0, 0],
  "foot.l": [-22, 0, 0],
  "upperleg.r": [24, 14, 6],
  "lowerleg.r": [52, 0, 0],
  "foot.r": [-22, 0, 0],
});

const LEVEL_SPIN_POSE = (yawDeg: number) =>
  artPose({
    hips: [8, yawDeg, -3],
    spine: [6, 12, -2],
    chest: [6, 16, -2],
    head: [-8, -14, 2],
    "upperarm.r": [0, 16, -10],
    "lowerarm.r": [0, 4, 0],
    "wrist.r": [90, 0, 48],
    "hand.r": [0, 0, 28],
    "handslot.r": [0, 0, 12],
    "upperarm.l": [0, -50, -46],
    "lowerarm.l": [0, -82, 0],
    "upperleg.l": [-32, -8, -6],
    "lowerleg.l": [48, 0, 0],
    "upperleg.r": [22, 10, 6],
    "lowerleg.r": [38, 0, 0],
  });

function buildIchimonjiClip(rig: InspectedKayKitRig, doubleHit: boolean): THREE.AnimationClip {
  const spec = EXPERIMENTAL_ARTS[doubleHit ? "ichimonji_double" : "ichimonji"];
  const dur = spec.durationMs / 1000;
  if (!doubleHit) {
    return compileArtClip(spec.clipName, dur, rig, [
      { t: 0, hipsOffset: [0, -0.04, 0], bones: artPose({}) },
      { t: 0.24, hipsOffset: [0, 0.06, -0.08], ease: "coil", bones: JODAN_COIL },
      { t: 0.35, hipsOffset: [0, 0.08, -0.1], ease: "hold", bones: JODAN_COIL },
      { t: 0.48, hipsOffset: [0.02, -0.15, 0.3], ease: "snapCut", substeps: 6, bones: JODAN_SPLIT },
      { t: 0.72, hipsOffset: [0.02, -0.14, 0.26], ease: "hold", bones: JODAN_SPLIT },
      { t: dur, hipsOffset: [0, -0.04, 0], ease: "easeInOut", bones: artPose({}) },
    ]);
  }
  return compileArtClip(spec.clipName, dur, rig, [
    { t: 0, hipsOffset: [0, -0.04, 0], bones: artPose({}) },
    { t: 0.22, hipsOffset: [0, 0.06, -0.08], ease: "coil", bones: JODAN_COIL },
    { t: 0.32, hipsOffset: [0, 0.08, -0.1], ease: "hold", bones: JODAN_COIL },
    { t: 0.44, hipsOffset: [0.02, -0.14, 0.28], ease: "snapCut", substeps: 6, bones: JODAN_SPLIT },
    { t: 0.68, hipsOffset: [0, 0.07, 0.14], ease: "coil", bones: JODAN_COIL },
    { t: 0.84, hipsOffset: [0, 0.09, 0.12], ease: "hold", bones: JODAN_COIL },
    { t: 0.99, hipsOffset: [0.02, -0.16, 0.44], ease: "snapCut", substeps: 6, bones: JODAN_SPLIT },
    { t: 1.24, hipsOffset: [0.02, -0.14, 0.38], ease: "hold", bones: JODAN_SPLIT },
    { t: dur, hipsOffset: [0, -0.04, 0], ease: "easeInOut", bones: artPose({}) },
  ]);
}

function buildAshinaCrossClip(rig: InspectedKayKitRig): THREE.AnimationClip {
  const spec = EXPERIMENTAL_ARTS.ashina_cross;
  const dur = spec.durationMs / 1000;
  return compileArtClip(spec.clipName, dur, rig, [
    { t: 0, hipsOffset: [0, -0.04, 0], bones: artPose({}) },
    { t: 0.14, hipsOffset: [0.04, -0.2, -0.1], ease: "coil", bones: SHEATHE_CROUCH },
    { t: 0.32, hipsOffset: [0.04, -0.21, -0.12], ease: "hold", bones: SHEATHE_CROUCH },
    // Explosive cross slash 1: whipping from left hip diagonally right!
    {
      t: 0.43,
      hipsOffset: [-0.04, -0.12, 0.34],
      ease: "snapCut",
      substeps: 6,
      bones: artPose({
        hips: [10, -44, 5],
        spine: [10, -22, 4],
        chest: [8, -24, 4],
        head: [-12, 46, -4],
        "upperarm.r": [0, 32, -48],
        "lowerarm.r": [0, 6, 0],
        "wrist.r": [-26, 0, 42],
        "hand.r": [-12, 0, 22],
        "handslot.r": [-4, 0, 10],
        "upperleg.l": [-40, -8, -5],
        "lowerleg.l": [56, 0, 0],
      }),
    },
    // Instant rebound cross slash 2: ripping diagonally down-left to complete the X!
    {
      t: 0.57,
      hipsOffset: [0.06, -0.13, 0.5],
      ease: "snapCut",
      substeps: 6,
      bones: artPose({
        hips: [12, 48, -5],
        spine: [12, 22, -4],
        chest: [10, 24, -4],
        head: [-14, -48, 5],
        "upperarm.r": [0, 86, -14],
        "lowerarm.r": [0, 8, 0],
        "wrist.r": [36, 0, 44],
        "hand.r": [16, 0, 24],
        "handslot.r": [6, 0, 10],
        "upperleg.l": [-44, -8, -6],
        "lowerleg.l": [60, 0, 0],
      }),
    },
    {
      t: 0.76,
      hipsOffset: [0.04, -0.12, 0.44],
      ease: "hold",
      bones: artPose({
        hips: [10, 42, -4],
        "upperarm.r": [0, 82, -14],
        "lowerarm.r": [0, 12, 0],
        "wrist.r": [30, 0, 38],
      }),
    },
    { t: dur, hipsOffset: [0, -0.04, 0], ease: "easeInOut", bones: artPose({}) },
  ]);
}

function buildDragonFlashClip(rig: InspectedKayKitRig): THREE.AnimationClip {
  const spec = EXPERIMENTAL_ARTS.dragon_flash;
  const dur = spec.durationMs / 1000;
  const dragonExtend = artPose({
    hips: [12, 18, -3],
    spine: [12, 10, -2],
    chest: [10, 12, -2],
    head: [-16, -24, 3],
    "upperarm.r": [0, 58, -38],
    "lowerarm.r": [0, 2, 0],
    "wrist.r": [0, 0, 48],
    "hand.r": [0, 0, 28],
    "handslot.r": [0, 0, 12],
    "upperarm.l": [0, 26, -48],
    "lowerarm.l": [0, -32, 0],
    "upperleg.l": [-48, -6, -5],
    "lowerleg.l": [56, 0, 0],
    "upperleg.r": [42, 8, 6],
    "lowerleg.r": [16, 0, 0],
  });
  return compileArtClip(spec.clipName, dur, rig, [
    { t: 0, hipsOffset: [0, -0.04, 0], bones: artPose({}) },
    { t: 0.34, hipsOffset: [-0.04, -0.18, -0.14], ease: "coil", bones: SHEATHE_CROUCH },
    // Initial wind beam cleave out to full extension
    { t: 0.48, hipsOffset: [0.02, -0.12, 0.34], ease: "snapCut", substeps: 6, bones: dragonExtend },
    // Tense stillness while second colossal vacuum shockwave gathers
    { t: 0.72, hipsOffset: [0.02, -0.13, 0.32], ease: "hold", bones: dragonExtend },
    // Shockwave detonation punch forward
    { t: 0.88, hipsOffset: [0.02, -0.11, 0.46], ease: "snapCut", substeps: 5, bones: dragonExtend },
    { t: 1.08, hipsOffset: [0.02, -0.11, 0.4], ease: "hold", bones: dragonExtend },
    { t: dur, hipsOffset: [0, -0.04, 0], ease: "easeInOut", bones: artPose({}) },
  ]);
}

function buildWhirlwindSlashClip(rig: InspectedKayKitRig): THREE.AnimationClip {
  const spec = EXPERIMENTAL_ARTS.whirlwind_slash;
  const dur = spec.durationMs / 1000;
  return compileArtClip(spec.clipName, dur, rig, [
    { t: 0, hipsOffset: [0, -0.04, 0], bones: artPose({}) },
    { t: 0.14, hipsOffset: [-0.04, -0.14, -0.04], ease: "coil", bones: LEVEL_SPIN_POSE(-56) },
    { t: 0.28, hipsOffset: [0, -0.12, 0.14], ease: "linear", substeps: 6, bones: LEVEL_SPIN_POSE(110) },
    { t: 0.44, hipsOffset: [0, -0.11, 0.24], ease: "linear", substeps: 6, bones: LEVEL_SPIN_POSE(300) },
    { t: 0.6, hipsOffset: [0.02, -0.12, 0.32], ease: "linear", substeps: 6, bones: LEVEL_SPIN_POSE(500) },
    { t: 0.76, hipsOffset: [0.04, -0.13, 0.36], ease: "easeOut", substeps: 6, bones: LEVEL_SPIN_POSE(702) },
    { t: dur, hipsOffset: [0, -0.04, 0], ease: "easeInOut", bones: artPose({ hips: [4, 702, 0] }) },
  ]);
}

function buildNightjarSlashClip(rig: InspectedKayKitRig): THREE.AnimationClip {
  const spec = EXPERIMENTAL_ARTS.nightjar_slash;
  const dur = spec.durationMs / 1000;
  const flipTuck = (hipsPitch: number) =>
    artPose({
      hips: [hipsPitch, 0, 0],
      spine: [18, 0, 0],
      chest: [14, 0, 0],
      // Arm & blade tucked back/alongside torso so sword sweeps high above the sand during the 360 deg somersault
      "upperarm.r": [0, -34, 62],
      "lowerarm.r": [0, 56, 0],
      "wrist.r": [0, 0, -28],
      "hand.r": [0, 0, -14],
      "handslot.r": [0, 0, -6],
      "upperleg.l": [-60, 0, -6],
      "lowerleg.l": [98, 0, 0],
      "upperleg.r": [-52, 0, 6],
      "lowerleg.r": [94, 0, 0],
    });
  return compileArtClip(spec.clipName, dur, rig, [
    { t: 0, hipsOffset: [0, -0.04, 0], bones: artPose({}) },
    // Coiled forward launch crouch with sword tucked back
    {
      t: 0.12,
      hipsOffset: [0, -0.14, 0.02],
      ease: "coil",
      bones: flipTuck(18),
    },
    // Rising forward somersault initiation (+1.18m high, 95 deg pitch, blade safely trailing upward!)
    {
      t: 0.22,
      hipsOffset: [0, 1.18, 0.12],
      ease: "linear",
      substeps: 5,
      bones: flipTuck(95),
    },
    // Mid-air tucked somersault flip apex (+1.52m height, 185 deg inverted)
    {
      t: 0.32,
      hipsOffset: [0, 1.52, 0.24],
      ease: "linear",
      substeps: 5,
      bones: flipTuck(185),
    },
    // Unfolding out of somersault high overhead for the diving Nightjar cleave
    {
      t: 0.44,
      hipsOffset: [0, 0.92, 0.34],
      ease: "linear",
      substeps: 5,
      bones: {
        ...JODAN_COIL,
        hips: [308, 4, 0],
        "upperleg.l": [-48, -6, -6],
        "lowerleg.l": [78, 0, 0],
        "upperleg.r": [-26, 6, 6],
        "lowerleg.r": [68, 0, 0],
      },
    },
    // Completing flip straight into ferocious descending cleave (360° -> upright split!)
    {
      t: 0.56,
      hipsOffset: [0.02, -0.14, 0.44],
      ease: "snapCut",
      substeps: 6,
      bones: { ...JODAN_SPLIT, hips: [374, 12, -2] },
    },
    {
      t: 0.78,
      hipsOffset: [0.02, -0.12, 0.38],
      ease: "hold",
      bones: { ...JODAN_SPLIT, hips: [372, 10, -2] },
    },
    { t: dur, hipsOffset: [0, -0.04, 0], ease: "easeInOut", bones: artPose({ hips: [364, -18, 0] }) },
  ]);
}

function buildFloatingPassageClip(rig: InspectedKayKitRig): THREE.AnimationClip {
  const spec = EXPERIMENTAL_ARTS.floating_passage;
  const dur = spec.durationMs / 1000;
  const stroke = (yawDeg: number, armYaw: number, armRoll: number, wristX: number, wristZ: number) =>
    artPose({
      hips: [10, yawDeg, -3],
      spine: [8, 10, -2],
      chest: [6, 12, -2],
      head: [-10, -14, 2],
      "upperarm.r": [0, armYaw, armRoll],
      "lowerarm.r": [0, 8, 0],
      "wrist.r": [wristX, 0, wristZ],
      "hand.r": [wristX * 0.4, 0, wristZ * 0.5],
      "handslot.r": [0, 0, 10],
      "upperleg.l": [-34, -6, -5],
      "lowerleg.l": [48, 0, 0],
      "upperleg.r": [24, 8, 5],
      "lowerleg.r": [30, 0, 0],
    });
  return compileArtClip(spec.clipName, dur, rig, [
    { t: 0, hipsOffset: [0, -0.04, 0], bones: artPose({}) },
    { t: 0.14, hipsOffset: [-0.04, -0.1, 0.04], ease: "coil", bones: stroke(-42, 26, -42, 20, 26) },
    { t: 0.25, hipsOffset: [0.05, -0.1, 0.16], ease: "snapCut", substeps: 4, bones: stroke(42, 86, -12, 34, 42) },
    { t: 0.44, hipsOffset: [-0.05, -0.08, 0.24], ease: "snapCut", substeps: 4, bones: stroke(-38, 48, -38, -28, 40) },
    { t: 0.66, hipsOffset: [0, -0.1, 0.3], ease: "linear", substeps: 6, bones: LEVEL_SPIN_POSE(330) },
    { t: 0.84, hipsOffset: [0.06, -0.11, 0.38], ease: "snapCut", substeps: 4, bones: stroke(404, 88, -14, 34, 42) },
    { t: 1.06, hipsOffset: [-0.05, -0.04, 0.46], ease: "snapCut", substeps: 5, bones: stroke(326, 62, -52, -26, 40) },
    { t: dur, hipsOffset: [0, -0.04, 0], ease: "easeInOut", bones: artPose({ hips: [4, 342, 0] }) },
  ]);
}

function buildShadowrushClip(rig: InspectedKayKitRig): THREE.AnimationClip {
  const spec = EXPERIMENTAL_ARTS.shadowrush;
  const dur = spec.durationMs / 1000;
  return compileArtClip(spec.clipName, dur, rig, [
    { t: 0, hipsOffset: [0, -0.04, 0], bones: artPose({}) },
    // Coiled spear crouch
    {
      t: 0.2,
      hipsOffset: [-0.04, -0.16, -0.14],
      ease: "coil",
      bones: artPose({
        hips: [14, -48, 3],
        "upperarm.r": [0, -34, 24],
        "lowerarm.r": [0, 118, 0],
        "wrist.r": [0, 0, 48],
        "hand.r": [0, 0, 28],
        "handslot.r": [0, 0, 12],
        "upperleg.l": [-46, -14, -6],
        "lowerleg.l": [70, 0, 0],
      }),
    },
    // Blistering Shadowrush lance pierce
    {
      t: 0.34,
      hipsOffset: [0.02, -0.11, 0.5],
      ease: "snapCut",
      substeps: 6,
      bones: artPose({
        hips: [14, 16, -2],
        spine: [12, 8, -2],
        chest: [10, 10, -2],
        head: [-18, -26, 2],
        "upperarm.r": [0, 56, -38],
        "lowerarm.r": [0, 2, 0],
        "wrist.r": [0, 0, 48],
        "hand.r": [0, 0, 28],
        "handslot.r": [0, 0, 12],
        "upperleg.l": [-52, -4, -5],
        "lowerleg.l": [56, 0, 0],
      }),
    },
    // Owl kick-off vault skyward (+1.55m apex!)
    {
      t: 0.68,
      hipsOffset: [0, 1.52, 0.32],
      ease: "easeOut",
      substeps: 5,
      bones: {
        ...JODAN_COIL,
        hips: [-14, -12, 0],
        "upperleg.l": [-58, -6, -6],
        "lowerleg.l": [94, 0, 0],
        "upperleg.r": [-38, 6, 6],
        "lowerleg.r": [82, 0, 0],
      },
    },
    // Descending falcon cleave crashing back down
    { t: 0.98, hipsOffset: [0.02, -0.13, 0.42], ease: "snapCut", substeps: 6, bones: JODAN_SPLIT },
    { t: 1.15, hipsOffset: [0.02, -0.11, 0.36], ease: "hold", bones: JODAN_SPLIT },
    { t: dur, hipsOffset: [0, -0.04, 0], ease: "easeInOut", bones: artPose({}) },
  ]);
}

function buildSpiralCloudClip(rig: InspectedKayKitRig): THREE.AnimationClip {
  const spec = EXPERIMENTAL_ARTS.spiral_cloud_passage;
  const dur = spec.durationMs / 1000;
  return compileArtClip(spec.clipName, dur, rig, [
    { t: 0, hipsOffset: [0, -0.04, 0], bones: artPose({}) },
    { t: 0.14, hipsOffset: [-0.04, -0.12, 0], ease: "coil", bones: LEVEL_SPIN_POSE(-50) },
    { t: 0.34, hipsOffset: [0, 0.2, 0.14], ease: "linear", substeps: 6, bones: LEVEL_SPIN_POSE(180) },
    { t: 0.56, hipsOffset: [0, 0.42, 0.24], ease: "linear", substeps: 6, bones: LEVEL_SPIN_POSE(450) },
    { t: 0.8, hipsOffset: [0, 0.24, 0.34], ease: "linear", substeps: 6, bones: LEVEL_SPIN_POSE(720) },
    { t: 1.06, hipsOffset: [0.04, -0.12, 0.44], ease: "snapCut", substeps: 6, bones: LEVEL_SPIN_POSE(1040) },
    { t: 1.24, hipsOffset: [0.03, -0.1, 0.38], ease: "hold", bones: LEVEL_SPIN_POSE(1062) },
    { t: dur, hipsOffset: [0, -0.04, 0], ease: "easeInOut", bones: artPose({ hips: [4, 1062, 0] }) },
  ]);
}

function buildOneMindClip(rig: InspectedKayKitRig): THREE.AnimationClip {
  const spec = EXPERIMENTAL_ARTS.one_mind;
  const dur = spec.durationMs / 1000;
  const sheatheHold = artPose({
    hips: [14, 36, -3],
    spine: [12, 14, -2],
    chest: [10, 16, -2],
    head: [-16, -42, 3],
    "upperarm.r": [0, 72, -16],
    "lowerarm.r": [0, 62, 0],
    "wrist.r": [22, 0, -24],
    "hand.r": [10, 0, -14],
    "handslot.r": [4, 0, -6],
    "upperleg.l": [-42, -8, -5],
    "lowerleg.l": [62, 0, 0],
  });
  return compileArtClip(spec.clipName, dur, rig, [
    { t: 0, hipsOffset: [0, -0.04, 0], bones: artPose({}) },
    { t: 0.2, hipsOffset: [0.04, -0.18, -0.08], ease: "coil", bones: SHEATHE_CROUCH },
    // Initial Flash Draw forward lunge
    {
      t: 0.34,
      hipsOffset: [-0.04, -0.12, 0.38],
      ease: "snapCut",
      substeps: 6,
      bones: artPose({
        hips: [10, -40, 4],
        "upperarm.r": [0, 38, -38],
        "lowerarm.r": [0, 6, 0],
        "wrist.r": [-24, 0, 42],
        "hand.r": [-12, 0, 22],
        "handslot.r": [-4, 0, 10],
      }),
    },
    // Poised still zanshin while invisible Judgement slashes erupt around the foe (0.52s..0.95s)
    { t: 0.56, hipsOffset: [0.02, -0.14, 0.36], ease: "coil", bones: sheatheHold },
    { t: 0.96, hipsOffset: [0.02, -0.15, 0.34], ease: "hold", bones: sheatheHold },
    // Decisive Crimson Finisher slash across the chest
    {
      t: 1.16,
      hipsOffset: [0.05, -0.1, 0.5],
      ease: "snapCut",
      substeps: 6,
      bones: artPose({
        hips: [12, 52, -5],
        spine: [10, 22, -4],
        chest: [8, 24, -4],
        head: [-12, -48, 5],
        "upperarm.r": [0, 88, -14],
        "lowerarm.r": [0, 6, 0],
        "wrist.r": [70, 0, 46],
        "hand.r": [14, 0, 26],
        "handslot.r": [6, 0, 12],
      }),
    },
    { t: dur, hipsOffset: [0, -0.04, 0], ease: "easeInOut", bones: artPose({}) },
  ]);
}

function buildHighMonkClip(rig: InspectedKayKitRig): THREE.AnimationClip {
  const spec = EXPERIMENTAL_ARTS.high_monk;
  const dur = spec.durationMs / 1000;
  return compileArtClip(spec.clipName, dur, rig, [
    { t: 0, hipsOffset: [0, -0.04, 0], bones: artPose({}) },
    { t: 0.14, hipsOffset: [0, -0.14, 0], ease: "coil", bones: LEVEL_SPIN_POSE(-40) },
    // Temple sweep-counter leap (+1.18m high!)
    {
      t: 0.34,
      hipsOffset: [0, 1.16, 0.22],
      ease: "easeOut",
      substeps: 5,
      bones: {
        ...LEVEL_SPIN_POSE(180),
        "upperleg.l": [-62, 0, -8],
        "lowerleg.l": [92, 0, 0],
        "upperleg.r": [-24, 0, 8],
        "lowerleg.r": [68, 0, 0],
      },
    },
    // Cascading Senpou Flurry I (landing diagonal cut)
    {
      t: 0.64,
      hipsOffset: [0.04, -0.11, 0.34],
      ease: "snapCut",
      substeps: 5,
      bones: artPose({
        hips: [10, 404, -4],
        "upperarm.r": [0, 88, -16],
        "lowerarm.r": [0, 6, 0],
        "wrist.r": [36, 0, 42],
        "hand.r": [14, 0, 22],
        "handslot.r": [6, 0, 10],
      }),
    },
    // Cascading Finisher (overhead temple split)
    {
      t: 0.92,
      hipsOffset: [0.02, -0.15, 0.44],
      ease: "snapCut",
      substeps: 5,
      bones: { ...JODAN_SPLIT, hips: [14, 372, -2] },
    },
    { t: dur, hipsOffset: [0, -0.04, 0], ease: "easeInOut", bones: artPose({ hips: [4, 342, 0] }) },
  ]);
}

export type ExtraSekiroArtKey = Exclude<
  keyof typeof EXPERIMENTAL_ARTS,
  "sakura_dance" | "mortal_draw" | "mortal_draw_empowered"
>;

export function buildExtraSekiroArtClips(
  rig: InspectedKayKitRig
): Record<ExtraSekiroArtKey, THREE.AnimationClip> {
  return {
    ichimonji: buildIchimonjiClip(rig, false),
    ichimonji_double: buildIchimonjiClip(rig, true),
    ashina_cross: buildAshinaCrossClip(rig),
    dragon_flash: buildDragonFlashClip(rig),
    whirlwind_slash: buildWhirlwindSlashClip(rig),
    nightjar_slash: buildNightjarSlashClip(rig),
    floating_passage: buildFloatingPassageClip(rig),
    shadowrush: buildShadowrushClip(rig),
    spiral_cloud_passage: buildSpiralCloudClip(rig),
    one_mind: buildOneMindClip(rig),
    high_monk: buildHighMonkClip(rig),
  };
}
