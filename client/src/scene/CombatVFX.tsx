import { memo, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import type { CombatEventPayload } from "@sekiroslop/shared";
import { EXPERIMENTAL_SWORD_VFX_AND_HITBOX } from "../experimental/sword-vfx-hitbox";

export interface BurstEffect {
  id: number;
  kind: CombatEventPayload["kind"];
  x: number;
  y: number;
  z: number;
  createdAt: number;
  heavy?: boolean;
}

interface CombatVFXProps {
  effectsRef: React.MutableRefObject<BurstEffect[]>;
}

const MAX_SLOTS = 12;

/**
 * Pooled, zero-allocation lightweight combat impact flashes with shared memoized geometries
 * and clean GPU disposal on unmount:
 * - Deflect: bright golden-orange expanding double shockwave + white-hot core flash
 * - Block: tight pale-amber steel spark ring
 * - Hit: crisp crimson impact ring + core flash
 * - Stagger: wide orange posture-break shockwave ring
 * - Evade: sleek cool-blue flash-step afterimage ring
 */
export const CombatVFX = memo(function CombatVFX({ effectsRef }: CombatVFXProps) {
  const ringRefs = useRef<(THREE.Mesh | null)[]>([]);
  const outerRingRefs = useRef<(THREE.Mesh | null)[]>([]);
  const coreRefs = useRef<(THREE.Mesh | null)[]>([]);
  const wasIdleRef = useRef(false);

  const { ringGeo, outerRingGeo, coreGeo } = useMemo(() => {
    return {
      ringGeo: new THREE.RingGeometry(0.42, 0.52, 24),
      outerRingGeo: new THREE.RingGeometry(0.48, 0.54, 24),
      coreGeo: new THREE.OctahedronGeometry(0.36, 0),
    };
  }, []);

  useEffect(() => {
    return () => {
      ringGeo.dispose();
      outerRingGeo.dispose();
      coreGeo.dispose();
    };
  }, [ringGeo, outerRingGeo, coreGeo]);

  useFrame((state) => {
    const now = performance.now();
    const list = effectsRef.current;

    // Prune expired effects (> 380ms)
    while (list.length > 0 && now - list[0].createdAt > 380) {
      list.shift();
    }
    if (list.length === 0 && wasIdleRef.current) return;
    wasIdleRef.current = list.length === 0;

    for (let i = 0; i < MAX_SLOTS; i++) {
      const ring = ringRefs.current[i];
      const outer = outerRingRefs.current[i];
      const core = coreRefs.current[i];
      if (!ring || !outer || !core) continue;

      const fx = list[i];
      if (
        !fx ||
        (EXPERIMENTAL_SWORD_VFX_AND_HITBOX &&
          (fx.kind === "deflect" ||
            fx.kind === "hit" ||
            fx.kind === "block" ||
            fx.kind === "stagger"))
      ) {
        ring.visible = false;
        outer.visible = false;
        core.visible = false;
        continue;
      }

      const age = (now - fx.createdAt) / 380;
      if (age >= 1) {
        ring.visible = false;
        outer.visible = false;
        core.visible = false;
        continue;
      }

      const pop = Math.pow(age, 0.55);
      const fade = Math.pow(1 - age, 1.35);

      ring.visible = true;
      core.visible = true;
      ring.position.set(fx.x, fx.y, fx.z);
      core.position.set(fx.x, fx.y, fx.z);
      ring.quaternion.copy(state.camera.quaternion);

      let color = "#f43f5e";
      let maxScale = 1.15;
      let showOuter = false;
      if (fx.kind === "deflect") {
        color = "#fde047";
        maxScale = fx.heavy ? 2.15 : 1.75;
        showOuter = true;
      } else if (fx.kind === "block") {
        color = "#fdba74";
        maxScale = 1.05;
      } else if (fx.kind === "stagger") {
        color = "#f97316";
        maxScale = 2.45;
        showOuter = true;
      } else if (fx.kind === "evade") {
        color = "#93c5fd";
        maxScale = 1.05;
      }

      const ringMat = ring.material as THREE.MeshBasicMaterial;
      const coreMat = core.material as THREE.MeshBasicMaterial;
      ringMat.color.set(color);
      ringMat.opacity = fade * 0.94;
      coreMat.color.set(fx.kind === "deflect" || fx.kind === "evade" ? "#ffffff" : color);
      coreMat.opacity = Math.max(0, 1 - age * 2.1);

      const s = 0.24 + pop * maxScale;
      ring.scale.set(s, s, s);
      const cs = Math.max(0.01, (1 - age * 1.8) * (fx.kind === "deflect" ? 0.44 : 0.24));
      core.scale.set(cs, cs, cs);

      outer.visible = showOuter;
      if (showOuter) {
        outer.position.set(fx.x, fx.y, fx.z);
        outer.quaternion.copy(state.camera.quaternion);
        const os = 0.34 + pop * (maxScale * 1.32);
        outer.scale.set(os, os, os);
        const outerMat = outer.material as THREE.MeshBasicMaterial;
        outerMat.color.set(fx.kind === "deflect" ? "#ffffff" : "#fef08a");
        outerMat.opacity = fade * 0.65;
      }
    }
  });

  return (
    <group>
      {Array.from({ length: MAX_SLOTS }).map((_, idx) => (
        <group key={idx}>
          <mesh
            ref={(el) => {
              ringRefs.current[idx] = el;
            }}
            geometry={ringGeo}
            visible={false}
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
              outerRingRefs.current[idx] = el;
            }}
            geometry={outerRingGeo}
            visible={false}
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
              coreRefs.current[idx] = el;
            }}
            geometry={coreGeo}
            visible={false}
          >
            <meshBasicMaterial
              transparent
              opacity={0}
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
