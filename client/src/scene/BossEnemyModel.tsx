import { memo, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { ENEMY_ARCHETYPES, type EnemyKind } from "@sekiroslop/shared";
import type { RoomWorldSnapshot } from "../net/useColosseumRoom";
import type { GraphicsQualityTier } from "../lib/graphicsQuality";
import { getHitStopAnimationDelta } from "../lib/hitStop";

export interface BossEnemyModelProps {
  entityId: string;
  graphicsTier?: GraphicsQualityTier;
  enemyKind: "dread_knight" | "dragon";
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

const TARGET_HEIGHTS: Record<"dread_knight" | "dragon", number> = {
  dread_knight: 3.15,
  dragon: 3.85,
};

function samePercent(valueA: number, maxA: number, valueB: number, maxB: number): boolean {
  const percentA = maxA > 0 ? Math.round((valueA / maxA) * 100) : 0;
  const percentB = maxB > 0 ? Math.round((valueB / maxB) * 100) : 0;
  return percentA === percentB;
}

function areBossEnemyPropsEqual(a: BossEnemyModelProps, b: BossEnemyModelProps): boolean {
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

function pickBossClip(
  enemyKind: "dread_knight" | "dragon",
  action: string,
  attackKind: string,
  available: Set<string>
): { name: string; speed: number; loop: boolean } {
  const firstOf = (names: string[]) => names.find((n) => available.has(n)) ?? Array.from(available)[0] ?? "";

  if (enemyKind === "dragon") {
    if (attackKind === "enemy_dive_lunge") {
      return {
        name: firstOf(["DragonArmature|DragonArmature|Dragon_Attack2", "2H_Melee_Attack_Chop"]),
        speed: action.startsWith("windup") ? 0.36 : 1.75,
        loop: false,
      };
    }
    if (attackKind === "enemy_tail_whip") {
      return {
        name: firstOf(["2H_Melee_Attack_Chop", "DragonArmature|DragonArmature|Dragon_Attack2"]),
        speed: action.startsWith("windup") ? 0.4 : 1.55,
        loop: false,
      };
    }
    switch (action) {
      case "dead":
        return { name: firstOf(["Death_A", "Idle"]), speed: 1.0, loop: false };
      case "hurt":
      case "staggered":
        return {
          name: firstOf(["DragonArmature|DragonArmature|Dragon_Hit", "Idle"]),
          speed: action === "staggered" ? 0.5 : 1.25,
          loop: action === "staggered",
        };
      case "windup_light":
        return {
          name: firstOf(["DragonArmature|DragonArmature|Dragon_Attack2", "Idle"]),
          speed: 0.42,
          loop: false,
        };
      case "attack_light":
        return {
          name: firstOf(["DragonArmature|DragonArmature|Dragon_Attack2", "2H_Melee_Attack_Chop"]),
          speed: 1.35,
          loop: false,
        };
      case "windup_heavy":
        return {
          name: firstOf(["2H_Melee_Attack_Chop", "DragonArmature|DragonArmature|Dragon_Attack2"]),
          speed: 0.38,
          loop: false,
        };
      case "attack_heavy":
        return {
          name: firstOf(["2H_Melee_Attack_Chop", "DragonArmature|DragonArmature|Dragon_Attack2"]),
          speed: 1.55,
          loop: false,
        };
      case "chase":
        return { name: firstOf(["Idle"]), speed: 1.45, loop: true };
      case "strafe":
        return { name: firstOf(["Idle"]), speed: 1.15, loop: true };
      default:
        return { name: firstOf(["Idle"]), speed: 1.0, loop: true };
    }
  }

  // Dread Knight (Quaternius single_knight_pack KnightCharacter.glb)
  switch (action) {
    case "dead":
      return { name: firstOf(["HumanArmature|Death", "HumanArmature|Idle"]), speed: 1.0, loop: false };
    case "staggered":
      return { name: firstOf(["HumanArmature|Idle", "HumanArmature|Idle_swordRight"]), speed: 0.45, loop: true };
    case "hurt":
      return { name: firstOf(["HumanArmature|Roll", "HumanArmature|Idle"]), speed: 1.1, loop: false };
    case "block":
      return { name: firstOf(["HumanArmature|Idle_swordLeft", "HumanArmature|Idle_swordRight"]), speed: 0.7, loop: true };
    case "windup_light":
      return { name: firstOf(["HumanArmature|Run_swordAttack", "HumanArmature|swordAttackJump"]), speed: 0.35, loop: false };
    case "attack_light":
      return { name: firstOf(["HumanArmature|Run_swordAttack", "HumanArmature|swordAttackJump"]), speed: 1.4, loop: false };
    case "windup_heavy":
      return { name: firstOf(["HumanArmature|swordAttackJump", "HumanArmature|Run_swordAttack"]), speed: 0.32, loop: false };
    case "attack_heavy":
      return { name: firstOf(["HumanArmature|swordAttackJump", "HumanArmature|Run_swordAttack"]), speed: 1.35, loop: false };
    case "chase":
      return { name: firstOf(["HumanArmature|Run_swordRight", "HumanArmature|Run", "HumanArmature|Walking"]), speed: 0.85, loop: true };
    case "strafe":
      return { name: firstOf(["HumanArmature|Walking", "HumanArmature|Idle_swordRight"]), speed: 0.9, loop: true };
    default:
      return { name: firstOf(["HumanArmature|Idle_swordRight", "HumanArmature|Idle"]), speed: 0.9, loop: true };
  }
}

function buildDreadGreatsword(): { group: THREE.Group; bladeMat: THREE.MeshStandardMaterial } {
  const group = new THREE.Group();
  group.name = "DreadKnightGreatsword";

  const handleMat = new THREE.MeshStandardMaterial({ color: "#1c1917", roughness: 0.85, metalness: 0.25 });
  const guardMat = new THREE.MeshStandardMaterial({
    color: "#3f3f46",
    roughness: 0.32,
    metalness: 0.9,
    emissive: "#7f1d1d",
    emissiveIntensity: 0.35,
  });
  const bladeMat = new THREE.MeshStandardMaterial({
    color: "#18181b",
    roughness: 0.25,
    metalness: 0.92,
    emissive: "#ef4444",
    emissiveIntensity: 0.65,
  });

  // Sized in KnightCharacter local bone units (~0.01 scale because HumanArmature has scale 100)
  const unit = 0.01;
  const pommel = new THREE.Mesh(new THREE.OctahedronGeometry(0.11 * unit, 0), guardMat);
  pommel.position.y = -0.35 * unit;
  group.add(pommel);

  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.05 * unit, 0.06 * unit, 0.55 * unit, 8), handleMat);
  grip.position.y = -0.05 * unit;
  group.add(grip);

  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.75 * unit, 0.14 * unit, 0.16 * unit), guardMat);
  guard.position.y = 0.24 * unit;
  group.add(guard);

  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.26 * unit, 2.25 * unit, 0.07 * unit), bladeMat);
  blade.position.y = 1.4 * unit;
  group.add(blade);

  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.18 * unit, 0.55 * unit, 4), bladeMat);
  tip.position.y = 2.75 * unit;
  tip.rotation.y = Math.PI * 0.25;
  group.add(tip);

  return { group, bladeMat };
}

export const BossEnemyModel = memo(function BossEnemyModel({
  entityId,
  graphicsTier = "high",
  enemyKind,
  x,
  y = 0,
  z,
  yaw,
  action,
  attackKind = "",
  isBlocking = false,
  hp,
  maxHp,
  posture,
  maxPosture,
  telegraph = "none",
  isLockedTarget = false,
  worldRef,
  alive,
}: BossEnemyModelProps) {
  const archetype = ENEMY_ARCHETYPES[enemyKind as EnemyKind];
  const gltf = useGLTF(archetype.modelFile);

  const rootRef = useRef<THREE.Group>(null);
  const modelPivotRef = useRef<THREE.Group>(null);
  const fireConeRef = useRef<THREE.Mesh>(null);
  const shockRingRef = useRef<THREE.Mesh>(null);
  const barGroupRef = useRef<THREE.Group>(null);
  const lockDotRef = useRef<THREE.Group>(null);

  const smoothedPos = useRef(new THREE.Vector3(x, y, z));
  const smoothedYaw = useRef(yaw);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const actionsMapRef = useRef<Map<string, THREE.AnimationAction>>(new Map());
  const activeClipRef = useRef<string>("");
  const dreadBladeMatRef = useRef<THREE.MeshStandardMaterial | null>(null);

  const { clonedScene, normScale, groundOffsetY } = useMemo(() => {
    const cloned = cloneSkinned(gltf.scene);

    // Style boss materials for dramatic visual distinction
    cloned.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        mesh.frustumCulled = false;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const styled = mats.map((m) => {
          const mat = m.clone() as THREE.MeshStandardMaterial;
          if (enemyKind === "dread_knight") {
            if (mat.color) mat.color.multiply(new THREE.Color("#4a3f46"));
            mat.metalness = Math.max(mat.metalness ?? 0.3, 0.72);
            mat.roughness = Math.min(mat.roughness ?? 0.6, 0.38);
            mat.emissive = new THREE.Color("#450a0a");
            mat.emissiveIntensity = 0.25;
          } else if (enemyKind === "dragon") {
            if (mat.color) mat.color.lerp(new THREE.Color("#b91c1c"), 0.55);
            mat.roughness = 0.48;
            mat.metalness = 0.18;
            mat.emissive = new THREE.Color("#7c2d12");
            mat.emissiveIntensity = 0.22;
          }
          return mat;
        });
        mesh.material = Array.isArray(mesh.material) ? styled : styled[0];
      }
    });

    // Attach molten greatsword to Dread Knight's right hand bone
    if (enemyKind === "dread_knight") {
      const hand = cloned.getObjectByName("MiddleHand.R") ?? cloned.getObjectByName("Palm.R");
      if (hand) {
        const { group, bladeMat } = buildDreadGreatsword();
        group.rotation.set(Math.PI * 0.48, 0, -Math.PI * 0.08);
        hand.add(group);
        dreadBladeMatRef.current = bladeMat;
      }
    }

    // Measure exact world bounding box to normalize height & plant feet cleanly at y = 0
    cloned.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(cloned);
    const size = new THREE.Vector3();
    box.getSize(size);
    const rawHeight = Math.max(0.01, size.y);
    const targetH = TARGET_HEIGHTS[enemyKind];
    const scaleFactor = targetH / rawHeight;
    const offsetY = -box.min.y * scaleFactor;

    return {
      clonedScene: cloned,
      normScale: scaleFactor,
      groundOffsetY: enemyKind === "dragon" ? offsetY + 0.45 : offsetY,
    };
  }, [gltf.scene, enemyKind]);

  // Setup AnimationMixer
  useEffect(() => {
    const mixer = new THREE.AnimationMixer(clonedScene);
    const map = new Map<string, THREE.AnimationAction>();
    for (const clip of gltf.animations) {
      map.set(clip.name, mixer.clipAction(clip));
    }
    mixerRef.current = mixer;
    actionsMapRef.current = map;
    activeClipRef.current = "";

    return () => {
      mixer.stopAllAction();
      mixer.uncacheRoot(clonedScene);
      mixerRef.current = null;
      actionsMapRef.current.clear();
    };
  }, [clonedScene, gltf.animations]);

  // Trigger animation transitions when action changes
  useEffect(() => {
    const map = actionsMapRef.current;
    if (map.size === 0) return;

    const available = new Set(map.keys());
    const spec = pickBossClip(enemyKind, alive ? action : "dead", attackKind, available);
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
        prev.fadeOut(0.16);
        next.fadeIn(0.16).play();
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
    const t = state.clock.elapsedTime;

    // Pull latest server position from worldRef when available for 60fps smoothness
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

    const posLerp = 1 - Math.exp(-14 * dt);
    smoothedPos.current.lerp(new THREE.Vector3(tx, ty, tz), posLerp);

    let dYaw = tyaw - smoothedYaw.current;
    while (dYaw > Math.PI) dYaw -= Math.PI * 2;
    while (dYaw < -Math.PI) dYaw += Math.PI * 2;
    smoothedYaw.current += dYaw * (1 - Math.exp(-14 * dt));

    if (rootRef.current) {
      rootRef.current.position.copy(smoothedPos.current);
      rootRef.current.rotation.y = smoothedYaw.current;
    }

    // Procedural boss flourishes (dragon hover/dive pitch, dread knight slam lean)
    if (modelPivotRef.current) {
      if (enemyKind === "dragon" && alive) {
        const hoverBob = Math.sin(t * 3.4) * 0.22;
        const divePitch = action === "attack_heavy" ? 0.34 : action === "windup_heavy" ? -0.22 : action === "chase" ? 0.12 : 0;
        modelPivotRef.current.position.y = groundOffsetY + hoverBob;
        modelPivotRef.current.rotation.x = THREE.MathUtils.lerp(modelPivotRef.current.rotation.x, divePitch, dt * 8);
      } else {
        modelPivotRef.current.position.y = groundOffsetY;
        const lean = action === "staggered" ? -0.18 : action === "attack_heavy" ? 0.16 : 0;
        modelPivotRef.current.rotation.x = THREE.MathUtils.lerp(modelPivotRef.current.rotation.x, lean, dt * 8);
      }
    }

    // Pulse Dread Knight molten greatsword during windup/attack
    if (dreadBladeMatRef.current) {
      const targetGlow =
        telegraph === "heavy" || action === "attack_heavy"
          ? 2.8
          : telegraph === "light" || action === "attack_light"
            ? 1.6
            : 0.65;
      dreadBladeMatRef.current.emissiveIntensity = THREE.MathUtils.lerp(
        dreadBladeMatRef.current.emissiveIntensity,
        targetGlow,
        dt * 10
      );
    }

    // Animate Dragon fire breath cone during attack_light
    if (fireConeRef.current) {
      const breathing = alive && enemyKind === "dragon" && action === "attack_light";
      fireConeRef.current.visible = breathing;
      if (breathing) {
        const pulse = 0.92 + Math.sin(t * 38) * 0.12;
        fireConeRef.current.scale.set(pulse, 1.0, pulse);
      }
    }

    // Animate heavy AoE telegraph / shockwave ring
    if (shockRingRef.current) {
      const showRing = alive && (telegraph === "heavy" || action === "attack_heavy");
      shockRingRef.current.visible = showRing;
      if (showRing) {
        const s = action === "attack_heavy" ? 1.18 : 0.85 + Math.sin(t * 16) * 0.12;
        shockRingRef.current.scale.set(s, s, 1);
      }
    }

    // Billboard boss health bar & lock dot toward camera
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
  const barHeight = enemyKind === "dragon" ? 4.45 : 3.75;

  return (
    <group ref={rootRef} position={[x, y, z]} rotation={[0, yaw, 0]}>
      <group ref={modelPivotRef} position={[0, groundOffsetY, 0]} scale={[normScale, normScale, normScale]}>
        <primitive object={clonedScene} />
      </group>

      {/* Sekiro-style Lock-On Dot */}
      {isLockedTarget && alive && (
        <group ref={lockDotRef} position={[0, TARGET_HEIGHTS[enemyKind] * 0.56, 0]}>
          <mesh renderOrder={999}>
            <circleGeometry args={[0.13, 20]} />
            <meshBasicMaterial color="#ffffff" depthTest={false} transparent opacity={0.98} />
          </mesh>
          <mesh renderOrder={998}>
            <circleGeometry args={[0.24, 20]} />
            <meshBasicMaterial color="#fde047" depthTest={false} transparent opacity={0.32} />
          </mesh>
        </group>
      )}

      {/* Boss Ground Aura Ring */}
      {alive && (
        <mesh position={[0, 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[1.35, 1.65, 36]} />
          <meshBasicMaterial
            color={action === "staggered" ? "#facc15" : isLockedTarget ? "#fde047" : archetype.accentColor}
            transparent
            opacity={isLockedTarget ? 0.85 : 0.42}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
      )}

      {/* Heavy AoE Shockwave / Tail-Whip Telegraph Ring */}
      <mesh ref={shockRingRef} visible={false} position={[0, 0.07, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[3.4, 4.65, 48]} />
        <meshBasicMaterial
          color={enemyKind === "dragon" ? "#ff5500" : "#ef4444"}
          transparent
          opacity={0.48}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      {/* Crimson Wyvern Fire Breath Cone VFX */}
      {enemyKind === "dragon" && (
        <mesh
          ref={fireConeRef}
          visible={false}
          position={[0, 1.9, 3.6]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <coneGeometry args={[1.65, 5.4, 18, 1, true]} />
          <meshBasicMaterial
            color="#ff6b00"
            transparent
            opacity={0.55}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
      )}

      {/* Blocking Shield Shimmer for Dread Knight */}
      {alive && enemyKind === "dread_knight" && isBlocking && (
        <mesh position={[0, 1.6, 1.05]}>
          <ringGeometry args={[0.7, 0.95, 24]} />
          <meshBasicMaterial color="#94a3b8" transparent opacity={0.65} side={THREE.DoubleSide} />
        </mesh>
      )}

      {/* Telegraph Warning Halo */}
      {graphicsTier !== "low" && alive && telegraph !== "none" && (
        <pointLight
          position={[0, 2.3, 0.9]}
          color={telegraph === "heavy" ? "#ff2200" : "#fb923c"}
          intensity={telegraph === "heavy" ? 14 : 7}
          distance={9}
        />
      )}

      {/* Billboarded Floating Boss Health & Posture Bars */}
      {alive && (
        <group ref={barGroupRef} position={[0, barHeight, 0]}>
          <mesh position={[0, 0.08, 0]}>
            <planeGeometry args={[2.2, 0.16]} />
            <meshBasicMaterial color="#0f172a" transparent opacity={0.82} />
          </mesh>
          <mesh position={[-1.08 + hpRatio * 1.08, 0.08, 0.01]}>
            <planeGeometry args={[Math.max(0.001, 2.16 * hpRatio), 0.12]} />
            <meshBasicMaterial color={archetype.accentColor} />
          </mesh>
          <mesh position={[0, -0.07, 0]}>
            <planeGeometry args={[2.2, 0.09]} />
            <meshBasicMaterial color="#1e293b" transparent opacity={0.82} />
          </mesh>
          <mesh position={[-1.08 + postureRatio * 1.08, -0.07, 0.01]}>
            <planeGeometry args={[Math.max(0.001, 2.16 * postureRatio), 0.06]} />
            <meshBasicMaterial color={action === "staggered" ? "#fde047" : "#f59e0b"} />
          </mesh>
        </group>
      )}
    </group>
  );
}, areBossEnemyPropsEqual);
