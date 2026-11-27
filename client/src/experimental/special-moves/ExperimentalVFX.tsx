import { memo, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import type { RoomWorldSnapshot } from "../../net/useColosseumRoom";
import type { LivePose } from "../../scene/GladiatorModel";
import { EXPERIMENTAL_ARTS, type ExperimentalArtKind } from "./config";

export interface ExperimentalVfxEvent {
  id: number;
  kind: ExperimentalArtKind;
  casterId?: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  createdAt: number;
}

export interface ExperimentalVFXProps {
  eventsRef: React.MutableRefObject<ExperimentalVfxEvent[]>;
  worldRef?: React.MutableRefObject<RoomWorldSnapshot>;
  sessionId?: string;
  localPoseRef?: React.MutableRefObject<LivePose>;
}

const MAX_EVENT_SLOTS = 4;
const SAKURA_PETAL_COUNT = 90;
const SAKURA_SPARKLE_COUNT = 48;
const MORTAL_EMBER_COUNT = 64;

interface PetalSeed {
  phase: number;
  radiusBase: number;
  radiusSpread: number;
  helixTurns: number;
  heightRise: number;
  flutterFreq: number;
  scale: number;
  spinSpeedX: number;
  spinSpeedY: number;
  spinSpeedZ: number;
  colorIndex: number;
}

interface ParticleSeed {
  angle: number;
  radius: number;
  speed: number;
  height: number;
  phase: number;
}

const SAKURA_PALETTE = [
  new THREE.Color("#fbcfe8"),
  new THREE.Color("#f9a8d4"),
  new THREE.Color("#f472b6"),
  new THREE.Color("#fff1f2"),
];

// Default material colors restored before rendering Sakura Dance or Mortal Draw so pooled slots never leak tints
const COL_SAKURA_ARC1_OUTER = new THREE.Color("#f472b6");
const COL_SAKURA_ARC1_CORE = new THREE.Color("#fff1f2");
const COL_SAKURA_ARC2_OUTER = new THREE.Color("#ec4899");
const COL_SAKURA_ARC2_CORE = new THREE.Color("#ffffff");
const COL_SAKURA_ARC3_OUTER = new THREE.Color("#f472b6");
const COL_SAKURA_ARC3_CORE = new THREE.Color("#fce7f3");
const COL_SAKURA_WIND1 = new THREE.Color("#fbcfe8");
const COL_SAKURA_WIND2 = new THREE.Color("#f9a8d4");
const COL_SAKURA_SPARKLE = new THREE.Color("#ffe4e6");

const COL_MORTAL_CHARGE_DARK = new THREE.Color("#0a0204");
const COL_MORTAL_CHARGE_GLOW = new THREE.Color("#dc2626");
const COL_MORTAL_W1_SHADOW = new THREE.Color("#080103");
const COL_MORTAL_W1_CRIMSON = new THREE.Color("#dc2626");
const COL_MORTAL_W1_CORE = new THREE.Color("#ff6b7a");
const COL_MORTAL_W2_SHADOW = new THREE.Color("#060002");
const COL_MORTAL_W2_CRIMSON = new THREE.Color("#ef4444");
const COL_MORTAL_W2_CORE = new THREE.Color("#fecdd3");
const COL_MORTAL_SHOCK1 = new THREE.Color("#b91c1c");
const COL_MORTAL_SHOCK2 = new THREE.Color("#ef4444");

type ExtraArtKind = Exclude<
  ExperimentalArtKind,
  "sakura_dance" | "mortal_draw" | "mortal_draw_empowered"
>;

interface ExtraArtPalette {
  readonly shadow: THREE.Color;
  readonly primary: THREE.Color;
  readonly secondary: THREE.Color;
  readonly core: THREE.Color;
  readonly ring: THREE.Color;
  readonly spark: THREE.Color;
}

const EXTRA_ART_PALETTES: Record<ExtraArtKind, ExtraArtPalette> = {
  ichimonji: {
    shadow: new THREE.Color("#082f49"),
    primary: new THREE.Color("#38bdf8"),
    secondary: new THREE.Color("#0284c7"),
    core: new THREE.Color("#f0f9ff"),
    ring: new THREE.Color("#7dd3fc"),
    spark: new THREE.Color("#e0f2fe"),
  },
  ichimonji_double: {
    shadow: new THREE.Color("#0c4a6e"),
    primary: new THREE.Color("#0ea5e9"),
    secondary: new THREE.Color("#38bdf8"),
    core: new THREE.Color("#ffffff"),
    ring: new THREE.Color("#38bdf8"),
    spark: new THREE.Color("#bae6fd"),
  },
  ashina_cross: {
    shadow: new THREE.Color("#172554"),
    primary: new THREE.Color("#60a5fa"),
    secondary: new THREE.Color("#93c5fd"),
    core: new THREE.Color("#ffffff"),
    ring: new THREE.Color("#dbeafe"),
    spark: new THREE.Color("#ffffff"),
  },
  dragon_flash: {
    shadow: new THREE.Color("#083344"),
    primary: new THREE.Color("#22d3ee"),
    secondary: new THREE.Color("#fef08a"),
    core: new THREE.Color("#ffffff"),
    ring: new THREE.Color("#67e8f9"),
    spark: new THREE.Color("#fef08a"),
  },
  whirlwind_slash: {
    shadow: new THREE.Color("#064e3b"),
    primary: new THREE.Color("#34d399"),
    secondary: new THREE.Color("#6ee7b7"),
    core: new THREE.Color("#ecfdf5"),
    ring: new THREE.Color("#6ee7b7"),
    spark: new THREE.Color("#d1fae5"),
  },
  nightjar_slash: {
    shadow: new THREE.Color("#0c4a6e"),
    primary: new THREE.Color("#a7f3d0"),
    secondary: new THREE.Color("#38bdf8"),
    core: new THREE.Color("#ffffff"),
    ring: new THREE.Color("#6ee7b7"),
    spark: new THREE.Color("#bae6fd"),
  },
  floating_passage: {
    shadow: new THREE.Color("#134e4a"),
    primary: new THREE.Color("#2dd4bf"),
    secondary: new THREE.Color("#38bdf8"),
    core: new THREE.Color("#e0f2fe"),
    ring: new THREE.Color("#5eead4"),
    spark: new THREE.Color("#ccfbf1"),
  },
  shadowrush: {
    shadow: new THREE.Color("#052e16"),
    primary: new THREE.Color("#4ade80"),
    secondary: new THREE.Color("#fde047"),
    core: new THREE.Color("#fefce8"),
    ring: new THREE.Color("#86efac"),
    spark: new THREE.Color("#fde047"),
  },
  spiral_cloud_passage: {
    shadow: new THREE.Color("#2e1065"),
    primary: new THREE.Color("#a855f7"),
    secondary: new THREE.Color("#38bdf8"),
    core: new THREE.Color("#f0f9ff"),
    ring: new THREE.Color("#c084fc"),
    spark: new THREE.Color("#e0f2fe"),
  },
  one_mind: {
    shadow: new THREE.Color("#3b0764"),
    primary: new THREE.Color("#e879f9"),
    secondary: new THREE.Color("#f43f5e"),
    core: new THREE.Color("#ffffff"),
    ring: new THREE.Color("#f0abfc"),
    spark: new THREE.Color("#fae8ff"),
  },
  high_monk: {
    shadow: new THREE.Color("#451a03"),
    primary: new THREE.Color("#fbbf24"),
    secondary: new THREE.Color("#f59e0b"),
    core: new THREE.Color("#fffbeb"),
    ring: new THREE.Color("#fde047"),
    spark: new THREE.Color("#fef3c7"),
  },
};

const ONE_MIND_PULSES: readonly {
  readonly startMs: number;
  readonly durMs: number;
  readonly y: number;
  readonly z: number;
  readonly tiltX: number;
  readonly rollZ: number;
  readonly yawStart: number;
  readonly yawEnd: number;
  readonly scale: number;
  readonly slotIdx: 0 | 1 | 2;
}[] = [
  { startMs: 490, durMs: 175, y: 1.15, z: 1.75, tiltX: 0.14, rollZ: 0.78, yawStart: -1.35, yawEnd: 1.25, scale: 1.16, slotIdx: 0 },
  { startMs: 575, durMs: 175, y: 1.48, z: 2.35, tiltX: -0.18, rollZ: -0.82, yawStart: 1.38, yawEnd: -1.32, scale: 1.22, slotIdx: 1 },
  { startMs: 660, durMs: 175, y: 0.92, z: 2.05, tiltX: 0.24, rollZ: 1.38, yawStart: -1.15, yawEnd: 1.18, scale: 1.18, slotIdx: 2 },
  { startMs: 745, durMs: 175, y: 1.62, z: 2.85, tiltX: -0.12, rollZ: -0.32, yawStart: 1.42, yawEnd: -1.36, scale: 1.28, slotIdx: 0 },
  { startMs: 830, durMs: 175, y: 1.22, z: 2.5, tiltX: 0.2, rollZ: -1.24, yawStart: -1.28, yawEnd: 1.32, scale: 1.26, slotIdx: 1 },
  { startMs: 915, durMs: 185, y: 1.38, z: 3.15, tiltX: -0.15, rollZ: 0.56, yawStart: 1.45, yawEnd: -1.42, scale: 1.38, slotIdx: 2 },
];

// Module-level scratch objects to guarantee zero per-frame heap allocations in useFrame
const _dummy = new THREE.Object3D();
const _zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);

function updateTintedArcPair(
  outer: THREE.Mesh | null,
  core: THREE.Mesh | null,
  elapsedMs: number,
  startMs: number,
  durMs: number,
  y: number,
  zStart: number,
  zEnd: number,
  pitchStart: number,
  pitchEnd: number,
  yawStart: number,
  yawEnd: number,
  rollZ: number,
  scaleX: number,
  scaleY: number,
  scaleZ: number,
  outerColor: THREE.Color,
  coreColor: THREE.Color,
  opacityScale = 1
): void {
  if (!outer || !core) return;
  const local = (elapsedMs - startMs) / durMs;
  if (local < 0 || local > 1) return;

  const easeOut = 1 - Math.pow(1 - local, 2.4);
  const fade = Math.sin(local * Math.PI) * Math.pow(1 - local, 0.42) * opacityScale;
  const grow = 0.72 + easeOut * 0.52;
  const pz = zStart + (zEnd - zStart) * easeOut;
  const rx = pitchStart + (pitchEnd - pitchStart) * easeOut;
  const ry = yawStart + (yawEnd - yawStart) * easeOut;

  const outerMat = outer.material as THREE.MeshBasicMaterial;
  outerMat.color.copy(outerColor);
  outerMat.opacity = fade * 0.9;
  outer.visible = true;
  outer.position.set(0, y, pz);
  outer.rotation.set(rx, ry, rollZ);
  outer.scale.set(scaleX * grow, scaleY * grow, scaleZ * grow);

  const coreMat = core.material as THREE.MeshBasicMaterial;
  coreMat.color.copy(coreColor);
  coreMat.opacity = fade * 0.98;
  core.visible = true;
  core.position.set(0, y + 0.02, pz + 0.04);
  core.rotation.set(rx, ry, rollZ);
  core.scale.set(scaleX * grow * 1.02, scaleY * grow * 1.02, scaleZ * grow * 1.02);
}

function updateTintedHeavyWave(
  shadow: THREE.Mesh | null,
  body: THREE.Mesh | null,
  core: THREE.Mesh | null,
  elapsedMs: number,
  startMs: number,
  durMs: number,
  y: number,
  zStart: number,
  zEnd: number,
  pitchStart: number,
  pitchEnd: number,
  yawStart: number,
  yawEnd: number,
  rollZ: number,
  scaleX: number,
  scaleY: number,
  scaleZ: number,
  shadowColor: THREE.Color,
  bodyColor: THREE.Color,
  coreColor: THREE.Color
): void {
  if (!shadow || !body || !core) return;
  const local = (elapsedMs - startMs) / durMs;
  if (local < 0 || local > 1) return;

  const burst = 1 - Math.pow(1 - local, 2.8);
  const fade = Math.pow(1 - local, 1.05) * Math.min(1, local * 9);
  const grow = 0.62 + burst * 0.65;
  const pz = zStart + (zEnd - zStart) * burst;
  const rx = pitchStart + (pitchEnd - pitchStart) * burst;
  const ry = yawStart + (yawEnd - yawStart) * burst;

  const shadowMat = shadow.material as THREE.MeshBasicMaterial;
  shadowMat.color.copy(shadowColor);
  shadowMat.opacity = fade * 0.72;
  shadow.visible = true;
  shadow.position.set(0, y - 0.02, pz - 0.05);
  shadow.rotation.set(rx, ry, rollZ);
  shadow.scale.set(scaleX * grow * 1.07, scaleY * grow * 1.07, scaleZ * grow * 1.07);

  const bodyMat = body.material as THREE.MeshBasicMaterial;
  bodyMat.color.copy(bodyColor);
  bodyMat.opacity = fade * 0.95;
  body.visible = true;
  body.position.set(0, y, pz);
  body.rotation.set(rx, ry, rollZ);
  body.scale.set(scaleX * grow, scaleY * grow, scaleZ * grow);

  const coreMat = core.material as THREE.MeshBasicMaterial;
  coreMat.color.copy(coreColor);
  coreMat.opacity = Math.pow(fade, 0.85) * 0.96;
  core.visible = true;
  core.position.set(0, y + 0.02, pz + 0.05);
  core.rotation.set(rx, ry, rollZ);
  core.scale.set(scaleX * grow * 1.03, scaleY * grow * 1.03, scaleZ * grow * 1.03);
}

function updateTintedRing(
  mesh: THREE.Mesh | null,
  elapsedMs: number,
  startMs: number,
  durMs: number,
  yStart: number,
  yEnd: number,
  zStart: number,
  zEnd: number,
  rotX: number,
  rotZStart: number,
  rotZEnd: number,
  scaleStart: number,
  scaleEnd: number,
  color: THREE.Color,
  maxOpacity: number
): void {
  if (!mesh) return;
  const local = (elapsedMs - startMs) / durMs;
  if (local < 0 || local > 1) return;

  const ease = 1 - Math.pow(1 - local, 2.4);
  const fade = Math.sin(local * Math.PI) * Math.pow(1 - local, 0.45);
  const sc = scaleStart + (scaleEnd - scaleStart) * ease;
  const mat = mesh.material as THREE.MeshBasicMaterial;
  mat.color.copy(color);
  mat.opacity = fade * maxOpacity;

  mesh.visible = true;
  mesh.position.set(0, yStart + (yEnd - yStart) * ease, zStart + (zEnd - zStart) * ease);
  mesh.rotation.set(rotX, 0, rotZStart + (rotZEnd - rotZStart) * local);
  mesh.scale.set(sc, sc, 1);
}

function seededRand(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Custom tapered curved sword crescent ribbon centered along +Z (forward in front of gladiator).
 * Features vertex colors fading smoothly from bright leading outer edge to soft inner tail
 * and tapered needle tips at both ends of the arc.
 */
function createCrescentWaveGeometry(
  innerRadius: number,
  outerRadius: number,
  arcAngle: number,
  segments: number,
  archLift: number
): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= segments; i++) {
    const u = i / segments; // 0 .. 1 along sweep
    const theta = -arcAngle * 0.5 + u * arcAngle;
    // Taper thickness to sharp points at the leading and trailing tips
    const taper = Math.sin(u * Math.PI);
    const widthCurve = Math.pow(taper, 0.55);
    const rOut = innerRadius + (outerRadius - innerRadius) * (0.28 + 0.72 * widthCurve);
    const rIn = rOut - (outerRadius - innerRadius) * widthCurve;
    const lift = Math.sin(u * Math.PI) * archLift;

    const sinT = Math.sin(theta);
    const cosT = Math.cos(theta);

    // Inner trailing vertex (soft fade to near-zero for razor-clean ribbon falloff)
    positions.push(sinT * rIn, lift * 0.35, cosT * rIn);
    uvs.push(u, 0);
    const innerBrightness = 0.06 * taper;
    colors.push(innerBrightness, innerBrightness, innerBrightness);

    // Outer razor edge vertex (full intensity)
    positions.push(sinT * rOut, lift, cosT * rOut);
    uvs.push(u, 1);
    const outerBrightness = 0.45 + 0.55 * taper;
    colors.push(outerBrightness, outerBrightness, outerBrightness);

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
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Custom notched cherry blossom petal BufferGeometry for InstancedMesh rendering.
 */
function createSakuraPetalGeometry(): THREE.BufferGeometry {
  const vertices = new Float32Array([
    // Center base -> left lobe -> center notch -> right lobe
    0.0, -0.075, 0.0,
    -0.055, 0.015, 0.012,
    -0.032, 0.075, 0.0,
    0.0, 0.048, -0.006,
    0.032, 0.075, 0.0,
    0.055, 0.015, 0.012,
  ]);
  const indices = [0, 1, 3, 1, 2, 3, 0, 3, 5, 3, 4, 5];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

interface SlotRefs {
  root: THREE.Group | null;
  // Sakura Dance meshes
  sakuraArc1Outer: THREE.Mesh | null;
  sakuraArc1Core: THREE.Mesh | null;
  sakuraArc2Outer: THREE.Mesh | null;
  sakuraArc2Core: THREE.Mesh | null;
  sakuraArc3Outer: THREE.Mesh | null;
  sakuraArc3Core: THREE.Mesh | null;
  sakuraWind1: THREE.Mesh | null;
  sakuraWind2: THREE.Mesh | null;
  sakuraPetals: THREE.InstancedMesh | null;
  sakuraSparkles: THREE.Points<
    THREE.BufferGeometry<THREE.NormalOrGLBufferAttributes>,
    THREE.Material | THREE.Material[]
  > | null;
  // Mortal Draw / Empowered meshes
  mortalChargeDark: THREE.Mesh | null;
  mortalChargeGlow: THREE.Mesh | null;
  mortalWave1Shadow: THREE.Mesh | null;
  mortalWave1Crimson: THREE.Mesh | null;
  mortalWave1Core: THREE.Mesh | null;
  mortalWave2Shadow: THREE.Mesh | null;
  mortalWave2Crimson: THREE.Mesh | null;
  mortalWave2Core: THREE.Mesh | null;
  mortalShock1: THREE.Mesh | null;
  mortalShock2: THREE.Mesh | null;
  mortalEmbers: THREE.Points<
    THREE.BufferGeometry<THREE.NormalOrGLBufferAttributes>,
    THREE.Material | THREE.Material[]
  > | null;
}

function createEmptySlotRef(): SlotRefs {
  return {
    root: null,
    sakuraArc1Outer: null,
    sakuraArc1Core: null,
    sakuraArc2Outer: null,
    sakuraArc2Core: null,
    sakuraArc3Outer: null,
    sakuraArc3Core: null,
    sakuraWind1: null,
    sakuraWind2: null,
    sakuraPetals: null,
    sakuraSparkles: null,
    mortalChargeDark: null,
    mortalChargeGlow: null,
    mortalWave1Shadow: null,
    mortalWave1Crimson: null,
    mortalWave1Core: null,
    mortalWave2Shadow: null,
    mortalWave2Crimson: null,
    mortalWave2Core: null,
    mortalShock1: null,
    mortalShock2: null,
    mortalEmbers: null,
  };
}

/**
 * Pooled, zero-per-frame-allocation procedural Three.js VFX for Experimental Combat Arts:
 *   - Sakura Dance: 90 instanced helical cherry blossom petals + 3 double-layered rose/white
 *     aerial slash arcs + rising wind rings + shimmering sakura sparkles.
 *   - Mortal Draw / Empowered: coiling black-and-crimson charge aura + rising dark embers +
 *     colossal expanding double-layered crescent slash wave (pitch-black shadow rim + blinding
 *     blood-crimson core) + expanding dark-crimson shockwaves (+ reversed 2nd wave when empowered).
 */
export const ExperimentalVFX = memo(function ExperimentalVFX({
  eventsRef,
  worldRef,
  sessionId,
  localPoseRef,
}: ExperimentalVFXProps) {
  const slotRefs = useRef<SlotRefs[]>(
    Array.from({ length: MAX_EVENT_SLOTS }, () => createEmptySlotRef())
  );
  const wasIdleRef = useRef(false);

  // Precompute deterministic seeds once for petals & point particles
  const { petalSeeds, sparkleSeeds, emberSeeds } = useMemo(() => {
    const petals: PetalSeed[] = [];
    for (let i = 0; i < SAKURA_PETAL_COUNT; i++) {
      petals.push({
        phase: seededRand(i * 3.1 + 1) * Math.PI * 2,
        radiusBase: 0.48 + seededRand(i * 5.7 + 2) * 1.45,
        radiusSpread: 0.9 + seededRand(i * 7.3 + 3) * 1.9,
        helixTurns: 1.4 + seededRand(i * 11.1 + 4) * 2.2,
        heightRise: 1.1 + seededRand(i * 13.7 + 5) * 2.2,
        flutterFreq: 3.5 + seededRand(i * 17.3 + 6) * 5.5,
        scale: 0.72 + seededRand(i * 19.9 + 7) * 0.95,
        spinSpeedX: 2.2 + seededRand(i * 23.1 + 8) * 5.0,
        spinSpeedY: 2.8 + seededRand(i * 29.3 + 9) * 5.5,
        spinSpeedZ: 1.8 + seededRand(i * 31.7 + 10) * 4.5,
        colorIndex: i % SAKURA_PALETTE.length,
      });
    }

    const sparkles: ParticleSeed[] = [];
    for (let i = 0; i < SAKURA_SPARKLE_COUNT; i++) {
      sparkles.push({
        angle: seededRand(i * 4.3 + 101) * Math.PI * 2,
        radius: 0.7 + seededRand(i * 8.1 + 102) * 1.8,
        speed: 1.4 + seededRand(i * 9.7 + 103) * 2.4,
        height: 0.6 + seededRand(i * 14.3 + 104) * 2.3,
        phase: seededRand(i * 16.9 + 105) * Math.PI * 2,
      });
    }

    const embers: ParticleSeed[] = [];
    for (let i = 0; i < MORTAL_EMBER_COUNT; i++) {
      embers.push({
        angle: (seededRand(i * 6.7 + 201) - 0.5) * Math.PI * 1.25,
        radius: 0.5 + seededRand(i * 10.3 + 202) * 1.35,
        speed: 2.4 + seededRand(i * 15.1 + 203) * 4.8,
        height: 0.2 + seededRand(i * 21.7 + 204) * 1.65,
        phase: seededRand(i * 27.9 + 205) * Math.PI * 2,
      });
    }

    return { petalSeeds: petals, sparkleSeeds: sparkles, emberSeeds: embers };
  }, []);

  // Allocate shared geometries & per-slot particle buffers once
  const resources = useMemo(() => {
    const sakuraArcOuterGeo = createCrescentWaveGeometry(1.15, 2.55, Math.PI * 1.18, 28, 0.22);
    const sakuraArcCoreGeo = createCrescentWaveGeometry(1.58, 2.36, Math.PI * 1.12, 28, 0.2);
    const mortalShadowGeo = createCrescentWaveGeometry(1.25, 4.15, Math.PI * 1.16, 36, 0.34);
    const mortalCrimsonGeo = createCrescentWaveGeometry(1.65, 3.85, Math.PI * 1.12, 36, 0.3);
    const mortalCoreGeo = createCrescentWaveGeometry(2.35, 3.45, Math.PI * 1.04, 32, 0.24);
    const windRingGeo = new THREE.RingGeometry(1.08, 1.34, 36);
    const chargeRingGeo = new THREE.RingGeometry(0.88, 1.32, 36);
    const shockRingGeo = new THREE.RingGeometry(1.45, 2.05, 36);
    const petalGeo = createSakuraPetalGeometry();

    const sparkleGeos: THREE.BufferGeometry[] = [];
    const emberGeos: THREE.BufferGeometry[] = [];
    for (let s = 0; s < MAX_EVENT_SLOTS; s++) {
      const spGeo = new THREE.BufferGeometry();
      spGeo.setAttribute(
        "position",
        new THREE.BufferAttribute(new Float32Array(SAKURA_SPARKLE_COUNT * 3), 3)
      );
      sparkleGeos.push(spGeo);

      const emGeo = new THREE.BufferGeometry();
      emGeo.setAttribute(
        "position",
        new THREE.BufferAttribute(new Float32Array(MORTAL_EMBER_COUNT * 3), 3)
      );
      const emColors = new Float32Array(MORTAL_EMBER_COUNT * 3);
      for (let i = 0; i < MORTAL_EMBER_COUNT; i++) {
        const dark = i % 3 === 0;
        emColors[i * 3] = dark ? 0.14 : 1.0;
        emColors[i * 3 + 1] = dark ? 0.02 : 0.16;
        emColors[i * 3 + 2] = dark ? 0.04 : 0.22;
      }
      emGeo.setAttribute("color", new THREE.BufferAttribute(emColors, 3));
      emberGeos.push(emGeo);
    }

    return {
      sakuraArcOuterGeo,
      sakuraArcCoreGeo,
      mortalShadowGeo,
      mortalCrimsonGeo,
      mortalCoreGeo,
      windRingGeo,
      chargeRingGeo,
      shockRingGeo,
      petalGeo,
      sparkleGeos,
      emberGeos,
    };
  }, []);

  // Initialize petal instance colors once on mount
  useEffect(() => {
    for (let s = 0; s < MAX_EVENT_SLOTS; s++) {
      const inst = slotRefs.current[s].sakuraPetals;
      if (!inst) continue;
      for (let i = 0; i < SAKURA_PETAL_COUNT; i++) {
        inst.setColorAt(i, SAKURA_PALETTE[petalSeeds[i].colorIndex]);
        inst.setMatrixAt(i, _zeroMatrix);
      }
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
      inst.instanceMatrix.needsUpdate = true;
    }
  }, [petalSeeds]);

  // Dispose geometries on unmount
  useEffect(() => {
    return () => {
      resources.sakuraArcOuterGeo.dispose();
      resources.sakuraArcCoreGeo.dispose();
      resources.mortalShadowGeo.dispose();
      resources.mortalCrimsonGeo.dispose();
      resources.mortalCoreGeo.dispose();
      resources.windRingGeo.dispose();
      resources.chargeRingGeo.dispose();
      resources.shockRingGeo.dispose();
      resources.petalGeo.dispose();
      resources.sparkleGeos.forEach((g) => g.dispose());
      resources.emberGeos.forEach((g) => g.dispose());
    };
  }, [resources]);

  useFrame(() => {
    const now = performance.now();
    const list = eventsRef.current;

    // Compact completed events in-place across the entire queue (zero allocations)
    // so long-lived arts at index 0 never block shorter expired arts behind them.
    // (Allow 550ms linger for falling sakura petals / fading smoke.)
    let writeIdx = 0;
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      const maxLife = EXPERIMENTAL_ARTS[item.kind].durationMs + 550;
      if (now - item.createdAt <= maxLife) {
        if (writeIdx !== i) {
          list[writeIdx] = item;
        }
        writeIdx++;
      }
    }
    list.length = writeIdx;

    if (list.length === 0 && wasIdleRef.current) return;
    wasIdleRef.current = list.length === 0;

    for (let s = 0; s < MAX_EVENT_SLOTS; s++) {
      const slot = slotRefs.current[s];
      if (!slot.root) continue;

      const fx = list[s];
      if (!fx) {
        slot.root.visible = false;
        continue;
      }

      const spec = EXPERIMENTAL_ARTS[fx.kind];
      const totalLifeMs = spec.durationMs + 550;
      const elapsedMs = now - fx.createdAt;
      if (elapsedMs < 0 || elapsedMs > totalLifeMs) {
        slot.root.visible = false;
        continue;
      }

      // Track caster live position during active cast so arcs stay tightly bound to the gladiator
      let px = fx.x;
      let py = fx.y;
      let pz = fx.z;
      let pyaw = fx.yaw;
      if (fx.casterId && elapsedMs < spec.durationMs) {
        if (sessionId && fx.casterId === sessionId && localPoseRef) {
          px = localPoseRef.current.x;
          py = localPoseRef.current.y;
          pz = localPoseRef.current.z;
          pyaw = localPoseRef.current.yaw;
        } else if (worldRef) {
          const remote = worldRef.current.players.find((p) => p.id === fx.casterId);
          if (remote) {
            px = remote.x;
            py = remote.y;
            pz = remote.z;
            pyaw = remote.yaw;
          }
        }
      }

      slot.root.visible = true;
      slot.root.position.set(px, py, pz);
      slot.root.rotation.set(0, pyaw, 0);

      const isSakura = fx.kind === "sakura_dance";
      const isMortal = fx.kind === "mortal_draw" || fx.kind === "mortal_draw_empowered";
      const isEmpowered = isMortal;
      const isExtra = !isSakura && !isMortal;

      // Reset visibility of all pooled meshes in this slot before rendering the active art branch
      if (slot.sakuraPetals) slot.sakuraPetals.visible = isSakura;
      if (slot.sakuraSparkles) slot.sakuraSparkles.visible = isSakura || isExtra;
      if (slot.sakuraWind1) slot.sakuraWind1.visible = false;
      if (slot.sakuraWind2) slot.sakuraWind2.visible = false;
      if (slot.sakuraArc1Outer) slot.sakuraArc1Outer.visible = false;
      if (slot.sakuraArc1Core) slot.sakuraArc1Core.visible = false;
      if (slot.sakuraArc2Outer) slot.sakuraArc2Outer.visible = false;
      if (slot.sakuraArc2Core) slot.sakuraArc2Core.visible = false;
      if (slot.sakuraArc3Outer) slot.sakuraArc3Outer.visible = false;
      if (slot.sakuraArc3Core) slot.sakuraArc3Core.visible = false;
      if (slot.mortalChargeDark) slot.mortalChargeDark.visible = false;
      if (slot.mortalChargeGlow) slot.mortalChargeGlow.visible = false;
      if (slot.mortalWave1Shadow) slot.mortalWave1Shadow.visible = false;
      if (slot.mortalWave1Crimson) slot.mortalWave1Crimson.visible = false;
      if (slot.mortalWave1Core) slot.mortalWave1Core.visible = false;
      if (slot.mortalWave2Shadow) slot.mortalWave2Shadow.visible = false;
      if (slot.mortalWave2Crimson) slot.mortalWave2Crimson.visible = false;
      if (slot.mortalWave2Core) slot.mortalWave2Core.visible = false;
      if (slot.mortalShock1) slot.mortalShock1.visible = false;
      if (slot.mortalShock2) slot.mortalShock2.visible = false;
      if (slot.mortalEmbers) slot.mortalEmbers.visible = isMortal;

      // ---- SAKURA DANCE VFX ----
      if (isSakura) {
        // Explicitly restore default Sakura material colors so pooled slot reuse never leaks tints
        if (slot.sakuraArc1Outer) (slot.sakuraArc1Outer.material as THREE.MeshBasicMaterial).color.copy(COL_SAKURA_ARC1_OUTER);
        if (slot.sakuraArc1Core) (slot.sakuraArc1Core.material as THREE.MeshBasicMaterial).color.copy(COL_SAKURA_ARC1_CORE);
        if (slot.sakuraArc2Outer) (slot.sakuraArc2Outer.material as THREE.MeshBasicMaterial).color.copy(COL_SAKURA_ARC2_OUTER);
        if (slot.sakuraArc2Core) (slot.sakuraArc2Core.material as THREE.MeshBasicMaterial).color.copy(COL_SAKURA_ARC2_CORE);
        if (slot.sakuraArc3Outer) (slot.sakuraArc3Outer.material as THREE.MeshBasicMaterial).color.copy(COL_SAKURA_ARC3_OUTER);
        if (slot.sakuraArc3Core) (slot.sakuraArc3Core.material as THREE.MeshBasicMaterial).color.copy(COL_SAKURA_ARC3_CORE);
        if (slot.sakuraWind1) (slot.sakuraWind1.material as THREE.MeshBasicMaterial).color.copy(COL_SAKURA_WIND1);
        if (slot.sakuraWind2) (slot.sakuraWind2.material as THREE.MeshBasicMaterial).color.copy(COL_SAKURA_WIND2);
        if (slot.sakuraSparkles) {
          const spMat = slot.sakuraSparkles.material as THREE.PointsMaterial;
          spMat.color.copy(COL_SAKURA_SPARKLE);
          spMat.size = 0.13;
        }

        const lifeT = elapsedMs / totalLifeMs;
        const sec = elapsedMs * 0.001;

        // Helper for the 3 distinct aerial curved slash arcs
        const updateSakuraArc = (
          outer: THREE.Mesh | null,
          core: THREE.Mesh | null,
          startMs: number,
          durMs: number,
          heightY: number,
          tiltX: number,
          tiltZ: number,
          yawStart: number,
          yawEnd: number,
          baseScale: number
        ) => {
          if (!outer || !core) return;
          const local = (elapsedMs - startMs) / durMs;
          if (local < 0 || local > 1) return;

          const easeOut = 1 - Math.pow(1 - local, 2.2);
          const fade = Math.sin(Math.min(1, local) * Math.PI) * Math.pow(1 - local, 0.45);
          const scale = baseScale * (0.78 + easeOut * 0.56);
          const sweepYaw = yawStart + (yawEnd - yawStart) * easeOut;

          outer.visible = true;
          outer.position.set(0, heightY, 0.15);
          outer.rotation.set(tiltX, sweepYaw, tiltZ);
          outer.scale.set(scale, scale, scale);
          (outer.material as THREE.MeshBasicMaterial).opacity = fade * 0.88;

          core.visible = true;
          core.position.set(0, heightY + 0.02, 0.18);
          core.rotation.set(tiltX, sweepYaw, tiltZ);
          core.scale.set(scale * 1.02, scale * 1.02, scale * 1.02);
          (core.material as THREE.MeshBasicMaterial).opacity = fade * 0.96;
        };

        // 1. Rising diagonal aerial slash
        updateSakuraArc(
          slot.sakuraArc1Outer,
          slot.sakuraArc1Core,
          240,
          340,
          1.25,
          0.18,
          0.46,
          -1.15,
          1.05,
          1.05
        );
        // 2. High inverted cross slash
        updateSakuraArc(
          slot.sakuraArc2Outer,
          slot.sakuraArc2Core,
          590,
          360,
          1.98,
          -0.22,
          -0.52,
          1.25,
          -1.18,
          1.18
        );
        // 3. Descending wide crescent cleave
        updateSakuraArc(
          slot.sakuraArc3Outer,
          slot.sakuraArc3Core,
          970,
          420,
          1.22,
          0.26,
          0.34,
          -1.35,
          1.35,
          1.34
        );

        // Subtle airborne wind rings
        if (slot.sakuraWind1 && elapsedMs > 180 && elapsedMs < 960) {
          const w1 = (elapsedMs - 180) / 780;
          slot.sakuraWind1.visible = true;
          slot.sakuraWind1.position.set(0, 0.45 + w1 * 1.55, 0);
          slot.sakuraWind1.rotation.set(-Math.PI * 0.5, 0, w1 * Math.PI * 3.5);
          const sc = 0.72 + w1 * 1.25;
          slot.sakuraWind1.scale.set(sc, sc, 1);
          (slot.sakuraWind1.material as THREE.MeshBasicMaterial).opacity =
            Math.sin(w1 * Math.PI) * 0.45;
        }
        if (slot.sakuraWind2 && elapsedMs > 760 && elapsedMs < 1520) {
          const w2 = (elapsedMs - 760) / 760;
          slot.sakuraWind2.visible = true;
          slot.sakuraWind2.position.set(0, 1.85 - w2 * 1.35, 0.15);
          slot.sakuraWind2.rotation.set(-Math.PI * 0.5, 0, -w2 * Math.PI * 4.0);
          const sc = 0.85 + w2 * 1.55;
          slot.sakuraWind2.scale.set(sc, sc, 1);
          (slot.sakuraWind2.material as THREE.MeshBasicMaterial).opacity =
            Math.sin(w2 * Math.PI) * 0.52;
        }

        // 90 Instanced swirling cherry blossom petals (helical rise -> bloom outward -> flutter down)
        if (slot.sakuraPetals) {
          const fadeOut = lifeT > 0.72 ? Math.max(0, 1 - (lifeT - 0.72) / 0.28) : 1;
          const fadeIn = Math.min(1, elapsedMs / 160);
          const petalAlpha = fadeIn * fadeOut;

          for (let i = 0; i < SAKURA_PETAL_COUNT; i++) {
            const seed = petalSeeds[i];
            const risePhase = Math.min(1, sec / 1.05);
            const fallPhase = Math.max(0, sec - 1.05);

            const helixAngle = seed.phase + sec * (2.6 + seed.helixTurns * 1.35);
            const r =
              seed.radiusBase +
              Math.sin(risePhase * Math.PI * 0.75) * seed.radiusSpread +
              fallPhase * 0.75;
            const yPos = Math.max(
              0.08,
              0.35 +
                Math.sin(risePhase * Math.PI * 0.5) * seed.heightRise -
                fallPhase * fallPhase * 0.88 +
                Math.sin(sec * seed.flutterFreq + seed.phase) * 0.16
            );

            _dummy.position.set(
              Math.cos(helixAngle) * r + Math.sin(sec * seed.flutterFreq) * 0.14,
              yPos,
              Math.sin(helixAngle) * r + Math.cos(sec * seed.flutterFreq * 0.8) * 0.14
            );
            _dummy.rotation.set(
              sec * seed.spinSpeedX + seed.phase,
              sec * seed.spinSpeedY,
              sec * seed.spinSpeedZ
            );
            const sScale = seed.scale * (0.35 + 0.65 * petalAlpha);
            _dummy.scale.set(sScale, sScale, sScale);
            _dummy.updateMatrix();
            slot.sakuraPetals.setMatrixAt(i, _dummy.matrix);
          }
          slot.sakuraPetals.instanceMatrix.needsUpdate = true;
          (slot.sakuraPetals.material as THREE.MeshBasicMaterial).opacity = petalAlpha * 0.92;
        }

        // Shimmering sakura sparkle particles
        if (slot.sakuraSparkles) {
          const posAttr = resources.sparkleGeos[s].getAttribute("position") as THREE.BufferAttribute;
          const arr = posAttr.array as Float32Array;
          const sparkAlpha =
            Math.min(1, elapsedMs / 200) * Math.max(0, 1 - Math.max(0, lifeT - 0.55) / 0.45);
          for (let i = 0; i < SAKURA_SPARKLE_COUNT; i++) {
            const sp = sparkleSeeds[i];
            const ang = sp.angle + sec * sp.speed * 1.4;
            const rad = sp.radius * (0.65 + lifeT * 0.9);
            arr[i * 3] = Math.cos(ang) * rad;
            arr[i * 3 + 1] =
              0.35 + sp.height * Math.sin(Math.min(1, lifeT * 1.35) * Math.PI * 0.78) +
              Math.sin(sec * 6 + sp.phase) * 0.12;
            arr[i * 3 + 2] = Math.sin(ang) * rad;
          }
          posAttr.needsUpdate = true;
          (slot.sakuraSparkles.material as THREE.PointsMaterial).opacity = sparkAlpha * 0.9;
        }
      }

      // ---- MORTAL DRAW / EMPOWERED MORTAL DRAW VFX ----
      if (isMortal) {
        // Explicitly restore default Mortal material colors so pooled slot reuse never leaks tints
        if (slot.mortalChargeDark) (slot.mortalChargeDark.material as THREE.MeshBasicMaterial).color.copy(COL_MORTAL_CHARGE_DARK);
        if (slot.mortalChargeGlow) (slot.mortalChargeGlow.material as THREE.MeshBasicMaterial).color.copy(COL_MORTAL_CHARGE_GLOW);
        if (slot.mortalWave1Shadow) (slot.mortalWave1Shadow.material as THREE.MeshBasicMaterial).color.copy(COL_MORTAL_W1_SHADOW);
        if (slot.mortalWave1Crimson) (slot.mortalWave1Crimson.material as THREE.MeshBasicMaterial).color.copy(COL_MORTAL_W1_CRIMSON);
        if (slot.mortalWave1Core) (slot.mortalWave1Core.material as THREE.MeshBasicMaterial).color.copy(COL_MORTAL_W1_CORE);
        if (slot.mortalWave2Shadow) (slot.mortalWave2Shadow.material as THREE.MeshBasicMaterial).color.copy(COL_MORTAL_W2_SHADOW);
        if (slot.mortalWave2Crimson) (slot.mortalWave2Crimson.material as THREE.MeshBasicMaterial).color.copy(COL_MORTAL_W2_CRIMSON);
        if (slot.mortalWave2Core) (slot.mortalWave2Core.material as THREE.MeshBasicMaterial).color.copy(COL_MORTAL_W2_CORE);
        if (slot.mortalShock1) (slot.mortalShock1.material as THREE.MeshBasicMaterial).color.copy(COL_MORTAL_SHOCK1);
        if (slot.mortalShock2) (slot.mortalShock2.material as THREE.MeshBasicMaterial).color.copy(COL_MORTAL_SHOCK2);

        const sec = elapsedMs * 0.001;

        // 1. Coiling Crimson-and-Black Charging Aura (0..500ms, plus 780..1080ms reverse coil when empowered)
        const charge1 = elapsedMs <= 520 ? elapsedMs / 520 : -1;
        const charge2 =
          isEmpowered && elapsedMs >= 780 && elapsedMs <= 1080
            ? (elapsedMs - 780) / 300
            : -1;
        const chargeT = charge1 >= 0 ? charge1 : charge2;

        if (chargeT >= 0 && slot.mortalChargeDark && slot.mortalChargeGlow) {
          const pulse = 0.85 + Math.sin(chargeT * Math.PI * 5) * 0.15;
          const shrink = 1.45 - chargeT * 0.52; // Coils inward into the blade!
          const alpha = Math.sin(chargeT * Math.PI) * 0.92;

          slot.mortalChargeDark.visible = true;
          slot.mortalChargeDark.position.set(0, 0.12 + chargeT * 0.35, 0);
          slot.mortalChargeDark.rotation.set(-Math.PI * 0.5, 0, -sec * 7.5);
          slot.mortalChargeDark.scale.set(shrink * 1.25, shrink * 1.25, 1);
          (slot.mortalChargeDark.material as THREE.MeshBasicMaterial).opacity = alpha * 0.86;

          slot.mortalChargeGlow.visible = true;
          slot.mortalChargeGlow.position.set(0, 0.16 + chargeT * 0.45, 0);
          slot.mortalChargeGlow.rotation.set(-Math.PI * 0.5, 0, sec * 9.5);
          slot.mortalChargeGlow.scale.set(shrink * pulse, shrink * pulse, 1);
          (slot.mortalChargeGlow.material as THREE.MeshBasicMaterial).opacity = alpha * 0.95;
        }

        // Helper for colossal double-layered Mortal Blade crescent waves
        const updateMortalWave = (
          shadow: THREE.Mesh | null,
          crimson: THREE.Mesh | null,
          core: THREE.Mesh | null,
          startMs: number,
          durMs: number,
          heightY: number,
          tiltX: number,
          tiltZ: number,
          yawStart: number,
          yawEnd: number,
          maxScale: number
        ) => {
          if (!shadow || !crimson || !core) return;
          const local = (elapsedMs - startMs) / durMs;
          if (local < 0 || local > 1) return;

          const burst = 1 - Math.pow(1 - local, 3.0);
          const fade = Math.pow(1 - local, 1.15) * Math.min(1, local * 8);
          const scale = 0.65 + burst * (maxScale - 0.65);
          const sweepYaw = yawStart + (yawEnd - yawStart) * burst;
          const lungeZ = 0.2 + burst * 0.95;

          // Pitch-black shadow rim (NormalBlending, slightly larger & behind)
          shadow.visible = true;
          shadow.position.set(0, heightY - 0.03, lungeZ - 0.06);
          shadow.rotation.set(tiltX, sweepYaw, tiltZ);
          shadow.scale.set(scale * 1.07, scale * 1.07, scale * 1.07);
          (shadow.material as THREE.MeshBasicMaterial).opacity = fade * 0.9;

          // Blinding blood-crimson middle body (AdditiveBlending)
          crimson.visible = true;
          crimson.position.set(0, heightY, lungeZ);
          crimson.rotation.set(tiltX, sweepYaw, tiltZ);
          crimson.scale.set(scale, scale, scale);
          (crimson.material as THREE.MeshBasicMaterial).opacity = fade * 0.96;

          // Molten scarlet-white leading razor edge (AdditiveBlending)
          core.visible = true;
          core.position.set(0, heightY + 0.02, lungeZ + 0.05);
          core.rotation.set(tiltX, sweepYaw, tiltZ);
          core.scale.set(scale * 1.03, scale * 1.03, scale * 1.03);
          (core.material as THREE.MeshBasicMaterial).opacity = Math.pow(fade, 0.85) * 0.92;
        };

        // First Colossal Mortal Blade Wave (right-to-left violent horizontal/diagonal draw)
        updateMortalWave(
          slot.mortalWave1Shadow,
          slot.mortalWave1Crimson,
          slot.mortalWave1Core,
          470,
          560,
          1.16,
          0.08,
          0.18,
          -0.95,
          0.85,
          isEmpowered ? 1.52 : 1.38
        );

        // First expanding dark-crimson ground shockwave ring
        if (slot.mortalShock1 && elapsedMs >= 490 && elapsedMs <= 1080) {
          const st = (elapsedMs - 490) / 590;
          const ease = 1 - Math.pow(1 - st, 2.5);
          slot.mortalShock1.visible = true;
          slot.mortalShock1.position.set(0, 0.09, 0.55);
          slot.mortalShock1.rotation.set(-Math.PI * 0.5, 0, st * 2.4);
          const sc = 0.55 + ease * (isEmpowered ? 2.45 : 2.15);
          slot.mortalShock1.scale.set(sc, sc, 1);
          (slot.mortalShock1.material as THREE.MeshBasicMaterial).opacity =
            Math.pow(1 - st, 1.35) * 0.82;
        }

        // Second Reversed Colossal Mortal Wave (Empowered Draw only!)
        if (isEmpowered) {
          updateMortalWave(
            slot.mortalWave2Shadow,
            slot.mortalWave2Crimson,
            slot.mortalWave2Core,
            1040,
            660,
            1.28,
            -0.12,
            -0.28,
            1.15,
            -1.05,
            1.78
          );

          if (slot.mortalShock2 && elapsedMs >= 1060 && elapsedMs <= 1780) {
            const st = (elapsedMs - 1060) / 720;
            const ease = 1 - Math.pow(1 - st, 2.5);
            slot.mortalShock2.visible = true;
            slot.mortalShock2.position.set(0, 0.11, 0.85);
            slot.mortalShock2.rotation.set(-Math.PI * 0.5, 0, -st * 3.1);
            const sc = 0.68 + ease * 2.95;
            slot.mortalShock2.scale.set(sc, sc, 1);
            (slot.mortalShock2.material as THREE.MeshBasicMaterial).opacity =
              Math.pow(1 - st, 1.3) * 0.9;
          }
        }

        // Rising dark-crimson charge embers -> violent forward impact burst on each wave!
        if (slot.mortalEmbers) {
          const posAttr = resources.emberGeos[s].getAttribute("position") as THREE.BufferAttribute;
          const arr = posAttr.array as Float32Array;
          const lifeT = elapsedMs / totalLifeMs;
          const inCharge = elapsedMs < 480;
          const postSecond = isEmpowered && elapsedMs >= 1050;
          const burstSec = postSecond
            ? (elapsedMs - 1050) * 0.001
            : Math.max(0, (elapsedMs - 480) * 0.001);

          for (let i = 0; i < MORTAL_EMBER_COUNT; i++) {
            const em = emberSeeds[i];
            if (inCharge) {
              const ct = elapsedMs / 480;
              const swirl = em.phase + sec * 5.2;
              const r = em.radius * (1.25 - ct * 0.55);
              arr[i * 3] = Math.cos(swirl) * r;
              arr[i * 3 + 1] = 0.15 + ((em.height + sec * 2.1) % 2.1);
              arr[i * 3 + 2] = Math.sin(swirl) * r;
            } else {
              // Forward spray across the crescent slash arc
              const dir = postSecond ? -1 : 1;
              const spreadAngle = em.angle * dir;
              const dist = 0.8 + burstSec * em.speed * (isEmpowered ? 1.55 : 1.25);
              arr[i * 3] = Math.sin(spreadAngle) * dist;
              arr[i * 3 + 1] = Math.max(
                0.08,
                0.85 + em.height * 0.65 + Math.sin(em.phase + burstSec * 4) * 0.35 - burstSec * 0.5
              );
              arr[i * 3 + 2] = Math.cos(spreadAngle) * dist + 0.35;
            }
          }
          posAttr.needsUpdate = true;
          const emberFade =
            Math.min(1, elapsedMs / 120) * Math.max(0, 1 - Math.max(0, lifeT - 0.62) / 0.38);
          (slot.mortalEmbers.material as THREE.PointsMaterial).opacity = emberFade * 0.95;
        }
      }

      // ---- 11 EXTRA SEKIRO COMBAT ARTS VFX (Pooled, Zero-Alloc, Per-Art Choreographed) ----
      if (isExtra) {
        const extraKind = fx.kind as ExtraArtKind;
        const pal = EXTRA_ART_PALETTES[extraKind];
        const sec = elapsedMs * 0.001;
        const lifeT = elapsedMs / totalLifeMs;
        let sparkMode: "vortex" | "beam" | "burst" | "dimensional" = "burst";

        switch (extraKind) {
          case "ichimonji": {
            // Overhead Jodan charge -> towering azure vertical cleave + posture-restoring aura ring
            updateTintedRing(
              slot.mortalChargeDark, elapsedMs, 0, 350, 0.14, 0.6, 0, 0, -Math.PI * 0.5, 0, -4.5, 1.35, 0.72, pal.shadow, 0.78
            );
            updateTintedRing(
              slot.mortalChargeGlow, elapsedMs, 0, 350, 0.18, 0.78, 0, 0, -Math.PI * 0.5, 0, 6.2, 1.2, 0.62, pal.primary, 0.92
            );
            updateTintedHeavyWave(
              slot.mortalWave1Shadow, slot.mortalWave1Crimson, slot.mortalWave1Core,
              elapsedMs, 340, 420, 1.25, 0.15, 0.95, -0.95, 0.38, 0, 0, Math.PI * 0.5, 0.95, 1.18, 1.15,
              pal.shadow, pal.primary, pal.core
            );
            updateTintedArcPair(
              slot.sakuraArc1Outer, slot.sakuraArc1Core,
              elapsedMs, 350, 360, 1.22, 0.25, 1.1, -0.9, 0.34, 0, 0, Math.PI * 0.5, 1.05, 1.25, 1.2,
              pal.secondary, pal.core
            );
            updateTintedRing(
              slot.mortalShock1, elapsedMs, 410, 480, 0.09, 0.09, 0.9, 1.35, -Math.PI * 0.5, 0, 2.2, 0.45, 2.05, pal.primary, 0.85
            );
            updateTintedRing(
              slot.sakuraWind1, elapsedMs, 420, 520, 0.2, 1.9, 0, 0.1, -Math.PI * 0.5, 0, 5.2, 0.65, 1.4, pal.ring, 0.62
            );
            sparkMode = "burst";
            break;
          }

          case "ichimonji_double": {
            // Twin overhead vertical azure splits + escalating posture crush shockwaves
            if (elapsedMs < 360) {
              updateTintedRing(slot.mortalChargeGlow, elapsedMs, 0, 330, 0.16, 0.72, 0, 0, -Math.PI * 0.5, 0, 5.8, 1.2, 0.6, pal.primary, 0.88);
            } else {
              updateTintedRing(slot.mortalChargeGlow, elapsedMs, 600, 260, 0.22, 0.95, 0.1, 0.15, -Math.PI * 0.5, 0, -6.4, 1.32, 0.65, pal.secondary, 0.94);
            }
            updateTintedHeavyWave(
              slot.mortalWave1Shadow, slot.mortalWave1Crimson, slot.mortalWave1Core,
              elapsedMs, 320, 390, 1.22, 0.15, 0.9, -0.92, 0.36, 0.06, -0.04, Math.PI * 0.5, 0.92, 1.15, 1.1,
              pal.shadow, pal.primary, pal.core
            );
            updateTintedRing(
              slot.mortalShock1, elapsedMs, 380, 440, 0.09, 0.09, 0.85, 1.2, -Math.PI * 0.5, 0, 2.0, 0.45, 1.9, pal.primary, 0.78
            );
            updateTintedHeavyWave(
              slot.mortalWave2Shadow, slot.mortalWave2Crimson, slot.mortalWave2Core,
              elapsedMs, 860, 490, 1.32, 0.25, 1.25, -1.02, 0.42, -0.05, 0.04, Math.PI * 0.5, 1.1, 1.38, 1.32,
              pal.shadow, pal.secondary, pal.core
            );
            updateTintedArcPair(
              slot.sakuraArc2Outer, slot.sakuraArc2Core,
              elapsedMs, 870, 420, 1.3, 0.35, 1.4, -0.98, 0.38, 0, 0, Math.PI * 0.5, 1.15, 1.42, 1.35,
              pal.primary, pal.core
            );
            updateTintedRing(
              slot.mortalShock2, elapsedMs, 930, 520, 0.1, 0.1, 1.05, 1.65, -Math.PI * 0.5, 0, -2.8, 0.55, 2.45, pal.secondary, 0.92
            );
            updateTintedRing(
              slot.sakuraWind1, elapsedMs, 920, 520, 0.2, 2.1, 0.1, 0.25, -Math.PI * 0.5, 0, 6.0, 0.7, 1.65, pal.ring, 0.65
            );
            sparkMode = "burst";
            break;
          }

          case "ashina_cross": {
            // Sheathed glint -> twin razor-sharp +-38 deg (0.663 rad) intersecting X-arcs
            updateTintedRing(
              slot.mortalChargeGlow, elapsedMs, 0, 320, 0.92, 0.96, 0.12, 0.18, 0, 0, 4.5, 0.85, 0.22, pal.core, 0.96
            );
            updateTintedRing(
              slot.sakuraWind1, elapsedMs, 240, 220, 0.94, 0.96, 0.15, 0.3, 0, 0, -3.2, 0.25, 1.45, pal.ring, 0.85
            );
            // X-Arc 1 (+38 deg)
            updateTintedHeavyWave(
              slot.mortalWave1Shadow, slot.mortalWave1Crimson, slot.mortalWave1Core,
              elapsedMs, 330, 380, 1.12, 0.25, 1.35, 0.08, -0.06, -1.15, 1.05, 0.663, 1.05, 1.05, 1.18,
              pal.shadow, pal.primary, pal.core
            );
            updateTintedArcPair(
              slot.sakuraArc1Outer, slot.sakuraArc1Core,
              elapsedMs, 340, 360, 1.14, 0.35, 1.45, 0.08, -0.06, -1.2, 1.1, 0.663, 1.12, 1.12, 1.24,
              pal.secondary, pal.core
            );
            // X-Arc 2 (-38 deg) completing the glowing Ashina Cross
            updateTintedHeavyWave(
              slot.mortalWave2Shadow, slot.mortalWave2Crimson, slot.mortalWave2Core,
              elapsedMs, 445, 420, 1.16, 0.35, 1.55, -0.08, 0.06, 1.18, -1.08, -0.663, 1.12, 1.12, 1.24,
              pal.shadow, pal.secondary, pal.core
            );
            updateTintedArcPair(
              slot.sakuraArc2Outer, slot.sakuraArc2Core,
              elapsedMs, 455, 390, 1.18, 0.45, 1.65, -0.08, 0.06, 1.22, -1.12, -0.663, 1.18, 1.18, 1.3,
              pal.primary, pal.core
            );
            updateTintedRing(
              slot.mortalShock1, elapsedMs, 450, 440, 0.1, 0.1, 0.85, 1.4, -Math.PI * 0.5, 0, 2.8, 0.45, 2.15, pal.primary, 0.78
            );
            sparkMode = "burst";
            break;
          }

          case "dragon_flash": {
            // Sword-Saint wind gather -> racing 7m forward gale beam + delayed massive shockwave detonation
            updateTintedRing(
              slot.mortalChargeDark, elapsedMs, 0, 370, 0.14, 0.52, 0, 0, -Math.PI * 0.5, 0, -6.5, 1.5, 0.6, pal.shadow, 0.8
            );
            updateTintedRing(
              slot.mortalChargeGlow, elapsedMs, 0, 370, 0.18, 0.62, 0, 0.1, -Math.PI * 0.5, 0, 8.2, 1.35, 0.55, pal.primary, 0.95
            );
            // Racing 7m forward beam (vertical + horizontal crossed gale blade racing to z=6.6m)
            updateTintedHeavyWave(
              slot.mortalWave1Shadow, slot.mortalWave1Crimson, slot.mortalWave1Core,
              elapsedMs, 370, 430, 1.12, 0.4, 6.4, -0.18, 0.06, 0, 0, Math.PI * 0.5, 0.75, 1.25, 2.05,
              pal.shadow, pal.primary, pal.core
            );
            updateTintedArcPair(
              slot.sakuraArc1Outer, slot.sakuraArc1Core,
              elapsedMs, 380, 400, 1.1, 0.5, 6.6, 0.04, 0.04, -0.25, 0.25, 0, 0.78, 1.0, 2.15,
              pal.secondary, pal.core
            );
            updateTintedRing(
              slot.sakuraWind1, elapsedMs, 380, 420, 1.12, 1.14, 0.6, 5.4, 0, 0, 9.0, 0.45, 1.85, pal.ring, 0.82
            );
            // Delayed vacuum shockwave eruption (740..1240ms) racing out to 7.2m
            updateTintedHeavyWave(
              slot.mortalWave2Shadow, slot.mortalWave2Crimson, slot.mortalWave2Core,
              elapsedMs, 740, 520, 1.2, 0.8, 7.1, -0.22, 0.12, 0, 0, Math.PI * 0.5, 1.15, 1.65, 2.35,
              pal.shadow, pal.secondary, pal.core
            );
            updateTintedArcPair(
              slot.sakuraArc2Outer, slot.sakuraArc2Core,
              elapsedMs, 750, 480, 1.16, 1.0, 7.2, 0, 0, -0.35, 0.35, 0.18, 1.2, 1.25, 2.3,
              pal.primary, pal.core
            );
            updateTintedRing(
              slot.mortalShock1, elapsedMs, 750, 520, 0.1, 0.1, 2.2, 4.0, -Math.PI * 0.5, 0, 3.6, 0.6, 2.65, pal.primary, 0.88
            );
            updateTintedRing(
              slot.mortalShock2, elapsedMs, 810, 520, 0.11, 0.11, 4.4, 6.4, -Math.PI * 0.5, 0, -4.2, 0.7, 3.05, pal.secondary, 0.92
            );
            sparkMode = "beam";
            break;
          }

          case "whirlwind_slash": {
            // 360 deg twin emerald-mint spinning cuts + twin swirling wind rings
            updateTintedHeavyWave(
              slot.mortalWave1Shadow, slot.mortalWave1Crimson, slot.mortalWave1Core,
              elapsedMs, 200, 380, 1.02, 0, 0.2, 0.06, 0.06, -1.6, 4.6, 0.12, 1.08, 1.0, 1.08,
              pal.shadow, pal.primary, pal.core
            );
            updateTintedArcPair(
              slot.sakuraArc1Outer, slot.sakuraArc1Core,
              elapsedMs, 210, 360, 1.06, 0, 0.25, 0.08, -0.05, -1.2, 5.1, -0.1, 1.18, 1.0, 1.18,
              pal.secondary, pal.core
            );
            updateTintedHeavyWave(
              slot.mortalWave2Shadow, slot.mortalWave2Crimson, slot.mortalWave2Core,
              elapsedMs, 490, 440, 1.08, 0.05, 0.32, -0.06, 0.08, 0.6, 7.0, -0.14, 1.24, 1.05, 1.24,
              pal.shadow, pal.secondary, pal.core
            );
            updateTintedRing(
              slot.sakuraWind1, elapsedMs, 180, 680, 0.55, 1.35, 0, 0.2, -Math.PI * 0.5, 0, 11.0, 0.85, 2.25, pal.ring, 0.72
            );
            updateTintedRing(
              slot.sakuraWind2, elapsedMs, 440, 580, 1.2, 0.5, 0.1, 0.3, -Math.PI * 0.5, 0, -12.0, 0.95, 2.55, pal.primary, 0.68
            );
            updateTintedRing(
              slot.mortalShock1, elapsedMs, 520, 480, 0.09, 0.09, 0.15, 0.35, -Math.PI * 0.5, 0, 3.0, 0.55, 2.15, pal.primary, 0.76
            );
            sparkMode = "vortex";
            break;
          }

          case "nightjar_slash": {
            // Acrobatic somersault wind halo -> fierce vertical diving cleave + landing shockwave
            updateTintedRing(
              slot.sakuraWind1, elapsedMs, 100, 420, 0.35, 1.65, 0.05, 0.5, -Math.PI * 0.5, 0, 7.5, 0.6, 1.45, pal.ring, 0.7
            );
            updateTintedRing(
              slot.sakuraWind2, elapsedMs, 160, 400, 1.25, 1.35, 0.2, 0.75, 0, 0, 10.5, 0.5, 1.35, pal.secondary, 0.64
            );
            updateTintedHeavyWave(
              slot.mortalWave1Shadow, slot.mortalWave1Crimson, slot.mortalWave1Core,
              elapsedMs, 420, 440, 1.28, 0.2, 1.2, -1.15, 0.45, 0, 0, Math.PI * 0.5, 0.96, 1.24, 1.22,
              pal.shadow, pal.primary, pal.core
            );
            updateTintedArcPair(
              slot.sakuraArc1Outer, slot.sakuraArc1Core,
              elapsedMs, 430, 380, 1.24, 0.28, 1.3, -1.05, 0.4, 0, 0, Math.PI * 0.5, 1.1, 1.32, 1.28,
              pal.secondary, pal.core
            );
            updateTintedRing(
              slot.mortalShock1, elapsedMs, 510, 480, 0.09, 0.09, 0.75, 1.25, -Math.PI * 0.5, 0, 2.5, 0.48, 2.2, pal.secondary, 0.85
            );
            sparkMode = "burst";
            break;
          }

          case "floating_passage": {
            // Tomoe 5-stroke flowing azure/teal cyclone flurry
            updateTintedArcPair(
              slot.sakuraArc1Outer, slot.sakuraArc1Core,
              elapsedMs, 150, 250, 1.02, 0.12, 0.55, 0.14, -0.1, -1.25, 1.15, 0.44, 1.05, 1.0, 1.05,
              pal.primary, pal.core
            );
            updateTintedArcPair(
              slot.sakuraArc2Outer, slot.sakuraArc2Core,
              elapsedMs, 345, 250, 1.12, 0.18, 0.68, -0.12, 0.12, 1.28, -1.18, -0.44, 1.1, 1.0, 1.1,
              pal.secondary, pal.core
            );
            updateTintedHeavyWave(
              slot.mortalWave1Shadow, slot.mortalWave1Crimson, slot.mortalWave1Core,
              elapsedMs, 540, 310, 1.04, 0.08, 0.42, 0.06, -0.04, -1.7, 3.6, 0.1, 1.05, 1.0, 1.05,
              pal.shadow, pal.primary, pal.core
            );
            updateTintedArcPair(
              slot.sakuraArc3Outer, slot.sakuraArc3Core,
              elapsedMs, 745, 250, 1.15, 0.22, 0.78, 0.16, -0.12, -1.3, 1.2, 0.54, 1.14, 1.05, 1.14,
              pal.secondary, pal.core
            );
            updateTintedHeavyWave(
              slot.mortalWave2Shadow, slot.mortalWave2Crimson, slot.mortalWave2Core,
              elapsedMs, 940, 380, 1.26, 0.25, 1.05, -0.26, 0.22, 1.35, -1.35, -0.38, 1.22, 1.15, 1.26,
              pal.shadow, pal.secondary, pal.core
            );
            updateTintedRing(
              slot.sakuraWind1, elapsedMs, 140, 1120, 0.35, 1.65, 0.1, 0.45, -Math.PI * 0.5, 0, 15.0, 0.75, 2.05, pal.ring, 0.62
            );
            updateTintedRing(
              slot.sakuraWind2, elapsedMs, 420, 920, 1.35, 0.45, 0.15, 0.55, -Math.PI * 0.5, 0, -14.0, 0.85, 2.25, pal.secondary, 0.56
            );
            updateTintedRing(
              slot.mortalShock1, elapsedMs, 960, 420, 0.09, 0.09, 0.5, 0.95, -Math.PI * 0.5, 0, 3.2, 0.5, 2.0, pal.primary, 0.8
            );
            sparkMode = "vortex";
            break;
          }

          case "shadowrush": {
            // Coiled shadow spear -> blistering lance pierce + Owl Vault rings + descending Falcon Plunge
            updateTintedRing(
              slot.mortalChargeDark, elapsedMs, 0, 240, 0.14, 0.28, -0.1, 0, -Math.PI * 0.5, 0, -5.0, 1.25, 0.55, pal.shadow, 0.8
            );
            updateTintedRing(
              slot.mortalChargeGlow, elapsedMs, 0, 240, 0.18, 0.34, -0.05, 0.05, -Math.PI * 0.5, 0, 6.2, 1.15, 0.5, pal.primary, 0.9
            );
            // Spear Pierce (crossed horizontal + vertical forward-stretched lance)
            updateTintedHeavyWave(
              slot.mortalWave1Shadow, slot.mortalWave1Crimson, slot.mortalWave1Core,
              elapsedMs, 240, 340, 1.04, 0.25, 4.4, 0, 0, 0, 0, Math.PI * 0.5, 0.52, 0.72, 2.05,
              pal.shadow, pal.primary, pal.core
            );
            updateTintedArcPair(
              slot.sakuraArc1Outer, slot.sakuraArc1Core,
              elapsedMs, 250, 320, 1.04, 0.3, 4.5, 0, 0, -0.18, 0.18, 0, 0.56, 0.72, 2.1,
              pal.secondary, pal.core
            );
            // Forward-facing sonic spear launch ring + high Owl Vault airborne ring
            updateTintedRing(
              slot.sakuraWind1, elapsedMs, 250, 320, 1.04, 1.08, 0.4, 3.6, 0, 0, 8.5, 0.4, 1.65, pal.ring, 0.86
            );
            updateTintedRing(
              slot.sakuraWind2, elapsedMs, 520, 420, 1.4, 1.75, 0.3, 0.55, -Math.PI * 0.5, 0, -7.2, 0.55, 1.85, pal.secondary, 0.78
            );
            // Descending Falcon Plunge vertical cleave + twin plunge shockwave rings
            updateTintedHeavyWave(
              slot.mortalWave2Shadow, slot.mortalWave2Crimson, slot.mortalWave2Core,
              elapsedMs, 850, 420, 1.24, 0.25, 1.35, -1.05, 0.42, 0, 0, Math.PI * 0.5, 1.02, 1.28, 1.26,
              pal.shadow, pal.secondary, pal.core
            );
            updateTintedArcPair(
              slot.sakuraArc2Outer, slot.sakuraArc2Core,
              elapsedMs, 860, 380, 1.2, 0.35, 1.45, -1.0, 0.38, 0, 0, Math.PI * 0.5, 1.1, 1.34, 1.3,
              pal.primary, pal.core
            );
            updateTintedRing(
              slot.mortalShock1, elapsedMs, 890, 440, 0.09, 0.09, 0.75, 1.2, -Math.PI * 0.5, 0, 2.8, 0.48, 2.35, pal.primary, 0.86
            );
            updateTintedRing(
              slot.mortalShock2, elapsedMs, 930, 460, 0.11, 0.11, 0.8, 1.3, -Math.PI * 0.5, 0, -3.5, 0.58, 2.8, pal.secondary, 0.78
            );
            sparkMode = "burst";
            break;
          }

          case "spiral_cloud_passage": {
            // Mushin 4-stage swirling violet-azure cyclone sword dance
            updateTintedArcPair(
              slot.sakuraArc1Outer, slot.sakuraArc1Core,
              elapsedMs, 165, 290, 1.02, 0.05, 0.35, 0.12, -0.06, -1.6, 3.2, 0.24, 1.12, 1.05, 1.12,
              pal.primary, pal.core
            );
            updateTintedArcPair(
              slot.sakuraArc2Outer, slot.sakuraArc2Core,
              elapsedMs, 375, 290, 1.32, 0.08, 0.45, -0.1, 0.1, 1.4, -3.6, -0.28, 1.24, 1.1, 1.24,
              pal.secondary, pal.core
            );
            updateTintedHeavyWave(
              slot.mortalWave1Shadow, slot.mortalWave1Crimson, slot.mortalWave1Core,
              elapsedMs, 580, 340, 1.42, 0.1, 0.52, 0.08, -0.08, -2.0, 4.4, 0.16, 1.22, 1.12, 1.22,
              pal.shadow, pal.primary, pal.core
            );
            updateTintedHeavyWave(
              slot.mortalWave2Shadow, slot.mortalWave2Crimson, slot.mortalWave2Core,
              elapsedMs, 840, 520, 1.2, 0.15, 0.85, -0.14, 0.14, -1.8, 5.4, -0.22, 1.42, 1.22, 1.42,
              pal.shadow, pal.secondary, pal.core
            );
            updateTintedArcPair(
              slot.sakuraArc3Outer, slot.sakuraArc3Core,
              elapsedMs, 860, 460, 1.28, 0.2, 0.9, 0.1, -0.1, 1.6, -4.8, 0.32, 1.48, 1.2, 1.48,
              pal.primary, pal.core
            );
            updateTintedRing(
              slot.sakuraWind1, elapsedMs, 150, 1220, 0.3, 2.05, 0.05, 0.4, -Math.PI * 0.5, 0, 18.0, 0.8, 2.55, pal.ring, 0.76
            );
            updateTintedRing(
              slot.sakuraWind2, elapsedMs, 320, 1080, 1.85, 0.35, 0.1, 0.5, -Math.PI * 0.5, 0, -17.0, 0.95, 2.75, pal.secondary, 0.7
            );
            updateTintedRing(
              slot.mortalShock1, elapsedMs, 870, 520, 0.09, 0.09, 0.35, 0.85, -Math.PI * 0.5, 0, 3.8, 0.6, 2.65, pal.primary, 0.88
            );
            updateTintedRing(
              slot.mortalShock2, elapsedMs, 940, 540, 0.11, 0.11, 0.45, 0.95, -Math.PI * 0.5, 0, -4.4, 0.72, 3.1, pal.secondary, 0.82
            );
            sparkMode = "vortex";
            break;
          }

          case "one_mind": {
            // Sheathed flash draw -> rapid 6-pulse crisscrossing dimensional slashes -> decisive crimson-violet finisher
            updateTintedRing(
              slot.mortalChargeDark, elapsedMs, 0, 270, 0.14, 0.35, 0, 0, -Math.PI * 0.5, 0, -6.0, 1.35, 0.45, pal.shadow, 0.86
            );
            updateTintedRing(
              slot.mortalChargeGlow, elapsedMs, 0, 270, 0.18, 0.42, 0, 0.08, -Math.PI * 0.5, 0, 7.5, 1.2, 0.38, pal.primary, 0.96
            );
            // First Sheathe Flash
            updateTintedHeavyWave(
              slot.mortalWave1Shadow, slot.mortalWave1Crimson, slot.mortalWave1Core,
              elapsedMs, 265, 290, 1.08, 0.25, 1.65, 0.12, -0.08, -1.25, 1.15, 0.38, 1.1, 1.05, 1.28,
              pal.shadow, pal.primary, pal.core
            );
            // Rapid 6-pulse crisscrossing dimensional judgment slashes (490..1100ms)
            for (let p = 0; p < ONE_MIND_PULSES.length; p++) {
              const pulse = ONE_MIND_PULSES[p];
              if (elapsedMs < pulse.startMs || elapsedMs > pulse.startMs + pulse.durMs) continue;
              const outer =
                pulse.slotIdx === 0 ? slot.sakuraArc1Outer : pulse.slotIdx === 1 ? slot.sakuraArc2Outer : slot.sakuraArc3Outer;
              const core =
                pulse.slotIdx === 0 ? slot.sakuraArc1Core : pulse.slotIdx === 1 ? slot.sakuraArc2Core : slot.sakuraArc3Core;
              updateTintedArcPair(
                outer, core,
                elapsedMs, pulse.startMs, pulse.durMs,
                pulse.y, pulse.z - 0.35, pulse.z + 0.35,
                pulse.tiltX, -pulse.tiltX,
                pulse.yawStart, pulse.yawEnd, pulse.rollZ,
                pulse.scale, pulse.scale, pulse.scale * 1.08,
                p % 2 === 0 ? pal.primary : pal.secondary,
                pal.core,
                1.08
              );
            }
            // Dimensional judgement containment rings during phantom flurry
            updateTintedRing(
              slot.sakuraWind1, elapsedMs, 480, 600, 1.15, 1.25, 2.2, 2.6, 0, 0, 9.0, 0.95, 2.15, pal.ring, 0.62
            );
            updateTintedRing(
              slot.sakuraWind2, elapsedMs, 520, 560, 0.12, 0.16, 2.1, 2.5, -Math.PI * 0.5, 0, -8.5, 0.85, 2.35, pal.primary, 0.68
            );
            // Decisive Crimson-Violet Final Cut (1055..1520ms)
            updateTintedHeavyWave(
              slot.mortalWave2Shadow, slot.mortalWave2Crimson, slot.mortalWave2Core,
              elapsedMs, 1055, 480, 1.16, 0.45, 2.35, -0.08, 0.08, 1.35, -1.25, -0.22, 1.48, 1.28, 1.56,
              pal.shadow, pal.secondary, pal.core
            );
            updateTintedRing(
              slot.mortalShock1, elapsedMs, 1075, 480, 0.1, 0.1, 1.35, 2.1, -Math.PI * 0.5, 0, 3.6, 0.6, 2.85, pal.secondary, 0.92
            );
            updateTintedRing(
              slot.mortalShock2, elapsedMs, 1110, 480, 0.12, 0.12, 1.65, 2.45, -Math.PI * 0.5, 0, -4.2, 0.72, 3.2, pal.primary, 0.84
            );
            sparkMode = "dimensional";
            break;
          }

          case "high_monk": {
            // Senpou golden lotus sweep-counter leap -> cascading golden lotus arcs & temple shockwaves
            updateTintedRing(
              slot.sakuraWind1, elapsedMs, 180, 520, 0.35, 1.55, 0.05, 0.35, -Math.PI * 0.5, 0, 8.5, 0.65, 1.95, pal.ring, 0.86
            );
            updateTintedRing(
              slot.sakuraWind2, elapsedMs, 260, 520, 1.45, 0.55, 0.15, 0.45, -Math.PI * 0.5, 0, -8.0, 0.75, 2.1, pal.primary, 0.74
            );
            updateTintedArcPair(
              slot.sakuraArc1Outer, slot.sakuraArc1Core,
              elapsedMs, 220, 320, 1.38, 0.12, 0.65, 0.18, -0.14, -1.4, 1.4, 0.28, 1.15, 1.1, 1.15,
              pal.primary, pal.core
            );
            // Cascading Flurry I golden lotus diagonal
            updateTintedHeavyWave(
              slot.mortalWave1Shadow, slot.mortalWave1Crimson, slot.mortalWave1Core,
              elapsedMs, 540, 340, 1.12, 0.18, 0.95, 0.1, -0.08, 1.25, -1.2, -0.48, 1.12, 1.08, 1.16,
              pal.shadow, pal.primary, pal.core
            );
            updateTintedArcPair(
              slot.sakuraArc2Outer, slot.sakuraArc2Core,
              elapsedMs, 550, 310, 1.16, 0.25, 1.05, 0.12, -0.08, 1.3, -1.25, -0.48, 1.18, 1.12, 1.22,
              pal.secondary, pal.core
            );
            // Senpou Finisher overhead golden lotus vertical split + radiant ground lotus rings
            updateTintedHeavyWave(
              slot.mortalWave2Shadow, slot.mortalWave2Crimson, slot.mortalWave2Core,
              elapsedMs, 810, 440, 1.26, 0.25, 1.25, -0.98, 0.38, 0, 0, Math.PI * 0.5, 1.14, 1.34, 1.3,
              pal.shadow, pal.secondary, pal.core
            );
            updateTintedArcPair(
              slot.sakuraArc3Outer, slot.sakuraArc3Core,
              elapsedMs, 820, 390, 1.24, 0.35, 1.35, -0.94, 0.35, 0, 0, Math.PI * 0.5, 1.22, 1.38, 1.34,
              pal.primary, pal.core
            );
            updateTintedRing(
              slot.mortalShock1, elapsedMs, 840, 460, 0.09, 0.09, 0.7, 1.25, -Math.PI * 0.5, 0, 3.0, 0.55, 2.35, pal.primary, 0.9
            );
            updateTintedRing(
              slot.mortalShock2, elapsedMs, 890, 480, 0.11, 0.11, 0.85, 1.4, -Math.PI * 0.5, 0, -3.6, 0.68, 2.75, pal.ring, 0.8
            );
            sparkMode = "vortex";
            break;
          }
        }

        // Reuse pooled sparkle Points buffer with art-specific color and zero-alloc trajectory
        if (slot.sakuraSparkles) {
          const spMat = slot.sakuraSparkles.material as THREE.PointsMaterial;
          spMat.color.copy(pal.spark);
          spMat.size = sparkMode === "beam" || sparkMode === "dimensional" ? 0.17 : 0.15;

          const posAttr = resources.sparkleGeos[s].getAttribute("position") as THREE.BufferAttribute;
          const arr = posAttr.array as Float32Array;
          const sparkAlpha =
            Math.min(1, elapsedMs / 150) * Math.max(0, 1 - Math.max(0, lifeT - 0.58) / 0.42);

          for (let i = 0; i < SAKURA_SPARKLE_COUNT; i++) {
            const sp = sparkleSeeds[i];
            if (sparkMode === "beam") {
              const beamProgress = Math.max(0, (elapsedMs - 340) * 0.001);
              const zDist = 0.4 + ((sp.phase * 1.1 + beamProgress * sp.speed * 3.8) % 7.0);
              const spread = (0.35 + zDist * 0.12) * Math.sin(sp.angle + sec * 4.0);
              arr[i * 3] = spread;
              arr[i * 3 + 1] = 0.35 + sp.height * 0.68 + Math.cos(sp.phase + sec * 5.0) * 0.25;
              arr[i * 3 + 2] = zDist;
            } else if (sparkMode === "dimensional") {
              const ang = sp.angle + sec * sp.speed * 2.4;
              const rad = 0.65 + (sp.radius * 0.65) * (0.6 + Math.sin(sec * 8.0 + sp.phase) * 0.4);
              arr[i * 3] = Math.cos(ang) * rad;
              arr[i * 3 + 1] = 0.45 + sp.height * 0.72 + Math.sin(sec * 9.0 + sp.phase) * 0.18;
              arr[i * 3 + 2] = 2.25 + Math.sin(ang) * rad * 0.95;
            } else if (sparkMode === "vortex") {
              const ang = sp.angle + sec * sp.speed * 2.8;
              const rad = sp.radius * (0.65 + lifeT * 1.1);
              arr[i * 3] = Math.cos(ang) * rad;
              arr[i * 3 + 1] = 0.25 + ((sp.height + sec * 1.6) % 2.4);
              arr[i * 3 + 2] = Math.sin(ang) * rad + 0.35;
            } else {
              const ang = sp.angle * 0.55;
              const dist = 0.55 + lifeT * sp.speed * 1.45;
              arr[i * 3] = Math.sin(ang) * dist;
              arr[i * 3 + 1] = Math.max(
                0.1,
                0.35 + sp.height * 0.85 * Math.sin(Math.min(1, lifeT * 1.35) * Math.PI * 0.85)
              );
              arr[i * 3 + 2] = Math.cos(ang) * dist + 0.55;
            }
          }
          posAttr.needsUpdate = true;
          spMat.opacity = sparkAlpha * 0.94;
        }
      }
    }
  });

  return (
    <group name="ExperimentalCombatArtsVFX">
      {Array.from({ length: MAX_EVENT_SLOTS }).map((_, idx) => (
        <group
          key={idx}
          ref={(el) => {
            slotRefs.current[idx].root = el;
          }}
          visible={false}
        >
          {/* === SAKURA DANCE POOLED LAYERS === */}
          <mesh
            ref={(el) => {
              slotRefs.current[idx].sakuraArc1Outer = el;
            }}
            geometry={resources.sakuraArcOuterGeo}
            visible={false}
          >
            <meshBasicMaterial
              color="#f472b6"
              vertexColors
              transparent
              opacity={0}
              side={THREE.DoubleSide}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
          <mesh
            ref={(el) => {
              slotRefs.current[idx].sakuraArc1Core = el;
            }}
            geometry={resources.sakuraArcCoreGeo}
            visible={false}
          >
            <meshBasicMaterial
              color="#fff1f2"
              vertexColors
              transparent
              opacity={0}
              side={THREE.DoubleSide}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>

          <mesh
            ref={(el) => {
              slotRefs.current[idx].sakuraArc2Outer = el;
            }}
            geometry={resources.sakuraArcOuterGeo}
            visible={false}
          >
            <meshBasicMaterial
              color="#ec4899"
              vertexColors
              transparent
              opacity={0}
              side={THREE.DoubleSide}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
          <mesh
            ref={(el) => {
              slotRefs.current[idx].sakuraArc2Core = el;
            }}
            geometry={resources.sakuraArcCoreGeo}
            visible={false}
          >
            <meshBasicMaterial
              color="#ffffff"
              vertexColors
              transparent
              opacity={0}
              side={THREE.DoubleSide}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>

          <mesh
            ref={(el) => {
              slotRefs.current[idx].sakuraArc3Outer = el;
            }}
            geometry={resources.sakuraArcOuterGeo}
            visible={false}
          >
            <meshBasicMaterial
              color="#f472b6"
              vertexColors
              transparent
              opacity={0}
              side={THREE.DoubleSide}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
          <mesh
            ref={(el) => {
              slotRefs.current[idx].sakuraArc3Core = el;
            }}
            geometry={resources.sakuraArcCoreGeo}
            visible={false}
          >
            <meshBasicMaterial
              color="#fce7f3"
              vertexColors
              transparent
              opacity={0}
              side={THREE.DoubleSide}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>

          <mesh
            ref={(el) => {
              slotRefs.current[idx].sakuraWind1 = el;
            }}
            geometry={resources.windRingGeo}
            visible={false}
          >
            <meshBasicMaterial
              color="#fbcfe8"
              transparent
              opacity={0}
              side={THREE.DoubleSide}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
          <mesh
            ref={(el) => {
              slotRefs.current[idx].sakuraWind2 = el;
            }}
            geometry={resources.windRingGeo}
            visible={false}
          >
            <meshBasicMaterial
              color="#f9a8d4"
              transparent
              opacity={0}
              side={THREE.DoubleSide}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>

          <instancedMesh
            ref={(el) => {
              slotRefs.current[idx].sakuraPetals = el;
            }}
            args={[resources.petalGeo, undefined, SAKURA_PETAL_COUNT]}
            frustumCulled={false}
            visible={false}
          >
            <meshBasicMaterial
              color="#ffffff"
              transparent
              opacity={0.9}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </instancedMesh>

          <points
            ref={(el) => {
              slotRefs.current[idx].sakuraSparkles = el;
            }}
            geometry={resources.sparkleGeos[idx]}
            frustumCulled={false}
            visible={false}
          >
            <pointsMaterial
              color="#ffe4e6"
              size={0.13}
              sizeAttenuation
              transparent
              opacity={0}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </points>

          {/* === MORTAL DRAW & EMPOWERED POOLED LAYERS === */}
          <mesh
            ref={(el) => {
              slotRefs.current[idx].mortalChargeDark = el;
            }}
            geometry={resources.chargeRingGeo}
            visible={false}
          >
            <meshBasicMaterial
              color="#0a0204"
              transparent
              opacity={0}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </mesh>
          <mesh
            ref={(el) => {
              slotRefs.current[idx].mortalChargeGlow = el;
            }}
            geometry={resources.chargeRingGeo}
            visible={false}
          >
            <meshBasicMaterial
              color="#dc2626"
              transparent
              opacity={0}
              side={THREE.DoubleSide}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>

          {/* First Mortal Wave: pitch-black shadow rim + blood-crimson body + hot scarlet core */}
          <mesh
            ref={(el) => {
              slotRefs.current[idx].mortalWave1Shadow = el;
            }}
            geometry={resources.mortalShadowGeo}
            visible={false}
          >
            <meshBasicMaterial
              color="#080103"
              transparent
              opacity={0}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </mesh>
          <mesh
            ref={(el) => {
              slotRefs.current[idx].mortalWave1Crimson = el;
            }}
            geometry={resources.mortalCrimsonGeo}
            visible={false}
          >
            <meshBasicMaterial
              color="#dc2626"
              vertexColors
              transparent
              opacity={0}
              side={THREE.DoubleSide}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
          <mesh
            ref={(el) => {
              slotRefs.current[idx].mortalWave1Core = el;
            }}
            geometry={resources.mortalCoreGeo}
            visible={false}
          >
            <meshBasicMaterial
              color="#ff6b7a"
              vertexColors
              transparent
              opacity={0}
              side={THREE.DoubleSide}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>

          {/* Second Reversed Colossal Mortal Wave (Empowered Draw) */}
          <mesh
            ref={(el) => {
              slotRefs.current[idx].mortalWave2Shadow = el;
            }}
            geometry={resources.mortalShadowGeo}
            visible={false}
          >
            <meshBasicMaterial
              color="#060002"
              transparent
              opacity={0}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </mesh>
          <mesh
            ref={(el) => {
              slotRefs.current[idx].mortalWave2Crimson = el;
            }}
            geometry={resources.mortalCrimsonGeo}
            visible={false}
          >
            <meshBasicMaterial
              color="#ef4444"
              vertexColors
              transparent
              opacity={0}
              side={THREE.DoubleSide}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
          <mesh
            ref={(el) => {
              slotRefs.current[idx].mortalWave2Core = el;
            }}
            geometry={resources.mortalCoreGeo}
            visible={false}
          >
            <meshBasicMaterial
              color="#fecdd3"
              vertexColors
              transparent
              opacity={0}
              side={THREE.DoubleSide}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>

          {/* Expanding dark-crimson ground shockwave rings */}
          <mesh
            ref={(el) => {
              slotRefs.current[idx].mortalShock1 = el;
            }}
            geometry={resources.shockRingGeo}
            visible={false}
          >
            <meshBasicMaterial
              color="#b91c1c"
              transparent
              opacity={0}
              side={THREE.DoubleSide}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
          <mesh
            ref={(el) => {
              slotRefs.current[idx].mortalShock2 = el;
            }}
            geometry={resources.shockRingGeo}
            visible={false}
          >
            <meshBasicMaterial
              color="#ef4444"
              transparent
              opacity={0}
              side={THREE.DoubleSide}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>

          {/* Rising dark embers & forward impact burst particles */}
          <points
            ref={(el) => {
              slotRefs.current[idx].mortalEmbers = el;
            }}
            geometry={resources.emberGeos[idx]}
            frustumCulled={false}
            visible={false}
          >
            <pointsMaterial
              vertexColors
              size={0.18}
              sizeAttenuation
              transparent
              opacity={0}
              depthWrite={false}
            />
          </points>
        </group>
      ))}
    </group>
  );
});
