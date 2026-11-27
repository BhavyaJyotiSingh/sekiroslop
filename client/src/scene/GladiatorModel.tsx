import { memo, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import {
  ENEMY_ARCHETYPES,
  PLAYER_PALETTES,
  PLAYER_SKINS,
  type EnemyKind,
  type LocomotionAnim,
  type PlayerSkinKind,
} from "@sekiroslop/shared";
import type { PlayerSnapshot, RoomWorldSnapshot } from "../net/useColosseumRoom";
import { getHitStopAnimationDelta } from "../lib/hitStop";
import {
  EXPERIMENTAL_ARTS,
  EXPERIMENTAL_SPECIAL_MOVES,
  buildAllExperimentalClips,
  inspectKayKitRig,
  type CanonicalBoneKey,
  type InspectedBone,
  type InspectedKayKitRig,
  type ExperimentalArtKind,
  type InspectedRigStatus,
} from "../experimental/special-moves";
import {
  EXPERIMENTAL_SWORD_VFX_AND_HITBOX,
  WeaponBladeTrail,
  type SweptDebugState,
  type SweptTargetCapsule,
} from "../experimental/sword-vfx-hitbox";
import {
  SEKIRO_CLIP_NAMES,
  SEKIRO_REALISTIC_ANIMATIONS,
  buildAllSekiroCombatClips,
} from "./sekiroCombatClips";
import { getGraphicsQualityProfile, type GraphicsQualityTier } from "../lib/graphicsQuality";
import { FlightVFX } from "./FlightVFX";

interface CachedRigClips {
  clipMap: Map<string, THREE.AnimationClip>;
  clipBoneSets: Map<string, Set<string>>;
  availableNames: Set<string>;
  rigBones: Array<Omit<InspectedBone, "object">>;
  rigStatus: InspectedRigStatus | null;
  hipsRestPosition: THREE.Vector3;
}

interface RemotePlayerSample {
  at: number;
  sequence: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

const REMOTE_INTERPOLATION_DELAY_MS = 66;

const rigClipCache = new Map<string, CachedRigClips>();

function bindCachedRig(root: THREE.Object3D, cached: CachedRigClips): InspectedKayKitRig {
  const bones = new Map<CanonicalBoneKey, InspectedBone>();
  for (const info of cached.rigBones) {
    const object = root.getObjectByName(info.runtimeName);
    if (object) bones.set(info.canonicalName, { ...info, object });
  }
  return {
    bones,
    hipsRestPosition: cached.hipsRestPosition,
    status: cached.rigStatus ?? {
      ready: false,
      foundBoneCount: bones.size,
      totalTrackedBones: 0,
      missingRequiredBones: [],
      hipsRestY: cached.hipsRestPosition.y,
      swordGripBoneName: null,
      swordGripVerified: false,
      attachedWeaponNames: [],
      summary: "Rig clips cached",
    },
  };
}

function findBone(root: THREE.Object3D, ...names: string[]): THREE.Object3D | undefined {
  for (const name of names) {
    const found = root.getObjectByName(name);
    if (found) return found;
  }
  return undefined;
}

export interface LivePose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  moveAnim: LocomotionAnim;
  speedRatio: number; // 0 .. 1 for silky Idle <-> Walk <-> Run speed scaling
  isFlying?: boolean;
}

export interface GladiatorModelProps {
  entityId: string;
  kind: "player" | "skeleton";
  graphicsTier?: GraphicsQualityTier;
  enemyKind?: EnemyKind;
  slot?: number;
  team?: "red" | "blue" | "";
  skin?: PlayerSkinKind;
  x: number;
  y?: number;
  z: number;
  yaw: number;
  action: string;
  attackKind?: string;
  moveAnim?: string;
  isBlocking?: boolean;
  isFlying?: boolean;
  hp: number;
  maxHp: number;
  posture: number;
  maxPosture: number;
  telegraph?: string;
  isLocal?: boolean;
  isLockedTarget?: boolean;
  furyActive?: boolean;
  ironWillActive?: boolean;
  swiftFeetActive?: boolean;
  livePoseRef?: React.MutableRefObject<LivePose>;
  worldRef?: React.MutableRefObject<RoomWorldSnapshot>;
  activeExperimentalArt?: { kind: ExperimentalArtKind; nonce: number } | null;
  onRigInspected?: (status: InspectedRigStatus) => void;
  sweptDebugRef?: React.MutableRefObject<SweptDebugState>;
  sweptTargetsRef?: React.MutableRefObject<readonly SweptTargetCapsule[]>;
  alive: boolean;
}

const ONE_SHOT_ACTIONS = new Set([
  "light1",
  "light2",
  "heavy",
  "whirlwind",
  "thrust",
  "aerial_slam",
  "counter",
  "punch",
  "throw_pilum",
  "cast_fireball",
  "cast_arcane",
  "shoot_stun",
  "use_item",
  "attack_light",
  "attack_heavy",
  "enemy_fast",
  "enemy_lunge",
  "enemy_cleave",
  "enemy_slam",
  "enemy_fireball",
  "enemy_mist_slash",
  "dodge",
  "hurt",
  "dead",
]);

const HIDDEN_BUILTIN_PROPS = new Set([
  "1H_Sword",
  "2H_Sword",
  "1H_Sword_Offhand",
  "1H_Axe",
  "2H_Axe",
  "Mug",
  "1H_Axe_Offhand",
]);

const LOCOMOTION_CLIPS = new Set([
  "Idle",
  "Idle_Combat",
  "Walking_A",
  "Walking_Backwards",
  "Running_A",
  "Running_Strafe_Left",
  "Running_Strafe_Right",
  "Jump_Idle",
  "Jump_Start",
]);

function pickClipName(
  kind: "player" | "skeleton",
  enemyKind: EnemyKind,
  action: string,
  attackKind: string,
  moveAnim: string,
  speedRatio: number,
  available: Set<string>
): { name: string; speed: number; loop: boolean } {
  const firstOf = (names: string[]) => names.find((n) => available.has(n)) ?? "Idle";
  const useSekiro = kind === "player" && SEKIRO_REALISTIC_ANIMATIONS;

  // Animation-faithful timing for exact enemy attackKind
  if (kind === "skeleton" && attackKind && (action === "windup_light" || action === "windup_heavy" || action === "attack_light" || action === "attack_heavy")) {
    const isWindup = action === "windup_light" || action === "windup_heavy";
    if (attackKind === "enemy_fireball") {
      return {
        name: firstOf(isWindup ? ["Spellcast_Raise", "Spellcasting"] : ["Spellcast_Shoot", "Throw"]),
        speed: isWindup ? 0.75 : 1.45,
        loop: false,
      };
    }
    if (attackKind === "enemy_mist_slash") {
      return {
        name: firstOf(["1H_Melee_Attack_Slice_Diagonal", "1H_Melee_Attack_Slice_Horizontal"]),
        speed: isWindup ? 0.48 : 1.75,
        loop: false,
      };
    }
  }

  switch (action) {
    case "fly":
      return { name: firstOf(["Jump_Idle", "Idle"]), speed: 0.85, loop: true };
    case "shocked":
      return { name: firstOf(["Hit_A", "Hit_B"]), speed: 2.2, loop: true };
    case "cast_fireball":
    case "cast_arcane":
      return { name: firstOf(["Spellcast_Shoot", "Throw", "1H_Melee_Attack_Stab"]), speed: 1.5, loop: false };
    case "shoot_stun":
      return { name: firstOf(["1H_Ranged_Shoot", "Throw", "1H_Melee_Attack_Stab"]), speed: 1.55, loop: false };
    case "jump":
    case "knockback":
      if (useSekiro && available.has(SEKIRO_CLIP_NAMES.jump)) {
        return { name: SEKIRO_CLIP_NAMES.jump, speed: 1.0, loop: true };
      }
      return { name: firstOf(["Running_A", "Walking_A"]), speed: 0.9, loop: true };
    case "move":
      if (moveAnim === "jump") {
        if (useSekiro && available.has(SEKIRO_CLIP_NAMES.jump)) {
          return { name: SEKIRO_CLIP_NAMES.jump, speed: 1.0, loop: true };
        }
        return { name: firstOf(["Running_A", "Walking_A"]), speed: 0.9, loop: true };
      }
      if (moveAnim === "strafe_left") {
        return { name: firstOf(["Running_Strafe_Left", "Running_A"]), speed: 0.95 + speedRatio * 0.45, loop: true };
      }
      if (moveAnim === "strafe_right") {
        return { name: firstOf(["Running_Strafe_Right", "Running_A"]), speed: 0.95 + speedRatio * 0.45, loop: true };
      }
      if (moveAnim === "backpedal") {
        return { name: firstOf(["Walking_Backwards", "Walking_A"]), speed: 1.05 + speedRatio * 0.5, loop: true };
      }
      // Smoothly transition from brisk walk at low speed into full sprint at high speed
      if (speedRatio < 0.42 && available.has("Walking_A")) {
        return { name: "Walking_A", speed: 1.15 + speedRatio * 0.85, loop: true };
      }
      return { name: firstOf(["Running_A", "Walking_A"]), speed: 0.88 + speedRatio * 0.62, loop: true };
    case "chase":
      return {
        name: firstOf(["Running_A", "Walking_A"]),
        speed: enemyKind === "assassin" ? 1.38 : enemyKind === "skirmisher" ? 1.3 : enemyKind === "champion" ? 1.0 : 1.2,
        loop: true,
      };
    case "strafe":
      return {
        name: firstOf(["Walking_A", "Running_A"]),
        speed: enemyKind === "assassin" ? 1.25 : 1.0,
        loop: true,
      };
    case "light1":
      if (useSekiro && available.has(SEKIRO_CLIP_NAMES.light1)) {
        return { name: SEKIRO_CLIP_NAMES.light1, speed: 1.0, loop: false };
      }
      return { name: firstOf(["1H_Melee_Attack_Slice_Horizontal", "1H_Melee_Attack_Chop"]), speed: 1.75, loop: false };
    case "light2":
      if (useSekiro && available.has(SEKIRO_CLIP_NAMES.light2)) {
        return { name: SEKIRO_CLIP_NAMES.light2, speed: 1.0, loop: false };
      }
      return { name: firstOf(["1H_Melee_Attack_Slice_Diagonal", "1H_Melee_Attack_Slice_Horizontal"]), speed: 1.75, loop: false };
    case "heavy":
      if (useSekiro && available.has(SEKIRO_CLIP_NAMES.heavy)) {
        return { name: SEKIRO_CLIP_NAMES.heavy, speed: 1.0, loop: false };
      }
      return { name: firstOf(["2H_Melee_Attack_Chop", "1H_Melee_Attack_Chop"]), speed: 1.22, loop: false };
    case "whirlwind":
      if (useSekiro && available.has(SEKIRO_CLIP_NAMES.whirlwind)) {
        return { name: SEKIRO_CLIP_NAMES.whirlwind, speed: 1.0, loop: false };
      }
      return { name: firstOf(["2H_Melee_Attack_Spin", "2H_Melee_Attack_Spinning", "1H_Melee_Attack_Slice_Horizontal"]), speed: 1.5, loop: false };
    case "thrust":
      if (useSekiro && available.has(SEKIRO_CLIP_NAMES.thrust)) {
        return { name: SEKIRO_CLIP_NAMES.thrust, speed: 1.0, loop: false };
      }
      return { name: firstOf(["2H_Melee_Attack_Stab", "1H_Melee_Attack_Stab"]), speed: 1.38, loop: false };
    case "aerial_slam":
      if (useSekiro && available.has(SEKIRO_CLIP_NAMES.aerial_slam)) {
        return { name: SEKIRO_CLIP_NAMES.aerial_slam, speed: 1.0, loop: false };
      }
      return { name: firstOf(["2H_Melee_Attack_Chop", "1H_Melee_Attack_Chop"]), speed: 1.45, loop: false };
    case "counter":
      if (useSekiro && available.has(SEKIRO_CLIP_NAMES.counter)) {
        return { name: SEKIRO_CLIP_NAMES.counter, speed: 1.0, loop: false };
      }
      return { name: firstOf(["Block_Attack", "1H_Melee_Attack_Slice_Diagonal"]), speed: 1.65, loop: false };
    case "punch":
      if (useSekiro && available.has(SEKIRO_CLIP_NAMES.punch)) {
        return { name: SEKIRO_CLIP_NAMES.punch, speed: 1.0, loop: false };
      }
      return { name: firstOf(["1H_Melee_Attack_Stab", "1H_Melee_Attack_Slice_Horizontal"]), speed: 1.9, loop: false };
    case "throw_pilum":
      return { name: firstOf(["Throw", "1H_Melee_Attack_Stab"]), speed: 1.45, loop: false };
    case "use_item":
      return { name: firstOf(["Use_Item", "Cheer"]), speed: 1.45, loop: false };
    case "enemy_fast":
      if (enemyKind === "assassin") {
        return {
          name: firstOf(["Dualwield_Melee_Attack_Slice", "1H_Melee_Attack_Slice_Horizontal"]),
          speed: 1.85,
          loop: false,
        };
      }
      return {
        name: firstOf(["1H_Melee_Attack_Slice_Horizontal", "1H_Melee_Attack_Chop"]),
        speed: 1.75,
        loop: false,
      };
    case "enemy_lunge":
      return {
        name: firstOf(["Dualwield_Melee_Attack_Stab", "1H_Melee_Attack_Stab", "2H_Melee_Attack_Stab"]),
        speed: 1.65,
        loop: false,
      };
    case "enemy_cleave":
      return {
        name: firstOf(["2H_Melee_Attack_Slice", "1H_Melee_Attack_Slice_Horizontal", "2H_Melee_Attack_Chop"]),
        speed: 1.28,
        loop: false,
      };
    case "enemy_slam":
      return {
        name: firstOf(["2H_Melee_Attack_Chop", "1H_Melee_Attack_Chop"]),
        speed: 1.22,
        loop: false,
      };
    case "windup_light":
      if (enemyKind === "assassin") {
        return {
          name: firstOf(["Dualwield_Melee_Attack_Slice", "1H_Melee_Attack_Slice_Horizontal"]),
          speed: 0.44,
          loop: false,
        };
      }
      if (enemyKind === "champion") {
        return {
          name: firstOf(["2H_Melee_Attack_Slice", "1H_Melee_Attack_Slice_Horizontal"]),
          speed: 0.3,
          loop: false,
        };
      }
      return {
        name: firstOf(["1H_Melee_Attack_Slice_Horizontal"]),
        speed: enemyKind === "skirmisher" ? 0.45 : 0.35,
        loop: false,
      };
    case "attack_light":
      if (enemyKind === "assassin") {
        return {
          name: firstOf(["Dualwield_Melee_Attack_Slice", "1H_Melee_Attack_Slice_Horizontal"]),
          speed: 1.85,
          loop: false,
        };
      }
      if (enemyKind === "champion") {
        return {
          name: firstOf(["2H_Melee_Attack_Slice", "1H_Melee_Attack_Slice_Horizontal"]),
          speed: 1.32,
          loop: false,
        };
      }
      return {
        name: firstOf(["1H_Melee_Attack_Slice_Horizontal"]),
        speed: enemyKind === "skirmisher" ? 1.75 : 1.45,
        loop: false,
      };
    case "windup_heavy":
      if (enemyKind === "assassin") {
        return {
          name: firstOf(["Dualwield_Melee_Attack_Stab", "1H_Melee_Attack_Stab"]),
          speed: 0.3,
          loop: false,
        };
      }
      if (enemyKind === "champion") {
        return {
          name: firstOf(["2H_Melee_Attack_Chop", "1H_Melee_Attack_Chop"]),
          speed: 0.24,
          loop: false,
        };
      }
      if (enemyKind === "skirmisher") {
        return {
          name: firstOf(["1H_Melee_Attack_Slice_Diagonal", "1H_Melee_Attack_Chop"]),
          speed: 0.36,
          loop: false,
        };
      }
      return { name: firstOf(["1H_Melee_Attack_Chop"]), speed: 0.25, loop: false };
    case "attack_heavy":
      if (enemyKind === "assassin") {
        return {
          name: firstOf(["Dualwield_Melee_Attack_Stab", "1H_Melee_Attack_Stab"]),
          speed: 1.65,
          loop: false,
        };
      }
      if (enemyKind === "champion") {
        return {
          name: firstOf(["2H_Melee_Attack_Chop", "1H_Melee_Attack_Chop"]),
          speed: 1.24,
          loop: false,
        };
      }
      if (enemyKind === "skirmisher") {
        return {
          name: firstOf(["1H_Melee_Attack_Slice_Diagonal", "1H_Melee_Attack_Chop"]),
          speed: 1.55,
          loop: false,
        };
      }
      return { name: firstOf(["1H_Melee_Attack_Chop"]), speed: 1.35, loop: false };
    case "block":
      if (useSekiro && available.has(SEKIRO_CLIP_NAMES.block)) {
        return { name: SEKIRO_CLIP_NAMES.block, speed: 1.0, loop: true };
      }
      return { name: firstOf(["Blocking", "Block"]), speed: 1.0, loop: true };
    case "dodge":
      if (useSekiro && available.has(SEKIRO_CLIP_NAMES.dodge)) {
        return { name: SEKIRO_CLIP_NAMES.dodge, speed: 1.0, loop: false };
      }
      return { name: firstOf(["Dodge_Forward", "Running_A"]), speed: 1.6, loop: false };
    case "hurt":
      return { name: firstOf(["Hit_A", "Hit_B"]), speed: 1.35, loop: false };
    case "staggered":
      return { name: firstOf(["Hit_B", "Hit_A"]), speed: 0.55, loop: true };
    case "dead":
      return { name: firstOf(["Death_A", "Death_B"]), speed: 1.0, loop: false };
    default:
      if (useSekiro && available.has(SEKIRO_CLIP_NAMES.idle)) {
        return { name: SEKIRO_CLIP_NAMES.idle, speed: 1.0, loop: true };
      }
      return {
        name: kind === "skeleton" ? firstOf(["Idle_Combat", "Idle"]) : firstOf(["Idle"]),
        speed: 1.0,
        loop: true,
      };
  }
}

function buildRomanGladius(
  isSkeleton: boolean,
  playerAccent = "#c89d3c"
): { group: THREE.Group; bladeMat: THREE.MeshStandardMaterial } {
  const sword = new THREE.Group();
  sword.name = "RomanGladius";
  sword.rotation.set(Math.PI * 0.5, 0, 0);

  const grip = new THREE.Mesh(
    new THREE.CylinderGeometry(0.032, 0.036, 0.24, 6),
    new THREE.MeshStandardMaterial({ color: "#4a2e16", roughness: 0.85 })
  );
  grip.position.y = 0.05;
  sword.add(grip);

  const guard = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.06, 0.08),
    new THREE.MeshStandardMaterial({
      color: isSkeleton ? "#57534e" : playerAccent,
      metalness: 0.72,
      roughness: 0.35,
    })
  );
  guard.position.y = 0.19;
  sword.add(guard);

  const bladeMat = new THREE.MeshStandardMaterial({
    color: isSkeleton ? "#a8a29e" : "#e2e8f0",
    metalness: 0.85,
    roughness: 0.2,
    emissive: new THREE.Color("#000000"),
    emissiveIntensity: 0,
  });

  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.088, 0.9, 0.026), bladeMat);
  blade.position.y = 0.67;
  blade.castShadow = true;
  sword.add(blade);

  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.054, 0.22, 4), bladeMat);
  tip.position.y = 1.22;
  tip.rotation.y = Math.PI * 0.25;
  sword.add(tip);

  return { group: sword, bladeMat };
}

function buildRomanShield(primaryColor: string, accentColor: string): THREE.Group {
  const shield = new THREE.Group();
  shield.name = "RomanShield";
  shield.position.set(0.08, 0.05, 0.1);
  shield.rotation.set(0, Math.PI * 0.5, 0);

  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.42, 0.42, 0.06, 14),
    new THREE.MeshStandardMaterial({ color: primaryColor, roughness: 0.65, metalness: 0.2 })
  );
  body.rotation.x = Math.PI * 0.5;
  body.castShadow = true;
  shield.add(body);

  const boss = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 8, 8),
    new THREE.MeshStandardMaterial({ color: accentColor, metalness: 0.78, roughness: 0.3 })
  );
  boss.position.z = 0.04;
  shield.add(boss);

  return shield;
}

function buildBronzeShortGladius(): { group: THREE.Group; bladeMat: THREE.MeshStandardMaterial } {
  const sword = new THREE.Group();
  sword.name = "SkirmisherBronzeGladius";
  sword.rotation.set(Math.PI * 0.5, 0, 0);

  const grip = new THREE.Mesh(
    new THREE.CylinderGeometry(0.028, 0.032, 0.21, 6),
    new THREE.MeshStandardMaterial({ color: "#5c3a1a", roughness: 0.85 })
  );
  grip.position.y = 0.04;
  sword.add(grip);

  const guard = new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 0.05, 0.065),
    new THREE.MeshStandardMaterial({ color: "#b45309", metalness: 0.72, roughness: 0.35 })
  );
  guard.position.y = 0.16;
  sword.add(guard);

  const bladeMat = new THREE.MeshStandardMaterial({
    color: "#d99b43",
    metalness: 0.78,
    roughness: 0.26,
    emissive: new THREE.Color("#000000"),
    emissiveIntensity: 0,
  });

  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.072, 0.64, 0.022), bladeMat);
  blade.position.y = 0.5;
  blade.castShadow = true;
  sword.add(blade);

  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.044, 0.18, 4), bladeMat);
  tip.position.y = 0.9;
  tip.rotation.y = Math.PI * 0.25;
  sword.add(tip);

  return { group: sword, bladeMat };
}

function buildCurvedDagger(mirror = false): { group: THREE.Group; bladeMat: THREE.MeshStandardMaterial } {
  const dagger = new THREE.Group();
  dagger.name = mirror ? "AssassinDaggerL" : "AssassinDaggerR";
  dagger.rotation.set(Math.PI * 0.5, 0, mirror ? 0.16 : -0.16);

  const grip = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025, 0.028, 0.19, 6),
    new THREE.MeshStandardMaterial({ color: "#27272a", roughness: 0.8 })
  );
  grip.position.y = 0.04;
  dagger.add(grip);

  const guard = new THREE.Mesh(
    new THREE.BoxGeometry(0.15, 0.04, 0.055),
    new THREE.MeshStandardMaterial({ color: "#7e22ce", metalness: 0.75, roughness: 0.28 })
  );
  guard.position.y = 0.14;
  dagger.add(guard);

  const bladeMat = new THREE.MeshStandardMaterial({
    color: "#cbd5e1",
    metalness: 0.9,
    roughness: 0.18,
    emissive: new THREE.Color("#6b21a8"),
    emissiveIntensity: 0.22,
  });

  // Two angled segments creating a wicked curved assassin sickle-dagger silhouette
  const lowerBlade = new THREE.Mesh(new THREE.BoxGeometry(0.058, 0.34, 0.02), bladeMat);
  lowerBlade.position.set(mirror ? -0.015 : 0.015, 0.32, 0);
  lowerBlade.rotation.z = mirror ? 0.14 : -0.14;
  lowerBlade.castShadow = true;
  dagger.add(lowerBlade);

  const upperBlade = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.28, 0.018), bladeMat);
  upperBlade.position.set(mirror ? -0.055 : 0.055, 0.58, 0);
  upperBlade.rotation.z = mirror ? 0.34 : -0.34;
  upperBlade.castShadow = true;
  dagger.add(upperBlade);

  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.032, 0.15, 4), bladeMat);
  tip.position.set(mirror ? -0.11 : 0.11, 0.76, 0);
  tip.rotation.z = mirror ? 0.44 : -0.44;
  tip.rotation.y = Math.PI * 0.25;
  dagger.add(tip);

  return { group: dagger, bladeMat };
}

function buildChampionGreatsword(): { group: THREE.Group; bladeMat: THREE.MeshStandardMaterial } {
  const sword = new THREE.Group();
  sword.name = "ChampionGreatsword";
  sword.rotation.set(Math.PI * 0.5, 0, 0);

  const pommel = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.068, 0),
    new THREE.MeshStandardMaterial({
      color: "#d4af37",
      metalness: 0.85,
      roughness: 0.25,
      emissive: new THREE.Color("#b91c1c"),
      emissiveIntensity: 0.35,
    })
  );
  pommel.position.y = -0.14;
  sword.add(pommel);

  const grip = new THREE.Mesh(
    new THREE.CylinderGeometry(0.042, 0.046, 0.34, 8),
    new THREE.MeshStandardMaterial({ color: "#451a03", roughness: 0.78 })
  );
  grip.position.y = 0.04;
  sword.add(grip);

  const guard = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.09, 0.12),
    new THREE.MeshStandardMaterial({
      color: "#d97706",
      metalness: 0.86,
      roughness: 0.24,
      emissive: new THREE.Color("#991b1b"),
      emissiveIntensity: 0.25,
    })
  );
  guard.position.y = 0.24;
  sword.add(guard);

  const bladeMat = new THREE.MeshStandardMaterial({
    color: "#f59e0b",
    metalness: 0.85,
    roughness: 0.2,
    emissive: new THREE.Color("#dc2626"),
    emissiveIntensity: 0.42,
  });

  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.32, 0.04), bladeMat);
  blade.position.y = 0.92;
  blade.castShadow = true;
  sword.add(blade);

  // Crimson fuller core running down the center of the greatsword
  const fuller = new THREE.Mesh(
    new THREE.BoxGeometry(0.055, 1.18, 0.048),
    new THREE.MeshStandardMaterial({
      color: "#7f1d1d",
      metalness: 0.65,
      roughness: 0.25,
      emissive: new THREE.Color("#ef4444"),
      emissiveIntensity: 0.65,
    })
  );
  fuller.position.y = 0.9;
  sword.add(fuller);

  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.105, 0.34, 4), bladeMat);
  tip.position.y = 1.74;
  tip.rotation.y = Math.PI * 0.25;
  sword.add(tip);

  return { group: sword, bladeMat };
}

function buildBossCrestPlume(): THREE.Group {
  const plume = new THREE.Group();
  plume.name = "BossCrestPlume";
  // Positioned cleanly atop Barbarian_Hat on head bone
  plume.position.set(0, 0.72, -0.02);

  const base = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.11, 0.56),
    new THREE.MeshStandardMaterial({
      color: "#eab308",
      metalness: 0.85,
      roughness: 0.22,
      emissive: new THREE.Color("#b45309"),
      emissiveIntensity: 0.28,
    })
  );
  base.position.y = -0.18;
  plume.add(base);

  const mainCrest = new THREE.Mesh(
    new THREE.BoxGeometry(0.14, 0.42, 0.78),
    new THREE.MeshStandardMaterial({
      color: "#b91c1c",
      roughness: 0.65,
      emissive: new THREE.Color("#dc2626"),
      emissiveIntensity: 0.25,
    })
  );
  mainCrest.position.y = 0.06;
  plume.add(mainCrest);

  const goldTrim = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.08, 0.82),
    new THREE.MeshStandardMaterial({
      color: "#fde047",
      metalness: 0.8,
      roughness: 0.25,
      emissive: new THREE.Color("#f59e0b"),
      emissiveIntensity: 0.35,
    })
  );
  goldTrim.position.y = 0.26;
  plume.add(goldTrim);

  return plume;
}

function buildHelmetPlume(
  plumeColor: string,
  accentColor: string,
  skin: PlayerSkinKind
): THREE.Group {
  const plume = new THREE.Group();
  plume.name = `PlayerCrest_${skin}`;
  plume.position.set(0, 0.58, 0);

  const crestWidth = skin === "golden_champion" ? 0.16 : skin === "shadow_shinobi" ? 0.085 : 0.11;
  const crestHeight = skin === "golden_champion" ? 0.36 : skin === "ashina_ronin" ? 0.22 : 0.28;
  const crest = new THREE.Mesh(
    new THREE.BoxGeometry(crestWidth, crestHeight, 0.58),
    new THREE.MeshStandardMaterial({
      color: plumeColor,
      roughness: skin === "shadow_shinobi" ? 0.45 : 0.78,
      metalness: skin === "golden_champion" ? 0.35 : 0.05,
    })
  );
  if (skin === "shadow_shinobi") crest.rotation.z = -0.18;
  plume.add(crest);

  const base = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.08, 0.42),
    new THREE.MeshStandardMaterial({
      color: accentColor,
      metalness: skin === "ashina_ronin" ? 0.85 : 0.7,
      roughness: 0.3,
    })
  );
  base.position.y = -0.14;
  plume.add(base);

  if (skin === "shadow_shinobi") {
    const foreheadMark = new THREE.Mesh(
      new THREE.BoxGeometry(0.025, 0.12, 0.34),
      new THREE.MeshStandardMaterial({ color: accentColor, metalness: 0.3, roughness: 0.5 })
    );
    foreheadMark.position.set(0, -0.2, 0.02);
    plume.add(foreheadMark);
  }

  return plume;
}

export const GladiatorModel = memo(function GladiatorModel({
  entityId,
  kind,
  graphicsTier = "high",
  enemyKind = "legionary",
  slot = 0,
  team = "",
  skin = "knight",
  x,
  y = 0,
  z,
  yaw,
  action,
  attackKind = "",
  moveAnim = "idle",
  isBlocking = false,
  isFlying = false,
  hp,
  maxHp,
  posture,
  maxPosture,
  telegraph = "none",
  isLocal = false,
  isLockedTarget = false,
  furyActive = false,
  ironWillActive = false,
  swiftFeetActive = false,
  livePoseRef,
  worldRef,
  activeExperimentalArt = null,
  onRigInspected,
  sweptDebugRef,
  sweptTargetsRef,
  alive,
}: GladiatorModelProps) {
  const resolvedEnemyKind: EnemyKind = enemyKind in ENEMY_ARCHETYPES ? enemyKind : "legionary";
  const archetype = kind === "skeleton" ? ENEMY_ARCHETYPES[resolvedEnemyKind] : null;
  const isBoss = Boolean(archetype?.isBoss);
  const modelScale = archetype ? archetype.scale : 1.0;

  const skinSpec = PLAYER_SKINS[skin] ?? PLAYER_SKINS.knight;
  const gltfPath = archetype ? archetype.modelFile : skinSpec.modelFile;
  const gltf = useGLTF(gltfPath);
  const sharedAnimGltf = useGLTF("/assets/models/Knight.glb");
  const weaponPath =
    kind === "player"
      ? skin === "shadow_shinobi" || skin === "ashina_ronin"
        ? "/assets/weapons/Katana.glb"
        : skin === "golden_champion"
          ? "/assets/weapons/Claymore.glb"
          : skin === "cyber_valkyrie"
            ? "/assets/weapons/StunPistol.glb"
            : gltfPath
      : resolvedEnemyKind === "mist_shinobi"
        ? "/assets/weapons/Scythe.glb"
        : gltfPath;
  const weaponGltf = useGLTF(weaponPath);
  const palette = skin === "knight" ? PLAYER_PALETTES[slot % PLAYER_PALETTES.length] : skinSpec;

  const rootRef = useRef<THREE.Group>(null);
  const flightStateRef = useRef(isFlying);
  const wasAliveRef = useRef(alive);
  const remoteHistoryRef = useRef<RemotePlayerSample[]>([]);
  const barGroupRef = useRef<THREE.Group>(null);
  const lockReticleRef = useRef<THREE.Group>(null);
  const telegraphRef = useRef<THREE.Mesh>(null);
  const staggerRef = useRef<THREE.Mesh>(null);
  const ironAuraRef = useRef<THREE.Mesh>(null);
  const swiftAuraRef = useRef<THREE.Mesh>(null);
  const bossRingRef = useRef<THREE.Mesh>(null);

  const {
    model,
    clipMap,
    clipBoneSets,
    inspectedRig,
    availableNames,
    bladeMats,
    swordObject,
    rigStatus,
    normalizedSkinScale,
    skinGroundOffsetY,
    disposableGeometries,
    disposableMaterials,
  } = useMemo(() => {
    const cloned = cloneSkinned(gltf.scene);
    const disposablesGeo = new Set<THREE.BufferGeometry>();
    const disposablesMat = new Set<THREE.Material>();

    const trackProceduralGroup = (group: THREE.Object3D) => {
      group.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          const mesh = obj as THREE.Mesh;
          mesh.frustumCulled = false;
          if (mesh.geometry) disposablesGeo.add(mesh.geometry);
          if (Array.isArray(mesh.material)) {
            for (const m of mesh.material) disposablesMat.add(m);
          } else if (mesh.material) {
            disposablesMat.add(mesh.material);
          }
        }
      });
    };

    cloned.traverse((obj) => {
      if (HIDDEN_BUILTIN_PROPS.has(obj.name) && !(kind === "player" && skin === "arcane_battlemage") && resolvedEnemyKind !== "pyromancer") {
        obj.visible = false;
      }
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        mesh.frustumCulled = false;
        mesh.castShadow = kind === "player" || graphicsTier !== "low";
        mesh.receiveShadow = true;
        if (kind === "player" && mesh.material && skin === "knight") {
          const tint = new THREE.Color(palette.primary);
          if (Array.isArray(mesh.material)) {
            mesh.material = mesh.material.map((orig) => {
              const mat = (orig as THREE.MeshStandardMaterial).clone();
              mat.emissive = tint;
              mat.emissiveIntensity = 0.08;
              disposablesMat.add(mat);
              return mat;
            });
          } else {
            const mat = (mesh.material as THREE.MeshStandardMaterial).clone();
            mat.emissive = tint;
            mat.emissiveIntensity = 0.08;
            disposablesMat.add(mat);
            mesh.material = mat;
          }
        }
      }
    });

    // Measure raw character body height before attaching plumes/weapons so all player skins share a universal height
    let computedSkinScale = 1.0;
    let computedGroundOffsetY = 0;
    if (kind === "player") {
      cloned.updateMatrixWorld(true);
      const skinBox = new THREE.Box3().setFromObject(cloned);
      const skinSize = new THREE.Vector3();
      skinBox.getSize(skinSize);
      const rawH = Math.max(0.1, skinSize.y);
      computedSkinScale = 2.05 / rawH;
      computedGroundOffsetY = -skinBox.min.y * computedSkinScale;
    }

    // GLTFLoader sanitizes "." out of node names at runtime (handslot.r -> handslotr)
    const rightHand = findBone(cloned, "handslotr", "handslot.r", "handr", "hand.r");
    const leftHand = findBone(cloned, "handslotl", "handslot.l", "handl", "hand.l");
    const head = findBone(cloned, "head");
    const mats: THREE.MeshStandardMaterial[] = [];
    let playerSwordObj: THREE.Object3D | null = null;

    const attachNormalizedWeapon = (
      weaponScene: THREE.Object3D,
      parent: THREE.Object3D | undefined,
      targetLength: number,
      rotEuler: [number, number, number],
      emissiveHex?: string
    ) => {
      if (!parent) return null;
      const w = weaponScene.clone(true);
      const box = new THREE.Box3().setFromObject(w);
      const sz = new THREE.Vector3();
      box.getSize(sz);
      const maxDim = Math.max(0.01, sz.x, sz.y, sz.z);
      w.scale.setScalar(targetLength / maxDim);
      w.rotation.set(rotEuler[0], rotEuler[1], rotEuler[2]);
      w.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          const m = o as THREE.Mesh;
          m.frustumCulled = false;
          m.castShadow = true;
          const orig = m.material as THREE.MeshStandardMaterial;
          const clonedMat = orig.clone();
          if (emissiveHex) {
            clonedMat.emissive = new THREE.Color(emissiveHex);
            clonedMat.emissiveIntensity = 0.35;
          }
          m.material = clonedMat;
          mats.push(clonedMat);
          disposablesMat.add(clonedMat);
        }
      });
      parent.add(w);
      return w;
    };

    if (kind === "player") {
      if (skin === "shadow_shinobi") {
        playerSwordObj = attachNormalizedWeapon(weaponGltf.scene, rightHand, 1.35, [Math.PI * 0.5, 0, 0]);
      } else if (skin === "ashina_ronin") {
        playerSwordObj = attachNormalizedWeapon(weaponGltf.scene, rightHand, 1.72, [Math.PI * 0.5, 0, 0], "#dc2626");
      } else if (skin === "golden_champion") {
        playerSwordObj = attachNormalizedWeapon(weaponGltf.scene, rightHand, 1.68, [Math.PI * 0.5, 0, 0], "#eab308");
      } else if (skin === "arcane_battlemage") {
        // Mage.glb comes with 2H_Staff & Spellbook_open on its rig!
        const staff = findBone(cloned, "2H_Staff", "1H_Wand");
        playerSwordObj = staff ?? rightHand ?? null;
      } else if (skin === "cyber_valkyrie") {
        const energyBlade = buildRomanGladius(false, "#22d3ee");
        energyBlade.bladeMat.color.set("#67e8f9");
        energyBlade.bladeMat.emissive.set("#06b6d4");
        energyBlade.bladeMat.emissiveIntensity = 1.1;
        trackProceduralGroup(energyBlade.group);
        mats.push(energyBlade.bladeMat);
        playerSwordObj = energyBlade.group;
        rightHand?.add(energyBlade.group);
        attachNormalizedWeapon(weaponGltf.scene, leftHand, 0.55, [0, Math.PI * 0.5, 0], "#22d3ee");
      } else {
        const gladius = buildRomanGladius(false, palette.accent);
        const shield = buildRomanShield(palette.primary, palette.accent);
        const plume = buildHelmetPlume(palette.plume, palette.accent, skin);
        trackProceduralGroup(gladius.group);
        trackProceduralGroup(shield);
        trackProceduralGroup(plume);
        mats.push(gladius.bladeMat);
        playerSwordObj = gladius.group;
        rightHand?.add(gladius.group);
        leftHand?.add(shield);
        head?.add(plume);
      }
    } else if (resolvedEnemyKind === "skirmisher") {
      // Agile Velite Skirmisher: lighter short bronze gladius, no shield
      const bronzeGladius = buildBronzeShortGladius();
      trackProceduralGroup(bronzeGladius.group);
      mats.push(bronzeGladius.bladeMat);
      rightHand?.add(bronzeGladius.group);
    } else if (resolvedEnemyKind === "assassin") {
      // Arena Stalker: twin curved daggers in both hands
      const daggerR = buildCurvedDagger(false);
      const daggerL = buildCurvedDagger(true);
      trackProceduralGroup(daggerR.group);
      trackProceduralGroup(daggerL.group);
      mats.push(daggerR.bladeMat, daggerL.bladeMat);
      rightHand?.add(daggerR.group);
      leftHand?.add(daggerL.group);
    } else if (resolvedEnemyKind === "mist_shinobi") {
      attachNormalizedWeapon(weaponGltf.scene, rightHand, 1.85, [Math.PI * 0.5, 0, 0], "#a855f7");
    } else if (resolvedEnemyKind === "pyromancer") {
      // Skeleton_Mage.glb has its own staff & hat
    } else if (resolvedEnemyKind === "champion") {
      // Murmillo Champion Boss: towering Barbarian with glowing greatsword, built-in round shield, and boss plume
      const greatsword = buildChampionGreatsword();
      const bossPlume = buildBossCrestPlume();
      trackProceduralGroup(greatsword.group);
      trackProceduralGroup(bossPlume);
      mats.push(greatsword.bladeMat);
      rightHand?.add(greatsword.group);
      // Keep Barbarian_Round_Shield visible on left hand; add tall golden-crimson Boss Crest Plume on head
      head?.add(bossPlume);
    } else {
      // Skeleton Legionary: iron gladius + iron shield
      const gladius = buildRomanGladius(true);
      const shield = buildRomanShield("#3f3a34", "#9ca3af");
      trackProceduralGroup(gladius.group);
      trackProceduralGroup(shield);
      mats.push(gladius.bladeMat);
      rightHand?.add(gladius.group);
      leftHand?.add(shield);
    }

    let clipMap: Map<string, THREE.AnimationClip>;
    let clipBoneSets: Map<string, Set<string>>;
    let availableNames: Set<string>;
    let inspectedRig: InspectedKayKitRig | null = null;
    let inspectedStatus: InspectedRigStatus | null = null;
    const cachedClips = rigClipCache.get(gltfPath);

    if (cachedClips) {
      clipMap = cachedClips.clipMap;
      clipBoneSets = cachedClips.clipBoneSets;
      availableNames = cachedClips.availableNames;
      if ((EXPERIMENTAL_SPECIAL_MOVES || SEKIRO_REALISTIC_ANIMATIONS) && kind === "player") {
        inspectedRig = bindCachedRig(cloned, cachedClips);
        inspectedStatus = EXPERIMENTAL_SPECIAL_MOVES ? cachedClips.rigStatus : null;
      }
    } else {
      // Rig inspection and retargeting are model-path invariant. Cache their immutable
      // clips and bind only the bone object references to each per-entity skeleton clone.
      const map = new Map<string, THREE.AnimationClip>();
      const boneSetByClip = new Map<string, Set<string>>();
      const names = new Set<string>();
      const expClipsToRegister: THREE.AnimationClip[] = [];
      let playerRig: InspectedKayKitRig | null = null;
      if ((EXPERIMENTAL_SPECIAL_MOVES || SEKIRO_REALISTIC_ANIMATIONS) && kind === "player") {
        playerRig = inspectKayKitRig(cloned);
        inspectedRig = playerRig;
        if (EXPERIMENTAL_SPECIAL_MOVES) {
          inspectedStatus = playerRig.status;
          expClipsToRegister.push(...Object.values(buildAllExperimentalClips(playerRig)));
        }
        if (SEKIRO_REALISTIC_ANIMATIONS) {
          expClipsToRegister.push(...Object.values(buildAllSekiroCombatClips(playerRig)));
        }
      }

      const registerClipBones = (clip: THREE.AnimationClip) => {
        const set = new Set<string>();
        for (const track of clip.tracks) {
          const dot = track.name.indexOf(".");
          if (dot > 0) set.add(track.name.slice(0, dot));
        }
        boneSetByClip.set(clip.name, set);
      };

      const usingSharedAnims = gltf.animations.length === 0;
      const sourceAnims = usingSharedAnims ? sharedAnimGltf.animations : gltf.animations;
      const targetHips = findBone(cloned, "hips");
      const sourceHips = usingSharedAnims ? findBone(sharedAnimGltf.scene, "hips") : undefined;
      const hipsRatio =
        usingSharedAnims && targetHips && sourceHips && sourceHips.position.y > 0.05
          ? targetHips.position.y / sourceHips.position.y
          : 1.0;

      for (const srcClip of sourceAnims) {
        let clip = srcClip.clone();
        if (usingSharedAnims) {
          const retargetedTracks: THREE.KeyframeTrack[] = [];
          for (const track of clip.tracks) {
            if (track.name.endsWith(".scale")) continue;
            if (track.name.endsWith(".position")) {
              const dot = track.name.indexOf(".");
              const boneName = dot > 0 ? track.name.slice(0, dot).toLowerCase() : "";
              if (boneName !== "hips") continue;
              if (Math.abs(hipsRatio - 1.0) > 0.01) {
                const scaledTrack = track.clone();
                for (let i = 0; i < scaledTrack.values.length; i++) {
                  scaledTrack.values[i] *= hipsRatio;
                }
                retargetedTracks.push(scaledTrack);
                continue;
              }
            }
            retargetedTracks.push(track);
          }
          clip = new THREE.AnimationClip(clip.name, clip.duration, retargetedTracks);
        } else {
          clip.tracks = clip.tracks.filter((t) => !t.name.endsWith(".scale"));
        }
        if (LOCOMOTION_CLIPS.has(clip.name)) {
          for (const track of clip.tracks) {
            if (track.times.length >= 3) track.setInterpolation(THREE.InterpolateSmooth);
          }
        }
        map.set(clip.name, clip);
        names.add(clip.name);
        registerClipBones(clip);
      }
      for (const expClip of expClipsToRegister) {
        if (map.has(expClip.name)) continue;
        map.set(expClip.name, expClip);
        names.add(expClip.name);
        registerClipBones(expClip);
      }

      clipMap = map;
      clipBoneSets = boneSetByClip;
      availableNames = names;
      rigClipCache.set(gltfPath, {
        clipMap,
        clipBoneSets,
        availableNames,
        rigBones: playerRig ? Array.from(playerRig.bones.values(), ({ object: _object, ...bone }) => bone) : [],
        rigStatus: playerRig?.status ?? null,
        hipsRestPosition: playerRig?.hipsRestPosition ?? new THREE.Vector3(0, 0.4057, 0),
      });
    }
    return {
      model: cloned,
      clipMap,
      clipBoneSets,
      inspectedRig,
      availableNames,
      bladeMats: mats,
      swordObject: playerSwordObj,
      rigStatus: inspectedStatus,
      normalizedSkinScale: computedSkinScale,
      skinGroundOffsetY: computedGroundOffsetY,
      disposableGeometries: disposablesGeo,
      disposableMaterials: disposablesMat,
    };
  }, [gltf, sharedAnimGltf, weaponGltf, kind, resolvedEnemyKind, gltfPath, skin, graphicsTier, palette.accent, palette.plume, palette.primary]);

  useEffect(() => {
    return () => {
      for (const geo of disposableGeometries) {
        geo.dispose();
      }
      for (const mat of disposableMaterials) {
        mat.dispose();
      }
    };
  }, [disposableGeometries, disposableMaterials]);

  useEffect(() => {
    if (EXPERIMENTAL_SPECIAL_MOVES && isLocal && rigStatus && onRigInspected) {
      onRigInspected(rigStatus);
    }
  }, [isLocal, onRigInspected, rigStatus]);

  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const currentClipRef = useRef<THREE.AnimationAction | null>(null);
  const currentClipNameRef = useRef<string>("");
  const lastOneShotActionRef = useRef<string>("");
  const [combatSwingNonce, setCombatSwingNonce] = useState<number>(0);
  const lastExpArtNonceRef = useRef<number>(0);
  const expArtUntilRef = useRef<number>(0);

  useEffect(() => {
    const mixer = new THREE.AnimationMixer(model);
    mixerRef.current = mixer;
    return () => {
      mixer.stopAllAction();
      mixer.uncacheRoot(model);
      mixerRef.current = null;
      currentClipRef.current = null;
      currentClipNameRef.current = "";
      lastOneShotActionRef.current = "";
      expArtUntilRef.current = 0;
    };
  }, [model]);

  const transitionToClip = (nextAction: string, nextMoveAnim: string, speedRatio = 1.0) => {
    const mixer = mixerRef.current;
    if (!mixer) return;

    const spec = pickClipName(kind, resolvedEnemyKind, nextAction, attackKind, nextMoveAnim, speedRatio, availableNames);
    const isOneShot = ONE_SHOT_ACTIONS.has(nextAction);

    // If the exact same looping clip is already playing, NEVER reset it mid-stride — only tune timeScale!
    if (!isOneShot && currentClipNameRef.current === spec.name && currentClipRef.current) {
      currentClipRef.current.timeScale = THREE.MathUtils.lerp(
        currentClipRef.current.timeScale,
        spec.speed,
        0.25
      );
      return;
    }

    // Avoid re-triggering the same one-shot action repeatedly while still playing
    if (isOneShot && lastOneShotActionRef.current === nextAction && currentClipNameRef.current === spec.name) {
      return;
    }

    const clip = clipMap.get(spec.name);
    if (!clip) return;

    // Restore rest quaternion on any rig bone NOT animated by the incoming clip so hands/wrists never stick
    if (inspectedRig) {
      const animatedSet = clipBoneSets.get(spec.name);
      for (const info of inspectedRig.bones.values()) {
        if (!animatedSet || !animatedSet.has(info.runtimeName)) {
          info.object.quaternion.copy(info.restLocalQuaternion);
        }
      }
    }

    const next = mixer.clipAction(clip);
    next.enabled = true;
    next.timeScale = spec.speed;

    if (spec.loop) {
      next.setLoop(THREE.LoopRepeat, Infinity);
      next.clampWhenFinished = false;
      // Only reset if not already fading/running to keep stride phase fluid
      if (!next.isRunning()) {
        next.reset();
      }
    } else {
      next.reset();
      next.setLoop(THREE.LoopOnce, 1);
      next.clampWhenFinished = nextAction === "dead";
    }

    const fadeDuration = isOneShot || nextAction === "block" ? 0.045 : 0.12;
    if (currentClipRef.current && currentClipRef.current !== next) {
      next.crossFadeFrom(currentClipRef.current, fadeDuration, false);
    }
    next.play();

    if (isOneShot) {
      setCombatSwingNonce((n) => n + 1);
    }
    currentClipRef.current = next;
    currentClipNameRef.current = spec.name;
    lastOneShotActionRef.current = isOneShot ? nextAction : "";
  };

  const baseEffectiveAction = !alive
    ? "dead"
    : isBlocking &&
        (action === "idle" ||
          action === "move" ||
          action === "jump" ||
          action === "chase" ||
          action === "strafe" ||
          action === "block")
      ? "block"
      : action;

  // Trigger procedural Experimental Combat Art clip on new nonce (non-destructive, never mutates native clips)
  useEffect(() => {
    if (!EXPERIMENTAL_SPECIAL_MOVES || kind !== "player") return;
    if (!activeExperimentalArt) {
      if (expArtUntilRef.current > 0) {
        expArtUntilRef.current = 0;
        if (!isLocal || (baseEffectiveAction !== "idle" && baseEffectiveAction !== "move" && baseEffectiveAction !== "jump")) {
          transitionToClip(baseEffectiveAction, moveAnim, 1.0);
        }
      }
      return;
    }
    if (activeExperimentalArt.nonce === lastExpArtNonceRef.current) return;
    const mixer = mixerRef.current;
    const artSpec = EXPERIMENTAL_ARTS[activeExperimentalArt.kind];
    if (!artSpec) return;
    const clip = clipMap.get(artSpec.clipName);
    if (!mixer || !clip) return;

    lastExpArtNonceRef.current = activeExperimentalArt.nonce;
    expArtUntilRef.current = performance.now() + artSpec.durationMs;

    const next = mixer.clipAction(clip);
    next.enabled = true;
    next.timeScale = 1.0;
    next.reset();
    next.setLoop(THREE.LoopOnce, 1);
    next.clampWhenFinished = false;
    if (currentClipRef.current && currentClipRef.current !== next) {
      next.crossFadeFrom(currentClipRef.current, 0.08, false);
    }
    next.play();

    currentClipRef.current = next;
    currentClipNameRef.current = clip.name;
    lastOneShotActionRef.current = activeExperimentalArt.kind;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeExperimentalArt, clipMap, kind]);

  // For local player: ONLY combat/override states come from server props (locomotion is driven 100% in useFrame!)
  // Include `model` so skin changes immediately re-bind the active clip on the new mixer (prevents remote T-pose).
  useEffect(() => {
    const isLoco =
      baseEffectiveAction === "idle" ||
      baseEffectiveAction === "move" ||
      baseEffectiveAction === "jump" ||
      baseEffectiveAction === "fly" ||
      baseEffectiveAction === "knockback";
    if (isLocal && isLoco) return;
    if (EXPERIMENTAL_SPECIAL_MOVES && alive && performance.now() < expArtUntilRef.current) return;
    transitionToClip(baseEffectiveAction, moveAnim, 1.0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseEffectiveAction, attackKind, moveAnim, isLocal, resolvedEnemyKind, model]);

  const initializedRef = useRef(false);

  useFrame((state, delta) => {
    const clampedDelta = Math.min(delta, 0.05);
    mixerRef.current?.update(getHitStopAnimationDelta(clampedDelta));

    const expArtPlaying =
      EXPERIMENTAL_SPECIAL_MOVES &&
      kind === "player" &&
      Boolean(activeExperimentalArt) &&
      performance.now() < expArtUntilRef.current;

    // Blade glow for Experimental Arts, Special Moves, Attacks, Block, Boss Greatsword & Warrior's Fury aura
    let emissiveHex = "#000000";
    let emissiveIntensity = 0;

    if (expArtPlaying && activeExperimentalArt) {
      const artSpec = EXPERIMENTAL_ARTS[activeExperimentalArt.kind];
      emissiveHex = artSpec.bladeGlowColor;
      emissiveIntensity = artSpec.bladeGlowIntensity;
    } else if (action === "counter") {
      emissiveHex = "#fef08a";
      emissiveIntensity = 1.65;
    } else if (action === "whirlwind" || action === "thrust" || action === "aerial_slam") {
      emissiveHex = "#f97316";
      emissiveIntensity = 1.45;
    } else if (
      action === "heavy" ||
      action === "windup_heavy" ||
      action === "attack_heavy" ||
      action === "enemy_slam" ||
      action === "enemy_lunge"
    ) {
      emissiveHex = resolvedEnemyKind === "assassin" ? "#c084fc" : "#f59e0b";
      emissiveIntensity = 1.25;
    } else if (furyActive) {
      emissiveHex = "#ef4444";
      emissiveIntensity = 0.95 + Math.sin(state.clock.elapsedTime * 12) * 0.25;
    } else if (
      action === "light1" ||
      action === "light2" ||
      action === "attack_light" ||
      action === "enemy_fast" ||
      action === "enemy_cleave"
    ) {
      emissiveHex = isBoss ? "#fb923c" : resolvedEnemyKind === "assassin" ? "#a855f7" : "#e2e8f0";
      emissiveIntensity = isBoss ? 1.05 : 0.6;
    } else if (isBlocking) {
      emissiveHex = "#60a5fa";
      emissiveIntensity = 0.4;
    } else if (isBoss) {
      emissiveHex = "#dc2626";
      emissiveIntensity = 0.38 + Math.sin(state.clock.elapsedTime * 5) * 0.14;
    } else if (kind === "skeleton" && resolvedEnemyKind === "assassin") {
      emissiveHex = "#6b21a8";
      emissiveIntensity = 0.22;
    }

    for (const mat of bladeMats) {
      mat.emissive.set(emissiveHex);
      mat.emissiveIntensity = emissiveIntensity;
    }

    if (ironAuraRef.current) {
      ironAuraRef.current.rotation.y += clampedDelta * 2.2;
    }
    if (swiftAuraRef.current) {
      swiftAuraRef.current.rotation.z -= clampedDelta * 5.0;
    }
    if (bossRingRef.current) {
      const pulse = 1 + Math.sin(state.clock.elapsedTime * 4.5) * 0.08;
      bossRingRef.current.scale.set(pulse, pulse, 1);
      bossRingRef.current.rotation.z += clampedDelta * 0.7;
    }

    const root = rootRef.current;
    if (root) {
      if (isLocal && livePoseRef) {
        // Native 60-144 FPS local transform & velocity-blended locomotion (zero server clip fighting!)
        const pose = livePoseRef.current;
        flightStateRef.current = pose.isFlying ?? isFlying;
        root.position.set(pose.x, pose.y, pose.z);
        root.rotation.y = pose.yaw;
        initializedRef.current = true;

        if (
          alive &&
          !isBlocking &&
          !expArtPlaying &&
          (action === "idle" || action === "move" || action === "jump" || action === "fly" || action === "knockback")
        ) {
          const localAct = (pose.isFlying ?? isFlying) ? "fly" : pose.y > 0.12 ? "jump" : pose.moveAnim === "idle" ? "idle" : "move";
          transitionToClip(localAct, pose.moveAnim, pose.speedRatio);
        }
      } else {
        // Read latest 30Hz transform directly from worldRef (decoupled from React re-renders!)
        let tx = x;
        let ty = y;
        let tz = z;
        let tyaw = yaw;
        let livePlayer: PlayerSnapshot | undefined;
        if (worldRef) {
          if (kind === "player") {
            livePlayer = worldRef.current.players.find((p) => p.id === entityId);
            flightStateRef.current = livePlayer?.isFlying ?? isFlying;
            if (livePlayer) {
              tx = livePlayer.x;
              ty = livePlayer.y;
              tz = livePlayer.z;
              tyaw = livePlayer.yaw;
            }
          } else {
            const liveE = worldRef.current.enemies.find((e) => e.id === entityId);
            if (liveE) {
              tx = liveE.x;
              ty = liveE.y;
              tz = liveE.z;
              tyaw = liveE.yaw;
            }
          }
        }

        const liveAlive = livePlayer?.alive ?? alive;
        const respawned = kind === "player" && !wasAliveRef.current && liveAlive;
        wasAliveRef.current = liveAlive;

        if (kind === "player" && livePlayer) {
          const now = performance.now();
          const history = remoteHistoryRef.current;
          if (respawned) history.length = 0;
          const previous = history[history.length - 1];
          if (
            !previous ||
            livePlayer.lastMoveSeq !== previous.sequence ||
            Math.abs(livePlayer.x - previous.x) > 0.001 ||
            Math.abs(livePlayer.y - previous.y) > 0.001 ||
            Math.abs(livePlayer.z - previous.z) > 0.001 ||
            Math.abs(Math.atan2(Math.sin(livePlayer.yaw - previous.yaw), Math.cos(livePlayer.yaw - previous.yaw))) > 0.001
          ) {
            history.push({
              at: respawned || !previous ? now - REMOTE_INTERPOLATION_DELAY_MS : now,
              sequence: livePlayer.lastMoveSeq,
              x: livePlayer.x,
              y: livePlayer.y,
              z: livePlayer.z,
              yaw: livePlayer.yaw,
            });
            if (history.length > 8) history.shift();
          }

          if (history.length > 0 && !respawned) {
            const renderAt = now - REMOTE_INTERPOLATION_DELAY_MS;
            let from = history[0];
            let to: RemotePlayerSample | undefined;
            for (let i = 1; i < history.length; i += 1) {
              if (history[i].at >= renderAt) {
                from = history[i - 1];
                to = history[i];
                break;
              }
            }
            if (to && to.at > from.at) {
              const alpha = THREE.MathUtils.clamp((renderAt - from.at) / (to.at - from.at), 0, 1);
              tx = THREE.MathUtils.lerp(from.x, to.x, alpha);
              ty = THREE.MathUtils.lerp(from.y, to.y, alpha);
              tz = THREE.MathUtils.lerp(from.z, to.z, alpha);
              const yawDelta = Math.atan2(Math.sin(to.yaw - from.yaw), Math.cos(to.yaw - from.yaw));
              tyaw = from.yaw + yawDelta * alpha;
            } else {
              const latest = history[history.length - 1];
              const ahead = Math.min(0.033, Math.max(0, (renderAt - latest.at) / 1000));
              tx = latest.x + livePlayer.velocityX * ahead;
              ty = latest.y + livePlayer.velocityY * ahead;
              tz = latest.z + livePlayer.velocityZ * ahead;
              tyaw = latest.yaw;
            }
          }
        }

        if (!initializedRef.current || respawned) {
          root.position.set(tx, ty, tz);
          root.rotation.y = tyaw;
          initializedRef.current = true;
        } else if (kind === "player") {
          // Remote players render from a short timestamped snapshot buffer. This avoids
          // frame-rate-dependent chasing and keeps motion continuous between 30 Hz patches.
          root.position.set(tx, ty, tz);
          const diff = Math.atan2(Math.sin(tyaw - root.rotation.y), Math.cos(tyaw - root.rotation.y));
          root.rotation.y += diff * (1 - Math.exp(-24 * clampedDelta));
        } else {
          const dx = tx - root.position.x;
          const dz = tz - root.position.z;
          const distance = Math.hypot(dx, dz);
          const easedStep = distance * (1 - Math.exp(-20 * clampedDelta));
          const maxStep = 30 * clampedDelta;
          const step = Math.min(distance, easedStep, maxStep);
          const t = distance > 1e-5 ? step / distance : 1;
          root.position.x += dx * t;
          root.position.y = THREE.MathUtils.lerp(root.position.y, ty, 1 - Math.exp(-20 * clampedDelta));
          root.position.z += dz * t;
          const diff = Math.atan2(Math.sin(tyaw - root.rotation.y), Math.cos(tyaw - root.rotation.y));
          root.rotation.y += diff * (1 - Math.exp(-20 * clampedDelta));
        }
      }
      const targetPitch = flightStateRef.current && root.position.y > 0.2 ? 0.18 : 0;
      root.rotation.x = THREE.MathUtils.lerp(root.rotation.x, targetPitch, Math.min(1, clampedDelta * 10));
    }

    if (barGroupRef.current) {
      barGroupRef.current.quaternion.copy(state.camera.quaternion);
    }

    if (lockReticleRef.current) {
      lockReticleRef.current.quaternion.copy(state.camera.quaternion);
      const pulse = 1 + Math.sin(state.clock.elapsedTime * 8) * 0.1;
      lockReticleRef.current.scale.set(pulse, pulse, pulse);
    }

    if (telegraphRef.current) {
      const s = 1 + Math.sin(state.clock.elapsedTime * 22) * 0.18;
      telegraphRef.current.scale.set(s, s, s);
    }
    if (staggerRef.current) {
      staggerRef.current.rotation.z += clampedDelta * 4;
    }
  });

  const hpPct = Math.max(0, Math.min(1, hp / Math.max(1, maxHp)));
  const posturePct = Math.max(0, Math.min(1, posture / Math.max(1, maxPosture)));
  const showOverheadBar = !isLocal && alive;
  const barWidth = isBoss ? 1.52 : 1.15;
  const barInnerWidth = isBoss ? 1.46 : 1.11;

  return (
    <group ref={rootRef} userData={{ cameraCollisionIgnore: true }}>
      <primitive
        object={model}
        scale={archetype ? modelScale : normalizedSkinScale}
        position={[0, archetype ? 0 : skinGroundOffsetY, 0]}
      />

      {kind === "player" && alive && (
        <FlightVFX active={isFlying} activeRef={flightStateRef} graphicsTier={graphicsTier} />
      )}

      {EXPERIMENTAL_SWORD_VFX_AND_HITBOX && kind === "player" && swordObject && (
        <WeaponBladeTrail
          swordObject={swordObject}
          action={activeExperimentalArt?.kind ?? action}
          attackNonce={(activeExperimentalArt?.nonce ?? 0) + combatSwingNonce}
          furyActive={furyActive}
          isBlocking={isBlocking}
          alive={alive}
          entityId={entityId}
          debugStateRef={sweptDebugRef}
          targetsRef={sweptTargetsRef}
          trailSubSteps={getGraphicsQualityProfile(graphicsTier).bladeTrailSubSteps}
        />
      )}

      {/* 3v3 Team Ground Ring */}
      {alive && (team === "red" || team === "blue") && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.045, 0]}>
          <ringGeometry args={[0.62, 0.82, 24]} />
          <meshBasicMaterial
            color={team === "red" ? "#ef4444" : "#3b82f6"}
            transparent
            opacity={0.85}
            depthWrite={false}
          />
        </mesh>
      )}

      {/* Enemy Archetype Ground Accent Rings */}
      {kind === "skeleton" && alive && resolvedEnemyKind === "skirmisher" && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
          <ringGeometry args={[0.52, 0.65, 20]} />
          <meshBasicMaterial color="#eab308" transparent opacity={0.58} depthWrite={false} />
        </mesh>
      )}

      {kind === "skeleton" && alive && resolvedEnemyKind === "legionary" && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
          <ringGeometry args={[0.58, 0.73, 20]} />
          <meshBasicMaterial color="#dc2626" transparent opacity={0.56} depthWrite={false} />
        </mesh>
      )}

      {kind === "skeleton" && alive && resolvedEnemyKind === "assassin" && (
        <group position={[0, 0.035, 0]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.55, 0.74, 24]} />
            <meshBasicMaterial
              color="#a855f7"
              transparent
              opacity={0.62}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]}>
            <ringGeometry args={[0.36, 0.44, 6]} />
            <meshBasicMaterial
              color="#d8b4fe"
              transparent
              opacity={0.45}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
        </group>
      )}

      {kind === "skeleton" && alive && resolvedEnemyKind === "champion" && (
        <group position={[0, 0.04, 0]}>
          <mesh ref={bossRingRef} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.88, 1.18, 28]} />
            <meshBasicMaterial
              color="#f97316"
              transparent
              opacity={0.78}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.008, 0]}>
            <ringGeometry args={[0.68, 0.84, 24]} />
            <meshBasicMaterial
              color="#ef4444"
              transparent
              opacity={0.72}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
        </group>
      )}

      {/* Active Power-Up 3D Visual Auras */}
      {alive && furyActive && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.08, 0]}>
          <ringGeometry args={[0.76, 1.02, 20]} />
          <meshBasicMaterial
            color="#f97316"
            transparent
            opacity={0.72}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
      )}

      {alive && ironWillActive && (
        <mesh ref={ironAuraRef} position={[0, 1.05, 0]}>
          <cylinderGeometry args={[0.82, 0.82, 1.45, 6, 1, true]} />
          <meshBasicMaterial
            color="#38bdf8"
            transparent
            opacity={0.24}
            side={THREE.DoubleSide}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
      )}

      {alive && swiftFeetActive && (
        <mesh ref={swiftAuraRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.14, 0]}>
          <ringGeometry args={[0.68, 0.92, 6]} />
          <meshBasicMaterial
            color="#4ade80"
            transparent
            opacity={0.75}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
      )}

      {isLockedTarget && alive && (
        <group ref={lockReticleRef} position={[0, 1.32 * modelScale, 0]}>
          <mesh renderOrder={999}>
            <circleGeometry args={[0.09, 20]} />
            <meshBasicMaterial color="#ffffff" depthTest={false} transparent opacity={0.98} />
          </mesh>
          <mesh renderOrder={998}>
            <circleGeometry args={[0.17, 20]} />
            <meshBasicMaterial color="#fde047" depthTest={false} transparent opacity={0.32} />
          </mesh>
        </group>
      )}

      {alive && telegraph !== "none" && (
        <mesh ref={telegraphRef} position={[0, 2.38 * modelScale, 0]}>
          <octahedronGeometry args={[telegraph === "heavy" ? 0.28 : 0.19, 0]} />
          <meshBasicMaterial color={telegraph === "heavy" ? "#ef4444" : "#fde047"} />
        </mesh>
      )}

      {alive && action === "staggered" && (
        <mesh ref={staggerRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 2.28 * modelScale, 0]}>
          <ringGeometry args={[0.28, 0.44, 6]} />
          <meshBasicMaterial color="#f97316" side={THREE.DoubleSide} />
        </mesh>
      )}

      {showOverheadBar && (
        <group ref={barGroupRef} position={[0, (isBoss ? 2.82 : 2.65) * modelScale, 0]}>
          <mesh position={[0, 0.08, 0]}>
            <planeGeometry args={[barWidth, isBoss ? 0.14 : 0.11]} />
            <meshBasicMaterial color={isBoss ? "#450a0a" : "#1c1917"} />
          </mesh>
          <mesh
            position={[-(barInnerWidth / 2) * (1 - Math.max(0.001, hpPct)), 0.08, 0.005]}
            scale={[Math.max(0.001, hpPct), 1, 1]}
          >
            <planeGeometry args={[barInnerWidth, isBoss ? 0.095 : 0.075]} />
            <meshBasicMaterial
              color={
                team === "red"
                  ? "#ef4444"
                  : team === "blue"
                    ? "#3b82f6"
                    : kind === "skeleton"
                      ? (archetype?.accentColor ?? "#dc2626")
                      : palette.plume
              }
            />
          </mesh>
          <mesh position={[0, -0.04, 0]}>
            <planeGeometry args={[barWidth, 0.08]} />
            <meshBasicMaterial color="#1c1917" />
          </mesh>
          <mesh position={[0, -0.04, 0.005]} scale={[Math.max(0.001, posturePct), 1, 1]}>
            <planeGeometry args={[barInnerWidth, 0.05]} />
            <meshBasicMaterial color={posturePct > 0.78 ? "#f97316" : "#eab308"} />
          </mesh>
        </group>
      )}
    </group>
  );
}, areGladiatorModelPropsEqual);

function areGladiatorModelPropsEqual(prev: GladiatorModelProps, next: GladiatorModelProps): boolean {
  const transformIsLive = Boolean(
    (prev.livePoseRef && prev.livePoseRef === next.livePoseRef) ||
      (prev.worldRef && prev.worldRef === next.worldRef)
  );
  const sameTransform = transformIsLive ||
    (prev.x === next.x && prev.y === next.y && prev.z === next.z && prev.yaw === next.yaw);
  const sameHealth =
    Math.round((prev.hp / Math.max(1, prev.maxHp)) * 100) ===
      Math.round((next.hp / Math.max(1, next.maxHp)) * 100) &&
    Math.round((prev.posture / Math.max(1, prev.maxPosture)) * 100) ===
      Math.round((next.posture / Math.max(1, next.maxPosture)) * 100);
  const prevArt = prev.activeExperimentalArt;
  const nextArt = next.activeExperimentalArt;

  return (
    sameTransform &&
    sameHealth &&
    prev.entityId === next.entityId &&
    prev.kind === next.kind &&
    prev.graphicsTier === next.graphicsTier &&
    prev.enemyKind === next.enemyKind &&
    prev.slot === next.slot &&
    prev.team === next.team &&
    prev.skin === next.skin &&
    prev.action === next.action &&
    prev.attackKind === next.attackKind &&
    prev.moveAnim === next.moveAnim &&
    prev.isBlocking === next.isBlocking &&
    prev.isFlying === next.isFlying &&
    prev.telegraph === next.telegraph &&
    prev.isLocal === next.isLocal &&
    prev.isLockedTarget === next.isLockedTarget &&
    prev.furyActive === next.furyActive &&
    prev.ironWillActive === next.ironWillActive &&
    prev.swiftFeetActive === next.swiftFeetActive &&
    prev.livePoseRef === next.livePoseRef &&
    prev.worldRef === next.worldRef &&
    prev.sweptDebugRef === next.sweptDebugRef &&
    prev.sweptTargetsRef === next.sweptTargetsRef &&
    prev.onRigInspected === next.onRigInspected &&
    prev.alive === next.alive &&
    prevArt?.kind === nextArt?.kind &&
    prevArt?.nonce === nextArt?.nonce
  );
}
