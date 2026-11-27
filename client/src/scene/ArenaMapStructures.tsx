import { memo, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { ARENA, type ArenaMapKind } from "@sekiroslop/shared";

interface ArenaMapStructuresProps {
  mapKind: ArenaMapKind;
}

const WALL_R = ARENA.WALL_RADIUS; // 26.2
const TORCH_DUMMY = new THREE.Object3D();
const AURORA_DUMMY = new THREE.Object3D();
const TORCH_FLAME_Y = 1.48;
const TORCH_HALO_Y = 1.45;

export const SUNLIT_TORCH_ANGLES = [-2.6, -1.8, 1.8, 2.6] as const;

/** 10 symmetric obelisk angles around WALL_R + 0.75, skipping North Gate and South Dais. */
export const AURORA_OBELISK_ANGLES: readonly number[] = [
  -2.618, -2.094, -1.571, -1.047, -0.524, 0.524, 1.047, 1.571, 2.094, 2.618,
];

function createTorchHaloTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(255, 255, 255, 1)");
    grad.addColorStop(0.35, "rgba(255, 196, 92, 0.55)");
    grad.addColorStop(0.7, "rgba(255, 120, 24, 0.18)");
    grad.addColorStop(1, "rgba(255, 100, 12, 0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function seeded(seed: number): number {
  const v = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return v - Math.floor(v);
}

/** Keeps the North Gate alcove (z < -20.5, |x| < 6.4) completely unobstructed. */
function isNorthGateZone(x: number, z: number): boolean {
  return z < -20.5 && Math.abs(x) < 6.4;
}

function setGroupedInstanceMatrix(
  mesh: THREE.InstancedMesh,
  index: number,
  parentPosition: THREE.Vector3,
  parentYaw: number,
  parentScale: number,
  childPosition: THREE.Vector3,
  childRotation: THREE.Euler,
  childScale = new THREE.Vector3(1, 1, 1)
): void {
  const parentMatrix = new THREE.Matrix4().compose(
    parentPosition,
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, parentYaw, 0)),
    new THREE.Vector3(parentScale, parentScale, parentScale)
  );
  const childMatrix = new THREE.Matrix4().compose(
    childPosition,
    new THREE.Quaternion().setFromEuler(childRotation),
    childScale
  );
  mesh.setMatrixAt(index, parentMatrix.multiply(childMatrix));
}

/* ============================================================================
 * 1. SUNLIT COLOSSEUM — Imperial Dais, Fluttering Banners, Weapon Racks,
 *    Terracotta Amphora Clusters, Stone Rubble/Sand Drifts & Floor Markings
 * ============================================================================ */

const BANNER_ANGLES = Array.from({ length: 14 }, (_, i) => {
  const angle = (i / 14) * Math.PI * 2 + 0.22;
  const x = Math.sin(angle) * (WALL_R - 0.72);
  const z = Math.cos(angle) * (WALL_R - 0.72);
  return { i, angle, x, z };
}).filter((b) => !isNorthGateZone(b.x, b.z) && !(b.z > 22 && Math.abs(b.x) < 6));

const WEAPON_RACK_SITES = [
  -2.35, -1.65, -0.82, 0.82, 1.65, 2.35,
].map((angle, i) => ({
  i,
  angle,
  x: Math.sin(angle) * (WALL_R + 0.05),
  z: Math.cos(angle) * (WALL_R + 0.05),
}));

const SunlitColosseumProps = memo(function SunlitColosseumProps() {
  const bannersRef = useRef<THREE.InstancedMesh>(null);
  const bannerTrimsRef = useRef<THREE.InstancedMesh>(null);
  const standardsRef = useRef<THREE.InstancedMesh>(null);
  const amphoraRef = useRef<THREE.InstancedMesh>(null);
  const rubbleRef = useRef<THREE.InstancedMesh>(null);
  const rackPostsRef = useRef<THREE.InstancedMesh>(null);
  const rackBarsRef = useRef<THREE.InstancedMesh>(null);
  const bronzeShieldsRef = useRef<THREE.InstancedMesh>(null);
  const crimsonShieldsRef = useRef<THREE.InstancedMesh>(null);
  const woodSpearsRef = useRef<THREE.InstancedMesh>(null);
  const steelSpearsRef = useRef<THREE.InstancedMesh>(null);
  const torchFlameRef = useRef<THREE.InstancedMesh>(null);
  const torchHaloRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  const shared = useMemo(() => {
    const haloTex = createTorchHaloTexture();
    const geos = {
      bannerCloth: new THREE.BoxGeometry(1.18, 2.65, 0.06),
      bannerTrim: new THREE.BoxGeometry(1.22, 0.18, 0.08),
      standardPole: new THREE.CylinderGeometry(0.06, 0.06, 4.4, 6),
      amphora: new THREE.LatheGeometry(
        [
          new THREE.Vector2(0.06, 0.0),
          new THREE.Vector2(0.24, 0.22),
          new THREE.Vector2(0.28, 0.56),
          new THREE.Vector2(0.11, 0.86),
          new THREE.Vector2(0.15, 1.02),
        ],
        8
      ),
      rubble: new THREE.DodecahedronGeometry(0.55, 0),
      rackPost: new THREE.BoxGeometry(0.14, 1.65, 0.14),
      rackBar: new THREE.BoxGeometry(2.1, 0.12, 0.12),
      shield: new THREE.CylinderGeometry(0.46, 0.46, 0.09, 12),
      spear: new THREE.CylinderGeometry(0.032, 0.038, 2.35, 6),
      torchFlame: new THREE.ConeGeometry(0.14, 0.42, 6),
      torchHalo: new THREE.PlaneGeometry(1.15, 1.15),
    };
    const mats = {
      crimson: new THREE.MeshStandardMaterial({ color: "#9c1b22", roughness: 0.78 }),
      gold: new THREE.MeshStandardMaterial({ color: "#dfa83c", metalness: 0.72, roughness: 0.3 }),
      terracotta: new THREE.MeshStandardMaterial({ color: "#b85c38", roughness: 0.84 }),
      travertine: new THREE.MeshStandardMaterial({ color: "#cfb790", roughness: 0.9 }),
      wood: new THREE.MeshStandardMaterial({ color: "#5c3d28", roughness: 0.88 }),
      bronze: new THREE.MeshStandardMaterial({ color: "#a87734", metalness: 0.68, roughness: 0.36 }),
      steel: new THREE.MeshStandardMaterial({ color: "#b6bec9", metalness: 0.78, roughness: 0.28 }),
      marble: new THREE.MeshStandardMaterial({ color: "#efe2c6", roughness: 0.68 }),
      darkMarble: new THREE.MeshStandardMaterial({ color: "#6e553e", roughness: 0.8 }),
      torchFlame: new THREE.MeshBasicMaterial({
        color: "#ff9b26",
        transparent: true,
        opacity: 0.92,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
      torchHalo: new THREE.MeshBasicMaterial({
        map: haloTex,
        color: "#ff7b1c",
        transparent: true,
        opacity: 0.42,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    };
    return { geos, mats, haloTex };
  }, []);

  useEffect(() => () => {
    Object.values(shared.geos).forEach((g) => g.dispose());
    Object.values(shared.mats).forEach((m) => m.dispose());
    shared.haloTex.dispose();
  }, [shared]);

  // Populate static instanced props (standards, amphora clusters, stone rubble/sand drifts)
  useEffect(() => {
    // 14 Legionary standards perched along podium rim
    if (standardsRef.current) {
      BANNER_ANGLES.forEach((b, idx) => {
        const r = WALL_R + 0.15;
        dummy.position.set(Math.sin(b.angle) * r, 6.2, Math.cos(b.angle) * r);
        dummy.rotation.set(0, b.angle, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        standardsRef.current!.setMatrixAt(idx, dummy.matrix);
      });
      standardsRef.current.instanceMatrix.needsUpdate = true;
      standardsRef.current.computeBoundingSphere();
    }

    // 28 Terracotta amphora jars clustered cleanly along the inner arena perimeter (clear of walls & seats)
    if (amphoraRef.current) {
      let count = 0;
      const clusterAngles = [-2.55, -1.9, -1.15, -0.45, 0.45, 1.15, 1.9, 2.55];
      for (let c = 0; c < clusterAngles.length && count < 28; c++) {
        const baseA = clusterAngles[c];
        for (let j = 0; j < 4 && count < 28; j++) {
          const a = baseA + (seeded(c * 19 + j) - 0.5) * 0.14;
          const r = WALL_R - 1.35 + seeded(c * 31 + j) * 0.35;
          const sc = 0.85 + seeded(c * 43 + j) * 0.45;
          dummy.position.set(Math.sin(a) * r, 0, Math.cos(a) * r);
          dummy.rotation.set(
            (seeded(c * 51 + j) - 0.5) * 0.16,
            seeded(c * 61 + j) * Math.PI * 2,
            (seeded(c * 71 + j) - 0.5) * 0.16
          );
          dummy.scale.setScalar(sc);
          dummy.updateMatrix();
          amphoraRef.current.setMatrixAt(count++, dummy.matrix);
        }
      }
      amphoraRef.current.instanceMatrix.needsUpdate = true;
      amphoraRef.current.computeBoundingSphere();
    }

    // 22 Stone rubble blocks & sand drifts hugging the inner perimeter clear of the podium wall
    if (rubbleRef.current) {
      let idx = 0;
      for (let i = 0; i < 28 && idx < 22; i++) {
        const a = (i / 28) * Math.PI * 2 + 0.11;
        const r = WALL_R - 1.45 + seeded(i + 501) * 0.45;
        const x = Math.sin(a) * r;
        const z = Math.cos(a) * r;
        if (isNorthGateZone(x, z)) continue;
        dummy.position.set(x, 0.08, z);
        dummy.rotation.set(seeded(i + 601) * 1.2, seeded(i + 701) * Math.PI, seeded(i + 801) * 1.2);
        dummy.scale.set(
          0.7 + seeded(i + 901) * 1.1,
          0.35 + seeded(i + 1001) * 0.5,
          0.7 + seeded(i + 1101) * 1.0
        );
        dummy.updateMatrix();
        rubbleRef.current.setMatrixAt(idx++, dummy.matrix);
      }
      rubbleRef.current.instanceMatrix.needsUpdate = true;
      rubbleRef.current.computeBoundingSphere();
    }

    const rackBatches = [
      rackPostsRef.current,
      rackBarsRef.current,
      bronzeShieldsRef.current,
      crimsonShieldsRef.current,
      woodSpearsRef.current,
      steelSpearsRef.current,
    ];
    if (rackBatches.every((mesh) => mesh !== null)) {
      let postIdx = 0;
      let barIdx = 0;
      let bronzeIdx = 0;
      let crimsonIdx = 0;
      let woodSpearIdx = 0;
      let steelSpearIdx = 0;
      for (const site of WEAPON_RACK_SITES) {
        const parentPosition = new THREE.Vector3(site.x, 4.45, site.z);
        const parentYaw = site.angle + Math.PI;
        for (const x of [-0.95, 0.95]) {
          setGroupedInstanceMatrix(rackPostsRef.current!, postIdx++, parentPosition, parentYaw, 1,
            new THREE.Vector3(x, 0.82, 0), new THREE.Euler());
        }
        for (const y of [1.35, 0.55]) {
          setGroupedInstanceMatrix(rackBarsRef.current!, barIdx++, parentPosition, parentYaw, 1,
            new THREE.Vector3(0, y, 0), new THREE.Euler());
        }
        setGroupedInstanceMatrix(bronzeShieldsRef.current!, bronzeIdx++, parentPosition, parentYaw, 1,
          new THREE.Vector3(-0.55, 0.85, 0.14), new THREE.Euler(Math.PI / 2 - 0.15, 0, 0));
        setGroupedInstanceMatrix(crimsonShieldsRef.current!, crimsonIdx++, parentPosition, parentYaw, 1,
          new THREE.Vector3(0.45, 0.85, 0.14), new THREE.Euler(Math.PI / 2 - 0.15, 0, 0));
        for (const [spearIndex, x] of [-0.2, 0.02, 0.85].entries()) {
          const target = spearIndex === 1 ? steelSpearsRef.current! : woodSpearsRef.current!;
          const index = spearIndex === 1 ? steelSpearIdx++ : woodSpearIdx++;
          setGroupedInstanceMatrix(target, index, parentPosition, parentYaw, 1,
            new THREE.Vector3(x, 1.18, -0.06), new THREE.Euler(0.14, 0, (spearIndex - 1) * 0.07));
        }
      }
      rackBatches.forEach((mesh) => {
        mesh!.instanceMatrix.needsUpdate = true;
        mesh!.computeBoundingSphere();
      });
    }

    if (torchFlameRef.current && torchHaloRef.current) {
      SUNLIT_TORCH_ANGLES.forEach((ang, idx) => {
        const tx = Math.sin(ang) * (WALL_R - 1.35);
        const tz = Math.cos(ang) * (WALL_R - 1.35);
        TORCH_DUMMY.position.set(tx, TORCH_FLAME_Y, tz);
        TORCH_DUMMY.rotation.set(0, ang, 0);
        TORCH_DUMMY.scale.set(1, 1, 1);
        TORCH_DUMMY.updateMatrix();
        torchFlameRef.current!.setMatrixAt(idx, TORCH_DUMMY.matrix);

        TORCH_DUMMY.position.set(tx, TORCH_HALO_Y, tz);
        TORCH_DUMMY.rotation.set(0, 0, 0);
        TORCH_DUMMY.scale.set(1, 1, 1);
        TORCH_DUMMY.updateMatrix();
        torchHaloRef.current!.setMatrixAt(idx, TORCH_DUMMY.matrix);
      });
      torchFlameRef.current.instanceMatrix.needsUpdate = true;
      torchFlameRef.current.computeBoundingSphere();
      torchHaloRef.current.instanceMatrix.needsUpdate = true;
      torchHaloRef.current.computeBoundingSphere();
    }
  }, [dummy]);

  // Animate crimson Roman banners fluttering gently in the Mediterranean breeze
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (bannersRef.current && bannerTrimsRef.current) {
      BANNER_ANGLES.forEach((b, idx) => {
        const sway = Math.sin(t * 2.1 + idx * 0.9) * 0.09;
        dummy.position.set(b.x, 2.85, b.z);
        dummy.rotation.set(sway, b.angle, sway * 0.35);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        bannersRef.current!.setMatrixAt(idx, dummy.matrix);

        dummy.position.set(b.x, 1.56, b.z);
        dummy.rotation.set(sway * 1.25, b.angle, sway * 0.45);
        dummy.updateMatrix();
        bannerTrimsRef.current!.setMatrixAt(idx, dummy.matrix);
      });
      bannersRef.current.instanceMatrix.needsUpdate = true;
      bannerTrimsRef.current.instanceMatrix.needsUpdate = true;
    }

    if (torchFlameRef.current && torchHaloRef.current) {
      for (let idx = 0; idx < SUNLIT_TORCH_ANGLES.length; idx++) {
        const ang = SUNLIT_TORCH_ANGLES[idx];
        const tx = Math.sin(ang) * (WALL_R - 1.35);
        const tz = Math.cos(ang) * (WALL_R - 1.35);
        const flicker = 0.88 + Math.sin(t * 9.5 + idx * 2.1) * 0.14 + Math.cos(t * 14.3 + idx) * 0.06;
        const lean = Math.sin(t * 6.2 + idx * 1.7) * 0.08;

        TORCH_DUMMY.position.set(tx, TORCH_FLAME_Y, tz);
        TORCH_DUMMY.rotation.set(lean, ang, lean * 0.6);
        TORCH_DUMMY.scale.set(0.92 + flicker * 0.08, flicker, 0.92 + flicker * 0.08);
        TORCH_DUMMY.updateMatrix();
        torchFlameRef.current.setMatrixAt(idx, TORCH_DUMMY.matrix);

        const haloScale = 0.92 + Math.sin(t * 7.8 + idx * 2.4) * 0.12;
        TORCH_DUMMY.position.set(tx, TORCH_HALO_Y, tz);
        TORCH_DUMMY.quaternion.copy(state.camera.quaternion);
        TORCH_DUMMY.scale.setScalar(haloScale);
        TORCH_DUMMY.updateMatrix();
        torchHaloRef.current.setMatrixAt(idx, TORCH_DUMMY.matrix);
      }
      torchFlameRef.current.instanceMatrix.needsUpdate = true;
      torchHaloRef.current.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <group>
      {/* Flush Arena Floor Sand Markings & Weathered Blood-Ring Inlays (y <= 0.025m) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.014, 0]} receiveShadow>
        <ringGeometry args={[13.45, 13.85, 64]} />
        <meshStandardMaterial color="#c89e69" roughness={0.95} transparent opacity={0.62} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]} receiveShadow>
        <ringGeometry args={[20.8, 21.35, 64]} />
        <meshStandardMaterial color="#8f3f2e" roughness={0.96} transparent opacity={0.32} />
      </mesh>
      {[0, 1, 2, 3].map((idx) => {
        const a = (idx / 4) * Math.PI * 2;
        return (
          <mesh
            key={`compass-${idx}`}
            rotation={[-Math.PI / 2, 0, -a]}
            position={[Math.sin(a) * 8.6, 0.016, Math.cos(a) * 8.6]}
            receiveShadow
          >
            <planeGeometry args={[0.45, 8.8]} />
            <meshStandardMaterial color="#d8bc8f" roughness={0.92} transparent opacity={0.55} />
          </mesh>
        );
      })}

      {/* Grand Imperial Emperor's Dais / Box on the South Wall (z = +28.4m) */}
      <group position={[0, 4.5, WALL_R + 2.2]}>
        {/* Stepped marble podium */}
        <mesh position={[0, 0.3, 0.4]} receiveShadow>
          <boxGeometry args={[12.4, 0.7, 5.4]} />
          <meshStandardMaterial color="#e8d8b7" roughness={0.75} />
        </mesh>
        {/* Canopy roof + golden pediment */}
        <mesh position={[0, 4.4, 0.2]}>
          <boxGeometry args={[11.8, 0.55, 4.8]} />
          <meshStandardMaterial color="#8c1c22" roughness={0.76} />
        </mesh>
        <mesh position={[0, 4.82, 0.2]}>
          <boxGeometry args={[12.2, 0.22, 5.1]} />
          <meshStandardMaterial color="#dfa83c" metalness={0.68} roughness={0.32} />
        </mesh>
        {/* Imperial Golden Aquila Finial */}
        <mesh position={[0, 5.65, -2.0]}>
          <octahedronGeometry args={[0.62, 0]} />
          <meshStandardMaterial color="#f5c542" metalness={0.82} roughness={0.22} />
        </mesh>
        {/* 4 Fluted Marble Columns */}
        {[-5.0, -2.1, 2.1, 5.0].map((cx) => (
          <mesh key={cx} position={[cx, 2.35, -1.7]}>
            <cylinderGeometry args={[0.24, 0.28, 3.9, 10]} />
            <meshStandardMaterial color="#efe2c6" roughness={0.62} />
          </mesh>
        ))}
        {/* Crimson Imperial Drapery hanging over the arena podium wall */}
        <mesh position={[0, -0.85, -2.62]}>
          <boxGeometry args={[9.4, 2.5, 0.16]} />
          <meshStandardMaterial color="#9c1b22" roughness={0.8} />
        </mesh>
        <mesh position={[0, -2.02, -2.56]}>
          <boxGeometry args={[9.4, 0.26, 0.18]} />
          <meshStandardMaterial color="#e6b84c" metalness={0.62} roughness={0.32} />
        </mesh>
        {/* Emperor's Throne Silhouette */}
        <mesh position={[0, 1.35, 0.4]}>
          <boxGeometry args={[1.5, 1.6, 1.1]} />
          <meshStandardMaterial color="#7d1920" roughness={0.75} />
        </mesh>
      </group>

      {/* Fluttering Roman Crimson & Gold Banners + Legionary Standards */}
      <instancedMesh ref={bannersRef} args={[shared.geos.bannerCloth, shared.mats.crimson, BANNER_ANGLES.length]} frustumCulled={false} />
      <instancedMesh ref={bannerTrimsRef} args={[shared.geos.bannerTrim, shared.mats.gold, BANNER_ANGLES.length]} frustumCulled={false} />
      <instancedMesh ref={standardsRef} args={[shared.geos.standardPole, shared.mats.gold, BANNER_ANGLES.length]} frustumCulled={false} />

      {/* Terracotta Amphora Clusters & Stone Rubble/Sand Drifts */}
      <instancedMesh ref={amphoraRef} args={[shared.geos.amphora, shared.mats.terracotta, 28]} frustumCulled={false} />
      <instancedMesh ref={rubbleRef} args={[shared.geos.rubble, shared.mats.travertine, 22]} frustumCulled={false} />

      {/* Perimeter Gladiator Weapon Racks (shields, spears, swords along podium top r = 26.25m) */}
      <instancedMesh ref={rackPostsRef} args={[shared.geos.rackPost, shared.mats.wood, 12]} />
      <instancedMesh ref={rackBarsRef} args={[shared.geos.rackBar, shared.mats.wood, 12]} />
      <instancedMesh ref={bronzeShieldsRef} args={[shared.geos.shield, shared.mats.bronze, 6]} />
      <instancedMesh ref={crimsonShieldsRef} args={[shared.geos.shield, shared.mats.crimson, 6]} />
      <instancedMesh ref={woodSpearsRef} args={[shared.geos.spear, shared.mats.wood, 12]} />
      <instancedMesh ref={steelSpearsRef} args={[shared.geos.spear, shared.mats.steel, 6]} />

      {/* Animated Torch Flames & Warm Glow Halos for Perimeter Torches */}
      <instancedMesh
        ref={torchFlameRef}
        args={[shared.geos.torchFlame, shared.mats.torchFlame, SUNLIT_TORCH_ANGLES.length]}
        frustumCulled={false}
      />
      <instancedMesh
        ref={torchHaloRef}
        args={[shared.geos.torchHalo, shared.mats.torchHalo, SUNLIT_TORCH_ANGLES.length]}
        frustumCulled={false}
      />
    </group>
  );
});

/* ============================================================================
 * 2. MOONLIT SAKURA COURTYARD — Gnarled Cherry Blossom Trees, Vermilion Torii,
 *    Ashina Shrine Pavilions, Glowing Stone Lanterns (Tōrō), Bamboo Fence &
 *    Fallen Petal Drifts
 * ============================================================================ */

const SAKURA_TREE_SITES = Array.from({ length: 12 }, (_, i) => {
  const angle = (i / 12) * Math.PI * 2 + 0.16;
  const r = i % 2 === 0 ? 28.4 : 31.2;
  const x = Math.sin(angle) * r;
  const z = Math.cos(angle) * r;
  const scale = 0.92 + seeded(i + 301) * 0.38;
  return { i, x, z, yaw: angle + seeded(i + 401), scale };
}).filter((t) => !isNorthGateZone(t.x, t.z));

const SAKURA_TORII_SITES = [
  { x: -27.5, z: 0, yaw: Math.PI / 2 },
  { x: 27.5, z: 0, yaw: -Math.PI / 2 },
  { x: 0, z: 27.5, yaw: Math.PI },
] as const;

const SAKURA_LANTERN_SITES = Array.from({ length: 12 }, (_, i) => {
  const angle = (i / 12) * Math.PI * 2 + Math.PI / 12;
  const x = Math.sin(angle) * 26.35;
  const z = Math.cos(angle) * 26.35;
  return { i, x, z, yaw: angle };
}).filter((l) => !isNorthGateZone(l.x, l.z));

const SAKURA_BONFIRE_SITES: readonly [number, number, number][] = [
  [-16.5, 0, 17.5],
  [16.5, 0, 17.5],
];
const SAKURA_LANTERN_CHAMBER_Y = 1.56;
const SAKURA_BONFIRE_FLAME_Y = 0.75;
const SAKURA_VFX_DUMMY = new THREE.Object3D();

const MoonlitSakuraStructures = memo(function MoonlitSakuraStructures() {
  const bambooPostsRef = useRef<THREE.InstancedMesh>(null);
  const bambooRailsRef = useRef<THREE.InstancedMesh>(null);
  const fallenPetalsRef = useRef<THREE.InstancedMesh>(null);
  const canopyLightRef = useRef<THREE.InstancedMesh>(null);
  const canopyDeepRef = useRef<THREE.InstancedMesh>(null);
  const lightStepStonesRef = useRef<THREE.InstancedMesh>(null);
  const mossStepStonesRef = useRef<THREE.InstancedMesh>(null);
  const treeTrunksRef = useRef<THREE.InstancedMesh>(null);
  const treeLimbsRef = useRef<THREE.InstancedMesh>(null);
  const lanternFeetRef = useRef<THREE.InstancedMesh>(null);
  const lanternShaftsRef = useRef<THREE.InstancedMesh>(null);
  const lanternBoxesRef = useRef<THREE.InstancedMesh>(null);
  const lanternRoofsRef = useRef<THREE.InstancedMesh>(null);
  const lanternGlowSpritesRef = useRef<THREE.InstancedMesh>(null);
  const bonfireFlamesRef = useRef<THREE.InstancedMesh>(null);
  const bonfireHalosRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  const shared = useMemo(() => {
    const haloTex = createTorchHaloTexture();
    const curbPts = [
      new THREE.Vector2(WALL_R - 0.55, -0.06),
      new THREE.Vector2(WALL_R - 0.42, 0.09),
      new THREE.Vector2(WALL_R + 0.15, 0.09),
      new THREE.Vector2(WALL_R + 0.15, -0.06),
    ];
    const geos = {
      gardenCenterDisc: new THREE.CircleGeometry(4.5, 24),
      courtyardCurb: new THREE.LatheGeometry(curbPts, 64),
      stepStone: new THREE.CircleGeometry(0.84, 7),
      fallenPetal: new THREE.CircleGeometry(0.18, 5),
      bambooPost: new THREE.CylinderGeometry(0.085, 0.1, 2.65, 6),
      bambooRail: new THREE.CylinderGeometry(0.055, 0.055, 1.95, 6),
      toriiBase: new THREE.BoxGeometry(0.82, 0.55, 0.82),
      toriiPost: new THREE.CylinderGeometry(0.24, 0.3, 5.6, 8),
      toriiTop: new THREE.BoxGeometry(6.6, 0.44, 0.78),
      toriiCap: new THREE.BoxGeometry(6.95, 0.22, 0.86),
      toriiBar: new THREE.BoxGeometry(4.8, 0.24, 0.52),
      treeTrunk: new THREE.CylinderGeometry(0.42, 0.82, 6.8, 8),
      treeLimb: new THREE.CylinderGeometry(0.22, 0.42, 4.4, 7),
      canopyPuff: new THREE.IcosahedronGeometry(2.15, 1),
      innerPillarBase: new THREE.BoxGeometry(2.35, 0.85, 2.35),
      innerPillarShaft: new THREE.CylinderGeometry(0.82, 0.94, 5.6, 10),
      innerRopeBand: new THREE.TorusGeometry(0.92, 0.12, 7, 16),
      lanternFoot: new THREE.BoxGeometry(0.84, 0.32, 0.84),
      lanternShaft: new THREE.CylinderGeometry(0.22, 0.28, 1.05, 6),
      lanternBox: new THREE.BoxGeometry(0.56, 0.52, 0.56),
      lanternRoof: new THREE.ConeGeometry(0.82, 0.44, 4),
      lanternGlowSprite: new THREE.PlaneGeometry(1.5, 1.5),
      bonfireFlame: new THREE.ConeGeometry(0.26, 0.72, 7),
      bonfireHalo: new THREE.PlaneGeometry(2.1, 2.1),
    };

    const mats = {
      stoneDark: new THREE.MeshStandardMaterial({ color: "#363c58", roughness: 0.82 }),
      stoneLight: new THREE.MeshStandardMaterial({ color: "#7980a3", roughness: 0.78 }),
      mossStone: new THREE.MeshStandardMaterial({ color: "#45585e", roughness: 0.86 }),
      bamboo: new THREE.MeshStandardMaterial({ color: "#5e6f4a", roughness: 0.74 }),
      toriiRed: new THREE.MeshStandardMaterial({ color: "#b32436", roughness: 0.48 }),
      toriiDark: new THREE.MeshStandardMaterial({ color: "#1d1b29", roughness: 0.6 }),
      gold: new THREE.MeshStandardMaterial({ color: "#e8b954", metalness: 0.65, roughness: 0.34 }),
      bark: new THREE.MeshStandardMaterial({ color: "#3d2d3a", roughness: 0.92 }),
      blossomLight: new THREE.MeshStandardMaterial({
        color: "#f7a3cf",
        emissive: "#6b1f4c",
        emissiveIntensity: 0.26,
        roughness: 0.84,
      }),
      blossomDeep: new THREE.MeshStandardMaterial({
        color: "#d45594",
        emissive: "#57163b",
        emissiveIntensity: 0.24,
        roughness: 0.86,
      }),
      fallenPetalMat: new THREE.MeshBasicMaterial({ color: "#ff9ed0", transparent: true, opacity: 0.78 }),
      lanternGlow: new THREE.MeshBasicMaterial({ color: "#ffc25c", toneMapped: false }),
      lanternGlowSprite: new THREE.MeshBasicMaterial({
        map: haloTex,
        color: "#ffbe5c",
        transparent: true,
        opacity: 0.48,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
      bonfireFlame: new THREE.MeshBasicMaterial({
        color: "#ff9b26",
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
      bonfireHalo: new THREE.MeshBasicMaterial({
        map: haloTex,
        color: "#ff8c2e",
        transparent: true,
        opacity: 0.48,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
      shojiGlow: new THREE.MeshBasicMaterial({ color: "#ffcf78", toneMapped: false }),
      shrineWood: new THREE.MeshStandardMaterial({ color: "#3a2730", roughness: 0.84 }),
      shrineRoof: new THREE.MeshStandardMaterial({ color: "#222945", roughness: 0.64, metalness: 0.16 }),
    };

    return { geos, mats, haloTex };
  }, []);

  useEffect(() => () => {
    Object.values(shared.geos).forEach((g) => g.dispose());
    Object.values(shared.mats).forEach((m) => m.dispose());
    shared.haloTex.dispose();
  }, [shared]);

  useEffect(() => {
    // 1. Bamboo perimeter fence (r = 26.15m, skipping North Gate)
    const fenceSegs = 84;
    if (bambooPostsRef.current && bambooRailsRef.current) {
      let pIdx = 0;
      let rIdx = 0;
      for (let i = 0; i < fenceSegs; i++) {
        const a = (i / fenceSegs) * Math.PI * 2;
        const x = Math.sin(a) * 26.15;
        const z = Math.cos(a) * 26.15;
        if (isNorthGateZone(x, z)) continue;

        dummy.position.set(x, 1.3, z);
        dummy.rotation.set(0, a, (seeded(i + 21) - 0.5) * 0.04);
        dummy.scale.set(1, 0.94 + seeded(i + 41) * 0.14, 1);
        dummy.updateMatrix();
        bambooPostsRef.current.setMatrixAt(pIdx++, dummy.matrix);

        // Two horizontal rails per segment
        for (const ry of [0.85, 1.95]) {
          dummy.position.set(x, ry, z);
          dummy.rotation.set(0, a, Math.PI / 2);
          dummy.scale.set(1, 1, 1);
          dummy.updateMatrix();
          bambooRailsRef.current.setMatrixAt(rIdx++, dummy.matrix);
        }
      }
      bambooPostsRef.current.count = pIdx;
      bambooRailsRef.current.count = rIdx;
      bambooPostsRef.current.instanceMatrix.needsUpdate = true;
      bambooRailsRef.current.instanceMatrix.needsUpdate = true;
      bambooPostsRef.current.computeBoundingSphere();
      bambooRailsRef.current.computeBoundingSphere();
    }

    // 2. 160 Fallen sakura petal drifts flush on the courtyard floor (y = 0.022m)
    if (fallenPetalsRef.current) {
      const palette = [
        new THREE.Color("#ffb5dc"),
        new THREE.Color("#f078b8"),
        new THREE.Color("#ffe3f2"),
      ];
      for (let i = 0; i < 160; i++) {
        const a = seeded(i + 901) * Math.PI * 2;
        const r = 3.2 + Math.sqrt(seeded(i + 1001)) * 21.2;
        dummy.position.set(Math.cos(a) * r, 0.022, Math.sin(a) * r);
        dummy.rotation.set(-Math.PI / 2, 0, seeded(i + 1101) * Math.PI * 2);
        const s = 0.75 + seeded(i + 1201) * 1.45;
        dummy.scale.set(s, s * 0.7, 1);
        dummy.updateMatrix();
        fallenPetalsRef.current.setMatrixAt(i, dummy.matrix);
        fallenPetalsRef.current.setColorAt(i, palette[i % palette.length]);
      }
      fallenPetalsRef.current.instanceMatrix.needsUpdate = true;
      fallenPetalsRef.current.computeBoundingSphere();
      if (fallenPetalsRef.current.instanceColor) {
        fallenPetalsRef.current.instanceColor.needsUpdate = true;
      }
    }

    // 3. Instanced lush layered blossom canopies for all 12 perimeter gnarled trees
    if (canopyLightRef.current && canopyDeepRef.current) {
      let lightIdx = 0;
      let deepIdx = 0;
      const lightOffsets: [number, number, number, number][] = [
        [-1.9, 7.2, 0.4, 1.25],
        [1.8, 7.6, -0.6, 1.15],
        [0.0, 8.6, 0.2, 1.32],
      ];
      const deepOffsets: [number, number, number, number][] = [
        [-0.9, 6.4, -1.3, 1.12],
        [1.2, 6.7, 1.3, 1.08],
      ];
      for (const tree of SAKURA_TREE_SITES) {
        const cos = Math.cos(tree.yaw);
        const sin = Math.sin(tree.yaw);
        for (const [ox, oy, oz, sc] of lightOffsets) {
          const wx = tree.x + (ox * cos - oz * sin) * tree.scale;
          const wz = tree.z + (ox * sin + oz * cos) * tree.scale;
          dummy.position.set(wx, oy * tree.scale, wz);
          dummy.rotation.set(0.2, tree.yaw + ox, 0.1);
          dummy.scale.set(sc * tree.scale * 1.18, sc * tree.scale * 0.72, sc * tree.scale * 1.1);
          dummy.updateMatrix();
          canopyLightRef.current.setMatrixAt(lightIdx++, dummy.matrix);
        }
        for (const [ox, oy, oz, sc] of deepOffsets) {
          const wx = tree.x + (ox * cos - oz * sin) * tree.scale;
          const wz = tree.z + (ox * sin + oz * cos) * tree.scale;
          dummy.position.set(wx, oy * tree.scale, wz);
          dummy.rotation.set(-0.15, tree.yaw + oz, 0.2);
          dummy.scale.set(sc * tree.scale * 1.22, sc * tree.scale * 0.7, sc * tree.scale * 1.12);
          dummy.updateMatrix();
          canopyDeepRef.current.setMatrixAt(deepIdx++, dummy.matrix);
        }
      }
      canopyLightRef.current.count = lightIdx;
      canopyDeepRef.current.count = deepIdx;
      canopyLightRef.current.instanceMatrix.needsUpdate = true;
      canopyDeepRef.current.instanceMatrix.needsUpdate = true;
      canopyLightRef.current.computeBoundingSphere();
      canopyDeepRef.current.computeBoundingSphere();
    }
  }, [dummy]);

  useEffect(() => {
    let lightStoneIdx = 0;
    let mossStoneIdx = 0;
    for (let pathIdx = 0; pathIdx < 4; pathIdx++) {
      const angle = (pathIdx / 4) * Math.PI * 2;
      [6.8, 9.8, 12.8, 16.0, 19.2, 22.0].forEach((radius, stoneIdx) => {
        const target = stoneIdx % 2 === 0 ? lightStepStonesRef.current : mossStepStonesRef.current;
        const index = stoneIdx % 2 === 0 ? lightStoneIdx++ : mossStoneIdx++;
        dummy.position.set(Math.sin(angle) * radius, 0.024, Math.cos(angle) * radius);
        dummy.rotation.set(-Math.PI / 2, 0, -angle);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        target?.setMatrixAt(index, dummy.matrix);
      });
    }
    if (lightStepStonesRef.current) {
      lightStepStonesRef.current.instanceMatrix.needsUpdate = true;
      lightStepStonesRef.current.computeBoundingSphere();
    }
    if (mossStepStonesRef.current) {
      mossStepStonesRef.current.instanceMatrix.needsUpdate = true;
      mossStepStonesRef.current.computeBoundingSphere();
    }

    let trunkIdx = 0;
    let limbIdx = 0;
    for (const tree of SAKURA_TREE_SITES) {
      const parentPosition = new THREE.Vector3(tree.x, 0, tree.z);
      setGroupedInstanceMatrix(treeTrunksRef.current!, trunkIdx++, parentPosition, tree.yaw, tree.scale,
        new THREE.Vector3(0, 3.2, 0), new THREE.Euler(0.08, 0, 0.06));
      setGroupedInstanceMatrix(treeLimbsRef.current!, limbIdx++, parentPosition, tree.yaw, tree.scale,
        new THREE.Vector3(-1.2, 5.4, 0.2), new THREE.Euler(0.15, 0, 0.58));
      setGroupedInstanceMatrix(treeLimbsRef.current!, limbIdx++, parentPosition, tree.yaw, tree.scale,
        new THREE.Vector3(1.1, 5.6, -0.3), new THREE.Euler(-0.2, 0, -0.52));
    }
    if (treeTrunksRef.current) {
      treeTrunksRef.current.instanceMatrix.needsUpdate = true;
      treeTrunksRef.current.computeBoundingSphere();
    }
    if (treeLimbsRef.current) {
      treeLimbsRef.current.instanceMatrix.needsUpdate = true;
      treeLimbsRef.current.computeBoundingSphere();
    }

    let lanternIdx = 0;
    for (const lantern of SAKURA_LANTERN_SITES) {
      const parentPosition = new THREE.Vector3(lantern.x, 0, lantern.z);
      setGroupedInstanceMatrix(lanternFeetRef.current!, lanternIdx, parentPosition, lantern.yaw, 1,
        new THREE.Vector3(0, 0.16, 0), new THREE.Euler());
      setGroupedInstanceMatrix(lanternShaftsRef.current!, lanternIdx, parentPosition, lantern.yaw, 1,
        new THREE.Vector3(0, 0.82, 0), new THREE.Euler());
      setGroupedInstanceMatrix(lanternBoxesRef.current!, lanternIdx, parentPosition, lantern.yaw, 1,
        new THREE.Vector3(0, 1.56, 0), new THREE.Euler());
      setGroupedInstanceMatrix(lanternRoofsRef.current!, lanternIdx++, parentPosition, lantern.yaw, 1,
        new THREE.Vector3(0, 2.02, 0), new THREE.Euler(0, Math.PI / 4, 0));
    }
    for (const mesh of [lanternFeetRef.current, lanternShaftsRef.current, lanternBoxesRef.current, lanternRoofsRef.current]) {
      if (mesh) {
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
      }
    }

    if (lanternGlowSpritesRef.current) {
      SAKURA_LANTERN_SITES.forEach((lantern, idx) => {
        SAKURA_VFX_DUMMY.position.set(lantern.x, SAKURA_LANTERN_CHAMBER_Y, lantern.z);
        SAKURA_VFX_DUMMY.rotation.set(0, 0, 0);
        SAKURA_VFX_DUMMY.scale.set(1, 1, 1);
        SAKURA_VFX_DUMMY.updateMatrix();
        lanternGlowSpritesRef.current!.setMatrixAt(idx, SAKURA_VFX_DUMMY.matrix);
      });
      lanternGlowSpritesRef.current.instanceMatrix.needsUpdate = true;
      lanternGlowSpritesRef.current.computeBoundingSphere();
    }

    if (bonfireFlamesRef.current && bonfireHalosRef.current) {
      SAKURA_BONFIRE_SITES.forEach(([bx, , bz], idx) => {
        SAKURA_VFX_DUMMY.position.set(bx, SAKURA_BONFIRE_FLAME_Y, bz);
        SAKURA_VFX_DUMMY.rotation.set(0, 0, 0);
        SAKURA_VFX_DUMMY.scale.set(1, 1, 1);
        SAKURA_VFX_DUMMY.updateMatrix();
        bonfireFlamesRef.current!.setMatrixAt(idx, SAKURA_VFX_DUMMY.matrix);

        SAKURA_VFX_DUMMY.position.set(bx, SAKURA_BONFIRE_FLAME_Y + 0.05, bz);
        SAKURA_VFX_DUMMY.rotation.set(0, 0, 0);
        SAKURA_VFX_DUMMY.scale.set(1, 1, 1);
        SAKURA_VFX_DUMMY.updateMatrix();
        bonfireHalosRef.current!.setMatrixAt(idx, SAKURA_VFX_DUMMY.matrix);
      });
      bonfireFlamesRef.current.instanceMatrix.needsUpdate = true;
      bonfireFlamesRef.current.computeBoundingSphere();
      bonfireHalosRef.current.instanceMatrix.needsUpdate = true;
      bonfireHalosRef.current.computeBoundingSphere();
    }
  }, [dummy]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (lanternGlowSpritesRef.current) {
      for (let idx = 0; idx < SAKURA_LANTERN_SITES.length; idx++) {
        const lantern = SAKURA_LANTERN_SITES[idx];
        const pulse = 0.96 + Math.sin(t * 2.4 + idx * 1.1) * 0.05;
        SAKURA_VFX_DUMMY.position.set(lantern.x, SAKURA_LANTERN_CHAMBER_Y, lantern.z);
        SAKURA_VFX_DUMMY.quaternion.copy(state.camera.quaternion);
        SAKURA_VFX_DUMMY.scale.setScalar(pulse);
        SAKURA_VFX_DUMMY.updateMatrix();
        lanternGlowSpritesRef.current.setMatrixAt(idx, SAKURA_VFX_DUMMY.matrix);
      }
      lanternGlowSpritesRef.current.instanceMatrix.needsUpdate = true;
    }

    if (bonfireFlamesRef.current && bonfireHalosRef.current) {
      for (let idx = 0; idx < SAKURA_BONFIRE_SITES.length; idx++) {
        const [bx, , bz] = SAKURA_BONFIRE_SITES[idx];
        const flicker = 0.88 + Math.sin(t * 9.2 + idx * 2.3) * 0.14 + Math.cos(t * 14.7 + idx) * 0.06;
        const lean = Math.sin(t * 5.8 + idx * 1.9) * 0.08;

        SAKURA_VFX_DUMMY.position.set(bx, SAKURA_BONFIRE_FLAME_Y, bz);
        SAKURA_VFX_DUMMY.rotation.set(lean, t * 0.6 + idx, lean * 0.6);
        SAKURA_VFX_DUMMY.scale.set(0.92 + flicker * 0.08, flicker, 0.92 + flicker * 0.08);
        SAKURA_VFX_DUMMY.updateMatrix();
        bonfireFlamesRef.current.setMatrixAt(idx, SAKURA_VFX_DUMMY.matrix);

        const haloScale = 0.92 + Math.sin(t * 7.4 + idx * 2.6) * 0.12;
        SAKURA_VFX_DUMMY.position.set(bx, SAKURA_BONFIRE_FLAME_Y + 0.05, bz);
        SAKURA_VFX_DUMMY.quaternion.copy(state.camera.quaternion);
        SAKURA_VFX_DUMMY.scale.setScalar(haloScale);
        SAKURA_VFX_DUMMY.updateMatrix();
        bonfireHalosRef.current.setMatrixAt(idx, SAKURA_VFX_DUMMY.matrix);
      }
      bonfireFlamesRef.current.instanceMatrix.needsUpdate = true;
      bonfireHalosRef.current.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <group>
      {/* Flush Courtyard Zen Medallion, Raked-Gravel Rings & Stepping Paths (y <= 0.028m) */}
      <mesh
        geometry={shared.geos.gardenCenterDisc}
        material={shared.mats.stoneDark}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.018, 0]}
        receiveShadow
      />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} receiveShadow>
        <ringGeometry args={[12.8, 13.15, 56]} />
        <meshStandardMaterial color="#676f96" roughness={0.88} transparent opacity={0.55} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} receiveShadow>
        <ringGeometry args={[18.8, 19.1, 56]} />
        <meshStandardMaterial color="#676f96" roughness={0.88} transparent opacity={0.45} />
      </mesh>
      <instancedMesh ref={lightStepStonesRef} args={[shared.geos.stepStone, shared.mats.stoneLight, 12]} receiveShadow />
      <instancedMesh ref={mossStepStonesRef} args={[shared.geos.stepStone, shared.mats.mossStone, 12]} receiveShadow />

      {/* 160 Instanced Fallen Sakura Petals flush on floor */}
      <instancedMesh ref={fallenPetalsRef} args={[shared.geos.fallenPetal, shared.mats.fallenPetalMat, 160]} frustumCulled={false} />

      {/* Low Mossy Courtyard Stone Curb + Bamboo Perimeter Fence (r = 26.15m) */}
      <mesh geometry={shared.geos.courtyardCurb} material={shared.mats.stoneDark} position={[0, 0.06, 0]} receiveShadow />
      <instancedMesh ref={bambooPostsRef} args={[shared.geos.bambooPost, shared.mats.bamboo, 84]} frustumCulled={false} castShadow />
      <instancedMesh ref={bambooRailsRef} args={[shared.geos.bambooRail, shared.mats.bamboo, 168]} frustumCulled={false} />

      {/* Grand Ashina Moon Shrine Pavilion on South Overlook (z = +32.5m) */}
      <group position={[0, 0, 32.5]}>
        <mesh position={[0, 0.85, 0]} material={shared.mats.stoneDark} receiveShadow>
          <boxGeometry args={[11.2, 1.7, 7.6]} />
        </mesh>
        {/* Timber sanctuary walls with glowing warm shoji paper screens */}
        <mesh position={[0, 3.0, 0]} material={shared.mats.shrineWood}>
          <boxGeometry args={[7.8, 2.9, 4.8]} />
        </mesh>
        <mesh position={[0, 3.0, -2.44]} material={shared.mats.shojiGlow}>
          <planeGeometry args={[5.4, 2.0]} />
        </mesh>
        {/* Corner timber pillars */}
        {[-4.6, 4.6].map((px) =>
          [-3.0, 3.0].map((pz) => (
            <mesh key={`shrine-col-${px}-${pz}`} position={[px, 3.1, pz]} material={shared.mats.toriiRed}>
              <cylinderGeometry args={[0.24, 0.28, 3.2, 8]} />
            </mesh>
          ))
        )}
        {/* Tier 1 Sweeping Pagoda Roof */}
        <mesh position={[0, 5.2, 0]} rotation={[0, Math.PI / 4, 0]} material={shared.mats.shrineRoof}>
          <coneGeometry args={[8.4, 2.1, 4]} />
        </mesh>
        {/* Tier 2 Upper Pagoda Roof */}
        <mesh position={[0, 6.7, 0]} material={shared.mats.shrineWood}>
          <boxGeometry args={[4.4, 1.6, 3.4]} />
        </mesh>
        <mesh position={[0, 6.65, -1.73]} material={shared.mats.shojiGlow}>
          <planeGeometry args={[2.6, 0.95]} />
        </mesh>
        <mesh position={[0, 8.2, 0]} rotation={[0, Math.PI / 4, 0]} material={shared.mats.shrineRoof}>
          <coneGeometry args={[5.4, 1.85, 4]} />
        </mesh>
        {/* Golden Finial */}
        <mesh position={[0, 9.4, 0]} material={shared.mats.gold}>
          <cylinderGeometry args={[0.08, 0.22, 0.9, 8]} />
        </mesh>
      </group>

      {/* 2 Flanking Smaller Ashina Watch-Pavilions (SE / SW at r = 34m) */}
      {[-0.78, 0.78].map((ang, idx) => (
        <group key={`watch-${idx}`} position={[Math.sin(ang) * 34, 0, Math.cos(ang) * 34]} rotation={[0, ang + Math.PI, 0]}>
          <mesh position={[0, 0.6, 0]} material={shared.mats.stoneDark}>
            <boxGeometry args={[5.4, 1.2, 5.4]} />
          </mesh>
          <mesh position={[0, 2.5, 0]} material={shared.mats.shrineWood}>
            <boxGeometry args={[3.6, 2.6, 3.6]} />
          </mesh>
          <mesh position={[0, 2.55, 1.83]} material={shared.mats.shojiGlow}>
            <planeGeometry args={[2.2, 1.3]} />
          </mesh>
          <mesh position={[0, 4.6, 0]} rotation={[0, Math.PI / 4, 0]} material={shared.mats.shrineRoof}>
            <coneGeometry args={[4.6, 1.75, 4]} />
          </mesh>
        </group>
      ))}

      {/* 3 Grand Vermilion Torii Gates (East, West, South at r = 27.5m) */}
      {SAKURA_TORII_SITES.map((site, index) => (
        <group key={`torii-${index}`} position={[site.x, 0, site.z]} rotation={[0, site.yaw, 0]}>
          <mesh geometry={shared.geos.toriiBase} material={shared.mats.stoneDark} position={[-2.2, 0.28, 0]} />
          <mesh geometry={shared.geos.toriiBase} material={shared.mats.stoneDark} position={[2.2, 0.28, 0]} />
          <mesh geometry={shared.geos.toriiPost} material={shared.mats.toriiRed} position={[-2.2, 2.8, 0]} castShadow />
          <mesh geometry={shared.geos.toriiPost} material={shared.mats.toriiRed} position={[2.2, 2.8, 0]} castShadow />
          <mesh geometry={shared.geos.toriiTop} material={shared.mats.toriiRed} position={[0, 5.45, 0]} castShadow />
          <mesh geometry={shared.geos.toriiCap} material={shared.mats.toriiDark} position={[0, 5.76, 0]} />
          <mesh geometry={shared.geos.toriiBar} material={shared.mats.toriiRed} position={[0, 4.55, 0]} />
          <mesh position={[0, 5.0, 0]} material={shared.mats.gold}>
            <boxGeometry args={[0.72, 0.85, 0.18]} />
          </mesh>
        </group>
      ))}

      {/* 12 Gnarled Cherry Blossom Tree Trunks & Limbs (r >= 28.4m) + Instanced Lush Canopies */}
      <instancedMesh ref={treeTrunksRef} args={[shared.geos.treeTrunk, shared.mats.bark, SAKURA_TREE_SITES.length]} castShadow frustumCulled={false} />
      <instancedMesh ref={treeLimbsRef} args={[shared.geos.treeLimb, shared.mats.bark, SAKURA_TREE_SITES.length * 2]} frustumCulled={false} />
      <instancedMesh ref={canopyLightRef} args={[shared.geos.canopyPuff, shared.mats.blossomLight, SAKURA_TREE_SITES.length * 3]} frustumCulled={false} />
      <instancedMesh ref={canopyDeepRef} args={[shared.geos.canopyPuff, shared.mats.blossomDeep, SAKURA_TREE_SITES.length * 2]} frustumCulled={false} />

      {/* 12 Glowing Mossy Stone Lanterns (Tōrō) around the perimeter (r = 26.35m) */}
      <instancedMesh ref={lanternFeetRef} args={[shared.geos.lanternFoot, shared.mats.mossStone, SAKURA_LANTERN_SITES.length]} />
      <instancedMesh ref={lanternShaftsRef} args={[shared.geos.lanternShaft, shared.mats.stoneLight, SAKURA_LANTERN_SITES.length]} />
      <instancedMesh ref={lanternBoxesRef} args={[shared.geos.lanternBox, shared.mats.lanternGlow, SAKURA_LANTERN_SITES.length]} />
      <instancedMesh ref={lanternRoofsRef} args={[shared.geos.lanternRoof, shared.mats.mossStone, SAKURA_LANTERN_SITES.length]} />
      <instancedMesh ref={lanternGlowSpritesRef} args={[shared.geos.lanternGlowSprite, shared.mats.lanternGlowSprite, SAKURA_LANTERN_SITES.length]} />

      {/* 2 Ceremonial Bonfire Flame Cones & Warm Glow Halos */}
      <instancedMesh ref={bonfireFlamesRef} args={[shared.geos.bonfireFlame, shared.mats.bonfireFlame, SAKURA_BONFIRE_SITES.length]} />
      <instancedMesh ref={bonfireHalosRef} args={[shared.geos.bonfireHalo, shared.mats.bonfireHalo, SAKURA_BONFIRE_SITES.length]} />

      {/* 4 Themed Mossy Inner Pillars (strictly aligned to ARENA.PILLARS colliders!) */}
      {ARENA.PILLARS.map((pillar, index) => (
        <group key={`sakura-inner-pillar-${index}`} position={[pillar.x, 0, pillar.z]}>
          <mesh geometry={shared.geos.innerPillarBase} material={shared.mats.mossStone} position={[0, 0.42, 0]} castShadow receiveShadow />
          <mesh geometry={shared.geos.innerPillarShaft} material={shared.mats.stoneDark} position={[0, 3.25, 0]} castShadow receiveShadow />
          <mesh geometry={shared.geos.innerRopeBand} material={shared.mats.toriiRed} position={[0, 4.8, 0]} rotation={[Math.PI / 2, 0, 0]} />
          {/* Overhanging cherry blossom boughs high above player height (y = 6.2m) */}
          <mesh
            geometry={shared.geos.canopyPuff}
            material={shared.mats.blossomLight}
            position={[0.3, 6.45, -0.2]}
            scale={[0.92, 0.58, 0.88]}
            castShadow
          />
          <mesh
            geometry={shared.geos.canopyPuff}
            material={shared.mats.blossomDeep}
            position={[-0.65, 6.1, 0.45]}
            scale={[0.72, 0.48, 0.72]}
          />
        </group>
      ))}
    </group>
  );
});

/* ============================================================================
 * 3. AURORA SANCTUARY — Obsidian-Gold Curb, 10 Floating Multi-Color Crystal
 *    Obelisks, 8 Prismatic Archways & South Celestial Observatory Armillary Dais
 * ============================================================================ */

function createAuroraHaloTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(255, 255, 255, 1)");
    grad.addColorStop(0.32, "rgba(186, 230, 253, 0.58)");
    grad.addColorStop(0.7, "rgba(34, 211, 238, 0.18)");
    grad.addColorStop(1, "rgba(34, 211, 238, 0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

const AURORA_CRYSTAL_HEX = ["#22d3ee", "#34d399", "#f472b6", "#fbbf24"] as const;
const AURORA_ARCH_ANGLES: readonly number[] = [
  -2.45, -1.9, -1.35, -0.78, 0.78, 1.35, 1.9, 2.45,
];

const AuroraSanctuaryStructures = memo(function AuroraSanctuaryStructures() {
  const plinthsRef = useRef<THREE.InstancedMesh>(null);
  const crystalsRef = useRef<THREE.InstancedMesh>(null);
  const halosRef = useRef<THREE.InstancedMesh>(null);
  const archColsRef = useRef<THREE.InstancedMesh>(null);
  const archBeamsRef = useRef<THREE.InstancedMesh>(null);

  const armillaryRing1Ref = useRef<THREE.Mesh>(null);
  const armillaryRing2Ref = useRef<THREE.Mesh>(null);
  const armillaryRing3Ref = useRef<THREE.Mesh>(null);
  const armillaryCoreRef = useRef<THREE.Mesh>(null);

  const shared = useMemo(() => {
    const haloTex = createAuroraHaloTexture();
    const curbPts = [
      new THREE.Vector2(WALL_R - 0.55, -0.06),
      new THREE.Vector2(WALL_R - 0.42, 0.1),
      new THREE.Vector2(WALL_R + 0.15, 0.1),
      new THREE.Vector2(WALL_R + 0.15, -0.06),
    ];

    const geos = {
      curb: new THREE.LatheGeometry(curbPts, 64),
      curbTrim: new THREE.TorusGeometry(WALL_R - 0.18, 0.045, 6, 72),
      plinth: new THREE.CylinderGeometry(0.42, 0.58, 1.5, 6),
      crystal: new THREE.OctahedronGeometry(0.65, 0),
      halo: new THREE.PlaneGeometry(3.1, 3.1),
      archCol: new THREE.BoxGeometry(0.54, 6.2, 0.54),
      archBeam: new THREE.BoxGeometry(3.85, 0.48, 0.62),
      daisTier1: new THREE.CylinderGeometry(6.4, 6.9, 1.6, 24),
      daisTier2: new THREE.CylinderGeometry(5.7, 6.1, 1.6, 24),
      daisTier3: new THREE.CylinderGeometry(5.0, 5.3, 1.6, 24),
      daisTrim: new THREE.TorusGeometry(5.0, 0.09, 8, 48),
      armillaryOuter: new THREE.TorusGeometry(2.15, 0.08, 12, 48),
      armillaryMid: new THREE.TorusGeometry(1.7, 0.07, 12, 48),
      armillaryInner: new THREE.TorusGeometry(1.25, 0.06, 12, 48),
      armillaryCore: new THREE.OctahedronGeometry(0.95, 0),
      innerPillarBase: new THREE.BoxGeometry(2.35, 0.85, 2.35),
      innerPillarShaft: new THREE.CylinderGeometry(0.82, 0.94, 5.6, 8),
      innerPillarCollar: new THREE.TorusGeometry(0.92, 0.1, 7, 16),
      innerPillarCap: new THREE.OctahedronGeometry(0.75, 0),
    };

    const mats = {
      obsidian: new THREE.MeshStandardMaterial({ color: "#182235", roughness: 0.52, metalness: 0.42 }),
      slateJade: new THREE.MeshStandardMaterial({ color: "#1e3a52", roughness: 0.58, metalness: 0.25 }),
      gold: new THREE.MeshStandardMaterial({
        color: "#fbbf24",
        emissive: "#92400e",
        emissiveIntensity: 0.22,
        metalness: 0.78,
        roughness: 0.26,
      }),
      cyanTrim: new THREE.MeshStandardMaterial({
        color: "#22d3ee",
        emissive: "#0891b2",
        emissiveIntensity: 0.65,
        metalness: 0.45,
        roughness: 0.24,
      }),
      crystal: new THREE.MeshStandardMaterial({
        color: "#ffffff",
        emissive: "#0e7490",
        emissiveIntensity: 0.48,
        roughness: 0.18,
        metalness: 0.25,
        toneMapped: false,
      }),
      halo: new THREE.MeshBasicMaterial({
        map: haloTex,
        color: "#ffffff",
        transparent: true,
        opacity: 0.52,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
      archBeam: new THREE.MeshStandardMaterial({
        color: "#1e3a52",
        emissive: "#0e7490",
        emissiveIntensity: 0.42,
        roughness: 0.35,
        metalness: 0.55,
      }),
      prismCore: new THREE.MeshStandardMaterial({
        color: "#38bdf8",
        emissive: "#c084fc",
        emissiveIntensity: 0.65,
        roughness: 0.16,
        metalness: 0.35,
        toneMapped: false,
      }),
    };

    return { geos, mats, haloTex };
  }, []);

  useEffect(() => () => {
    Object.values(shared.geos).forEach((g) => g.dispose());
    Object.values(shared.mats).forEach((m) => m.dispose());
    shared.haloTex.dispose();
  }, [shared]);

  useEffect(() => {
    const obeliskRadius = WALL_R + 0.75;
    const colorScratch = new THREE.Color();

    if (plinthsRef.current && crystalsRef.current && halosRef.current) {
      for (let i = 0; i < AURORA_OBELISK_ANGLES.length; i++) {
        const a = AURORA_OBELISK_ANGLES[i];
        const x = Math.sin(a) * obeliskRadius;
        const z = Math.cos(a) * obeliskRadius;

        AURORA_DUMMY.position.set(x, 0.75, z);
        AURORA_DUMMY.rotation.set(0, a, 0);
        AURORA_DUMMY.scale.set(1, 1, 1);
        AURORA_DUMMY.updateMatrix();
        plinthsRef.current.setMatrixAt(i, AURORA_DUMMY.matrix);

        AURORA_DUMMY.position.set(x, 2.85, z);
        AURORA_DUMMY.rotation.set(0, a, 0);
        AURORA_DUMMY.scale.set(0.65, 1.8, 0.65);
        AURORA_DUMMY.updateMatrix();
        crystalsRef.current.setMatrixAt(i, AURORA_DUMMY.matrix);

        AURORA_DUMMY.position.set(x, 2.85, z);
        AURORA_DUMMY.rotation.set(0, a, 0);
        AURORA_DUMMY.scale.set(1, 1, 1);
        AURORA_DUMMY.updateMatrix();
        halosRef.current.setMatrixAt(i, AURORA_DUMMY.matrix);

        colorScratch.set(AURORA_CRYSTAL_HEX[i % AURORA_CRYSTAL_HEX.length]);
        crystalsRef.current.setColorAt(i, colorScratch);
        halosRef.current.setColorAt(i, colorScratch);
      }

      plinthsRef.current.instanceMatrix.needsUpdate = true;
      plinthsRef.current.computeBoundingSphere();

      crystalsRef.current.instanceMatrix.needsUpdate = true;
      if (crystalsRef.current.instanceColor) crystalsRef.current.instanceColor.needsUpdate = true;
      crystalsRef.current.computeBoundingSphere();

      halosRef.current.instanceMatrix.needsUpdate = true;
      if (halosRef.current.instanceColor) halosRef.current.instanceColor.needsUpdate = true;
      halosRef.current.computeBoundingSphere();
    }

    if (archColsRef.current && archBeamsRef.current) {
      const archR = WALL_R + 2.35;
      const halfSpan = 1.48;
      let colIdx = 0;

      for (let i = 0; i < AURORA_ARCH_ANGLES.length; i++) {
        const a = AURORA_ARCH_ANGLES[i];
        const cx = Math.sin(a) * archR;
        const cz = Math.cos(a) * archR;
        const tx = Math.cos(a);
        const tz = -Math.sin(a);

        for (const side of [-1, 1]) {
          AURORA_DUMMY.position.set(cx + tx * side * halfSpan, 3.1, cz + tz * side * halfSpan);
          AURORA_DUMMY.rotation.set(0, a, 0);
          AURORA_DUMMY.scale.set(1, 1, 1);
          AURORA_DUMMY.updateMatrix();
          archColsRef.current.setMatrixAt(colIdx++, AURORA_DUMMY.matrix);
        }

        AURORA_DUMMY.position.set(cx, 6.25, cz);
        AURORA_DUMMY.rotation.set(0, a, 0);
        AURORA_DUMMY.scale.set(1, 1, 1);
        AURORA_DUMMY.updateMatrix();
        archBeamsRef.current.setMatrixAt(i, AURORA_DUMMY.matrix);
      }

      archColsRef.current.instanceMatrix.needsUpdate = true;
      archColsRef.current.computeBoundingSphere();
      archBeamsRef.current.instanceMatrix.needsUpdate = true;
      archBeamsRef.current.computeBoundingSphere();
    }
  }, []);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const obeliskRadius = WALL_R + 0.75;

    if (crystalsRef.current && halosRef.current) {
      for (let i = 0; i < AURORA_OBELISK_ANGLES.length; i++) {
        const a = AURORA_OBELISK_ANGLES[i];
        const x = Math.sin(a) * obeliskRadius;
        const z = Math.cos(a) * obeliskRadius;
        const y = 2.85 + Math.sin(t * 1.6 + i * 0.8) * 0.28;

        AURORA_DUMMY.position.set(x, y, z);
        AURORA_DUMMY.rotation.set(0, t * 0.85 + i * 0.6, 0);
        AURORA_DUMMY.scale.set(0.65, 1.8, 0.65);
        AURORA_DUMMY.updateMatrix();
        crystalsRef.current.setMatrixAt(i, AURORA_DUMMY.matrix);

        AURORA_DUMMY.position.set(x, y, z);
        AURORA_DUMMY.quaternion.copy(state.camera.quaternion);
        AURORA_DUMMY.scale.setScalar(1 + Math.sin(t * 2.2 + i) * 0.08);
        AURORA_DUMMY.updateMatrix();
        halosRef.current.setMatrixAt(i, AURORA_DUMMY.matrix);
      }
      crystalsRef.current.instanceMatrix.needsUpdate = true;
      halosRef.current.instanceMatrix.needsUpdate = true;
    }

    if (armillaryRing1Ref.current) {
      armillaryRing1Ref.current.rotation.y = t * 0.24;
      armillaryRing1Ref.current.rotation.x = 0.42 + Math.sin(t * 0.3) * 0.08;
    }
    if (armillaryRing2Ref.current) {
      armillaryRing2Ref.current.rotation.y = -t * 0.36;
      armillaryRing2Ref.current.rotation.z = 0.68 + Math.cos(t * 0.25) * 0.1;
    }
    if (armillaryRing3Ref.current) {
      armillaryRing3Ref.current.rotation.x = t * 0.48;
      armillaryRing3Ref.current.rotation.z = -0.35;
    }
    if (armillaryCoreRef.current) {
      armillaryCoreRef.current.rotation.y = -t * 0.7;
      armillaryCoreRef.current.position.y = 7.2 + Math.sin(t * 1.8) * 0.16;
    }
  });

  return (
    <group>
      {/* Obsidian-Gold Courtyard Perimeter Curb */}
      <mesh geometry={shared.geos.curb} material={shared.mats.obsidian} position={[0, 0.06, 0]} receiveShadow />
      <mesh
        geometry={shared.geos.curbTrim}
        material={shared.mats.gold}
        position={[0, 0.16, 0]}
        rotation={[Math.PI / 2, 0, 0]}
      />

      {/* 10 Floating Multi-Color Crystal Obelisks */}
      <instancedMesh
        ref={plinthsRef}
        args={[shared.geos.plinth, shared.mats.slateJade, AURORA_OBELISK_ANGLES.length]}
        castShadow
        receiveShadow
        frustumCulled={false}
      />
      <instancedMesh
        ref={crystalsRef}
        args={[shared.geos.crystal, shared.mats.crystal, AURORA_OBELISK_ANGLES.length]}
        frustumCulled={false}
      />
      <instancedMesh
        ref={halosRef}
        args={[shared.geos.halo, shared.mats.halo, AURORA_OBELISK_ANGLES.length]}
        frustumCulled={false}
      />

      {/* 8 Prismatic Perimeter Archways */}
      <instancedMesh
        ref={archColsRef}
        args={[shared.geos.archCol, shared.mats.slateJade, AURORA_ARCH_ANGLES.length * 2]}
        castShadow
        frustumCulled={false}
      />
      <instancedMesh
        ref={archBeamsRef}
        args={[shared.geos.archBeam, shared.mats.archBeam, AURORA_ARCH_ANGLES.length]}
        castShadow
        frustumCulled={false}
      />

      {/* South Celestial Observatory Dais (z = WALL_R + 7.2 = 33.2, outside PLAYABLE_RADIUS) & 3-Ring Armillary Sphere */}
      <group position={[0, 0, WALL_R + 7.2]}>
        <mesh geometry={shared.geos.daisTier1} material={shared.mats.obsidian} position={[0, 0.8, 0]} receiveShadow castShadow />
        <mesh geometry={shared.geos.daisTier2} material={shared.mats.slateJade} position={[0, 2.4, 0]} receiveShadow castShadow />
        <mesh geometry={shared.geos.daisTier3} material={shared.mats.slateJade} position={[0, 4.0, 0]} receiveShadow castShadow />
        <mesh
          geometry={shared.geos.daisTrim}
          material={shared.mats.gold}
          position={[0, 4.8, 0]}
          rotation={[Math.PI / 2, 0, 0]}
        />

        <mesh ref={armillaryRing1Ref} geometry={shared.geos.armillaryOuter} material={shared.mats.gold} position={[0, 7.2, 0]} />
        <mesh ref={armillaryRing2Ref} geometry={shared.geos.armillaryMid} material={shared.mats.cyanTrim} position={[0, 7.2, 0]} />
        <mesh ref={armillaryRing3Ref} geometry={shared.geos.armillaryInner} material={shared.mats.gold} position={[0, 7.2, 0]} />
        <mesh ref={armillaryCoreRef} geometry={shared.geos.armillaryCore} material={shared.mats.prismCore} position={[0, 7.2, 0]} scale={[0.75, 1.35, 0.75]} />
      </group>

      {/* 4 Themed Jade-Prism Inner Pillars (strictly aligned to ARENA.PILLARS colliders!) */}
      {ARENA.PILLARS.map((pillar, index) => (
        <group key={`aurora-inner-pillar-${index}`} position={[pillar.x, 0, pillar.z]}>
          <mesh geometry={shared.geos.innerPillarBase} material={shared.mats.obsidian} position={[0, 0.42, 0]} castShadow receiveShadow />
          <mesh geometry={shared.geos.innerPillarShaft} material={shared.mats.slateJade} position={[0, 3.25, 0]} castShadow receiveShadow />
          <mesh geometry={shared.geos.innerPillarCollar} material={shared.mats.gold} position={[0, 4.8, 0]} rotation={[Math.PI / 2, 0, 0]} />
          <mesh geometry={shared.geos.innerPillarCap} material={shared.mats.cyanTrim} position={[0, 6.45, 0]} scale={[0.7, 1.25, 0.7]} />
        </group>
      ))}
    </group>
  );
});

/* ============================================================================
 * 4. SUNLIT SAKURA GARDEN — 24 Thick Multi-Tiered Cherry Blossom Trees,
 *    1,000 Floor Flowers, Warm Bamboo Fence, 3 Vermilion Torii Gates,
 *    Sunlit Shinto Pagoda Pavilion & 12 Stone Lanterns
 * ============================================================================ */

const SUNNY_TREE_COUNT = 24;
const SUNNY_FLOOR_FLOWER_COUNT = 1000;
const SUNNY_LANTERN_COUNT = 12;

const SUNNY_TREE_SITES = Array.from({ length: SUNNY_TREE_COUNT }, (_, i) => {
  const t = (i + 0.5) / SUNNY_TREE_COUNT;
  const angle = -Math.PI + 0.28 + t * (Math.PI * 2 - 0.56);
  const r = 26.8 + (i % 3) * 2.4 + seeded(i + 1301) * 2.4;
  const x = Math.sin(angle) * r;
  const z = Math.cos(angle) * r;
  const scale = 0.96 + seeded(i + 1401) * 0.34;
  return { i, x, z, yaw: angle + seeded(i + 1501) * 0.8, scale };
});

const SUNNY_LANTERN_SITES = Array.from({ length: SUNNY_LANTERN_COUNT }, (_, i) => {
  const t = (i + 0.5) / SUNNY_LANTERN_COUNT;
  const angle = -Math.PI + 0.26 + t * (Math.PI * 2 - 0.52);
  const x = Math.sin(angle) * 26.35;
  const z = Math.cos(angle) * 26.35;
  return { i, x, z, yaw: angle };
});

const SUNNY_FLOWER_PALETTE = [
  new THREE.Color("#ffb7dc"),
  new THREE.Color("#fff3f8"),
  new THREE.Color("#ff85b3"),
  new THREE.Color("#fde047"),
] as const;

const SunnySakuraStructures = memo(function SunnySakuraStructures() {
  const bambooPostsRef = useRef<THREE.InstancedMesh>(null);
  const bambooRailsRef = useRef<THREE.InstancedMesh>(null);
  const thickTrunksRef = useRef<THREE.InstancedMesh>(null);
  const thickBranchesRef = useRef<THREE.InstancedMesh>(null);
  const denseCanopyLightRef = useRef<THREE.InstancedMesh>(null);
  const denseCanopyDeepRef = useRef<THREE.InstancedMesh>(null);
  const denseCanopyCreamRef = useRef<THREE.InstancedMesh>(null);
  const floorFlowersRef = useRef<THREE.InstancedMesh>(null);
  const floorFlowerCentersRef = useRef<THREE.InstancedMesh>(null);
  const lanternFeetRef = useRef<THREE.InstancedMesh>(null);
  const lanternShaftsRef = useRef<THREE.InstancedMesh>(null);
  const lanternBoxesRef = useRef<THREE.InstancedMesh>(null);
  const lanternRoofsRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  const shared = useMemo(() => {
    const curbPts = [
      new THREE.Vector2(WALL_R - 0.55, -0.06),
      new THREE.Vector2(WALL_R - 0.42, 0.09),
      new THREE.Vector2(WALL_R + 0.15, 0.09),
      new THREE.Vector2(WALL_R + 0.15, -0.06),
    ];
    const geos = {
      courtyardCurb: new THREE.LatheGeometry(curbPts, 64),
      bambooPost: new THREE.CylinderGeometry(0.085, 0.1, 2.55, 6),
      bambooRail: new THREE.CylinderGeometry(0.055, 0.055, 1.95, 6),
      toriiBase: new THREE.BoxGeometry(0.82, 0.55, 0.82),
      toriiPost: new THREE.CylinderGeometry(0.24, 0.3, 5.6, 8),
      toriiTop: new THREE.BoxGeometry(6.6, 0.44, 0.78),
      toriiCap: new THREE.BoxGeometry(6.95, 0.22, 0.86),
      toriiBar: new THREE.BoxGeometry(4.8, 0.24, 0.52),
      thickTrunk: new THREE.CylinderGeometry(0.45, 0.78, 5.2, 8),
      thickBranch: new THREE.CylinderGeometry(0.2, 0.42, 4.4, 7),
      canopyPuff: new THREE.DodecahedronGeometry(2.35, 1),
      floorFlower: new THREE.CircleGeometry(0.16, 5),
      floorFlowerCenter: new THREE.CircleGeometry(0.045, 5),
      innerPillarBase: new THREE.BoxGeometry(2.35, 0.85, 2.35),
      innerPillarShaft: new THREE.CylinderGeometry(0.82, 0.94, 5.6, 10),
      innerRopeBand: new THREE.TorusGeometry(0.92, 0.12, 7, 16),
      lanternFoot: new THREE.BoxGeometry(0.84, 0.32, 0.84),
      lanternShaft: new THREE.CylinderGeometry(0.22, 0.28, 1.05, 6),
      lanternBox: new THREE.BoxGeometry(0.56, 0.52, 0.56),
      lanternRoof: new THREE.ConeGeometry(0.82, 0.44, 4),
    };

    const mats = {
      mossStone: new THREE.MeshStandardMaterial({ color: "#687856", roughness: 0.86 }),
      warmStone: new THREE.MeshStandardMaterial({ color: "#9c9a8a", roughness: 0.8 }),
      bamboo: new THREE.MeshStandardMaterial({ color: "#8ca156", roughness: 0.72 }),
      toriiRed: new THREE.MeshStandardMaterial({ color: "#c93b44", roughness: 0.46 }),
      toriiDark: new THREE.MeshStandardMaterial({ color: "#3a2a22", roughness: 0.62 }),
      gold: new THREE.MeshStandardMaterial({ color: "#f5b942", metalness: 0.62, roughness: 0.34 }),
      bark: new THREE.MeshStandardMaterial({ color: "#5c4236", roughness: 0.9 }),
      blossomLight: new THREE.MeshStandardMaterial({ color: "#ffb7dc", roughness: 0.82 }),
      blossomDeep: new THREE.MeshStandardMaterial({ color: "#ff7fb8", roughness: 0.84 }),
      blossomCream: new THREE.MeshStandardMaterial({ color: "#ffe8f3", roughness: 0.8 }),
      flowerPetal: new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.72 }),
      flowerCenter: new THREE.MeshStandardMaterial({ color: "#f59e0b", roughness: 0.55 }),
      lanternPaper: new THREE.MeshStandardMaterial({ color: "#fff4d4", roughness: 0.6 }),
      cedarWood: new THREE.MeshStandardMaterial({ color: "#7a4c36", roughness: 0.8 }),
      pagodaRoof: new THREE.MeshStandardMaterial({ color: "#3a2e2b", roughness: 0.66, metalness: 0.12 }),
      shojiScreen: new THREE.MeshStandardMaterial({ color: "#fff5dc", roughness: 0.7 }),
    };

    return { geos, mats };
  }, []);

  useEffect(() => () => {
    Object.values(shared.geos).forEach((g) => g.dispose());
    Object.values(shared.mats).forEach((m) => m.dispose());
  }, [shared]);

  useEffect(() => {
    // 1. Warm bamboo perimeter fence (r = 26.15m, skipping North Gate)
    const fenceSegs = 84;
    if (bambooPostsRef.current && bambooRailsRef.current) {
      let pIdx = 0;
      let rIdx = 0;
      for (let i = 0; i < fenceSegs; i++) {
        const a = (i / fenceSegs) * Math.PI * 2;
        const x = Math.sin(a) * 26.15;
        const z = Math.cos(a) * 26.15;
        if (isNorthGateZone(x, z)) continue;

        dummy.position.set(x, 1.25, z);
        dummy.rotation.set(0, a, (seeded(i + 21) - 0.5) * 0.04);
        dummy.scale.set(1, 0.94 + seeded(i + 41) * 0.14, 1);
        dummy.updateMatrix();
        bambooPostsRef.current.setMatrixAt(pIdx++, dummy.matrix);

        for (const ry of [0.8, 1.85]) {
          dummy.position.set(x, ry, z);
          dummy.rotation.set(0, a, Math.PI / 2);
          dummy.scale.set(1, 1, 1);
          dummy.updateMatrix();
          bambooRailsRef.current.setMatrixAt(rIdx++, dummy.matrix);
        }
      }
      bambooPostsRef.current.count = pIdx;
      bambooRailsRef.current.count = rIdx;
      bambooPostsRef.current.instanceMatrix.needsUpdate = true;
      bambooRailsRef.current.instanceMatrix.needsUpdate = true;
      bambooPostsRef.current.computeBoundingSphere();
      bambooRailsRef.current.computeBoundingSphere();
    }

    // 2. 24 Thick, Multi-Tiered Cherry Blossom Trees (24 trunks, 72 branches, 96+72+48 canopy puffs)
    const branchSpecs: readonly [number, number, number, number, number, number][] = [
      [-1.15, 4.7, 0.25, 0.18, 0.1, 0.62],
      [1.1, 4.85, -0.35, -0.22, 0.4, -0.58],
      [0.15, 5.1, 1.1, -0.55, -0.2, 0.12],
    ];
    const lightOffsets: readonly [number, number, number, number][] = [
      [-2.1, 6.4, 0.4, 1.24],
      [2.0, 6.8, -0.6, 1.18],
      [0.0, 7.8, 0.2, 1.32],
      [0.2, 6.2, 2.0, 1.1],
    ];
    const deepOffsets: readonly [number, number, number, number][] = [
      [-1.0, 5.6, -1.6, 1.12],
      [1.4, 5.9, 1.4, 1.08],
      [-1.5, 7.1, -0.4, 1.05],
    ];
    const creamOffsets: readonly [number, number, number, number][] = [
      [-0.8, 8.2, 0.8, 1.02],
      [1.1, 7.9, -0.9, 0.96],
    ];

    if (
      thickTrunksRef.current &&
      thickBranchesRef.current &&
      denseCanopyLightRef.current &&
      denseCanopyDeepRef.current &&
      denseCanopyCreamRef.current
    ) {
      let trunkIdx = 0;
      let branchIdx = 0;
      let lightIdx = 0;
      let deepIdx = 0;
      let creamIdx = 0;

      for (const tree of SUNNY_TREE_SITES) {
        const parentPos = new THREE.Vector3(tree.x, 0, tree.z);
        setGroupedInstanceMatrix(
          thickTrunksRef.current,
          trunkIdx++,
          parentPos,
          tree.yaw,
          tree.scale,
          new THREE.Vector3(0, 2.5, 0),
          new THREE.Euler(0.06, 0, 0.05)
        );
        for (const [bx, by, bz, rx, ry, rz] of branchSpecs) {
          setGroupedInstanceMatrix(
            thickBranchesRef.current,
            branchIdx++,
            parentPos,
            tree.yaw,
            tree.scale,
            new THREE.Vector3(bx, by, bz),
            new THREE.Euler(rx, ry, rz)
          );
        }

        const cos = Math.cos(tree.yaw);
        const sin = Math.sin(tree.yaw);
        for (const [ox, oy, oz, sc] of lightOffsets) {
          dummy.position.set(tree.x + (ox * cos - oz * sin) * tree.scale, oy * tree.scale, tree.z + (ox * sin + oz * cos) * tree.scale);
          dummy.rotation.set(0.18, tree.yaw + ox, 0.12);
          dummy.scale.set(sc * tree.scale * 1.18, sc * tree.scale * 0.72, sc * tree.scale * 1.12);
          dummy.updateMatrix();
          denseCanopyLightRef.current.setMatrixAt(lightIdx++, dummy.matrix);
        }
        for (const [ox, oy, oz, sc] of deepOffsets) {
          dummy.position.set(tree.x + (ox * cos - oz * sin) * tree.scale, oy * tree.scale, tree.z + (ox * sin + oz * cos) * tree.scale);
          dummy.rotation.set(-0.15, tree.yaw + oz, 0.2);
          dummy.scale.set(sc * tree.scale * 1.2, sc * tree.scale * 0.7, sc * tree.scale * 1.14);
          dummy.updateMatrix();
          denseCanopyDeepRef.current.setMatrixAt(deepIdx++, dummy.matrix);
        }
        for (const [ox, oy, oz, sc] of creamOffsets) {
          dummy.position.set(tree.x + (ox * cos - oz * sin) * tree.scale, oy * tree.scale, tree.z + (ox * sin + oz * cos) * tree.scale);
          dummy.rotation.set(0.12, tree.yaw + ox * 0.5, -0.14);
          dummy.scale.set(sc * tree.scale * 1.1, sc * tree.scale * 0.68, sc * tree.scale * 1.05);
          dummy.updateMatrix();
          denseCanopyCreamRef.current.setMatrixAt(creamIdx++, dummy.matrix);
        }
      }

      for (const mesh of [
        thickTrunksRef.current,
        thickBranchesRef.current,
        denseCanopyLightRef.current,
        denseCanopyDeepRef.current,
        denseCanopyCreamRef.current,
      ]) {
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
      }
    }

    // 3. 1,000 Little Flowers Covering the Floor (2 draw calls: petals + gold centers)
    if (floorFlowersRef.current && floorFlowerCentersRef.current) {
      for (let i = 0; i < SUNNY_FLOOR_FLOWER_COUNT; i++) {
        const angle = seeded(i + 2001) * Math.PI * 2;
        const r = 1.6 + Math.pow(seeded(i + 2101), 0.58) * 23.2;
        let fx = Math.cos(angle) * r;
        let fz = Math.sin(angle) * r;

        for (const pillar of ARENA.PILLARS) {
          const dx = fx - pillar.x;
          const dz = fz - pillar.z;
          const dist = Math.hypot(dx, dz);
          if (dist < pillar.radius + 0.35 && dist > 0.001) {
            const push = (pillar.radius + 0.45) / dist;
            fx = pillar.x + dx * push;
            fz = pillar.z + dz * push;
          }
        }

        const fy = 0.018 + seeded(i + 2201) * 0.006;
        const yaw = seeded(i + 2301) * Math.PI * 2;
        const sc = 0.65 + seeded(i + 2401) * 0.8;

        dummy.position.set(fx, fy, fz);
        dummy.rotation.set(-Math.PI / 2, 0, yaw);
        dummy.scale.set(sc, sc, 1);
        dummy.updateMatrix();
        floorFlowersRef.current.setMatrixAt(i, dummy.matrix);
        floorFlowersRef.current.setColorAt(i, SUNNY_FLOWER_PALETTE[i % SUNNY_FLOWER_PALETTE.length]);

        dummy.position.set(fx, 0.025, fz);
        dummy.rotation.set(-Math.PI / 2, 0, yaw);
        dummy.scale.set(sc, sc, 1);
        dummy.updateMatrix();
        floorFlowerCentersRef.current.setMatrixAt(i, dummy.matrix);
      }
      floorFlowersRef.current.instanceMatrix.needsUpdate = true;
      floorFlowersRef.current.computeBoundingSphere();
      if (floorFlowersRef.current.instanceColor) {
        floorFlowersRef.current.instanceColor.needsUpdate = true;
      }
      floorFlowerCentersRef.current.instanceMatrix.needsUpdate = true;
      floorFlowerCentersRef.current.computeBoundingSphere();
    }

    // 4. 12 Sunlit Stone Lanterns (Tōrō) around the perimeter
    if (lanternFeetRef.current && lanternShaftsRef.current && lanternBoxesRef.current && lanternRoofsRef.current) {
      let lanternIdx = 0;
      for (const lantern of SUNNY_LANTERN_SITES) {
        const parentPos = new THREE.Vector3(lantern.x, 0, lantern.z);
        setGroupedInstanceMatrix(lanternFeetRef.current, lanternIdx, parentPos, lantern.yaw, 1, new THREE.Vector3(0, 0.16, 0), new THREE.Euler());
        setGroupedInstanceMatrix(lanternShaftsRef.current, lanternIdx, parentPos, lantern.yaw, 1, new THREE.Vector3(0, 0.82, 0), new THREE.Euler());
        setGroupedInstanceMatrix(lanternBoxesRef.current, lanternIdx, parentPos, lantern.yaw, 1, new THREE.Vector3(0, 1.56, 0), new THREE.Euler());
        setGroupedInstanceMatrix(lanternRoofsRef.current, lanternIdx++, parentPos, lantern.yaw, 1, new THREE.Vector3(0, 2.02, 0), new THREE.Euler(0, Math.PI / 4, 0));
      }
      for (const mesh of [lanternFeetRef.current, lanternShaftsRef.current, lanternBoxesRef.current, lanternRoofsRef.current]) {
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
      }
    }
  }, [dummy]);

  return (
    <group>
      {/* 1,000 Instanced Floor Flowers + Gold Centers (2 draw calls) */}
      <instancedMesh ref={floorFlowersRef} args={[shared.geos.floorFlower, shared.mats.flowerPetal, SUNNY_FLOOR_FLOWER_COUNT]} receiveShadow frustumCulled={false} />
      <instancedMesh ref={floorFlowerCentersRef} args={[shared.geos.floorFlowerCenter, shared.mats.flowerCenter, SUNNY_FLOOR_FLOWER_COUNT]} frustumCulled={false} />

      {/* Mossy Courtyard Stone Curb + Warm Bamboo Perimeter Fence (r = 26.15m) */}
      <mesh geometry={shared.geos.courtyardCurb} material={shared.mats.mossStone} position={[0, 0.06, 0]} receiveShadow />
      <instancedMesh ref={bambooPostsRef} args={[shared.geos.bambooPost, shared.mats.bamboo, 84]} frustumCulled={false} castShadow />
      <instancedMesh ref={bambooRailsRef} args={[shared.geos.bambooRail, shared.mats.bamboo, 168]} frustumCulled={false} />

      {/* Sunlit Shinto Pagoda Pavilion on South Overlook (z = +32.5m) */}
      <group position={[0, 0, 32.5]}>
        <mesh position={[0, 0.85, 0]} material={shared.mats.warmStone} receiveShadow>
          <boxGeometry args={[11.2, 1.7, 7.6]} />
        </mesh>
        <mesh position={[0, 3.0, 0]} material={shared.mats.cedarWood} castShadow>
          <boxGeometry args={[7.8, 2.9, 4.8]} />
        </mesh>
        <mesh position={[0, 3.0, -2.44]} material={shared.mats.shojiScreen}>
          <planeGeometry args={[5.4, 2.0]} />
        </mesh>
        {[-4.6, 4.6].map((px) =>
          [-3.0, 3.0].map((pz) => (
            <mesh key={`sunny-pagoda-col-${px}-${pz}`} position={[px, 3.1, pz]} material={shared.mats.toriiRed} castShadow>
              <cylinderGeometry args={[0.24, 0.28, 3.2, 8]} />
            </mesh>
          ))
        )}
        <mesh position={[0, 5.2, 0]} rotation={[0, Math.PI / 4, 0]} material={shared.mats.pagodaRoof} castShadow>
          <coneGeometry args={[8.4, 2.1, 4]} />
        </mesh>
        <mesh position={[0, 6.7, 0]} material={shared.mats.cedarWood}>
          <boxGeometry args={[4.4, 1.6, 3.4]} />
        </mesh>
        <mesh position={[0, 6.65, -1.73]} material={shared.mats.shojiScreen}>
          <planeGeometry args={[2.6, 0.95]} />
        </mesh>
        <mesh position={[0, 8.2, 0]} rotation={[0, Math.PI / 4, 0]} material={shared.mats.pagodaRoof} castShadow>
          <coneGeometry args={[5.4, 1.85, 4]} />
        </mesh>
        <mesh position={[0, 9.4, 0]} material={shared.mats.gold}>
          <cylinderGeometry args={[0.08, 0.22, 0.9, 8]} />
        </mesh>
      </group>

      {/* 3 Grand Vermilion Torii Gates (East, West, South at r = 27.5m) */}
      {SAKURA_TORII_SITES.map((site, index) => (
        <group key={`sunny-torii-${index}`} position={[site.x, 0, site.z]} rotation={[0, site.yaw, 0]}>
          <mesh geometry={shared.geos.toriiBase} material={shared.mats.warmStone} position={[-2.2, 0.28, 0]} />
          <mesh geometry={shared.geos.toriiBase} material={shared.mats.warmStone} position={[2.2, 0.28, 0]} />
          <mesh geometry={shared.geos.toriiPost} material={shared.mats.toriiRed} position={[-2.2, 2.8, 0]} castShadow />
          <mesh geometry={shared.geos.toriiPost} material={shared.mats.toriiRed} position={[2.2, 2.8, 0]} castShadow />
          <mesh geometry={shared.geos.toriiTop} material={shared.mats.toriiRed} position={[0, 5.45, 0]} castShadow />
          <mesh geometry={shared.geos.toriiCap} material={shared.mats.toriiDark} position={[0, 5.76, 0]} />
          <mesh geometry={shared.geos.toriiBar} material={shared.mats.toriiRed} position={[0, 4.55, 0]} />
          <mesh position={[0, 5.0, 0]} material={shared.mats.gold}>
            <boxGeometry args={[0.72, 0.85, 0.18]} />
          </mesh>
        </group>
      ))}

      {/* 24 Thick, Multi-Tiered Cherry Blossom Trees (r = 26.8..34.0m) */}
      <instancedMesh ref={thickTrunksRef} args={[shared.geos.thickTrunk, shared.mats.bark, SUNNY_TREE_COUNT]} castShadow frustumCulled={false} />
      <instancedMesh ref={thickBranchesRef} args={[shared.geos.thickBranch, shared.mats.bark, SUNNY_TREE_COUNT * 3]} frustumCulled={false} />
      <instancedMesh ref={denseCanopyLightRef} args={[shared.geos.canopyPuff, shared.mats.blossomLight, SUNNY_TREE_COUNT * 4]} castShadow frustumCulled={false} />
      <instancedMesh ref={denseCanopyDeepRef} args={[shared.geos.canopyPuff, shared.mats.blossomDeep, SUNNY_TREE_COUNT * 3]} frustumCulled={false} />
      <instancedMesh ref={denseCanopyCreamRef} args={[shared.geos.canopyPuff, shared.mats.blossomCream, SUNNY_TREE_COUNT * 2]} frustumCulled={false} />

      {/* 12 Sunlit Stone Lanterns (Tōrō) along the perimeter */}
      <instancedMesh ref={lanternFeetRef} args={[shared.geos.lanternFoot, shared.mats.mossStone, SUNNY_LANTERN_COUNT]} />
      <instancedMesh ref={lanternShaftsRef} args={[shared.geos.lanternShaft, shared.mats.warmStone, SUNNY_LANTERN_COUNT]} />
      <instancedMesh ref={lanternBoxesRef} args={[shared.geos.lanternBox, shared.mats.lanternPaper, SUNNY_LANTERN_COUNT]} />
      <instancedMesh ref={lanternRoofsRef} args={[shared.geos.lanternRoof, shared.mats.mossStone, SUNNY_LANTERN_COUNT]} />

      {/* 4 Sakura-Draped Inner Pillars (strictly aligned to ARENA.PILLARS colliders!) */}
      {ARENA.PILLARS.map((pillar, index) => (
        <group key={`sunny-inner-pillar-${index}`} position={[pillar.x, 0, pillar.z]}>
          <mesh geometry={shared.geos.innerPillarBase} material={shared.mats.mossStone} position={[0, 0.42, 0]} castShadow receiveShadow />
          <mesh geometry={shared.geos.innerPillarShaft} material={shared.mats.warmStone} position={[0, 3.25, 0]} castShadow receiveShadow />
          <mesh geometry={shared.geos.innerRopeBand} material={shared.mats.toriiRed} position={[0, 4.8, 0]} rotation={[Math.PI / 2, 0, 0]} />
          <mesh
            geometry={shared.geos.canopyPuff}
            material={shared.mats.blossomLight}
            position={[0.3, 6.2, -0.2]}
            scale={[0.88, 0.54, 0.84]}
            castShadow
          />
          <mesh
            geometry={shared.geos.canopyPuff}
            material={shared.mats.blossomDeep}
            position={[-0.65, 5.95, 0.45]}
            scale={[0.7, 0.46, 0.7]}
          />
        </group>
      ))}
    </group>
  );
});

export const ArenaMapStructures = memo(function ArenaMapStructures({ mapKind }: ArenaMapStructuresProps) {
  if (mapKind === "sunlit_colosseum") return <SunlitColosseumProps />;
  if (mapKind === "moonlit_sakura") return <MoonlitSakuraStructures />;
  if (mapKind === "aurora_sanctuary") return <AuroraSanctuaryStructures />;
  if (mapKind === "sunny_sakura") return <SunnySakuraStructures />;
  return null;
});
