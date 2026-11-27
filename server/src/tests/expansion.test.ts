import assert from "node:assert/strict";
import {
  BOSS_RUSH_TRIALS,
  ENEMY_ARCHETYPES,
  FFA_CONFIG,
  PLAYER_ABILITIES,
  PLAYER_SKINS,
  type EnemyKind,
} from "@sekiroslop/shared";
import { resolveProjectileHit, type CombatEntity } from "../combat/CombatEngine.js";
import { stepSkeletonAI, type EnemyRuntime } from "../ai/SkeletonAI.js";

function makeEntity(overrides: Partial<CombatEntity> = {}): CombatEntity {
  return {
    id: "ent_1",
    name: "Tester",
    isPlayer: true,
    x: 0,
    y: 0,
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

// 1. Verify zero modelFile reuse across all 6 player skins and 11 enemies
const skinModels = Object.values(PLAYER_SKINS).map((s) => s.modelFile);
assert.equal(skinModels.length, 6, "Expected 6 player skins");
assert.equal(new Set(skinModels).size, 6, "Every player skin must use a unique .glb");

const enemyModels = Object.values(ENEMY_ARCHETYPES).map((e) => e.modelFile);
assert.equal(enemyModels.length, 11, "Expected 11 enemy & boss archetypes");
assert.equal(new Set(enemyModels).size, 11, "Every enemy & boss must use a unique .glb");

// 2. Verify Stun-Gun projectile stun + Perfect-Deflect reflection
const now = 10000;
const caster = makeEntity({ id: "p1", x: 0, z: 0 });
const victim = makeEntity({ id: "p2", x: 0, z: 8, yaw: Math.PI });

const stunHit = resolveProjectileHit(
  caster,
  victim,
  0,
  1.3,
  8,
  0,
  PLAYER_ABILITIES.stun_gun.speed,
  now,
  { kind: "stun_bolt", hpDamage: 18, postureDamage: 30, stunMs: 950 },
  "p1"
);
assert.equal(stunHit.reflected, false);
assert.ok((victim.shockedUntil ?? 0) >= now + 900, "Stun bolt must apply shockedUntil stun");
assert.equal(victim.action, "shocked");

const deflectingTarget = makeEntity({
  id: "p3",
  x: 0,
  z: 8,
  yaw: Math.PI, // Facing incoming +Z fireball
  isBlocking: true,
  blockStartedAt: now - 100,
});
const reflectedHit = resolveProjectileHit(
  caster,
  deflectingTarget,
  0,
  1.3,
  8,
  0,
  22,
  now,
  { kind: "fireball", hpDamage: 38, postureDamage: 42 },
  "p1"
);
assert.equal(reflectedHit.reflected, true, "Perfect Deflect must reflect incoming projectiles");
assert.ok(reflectedHit.events.some((e) => e.kind === "projectile_reflect"));

// 3. Verify new enemy AI archetypes (pyromancer fireball, stun_drone hover, mist_shinobi teleport)
function makeAi(kind: EnemyKind, x: number, z: number): EnemyRuntime {
  const spec = ENEMY_ARCHETYPES[kind];
  return {
    entity: makeEntity({
      id: `ai_${kind}`,
      name: spec.name,
      isPlayer: false,
      x,
      z,
      hp: spec.maxHp,
      maxHp: spec.maxHp,
      maxPosture: spec.maxPosture,
    }),
    kind,
    activeAttack: null,
    nextDecisionAt: 0,
    strafeDir: 1,
    emerging: false,
    deadAt: 0,
    attackCounter: 0,
    blockUntil: 0,
    blockCooldownUntil: 0,
  };
}

const playerTarget = makeEntity({ id: "hero", x: 0, z: 10, yaw: 0 });
const pyro = makeAi("pyromancer", 0, 0);
const pyroStep1 = stepSkeletonAI(pyro, [playerTarget], [pyro], now, 0.033);
assert.equal(pyroStep1.attackKind, "enemy_fireball");
const pyroStep2 = stepSkeletonAI(pyro, [playerTarget], [pyro], now + 660, 0.033);
assert.equal(pyroStep2.spawnedProjectiles.length, 1);
assert.equal(pyroStep2.spawnedProjectiles[0].kind, "fireball");

const drone = makeAi("stun_drone", 0, 0);
stepSkeletonAI(drone, [playerTarget], [drone], now, 0.033);
assert.equal(drone.entity.y, 1.55, "Stun drone must hover at y=1.55m");

const tengu = makeAi("mist_shinobi", 0, 0);
const tenguStep = stepSkeletonAI(tengu, [playerTarget], [tengu], now, 0.033);
assert.ok(tenguStep.events.some((e) => e.kind === "shadow_step"), "Tengu Reaper must use shadow-step teleport");

// 4. Verify Boss Rush & FFA config
assert.equal(BOSS_RUSH_TRIALS.length, 5);
assert.equal(FFA_CONFIG.TARGET_SCORE, 10);

console.log("✅ All SekiroSlop expansion unit tests passed!");
