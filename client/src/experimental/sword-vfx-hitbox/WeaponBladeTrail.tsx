import { memo, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { createPortal, useFrame, useThree } from "@react-three/fiber";
import {
  ATTACK_ACTIVE_FRAMES,
  EXPERIMENTAL_SWORD_VFX_AND_HITBOX,
  SWORD_VFX_CONSTANTS,
  getBladeAuraIntensity,
  isElapsedInActiveFrames,
  isOffensiveSwordAction,
  resolveSwordTheme,
} from "./config";
import {
  createBladeAuraMaterial,
  createBladeSparkPointsMaterial,
  createRibbonTrailMaterial,
  updateSwordShaderUniforms,
} from "./swordAuraShader";
import {
  createSweptSwingTracker,
  type SweptDebugState,
  type SweptHitResult,
  type SweptTargetCapsule,
} from "./sweptHitbox";
import { EXPERIMENTAL_ARTS } from "../special-moves/config";

export interface WeaponBladeTrailProps {
  /** Live Three.js sword group (e.g. `RomanGladius`) OR character model root containing `"RomanGladius"`. */
  swordObject: THREE.Object3D | null;
  /** Optional explicit world-tracked Object3D anchor placed at blade base/guard. */
  baseAnchor?: THREE.Object3D | null;
  /** Optional explicit world-tracked Object3D anchor placed at blade tip. */
  tipAnchor?: THREE.Object3D | null;
  /** Current combat action (`light1`, `heavy`, `sakura_dance`, `mortal_draw`, `idle`, etc.). */
  action: string;
  /** Optional monotonic counter bumped whenever the same attack repeats back-to-back. */
  attackNonce?: number;
  /** Whether Warrior's Fury or an offensive blade buff is active. */
  furyActive?: boolean;
  /** Whether the gladiator is actively blocking. */
  isBlocking?: boolean;
  /** Whether the entity is alive (trail & aura cleanly hide on death). */
  alive?: boolean;
  /** Entity ID excluded from swept self-hits when `targetsRef` is provided. */
  entityId?: string;
  /** Optional target capsules for real-time swept weapon hitbox checks during active frames. */
  targetsRef?: React.MutableRefObject<readonly SweptTargetCapsule[]>;
  /** Callback fired once per target per swing when the real blade sweep intersects a capsule. */
  onSweptHit?: (hit: SweptHitResult, action: string) => void;
  /** Optional shared debug state ref visualized by `SweptHitboxDebugOverlay` (`[H]`). */
  debugStateRef?: React.MutableRefObject<SweptDebugState>;
  /** Local toggle allowing callers to disable per-entity without touching global flag. */
  enabled?: boolean;
  /** Number of intermediate trail samples between rendered frames. */
  trailSubSteps?: 1 | 2 | 3;
}

const RING_SIZE = SWORD_VFX_CONSTANTS.TRAIL_RING_SAMPLES;
const PARTICLE_COUNT = SWORD_VFX_CONSTANTS.TIP_PARTICLE_POOL_SIZE;
const RIBBON_VERT_COUNT = RING_SIZE * 2;
const RIBBON_QUAD_COUNT = RING_SIZE - 1;
const RIBBON_INDEX_COUNT = RIBBON_QUAD_COUNT * 6;

/**
 * Builds a slightly inflated tapered blade-envelope geometry aligned with
 * GladiatorModel's RomanGladius (`blade` at y=0.22..1.12, `tip` cone to y=1.33).
 */
function buildBladeAuraGeometry(): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(0.014, 0.068, 1.15, 6, 8, false);
  // Shift so base sits at y = 0.21 (just above crossguard) and tip reaches y = 1.36
  geo.translate(0, 0.785, 0);
  // Flatten into a sleek double-edged gladius cross-section (wide X, slim Z)
  geo.scale(1.05, 1.0, 0.42);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Real Weapon-Tracked Ribbon Trail, Animated Fresnel Blade Aura Shell,
 * Pooled Blade-Tip Slash Particles, and Integrated Swept Hitbox Driver.
 *
 * Zero per-frame heap allocations:
 * - Reads live world positions via `Object3D.getWorldPosition` into pre-allocated scratch Vector3s.
 * - Maintains an 18-sample ring buffer updating a single pre-allocated BufferGeometry ribbon in-place.
 * - Emits pooled `THREE.Points` sparks off the real moving sword tip during active swing frames.
 */
export const WeaponBladeTrail = memo(function WeaponBladeTrail({
  swordObject,
  baseAnchor = null,
  tipAnchor = null,
  action,
  attackNonce = 0,
  furyActive = false,
  isBlocking = false,
  alive = true,
  entityId,
  targetsRef,
  onSweptHit,
  debugStateRef,
  enabled = true,
  trailSubSteps = 2,
}: WeaponBladeTrailProps) {
  const { scene } = useThree();

  // Resolve exact RomanGladius Object3D (works whether caller passes gladius group or character root)
  const resolvedSword = useMemo(() => {
    if (!swordObject) return null;
    if (swordObject.name === "RomanGladius") return swordObject;
    return swordObject.getObjectByName("RomanGladius") ?? swordObject;
  }, [swordObject]);

  // Track active base & tip anchors in a ref (never mutating scene graph during render)
  const anchorsRef = useRef<{
    base: THREE.Object3D | null;
    tip: THREE.Object3D | null;
  }>({ base: baseAnchor, tip: tipAnchor });

  // Attach lightweight invisible base & tip markers in useEffect so render stays pure
  // and remove any anchors this component created on unmount or sword change.
  useEffect(() => {
    if (!resolvedSword) {
      anchorsRef.current.base = baseAnchor;
      anchorsRef.current.tip = tipAnchor;
      return;
    }

    let createdBase: THREE.Object3D | null = null;
    let createdTip: THREE.Object3D | null = null;

    let base = baseAnchor;
    if (!base) {
      base = resolvedSword.getObjectByName("ExpSwordBaseAnchor") ?? null;
      if (!base) {
        base = new THREE.Object3D();
        base.name = "ExpSwordBaseAnchor";
        base.position.set(0, SWORD_VFX_CONSTANTS.GLADIUS_LOCAL_BASE_Y, 0);
        resolvedSword.add(base);
        createdBase = base;
      }
    }

    let tip = tipAnchor;
    if (!tip) {
      tip = resolvedSword.getObjectByName("ExpSwordTipAnchor") ?? null;
      if (!tip) {
        tip = new THREE.Object3D();
        tip.name = "ExpSwordTipAnchor";
        tip.position.set(0, SWORD_VFX_CONSTANTS.GLADIUS_LOCAL_TIP_Y, 0);
        resolvedSword.add(tip);
        createdTip = tip;
      }
    }

    anchorsRef.current.base = base;
    anchorsRef.current.tip = tip;

    return () => {
      if (createdBase && createdBase.parent === resolvedSword) {
        resolvedSword.remove(createdBase);
      }
      if (createdTip && createdTip.parent === resolvedSword) {
        resolvedSword.remove(createdTip);
      }
      if (anchorsRef.current.base === createdBase) {
        anchorsRef.current.base = null;
      }
      if (anchorsRef.current.tip === createdTip) {
        anchorsRef.current.tip = null;
      }
    };
  }, [resolvedSword, baseAnchor, tipAnchor]);

  // Pre-allocated geometries & custom GLSL ShaderMaterials
  const {
    ribbonGeo,
    ribbonMat,
    auraGeo,
    auraMat,
    particleGeo,
    particleMat,
  } = useMemo(() => {
    // Ribbon BufferGeometry (18 samples x 2 vertices = 36 vertices)
    const rGeo = new THREE.BufferGeometry();
    const positions = new Float32Array(RIBBON_VERT_COUNT * 3);
    const uvs = new Float32Array(RIBBON_VERT_COUNT * 2);
    const indices = new Uint16Array(RIBBON_INDEX_COUNT);

    for (let i = 0; i < RING_SIZE; i++) {
      const u = i / (RING_SIZE - 1);
      const vBase = i * 2;
      const vTip = i * 2 + 1;
      uvs[vBase * 2] = u;
      uvs[vBase * 2 + 1] = 0.0;
      uvs[vTip * 2] = u;
      uvs[vTip * 2 + 1] = 1.0;
    }

    let ptr = 0;
    for (let i = 0; i < RIBBON_QUAD_COUNT; i++) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices[ptr++] = a;
      indices[ptr++] = b;
      indices[ptr++] = c;
      indices[ptr++] = b;
      indices[ptr++] = d;
      indices[ptr++] = c;
    }

    const posAttr = new THREE.BufferAttribute(positions, 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    rGeo.setAttribute("position", posAttr);
    rGeo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    rGeo.setIndex(new THREE.BufferAttribute(indices, 1));

    const rMat = createRibbonTrailMaterial({ intensity: 0 });
    const aGeo = buildBladeAuraGeometry();
    const aMat = createBladeAuraMaterial({ intensity: 0 });

    // Pooled tip slash particles BufferGeometry
    const pGeo = new THREE.BufferGeometry();
    const pPos = new Float32Array(PARTICLE_COUNT * 3);
    const pCol = new Float32Array(PARTICLE_COUNT * 3);
    const pSize = new Float32Array(PARTICLE_COUNT);
    const pAlpha = new Float32Array(PARTICLE_COUNT);

    const pPosAttr = new THREE.BufferAttribute(pPos, 3);
    pPosAttr.setUsage(THREE.DynamicDrawUsage);
    const pColAttr = new THREE.BufferAttribute(pCol, 3);
    pColAttr.setUsage(THREE.DynamicDrawUsage);
    const pSizeAttr = new THREE.BufferAttribute(pSize, 1);
    pSizeAttr.setUsage(THREE.DynamicDrawUsage);
    const pAlphaAttr = new THREE.BufferAttribute(pAlpha, 1);
    pAlphaAttr.setUsage(THREE.DynamicDrawUsage);

    pGeo.setAttribute("position", pPosAttr);
    pGeo.setAttribute("color", pColAttr);
    pGeo.setAttribute("aSize", pSizeAttr);
    pGeo.setAttribute("aAlpha", pAlphaAttr);

    const pMat = createBladeSparkPointsMaterial();

    return {
      ribbonGeo: rGeo,
      ribbonMat: rMat,
      auraGeo: aGeo,
      auraMat: aMat,
      particleGeo: pGeo,
      particleMat: pMat,
    };
  }, []);

  useEffect(() => {
    return () => {
      ribbonGeo.dispose();
      ribbonMat.dispose();
      auraGeo.dispose();
      auraMat.dispose();
      particleGeo.dispose();
      particleMat.dispose();
    };
  }, [ribbonGeo, ribbonMat, auraGeo, auraMat, particleGeo, particleMat]);

  const ribbonMeshRef = useRef<THREE.Mesh>(null);
  const auraMeshRef = useRef<THREE.Mesh>(null);
  const pointsRef = useRef<THREE.Points>(null);

  // Pre-allocated zero-GC runtime state (ring buffer, scratch vectors, particle pool, swept tracker)
  const runtimeRef = useRef<{
    ringBase: Float32Array;
    ringTip: Float32Array;
    ringHead: number;
    ringFilled: number;
    ribbonIntensity: number;
    auraIntensity: number;
    liveParticleCount: number;
    lastAction: string;
    lastAttackNonce: number;
    actionStartMs: number;
    // Scratch Vector3s — NEVER re-allocated
    currBase: THREE.Vector3;
    currTip: THREE.Vector3;
    prevBase: THREE.Vector3;
    prevTip: THREE.Vector3;
    tipVel: THREE.Vector3;
    sparkColor: THREE.Color;
    // Pooled particle kinematic arrays
    pVel: Float32Array;
    pAge: Float32Array;
    pMaxAge: Float32Array;
    pCursor: number;
    rngSeed: number;
    emitAccum: number;
    // Swept hitbox tracker
    sweptTracker: ReturnType<typeof createSweptSwingTracker>;
  } | null>(null);

  if (!runtimeRef.current) {
    runtimeRef.current = {
      ringBase: new Float32Array(RING_SIZE * 3),
      ringTip: new Float32Array(RING_SIZE * 3),
      ringHead: 0,
      ringFilled: 0,
      ribbonIntensity: 0,
      auraIntensity: 0,
      liveParticleCount: 0,
      lastAction: "",
      lastAttackNonce: -1,
      actionStartMs: 0,
      currBase: new THREE.Vector3(),
      currTip: new THREE.Vector3(),
      prevBase: new THREE.Vector3(),
      prevTip: new THREE.Vector3(),
      tipVel: new THREE.Vector3(),
      sparkColor: new THREE.Color(),
      pVel: new Float32Array(PARTICLE_COUNT * 3),
      pAge: new Float32Array(PARTICLE_COUNT),
      pMaxAge: new Float32Array(PARTICLE_COUNT),
      pCursor: 0,
      rngSeed: 1337,
      emitAccum: 0,
      sweptTracker: createSweptSwingTracker(8),
    };
  }

  useFrame((state, delta) => {
    if (!EXPERIMENTAL_SWORD_VFX_AND_HITBOX || !enabled) return;
    const activeBaseAnchor = anchorsRef.current.base;
    const activeTipAnchor = anchorsRef.current.tip;
    if (!activeBaseAnchor || !activeTipAnchor) return;

    const rt = runtimeRef.current!;
    const dt = Math.min(delta, 0.05);
    const nowMs = performance.now();
    const elapsedTime = state.clock.elapsedTime;

    // Detect action change or repeat swing nonce -> reset attack timer & swept hit tracker
    if (action !== rt.lastAction || attackNonce !== rt.lastAttackNonce) {
      rt.lastAction = action;
      rt.lastAttackNonce = attackNonce;
      rt.actionStartMs = nowMs;
      rt.sweptTracker.reset();
    }

    const actionElapsedMs = nowMs - rt.actionStartMs;
    const isAttacking = alive && isOffensiveSwordAction(action);
    const inActiveFrames = isAttacking && isElapsedInActiveFrames(action, actionElapsedMs);
    const targetAura = alive ? getBladeAuraIntensity(action, inActiveFrames, furyActive, isBlocking) : 0;
    const attackWindow = ATTACK_ACTIVE_FRAMES[action];
    // Allow ribbon visual to stay luminous slightly past active frames into early follow-through
    const ribbonEmitWindow =
      isAttacking &&
      attackWindow !== undefined &&
      actionElapsedMs >= attackWindow.windupMs * 0.65 &&
      actionElapsedMs <= attackWindow.windupMs + attackWindow.activeMs + 95;

    if (
      !isAttacking &&
      targetAura <= 0.001 &&
      rt.auraIntensity <= 0.001 &&
      rt.ribbonIntensity <= 0.001 &&
      rt.liveParticleCount === 0
    ) {
      rt.ringFilled = 0;
      if (auraMeshRef.current) auraMeshRef.current.visible = false;
      if (ribbonMeshRef.current) ribbonMeshRef.current.visible = false;
      if (pointsRef.current) pointsRef.current.visible = false;
      return;
    }

    // Flush ancestor & anchor world matrices immediately (without non-zero useFrame priority,
    // which would disable R3F auto-render) so pose/bone updates are never 1 frame stale.
    if (resolvedSword) {
      resolvedSword.updateWorldMatrix(true, false);
    }
    if (activeBaseAnchor.parent !== resolvedSword) {
      activeBaseAnchor.updateWorldMatrix(true, false);
    }
    if (activeTipAnchor.parent !== resolvedSword) {
      activeTipAnchor.updateWorldMatrix(true, false);
    }
    activeBaseAnchor.updateMatrixWorld(true);
    activeTipAnchor.updateMatrixWorld(true);

    // Read REAL live world-space positions of the sword base and tip (zero allocations)
    activeBaseAnchor.getWorldPosition(rt.currBase);
    activeTipAnchor.getWorldPosition(rt.currTip);

    // Teleport / respawn guard: reset ring buffer if blade jumped > 3m in a single frame
    const tipDx = rt.currTip.x - rt.prevTip.x;
    const tipDy = rt.currTip.y - rt.prevTip.y;
    const tipDz = rt.currTip.z - rt.prevTip.z;
    const tipDistSq = tipDx * tipDx + tipDy * tipDy + tipDz * tipDz;

    if (rt.ringFilled > 0 && tipDistSq > SWORD_VFX_CONSTANTS.TELEPORT_RESET_DIST_SQ) {
      rt.ringFilled = 0;
      rt.ringHead = 0;
      rt.ribbonIntensity = 0;
      rt.sweptTracker.reset();
    }

    // Compute live tip velocity for particle ejection tangent
    if (rt.ringFilled > 0 && dt > 1e-4) {
      rt.tipVel.set(tipDx / dt, tipDy / dt, tipDz / dt);
    } else {
      rt.tipVel.set(0, 0, 0);
    }
    // Fill the ribbon ring with quality-scaled intermediate samples. This only
    // affects the visual trail; swept collision keeps its fixed gameplay sampling.
    const sampleCount = rt.ringFilled === 0 ? 1 : trailSubSteps;
    for (let sample = 1; sample <= sampleCount; sample++) {
      const alpha = sample / sampleCount;
      const slot3 = rt.ringHead * 3;
      rt.ringBase[slot3] = rt.prevBase.x + (rt.currBase.x - rt.prevBase.x) * alpha;
      rt.ringBase[slot3 + 1] = rt.prevBase.y + (rt.currBase.y - rt.prevBase.y) * alpha;
      rt.ringBase[slot3 + 2] = rt.prevBase.z + (rt.currBase.z - rt.prevBase.z) * alpha;
      rt.ringTip[slot3] = rt.prevTip.x + (rt.currTip.x - rt.prevTip.x) * alpha;
      rt.ringTip[slot3 + 1] = rt.prevTip.y + (rt.currTip.y - rt.prevTip.y) * alpha;
      rt.ringTip[slot3 + 2] = rt.prevTip.z + (rt.currTip.z - rt.prevTip.z) * alpha;
      rt.ringHead = (rt.ringHead + 1) % RING_SIZE;
      if (rt.ringFilled < RING_SIZE) rt.ringFilled++;
    }
    rt.prevBase.copy(rt.currBase);
    rt.prevTip.copy(rt.currTip);

    // Resolve color theme (zero allocations)
    const theme = resolveSwordTheme(action, furyActive, isBlocking);

    // 1. Update Blade Aura Shell shader uniforms
    const auraLerp = 1 - Math.exp(-16 * dt);
    rt.auraIntensity += (targetAura - rt.auraIntensity) * auraLerp;

    updateSwordShaderUniforms(auraMat, elapsedTime, theme.core, theme.aura, rt.auraIntensity);
    if (auraMeshRef.current) {
      auraMeshRef.current.visible = rt.auraIntensity > 0.02;
    }

    // 2. Update Real Weapon-Tracked Ribbon Trail geometry & uniforms
    const isSpecialArt =
      action in EXPERIMENTAL_ARTS ||
      action === "whirlwind" ||
      action === "thrust" ||
      action === "aerial_slam" ||
      action === "counter";
    const tipMovingFast = tipDistSq > 0.0009; // > 3cm per frame
    const targetRibbon =
      !alive
        ? 0
        : ribbonEmitWindow && (tipMovingFast || isSpecialArt)
          ? isSpecialArt
            ? 1.38
            : 1.05
          : furyActive && tipMovingFast
            ? 0.42
            : 0;

    const ribbonRate = targetRibbon > rt.ribbonIntensity ? 26 : 9.5;
    rt.ribbonIntensity += (targetRibbon - rt.ribbonIntensity) * (1 - Math.exp(-ribbonRate * dt));

    updateSwordShaderUniforms(ribbonMat, elapsedTime, theme.core, theme.edge, rt.ribbonIntensity);

    const ribbonMesh = ribbonMeshRef.current;
    if (ribbonMesh) {
      const showRibbon = rt.ribbonIntensity > 0.015 && rt.ringFilled >= 2;
      ribbonMesh.visible = showRibbon;

      if (showRibbon) {
        const posAttr = ribbonGeo.getAttribute("position") as THREE.BufferAttribute;
        const posArr = posAttr.array as Float32Array;
        const newestIdx = (rt.ringHead - 1 + RING_SIZE) % RING_SIZE;

        // Write vertices ordered from newest (i=0, vUv.x=0) to oldest (i=RING_SIZE-1, vUv.x=1)
        for (let i = 0; i < RING_SIZE; i++) {
          const offset = i < rt.ringFilled ? i : rt.ringFilled - 1;
          const ringIdx = (newestIdx - offset + RING_SIZE) % RING_SIZE;
          const src3 = ringIdx * 3;
          const dstBase = i * 6;

          posArr[dstBase] = rt.ringBase[src3];
          posArr[dstBase + 1] = rt.ringBase[src3 + 1];
          posArr[dstBase + 2] = rt.ringBase[src3 + 2];

          posArr[dstBase + 3] = rt.ringTip[src3];
          posArr[dstBase + 4] = rt.ringTip[src3 + 1];
          posArr[dstBase + 5] = rt.ringTip[src3 + 2];
        }
        posAttr.needsUpdate = true;
      }
    }

    // 3. Emit & integrate pooled colourful slash particles off the real moving blade tip
    const pPosAttr = particleGeo.getAttribute("position") as THREE.BufferAttribute;
    const pColAttr = particleGeo.getAttribute("color") as THREE.BufferAttribute;
    const pSizeAttr = particleGeo.getAttribute("aSize") as THREE.BufferAttribute;
    const pAlphaAttr = particleGeo.getAttribute("aAlpha") as THREE.BufferAttribute;

    const pPos = pPosAttr.array as Float32Array;
    const pCol = pColAttr.array as Float32Array;
    const pSize = pSizeAttr.array as Float32Array;
    const pAlpha = pAlphaAttr.array as Float32Array;

    const nextRand = () => {
      rt.rngSeed = (rt.rngSeed * 1664525 + 1013904223) >>> 0;
      return rt.rngSeed / 4294967296;
    };

    const emitRate =
      alive && inActiveFrames
        ? isSpecialArt
          ? 140
          : 95
        : alive && furyActive
          ? 24
          : 0;

    if (emitRate > 0) {
      rt.emitAccum += emitRate * dt;
      rt.sparkColor.set(theme.spark);

      while (rt.emitAccum >= 1.0) {
        rt.emitAccum -= 1.0;
        const idx = rt.pCursor;
        rt.pCursor = (rt.pCursor + 1) % PARTICLE_COUNT;

        // Spawn along upper 65% of the live blade (biased toward tip)
        const bladeT = 0.35 + nextRand() * 0.65;
        const sx = rt.currBase.x + (rt.currTip.x - rt.currBase.x) * bladeT;
        const sy = rt.currBase.y + (rt.currTip.y - rt.currBase.y) * bladeT;
        const sz = rt.currBase.z + (rt.currTip.z - rt.currBase.z) * bladeT;

        const i3 = idx * 3;
        pPos[i3] = sx;
        pPos[i3 + 1] = sy;
        pPos[i3 + 2] = sz;

        // Carry a fraction of actual blade velocity + crisp outward scatter
        rt.pVel[i3] = rt.tipVel.x * 0.22 + (nextRand() - 0.5) * 2.4;
        rt.pVel[i3 + 1] = rt.tipVel.y * 0.18 + 0.6 + nextRand() * 1.9;
        rt.pVel[i3 + 2] = rt.tipVel.z * 0.22 + (nextRand() - 0.5) * 2.4;

        pCol[i3] = rt.sparkColor.r;
        pCol[i3 + 1] = rt.sparkColor.g;
        pCol[i3 + 2] = rt.sparkColor.b;

        pSize[idx] = isSpecialArt ? 0.24 + nextRand() * 0.24 : 0.16 + nextRand() * 0.18;
        pAlpha[idx] = 1.0;
        rt.pAge[idx] = 0;
        rt.pMaxAge[idx] = 0.22 + nextRand() * 0.26;
      }
    } else {
      rt.emitAccum = 0;
    }

    let activeParticleCount = 0;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const maxAge = rt.pMaxAge[i];
      if (maxAge <= 0) {
        pAlpha[i] = 0;
        continue;
      }
      const nextAge = rt.pAge[i] + dt;
      if (nextAge >= maxAge) {
        rt.pMaxAge[i] = 0;
        pAlpha[i] = 0;
        continue;
      }
      activeParticleCount++;
      rt.pAge[i] = nextAge;
      const lifeRatio = 1 - nextAge / maxAge;

      const i3 = i * 3;
      rt.pVel[i3] *= Math.max(0, 1 - 3.2 * dt);
      rt.pVel[i3 + 1] -= 3.8 * dt;
      rt.pVel[i3 + 2] *= Math.max(0, 1 - 3.2 * dt);

      pPos[i3] += rt.pVel[i3] * dt;
      pPos[i3 + 1] += rt.pVel[i3 + 1] * dt;
      pPos[i3 + 2] += rt.pVel[i3 + 2] * dt;
      pAlpha[i] = lifeRatio * lifeRatio;
    }

    rt.liveParticleCount = activeParticleCount;
    if (pointsRef.current) {
      pointsRef.current.visible = activeParticleCount > 0;
    }
    if (activeParticleCount > 0 || emitRate > 0) {
      pPosAttr.needsUpdate = true;
      pColAttr.needsUpdate = true;
      pSizeAttr.needsUpdate = true;
      pAlphaAttr.needsUpdate = true;
    }

    // 4. Optional Swept Weapon Hitbox step on the exact same real world-space blade segment
    // Gate swept collision & debug quad recording so idle frames never clobber active swing quads
    // and unused swept collision math doesn't run when neither onSweptHit nor [H] overlay is active.
    const debugState = debugStateRef?.current;
    const debugVisible = Boolean(debugState?.visible);
    if (debugVisible && debugState && targetsRef) {
      debugState.targets = targetsRef.current;
    }

    if (onSweptHit || debugVisible) {
      const targets = targetsRef ? targetsRef.current : EMPTY_TARGETS;
      const hits = rt.sweptTracker.step(
        rt.currBase,
        rt.currTip,
        inActiveFrames,
        targets,
        entityId,
        debugVisible && inActiveFrames ? debugState : undefined,
        nowMs
      );
      if (onSweptHit && hits.length > 0) {
        for (let i = 0; i < hits.length; i++) {
          onSweptHit(hits[i], action);
        }
      }
    } else if (rt.sweptTracker.hasPrev) {
      rt.sweptTracker.hasPrev = false;
    }
  });

  if (!EXPERIMENTAL_SWORD_VFX_AND_HITBOX || !enabled || !resolvedSword) {
    return null;
  }

  return (
    <>
      {/* World-space real weapon-tracked ribbon trail + pooled blade tip particles */}
      {createPortal(
        <group name="ExperimentalWeaponTrailWorld">
          <mesh
            ref={ribbonMeshRef}
            geometry={ribbonGeo}
            material={ribbonMat}
            visible={false}
            frustumCulled={false}
            renderOrder={20}
          />
          <points
            ref={pointsRef}
            geometry={particleGeo}
            material={particleMat}
            visible={false}
            frustumCulled={false}
            renderOrder={21}
          />
        </group>,
        scene
      )}

      {/* Animated Fresnel + plasma-wave Blade Aura Shell wrapped directly around the Gladius mesh */}
      {createPortal(
        <mesh
          ref={auraMeshRef}
          name="ExperimentalBladeAuraShell"
          geometry={auraGeo}
          material={auraMat}
          visible={false}
          renderOrder={19}
        />,
        resolvedSword
      )}
    </>
  );
});

const EMPTY_TARGETS: readonly SweptTargetCapsule[] = [];
