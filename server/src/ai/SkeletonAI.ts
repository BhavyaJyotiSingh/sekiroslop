import {
  ARENA,
  ATTACK_SPECS,
  ENEMY_ARCHETYPES,
  clampToArena,
  yawFromDelta,
  type AttackKind,
  type CombatEventPayload,
  type EnemyKind,
  type ProjectileKind,
} from "@sekiroslop/shared";
import {
  isAttackFinished,
  resolveMeleeSwing,
  updatePostureDecay,
  type AttackRuntime,
  type CombatEntity,
} from "../combat/CombatEngine.js";

export interface EnemyRuntime {
  entity: CombatEntity;
  kind: EnemyKind;
  activeAttack: AttackRuntime | null;
  nextDecisionAt: number;
  strafeDir: number;
  emerging: boolean;
  deadAt: number;
  attackCounter: number;
  blockUntil: number;
  blockCooldownUntil: number;
  lastTeleportAt?: number;
  rangedFiredInAttack?: boolean;
}

export interface EnemySpawnedProjectile {
  kind: ProjectileKind;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  hpDamage: number;
  postureDamage: number;
  stunMs?: number;
  aoeRadius?: number;
}

const PLAYER_ATTACK_ACTIONS = new Set<string>([
  "light1",
  "light2",
  "heavy",
  "thrust",
  "whirlwind",
  "aerial_slam",
  "counter",
]);

function isHeavyEnemyAttack(kind: AttackKind): boolean {
  return (
    kind === "enemy_heavy" ||
    kind === "enemy_slam" ||
    kind === "enemy_lunge" ||
    kind === "enemy_shockwave_slam" ||
    kind === "enemy_tail_whip" ||
    kind === "enemy_dive_lunge" ||
    kind === "enemy_wolf_pounce" ||
    kind === "enemy_mech_slash" ||
    kind === "enemy_stun_volley"
  );
}

function isRangedEnemyAttack(kind: AttackKind): boolean {
  return (
    kind === "enemy_fireball" ||
    kind === "enemy_stun_bolt" ||
    kind === "enemy_stun_volley"
  );
}

function getPostAttackPauseMs(kind: EnemyKind): number {
  switch (kind) {
    case "skirmisher":
    case "dire_wolf":
      return 300 + Math.random() * 250;
    case "assassin":
    case "mist_shinobi":
      return 400 + Math.random() * 350;
    case "pyromancer":
    case "stun_drone":
      return 950 + Math.random() * 450;
    case "champion":
      return 650 + Math.random() * 450;
    case "dread_knight":
    case "aegis_mech":
      return 720 + Math.random() * 480;
    case "dragon":
      return 600 + Math.random() * 420;
    case "legionary":
    default:
      return 500 + Math.random() * 400;
  }
}

export function stepSkeletonAI(
  runtime: EnemyRuntime,
  allPlayers: CombatEntity[],
  allEnemies: EnemyRuntime[],
  now: number,
  dtSec: number
): {
  events: CombatEventPayload[];
  telegraph: "none" | "light" | "heavy";
  attackKind: string;
  spawnedProjectiles: EnemySpawnedProjectile[];
} {
  const events: CombatEventPayload[] = [];
  const spawnedProjectiles: EnemySpawnedProjectile[] = [];
  const enemy = runtime.entity;
  const archetype = ENEMY_ARCHETYPES[runtime.kind] ?? ENEMY_ARCHETYPES.legionary;

  if (!enemy.alive) {
    enemy.action = "dead";
    enemy.isBlocking = false;
    runtime.blockUntil = 0;
    return { events, telegraph: "none", attackKind: "", spawnedProjectiles };
  }

  // Hover-Drones float steadily at 1.55m
  if (runtime.kind === "stun_drone") {
    enemy.y = 1.55;
  }

  updatePostureDecay(enemy, now, dtSec);

  // Electro-shocked stun (from Voltaic Stun Gun)
  if (enemy.shockedUntil && now < enemy.shockedUntil) {
    enemy.action = "shocked";
    enemy.isBlocking = false;
    if (!archetype.isBoss) runtime.activeAttack = null;
    runtime.blockUntil = 0;
    return { events, telegraph: "none", attackKind: "", spawnedProjectiles };
  }

  // Staggered state (posture broken)
  if (now < enemy.staggeredUntil) {
    enemy.action = "staggered";
    enemy.isBlocking = false;
    runtime.activeAttack = null;
    runtime.blockUntil = 0;
    return { events, telegraph: "none", attackKind: "", spawnedProjectiles };
  } else if (enemy.action === "staggered") {
    enemy.posture = 0;
    enemy.action = "idle";
  }

  // Brief hurt stagger (doesn't cancel heavy/slam/lunge attacks)
  if (
    now < enemy.hurtUntil &&
    (!runtime.activeAttack || !isHeavyEnemyAttack(runtime.activeAttack.kind))
  ) {
    enemy.action = "hurt";
    enemy.isBlocking = false;
    runtime.activeAttack = null;
    runtime.blockUntil = 0;
    return { events, telegraph: "none", attackKind: "", spawnedProjectiles };
  }

  // March out of the North Gladiator Gate before engaging
  if (runtime.emerging) {
    enemy.isBlocking = false;
    const targetZ = ARENA.NORTH_GATE.emergeZ;
    const dz = targetZ - enemy.z;
    if (dz <= 0.4) {
      runtime.emerging = false;
    } else {
      enemy.yaw = 0; // Face South (+Z) into arena
      const clamped = clampToArena(
        enemy.x,
        enemy.z + archetype.moveSpeed * 1.15 * dtSec,
        ARENA.ENTITY_RADIUS,
        true
      );
      enemy.x = clamped.x;
      enemy.z = clamped.z;
      enemy.action = "chase";
      return { events, telegraph: "none", attackKind: "", spawnedProjectiles };
    }
  }

  // Active attack progression
  if (runtime.activeAttack) {
    enemy.isBlocking = false;
    const atk = runtime.activeAttack;
    const spec = ATTACK_SPECS[atk.kind];
    const elapsed = now - atk.startedAt;
    const heavy = isHeavyEnemyAttack(atk.kind);

    if (isAttackFinished(atk, now)) {
      runtime.activeAttack = null;
      runtime.rangedFiredInAttack = false;
      enemy.action = "strafe";
      runtime.nextDecisionAt = now + getPostAttackPauseMs(runtime.kind);
      return { events, telegraph: "none", attackKind: "", spawnedProjectiles };
    }

    if (elapsed < spec.windupMs) {
      // Track target slightly during first 60% of windup, then commit angle
      if (elapsed < spec.windupMs * 0.65) {
        const nearest = findNearestLiving(enemy, allPlayers);
        if (nearest) {
          enemy.yaw = yawFromDelta(nearest.x - enemy.x, nearest.z - enemy.z);
        }
      }
      enemy.action = heavy ? "windup_heavy" : "windup_light";
      return { events, telegraph: heavy ? "heavy" : "light", attackKind: atk.kind, spawnedProjectiles };
    }

    // Active swing / ranged release phase
    enemy.action = heavy ? "attack_heavy" : "attack_light";
    if (elapsed <= spec.windupMs + spec.activeMs) {
      if (isRangedEnemyAttack(atk.kind)) {
        if (!runtime.rangedFiredInAttack) {
          runtime.rangedFiredInAttack = true;
          const target = findNearestLiving(enemy, allPlayers);
          const originY = (enemy.y ?? 0) + 1.35;
          const aimYaw = target ? yawFromDelta(target.x - enemy.x, target.z - enemy.z) : enemy.yaw;
          enemy.yaw = aimYaw;
          const ty = (target?.y ?? 0) + 1.1;
          const horiz = target ? Math.hypot(target.x - enemy.x, target.z - enemy.z) : 10;
          const pitch = target ? Math.atan2(ty - originY, Math.max(1, horiz)) : 0;

          if (atk.kind === "enemy_fireball") {
            const spd = 20;
            const c = Math.cos(pitch);
            spawnedProjectiles.push({
              kind: "fireball",
              x: enemy.x + Math.sin(aimYaw) * 0.9,
              y: originY,
              z: enemy.z + Math.cos(aimYaw) * 0.9,
              vx: Math.sin(aimYaw) * c * spd,
              vy: Math.sin(pitch) * spd + 0.5,
              vz: Math.cos(aimYaw) * c * spd,
              yaw: aimYaw,
              hpDamage: spec.hpDamage,
              postureDamage: spec.postureDamage,
              aoeRadius: 2.5,
            });
            events.push({ kind: "spell_cast", x: enemy.x, y: originY, z: enemy.z, yaw: aimYaw, abilityKind: "fireball" });
          } else if (atk.kind === "enemy_stun_bolt") {
            const spd = 30;
            const c = Math.cos(pitch);
            spawnedProjectiles.push({
              kind: "stun_bolt",
              x: enemy.x + Math.sin(aimYaw) * 0.9,
              y: originY,
              z: enemy.z + Math.cos(aimYaw) * 0.9,
              vx: Math.sin(aimYaw) * c * spd,
              vy: Math.sin(pitch) * spd,
              vz: Math.cos(aimYaw) * c * spd,
              yaw: aimYaw,
              hpDamage: spec.hpDamage,
              postureDamage: spec.postureDamage,
              stunMs: 650,
            });
            events.push({ kind: "stun_shot", x: enemy.x, y: originY, z: enemy.z, yaw: aimYaw, abilityKind: "stun_gun" });
          } else if (atk.kind === "enemy_stun_volley") {
            const spd = 28;
            for (const offset of [-0.18, 0, 0.18]) {
              const yawOff = aimYaw + offset;
              const c = Math.cos(pitch);
              spawnedProjectiles.push({
                kind: "stun_bolt",
                x: enemy.x + Math.sin(yawOff) * 1.1,
                y: originY + 0.35,
                z: enemy.z + Math.cos(yawOff) * 1.1,
                vx: Math.sin(yawOff) * c * spd,
                vy: Math.sin(pitch) * spd,
                vz: Math.cos(yawOff) * c * spd,
                yaw: yawOff,
                hpDamage: spec.hpDamage,
                postureDamage: spec.postureDamage,
                stunMs: 550,
              });
            }
            events.push({ kind: "stun_shot", x: enemy.x, y: originY + 0.35, z: enemy.z, yaw: aimYaw, abilityKind: "stun_gun" });
          }
        }
      } else {
        const lungeSpeed = spec.lungeSpeed ?? (heavy ? 2.4 : 1.8);
        const step = lungeSpeed * dtSec;
        const moved = clampToArena(
          enemy.x + Math.sin(enemy.yaw) * step,
          enemy.z + Math.cos(enemy.yaw) * step
        );
        enemy.x = moved.x;
        enemy.z = moved.z;

        const hitEvents = resolveMeleeSwing(enemy, atk, allPlayers, now);
        events.push(...hitEvents);
      }
    }
    return { events, telegraph: "none", attackKind: atk.kind, spawnedProjectiles };
  }

  // Find nearest living player
  const target = findNearestLiving(enemy, allPlayers);
  if (!target) {
    enemy.isBlocking = false;
    runtime.blockUntil = 0;
    enemy.action = "idle";
    return { events, telegraph: "none", attackKind: "", spawnedProjectiles };
  }

  const dx = target.x - enemy.x;
  const dz = target.z - enemy.z;
  const dist = Math.hypot(dx, dz) || 0.001;
  enemy.yaw = yawFromDelta(dx, dz);

  // Mist Shinobi (Tengu Reaper) Shadow-Step Ambush Teleport behind target
  if (
    runtime.kind === "mist_shinobi" &&
    dist > 4.6 &&
    dist < 14.0 &&
    now - (runtime.lastTeleportAt ?? 0) >= 4800
  ) {
    runtime.lastTeleportAt = now;
    const oldX = enemy.x;
    const oldZ = enemy.z;
    const behindX = target.x - Math.sin(target.yaw) * 2.1;
    const behindZ = target.z - Math.cos(target.yaw) * 2.1;
    const landed = clampToArena(behindX, behindZ);
    enemy.x = landed.x;
    enemy.z = landed.z;
    enemy.yaw = yawFromDelta(target.x - enemy.x, target.z - enemy.z);
    events.push({
      kind: "shadow_step",
      x: oldX,
      y: 1.0,
      z: oldZ,
      targetX: landed.x,
      targetY: 1.0,
      targetZ: landed.z,
      attackerId: enemy.id,
    });
  }

  // Separation from other enemies so they don't stack
  let sepX = 0;
  let sepZ = 0;
  for (const other of allEnemies) {
    if (other.entity.id === enemy.id || !other.entity.alive) continue;
    const odx = enemy.x - other.entity.x;
    const odz = enemy.z - other.entity.z;
    const od = Math.hypot(odx, odz);
    if (od > 0.001 && od < 2.2) {
      const push = (2.2 - od) / 2.2;
      sepX += (odx / od) * push * 2.4;
      sepZ += (odz / od) * push * 2.4;
    }
  }

  // Active guard state for shield-bearing archetypes (legionary & champion)
  if (enemy.isBlocking) {
    if (now >= runtime.blockUntil || dist > archetype.attackRange + 2.4) {
      // Lower guard and prepare to counter-attack
      enemy.isBlocking = false;
      runtime.blockUntil = 0;
      runtime.blockCooldownUntil =
        now +
        (runtime.kind === "champion" || runtime.kind === "dread_knight"
          ? 3600 + Math.random() * 1400
          : 2200 + Math.random() * 1200);
      runtime.nextDecisionAt = Math.min(runtime.nextDecisionAt, now + 80);
    } else {
      enemy.action = "block";
      const clamped = clampToArena(enemy.x + sepX * 0.5 * dtSec, enemy.z + sepZ * 0.5 * dtSec);
      enemy.x = clamped.x;
      enemy.z = clamped.z;
      return { events, telegraph: "none", attackKind: "", spawnedProjectiles };
    }
  }

  // Disciplined blocking (legionary raises shield reactively/occasionally; champion braces briefly)
  if (archetype.canBlock && now >= runtime.blockCooldownUntil) {
    const playerAttacking = PLAYER_ATTACK_ACTIONS.has(target.action);
    const closeForGuard = dist <= archetype.attackRange + 1.35;
    if (closeForGuard) {
      let blockChance = 0;
      if (runtime.kind === "legionary") {
        blockChance = playerAttacking ? 0.18 : now < runtime.nextDecisionAt ? 0.025 : 0.01;
      } else if (runtime.kind === "champion" || runtime.kind === "mist_shinobi") {
        blockChance = playerAttacking ? 0.1 : now < runtime.nextDecisionAt ? 0.015 : 0;
      } else if (runtime.kind === "dread_knight" || runtime.kind === "aegis_mech") {
        blockChance = playerAttacking ? 0.14 : now < runtime.nextDecisionAt ? 0.02 : 0;
      }
      if (blockChance > 0 && Math.random() < blockChance) {
        const durationMs =
          runtime.kind === "champion"
            ? 500 + Math.random() * 350
            : runtime.kind === "dread_knight" || runtime.kind === "aegis_mech"
              ? 650 + Math.random() * 400
              : 700 + Math.random() * 400;
        enemy.isBlocking = true;
        enemy.blockStartedAt = now;
        enemy.action = "block";
        runtime.blockUntil = now + durationMs;
        return { events, telegraph: "none", attackKind: "", spawnedProjectiles };
      }
    }
  }

  // Determine effective strike trigger distance
  const effectiveAttackRange =
    (runtime.kind === "assassin" || runtime.kind === "dire_wolf") && dist >= 2.2
      ? Math.max(archetype.attackRange, 3.65)
      : runtime.kind === "dragon" && dist >= 3.8
        ? Math.max(archetype.attackRange, 6.4)
        : runtime.kind === "aegis_mech"
          ? 16.5
          : archetype.attackRange;

  // Attack when within strike distance & cooldown ready
  if (dist <= effectiveAttackRange && now >= runtime.nextDecisionAt) {
    runtime.attackCounter++;
    let kind: AttackKind;

    if (runtime.kind === "assassin") {
      if (dist >= 2.25 || runtime.attackCounter === 1 || runtime.attackCounter % 3 === 0) {
        kind = archetype.heavyAttack;
      } else {
        kind = archetype.primaryAttack;
      }
    } else if (runtime.kind === "dire_wolf") {
      kind = dist >= 2.4 || runtime.attackCounter % 2 === 1 ? "enemy_wolf_pounce" : "enemy_wolf_bite";
    } else if (runtime.kind === "pyromancer") {
      kind = "enemy_fireball";
    } else if (runtime.kind === "stun_drone") {
      kind = "enemy_stun_bolt";
    } else if (runtime.kind === "mist_shinobi") {
      kind = runtime.attackCounter % 3 === 0 ? "enemy_lunge" : "enemy_mist_slash";
    } else if (runtime.kind === "aegis_mech") {
      kind = dist > 4.4 ? "enemy_stun_volley" : "enemy_mech_slash";
    } else if (runtime.kind === "champion") {
      kind =
        runtime.attackCounter % 3 === 0 || (dist <= 2.9 && Math.random() < 0.25)
          ? archetype.heavyAttack
          : archetype.primaryAttack;
    } else if (runtime.kind === "dread_knight") {
      kind =
        runtime.attackCounter % 3 === 0 || (dist <= 3.2 && Math.random() < 0.28)
          ? archetype.heavyAttack
          : archetype.primaryAttack;
    } else if (runtime.kind === "dragon") {
      if (dist >= 4.2 && runtime.attackCounter % 2 === 1) {
        kind = "enemy_dive_lunge";
      } else if (dist <= 3.1 || runtime.attackCounter % 3 === 0) {
        kind = archetype.heavyAttack;
      } else {
        kind = archetype.primaryAttack;
      }
    } else if (runtime.kind === "skirmisher") {
      kind = runtime.attackCounter % 3 === 0 ? archetype.heavyAttack : archetype.primaryAttack;
    } else {
      kind = runtime.attackCounter % 3 === 0 ? archetype.heavyAttack : archetype.primaryAttack;
    }

    const heavy = isHeavyEnemyAttack(kind);
    runtime.activeAttack = {
      kind,
      startedAt: now,
      hitIds: new Set(),
    };
    runtime.rangedFiredInAttack = false;
    enemy.isBlocking = false;
    enemy.action = heavy ? "windup_heavy" : "windup_light";
    events.push({
      kind: "swing",
      x: enemy.x,
      y: (enemy.y ?? 0) + 1.2,
      z: enemy.z,
      yaw: enemy.yaw,
      attackerId: enemy.id,
      attackerName: enemy.name,
      heavy,
      moveKind: kind,
      enemyKind: runtime.kind,
    });
    return { events, telegraph: heavy ? "heavy" : "light", attackKind: kind, spawnedProjectiles };
  }

  // Movement: ranged enemies kite at mid-range; melee chase & flank
  let moveX = sepX;
  let moveZ = sepZ;
  const isPureRanged = runtime.kind === "pyromancer" || runtime.kind === "stun_drone";
  const preferredHoldDist = isPureRanged ? 9.5 : Math.max(1.8, archetype.attackRange - 0.35);

  if (isPureRanged && dist < 5.5) {
    moveX -= (dx / dist) * archetype.moveSpeed * 0.85;
    moveZ -= (dz / dist) * archetype.moveSpeed * 0.85;
    enemy.action = "strafe";
  } else if (dist > preferredHoldDist) {
    const dirX = dx / dist;
    const dirZ = dz / dist;

    if (
      (runtime.kind === "assassin" && dist < 9.5) ||
      (runtime.kind === "mist_shinobi" && dist < 11.0) ||
      (runtime.kind === "dragon" && dist < 13.0)
    ) {
      if (Math.random() < (runtime.kind === "dragon" ? 0.025 : 0.035)) runtime.strafeDir *= -1;
      const flankWeight =
        runtime.kind === "dragon"
          ? dist > archetype.attackRange ? 0.48 : 0.78
          : dist > archetype.attackRange ? 0.52 : 0.72;
      const forwardWeight = Math.sqrt(Math.max(0.1, 1 - flankWeight * flankWeight));
      const perpX = (-dz / dist) * runtime.strafeDir;
      const perpZ = (dx / dist) * runtime.strafeDir;
      moveX += (dirX * forwardWeight + perpX * flankWeight) * archetype.moveSpeed;
      moveZ += (dirZ * forwardWeight + perpZ * flankWeight) * archetype.moveSpeed;
    } else {
      moveX += dirX * archetype.moveSpeed;
      moveZ += dirZ * archetype.moveSpeed;
    }
    enemy.action = "chase";
  } else {
    const flipChance =
      runtime.kind === "assassin" || runtime.kind === "mist_shinobi"
        ? 0.045
        : runtime.kind === "dragon"
          ? 0.025
          : runtime.kind === "champion" || runtime.kind === "dread_knight" || runtime.kind === "aegis_mech"
            ? 0.01
            : 0.02;
    if (Math.random() < flipChance) runtime.strafeDir *= -1;

    const strafeMult =
      runtime.kind === "assassin" || runtime.kind === "mist_shinobi"
        ? 0.85
        : runtime.kind === "dragon" || runtime.kind === "stun_drone"
          ? 0.78
          : runtime.kind === "skirmisher"
            ? 0.7
            : runtime.kind === "dread_knight" || runtime.kind === "aegis_mech"
              ? 0.3
              : runtime.kind === "champion"
                ? 0.38
                : 0.55;
    const strafeSpeed = archetype.moveSpeed * strafeMult;
    moveX += (-dz / dist) * runtime.strafeDir * strafeSpeed;
    moveZ += (dx / dist) * runtime.strafeDir * strafeSpeed;
    enemy.action = "strafe";
  }

  const clamped = clampToArena(enemy.x + moveX * dtSec, enemy.z + moveZ * dtSec);
  enemy.x = clamped.x;
  enemy.z = clamped.z;
  return { events, telegraph: "none", attackKind: "", spawnedProjectiles };
}

function findNearestLiving(from: CombatEntity, targets: CombatEntity[]): CombatEntity | null {
  let best: CombatEntity | null = null;
  let bestDistSq = Infinity;
  for (const t of targets) {
    if (!t.alive) continue;
    const dx = t.x - from.x;
    const dz = t.z - from.z;
    const dSq = dx * dx + dz * dz;
    if (dSq < bestDistSq) {
      bestDistSq = dSq;
      best = t;
    }
  }
  return best;
}
