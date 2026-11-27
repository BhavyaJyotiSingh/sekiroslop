import { memo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import type { RoomWorldSnapshot } from "../net/useColosseumRoom";

interface PilumProjectilesProps {
  worldRef: React.MutableRefObject<RoomWorldSnapshot>;
}

const MAX_PILUMS = 8;

/**
 * Renders live flying 3D Roman Pilum spears synchronized from the 30Hz server state
 * with velocity-aligned orientation and an additive golden flight trail.
 */
export const PilumProjectiles = memo(function PilumProjectiles({ worldRef }: PilumProjectilesProps) {
  const refs = useRef<(THREE.Group | null)[]>([]);
  const spearGroupRefs = useRef<(THREE.Group | null)[]>([]);
  const fireballGroupRefs = useRef<(THREE.Group | null)[]>([]);
  const arcaneGroupRefs = useRef<(THREE.Group | null)[]>([]);
  const stunGroupRefs = useRef<(THREE.Group | null)[]>([]);
  const wasIdleRef = useRef(false);
  const slotIdsRef = useRef<(string | null)[]>(Array(MAX_PILUMS).fill(null));
  const tmpDir = useRef(new THREE.Vector3());
  const tmpQuat = useRef(new THREE.Quaternion());
  const upAxis = useRef(new THREE.Vector3(0, 1, 0));

  useFrame((state, delta) => {
    const pilums = worldRef.current.pilums;
    if (pilums.length === 0 && wasIdleRef.current) return;
    wasIdleRef.current = pilums.length === 0;
    const dt = Math.min(delta, 0.05);
    const t = state.clock.elapsedTime;

    for (let i = 0; i < MAX_PILUMS; i++) {
      const grp = refs.current[i];
      if (!grp) continue;

      const p = pilums[i];
      if (!p) {
        grp.visible = false;
        slotIdsRef.current[i] = null;
        continue;
      }

      if (!grp.visible || slotIdsRef.current[i] !== p.id) {
        grp.visible = true;
        slotIdsRef.current[i] = p.id;
        grp.position.set(p.x, p.y, p.z);
      } else {
        const targetX = p.x + p.vx * dt;
        const targetY = p.y + p.vy * dt;
        const targetZ = p.z + p.vz * dt;
        const alpha = 1 - Math.exp(-26 * dt);
        grp.position.x = THREE.MathUtils.lerp(grp.position.x, targetX, alpha);
        grp.position.y = THREE.MathUtils.lerp(grp.position.y, targetY, alpha);
        grp.position.z = THREE.MathUtils.lerp(grp.position.z, targetZ, alpha);
      }

      tmpDir.current.set(p.vx, p.vy, p.vz).normalize();
      if (tmpDir.current.lengthSq() > 0.001) {
        tmpQuat.current.setFromUnitVectors(upAxis.current, tmpDir.current);
        grp.quaternion.copy(tmpQuat.current);
      }

      const kind = p.kind ?? "fireball";
      if (spearGroupRefs.current[i]) spearGroupRefs.current[i]!.visible = false;
      if (fireballGroupRefs.current[i]) {
        fireballGroupRefs.current[i]!.visible = kind === "fireball";
        fireballGroupRefs.current[i]!.rotation.y = t * 8;
      }
      if (arcaneGroupRefs.current[i]) {
        arcaneGroupRefs.current[i]!.visible = kind === "arcane_orb";
        arcaneGroupRefs.current[i]!.rotation.y = t * 10;
      }
      if (stunGroupRefs.current[i]) stunGroupRefs.current[i]!.visible = kind === "stun_bolt";
    }
  });

  return (
    <group>
      {Array.from({ length: MAX_PILUMS }).map((_, idx) => (
        <group
          key={idx}
          ref={(el) => {
            refs.current[idx] = el;
          }}
          visible={false}
        >
          {/* 1. Roman Pilum Spear */}
          <group ref={(el) => { spearGroupRefs.current[idx] = el; }}>
            <mesh>
              <cylinderGeometry args={[0.032, 0.038, 1.35, 6]} />
              <meshStandardMaterial color="#78350f" roughness={0.82} />
            </mesh>
            <mesh position={[0, 0.65, 0]}>
              <cylinderGeometry args={[0.048, 0.048, 0.12, 6]} />
              <meshStandardMaterial color="#d4af37" metalness={0.85} roughness={0.25} />
            </mesh>
            <mesh position={[0, 0.96, 0]}>
              <cylinderGeometry args={[0.02, 0.028, 0.56, 6]} />
              <meshStandardMaterial color="#e2e8f0" metalness={0.92} roughness={0.18} />
            </mesh>
            <mesh position={[0, 1.32, 0]}>
              <coneGeometry args={[0.075, 0.26, 4]} />
              <meshStandardMaterial color="#ffffff" emissive="#fbbf24" emissiveIntensity={0.85} metalness={0.95} roughness={0.12} />
            </mesh>
            <mesh position={[0, -0.95, 0]}>
              <coneGeometry args={[0.14, 1.9, 6, 1, true]} />
              <meshBasicMaterial color="#fde047" transparent opacity={0.55} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} depthWrite={false} />
            </mesh>
          </group>

          {/* 2. Blazing Fireball */}
          <group ref={(el) => { fireballGroupRefs.current[idx] = el; }} visible={false}>
            <mesh>
              <sphereGeometry args={[0.32, 12, 10]} />
              <meshBasicMaterial color="#fff7ed" toneMapped={false} />
            </mesh>
            <mesh>
              <sphereGeometry args={[0.48, 12, 10]} />
              <meshBasicMaterial color="#ff5500" transparent opacity={0.62} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
            </mesh>
            <mesh position={[0, -0.75, 0]}>
              <coneGeometry args={[0.38, 1.6, 8, 1, true]} />
              <meshBasicMaterial color="#fb923c" transparent opacity={0.55} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
            </mesh>
          </group>

          {/* 3. Astral Frost-Arcane Orb */}
          <group ref={(el) => { arcaneGroupRefs.current[idx] = el; }} visible={false}>
            <mesh>
              <octahedronGeometry args={[0.34, 0]} />
              <meshBasicMaterial color="#e0f2fe" toneMapped={false} />
            </mesh>
            <mesh rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[0.46, 0.05, 6, 16]} />
              <meshBasicMaterial color="#38bdf8" transparent opacity={0.85} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
            </mesh>
          </group>

          {/* 4. Voltaic Stun-Gun Bolt */}
          <group ref={(el) => { stunGroupRefs.current[idx] = el; }} visible={false}>
            <mesh>
              <cylinderGeometry args={[0.06, 0.06, 1.5, 6]} />
              <meshBasicMaterial color="#ecfeff" toneMapped={false} />
            </mesh>
            <mesh>
              <cylinderGeometry args={[0.16, 0.16, 1.7, 6]} />
              <meshBasicMaterial color="#22d3ee" transparent opacity={0.55} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
            </mesh>
          </group>
        </group>
      ))}
    </group>
  );
});
