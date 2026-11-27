import { memo, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import type { CombatEventKind } from "@sekiroslop/shared";
import { EXPERIMENTAL_SWORD_VFX_AND_HITBOX } from "./config";

export type CombatBurstKind = "deflect" | "hit" | "block" | "posture_break" | "punch";

export interface CombatBurstEvent {
  id: number;
  kind: CombatBurstKind;
  /** Exact world-space contact X coordinate. */
  x: number;
  /** Exact world-space contact Y coordinate. */
  y: number;
  /** Exact world-space contact Z coordinate. */
  z: number;
  /** Optional normalized horizontal attack swing direction X (for directional hit bursts). */
  swingDirX?: number;
  /** Optional normalized horizontal attack swing direction Z (for directional hit bursts). */
  swingDirZ?: number;
  /** Optional theme tint hex color for hit bursts. */
  colorHex?: string;
  /** Heavy / empowered attack flag amplifying burst scale and spark velocity. */
  heavy?: boolean;
  /** Timestamp in `performance.now()` ms. */
  createdAt: number;
}

export interface CombatBurstVFXProps {
  /** Shared mutable queue of combat contact burst events (pruned automatically in-place). */
  burstsRef: React.MutableRefObject<CombatBurstEvent[]>;
  enabled?: boolean;
}

const MAX_BURST_SLOTS = 12;
const SPARKS_PER_BURST = 24;
const TOTAL_SPARK_INSTANCES = MAX_BURST_SLOTS * SPARKS_PER_BURST;

/** Maps shared Colosseum combat event kinds to experimental burst kinds. */
export function mapCombatEventToBurstKind(kind: CombatEventKind): CombatBurstKind | null {
  if (kind === "deflect") return "deflect";
  if (kind === "block") return "block";
  if (kind === "stagger") return "posture_break";
  if (kind === "hit") return "hit";
  return null;
}

let _nextBurstId = 1;

/**
 * Convenience helper to enqueue a new exact-contact combat burst into `burstsRef`.
 */
export function enqueueCombatBurst(
  burstsRef: React.MutableRefObject<CombatBurstEvent[]>,
  burst: Omit<CombatBurstEvent, "id" | "createdAt">
): void {
  const list = burstsRef.current;
  if (list.length >= MAX_BURST_SLOTS) {
    list.shift();
  }
  list.push({
    ...burst,
    id: _nextBurstId++,
    createdAt: performance.now(),
  });
}

function getBurstDurationMs(kind: CombatBurstKind): number {
  switch (kind) {
    case "deflect":
      return 480;
    case "posture_break":
      return 580;
    case "punch":
      return 460;
    case "hit":
      return 380;
    case "block":
      return 340;
  }
}

/**
 * Pooled, zero-allocation procedural particle & ring bursts spawned at EXACT weapon contact points:
 * - Perfect Deflect: blazing golden spark shower (24 radial spark streaks) + expanding golden ring + white core flash
 * - Hit / Impact: directional spark & energy burst aligned to actual attack swing direction
 * - Block: crisp amber-white steel spark spray
 * - Posture Break: dramatic shockwave ring + upward energy sparks
 *
 * Renders all 12 concurrent bursts (288 spark streaks + 12 shockwave rings + 12 core flashes + 12 ground rings)
 * in just 4 total GPU draw calls via InstancedMesh with zero per-frame allocations!
 */
export const CombatBurstVFX = memo(function CombatBurstVFX({
  burstsRef,
  enabled = true,
}: CombatBurstVFXProps) {
  const sparkInstRef = useRef<THREE.InstancedMesh>(null);
  const ringInstRef = useRef<THREE.InstancedMesh>(null);
  const coreInstRef = useRef<THREE.InstancedMesh>(null);
  const groundRingInstRef = useRef<THREE.InstancedMesh>(null);

  const { sparkGeo, sparkMat, ringGeo, ringMat, coreGeo, coreMat, groundRingGeo, groundRingMat } = useMemo(() => {
    // Sleek razor-sharp elongated diamond streak pointing along +Y for crisp lookAt velocity orientation
    const sGeo = new THREE.OctahedronGeometry(0.045, 0);
    sGeo.scale(0.48, 4.6, 0.48);

    const sMat = new THREE.MeshBasicMaterial({
      color: "#ffffff",
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });

    const rGeo = new THREE.RingGeometry(0.42, 0.52, 28);
    const rMat = new THREE.MeshBasicMaterial({
      color: "#ffffff",
      transparent: true,
      opacity: 0.92,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });

    const cGeo = new THREE.OctahedronGeometry(0.32, 0);
    const cMat = new THREE.MeshBasicMaterial({
      color: "#ffffff",
      transparent: true,
      opacity: 0.98,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });

    const grGeo = new THREE.RingGeometry(0.55, 0.85, 32);
    grGeo.rotateX(-Math.PI / 2);
    const grMat = new THREE.MeshBasicMaterial({
      color: "#ffffff",
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });

    return {
      sparkGeo: sGeo,
      sparkMat: sMat,
      ringGeo: rGeo,
      ringMat: rMat,
      coreGeo: cGeo,
      coreMat: cMat,
      groundRingGeo: grGeo,
      groundRingMat: grMat,
    };
  }, []);

  useEffect(() => {
    return () => {
      sparkGeo.dispose();
      sparkMat.dispose();
      ringGeo.dispose();
      ringMat.dispose();
      coreGeo.dispose();
      coreMat.dispose();
      groundRingGeo.dispose();
      groundRingMat.dispose();
    };
  }, [sparkGeo, sparkMat, ringGeo, ringMat, coreGeo, coreMat, groundRingGeo, groundRingMat]);

  // Pre-allocated flat typed arrays & scratch math objects — zero per-frame allocations
  const poolRef = useRef<{
    slotBurstId: Int32Array;
    sparkDirX: Float32Array;
    sparkDirY: Float32Array;
    sparkDirZ: Float32Array;
    sparkSpeed: Float32Array;
    sparkLen: Float32Array;
    sparkGravity: Float32Array;
    sparkActiveCount: Uint8Array;
    // Scratch math objects
    mat4: THREE.Matrix4;
    pos: THREE.Vector3;
    vel: THREE.Vector3;
    quat: THREE.Quaternion;
    scale: THREE.Vector3;
    zeroPos: THREE.Vector3;
    zeroScale: THREE.Vector3;
    upVec: THREE.Vector3;
    color: THREE.Color;
    horizQuat: THREE.Quaternion;
  } | null>(null);
  const wasIdleRef = useRef(false);

  if (!poolRef.current) {
    const slotBurstId = new Int32Array(MAX_BURST_SLOTS);
    slotBurstId.fill(-1);
    const horizQuat = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(1, 0, 0),
      -Math.PI * 0.5
    );
    poolRef.current = {
      slotBurstId,
      sparkDirX: new Float32Array(TOTAL_SPARK_INSTANCES),
      sparkDirY: new Float32Array(TOTAL_SPARK_INSTANCES),
      sparkDirZ: new Float32Array(TOTAL_SPARK_INSTANCES),
      sparkSpeed: new Float32Array(TOTAL_SPARK_INSTANCES),
      sparkLen: new Float32Array(TOTAL_SPARK_INSTANCES),
      sparkGravity: new Float32Array(TOTAL_SPARK_INSTANCES),
      sparkActiveCount: new Uint8Array(MAX_BURST_SLOTS),
      mat4: new THREE.Matrix4(),
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      quat: new THREE.Quaternion(),
      scale: new THREE.Vector3(),
      zeroPos: new THREE.Vector3(0, -999, 0),
      zeroScale: new THREE.Vector3(0, 0, 0),
      upVec: new THREE.Vector3(0, 1, 0),
      color: new THREE.Color(),
      horizQuat,
    };
  }

  useFrame((state) => {
    if (!EXPERIMENTAL_SWORD_VFX_AND_HITBOX || !enabled) return;

    const sparkMesh = sparkInstRef.current;
    const ringMesh = ringInstRef.current;
    const coreMesh = coreInstRef.current;
    const groundRingMesh = groundRingInstRef.current;
    if (!sparkMesh || !ringMesh || !coreMesh || !groundRingMesh) return;

    const pool = poolRef.current!;
    const list = burstsRef.current;
    const now = performance.now();

    // Compact expired bursts in-place across the entire queue (zero allocations)
    // so longer bursts (e.g. posture_break 580ms) never block shorter expired bursts behind them.
    let writeIdx = 0;
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      if (now - item.createdAt < getBurstDurationMs(item.kind)) {
        if (writeIdx !== i) {
          list[writeIdx] = item;
        }
        writeIdx++;
      }
    }
    list.length = writeIdx;
    if (list.length === 0 && wasIdleRef.current) return;
    wasIdleRef.current = list.length === 0;

    const zeroScale = pool.zeroScale;
    const zeroPos = pool.zeroPos;

    for (let slot = 0; slot < MAX_BURST_SLOTS; slot++) {
      const fx = list[slot];
      const baseIdx = slot * SPARKS_PER_BURST;

      if (!fx) {
        pool.slotBurstId[slot] = -1;
        pool.mat4.compose(zeroPos, pool.quat.identity(), zeroScale);
        ringMesh.setMatrixAt(slot, pool.mat4);
        coreMesh.setMatrixAt(slot, pool.mat4);
        groundRingMesh.setMatrixAt(slot, pool.mat4);
        for (let k = 0; k < SPARKS_PER_BURST; k++) {
          sparkMesh.setMatrixAt(baseIdx + k, pool.mat4);
        }
        continue;
      }

      const durationMs = getBurstDurationMs(fx.kind);
      const elapsedMs = now - fx.createdAt;
      const age = elapsedMs / durationMs;

      if (age < 0 || age >= 1) {
        pool.mat4.compose(zeroPos, pool.quat.identity(), zeroScale);
        ringMesh.setMatrixAt(slot, pool.mat4);
        coreMesh.setMatrixAt(slot, pool.mat4);
        groundRingMesh.setMatrixAt(slot, pool.mat4);
        for (let k = 0; k < SPARKS_PER_BURST; k++) {
          sparkMesh.setMatrixAt(baseIdx + k, pool.mat4);
        }
        continue;
      }

      // Initialize deterministic per-spark trajectories once when a new burst occupies this slot
      if (pool.slotBurstId[slot] !== fx.id) {
        pool.slotBurstId[slot] = fx.id;
        let seed = ((fx.id * 2654435761) ^ 0x9e3779b9) >>> 0;
        const rand = () => {
          seed = (seed * 1664525 + 1013904223) >>> 0;
          return seed / 4294967296;
        };

        const heavyBoost = fx.heavy ? 1.28 : 1.0;

        if (fx.kind === "deflect") {
          // 24 blazing golden radial spark streaks (wider 360° fan)
          pool.sparkActiveCount[slot] = 24;
          for (let k = 0; k < 24; k++) {
            const idx = baseIdx + k;
            const phi = (k / 24) * Math.PI * 2 + (rand() - 0.5) * 0.24;
            const elev = (rand() - 0.35) * Math.PI * 0.85;
            const cosE = Math.cos(elev);
            pool.sparkDirX[idx] = Math.cos(phi) * cosE;
            pool.sparkDirY[idx] = Math.sin(elev) + 0.22;
            pool.sparkDirZ[idx] = Math.sin(phi) * cosE;
            pool.sparkSpeed[idx] = (5.6 + rand() * 6.2) * heavyBoost;
            pool.sparkLen[idx] = (1.05 + rand() * 0.95) * heavyBoost;
            pool.sparkGravity[idx] = 8.5;
          }
        } else if (fx.kind === "hit") {
          // 18 directional impact sparks aligned with the real attack swing direction
          pool.sparkActiveCount[slot] = 18;
          const hasDir =
            fx.swingDirX !== undefined &&
            fx.swingDirZ !== undefined &&
            Math.hypot(fx.swingDirX, fx.swingDirZ) > 0.05;
          const dirX = hasDir ? fx.swingDirX! : 0;
          const dirZ = hasDir ? fx.swingDirZ! : 1;
          const baseAngle = Math.atan2(dirZ, dirX);

          for (let k = 0; k < 18; k++) {
            const idx = baseIdx + k;
            const spread = hasDir ? (rand() - 0.5) * 1.15 : (k / 18) * Math.PI * 2;
            const angle = baseAngle + spread;
            const up = (rand() - 0.25) * 1.1;
            const dx = Math.cos(angle);
            const dz = Math.sin(angle);
            const invLen = 1 / Math.max(1e-4, Math.hypot(dx, up, dz));
            pool.sparkDirX[idx] = dx * invLen;
            pool.sparkDirY[idx] = up * invLen;
            pool.sparkDirZ[idx] = dz * invLen;
            pool.sparkSpeed[idx] = (4.6 + rand() * 5.0) * heavyBoost;
            pool.sparkLen[idx] = (0.8 + rand() * 0.75) * heavyBoost;
            pool.sparkGravity[idx] = 9.5;
          }
        } else if (fx.kind === "block") {
          // 12 tighter, shorter cool-amber/steel spark spray
          pool.sparkActiveCount[slot] = 12;
          for (let k = 0; k < 12; k++) {
            const idx = baseIdx + k;
            const phi = (k / 12) * Math.PI * 2 + (rand() - 0.5) * 0.35;
            const up = 0.1 + rand() * 0.85;
            const invLen = 1 / Math.hypot(Math.cos(phi), up, Math.sin(phi));
            pool.sparkDirX[idx] = Math.cos(phi) * invLen;
            pool.sparkDirY[idx] = up * invLen;
            pool.sparkDirZ[idx] = Math.sin(phi) * invLen;
            pool.sparkSpeed[idx] = 3.0 + rand() * 3.2;
            pool.sparkLen[idx] = 0.45 + rand() * 0.45;
            pool.sparkGravity[idx] = 12.0;
          }
        } else if (fx.kind === "punch") {
          // 24 radial dust-and-gold shockwave sparks erupting outward + upward on punch launch!
          pool.sparkActiveCount[slot] = 24;
          const hasDir =
            fx.swingDirX !== undefined &&
            fx.swingDirZ !== undefined &&
            Math.hypot(fx.swingDirX, fx.swingDirZ) > 0.05;
          const dirX = hasDir ? fx.swingDirX! : 0;
          const dirZ = hasDir ? fx.swingDirZ! : 1;
          for (let k = 0; k < 24; k++) {
            const idx = baseIdx + k;
            const phi = (k / 24) * Math.PI * 2 + (rand() - 0.5) * 0.25;
            const rx = Math.cos(phi) * 0.85 + dirX * 0.65;
            const ry = 0.25 + rand() * 0.95;
            const rz = Math.sin(phi) * 0.85 + dirZ * 0.65;
            const invLen = 1 / Math.max(1e-4, Math.hypot(rx, ry, rz));
            pool.sparkDirX[idx] = rx * invLen;
            pool.sparkDirY[idx] = ry * invLen;
            pool.sparkDirZ[idx] = rz * invLen;
            pool.sparkSpeed[idx] = 5.4 + rand() * 5.6;
            pool.sparkLen[idx] = 0.85 + rand() * 0.85;
            pool.sparkGravity[idx] = 7.5;
          }
        } else {
          // posture_break: 24 dramatic upward energy sparks + wide shockwave
          pool.sparkActiveCount[slot] = 24;
          for (let k = 0; k < 24; k++) {
            const idx = baseIdx + k;
            const phi = (k / 24) * Math.PI * 2 + (rand() - 0.5) * 0.2;
            const radial = 0.45 + rand() * 0.55;
            const up = 0.9 + rand() * 1.4;
            const invLen = 1 / Math.hypot(radial, up);
            pool.sparkDirX[idx] = Math.cos(phi) * radial * invLen;
            pool.sparkDirY[idx] = up * invLen;
            pool.sparkDirZ[idx] = Math.sin(phi) * radial * invLen;
            pool.sparkSpeed[idx] = 4.2 + rand() * 4.8;
            pool.sparkLen[idx] = 1.0 + rand() * 0.85;
            pool.sparkGravity[idx] = 2.2; // buoyant upward energy rise
          }
        }
      }

      const tSec = elapsedMs * 0.001;
      const fade = Math.pow(1 - age, 1.35);
      const heavyMult = fx.heavy ? 1.25 : 1.0;

      // 1. Expanding Ring Instance
      let ringScale = 0.3;
      if (fx.kind === "deflect") {
        ringScale = (0.4 + Math.pow(age, 0.52) * 2.55) * heavyMult;
        pool.color.set("#ffbe2e").multiplyScalar(fade * 1.75);
        pool.quat.copy(state.camera.quaternion);
      } else if (fx.kind === "posture_break") {
        ringScale = 0.55 + Math.pow(age, 0.5) * 3.6;
        pool.color.set("#f97316").multiplyScalar(fade * 1.7);
        pool.quat.copy(pool.horizQuat);
      } else if (fx.kind === "punch") {
        ringScale = 0.35 + Math.pow(age, 0.48) * 2.85;
        pool.color.set("#fde047").multiplyScalar(fade * 1.75);
        pool.quat.copy(state.camera.quaternion);
      } else if (fx.kind === "block") {
        ringScale = 0.2 + Math.pow(age, 0.6) * 0.95;
        pool.color.set("#cbd5e1").multiplyScalar(fade * 1.25);
        pool.quat.copy(state.camera.quaternion);
      } else {
        // hit
        ringScale = (0.28 + Math.pow(age, 0.58) * 1.45) * heavyMult;
        pool.color.set(fx.colorHex ?? "#fb7185").multiplyScalar(fade * 1.45);
        pool.quat.copy(state.camera.quaternion);
      }

      pool.pos.set(fx.x, fx.y, fx.z);
      pool.scale.set(ringScale, ringScale, ringScale);
      pool.mat4.compose(pool.pos, pool.quat, pool.scale);
      ringMesh.setMatrixAt(slot, pool.mat4);
      ringMesh.setColorAt(slot, pool.color);

      // 1b. Ground Shockwave Ring Instance (XZ plane at y = 0.06)
      if (
        fx.kind === "posture_break" ||
        fx.kind === "punch" ||
        fx.kind === "deflect" ||
        fx.heavy === true
      ) {
        const easeOut = 1 - Math.pow(1 - age, 2.2);
        const minR = fx.kind === "posture_break" ? 0.5 : 0.4;
        const maxR = fx.kind === "posture_break" ? 2.8 : 1.9;
        // RingGeometry(0.55, 0.85, 32) has outer radius 0.85
        const grScale = (minR + easeOut * (maxR - minR)) / 0.85;
        pool.pos.set(fx.x, 0.06, fx.z);
        pool.quat.identity();
        pool.scale.set(grScale, 1, grScale);
        pool.mat4.compose(pool.pos, pool.quat, pool.scale);
        groundRingMesh.setMatrixAt(slot, pool.mat4);

        if (fx.kind === "posture_break") {
          pool.color.set("#f97316").multiplyScalar(fade * 1.8);
        } else if (fx.kind === "deflect") {
          pool.color.set("#ffbe2e").multiplyScalar(fade * 1.75);
        } else if (fx.kind === "punch") {
          pool.color.set("#fde047").multiplyScalar(fade * 1.65);
        } else {
          pool.color.set(fx.colorHex ?? "#fb7185").multiplyScalar(fade * 1.55);
        }
        groundRingMesh.setColorAt(slot, pool.color);
      } else {
        pool.mat4.compose(zeroPos, pool.quat.identity(), zeroScale);
        groundRingMesh.setMatrixAt(slot, pool.mat4);
      }

      // 2. White-Hot Core Flash Instance
      const coreAge = Math.min(1, age * 2.4);
      const coreScale =
        coreAge >= 1
          ? 0
          : (1 - coreAge) *
            (fx.kind === "deflect"
              ? 1.7
              : fx.kind === "posture_break"
                ? 1.75
                : fx.kind === "punch"
                  ? 1.45
                  : fx.kind === "block"
                    ? 0.62
                    : 0.95) *
            heavyMult;

      if (coreScale > 0.005) {
        pool.pos.set(fx.x, fx.y, fx.z);
        pool.quat.copy(state.camera.quaternion);
        pool.scale.set(coreScale, coreScale, coreScale);
        pool.mat4.compose(pool.pos, pool.quat, pool.scale);
        coreMesh.setMatrixAt(slot, pool.mat4);
        if (fx.kind === "deflect") {
          pool.color.set("#fff8d6").multiplyScalar(2.0);
        } else if (fx.kind === "posture_break") {
          pool.color.set("#fef08a").multiplyScalar(1.7);
        } else if (fx.kind === "punch") {
          pool.color.set("#fff7ed").multiplyScalar(1.85);
        } else if (fx.kind === "block") {
          pool.color.set("#cbd5e1").multiplyScalar(1.25);
        } else {
          pool.color.set(fx.colorHex ?? "#ffe4e6").multiplyScalar(1.5);
        }
        coreMesh.setColorAt(slot, pool.color);
      } else {
        pool.mat4.compose(zeroPos, pool.quat.identity(), zeroScale);
        coreMesh.setMatrixAt(slot, pool.mat4);
      }

      // 3. Pooled Spark Streak Instances (up to 24 per burst)
      const activeCount = pool.sparkActiveCount[slot];
      const drag = Math.exp(-3.4 * tSec);
      const integralDrag = (1 - drag) / 3.4; // exact analytical integral of exp(-3.4*t)

      for (let k = 0; k < SPARKS_PER_BURST; k++) {
        const idx = baseIdx + k;
        if (k >= activeCount || fade <= 0.02) {
          pool.mat4.compose(zeroPos, pool.quat.identity(), zeroScale);
          sparkMesh.setMatrixAt(idx, pool.mat4);
          continue;
        }

        const speed = pool.sparkSpeed[idx];
        const grav = pool.sparkGravity[idx];
        const dx = pool.sparkDirX[idx];
        const dy = pool.sparkDirY[idx];
        const dz = pool.sparkDirZ[idx];

        // Analytical ballistic position + instantaneous tangent velocity (zero state drift)
        const px = fx.x + dx * speed * integralDrag;
        const py = fx.y + dy * speed * integralDrag - 0.5 * grav * tSec * tSec;
        const pz = fx.z + dz * speed * integralDrag;

        const vx = dx * speed * drag;
        const vy = dy * speed * drag - grav * tSec;
        const vz = dz * speed * drag;

        pool.vel.set(vx, vy, vz);
        const speedNow = pool.vel.length();
        if (speedNow > 1e-4) {
          pool.vel.divideScalar(speedNow);
          pool.quat.setFromUnitVectors(pool.upVec, pool.vel);
        } else {
          pool.quat.identity();
        }

        const thickness = fade * (fx.kind === "deflect" ? 1.05 : 0.85);
        const streakLen = pool.sparkLen[idx] * (0.35 + fade * 0.95);
        pool.pos.set(px, py, pz);
        pool.scale.set(thickness, streakLen, thickness);
        pool.mat4.compose(pool.pos, pool.quat, pool.scale);
        sparkMesh.setMatrixAt(idx, pool.mat4);

        // Per-spark vivid color shading
        if (fx.kind === "deflect") {
          pool.color.set(k % 3 === 0 ? "#fff8d6" : "#ffbe2e");
          pool.color.multiplyScalar(fade * 1.85);
        } else if (fx.kind === "posture_break") {
          pool.color.set(k % 2 === 0 ? "#fde047" : "#f97316");
          pool.color.multiplyScalar(fade * 1.65);
        } else if (fx.kind === "punch") {
          pool.color.set(k % 3 === 0 ? "#ffffff" : k % 2 === 0 ? "#fde047" : "#fb923c");
          pool.color.multiplyScalar(fade * 1.7);
        } else if (fx.kind === "block") {
          pool.color.set(k % 2 === 0 ? "#cbd5e1" : "#f59e0b");
          pool.color.multiplyScalar(fade * 1.3);
        } else {
          pool.color.set(k % 4 === 0 ? "#ffffff" : (fx.colorHex ?? "#f43f5e"));
          pool.color.multiplyScalar(fade * 1.55);
        }
        sparkMesh.setColorAt(idx, pool.color);
      }
    }

    sparkMesh.instanceMatrix.needsUpdate = true;
    if (sparkMesh.instanceColor) sparkMesh.instanceColor.needsUpdate = true;

    ringMesh.instanceMatrix.needsUpdate = true;
    if (ringMesh.instanceColor) ringMesh.instanceColor.needsUpdate = true;

    coreMesh.instanceMatrix.needsUpdate = true;
    if (coreMesh.instanceColor) coreMesh.instanceColor.needsUpdate = true;

    groundRingMesh.instanceMatrix.needsUpdate = true;
    if (groundRingMesh.instanceColor) groundRingMesh.instanceColor.needsUpdate = true;
  });

  if (!EXPERIMENTAL_SWORD_VFX_AND_HITBOX || !enabled) {
    return null;
  }

  return (
    <group name="ExperimentalCombatBurstVFX">
      <instancedMesh
        ref={sparkInstRef}
        args={[sparkGeo, sparkMat, TOTAL_SPARK_INSTANCES]}
        frustumCulled={false}
        renderOrder={24}
      />
      <instancedMesh
        ref={ringInstRef}
        args={[ringGeo, ringMat, MAX_BURST_SLOTS]}
        frustumCulled={false}
        renderOrder={23}
      />
      <instancedMesh
        ref={coreInstRef}
        args={[coreGeo, coreMat, MAX_BURST_SLOTS]}
        frustumCulled={false}
        renderOrder={25}
      />
      <instancedMesh
        ref={groundRingInstRef}
        args={[groundRingGeo, groundRingMat, MAX_BURST_SLOTS]}
        frustumCulled={false}
        renderOrder={22}
      />
    </group>
  );
});
