import { memo, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import type { AttackKind, PowerUpKind } from "@sekiroslop/shared";
import { POWER_UPS } from "@sekiroslop/shared";
import type { RoomWorldSnapshot } from "../net/useColosseumRoom";
import type { LivePose } from "./GladiatorModel";
import { EXPERIMENTAL_SWORD_VFX_AND_HITBOX } from "../experimental/sword-vfx-hitbox";

export interface SlashEffect {
  id: number;
  kind: AttackKind | "powerup";
  powerUpKind?: PowerUpKind;
  attackerId?: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  createdAt: number;
  delayMs: number;
  durationMs: number;
}

interface SlashVFXProps {
  slashesRef: React.MutableRefObject<SlashEffect[]>;
  worldRef: React.MutableRefObject<RoomWorldSnapshot>;
  sessionId: string;
  localPoseRef: React.MutableRefObject<LivePose>;
}

const MAX_SLASH_SLOTS = 12;

/**
 * Builds a sleek tapered crescent ribbon centered around +Y (PI/2) so rotating X by +PI/2
 * aligns the arc directly in front (+Z) of the gladiator. Vertex colors fade cleanly from
 * a blazing outer razor edge to a wispy inner tail with needle-sharp tips.
 */
function createTaperedCrescentGeo(
  innerR: number,
  outerR: number,
  arcAngle: number,
  segments: number
): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const startAngle = Math.PI * 0.5 - arcAngle * 0.5;

  for (let i = 0; i <= segments; i++) {
    const u = i / segments;
    const theta = startAngle + u * arcAngle;
    const taper = Math.sin(u * Math.PI);
    const widthFactor = Math.pow(taper, 0.6);
    const rOut = innerR + (outerR - innerR) * (0.35 + 0.65 * widthFactor);
    const rIn = rOut - (outerR - innerR) * widthFactor;

    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);

    // Inner trailing edge (soft fade to near-zero so there's no hard flat inner edge)
    positions.push(cosT * rIn, sinT * rIn, 0);
    const innerCol = 0.08 * taper;
    colors.push(innerCol, innerCol, innerCol);

    // Outer razor cutting edge (bright luminous core)
    positions.push(cosT * rOut, sinT * rOut, 0);
    const outerCol = 0.4 + 0.6 * taper;
    colors.push(outerCol, outerCol, outerCol);

    if (i < segments) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, b, c, b, d, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  return geo;
}

/**
 * Pooled 3D sword slash arcs, Punch shockwaves, Thrust lances & special attack VFX.
 * All geometries are memoized and disposed cleanly on unmount.
 */
export const SlashVFX = memo(function SlashVFX({
  slashesRef,
  worldRef,
  sessionId,
  localPoseRef,
}: SlashVFXProps) {
  const groupRefs = useRef<(THREE.Group | null)[]>([]);
  const arcRefs = useRef<(THREE.Mesh | null)[]>([]);
  const ringRefs = useRef<(THREE.Mesh | null)[]>([]);
  const lanceRefs = useRef<(THREE.Mesh | null)[]>([]);
  const wasIdleRef = useRef(false);

  const { crescentGeo, fullRingGeo, lanceGeo } = useMemo(() => {
    const crescent = createTaperedCrescentGeo(1.05, 1.98, Math.PI * 0.78, 26);
    const fullRing = new THREE.RingGeometry(1.55, 2.22, 32);
    const lance = new THREE.ConeGeometry(0.22, 3.8, 10, 1, true);
    lance.rotateX(Math.PI * 0.5);
    lance.translate(0, 0, 2.1);
    return { crescentGeo: crescent, fullRingGeo: fullRing, lanceGeo: lance };
  }, []);

  useEffect(() => {
    return () => {
      crescentGeo.dispose();
      fullRingGeo.dispose();
      lanceGeo.dispose();
    };
  }, [crescentGeo, fullRingGeo, lanceGeo]);

  useFrame(() => {
    const now = performance.now();
    const list = slashesRef.current;

    let writeIdx = 0;
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      if (now - item.createdAt <= item.delayMs + item.durationMs) {
        if (writeIdx !== i) {
          list[writeIdx] = item;
        }
        writeIdx++;
      }
    }
    if (writeIdx !== list.length) {
      list.length = writeIdx;
    }
    if (list.length === 0 && wasIdleRef.current) return;
    wasIdleRef.current = list.length === 0;

    for (let i = 0; i < MAX_SLASH_SLOTS; i++) {
      const grp = groupRefs.current[i];
      const arc = arcRefs.current[i];
      const ring = ringRefs.current[i];
      const lance = lanceRefs.current[i];
      if (!grp || !arc || !ring || !lance) continue;

      const fx = list[i];
      if (!fx) {
        grp.visible = false;
        continue;
      }

      const elapsed = now - fx.createdAt - fx.delayMs;
      if (elapsed < 0 || elapsed >= fx.durationMs) {
        grp.visible = false;
        continue;
      }

      if (
        EXPERIMENTAL_SWORD_VFX_AND_HITBOX &&
        (fx.kind === "light1" ||
          fx.kind === "light2" ||
          fx.kind === "heavy" ||
          fx.kind === "counter")
      ) {
        grp.visible = false;
        continue;
      }

      const age = elapsed / fx.durationMs;
      const pop = 1 - Math.pow(1 - age, 2.4);

      // Follow live attacker position so the slash stays locked to the sword while moving/lunging
      let px = fx.x;
      let py = fx.y;
      let pz = fx.z;
      let pyaw = fx.yaw;
      if (fx.attackerId && fx.kind !== "aerial_slam") {
        if (fx.attackerId === sessionId) {
          px = localPoseRef.current.x;
          py = localPoseRef.current.y + 1.15;
          pz = localPoseRef.current.z;
          pyaw = localPoseRef.current.yaw;
        } else {
          const remote = worldRef.current.players.find((p) => p.id === fx.attackerId);
          if (remote) {
            px = remote.x;
            py = remote.y + 1.15;
            pz = remote.z;
            pyaw = remote.yaw;
          }
        }
      }

      grp.visible = true;
      grp.position.set(px, py, pz);
      grp.rotation.set(0, pyaw, 0);

      // Reset all pooled mesh transforms cleanly every frame to prevent leftover offsets!
      arc.visible = false;
      arc.position.set(0, 0, 0);
      arc.rotation.set(0, 0, 0);
      arc.scale.set(1, 1, 1);

      ring.visible = false;
      ring.position.set(0, 0, 0);
      ring.rotation.set(0, 0, 0);
      ring.scale.set(1, 1, 1);

      lance.visible = false;
      lance.position.set(0, 0, 0);
      lance.rotation.set(0, 0, 0);
      lance.scale.set(1, 1, 1);

      const arcMat = arc.material as THREE.MeshBasicMaterial;
      const ringMat = ring.material as THREE.MeshBasicMaterial;
      const lanceMat = lance.material as THREE.MeshBasicMaterial;

      const fade = Math.pow(1 - age, 1.35);
      const inPeakWindow = age >= 0.15 && age <= 0.65;

      if (fx.kind === "light1" || fx.kind === "light2") {
        // Tapered diagonal sweep squarely in front (+Z) of the gladiator
        arc.visible = true;
        const tilt = fx.kind === "light1" ? 0.22 : -0.26;
        const sweepZ = fx.kind === "light1" ? -0.6 + pop * 1.2 : 0.6 - pop * 1.2;
        arc.position.set(0, 0.05, 0.15);
        arc.rotation.set(Math.PI * 0.5, tilt, sweepZ);
        const s = 0.88 + pop * 0.26;
        arc.scale.set(s, s, 1);
        arcMat.color.set("#f1f5f9");
        arcMat.opacity = fade * 0.86;
      } else if (fx.kind === "heavy") {
        // Vertical overhead cleave sweeping from above (+Y) down in front (+Z)
        arc.visible = true;
        arc.position.set(0, 0.25, 0.25);
        arc.rotation.set(0, -Math.PI * 0.5, -0.35 - pop * 0.88);
        const peakBoost = inPeakWindow ? 1.18 : 1.0;
        const s = (1.1 + pop * 0.4) * peakBoost;
        arc.scale.set(s, s, 1);
        arcMat.color.set(inPeakWindow ? "#fef08a" : "#fbbf24");
        arcMat.opacity = Math.min(1, fade * (inPeakWindow ? 1.12 : 0.92));
      } else if (fx.kind === "punch") {
        // Crisp air-concussion shockwave ring + upward-angled punch air cone right in front of the fist!
        ring.visible = true;
        lance.visible = true;

        ring.position.set(0, 0.06 + pop * 0.32, 0.72 + pop * 1.15);
        ring.rotation.set(-0.22, 0, age * 4.2);
        const rs = 0.18 + pop * 0.62;
        ring.scale.set(rs, rs, 1);
        ringMat.color.set("#fde047");
        ringMat.opacity = fade * 0.92;

        lance.position.set(0, 0.02 + pop * 0.25, -0.85 + pop * 0.65);
        lance.rotation.set(-0.24, 0, 0);
        const lw = 0.75 + pop * 0.85;
        lance.scale.set(lw, lw, 0.52 + pop * 0.35);
        lanceMat.color.set("#ffedd5");
        lanceMat.opacity = fade * 0.72;
      } else if (fx.kind === "whirlwind") {
        ring.visible = true;
        arc.visible = true;
        const peakBoost = inPeakWindow ? 1.14 : 1.0;
        ring.position.set(0, 0.05, 0);
        ring.rotation.set(-Math.PI * 0.5, 0, age * Math.PI * 4.4);
        const rs = (0.76 + pop * 0.92) * peakBoost;
        ring.scale.set(rs, rs, 1);
        ringMat.color.set(inPeakWindow ? "#fde047" : "#f59e0b");
        ringMat.opacity = Math.min(1, fade * (inPeakWindow ? 1.08 : 0.88));

        arc.position.set(0, 0.16, 0);
        arc.rotation.set(Math.PI * 0.5, 0, age * Math.PI * 5.8);
        const as = (1.26 + pop * 0.46) * peakBoost;
        arc.scale.set(as, as, 1);
        arcMat.color.set(inPeakWindow ? "#fffbeb" : "#fef08a");
        arcMat.opacity = Math.min(1, fade * (inPeakWindow ? 1.12 : 0.94));
      } else if (fx.kind === "thrust") {
        // 5.5m piercing golden shockwave lance shooting straight ahead
        lance.visible = true;
        ring.visible = true;
        const peakBoost = inPeakWindow ? 1.12 : 1.0;
        lance.position.set(0, 0.05, pop * 1.45);
        const ls = 1.05 + pop * 0.58;
        lance.scale.set(0.88 * (1 - age * 0.35) * peakBoost, 0.88 * (1 - age * 0.35) * peakBoost, ls * 1.45);
        lanceMat.color.set(inPeakWindow ? "#fffbeb" : "#fde047");
        lanceMat.opacity = Math.min(1, fade * (inPeakWindow ? 1.12 : 0.96));

        ring.position.set(0, 0.05, 1.35 + pop * 3.4);
        ring.rotation.set(0, 0, age * 4.0);
        const rs = (0.22 + pop * 0.54) * peakBoost;
        ring.scale.set(rs, rs, 1);
        ringMat.color.set("#ffffff");
        ringMat.opacity = fade * 0.9;
      } else if (fx.kind === "aerial_slam") {
        // Ground impact shockwave ring (used for both Aerial Plunge Slam and Punch-toss landing dust!)
        const isLandingDust = !fx.attackerId && fx.y < 0.35;
        ring.visible = true;
        ring.position.set(0, -py + 0.08, 0);
        ring.rotation.set(-Math.PI * 0.5, 0, age * 2.2);
        const peakBoost = !isLandingDust && inPeakWindow ? 1.12 : 1.0;
        const rs = (isLandingDust ? 0.28 + pop * 0.75 : 0.44 + pop * 1.16) * peakBoost;
        ring.scale.set(rs, rs, 1);
        ringMat.color.set(isLandingDust ? "#fde68a" : inPeakWindow ? "#fdba74" : "#fb923c");
        ringMat.opacity = Math.min(1, fade * (isLandingDust ? 0.78 : inPeakWindow ? 1.1 : 0.95));
      } else if (fx.kind === "counter") {
        arc.visible = true;
        ring.visible = true;
        const peakBoost = inPeakWindow ? 1.12 : 1.0;
        arc.position.set(0, 0.1, 0.35);
        arc.rotation.set(Math.PI * 0.5, -0.3, -0.75 + pop * 1.5);
        const s = (1.15 + pop * 0.45) * peakBoost;
        arc.scale.set(s, s, 1);
        arcMat.color.set(inPeakWindow ? "#fffbeb" : "#ffffff");
        arcMat.opacity = Math.min(1, fade * (inPeakWindow ? 1.1 : 1.0));

        ring.position.set(0, 0.1, 0.95);
        ring.rotation.set(0, 0, age * 4.5);
        const rs = (0.24 + pop * 0.58) * peakBoost;
        ring.scale.set(rs, rs, 1);
        ringMat.color.set(inPeakWindow ? "#fef08a" : "#fde047");
        ringMat.opacity = fade * 0.9;
      } else if (fx.kind === "powerup") {
        ring.visible = true;
        const spec = fx.powerUpKind ? POWER_UPS[fx.powerUpKind] : POWER_UPS.healing_flask;
        ring.position.set(0, -0.9 + pop * 1.85, 0);
        ring.rotation.set(-Math.PI * 0.5, 0, age * 5.2);
        const rs = 0.32 + pop * 0.48;
        ring.scale.set(rs, rs, 1);
        ringMat.color.set(spec.color);
        ringMat.opacity = fade * 0.9;
      }
    }
  });

  return (
    <group>
      {Array.from({ length: MAX_SLASH_SLOTS }).map((_, idx) => (
        <group
          key={idx}
          ref={(el) => {
            groupRefs.current[idx] = el;
          }}
          visible={false}
        >
          <mesh
            ref={(el) => {
              arcRefs.current[idx] = el;
            }}
            geometry={crescentGeo}
          >
            <meshBasicMaterial
              vertexColors
              transparent
              opacity={0}
              side={THREE.DoubleSide}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
          <mesh
            ref={(el) => {
              ringRefs.current[idx] = el;
            }}
            geometry={fullRingGeo}
          >
            <meshBasicMaterial
              transparent
              opacity={0}
              side={THREE.DoubleSide}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
          <mesh
            ref={(el) => {
              lanceRefs.current[idx] = el;
            }}
            geometry={lanceGeo}
          >
            <meshBasicMaterial
              transparent
              opacity={0}
              side={THREE.DoubleSide}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
});
