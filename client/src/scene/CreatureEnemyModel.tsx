import { memo, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { ATTACK_SPECS, ENEMY_ARCHETYPES, type AttackKind, type EnemyKind } from "@sekiroslop/shared";
import type { RoomWorldSnapshot } from "../net/useColosseumRoom";
import type { GraphicsQualityTier } from "../lib/graphicsQuality";
import { getHitStopAnimationDelta } from "../lib/hitStop";

export interface CreatureEnemyModelProps {
  entityId: string;
  graphicsTier?: GraphicsQualityTier;
  enemyKind: "stun_drone" | "dire_wolf" | "aegis_mech";
  x: number;
  y?: number;
  z: number;
  yaw: number;
  action: string;
  attackKind?: string;
  isBlocking?: boolean;
  hp: number;
  maxHp: number;
  posture: number;
  maxPosture: number;
  telegraph?: string;
  isLockedTarget?: boolean;
  worldRef?: React.MutableRefObject<RoomWorldSnapshot>;
  alive: boolean;
}

const TARGET_HEIGHTS: Record<"stun_drone" | "dire_wolf" | "aegis_mech", number> = {
  stun_drone: 1.55,
  dire_wolf: 1.35,
  aegis_mech: 3.4,
};

function samePercent(valueA: number, maxA: number, valueB: number, maxB: number): boolean {
  const percentA = maxA > 0 ? Math.round((valueA / maxA) * 100) : 0;
  const percentB = maxB > 0 ? Math.round((valueB / maxB) * 100) : 0;
  return percentA === percentB;
}

function areCreatureEnemyPropsEqual(a: CreatureEnemyModelProps, b: CreatureEnemyModelProps): boolean {
  const livePosition = a.worldRef !== undefined && a.worldRef === b.worldRef;
  return (
    a.entityId === b.entityId && a.graphicsTier === b.graphicsTier && a.enemyKind === b.enemyKind && a.worldRef === b.worldRef &&
    (livePosition || (a.x === b.x && (a.y ?? 0) === (b.y ?? 0) && a.z === b.z && a.yaw === b.yaw)) &&
    a.action === b.action && (a.attackKind ?? "") === (b.attackKind ?? "") &&
    (a.isBlocking ?? false) === (b.isBlocking ?? false) &&
    samePercent(a.hp, a.maxHp, b.hp, b.maxHp) && samePercent(a.posture, a.maxPosture, b.posture, b.maxPosture) &&
    (a.telegraph ?? "none") === (b.telegraph ?? "none") &&
    (a.isLockedTarget ?? false) === (b.isLockedTarget ?? false) && a.alive === b.alive
  );
}

function pickCreatureClip(
  enemyKind: "stun_drone" | "dire_wolf" | "aegis_mech",
  action: string,
  attackKind: string,
  available: Set<string>,
  durations: Map<string, number>
): { name: string; speed: number; loop: boolean } {
  const firstOf = (names: string[]) => names.find((n) => available.has(n)) ?? Array.from(available)[0] ?? "";
  const syncSpeed = (clipName: string, atk: string, fallback: number) => {
    const spec = ATTACK_SPECS[atk as AttackKind];
    const dur = durations.get(clipName);
    if (!spec || !dur || dur <= 0.05) return fallback;
    const totalSec = (spec.windupMs + spec.activeMs + spec.recoveryMs) / 1000;
    return Math.max(0.35, Math.min(2.4, dur / totalSec));
  };

  if (enemyKind === "stun_drone") {
    switch (action) {
      case "dead":
        return { name: firstOf(["CharacterArmature|Dead", "CharacterArmature|Idle"]), speed: 1.0, loop: false };
      case "shocked":
      case "staggered":
        return { name: firstOf(["CharacterArmature|Idle"]), speed: 1.8, loop: true };
      case "windup_light":
      case "windup_heavy":
        return { name: firstOf(["CharacterArmature|Idle"]), speed: 0.6, loop: false };
      case "attack_light":
      case "attack_heavy":
        return { name: firstOf(["CharacterArmature|Shoot", "CharacterArmature|Attack"]), speed: 1.35, loop: false };
      case "chase":
        return { name: firstOf(["CharacterArmature|Run", "CharacterArmature|Walk"]), speed: 1.15, loop: true };
      default:
        return { name: firstOf(["CharacterArmature|Idle"]), speed: 1.0, loop: true };
    }
  }

  if (enemyKind === "dire_wolf") {
    switch (action) {
      case "dead":
        return { name: firstOf(["AnimalArmature|Death"]), speed: 1.0, loop: false };
      case "shocked":
      case "staggered":
        return { name: firstOf(["AnimalArmature|Idle_HitReact_Left", "AnimalArmature|Idle"]), speed: 0.7, loop: true };
      case "hurt":
        return { name: firstOf(["AnimalArmature|Idle_HitReact_Right"]), speed: 1.35, loop: false };
      case "windup_heavy":
        return { name: firstOf(["AnimalArmature|Gallop_Jump", "AnimalArmature|Attack"]), speed: 0.45, loop: false };
      case "attack_heavy": {
        const c = firstOf(["AnimalArmature|Gallop_Jump", "AnimalArmature|Attack"]);
        return { name: c, speed: syncSpeed(c, attackKind || "enemy_wolf_pounce", 1.3), loop: false };
      }
      case "windup_light":
        return { name: firstOf(["AnimalArmature|Attack"]), speed: 0.48, loop: false };
      case "attack_light": {
        const c = firstOf(["AnimalArmature|Attack"]);
        return { name: c, speed: syncSpeed(c, attackKind || "enemy_wolf_bite", 1.45), loop: false };
      }
      case "chase":
        return { name: firstOf(["AnimalArmature|Gallop", "AnimalArmature|Walk"]), speed: 1.25, loop: true };
      case "strafe":
        return { name: firstOf(["AnimalArmature|Walk", "AnimalArmature|Idle"]), speed: 1.1, loop: true };
      default:
        return { name: firstOf(["AnimalArmature|Idle"]), speed: 1.0, loop: true };
    }
  }

  // Aegis War-Mech (George.glb)
  switch (action) {
    case "dead":
      return { name: firstOf(["Death"]), speed: 1.0, loop: false };
    case "shocked":
    case "staggered":
      return { name: firstOf(["HitRecieve_1", "HitRecieve_2", "Idle"]), speed: 0.55, loop: true };
    case "hurt":
      return { name: firstOf(["HitRecieve_2", "HitRecieve_1"]), speed: 1.2, loop: false };
    case "windup_heavy":
      return { name: firstOf(["Shoot", "Punch"]), speed: 0.45, loop: false };
    case "attack_heavy": {
      const c = firstOf([attackKind === "enemy_stun_volley" ? "Shoot" : "Punch", "SwordSlash"]);
      return { name: c, speed: syncSpeed(c, attackKind || "enemy_stun_volley", 1.3), loop: false };
    }
    case "windup_light":
      return { name: firstOf(["SwordSlash"]), speed: 0.42, loop: false };
    case "attack_light": {
      const c = firstOf(["SwordSlash"]);
      return { name: c, speed: syncSpeed(c, attackKind || "enemy_mech_slash", 1.35), loop: false };
    }
    case "chase":
      return { name: firstOf(["Run", "Walk"]), speed: 0.95, loop: true };
    case "strafe":
      return { name: firstOf(["Walk", "Idle"]), speed: 0.9, loop: true };
    default:
      return { name: firstOf(["Idle"]), speed: 0.95, loop: true };
  }
}

export const CreatureEnemyModel = memo(function CreatureEnemyModel({
  entityId,
  graphicsTier = "high",
  enemyKind,
  x,
  y = 0,
  z,
  yaw,
  action,
  attackKind = "",
  hp,
  maxHp,
  posture,
  maxPosture,
  telegraph = "none",
  isLockedTarget = false,
  worldRef,
  alive,
}: CreatureEnemyModelProps) {
  const archetype = ENEMY_ARCHETYPES[enemyKind as EnemyKind];
  const gltf = useGLTF(archetype.modelFile);

  const rootRef = useRef<THREE.Group>(null);
  const modelPivotRef = useRef<THREE.Group>(null);
  const barGroupRef = useRef<THREE.Group>(null);
  const lockDotRef = useRef<THREE.Group>(null);

  const smoothedPos = useRef(new THREE.Vector3(x, y, z));
  const smoothedYaw = useRef(yaw);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const actionsMapRef = useRef<Map<string, THREE.AnimationAction>>(new Map());
  const durationsRef = useRef<Map<string, number>>(new Map());
  const activeClipRef = useRef<string>("");

  const { clonedScene, normScale, groundOffsetY } = useMemo(() => {
    const cloned = cloneSkinned(gltf.scene);
    cloned.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        mesh.frustumCulled = false;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    cloned.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(cloned);
    const size = new THREE.Vector3();
    box.getSize(size);
    const rawHeight = Math.max(0.01, size.y);
    const scaleFactor = TARGET_HEIGHTS[enemyKind] / rawHeight;
    const offsetY = -box.min.y * scaleFactor;
    return { clonedScene: cloned, normScale: scaleFactor, groundOffsetY: offsetY };
  }, [gltf.scene, enemyKind]);

  useEffect(() => {
    const mixer = new THREE.AnimationMixer(clonedScene);
    const map = new Map<string, THREE.AnimationAction>();
    const durs = new Map<string, number>();
    for (const clip of gltf.animations) {
      map.set(clip.name, mixer.clipAction(clip));
      durs.set(clip.name, clip.duration);
    }
    mixerRef.current = mixer;
    actionsMapRef.current = map;
    durationsRef.current = durs;
    activeClipRef.current = "";

    return () => {
      mixer.stopAllAction();
      mixer.uncacheRoot(clonedScene);
      mixerRef.current = null;
      actionsMapRef.current.clear();
    };
  }, [clonedScene, gltf.animations]);

  useEffect(() => {
    const map = actionsMapRef.current;
    if (map.size === 0) return;

    const available = new Set(map.keys());
    const spec = pickCreatureClip(enemyKind, alive ? action : "dead", attackKind, available, durationsRef.current);
    if (!spec.name) return;

    const next = map.get(spec.name);
    if (!next) return;

    const prevName = activeClipRef.current;
    const prev = prevName ? map.get(prevName) : undefined;

    if (prevName !== spec.name || !spec.loop) {
      next.reset();
      next.setLoop(spec.loop ? THREE.LoopRepeat : THREE.LoopOnce, spec.loop ? Infinity : 1);
      next.clampWhenFinished = !spec.loop;
      next.setEffectiveTimeScale(spec.speed);
      next.setEffectiveWeight(1);
      if (prev && prev !== next) {
        prev.fadeOut(0.14);
        next.fadeIn(0.14).play();
      } else {
        next.play();
      }
      activeClipRef.current = spec.name;
    } else {
      next.setEffectiveTimeScale(spec.speed);
    }
  }, [action, attackKind, alive, enemyKind]);

  useFrame((state, delta) => {
    const dt = Math.min(0.05, delta);
    let tx = x;
    let ty = y;
    let tz = z;
    let tyaw = yaw;
    if (worldRef) {
      const live = worldRef.current.enemies.find((e) => e.id === entityId);
      if (live) {
        tx = live.x;
        ty = live.y;
        tz = live.z;
        tyaw = live.yaw;
      }
    }

    const posLerp = 1 - Math.exp(-15 * dt);
    smoothedPos.current.lerp(new THREE.Vector3(tx, ty, tz), posLerp);
    let dYaw = tyaw - smoothedYaw.current;
    while (dYaw > Math.PI) dYaw -= Math.PI * 2;
    while (dYaw < -Math.PI) dYaw += Math.PI * 2;
    smoothedYaw.current += dYaw * (1 - Math.exp(-15 * dt));

    if (rootRef.current) {
      rootRef.current.position.copy(smoothedPos.current);
      rootRef.current.rotation.y = smoothedYaw.current;
    }
    if (modelPivotRef.current && enemyKind === "stun_drone" && alive) {
      modelPivotRef.current.position.y = groundOffsetY + Math.sin(state.clock.elapsedTime * 3.8) * 0.16;
    }
    if (barGroupRef.current) {
      barGroupRef.current.quaternion.copy(state.camera.quaternion);
    }
    if (lockDotRef.current) {
      lockDotRef.current.quaternion.copy(state.camera.quaternion);
    }
    mixerRef.current?.update(getHitStopAnimationDelta(dt));
  });

  const hpRatio = Math.max(0, Math.min(1, maxHp > 0 ? hp / maxHp : 0));
  const postureRatio = Math.max(0, Math.min(1, maxPosture > 0 ? posture / maxPosture : 0));
  const barHeight = TARGET_HEIGHTS[enemyKind] + 0.65;

  return (
    <group ref={rootRef} position={[x, y, z]} rotation={[0, yaw, 0]} userData={{ cameraCollisionIgnore: true }}>
      <group ref={modelPivotRef} position={[0, groundOffsetY, 0]} scale={[normScale, normScale, normScale]}>
        <primitive object={clonedScene} />
      </group>

      {isLockedTarget && alive && (
        <group ref={lockDotRef} position={[0, TARGET_HEIGHTS[enemyKind] * 0.56, 0]}>
          <mesh renderOrder={999}>
            <circleGeometry args={[0.1, 20]} />
            <meshBasicMaterial color="#ffffff" depthTest={false} transparent opacity={0.98} />
          </mesh>
          <mesh renderOrder={998}>
            <circleGeometry args={[0.19, 20]} />
            <meshBasicMaterial color="#fde047" depthTest={false} transparent opacity={0.32} />
          </mesh>
        </group>
      )}

      {alive && (
        <mesh position={[0, 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[enemyKind === "aegis_mech" ? 1.2 : 0.6, enemyKind === "aegis_mech" ? 1.48 : 0.78, 32]} />
          <meshBasicMaterial
            color={action === "shocked" ? "#22d3ee" : isLockedTarget ? "#fde047" : archetype.accentColor}
            transparent
            opacity={isLockedTarget ? 0.85 : 0.45}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
      )}

      {graphicsTier !== "low" && alive && telegraph !== "none" && (
        <pointLight
          position={[0, TARGET_HEIGHTS[enemyKind] * 0.8, 0.8]}
          color={telegraph === "heavy" ? "#ff2200" : "#22d3ee"}
          intensity={10}
          distance={8}
        />
      )}

      {isLockedTarget && alive && (
        <group ref={lockDotRef} position={[0, TARGET_HEIGHTS[enemyKind] * 0.56, 0]}>
          <mesh renderOrder={999}>
            <circleGeometry args={[0.1, 20]} />
            <meshBasicMaterial color="#ffffff" depthTest={false} transparent opacity={0.98} />
          </mesh>
          <mesh renderOrder={998}>
            <circleGeometry args={[0.19, 20]} />
            <meshBasicMaterial color="#fde047" depthTest={false} transparent opacity={0.32} />
          </mesh>
        </group>
      )}

      {alive && (
        <group ref={barGroupRef} position={[0, barHeight, 0]}>
          <mesh position={[0, 0.08, 0]}>
            <planeGeometry args={[1.6, 0.13]} />
            <meshBasicMaterial color="#0f172a" transparent opacity={0.82} />
          </mesh>
          <mesh position={[-0.78 + hpRatio * 0.78, 0.08, 0.01]}>
            <planeGeometry args={[Math.max(0.001, 1.56 * hpRatio), 0.095]} />
            <meshBasicMaterial color={archetype.accentColor} />
          </mesh>
          <mesh position={[0, -0.05, 0]}>
            <planeGeometry args={[1.6, 0.08]} />
            <meshBasicMaterial color="#1e293b" transparent opacity={0.82} />
          </mesh>
          <mesh position={[-0.78 + postureRatio * 0.78, -0.05, 0.01]}>
            <planeGeometry args={[Math.max(0.001, 1.56 * postureRatio), 0.05]} />
            <meshBasicMaterial color={action === "staggered" ? "#fde047" : "#f59e0b"} />
          </mesh>
        </group>
      )}
    </group>
  );
}, areCreatureEnemyPropsEqual);
