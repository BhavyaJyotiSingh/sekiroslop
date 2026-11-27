import { memo, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { ARENA, ARENA_MAPS, type ArenaMapKind } from "@sekiroslop/shared";

interface ArenaAtmosphereVFXProps {
  mapKind: ArenaMapKind;
  particleScale: number;
}

const DUST_COUNT = 240;
const BRAZIER_EMBER_COUNT = 120;
const PETAL_COUNT = 320;
const FIREFLY_COUNT = 75;
const MIST_COUNT = 14;
const AURORA_WISP_BASE = 70;
const AURORA_PILLAR_COUNT = 10;

function seeded(seed: number): number {
  const v = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return v - Math.floor(v);
}

function createSoftGlowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.35, "rgba(255,255,255,0.68)");
    g.addColorStop(0.75, "rgba(255,255,255,0.16)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function createMistTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(64, 64, 6, 64, 64, 62);
    g.addColorStop(0, "rgba(255,255,255,0.55)");
    g.addColorStop(0.5, "rgba(255,255,255,0.22)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function createPetalGeometry(): THREE.BufferGeometry {
  // Curved diamond-like sakura petal silhouette (2 triangles, ultra-cheap)
  const positions = new Float32Array([
    0, 0, -0.14,
    0.095, 0.025, 0.0,
    0, 0.01, 0.14,
    -0.095, 0.025, 0.0,
  ]);
  const indices = [0, 1, 2, 0, 2, 3];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

const SunlitAtmosphere = memo(function SunlitAtmosphere({
  glowTex,
  particleScale,
}: {
  glowTex: THREE.CanvasTexture;
  particleScale: number;
}) {
  const dustRef = useRef<THREE.Points>(null);
  const emberRef = useRef<THREE.Points>(null);
  const shaftsRef = useRef<THREE.InstancedMesh>(null);
  const dustCount = Math.max(1, Math.round(DUST_COUNT * particleScale));

  const { dustGeo, dustMat, emberGeo, emberMat, shaftGeo, shaftMat } = useMemo(() => {
    // 1. Drifting sunlit dust motes
    const dGeo = new THREE.BufferGeometry();
    const dPos = new Float32Array(dustCount * 3);
    const dCol = new Float32Array(dustCount * 3);
    const dMeta = new Float32Array(dustCount * 4);
    const cGold = new THREE.Color("#ffe5a3");
    const cCream = new THREE.Color("#fff5d6");
    const tmp = new THREE.Color();

    for (let i = 0; i < dustCount; i++) {
      const a = seeded(i + 11) * Math.PI * 2;
      const r = 2 + seeded(i + 113) * 24;
      dPos[i * 3] = Math.cos(a) * r;
      dPos[i * 3 + 1] = 0.5 + seeded(i + 211) * 14;
      dPos[i * 3 + 2] = Math.sin(a) * r;
      dMeta[i * 4] = (seeded(i + 311) - 0.5) * 0.45;
      dMeta[i * 4 + 1] = 0.08 + seeded(i + 411) * 0.22;
      dMeta[i * 4 + 2] = (seeded(i + 511) - 0.5) * 0.45;
      dMeta[i * 4 + 3] = seeded(i + 611) * Math.PI * 2;
      tmp.copy(i % 2 === 0 ? cGold : cCream).multiplyScalar(0.75 + seeded(i + 711) * 0.45);
      dCol[i * 3] = tmp.r;
      dCol[i * 3 + 1] = tmp.g;
      dCol[i * 3 + 2] = tmp.b;
    }
    dGeo.setAttribute("position", new THREE.BufferAttribute(dPos, 3));
    dGeo.setAttribute("color", new THREE.BufferAttribute(dCol, 3));
    dGeo.userData.meta = dMeta;

    const dMat = new THREE.PointsMaterial({
      size: 0.24,
      map: glowTex,
      vertexColors: true,
      transparent: true,
      opacity: 0.72,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
      toneMapped: false,
    });

    // 2. Rising embers from the 8 perimeter bronze braziers
    const eGeo = new THREE.BufferGeometry();
    const ePos = new Float32Array(BRAZIER_EMBER_COUNT * 3);
    const eCol = new Float32Array(BRAZIER_EMBER_COUNT * 3);
    const eMeta = new Float32Array(BRAZIER_EMBER_COUNT * 4);
    const cOrange = new THREE.Color("#ff7b24");
    const cBright = new THREE.Color("#ffd86b");

    for (let i = 0; i < BRAZIER_EMBER_COUNT; i++) {
      const brazierIdx = i % 8;
      const bAngle = (brazierIdx / 8) * Math.PI * 2 + Math.PI / 8;
      const rb = ARENA.WALL_RADIUS - 0.1;
      const bx = Math.sin(bAngle) * rb;
      const bz = Math.cos(bAngle) * rb;
      ePos[i * 3] = bx + (seeded(i + 901) - 0.5) * 0.7;
      ePos[i * 3 + 1] = 5.4 + seeded(i + 1001) * 7.5;
      ePos[i * 3 + 2] = bz + (seeded(i + 1101) - 0.5) * 0.7;
      eMeta[i * 4] = bx;
      eMeta[i * 4 + 1] = 0.8 + seeded(i + 1201) * 1.3;
      eMeta[i * 4 + 2] = bz;
      eMeta[i * 4 + 3] = seeded(i + 1301) * Math.PI * 2;
      tmp.copy(i % 3 === 0 ? cBright : cOrange).multiplyScalar(0.95 + seeded(i + 1401) * 0.5);
      eCol[i * 3] = tmp.r;
      eCol[i * 3 + 1] = tmp.g;
      eCol[i * 3 + 2] = tmp.b;
    }
    eGeo.setAttribute("position", new THREE.BufferAttribute(ePos, 3));
    eGeo.setAttribute("color", new THREE.BufferAttribute(eCol, 3));
    eGeo.userData.meta = eMeta;

    const eMat = new THREE.PointsMaterial({
      size: 0.22,
      map: glowTex,
      vertexColors: true,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
      toneMapped: false,
    });

    // 3. Angled volumetric-style golden light shafts (single InstancedMesh + Fresnel/smoothstep shader)
    const sGeo = new THREE.ConeGeometry(4.4, 28, 16, 1, true);
    const sMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color("#ffd891") },
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vViewDir;

        void main() {
          vUv = uv;
          vec4 localPos = vec4(position, 1.0);
          vec3 transformedNormal = normal;
          #ifdef USE_INSTANCING
            localPos = instanceMatrix * localPos;
            transformedNormal = mat3(instanceMatrix) * transformedNormal;
          #endif
          vec4 mvPosition = modelViewMatrix * localPos;
          vNormal = normalize(normalMatrix * transformedNormal);
          vViewDir = normalize(-mvPosition.xyz);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uColor;
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vViewDir;

        void main() {
          float fresnel = abs(dot(normalize(vNormal), normalize(vViewDir)));
          float edgeFalloff = pow(fresnel, 1.6);
          float verticalFade = smoothstep(0.0, 0.25, vUv.y) * (1.0 - smoothstep(0.72, 1.0, vUv.y));
          float shimmer = 0.85 + 0.15 * sin(uTime * 0.55 + vUv.x * 6.28318);
          float alpha = edgeFalloff * verticalFade * shimmer * 0.095;
          gl_FragColor = vec4(uColor, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    });

    return { dustGeo: dGeo, dustMat: dMat, emberGeo: eGeo, emberMat: eMat, shaftGeo: sGeo, shaftMat: sMat };
  }, [glowTex, dustCount]);

  useEffect(() => () => {
    dustGeo.dispose();
    dustMat.dispose();
    emberGeo.dispose();
    emberMat.dispose();
    shaftGeo.dispose();
    shaftMat.dispose();
  }, [dustGeo, dustMat, emberGeo, emberMat, shaftGeo, shaftMat]);

  const shaftSpecs = useMemo(
    () => [
      { pos: [14, 13.5, -10] as [number, number, number], rot: [0.34, 0.15, 0.42] as [number, number, number], scale: 1.1 },
      { pos: [4, 14.0, -14] as [number, number, number], rot: [0.36, 0.12, 0.4] as [number, number, number], scale: 0.95 },
      { pos: [17, 13.2, 4] as [number, number, number], rot: [0.32, 0.18, 0.44] as [number, number, number], scale: 1.0 },
      { pos: [-7, 14.2, -9] as [number, number, number], rot: [0.35, 0.1, 0.39] as [number, number, number], scale: 0.88 },
      { pos: [9, 13.8, 12] as [number, number, number], rot: [0.33, 0.14, 0.41] as [number, number, number], scale: 1.05 },
    ],
    []
  );

  useEffect(() => {
    const mesh = shaftsRef.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    for (let i = 0; i < shaftSpecs.length; i++) {
      const s = shaftSpecs[i];
      dummy.position.set(s.pos[0], s.pos[1], s.pos[2]);
      dummy.rotation.set(s.rot[0], s.rot[1], s.rot[2]);
      dummy.scale.setScalar(s.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [shaftSpecs]);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    const t = state.clock.elapsedTime;

    const dPos = dustGeo.getAttribute("position") as THREE.BufferAttribute;
    const dMeta = dustGeo.userData.meta as Float32Array;
    const dv = dPos.array as Float32Array;
    for (let i = 0; i < dustCount; i++) {
      const o = i * 3;
      const m = i * 4;
      dv[o] += (dMeta[m] + Math.sin(t * 0.55 + dMeta[m + 3]) * 0.18) * dt;
      dv[o + 1] += dMeta[m + 1] * dt;
      dv[o + 2] += (dMeta[m + 2] + Math.cos(t * 0.48 + dMeta[m + 3]) * 0.18) * dt;
      if (dv[o + 1] > 15.5) {
        dv[o + 1] = 0.4;
        const a = dMeta[m + 3] + t * 0.1;
        const r = 2 + ((i * 29) % 240) / 10;
        dv[o] = Math.cos(a) * r;
        dv[o + 2] = Math.sin(a) * r;
      }
    }
    dPos.needsUpdate = true;

    const ePos = emberGeo.getAttribute("position") as THREE.BufferAttribute;
    const eMeta = emberGeo.userData.meta as Float32Array;
    const ev = ePos.array as Float32Array;
    for (let i = 0; i < BRAZIER_EMBER_COUNT; i++) {
      const o = i * 3;
      const m = i * 4;
      ev[o] += Math.sin(t * 2.2 + eMeta[m + 3]) * 0.45 * dt;
      ev[o + 1] += eMeta[m + 1] * dt;
      ev[o + 2] += Math.cos(t * 1.9 + eMeta[m + 3]) * 0.45 * dt;
      if (ev[o + 1] > 13.4) {
        ev[o] = eMeta[m] + (Math.sin(t + i) * 0.35);
        ev[o + 1] = 5.35;
        ev[o + 2] = eMeta[m + 2] + (Math.cos(t + i) * 0.35);
      }
    }
    ePos.needsUpdate = true;

    shaftMat.uniforms.uTime.value = t;
  });

  return (
    <group>
      <points ref={dustRef} geometry={dustGeo} material={dustMat} frustumCulled={false} />
      <points ref={emberRef} geometry={emberGeo} material={emberMat} frustumCulled={false} />
      <instancedMesh ref={shaftsRef} args={[shaftGeo, shaftMat, 5]} frustumCulled={false} />
    </group>
  );
});

const SakuraAtmosphere = memo(function SakuraAtmosphere({
  glowTex,
  mistTex,
  particleScale,
}: {
  glowTex: THREE.CanvasTexture;
  mistTex: THREE.CanvasTexture;
  particleScale: number;
}) {
  const petalsRef = useRef<THREE.InstancedMesh>(null);
  const fireflyRef = useRef<THREE.Points>(null);
  const mistRef = useRef<THREE.InstancedMesh>(null);
  const bonfireEmberRef = useRef<THREE.Points>(null);
  const petalCount = Math.max(1, Math.round(PETAL_COUNT * particleScale));
  const bonfireEmberCount = Math.max(12, Math.round(32 * particleScale));

  const dummy = useMemo(() => new THREE.Object3D(), []);

  const {
    petalGeo,
    petalMat,
    petalData,
    fireflyGeo,
    fireflyMat,
    mistGeo,
    mistMat,
    mistData,
    bonfireEmberGeo,
    bonfireEmberMat,
  } = useMemo(() => {
    const pGeo = createPetalGeometry();
    const pMat = new THREE.MeshBasicMaterial({
      color: "#ffffff",
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });

    // Per-petal state: x, y, z, fallSpeed, swayPhase, tumbleSpeed, scale
    const pData = new Float32Array(petalCount * 7);
    for (let i = 0; i < petalCount; i++) {
      const a = seeded(i + 31) * Math.PI * 2;
      const r = 1.5 + seeded(i + 131) * 28.5;
      pData[i * 7 + 0] = Math.cos(a) * r;
      pData[i * 7 + 1] = 0.3 + seeded(i + 231) * 15.5;
      pData[i * 7 + 2] = Math.sin(a) * r;
      pData[i * 7 + 3] = 0.65 + seeded(i + 331) * 0.95;
      pData[i * 7 + 4] = seeded(i + 431) * Math.PI * 2;
      pData[i * 7 + 5] = 1.4 + seeded(i + 531) * 2.4;
      pData[i * 7 + 6] = 0.75 + seeded(i + 631) * 0.75;
    }

    // Golden fireflies
    const fGeo = new THREE.BufferGeometry();
    const fPos = new Float32Array(FIREFLY_COUNT * 3);
    const fCol = new Float32Array(FIREFLY_COUNT * 3);
    const fMeta = new Float32Array(FIREFLY_COUNT * 4);
    const cAmber = new THREE.Color("#ffd166");
    const cWarm = new THREE.Color("#ffae42");
    const tmp = new THREE.Color();

    for (let i = 0; i < FIREFLY_COUNT; i++) {
      const a = seeded(i + 731) * Math.PI * 2;
      const r = 12 + seeded(i + 831) * 16.5;
      fPos[i * 3] = Math.cos(a) * r;
      fPos[i * 3 + 1] = 0.8 + seeded(i + 931) * 5.2;
      fPos[i * 3 + 2] = Math.sin(a) * r;
      fMeta[i * 4] = a;
      fMeta[i * 4 + 1] = r;
      fMeta[i * 4 + 2] = fPos[i * 3 + 1];
      fMeta[i * 4 + 3] = seeded(i + 1031) * Math.PI * 2;
      tmp.copy(i % 2 === 0 ? cAmber : cWarm);
      fCol[i * 3] = tmp.r;
      fCol[i * 3 + 1] = tmp.g;
      fCol[i * 3 + 2] = tmp.b;
    }
    fGeo.setAttribute("position", new THREE.BufferAttribute(fPos, 3));
    fGeo.setAttribute("color", new THREE.BufferAttribute(fCol, 3));
    fGeo.userData.meta = fMeta;

    const fMat = new THREE.PointsMaterial({
      size: 0.34,
      map: glowTex,
      vertexColors: true,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
      toneMapped: false,
    });

    // Low-lying nocturnal mist wisps
    const mGeo = new THREE.PlaneGeometry(14, 14);
    const mMat = new THREE.MeshBasicMaterial({
      map: mistTex,
      color: "#8ea8e6",
      transparent: true,
      opacity: 0.14,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mData = new Float32Array(MIST_COUNT * 4);
    for (let i = 0; i < MIST_COUNT; i++) {
      mData[i * 4 + 0] = (i / MIST_COUNT) * Math.PI * 2;
      mData[i * 4 + 1] = 19 + seeded(i + 1501) * 9.5;
      mData[i * 4 + 2] = 0.35 + seeded(i + 1601) * 1.1;
      mData[i * 4 + 3] = (seeded(i + 1701) > 0.5 ? 1 : -1) * (0.025 + seeded(i + 1801) * 0.03);
    }

    // Rising embers from the two ceremonial bonfires ([-16.5, 0.6, 17.5] and [16.5, 0.6, 17.5])
    const bGeo = new THREE.BufferGeometry();
    const bPos = new Float32Array(bonfireEmberCount * 3);
    const bCol = new Float32Array(bonfireEmberCount * 3);
    const bMeta = new Float32Array(bonfireEmberCount * 4);
    const cEmberOrange = new THREE.Color("#ff7b24");
    const cEmberGold = new THREE.Color("#ffd86b");

    for (let i = 0; i < bonfireEmberCount; i++) {
      const bx = i % 2 === 0 ? -16.5 : 16.5;
      const bz = 17.5;
      bPos[i * 3] = bx + (seeded(i + 2001) - 0.5) * 0.8;
      bPos[i * 3 + 1] = 0.6 + seeded(i + 2101) * 5.2;
      bPos[i * 3 + 2] = bz + (seeded(i + 2201) - 0.5) * 0.8;
      bMeta[i * 4] = bx;
      bMeta[i * 4 + 1] = 0.75 + seeded(i + 2301) * 0.95;
      bMeta[i * 4 + 2] = bz;
      bMeta[i * 4 + 3] = seeded(i + 2401) * Math.PI * 2;
      tmp.copy(i % 3 === 0 ? cEmberGold : cEmberOrange).multiplyScalar(0.9 + seeded(i + 2501) * 0.45);
      bCol[i * 3] = tmp.r;
      bCol[i * 3 + 1] = tmp.g;
      bCol[i * 3 + 2] = tmp.b;
    }
    bGeo.setAttribute("position", new THREE.BufferAttribute(bPos, 3));
    bGeo.setAttribute("color", new THREE.BufferAttribute(bCol, 3));
    bGeo.userData.meta = bMeta;

    const bMat = new THREE.PointsMaterial({
      size: 0.2,
      map: glowTex,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
      toneMapped: false,
    });

    return {
      petalGeo: pGeo,
      petalMat: pMat,
      petalData: pData,
      fireflyGeo: fGeo,
      fireflyMat: fMat,
      mistGeo: mGeo,
      mistMat: mMat,
      mistData: mData,
      bonfireEmberGeo: bGeo,
      bonfireEmberMat: bMat,
    };
  }, [glowTex, mistTex, petalCount, bonfireEmberCount]);

  // Assign varied pastel sakura colors to petal instances
  useEffect(() => {
    const mesh = petalsRef.current;
    if (!mesh) return;
    const palette = [
      new THREE.Color("#ffb7dc"),
      new THREE.Color("#ff8ec9"),
      new THREE.Color("#ffe3f1"),
      new THREE.Color("#f56ab2"),
    ];
    for (let i = 0; i < petalCount; i++) {
      mesh.setColorAt(i, palette[i % palette.length]);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [petalCount]);

  useEffect(() => () => {
    petalGeo.dispose();
    petalMat.dispose();
    fireflyGeo.dispose();
    fireflyMat.dispose();
    mistGeo.dispose();
    mistMat.dispose();
    bonfireEmberGeo.dispose();
    bonfireEmberMat.dispose();
  }, [petalGeo, petalMat, fireflyGeo, fireflyMat, mistGeo, mistMat, bonfireEmberGeo, bonfireEmberMat]);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    const t = state.clock.elapsedTime;

    // Swirling tumbling sakura petals
    const petals = petalsRef.current;
    if (petals) {
      const windX = Math.sin(t * 0.35) * 1.35 + 0.9;
      const windZ = Math.cos(t * 0.28) * 1.05 + 0.45;
      for (let i = 0; i < petalCount; i++) {
        const b = i * 7;
        const phase = petalData[b + 4];
        const tumble = petalData[b + 5];
        const sc = petalData[b + 6];

        petalData[b + 0] += (windX + Math.sin(t * 1.4 + phase) * 0.85) * dt;
        petalData[b + 1] -= petalData[b + 3] * dt;
        petalData[b + 2] += (windZ + Math.cos(t * 1.2 + phase) * 0.85) * dt;

        if (petalData[b + 1] < 0.05) {
          const a = phase + t * 0.15;
          const r = 2 + ((i * 41) % 280) / 10;
          petalData[b + 0] = Math.cos(a) * r;
          petalData[b + 1] = 15.6;
          petalData[b + 2] = Math.sin(a) * r;
        }
        // Keep within outer courtyard radius
        const distSq = petalData[b + 0] * petalData[b + 0] + petalData[b + 2] * petalData[b + 2];
        if (distSq > 33 * 33) {
          petalData[b + 0] *= -0.75;
          petalData[b + 2] *= -0.75;
        }

        dummy.position.set(petalData[b + 0], petalData[b + 1], petalData[b + 2]);
        dummy.rotation.set(
          t * tumble + phase,
          t * (tumble * 0.7) + phase * 1.5,
          Math.sin(t * 2.1 + phase) * 0.9
        );
        dummy.scale.setScalar(sc);
        dummy.updateMatrix();
        petals.setMatrixAt(i, dummy.matrix);
      }
      petals.instanceMatrix.needsUpdate = true;
    }

    // Bobbing golden fireflies
    const fPos = fireflyGeo.getAttribute("position") as THREE.BufferAttribute;
    const fMeta = fireflyGeo.userData.meta as Float32Array;
    const fv = fPos.array as Float32Array;
    for (let i = 0; i < FIREFLY_COUNT; i++) {
      const o = i * 3;
      const m = i * 4;
      const a = fMeta[m] + Math.sin(t * 0.25 + fMeta[m + 3]) * 0.12;
      const r = fMeta[m + 1] + Math.cos(t * 0.4 + fMeta[m + 3]) * 1.2;
      fv[o] = Math.cos(a) * r;
      fv[o + 1] = fMeta[m + 2] + Math.sin(t * 1.35 + fMeta[m + 3]) * 0.55;
      fv[o + 2] = Math.sin(a) * r;
    }
    fPos.needsUpdate = true;
    fireflyMat.opacity = 0.72 + Math.sin(t * 2.4) * 0.2;

    // Drifting low nocturnal mist wisps
    const mist = mistRef.current;
    if (mist) {
      for (let i = 0; i < MIST_COUNT; i++) {
        const m = i * 4;
        const a = mistData[m + 0] + t * mistData[m + 3];
        const r = mistData[m + 1];
        dummy.position.set(Math.cos(a) * r, mistData[m + 2], Math.sin(a) * r);
        dummy.rotation.set(-Math.PI / 2, 0, a * 0.6 + t * 0.05);
        dummy.scale.set(1.15, 1.15, 1);
        dummy.updateMatrix();
        mist.setMatrixAt(i, dummy.matrix);
      }
      mist.instanceMatrix.needsUpdate = true;
    }

    // Rising bonfire embers
    const bPos = bonfireEmberGeo.getAttribute("position") as THREE.BufferAttribute;
    const bMeta = bonfireEmberGeo.userData.meta as Float32Array;
    const bv = bPos.array as Float32Array;
    for (let i = 0; i < bonfireEmberCount; i++) {
      const o = i * 3;
      const m = i * 4;
      bv[o] += Math.sin(t * 2.0 + bMeta[m + 3]) * 0.35 * dt;
      bv[o + 1] += bMeta[m + 1] * dt;
      bv[o + 2] += Math.cos(t * 1.8 + bMeta[m + 3]) * 0.35 * dt;
      if (bv[o + 1] > 6.4) {
        bv[o] = bMeta[m] + Math.sin(t + i) * 0.35;
        bv[o + 1] = 0.6;
        bv[o + 2] = bMeta[m + 2] + Math.cos(t + i) * 0.35;
      }
    }
    bPos.needsUpdate = true;
  });

  return (
    <group>
      <instancedMesh ref={petalsRef} args={[petalGeo, petalMat, petalCount]} frustumCulled={false} />
      <points ref={fireflyRef} geometry={fireflyGeo} material={fireflyMat} frustumCulled={false} />
      <points ref={bonfireEmberRef} geometry={bonfireEmberGeo} material={bonfireEmberMat} frustumCulled={false} />
      <instancedMesh ref={mistRef} args={[mistGeo, mistMat, MIST_COUNT]} frustumCulled={false} />
    </group>
  );
});

const AURORA_WISP_HEX = ["#22d3ee", "#34d399", "#f472b6", "#fde047"] as const;
const AURORA_PILLAR_HEX = ["#22d3ee", "#34d399", "#f472b6", "#fbbf24"] as const;

const AuroraAtmosphere = memo(function AuroraAtmosphere({
  glowTex,
  particleScale,
}: {
  glowTex: THREE.CanvasTexture;
  particleScale: number;
}) {
  const wispRef = useRef<THREE.Points>(null);
  const pillarsRef = useRef<THREE.InstancedMesh>(null);
  const outerRingRef = useRef<THREE.Mesh>(null);
  const innerRingRef = useRef<THREE.Mesh>(null);
  const wispCount = Math.max(24, Math.round(AURORA_WISP_BASE * particleScale));

  const {
    wispGeo,
    wispMat,
    pillarGeo,
    pillarMat,
    outerRingGeo,
    outerRingMat,
    innerRingGeo,
    innerRingMat,
  } = useMemo(() => {
    // 1. Multi-color drifting aurora spirit wisps
    const wGeo = new THREE.BufferGeometry();
    const wPos = new Float32Array(wispCount * 3);
    const wCol = new Float32Array(wispCount * 3);
    // meta: [angle, radius, ySpeed, angularSpeedAndPhase]
    const wMeta = new Float32Array(wispCount * 4);
    const palette = AURORA_WISP_HEX.map((hex) => new THREE.Color(hex));
    const tmp = new THREE.Color();

    for (let i = 0; i < wispCount; i++) {
      const angle = seeded(i + 31) * Math.PI * 2;
      const radius = 6 + seeded(i + 137) * 20; // r = 6..26
      const y = 0.5 + seeded(i + 241) * 9.0; // y = 0.5..9.5
      wPos[i * 3] = Math.cos(angle) * radius;
      wPos[i * 3 + 1] = y;
      wPos[i * 3 + 2] = Math.sin(angle) * radius;

      wMeta[i * 4] = angle;
      wMeta[i * 4 + 1] = radius;
      wMeta[i * 4 + 2] = 0.16 + seeded(i + 353) * 0.24; // upward drift speed
      wMeta[i * 4 + 3] = (0.08 + seeded(i + 467) * 0.12) * (i % 2 === 0 ? 1 : -1); // gentle orbit speed

      tmp.copy(palette[i % palette.length]).multiplyScalar(0.85 + seeded(i + 577) * 0.35);
      wCol[i * 3] = tmp.r;
      wCol[i * 3 + 1] = tmp.g;
      wCol[i * 3 + 2] = tmp.b;
    }

    wGeo.setAttribute("position", new THREE.BufferAttribute(wPos, 3));
    wGeo.setAttribute("color", new THREE.BufferAttribute(wCol, 3));
    wGeo.userData.meta = wMeta;

    const wMat = new THREE.PointsMaterial({
      size: 0.34,
      map: glowTex,
      vertexColors: true,
      transparent: true,
      opacity: 0.84,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
      toneMapped: false,
    });

    // 2. 10 Rising Prismatic Light Pillars
    const pGeo = new THREE.CylinderGeometry(0.32, 0.52, 9.0, 10, 1, true);
    const pMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vViewDir;
        varying vec3 vColor;

        void main() {
          vUv = uv;
          vColor = vec3(1.0);
          #ifdef USE_INSTANCING_COLOR
            vColor = instanceColor;
          #endif
          vec4 localPos = vec4(position, 1.0);
          vec3 transformedNormal = normal;
          #ifdef USE_INSTANCING
            localPos = instanceMatrix * localPos;
            transformedNormal = mat3(instanceMatrix) * transformedNormal;
          #endif
          vec4 mvPosition = modelViewMatrix * localPos;
          vNormal = normalize(normalMatrix * transformedNormal);
          vViewDir = normalize(-mvPosition.xyz);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vViewDir;
        varying vec3 vColor;

        void main() {
          float fresnel = abs(dot(normalize(vNormal), normalize(vViewDir)));
          float edgeFalloff = pow(fresnel, 1.35);
          float verticalFade = smoothstep(0.0, 0.18, vUv.y) * (1.0 - smoothstep(0.55, 1.0, vUv.y));
          float pulse = 0.82 + 0.18 * sin(uTime * 1.4 + vUv.x * 6.28318);
          float alpha = edgeFalloff * verticalFade * pulse * 0.24;
          gl_FragColor = vec4(vColor, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    });

    // 3. 2 Counter-Rotating Holographic Floor Astrolabe Rings
    const oGeo = new THREE.RingGeometry(11.6, 11.82, 72);
    const oMat = new THREE.MeshBasicMaterial({
      color: "#22d3ee",
      transparent: true,
      opacity: 0.26,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });

    const iGeo = new THREE.RingGeometry(7.6, 7.78, 64);
    const iMat = new THREE.MeshBasicMaterial({
      color: "#f472b6",
      transparent: true,
      opacity: 0.26,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });

    return {
      wispGeo: wGeo,
      wispMat: wMat,
      pillarGeo: pGeo,
      pillarMat: pMat,
      outerRingGeo: oGeo,
      outerRingMat: oMat,
      innerRingGeo: iGeo,
      innerRingMat: iMat,
    };
  }, [glowTex, wispCount]);

  useEffect(() => () => {
    wispGeo.dispose();
    wispMat.dispose();
    pillarGeo.dispose();
    pillarMat.dispose();
    outerRingGeo.dispose();
    outerRingMat.dispose();
    innerRingGeo.dispose();
    innerRingMat.dispose();
  }, [wispGeo, wispMat, pillarGeo, pillarMat, outerRingGeo, outerRingMat, innerRingGeo, innerRingMat]);

  useEffect(() => {
    const mesh = pillarsRef.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    const radius = ARENA.WALL_RADIUS + 0.75;
    let instanceIdx = 0;

    // 11 evenly spaced slots with slot 5 at angle PI (North Gate gap), leaving 10 pillars
    for (let slot = 0; slot < 11 && instanceIdx < AURORA_PILLAR_COUNT; slot++) {
      if (slot === 5) continue;
      const angle = (slot / 11) * Math.PI * 2 + Math.PI / 11;
      dummy.position.set(Math.sin(angle) * radius, 4.5, Math.cos(angle) * radius);
      dummy.rotation.set(0, -angle, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(instanceIdx, dummy.matrix);

      color.set(AURORA_PILLAR_HEX[instanceIdx % AURORA_PILLAR_HEX.length]);
      mesh.setColorAt(instanceIdx, color);
      instanceIdx++;
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, []);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    const t = state.clock.elapsedTime;

    const wPos = wispGeo.getAttribute("position") as THREE.BufferAttribute;
    const wMeta = wispGeo.userData.meta as Float32Array;
    const wv = wPos.array as Float32Array;

    for (let i = 0; i < wispCount; i++) {
      const o = i * 3;
      const m = i * 4;
      const angle = wMeta[m] + wMeta[m + 3] * dt;
      wMeta[m] = angle;
      const r = wMeta[m + 1] + Math.sin(t * 0.7 + i) * 0.35;
      wv[o] = Math.cos(angle) * r;
      wv[o + 1] += wMeta[m + 2] * dt;
      wv[o + 2] = Math.sin(angle) * r;

      if (wv[o + 1] > 9.5) {
        wv[o + 1] = 0.5;
      }
    }
    wPos.needsUpdate = true;

    pillarMat.uniforms.uTime.value = t;

    if (outerRingRef.current) {
      outerRingRef.current.rotation.z += dt * 0.14;
    }
    if (innerRingRef.current) {
      innerRingRef.current.rotation.z -= dt * 0.19;
    }
  });

  return (
    <group>
      <points ref={wispRef} geometry={wispGeo} material={wispMat} frustumCulled={false} />
      <instancedMesh
        ref={pillarsRef}
        args={[pillarGeo, pillarMat, AURORA_PILLAR_COUNT]}
        frustumCulled={false}
      />
      <mesh
        ref={outerRingRef}
        geometry={outerRingGeo}
        material={outerRingMat}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.022, 0]}
      />
      <mesh
        ref={innerRingRef}
        geometry={innerRingGeo}
        material={innerRingMat}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.022, 0]}
      />
    </group>
  );
});

const SUNNY_SAKURA_PETAL_BASE = 180;
const SUNNY_SAKURA_POLLEN_BASE = 140;
const SUNNY_SAKURA_SHAFT_COUNT = 5;
const SUNNY_SAKURA_PETAL_STRIDE = 7;

const SunnySakuraAtmosphere = memo(function SunnySakuraAtmosphere({
  glowTex,
  particleScale,
}: {
  glowTex: THREE.CanvasTexture;
  particleScale: number;
}) {
  const petalsRef = useRef<THREE.InstancedMesh>(null);
  const shaftsRef = useRef<THREE.InstancedMesh>(null);
  const petalCount = Math.max(60, Math.round(SUNNY_SAKURA_PETAL_BASE * particleScale));
  const pollenCount = Math.max(40, Math.round(SUNNY_SAKURA_POLLEN_BASE * particleScale));

  const dummy = useMemo(() => new THREE.Object3D(), []);

  const { petalGeo, petalMat, petalData, pollenGeo, pollenMat, shaftGeo, shaftMat } = useMemo(() => {
    // 1. Falling sakura petals & spring leaves
    const pGeo = createPetalGeometry();
    const pMat = new THREE.MeshBasicMaterial({
      color: "#ffffff",
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
    });
    // Per-petal state: x, y, z, fallSpeed, swayPhase, tumbleSpeed, scale
    const pData = new Float32Array(petalCount * SUNNY_SAKURA_PETAL_STRIDE);
    for (let i = 0; i < petalCount; i++) {
      const b = i * SUNNY_SAKURA_PETAL_STRIDE;
      const a = seeded(i + 3031) * Math.PI * 2;
      const r = Math.sqrt(seeded(i + 3131)) * 29;
      pData[b + 0] = Math.cos(a) * r;
      pData[b + 1] = 0.2 + seeded(i + 3231) * 13.3;
      pData[b + 2] = Math.sin(a) * r;
      pData[b + 3] = 0.55 + seeded(i + 3331) * 0.8;
      pData[b + 4] = seeded(i + 3431) * Math.PI * 2;
      pData[b + 5] = 1.2 + seeded(i + 3531) * 2.2;
      pData[b + 6] = 0.8 + seeded(i + 3631) * 0.7;
    }

    // 2. Golden pollen motes
    const poGeo = new THREE.BufferGeometry();
    const poPos = new Float32Array(pollenCount * 3);
    const poMeta = new Float32Array(pollenCount * 4);
    for (let i = 0; i < pollenCount; i++) {
      const a = seeded(i + 3731) * Math.PI * 2;
      const r = 1.5 + seeded(i + 3831) * 25;
      const y = 0.6 + seeded(i + 3931) * 9.5;
      poPos[i * 3] = Math.cos(a) * r;
      poPos[i * 3 + 1] = y;
      poPos[i * 3 + 2] = Math.sin(a) * r;
      poMeta[i * 4] = a;
      poMeta[i * 4 + 1] = r;
      poMeta[i * 4 + 2] = y;
      poMeta[i * 4 + 3] = seeded(i + 4031) * Math.PI * 2;
    }
    poGeo.setAttribute("position", new THREE.BufferAttribute(poPos, 3));
    poGeo.userData.meta = poMeta;
    const poMat = new THREE.PointsMaterial({
      size: 0.2,
      map: glowTex,
      color: "#fff2b2",
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
      toneMapped: false,
    });

    // 3. Warm golden sunbeams through the canopy (single InstancedMesh + Fresnel/smoothstep shader)
    const sGeo = new THREE.ConeGeometry(4.0, 28, 16, 1, true);
    const sMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color("#ffe3a1") },
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vViewDir;

        void main() {
          vUv = uv;
          vec4 localPos = vec4(position, 1.0);
          vec3 transformedNormal = normal;
          #ifdef USE_INSTANCING
            localPos = instanceMatrix * localPos;
            transformedNormal = mat3(instanceMatrix) * transformedNormal;
          #endif
          vec4 mvPosition = modelViewMatrix * localPos;
          vNormal = normalize(normalMatrix * transformedNormal);
          vViewDir = normalize(-mvPosition.xyz);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uColor;
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vViewDir;

        void main() {
          float fresnel = abs(dot(normalize(vNormal), normalize(vViewDir)));
          float edgeFalloff = pow(fresnel, 1.6);
          float verticalFade = smoothstep(0.0, 0.25, vUv.y) * (1.0 - smoothstep(0.72, 1.0, vUv.y));
          float shimmer = 0.85 + 0.15 * sin(uTime * 0.5 + vUv.x * 6.28318);
          float alpha = edgeFalloff * verticalFade * shimmer * 0.085;
          gl_FragColor = vec4(uColor, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    });

    return {
      petalGeo: pGeo,
      petalMat: pMat,
      petalData: pData,
      pollenGeo: poGeo,
      pollenMat: poMat,
      shaftGeo: sGeo,
      shaftMat: sMat,
    };
  }, [glowTex, petalCount, pollenCount]);

  // Sakura pinks + cream with ~15% fresh spring leaf green
  useEffect(() => {
    const mesh = petalsRef.current;
    if (!mesh) return;
    const pink = new THREE.Color("#ffb7dc");
    const rose = new THREE.Color("#ff85b3");
    const cream = new THREE.Color("#fff0f7");
    const leaf = new THREE.Color("#86efac");
    const blossoms = [pink, rose, cream];
    for (let i = 0; i < petalCount; i++) {
      const c = seeded(i + 4131) < 0.15 ? leaf : blossoms[i % blossoms.length];
      mesh.setColorAt(i, c);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [petalCount]);

  const shaftSpecs = useMemo(
    () => [
      { pos: [13, 13.4, -11] as [number, number, number], rot: [0.32, 0.14, 0.4] as [number, number, number], scale: 1.05 },
      { pos: [3, 13.9, -15] as [number, number, number], rot: [0.34, 0.12, 0.38] as [number, number, number], scale: 0.92 },
      { pos: [18, 13.1, 3] as [number, number, number], rot: [0.3, 0.17, 0.43] as [number, number, number], scale: 1.0 },
      { pos: [-8, 14.1, -8] as [number, number, number], rot: [0.33, 0.1, 0.37] as [number, number, number], scale: 0.86 },
      { pos: [8, 13.7, 13] as [number, number, number], rot: [0.31, 0.14, 0.4] as [number, number, number], scale: 1.0 },
    ],
    []
  );

  useEffect(() => {
    const mesh = shaftsRef.current;
    if (!mesh) return;
    const d = new THREE.Object3D();
    for (let i = 0; i < shaftSpecs.length; i++) {
      const s = shaftSpecs[i];
      d.position.set(s.pos[0], s.pos[1], s.pos[2]);
      d.rotation.set(s.rot[0], s.rot[1], s.rot[2]);
      d.scale.setScalar(s.scale);
      d.updateMatrix();
      mesh.setMatrixAt(i, d.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [shaftSpecs]);

  useEffect(() => () => {
    petalGeo.dispose();
    petalMat.dispose();
    pollenGeo.dispose();
    pollenMat.dispose();
    shaftGeo.dispose();
    shaftMat.dispose();
  }, [petalGeo, petalMat, pollenGeo, pollenMat, shaftGeo, shaftMat]);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    const t = state.clock.elapsedTime;

    // Continuously falling & tumbling petals / leaves with gentle spring breeze gusts
    const petals = petalsRef.current;
    if (petals) {
      const gust = 0.5 + 0.5 * Math.sin(t * 0.21);
      const windX = 0.55 + Math.sin(t * 0.3) * 0.6 + gust * 0.5;
      const windZ = 0.25 + Math.cos(t * 0.24) * 0.5;
      for (let i = 0; i < petalCount; i++) {
        const b = i * SUNNY_SAKURA_PETAL_STRIDE;
        const phase = petalData[b + 4];
        const tumble = petalData[b + 5];

        petalData[b + 0] += (windX + Math.sin(t * 1.3 + phase) * 0.7) * dt;
        petalData[b + 1] -= petalData[b + 3] * dt;
        petalData[b + 2] += (windZ + Math.cos(t * 1.1 + phase) * 0.7) * dt;

        const x = petalData[b + 0];
        const z = petalData[b + 2];
        if (petalData[b + 1] < 0.2 || x * x + z * z > 31 * 31) {
          // Recycle back to the canopy height upwind
          const a = phase + t * 0.13 + i * 0.37;
          const r = Math.sqrt(((i * 53) % 290) / 290) * 29;
          petalData[b + 0] = Math.cos(a) * r - windX * 2.5;
          petalData[b + 1] = 11.5 + ((i * 17) % 20) / 10;
          petalData[b + 2] = Math.sin(a) * r - windZ * 2.5;
        }

        dummy.position.set(petalData[b + 0], petalData[b + 1], petalData[b + 2]);
        dummy.rotation.set(
          t * tumble + phase,
          t * (tumble * 0.65) + phase * 1.5,
          Math.sin(t * 1.9 + phase) * 0.85
        );
        dummy.scale.setScalar(petalData[b + 6]);
        dummy.updateMatrix();
        petals.setMatrixAt(i, dummy.matrix);
      }
      petals.instanceMatrix.needsUpdate = true;
    }

    // Lazily floating golden pollen
    const poPos = pollenGeo.getAttribute("position") as THREE.BufferAttribute;
    const poMeta = pollenGeo.userData.meta as Float32Array;
    const pv = poPos.array as Float32Array;
    for (let i = 0; i < pollenCount; i++) {
      const o = i * 3;
      const m = i * 4;
      const a = poMeta[m] + t * 0.018 + Math.sin(t * 0.2 + poMeta[m + 3]) * 0.08;
      const r = poMeta[m + 1] + Math.cos(t * 0.33 + poMeta[m + 3]) * 0.9;
      pv[o] = Math.cos(a) * r;
      pv[o + 1] = poMeta[m + 2] + Math.sin(t * 0.7 + poMeta[m + 3]) * 0.45;
      pv[o + 2] = Math.sin(a) * r;
    }
    poPos.needsUpdate = true;
    pollenMat.opacity = 0.62 + Math.sin(t * 1.3) * 0.1;

    shaftMat.uniforms.uTime.value = t;
  });

  return (
    <group>
      <instancedMesh ref={petalsRef} args={[petalGeo, petalMat, petalCount]} frustumCulled={false} />
      <points geometry={pollenGeo} material={pollenMat} frustumCulled={false} />
      <instancedMesh ref={shaftsRef} args={[shaftGeo, shaftMat, SUNNY_SAKURA_SHAFT_COUNT]} frustumCulled={false} />
    </group>
  );
});

export const ArenaAtmosphereVFX = memo(function ArenaAtmosphereVFX({ mapKind, particleScale }: ArenaAtmosphereVFXProps) {
  const map = ARENA_MAPS[mapKind] ?? ARENA_MAPS.sunlit_colosseum;

  const { glowTex, mistTex } = useMemo(
    () => ({
      glowTex: createSoftGlowTexture(),
      mistTex: createMistTexture(),
    }),
    []
  );

  useEffect(() => () => {
    glowTex.dispose();
    mistTex.dispose();
  }, [glowTex, mistTex]);

  return (
    <group>
      {mapKind === "sunlit_colosseum" && <SunlitAtmosphere glowTex={glowTex} particleScale={particleScale} />}
      {mapKind === "moonlit_sakura" && <SakuraAtmosphere glowTex={glowTex} mistTex={mistTex} particleScale={particleScale} />}
      {mapKind === "aurora_sanctuary" && <AuroraAtmosphere glowTex={glowTex} particleScale={particleScale} />}
      {mapKind === "sunny_sakura" && <SunnySakuraAtmosphere glowTex={glowTex} particleScale={particleScale} />}

      {/* Subtle flush center duel-ring shimmer */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.038, 0]}>
        <ringGeometry args={[4.45, 4.54, 64]} />
        <meshBasicMaterial
          color={map.accent}
          transparent
          opacity={mapKind === "sunlit_colosseum" || mapKind === "sunny_sakura" ? 0.22 : 0.38}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
});
