import { memo, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { soundEngine } from "../audio/SoundEngine";

const CAT_COLOURS = ["#c9773d", "#292632", "#e8d8b8"] as const;
const CAT_PATROLS = [
  { radiusX: 23.6, radiusZ: 23.6, speed: 0.11, phase: 0 },
  { radiusX: 24.4, radiusZ: 23.6, speed: -0.085, phase: 2.1 },
  { radiusX: 23.6, radiusZ: 24.4, speed: 0.095, phase: 4.2 },
] as const;

interface SharedCatAssets {
  bodyGeo: THREE.SphereGeometry;
  earGeo: THREE.ConeGeometry;
  eyeGeo: THREE.SphereGeometry;
  noseGeo: THREE.SphereGeometry;
  tailGeo: THREE.CylinderGeometry;
  furMats: THREE.MeshStandardMaterial[];
  headAccentMat: THREE.MeshStandardMaterial;
  eyeMat: THREE.MeshBasicMaterial;
  noseMat: THREE.MeshBasicMaterial;
}

interface StrayCatProps {
  index: number;
  active: boolean;
  assets: SharedCatAssets;
}

function StrayCat({ index, active, assets }: StrayCatProps) {
  const rootRef = useRef<THREE.Group>(null);
  const bodyRef = useRef<THREE.Group>(null);
  const tailRef = useRef<THREE.Group>(null);
  const nextMeowRef = useRef<number | null>(null);
  const furMat = assets.furMats[index % assets.furMats.length];
  const headMat = index === 1 ? assets.headAccentMat : furMat;
  const patrol = CAT_PATROLS[index % CAT_PATROLS.length];
  // Patrol the open inner perimeter, clear of the wall, lanterns, rubble, and map props.

  useFrame((state) => {
    const root = rootRef.current;
    if (!root) return;
    const time = state.clock.elapsedTime;
    const angle = patrol.phase + time * patrol.speed;
    root.position.set(
      Math.sin(angle) * patrol.radiusX,
      0.035,
      Math.cos(angle) * patrol.radiusZ
    );
    const direction = Math.sign(patrol.speed);
    root.rotation.y = Math.atan2(
      patrol.radiusX * Math.cos(angle) * direction,
      -patrol.radiusZ * Math.sin(angle) * direction
    );
    if (bodyRef.current) {
      bodyRef.current.position.y = 0.44 + Math.abs(Math.sin(time * 5.5 + index)) * 0.045;
    }
    if (tailRef.current) {
      tailRef.current.rotation.x = Math.sin(time * 2.7 + index * 2) * 0.28;
      tailRef.current.rotation.z = Math.sin(time * 1.8 + index) * 0.2;
    }
    if (!active) {
      nextMeowRef.current = null;
      return;
    }
    if (nextMeowRef.current === null) {
      nextMeowRef.current = time + 8 + Math.random() * 24;
      return;
    }
    if (time >= nextMeowRef.current) {
      soundEngine.playCatMeow();
      nextMeowRef.current = time + 16 + Math.random() * 22;
    }
  });

  return (
    <group ref={rootRef} scale={0.62}>
      <group ref={bodyRef} position={[0, 0.44, 0]}>
        <mesh geometry={assets.bodyGeo} material={furMat} scale={[0.48, 0.35, 0.74]} castShadow receiveShadow />
        <mesh geometry={assets.bodyGeo} material={headMat} position={[0, 0.13, 0.45]} scale={[0.31, 0.3, 0.31]} castShadow />
        <mesh geometry={assets.earGeo} material={furMat} position={[-0.2, 0.37, 0.28]} rotation={[0, 0, 0.14]} />
        <mesh geometry={assets.earGeo} material={furMat} position={[0.2, 0.37, 0.28]} rotation={[0, 0, -0.14]} />
        <mesh geometry={assets.eyeGeo} material={assets.eyeMat} position={[-0.105, 0.16, 0.72]} />
        <mesh geometry={assets.eyeGeo} material={assets.eyeMat} position={[0.105, 0.16, 0.72]} />
        <mesh geometry={assets.noseGeo} material={assets.noseMat} position={[0, 0.08, 0.745]} />
        {[0, 1, 2, 3].map((leg) => (
          <mesh
            key={`leg-${leg}`}
            geometry={assets.bodyGeo}
            material={furMat}
            position={[leg % 2 ? 0.27 : -0.27, -0.22, leg < 2 ? 0.45 : -0.44]}
            scale={[0.12, 0.28, 0.13]}
          />
        ))}
        <group ref={tailRef} position={[0, 0.03, -0.62]}>
          <mesh geometry={assets.tailGeo} material={furMat} position={[0, 0.26, -0.25]} rotation={[-0.65, 0, 0]} />
          <mesh geometry={assets.bodyGeo} material={furMat} position={[0, 0.49, -0.47]} scale={0.1} />
        </group>
      </group>
    </group>
  );
}

interface ArenaCatsProps {
  active?: boolean;
}

export const ArenaCats = memo(function ArenaCats({ active = false }: ArenaCatsProps) {
  const assets = useMemo<SharedCatAssets>(() => ({
    bodyGeo: new THREE.SphereGeometry(1, 10, 8),
    earGeo: new THREE.ConeGeometry(0.12, 0.3, 5),
    eyeGeo: new THREE.SphereGeometry(0.045, 6, 5),
    noseGeo: new THREE.SphereGeometry(0.04, 6, 5),
    tailGeo: new THREE.CylinderGeometry(0.09, 0.13, 0.62, 7),
    furMats: CAT_COLOURS.map((color) => new THREE.MeshStandardMaterial({ color, roughness: 0.92 })),
    headAccentMat: new THREE.MeshStandardMaterial({ color: "#ddd4dc", roughness: 0.9 }),
    eyeMat: new THREE.MeshBasicMaterial({ color: "#a9ff8e", toneMapped: false }),
    noseMat: new THREE.MeshBasicMaterial({ color: "#f08dba" }),
  }), []);

  useEffect(() => {
    return () => {
      assets.bodyGeo.dispose();
      assets.earGeo.dispose();
      assets.eyeGeo.dispose();
      assets.noseGeo.dispose();
      assets.tailGeo.dispose();
      assets.furMats.forEach((m) => m.dispose());
      assets.headAccentMat.dispose();
      assets.eyeMat.dispose();
      assets.noseMat.dispose();
    };
  }, [assets]);

  return (
    <group>
      {[0, 1, 2].map((index) => (
        <StrayCat key={index} index={index} active={active} assets={assets} />
      ))}
    </group>
  );
});
