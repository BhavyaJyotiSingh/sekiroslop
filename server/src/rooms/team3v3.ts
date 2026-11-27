import {
  ATTACK_SPECS,
  COMBAT,
  ENEMY_ARCHETYPES,
  POWER_UPS,
  clampToArena,
  forwardFromYaw,
  yawFromDelta,
  type AttackKind,
  type CombatArtKind,
  type CombatEventPayload,
  type EnemyKind,
  type PowerUpKind,
  type TeamSide,
} from "@sekiroslop/shared";
import {
  isAttackFinished,
  resolveMeleeSwing,
  updatePostureDecay,
  type AttackRuntime,
  type CombatEntity,
} from "../combat/CombatEngine.js";
import { ColosseumState, EnemyState, type PickupState } from "../schema/ColosseumState.js";

export const TEAM_3V3_SIZE = 3;
export const TEAM_3V3_MAX_ROUNDS = 5;
export const TEAM_3V3_WINS_TO_CLINCH = 3;
export const TEAM_3V3_INTERMISSION_MS = 3500;

export const ALL_COMBAT_ART_KINDS: readonly CombatArtKind[] = [
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

export function pickRandomCombatArt(rng: () => number = Math.random): CombatArtKind {
  const idx = Math.floor(rng() * ALL_COMBAT_ART_KINDS.length) % ALL_COMBAT_ART_KINDS.length;
  return ALL_COMBAT_ART_KINDS[idx];
}

interface SpawnPoint {
  x: number;
  z: number;
  yaw: number;
}

const RED_SPAWNS: readonly SpawnPoint[] = [
  { x: -14.5, z: 4.5, yaw: Math.PI * 0.42 },
  { x: -16.0, z: 0.0, yaw: Math.PI * 0.5 },
  { x: -14.5, z: -4.5, yaw: Math.PI * 0.58 },
];

const BLUE_SPAWNS: readonly SpawnPoint[] = [
  { x: 14.5, z: -4.5, yaw: -Math.PI * 0.58 },
  { x: 16.0, z: 0.0, yaw: -Math.PI * 0.5 },
  { x: 14.5, z: 4.5, yaw: -Math.PI * 0.42 },
];

const RED_BOT_NAMES = ["Crixus [AI]", "Spartacus [AI]", "Oenomaus [AI]"] as const;
const BLUE_BOT_NAMES = ["Tiberius [AI]", "Scipio [AI]", "Aurelius [AI]"] as const;
const BOT_ARCHETYPES: readonly EnemyKind[] = ["legionary", "assassin", "skirmisher"] as const;

const ATTACKING_ACTIONS = new Set<string>([
  "light1",
  "light2",
  "heavy",
  "thrust",
  "whirlwind",
  "aerial_slam",
  "counter",
  "punch",
  "windup_light",
  "windup_heavy",
  "attack_light",
  "attack_heavy",
]);

export interface TeamBotRuntime {
  entity: CombatEntity;
  kind: EnemyKind;
  team: TeamSide;
  combatArt: CombatArtKind;
  combatArtReadyAt: number;
  activeAttack: AttackRuntime | null;
  nextDecisionAt: number;
  strafeDir: number;
  deadAt: number;
  attackCounter: number;
  blockUntil: number;
  blockCooldownUntil: number;
  dodgeUntil: number;
  dodgeCooldownUntil: number;
  dodgeDirX: number;
  dodgeDirZ: number;
  furyUntil: number;
  ironWillUntil: number;
  swiftFeetUntil: number;
  tonicUntil: number;
}

export interface Team3v3Host {
  state: ColosseumState;
  getHumanPlayers: () => Array<{ id: string; entity: CombatEntity }>;
  resetPlayerForRound: (
    playerId: string,
    x: number,
    z: number,
    yaw: number,
    team: TeamSide
  ) => void;
  setPlayerTeam: (playerId: string, team: TeamSide | "") => void;
  resetMatchPlayerStats: () => void;
  clearTransientCombatState: () => void;
  refreshArenaPickups: (count: number) => void;
  broadcastCombatEvent: (payload: CombatEventPayload) => void;
  castBotCombatArt: (bot: TeamBotRuntime, now: number) => void;
  isKnockedBack: (entityId: string) => boolean;
  stepKnockback: (entity: CombatEntity, now: number, dtSec: number) => boolean;
  clearKnockback: (entityId: string) => void;
  onBotKilled?: (bot: TeamBotRuntime, killer: CombatEntity) => void;
}

export class Team3v3Controller {
  readonly bots = new Map<string, TeamBotRuntime>();
  private nextBotSeq = 1;
  private nextRoundAt = 0;

  constructor(private readonly host: Team3v3Host) {}

  get is3v3Mode(): boolean {
    return this.host.state.gameMode === "team_3v3";
  }

  getBotEntity(id: string): CombatEntity | undefined {
    return this.bots.get(id)?.entity;
  }

  getBotEntities(): CombatEntity[] {
    const out: CombatEntity[] = [];
    this.bots.forEach((b) => out.push(b.entity));
    return out;
  }

  setGameMode(clientId: string, mode: "waves" | "team_3v3" | "boss_rush" | "ffa"): boolean {
    const { state } = this.host;
    if (clientId !== state.hostSessionId) return false;
    if (mode !== "waves" && mode !== "team_3v3" && mode !== "boss_rush" && mode !== "ffa") return false;

    state.gameMode = mode;
    this.clearBots();
    this.host.clearTransientCombatState();
    state.wave = 0;
    state.waveActive = false;
    state.teamMatchActive = false;
    state.teamRoundActive = false;
    state.teamRound = 0;
    state.teamMaxRounds = TEAM_3V3_MAX_ROUNDS;
    state.teamRedScore = 0;
    state.teamBlueScore = 0;
    state.teamRoundWinner = "";
    state.teamMatchWinner = "";
    state.teamIntermissionMs = 0;
    state.bossTrial = 0;
    state.bossTrialTitle = "";
    state.ffaZoneOwnerId = "";
    state.ffaZoneProgress = 0;
    state.ffaWinnerName = "";

    if (mode === "team_3v3") {
      this.autoBalanceAllPlayers();
    } else {
      for (const { id } of this.host.getHumanPlayers()) {
        this.host.setPlayerTeam(id, "");
      }
    }
    return true;
  }

  setFillBots(clientId: string, enabled: boolean): boolean {
    const { state } = this.host;
    if (clientId !== state.hostSessionId) return false;
    if (state.teamMatchActive) return false;
    state.teamFillBots = Boolean(enabled);
    return true;
  }

  assignPlayerOnJoin(playerId: string): TeamSide | "" {
    if (!this.is3v3Mode) return "";
    const redCount = this.countHumansOnTeam("red", playerId);
    const blueCount = this.countHumansOnTeam("blue", playerId);
    let chosen: TeamSide;
    if (redCount <= blueCount && redCount < TEAM_3V3_SIZE) {
      chosen = "red";
    } else if (blueCount < TEAM_3V3_SIZE) {
      chosen = "blue";
    } else {
      chosen = "red";
    }
    this.host.setPlayerTeam(playerId, chosen);
    return chosen;
  }

  joinTeam(playerId: string, team: TeamSide): boolean {
    const { state } = this.host;
    if (state.gameMode !== "team_3v3") return false;
    if (state.teamMatchActive) return false;
    if (team !== "red" && team !== "blue") return false;
    const count = this.countHumansOnTeam(team, playerId);
    if (count >= TEAM_3V3_SIZE) return false;
    this.host.setPlayerTeam(playerId, team);
    return true;
  }

  startMatch(clientId: string, now: number = Date.now()): boolean {
    const { state } = this.host;
    if (clientId !== state.hostSessionId) return false;
    if (state.gameMode !== "team_3v3") return false;
    if (state.teamMatchActive) return false;
    if (this.host.getHumanPlayers().length === 0) return false;

    state.teamRedScore = 0;
    state.teamBlueScore = 0;
    state.teamRound = 0;
    state.teamMaxRounds = TEAM_3V3_MAX_ROUNDS;
    state.teamRoundWinner = "";
    state.teamMatchWinner = "";
    state.teamIntermissionMs = 0;
    state.teamMatchActive = true;
    this.host.resetMatchPlayerStats();

    this.startNextRound(now);
    return true;
  }

  rematch(clientId: string, now: number = Date.now()): boolean {
    const { state } = this.host;
    if (clientId !== state.hostSessionId) return false;
    if (state.gameMode !== "team_3v3") return false;
    if (state.teamMatchActive) return false;
    return this.startMatch(clientId, now);
  }

  clearBots(): void {
    this.bots.forEach((_, id) => {
      this.host.state.enemies.delete(id);
      this.host.clearKnockback(id);
    });
    this.bots.clear();
  }

  startNextRound(now: number = Date.now()): void {
    const { state } = this.host;
    this.clearBots();
    this.host.clearTransientCombatState();

    state.teamRound += 1;
    state.teamRoundActive = true;
    state.teamRoundWinner = "";
    state.teamIntermissionMs = 0;

    // Partition humans by team (auto-assign any unassigned human)
    const redHumans: string[] = [];
    const blueHumans: string[] = [];
    for (const { id } of this.host.getHumanPlayers()) {
      const ps = state.players.get(id);
      let t = (ps?.team === "red" || ps?.team === "blue" ? ps.team : "") as TeamSide | "";
      if (!t) {
        t = redHumans.length <= blueHumans.length ? "red" : "blue";
        this.host.setPlayerTeam(id, t);
      }
      if (t === "red" && redHumans.length < TEAM_3V3_SIZE) {
        redHumans.push(id);
      } else if (t === "blue" && blueHumans.length < TEAM_3V3_SIZE) {
        blueHumans.push(id);
      } else if (redHumans.length < TEAM_3V3_SIZE) {
        this.host.setPlayerTeam(id, "red");
        redHumans.push(id);
      } else {
        this.host.setPlayerTeam(id, "blue");
        blueHumans.push(id);
      }
    }

    redHumans.forEach((id, idx) => {
      const sp = RED_SPAWNS[idx % RED_SPAWNS.length];
      this.host.resetPlayerForRound(id, sp.x, sp.z, sp.yaw, "red");
    });
    blueHumans.forEach((id, idx) => {
      const sp = BLUE_SPAWNS[idx % BLUE_SPAWNS.length];
      this.host.resetPlayerForRound(id, sp.x, sp.z, sp.yaw, "blue");
    });

    if (state.teamFillBots) {
      for (let i = redHumans.length; i < TEAM_3V3_SIZE; i++) {
        this.spawnBot("red", i, now);
      }
      for (let i = blueHumans.length; i < TEAM_3V3_SIZE; i++) {
        this.spawnBot("blue", i, now);
      }
    }

    this.host.refreshArenaPickups(3);

    this.host.broadcastCombatEvent({
      kind: "round_start",
      x: 0,
      y: 2.0,
      z: 0,
      round: state.teamRound,
      maxRounds: state.teamMaxRounds,
      redScore: state.teamRedScore,
      blueScore: state.teamBlueScore,
    });
  }

  private spawnBot(team: TeamSide, slotIdx: number, now: number): TeamBotRuntime {
    const id = `bot_${team}_${this.nextBotSeq++}`;
    const sp = team === "red" ? RED_SPAWNS[slotIdx % RED_SPAWNS.length] : BLUE_SPAWNS[slotIdx % BLUE_SPAWNS.length];
    const name =
      team === "red"
        ? RED_BOT_NAMES[slotIdx % RED_BOT_NAMES.length]
        : BLUE_BOT_NAMES[slotIdx % BLUE_BOT_NAMES.length];
    const kind = BOT_ARCHETYPES[slotIdx % BOT_ARCHETYPES.length];
    const combatArt = pickRandomCombatArt();

    const es = new EnemyState();
    es.id = id;
    es.kind = kind;
    es.name = name;
    es.x = sp.x;
    es.y = 0;
    es.z = sp.z;
    es.yaw = sp.yaw;
    es.hp = COMBAT.PLAYER_MAX_HP;
    es.maxHp = COMBAT.PLAYER_MAX_HP;
    es.posture = 0;
    es.maxPosture = COMBAT.PLAYER_MAX_POSTURE;
    es.action = "idle";
    es.telegraph = "none";
    es.isBlocking = false;
    es.alive = true;
    es.team = team;
    es.combatArt = combatArt;
    es.isBot = true;
    this.host.state.enemies.set(id, es);

    const bot: TeamBotRuntime = {
      entity: {
        id,
        name,
        isPlayer: false,
        team,
        x: sp.x,
        y: 0,
        z: sp.z,
        yaw: sp.yaw,
        hp: COMBAT.PLAYER_MAX_HP,
        maxHp: COMBAT.PLAYER_MAX_HP,
        posture: 0,
        maxPosture: COMBAT.PLAYER_MAX_POSTURE,
        alive: true,
        isBlocking: false,
        blockStartedAt: 0,
        dodgeInvulnUntil: 0,
        staggeredUntil: 0,
        hurtUntil: 0,
        lastPostureHitAt: 0,
        action: "idle",
        onKilled: (killer) => {
          bot.deadAt = Date.now();
          if (killer.isPlayer) {
            const ks = this.host.state.players.get(killer.id);
            if (ks) ks.kills += 1;
          }
          this.host.onBotKilled?.(bot, killer);
        },
      },
      kind,
      team,
      combatArt,
      combatArtReadyAt: now + 4500 + Math.random() * 3500,
      activeAttack: null,
      nextDecisionAt: now + 500 + Math.random() * 400,
      strafeDir: Math.random() < 0.5 ? -1 : 1,
      deadAt: 0,
      attackCounter: 0,
      blockUntil: 0,
      blockCooldownUntil: 0,
      dodgeUntil: 0,
      dodgeCooldownUntil: 0,
      dodgeDirX: 0,
      dodgeDirZ: 1,
      furyUntil: 0,
      ironWillUntil: 0,
      swiftFeetUntil: 0,
      tonicUntil: 0,
    };

    this.bots.set(id, bot);
    return bot;
  }

  step(now: number, dtSec: number, allCombatEntities: CombatEntity[]): void {
    const { state } = this.host;
    if (state.gameMode !== "team_3v3") return;

    // 1. Update bot buff multipliers & AI
    this.bots.forEach((bot, id) => {
      const es = state.enemies.get(id);
      if (!es) return;

      bot.entity.damageOutMult = now < bot.furyUntil ? COMBAT.FURY_DAMAGE_MULT : 1.0;
      bot.entity.postureOutMult = now < bot.furyUntil ? COMBAT.FURY_POSTURE_MULT : 1.0;
      bot.entity.damageInMult = now < bot.ironWillUntil ? COMBAT.IRON_WILL_DAMAGE_MULT : 1.0;
      bot.entity.postureRecoveryMult = now < bot.tonicUntil ? 2.4 : 1.0;

      if (!bot.entity.alive) {
        this.host.clearKnockback(id);
        es.alive = false;
        es.action = "dead";
        es.telegraph = "none";
        es.isBlocking = false;
        return;
      }

      if (this.host.isKnockedBack(id)) {
        const stillFlying = this.host.stepKnockback(bot.entity, now, dtSec);
        if (stillFlying) {
          bot.activeAttack = null;
          bot.entity.isBlocking = false;
          this.syncBotSchema(bot, es, "none");
          return;
        }
      }

      if (!state.teamRoundActive) {
        bot.entity.action = "idle";
        bot.entity.isBlocking = false;
        this.syncBotSchema(bot, es, "none");
        return;
      }

      const telegraph = this.stepBotAI(bot, allCombatEntities, now, dtSec);
      this.syncBotSchema(bot, es, telegraph);
    });

    // 2. Round completion & intermission flow
    if (state.teamRoundActive) {
      let redAlive = 0;
      let blueAlive = 0;

      for (const { entity } of this.host.getHumanPlayers()) {
        if (!entity.alive) continue;
        if (entity.team === "red") redAlive++;
        else if (entity.team === "blue") blueAlive++;
      }
      this.bots.forEach((b) => {
        if (!b.entity.alive) return;
        if (b.team === "red") redAlive++;
        else if (b.team === "blue") blueAlive++;
      });

      if (redAlive === 0 || blueAlive === 0) {
        state.teamRoundActive = false;
        const winner: TeamSide | "draw" =
          redAlive > 0 ? "red" : blueAlive > 0 ? "blue" : "draw";
        state.teamRoundWinner = winner;
        if (winner === "red") state.teamRedScore += 1;
        else if (winner === "blue") state.teamBlueScore += 1;

        this.host.broadcastCombatEvent({
          kind: "round_end",
          x: 0,
          y: 2.0,
          z: 0,
          round: state.teamRound,
          maxRounds: state.teamMaxRounds,
          teamWinner: winner,
          redScore: state.teamRedScore,
          blueScore: state.teamBlueScore,
        });

        const matchOver =
          state.teamRedScore >= TEAM_3V3_WINS_TO_CLINCH ||
          state.teamBlueScore >= TEAM_3V3_WINS_TO_CLINCH ||
          state.teamRound >= state.teamMaxRounds;

        if (matchOver) {
          const matchWinner: TeamSide | "draw" =
            state.teamRedScore > state.teamBlueScore
              ? "red"
              : state.teamBlueScore > state.teamRedScore
                ? "blue"
                : "draw";
          state.teamMatchWinner = matchWinner;
          state.teamMatchActive = false;
          state.teamIntermissionMs = 0;
          this.host.broadcastCombatEvent({
            kind: "match_end",
            x: 0,
            y: 2.2,
            z: 0,
            round: state.teamRound,
            maxRounds: state.teamMaxRounds,
            teamWinner: matchWinner,
            redScore: state.teamRedScore,
            blueScore: state.teamBlueScore,
          });
        } else {
          this.nextRoundAt = now + TEAM_3V3_INTERMISSION_MS;
          state.teamIntermissionMs = TEAM_3V3_INTERMISSION_MS;
        }
      }
    } else if (state.teamMatchActive) {
      const remaining = Math.max(0, this.nextRoundAt - now);
      state.teamIntermissionMs = remaining;
      if (remaining <= 0) {
        this.startNextRound(now);
      }
    }
  }

  private stepBotAI(
    bot: TeamBotRuntime,
    allEntities: CombatEntity[],
    now: number,
    dtSec: number
  ): "none" | "light" | "heavy" {
    const self = bot.entity;
    const archetype = ENEMY_ARCHETYPES[bot.kind] ?? ENEMY_ARCHETYPES.legionary;
    const swiftMult = now < bot.swiftFeetUntil ? COMBAT.SWIFT_FEET_SPEED_MULT : 1.0;
    const moveSpeed = archetype.moveSpeed * swiftMult;

    updatePostureDecay(self, now, dtSec);

    // 1. Staggered
    if (now < self.staggeredUntil) {
      self.action = "staggered";
      self.isBlocking = false;
      bot.activeAttack = null;
      bot.blockUntil = 0;
      return "none";
    } else if (self.action === "staggered") {
      self.posture = 0;
      self.action = "idle";
    }

    // 2. Hurt stun
    if (now < self.hurtUntil && (!bot.activeAttack || bot.activeAttack.kind === "enemy_fast")) {
      self.action = "hurt";
      self.isBlocking = false;
      bot.activeAttack = null;
      return "none";
    }

    // 3. Collect nearby arena powerup if within collect radius
    this.tryBotCollectPickups(bot, now);

    // 4. Dodge movement
    if (now < bot.dodgeUntil) {
      self.action = "dodge";
      self.isBlocking = false;
      const stepDist = COMBAT.PLAYER_DODGE_SPEED * 0.42 * swiftMult * dtSec;
      const clamped = clampToArena(
        self.x + bot.dodgeDirX * stepDist,
        self.z + bot.dodgeDirZ * stepDist
      );
      self.x = clamped.x;
      self.z = clamped.z;
      return "none";
    }

    // Build list of opposing-team living targets
    const opposingTargets: CombatEntity[] = [];
    for (const e of allEntities) {
      if (!e.alive || e.id === self.id) continue;
      if (e.team && e.team === bot.team) continue;
      opposingTargets.push(e);
    }

    // 5. Active melee attack progression
    if (bot.activeAttack) {
      self.isBlocking = false;
      const atk = bot.activeAttack;
      const spec = ATTACK_SPECS[atk.kind];
      const elapsed = now - atk.startedAt;
      const heavy = atk.kind === "enemy_heavy" || atk.kind === "enemy_lunge";

      if (isAttackFinished(atk, now)) {
        bot.activeAttack = null;
        self.action = "strafe";
        bot.nextDecisionAt = now + 380 + Math.random() * 340;
        return "none";
      }

      if (elapsed < spec.windupMs) {
        if (elapsed < spec.windupMs * 0.6) {
          const nearest = findNearest(self.x, self.z, opposingTargets);
          if (nearest) {
            self.yaw = yawFromDelta(nearest.x - self.x, nearest.z - self.z);
          }
        }
        self.action = heavy ? "windup_heavy" : "windup_light";
        return heavy ? "heavy" : "light";
      }

      self.action = heavy ? "attack_heavy" : "attack_light";
      if (elapsed <= spec.windupMs + spec.activeMs) {
        const lungeSpeed = spec.lungeSpeed ?? (heavy ? 2.6 : 1.9);
        const moved = clampToArena(
          self.x + Math.sin(self.yaw) * lungeSpeed * dtSec,
          self.z + Math.cos(self.yaw) * lungeSpeed * dtSec
        );
        self.x = moved.x;
        self.z = moved.z;

        const events = resolveMeleeSwing(self, atk, opposingTargets, now);
        for (const ev of events) {
          this.host.broadcastCombatEvent(ev);
        }
      }
      return "none";
    }

    const target = findNearest(self.x, self.z, opposingTargets);
    if (!target) {
      self.isBlocking = false;
      self.action = "idle";
      return "none";
    }

    const dx = target.x - self.x;
    const dz = target.z - self.z;
    const dist = Math.hypot(dx, dz) || 0.001;

    // 6. Active guard / deflect hold
    if (self.isBlocking) {
      if (now >= bot.blockUntil || dist > archetype.attackRange + 2.5) {
        self.isBlocking = false;
        bot.blockUntil = 0;
        bot.blockCooldownUntil = now + 1800 + Math.random() * 1100;
      } else {
        self.yaw = yawFromDelta(dx, dz);
        self.action = "block";
        return "none";
      }
    }

    // 7. Reactive block/deflect or dodge when enemy attacks nearby
    const targetAttacking = ATTACKING_ACTIONS.has(target.action);
    if (targetAttacking && dist <= 4.0) {
      if (now >= bot.blockCooldownUntil && Math.random() < 0.22) {
        self.yaw = yawFromDelta(dx, dz);
        self.isBlocking = true;
        self.blockStartedAt = now;
        self.action = "block";
        bot.blockUntil = now + 450 + Math.random() * 350;
        return "none";
      }
      if (now >= bot.dodgeCooldownUntil && (self.hp < 55 || Math.random() < 0.1)) {
        const perpX = (-dz / dist) * bot.strafeDir;
        const perpZ = (dx / dist) * bot.strafeDir;
        bot.dodgeDirX = perpX;
        bot.dodgeDirZ = perpZ;
        bot.dodgeUntil = now + 240;
        bot.dodgeCooldownUntil = now + 1600;
        self.dodgeInvulnUntil = now + COMBAT.DODGE_IFRAMES_MS;
        self.action = "dodge";
        return "none";
      }
    }

    // 8. Seek nearby arena powerup if beneficial
    const desiredPickup = this.findDesiredPickup(bot, dist);
    if (desiredPickup) {
      const pdx = desiredPickup.x - self.x;
      const pdz = desiredPickup.z - self.z;
      const pdist = Math.hypot(pdx, pdz) || 0.001;
      self.yaw = yawFromDelta(pdx, pdz);
      const next = clampToArena(
        self.x + (pdx / pdist) * moveSpeed * dtSec,
        self.z + (pdz / pdist) * moveSpeed * dtSec
      );
      self.x = next.x;
      self.z = next.z;
      self.action = "chase";
      return "none";
    }

    // 9. Face target & cast assigned random Combat Art supermove when off cooldown & in range
    self.yaw = yawFromDelta(dx, dz);
    if (dist <= 4.3 && now >= bot.combatArtReadyAt && now >= bot.nextDecisionAt) {
      bot.combatArtReadyAt = now + 9000 + Math.random() * 5000;
      bot.nextDecisionAt = now + 1150;
      self.isBlocking = false;
      self.action = "attack_heavy";
      this.host.castBotCombatArt(bot, now);
      return "heavy";
    }

    // 10. Normal melee attack when within strike range
    const effectiveRange = Math.max(archetype.attackRange, 2.75);
    if (dist <= effectiveRange && now >= bot.nextDecisionAt) {
      bot.attackCounter++;
      const kind: AttackKind =
        bot.attackCounter % 3 === 0 ? archetype.heavyAttack : archetype.primaryAttack;
      const heavy = kind === "enemy_heavy" || kind === "enemy_lunge";
      bot.activeAttack = {
        kind,
        startedAt: now,
        hitIds: new Set(),
      };
      self.isBlocking = false;
      self.action = heavy ? "windup_heavy" : "windup_light";
      this.host.broadcastCombatEvent({
        kind: "swing",
        x: self.x,
        y: 1.2,
        z: self.z,
        yaw: self.yaw,
        attackerId: self.id,
        attackerName: self.name,
        heavy,
        moveKind: kind,
        enemyKind: bot.kind,
      });
      return heavy ? "heavy" : "light";
    }

    // 11. Chase or strafe with light separation from teammates
    let sepX = 0;
    let sepZ = 0;
    for (const other of allEntities) {
      if (other.id === self.id || !other.alive) continue;
      const odx = self.x - other.x;
      const odz = self.z - other.z;
      const od = Math.hypot(odx, odz);
      if (od > 0.001 && od < 2.0) {
        const push = (2.0 - od) / 2.0;
        sepX += (odx / od) * push * 2.2;
        sepZ += (odz / od) * push * 2.2;
      }
    }

    let moveX = sepX;
    let moveZ = sepZ;
    const holdDist = Math.max(1.9, effectiveRange - 0.35);

    if (dist > holdDist) {
      moveX += (dx / dist) * moveSpeed;
      moveZ += (dz / dist) * moveSpeed;
      self.action = "chase";
    } else {
      if (Math.random() < 0.03) bot.strafeDir *= -1;
      const strafeSpeed = moveSpeed * 0.65;
      moveX += (-dz / dist) * bot.strafeDir * strafeSpeed;
      moveZ += (dx / dist) * bot.strafeDir * strafeSpeed;
      self.action = "strafe";
    }

    const clamped = clampToArena(self.x + moveX * dtSec, self.z + moveZ * dtSec);
    self.x = clamped.x;
    self.z = clamped.z;
    return "none";
  }

  private findDesiredPickup(bot: TeamBotRuntime, targetDist: number): PickupState | null {
    const self = bot.entity;
    let best: PickupState | null = null;
    let bestScore = Infinity;
    const needsHeal = self.hp <= 75;

    this.host.state.pickups.forEach((pickup) => {
      const d = Math.hypot(pickup.x - self.x, pickup.z - self.z);
      const maxSeekDist = pickup.kind === "healing_flask" && needsHeal ? 16 : 9.5;
      if (d > maxSeekDist) return;
      // Only peel off from an immediate melee clash if low HP & healing flask
      if (targetDist < 3.0 && !(pickup.kind === "healing_flask" && self.hp < 50)) return;
      const weight = pickup.kind === "healing_flask" && needsHeal ? 0.55 : 1.0;
      const score = d * weight;
      if (score < bestScore) {
        bestScore = score;
        best = pickup;
      }
    });

    return best;
  }

  private tryBotCollectPickups(
    bot: TeamBotRuntime,
    now: number
  ): void {
    const self = bot.entity;
    const collectedIds: string[] = [];

    this.host.state.pickups.forEach((pickup, pid) => {
      const dist = Math.hypot(self.x - pickup.x, self.z - pickup.z);
      if (dist <= COMBAT.PICKUP_COLLECT_RADIUS) {
        collectedIds.push(pid);
        const kind = pickup.kind as PowerUpKind;
        this.host.broadcastCombatEvent({
          kind: "pickup_collect",
          x: pickup.x,
          y: 0.9,
          z: pickup.z,
          attackerId: self.id,
          attackerName: self.name,
          powerUpKind: kind,
        });
        this.applyBotPowerUp(bot, kind, now);
      }
    });

    for (const pid of collectedIds) {
      this.host.state.pickups.delete(pid);
    }
  }

  private applyBotPowerUp(
    bot: TeamBotRuntime,
    kind: PowerUpKind,
    now: number
  ): void {
    const self = bot.entity;
    if (kind === "healing_flask") {
      self.hp = Math.min(self.maxHp, self.hp + COMBAT.HEALING_FLASK_HP);
    } else if (kind === "posture_tonic") {
      self.posture = 0;
      self.staggeredUntil = 0;
      bot.tonicUntil = now + POWER_UPS.posture_tonic.durationMs;
    } else if (kind === "warriors_fury") {
      bot.furyUntil = now + POWER_UPS.warriors_fury.durationMs;
    } else if (kind === "iron_will") {
      bot.ironWillUntil = now + POWER_UPS.iron_will.durationMs;
    } else if (kind === "swift_feet") {
      bot.swiftFeetUntil = now + POWER_UPS.swift_feet.durationMs;
    }

    this.host.broadcastCombatEvent({
      kind: "powerup_use",
      x: self.x,
      y: (self.y ?? 0) + 1.2,
      z: self.z,
      yaw: self.yaw,
      attackerId: self.id,
      attackerName: self.name,
      powerUpKind: kind,
    });
  }

  private syncBotSchema(bot: TeamBotRuntime, es: EnemyState, telegraph: string): void {
    es.x = bot.entity.x;
    es.y = bot.entity.y ?? 0;
    es.z = bot.entity.z;
    es.yaw = bot.entity.yaw;
    es.hp = Math.round(bot.entity.hp);
    es.posture = Math.round(bot.entity.posture);
    es.action = bot.entity.action;
    es.telegraph = telegraph;
    es.isBlocking = bot.entity.isBlocking;
    es.alive = bot.entity.alive;
    es.team = bot.team;
    es.combatArt = bot.combatArt;
    es.isBot = true;
  }

  private autoBalanceAllPlayers(): void {
    let red = 0;
    let blue = 0;
    for (const { id } of this.host.getHumanPlayers()) {
      const team: TeamSide = red <= blue && red < TEAM_3V3_SIZE ? "red" : "blue";
      if (team === "red") red++;
      else blue++;
      this.host.setPlayerTeam(id, team);
    }
  }

  private countHumansOnTeam(team: TeamSide, excludePlayerId?: string): number {
    let count = 0;
    this.host.state.players.forEach((p, id) => {
      if (id !== excludePlayerId && p.team === team) count++;
    });
    return count;
  }
}

function findNearest(x: number, z: number, targets: CombatEntity[]): CombatEntity | null {
  let best: CombatEntity | null = null;
  let bestDistSq = Infinity;
  for (const t of targets) {
    if (!t.alive) continue;
    const dx = t.x - x;
    const dz = t.z - z;
    const dSq = dx * dx + dz * dz;
    if (dSq < bestDistSq) {
      bestDistSq = dSq;
      best = t;
    }
  }
  return best;
}

export function getBotForward(yaw: number): { x: number; z: number } {
  return forwardFromYaw(yaw);
}
