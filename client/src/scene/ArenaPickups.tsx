import { memo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { POWER_UPS, type PowerUpKind } from "@sekiroslop/shared";
import type { PickupSnapshot } from "../net/useColosseumRoom";

interface ArenaPickupsProps {
  pickups: PickupSnapshot[];
}

function PickupVisual({ pickup }: { pickup: PickupSnapshot }) {
  const floatRef = useRef<THREE.Group>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const kind = pickup.kind as PowerUpKind;
  const spec = POWER_UPS[kind] ?? POWER_UPS.healing_flask;

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    if (floatRef.current) {
      floatRef.current.position.y = 0.92 + Math.sin(t * 2.8 + pickup.x) * 0.14;
      floatRef.current.rotation.y += delta * 1.9;
    }
    if (ringRef.current) {
      ringRef.current.rotation.z -= delta * 1.4;
      const pulse = 0.94 + Math.sin(t * 4.2 + pickup.z) * 0.08;
      ringRef.current.scale.set(pulse, pulse, 1);
    }
  });

  return (
    <group position={[pickup.x, 0, pickup.z]}>
      {/* Glowing Ground Rune Ring */}
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
        <ringGeometry args={[0.58, 0.82, 20]} />
        <meshBasicMaterial
          color={spec.color}
          transparent
          opacity={0.78}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>

      {/* Soft Vertical Light Beacon (spot pickups easily across the Colosseum!) */}
      <mesh position={[0, 1.35, 0]}>
        <cylinderGeometry args={[0.14, 0.42, 2.7, 10, 1, true]} />
        <meshBasicMaterial
          color={spec.glowColor}
          transparent
          opacity={0.14}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>

      {/* Floating Custom 3D Roman Collectible */}
      <group ref={floatRef} position={[0, 0.92, 0]}>
        {(kind === "healing_flask" || kind === "posture_tonic") && (
          <>
            {/* Roman Amphora / Flask Body */}
            <mesh castShadow>
              <sphereGeometry args={[0.26, 12, 10]} />
              <meshStandardMaterial
                color={spec.color}
                emissive={spec.color}
                emissiveIntensity={0.65}
                roughness={0.2}
                metalness={0.15}
              />
            </mesh>
            {/* Golden Neck & Stopper */}
            <mesh position={[0, 0.28, 0]}>
              <cylinderGeometry args={[0.09, 0.12, 0.2, 8]} />
              <meshStandardMaterial color="#d4af37" metalness={0.8} roughness={0.25} />
            </mesh>
            <mesh position={[0, 0.41, 0]}>
              <cylinderGeometry args={[0.11, 0.08, 0.08, 8]} />
              <meshStandardMaterial color="#78350f" roughness={0.8} />
            </mesh>
          </>
        )}

        {kind === "warriors_fury" && (
          <>
            {/* Blazing Crimson-Gold Relic Crystal + Orbiting Ring */}
            <mesh castShadow>
              <octahedronGeometry args={[0.32, 0]} />
              <meshStandardMaterial
                color="#f97316"
                emissive="#ef4444"
                emissiveIntensity={0.95}
                metalness={0.35}
                roughness={0.2}
              />
            </mesh>
            <mesh rotation={[Math.PI * 0.35, 0, 0]}>
              <torusGeometry args={[0.42, 0.04, 8, 20]} />
              <meshBasicMaterial color="#fde047" />
            </mesh>
          </>
        )}

        {kind === "iron_will" && (
          <>
            {/* Miniature Shimmering Roman Scutum Shield Crest */}
            <mesh castShadow>
              <cylinderGeometry args={[0.36, 0.36, 0.08, 12]} />
              <meshStandardMaterial
                color="#0284c7"
                emissive="#38bdf8"
                emissiveIntensity={0.55}
                metalness={0.75}
                roughness={0.25}
              />
            </mesh>
            <mesh rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[0.38, 0.04, 8, 16]} />
              <meshStandardMaterial color="#e2e8f0" metalness={0.9} roughness={0.18} />
            </mesh>
          </>
        )}

        {kind === "swift_feet" && (
          <>
            {/* Winged Wind Ring Relic */}
            <mesh rotation={[0.4, 0, 0]}>
              <torusGeometry args={[0.32, 0.06, 8, 18]} />
              <meshStandardMaterial
                color="#22c55e"
                emissive="#4ade80"
                emissiveIntensity={0.85}
                metalness={0.4}
                roughness={0.2}
              />
            </mesh>
            <mesh rotation={[-0.4, Math.PI * 0.5, 0]}>
              <torusGeometry args={[0.24, 0.045, 8, 16]} />
              <meshBasicMaterial color="#bbf7d0" />
            </mesh>
          </>
        )}
      </group>
    </group>
  );
}

export const ArenaPickups = memo(function ArenaPickups({ pickups }: ArenaPickupsProps) {
  return (
    <group>
      {pickups.map((p) => (
        <PickupVisual key={p.id} pickup={p} />
      ))}
    </group>
  );
});
