import * as THREE from "three";

/**
 * Canonical KayKit Knight.glb bone names (raw glTF names prior to Three.js GLTFLoader sanitization).
 *
 * NOTE: Three.js GLTFLoader runs `THREE.PropertyBinding.sanitizeNodeName` on node names,
 * converting dots to empty strings at runtime:
 *   "upperarm.r" -> "upperarmr"
 *   "handslot.r" -> "handslotr"
 *
 * This inspector resolves BOTH sanitized and raw names on any cloned KayKit Object3D,
 * recording the exact runtime `Object3D.name` and true rest-pose transforms so procedural
 * AnimationClips bind reliably without twisting joints or breaking sword attachment.
 */
export type CanonicalBoneKey =
  | "root"
  | "hips"
  | "spine"
  | "chest"
  | "head"
  | "upperarm.l"
  | "lowerarm.l"
  | "wrist.l"
  | "hand.l"
  | "handslot.l"
  | "upperarm.r"
  | "lowerarm.r"
  | "wrist.r"
  | "hand.r"
  | "handslot.r"
  | "upperleg.l"
  | "lowerleg.l"
  | "foot.l"
  | "upperleg.r"
  | "lowerleg.r"
  | "foot.r";

export const REQUIRED_BONES: readonly CanonicalBoneKey[] = [
  "hips",
  "spine",
  "chest",
  "head",
  "upperarm.l",
  "lowerarm.l",
  "hand.l",
  "upperarm.r",
  "lowerarm.r",
  "hand.r",
  "handslot.r",
  "upperleg.l",
  "lowerleg.l",
  "foot.l",
  "upperleg.r",
  "lowerleg.r",
  "foot.r",
];

export const ALL_TRACKED_BONES: readonly CanonicalBoneKey[] = [
  "root",
  "hips",
  "spine",
  "chest",
  "head",
  "upperarm.l",
  "lowerarm.l",
  "wrist.l",
  "hand.l",
  "handslot.l",
  "upperarm.r",
  "lowerarm.r",
  "wrist.r",
  "hand.r",
  "handslot.r",
  "upperleg.l",
  "lowerleg.l",
  "foot.l",
  "upperleg.r",
  "lowerleg.r",
  "foot.r",
];

export interface InspectedBone {
  readonly canonicalName: CanonicalBoneKey;
  /** Exact Object3D.name found on the live Three.js skeleton (used in KeyframeTrack names). */
  readonly runtimeName: string;
  readonly object: THREE.Object3D;
  readonly restLocalPosition: THREE.Vector3;
  readonly restLocalQuaternion: THREE.Quaternion;
  readonly restWorldQuaternion: THREE.Quaternion;
  readonly parentRestWorldQuaternion: THREE.Quaternion;
  readonly parentRestWorldQuaternionInv: THREE.Quaternion;
}

export interface InspectedRigStatus {
  readonly ready: boolean;
  readonly foundBoneCount: number;
  readonly totalTrackedBones: number;
  readonly missingRequiredBones: readonly CanonicalBoneKey[];
  readonly hipsRestY: number;
  readonly swordGripBoneName: string | null;
  readonly swordGripVerified: boolean;
  readonly attachedWeaponNames: readonly string[];
  readonly summary: string;
}

export interface InspectedKayKitRig {
  readonly bones: ReadonlyMap<CanonicalBoneKey, InspectedBone>;
  readonly hipsRestPosition: THREE.Vector3;
  readonly status: InspectedRigStatus;
}

const DEG2RAD = Math.PI / 180;
const _tmpEuler = new THREE.Euler(0, 0, 0, "YXZ");
const _tmpDeltaQ = new THREE.Quaternion();

function normalizeBoneLookup(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Inspects a cloned KayKit `Object3D` skeleton in its rest pose (BEFORE playing any AnimationMixer clip).
 * Captures local & model-space rest quaternions for every joint so programmatic animations compose
 * relative to the true rest basis without gimbal glitches or joint twists.
 */
export function inspectKayKitRig(root: THREE.Object3D): InspectedKayKitRig {
  // Ensure world matrices reflect the true rest pose relative to root
  root.updateMatrixWorld(true);

  const rootWorldQuat = new THREE.Quaternion();
  root.getWorldQuaternion(rootWorldQuat);
  const rootWorldQuatInv = rootWorldQuat.clone().invert();

  // Build fast lookup tables from all nodes in the cloned scene
  const exactMap = new Map<string, THREE.Object3D>();
  const normalizedMap = new Map<string, THREE.Object3D>();

  root.traverse((obj) => {
    if (!obj.name) return;
    if (!exactMap.has(obj.name)) {
      exactMap.set(obj.name, obj);
    }
    const norm = normalizeBoneLookup(obj.name);
    if (!normalizedMap.has(norm)) {
      normalizedMap.set(norm, obj);
    }
  });

  const bones = new Map<CanonicalBoneKey, InspectedBone>();

  for (const canonicalName of ALL_TRACKED_BONES) {
    const sanitized = THREE.PropertyBinding.sanitizeNodeName(canonicalName);
    const found =
      exactMap.get(sanitized) ??
      exactMap.get(canonicalName) ??
      normalizedMap.get(normalizeBoneLookup(canonicalName));

    if (!found) continue;

    const restLocalPosition = found.position.clone();
    const restLocalQuaternion = found.quaternion.clone().normalize();

    // Compute model-space (root-relative) rest orientation so root scene placement never pollutes clips
    const rawWorldQ = new THREE.Quaternion();
    found.getWorldQuaternion(rawWorldQ);
    const restWorldQuaternion = rootWorldQuatInv.clone().multiply(rawWorldQ).normalize();

    const parentWorldQ = new THREE.Quaternion();
    if (found.parent) {
      found.parent.getWorldQuaternion(parentWorldQ);
      parentWorldQ.premultiply(rootWorldQuatInv).normalize();
    } else {
      parentWorldQ.identity();
    }
    const parentRestWorldQuaternionInv = parentWorldQ.clone().invert();

    bones.set(canonicalName, {
      canonicalName,
      runtimeName: found.name,
      object: found,
      restLocalPosition,
      restLocalQuaternion,
      restWorldQuaternion,
      parentRestWorldQuaternion: parentWorldQ,
      parentRestWorldQuaternionInv,
    });
  }

  const missingRequiredBones = REQUIRED_BONES.filter((key) => !bones.has(key));
  const hipsBone = bones.get("hips");
  const hipsRestPosition = hipsBone
    ? hipsBone.restLocalPosition.clone()
    : new THREE.Vector3(0, 0.4057, 0);

  // Verify sword grip attachment on handslot.r (native 1H_Sword/2H_Sword or RomanGladius)
  const handSlotR = bones.get("handslot.r");
  const attachedWeaponNames: string[] = [];
  if (handSlotR) {
    for (const child of handSlotR.object.children) {
      if (child.name) {
        attachedWeaponNames.push(child.name);
      }
    }
  }

  const swordGripVerified =
    Boolean(handSlotR) &&
    attachedWeaponNames.some((n) => /sword|gladius|blade|weapon/i.test(n));

  const ready = missingRequiredBones.length === 0;
  const summary = ready
    ? `KayKit Rig OK (${bones.size}/${ALL_TRACKED_BONES.length} bones • grip: ${handSlotR?.runtimeName ?? "none"}${
        swordGripVerified ? ` [${attachedWeaponNames.slice(0, 2).join(", ")}]` : ""
      })`
    : `Rig Incomplete (missing: ${missingRequiredBones.slice(0, 4).join(", ")})`;

  return {
    bones,
    hipsRestPosition,
    status: {
      ready,
      foundBoneCount: bones.size,
      totalTrackedBones: ALL_TRACKED_BONES.length,
      missingRequiredBones,
      hipsRestY: hipsRestPosition.y,
      swordGripBoneName: handSlotR?.runtimeName ?? null,
      swordGripVerified,
      attachedWeaponNames,
      summary,
    },
  };
}

/**
 * Computes the exact local quaternion for an inspected bone given a character-space
 * anatomical rotation delta `[pitchXDeg, yawYDeg, rollZDeg]` (Euler order YXZ).
 *
 * Character-space conventions verified directly against `Knight.glb`:
 *   +X = character's left, +Y = up, +Z = forward
 *   - Torso/Hips/Head: +X leans forward, +Y twists left (CCW from above), +Z tilts right
 *   - Right Arm (-X in T-pose): +Z lowers arm down, -Z raises overhead, +Y swings forward across chest
 *   - Left Arm (+X in T-pose): -Z lowers arm down, +Z raises overhead, -Y swings forward across chest
 *   - Right Elbow: +Y bends forearm forward/inward across chest
 *   - Left Elbow:  -Y bends forearm forward/inward across chest
 *   - Thighs (-Y): -X swings knee forward (+Z), +X extends leg backward (-Z)
 *   - Knees:       +X bends shin backward (-Z)
 *   - Feet:        -X dorsiflexes toe upward
 *
 * Derivation:
 *   qLocal = parentRestWorldQ^-1 * qDeltaChar * restWorldQ
 * Notice that when the parent rotates by `qParentDelta`, the child's model-space orientation
 * becomes `qParentDelta * qDeltaChar * restWorldQ` — cleanly composing intrinsic joint angles
 * without bone-axis twisting!
 */
export function composeBoneLocalQuaternion(
  bone: InspectedBone,
  charDeltaDeg: readonly [number, number, number],
  out: THREE.Quaternion = new THREE.Quaternion()
): THREE.Quaternion {
  _tmpEuler.set(
    charDeltaDeg[0] * DEG2RAD,
    charDeltaDeg[1] * DEG2RAD,
    charDeltaDeg[2] * DEG2RAD,
    "YXZ"
  );
  _tmpDeltaQ.setFromEuler(_tmpEuler);

  return out
    .copy(bone.parentRestWorldQuaternionInv)
    .multiply(_tmpDeltaQ)
    .multiply(bone.restWorldQuaternion)
    .normalize();
}
