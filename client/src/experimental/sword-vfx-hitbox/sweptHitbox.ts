// Pure zero-dependency defaults matching SWORD_VFX_CONSTANTS in config.ts
const DEFAULT_SWEEP_SUBSTEPS = 4;
const DEFAULT_TARGET_CAPSULE_HEIGHT = 1.8;
const DEFAULT_TARGET_CAPSULE_RADIUS = 0.52;
const DEFAULT_BLADE_COLLISION_RADIUS = 0.06;

/** Structural 3D vector interface compatible with THREE.Vector3 and plain objects. */
export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** Upright combatant capsule target (`y` = feet elevation, spans `[y, y + height]`). */
export interface SweptTargetCapsule {
  id: string;
  x: number;
  y: number;
  z: number;
  /** Total upright capsule height in meters (default: 1.8). */
  height?: number;
  /** Capsule horizontal radius in meters (default: 0.52). */
  radius?: number;
  /** Dead targets are skipped automatically when explicitly false. */
  alive?: boolean;
}

/** Exact world-space contact produced when a swept blade segment intersects a target capsule. */
export interface SweptHitResult {
  targetId: string;
  hitPoint: { x: number; y: number; z: number };
  swingDir: { x: number; z: number };
  force: number;
  /** Closest surface-to-center distance between blade segment and capsule axis. */
  distance: number;
  /** 1-based substep index [1..substeps] where contact first occurred. */
  substep: number;
}

export interface SweepBladeOptions {
  /** Number of interpolated blade sub-segments across the swept quad (default: 4). */
  substeps?: number;
  /** Blade half-thickness added to capsule radius in meters (default: 0.06). */
  bladeRadius?: number;
  /** Targets already struck during this swing are skipped to guarantee 1 hit per swing. */
  alreadyHitIds?: ReadonlySet<string>;
  /** Optional attacker entity ID to ignore self-intersection. */
  excludeTargetId?: string;
}

/** Recorded swept blade quad sample for the optional `[H]` debug wireframe overlay. */
export interface SweptDebugQuad {
  prevBaseX: number;
  prevBaseY: number;
  prevBaseZ: number;
  prevTipX: number;
  prevTipY: number;
  prevTipZ: number;
  currBaseX: number;
  currBaseY: number;
  currBaseZ: number;
  currTipX: number;
  currTipY: number;
  currTipZ: number;
  active: boolean;
  timestamp: number;
}

/** Recorded contact marker for the optional `[H]` debug overlay. */
export interface SweptDebugContact {
  x: number;
  y: number;
  z: number;
  targetId: string;
  timestamp: number;
}

/** Shared mutable ring-buffer state inspected by `SweptHitboxDebugOverlay`. */
export interface SweptDebugState {
  quads: SweptDebugQuad[];
  quadHead: number;
  quadCount: number;
  contacts: SweptDebugContact[];
  contactHead: number;
  contactCount: number;
  targets: readonly SweptTargetCapsule[];
  /** Synced by `SweptHitboxDebugOverlay` so trails skip debug recording & sweeps when hidden. */
  visible?: boolean;
}

const MAX_DEBUG_QUADS = 32;
const MAX_DEBUG_CONTACTS = 16;

/** Creates a pre-allocated debug state container with zero per-frame allocations. */
export function createSweptDebugState(): SweptDebugState {
  const quads: SweptDebugQuad[] = new Array(MAX_DEBUG_QUADS);
  for (let i = 0; i < MAX_DEBUG_QUADS; i++) {
    quads[i] = {
      prevBaseX: 0,
      prevBaseY: 0,
      prevBaseZ: 0,
      prevTipX: 0,
      prevTipY: 0,
      prevTipZ: 0,
      currBaseX: 0,
      currBaseY: 0,
      currBaseZ: 0,
      currTipX: 0,
      currTipY: 0,
      currTipZ: 0,
      active: false,
      timestamp: 0,
    };
  }
  const contacts: SweptDebugContact[] = new Array(MAX_DEBUG_CONTACTS);
  for (let i = 0; i < MAX_DEBUG_CONTACTS; i++) {
    contacts[i] = { x: 0, y: 0, z: 0, targetId: "", timestamp: 0 };
  }
  return {
    quads,
    quadHead: 0,
    quadCount: 0,
    contacts,
    contactHead: 0,
    contactCount: 0,
    targets: [],
    visible: false,
  };
}

/** Records a swept blade frame into a pre-allocated `SweptDebugState` (zero allocations). */
export function recordSweptDebugQuad(
  state: SweptDebugState,
  prevBase: Vec3Like,
  prevTip: Vec3Like,
  currBase: Vec3Like,
  currTip: Vec3Like,
  active: boolean,
  nowMs: number
): void {
  const slot = state.quads[state.quadHead];
  slot.prevBaseX = prevBase.x;
  slot.prevBaseY = prevBase.y;
  slot.prevBaseZ = prevBase.z;
  slot.prevTipX = prevTip.x;
  slot.prevTipY = prevTip.y;
  slot.prevTipZ = prevTip.z;
  slot.currBaseX = currBase.x;
  slot.currBaseY = currBase.y;
  slot.currBaseZ = currBase.z;
  slot.currTipX = currTip.x;
  slot.currTipY = currTip.y;
  slot.currTipZ = currTip.z;
  slot.active = active;
  slot.timestamp = nowMs;
  state.quadHead = (state.quadHead + 1) % state.quads.length;
  if (state.quadCount < state.quads.length) state.quadCount++;
}

/** Records a confirmed swept contact into a pre-allocated `SweptDebugState` (zero allocations). */
export function recordSweptDebugContact(
  state: SweptDebugState,
  hit: SweptHitResult,
  nowMs: number
): void {
  const slot = state.contacts[state.contactHead];
  slot.x = hit.hitPoint.x;
  slot.y = hit.hitPoint.y;
  slot.z = hit.hitPoint.z;
  slot.targetId = hit.targetId;
  slot.timestamp = nowMs;
  state.contactHead = (state.contactHead + 1) % state.contacts.length;
  if (state.contactCount < state.contacts.length) state.contactCount++;
}

// Module-level scratch structure for zero-allocation segment-to-segment closest point math
const _segScratch = {
  c1x: 0,
  c1y: 0,
  c1z: 0,
  c2x: 0,
  c2y: 0,
  c2z: 0,
  distSq: 0,
};

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Exact closest-points computation between two 3D line segments P1->Q1 and P2->Q2
 * (Christer Ericson, Real-Time Collision Detection, Section 5.1.9).
 * Writes result into module-level `_segScratch` for zero heap allocations.
 */
export function closestPointsSegmentToSegment(
  p1x: number,
  p1y: number,
  p1z: number,
  q1x: number,
  q1y: number,
  q1z: number,
  p2x: number,
  p2y: number,
  p2z: number,
  q2x: number,
  q2y: number,
  q2z: number
): number {
  const EPS = 1e-8;
  const d1x = q1x - p1x;
  const d1y = q1y - p1y;
  const d1z = q1z - p1z;

  const d2x = q2x - p2x;
  const d2y = q2y - p2y;
  const d2z = q2z - p2z;

  const rx = p1x - p2x;
  const ry = p1y - p2y;
  const rz = p1z - p2z;

  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz;

  let s = 0;
  let t = 0;

  if (a <= EPS && e <= EPS) {
    s = 0;
    t = 0;
  } else if (a <= EPS) {
    s = 0;
    t = clamp01(f / e);
  } else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= EPS) {
      t = 0;
      s = clamp01(-c / a);
    } else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z;
      const denom = a * e - b * b;

      if (denom !== 0) {
        s = clamp01((b * f - c * e) / denom);
      } else {
        s = 0;
      }

      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp01(-c / a);
      } else if (t > 1) {
        t = 1;
        s = clamp01((b - c) / a);
      }
    }
  }

  const c1x = p1x + d1x * s;
  const c1y = p1y + d1y * s;
  const c1z = p1z + d1z * s;

  const c2x = p2x + d2x * t;
  const c2y = p2y + d2y * t;
  const c2z = p2z + d2z * t;

  const dx = c1x - c2x;
  const dy = c1y - c2y;
  const dz = c1z - c2z;

  _segScratch.c1x = c1x;
  _segScratch.c1y = c1y;
  _segScratch.c1z = c1z;
  _segScratch.c2x = c2x;
  _segScratch.c2y = c2y;
  _segScratch.c2z = c2z;
  _segScratch.distSq = dx * dx + dy * dy + dz * dz;

  return _segScratch.distSq;
}

/**
 * Pure, zero-allocation Swept Weapon Segment-to-Capsule Collision Detection.
 *
 * Sub-samples `substeps` (default 4) interpolated blade segments across the swept quad
 * `(prevBase, prevTip) -> (currBase, currTip)` so fast swings never tunnel through targets
 * between frames. Tests exact segment-to-upright-capsule distance against every living target
 * capsule `(x, y..y+1.8, z, radius=0.52)`.
 *
 * Pass a pre-allocated `outHits` array + `pool` (or reuse `outHits` length via `outHits.length = 0`)
 * to achieve strict zero heap allocations in hot render loops.
 */
export function sweepBladeAgainstTargets(
  prevBase: Vec3Like,
  prevTip: Vec3Like,
  currBase: Vec3Like,
  currTip: Vec3Like,
  targets: readonly SweptTargetCapsule[],
  options: SweepBladeOptions = {},
  outHits?: SweptHitResult[]
): SweptHitResult[] {
  const results = outHits ?? [];
  const substeps = Math.max(1, options.substeps ?? DEFAULT_SWEEP_SUBSTEPS);
  const bladeRadius = options.bladeRadius ?? DEFAULT_BLADE_COLLISION_RADIUS;
  const alreadyHitIds = options.alreadyHitIds;
  const excludeTargetId = options.excludeTargetId;

  // Compute normalized horizontal swing direction from real blade tip motion
  let rawDirX = currTip.x - prevTip.x;
  let rawDirZ = currTip.z - prevTip.z;
  const tipDeltaY = currTip.y - prevTip.y;
  const tipTravelDist = Math.sqrt(rawDirX * rawDirX + tipDeltaY * tipDeltaY + rawDirZ * rawDirZ);

  let dirLen = Math.hypot(rawDirX, rawDirZ);
  if (dirLen < 1e-4) {
    // Fallback to blade pointing vector in XZ if tip moved purely vertically or is stationary
    rawDirX = currTip.x - currBase.x;
    rawDirZ = currTip.z - currBase.z;
    dirLen = Math.hypot(rawDirX, rawDirZ);
  }
  const swingDirX = dirLen > 1e-5 ? rawDirX / dirLen : 0;
  const swingDirZ = dirLen > 1e-5 ? rawDirZ / dirLen : 1;

  // Force factor proportional to swept blade travel distance per frame [0.5 .. 2.5]
  const force = Math.min(2.5, Math.max(0.5, 0.55 + tipTravelDist * 2.2));

  // Broadphase swept-quad AABB to rapidly skip distant targets
  const minX = Math.min(prevBase.x, prevTip.x, currBase.x, currTip.x) - bladeRadius;
  const maxX = Math.max(prevBase.x, prevTip.x, currBase.x, currTip.x) + bladeRadius;
  const minY = Math.min(prevBase.y, prevTip.y, currBase.y, currTip.y) - bladeRadius;
  const maxY = Math.max(prevBase.y, prevTip.y, currBase.y, currTip.y) + bladeRadius;
  const minZ = Math.min(prevBase.z, prevTip.z, currBase.z, currTip.z) - bladeRadius;
  const maxZ = Math.max(prevBase.z, prevTip.z, currBase.z, currTip.z) + bladeRadius;

  let hitWriteIndex = 0;

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    if (target.alive === false) continue;
    if (excludeTargetId && target.id === excludeTargetId) continue;
    if (alreadyHitIds && alreadyHitIds.has(target.id)) continue;

    const radius = target.radius ?? DEFAULT_TARGET_CAPSULE_RADIUS;
    const height = target.height ?? DEFAULT_TARGET_CAPSULE_HEIGHT;
    const hitRadius = radius + bladeRadius;

    // Fast AABB rejection before sub-step segment tests
    if (
      target.x + radius < minX ||
      target.x - radius > maxX ||
      target.z + radius < minZ ||
      target.z - radius > maxZ ||
      target.y + height < minY ||
      target.y > maxY
    ) {
      continue;
    }

    // Upright capsule inner segment spanning [y + r, y + height - r] so outer shell matches [y, y + height]
    const capBottomY = target.y + Math.min(radius, height * 0.5);
    const capTopY = target.y + Math.max(height - radius, height * 0.5);
    const hitRadiusSq = hitRadius * hitRadius;

    let hitFound = false;
    let bestDistSq = Infinity;
    let bestX = 0;
    let bestY = 0;
    let bestZ = 0;
    let bestSubstep = 1;

    for (let s = 1; s <= substeps; s++) {
      const alpha = s / substeps;
      const segBaseX = prevBase.x + (currBase.x - prevBase.x) * alpha;
      const segBaseY = prevBase.y + (currBase.y - prevBase.y) * alpha;
      const segBaseZ = prevBase.z + (currBase.z - prevBase.z) * alpha;

      const segTipX = prevTip.x + (currTip.x - prevTip.x) * alpha;
      const segTipY = prevTip.y + (currTip.y - prevTip.y) * alpha;
      const segTipZ = prevTip.z + (currTip.z - prevTip.z) * alpha;

      const distSq = closestPointsSegmentToSegment(
        segBaseX,
        segBaseY,
        segBaseZ,
        segTipX,
        segTipY,
        segTipZ,
        target.x,
        capBottomY,
        target.z,
        target.x,
        capTopY,
        target.z
      );

      if (distSq <= hitRadiusSq) {
        if (!hitFound || distSq < bestDistSq) {
          hitFound = true;
          bestDistSq = distSq;
          // Exact contact point on the blade edge where it intersects the capsule
          bestX = _segScratch.c1x;
          bestY = _segScratch.c1y;
          bestZ = _segScratch.c1z;
          bestSubstep = s;
        }
        // Record earliest substep that intersects deeply enough (stops tunneling cleanly)
        break;
      }
    }

    if (hitFound) {
      const distance = Math.sqrt(bestDistSq);
      if (hitWriteIndex < results.length) {
        // Reuse existing pre-allocated result slot in-place (zero GC pressure)
        const existing = results[hitWriteIndex];
        existing.targetId = target.id;
        existing.hitPoint.x = bestX;
        existing.hitPoint.y = bestY;
        existing.hitPoint.z = bestZ;
        existing.swingDir.x = swingDirX;
        existing.swingDir.z = swingDirZ;
        existing.force = force;
        existing.distance = distance;
        existing.substep = bestSubstep;
      } else {
        results.push({
          targetId: target.id,
          hitPoint: { x: bestX, y: bestY, z: bestZ },
          swingDir: { x: swingDirX, z: swingDirZ },
          force,
          distance,
          substep: bestSubstep,
        });
      }
      hitWriteIndex++;
    }
  }

  results.length = hitWriteIndex;
  return results;
}

/**
 * Stateful per-swing tracker that manages `alreadyHitIds`, pre-allocated hit result buffer,
 * and previous-frame blade endpoints with zero per-frame heap allocations.
 */
export interface SweptSwingTracker {
  readonly alreadyHitIds: Set<string>;
  readonly hitBuffer: SweptHitResult[];
  hasPrev: boolean;
  readonly prevBase: { x: number; y: number; z: number };
  readonly prevTip: { x: number; y: number; z: number };
  reset(): void;
  step(
    currBase: Vec3Like,
    currTip: Vec3Like,
    activeFrames: boolean,
    targets: readonly SweptTargetCapsule[],
    excludeTargetId?: string,
    debugState?: SweptDebugState,
    nowMs?: number
  ): readonly SweptHitResult[];
}

export function createSweptSwingTracker(maxConcurrentHits = 8): SweptSwingTracker {
  const alreadyHitIds = new Set<string>();
  const hitBuffer: SweptHitResult[] = [];
  for (let i = 0; i < maxConcurrentHits; i++) {
    hitBuffer.push({
      targetId: "",
      hitPoint: { x: 0, y: 0, z: 0 },
      swingDir: { x: 0, z: 1 },
      force: 1,
      distance: 0,
      substep: 1,
    });
  }
  hitBuffer.length = 0;

  const prevBase = { x: 0, y: 0, z: 0 };
  const prevTip = { x: 0, y: 0, z: 0 };

  const tracker: SweptSwingTracker = {
    alreadyHitIds,
    hitBuffer,
    hasPrev: false,
    prevBase,
    prevTip,
    reset() {
      alreadyHitIds.clear();
      hitBuffer.length = 0;
      tracker.hasPrev = false;
    },
    step(currBase, currTip, activeFrames, targets, excludeTargetId, debugState, nowMs = 0) {
      hitBuffer.length = 0;

      if (!tracker.hasPrev) {
        prevBase.x = currBase.x;
        prevBase.y = currBase.y;
        prevBase.z = currBase.z;
        prevTip.x = currTip.x;
        prevTip.y = currTip.y;
        prevTip.z = currTip.z;
        tracker.hasPrev = true;
        return hitBuffer;
      }

      if (debugState) {
        debugState.targets = targets;
        if (activeFrames) {
          recordSweptDebugQuad(debugState, prevBase, prevTip, currBase, currTip, activeFrames, nowMs);
        }
      }

      if (activeFrames && targets.length > 0) {
        sweepBladeAgainstTargets(
          prevBase,
          prevTip,
          currBase,
          currTip,
          targets,
          { alreadyHitIds, excludeTargetId },
          hitBuffer
        );
        for (let i = 0; i < hitBuffer.length; i++) {
          const hit = hitBuffer[i];
          alreadyHitIds.add(hit.targetId);
          if (debugState) {
            recordSweptDebugContact(debugState, hit, nowMs);
          }
        }
      }

      prevBase.x = currBase.x;
      prevBase.y = currBase.y;
      prevBase.z = currBase.z;
      prevTip.x = currTip.x;
      prevTip.y = currTip.y;
      prevTip.z = currTip.z;

      return hitBuffer;
    },
  };

  return tracker;
}
