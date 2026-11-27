import assert from "node:assert/strict";
import { LocalPresence } from "colyseus";
import {
  ARENA,
  ATTACK_SPECS,
  COMBAT,
  ENEMY_ARCHETYPES,
  FLIGHT,
  GAME_PROTOCOL_VERSION,
  POWER_UPS,
  clampToArena,
  getWavePlan,
  type CombatEventPayload,
  type EnemyKind,
} from "@sekiroslop/shared";
import {
  resolveMeleeSwing,
  resolvePilumHit,
  updatePostureDecay,
  type AttackRuntime,
  type CombatEntity,
} from "../combat/CombatEngine.js";
import { stepSkeletonAI, type EnemyRuntime } from "../ai/SkeletonAI.js";
import { ColosseumRoom } from "../rooms/ColosseumRoom.js";
import { ColosseumState } from "../schema/ColosseumState.js";
import { allocateUniqueRoomCode, releaseRoomCode } from "../rooms/roomCode.js";

function makeEntity(overrides: Partial<CombatEntity> = {}): CombatEntity {
  return {
    id: "p1",
    name: "Marcus",
    isPlayer: true,
    x: 0,
    z: 0,
    yaw: 0,
    hp: 100,
    maxHp: 100,
    posture: 0,
    maxPosture: 100,
    alive: true,
    isBlocking: false,
    blockStartedAt: 0,
    dodgeInvulnUntil: 0,
    staggeredUntil: 0,
    hurtUntil: 0,
    lastPostureHitAt: 0,
    action: "idle",
    ...overrides,
  };
}

function distanceToSquareAABB(px: number, pz: number, cx: number, cz: number, half: number): number {
  const closestX = Math.max(cx - half, Math.min(px, cx + half));
  const closestZ = Math.max(cz - half, Math.min(pz, cz + half));
  return Math.hypot(px - closestX, pz - closestZ);
}

async function runTests() {
  // 1. Presence-backed unique room code generation & collision prevention
  const presence = new LocalPresence();
  const c1 = await allocateUniqueRoomCode(presence, "ROMA");
  assert.equal(c1, "ROMA", "Requested unused code should be allocated");

  const c2 = await allocateUniqueRoomCode(presence, "ROMA");
  assert.notEqual(c2, "ROMA", "Duplicate code request must collide-check and allocate a fresh code");
  assert.equal(c2.length, 4, "Fallback code should be 4 chars");

  await releaseRoomCode(presence, "ROMA");
  const c3 = await allocateUniqueRoomCode(presence, "ROMA");
  assert.equal(c3, "ROMA", "Released room code should be reusable");
  presence.shutdown();

  // 3. Square pillar plinth AABB collision (clampToArena pushes cleanly outside pillar corners & interior)
  const pillarSE = ARENA.PILLARS.find((p) => p.x === 9.5 && p.z === 9.5)!;
  const plinthHalf = pillarSE.radius * 1.08;

  // Point right at (9.5 + 1.15, 9.5 + 1.15) is inside the square plinth corner -> must be pushed cleanly outside
  const cornerInside = clampToArena(9.5 + 1.15, 9.5 + 1.15);
  const cornerInsideDist = distanceToSquareAABB(
    cornerInside.x,
    cornerInside.z,
    pillarSE.x,
    pillarSE.z,
    plinthHalf
  );
  assert.ok(
    cornerInsideDist >= ARENA.ENTITY_RADIUS - 1e-6,
    `Expected clampToArena(9.5+1.15, 9.5+1.15) outside square plinth by entityRadius, got dist=${cornerInsideDist} at (${cornerInside.x}, ${cornerInside.z})`
  );

  // Point grazing outside the plinth corner within entityRadius -> pushed radially outside
  const cornerGraze = clampToArena(pillarSE.x + plinthHalf + 0.1, pillarSE.z + plinthHalf + 0.1);
  const cornerGrazeDist = distanceToSquareAABB(
    cornerGraze.x,
    cornerGraze.z,
    pillarSE.x,
    pillarSE.z,
    plinthHalf
  );
  assert.ok(
    cornerGrazeDist >= ARENA.ENTITY_RADIUS - 1e-6,
    `Expected corner graze pushed to >= ${ARENA.ENTITY_RADIUS}, got ${cornerGrazeDist}`
  );

  // All 4 pillar centers must push cleanly outside their square plinths
  for (const pillar of ARENA.PILLARS) {
    const pushed = clampToArena(pillar.x, pillar.z);
    const dist = distanceToSquareAABB(
      pushed.x,
      pushed.z,
      pillar.x,
      pillar.z,
      pillar.radius * 1.08
    );
    assert.ok(
      dist >= ARENA.ENTITY_RADIUS - 1e-6,
      `Pillar (${pillar.x},${pillar.z}) center must push outside AABB, got dist=${dist}`
    );
  }

  // 4. Sekiro Perfect Deflect (within DEFLECT_WINDOW_MS) deals 0 HP, damages attacker posture & triggers Riposte callback
  let riposteOpenedAt = 0;
  let riposteAttackerId = "";
  const attacker = makeEntity({ id: "p1", name: "Brutus", x: 0, z: 0, yaw: 0 }); // faces +Z
  const defender = makeEntity({
    id: "p2",
    name: "Cassius",
    x: 0,
    z: 1.8,
    yaw: Math.PI, // faces -Z toward attacker
    isBlocking: true,
    blockStartedAt: 1000,
    onDeflected: (atkEntity, now) => {
      riposteOpenedAt = now;
      riposteAttackerId = atkEntity.id;
    },
  });
  const atk: AttackRuntime = { kind: "light1", startedAt: 920, hitIds: new Set() };
  // At t=1120: attack elapsed = 200ms (active window 160..310ms), block elapsed = 120ms <= 240ms
  const deflectEvents = resolveMeleeSwing(attacker, atk, [attacker, defender], 1120);
  assert.equal(deflectEvents.length, 1);
  assert.equal(deflectEvents[0].kind, "deflect");
  assert.equal(deflectEvents[0].isPvP, true, "PvP friendly fire flag must be set");
  assert.equal(defender.hp, 100, "Perfect deflect deals 0 HP damage");
  assert.ok(attacker.posture > 30, "Perfect deflect deals heavy posture damage to attacker");
  assert.equal(riposteOpenedAt, 1120, "Perfect deflect must invoke onDeflected to open Riposte window");
  assert.equal(riposteAttackerId, attacker.id, "onDeflected must pass the deflected attacker");

  // 5. Riposte Counter attack during Counter Window deals heavy HP & posture damage
  const riposteAtk: AttackRuntime = { kind: "counter", startedAt: 1180, hitIds: new Set() };
  // Counter active window: 100..270ms -> check at t=1320 (elapsed = 140ms)
  const attackerHpBefore = attacker.hp;
  const attackerPostureBefore = attacker.posture;
  const riposteEvents = resolveMeleeSwing(defender, riposteAtk, [attacker, defender], 1320);
  assert.equal(riposteEvents[0]?.kind, "hit");
  assert.equal(riposteEvents[0]?.moveKind, "counter");
  assert.equal(riposteEvents[0]?.heavy, true);
  assert.equal(attacker.hp, attackerHpBefore - ATTACK_SPECS.counter.hpDamage);
  assert.equal(
    attacker.posture,
    Math.min(attacker.maxPosture, attackerPostureBefore + ATTACK_SPECS.counter.postureDamage)
  );

  // 6. Normal Block (held past deflect window) drains defender posture -> stagger at 100
  attacker.posture = 0;
  attacker.hp = 100;
  attacker.staggeredUntil = 0;
  defender.blockStartedAt = 500;
  defender.posture = 90;
  const atk2: AttackRuntime = { kind: "light1", startedAt: 920, hitIds: new Set() };
  const blockEvents = resolveMeleeSwing(attacker, atk2, [attacker, defender], 1120);
  assert.equal(blockEvents[0].kind, "block");
  assert.equal(blockEvents[1]?.kind, "stagger", "Posture >= 100 must stagger defender");
  assert.equal(defender.action, "staggered");

  // 7. Permanent Friendly Fire PvP kill on unguarded/staggered friend
  defender.hp = 20;
  defender.isBlocking = false;
  const atk3: AttackRuntime = { kind: "heavy", startedAt: 1000, hitIds: new Set() };
  // Heavy active window: 340..520ms -> check at t=1400
  const killEvents = resolveMeleeSwing(attacker, atk3, [attacker, defender], 1400);
  assert.equal(killEvents[0].kind, "hit");
  assert.equal(killEvents[1]?.kind, "kill");
  assert.equal(defender.alive, false);
  assert.ok(COMBAT.STAGGER_DAMAGE_MULT > 1, "Stagger multiplier active");

  // 8. Special Move — Whirlwind 360° AoE hits enemies in front, behind, and beside (but not out of range)
  const spinner = makeEntity({ id: "spin", name: "Maximus", x: 0, z: 0, yaw: 0 }); // facing +Z
  const frontTarget = makeEntity({ id: "t_front", x: 0, z: 2.8, yaw: Math.PI });
  const backTarget = makeEntity({ id: "t_back", x: 0, z: -2.8, yaw: 0 });
  const sideTarget = makeEntity({ id: "t_side", x: 2.6, z: 0, yaw: -Math.PI / 2 });
  const farTarget = makeEntity({ id: "t_far", x: 0, z: -4.5, yaw: 0 });
  const whirlwindAtk: AttackRuntime = { kind: "whirlwind", startedAt: 2000, hitIds: new Set() };
  // Whirlwind active window: 210..470ms -> resolve at t=2250
  const wwEvents = resolveMeleeSwing(
    spinner,
    whirlwindAtk,
    [spinner, frontTarget, backTarget, sideTarget, farTarget],
    2250
  );
  const wwHitIds = wwEvents.filter((e) => e.kind === "hit").map((e) => e.targetId);
  assert.deepEqual(
    wwHitIds.sort(),
    ["t_back", "t_front", "t_side"],
    "Whirlwind 360° AoE must hit front, back, and side targets within 3.65m"
  );
  assert.equal(frontTarget.hp, 100 - ATTACK_SPECS.whirlwind.hpDamage);
  assert.equal(backTarget.hp, 100 - ATTACK_SPECS.whirlwind.hpDamage);
  assert.equal(farTarget.hp, 100, "Out-of-range target must not be hit by Whirlwind");

  // 9. Dodge Step 2.5x flash-step speed constant & validation
  assert.ok(
    COMBAT.PLAYER_DODGE_SPEED >= 40,
    `Expected 2.5x dodge speed >= 40, got ${COMBAT.PLAYER_DODGE_SPEED}`
  );

  // 10. Special Move — Imperial Thrust guard chip & long 5.5m piercing shockwave cone
  const thruster = makeEntity({ id: "thruster", x: 0, z: 0, yaw: 0 });
  const blockingFoe = makeEntity({
    id: "guard_foe",
    x: 0,
    z: 4.9, // beyond normal light/heavy range, within thrust 5.5m reach
    yaw: Math.PI,
    isBlocking: true,
    blockStartedAt: 3000,
  });
  const flankFoe = makeEntity({ id: "flank_foe", x: 2.2, z: 0.5, yaw: -Math.PI / 2 });
  const thrustAtk: AttackRuntime = { kind: "thrust", startedAt: 4000, hitIds: new Set() };
  // Thrust active window: 240..440ms -> check at t=4300
  const thrustEvents = resolveMeleeSwing(
    thruster,
    thrustAtk,
    [thruster, blockingFoe, flankFoe],
    4300
  );
  assert.equal(thrustEvents.length, 1, "Imperial Thrust narrow cone must hit only straight ahead");
  assert.equal(thrustEvents[0].kind, "block");
  assert.equal(thrustEvents[0].moveKind, "thrust");
  assert.equal(
    thrustEvents[0].damage,
    ATTACK_SPECS.thrust.blockChipHp,
    "Imperial Thrust must deal 16 guard chip HP through standard block"
  );
  assert.equal(blockingFoe.hp, 100 - ATTACK_SPECS.thrust.blockChipHp);
  assert.equal(blockingFoe.posture, ATTACK_SPECS.thrust.blockPostureDamage);
  assert.equal(flankFoe.hp, 100, "Target outside thrust narrow arcDot=0.72 must not be hit");

  // 11. Power-Ups — Warrior's Fury boost, Iron Will mitigation, Posture Tonic decay
  const furyAttacker = makeEntity({
    id: "fury_a",
    x: 0,
    z: 0,
    yaw: 0,
    damageOutMult: COMBAT.FURY_DAMAGE_MULT,
    postureOutMult: COMBAT.FURY_POSTURE_MULT,
  });
  const plainTarget = makeEntity({ id: "plain_t", x: 0, z: 2.0, yaw: Math.PI });
  const furyEvents = resolveMeleeSwing(
    furyAttacker,
    { kind: "light1", startedAt: 5000, hitIds: new Set() },
    [furyAttacker, plainTarget],
    5200
  );
  const expectedFuryDmg = Math.round(ATTACK_SPECS.light1.hpDamage * COMBAT.FURY_DAMAGE_MULT);
  assert.equal(furyEvents[0]?.damage, expectedFuryDmg, "Warrior's Fury must boost outgoing HP damage");
  assert.equal(plainTarget.hp, 100 - expectedFuryDmg);
  assert.equal(
    plainTarget.posture,
    Math.round(ATTACK_SPECS.light1.postureDamage * COMBAT.FURY_POSTURE_MULT),
    "Warrior's Fury must boost outgoing posture damage"
  );

  const ironDefender = makeEntity({
    id: "iron_d",
    x: 0,
    z: 2.0,
    yaw: Math.PI,
    damageInMult: COMBAT.IRON_WILL_DAMAGE_MULT,
  });
  const baseAttacker = makeEntity({ id: "base_a", x: 0, z: 0, yaw: 0 });
  const ironEvents = resolveMeleeSwing(
    baseAttacker,
    { kind: "heavy", startedAt: 6000, hitIds: new Set() },
    [baseAttacker, ironDefender],
    6400
  );
  const expectedIronDmg = Math.round(ATTACK_SPECS.heavy.hpDamage * COMBAT.IRON_WILL_DAMAGE_MULT);
  assert.equal(ironEvents[0]?.damage, expectedIronDmg, "Iron Will must reduce incoming HP damage by 45%");
  assert.equal(ironDefender.hp, 100 - expectedIronDmg);

  // Posture Tonic accelerates posture decay & shortens decay delay
  const tonicEntity = makeEntity({
    posture: 60,
    lastPostureHitAt: 7000,
    postureRecoveryMult: 2.4,
  });
  const normalEntity = makeEntity({
    posture: 60,
    lastPostureHitAt: 7000,
    postureRecoveryMult: 1.0,
  });
  // At t=7900 (900ms elapsed: > 1600*0.45=720ms for tonic, < 1600ms for normal)
  updatePostureDecay(tonicEntity, 7900, 0.5);
  updatePostureDecay(normalEntity, 7900, 0.5);
  assert.ok(tonicEntity.posture < 60, "Posture Tonic should begin posture recovery early");
  assert.equal(normalEntity.posture, 60, "Without tonic, posture should still be in delay window");

  // 12. Roman Pilum — Direct hit (with Fury/Iron Will scaling), Perfect Deflect & Dodge Evade
  const thrower = makeEntity({
    id: "pilum_owner",
    name: "Titus",
    x: 0,
    z: 0,
    yaw: 0,
    damageOutMult: COMBAT.FURY_DAMAGE_MULT,
    postureOutMult: COMBAT.FURY_POSTURE_MULT,
  });
  const spearTarget = makeEntity({ id: "spear_t", name: "Gaius", x: 0, z: 8, yaw: Math.PI });
  // Direct hit with Warrior's Fury
  const pilumHitEvents = resolvePilumHit(thrower, spearTarget, 0, 8, 0, COMBAT.PILUM_SPEED, 8000);
  const expectedPilumDmg = Math.round(COMBAT.PILUM_HP_DAMAGE * COMBAT.FURY_DAMAGE_MULT);
  assert.equal(pilumHitEvents[0]?.kind, "hit");
  assert.equal(pilumHitEvents[0]?.damage, expectedPilumDmg);
  assert.equal(spearTarget.hp, 100 - expectedPilumDmg);

  // Perfect Deflect of incoming Pilum flying +Z toward defender facing -Z (yaw = PI)
  let pilumDeflected = false;
  const spearDeflector = makeEntity({
    id: "spear_def",
    name: "Lucius",
    x: 0,
    z: 8,
    yaw: Math.PI,
    isBlocking: true,
    blockStartedAt: 8100,
    onDeflected: () => {
      pilumDeflected = true;
    },
  });
  const pilumDeflectEvents = resolvePilumHit(
    thrower,
    spearDeflector,
    0,
    8,
    0,
    COMBAT.PILUM_SPEED,
    8220
  );
  assert.equal(pilumDeflectEvents[0]?.kind, "deflect", "Timed guard facing Pilum must deflect it");
  assert.equal(spearDeflector.hp, 100, "Deflected Pilum must deal 0 HP damage");
  assert.equal(pilumDeflected, true, "Deflecting a Pilum must open Riposte counter callback");

  // 13. ColosseumRoom authoritative Healing Flask, Riposte Counter promotion & Solid Entity Separation
  const room = new ColosseumRoom();
  room.setState(new ColosseumState());
  const broadcasted: CombatEventPayload[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (room as any).broadcast = (_type: string, payload: CombatEventPayload) => {
    broadcasted.push(payload);
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fakeClient1 = { sessionId: "c1" } as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fakeClient2 = { sessionId: "c2" } as any;
  room.onJoin(fakeClient1, { name: "Marcus" });
  room.onJoin(fakeClient2, { name: "Brutus" });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rts = (room as any).playerRuntimes;
  const rt1 = rts.get("c1");
  const rt2 = rts.get("c2");

  // 13a. Healing Flask restores +50 HP capped at maxHp, clears belt slot & broadcasts powerup_use
  rt1.entity.hp = 35;
  rt1.belt[0] = { kind: "healing_flask", charges: POWER_UPS.healing_flask.charges };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (room as any).handleUseItem(fakeClient1, { slotIndex: 0, yaw: 0 });
  assert.equal(
    rt1.entity.hp,
    35 + COMBAT.HEALING_FLASK_HP,
    "Healing Flask must restore +50 HP"
  );
  assert.equal(rt1.belt[0].kind, "", "Consumed Healing Flask must clear belt slot");
  assert.equal(rt1.belt[0].charges, 0);
  assert.ok(
    broadcasted.some((e) => e.kind === "powerup_use" && e.powerUpKind === "healing_flask"),
    "Using Healing Flask must broadcast powerup_use event"
  );

  // Second Healing Flask caps cleanly at PLAYER_MAX_HP (100)
  rt1.belt[0] = { kind: "healing_flask", charges: 1 };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (room as any).handleUseItem(fakeClient1, { slotIndex: 0, yaw: 0 });
  assert.equal(rt1.entity.hp, COMBAT.PLAYER_MAX_HP, "Healing Flask must cap at maxHp");

  // 13b. Riposte Counter promotion via handleAttack during counterReadyUntil window
  rt1.counterReadyUntil = Date.now() + COMBAT.COUNTER_WINDOW_MS;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (room as any).handleAttack(fakeClient1, { kind: "light", yaw: 0 });
  assert.equal(
    rt1.activeAttack?.kind,
    "counter",
    "Light attack during counterReadyUntil must promote to Riposte Counter"
  );
  assert.equal(rt1.counterReadyUntil, 0, "Executing counter must consume counter window");
  rt1.activeAttack = null;

  // 13c. Solid Entity Separation prevents two players (and enemies) from overlapping at same XZ
  rt1.entity.x = 0;
  rt1.entity.z = 0;
  rt2.entity.x = 0.15;
  rt2.entity.z = 0.05;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (room as any).step(33);
  const sepDist = Math.hypot(rt2.entity.x - rt1.entity.x, rt2.entity.z - rt1.entity.z);
  assert.ok(
    sepDist >= ARENA.ENTITY_RADIUS * 2,
    `Solid entity separation must push overlapping players apart to >= ${ARENA.ENTITY_RADIUS * 2}m, got ${sepDist.toFixed(3)}m`
  );

  // 14. All 4 enemy archetypes (skirmisher, legionary, assassin, champion) specs & attack mapping
  const expectedKinds: EnemyKind[] = ["skirmisher", "legionary", "assassin", "champion"];
  for (const kind of expectedKinds) {
    const spec = ENEMY_ARCHETYPES[kind];
    assert.ok(spec, `Missing ENEMY_ARCHETYPES entry for ${kind}`);
    assert.equal(spec.kind, kind);
    assert.ok(spec.name.length > 0, `${kind} must have a non-empty display name`);
    assert.ok(spec.modelFile.endsWith(".glb"), `${kind} must reference a .glb model`);
    assert.ok(spec.scale > 0, `${kind} scale must be > 0`);
    assert.ok(spec.maxHp > 0 && spec.maxPosture > 0, `${kind} HP/posture must be > 0`);
    assert.ok(spec.moveSpeed > 0 && spec.attackRange > 0, `${kind} speed/range must be > 0`);
    assert.ok(ATTACK_SPECS[spec.primaryAttack], `${kind} primaryAttack must exist in ATTACK_SPECS`);
    assert.ok(ATTACK_SPECS[spec.heavyAttack], `${kind} heavyAttack must exist in ATTACK_SPECS`);
  }
  assert.equal(ENEMY_ARCHETYPES.skirmisher.canBlock, false);
  assert.equal(ENEMY_ARCHETYPES.skirmisher.primaryAttack, "enemy_fast");
  assert.equal(ENEMY_ARCHETYPES.legionary.canBlock, true);
  assert.equal(ENEMY_ARCHETYPES.legionary.primaryAttack, "enemy_light");
  assert.equal(ENEMY_ARCHETYPES.legionary.heavyAttack, "enemy_heavy");
  assert.equal(ENEMY_ARCHETYPES.assassin.canBlock, false);
  assert.equal(ENEMY_ARCHETYPES.assassin.heavyAttack, "enemy_lunge");
  assert.ok(
    ENEMY_ARCHETYPES.assassin.moveSpeed > ENEMY_ARCHETYPES.skirmisher.moveSpeed,
    "Assassin should be the fastest archetype"
  );
  assert.ok(
    (ATTACK_SPECS.enemy_lunge.lungeSpeed ?? 0) >= 10,
    "enemy_lunge must define high forward lungeSpeed"
  );
  assert.equal(ENEMY_ARCHETYPES.champion.isBoss, true);
  assert.equal(ENEMY_ARCHETYPES.champion.canBlock, true);
  assert.equal(ENEMY_ARCHETYPES.champion.primaryAttack, "enemy_cleave");
  assert.equal(ENEMY_ARCHETYPES.champion.heavyAttack, "enemy_slam");
  assert.ok(ENEMY_ARCHETYPES.champion.maxHp >= 300, "Champion Boss must have boss-tier HP");

  // 15. Progressive getWavePlan(1..6) including Champion Boss on Wave 4 and even Wave 6
  const wave1 = getWavePlan(1);
  assert.equal(wave1.wave, 1);
  assert.ok(wave1.title.length > 0);
  assert.deepEqual(wave1.enemies, ["skirmisher", "skirmisher", "legionary"]);
  assert.equal(wave1.maxConcurrent, 3);
  assert.equal(wave1.hpScale, 1.0);

  const wave2 = getWavePlan(2);
  assert.equal(wave2.wave, 2);
  assert.equal(wave2.enemies.length, 5);
  assert.ok(wave2.enemies.includes("assassin"), "Wave 2 should introduce Arena Stalker assassin");
  assert.equal(wave2.maxConcurrent, 4);

  const wave3 = getWavePlan(3);
  assert.equal(wave3.wave, 3);
  assert.equal(wave3.enemies.length, 6);
  assert.ok(wave3.hpScale > 1.0, "Wave 3 should begin scaling enemy HP");

  const wave4 = getWavePlan(4);
  assert.equal(wave4.wave, 4);
  assert.ok(wave4.enemies.includes("champion"), "Wave 4 must include the Murmillo Champion boss");
  assert.ok(wave4.title.toLowerCase().includes("champion"), "Wave 4 title should announce the Champion");

  const wave5 = getWavePlan(5);
  assert.equal(wave5.wave, 5);
  assert.equal(wave5.enemies.length, Math.min(10, 4 + 5));
  assert.equal(wave5.enemies.includes("champion"), false, "Odd endless Wave 5 should not include Champion");
  assert.ok(wave5.hpScale > 1.0, "Wave 5 should scale HP");

  const wave6 = getWavePlan(6);
  assert.equal(wave6.wave, 6);
  assert.equal(wave6.enemies.length, Math.min(10, 4 + 6));
  assert.equal(wave6.enemies.includes("champion"), true, "Even endless Wave 6 must include Champion boss");
  assert.ok(wave6.hpScale > wave5.hpScale, "Wave 6 HP scale must exceed Wave 5 HP scale");

  // Helper for AI archetype unit tests
  function makeEnemyRuntime(kind: EnemyKind, x: number, z: number, now = 10000): EnemyRuntime {
    const spec = ENEMY_ARCHETYPES[kind];
    return {
      entity: makeEntity({
        id: `ai_${kind}`,
        name: spec.name,
        isPlayer: false,
        x,
        z,
        yaw: 0,
        hp: spec.maxHp,
        maxHp: spec.maxHp,
        posture: 0,
        maxPosture: spec.maxPosture,
        action: "chase",
      }),
      kind,
      activeAttack: null,
      nextDecisionAt: now,
      strafeDir: 1,
      emerging: false,
      deadAt: 0,
      attackCounter: 0,
      blockUntil: 0,
      blockCooldownUntil: 0,
    };
  }

  // 16. Legionary shield block AI behavior (raises block reactively, holds until blockUntil, lowers with cooldown)
  const attackingPlayer = makeEntity({
    id: "ai_target_p",
    name: "Marcus",
    x: 0,
    z: 2.1,
    yaw: Math.PI,
    action: "light1",
  });
  const legionaryRt = makeEnemyRuntime("legionary", 0, 0, 10000);
  const skirmisherRt = makeEnemyRuntime("skirmisher", 0, 0, 10000);

  const origRandom = Math.random;
  try {
    Math.random = () => 0.01; // Deterministic low roll to trigger reactive shield guard
    const legStep1 = stepSkeletonAI(legionaryRt, [attackingPlayer], [legionaryRt], 10000, 0.033);
    assert.equal(legionaryRt.entity.isBlocking, true, "Legionary must raise shield block against close attacking player");
    assert.equal(legionaryRt.entity.action, "block", "Legionary action must enter 'block'");
    assert.equal(legStep1.telegraph, "none");
    assert.ok(
      legionaryRt.blockUntil >= 10700 && legionaryRt.blockUntil <= 11100,
      `Legionary block duration should be 700-1100ms, got ${legionaryRt.blockUntil - 10000}ms`
    );

    // Mid-block tick stays in block state
    stepSkeletonAI(legionaryRt, [attackingPlayer], [legionaryRt], 10300, 0.033);
    assert.equal(legionaryRt.entity.isBlocking, true);
    assert.equal(legionaryRt.entity.action, "block");

    // Past blockUntil lowers guard and enters cooldown
    stepSkeletonAI(legionaryRt, [attackingPlayer], [legionaryRt], legionaryRt.blockUntil + 50, 0.033);
    assert.equal(legionaryRt.entity.isBlocking, false, "Legionary must lower block once blockUntil elapses");
    assert.ok(
      legionaryRt.blockCooldownUntil > legionaryRt.blockUntil,
      "Legionary must set blockCooldownUntil after lowering shield"
    );

    // Skirmisher (canBlock: false) must NEVER block under the exact same conditions
    stepSkeletonAI(skirmisherRt, [attackingPlayer], [skirmisherRt], 10000, 0.033);
    assert.equal(skirmisherRt.entity.isBlocking, false, "Skirmisher must not be able to block");
    assert.notEqual(skirmisherRt.entity.action, "block");
  } finally {
    Math.random = origRandom;
  }

  // 17. Assassin mid-range enemy_lunge attack & forward lunge velocity
  const assassinTarget = makeEntity({ id: "assn_p", x: 0, z: 3.1, yaw: Math.PI, action: "idle" });
  const assassinRt = makeEnemyRuntime("assassin", 0, 0, 11000);
  const assnStart = stepSkeletonAI(assassinRt, [assassinTarget], [assassinRt], 11000, 0.033);
  assert.equal(assassinRt.activeAttack?.kind, "enemy_lunge", "Assassin at 3.1m must open with enemy_lunge");
  assert.equal(assnStart.telegraph, "heavy", "enemy_lunge must telegraph as heavy");
  assert.equal(assassinRt.entity.action, "windup_heavy");
  assert.equal(assnStart.events[0]?.moveKind, "enemy_lunge");
  assert.equal(assnStart.events[0]?.enemyKind, "assassin");

  // Step into active window: assassin lunges forward at 11.5 m/s and hits target
  const lungeActiveAt = 11000 + ATTACK_SPECS.enemy_lunge.windupMs + 40;
  const zBeforeLunge = assassinRt.entity.z;
  const assnActive = stepSkeletonAI(assassinRt, [assassinTarget], [assassinRt], lungeActiveAt, 0.05);
  assert.equal(assassinRt.entity.action, "attack_heavy");
  assert.ok(
    assassinRt.entity.z - zBeforeLunge >= 0.5,
    `Assassin enemy_lunge must surge forward using lungeSpeed (11.5 m/s * 0.05s = 0.575m), moved ${(assassinRt.entity.z - zBeforeLunge).toFixed(3)}m`
  );
  assert.equal(assnActive.events[0]?.kind, "hit", "Assassin enemy_lunge must hit unguarded target");
  assert.equal(assnActive.events[0]?.moveKind, "enemy_lunge");
  assert.equal(assassinTarget.hp, 100 - ATTACK_SPECS.enemy_lunge.hpDamage);

  // 18. Champion Boss enemy_slam heavy guard chip & 3rd-swing boss slam AI selection
  const championEntity = makeEntity({
    id: "boss_champ",
    name: ENEMY_ARCHETYPES.champion.name,
    isPlayer: false,
    x: 0,
    z: 0,
    yaw: 0,
    hp: ENEMY_ARCHETYPES.champion.maxHp,
    maxHp: ENEMY_ARCHETYPES.champion.maxHp,
    maxPosture: ENEMY_ARCHETYPES.champion.maxPosture,
  });
  const guardedPlayer = makeEntity({
    id: "guard_p",
    name: "Cassius",
    x: 0,
    z: 3.4, // within Champion's 4.0m enemy_slam reach
    yaw: Math.PI,
    isBlocking: true,
    blockStartedAt: 11000, // Held well past DEFLECT_WINDOW_MS -> standard block
  });
  const slamAtk: AttackRuntime = { kind: "enemy_slam", startedAt: 12000, hitIds: new Set() };
  const slamActiveAt = 12000 + ATTACK_SPECS.enemy_slam.windupMs + 60;
  const slamEvents = resolveMeleeSwing(championEntity, slamAtk, [championEntity, guardedPlayer], slamActiveAt);
  assert.equal(slamEvents[0]?.kind, "block", "Held guard facing Champion slam must resolve as block with heavy chip");
  assert.equal(slamEvents[0]?.moveKind, "enemy_slam");
  assert.equal(
    slamEvents[0]?.damage,
    ATTACK_SPECS.enemy_slam.blockChipHp,
    "Champion enemy_slam must deal heavy guard chip HP (10) through standard block"
  );
  assert.equal(guardedPlayer.hp, 100 - ATTACK_SPECS.enemy_slam.blockChipHp);
  assert.equal(guardedPlayer.posture, ATTACK_SPECS.enemy_slam.blockPostureDamage);

  // Verify Champion AI selects enemy_slam on its 3rd swing
  const champRt = makeEnemyRuntime("champion", 0, 0, 13000);
  champRt.attackCounter = 2; // Next swing is #3 -> guaranteed enemy_slam
  const champTarget = makeEntity({ id: "champ_p", x: 0, z: 3.0, yaw: Math.PI, action: "idle" });
  const champSwing = stepSkeletonAI(champRt, [champTarget], [champRt], 13000, 0.033);
  assert.equal(champRt.activeAttack?.kind, "enemy_slam", "Champion 3rd swing must select enemy_slam");
  assert.equal(champSwing.telegraph, "heavy");

  // 19. Auto-activation of Iron Will & Swift Feet on pickup + 3D Ability Projectile pitch clamp
  rt1.ironWillUntil = 0;
  rt1.swiftFeetUntil = 0;
  rt1.belt = [
    { kind: "healing_flask", charges: 1 },
    { kind: "posture_tonic", charges: 1 },
    { kind: "warriors_fury", charges: 1 },
  ];
  // Even with a full belt, Iron Will & Swift Feet activate immediately on pickup without consuming belt slots!
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const collectedIron = (room as any).tryCollectPickup(rt1, { kind: "iron_will" }, 10000);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const collectedSwift = (room as any).tryCollectPickup(rt1, { kind: "swift_feet" }, 10000);
  assert.equal(collectedIron, true, "Iron Will must collect & activate even when belt is full");
  assert.equal(collectedSwift, true, "Swift Feet must collect & activate even when belt is full");
  assert.ok(rt1.ironWillUntil > 10000, "Iron Will must activate immediately on pickup");
  assert.ok(rt1.swiftFeetUntil > 10000, "Swift Feet must activate immediately on pickup");

  rt1.abilityReadyAt = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (room as any).handleCastAbility(fakeClient1, { ability: "fireball", yaw: 0, pitch: 0.85 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pilumsMap = (room as any).pilumRuntimes as Map<string, { vy: number; vz: number }>;
  const highProj = Array.from(pilumsMap.values()).at(-1);
  assert.ok(highProj, "Fireball projectile should spawn on cast_ability");
  assert.ok(
    Math.abs(highProj.vy - Math.sin(0.85) * 22) < 1e-6,
    `Expected upward fireball vy at pitch 0.85, got ${highProj.vy}`
  );
  rt1.abilityReadyAt = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (room as any).handleCastAbility(fakeClient1, { ability: "fireball", yaw: 0, pitch: -0.8 });
  const lowProj = Array.from(pilumsMap.values()).at(-1);
  assert.ok(lowProj, "Downward fireball should spawn when off cooldown");
  assert.ok(
    Math.abs(lowProj.vy - Math.sin(-0.8) * 22) < 1e-6,
    `Expected downward fireball vy at pitch -0.8, got ${lowProj.vy}`
  );

  // 20. All 9 Selectable Sekiro Combat Arts, C-3 cooldown/state guards & Ichimonji hit-gated posture recovery
  const all8Arts = [
    "sakura_dance",
    "mortal_draw",
    "ichimonji_double",
    "ashina_cross",
    "dragon_flash",
    "whirlwind_slash",
    "shadowrush",
    "spiral_cloud_passage",
    "one_mind",
  ] as const;

  rt1.experimentalArtReadyAt = {};
  rt1.activeAttack = null;
  rt1.dodgeUntil = 0;
  rt1.entity.hurtUntil = 0;
  rt1.entity.staggeredUntil = 0;

  const ps1 = room.state.players.get(fakeClient1.sessionId)!;
  ps1.selectedArt = "ashina_cross";
  // Non-selected combat art in live mode (preview: false) must be rejected
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (room as any).pendingArtPulses = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (room as any).handleExperimentalArt(fakeClient1, { art: "sakura_dance", yaw: 0, preview: false });
  assert.equal(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (room as any).pendingArtPulses.length,
    0,
    "Non-selected combat art must be rejected in live mode"
  );

  for (const art of all8Arts) {
    ps1.selectedArt = art;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (room as any).handleExperimentalArt(fakeClient1, { art, yaw: 0, preview: false });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pulses = (room as any).pendingArtPulses as Array<{ art: string; postureRecover?: number }>;
    assert.ok(pulses.length >= 1, `Combat art ${art} must schedule at least one authoritative pulse`);
    assert.equal(pulses[0].art, art, `Scheduled pulse should match requested art ${art}`);
  }

  // C-3: Authoritative per-art cooldown blocks immediate recast of ichimonji_double
  ps1.selectedArt = "ichimonji_double";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (room as any).pendingArtPulses = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (room as any).handleExperimentalArt(fakeClient1, { art: "ichimonji_double", yaw: 0, preview: false });
  assert.equal(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (room as any).pendingArtPulses.length,
    0,
    "C-3: Casting ichimonji_double while on server cooldown must be rejected"
  );

  // C-3: Reject non-preview experimental art during activeAttack, dodgeUntil, or hurtUntil
  rt1.experimentalArtReadyAt = {};
  rt1.activeAttack = { kind: "light1", startedAt: Date.now(), hitIds: new Set() };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (room as any).handleExperimentalArt(fakeClient1, { art: "ichimonji_double", yaw: 0, preview: false });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assert.equal((room as any).pendingArtPulses.length, 0, "C-3: Must reject experimental art during activeAttack");
  rt1.activeAttack = null;

  rt1.dodgeUntil = Date.now() + 300;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (room as any).handleExperimentalArt(fakeClient1, { art: "ichimonji_double", yaw: 0, preview: false });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assert.equal((room as any).pendingArtPulses.length, 0, "C-3: Must reject experimental art during dodgeUntil");
  rt1.dodgeUntil = 0;

  rt1.entity.hurtUntil = Date.now() + 300;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (room as any).handleExperimentalArt(fakeClient1, { art: "ichimonji_double", yaw: 0, preview: false });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assert.equal((room as any).pendingArtPulses.length, 0, "C-3: Must reject experimental art during hurtUntil");
  rt1.entity.hurtUntil = 0;

  // Verify Combined Ichimonji empty-air whiff does NOT recover posture, while hitting a target DOES recover 22+22 posture
  ps1.selectedArt = "ichimonji_double";
  rt1.experimentalArtReadyAt = {};
  rt1.entity.x = 0;
  rt1.entity.y = 0;
  rt1.y = 0;
  rt1.entity.z = 0;
  rt1.entity.yaw = 0;
  rt1.entity.posture = 50;
  rt2.entity.x = 0;
  rt2.entity.y = 0;
  rt2.y = 0;
  rt2.entity.z = 2.4;
  rt2.entity.hp = 100;
  rt2.entity.posture = 0;
  rt2.entity.alive = true;
  rt2.entity.isBlocking = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (room as any).handleExperimentalArt(fakeClient1, { art: "ichimonji_double", yaw: 0, preview: false });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ichi2Pulses = (room as any).pendingArtPulses;
  assert.equal(ichi2Pulses.length, 2, "Combined Ichimonji must schedule 2 strikes");
  assert.equal(ichi2Pulses[0].postureRecover, 22);
  assert.equal(ichi2Pulses[1].postureRecover, 22);

  // Empty-air whiff (no target in range) -> posture MUST stay 50
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (room as any).resolveExperimentalArtPulse(ichi2Pulses[0], [rt1.entity], Date.now());
  assert.equal(rt1.entity.posture, 50, "C-3: Empty-air Ichimonji whiff must NOT recover posture");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (room as any).resolveExperimentalArtPulse(ichi2Pulses[0], [rt1.entity, rt2.entity], Date.now());
  assert.equal(rt1.entity.posture, 28, "First Ichimonji strike recovers 22 posture (50 -> 28)");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (room as any).resolveExperimentalArtPulse(ichi2Pulses[1], [rt1.entity, rt2.entity], Date.now());
  assert.equal(rt1.entity.posture, 6, "Second Ichimonji strike recovers 22 posture (28 -> 6)");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (room as any).pendingArtPulses = [];

  // 21. 3D Projectile Y-range check (high sky cast misses ground target) & swept anti-tunneling + slotIndex guards
  pilumsMap.clear();
  room.state.pilums.clear();
  rt1.entity.x = 0;
  rt1.entity.z = 0;
  rt1.entity.yaw = 0;
  rt1.y = 0;
  rt1.entity.y = 0;
  rt2.entity.x = 0;
  rt2.entity.z = 3.0;
  rt2.y = 0;
  rt2.entity.y = 0;
  rt2.entity.hp = 100;
  rt2.entity.alive = true;
  rt2.entity.isBlocking = false;

  // High sky cast (pitch = 1.15 rad) must fly cleanly over ground target at z = 3.0m
  rt1.abilityReadyAt = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (room as any).handleCastAbility(fakeClient1, { ability: "stun_gun", yaw: 0, pitch: 1.15 });
  for (let i = 0; i < 10; i++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (room as any).step(33);
  }
  assert.equal(rt2.entity.hp, 100, "Projectile aimed high into sky must not hit ground target below");

  // Swept substep test: level stun bolt at 38 m/s over a 100ms spike must NOT tunnel through target at z = 2.0m
  pilumsMap.clear();
  room.state.pilums.clear();
  rt2.entity.x = 0;
  rt2.entity.z = 2.0;
  rt2.entity.hp = 100;
  rt2.entity.alive = true;
  rt1.abilityReadyAt = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (room as any).handleCastAbility(fakeClient1, { ability: "stun_gun", yaw: 0, pitch: 0.0 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (room as any).step(100);
  assert.ok(
    rt2.entity.hp < 100,
    `Swept projectile substep must catch mid-tick target without tunneling (hp=${rt2.entity.hp})`
  );

  // Invalid slotIndex values (NaN, float, out-of-range, undefined) must be safely ignored without throwing
  rt1.belt[0] = { kind: "healing_flask", charges: 1 };
  for (const badSlot of [Number.NaN, 1.5, -1, 3, Number.POSITIVE_INFINITY, undefined]) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (room as any).handleUseItem(fakeClient1, { slotIndex: badSlot as any, yaw: 0 });
  }
  assert.equal(rt1.belt[0].charges, 1, "Invalid slotIndex must not consume valid belt items");

  // 22. C-4: Melee & Experimental Art vertical Y overlap check (<= 1.85m)
  const groundedSwinger = makeEntity({ id: "y_atk", x: 0, y: 0, z: 0, yaw: 0 });
  const airborneTarget = makeEntity({ id: "y_high", x: 0, y: 2.3, z: 1.8, yaw: Math.PI });
  const lowJumpTarget = makeEntity({ id: "y_low", x: 0, y: 1.5, z: 1.8, yaw: Math.PI });
  const ySwingEvents = resolveMeleeSwing(
    groundedSwinger,
    { kind: "light1", startedAt: 20000, hitIds: new Set() },
    [groundedSwinger, airborneTarget, lowJumpTarget],
    20200
  );
  assert.equal(airborneTarget.hp, 100, "C-4: Airborne target > 1.85m above attacker must evade grounded melee swing");
  assert.ok(lowJumpTarget.hp < 100, "C-4: Target within 1.85m vertical overlap must be hit by melee swing");
  assert.equal(ySwingEvents.filter((e) => e.kind === "hit").length, 1);

  // Experimental Art vertical Y overlap
  rt1.experimentalArtReadyAt = {};
  rt1.entity.x = 0;
  rt1.entity.y = 0;
  rt1.y = 0;
  rt1.entity.z = 0;
  rt1.entity.yaw = 0;
  rt2.entity.x = 0;
  rt2.entity.y = 2.4;
  rt2.y = 2.4;
  rt2.entity.z = 2.0;
  rt2.entity.hp = 100;
  rt2.entity.alive = true;
  rt2.entity.isBlocking = false;
  ps1.selectedArt = "ichimonji_double";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (room as any).handleExperimentalArt(fakeClient1, { art: "ichimonji_double", yaw: 0, preview: false });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const yArtPulse = (room as any).pendingArtPulses[0];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (room as any).resolveExperimentalArtPulse(yArtPulse, [rt1.entity, rt2.entity], Date.now());
  assert.equal(rt2.entity.hp, 100, "C-4: Experimental art pulse must miss target > 1.85m vertically away");
  rt2.entity.y = 0;
  rt2.y = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (room as any).pendingArtPulses = [];

  // 23. H-4: Enemy hurt stun cancels light activeAttack (prevents zero-telegraph resume), keeps heavy attack
  const h4LightEnemy = makeEnemyRuntime("legionary", 0, 0, 30000);
  const h4Player = makeEntity({ id: "h4_p", x: 0, z: 2.0, yaw: Math.PI });
  h4LightEnemy.activeAttack = { kind: "enemy_light", startedAt: 30000, hitIds: new Set() };
  h4LightEnemy.entity.hurtUntil = 30200;
  stepSkeletonAI(h4LightEnemy, [h4Player], [h4LightEnemy], 30050, 0.033);
  assert.equal(h4LightEnemy.entity.action, "hurt");
  assert.equal(h4LightEnemy.activeAttack, null, "H-4: Hurt stun must cancel non-heavy enemy activeAttack");

  const h4HeavyEnemy = makeEnemyRuntime("champion", 0, 0, 30000);
  h4HeavyEnemy.activeAttack = { kind: "enemy_slam", startedAt: 30000, hitIds: new Set() };
  h4HeavyEnemy.entity.hurtUntil = 30200;
  stepSkeletonAI(h4HeavyEnemy, [h4Player], [h4HeavyEnemy], 30050, 0.033);
  assert.ok(h4HeavyEnemy.activeAttack !== null, "H-4: Hurt stun must NOT cancel heavy enemy_slam attack");

  // 24. H-5 & M-3: enemy_lunge, enemy_cleave, enemy_slam are heavy moves + yaw on hit/block/deflect/stagger
  for (const heavyKind of ["enemy_lunge", "enemy_cleave", "enemy_slam"] as const) {
    const boss = makeEntity({ id: `h5_${heavyKind}`, isPlayer: false, x: 0, z: 0, yaw: 0.75 });
    const victim = makeEntity({
      id: `h5_v_${heavyKind}`,
      x: Math.sin(0.75) * 2.0,
      z: Math.cos(0.75) * 2.0,
      yaw: 0.75 + Math.PI,
      isBlocking: true,
      blockStartedAt: 40000 + ATTACK_SPECS[heavyKind].windupMs,
    });
    const activeAt = 40000 + ATTACK_SPECS[heavyKind].windupMs + 40;
    const defEvs = resolveMeleeSwing(
      boss,
      { kind: heavyKind, startedAt: 40000, hitIds: new Set() },
      [boss, victim],
      activeAt
    );
    assert.equal(defEvs[0]?.kind, "deflect");
    assert.equal(defEvs[0]?.heavy, true, `H-5: ${heavyKind} deflect must emit heavy: true`);
    assert.equal(defEvs[0]?.yaw, 0.75, `M-3: ${heavyKind} deflect must carry attacker yaw`);

    // Unblocked hit
    victim.isBlocking = false;
    victim.hp = 200;
    victim.maxHp = 200;
    const hitEvs = resolveMeleeSwing(
      boss,
      { kind: heavyKind, startedAt: 45000, hitIds: new Set() },
      [boss, victim],
      45000 + ATTACK_SPECS[heavyKind].windupMs + 40
    );
    assert.equal(hitEvs[0]?.kind, "hit");
    assert.equal(hitEvs[0]?.heavy, true, `H-5: ${heavyKind} hit must emit heavy: true`);
    assert.equal(hitEvs[0]?.yaw, 0.75, `M-3: ${heavyKind} hit must carry attacker yaw`);
  }

  // 25. H-6 & M-3: resolvePilumHit stagger bonus + no infinite re-stagger + disconnect kill fallback + pilum yaw
  const staggeredFoe = makeEntity({
    id: "h6_stag",
    x: 0,
    z: 6,
    hp: 200,
    maxHp: 200,
    posture: 100,
    maxPosture: 100,
    staggeredUntil: 55000,
    action: "staggered",
  });
  const pilumVx = 12;
  const pilumVz = 16;
  const expectedPilumYaw = Math.atan2(pilumVx, pilumVz);
  const stagPilumEvs = resolvePilumHit(thrower, staggeredFoe, 0, 6, pilumVx, pilumVz, 50000);
  const expectedStagPilumDmg = Math.round(
    COMBAT.PILUM_HP_DAMAGE * COMBAT.FURY_DAMAGE_MULT * COMBAT.STAGGER_DAMAGE_MULT
  );
  assert.equal(stagPilumEvs[0]?.kind, "hit");
  assert.equal(stagPilumEvs[0]?.damage, expectedStagPilumDmg, "H-6: Pilum must apply STAGGER_DAMAGE_MULT");
  assert.equal(stagPilumEvs[0]?.yaw, expectedPilumYaw, "M-3: Pilum hit must emit Math.atan2(vx, vz) yaw");
  assert.equal(staggeredFoe.posture, 0, "H-6: Pilum punish on staggered target must reset posture to 0");
  assert.equal(staggeredFoe.staggeredUntil, 0, "H-6: Pilum punish must clear staggeredUntil");
  assert.equal(
    stagPilumEvs.some((e) => e.kind === "stagger"),
    false,
    "H-6: Pilum must NOT re-stagger an already staggered target"
  );

  // Disconnected thrower (owner === undefined) lethal Pilum still invokes onKilled
  let disconnectKiller: CombatEntity | null = null;
  const lowEnemy = makeEntity({
    id: "h6_enemy",
    isPlayer: false,
    x: 0,
    z: 5,
    hp: 10,
    maxHp: 100,
    onKilled: (killer) => {
      disconnectKiller = killer;
    },
  });
  const dcKillEvs = resolvePilumHit(undefined, lowEnemy, 0, 5, 0, 25, 51000, "departed_player");
  assert.equal(lowEnemy.alive, false);
  assert.ok(dcKillEvs.some((e) => e.kind === "kill"));
  assert.ok(disconnectKiller !== null, "H-6: Disconnected Pilum kill must still invoke onKilled");
  assert.equal((disconnectKiller as CombatEntity).id, "departed_player");
  assert.equal((disconnectKiller as CombatEntity).isPlayer, true);

  // 26. H-10: Perfect Deflect posture-breaking attacker stops damage to subsequent targets in same tick
  const frailAttacker = makeEntity({
    id: "h10_atk",
    x: 0,
    z: 0,
    yaw: 0,
    posture: 90,
    maxPosture: 100,
  });
  const deflectFirst = makeEntity({
    id: "h10_def1",
    x: 0,
    z: 1.8,
    yaw: Math.PI,
    isBlocking: true,
    blockStartedAt: 60150,
  });
  const behindSecond = makeEntity({
    id: "h10_t2",
    x: 0.2,
    z: 2.0,
    yaw: Math.PI,
    isBlocking: false,
  });
  const h10MeleeEvs = resolveMeleeSwing(
    frailAttacker,
    { kind: "light1", startedAt: 60000, hitIds: new Set() },
    [frailAttacker, deflectFirst, behindSecond],
    60200
  );
  assert.ok(h10MeleeEvs.some((e) => e.kind === "deflect"));
  assert.ok(h10MeleeEvs.some((e) => e.kind === "stagger" && e.targetId === "h10_atk"));
  assert.equal(
    behindSecond.hp,
    100,
    "H-10: Second target must NOT take damage after first target's deflect posture-breaks attacker"
  );

  // H-10 on resolveExperimentalArtPulse
  rt1.experimentalArtReadyAt = {};
  rt1.entity.x = 0;
  rt1.entity.y = 0;
  rt1.entity.z = 0;
  rt1.entity.yaw = 0;
  rt1.entity.posture = 90;
  rt1.entity.staggeredUntil = 0;
  const artDeflector = makeEntity({
    id: "h10_art_d1",
    x: 0,
    y: 0,
    z: 2.0,
    yaw: Math.PI,
    isBlocking: true,
    blockStartedAt: Date.now() - 50,
  });
  const artSecond = makeEntity({
    id: "h10_art_t2",
    x: 0.1,
    y: 0,
    z: 2.1,
    yaw: Math.PI,
    isBlocking: false,
  });
  ps1.selectedArt = "ichimonji_double";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (room as any).handleExperimentalArt(fakeClient1, { art: "ichimonji_double", yaw: 0, preview: false });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const h10Pulse = (room as any).pendingArtPulses[0];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (room as any).resolveExperimentalArtPulse(h10Pulse, [rt1.entity, artDeflector, artSecond], Date.now());
  assert.equal(rt1.entity.action, "staggered");
  assert.equal(
    artSecond.hp,
    100,
    "H-10: Experimental art pulse must stop hitting subsequent targets after attacker is posture-broken"
  );
  rt1.entity.staggeredUntil = 0;
  rt1.entity.posture = 0;
  rt1.entity.action = "idle";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (room as any).pendingArtPulses = [];

  // 27. H-7: Coincident entity separation uses deterministic (1, 0) normal & emerging enemies stay in North Alcove
  rt1.entity.x = 3.0;
  rt1.entity.z = 3.0;
  rt2.entity.x = 3.0;
  rt2.entity.z = 3.0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (room as any).step(33);
  assert.ok(
    Math.hypot(rt2.entity.x - rt1.entity.x, rt2.entity.z - rt1.entity.z) >= ARENA.ENTITY_RADIUS * 2,
    "H-7: Coincident entities must separate cleanly via deterministic fallback normal"
  );

  // Two emerging enemies inside the North Gate alcove (z < -24.25) must NOT teleport out of tunnel
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (room as any).spawnEnemyByKind("legionary", 1.0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (room as any).spawnEnemyByKind("legionary", 1.0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const enemyRts = Array.from((room as any).enemyRuntimes.values()) as EnemyRuntime[];
  const emA = enemyRts[enemyRts.length - 2];
  const emB = enemyRts[enemyRts.length - 1];
  emA.emerging = true;
  emB.emerging = true;
  emA.entity.x = 0;
  emA.entity.z = ARENA.NORTH_GATE.spawnZ;
  emB.entity.x = 0;
  emB.entity.z = ARENA.NORTH_GATE.spawnZ;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (room as any).step(16);
  assert.ok(
    emA.entity.z < -24.5 && emB.entity.z < -24.5,
    `H-7: Emerging enemies must stay in North Alcove during separation (zA=${emA.entity.z}, zB=${emB.entity.z})`
  );
  // Clean up spawned enemies from shared room
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (room as any).enemyRuntimes.clear();
  room.state.enemies.clear();

  // 28. H-11: Null/non-object payload guards and server-authoritative movement input
  for (const badMsg of [null, undefined, "bad", 42] as unknown[]) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (room as any).handleMove(fakeClient1, badMsg);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (room as any).handleAttack(fakeClient1, badMsg);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (room as any).handleSpecial(fakeClient1, badMsg);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (room as any).handleBlock(fakeClient1, badMsg);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (room as any).handleDodge(fakeClient1, badMsg);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (room as any).handleUseItem(fakeClient1, badMsg);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (room as any).handleExperimentalArt(fakeClient1, badMsg);
  }
  rt1.lastMoveSeq = 0;
  rt1.lastMoveAt = Date.now() - 100;
  rt1.moveX = 0;
  rt1.moveZ = 0;
  rt1.entity.x = 0;
  rt1.entity.z = 0;
  rt1.entity.yaw = 0;
  rt1.entity.alive = true;
  rt1.entity.action = "idle";
  rt1.entity.isBlocking = false;
  rt1.entity.staggeredUntil = 0;
  rt1.entity.shockedUntil = 0;
  rt1.activeAttack = null;
  rt1.dodgeUntil = 0;
  rt1.y = 0;
  rt1.grounded = true;
  // Old clients' claimed coordinates and flight flags have no effect.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (room as any).handleMove(fakeClient1, { x: 100000, y: 6, z: 100000, yaw: 0, moving: true, flying: true });
  assert.equal(rt1.lastMoveSeq, 0, "H-11: Position-based movement payloads must be rejected");
  assert.equal(rt1.entity.x, 0, "H-11: Client cannot set an authoritative position");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (room as any).handleMove(fakeClient1, {
    sequence: 1, moveX: 0, moveZ: 2, jumpPressed: false, jumpHeld: false, yaw: Math.PI * 5,
  });
  assert.equal(rt1.lastMoveSeq, 1, "H-11: Valid sequenced movement input must be accepted");
  assert.equal(rt1.moveZ, 1, "H-11: Diagonal/input magnitude is normalized before simulation");
  assert.ok(Math.abs(rt1.entity.yaw - Math.PI) < 1e-8, "H-11: Accepted yaw is normalized");
  const inputStartZ = rt1.entity.z;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (room as any).stepPlayerMotion(rt1, 33, Date.now());
  const inputStep = rt1.entity.z - inputStartZ;
  assert.ok(inputStep > 0 && inputStep <= COMBAT.PLAYER_MOVE_SPEED * 0.033 + 0.001,
    `H-11: Server applies bounded movement from input, got ${inputStep.toFixed(3)}m in one tick`);
  // A duplicate sequence cannot replace the accepted intent.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (room as any).handleMove(fakeClient1, {
    sequence: 1, moveX: 0, moveZ: -1, jumpPressed: false, jumpHeld: false, yaw: 0,
  });
  assert.equal(rt1.moveZ, 1, "H-11: Duplicate input sequence must be ignored");

  // Protocol v2 requires clients to use the server-authoritative input schema.
  const protocolRoom = new ColosseumRoom();
  assert.throws(
    () => protocolRoom.onAuth(fakeClient1, { protocolVersion: GAME_PROTOCOL_VERSION - 1 }),
    /out of date/i,
    "Old clients must receive a clear protocol update error"
  );
  assert.equal(protocolRoom.onAuth(fakeClient1, { protocolVersion: GAME_PROTOCOL_VERSION }), true);

  // Flight is server-driven, spends fuel only while propelling, and stays within its burst radius.
  rt1.entity.x = 0;
  rt1.entity.z = 0;
  rt1.entity.yaw = 0;
  rt1.y = 0;
  rt1.entity.y = 0;
  rt1.grounded = true;
  rt1.velocityX = 0;
  rt1.velocityY = 0;
  rt1.velocityZ = 0;
  rt1.flightFuelMs = FLIGHT.MAX_FUEL_MS;
  rt1.flightOriginX = 0;
  rt1.flightOriginZ = 0;
  rt1.flightUsedThisJump = false;
  rt1.jumpPressed = true;
  rt1.jumpHeld = true;
  rt1.moveX = 0;
  rt1.moveZ = 1;
  rt1.lastMoveAt = Date.now();
  rt1.swiftFeetUntil = 0;
  let maxFlightY = 0;
  let maxFlightDistance = 0;
  let minimumFlightFuel = FLIGHT.MAX_FUEL_MS;
  let simNow = Date.now();
  for (let i = 0; i < 100; i += 1) {
    simNow += 33;
    rt1.lastMoveAt = simNow;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (room as any).stepPlayerMotion(rt1, 33, simNow);
    maxFlightY = Math.max(maxFlightY, rt1.y);
    if (rt1.y > 0) {
      maxFlightDistance = Math.max(maxFlightDistance, Math.hypot(rt1.entity.x, rt1.entity.z));
    }
    if (rt1.isFlying) minimumFlightFuel = Math.min(minimumFlightFuel, rt1.flightFuelMs);
  }
  assert.ok(maxFlightY > 1 && maxFlightY <= FLIGHT.MAX_Y + 1e-6,
    `Flight should ascend within the authoritative height cap, got ${maxFlightY.toFixed(2)}m`);
  assert.ok(minimumFlightFuel < FLIGHT.MAX_FUEL_MS, "Propelled flight must consume server-owned fuel");
  assert.ok(maxFlightDistance <= FLIGHT.MAX_BURST_DISTANCE + 1e-6,
    `Flight movement exceeded its distance cap: ${maxFlightDistance.toFixed(2)}m`);

  // 28b. Rocket-booster momentum preservation: natural apex arc and mid-air horizontal coasting
  rt1.entity.x = 0;
  rt1.entity.z = 0;
  rt1.entity.yaw = 0;
  rt1.y = 0;
  rt1.entity.y = 0;
  rt1.grounded = true;
  rt1.velocityX = 0;
  rt1.velocityY = 0;
  rt1.velocityZ = 0;
  rt1.isFlying = false;
  rt1.flightFuelMs = FLIGHT.MAX_FUEL_MS;
  rt1.flightOriginX = 0;
  rt1.flightOriginZ = 0;
  rt1.flightUsedThisJump = false;
  rt1.jumpPressed = true;
  rt1.jumpHeld = true;
  rt1.moveX = 0;
  rt1.moveZ = 1;
  rt1.swiftFeetUntil = 0;
  rt1.dodgeUntil = 0;
  let reachedAirbornePropel = false;
  for (let i = 0; i < 60; i += 1) {
    simNow += 33;
    rt1.lastMoveAt = simNow;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (room as any).stepPlayerMotion(rt1, 33, simNow);
    rt1.jumpPressed = false;
    if (rt1.y > 1.2 && rt1.velocityY > 2 && Math.hypot(rt1.velocityX, rt1.velocityZ) > 3) {
      reachedAirbornePropel = true;
      break;
    }
  }
  assert.ok(reachedAirbornePropel,
    `Rocket booster should reach airborne propel state (y=${rt1.y.toFixed(2)}, vy=${rt1.velocityY.toFixed(2)})`);
  const releaseVy = rt1.velocityY;
  const releaseSpeed = Math.hypot(rt1.velocityX, rt1.velocityZ);
  assert.ok(releaseVy > 2 && releaseSpeed > 3);

  rt1.jumpPressed = false;
  rt1.jumpHeld = false;
  rt1.moveX = 0;
  rt1.moveZ = 0;
  simNow += 33;
  rt1.lastMoveAt = simNow;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (room as any).stepPlayerMotion(rt1, 33, simNow);
  assert.ok(rt1.velocityY > 0,
    `Upward momentum must be preserved to arc naturally on release, got velocityY=${rt1.velocityY.toFixed(3)}`);

  for (let i = 0; i < 3; i += 1) {
    simNow += 33;
    rt1.lastMoveAt = simNow;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (room as any).stepPlayerMotion(rt1, 33, simNow);
  }
  const coastSpeed = Math.hypot(rt1.velocityX, rt1.velocityZ);
  assert.ok(coastSpeed >= releaseSpeed * 0.75,
    `Air momentum must be preserved while coasting (${coastSpeed.toFixed(3)} < ${(releaseSpeed * 0.75).toFixed(3)})`);

  // 29. H-12: Concurrent roomCode allocation TOCTOU lock & safe onDispose without state
  const concPresence = new LocalPresence();
  const [race1, race2] = await Promise.all([
    allocateUniqueRoomCode(concPresence, "DUEL"),
    allocateUniqueRoomCode(concPresence, "DUEL"),
  ]);
  assert.notEqual(race1, race2, "H-12: Concurrent allocateUniqueRoomCode calls must never return duplicate codes");
  assert.ok(race1 === "DUEL" || race2 === "DUEL");

  const disposeRoom = new ColosseumRoom();
  // Simulate failure after code allocation before setState(state)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (disposeRoom as any).presence = concPresence;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (disposeRoom as any).allocatedRoomCode = race1;
  await disposeRoom.onDispose();
  const reallocated = await allocateUniqueRoomCode(concPresence, race1);
  assert.equal(reallocated, race1, "H-12: onDispose must release allocatedRoomCode even when this.state is unset");
  concPresence.shutdown();

  // 30. M-1 & M-8: Authoritative dodge displacement, handleUseItem busy guards, and full respawn reset
  rt1.entity.x = 0;
  rt1.entity.z = 0;
  rt2.entity.x = 10;
  rt2.entity.z = 10;
  rt1.dodgeUntil = Date.now() + 500;
  rt1.dodgeDirX = 1;
  rt1.dodgeDirZ = 0;
  rt1.lastMoveAt = Date.now(); // Fresh input packet; server still owns dodge movement.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (room as any).step(33);
  assert.ok(rt1.entity.x > 0.2, "M-1: Server must simulate dodge displacement even with fresh input packets");

  // Headless client (stale lastMoveAt >= 80ms) still receives authoritative dodge displacement
  rt1.lastMoveAt = Date.now() - 200;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (room as any).step(33);
  assert.ok(rt1.entity.x > 0.2, "M-1: Headless client without recent move packets still moves during dodge");
  rt1.dodgeUntil = 0;

  // M-8: handleUseItem rejected while activeAttack, dodgeUntil, or hurtUntil
  rt1.belt[0] = { kind: "healing_flask", charges: 1 };
  rt1.entity.hp = 50;
  rt1.activeAttack = { kind: "light1", startedAt: Date.now(), hitIds: new Set() };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (room as any).handleUseItem(fakeClient1, { slotIndex: 0, yaw: 0 });
  assert.equal(rt1.belt[0].charges, 1, "M-8: handleUseItem must reject during activeAttack");
  rt1.activeAttack = null;

  rt1.dodgeUntil = Date.now() + 300;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (room as any).handleUseItem(fakeClient1, { slotIndex: 0, yaw: 0 });
  assert.equal(rt1.belt[0].charges, 1, "M-8: handleUseItem must reject during dodgeUntil");
  rt1.dodgeUntil = 0;

  rt1.entity.hurtUntil = Date.now() + 300;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (room as any).handleUseItem(fakeClient1, { slotIndex: 0, yaw: 0 });
  assert.equal(rt1.belt[0].charges, 1, "M-8: handleUseItem must reject during hurtUntil");
  rt1.entity.hurtUntil = 0;

  // M-8: Respawn resets all transient state including y, dodge, counter, itemAnim, activeAttack
  rt1.entity.alive = false;
  rt1.deadAt = Date.now() - COMBAT.RESPAWN_DELAY_MS - 100;
  rt1.y = 2.5;
  rt1.entity.y = 2.5;
  rt1.dodgeUntil = Date.now() + 500;
  rt1.dodgeCooldownUntil = Date.now() + 1000;
  rt1.entity.dodgeInvulnUntil = Date.now() + 500;
  rt1.counterReadyUntil = Date.now() + 500;
  rt1.itemAnimUntil = Date.now() + 500;
  rt1.activeAttack = { kind: "heavy", startedAt: Date.now(), hitIds: new Set() };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (room as any).step(33);
  assert.equal(rt1.entity.alive, true, "M-8: Dead player past respawn delay must respawn");
  assert.equal(rt1.y, 0);
  assert.equal(rt1.entity.y, 0);
  assert.equal(rt1.dodgeUntil, 0);
  assert.equal(rt1.dodgeCooldownUntil, 0);
  assert.equal(rt1.entity.dodgeInvulnUntil, 0);
  assert.equal(rt1.counterReadyUntil, 0);
  assert.equal(rt1.itemAnimUntil, 0);
  assert.equal(rt1.activeAttack, null);

  // 31. Punch Toss / Knockback physics: airborne elevation sync, arena clamping, wall damping, & landing recovery
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (room as any).spawnEnemyByKind("legionary", 1.0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const punchEnemyRt = Array.from((room as any).enemyRuntimes.values()).at(-1) as EnemyRuntime;
  punchEnemyRt.emerging = false;
  punchEnemyRt.entity.x = 0;
  punchEnemyRt.entity.y = 0;
  punchEnemyRt.entity.z = 1.6;
  rt1.entity.x = 0;
  rt1.entity.y = 0;
  rt1.y = 0;
  rt1.entity.z = 0;
  rt1.entity.yaw = 0; // facing +Z toward enemy
  rt1.activeAttack = null;
  rt1.dodgeUntil = 0;
  rt1.entity.hurtUntil = 0;
  rt1.entity.staggeredUntil = 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (room as any).launchPunchTarget(punchEnemyRt.entity.id, rt1.entity.id, Date.now());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const kbMap = (room as any).knockbacks as Map<string, { vx: number; vy: number; vz: number; y: number }>;
  assert.ok(kbMap.has(punchEnemyRt.entity.id), "Punch must register knockback runtime for target");

  let maxEnemyY = 0;
  for (let i = 0; i < 40; i++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (room as any).step(33);
    const es = room.state.enemies.get(punchEnemyRt.entity.id);
    if (es && es.y > maxEnemyY) maxEnemyY = es.y;
    assert.ok(
      Math.hypot(punchEnemyRt.entity.x, punchEnemyRt.entity.z) <= ARENA.PLAYABLE_RADIUS,
      "Launched enemy must remain clamped inside arena during flight"
    );
  }
  assert.ok(maxEnemyY > 1.5 && maxEnemyY < 3.5, `Expected readable punch arc apex ~2.2m, got ${maxEnemyY.toFixed(2)}m`);
  assert.equal(kbMap.has(punchEnemyRt.entity.id), false, "Launched enemy must complete flight and land");
  assert.equal(punchEnemyRt.entity.y, 0, "Landed enemy y must reset cleanly to 0");
  assert.ok(
    punchEnemyRt.entity.z > 6.0 && punchEnemyRt.entity.z < 12.0,
    `Expected weighty horizontal toss ~7-9m from z=1.6, landed at z=${punchEnemyRt.entity.z.toFixed(2)}`
  );

  // 32. New Boss Archetypes (Iron Dread Knight & Crimson Wyvern), Staged Waves & Deflect/Posture Mechanics
  const newBossKinds: EnemyKind[] = ["dread_knight", "dragon"];
  for (const kind of newBossKinds) {
    const spec = ENEMY_ARCHETYPES[kind];
    assert.ok(spec, `Missing ENEMY_ARCHETYPES entry for ${kind}`);
    assert.equal(spec.isBoss, true, `${kind} must be flagged isBoss`);
    assert.ok(spec.modelFile.startsWith("/assets/enemies/") && spec.modelFile.endsWith(".glb"));
    assert.ok(ATTACK_SPECS[spec.primaryAttack], `${kind} primaryAttack must exist`);
    assert.ok(ATTACK_SPECS[spec.heavyAttack], `${kind} heavyAttack must exist`);
  }
  assert.ok(ATTACK_SPECS.enemy_dive_lunge, "Dragon mid-range enemy_dive_lunge must exist in ATTACK_SPECS");

  // Verify staged waves introduce Dread Knight (Wave 3), Dragon (Wave 5), and rotating multi-boss spectacles (Wave 6-8)
  assert.ok(getWavePlan(3).enemies.includes("dread_knight"), "Wave 3 must feature Iron Dread Knight boss");
  assert.ok(getWavePlan(5).enemies.includes("dragon"), "Wave 5 must feature Crimson Wyvern boss");
  assert.ok(
    getWavePlan(6).enemies.includes("champion") && getWavePlan(6).enemies.includes("dread_knight"),
    "Wave 6 must feature Twin Titans (Champion + Dread Knight)"
  );
  assert.ok(
    getWavePlan(7).enemies.includes("dragon") && getWavePlan(7).enemies.includes("dread_knight"),
    "Wave 7 must feature Ashen Sky (Dragon + Dread Knight)"
  );
  assert.ok(
    getWavePlan(8).enemies.includes("champion") && getWavePlan(8).enemies.includes("dragon"),
    "Wave 8 must feature Imperial Pantheon (Champion + Dragon)"
  );

  // Dread Knight 3rd swing selects 360° enemy_shockwave_slam & can be Perfect-Deflected
  const dreadRt = makeEnemyRuntime("dread_knight", 0, 0, 20000);
  dreadRt.attackCounter = 2;
  const dreadTarget = makeEntity({ id: "dk_p", x: 0, z: 3.2, yaw: Math.PI, action: "idle" });
  const dkStep = stepSkeletonAI(dreadRt, [dreadTarget], [dreadRt], 20000, 0.033);
  assert.equal(dreadRt.activeAttack?.kind, "enemy_shockwave_slam", "Dread Knight 3rd swing must select enemy_shockwave_slam");
  assert.equal(dkStep.telegraph, "heavy");

  const deflectPlayer = makeEntity({
    id: "def_p",
    x: 0,
    z: 4.1,
    yaw: Math.PI,
    isBlocking: true,
    blockStartedAt: 20800,
  });
  const dkSlamAtk: AttackRuntime = { kind: "enemy_shockwave_slam", startedAt: 20000, hitIds: new Set() };
  const dkDeflectEvents = resolveMeleeSwing(
    dreadRt.entity,
    dkSlamAtk,
    [dreadRt.entity, deflectPlayer],
    20000 + ATTACK_SPECS.enemy_shockwave_slam.windupMs + 60
  );
  assert.equal(dkDeflectEvents[0]?.kind, "deflect", "Timed guard must Perfect-Deflect Dread Knight shockwave slam");
  assert.equal(deflectPlayer.hp, 100, "Perfect deflect of shockwave slam deals 0 HP");
  assert.equal(dreadRt.entity.posture, ATTACK_SPECS.enemy_shockwave_slam.deflectAttackerPosture);

  // Crimson Wyvern mid-range dive lunge, close-range 360° tail whip, and fire breath cone
  const dragonRt = makeEnemyRuntime("dragon", 0, 0, 22000);
  const farPlayer = makeEntity({ id: "dr_far", x: 0, z: 5.5, yaw: Math.PI, action: "idle" });
  const drDive = stepSkeletonAI(dragonRt, [farPlayer], [dragonRt], 22000, 0.033);
  assert.equal(dragonRt.activeAttack?.kind, "enemy_dive_lunge", "Dragon at 5.5m must launch enemy_dive_lunge");
  assert.equal(drDive.telegraph, "heavy");

  dragonRt.activeAttack = null;
  dragonRt.nextDecisionAt = 23000;
  const closePlayer = makeEntity({ id: "dr_close", x: 0, z: 2.5, yaw: Math.PI, action: "idle" });
  stepSkeletonAI(dragonRt, [closePlayer], [dragonRt], 23000, 0.033);
  assert.equal(dragonRt.activeAttack?.kind, "enemy_tail_whip", "Dragon at 2.5m must unleash 360° enemy_tail_whip");

  const fireBreathAtk: AttackRuntime = { kind: "enemy_fire_breath", startedAt: 24000, hitIds: new Set() };
  const breathTarget = makeEntity({ id: "dr_burn", x: 0, z: 5.6, yaw: Math.PI });
  const breathEvents = resolveMeleeSwing(
    dragonRt.entity,
    fireBreathAtk,
    [dragonRt.entity, breathTarget],
    24000 + ATTACK_SPECS.enemy_fire_breath.windupMs + 60
  );
  assert.equal(breathEvents[0]?.kind, "hit", "Dragon fire breath must hit unguarded target at 5.6m");
  assert.equal(breathTarget.hp, 100 - ATTACK_SPECS.enemy_fire_breath.hpDamage);

  // Clean up spawned test enemy
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (room as any).enemyRuntimes.clear();
  room.state.enemies.clear();

  // 33. Regression: No pinch-wedge trap behind North Gate Lever + idempotent clampToArena
  const leverX = ARENA.NORTH_GATE.leverX;
  const leverZ = ARENA.NORTH_GATE.leverZ;
  const leverHalf = 0.45;
  const leverProbePoints = [
    [leverX, leverZ],
    [leverX, leverZ - 0.85],
    [leverX + 0.35, leverZ - 0.9],
    [leverX - 0.35, leverZ - 0.9],
  ] as const;
  for (const [px, pz] of leverProbePoints) {
    const c1Pos = clampToArena(px, pz, ARENA.ENTITY_RADIUS);
    const c2Pos = clampToArena(c1Pos.x, c1Pos.z, ARENA.ENTITY_RADIUS);
    const leverDist = distanceToSquareAABB(c1Pos.x, c1Pos.z, leverX, leverZ, leverHalf);
    assert.ok(
      Math.hypot(c1Pos.x, c1Pos.z) <= ARENA.PLAYABLE_RADIUS - ARENA.ENTITY_RADIUS + 1e-5,
      `clampToArena(${px}, ${pz}) must stay within playable wall radius`
    );
    assert.ok(
      leverDist >= ARENA.ENTITY_RADIUS - 1e-4,
      `clampToArena(${px}, ${pz}) must clear lever pedestal without wall pinch-back, got leverDist=${leverDist.toFixed(4)}`
    );
    assert.ok(
      Math.hypot(c2Pos.x - c1Pos.x, c2Pos.z - c1Pos.z) < 1e-4,
      `clampToArena must be idempotent near lever/wall corner, drifted ${Math.hypot(c2Pos.x - c1Pos.x, c2Pos.z - c1Pos.z)}`
    );
  }

  // 34. Regression: Curved Colosseum wall tangential sliding preserves velocity instead of zeroing both axes
  const maxPlayR = ARENA.PLAYABLE_RADIUS - ARENA.ENTITY_RADIUS;
  const diag = maxPlayR * Math.SQRT1_2;
  rt1.entity.x = diag;
  rt1.entity.z = diag;
  rt1.velocityX = COMBAT.PLAYER_MOVE_SPEED;
  rt1.velocityZ = 0;
  rt1.moveX = 1;
  rt1.moveZ = 0;
  rt1.jumpPressed = false;
  rt1.jumpHeld = false;
  rt1.grounded = true;
  rt1.y = 0;
  rt1.entity.y = 0;
  rt1.lastMoveAt = Date.now();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (room as any).stepPlayerMotion(rt1, 33, Date.now());
  const postWallSpeed = Math.hypot(rt1.velocityX, rt1.velocityZ);
  assert.ok(
    postWallSpeed > COMBAT.PLAYER_MOVE_SPEED * 0.45,
    `Sliding along curved Colosseum wall at 45° must preserve tangential speed instead of zeroing velocity, got ${postWallSpeed.toFixed(2)}`
  );

  // 35. Regression: Dodging player can dash past body-blocking enemies instead of being pushed back into corner
  rt1.entity.x = 0;
  rt1.entity.z = -24.5;
  rt1.y = 0;
  rt1.entity.y = 0;
  rt2.entity.x = 12;
  rt2.entity.z = 12;
  // Spawn an enemy directly in front of the cornered player at (0, -23.7)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (room as any).spawnEnemyByKind("legionary", 1.0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const blockerRt = Array.from((room as any).enemyRuntimes.values()).at(-1) as EnemyRuntime;
  blockerRt.emerging = false;
  blockerRt.nextDecisionAt = Date.now() + 5000;
  blockerRt.entity.x = 0;
  blockerRt.entity.z = -23.7;
  // Trigger dodge +Z through the blocker
  rt1.dodgeCooldownUntil = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (room as any).handleDodge(fakeClient1, { dirX: 0, dirZ: 1, yaw: 0 });
  for (let i = 0; i < 6; i++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (room as any).step(33);
  }
  assert.ok(
    rt1.entity.z > -23.2,
    `Dodging player must phase cleanly past cornering enemy instead of staying trapped at z=-24.5, got z=${rt1.entity.z.toFixed(2)}`
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (room as any).enemyRuntimes.clear();
  room.state.enemies.clear();

  // 36. Regression: Rapid Wi-Fi / mobile move packet bursts (< 8ms apart) are accepted in sequence
  const burstSeqBase = rt1.lastMoveSeq + 10;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (room as any).handleMove(fakeClient1, {
    sequence: burstSeqBase,
    moveX: 0,
    moveZ: 1,
    jumpPressed: false,
    jumpHeld: false,
    yaw: 0,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (room as any).handleMove(fakeClient1, {
    sequence: burstSeqBase + 1,
    moveX: 1,
    moveZ: 0,
    jumpPressed: false,
    jumpHeld: false,
    yaw: 0,
  });
  assert.equal(
    rt1.lastMoveSeq,
    burstSeqBase + 1,
    "Consecutive move packets arriving < 8ms apart must both be accepted"
  );
  assert.equal(rt1.moveX, 1, "Second burst packet input must take effect");

  // 37. Regression: Mid-air stagger landing at y=0 resets grounded & flightUsedThisJump
  rt1.y = 0.2;
  rt1.entity.y = 0.2;
  rt1.velocityY = -12;
  rt1.grounded = false;
  rt1.isFlying = false;
  rt1.flightUsedThisJump = true;
  rt1.entity.staggeredUntil = Date.now() + 1000;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (room as any).stepPlayerMotion(rt1, 33, Date.now());
  assert.equal(rt1.y, 0);
  assert.equal(rt1.grounded, true, "Landing during stagger must reset grounded=true");
  assert.equal(rt1.flightUsedThisJump, false, "Landing during stagger must clear flightUsedThisJump");
  rt1.entity.staggeredUntil = 0;

  console.log("ALL 37 COMBAT, BOSS, PUNCH KNOCKBACK, ARCHETYPE, WAVE, AI, PILUM 3D, 14-ART & BUGFIX UNIT TESTS PASSED");
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
