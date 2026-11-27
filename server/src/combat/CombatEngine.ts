import {
  ATTACK_SPECS,
  COMBAT,
  forwardFromYaw,
  type AttackKind,
  type CombatEventPayload,
  type ProjectileKind,
  type TeamSide,
} from "@sekiroslop/shared";

export interface CombatEntity {
  id: string;
  name: string;
  isPlayer: boolean;
  team?: TeamSide | "";
  x: number;
  y?: number;
  z: number;
  yaw: number;
  hp: number;
  maxHp: number;
  posture: number;
  maxPosture: number;
  alive: boolean;
  isBlocking: boolean;
  blockStartedAt: number;
  dodgeInvulnUntil: number;
  staggeredUntil: number;
  hurtUntil: number;
  shockedUntil?: number;
  lastPostureHitAt: number;
  action: string;
  // Power-up multipliers (defaults to 1.0 when omitted)
  damageOutMult?: number;
  postureOutMult?: number;
  damageInMult?: number;
  postureRecoveryMult?: number;
  infiniteHealth?: boolean;
  onKilled?: (killer: CombatEntity) => void;
  onDeflected?: (attacker: CombatEntity, now: number) => void;
}

export interface AttackRuntime {
  kind: AttackKind;
  startedAt: number;
  hitIds: Set<string>;
}

/** Updates posture decay (faster while holding block or Posture Tonic, slower at low HP). */
export function updatePostureDecay(entity: CombatEntity, now: number, dtSec: number): void {
  if (!entity.alive || entity.posture <= 0) return;
  if (now < entity.staggeredUntil) return;

  const tonicMult = entity.postureRecoveryMult ?? 1.0;
  const delay = tonicMult > 1 ? COMBAT.POSTURE_DECAY_DELAY_MS * 0.45 : COMBAT.POSTURE_DECAY_DELAY_MS;
  if (now - entity.lastPostureHitAt < delay) return;

  const hpRatio = Math.max(0.25, entity.hp / entity.maxHp);
  const blockMult = entity.isBlocking ? COMBAT.POSTURE_BLOCK_DECAY_MULT : 1.0;
  const decay = COMBAT.POSTURE_DECAY_PER_SEC * hpRatio * blockMult * tonicMult * dtSec;
  entity.posture = Math.max(0, entity.posture - decay);
}

export function isAttackInActiveWindow(attack: AttackRuntime, now: number): boolean {
  const spec = ATTACK_SPECS[attack.kind];
  const elapsed = now - attack.startedAt;
  return elapsed >= spec.windupMs && elapsed <= spec.windupMs + spec.activeMs;
}

export function isAttackFinished(attack: AttackRuntime, now: number): boolean {
  const spec = ATTACK_SPECS[attack.kind];
  return now - attack.startedAt >= spec.windupMs + spec.activeMs + spec.recoveryMs;
}

/**
 * Resolves an active melee swing (including 360° Whirlwind & Aerial Slam) against candidates.
 * Applies Warrior's Fury & Iron Will multipliers and opens Riposte Counter window on deflect.
 */
export function resolveMeleeSwing(
  attacker: CombatEntity,
  attack: AttackRuntime,
  candidates: CombatEntity[],
  now: number
): CombatEventPayload[] {
  const events: CombatEventPayload[] = [];
  if (!attacker.alive || !isAttackInActiveWindow(attack, now)) {
    return events;
  }

  const spec = ATTACK_SPECS[attack.kind];
  const fwd = forwardFromYaw(attacker.yaw);
  const isHeavyMove =
    attack.kind === "heavy" ||
    attack.kind === "punch" ||
    attack.kind === "enemy_heavy" ||
    attack.kind === "enemy_lunge" ||
    attack.kind === "enemy_cleave" ||
    attack.kind === "enemy_slam" ||
    attack.kind === "enemy_dread_cleave" ||
    attack.kind === "enemy_shockwave_slam" ||
    attack.kind === "enemy_fire_breath" ||
    attack.kind === "enemy_tail_whip" ||
    attack.kind === "enemy_dive_lunge" ||
    attack.kind === "whirlwind" ||
    attack.kind === "thrust" ||
    attack.kind === "aerial_slam" ||
    attack.kind === "counter";

  const outDmgMult = attacker.damageOutMult ?? 1.0;
  const outPostureMult = attacker.postureOutMult ?? 1.0;

  for (const target of candidates) {
    if (target.id === attacker.id || !target.alive) continue;
    if (attacker.team && target.team && attacker.team === target.team) continue;
    if (attack.hitIds.has(target.id)) continue;

    if (Math.abs((attacker.y ?? 0) - (target.y ?? 0)) > 1.85) continue;

    const dx = target.x - attacker.x;
    const dz = target.z - attacker.z;
    const dist = Math.hypot(dx, dz);
    if (dist > spec.range) continue;

    // Facing cone check (arcDot <= -0.99 means full 360° AoE!)
    if (spec.arcDot > -0.99 && dist > 0.45) {
      const dirX = dx / dist;
      const dirZ = dz / dist;
      const dot = fwd.x * dirX + fwd.z * dirZ;
      if (dot < spec.arcDot) continue;
    }

    attack.hitIds.add(target.id);

    const midX = (attacker.x + target.x) * 0.5;
    const midZ = (attacker.z + target.z) * 0.5;
    const isPvP = attacker.isPlayer && target.isPlayer;
    const inDmgMult = target.damageInMult ?? 1.0;

    // 1. Dodge i-frames
    if (now < target.dodgeInvulnUntil) {
      events.push({
        kind: "evade",
        x: target.x,
        y: 1.1,
        z: target.z,
        attackerId: attacker.id,
        attackerName: attacker.name,
        targetId: target.id,
        targetName: target.name,
        isPvP,
      });
      continue;
    }

    // Check facing for Block / Deflect
    let facingAttacker = false;
    if (target.isBlocking && now >= target.staggeredUntil) {
      const targetFwd = forwardFromYaw(target.yaw);
      const toAttackerX = dist > 0.001 ? -dx / dist : -fwd.x;
      const toAttackerZ = dist > 0.001 ? -dz / dist : -fwd.z;
      const blockDot = targetFwd.x * toAttackerX + targetFwd.z * toAttackerZ;
      facingAttacker = blockDot >= COMBAT.BLOCK_FACING_DOT;
    }

    const blockElapsed = now - target.blockStartedAt;

    // 2. Perfect Deflection (Sekiro timed guard -> opens Riposte Counter window!)
    if (facingAttacker && blockElapsed <= COMBAT.DEFLECT_WINDOW_MS) {
      target.posture = Math.min(target.maxPosture - 1, target.posture + spec.deflectSelfPosture);
      target.lastPostureHitAt = now;
      target.onDeflected?.(attacker, now);

      attacker.posture = Math.min(attacker.maxPosture, attacker.posture + spec.deflectAttackerPosture);
      attacker.lastPostureHitAt = now;

      events.push({
        kind: "deflect",
        x: midX,
        y: 1.25,
        z: midZ,
        yaw: attacker.yaw,
        attackerId: attacker.id,
        attackerName: attacker.name,
        targetId: target.id,
        targetName: target.name,
        isPvP,
        heavy: isHeavyMove,
        moveKind: attack.kind,
      });

      if (attacker.posture >= attacker.maxPosture) {
        attacker.staggeredUntil = now + COMBAT.STAGGER_DURATION_MS;
        attacker.action = "staggered";
        attacker.isBlocking = false;
        events.push({
          kind: "stagger",
          x: attacker.x,
          y: 1.35,
          z: attacker.z,
          yaw: attacker.yaw,
          attackerId: target.id,
          attackerName: target.name,
          targetId: attacker.id,
          targetName: attacker.name,
          isPvP,
        });
        break;
      }
      continue;
    }

    // 3. Standard Block
    if (facingAttacker) {
      const blockPosture = Math.round(spec.blockPostureDamage * outPostureMult * inDmgMult);
      const chipHp = Math.round(spec.blockChipHp * outDmgMult * inDmgMult);
      target.posture = Math.min(target.maxPosture, target.posture + blockPosture);
      target.lastPostureHitAt = now;
      if (chipHp > 0 && !target.infiniteHealth) {
        target.hp = Math.max(1, target.hp - chipHp);
      }

      events.push({
        kind: "block",
        x: midX,
        y: 1.2,
        z: midZ,
        yaw: attacker.yaw,
        attackerId: attacker.id,
        attackerName: attacker.name,
        targetId: target.id,
        targetName: target.name,
        isPvP,
        damage: chipHp,
        moveKind: attack.kind,
      });

      if (target.posture >= target.maxPosture) {
        target.staggeredUntil = now + COMBAT.STAGGER_DURATION_MS;
        target.action = "staggered";
        target.isBlocking = false;
        events.push({
          kind: "stagger",
          x: target.x,
          y: 1.35,
          z: target.z,
          yaw: attacker.yaw,
          attackerId: attacker.id,
          attackerName: attacker.name,
          targetId: target.id,
          targetName: target.name,
          isPvP,
        });
      }
      continue;
    }

    // 4. Direct Hit (with Stagger bonus, Warrior's Fury, and Iron Will mitigation)
    const wasStaggered = now < target.staggeredUntil;
    const staggerMult = wasStaggered ? COMBAT.STAGGER_DAMAGE_MULT : 1;
    const finalDamage = Math.max(
      1,
      Math.round(spec.hpDamage * outDmgMult * inDmgMult * staggerMult)
    );
    const finalPosture = Math.round(spec.postureDamage * outPostureMult * inDmgMult);

    if (!target.infiniteHealth) {
      target.hp = Math.max(0, target.hp - finalDamage);
    }
    target.lastPostureHitAt = now;

    if (wasStaggered) {
      target.posture = 0;
      target.staggeredUntil = 0;
    } else {
      target.posture = Math.min(target.maxPosture, target.posture + finalPosture);
    }

    events.push({
      kind: "hit",
      x: target.x,
      y: 1.15,
      z: target.z,
      yaw: attacker.yaw,
      attackerId: attacker.id,
      attackerName: attacker.name,
      targetId: target.id,
      targetName: target.name,
      isPvP,
      damage: finalDamage,
      heavy: wasStaggered || isHeavyMove,
      moveKind: attack.kind,
    });

    if (target.hp <= 0) {
      target.alive = false;
      target.action = "dead";
      target.isBlocking = false;
      target.onKilled?.(attacker);
      events.push({
        kind: "kill",
        x: target.x,
        y: 1.0,
        z: target.z,
        attackerId: attacker.id,
        attackerName: attacker.name,
        targetId: target.id,
        targetName: target.name,
        isPvP,
        moveKind: attack.kind,
      });
    } else if (!wasStaggered && target.posture >= target.maxPosture) {
      target.staggeredUntil = now + COMBAT.STAGGER_DURATION_MS;
      target.action = "staggered";
      target.isBlocking = false;
      events.push({
        kind: "stagger",
        x: target.x,
        y: 1.35,
        z: target.z,
        yaw: attacker.yaw,
        attackerId: attacker.id,
        attackerName: attacker.name,
        targetId: target.id,
        targetName: target.name,
        isPvP,
      });
    } else {
      target.hurtUntil = now + COMBAT.HURT_STUN_MS;
      if (target.action !== "staggered") {
        target.action = "hurt";
      }
    }
  }

  return events;
}

/** Resolves a flying Pilum spear hit against a target (supports dodge i-frames, Deflect, Block, and Friendly Fire!). */
export function resolvePilumHit(
  owner: CombatEntity | undefined,
  target: CombatEntity,
  pilumX: number,
  pilumZ: number,
  pilumVx: number,
  pilumVz: number,
  now: number,
  ownerId?: string
): CombatEventPayload[] {
  const events: CombatEventPayload[] = [];
  if (!target.alive) return events;
  if (owner?.team && target.team && owner.team === target.team) return events;

  const effectiveOwnerId = owner?.id ?? ownerId;
  const isPvP = Boolean((owner ? owner.isPlayer : Boolean(ownerId)) && target.isPlayer);
  const pilumYaw = Math.atan2(pilumVx, pilumVz);

  // Dodge i-frames
  if (now < target.dodgeInvulnUntil) {
    events.push({
      kind: "evade",
      x: target.x,
      y: 1.2,
      z: target.z,
      attackerId: effectiveOwnerId,
      attackerName: owner?.name,
      targetId: target.id,
      targetName: target.name,
      isPvP,
    });
    return events;
  }

  // Check if defender is facing incoming Pilum
  const speed = Math.hypot(pilumVx, pilumVz) || 1;
  const incomingFromX = -pilumVx / speed;
  const incomingFromZ = -pilumVz / speed;
  let facingSpear = false;
  if (target.isBlocking && now >= target.staggeredUntil) {
    const fwd = forwardFromYaw(target.yaw);
    facingSpear = fwd.x * incomingFromX + fwd.z * incomingFromZ >= COMBAT.BLOCK_FACING_DOT;
  }

  if (facingSpear && now - target.blockStartedAt <= COMBAT.DEFLECT_WINDOW_MS) {
    target.posture = Math.min(target.maxPosture - 1, target.posture + 8);
    target.lastPostureHitAt = now;
    if (owner) target.onDeflected?.(owner, now);
    events.push({
      kind: "deflect",
      x: pilumX,
      y: 1.25,
      z: pilumZ,
      yaw: pilumYaw,
      attackerId: effectiveOwnerId,
      attackerName: owner?.name ?? "Pilum",
      targetId: target.id,
      targetName: target.name,
      isPvP,
      heavy: true,
    });
    return events;
  }

  const outDmgMult = owner?.damageOutMult ?? 1.0;
  const outPostureMult = owner?.postureOutMult ?? 1.0;
  const inDmgMult = target.damageInMult ?? 1.0;

  if (facingSpear) {
    const posture = Math.round(30 * outPostureMult * inDmgMult);
    const chip = Math.round(6 * outDmgMult * inDmgMult);
    target.posture = Math.min(target.maxPosture, target.posture + posture);
    target.lastPostureHitAt = now;
    if (!target.infiniteHealth) {
      target.hp = Math.max(1, target.hp - chip);
    }
    events.push({
      kind: "block",
      x: pilumX,
      y: 1.2,
      z: pilumZ,
      yaw: pilumYaw,
      attackerId: effectiveOwnerId,
      attackerName: owner?.name,
      targetId: target.id,
      targetName: target.name,
      isPvP,
      damage: chip,
    });
    if (target.posture >= target.maxPosture) {
      target.staggeredUntil = now + COMBAT.STAGGER_DURATION_MS;
      target.action = "staggered";
      target.isBlocking = false;
      events.push({
        kind: "stagger",
        x: target.x,
        y: 1.35,
        z: target.z,
        yaw: pilumYaw,
        attackerId: effectiveOwnerId,
        attackerName: owner?.name,
        targetId: target.id,
        targetName: target.name,
        isPvP,
      });
    }
    return events;
  }

  const wasStaggered = now < target.staggeredUntil;
  const staggerMult = wasStaggered ? COMBAT.STAGGER_DAMAGE_MULT : 1;
  const dmg = Math.max(
    1,
    Math.round(COMBAT.PILUM_HP_DAMAGE * outDmgMult * inDmgMult * staggerMult)
  );
  const posture = Math.round(COMBAT.PILUM_POSTURE_DAMAGE * outPostureMult * inDmgMult);
  if (!target.infiniteHealth) {
    target.hp = Math.max(0, target.hp - dmg);
  }
  target.lastPostureHitAt = now;

  if (wasStaggered) {
    target.posture = 0;
    target.staggeredUntil = 0;
  } else {
    target.posture = Math.min(target.maxPosture, target.posture + posture);
  }

  events.push({
    kind: "hit",
    x: target.x,
    y: 1.2,
    z: target.z,
    yaw: pilumYaw,
    attackerId: effectiveOwnerId,
    attackerName: owner?.name ?? "Pilum",
    targetId: target.id,
    targetName: target.name,
    isPvP,
    damage: dmg,
    heavy: true,
  });

  if (target.hp <= 0) {
    target.alive = false;
    target.action = "dead";
    target.isBlocking = false;
    const killerEntity: CombatEntity = owner ?? {
      id: effectiveOwnerId ?? "pilum_owner",
      name: "Pilum",
      isPlayer: true,
      x: pilumX,
      y: 0,
      z: pilumZ,
      yaw: pilumYaw,
      hp: 0,
      maxHp: COMBAT.PLAYER_MAX_HP,
      posture: 0,
      maxPosture: COMBAT.PLAYER_MAX_POSTURE,
      alive: false,
      isBlocking: false,
      blockStartedAt: 0,
      dodgeInvulnUntil: 0,
      staggeredUntil: 0,
      hurtUntil: 0,
      lastPostureHitAt: 0,
      action: "dead",
    };
    target.onKilled?.(killerEntity);
    events.push({
      kind: "kill",
      x: target.x,
      y: 1.0,
      z: target.z,
      attackerId: effectiveOwnerId,
      attackerName: owner?.name ?? "Pilum",
      targetId: target.id,
      targetName: target.name,
      isPvP,
    });
  } else if (!wasStaggered && target.posture >= target.maxPosture) {
    target.staggeredUntil = now + COMBAT.STAGGER_DURATION_MS;
    target.action = "staggered";
    target.isBlocking = false;
    events.push({
      kind: "stagger",
      x: target.x,
      y: 1.35,
      z: target.z,
      yaw: pilumYaw,
      attackerId: effectiveOwnerId,
      attackerName: owner?.name,
      targetId: target.id,
      targetName: target.name,
      isPvP,
    });
  } else {
    target.hurtUntil = now + COMBAT.HURT_STUN_MS;
    target.action = "hurt";
  }

  return events;
}

export interface ProjectileHitOptions {
  kind: ProjectileKind;
  hpDamage: number;
  postureDamage: number;
  stunMs?: number;
}

/**
 * Resolves any flying 3D projectile (Pilum, Fireball, Arcane Orb, Stun Bolt) against a target.
 * Returns `reflected: true` when the defender lands a Perfect Deflect so the caller can reverse it!
 */
export function resolveProjectileHit(
  owner: CombatEntity | undefined,
  target: CombatEntity,
  projX: number,
  projY: number,
  projZ: number,
  projVx: number,
  projVz: number,
  now: number,
  opts: ProjectileHitOptions,
  ownerId?: string
): { events: CombatEventPayload[]; reflected: boolean } {
  const events: CombatEventPayload[] = [];
  if (!target.alive) return { events, reflected: false };
  if (owner?.team && target.team && owner.team === target.team) return { events, reflected: false };

  const effectiveOwnerId = owner?.id ?? ownerId;
  const isPvP = Boolean((owner ? owner.isPlayer : Boolean(ownerId)) && target.isPlayer);
  const projYaw = Math.atan2(projVx, projVz);

  if (now < target.dodgeInvulnUntil) {
    events.push({
      kind: "evade",
      x: target.x,
      y: projY,
      z: target.z,
      attackerId: effectiveOwnerId,
      attackerName: owner?.name,
      targetId: target.id,
      targetName: target.name,
      isPvP,
    });
    return { events, reflected: false };
  }

  const speed = Math.hypot(projVx, projVz) || 1;
  const incomingFromX = -projVx / speed;
  const incomingFromZ = -projVz / speed;
  let facing = false;
  if (target.isBlocking && now >= target.staggeredUntil) {
    const fwd = forwardFromYaw(target.yaw);
    facing = fwd.x * incomingFromX + fwd.z * incomingFromZ >= COMBAT.BLOCK_FACING_DOT;
  }

  if (facing && now - target.blockStartedAt <= COMBAT.DEFLECT_WINDOW_MS) {
    target.posture = Math.min(target.maxPosture - 1, target.posture + 6);
    target.lastPostureHitAt = now;
    if (owner) target.onDeflected?.(owner, now);
    events.push({
      kind: "deflect",
      x: projX,
      y: projY,
      z: projZ,
      yaw: projYaw,
      attackerId: effectiveOwnerId,
      attackerName: owner?.name ?? opts.kind,
      targetId: target.id,
      targetName: target.name,
      isPvP,
      heavy: true,
      projectileKind: opts.kind,
    });
    events.push({
      kind: "projectile_reflect",
      x: projX,
      y: projY,
      z: projZ,
      yaw: projYaw,
      attackerId: target.id,
      targetId: effectiveOwnerId,
      projectileKind: opts.kind,
    });
    return { events, reflected: true };
  }

  const outDmgMult = owner?.damageOutMult ?? 1.0;
  const outPostureMult = owner?.postureOutMult ?? 1.0;
  const inDmgMult = target.damageInMult ?? 1.0;

  if (facing) {
    const posture = Math.round(opts.postureDamage * 0.65 * outPostureMult * inDmgMult);
    const chip = Math.round(opts.hpDamage * 0.2 * outDmgMult * inDmgMult);
    target.posture = Math.min(target.maxPosture, target.posture + posture);
    target.lastPostureHitAt = now;
    if (!target.infiniteHealth) {
      target.hp = Math.max(1, target.hp - chip);
    }
    events.push({
      kind: "block",
      x: projX,
      y: projY,
      z: projZ,
      yaw: projYaw,
      attackerId: effectiveOwnerId,
      attackerName: owner?.name,
      targetId: target.id,
      targetName: target.name,
      isPvP,
      damage: chip,
      projectileKind: opts.kind,
    });
    if (target.posture >= target.maxPosture) {
      target.staggeredUntil = now + COMBAT.STAGGER_DURATION_MS;
      target.action = "staggered";
      target.isBlocking = false;
      events.push({
        kind: "stagger",
        x: target.x,
        y: projY,
        z: target.z,
        yaw: projYaw,
        attackerId: effectiveOwnerId,
        attackerName: owner?.name,
        targetId: target.id,
        targetName: target.name,
        isPvP,
      });
    }
    return { events, reflected: false };
  }

  const wasStaggered = now < target.staggeredUntil;
  const staggerMult = wasStaggered ? COMBAT.STAGGER_DAMAGE_MULT : 1;
  const dmg = Math.max(1, Math.round(opts.hpDamage * outDmgMult * inDmgMult * staggerMult));
  const posture = Math.round(opts.postureDamage * outPostureMult * inDmgMult);
  if (!target.infiniteHealth) {
    target.hp = Math.max(0, target.hp - dmg);
  }
  target.lastPostureHitAt = now;

  if (wasStaggered) {
    target.posture = 0;
    target.staggeredUntil = 0;
  } else {
    target.posture = Math.min(target.maxPosture, target.posture + posture);
  }

  events.push({
    kind: "hit",
    x: target.x,
    y: projY,
    z: target.z,
    yaw: projYaw,
    attackerId: effectiveOwnerId,
    attackerName: owner?.name ?? opts.kind,
    targetId: target.id,
    targetName: target.name,
    isPvP,
    damage: dmg,
    heavy: true,
    projectileKind: opts.kind,
  });

  if (target.hp <= 0) {
    target.alive = false;
    target.action = "dead";
    target.isBlocking = false;
    const killerEntity: CombatEntity = owner ?? {
      id: effectiveOwnerId ?? "projectile_owner",
      name: opts.kind,
      isPlayer: true,
      x: projX,
      y: 0,
      z: projZ,
      yaw: projYaw,
      hp: 0,
      maxHp: COMBAT.PLAYER_MAX_HP,
      posture: 0,
      maxPosture: COMBAT.PLAYER_MAX_POSTURE,
      alive: false,
      isBlocking: false,
      blockStartedAt: 0,
      dodgeInvulnUntil: 0,
      staggeredUntil: 0,
      hurtUntil: 0,
      lastPostureHitAt: 0,
      action: "dead",
    };
    target.onKilled?.(killerEntity);
    events.push({
      kind: "kill",
      x: target.x,
      y: 1.0,
      z: target.z,
      attackerId: effectiveOwnerId,
      attackerName: owner?.name ?? opts.kind,
      targetId: target.id,
      targetName: target.name,
      isPvP,
    });
  } else if (opts.stunMs && opts.stunMs > 0) {
    target.shockedUntil = Math.max(target.shockedUntil ?? 0, now + opts.stunMs);
    target.hurtUntil = Math.max(target.hurtUntil, now + opts.stunMs);
    target.isBlocking = false;
    target.action = "shocked";
    events.push({
      kind: "shock_stun",
      x: target.x,
      y: projY,
      z: target.z,
      attackerId: effectiveOwnerId,
      targetId: target.id,
    });
  } else if (!wasStaggered && target.posture >= target.maxPosture) {
    target.staggeredUntil = now + COMBAT.STAGGER_DURATION_MS;
    target.action = "staggered";
    target.isBlocking = false;
    events.push({
      kind: "stagger",
      x: target.x,
      y: projY,
      z: target.z,
      yaw: projYaw,
      attackerId: effectiveOwnerId,
      attackerName: owner?.name,
      targetId: target.id,
      targetName: target.name,
      isPvP,
    });
  } else {
    target.hurtUntil = now + COMBAT.HURT_STUN_MS;
    target.action = "hurt";
  }

  return { events, reflected: false };
}
