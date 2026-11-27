import { memo, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { ARENA, type ArenaMapKind } from "@sekiroslop/shared";

interface OuterValleyTerrainProps {
  mapKind: ArenaMapKind;
}

const ANGULAR_SEGMENTS = 72;
const RADIAL_RINGS = 18;
const INNER_R = ARENA.WALL_RADIUS + 0.4; // 26.6m
const OUTER_R = 121.0;

function sampleHeight(r: number, theta: number, mapKind: ArenaMapKind): number {
  // Keep r <= 36.5 flat at y = -0.1 so all outer props, gazebos, bell tower & trees sit solidly on the ground
  const t = THREE.MathUtils.clamp((r - 36.5) / (OUTER_R - 36.5), 0, 1);
  if (t <= 0) {
    return -0.1;
  }

  const ridgeWave =
    Math.sin(theta * 5 + 0.4) * 0.45 +
    Math.cos(theta * 9 - 1.1) * 0.3 +
    Math.sin(theta * 14 + r * 0.08) * 0.25;
  const peakNoise = 0.55 + 0.45 * Math.sin(theta * 3 + r * 0.045) * Math.cos(theta * 7 - 0.7);

  if (mapKind === "moonlit_sakura") {
    // Sweeping Ashina mountain valley & misty ridges
    const valleyRise = Math.pow(t, 1.45) * 38.0;
    const slopes = (ridgeWave * 0.5 + 0.5) * (4.0 + t * 14.0);
    return -0.12 + valleyRise * peakNoise + slopes * t;
  }

  if (mapKind === "aurora_sanctuary") {
    // Sculpted terraced crystal-canyon ridges
    const rawRise = Math.pow(t, 1.35) * 40.0;
    const terraced = Math.floor(rawRise / 6.5) * 6.5 + (rawRise % 6.5) * 0.45;
    const crags =
      Math.abs(Math.sin(theta * 4 + 0.7)) * (5.0 + t * 14.0) +
      Math.cos(theta * 9) * 2.5 * t;
    return -0.12 + terraced * peakNoise + crags * t;
  }

  if (mapKind === "sunny_sakura") {
    // Gentle lush spring foothills: soft meadow swells rising into low rounded green hills
    const footRise = Math.pow(t, 1.8) * 24.0;
    const swells = (ridgeWave * 0.5 + 0.5) * (2.2 + t * 7.5);
    const meadowUndulation = Math.sin(theta * 6 + r * 0.11) * 0.6 * t;
    return -0.12 + footRise * (0.7 + 0.3 * peakNoise) + swells * t + meadowUndulation;
  }

  // Sunlit Colosseum: rolling Roman hills & distant limestone mountains
  const hillRise = Math.pow(t, 1.55) * 32.0;
  const rolling = (ridgeWave * 0.5 + 0.5) * (3.5 + t * 11.0);
  return -0.12 + hillRise * peakNoise + rolling * t;
}

const VALLEY_PALETTES: Record<
  ArenaMapKind,
  { floor: string; slope: string; peak: string; boulder: string; foliage: string }
> = {
  sunlit_colosseum: {
    floor: "#8f7a56",
    slope: "#5e6b44",
    peak: "#9d907b",
    boulder: "#8a7e6d",
    foliage: "#3f5a32",
  },
  moonlit_sakura: {
    floor: "#2c3d35",
    slope: "#1f2e38",
    peak: "#465568",
    boulder: "#333d47",
    foliage: "#21382d",
  },
  aurora_sanctuary: {
    floor: "#13293d",
    slope: "#1e4b5c",
    peak: "#3e3a6e",
    boulder: "#254e63",
    foliage: "#1a3d4a",
  },
  sunny_sakura: {
    floor: "#5b7d42",
    slope: "#4b6e3c",
    peak: "#758f65",
    boulder: "#7e8074",
    foliage: "#ff9ec9",
  },
};

export const OuterValleyTerrain = memo(function OuterValleyTerrain({ mapKind }: OuterValleyTerrainProps) {
  const palette = VALLEY_PALETTES[mapKind] ?? VALLEY_PALETTES.sunlit_colosseum;

  const terrainGeo = useMemo(() => {
    const verts: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];

    const cFloor = new THREE.Color(palette.floor);
    const cSlope = new THREE.Color(palette.slope);
    const cPeak = new THREE.Color(palette.peak);
    const tmp = new THREE.Color();

    for (let ring = 0; ring <= RADIAL_RINGS; ring++) {
      const u = ring / RADIAL_RINGS;
      // Non-linear radial spacing: denser near arena rim, wider in distant mountains
      const r = INNER_R + Math.pow(u, 1.35) * (OUTER_R - INNER_R);

      for (let seg = 0; seg <= ANGULAR_SEGMENTS; seg++) {
        const theta = (seg / ANGULAR_SEGMENTS) * Math.PI * 2;
        const x = Math.sin(theta) * r;
        const z = Math.cos(theta) * r;
        const y = sampleHeight(r, theta, mapKind);
        verts.push(x, y, z);

        if (u < 0.28) {
          tmp.copy(cFloor).lerp(cSlope, u / 0.28);
        } else {
          tmp.copy(cSlope).lerp(cPeak, Math.min(1, (u - 0.28) / 0.65));
        }
        colors.push(tmp.r, tmp.g, tmp.b);
      }
    }

    const rowStride = ANGULAR_SEGMENTS + 1;
    for (let ring = 0; ring < RADIAL_RINGS; ring++) {
      for (let seg = 0; seg < ANGULAR_SEGMENTS; seg++) {
        const a = ring * rowStride + seg;
        const b = a + 1;
        const c = (ring + 1) * rowStride + seg;
        const d = c + 1;
        indices.push(a, c, b);
        indices.push(b, c, d);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    return geo;
  }, [mapKind, palette.floor, palette.slope, palette.peak]);

  const terrainRef = useRef<THREE.Mesh>(null);
  const boulderRef = useRef<THREE.InstancedMesh>(null);
  const treeRef = useRef<THREE.InstancedMesh>(null);

  const boulderGeo = useMemo(() => new THREE.DodecahedronGeometry(1.0, 0), []);
  const treeGeo = useMemo(() => new THREE.ConeGeometry(1.0, 2.6, 6), []);

  useEffect(() => {
    const dummy = new THREE.Object3D();
    if (boulderRef.current) {
      for (let i = 0; i < 36; i++) {
        const theta = (i / 36) * Math.PI * 2 + (i % 3) * 0.09;
        const r = 42 + (i % 5) * 11;
        const y = sampleHeight(r, theta, mapKind);
        const s = 2.2 + (i % 4) * 1.1;
        dummy.position.set(Math.sin(theta) * r, y + s * 0.35, Math.cos(theta) * r);
        dummy.rotation.set((i % 3) * 0.3, theta, (i % 2) * 0.25);
        dummy.scale.set(s * 1.25, s * 0.85, s);
        dummy.updateMatrix();
        boulderRef.current.setMatrixAt(i, dummy.matrix);
      }
      boulderRef.current.instanceMatrix.needsUpdate = true;
      boulderRef.current.computeBoundingSphere();
    }

    if (treeRef.current) {
      for (let i = 0; i < 42; i++) {
        const theta = (i / 42) * Math.PI * 2 + 0.04;
        const r = 38 + (i % 4) * 9.5;
        const y = sampleHeight(r, theta, mapKind);
        const s = 1.6 + (i % 3) * 0.7;
        dummy.position.set(Math.sin(theta) * r, y + s * 1.15, Math.cos(theta) * r);
        dummy.rotation.set(0, theta, 0);
        dummy.scale.set(s * 0.75, s * (mapKind === "sunlit_colosseum" ? 1.4 : 1.15), s * 0.75);
        dummy.updateMatrix();
        treeRef.current.setMatrixAt(i, dummy.matrix);
      }
      treeRef.current.instanceMatrix.needsUpdate = true;
      treeRef.current.computeBoundingSphere();
    }

    for (const object of [terrainRef.current, boulderRef.current, treeRef.current]) {
      if (!object) continue;
      object.updateMatrix();
      object.matrixAutoUpdate = false;
      object.updateMatrixWorld(true);
    }
  }, [mapKind]);

  useEffect(() => {
    return () => {
      terrainGeo.dispose();
    };
  }, [terrainGeo]);

  useEffect(() => {
    return () => {
      boulderGeo.dispose();
      treeGeo.dispose();
    };
  }, [boulderGeo, treeGeo]);

  return (
    <group userData={{ cameraCollisionIgnore: true }}>
      <mesh ref={terrainRef} geometry={terrainGeo} receiveShadow frustumCulled={false}>
        <meshStandardMaterial vertexColors roughness={0.94} metalness={0.04} />
      </mesh>
      <instancedMesh ref={boulderRef} args={[boulderGeo, undefined, 36]} frustumCulled={false}>
        <meshStandardMaterial color={palette.boulder} roughness={0.92} />
      </instancedMesh>
      <instancedMesh ref={treeRef} args={[treeGeo, undefined, 42]} frustumCulled={false}>
        <meshStandardMaterial
          color={palette.foliage}
          roughness={0.88}
        />
      </instancedMesh>
    </group>
  );
});
