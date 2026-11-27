import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import {
  ARENA,
  COMBAT,
  ENEMY_ARCHETYPES,
  FLIGHT,
  clampToArena,
  yawFromDelta,
  type ArenaMapKind,
  type AttackMessage,
  type BlockMessage,
  type CastAbilityMessage,
  type DodgeMessage,
  type LocomotionAnim,
  type MoveMessage,
  type PlayerAbilityKind,
  type UseItemMessage,
} from "@sekiroslop/shared";
import { GladiatorModel, type LivePose } from "./GladiatorModel";
import { SceneAssetBoundary } from "./SceneAssetBoundary";
import type { EnemySnapshot, PlayerSnapshot, RoomWorldSnapshot } from "../net/useColosseumRoom";
import { soundEngine } from "../audio/SoundEngine";
import { resetTouchInputState, touchInput } from "../input/touchInput";
import { controlsConfigRef, type KeyBindings } from "../input/controlsConfig";
import {
  EXPERIMENTAL_SPECIAL_MOVES,
  type ExperimentalArtKind,
  type InspectedRigStatus,
} from "../experimental/special-moves";
import type { SweptDebugState, SweptTargetCapsule } from "../experimental/sword-vfx-hitbox";
import type { GraphicsQualityTier } from "../lib/graphicsQuality";

interface LocalPlayerControllerProps {
  player: PlayerSnapshot;
  spectateTargetId: string;
  worldRef: React.MutableRefObject<RoomWorldSnapshot>;
  localPoseRef: React.MutableRefObject<LivePose>;
  graphicsTier: GraphicsQualityTier;
  enemies: EnemySnapshot[];
  lockedEnemyId: string | null;
  shakeRef: React.MutableRefObject<number>;
  activeExperimentalArt?: { kind: ExperimentalArtKind; nonce: number } | null;
  sweptDebugRef?: React.MutableRefObject<SweptDebugState>;
  sweptTargetsRef?: React.MutableRefObject<readonly SweptTargetCapsule[]>;
  onLockChange: (enemyId: string | null) => void;
  onMove: (msg: MoveMessage) => void;
  onAttack: (msg: AttackMessage) => void;
  onUseItem: (msg: UseItemMessage) => void;
  onBlock: (msg: BlockMessage) => void;
  onDodge: (msg: DodgeMessage) => void;
  onInteractGate: () => void;
  onNearLeverChange: (near: boolean) => void;
  selectedAbility?: PlayerAbilityKind;
  onSelectAbility?: (ability: PlayerAbilityKind) => void;
  onCastAbility?: (msg: CastAbilityMessage) => void;
  onExperimentalArt?: (art: ExperimentalArtKind, yaw: number) => void;
  onRigInspected?: (status: InspectedRigStatus) => void;
}

interface LockableTarget {
  id: string;
  x: number;
  y: number;
  z: number;
  height: number;
}

interface QueuedMoveInput {
  message: MoveMessage;
  sentAt: number;
}

const MIN_CAM_PITCH = -0.46;
const MAX_CAM_PITCH = 1.44;
const LOCK_ON_MAX_RANGE = 34;
const LOCK_ON_BREAK_RANGE = 40;
const AUTO_LOCK_ATTACK_RANGE = 16;
const MIN_ENTITY_SEP = ARENA.ENTITY_RADIUS * 2 + 0.04;

function replayPendingMoveInputs(
  authority: PlayerSnapshot,
  acknowledgedSequence: number,
  inputHistory: Map<number, QueuedMoveInput>,
  now: number,
  mapKind?: ArenaMapKind
): { x: number; y: number; z: number } {
  const sampleAgeMs = Math.min(80, Math.max(0, (authority.pingMs ?? 0) / 2));
  let simulationTime = now - sampleAgeMs;
  let x = authority.x;
  let y = THREE.MathUtils.clamp(
    authority.y + authority.velocityY * (sampleAgeMs / 1000),
    0,
    FLIGHT.MAX_Y
  );
  let z = authority.z;
  let velocityX = authority.velocityX;
  let velocityZ = authority.velocityZ;
  const ordered = [...inputHistory.entries()].sort((a, b) => a[0] - b[0]);
  const acknowledgedInput = ordered.filter(([sequence]) => sequence <= acknowledgedSequence).at(-1)?.[1].message;
  let input: MoveMessage = acknowledgedInput ?? {
    sequence: acknowledgedSequence,
    moveX: 0,
    moveZ: 0,
    jumpPressed: false,
    jumpHeld: false,
    yaw: authority.yaw,
  };

  const swift = authority.swiftFeetMs > 0 ? COMBAT.SWIFT_FEET_SPEED_MULT : 1;
  const action = authority.action;
  const isLocked = action === "staggered" || action === "shocked" || action === "knockback";
  const isAttacking =
    action === "light1" || action === "light2" || action === "heavy" || action === "punch" ||
    action === "whirlwind" || action === "aerial_slam" || action === "counter";

  const advance = (until: number) => {
    let remaining = Math.max(0, until - simulationTime) / 1000;
    while (remaining > 0.0001) {
      const dt = Math.min(COMBAT.SERVER_TICK_MS / 1000, remaining);
      const magnitude = Math.hypot(input.moveX, input.moveZ);
      const inputScale = magnitude > 1 ? 1 / magnitude : 1;
      const isAirborne = authority.isFlying || authority.y > 0.12;
      const horizontalMode = isAirborne ? FLIGHT.FLY_SPEED_MULT : 1;
      const baseSpeed = authority.isBlocking
        ? COMBAT.PLAYER_BLOCK_SPEED
        : isAttacking
          ? COMBAT.PLAYER_MOVE_SPEED * 0.35
          : COMBAT.PLAYER_MOVE_SPEED;
      const canMove = !isLocked && action !== "dodge" && action !== "thrust" && magnitude > 0.05;
      const speed = canMove ? baseSpeed * swift * horizontalMode : 0;
      const response = !isAirborne
        ? (canMove ? 30 : 22)
        : canMove
          ? (authority.isFlying ? FLIGHT.FLY_ACCEL_XZ : FLIGHT.AIR_STEER_ACCEL)
          : FLIGHT.AIR_COAST_DRAG;
      const blend = 1 - Math.exp(-response * dt);
      velocityX += (input.moveX * inputScale * speed - velocityX) * blend;
      velocityZ += (input.moveZ * inputScale * speed - velocityZ) * blend;
      const clamped = clampToArena(x + velocityX * dt, z + velocityZ * dt, ARENA.ENTITY_RADIUS, false, mapKind);
      x = clamped.x;
      z = clamped.z;
      simulationTime += dt * 1000;
      remaining -= dt;
    }
  };

  for (const [sequence, queued] of ordered) {
    if (sequence <= acknowledgedSequence) continue;
    const inputAt = Math.max(simulationTime, queued.sentAt);
    advance(inputAt);
    input = queued.message;
  }
  advance(now);
  return { x, y, z };
}

function rayCylinderDistance(
  originX: number,
  originY: number,
  originZ: number,
  dirX: number,
  dirY: number,
  dirZ: number,
  radius: number,
  topY: number,
  maxDistance: number,
  isArenaWall: boolean
): number {
  const a = dirX * dirX + dirZ * dirZ;
  if (a < 1e-8) return maxDistance;

  const b = originX * dirX + originZ * dirZ;
  const c = originX * originX + originZ * originZ - radius * radius;
  const discriminant = b * b - a * c;
  if (discriminant < 0) return maxDistance;

  const root = Math.sqrt(discriminant);
  const near = (-b - root) / a;
  const far = (-b + root) / a;
  for (let i = 0; i < 2; i++) {
    const distance = i === 0 ? near : far;
    if (distance <= 0.001 || distance >= maxDistance) continue;

    const hitY = originY + dirY * distance;
    if (hitY < 0.55 || hitY > topY) continue;

    if (isArenaWall) {
      const hitX = originX + dirX * distance;
      const gate = ARENA.NORTH_GATE;
      if (
        hitY <= gate.height + 0.35 &&
        Math.abs(hitX - gate.x) <= gate.width * 0.5 + 0.2
      ) {
        continue;
      }
    }

    return distance;
  }
  return maxDistance;
}

function computeArenaCameraDistance(
  originX: number,
  originY: number,
  originZ: number,
  dirX: number,
  dirY: number,
  dirZ: number,
  maxDistance: number
): number {
  let nearest = maxDistance;

  for (let i = 0; i < ARENA.PILLARS.length; i++) {
    const pillar = ARENA.PILLARS[i];
    const distance = rayCylinderDistance(
      originX - pillar.x,
      originY,
      originZ - pillar.z,
      dirX,
      dirY,
      dirZ,
      pillar.radius + 0.18,
      pillar.height + 0.35,
      nearest,
      false
    );
    if (distance < nearest) nearest = distance;
  }

  const wallDistance = rayCylinderDistance(
    originX,
    originY,
    originZ,
    dirX,
    dirY,
    dirZ,
    ARENA.WALL_RADIUS - 0.45,
    4.6,
    nearest,
    true
  );
  if (wallDistance < nearest) nearest = wallDistance;
  return nearest;
}

function getLockableTargets(world: RoomWorldSnapshot, self: PlayerSnapshot): LockableTarget[] {
  const list: LockableTarget[] = [];
  const is3v3 = world.gameMode === "team_3v3";
  for (const e of world.enemies) {
    if (!e.alive) continue;
    if (is3v3 && self.team && e.team && e.team === self.team) continue;
    const scale = ENEMY_ARCHETYPES[e.kind]?.scale ?? 1.0;
    list.push({
      id: e.id,
      x: e.x,
      y: e.y ?? 0,
      z: e.z,
      height: 1.8 * scale,
    });
  }
  for (const p of world.players) {
    if (!p.alive || p.id === self.id) continue;
    if (is3v3 && self.team && p.team && p.team === self.team) continue;
    list.push({
      id: p.id,
      x: p.x,
      y: p.y ?? 0,
      z: p.z,
      height: 1.8,
    });
  }
  return list;
}

export function LocalPlayerController({
  player,
  spectateTargetId,
  worldRef,
  localPoseRef,
  graphicsTier,
  enemies,
  lockedEnemyId,
  shakeRef,
  activeExperimentalArt = null,
  sweptDebugRef,
  sweptTargetsRef,
  onLockChange,
  onMove,
  onAttack,
  onUseItem,
  onBlock,
  onDodge,
  onInteractGate,
  onNearLeverChange,
  selectedAbility = "fireball",
  onSelectAbility,
  onCastAbility,
  onExperimentalArt,
  onRigInspected,
}: LocalPlayerControllerProps) {
  const { camera, gl } = useThree();
  const livePoseRef = localPoseRef;

  const poseInitRef = useRef(false);
  if (!poseInitRef.current) {
    livePoseRef.current.x = player.x;
    livePoseRef.current.y = player.y ?? 0;
    livePoseRef.current.z = player.z;
    livePoseRef.current.yaw = player.yaw;
    livePoseRef.current.moveAnim = "idle";
    livePoseRef.current.speedRatio = 0;
    livePoseRef.current.isFlying = false;
    poseInitRef.current = true;
  }

  const velRef = useRef({ x: 0, y: 0, z: 0 });
  const groundedRef = useRef(true);
  const flyingRef = useRef(false);
  const jumpBoostGraceUntilRef = useRef(0);
  const jumpPressedPendingRef = useRef(false);
  const moveSequenceRef = useRef(0);
  const acknowledgedMoveSeqRef = useRef(0);
  const pendingMoveInputsRef = useRef(new Map<number, QueuedMoveInput>());
  const correctionOffsetRef = useRef({ x: 0, y: 0, z: 0 });
  const lastAuthorityRef = useRef({ sequence: -1, x: NaN, y: NaN, z: NaN });
  const flightOriginRef = useRef({ x: player.x, z: player.z });
  const flightUsedThisJumpRef = useRef(false);
  const knockbackTrackingRef = useRef(false);
  const coyoteUntilRef = useRef(0);
  const footstepTimerRef = useRef(0);
  const selectedAbilityRef = useRef(selectedAbility);
  selectedAbilityRef.current = selectedAbility;

  const camYawRef = useRef(player.yaw);
  const camPitchRef = useRef(0.38);
  const camDistRef = useRef(6.2);
  const camPosRef = useRef(new THREE.Vector3(player.x, 4.2, player.z + 6.2));
  const camLookRef = useRef(new THREE.Vector3(player.x, 1.5, player.z));
  const tmpCamPosRef = useRef(new THREE.Vector3());
  const tmpCamLookRef = useRef(new THREE.Vector3());
  const tmpCamDirRef = useRef(new THREE.Vector3());
  const tmpProjVecRef = useRef(new THREE.Vector3());
  const cameraRayOriginRef = useRef(new THREE.Vector3());
  const camInitRef = useRef(false);

  // Sekiro-style camera-flick target shifting state
  const lockFlickAccumXRef = useRef(0);
  const lockShiftCooldownUntilRef = useRef(0);

  const keysRef = useRef(new Set<string>());
  const blockingRef = useRef(false);
  const rmbHeldRef = useRef(false);
  const keyBlockHeldRef = useRef(false);
  const touchBlockHeldRef = useRef(false);
  const lastBlockAssertRef = useRef(0);
  const dodgeCooldownUntilRef = useRef(0);
  const localDodgeRemainingSecRef = useRef(0);
  const localDodgeDirRef = useRef({ x: 0, z: -1 });
  const lastMoveSendRef = useRef(0);
  const nearLeverRef = useRef(false);
  const wasAliveRef = useRef(player.alive);

  const draggingRef = useRef(false);
  const dragMovedRef = useRef(0);
  const lastMouseRef = useRef({ x: 0, y: 0 });

  const lockedIdRef = useRef(lockedEnemyId);
  lockedIdRef.current = lockedEnemyId;
  const aliveRef = useRef(player.alive);
  aliveRef.current = player.alive;
  const actionRef = useRef(player.action);
  actionRef.current = player.action;
  const playerRef = useRef(player);
  playerRef.current = player;

  // Snap local position on respawn
  useEffect(() => {
    if (!wasAliveRef.current && player.alive) {
      livePoseRef.current.x = player.x;
      livePoseRef.current.y = 0;
      livePoseRef.current.z = player.z;
      livePoseRef.current.yaw = player.yaw;
      livePoseRef.current.isFlying = false;
      livePoseRef.current.moveAnim = "idle";
      livePoseRef.current.speedRatio = 0;
      velRef.current = { x: 0, y: 0, z: 0 };
      groundedRef.current = true;
      flyingRef.current = false;
      jumpPressedPendingRef.current = false;
      jumpBoostGraceUntilRef.current = 0;
      flightOriginRef.current = { x: player.x, z: player.z };
      flightUsedThisJumpRef.current = false;
      knockbackTrackingRef.current = false;
      dodgeCooldownUntilRef.current = 0;
      localDodgeRemainingSecRef.current = 0;
      correctionOffsetRef.current = { x: 0, y: 0, z: 0 };
      pendingMoveInputsRef.current.clear();
      camYawRef.current = player.yaw;
      soundEngine.stopMeme(0.15);
    }
    wasAliveRef.current = player.alive;
  }, [player.alive, player.x, player.yaw, player.z]);

  // Auto-advance or clear lock when locked target dies
  useEffect(() => {
    if (!lockedEnemyId) return;
    const targets = getLockableTargets(worldRef.current, playerRef.current);
    const stillAlive = targets.some((t) => t.id === lockedEnemyId);
    if (!stillAlive) {
      if (document.querySelector(".touch-layer")) {
        // On touch devices, require tapping the next enemy manually
        onLockChange(null);
      } else {
        const next = findBestTargetNearAim(
          livePoseRef.current.x,
          livePoseRef.current.z,
          camYawRef.current,
          targets,
          LOCK_ON_MAX_RANGE
        );
        onLockChange(next ? next.id : null);
      }
    }
  }, [enemies, worldRef.current.players, lockedEnemyId, onLockChange]);

  const setLockedTarget = (nextId: string | null) => {
    lockedIdRef.current = nextId;
    lockFlickAccumXRef.current = 0;
    onLockChange(nextId);
  };

  /**
   * Sekiro-style directional lock shift:
   * Moving mouse/look right (`dir > 0`) shifts lock to the closest angular target on the right;
   * moving mouse/look left (`dir < 0`) shifts lock to the closest angular target on the left.
   */
  const shiftLockByLookDirection = (dir: 1 | -1): boolean => {
    const currentId = lockedIdRef.current;
    if (!currentId) return false;
    const pose = livePoseRef.current;
    const targets = getLockableTargets(worldRef.current, playerRef.current).filter(
      (t) => Math.hypot(t.x - pose.x, t.z - pose.z) <= LOCK_ON_MAX_RANGE
    );
    const current = targets.find((t) => t.id === currentId);
    if (!current || targets.length < 2) return false;

    const currentYaw = Math.atan2(current.x - pose.x, current.z - pose.z);
    let best: LockableTarget | null = null;
    let bestScore = Infinity;

    for (const candidate of targets) {
      if (candidate.id === currentId) continue;
      const candYaw = Math.atan2(candidate.x - pose.x, candidate.z - pose.z);
      // In our world (+X right when yaw=PI? Check: backX = -sin(yaw), so forward = (+sin(yaw), +cos(yaw)),
      // right vector = (-cos(yaw), +sin(yaw)). Moving mouse right decreases camYaw (`camYaw -= dx`),
      // so targets to the screen-right have `normalizeAngle(candYaw - currentYaw) < 0`!
      const relYaw = normalizeAngle(candYaw - currentYaw);
      const isDesiredSide = dir > 0 ? relYaw < -0.04 : relYaw > 0.04;
      if (!isDesiredSide) continue;

      const absAngle = Math.abs(relYaw);
      if (absAngle > Math.PI * 0.85) continue;
      const dist = Math.hypot(candidate.x - pose.x, candidate.z - pose.z);
      const score = absAngle * 2.4 + (dist / LOCK_ON_MAX_RANGE) * 0.65;
      if (score < bestScore) {
        bestScore = score;
        best = candidate;
      }
    }

    if (best) {
      lockShiftCooldownUntilRef.current = performance.now() + 260;
      setLockedTarget(best.id);
      return true;
    }
    return false;
  };

  const handleLookShiftImpulse = (pixelDx: number) => {
    if (!lockedIdRef.current) return;
    const now = performance.now();
    if (now < lockShiftCooldownUntilRef.current) return;
    lockFlickAccumXRef.current += pixelDx;
    if (Math.abs(lockFlickAccumXRef.current) >= 42) {
      const dir: 1 | -1 = lockFlickAccumXRef.current > 0 ? 1 : -1;
      lockFlickAccumXRef.current = 0;
      shiftLockByLookDirection(dir);
    }
  };

  const toggleLockOnBestTarget = () => {
    const pose = livePoseRef.current;
    if (lockedIdRef.current) {
      setLockedTarget(null);
      return;
    }
    const targets = getLockableTargets(worldRef.current, playerRef.current);
    const best = findBestTargetNearAim(
      pose.x,
      pose.z,
      camYawRef.current,
      targets,
      LOCK_ON_MAX_RANGE
    );
    if (best) {
      setLockedTarget(best.id);
    }
  };

  /**
   * Touch tap-to-lock: projects all living targets onto screen coordinates and locks onto
   * the tapped enemy (or unlocks if tapping the already-locked enemy).
   */
  const tapScreenToLock = (clientX: number, clientY: number) => {
    const rect = gl.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const pose = livePoseRef.current;
    const targets = getLockableTargets(worldRef.current, playerRef.current);
    const proj = tmpProjVecRef.current;
    const maxTapRadiusPx = 74;

    let bestTarget: LockableTarget | null = null;
    let bestPixelDist = maxTapRadiusPx;

    for (const t of targets) {
      const worldDist = Math.hypot(t.x - pose.x, t.z - pose.z);
      if (worldDist > LOCK_ON_MAX_RANGE + 4) continue;
      proj.set(t.x, t.y + t.height * 0.55, t.z).project(camera);
      if (proj.z < -1 || proj.z > 1) continue; // Behind camera

      const screenX = rect.left + (proj.x * 0.5 + 0.5) * rect.width;
      const screenY = rect.top + (-proj.y * 0.5 + 0.5) * rect.height;
      const pxDist = Math.hypot(clientX - screenX, clientY - screenY);
      if (pxDist < bestPixelDist) {
        bestPixelDist = pxDist;
        bestTarget = t;
      }
    }

    if (bestTarget) {
      if (lockedIdRef.current === bestTarget.id) {
        setLockedTarget(null);
      } else {
        setLockedTarget(bestTarget.id);
      }
    }
  };

  /**
   * Shared opt-in Auto-Lock on Attack (default off) so PC and mobile behave identically.
   */
  const ensureLockedTargetForAttack = () => {
    if (lockedIdRef.current) return;
    if (!controlsConfigRef.current.autoLockOnAttack) return;
    const pose = livePoseRef.current;
    const targets = getLockableTargets(worldRef.current, playerRef.current);
    const best = findBestTargetNearAim(
      pose.x,
      pose.z,
      camYawRef.current,
      targets,
      AUTO_LOCK_ATTACK_RANGE
    );
    if (best) {
      setLockedTarget(best.id);
    }
  };

  const getActiveLockedTarget = (): LockableTarget | null => {
    const id = lockedIdRef.current;
    if (!id) return null;
    const targets = getLockableTargets(worldRef.current, playerRef.current);
    return targets.find((t) => t.id === id) ?? null;
  };

  const getCombatYaw = (preferCamera = false): number => {
    const pose = livePoseRef.current;
    const target = getActiveLockedTarget();
    if (target) {
      return yawFromDelta(target.x - pose.x, target.z - pose.z);
    }
    if (preferCamera) {
      return camYawRef.current;
    }
    const move = computeMoveDir(
      keysRef.current,
      camYawRef.current,
      controlsConfigRef.current.bindings
    );
    if (move.moving) {
      return yawFromDelta(move.x, move.z);
    }
    return pose.yaw;
  };

  const getPilumAim = (): { yaw: number; pitch: number } => {
    const pose = livePoseRef.current;
    const handX = pose.x;
    const handY = pose.y + 1.38;
    const handZ = pose.z;

    const target = getActiveLockedTarget();
    if (target) {
      const dx = target.x - handX;
      const dy = target.y + target.height * 0.62 - handY;
      const dz = target.z - handZ;
      const horizDist = Math.hypot(dx, dz) || 0.0001;
      return {
        yaw: Math.atan2(dx, dz),
        pitch: Math.atan2(dy, horizDist) + Math.min(0.12, horizDist * 0.004),
      };
    }

    const camDir = tmpCamDirRef.current;
    camera.getWorldDirection(camDir);
    const camPos = camera.position;

    let t = 28;
    if (camDir.y < -0.04) {
      const tGround = (0.65 - camPos.y) / camDir.y;
      if (tGround > 2.5 && tGround < t) {
        t = tGround;
      }
    }

    let aimX = camPos.x + camDir.x * t;
    let aimY = camPos.y + camDir.y * t;
    let aimZ = camPos.z + camDir.z * t;

    let bestPerpSq = 0.95 * 0.95;
    for (const e of getLockableTargets(worldRef.current, playerRef.current)) {
      const targetChestY = e.y + e.height * 0.62;
      const ex = e.x - camPos.x;
      const ey = targetChestY - camPos.y;
      const ez = e.z - camPos.z;
      const forwardDist = ex * camDir.x + ey * camDir.y + ez * camDir.z;
      if (forwardDist < 2.5 || forwardDist > 28) continue;

      const px = ex - camDir.x * forwardDist;
      const py = ey - camDir.y * forwardDist;
      const pz = ez - camDir.z * forwardDist;
      const perpSq = px * px + py * py + pz * pz;
      if (perpSq <= bestPerpSq) {
        bestPerpSq = perpSq;
        aimX = e.x;
        aimY = targetChestY;
        aimZ = e.z;
      }
    }

    const dx = aimX - handX;
    const dy = aimY - handY;
    const dz = aimZ - handZ;
    const horizDist = Math.hypot(dx, dz) || 0.0001;
    return {
      yaw: Math.atan2(dx, dz),
      pitch: Math.atan2(dy, horizDist) + Math.min(0.12, horizDist * 0.004),
    };
  };

  useEffect(() => {
    if (!player.alive || player.action === "staggered") {
      blockingRef.current = false;
      return;
    }

    const blockHeld = rmbHeldRef.current || keyBlockHeldRef.current || touchBlockHeldRef.current;
    if (!blockHeld) return;

    const canResumeBlock =
      player.action === "idle" || player.action === "move" || player.action === "jump";
    if (
      canResumeBlock &&
      !player.isBlocking &&
      (!blockingRef.current || performance.now() - lastBlockAssertRef.current >= 150)
    ) {
      blockingRef.current = true;
      lastBlockAssertRef.current = performance.now();
      soundEngine.playGuardRaise();
      const aim = lockedIdRef.current ? getCombatYaw(false) : livePoseRef.current.yaw;
      livePoseRef.current.yaw = aim;
      onBlock({ active: true, yaw: aim });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player.alive, player.action, player.isBlocking, onBlock]);

  useEffect(() => {
    const dom = gl.domElement;
    const isModalOpen = () => Boolean(document.querySelector(".ui-modal-backdrop"));

    const triggerJump = () => {
      if (!aliveRef.current || actionRef.current === "staggered" || actionRef.current === "shocked") return;
      const now = performance.now();
      if (groundedRef.current || now <= coyoteUntilRef.current) {
        jumpPressedPendingRef.current = true;
        const swiftBoost = playerRef.current.swiftFeetMs > 0 ? COMBAT.SWIFT_FEET_SPEED_MULT : 1.0;
        velRef.current.y = COMBAT.PLAYER_JUMP_VELOCITY * swiftBoost;
        groundedRef.current = false;
        flyingRef.current = false;
        flightOriginRef.current = { x: livePoseRef.current.x, z: livePoseRef.current.z };
        flightUsedThisJumpRef.current = false;
        coyoteUntilRef.current = 0;
        jumpBoostGraceUntilRef.current = now + 180;
        soundEngine.playJump();
      } else if (playerRef.current.flightFuelMs > 40) {
        // Mid-air press engages propulsion immediately while held
        jumpPressedPendingRef.current = true;
        flyingRef.current = true;
        flightUsedThisJumpRef.current = true;
        jumpBoostGraceUntilRef.current = 0;
        velRef.current.y = Math.max(velRef.current.y, FLIGHT.IGNITION_MIN_VY);
      }
    };

    const triggerCastAbility = () => {
      if (!aliveRef.current || actionRef.current === "staggered" || actionRef.current === "shocked") return;
      if (!onCastAbility || playerRef.current.abilityCooldownMs > 0) return;
      const aim = getPilumAim();
      livePoseRef.current.yaw = aim.yaw;
      onCastAbility({
        ability: selectedAbilityRef.current,
        yaw: aim.yaw,
        pitch: aim.pitch,
      });
    };

    const triggerCycleAbility = () => {
      if (!onSelectAbility) return;
      const order: PlayerAbilityKind[] = ["fireball", "arcane_spell", "stun_gun"];
      const idx = order.indexOf(selectedAbilityRef.current);
      onSelectAbility(order[(idx + 1) % order.length]);
    };

    const triggerDodge = () => {
      if (!aliveRef.current || actionRef.current === "staggered") return;
      const now = performance.now();
      if (now < dodgeCooldownUntilRef.current) return;
      const dodgeCdMs = Math.round(
        COMBAT.DODGE_COOLDOWN_MS * (playerRef.current.swiftFeetMs > 0 ? 0.78 : 1.0)
      );
      dodgeCooldownUntilRef.current = now + dodgeCdMs;
      const move = computeMoveDir(
        keysRef.current,
        camYawRef.current,
        controlsConfigRef.current.bindings
      );
      const dirX = move.moving ? move.x : Math.sin(livePoseRef.current.yaw);
      const dirZ = move.moving ? move.z : Math.cos(livePoseRef.current.yaw);
      const swiftMult = playerRef.current.swiftFeetMs > 0 ? COMBAT.SWIFT_FEET_SPEED_MULT : 1.0;
      const slideSpeed = COMBAT.PLAYER_DODGE_SPEED * 0.72 * swiftMult;
      localDodgeRemainingSecRef.current = COMBAT.DODGE_DURATION_MS / 1000;
      localDodgeDirRef.current = { x: dirX, z: dirZ };
      velRef.current.x = dirX * slideSpeed;
      velRef.current.z = dirZ * slideSpeed;
      soundEngine.playDodge();
      onDodge({ dirX, dirZ, yaw: livePoseRef.current.yaw });
    };

    const triggerMelee = (kind: "light" | "heavy") => {
      if (!aliveRef.current || actionRef.current === "staggered") return;
      ensureLockedTargetForAttack();
      const aim = getCombatYaw(false);
      livePoseRef.current.yaw = aim;

      if (!groundedRef.current && livePoseRef.current.y > 0.38) {
        const act = actionRef.current;
        flyingRef.current = false;
        if (act !== "dodge" && act !== "hurt" && act !== "aerial_slam") {
          velRef.current.y = -24;
        }
        onAttack({ kind: "aerial", yaw: aim });
        return;
      }

      onAttack({ kind, yaw: aim });
    };

    const triggerPunch = () => {
      if (!aliveRef.current || actionRef.current === "staggered" || knockbackTrackingRef.current) return;
      ensureLockedTargetForAttack();
      const aim = getCombatYaw(false);
      livePoseRef.current.yaw = aim;
      if (groundedRef.current) {
        velRef.current.x = Math.sin(aim) * 3.8;
        velRef.current.z = Math.cos(aim) * 3.8;
      }
      onAttack({ kind: "punch", yaw: aim });
    };

    const triggerSelectedArt = () => {
      if (!EXPERIMENTAL_SPECIAL_MOVES || !onExperimentalArt) return;
      if (!aliveRef.current || actionRef.current === "staggered") return;
      const art = (playerRef.current.selectedArt ?? "ashina_cross") as ExperimentalArtKind;
      ensureLockedTargetForAttack();
      const aim = getCombatYaw(false);
      livePoseRef.current.yaw = aim;
      onExperimentalArt(art, aim);
    };

    const triggerUseSlot = (slotIndex: number) => {
      if (!aliveRef.current || actionRef.current === "staggered") return;
      const slot = playerRef.current.belt[slotIndex];
      if (!slot || !slot.kind || slot.charges <= 0) return;
      onUseItem({ slotIndex, yaw: livePoseRef.current.yaw });
    };

    const triggerQuickItem = () => {
      const idx = playerRef.current.belt.findIndex((s) => s.kind && s.charges > 0);
      if (idx >= 0) triggerUseSlot(idx);
    };

    const setBlockState = (active: boolean) => {
      if (active) {
        if (!aliveRef.current || actionRef.current === "staggered") return;
        if (!blockingRef.current) {
          blockingRef.current = true;
          lastBlockAssertRef.current = performance.now();
          soundEngine.playGuardRaise();
          const aim = lockedIdRef.current ? getCombatYaw(false) : livePoseRef.current.yaw;
          livePoseRef.current.yaw = aim;
          onBlock({ active: true, yaw: aim });
        }
      } else if (blockingRef.current) {
        blockingRef.current = false;
        onBlock({ active: false, yaw: livePoseRef.current.yaw });
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      ) {
        return;
      }
      if (isModalOpen()) {
        keysRef.current.clear();
        return;
      }

      const code = e.code;
      const b = controlsConfigRef.current.bindings;
      keysRef.current.add(code);
      soundEngine.unlock();

      if (code === b.lockTarget) {
        e.preventDefault();
        if (!e.repeat) toggleLockOnBestTarget();
      } else if (code === b.interact && !e.repeat) {
        onInteractGate();
      } else if (code === b.jump && !e.repeat) {
        e.preventDefault();
        triggerJump();
      } else if (
        (code === b.dodge || (b.dodge === "ShiftLeft" && code === "ShiftRight")) &&
        !e.repeat
      ) {
        triggerDodge();
      } else if (code === b.lightAttack && !e.repeat) {
        triggerMelee("light");
      } else if (code === b.punch && !e.repeat) {
        triggerPunch();
      } else if (code === b.block && !e.repeat) {
        keyBlockHeldRef.current = true;
        setBlockState(true);
      } else if (code === b.combatArt && !e.repeat) {
        e.preventDefault();
        triggerSelectedArt();
      } else if (code === b.castAbility && !e.repeat) {
        e.preventDefault();
        triggerCastAbility();
      } else if (code === b.cycleAbility && !e.repeat) {
        e.preventDefault();
        triggerCycleAbility();
      } else if (code === b.item1 && !e.repeat) {
        triggerUseSlot(0);
      } else if (code === b.item2 && !e.repeat) {
        triggerUseSlot(1);
      } else if (code === b.item3 && !e.repeat) {
        triggerUseSlot(2);
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      keysRef.current.delete(e.code);
      if (e.code === controlsConfigRef.current.bindings.block) {
        keyBlockHeldRef.current = false;
        if (!rmbHeldRef.current && !touchBlockHeldRef.current) {
          setBlockState(false);
        }
      }
    };

    const LMB_HEAVY_HOLD_MS = 230;
    let lmbHoldTimer: number | null = null;
    let lmbHeavyFired = false;

    const clearLmbTimer = () => {
      if (lmbHoldTimer !== null) {
        window.clearTimeout(lmbHoldTimer);
        lmbHoldTimer = null;
      }
    };

    const onMouseDown = (e: MouseEvent) => {
      if (e.target !== dom || isModalOpen()) return;
      soundEngine.unlock();

      if (e.button === 1) {
        e.preventDefault();
        toggleLockOnBestTarget();
        return;
      }

      if (e.button === 0) {
        clearLmbTimer();
        lmbHeavyFired = false;
        if (document.pointerLockElement === dom) {
          lmbHoldTimer = window.setTimeout(() => {
            lmbHoldTimer = null;
            lmbHeavyFired = true;
            triggerMelee("heavy");
          }, LMB_HEAVY_HOLD_MS);
        } else {
          draggingRef.current = true;
          dragMovedRef.current = 0;
          lastMouseRef.current = { x: e.clientX, y: e.clientY };
          lmbHoldTimer = window.setTimeout(() => {
            lmbHoldTimer = null;
            if (draggingRef.current && dragMovedRef.current < 6 && !isModalOpen()) {
              draggingRef.current = false;
              lmbHeavyFired = true;
              dom.requestPointerLock?.();
              triggerMelee("heavy");
            }
          }, LMB_HEAVY_HOLD_MS);
        }
      } else if (e.button === 2) {
        rmbHeldRef.current = true;
        setBlockState(true);
      }
    };

    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 0) {
        const hadPendingTap = lmbHoldTimer !== null;
        clearLmbTimer();
        if (draggingRef.current) {
          draggingRef.current = false;
          if (!lmbHeavyFired && dragMovedRef.current < 6 && e.target === dom && !isModalOpen()) {
            dom.requestPointerLock?.();
            triggerMelee("light");
          }
        } else if (hadPendingTap && !lmbHeavyFired && !isModalOpen()) {
          triggerMelee("light");
        }
        lmbHeavyFired = false;
      } else if (e.button === 2) {
        rmbHeldRef.current = false;
        if (!keyBlockHeldRef.current && !touchBlockHeldRef.current) {
          setBlockState(false);
        }
      }
    };

    const onMouseMove = (e: MouseEvent) => {
      if (isModalOpen()) return;
      const sens = controlsConfigRef.current.mouseSensitivity;
      if (document.pointerLockElement === dom) {
        camYawRef.current -= e.movementX * 0.0028 * sens;
        camPitchRef.current = THREE.MathUtils.clamp(
          camPitchRef.current + e.movementY * 0.0026 * sens,
          MIN_CAM_PITCH,
          MAX_CAM_PITCH
        );
        handleLookShiftImpulse(e.movementX * sens);
      } else if (draggingRef.current) {
        const dx = e.clientX - lastMouseRef.current.x;
        const dy = e.clientY - lastMouseRef.current.y;
        lastMouseRef.current = { x: e.clientX, y: e.clientY };
        dragMovedRef.current += Math.hypot(dx, dy);

        camYawRef.current -= dx * 0.0052 * sens;
        camPitchRef.current = THREE.MathUtils.clamp(
          camPitchRef.current + dy * 0.0048 * sens,
          MIN_CAM_PITCH,
          MAX_CAM_PITCH
        );
        handleLookShiftImpulse(dx * 1.4 * sens);
      }
    };

    const onWheel = (e: WheelEvent) => {
      if (e.target !== dom || isModalOpen()) return;
      if (lockedIdRef.current && Math.abs(e.deltaY) > 1) {
        e.preventDefault();
        shiftLockByLookDirection(e.deltaY > 0 ? 1 : -1);
        return;
      }
      camDistRef.current = THREE.MathUtils.clamp(camDistRef.current + e.deltaY * 0.004, 4.2, 9.6);
    };

    const onContextMenu = (e: MouseEvent) => {
      if (e.target === dom) e.preventDefault();
    };

    const onBlur = () => {
      clearLmbTimer();
      lmbHeavyFired = false;
      keysRef.current.clear();
      resetTouchInputState();
      draggingRef.current = false;
      rmbHeldRef.current = false;
      keyBlockHeldRef.current = false;
      touchBlockHeldRef.current = false;
      setBlockState(false);
    };

    touchInput.handlers = {
      smallAttack: () => triggerMelee("light"),
      bigAttack: () => triggerMelee("heavy"),
      punch: triggerPunch,
      castAbility: triggerCastAbility,
      cycleAbility: triggerCycleAbility,
      useItemSlot: triggerUseSlot,
      useQuickItem: triggerQuickItem,
      setBlock: (active: boolean) => {
        touchBlockHeldRef.current = active;
        if (active) {
          setBlockState(true);
        } else if (!rmbHeldRef.current && !keyBlockHeldRef.current) {
          setBlockState(false);
        }
      },
      jump: triggerJump,
      dodge: triggerDodge,
      toggleLock: toggleLockOnBestTarget,
      tapScreenToLock,
      interactGate: onInteractGate,
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("contextmenu", onContextMenu);
    window.addEventListener("blur", onBlur);
    return () => {
      clearLmbTimer();
      touchInput.handlers = null;
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("blur", onBlur);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl.domElement, onAttack, onUseItem, onBlock, onDodge, onInteractGate, onExperimentalArt]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const pose = livePoseRef.current;
    const vel = velRef.current;

    if (document.querySelector(".ui-modal-backdrop")) {
      keysRef.current.clear();
      touchInput.moveX = 0;
      touchInput.moveForward = 0;
      touchInput.jumpHeld = false;
    }

    // Decay accumulated Sekiro camera-flick impulse smoothly so slow drift doesn't shift targets
    lockFlickAccumXRef.current *= Math.exp(-9 * dt);

    if (touchInput.lookDeltaX !== 0 || touchInput.lookDeltaY !== 0) {
      const sens = controlsConfigRef.current.mouseSensitivity;
      camYawRef.current -= touchInput.lookDeltaX * 0.0065 * sens;
      camPitchRef.current = THREE.MathUtils.clamp(
        camPitchRef.current + touchInput.lookDeltaY * 0.0058 * sens,
        MIN_CAM_PITCH,
        MAX_CAM_PITCH
      );
      touchInput.lookDeltaX = 0;
      touchInput.lookDeltaY = 0;
    }

    if (keysRef.current.has("ArrowLeft")) {
      camYawRef.current += 2.3 * dt;
      handleLookShiftImpulse(-180 * dt);
    }
    if (keysRef.current.has("ArrowRight")) {
      camYawRef.current -= 2.3 * dt;
      handleLookShiftImpulse(180 * dt);
    }
    if (keysRef.current.has("ArrowUp")) {
      camPitchRef.current = THREE.MathUtils.clamp(camPitchRef.current - 1.6 * dt, MIN_CAM_PITCH, MAX_CAM_PITCH);
    }
    if (keysRef.current.has("ArrowDown")) {
      camPitchRef.current = THREE.MathUtils.clamp(camPitchRef.current + 1.6 * dt, MIN_CAM_PITCH, MAX_CAM_PITCH);
    }

    const liveWorld = worldRef.current;
    const liveSelf = liveWorld.players.find((p) => p.id === player.id) ?? player;
    const spectateTarget = !player.alive
      ? liveWorld.players.find((p) => p.id === spectateTargetId && p.alive) ?? null
      : null;
    const lockedTarget = getActiveLockedTarget();

    if (lockedTarget) {
      const distToEnemy = Math.hypot(lockedTarget.x - pose.x, lockedTarget.z - pose.z);
      if (distToEnemy > LOCK_ON_BREAK_RANGE) {
        lockedIdRef.current = null;
        onLockChange(null);
      }
    } else if (lockedIdRef.current) {
      // Locked target died or left — smoothly auto-switch to next nearest target in front
      const targets = getLockableTargets(liveWorld, liveSelf);
      if (document.querySelector(".touch-layer")) {
        lockedIdRef.current = null;
        onLockChange(null);
      } else {
        const next = findBestTargetNearAim(pose.x, pose.z, camYawRef.current, targets, LOCK_ON_MAX_RANGE);
        setLockedTarget(next ? next.id : null);
      }
    }

    let moving = false;
    let moveAnim: LocomotionAnim = "idle";
    const swiftMult = liveSelf.swiftFeetMs > 0 ? COMBAT.SWIFT_FEET_SPEED_MULT : 1.0;
    const jumpHeld = keysRef.current.has(controlsConfigRef.current.bindings.jump) || touchInput.jumpHeld;
    const canPropel =
      !groundedRef.current &&
      jumpHeld &&
      performance.now() >= jumpBoostGraceUntilRef.current &&
      liveSelf.flightFuelMs > 40 &&
      liveSelf.action !== "staggered" &&
      liveSelf.action !== "shocked" &&
      liveSelf.action !== "knockback" &&
      liveSelf.alive &&
      !knockbackTrackingRef.current;

    if (
      liveSelf.alive &&
      !knockbackTrackingRef.current &&
      liveSelf.action === "knockback" &&
      liveSelf.y > 0.15
    ) {
      knockbackTrackingRef.current = true;
      groundedRef.current = false;
      vel.x = 0;
      vel.y = 0;
      vel.z = 0;
    }

    if (knockbackTrackingRef.current) {
      if (!liveSelf.alive || (liveSelf.y <= 0.06 && liveSelf.action !== "knockback")) {
        knockbackTrackingRef.current = false;
        pose.x = THREE.MathUtils.lerp(pose.x, liveSelf.x, 0.5);
        pose.z = THREE.MathUtils.lerp(pose.z, liveSelf.z, 0.5);
        pose.y = 0;
        vel.x = 0;
        vel.y = 0;
        vel.z = 0;
        groundedRef.current = true;
      } else {
        const trackAlpha = 1 - Math.exp(-22 * dt);
        pose.x = THREE.MathUtils.lerp(pose.x, liveSelf.x, trackAlpha);
        pose.y = THREE.MathUtils.lerp(pose.y, liveSelf.y, trackAlpha);
        pose.z = THREE.MathUtils.lerp(pose.z, liveSelf.z, trackAlpha);
        vel.x = 0;
        vel.y = 0;
        vel.z = 0;
        moveAnim = "jump";
      }
    } else if (liveSelf.alive && liveSelf.action !== "staggered" && liveSelf.action !== "shocked") {
      const move = computeMoveDir(
        keysRef.current,
        camYawRef.current,
        controlsConfigRef.current.bindings
      );
      moving = move.moving;

      const isAttacking =
        liveSelf.action === "light1" ||
        liveSelf.action === "light2" ||
        liveSelf.action === "heavy" ||
        liveSelf.action === "punch" ||
        liveSelf.action === "whirlwind" ||
        liveSelf.action === "aerial_slam" ||
        liveSelf.action === "counter";
      const isLocalDodge = localDodgeRemainingSecRef.current > 0;
      const isDodge = liveSelf.action === "dodge" || isLocalDodge;
      const isBurstMove = isLocalDodge || liveSelf.action === "thrust";

      if (!isBurstMove) {
        const flightSpeedMult = groundedRef.current ? 1.0 : FLIGHT.FLY_SPEED_MULT;
        const targetSpeed = !moving
          ? 0
          : liveSelf.isBlocking
            ? COMBAT.PLAYER_BLOCK_SPEED * swiftMult * flightSpeedMult
            : isAttacking
              ? COMBAT.PLAYER_MOVE_SPEED * swiftMult * 0.35 * flightSpeedMult
              : COMBAT.PLAYER_MOVE_SPEED * swiftMult * flightSpeedMult;

        const targetVx = move.x * targetSpeed;
        const targetVz = move.z * targetSpeed;
        const rate = groundedRef.current
          ? (moving ? 30 : 22)
          : moving
            ? (canPropel ? FLIGHT.FLY_ACCEL_XZ : FLIGHT.AIR_STEER_ACCEL)
            : FLIGHT.AIR_COAST_DRAG;
        const blend = 1 - Math.exp(-rate * dt);
        vel.x = THREE.MathUtils.lerp(vel.x, targetVx, blend);
        vel.z = THREE.MathUtils.lerp(vel.z, targetVz, blend);
      } else if (isLocalDodge) {
        const stepDt = Math.min(dt, localDodgeRemainingSecRef.current);
        localDodgeRemainingSecRef.current = Math.max(0, localDodgeRemainingSecRef.current - stepDt);
        const slideSpeed = COMBAT.PLAYER_DODGE_SPEED * 0.72 * swiftMult;
        const scale = dt > 1e-6 ? stepDt / dt : 0;
        vel.x = localDodgeDirRef.current.x * slideSpeed * scale;
        vel.z = localDodgeDirRef.current.z * slideSpeed * scale;
      } else {
        const drag = 1 - Math.exp(-6.0 * dt);
        vel.x = THREE.MathUtils.lerp(vel.x, 0, drag);
        vel.z = THREE.MathUtils.lerp(vel.z, 0, drag);
      }

      let nextX = pose.x + vel.x * dt;
      let nextZ = pose.z + vel.z * dt;

      if (pose.y < 1.3 && !isDodge) {
        for (const e of liveWorld.enemies) {
          if (!e.alive || Math.abs((e.y ?? 0) - pose.y) > 1.3) continue;
          const dx = nextX - e.x;
          const dz = nextZ - e.z;
          const dSq = dx * dx + dz * dz;
          if (dSq < MIN_ENTITY_SEP * MIN_ENTITY_SEP) {
            let nx = 1;
            let nz = 0;
            if (dSq >= 1e-8) {
              const d = Math.sqrt(dSq);
              nx = dx / d;
              nz = dz / d;
            }
            nextX = e.x + nx * MIN_ENTITY_SEP;
            nextZ = e.z + nz * MIN_ENTITY_SEP;
          }
        }
        for (const other of liveWorld.players) {
          if (other.id === player.id || !other.alive || Math.abs((other.y ?? 0) - pose.y) > 1.3) continue;
          const dx = nextX - other.x;
          const dz = nextZ - other.z;
          const dSq = dx * dx + dz * dz;
          if (dSq < MIN_ENTITY_SEP * MIN_ENTITY_SEP) {
            let nx = 1;
            let nz = 0;
            if (dSq >= 1e-8) {
              const d = Math.sqrt(dSq);
              nx = dx / d;
              nz = dz / d;
            }
            nextX = other.x + nx * MIN_ENTITY_SEP;
            nextZ = other.z + nz * MIN_ENTITY_SEP;
          }
        }
      }

      const clamped = clampToArena(nextX, nextZ, ARENA.ENTITY_RADIUS, false, liveWorld.arenaMap);
      pose.x = clamped.x;
      pose.z = clamped.z;
      if (flightUsedThisJumpRef.current && !groundedRef.current) {
        const dx = pose.x - flightOriginRef.current.x;
        const dz = pose.z - flightOriginRef.current.z;
        const distance = Math.hypot(dx, dz);
        if (distance > FLIGHT.MAX_BURST_DISTANCE) {
          const scale = FLIGHT.MAX_BURST_DISTANCE / distance;
          pose.x = flightOriginRef.current.x + dx * scale;
          pose.z = flightOriginRef.current.z + dz * scale;
          const nx = dx / distance;
          const nz = dz / distance;
          const intoLimit = vel.x * nx + vel.z * nz;
          if (intoLimit > 0) {
            vel.x -= intoLimit * nx;
            vel.z -= intoLimit * nz;
          }
        }
      }

      flyingRef.current = canPropel;
      if (canPropel) flightUsedThisJumpRef.current = true;

      if (flyingRef.current) {
        // Hold-to-fly propulsion: gains altitude while held
        const alphaY = 1 - Math.exp(-FLIGHT.THRUST_ACCEL_Y * dt);
        vel.y = THREE.MathUtils.lerp(vel.y, FLIGHT.ASCEND_SPEED, alphaY);
        pose.y = Math.min(FLIGHT.MAX_Y, pose.y + vel.y * dt);
        if (pose.y >= FLIGHT.MAX_Y) {
          vel.y = Math.min(vel.y, 0);
        }
        groundedRef.current = false;
      } else if (!groundedRef.current || vel.y !== 0 || pose.y > 0) {
        vel.y -= COMBAT.PLAYER_GRAVITY * dt;
        pose.y += vel.y * dt;
        if (pose.y <= 0) {
          pose.y = 0;
          vel.y = 0;
          if (!groundedRef.current) {
            groundedRef.current = true;
          }
          flightUsedThisJumpRef.current = false;
        }
      } else {
        coyoteUntilRef.current = performance.now() + 90;
      }

      if (lockedTarget) {
        const faceEnemy = yawFromDelta(lockedTarget.x - pose.x, lockedTarget.z - pose.z);
        const diff = normalizeAngle(faceEnemy - pose.yaw);
        pose.yaw += diff * Math.min(1, dt * 18);
      } else if (moving && !isAttacking && !isBurstMove) {
        const moveYaw = yawFromDelta(move.x, move.z);
        const diff = normalizeAngle(moveYaw - pose.yaw);
        pose.yaw += diff * Math.min(1, dt * (liveSelf.isBlocking ? 10 : 15));
      }

      if (flyingRef.current && pose.y > 0.25) {
        moveAnim = "fly";
      } else if (!groundedRef.current || pose.y > 0.12) {
        moveAnim = "jump";
      } else if (Math.hypot(vel.x, vel.z) > 0.55) {
        if (lockedTarget || liveSelf.isBlocking) {
          const fwdX = Math.sin(pose.yaw);
          const fwdZ = Math.cos(pose.yaw);
          const rightX = -Math.cos(pose.yaw);
          const rightZ = Math.sin(pose.yaw);
          const fwdDot = vel.x * fwdX + vel.z * fwdZ;
          const rightDot = vel.x * rightX + vel.z * rightZ;
          if (Math.abs(rightDot) > Math.abs(fwdDot) * 1.15) {
            moveAnim = rightDot > 0 ? "strafe_right" : "strafe_left";
          } else {
            moveAnim = fwdDot < -0.4 ? "backpedal" : "run";
          }
        } else {
          moveAnim = "run";
        }

        footstepTimerRef.current += dt;
        const stepInterval = (liveSelf.isBlocking ? 0.38 : 0.26) / swiftMult;
        if (footstepTimerRef.current >= stepInterval) {
          footstepTimerRef.current = 0;
          soundEngine.playFootstep();
        }
      } else {
        footstepTimerRef.current = 0.22;
      }
    } else {
      vel.x *= Math.exp(-15 * dt);
      vel.z *= Math.exp(-15 * dt);
      if (pose.y > 0) {
        vel.y -= COMBAT.PLAYER_GRAVITY * dt;
        pose.y = Math.max(0, pose.y + vel.y * dt);
        if (pose.y <= 0.001) {
          pose.y = 0;
          vel.y = 0;
          groundedRef.current = true;
          flyingRef.current = false;
          flightUsedThisJumpRef.current = false;
        }
      }
    }

    pose.moveAnim = moveAnim;
    pose.isFlying = flyingRef.current;
    const flightSpeedMult = groundedRef.current ? 1.0 : FLIGHT.FLY_SPEED_MULT;
    pose.speedRatio = Math.min(
      1,
      Math.hypot(vel.x, vel.z) / (COMBAT.PLAYER_MOVE_SPEED * swiftMult * flightSpeedMult)
    );

    const authority = lastAuthorityRef.current;
    const authorityChanged =
      liveSelf.lastMoveSeq !== authority.sequence ||
      Math.abs(liveSelf.x - authority.x) > 0.001 ||
      Math.abs(liveSelf.y - authority.y) > 0.001 ||
      Math.abs(liveSelf.z - authority.z) > 0.001;
    if (authorityChanged) {
      acknowledgedMoveSeqRef.current = Math.max(acknowledgedMoveSeqRef.current, liveSelf.lastMoveSeq);
      for (const sequence of pendingMoveInputsRef.current.keys()) {
        if (sequence < acknowledgedMoveSeqRef.current - 1) pendingMoveInputsRef.current.delete(sequence);
      }
      if (!knockbackTrackingRef.current && liveSelf.alive === player.alive) {
        const dodgeActive =
          liveSelf.action === "dodge" || localDodgeRemainingSecRef.current > 0;
        if (dodgeActive || liveSelf.action === "thrust") {
          // Keep locally predicted slide/thrust continuous; clear stale move inputs so dodge end never snaps.
          pendingMoveInputsRef.current.clear();
          correctionOffsetRef.current = { x: 0, y: 0, z: 0 };
        } else {
          const replayed = replayPendingMoveInputs(
            liveSelf,
            acknowledgedMoveSeqRef.current,
            pendingMoveInputsRef.current,
            performance.now(),
            liveWorld.arenaMap
          );
          const corrDx = replayed.x - pose.x;
          const corrDz = replayed.z - pose.z;
          if (Math.hypot(corrDx, corrDz) > 6.0) {
            pose.x = replayed.x;
            pose.y = replayed.y;
            pose.z = replayed.z;
            vel.x = 0;
            vel.y = 0;
            vel.z = 0;
            correctionOffsetRef.current = { x: 0, y: 0, z: 0 };
          } else {
            correctionOffsetRef.current = {
              x: corrDx,
              y: replayed.y - pose.y,
              z: corrDz,
            };
          }
        }
      }
      lastAuthorityRef.current = {
        sequence: liveSelf.lastMoveSeq,
        x: liveSelf.x,
        y: liveSelf.y,
        z: liveSelf.z,
      };
    }

    if (!knockbackTrackingRef.current && player.alive) {
      const offset = correctionOffsetRef.current;
      const alpha = 1 - Math.exp(-12 * dt);
      let correctionX = offset.x * alpha;
      let correctionZ = offset.z * alpha;
      const correctionLength = Math.hypot(correctionX, correctionZ);
      const maxCorrection = 6 * dt;
      if (correctionLength > maxCorrection && correctionLength > 0) {
        const scale = maxCorrection / correctionLength;
        correctionX *= scale;
        correctionZ *= scale;
      }
      const correctionY = THREE.MathUtils.clamp(offset.y * alpha, -8 * dt, 8 * dt);
      pose.x += correctionX;
      pose.y += correctionY;
      pose.z += correctionZ;
      offset.x -= correctionX;
      offset.y -= correctionY;
      offset.z -= correctionZ;
    }

    const leverDist = Math.hypot(pose.x - ARENA.NORTH_GATE.leverX, pose.z - ARENA.NORTH_GATE.leverZ);
    const near = leverDist <= ARENA.NORTH_GATE.interactRadius;
    if (near !== nearLeverRef.current) {
      nearLeverRef.current = near;
      onNearLeverChange(near);
    }

    const now = performance.now();
    if (!knockbackTrackingRef.current && now - lastMoveSendRef.current >= COMBAT.SERVER_TICK_MS) {
      lastMoveSendRef.current = now;
      const input = computeMoveDir(
        keysRef.current,
        camYawRef.current,
        controlsConfigRef.current.bindings
      );
      const sequence = ++moveSequenceRef.current;
      const message: MoveMessage = {
        sequence,
        moveX: input.x,
        moveZ: input.z,
        jumpPressed: jumpPressedPendingRef.current,
        jumpHeld: keysRef.current.has(controlsConfigRef.current.bindings.jump) || touchInput.jumpHeld,
        yaw: pose.yaw,
      };
      jumpPressedPendingRef.current = false;
      pendingMoveInputsRef.current.set(sequence, { message, sentAt: now });
      while (pendingMoveInputsRef.current.size > 120) {
        const oldest = pendingMoveInputsRef.current.keys().next().value;
        if (oldest === undefined) break;
        pendingMoveInputsRef.current.delete(oldest);
      }
      onMove(message);
    }

    // Smooth Sekiro-style Lock-On Camera Tracking (keeps target framed over shoulder)
    if (lockedTarget && !spectateTarget) {
      const toTargetX = lockedTarget.x - pose.x;
      const toTargetZ = lockedTarget.z - pose.z;
      const horizDist = Math.hypot(toTargetX, toTargetZ);
      if (horizDist > 0.25) {
        const desiredCamYaw = Math.atan2(toTargetX, toTargetZ);
        const yawDiff = normalizeAngle(desiredCamYaw - camYawRef.current);
        camYawRef.current += yawDiff * (1 - Math.exp(-10.5 * dt));

        const targetChestY = lockedTarget.y + lockedTarget.height * 0.55;
        const playerShoulderY = pose.y + 1.65;
        const elevAngle = Math.atan2(targetChestY - playerShoulderY, horizDist);
        const desiredPitch = THREE.MathUtils.clamp(0.32 - elevAngle * 0.65, 0.12, 0.68);
        camPitchRef.current = THREE.MathUtils.lerp(
          camPitchRef.current,
          desiredPitch,
          1 - Math.exp(-8.5 * dt)
        );
      }
    }

    // Third-Person Camera
    const cameraSubject = spectateTarget ?? pose;
    const viewYaw = spectateTarget ? spectateTarget.yaw : camYawRef.current;
    const camDist = camDistRef.current;
    const pitch = camPitchRef.current;
    const horizDist = Math.cos(pitch) * camDist;
    const backX = -Math.sin(viewYaw) * horizDist;
    const backZ = -Math.cos(viewYaw) * horizDist;

    let targetCamX = cameraSubject.x + backX;
    let targetCamZ = cameraSubject.z + backZ;
    const subjectY = "y" in cameraSubject ? (cameraSubject.y ?? 0) : 0;
    const pivotY = subjectY + 1.65;
    let targetCamY = pivotY + Math.sin(pitch) * camDist;

    let lookUpLift = 0;
    if (targetCamY < 0.65) {
      lookUpLift = (0.65 - targetCamY) * 1.35;
      targetCamY = 0.65;
    }

    // Clamp camera strictly inside the Colosseum perimeter walls and outside all 4 stone pillars
    const camR = Math.hypot(targetCamX, targetCamZ);
    const maxCamR = ARENA.WALL_RADIUS - 0.9;
    if (camR > maxCamR) {
      targetCamX = (targetCamX / camR) * maxCamR;
      targetCamZ = (targetCamZ / camR) * maxCamR;
    }
    for (const pillar of ARENA.PILLARS) {
      const pRadius = pillar.radius * 1.28;
      const dx = targetCamX - pillar.x;
      const dz = targetCamZ - pillar.z;
      const distSq = dx * dx + dz * dz;
      if (distSq < pRadius * pRadius && targetCamY < pillar.height + 0.6) {
        const dist = Math.sqrt(distSq) || 0.001;
        targetCamX = pillar.x + (dx / dist) * pRadius;
        targetCamZ = pillar.z + (dz / dist) * pRadius;
      }
    }

    let targetLookX = cameraSubject.x;
    let targetLookY = subjectY + 1.55 + lookUpLift;
    let targetLookZ = cameraSubject.z;
    if (lockedTarget && !spectateTarget) {
      const targetMidY = lockedTarget.y + lockedTarget.height * 0.56;
      targetLookX = THREE.MathUtils.lerp(targetLookX, lockedTarget.x, 0.28);
      targetLookY = THREE.MathUtils.lerp(targetLookY, targetMidY, 0.28);
      targetLookZ = THREE.MathUtils.lerp(targetLookZ, lockedTarget.z, 0.28);
    }
    let shakeX = 0;
    let shakeY = 0;
    if (shakeRef.current > 0.005) {
      shakeX = (Math.random() - 0.5) * shakeRef.current;
      shakeY = (Math.random() - 0.5) * shakeRef.current;
      shakeRef.current = Math.max(0, shakeRef.current - dt * 1.45);
    }

    if (!camInitRef.current) {
      camPosRef.current.set(targetCamX, targetCamY, targetCamZ);
      camLookRef.current.set(targetLookX, targetLookY, targetLookZ);
      camInitRef.current = true;
    } else {
      const camSmooth = 1 - Math.exp(-16 * dt);
      tmpCamPosRef.current.set(targetCamX, targetCamY, targetCamZ);
      tmpCamLookRef.current.set(targetLookX, targetLookY, targetLookZ);
      camPosRef.current.lerp(tmpCamPosRef.current, camSmooth);
      camLookRef.current.lerp(tmpCamLookRef.current, camSmooth);
    }

    // Test the smoothed camera segment against the fixed arena cylinders without
    // traversing characters, terrain, or decorative scene meshes.
    const rayOrigin = cameraRayOriginRef.current.set(cameraSubject.x, pivotY, cameraSubject.z);
    const rayDirection = tmpCamDirRef.current.copy(camPosRef.current).sub(rayOrigin);
    const desiredDistance = rayDirection.length();
    if (desiredDistance > 0.001) {
      rayDirection.multiplyScalar(1 / desiredDistance);
      const blockerDistance = computeArenaCameraDistance(
        rayOrigin.x,
        rayOrigin.y,
        rayOrigin.z,
        rayDirection.x,
        rayDirection.y,
        rayDirection.z,
        desiredDistance
      );
      if (blockerDistance < desiredDistance) {
        const safeDistance = Math.max(2.1, blockerDistance - 0.38);
        if (safeDistance < desiredDistance) {
          camPosRef.current.copy(rayOrigin).addScaledVector(rayDirection, safeDistance);
        }
      }
    }

    camera.position.set(camPosRef.current.x + shakeX, camPosRef.current.y + shakeY, camPosRef.current.z);
    camera.lookAt(camLookRef.current);
  });

  return (
    <SceneAssetBoundary resetKey={player.skin}>
      <GladiatorModel
        entityId={player.id}
        kind="player"
        graphicsTier={graphicsTier}
        slot={player.slot}
        team={player.team}
        skin={player.skin}
        x={player.x}
        y={player.y}
        z={player.z}
        yaw={player.yaw}
        action={player.action}
        moveAnim={player.moveAnim}
        isBlocking={player.isBlocking}
        isFlying={player.isFlying}
        hp={player.hp}
        maxHp={player.maxHp}
        posture={player.posture}
        maxPosture={player.maxPosture}
        furyActive={player.furyMs > 0}
        ironWillActive={player.ironWillMs > 0}
        swiftFeetActive={player.swiftFeetMs > 0}
        isLocal
        livePoseRef={livePoseRef}
        activeExperimentalArt={activeExperimentalArt}
        onRigInspected={onRigInspected}
        sweptDebugRef={sweptDebugRef}
        sweptTargetsRef={sweptTargetsRef}
        alive={player.alive}
      />
    </SceneAssetBoundary>
  );
}

function findBestTargetNearAim(
  px: number,
  pz: number,
  aimYaw: number,
  targets: LockableTarget[],
  maxRange: number
): LockableTarget | null {
  let best: LockableTarget | null = null;
  let bestScore = Infinity;
  for (const t of targets) {
    const dist = Math.hypot(t.x - px, t.z - pz);
    if (dist > maxRange) continue;
    const angle = Math.abs(normalizeAngle(Math.atan2(t.x - px, t.z - pz) - aimYaw));
    // Prefer enemies near camera/aim direction, but allow nearby flanking targets
    const score = angle * 2.5 + (dist / maxRange) * 0.9;
    if (score < bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best;
}

function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function computeMoveDir(
  keys: Set<string>,
  camYaw: number,
  bindings: KeyBindings
): { x: number; z: number; moving: boolean } {
  let forward = touchInput.moveForward;
  let right = touchInput.moveX;
  if (keys.has(bindings.moveForward)) forward += 1;
  if (keys.has(bindings.moveBack)) forward -= 1;
  if (keys.has(bindings.moveRight)) right += 1;
  if (keys.has(bindings.moveLeft)) right -= 1;

  if (Math.hypot(forward, right) < 0.05) {
    return { x: 0, z: 0, moving: false };
  }

  const len = Math.hypot(forward, right);
  const nf = forward / len;
  const nr = right / len;

  const fwdX = Math.sin(camYaw);
  const fwdZ = Math.cos(camYaw);
  const rightX = -Math.cos(camYaw);
  const rightZ = Math.sin(camYaw);

  const wx = fwdX * nf + rightX * nr;
  const wz = fwdZ * nf + rightZ * nr;
  const wLen = Math.hypot(wx, wz) || 1;
  return { x: wx / wLen, z: wz / wLen, moving: true };
}
