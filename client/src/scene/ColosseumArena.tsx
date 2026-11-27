import { memo, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useLoader, useThree } from "@react-three/fiber";
import { ARENA, ARENA_MAPS, type ArenaMapKind } from "@sekiroslop/shared";
import type { RoomWorldSnapshot } from "../net/useColosseumRoom";
import { ArenaMapStructures } from "./ArenaMapStructures";
import { ArenaWorldProps } from "./ArenaWorldProps";
import { OuterValleyTerrain } from "./OuterValleyTerrain";
import { SceneAssetBoundary } from "./SceneAssetBoundary";

interface ColosseumArenaProps {
  worldRef: React.MutableRefObject<RoomWorldSnapshot>;
  mapKind: ArenaMapKind;
  gateCooldownMs: number;
  nearLever: boolean;
  maxAnisotropy?: number;
}

const ARCH_SEGMENTS = 32;
const WALL_RADIUS = ARENA.WALL_RADIUS; // 26.2
const SAND_NORMAL_SCALE = new THREE.Vector2(0.55, 0.55);

function seededZen(seed: number): number {
  const v = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return v - Math.floor(v);
}

/**
 * Generates a tileable 512x512 cool moonlit slate-gravel CanvasTexture with
 * raked-gravel wave ridges, deterministic granite grain, and subtle mossy flagstone seams.
 */
function createZenGravelTexture(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  if (ctx) {
    // Base cool moonlit slate-gravel gradient
    const grad = ctx.createLinearGradient(0, 0, size, size);
    grad.addColorStop(0, "#343c52");
    grad.addColorStop(0.5, "#2f374c");
    grad.addColorStop(1, "#2b3246");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    // Subtle weathered flagstone & mossy slate seams (tileable grid with slight offset)
    ctx.lineWidth = 1.5;
    const step = 128;
    for (let y = 0; y < size; y += step) {
      ctx.strokeStyle = "rgba(22, 27, 42, 0.34)";
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(size, y + 0.5);
      ctx.stroke();

      ctx.strokeStyle = "rgba(62, 86, 88, 0.16)";
      ctx.beginPath();
      ctx.moveTo(0, y + 2);
      ctx.lineTo(size, y + 2);
      ctx.stroke();

      const rowOffset = (y / step) % 2 === 0 ? 0 : step / 2;
      for (let x = rowOffset; x < size; x += step) {
        ctx.strokeStyle = "rgba(22, 27, 42, 0.28)";
        ctx.beginPath();
        ctx.moveTo(x + 0.5, y);
        ctx.lineTo(x + 0.5, y + step);
        ctx.stroke();
      }
    }

    // Concentric / undulating raked-gravel wave ridges (periodic across 512px for seamless 9x9 tiling)
    const waveCount = 24;
    for (let w = 0; w < waveCount; w++) {
      const baseY = (w / waveCount) * size;
      ctx.strokeStyle = w % 2 === 0 ? "rgba(74, 86, 118, 0.22)" : "rgba(24, 29, 44, 0.26)";
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      for (let x = 0; x <= size; x += 8) {
        const wave = Math.sin((x / size) * Math.PI * 4) * 5.5;
        const py = baseY + wave;
        if (x === 0) ctx.moveTo(x, py);
        else ctx.lineTo(x, py);
      }
      ctx.stroke();
    }

    // Deterministic seeded granite grain speckles
    for (let i = 0; i < 4800; i++) {
      const gx = seededZen(i * 1.13 + 3) * size;
      const gy = seededZen(i * 1.79 + 17) * size;
      const r = 0.8 + seededZen(i * 2.31 + 29) * 1.3;
      const tone = seededZen(i * 3.07 + 43);
      if (tone > 0.65) {
        ctx.fillStyle = "rgba(116, 128, 162, 0.24)";
      } else if (tone > 0.3) {
        ctx.fillStyle = "rgba(32, 38, 56, 0.32)";
      } else {
        ctx.fillStyle = "rgba(68, 92, 96, 0.16)";
      }
      ctx.fillRect(gx, gy, r, r);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(9, 9);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Generates a tileable 512x512 deep iridescent teal-jade CanvasTexture with
 * octagonal/radial stone tile seams, turquoise/amethyst mineral veins, and granite grain.
 */
function createPrismJadeTexture(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  if (ctx) {
    // Deep iridescent teal-jade base
    const grad = ctx.createLinearGradient(0, 0, size, size);
    grad.addColorStop(0, "#245461");
    grad.addColorStop(0.5, "#1f4857");
    grad.addColorStop(1, "#1b3d4d");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    // Subtle octagonal / radial tile grid (128px repeating cells)
    const step = 128;
    const inset = 22;
    ctx.lineWidth = 1.6;
    for (let y = 0; y < size; y += step) {
      for (let x = 0; x < size; x += step) {
        ctx.strokeStyle = "rgba(12, 28, 38, 0.42)";
        ctx.beginPath();
        ctx.moveTo(x + inset, y);
        ctx.lineTo(x + step - inset, y);
        ctx.lineTo(x + step, y + inset);
        ctx.lineTo(x + step, y + step - inset);
        ctx.lineTo(x + step - inset, y + step);
        ctx.lineTo(x + inset, y + step);
        ctx.lineTo(x, y + step - inset);
        ctx.lineTo(x, y + inset);
        ctx.closePath();
        ctx.stroke();

        // Inner radial bevel highlight
        ctx.strokeStyle = "rgba(34, 211, 238, 0.14)";
        ctx.beginPath();
        ctx.arc(x + step / 2, y + step / 2, step * 0.24, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // Subtle turquoise (#22d3ee) and faint amethyst (#c084fc) mineral vein highlights
    for (let v = 0; v < 14; v++) {
      const startX = seededZen(v * 3.1 + 7) * size;
      const startY = seededZen(v * 5.3 + 11) * size;
      const isAmethyst = v % 3 === 0;
      ctx.strokeStyle = isAmethyst
        ? "rgba(192, 132, 252, 0.14)"
        : "rgba(34, 211, 238, 0.16)";
      ctx.lineWidth = 1.2 + seededZen(v * 2.7 + 19) * 1.4;
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      let px = startX;
      let py = startY;
      for (let s = 1; s <= 5; s++) {
        px += (seededZen(v * 13 + s * 2.9) - 0.5) * 72;
        py += (seededZen(v * 17 + s * 4.1) - 0.5) * 72;
        ctx.lineTo(px, py);
      }
      ctx.stroke();
    }

    // Deterministic granite & crystalline mineral speckling
    for (let i = 0; i < 4800; i++) {
      const gx = seededZen(i * 1.13 + 31) * size;
      const gy = seededZen(i * 1.79 + 47) * size;
      const r = 0.8 + seededZen(i * 2.31 + 59) * 1.3;
      const tone = seededZen(i * 3.07 + 73);
      if (tone > 0.92) {
        ctx.fillStyle = "rgba(34, 211, 238, 0.24)";
      } else if (tone > 0.85) {
        ctx.fillStyle = "rgba(192, 132, 252, 0.18)";
      } else if (tone > 0.5) {
        ctx.fillStyle = "rgba(72, 132, 148, 0.22)";
      } else {
        ctx.fillStyle = "rgba(14, 30, 42, 0.34)";
      }
      ctx.fillRect(gx, gy, r, r);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(8, 8);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Generates a tileable 512x512 warm sunlit Kyoto courtyard CanvasTexture:
 * mossy flagstone with irregular joints, soft clover-moss patches, and baked
 * pink/white sakura petal flecks. Tile edges are kept periodic for 9x9 repeat.
 */
function createSpringMeadowFloorTexture(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  if (ctx) {
    // Warm sunlit mossy courtyard stone base
    const grad = ctx.createLinearGradient(0, 0, size, size);
    grad.addColorStop(0, "#8f9478");
    grad.addColorStop(0.5, "#868d6e");
    grad.addColorStop(1, "#7a8564");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    // Irregular Kyoto flagstones: jittered 4x4 grid of tinted slabs (wrapped for tiling)
    const cells = 4;
    const cell = size / cells;
    for (let cy = 0; cy < cells; cy++) {
      for (let cx = 0; cx < cells; cx++) {
        const seed = cy * 17 + cx * 5 + 3;
        const ox = cx * cell + (cy % 2 === 0 ? 0 : cell * 0.5);
        const oy = cy * cell;
        const tone = seededZen(seed * 1.7);
        const fill =
          tone > 0.66
            ? "rgba(164, 160, 136, 0.42)"
            : tone > 0.33
              ? "rgba(140, 142, 116, 0.38)"
              : "rgba(122, 128, 100, 0.36)";
        // Draw slab and its wrapped copies so seams stay periodic
        for (const wx of [-size, 0, size]) {
          for (const wy of [-size, 0, size]) {
            ctx.beginPath();
            const pts = 6;
            for (let p = 0; p < pts; p++) {
              const a = (p / pts) * Math.PI * 2 + seededZen(seed + p) * 0.4;
              const rr = cell * (0.42 + seededZen(seed * 3.1 + p * 1.3) * 0.1);
              const px = ox + cell / 2 + Math.cos(a) * rr + wx;
              const py = oy + cell / 2 + Math.sin(a) * rr + wy;
              if (p === 0) ctx.moveTo(px, py);
              else ctx.lineTo(px, py);
            }
            ctx.closePath();
            ctx.fillStyle = fill;
            ctx.fill();
            ctx.strokeStyle = "rgba(62, 70, 48, 0.42)";
            ctx.lineWidth = 2.2;
            ctx.stroke();
          }
        }
      }
    }

    // Soft clover-moss patches (wrapped)
    for (let m = 0; m < 46; m++) {
      const mx = seededZen(m * 2.13 + 101) * size;
      const my = seededZen(m * 3.71 + 211) * size;
      const mr = 10 + seededZen(m * 5.3 + 7) * 26;
      for (const wx of [-size, 0, size]) {
        for (const wy of [-size, 0, size]) {
          const g = ctx.createRadialGradient(mx + wx, my + wy, 0, mx + wx, my + wy, mr);
          g.addColorStop(0, "rgba(111, 143, 84, 0.55)");
          g.addColorStop(1, "rgba(111, 143, 84, 0)");
          ctx.fillStyle = g;
          ctx.fillRect(mx + wx - mr, my + wy - mr, mr * 2, mr * 2);
        }
      }
    }

    // Granite grain
    for (let i = 0; i < 3600; i++) {
      const gx = seededZen(i * 1.13 + 501) * size;
      const gy = seededZen(i * 1.79 + 617) * size;
      const r = 0.8 + seededZen(i * 2.31 + 59) * 1.2;
      const tone = seededZen(i * 3.07 + 811);
      ctx.fillStyle =
        tone > 0.6 ? "rgba(196, 190, 160, 0.22)" : tone > 0.25 ? "rgba(70, 76, 54, 0.26)" : "rgba(96, 128, 72, 0.22)";
      ctx.fillRect(gx, gy, r, r);
    }

    // Baked sakura petal flecks (tiny ellipses)
    for (let i = 0; i < 260; i++) {
      const px = seededZen(i * 4.17 + 907) * size;
      const py = seededZen(i * 6.29 + 919) * size;
      const rot = seededZen(i * 7.7 + 3) * Math.PI;
      const pick = seededZen(i * 8.3 + 11);
      ctx.fillStyle =
        pick > 0.6 ? "rgba(255, 183, 220, 0.72)" : pick > 0.25 ? "rgba(255, 243, 248, 0.7)" : "rgba(255, 133, 179, 0.6)";
      ctx.beginPath();
      ctx.ellipse(px, py, 2.6, 1.5, rot, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(9, 9);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export const ColosseumArena = memo(function ColosseumArena({
  worldRef,
  mapKind,
  gateCooldownMs,
  nearLever,
  maxAnisotropy = 4,
}: ColosseumArenaProps) {
  const gl = useThree((s) => s.gl);
  const palette = ARENA_MAPS[mapKind] ?? ARENA_MAPS.sunlit_colosseum;

  const zenGravelDiffuse = useMemo(() => {
    const tex = createZenGravelTexture();
    tex.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
    return tex;
  }, [gl]);

  const prismJadeDiffuse = useMemo(() => {
    const tex = createPrismJadeTexture();
    tex.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
    return tex;
  }, [gl]);

  const sunnyMeadowDiffuse = useMemo(() => {
    const tex = createSpringMeadowFloorTexture();
    tex.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
    return tex;
  }, [gl]);

  useEffect(() => () => {
    zenGravelDiffuse.dispose();
    prismJadeDiffuse.dispose();
    sunnyMeadowDiffuse.dispose();
  }, [zenGravelDiffuse, prismJadeDiffuse, sunnyMeadowDiffuse]);
  const [
    sandDiffuse,
    sandNormal,
    sandstoneDiffuse,
    sandstoneNormal,
    marbleDiffuse,
    stoneWallDiffuse,
    stoneWallNormal,
  ] = useLoader(THREE.TextureLoader, [
    "/assets/textures/arena_sand_diffuse.jpg",
    "/assets/textures/arena_sand_nor_gl.jpg",
    "/assets/textures/sandstone_diffuse.jpg",
    "/assets/textures/sandstone_nor_gl.jpg",
    "/assets/textures/marble_diffuse.jpg",
    "/assets/textures/stone_wall_diffuse.jpg",
    "/assets/textures/stone_wall_nor_gl.jpg",
  ]);

  // Configure tiling & color spaces once
  useMemo(() => {
    const setup = (tex: THREE.Texture, rx: number, ry: number, srgb: boolean) => {
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(rx, ry);
      tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      tex.anisotropy = maxAnisotropy;
      tex.needsUpdate = true;
    };
    setup(sandDiffuse, 14, 14, true);
    setup(sandNormal, 14, 14, false);
    setup(sandstoneDiffuse, 2, 2, true);
    setup(sandstoneNormal, 2, 2, false);
    setup(marbleDiffuse, 2, 2, true);
    setup(stoneWallDiffuse, 3, 1.5, true);
    setup(stoneWallNormal, 3, 1.5, false);
  }, [
    maxAnisotropy,
    sandDiffuse,
    sandNormal,
    sandstoneDiffuse,
    sandstoneNormal,
    marbleDiffuse,
    stoneWallDiffuse,
    stoneWallNormal,
  ]);

  // Instanced refs for low draw-call Colosseum architecture
  const podiumWallRef = useRef<THREE.InstancedMesh>(null);
  const tier1PiersRef = useRef<THREE.InstancedMesh>(null);
  const tier1LintelsRef = useRef<THREE.InstancedMesh>(null);
  const tier2PiersRef = useRef<THREE.InstancedMesh>(null);
  const tier2LintelsRef = useRef<THREE.InstancedMesh>(null);
  const seatsRef = useRef<THREE.InstancedMesh>(null);
  const columnsRef = useRef<THREE.InstancedMesh>(null);
  const brazierBowlsRef = useRef<THREE.InstancedMesh>(null);
  const brazierFlamesRef = useRef<THREE.InstancedMesh>(null);
  const brazierInnerFlamesRef = useRef<THREE.InstancedMesh>(null);
  const portcullisRef = useRef<THREE.Group>(null);
  const leverArmRef = useRef<THREE.Mesh>(null);

  // Compute segment transforms around the 32-segment Colosseum ring
  // Segment index 16 sits at angle = PI -> (x = 0, z = -R) -> North Gladiator Gate!
  useEffect(() => {
    const dummy = new THREE.Object3D();
    const northAngle = Math.PI;

    let podiumIdx = 0;
    let colIdx = 0;
    let seatIdx = 0;

    for (let i = 0; i < ARCH_SEGMENTS; i++) {
      const angle = (i / ARCH_SEGMENTS) * Math.PI * 2;
      const isNorthGate = Math.abs(Math.atan2(Math.sin(angle - northAngle), Math.cos(angle - northAngle))) < 0.14;
      const sin = Math.sin(angle);
      const cos = Math.cos(angle);

      // Podium wall (skip North gate opening so players see into the dark gladiator tunnel)
      if (!isNorthGate && podiumWallRef.current) {
        dummy.position.set(sin * WALL_RADIUS, 2.2, cos * WALL_RADIUS);
        dummy.rotation.set(0, angle, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        podiumWallRef.current.setMatrixAt(podiumIdx++, dummy.matrix);
      }

      // Engaged half-columns along the podium
      if (columnsRef.current) {
        const colAngle = angle + Math.PI / ARCH_SEGMENTS;
        dummy.position.set(Math.sin(colAngle) * (WALL_RADIUS - 0.55), 2.2, Math.cos(colAngle) * (WALL_RADIUS - 0.55));
        dummy.rotation.set(0, colAngle, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        columnsRef.current.setMatrixAt(colIdx++, dummy.matrix);
      }

      // Tier 1 Roman Arcade Piers & Arch Lintels (r = 31.0)
      if (tier1PiersRef.current && tier1LintelsRef.current) {
        const r1 = WALL_RADIUS + 4.8;
        const pierAngle = angle + Math.PI / ARCH_SEGMENTS;
        dummy.position.set(Math.sin(pierAngle) * r1, 8.6, Math.cos(pierAngle) * r1);
        dummy.rotation.set(0, pierAngle, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        tier1PiersRef.current.setMatrixAt(i, dummy.matrix);

        dummy.position.set(sin * r1, 12.2, cos * r1);
        dummy.rotation.set(0, angle, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        tier1LintelsRef.current.setMatrixAt(i, dummy.matrix);
      }

      // Tier 2 Upper Colosseum Facade (r = 35.6)
      if (tier2PiersRef.current && tier2LintelsRef.current) {
        const r2 = WALL_RADIUS + 9.4;
        const pierAngle = angle + Math.PI / ARCH_SEGMENTS;
        dummy.position.set(Math.sin(pierAngle) * r2, 16.5, Math.cos(pierAngle) * r2);
        dummy.rotation.set(0, pierAngle, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        tier2PiersRef.current.setMatrixAt(i, dummy.matrix);

        dummy.position.set(sin * r2, 20.6, cos * r2);
        dummy.rotation.set(0, angle, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        tier2LintelsRef.current.setMatrixAt(i, dummy.matrix);
      }

      // Stepped Cavea Spectator Tiers (3 concentric stone bench rows per segment)
      if (seatsRef.current) {
        for (let row = 0; row < 3; row++) {
          const rs = WALL_RADIUS + 1.4 + row * 1.45;
          const ys = 4.6 + row * 1.15;
          dummy.position.set(sin * rs, ys, cos * rs);
          dummy.rotation.set(0, angle, 0);
          dummy.scale.set(1 + row * 0.055, 1, 1);
          dummy.updateMatrix();
          seatsRef.current.setMatrixAt(seatIdx++, dummy.matrix);
        }
      }
    }

    // 8 Perimeter Bronze Fire Braziers around the podium top
    if (brazierBowlsRef.current && brazierFlamesRef.current && brazierInnerFlamesRef.current) {
      for (let b = 0; b < 8; b++) {
        const a = (b / 8) * Math.PI * 2 + Math.PI / 8;
        const rb = WALL_RADIUS - 0.1;
        dummy.position.set(Math.sin(a) * rb, 4.75, Math.cos(a) * rb);
        dummy.rotation.set(0, a, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        brazierBowlsRef.current.setMatrixAt(b, dummy.matrix);

        dummy.position.set(Math.sin(a) * rb, 5.45, Math.cos(a) * rb);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        brazierFlamesRef.current.setMatrixAt(b, dummy.matrix);

        dummy.position.set(Math.sin(a) * rb, 5.35, Math.cos(a) * rb);
        dummy.scale.set(0.62, 0.72, 0.62);
        dummy.updateMatrix();
        brazierInnerFlamesRef.current.setMatrixAt(b, dummy.matrix);
      }
    }

    for (const ref of [
      podiumWallRef,
      tier1PiersRef,
      tier1LintelsRef,
      tier2PiersRef,
      tier2LintelsRef,
      seatsRef,
      columnsRef,
      brazierBowlsRef,
      brazierFlamesRef,
      brazierInnerFlamesRef,
    ]) {
      if (ref.current) {
        ref.current.instanceMatrix.needsUpdate = true;
        ref.current.computeBoundingSphere();
      }
    }
  }, []);

  // Smoothly animate the iron portcullis gate, lever arm, and brazier fire flicker
  useFrame((state, delta) => {
    const progress = worldRef.current.northGate.openProgress;
    if (portcullisRef.current) {
      const targetY = progress * 3.85;
      portcullisRef.current.position.y = THREE.MathUtils.lerp(
        portcullisRef.current.position.y,
        targetY,
        Math.min(1, delta * 10)
      );
    }
    if (leverArmRef.current) {
      const targetRot = progress > 0.2 ? -0.65 : 0.55;
      leverArmRef.current.rotation.x = THREE.MathUtils.lerp(
        leverArmRef.current.rotation.x,
        targetRot,
        Math.min(1, delta * 12)
      );
    }
    const t = state.clock.elapsedTime;
    if (brazierFlamesRef.current) {
      const pulse = 0.9 + Math.sin(t * 11.5) * 0.12 + Math.sin(t * 23) * 0.04;
      brazierFlamesRef.current.scale.set(1, pulse, 1);
      brazierFlamesRef.current.position.y = 5.45 * (1 - pulse);
    }
    if (brazierInnerFlamesRef.current) {
      const pulse2 = 0.94 + Math.cos(t * 15) * 0.14;
      brazierInnerFlamesRef.current.scale.set(1, pulse2, 1);
      brazierInnerFlamesRef.current.position.y = 5.35 * (1 - pulse2);
    }
  });

  const leverReady = gateCooldownMs <= 0;
  const floorNormalMap = sandNormal;
  const floorNormalScale = SAND_NORMAL_SCALE;

  const podiumCurbGeo = useMemo(() => {
    const pts = [
      new THREE.Vector2(WALL_RADIUS - 0.65, -0.08),
      new THREE.Vector2(WALL_RADIUS - 0.45, 0.08),
      new THREE.Vector2(WALL_RADIUS + 0.15, 0.08),
      new THREE.Vector2(WALL_RADIUS + 0.15, -0.08),
    ];
    return new THREE.LatheGeometry(pts, 48);
  }, []);

  useEffect(() => () => {
    podiumCurbGeo.dispose();
  }, [podiumCurbGeo]);

  return (
    <group>
      {/* Main Playable Arena Floor (tactile normal maps on all 3 maps) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[WALL_RADIUS + 1.5, 56]} />
        <meshStandardMaterial
          key={mapKind}
          map={
            mapKind === "sunlit_colosseum"
              ? sandDiffuse
              : mapKind === "aurora_sanctuary"
                ? prismJadeDiffuse
                : mapKind === "sunny_sakura"
                  ? sunnyMeadowDiffuse
                  : zenGravelDiffuse
          }
          normalMap={floorNormalMap}
          normalScale={floorNormalScale}
          roughness={0.93}
          metalness={0.02}
          color={palette.sand}
        />
      </mesh>

      {/* Sunken Center Roman Medallion Ring & Hypogeum Timber Grate (Sunlit Colosseum) */}
      <mesh visible={mapKind === "sunlit_colosseum"} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]} receiveShadow>
        <ringGeometry args={[3.4, 4.15, 36]} />
        <meshStandardMaterial map={marbleDiffuse} color={palette.paleStone} roughness={0.78} />
      </mesh>
      <mesh visible={mapKind === "sunlit_colosseum"} position={[0, 0.018, 0]} receiveShadow>
        <boxGeometry args={[2.6, 0.036, 2.6]} />
        <meshStandardMaterial color={palette.darkStone} roughness={0.94} />
      </mesh>

      {/* Beveled Marble Podium Curb Trim Ring, Combat-Ring Decal & Cardinal Spoke Strips (Sunlit Colosseum) */}
      <mesh visible={mapKind === "sunlit_colosseum"} geometry={podiumCurbGeo} position={[0, 0.08, 0]} receiveShadow>
        <meshStandardMaterial map={marbleDiffuse} color={palette.paleStone} roughness={0.76} />
      </mesh>
      <mesh visible={mapKind === "sunlit_colosseum"} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]} receiveShadow>
        <ringGeometry args={[10.5, 11.1, 48]} />
        <meshStandardMaterial color={palette.darkStone} roughness={0.95} transparent opacity={0.35} />
      </mesh>
      {[0, 1, 2, 3].map((idx) => {
        const a = (idx / 4) * Math.PI * 2;
        return (
          <mesh
            key={`spoke-${idx}`}
            visible={mapKind === "sunlit_colosseum"}
            rotation={[-Math.PI / 2, 0, -a]}
            position={[Math.sin(a) * 7.325, 0.013, Math.cos(a) * 7.325]}
            receiveShadow
          >
            <planeGeometry args={[0.28, 6.35]} />
            <meshStandardMaterial map={marbleDiffuse} color={palette.paleStone} roughness={0.82} transparent opacity={0.68} />
          </mesh>
        );
      })}

      {/* Central Celestial Astrolabe Mandala & Outer Inlaid Ring (Aurora Sanctuary) */}
      <mesh visible={mapKind === "aurora_sanctuary"} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]} receiveShadow>
        <ringGeometry args={[3.35, 3.78, 48]} />
        <meshStandardMaterial
          color="#38bdf8"
          emissive="#0284c7"
          emissiveIntensity={0.45}
          roughness={0.32}
          metalness={0.6}
          transparent
          opacity={0.86}
        />
      </mesh>
      <mesh visible={mapKind === "aurora_sanctuary"} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.017, 0]} receiveShadow>
        <ringGeometry args={[3.8, 4.08, 48]} />
        <meshStandardMaterial
          color="#fbbf24"
          emissive="#b45309"
          emissiveIntensity={0.32}
          roughness={0.28}
          metalness={0.78}
        />
      </mesh>
      <mesh visible={mapKind === "aurora_sanctuary"} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]} receiveShadow>
        <ringGeometry args={[9.5, 10.0, 64]} />
        <meshStandardMaterial
          color="#fbbf24"
          emissive="#0e7490"
          emissiveIntensity={0.28}
          roughness={0.34}
          metalness={0.72}
          transparent
          opacity={0.85}
        />
      </mesh>

      {/* Outer Ground Skirt bridging arena floor to outer valley terrain */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.09, 0]}>
        <ringGeometry args={[WALL_RADIUS, WALL_RADIUS + 1.2, 40]} />
        <meshStandardMaterial color={palette.ground} roughness={0.95} />
      </mesh>

      {/* Rich Map-Specific Structures, Props, Landmarks & Flush Floor Inlays */}
      <OuterValleyTerrain mapKind={mapKind} />
      <ArenaMapStructures mapKind={mapKind} />
      <SceneAssetBoundary resetKey={mapKind}>
        <ArenaWorldProps mapKind={mapKind} />
      </SceneAssetBoundary>

      {/* === SUNLIT COLOSSEUM INSTANCED AMPHITHEATER === */}
      {/* Instanced Podium Wall Segments (31 segments, leaving North Gate open) */}
      <instancedMesh visible={mapKind === "sunlit_colosseum"} ref={podiumWallRef} args={[undefined, undefined, ARCH_SEGMENTS - 1]} frustumCulled={false} castShadow receiveShadow>
        <boxGeometry args={[5.45, 4.4, 1.5]} />
        <meshStandardMaterial
          map={stoneWallDiffuse}
          normalMap={stoneWallNormal}
          color={palette.stone}
          roughness={0.88}
        />
      </instancedMesh>

      {/* Instanced Engaged Podium Columns */}
      <instancedMesh visible={mapKind === "sunlit_colosseum"} ref={columnsRef} args={[undefined, undefined, ARCH_SEGMENTS]} frustumCulled={false} castShadow receiveShadow>
        <cylinderGeometry args={[0.38, 0.44, 4.5, 10]} />
        <meshStandardMaterial map={marbleDiffuse} color={palette.paleStone} roughness={0.68} />
      </instancedMesh>

      {/* Instanced Spectator Seating (Cavea) */}
      <instancedMesh visible={mapKind === "sunlit_colosseum"} ref={seatsRef} args={[undefined, undefined, ARCH_SEGMENTS * 3]} frustumCulled={false} receiveShadow>
        <boxGeometry args={[5.55, 1.0, 1.45]} />
        <meshStandardMaterial map={sandstoneDiffuse} color={palette.stone} roughness={0.9} />
      </instancedMesh>

      {/* Instanced Tier 1 Arcade Piers & Lintels */}
      <instancedMesh visible={mapKind === "sunlit_colosseum"} ref={tier1PiersRef} args={[undefined, undefined, ARCH_SEGMENTS]} frustumCulled={false}>
        <boxGeometry args={[2.2, 7.6, 2.2]} />
        <meshStandardMaterial
          map={sandstoneDiffuse}
          normalMap={sandstoneNormal}
          color={palette.paleStone}
          roughness={0.88}
        />
      </instancedMesh>
      <instancedMesh visible={mapKind === "sunlit_colosseum"} ref={tier1LintelsRef} args={[undefined, undefined, ARCH_SEGMENTS]} frustumCulled={false}>
        <boxGeometry args={[6.4, 1.65, 2.5]} />
        <meshStandardMaterial map={sandstoneDiffuse} color={palette.stone} roughness={0.85} />
      </instancedMesh>

      {/* Instanced Tier 2 Upper Colosseum Facade */}
      <instancedMesh visible={mapKind === "sunlit_colosseum"} ref={tier2PiersRef} args={[undefined, undefined, ARCH_SEGMENTS]} frustumCulled={false}>
        <boxGeometry args={[2.3, 8.2, 2.3]} />
        <meshStandardMaterial map={sandstoneDiffuse} color={palette.stone} roughness={0.9} />
      </instancedMesh>
      <instancedMesh visible={mapKind === "sunlit_colosseum"} ref={tier2LintelsRef} args={[undefined, undefined, ARCH_SEGMENTS]} frustumCulled={false}>
        <boxGeometry args={[7.3, 2.0, 2.7]} />
        <meshStandardMaterial map={sandstoneDiffuse} color={palette.paleStone} roughness={0.86} />
      </instancedMesh>

      {/* Instanced Perimeter Bronze Fire Braziers (dual-layered flickering flames) */}
      <instancedMesh visible={mapKind === "sunlit_colosseum"} ref={brazierBowlsRef} args={[undefined, undefined, 8]} frustumCulled={false}>
        <cylinderGeometry args={[0.62, 0.34, 0.78, 8]} />
        <meshStandardMaterial color="#4a3726" metalness={0.75} roughness={0.38} />
      </instancedMesh>
      <instancedMesh visible={mapKind === "sunlit_colosseum"} ref={brazierFlamesRef} args={[undefined, undefined, 8]} frustumCulled={false}>
        <coneGeometry args={[0.42, 1.05, 7]} />
        <meshBasicMaterial color="#ff6e1a" toneMapped={false} />
      </instancedMesh>
      <instancedMesh visible={mapKind === "sunlit_colosseum"} ref={brazierInnerFlamesRef} args={[undefined, undefined, 8]} frustumCulled={false}>
        <coneGeometry args={[0.32, 0.85, 7]} />
        <meshBasicMaterial color="#ffe57f" toneMapped={false} />
      </instancedMesh>

      {/* 4 Weathered Inner Arena Cover Pillars (Sunlit Colosseum) */}
      {mapKind === "sunlit_colosseum" && ARENA.PILLARS.map((p, idx) => (
        <group key={idx} position={[p.x, 0, p.z]}>
          {/* Plinth */}
          <mesh position={[0, 0.45, 0]} castShadow receiveShadow>
            <boxGeometry args={[p.radius * 2.15, 0.9, p.radius * 2.15]} />
            <meshStandardMaterial map={marbleDiffuse} color={palette.paleStone} roughness={0.78} />
          </mesh>
          {/* Shaft */}
          <mesh position={[0, p.height / 2 + 0.3, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[p.radius * 0.85, p.radius * 0.95, p.height - 0.6, 12]} />
            <meshStandardMaterial
              map={sandstoneDiffuse}
              normalMap={sandstoneNormal}
              color={palette.stone}
              roughness={0.84}
            />
          </mesh>
          {/* Gilded Roman collar ring */}
          <mesh position={[0, p.height - 0.15, 0]}>
            <cylinderGeometry args={[p.radius * 0.96, p.radius * 0.92, 0.24, 12]} />
            <meshStandardMaterial color="#d4a644" metalness={0.68} roughness={0.32} />
          </mesh>
          {/* Capital */}
          <mesh position={[0, p.height + 0.25, 0]} castShadow>
            <boxGeometry args={[p.radius * 2.2, 0.55, p.radius * 2.2]} />
            <meshStandardMaterial map={marbleDiffuse} color={palette.paleStone} roughness={0.72} />
          </mesh>
        </group>
      ))}

      {/* === NORTH GLADIATOR GATE & UNDERGROUND PASSAGE (Themed per Map) === */}
      <group position={[ARENA.NORTH_GATE.x, 0, ARENA.NORTH_GATE.z]}>
        {/* Archway Side Piers & Massive Lintel */}
        <mesh position={[-2.95, 2.4, 0]} castShadow receiveShadow>
          <boxGeometry args={[1.4, 4.8, 2.2]} />
          <meshStandardMaterial
            map={mapKind === "sunlit_colosseum" ? stoneWallDiffuse : null}
            normalMap={stoneWallNormal}
            color={
              mapKind === "moonlit_sakura"
                ? "#3b425c"
                : mapKind === "aurora_sanctuary"
                  ? "#1e3a52"
                  : mapKind === "sunny_sakura"
                    ? "#7a4c36"
                    : palette.stone
            }
            roughness={0.86}
          />
        </mesh>
        <mesh position={[2.95, 2.4, 0]} castShadow receiveShadow>
          <boxGeometry args={[1.4, 4.8, 2.2]} />
          <meshStandardMaterial
            map={mapKind === "sunlit_colosseum" ? stoneWallDiffuse : null}
            normalMap={stoneWallNormal}
            color={
              mapKind === "moonlit_sakura"
                ? "#3b425c"
                : mapKind === "aurora_sanctuary"
                  ? "#1e3a52"
                  : mapKind === "sunny_sakura"
                    ? "#7a4c36"
                    : palette.stone
            }
            roughness={0.86}
          />
        </mesh>
        <mesh position={[0, 5.05, 0]} castShadow receiveShadow>
          <boxGeometry args={[7.4, 1.15, 2.4]} />
          <meshStandardMaterial
            map={mapKind === "sunlit_colosseum" ? marbleDiffuse : null}
            color={
              mapKind === "moonlit_sakura"
                ? "#9d2942"
                : mapKind === "aurora_sanctuary"
                  ? "#1e3a52"
                  : mapKind === "sunny_sakura"
                    ? "#c93b44"
                    : palette.paleStone
            }
            roughness={0.72}
          />
        </mesh>
        {/* Aurora Sanctuary cyan & gold North Gate trim */}
        <mesh visible={mapKind === "aurora_sanctuary"} position={[0, 4.5, 0]}>
          <boxGeometry args={[7.5, 0.14, 2.48]} />
          <meshStandardMaterial color="#fbbf24" metalness={0.78} roughness={0.28} />
        </mesh>
        <mesh visible={mapKind === "aurora_sanctuary"} position={[0, 5.64, 0]}>
          <boxGeometry args={[7.55, 0.12, 2.48]} />
          <meshStandardMaterial color="#22d3ee" emissive="#0891b2" emissiveIntensity={0.55} roughness={0.3} />
        </mesh>
        {/* Sunlit Sakura warm cedar & vermilion North Gate trim (kasagi cap + nuki beam) */}
        <mesh visible={mapKind === "sunny_sakura"} position={[0, 5.72, 0]}>
          <boxGeometry args={[8.2, 0.22, 2.6]} />
          <meshStandardMaterial color="#3a2a22" roughness={0.7} />
        </mesh>
        <mesh visible={mapKind === "sunny_sakura"} position={[0, 4.42, 0]}>
          <boxGeometry args={[7.5, 0.16, 2.46]} />
          <meshStandardMaterial color="#7a4c36" roughness={0.78} />
        </mesh>

        {/* Dark Shadowed Underground Passage Tunnel behind the Gate */}
        <mesh position={[0, 2.2, -3.4]}>
          <boxGeometry args={[5.2, 4.5, 6.2]} />
          <meshStandardMaterial color={palette.darkStone} side={THREE.BackSide} roughness={0.98} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, -3.4]}>
          <planeGeometry args={[5.2, 6.4]} />
          <meshStandardMaterial color={palette.darkStone} roughness={0.95} />
        </mesh>

        {/* Animated Iron Portcullis Bars */}
        <group ref={portcullisRef} position={[0, 0, 0.1]}>
          {[-1.8, -1.2, -0.6, 0, 0.6, 1.2, 1.8].map((bx) => (
            <mesh key={bx} position={[bx, 2.2, 0]} castShadow>
              <cylinderGeometry args={[0.075, 0.075, 4.4, 6]} />
              <meshStandardMaterial color="#2c2a29" metalness={0.78} roughness={0.38} />
            </mesh>
          ))}
          {[0.8, 2.2, 3.6].map((by) => (
            <mesh key={by} position={[0, by, 0]} castShadow>
              <boxGeometry args={[4.4, 0.16, 0.16]} />
              <meshStandardMaterial color="#252322" metalness={0.78} roughness={0.4} />
            </mesh>
          ))}
        </group>
      </group>

      {/* === INTERACTIVE NORTH GATE LEVER PEDESTAL === */}
      <group position={[ARENA.NORTH_GATE.leverX, 0, ARENA.NORTH_GATE.leverZ]}>
        {/* Stone pedestal */}
        <mesh position={[0, 0.55, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.9, 1.1, 0.9]} />
          <meshStandardMaterial
            map={mapKind === "sunlit_colosseum" ? marbleDiffuse : null}
            color={
              mapKind === "sunlit_colosseum"
                ? "#d4c2a2"
                : mapKind === "aurora_sanctuary"
                  ? "#1e3a52"
                  : palette.stone
            }
            roughness={0.75}
          />
        </mesh>
        {/* Bronze winch housing */}
        <mesh position={[0, 1.22, 0]} castShadow>
          <boxGeometry args={[0.55, 0.3, 0.45]} />
          <meshStandardMaterial color="#785322" metalness={0.72} roughness={0.35} />
        </mesh>
        {/* Pullable Lever Arm */}
        <mesh ref={leverArmRef} position={[0, 1.55, 0]} rotation={[0.55, 0, 0]} castShadow>
          <cylinderGeometry args={[0.05, 0.06, 0.95, 8]} />
          <meshStandardMaterial
            color={nearLever && leverReady ? palette.accentAlt : palette.accent}
            emissive={nearLever && leverReady ? palette.accent : leverReady ? palette.darkStone : "#000000"}
            emissiveIntensity={nearLever && leverReady ? 1.0 : 0.4}
            metalness={0.65}
            roughness={0.3}
          />
        </mesh>
        {/* Glowing Floor Ring Indicator */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
          <ringGeometry args={[1.0, 1.22, 24]} />
          <meshBasicMaterial
            color={leverReady ? (nearLever ? palette.accentAlt : palette.accent) : "#78716c"}
            transparent
            opacity={nearLever ? 0.85 : 0.45}
          />
        </mesh>
      </group>
    </group>
  );
});
