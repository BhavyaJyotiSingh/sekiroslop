import { Room, type Client } from "colyseus";
import {
  ALL_POWERUP_KINDS,
  ARENA_MAPS,
  ARENA,
  ATTACK_SPECS,
  BOSS_RUSH_TRIALS,
  COMBAT,
  ENEMY_ARCHETYPES,
  FFA_CONFIG,
  FLIGHT,
  GAME_PROTOCOL_VERSION,
  PLAYER_ABILITIES,
  PLAYER_SKINS,
  POWER_UPS,
  SPECIAL_MOVES,
  clampToArena,
  forwardFromYaw,
  getWavePlan,
  yawFromDelta,
  type AttackKind,
  type ArenaMapMessage,
  type ArenaMapKind,
  type AttackMessage,
  type BlockMessage,
  type CastAbilityMessage,
  type CastSelectedArtMessage,
  type CombatArtKind,
  type CombatEventPayload,
  type DodgeMessage,
  type EnemyKind,
  type GameModeMessage,
  type JoinTeamMessage,
  type MoveMessage,
  type MemeSfxKind,
  type PlayerAbilityKind,
  type PlayerLoadoutMessage,
  type PartyChatMessage,
  type PlayerSkinKind,
  type PowerUpKind,
  type ProjectileKind,
  type RespawnMode,
  type RespawnModeMessage,
  type SpecialMessage,
  type TeamFillBotsMessage,
  type TeamSide,
  type UseItemMessage,
} from "@sekiroslop/shared";
import {
  ColosseumState,
  EnemyState,
  PickupState,
  PilumState,
  PlayerState,
} from "../schema/ColosseumState.js";
import {
  isAttackFinished,
  isAttackInActiveWindow,
  resolveMeleeSwing,
  resolveProjectileHit,
  updatePostureDecay,
  type AttackRuntime,
  type CombatEntity,
} from "../combat/CombatEngine.js";
import { stepSkeletonAI, type EnemyRuntime } from "../ai/SkeletonAI.js";
import { allocateUniqueRoomCode, releaseRoomCode } from "./roomCode.js";
import { Team3v3Controller, type TeamBotRuntime } from "./team3v3.js";

interface BeltSlot {
  kind: PowerUpKind | "";
  charges: number;
}

interface PlayerRuntime {
  entity: CombatEntity;
  slot: number;
  lastMoveAt: number;
  lastMoveSeq: number;
  moveX: number;
  moveZ: number;
  jumpPressed: boolean;
  jumpHeld: boolean;
  velocityX: number;
  velocityY: number;
  velocityZ: number;
  grounded: boolean;
  jumpGraceUntil: number;
  flightOriginX: number;
  flightOriginZ: number;
  flightUsedThisJump: boolean;
  activeAttack: AttackRuntime | null;
  lastLightEndedAt: number;
  comboStep: 1 | 2;
  dodgeUntil: number;
  dodgeRemainingMs: number;
  dodgeCooldownUntil: number;
  dodgeDirX: number;
  dodgeDirZ: number;
  deadAt: number;
  isMoving: boolean;
  y: number;
  moveAnim: string;
  // Special cooldowns & counter window
  whirlwindReadyAt: number;
  counterReadyUntil: number;
  itemAnimUntil: number;
  itemAnimName: string;
  memeSfxReadyAt: number;
  experimentalArtReadyAt: Partial<Record<ExperimentalArtKind, number>>;
  selectedAbility: PlayerAbilityKind;
  abilityReadyAt: number;
  flightFuelMs: number;
  isFlying: boolean;
  ffaZoneMs: number;
  // Power-up buffs
  furyUntil: number;
  ironWillUntil: number;
  swiftFeetUntil: number;
  tonicUntil: number;
  belt: [BeltSlot, BeltSlot, BeltSlot];
}

interface PilumRuntime {
  id: string;
  kind: ProjectileKind;
  ownerId: string;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  hpDamage: number;
  postureDamage: number;
  aoeRadius?: number;
  stunMs?: number;
  homingTargetId?: string;
  expiresAt: number;
}

interface KnockbackRuntime {
  vx: number;
  vy: number;
  vz: number;
  y: number;
}

type ExperimentalArtKind = CombatArtKind;

interface ExperimentalArtMessage {
  art: string;
  yaw: number;
  preview?: boolean;
}

interface ExperimentalArtPulseSpec {
  offsetMs: number;
  range: number;
  arcDot: number;
  hpDamage: number;
  postureDamage: number;
  blockPostureDamage: number;
  blockChipHp: number;
  deflectAttackerPosture: number;
  deflectSelfPosture: number;
  heavy: boolean;
  moveKind: AttackKind;
  postureRecover?: number;
}

interface ExperimentalArtPulse extends Omit<ExperimentalArtPulseSpec, "offsetMs"> {
  attackerId: string;
  art: ExperimentalArtKind;
  triggerAt: number;
}

const EXPERIMENTAL_ART_SERVER_SPECS: Record<
  ExperimentalArtKind,
  readonly ExperimentalArtPulseSpec[]
> = {
  sakura_dance: [
    {
      offsetMs: 350,
      range: 3.3,
      arcDot: -1.0,
      hpDamage: 8,
      postureDamage: 16,
      blockPostureDamage: 13,
      blockChipHp: 0,
      deflectAttackerPosture: 20,
      deflectSelfPosture: 4,
      heavy: true,
      moveKind: "whirlwind",
    },
    {
      offsetMs: 710,
      range: 3.55,
      arcDot: -1.0,
      hpDamage: 9,
      postureDamage: 17,
      blockPostureDamage: 14,
      blockChipHp: 0,
      deflectAttackerPosture: 22,
      deflectSelfPosture: 4,
      heavy: true,
      moveKind: "whirlwind",
    },
    {
      offsetMs: 1090,
      range: 3.85,
      arcDot: -1.0,
      hpDamage: 11,
      postureDamage: 22,
      blockPostureDamage: 17,
      blockChipHp: 3,
      deflectAttackerPosture: 24,
      deflectSelfPosture: 4,
      heavy: true,
      moveKind: "whirlwind",
    },
  ],
  mortal_draw: [
    {
      offsetMs: 550,
      range: 5.8,
      arcDot: 0.08,
      hpDamage: 20,
      postureDamage: 37,
      blockPostureDamage: 30,
      blockChipHp: 10,
      deflectAttackerPosture: 37,
      deflectSelfPosture: 6,
      heavy: true,
      moveKind: "heavy",
    },
    {
      offsetMs: 1160,
      range: 6.3,
      arcDot: -0.15,
      hpDamage: 25,
      postureDamage: 48,
      blockPostureDamage: 37,
      blockChipHp: 13,
      deflectAttackerPosture: 40,
      deflectSelfPosture: 6,
      heavy: true,
      moveKind: "heavy",
    },
  ],
  ichimonji_double: [
    {
      offsetMs: 400,
      range: 3.6,
      arcDot: 0.55,
      hpDamage: 11,
      postureDamage: 32,
      blockPostureDamage: 24,
      blockChipHp: 2,
      deflectAttackerPosture: 30,
      deflectSelfPosture: 5,
      heavy: true,
      moveKind: "heavy",
      postureRecover: 22,
    },
    {
      offsetMs: 950,
      range: 3.85,
      arcDot: 0.5,
      hpDamage: 16,
      postureDamage: 43,
      blockPostureDamage: 35,
      blockChipHp: 4,
      deflectAttackerPosture: 36,
      deflectSelfPosture: 6,
      heavy: true,
      moveKind: "heavy",
      postureRecover: 22,
    },
  ],
  ashina_cross: [
    {
      offsetMs: 380,
      range: 4.2,
      arcDot: 0.2,
      hpDamage: 12,
      postureDamage: 24,
      blockPostureDamage: 19,
      blockChipHp: 6,
      deflectAttackerPosture: 27,
      deflectSelfPosture: 4,
      heavy: true,
      moveKind: "counter",
    },
    {
      offsetMs: 520,
      range: 4.3,
      arcDot: 0.2,
      hpDamage: 15,
      postureDamage: 29,
      blockPostureDamage: 22,
      blockChipHp: 7,
      deflectAttackerPosture: 30,
      deflectSelfPosture: 4,
      heavy: true,
      moveKind: "counter",
    },
  ],
  dragon_flash: [
    {
      offsetMs: 450,
      range: 5.5,
      arcDot: 0.45,
      hpDamage: 12,
      postureDamage: 26,
      blockPostureDamage: 20,
      blockChipHp: 6,
      deflectAttackerPosture: 32,
      deflectSelfPosture: 5,
      heavy: true,
      moveKind: "thrust",
    },
    {
      offsetMs: 850,
      range: 7.2,
      arcDot: 0.68,
      hpDamage: 20,
      postureDamage: 42,
      blockPostureDamage: 33,
      blockChipHp: 12,
      deflectAttackerPosture: 39,
      deflectSelfPosture: 6,
      heavy: true,
      moveKind: "thrust",
    },
  ],
  whirlwind_slash: [
    {
      offsetMs: 280,
      range: 3.9,
      arcDot: -1.0,
      hpDamage: 9,
      postureDamage: 18,
      blockPostureDamage: 14,
      blockChipHp: 4,
      deflectAttackerPosture: 22,
      deflectSelfPosture: 4,
      heavy: false,
      moveKind: "whirlwind",
    },
    {
      offsetMs: 580,
      range: 4.1,
      arcDot: -1.0,
      hpDamage: 11,
      postureDamage: 22,
      blockPostureDamage: 18,
      blockChipHp: 5,
      deflectAttackerPosture: 26,
      deflectSelfPosture: 5,
      heavy: true,
      moveKind: "whirlwind",
    },
  ],
  shadowrush: [
    {
      offsetMs: 320,
      range: 5.3,
      arcDot: 0.65,
      hpDamage: 13,
      postureDamage: 27,
      blockPostureDamage: 22,
      blockChipHp: 9,
      deflectAttackerPosture: 33,
      deflectSelfPosture: 5,
      heavy: true,
      moveKind: "thrust",
    },
    {
      offsetMs: 960,
      range: 3.8,
      arcDot: 0.15,
      hpDamage: 16,
      postureDamage: 30,
      blockPostureDamage: 23,
      blockChipHp: 4,
      deflectAttackerPosture: 30,
      deflectSelfPosture: 5,
      heavy: true,
      moveKind: "aerial_slam",
    },
  ],
  spiral_cloud_passage: [
    {
      offsetMs: 230,
      range: 3.9,
      arcDot: -0.55,
      hpDamage: 6,
      postureDamage: 12,
      blockPostureDamage: 9,
      blockChipHp: 3,
      deflectAttackerPosture: 16,
      deflectSelfPosture: 4,
      heavy: false,
      moveKind: "whirlwind",
    },
    {
      offsetMs: 440,
      range: 4.0,
      arcDot: -0.8,
      hpDamage: 7,
      postureDamage: 13,
      blockPostureDamage: 11,
      blockChipHp: 4,
      deflectAttackerPosture: 17,
      deflectSelfPosture: 4,
      heavy: false,
      moveKind: "whirlwind",
    },
    {
      offsetMs: 650,
      range: 4.2,
      arcDot: -1.0,
      hpDamage: 7,
      postureDamage: 13,
      blockPostureDamage: 12,
      blockChipHp: 4,
      deflectAttackerPosture: 19,
      deflectSelfPosture: 4,
      heavy: false,
      moveKind: "whirlwind",
    },
    {
      offsetMs: 960,
      range: 4.5,
      arcDot: -1.0,
      hpDamage: 12,
      postureDamage: 26,
      blockPostureDamage: 20,
      blockChipHp: 7,
      deflectAttackerPosture: 29,
      deflectSelfPosture: 5,
      heavy: true,
      moveKind: "whirlwind",
    },
  ],
  one_mind: [
    {
      offsetMs: 330,
      range: 4.5,
      arcDot: 0.2,
      hpDamage: 11,
      postureDamage: 22,
      blockPostureDamage: 17,
      blockChipHp: 4,
      deflectAttackerPosture: 24,
      deflectSelfPosture: 4,
      heavy: true,
      moveKind: "counter",
    },
    {
      offsetMs: 620,
      range: 4.9,
      arcDot: -0.55,
      hpDamage: 8,
      postureDamage: 16,
      blockPostureDamage: 13,
      blockChipHp: 4,
      deflectAttackerPosture: 19,
      deflectSelfPosture: 4,
      heavy: false,
      moveKind: "whirlwind",
    },
    {
      offsetMs: 840,
      range: 4.9,
      arcDot: -0.55,
      hpDamage: 8,
      postureDamage: 16,
      blockPostureDamage: 13,
      blockChipHp: 4,
      deflectAttackerPosture: 19,
      deflectSelfPosture: 4,
      heavy: false,
      moveKind: "whirlwind",
    },
    {
      offsetMs: 1150,
      range: 5.1,
      arcDot: -0.15,
      hpDamage: 16,
      postureDamage: 32,
      blockPostureDamage: 24,
      blockChipHp: 9,
      deflectAttackerPosture: 33,
      deflectSelfPosture: 5,
      heavy: true,
      moveKind: "heavy",
    },
  ],
};

const EXPERIMENTAL_ART_COOLDOWNS_MS: Record<ExperimentalArtKind, number> = {
  sakura_dance: 7500,
  mortal_draw: 10000,
  ichimonji_double: 7500,
  ashina_cross: 6500,
  dragon_flash: 9000,
  whirlwind_slash: 5500,
  shadowrush: 8500,
  spiral_cloud_passage: 10000,
  one_mind: 11500,
};

export class ColosseumRoom extends Room {
  declare state: ColosseumState;
  maxClients = 6;

  readonly team3v3: Team3v3Controller = this.createTeam3v3Controller();
  private allocatedRoomCode = "";
  private playerRuntimes = new Map<string, PlayerRuntime>();
  private enemyRuntimes = new Map<string, EnemyRuntime>();
  private pilumRuntimes = new Map<string, PilumRuntime>();
  private knockbacks = new Map<string, KnockbackRuntime>();
  private chatSentAt = new Map<string, number>();
  private pendingArtPulses: ExperimentalArtPulse[] = [];
  private waveQueue: EnemyKind[] = [];
  private waveMaxConcurrent = 3;
  private waveHpScale = 1.0;
  private nextWaveSpawnAt = 0;
  private nextBossTrialAt = 0;
  private nextEnemySeq = 1;
  private nextPickupSeq = 1;
  private nextPilumSeq = 1;
  private gateOpenUntil = 0;
  private nextPickupSpawnAt = 0;

  async onCreate(options?: { roomCode?: string }): Promise<void> {
    const code = await allocateUniqueRoomCode(this.presence, options?.roomCode);
    this.allocatedRoomCode = code;
    const state = new ColosseumState();
    this.roomId = code;
    state.roomCode = code;
    this.setState(state);

    this.onMessage("move", (client, msg: MoveMessage) => this.handleMove(client, msg));
    this.onMessage("attack", (client, msg: AttackMessage) => this.handleAttack(client, msg));
    this.onMessage("special", (client, msg: SpecialMessage) => this.handleSpecial(client, msg));
    this.onMessage("use_item", (client, msg: UseItemMessage) => this.handleUseItem(client, msg));
    this.onMessage("block", (client, msg: BlockMessage) => this.handleBlock(client, msg));
    this.onMessage("dodge", (client, msg: DodgeMessage) => this.handleDodge(client, msg));
    this.onMessage("interact_gate", (client) => this.handleInteractGate(client));
    this.onMessage("experimental_art", (client, msg: ExperimentalArtMessage) =>
      this.handleExperimentalArt(client, msg)
    );
    this.onMessage("player_loadout", (client, msg: PlayerLoadoutMessage) => this.handlePlayerLoadout(client, msg));
    this.onMessage("respawn_mode", (client, msg: RespawnModeMessage) => this.handleRespawnMode(client, msg));
    this.onMessage("arena_map", (client, msg: ArenaMapMessage) => this.handleArenaMap(client, msg));
    this.onMessage("game_mode", (client, msg: GameModeMessage) => {
      if (msg && typeof msg === "object") {
        if (this.team3v3.setGameMode(client.sessionId, msg.mode)) {
          this.waveQueue = [];
          this.state.waveTitle = "";
          this.state.totalEnemiesInWave = 0;
          this.state.enemiesRemaining = 0;
          this.enemyRuntimes.clear();
          this.state.enemies.clear();
          this.playerRuntimes.forEach((rt, pid) => {
            const ps = this.state.players.get(pid);
            if (ps && !rt.entity.alive) this.revivePlayer(rt, ps);
          });
        }
      }
    });
    this.onMessage("join_team", (client, msg: JoinTeamMessage) => {
      if (msg && typeof msg === "object") this.team3v3.joinTeam(client.sessionId, msg.team);
    });
    this.onMessage("team_fill_bots", (client, msg: TeamFillBotsMessage) => {
      if (msg && typeof msg === "object") this.team3v3.setFillBots(client.sessionId, Boolean(msg.enabled));
    });
    this.onMessage("team_start_match", (client) => {
      this.team3v3.startMatch(client.sessionId);
    });
    this.onMessage("team_rematch", (client) => {
      this.team3v3.rematch(client.sessionId);
    });
    this.onMessage("cast_selected_art", (client, msg: CastSelectedArtMessage) =>
      this.handleCastSelectedArt(client, msg)
    );
    this.onMessage("cast_ability", (client, msg: CastAbilityMessage) =>
      this.handleCastAbility(client, msg)
    );
    this.onMessage("ffa_start_match", (client) => {
      this.startFfaMatch(client.sessionId);
    });
    this.onMessage("toggle_infinite_health", (client, msg: { enabled?: boolean }) => {
      this.handleToggleInfiniteHealth(client, Boolean(msg?.enabled));
    });
    this.onMessage("ping_report", (client, msg: { pingMs?: number }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || !Number.isFinite(msg?.pingMs)) return;
      player.pingMs = Math.max(0, Math.min(2000, Math.round(msg.pingMs!)));
    });
    this.onMessage("party_chat", (client, msg: { text?: string }) => {
      const player = this.state.players.get(client.sessionId);
      const now = Date.now();
      if (!player || now - (this.chatSentAt.get(client.sessionId) ?? 0) < 650) return;
      const text = typeof msg?.text === "string" ? msg.text.replace(/\s+/g, " ").trim().slice(0, 220) : "";
      if (!text) return;
      this.chatSentAt.set(client.sessionId, now);
      const payload: PartyChatMessage = {
        senderId: client.sessionId,
        senderName: player.name,
        text,
        sentAt: now,
      };
      this.broadcast("party_chat", payload);
    });

    // Seed initial random power-ups around the Colosseum
    this.spawnRandomArenaPickups(3);
    this.nextPickupSpawnAt = Date.now() + COMBAT.PICKUP_RESPAWN_MS;

    this.patchRate = COMBAT.SERVER_TICK_MS;
    this.setSimulationInterval((deltaMs) => this.step(deltaMs), COMBAT.SERVER_TICK_MS);
    console.log(`[ColosseumRoom] Created arena ${code} (30Hz)`);
  }

  onAuth(_client: Client, options?: { protocolVersion?: number }): boolean {
    if (options?.protocolVersion !== GAME_PROTOCOL_VERSION) {
      throw new Error("This game client is out of date. Refresh the page to update.");
    }
    return true;
  }

  onJoin(client: Client, options?: { name?: string; protocolVersion?: number }): void {
    const usedSlots = new Set<number>();
    this.playerRuntimes.forEach((p) => usedSlots.add(p.slot));
    let slot = 0;
    while (usedSlots.has(slot) && slot < this.maxClients) slot++;

    const spawn = ARENA.PLAYER_SPAWNS[slot % ARENA.PLAYER_SPAWNS.length];
    const cleanName = (options?.name ?? `Gladiator ${slot + 1}`).trim().slice(0, 18) || `Gladiator ${slot + 1}`;

    const ps = new PlayerState();
    ps.id = client.sessionId;
    ps.name = cleanName;
    ps.slot = slot;
    ps.skin = "knight";
    ps.selectedArt = "ashina_cross";
    ps.x = spawn.x;
    ps.z = spawn.z;
    ps.yaw = spawn.yaw;
    ps.hp = COMBAT.PLAYER_MAX_HP;
    ps.maxHp = COMBAT.PLAYER_MAX_HP;
    ps.posture = 0;
    ps.maxPosture = COMBAT.PLAYER_MAX_POSTURE;
    ps.action = "idle";
    ps.alive = true;
    this.state.players.set(client.sessionId, ps);
    if (!this.state.hostSessionId) this.state.hostSessionId = client.sessionId;

    const now = Date.now();
    const entity: CombatEntity = {
      id: client.sessionId,
      name: cleanName,
      isPlayer: true,
      x: spawn.x,
      y: 0,
      z: spawn.z,
      yaw: spawn.yaw,
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
      onDeflected: (_attacker, t) => {
        const rt = this.playerRuntimes.get(client.sessionId);
        if (rt) {
          rt.counterReadyUntil = t + COMBAT.COUNTER_WINDOW_MS;
        }
      },
      onKilled: (killer) => {
        const victimState = this.state.players.get(client.sessionId);
        if (victimState) victimState.deaths += 1;
        if (killer.isPlayer) {
          const killerState = this.state.players.get(killer.id);
          if (killerState) {
            killerState.kills += 1;
            killerState.pvpKills += 1;
            if (this.state.gameMode === "ffa" && !this.state.ffaWinnerName) {
              killerState.ffaScore += 1;
              if (killerState.ffaScore >= this.state.ffaTargetScore) {
                this.finishFfaMatch(killerState.name);
              }
            }
          }
        }
        const rt = this.playerRuntimes.get(client.sessionId);
        if (rt) rt.deadAt = Date.now();
      },
    };

    this.playerRuntimes.set(client.sessionId, {
      entity,
      slot,
      lastMoveAt: now,
      lastMoveSeq: 0,
      moveX: 0,
      moveZ: 0,
      jumpPressed: false,
      jumpHeld: false,
      velocityX: 0,
      velocityY: 0,
      velocityZ: 0,
      grounded: true,
      jumpGraceUntil: 0,
      flightOriginX: spawn.x,
      flightOriginZ: spawn.z,
      flightUsedThisJump: false,
      activeAttack: null,
      lastLightEndedAt: 0,
      comboStep: 1,
      dodgeUntil: 0,
      dodgeRemainingMs: 0,
      dodgeCooldownUntil: 0,
      dodgeDirX: 0,
      dodgeDirZ: -1,
      deadAt: 0,
      isMoving: false,
      y: 0,
      moveAnim: "idle",
      whirlwindReadyAt: 0,
      counterReadyUntil: 0,
      itemAnimUntil: 0,
      itemAnimName: "idle",
      memeSfxReadyAt: 0,
      experimentalArtReadyAt: {},
      selectedAbility: "fireball",
      abilityReadyAt: 0,
      flightFuelMs: FLIGHT.MAX_FUEL_MS,
      isFlying: false,
      ffaZoneMs: 0,
      furyUntil: 0,
      ironWillUntil: 0,
      swiftFeetUntil: 0,
      tonicUntil: 0,
      belt: [
        { kind: "", charges: 0 },
        { kind: "", charges: 0 },
        { kind: "", charges: 0 },
      ],
    });

    this.team3v3.assignPlayerOnJoin(client.sessionId);
    if (this.playerRuntimes.size > 1) {
      for (const [pid, prt] of this.playerRuntimes.entries()) {
        prt.entity.infiniteHealth = false;
        const pstate = this.state.players.get(pid);
        if (pstate) pstate.infiniteHealth = false;
      }
    }

    console.log(`[ColosseumRoom ${this.roomId}] ${cleanName} joined (slot ${slot})`);
  }

  onLeave(client: Client): void {
    this.pendingArtPulses = this.pendingArtPulses.filter((p) => p.attackerId !== client.sessionId);
    this.knockbacks.delete(client.sessionId);
    this.chatSentAt.delete(client.sessionId);
    this.playerRuntimes.delete(client.sessionId);
    this.state.players.delete(client.sessionId);
    if (this.state.hostSessionId === client.sessionId) {
      this.state.hostSessionId = this.playerRuntimes.keys().next().value ?? "";
    }
    console.log(`[ColosseumRoom ${this.roomId}] ${client.sessionId} left`);
  }

  async onDispose(): Promise<void> {
    const code = this.allocatedRoomCode || this.state?.roomCode || "";
    if (code) {
      await releaseRoomCode(this.presence, code);
    }
    this.allocatedRoomCode = "";
    console.log(`[ColosseumRoom] Disposed arena ${code}`);
  }

  private handleMove(client: Client, msg: MoveMessage): void {
    if (!msg || typeof msg !== "object") return;
    const rt = this.playerRuntimes.get(client.sessionId);
    if (!rt || !rt.entity.alive) return;
    if (this.knockbacks.has(client.sessionId)) return;

    const now = Date.now();
    if (
      !Number.isSafeInteger(msg.sequence) ||
      msg.sequence <= rt.lastMoveSeq ||
      !Number.isFinite(msg.moveX) ||
      !Number.isFinite(msg.moveZ) ||
      !Number.isFinite(msg.yaw) ||
      typeof msg.jumpPressed !== "boolean" ||
      typeof msg.jumpHeld !== "boolean"
    ) return;

    const inputMagnitude = Math.hypot(msg.moveX, msg.moveZ);
    if (!Number.isFinite(inputMagnitude)) return;
    const inputScale = inputMagnitude > 1 ? 1 / inputMagnitude : 1;
    rt.moveX = msg.moveX * inputScale;
    rt.moveZ = msg.moveZ * inputScale;
    rt.jumpPressed = msg.jumpPressed;
    rt.jumpHeld = msg.jumpHeld;
    rt.lastMoveSeq = msg.sequence;
    rt.lastMoveAt = now;

    if (now < rt.entity.staggeredUntil || (rt.entity.shockedUntil && now < rt.entity.shockedUntil)) {
      rt.moveX = 0;
      rt.moveZ = 0;
      rt.jumpPressed = false;
      rt.jumpHeld = false;
      rt.isMoving = false;
      rt.isFlying = false;
      return;
    }

    rt.entity.yaw = Math.atan2(Math.sin(msg.yaw), Math.cos(msg.yaw));
    rt.isMoving = inputMagnitude > 0.05;
  }

  private stepPlayerMotion(rt: PlayerRuntime, deltaMs: number, now: number): void {
    const entity = rt.entity;
    const ps = this.state.players.get(entity.id);
    if (!ps || !entity.alive) return;

    const dt = Math.min(0.1, Math.max(0, deltaMs / 1000));
    if (now - rt.lastMoveAt > 120) {
      rt.moveX = 0;
      rt.moveZ = 0;
      rt.jumpHeld = false;
    }

    const jumpPressed = rt.jumpPressed;
    rt.jumpPressed = false;
    const locked = now < entity.staggeredUntil || Boolean(entity.shockedUntil && now < entity.shockedUntil);
    const dodging = now < rt.dodgeUntil;
    const canMove = !locked && !this.knockbacks.has(entity.id);

    if (jumpPressed && canMove) {
      if (rt.grounded) {
        const swift = now < rt.swiftFeetUntil ? COMBAT.SWIFT_FEET_SPEED_MULT : 1;
        rt.velocityY = COMBAT.PLAYER_JUMP_VELOCITY * swift;
        rt.grounded = false;
        rt.jumpGraceUntil = now + 180;
        rt.flightOriginX = entity.x;
        rt.flightOriginZ = entity.z;
        rt.flightUsedThisJump = false;
      } else if (rt.flightFuelMs > 40) {
        // A fresh mid-air press engages the same immediate lift as local prediction.
        rt.jumpGraceUntil = now;
        rt.velocityY = Math.max(rt.velocityY, FLIGHT.IGNITION_MIN_VY);
      }
    }

    const canPropel =
      canMove &&
      !rt.grounded &&
      now >= rt.jumpGraceUntil &&
      rt.jumpHeld &&
      rt.flightFuelMs > 0;
    rt.isFlying = canPropel;

    if (canPropel) {
      rt.flightUsedThisJump = true;
      const alphaY = 1 - Math.exp(-FLIGHT.THRUST_ACCEL_Y * dt);
      rt.velocityY += (FLIGHT.ASCEND_SPEED - rt.velocityY) * alphaY;
      rt.y = Math.min(FLIGHT.MAX_Y, rt.y + rt.velocityY * dt);
      if (rt.y >= FLIGHT.MAX_Y) rt.velocityY = Math.min(0, rt.velocityY);
      rt.flightFuelMs = Math.max(0, rt.flightFuelMs - dt * 1000);
      if (rt.flightFuelMs <= 0) rt.isFlying = false;
    } else if (!rt.grounded) {
      rt.velocityY -= COMBAT.PLAYER_GRAVITY * dt;
      rt.y += rt.velocityY * dt;
      if (rt.y <= 0) {
        rt.y = 0;
        rt.velocityY = 0;
        rt.grounded = true;
        rt.isFlying = false;
        rt.flightUsedThisJump = false;
      }
    }

    if (rt.grounded && !rt.isFlying) {
      rt.flightFuelMs = Math.min(
        FLIGHT.MAX_FUEL_MS,
        rt.flightFuelMs + FLIGHT.RECHARGE_PER_SEC * dt
      );
    }

    const inputMagnitude = Math.hypot(rt.moveX, rt.moveZ);
    const inputX = inputMagnitude > 1 ? rt.moveX / inputMagnitude : rt.moveX;
    const inputZ = inputMagnitude > 1 ? rt.moveZ / inputMagnitude : rt.moveZ;
    const hasInput = inputMagnitude > 0.05 && canMove && !dodging;
    const swift = now < rt.swiftFeetUntil ? COMBAT.SWIFT_FEET_SPEED_MULT : 1;
    const baseSpeed = entity.isBlocking
      ? COMBAT.PLAYER_BLOCK_SPEED
      : rt.activeAttack
        ? COMBAT.PLAYER_MOVE_SPEED * 0.35
        : COMBAT.PLAYER_MOVE_SPEED;
    const horizontalMode = rt.grounded ? 1 : FLIGHT.FLY_SPEED_MULT;
    let targetSpeed = hasInput ? baseSpeed * swift * horizontalMode : 0;

    if (rt.flightUsedThisJump && !rt.grounded) {
      const distance = Math.hypot(entity.x - rt.flightOriginX, entity.z - rt.flightOriginZ);
      const remaining = Math.max(0, FLIGHT.MAX_BURST_DISTANCE - distance);
      const maxFlightSpeed = FLIGHT.MAX_BURST_DISTANCE / (FLIGHT.MAX_FUEL_MS / 1000);
      targetSpeed = Math.min(targetSpeed, maxFlightSpeed, remaining * 18);
    }

    const response = rt.grounded
      ? (hasInput ? 30 : 22)
      : hasInput
        ? (rt.isFlying ? FLIGHT.FLY_ACCEL_XZ : FLIGHT.AIR_STEER_ACCEL)
        : FLIGHT.AIR_COAST_DRAG;
    const blend = 1 - Math.exp(-response * dt);
    if (dodging) {
      rt.velocityX = 0;
      rt.velocityZ = 0;
    } else {
      const targetX = inputX * targetSpeed;
      const targetZ = inputZ * targetSpeed;
      rt.velocityX += (targetX - rt.velocityX) * blend;
      rt.velocityZ += (targetZ - rt.velocityZ) * blend;
    }

    const desiredX = entity.x + rt.velocityX * dt;
    const desiredZ = entity.z + rt.velocityZ * dt;
    const clamped = clampToArena(
      desiredX,
      desiredZ,
      ARENA.ENTITY_RADIUS,
      false,
      this.state.arenaMap as ArenaMapKind
    );
    const pushX = clamped.x - desiredX;
    const pushZ = clamped.z - desiredZ;
    const pushLen = Math.hypot(pushX, pushZ);
    if (pushLen > 0.0005) {
      const nx = pushX / pushLen;
      const nz = pushZ / pushLen;
      const intoWall = rt.velocityX * nx + rt.velocityZ * nz;
      if (intoWall < 0) {
        rt.velocityX -= intoWall * nx;
        rt.velocityZ -= intoWall * nz;
      }
    }
    entity.x = clamped.x;
    entity.z = clamped.z;

    if (rt.flightUsedThisJump && !rt.grounded) {
      const dx = entity.x - rt.flightOriginX;
      const dz = entity.z - rt.flightOriginZ;
      const distance = Math.hypot(dx, dz);
      if (distance > FLIGHT.MAX_BURST_DISTANCE) {
        const scale = FLIGHT.MAX_BURST_DISTANCE / distance;
        entity.x = rt.flightOriginX + dx * scale;
        entity.z = rt.flightOriginZ + dz * scale;
        const nx = dx / distance;
        const nz = dz / distance;
        const intoLimit = rt.velocityX * nx + rt.velocityZ * nz;
        if (intoLimit > 0) {
          rt.velocityX -= intoLimit * nx;
          rt.velocityZ -= intoLimit * nz;
        }
      }
    }

    entity.y = rt.y;
    ps.velocityX = rt.velocityX;
    ps.velocityY = rt.velocityY;
    ps.velocityZ = rt.velocityZ;
    rt.isMoving = inputMagnitude > 0.05 || Math.hypot(rt.velocityX, rt.velocityZ) > 0.6;
    if (rt.isFlying && rt.y > 0.25) rt.moveAnim = "fly";
    else if (!rt.grounded || rt.y > 0.12) rt.moveAnim = "jump";
    else if (rt.isMoving) rt.moveAnim = "run";
    else rt.moveAnim = "idle";

    if (!rt.activeAttack && !dodging && now >= entity.hurtUntil && !locked) {
      entity.action = rt.isFlying ? "fly" : !rt.grounded ? "jump" : entity.isBlocking ? "block" : rt.isMoving ? "move" : "idle";
    }
  }

  private handlePlayerLoadout(client: Client, msg: PlayerLoadoutMessage): void {
    const ps = this.state.players.get(client.sessionId);
    if (!ps || !msg || typeof msg !== "object") return;

    if (msg.skin && Object.prototype.hasOwnProperty.call(PLAYER_SKINS, msg.skin)) {
      ps.skin = msg.skin as PlayerSkinKind;
    }
    if (
      msg.combatArt &&
      Object.prototype.hasOwnProperty.call(EXPERIMENTAL_ART_SERVER_SPECS, msg.combatArt)
    ) {
      ps.selectedArt = msg.combatArt as CombatArtKind;
    }
  }

  private handleRespawnMode(client: Client, msg: RespawnModeMessage): void {
    if (
      client.sessionId !== this.state.hostSessionId ||
      !msg ||
      (msg.mode !== "infinite" && msg.mode !== "wave_end")
    ) {
      return;
    }
    this.state.respawnMode = msg.mode as RespawnMode;
    if (msg.mode === "infinite") {
      this.playerRuntimes.forEach((rt, pid) => {
        const ps = this.state.players.get(pid);
        if (ps && !rt.entity.alive) {
          this.revivePlayer(rt, ps);
        }
      });
    }
  }

  private handleArenaMap(client: Client, msg: ArenaMapMessage): void {
    if (
      client.sessionId !== this.state.hostSessionId ||
      !msg ||
      !Object.prototype.hasOwnProperty.call(ARENA_MAPS, msg.map)
    ) {
      return;
    }
    this.state.arenaMap = msg.map as ArenaMapKind;
  }

  private handleToggleInfiniteHealth(client: Client, enabled: boolean): void {
    if (this.playerRuntimes.size !== 1) return;
    const rt = this.playerRuntimes.get(client.sessionId);
    const ps = this.state.players.get(client.sessionId);
    if (!rt || !ps) return;
    rt.entity.infiniteHealth = enabled;
    ps.infiniteHealth = enabled;
    if (enabled) {
      rt.entity.hp = rt.entity.maxHp;
      rt.entity.alive = true;
      ps.hp = rt.entity.hp;
      ps.alive = true;
    }
  }

  private handleCastSelectedArt(client: Client, msg: CastSelectedArtMessage): void {
    const ps = this.state.players.get(client.sessionId);
    if (!ps || !msg || !Number.isFinite(msg.yaw)) return;
    this.handleExperimentalArt(client, { art: ps.selectedArt, yaw: msg.yaw });
  }

  private revivePlayer(rt: PlayerRuntime, ps: PlayerState): void {
    this.knockbacks.delete(rt.entity.id);
    const spawn = ARENA.PLAYER_SPAWNS[rt.slot % ARENA.PLAYER_SPAWNS.length];
    rt.entity.x = spawn.x;
    rt.entity.y = 0;
    rt.entity.z = spawn.z;
    rt.entity.yaw = spawn.yaw;
    rt.entity.hp = COMBAT.PLAYER_MAX_HP;
    rt.entity.posture = 0;
    rt.entity.alive = true;
    rt.entity.isBlocking = false;
    rt.entity.dodgeInvulnUntil = 0;
    rt.entity.staggeredUntil = 0;
    rt.entity.hurtUntil = 0;
    rt.entity.action = "idle";
    rt.y = 0;
    rt.velocityX = 0;
    rt.velocityY = 0;
    rt.velocityZ = 0;
    rt.grounded = true;
    rt.jumpGraceUntil = 0;
    rt.moveX = 0;
    rt.moveZ = 0;
    rt.jumpPressed = false;
    rt.jumpHeld = false;
    rt.isFlying = false;
    rt.flightOriginX = spawn.x;
    rt.flightOriginZ = spawn.z;
    rt.flightUsedThisJump = false;
    rt.deadAt = 0;
    rt.isMoving = false;
    rt.moveAnim = "idle";
    rt.dodgeUntil = 0;
    rt.dodgeRemainingMs = 0;
    rt.dodgeCooldownUntil = 0;
    rt.counterReadyUntil = 0;
    rt.itemAnimUntil = 0;
    rt.activeAttack = null;
    rt.furyUntil = 0;
    rt.ironWillUntil = 0;
    rt.swiftFeetUntil = 0;
    rt.tonicUntil = 0;
    ps.x = spawn.x;
    ps.y = 0;
    ps.z = spawn.z;
    ps.yaw = spawn.yaw;
    ps.hp = COMBAT.PLAYER_MAX_HP;
    ps.posture = 0;
    ps.alive = true;
    ps.isBlocking = false;
    ps.action = "idle";
    ps.respawnTimer = 0;
  }

  private resetRunAfterTeamWipe(): void {
    this.state.wave = 0;
    this.state.waveActive = false;
    this.state.waveTitle = "";
    this.state.totalEnemiesInWave = 0;
    this.state.enemiesRemaining = 0;
    this.state.skeletonsDefeated = 0;
    this.waveQueue = [];
    this.waveMaxConcurrent = 3;
    this.waveHpScale = 1.0;
    this.nextWaveSpawnAt = 0;
    this.nextEnemySeq = 1;
    this.gateOpenUntil = 0;
    this.state.northGate.open = false;
    this.state.northGate.openProgress = 0;
    this.state.northGate.cooldownMs = 0;
    this.state.northGate.activations = 0;

    this.enemyRuntimes.clear();
    this.state.enemies.clear();
    this.pilumRuntimes.clear();
    this.state.pilums.clear();
    this.pendingArtPulses = [];

    this.playerRuntimes.forEach((rt, id) => {
      const ps = this.state.players.get(id);
      if (!ps) return;
      this.revivePlayer(rt, ps);
      ps.kills = 0;
      ps.pvpKills = 0;
      ps.deaths = 0;
      rt.whirlwindReadyAt = 0;
      rt.experimentalArtReadyAt = {};
      rt.belt.forEach((slot) => {
        slot.kind = "";
        slot.charges = 0;
      });
    });

    this.state.pickups.clear();
    this.nextPickupSeq = 1;
    this.spawnRandomArenaPickups(3);
    this.nextPickupSpawnAt = Date.now() + COMBAT.PICKUP_RESPAWN_MS;
  }

  private handleAttack(client: Client, msg: AttackMessage): void {
    if (!msg || typeof msg !== "object") return;
    const rt = this.playerRuntimes.get(client.sessionId);
    if (!rt || !rt.entity.alive) return;
    if (this.knockbacks.has(client.sessionId)) return;

    const now = Date.now();
    if (now < rt.entity.staggeredUntil || now < rt.dodgeUntil || now < rt.entity.hurtUntil) return;

    // Allow late-recovery combo chaining for light1 -> light2
    if (rt.activeAttack) {
      const activeSpec = ATTACK_SPECS[rt.activeAttack.kind];
      const elapsed = now - rt.activeAttack.startedAt;
      const inLateRecovery = elapsed >= activeSpec.windupMs + activeSpec.activeMs + 60;
      if (msg.kind === "light" && rt.activeAttack.kind === "light1" && inLateRecovery) {
        rt.lastLightEndedAt = now;
        rt.activeAttack = null;
      } else {
        return;
      }
    }

    if (Number.isFinite(msg.yaw)) {
      rt.entity.yaw = msg.yaw;
    }
    rt.entity.isBlocking = false;

    let kind: AttackKind;
    if (msg.kind === "punch") {
      kind = "punch";
      rt.comboStep = 1;
    } else if (msg.kind === "aerial") {
      kind = "aerial_slam";
    } else if (msg.kind === "heavy") {
      kind = "heavy";
    } else if (now <= rt.counterReadyUntil) {
      // Perfect Parry Riposte Counterattack!
      kind = "counter";
      rt.counterReadyUntil = 0;
    } else {
      const chainSecond = now - rt.lastLightEndedAt <= COMBAT.COMBO_WINDOW_MS && rt.comboStep === 1;
      kind = chainSecond ? "light2" : "light1";
      rt.comboStep = kind === "light1" ? 1 : 2;
    }

    this.startPlayerAttack(rt, kind, now);
  }

  private handleSpecial(client: Client, msg: SpecialMessage): void {
    if (!msg || typeof msg !== "object") return;
    const rt = this.playerRuntimes.get(client.sessionId);
    if (!rt || !rt.entity.alive) return;
    if (this.knockbacks.has(client.sessionId)) return;

    const now = Date.now();
    if (now < rt.entity.staggeredUntil || now < rt.dodgeUntil || now < rt.entity.hurtUntil) return;
    if (rt.activeAttack) return;

    if (msg.kind === "whirlwind") {
      if (now < rt.whirlwindReadyAt) return;
      rt.whirlwindReadyAt = now + SPECIAL_MOVES.whirlwind.cooldownMs;
    } else {
      return;
    }

    if (Number.isFinite(msg.yaw)) {
      rt.entity.yaw = msg.yaw;
    }
    rt.entity.isBlocking = false;
    this.startPlayerAttack(rt, msg.kind, now);
  }

  private startPlayerAttack(rt: PlayerRuntime, kind: AttackKind, now: number): void {
    rt.activeAttack = {
      kind,
      startedAt: now,
      hitIds: new Set(),
    };
    rt.entity.action = kind;

    const isHeavy = kind !== "light1" && kind !== "light2";
    this.broadcastCombatEvent({
      kind: "swing",
      x: rt.entity.x,
      y: rt.y + 1.2,
      z: rt.entity.z,
      yaw: rt.entity.yaw,
      attackerId: rt.entity.id,
      attackerName: rt.entity.name,
      heavy: isHeavy,
      moveKind: kind,
    });

    this.broadcastCombatEvent({
      kind: "special_vfx",
      x: rt.entity.x,
      y: rt.y + 1.15,
      z: rt.entity.z,
      yaw: rt.entity.yaw,
      attackerId: rt.entity.id,
      attackerName: rt.entity.name,
      moveKind: kind,
      heavy: isHeavy,
    });
  }

  private launchPunchTarget(targetId: string, attackerId: string, now: number): void {
    const attacker = this.playerRuntimes.get(attackerId)?.entity;
    const playerTarget = this.playerRuntimes.get(targetId);
    const enemyTarget = this.enemyRuntimes.get(targetId);
    const botTarget = this.team3v3.bots.get(targetId);
    const target = playerTarget?.entity ?? enemyTarget?.entity ?? botTarget?.entity;
    if (!attacker || !target || !target.alive) return;

    const dx = target.x - attacker.x;
    const dz = target.z - attacker.z;
    const distance = Math.hypot(dx, dz);
    const dirX = distance > 0.001 ? dx / distance : Math.sin(attacker.yaw);
    const dirZ = distance > 0.001 ? dz / distance : Math.cos(attacker.yaw);

    const isBoss = Boolean(enemyTarget && ENEMY_ARCHETYPES[enemyTarget.kind]?.isBoss);
    // Crisp, weighty arc (~7.5m horizontal toss, ~2.2m apex, ~0.76s flight; bosses resist slightly more)
    const horizSpeed = isBoss ? 8.8 : 11.4;
    const launchVy = isBoss ? 8.8 : 11.4;
    const startY = Math.max(0.05, target.y ?? 0);

    this.knockbacks.set(targetId, {
      vx: dirX * horizSpeed,
      vy: launchVy,
      vz: dirZ * horizSpeed,
      y: startY,
    });
    target.y = startY;
    target.isBlocking = false;
    target.hurtUntil = now + 820;
    target.action = "jump";
    if (playerTarget) {
      playerTarget.velocityX = 0;
      playerTarget.velocityY = launchVy;
      playerTarget.velocityZ = 0;
      playerTarget.grounded = false;
      playerTarget.moveX = 0;
      playerTarget.moveZ = 0;
      playerTarget.jumpPressed = false;
      playerTarget.jumpHeld = false;
      playerTarget.isFlying = false;
      playerTarget.flightUsedThisJump = false;
      playerTarget.activeAttack = null;
      playerTarget.dodgeUntil = 0;
      playerTarget.y = startY;
      playerTarget.isMoving = false;
    }
    if (enemyTarget) {
      enemyTarget.activeAttack = null;
      enemyTarget.emerging = false;
    }
    if (botTarget) {
      botTarget.activeAttack = null;
    }
  }

  private handleUseItem(client: Client, msg: UseItemMessage): void {
    if (!msg || typeof msg !== "object") return;
    const rt = this.playerRuntimes.get(client.sessionId);
    if (!rt || !rt.entity.alive) return;
    if (this.knockbacks.has(client.sessionId)) return;

    const idx = msg?.slotIndex;
    if (
      typeof idx !== "number" ||
      !Number.isInteger(idx) ||
      idx < 0 ||
      idx >= COMBAT.INVENTORY_SLOTS
    ) {
      return;
    }

    const slot = rt.belt[idx];
    if (!slot || !slot.kind || slot.charges <= 0) return;

    const now = Date.now();
    if (
      now < rt.entity.staggeredUntil ||
      now < rt.dodgeUntil ||
      now < rt.entity.hurtUntil ||
      rt.activeAttack
    ) {
      return;
    }

    const kind = slot.kind;
    if (kind === "healing_flask") {
      rt.entity.hp = Math.min(rt.entity.maxHp, rt.entity.hp + COMBAT.HEALING_FLASK_HP);
      rt.itemAnimUntil = now + 420;
      rt.itemAnimName = "use_item";
    } else if (kind === "posture_tonic") {
      rt.entity.posture = 0;
      rt.entity.staggeredUntil = 0;
      rt.tonicUntil = now + POWER_UPS.posture_tonic.durationMs;
      rt.itemAnimUntil = now + 420;
      rt.itemAnimName = "use_item";
    } else if (kind === "warriors_fury") {
      rt.furyUntil = now + POWER_UPS.warriors_fury.durationMs;
      rt.itemAnimUntil = now + 380;
      rt.itemAnimName = "use_item";
    } else if (kind === "iron_will") {
      rt.ironWillUntil = now + POWER_UPS.iron_will.durationMs;
      rt.itemAnimUntil = now + 380;
      rt.itemAnimName = "use_item";
    } else if (kind === "swift_feet") {
      rt.swiftFeetUntil = now + POWER_UPS.swift_feet.durationMs;
      rt.itemAnimUntil = now + 380;
      rt.itemAnimName = "use_item";
    }

    slot.charges -= 1;
    if (slot.charges <= 0) {
      slot.kind = "";
      slot.charges = 0;
    }

    this.broadcastCombatEvent({
      kind: "powerup_use",
      x: rt.entity.x,
      y: rt.y + 1.2,
      z: rt.entity.z,
      yaw: rt.entity.yaw,
      attackerId: rt.entity.id,
      attackerName: rt.entity.name,
      powerUpKind: kind,
    });
  }

  private spawnProjectile(opts: {
    kind: ProjectileKind;
    ownerId: string;
    x: number;
    y: number;
    z: number;
    yaw: number;
    pitch: number;
    speed: number;
    hpDamage: number;
    postureDamage: number;
    aoeRadius?: number;
    stunMs?: number;
    homingTargetId?: string;
    lifetimeMs: number;
    now: number;
  }): void {
    const id = `pilum_${this.nextPilumSeq++}`;
    const clampedPitch = Math.max(-0.95, Math.min(1.15, opts.pitch));
    const cosP = Math.cos(clampedPitch);
    const fwd = forwardFromYaw(opts.yaw);
    const vx = fwd.x * cosP * opts.speed;
    const vy = Math.sin(clampedPitch) * opts.speed;
    const vz = fwd.z * cosP * opts.speed;

    const ps = new PilumState();
    ps.id = id;
    ps.kind = opts.kind;
    ps.ownerId = opts.ownerId;
    ps.x = opts.x;
    ps.y = opts.y;
    ps.z = opts.z;
    ps.vx = vx;
    ps.vy = vy;
    ps.vz = vz;
    ps.yaw = opts.yaw;
    this.state.pilums.set(id, ps);

    this.pilumRuntimes.set(id, {
      id,
      kind: opts.kind,
      ownerId: opts.ownerId,
      x: opts.x,
      y: opts.y,
      z: opts.z,
      vx,
      vy,
      vz,
      yaw: opts.yaw,
      hpDamage: opts.hpDamage,
      postureDamage: opts.postureDamage,
      aoeRadius: opts.aoeRadius,
      stunMs: opts.stunMs,
      homingTargetId: opts.homingTargetId,
      expiresAt: opts.now + opts.lifetimeMs,
    });
  }

  private handleCastAbility(client: Client, msg: CastAbilityMessage): void {
    if (!msg || typeof msg !== "object") return;
    const rt = this.playerRuntimes.get(client.sessionId);
    if (!rt || !rt.entity.alive) return;
    if (this.knockbacks.has(client.sessionId)) return;

    const abilityKind = msg.ability;
    if (!Object.prototype.hasOwnProperty.call(PLAYER_ABILITIES, abilityKind)) return;
    const spec = PLAYER_ABILITIES[abilityKind];

    const now = Date.now();
    if (
      now < rt.entity.staggeredUntil ||
      (rt.entity.shockedUntil && now < rt.entity.shockedUntil) ||
      now < rt.dodgeUntil ||
      now < rt.entity.hurtUntil ||
      now < rt.abilityReadyAt
    ) {
      return;
    }

    const yaw = Number.isFinite(msg.yaw) ? msg.yaw : rt.entity.yaw;
    const pitch = typeof msg.pitch === "number" && Number.isFinite(msg.pitch) ? msg.pitch : 0.02;
    rt.entity.yaw = yaw;
    rt.entity.isBlocking = false;
    rt.selectedAbility = abilityKind;
    rt.abilityReadyAt = now + spec.cooldownMs;
    rt.itemAnimUntil = now + 380;
    rt.itemAnimName =
      abilityKind === "fireball"
        ? "cast_fireball"
        : abilityKind === "arcane_spell"
          ? "cast_arcane"
          : "shoot_stun";

    const fwd = forwardFromYaw(yaw);
    const originX = rt.entity.x + fwd.x * 0.95;
    const originY = rt.y + 1.38;
    const originZ = rt.entity.z + fwd.z * 0.95;

    if (abilityKind === "arcane_spell") {
      // Find nearest living opponent for gentle homing
      let nearestId: string | undefined;
      let bestDist = 22 * 22;
      this.enemyRuntimes.forEach((e) => {
        if (!e.entity.alive) return;
        const dSq = (e.entity.x - rt.entity.x) ** 2 + (e.entity.z - rt.entity.z) ** 2;
        if (dSq < bestDist) {
          bestDist = dSq;
          nearestId = e.entity.id;
        }
      });
      for (const offset of [-0.14, 0.14]) {
        this.spawnProjectile({
          kind: "arcane_orb",
          ownerId: rt.entity.id,
          x: originX,
          y: originY,
          z: originZ,
          yaw: yaw + offset,
          pitch,
          speed: spec.speed,
          hpDamage: Math.round(spec.hpDamage * 0.6),
          postureDamage: Math.round(spec.postureDamage * 0.6),
          aoeRadius: spec.aoeRadius,
          homingTargetId: nearestId,
          lifetimeMs: 1800,
          now,
        });
      }
      this.broadcastCombatEvent({
        kind: "spell_cast",
        x: originX,
        y: originY,
        z: originZ,
        yaw,
        attackerId: rt.entity.id,
        attackerName: rt.entity.name,
        abilityKind,
      });
    } else {
      this.spawnProjectile({
        kind: spec.projectileKind,
        ownerId: rt.entity.id,
        x: originX,
        y: originY,
        z: originZ,
        yaw,
        pitch,
        speed: spec.speed,
        hpDamage: spec.hpDamage,
        postureDamage: spec.postureDamage,
        aoeRadius: spec.aoeRadius,
        stunMs: spec.stunMs,
        lifetimeMs: abilityKind === "stun_gun" ? 950 : 1700,
        now,
      });
      this.broadcastCombatEvent({
        kind: abilityKind === "stun_gun" ? "stun_shot" : "spell_cast",
        x: originX,
        y: originY,
        z: originZ,
        yaw,
        attackerId: rt.entity.id,
        attackerName: rt.entity.name,
        abilityKind,
      });
    }
  }

  private handleBlock(client: Client, msg: BlockMessage): void {
    if (!msg || typeof msg !== "object") return;
    const rt = this.playerRuntimes.get(client.sessionId);
    if (!rt || !rt.entity.alive) return;
    if (this.knockbacks.has(client.sessionId)) {
      rt.entity.isBlocking = false;
      return;
    }

    const now = Date.now();
    if (now < rt.entity.staggeredUntil) {
      rt.entity.isBlocking = false;
      return;
    }

    if (Number.isFinite(msg.yaw)) {
      rt.entity.yaw = msg.yaw;
    }

    if (msg.active) {
      if (rt.activeAttack) {
        const spec = ATTACK_SPECS[rt.activeAttack.kind];
        const elapsed = now - rt.activeAttack.startedAt;
        const inCancelableWindow =
          elapsed < spec.windupMs * 0.65 || elapsed > spec.windupMs + spec.activeMs;
        if (inCancelableWindow) {
          rt.activeAttack = null;
        } else {
          return;
        }
      }
      if (!rt.entity.isBlocking) {
        rt.entity.isBlocking = true;
        rt.entity.blockStartedAt = now;
      }
    } else {
      rt.entity.isBlocking = false;
    }
  }

  private handleDodge(client: Client, msg: DodgeMessage): void {
    if (!msg || typeof msg !== "object") return;
    const rt = this.playerRuntimes.get(client.sessionId);
    if (!rt || !rt.entity.alive) return;
    if (this.knockbacks.has(client.sessionId)) return;

    const now = Date.now();
    if (now < rt.entity.staggeredUntil || now < rt.dodgeCooldownUntil) return;

    rt.activeAttack = null;
    rt.entity.isBlocking = false;
    const swiftMult = now < rt.swiftFeetUntil ? 0.78 : 1.0;
    rt.dodgeUntil = now + COMBAT.DODGE_DURATION_MS;
    rt.dodgeRemainingMs = COMBAT.DODGE_DURATION_MS;
    rt.dodgeCooldownUntil = now + Math.round(COMBAT.DODGE_COOLDOWN_MS * swiftMult);
    rt.entity.dodgeInvulnUntil = now + COMBAT.DODGE_IFRAMES_MS;

    const len = Math.hypot(msg.dirX, msg.dirZ);
    if (len > 0.01) {
      rt.dodgeDirX = msg.dirX / len;
      rt.dodgeDirZ = msg.dirZ / len;
    } else {
      rt.dodgeDirX = Math.sin(rt.entity.yaw);
      rt.dodgeDirZ = Math.cos(rt.entity.yaw);
    }
    if (Number.isFinite(msg.yaw)) {
      rt.entity.yaw = msg.yaw;
    }
    rt.entity.action = "dodge";
  }

  private handleInteractGate(client: Client): void {
    if (this.state.gameMode === "team_3v3" || this.state.gameMode === "ffa") return;
    const rt = this.playerRuntimes.get(client.sessionId);
    if (!rt || !rt.entity.alive) return;

    const gate = this.state.northGate;
    if (this.state.waveActive || gate.cooldownMs > 0) return;

    const dx = rt.entity.x - ARENA.NORTH_GATE.leverX;
    const dz = rt.entity.z - ARENA.NORTH_GATE.leverZ;
    if (Math.hypot(dx, dz) > ARENA.NORTH_GATE.interactRadius + 0.9) return;

    const now = Date.now();
    if (this.state.gameMode === "boss_rush") {
      const nextTrial = Math.min(BOSS_RUSH_TRIALS.length, this.state.bossTrial + 1);
      this.startBossRushTrial(nextTrial, rt.entity.id, rt.entity.name, now);
      return;
    }

    const nextWave = this.state.wave + 1;
    const plan = getWavePlan(nextWave);

    this.state.wave = nextWave;
    this.state.waveActive = true;
    this.state.waveTitle = plan.title;
    this.state.totalEnemiesInWave = plan.enemies.length;
    this.state.enemiesRemaining = plan.enemies.length;

    this.waveQueue = [...plan.enemies];
    this.waveMaxConcurrent = plan.maxConcurrent;
    this.waveHpScale = plan.hpScale;

    gate.open = true;
    gate.cooldownMs = COMBAT.GATE_COOLDOWN_MS;
    gate.activations += 1;
    this.gateOpenUntil = now + 3200;

    this.broadcastCombatEvent({
      kind: "gate_open",
      x: ARENA.NORTH_GATE.x,
      y: 2.2,
      z: ARENA.NORTH_GATE.z,
      attackerId: rt.entity.id,
      attackerName: rt.entity.name,
    });

    this.broadcastCombatEvent({
      kind: "wave_start",
      x: ARENA.NORTH_GATE.x,
      y: 2.4,
      z: ARENA.NORTH_GATE.z,
      attackerId: rt.entity.id,
      attackerName: rt.entity.name,
      wave: nextWave,
      waveTitle: plan.title,
    });

    const firstKind = this.waveQueue.shift();
    if (firstKind) {
      this.spawnEnemyByKind(firstKind, this.waveHpScale);
    }
    this.nextWaveSpawnAt = now + COMBAT.WAVE_SPAWN_INTERVAL_MS;

    // Randomize/refresh arena power-ups between gate wave activations
    if (this.state.pickups.size < COMBAT.MAX_ARENA_PICKUPS) {
      this.spawnRandomArenaPickups(1);
    }
  }

  private startBossRushTrial(
    trialNumber: number,
    initiatorId: string,
    initiatorName: string,
    now: number
  ): void {
    const trial = BOSS_RUSH_TRIALS[trialNumber - 1] ?? BOSS_RUSH_TRIALS[0];
    this.state.bossTrial = trial.trial;
    this.state.bossTrialTitle = trial.title;
    this.state.wave = trial.trial;
    this.state.waveActive = true;
    this.state.waveTitle = trial.title;
    this.state.totalEnemiesInWave = trial.bosses.length;
    this.state.enemiesRemaining = trial.bosses.length;
    this.waveQueue = [...trial.bosses];
    this.waveMaxConcurrent = trial.bosses.length;
    this.waveHpScale = 1 + (trial.trial - 1) * 0.08;

    const gate = this.state.northGate;
    gate.open = true;
    gate.cooldownMs = COMBAT.GATE_COOLDOWN_MS;
    gate.activations += 1;
    this.gateOpenUntil = now + 3400;

    this.broadcastCombatEvent({
      kind: "boss_trial_start",
      x: ARENA.NORTH_GATE.x,
      y: 2.4,
      z: ARENA.NORTH_GATE.z,
      attackerId: initiatorId,
      attackerName: initiatorName,
      wave: trial.trial,
      waveTitle: trial.title,
    });

    const first = this.waveQueue.shift();
    if (first) this.spawnEnemyByKind(first, this.waveHpScale);
    this.nextWaveSpawnAt = now + 900;
  }

  private startFfaMatch(clientId: string): void {
    if (clientId !== this.state.hostSessionId || this.state.gameMode !== "ffa") return;
    this.state.ffaWinnerName = "";
    this.state.ffaTargetScore = FFA_CONFIG.TARGET_SCORE;
    this.state.ffaZoneOwnerId = "";
    this.state.ffaZoneProgress = 0;
    this.enemyRuntimes.clear();
    this.state.enemies.clear();

    let idx = 0;
    this.playerRuntimes.forEach((rt, id) => {
      const ps = this.state.players.get(id);
      if (!ps) return;
      this.revivePlayer(rt, ps);
      const angle = (idx / Math.max(1, this.playerRuntimes.size)) * Math.PI * 2;
      const sx = Math.sin(angle) * 14;
      const sz = Math.cos(angle) * 14;
      rt.entity.x = sx;
      rt.entity.z = sz;
      rt.entity.yaw = yawFromDelta(-sx, -sz);
      ps.x = sx;
      ps.z = sz;
      ps.yaw = rt.entity.yaw;
      ps.ffaScore = 0;
      rt.ffaZoneMs = 0;
      idx++;
    });

    if (this.state.teamFillBots) {
      const ffaKinds: EnemyKind[] = ["mist_shinobi", "pyromancer", "assassin", "stun_drone", "dire_wolf"];
      for (let i = 0; i < FFA_CONFIG.BOT_COUNT; i++) {
        this.spawnEnemyByKind(ffaKinds[i % ffaKinds.length], 0.9);
      }
    }
    this.broadcastCombatEvent({
      kind: "wave_start",
      x: 0,
      y: 2,
      z: 0,
      wave: 1,
      waveTitle: "Mythic Free-For-All — First to 10",
    });
  }

  private finishFfaMatch(winnerName: string): void {
    this.state.ffaWinnerName = winnerName;
    this.enemyRuntimes.clear();
    this.state.enemies.clear();
    this.broadcastCombatEvent({
      kind: "ffa_win",
      x: 0,
      y: 2.5,
      z: 0,
      winnerName,
      score: this.state.ffaTargetScore,
    });
  }

  private handleExperimentalArt(client: Client, msg: ExperimentalArtMessage): void {
    if (!msg || typeof msg !== "object") return;
    const rt = this.playerRuntimes.get(client.sessionId);
    if (!rt || !rt.entity.alive) return;
    if (this.knockbacks.has(client.sessionId)) return;

    const rawArt = msg?.art;
    if (
      typeof rawArt !== "string" ||
      !Object.prototype.hasOwnProperty.call(EXPERIMENTAL_ART_SERVER_SPECS, rawArt)
    ) {
      return;
    }
    const art = rawArt as ExperimentalArtKind;
    const playerState = this.state.players.get(client.sessionId);
    if (!playerState) return;
    const pulseSpecs = EXPERIMENTAL_ART_SERVER_SPECS[art];

    const now = Date.now();
    const preview = Boolean(msg.preview);
    if (!preview && playerState.selectedArt !== art) return;
    if (
      !preview &&
      (now < rt.entity.staggeredUntil ||
        now < rt.dodgeUntil ||
        now < rt.entity.hurtUntil ||
        Boolean(rt.activeAttack) ||
        now < (rt.experimentalArtReadyAt[art] ?? 0))
    ) {
      return;
    }

    if (Number.isFinite(msg.yaw)) {
      rt.entity.yaw = msg.yaw;
    }
    if (!preview) {
      rt.entity.isBlocking = false;
      rt.activeAttack = null;
      rt.experimentalArtReadyAt[art] = now + EXPERIMENTAL_ART_COOLDOWNS_MS[art];
    }

    this.broadcast("experimental_art", {
      art,
      attackerId: rt.entity.id,
      attackerName: rt.entity.name,
      x: rt.entity.x,
      y: rt.y,
      z: rt.entity.z,
      yaw: rt.entity.yaw,
      preview,
    });

    if (preview) return;

    // Replace any un-fired pulses from this attacker before queuing new slash windows
    this.pendingArtPulses = this.pendingArtPulses.filter((p) => p.attackerId !== rt.entity.id);

    for (const spec of pulseSpecs) {
      const { offsetMs, ...pulseProps } = spec;
      this.pendingArtPulses.push({
        attackerId: rt.entity.id,
        art,
        triggerAt: now + offsetMs,
        ...pulseProps,
      });
    }
  }

  private resolveExperimentalArtPulse(
    pulse: ExperimentalArtPulse,
    allCombatEntities: CombatEntity[],
    now: number
  ): void {
    const attacker =
      this.playerRuntimes.get(pulse.attackerId)?.entity ??
      this.team3v3.getBotEntity(pulse.attackerId);
    if (!attacker || !attacker.alive || now < attacker.staggeredUntil) {
      return;
    }

    const fwd = forwardFromYaw(attacker.yaw);
    const outDmgMult = attacker.damageOutMult ?? 1.0;
    const outPostureMult = attacker.postureOutMult ?? 1.0;
    let contactedTarget = false;

    for (const target of allCombatEntities) {
      if (target.id === attacker.id || !target.alive) continue;
      if (attacker.team && target.team && attacker.team === target.team) continue;

      if (Math.abs((attacker.y ?? 0) - (target.y ?? 0)) > 1.85) continue;

      const dx = target.x - attacker.x;
      const dz = target.z - attacker.z;
      const dist = Math.hypot(dx, dz);
      if (dist > pulse.range) continue;

      if (pulse.arcDot > -0.99 && dist > 0.45) {
        const dot = fwd.x * (dx / dist) + fwd.z * (dz / dist);
        if (dot < pulse.arcDot) continue;
      }

      const midX = (attacker.x + target.x) * 0.5;
      const midZ = (attacker.z + target.z) * 0.5;
      const isPvP = attacker.isPlayer && target.isPlayer;
      const inDmgMult = target.damageInMult ?? 1.0;

      // 1. Dodge i-frames
      if (now < target.dodgeInvulnUntil) {
        this.broadcastCombatEvent({
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

      // 2. Facing Block / Perfect Deflect
      let facingAttacker = false;
      if (target.isBlocking && now >= target.staggeredUntil) {
        const targetFwd = forwardFromYaw(target.yaw);
        const toAttackerX = dist > 0.001 ? -dx / dist : -fwd.x;
        const toAttackerZ = dist > 0.001 ? -dz / dist : -fwd.z;
        const blockDot = targetFwd.x * toAttackerX + targetFwd.z * toAttackerZ;
        facingAttacker = blockDot >= COMBAT.BLOCK_FACING_DOT;
      }

      const blockElapsed = now - target.blockStartedAt;

      if (facingAttacker && blockElapsed <= COMBAT.DEFLECT_WINDOW_MS) {
        contactedTarget = true;
        target.posture = Math.min(target.maxPosture - 1, target.posture + pulse.deflectSelfPosture);
        target.lastPostureHitAt = now;
        target.onDeflected?.(attacker, now);

        attacker.posture = Math.min(
          attacker.maxPosture,
          attacker.posture + pulse.deflectAttackerPosture
        );
        attacker.lastPostureHitAt = now;

        this.broadcastCombatEvent({
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
          heavy: pulse.heavy,
          moveKind: pulse.moveKind,
        });

        if (attacker.posture >= attacker.maxPosture) {
          attacker.staggeredUntil = now + COMBAT.STAGGER_DURATION_MS;
          attacker.action = "staggered";
          attacker.isBlocking = false;
          this.broadcastCombatEvent({
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

      if (facingAttacker) {
        contactedTarget = true;
        const blockPosture = Math.round(pulse.blockPostureDamage * outPostureMult * inDmgMult);
        const chipHp = Math.round(pulse.blockChipHp * outDmgMult * inDmgMult);
        target.posture = Math.min(target.maxPosture, target.posture + blockPosture);
        target.lastPostureHitAt = now;
        if (chipHp > 0 && !target.infiniteHealth) {
          target.hp = Math.max(1, target.hp - chipHp);
        }

        this.broadcastCombatEvent({
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
          moveKind: pulse.moveKind,
        });

        if (target.posture >= target.maxPosture) {
          target.staggeredUntil = now + COMBAT.STAGGER_DURATION_MS;
          target.action = "staggered";
          target.isBlocking = false;
          this.broadcastCombatEvent({
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

      // 3. Direct Hit (with Permanent Friendly Fire, Stagger Bonus, Fury & Iron Will)
      contactedTarget = true;
      const wasStaggered = now < target.staggeredUntil;
      const staggerMult = wasStaggered ? COMBAT.STAGGER_DAMAGE_MULT : 1;
      const finalDamage = Math.max(
        1,
        Math.round(pulse.hpDamage * outDmgMult * inDmgMult * staggerMult)
      );
      const finalPosture = Math.round(pulse.postureDamage * outPostureMult * inDmgMult);

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

      this.broadcastCombatEvent({
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
        heavy: wasStaggered || pulse.heavy,
        moveKind: pulse.moveKind,
      });

      if (target.hp <= 0) {
        target.alive = false;
        target.action = "dead";
        target.isBlocking = false;
        target.onKilled?.(attacker);
        this.broadcastCombatEvent({
          kind: "kill",
          x: target.x,
          y: 1.0,
          z: target.z,
          attackerId: attacker.id,
          attackerName: attacker.name,
          targetId: target.id,
          targetName: target.name,
          isPvP,
          moveKind: pulse.moveKind,
        });
      } else if (!wasStaggered && target.posture >= target.maxPosture) {
        target.staggeredUntil = now + COMBAT.STAGGER_DURATION_MS;
        target.action = "staggered";
        target.isBlocking = false;
        this.broadcastCombatEvent({
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

    if (
      contactedTarget &&
      pulse.postureRecover &&
      pulse.postureRecover > 0 &&
      now >= attacker.staggeredUntil
    ) {
      attacker.posture = Math.max(0, attacker.posture - pulse.postureRecover);
    }
  }

  private spawnRandomArenaPickups(count: number): void {
    const occupied: { x: number; z: number }[] = [];
    this.state.pickups.forEach((p) => occupied.push({ x: p.x, z: p.z }));

    const candidates = ARENA.PICKUP_SPAWNS.filter(
      (pt) => !occupied.some((o) => Math.hypot(o.x - pt.x, o.z - pt.z) < 3.0)
    );
    // Fisher-Yates shuffle candidates
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }

    for (let i = 0; i < Math.min(count, candidates.length); i++) {
      if (this.state.pickups.size >= COMBAT.MAX_ARENA_PICKUPS) break;
      const pt = candidates[i];
      const kind = ALL_POWERUP_KINDS[Math.floor(Math.random() * ALL_POWERUP_KINDS.length)];
      this.createPickup(kind, pt.x, pt.z);
    }
  }

  private createPickup(kind: PowerUpKind, x: number, z: number): void {
    const clamped = clampToArena(x, z, 0.6);
    const id = `pu_${this.nextPickupSeq++}`;
    const ps = new PickupState();
    ps.id = id;
    ps.kind = kind;
    ps.x = clamped.x;
    ps.z = clamped.z;
    this.state.pickups.set(id, ps);
  }

  private tryCollectPickup(rt: PlayerRuntime, pickup: PickupState, now: number = Date.now()): boolean {
    const kind = pickup.kind as PowerUpKind;
    const spec = POWER_UPS[kind];
    if (!spec) return false;

    // Iron Will and Swift Feet activate immediately upon pickup!
    if (kind === "iron_will" || kind === "swift_feet") {
      if (kind === "iron_will") {
        rt.ironWillUntil = now + POWER_UPS.iron_will.durationMs;
      } else {
        rt.swiftFeetUntil = now + POWER_UPS.swift_feet.durationMs;
      }
      this.broadcastCombatEvent({
        kind: "powerup_use",
        x: rt.entity.x,
        y: rt.y + 1.2,
        z: rt.entity.z,
        yaw: rt.entity.yaw,
        attackerId: rt.entity.id,
        attackerName: rt.entity.name,
        powerUpKind: kind,
      });
      return true;
    }

    const empty = rt.belt.find((s) => !s.kind || s.charges <= 0);
    if (!empty) return false;

    empty.kind = kind;
    empty.charges = spec.charges;
    return true;
  }

  private spawnEnemyByKind(kind: EnemyKind, hpScale = 1.0): void {
    const spec = ENEMY_ARCHETYPES[kind] ?? ENEMY_ARCHETYPES.legionary;
    const id = `skel_${this.nextEnemySeq++}`;
    const name = spec.name;
    const maxHp = Math.round(spec.maxHp * hpScale);
    const maxPosture = spec.maxPosture;
    const spawnX = ARENA.NORTH_GATE.spawnX + (Math.random() - 0.5) * 1.4;
    const spawnZ = ARENA.NORTH_GATE.spawnZ;

    const es = new EnemyState();
    es.id = id;
    es.kind = kind;
    es.name = name;
    es.x = spawnX;
    es.z = spawnZ;
    es.yaw = 0;
    es.hp = maxHp;
    es.maxHp = maxHp;
    es.posture = 0;
    es.maxPosture = maxPosture;
    es.action = "chase";
    es.telegraph = "none";
    es.isBlocking = false;
    es.alive = true;
    this.state.enemies.set(id, es);

    const entity: CombatEntity = {
      id,
      name,
      isPlayer: false,
      x: spawnX,
      y: 0,
      z: spawnZ,
      yaw: 0,
      hp: maxHp,
      maxHp,
      posture: 0,
      maxPosture,
      alive: true,
      isBlocking: false,
      blockStartedAt: 0,
      dodgeInvulnUntil: 0,
      staggeredUntil: 0,
      hurtUntil: 0,
      lastPostureHitAt: 0,
      action: "chase",
      onKilled: (killer) => {
        this.state.skeletonsDefeated += 1;
        if (killer.isPlayer) {
          const killerState = this.state.players.get(killer.id);
          if (killerState) killerState.kills += 1;
        }
        const rt = this.enemyRuntimes.get(id);
        if (rt) {
          rt.deadAt = Date.now();
          // Occasional consumable drop right where the defeated enemy falls!
          if (
            this.state.pickups.size < COMBAT.MAX_ARENA_PICKUPS + 2 &&
            Math.random() <= COMBAT.ENEMY_DROP_CHANCE
          ) {
            const dropKind = ALL_POWERUP_KINDS[Math.floor(Math.random() * ALL_POWERUP_KINDS.length)];
            this.createPickup(dropKind, rt.entity.x, rt.entity.z);
          }
        }
      },
    };

    this.enemyRuntimes.set(id, {
      entity,
      kind,
      activeAttack: null,
      nextDecisionAt: Date.now() + 900,
      strafeDir: Math.random() < 0.5 ? -1 : 1,
      emerging: true,
      deadAt: 0,
      attackCounter: 0,
      blockUntil: 0,
      blockCooldownUntil: 0,
    });

    this.broadcastCombatEvent({
      kind: "spawn_enemy",
      x: spawnX,
      y: 1.2,
      z: ARENA.NORTH_GATE.z,
      targetId: id,
      targetName: name,
      enemyKind: kind,
    });
  }

  private step(deltaMs: number): void {
    const now = Date.now();
    const dtSec = Math.min(0.1, deltaMs / 1000);

    // 1. Wave reinforcement spawner + North Gate animation & cooldown
    const gate = this.state.northGate;
    if (gate.cooldownMs > 0) {
      gate.cooldownMs = Math.max(0, gate.cooldownMs - deltaMs);
    }

    if (this.state.waveActive && this.waveQueue.length > 0) {
      let aliveNow = 0;
      let anyEmerging = false;
      this.enemyRuntimes.forEach((e) => {
        if (e.entity.alive) {
          aliveNow++;
          if (e.emerging) anyEmerging = true;
        }
      });

      if (aliveNow < this.waveMaxConcurrent && now >= this.nextWaveSpawnAt) {
        const nextKind = this.waveQueue.shift();
        if (nextKind) {
          this.spawnEnemyByKind(nextKind, this.waveHpScale);
          aliveNow++;
          anyEmerging = true;
        }
        this.nextWaveSpawnAt = now + COMBAT.WAVE_SPAWN_INTERVAL_MS;
        gate.open = true;
        this.gateOpenUntil = Math.max(this.gateOpenUntil, now + 2600);
      } else if (anyEmerging || aliveNow < this.waveMaxConcurrent) {
        // Keep gate raised smoothly while queued reinforcements are emerging
        gate.open = true;
        this.gateOpenUntil = Math.max(this.gateOpenUntil, now + 1200);
      }
    }

    if (gate.open && now > this.gateOpenUntil) {
      gate.open = false;
    }
    const targetProgress = gate.open ? 1 : 0;
    const gateSpeed = dtSec * 1.4;
    if (gate.openProgress < targetProgress) {
      gate.openProgress = Math.min(1, gate.openProgress + gateSpeed);
    } else if (gate.openProgress > targetProgress) {
      gate.openProgress = Math.max(0, gate.openProgress - gateSpeed);
    }

    // Periodic random arena power-up spawn
    if (now >= this.nextPickupSpawnAt) {
      this.nextPickupSpawnAt = now + COMBAT.PICKUP_RESPAWN_MS;
      if (this.state.pickups.size < COMBAT.MAX_ARENA_PICKUPS) {
        this.spawnRandomArenaPickups(1);
      }
    }

    // Update player buff multipliers before combat resolution
    const allPlayerEntities: CombatEntity[] = [];
    this.playerRuntimes.forEach((p) => {
      p.entity.y = p.y;
      p.entity.damageOutMult = now < p.furyUntil ? COMBAT.FURY_DAMAGE_MULT : 1.0;
      p.entity.postureOutMult = now < p.furyUntil ? COMBAT.FURY_POSTURE_MULT : 1.0;
      p.entity.damageInMult = now < p.ironWillUntil ? COMBAT.IRON_WILL_DAMAGE_MULT : 1.0;
      p.entity.postureRecoveryMult = now < p.tonicUntil ? 2.4 : 1.0;
      allPlayerEntities.push(p.entity);
    });

    const allEnemyRuntimes: EnemyRuntime[] = [];
    const allCombatEntities: CombatEntity[] = [...allPlayerEntities];
    this.enemyRuntimes.forEach((e) => {
      e.entity.y = this.knockbacks.get(e.entity.id)?.y ?? e.entity.y ?? 0;
      allEnemyRuntimes.push(e);
      allCombatEntities.push(e.entity);
    });
    for (const botEntity of this.team3v3.getBotEntities()) {
      botEntity.y = this.knockbacks.get(botEntity.id)?.y ?? botEntity.y ?? 0;
      allCombatEntities.push(botEntity);
    }

    // 2. Step players & shared pickup collection
    this.playerRuntimes.forEach((rt, id) => {
      const entity = rt.entity;
      const ps = this.state.players.get(id);
      if (!ps) return;

      if (!entity.alive) {
        this.knockbacks.delete(id);
        if (
          (this.state.respawnMode === "wave_end" && this.state.waveActive) ||
          (this.state.gameMode === "team_3v3" && this.state.teamMatchActive)
        ) {
          ps.respawnTimer = 0;
        } else {
          const remaining = Math.max(0, COMBAT.RESPAWN_DELAY_MS - (now - rt.deadAt));
          ps.respawnTimer = Math.ceil(remaining / 1000);
          if (remaining <= 0) {
            this.revivePlayer(rt, ps);
          }
        }
      } else if (this.knockbacks.has(id)) {
        const knockback = this.knockbacks.get(id)!;
        const airDrag = Math.exp(-0.45 * dtSec);
        knockback.vx *= airDrag;
        knockback.vz *= airDrag;
        knockback.vy -= 30.0 * dtSec;
        knockback.y += knockback.vy * dtSec;
        const desiredX = entity.x + knockback.vx * dtSec;
        const desiredZ = entity.z + knockback.vz * dtSec;
        const clamped = clampToArena(
      desiredX,
      desiredZ,
      ARENA.ENTITY_RADIUS,
      false,
      this.state.arenaMap as ArenaMapKind
    );
        if (Math.hypot(clamped.x - desiredX, clamped.z - desiredZ) > 0.02) {
          // Thud cleanly off Colosseum wall or stone pillar instead of grinding along it
          knockback.vx *= 0.25;
          knockback.vz *= 0.25;
        }
        entity.x = clamped.x;
        entity.z = clamped.z;
        if (knockback.y <= 0 && knockback.vy < 0) {
          this.knockbacks.delete(id);
          rt.y = 0;
          rt.velocityX = 0;
          rt.velocityY = 0;
          rt.velocityZ = 0;
          rt.grounded = true;
          rt.flightUsedThisJump = false;
          entity.y = 0;
          entity.hurtUntil = Math.max(entity.hurtUntil, now + 260);
          entity.action = "hurt";
          this.broadcastCombatEvent({
            kind: "special_vfx",
            x: entity.x,
            y: 0.12,
            z: entity.z,
            yaw: entity.yaw,
            moveKind: "aerial_slam",
            heavy: false,
          });
        } else {
          rt.y = Math.max(0, Math.min(6.0, knockback.y));
          rt.velocityX = knockback.vx;
          rt.velocityY = knockback.vy;
          rt.velocityZ = knockback.vz;
          rt.grounded = false;
          entity.y = rt.y;
          entity.action = "knockback";
        }
      } else {
        updatePostureDecay(entity, now, dtSec);

        // Shared Pickup Collection (walking over item removes it for all players!)
        const collectedIds: string[] = [];
        this.state.pickups.forEach((pickup, pid) => {
          const dist = Math.hypot(entity.x - pickup.x, entity.z - pickup.z);
          if (dist <= COMBAT.PICKUP_COLLECT_RADIUS) {
            if (this.tryCollectPickup(rt, pickup, now)) {
              collectedIds.push(pid);
              this.broadcastCombatEvent({
                kind: "pickup_collect",
                x: pickup.x,
                y: 0.9,
                z: pickup.z,
                attackerId: entity.id,
                attackerName: entity.name,
                powerUpKind: pickup.kind as PowerUpKind,
              });
            }
          }
        });
        for (const pid of collectedIds) {
          this.state.pickups.delete(pid);
        }

        if (now < entity.staggeredUntil) {
          entity.action = "staggered";
          rt.activeAttack = null;
          entity.isBlocking = false;
          rt.isFlying = false;
        } else if (entity.shockedUntil && now < entity.shockedUntil) {
          entity.action = "shocked";
          rt.activeAttack = null;
          entity.isBlocking = false;
          rt.isFlying = false;
        } else if (entity.action === "staggered") {
          entity.posture = 0;
          entity.action = "idle";
        } else if (now < rt.dodgeUntil) {
          entity.action = "dodge";
          const swiftMult = now < rt.swiftFeetUntil ? COMBAT.SWIFT_FEET_SPEED_MULT : 1.0;
          const tickMs = dtSec * 1000;
          const stepMs = rt.dodgeRemainingMs > 0 ? Math.min(tickMs, rt.dodgeRemainingMs) : tickMs;
          if (rt.dodgeRemainingMs > 0) {
            rt.dodgeRemainingMs = Math.max(0, rt.dodgeRemainingMs - stepMs);
          }
          const stepDist = COMBAT.PLAYER_DODGE_SPEED * 0.72 * swiftMult * (stepMs / 1000);
          const clamped = clampToArena(
            entity.x + rt.dodgeDirX * stepDist,
            entity.z + rt.dodgeDirZ * stepDist,
            ARENA.ENTITY_RADIUS,
            false,
            this.state.arenaMap as ArenaMapKind
          );
          entity.x = clamped.x;
          entity.z = clamped.z;
        } else if (rt.activeAttack) {
          const spec = ATTACK_SPECS[rt.activeAttack.kind];
          if (isAttackFinished(rt.activeAttack, now)) {
            if (rt.activeAttack.kind === "light1" || rt.activeAttack.kind === "light2") {
              rt.lastLightEndedAt = now;
            }
            rt.activeAttack = null;
            entity.action = rt.isMoving ? "move" : "idle";
          } else {
            entity.action = rt.activeAttack.kind;
            // Authoritative forward lunge during special attacks (Dash Slash, Thrust, Counter, etc.)
            if (
              spec.lungeSpeed &&
              isAttackInActiveWindow(rt.activeAttack, now)
            ) {
              const fwd = forwardFromYaw(entity.yaw);
              const clamped = clampToArena(
                entity.x + fwd.x * spec.lungeSpeed * dtSec,
                entity.z + fwd.z * spec.lungeSpeed * dtSec
              );
              entity.x = clamped.x;
              entity.z = clamped.z;
            }
            const events = resolveMeleeSwing(entity, rt.activeAttack, allCombatEntities, now);
            for (const ev of events) {
              if (ev.kind === "hit" && ev.moveKind === "punch" && ev.targetId) {
                this.launchPunchTarget(ev.targetId, entity.id, now);
              }
              this.broadcastCombatEvent(ev);
            }
          }
        } else if (now < rt.itemAnimUntil) {
          entity.action = rt.itemAnimName;
        } else if (now < entity.hurtUntil) {
          entity.action = "hurt";
        } else if (entity.isBlocking) {
          entity.action = "block";
        } else {
          entity.action = rt.isFlying && rt.y > 0.25 ? "fly" : rt.y > 0.15 ? "jump" : rt.isMoving ? "move" : "idle";
        }
      }

      if (entity.alive && !this.knockbacks.has(id)) this.stepPlayerMotion(rt, deltaMs, now);
      if (!entity.alive || this.knockbacks.has(id)) {
        rt.jumpPressed = false;
        rt.jumpHeld = false;
        rt.isFlying = false;
      }

      // Sync authoritative state to Colyseus schema
      ps.x = entity.x;
      ps.y = rt.y;
      ps.z = entity.z;
      ps.yaw = entity.yaw;
      ps.moveAnim = rt.isFlying && rt.y > 0.25 ? "fly" : rt.y > 0.15 ? "jump" : rt.moveAnim;
      ps.hp = Math.round(entity.hp);
      ps.posture = Math.round(entity.posture);
      ps.action = entity.action;
      ps.isBlocking = entity.isBlocking;
      ps.alive = entity.alive;

      ps.whirlwindCdMs = Math.max(0, rt.whirlwindReadyAt - now);
      ps.counterReadyMs = Math.max(0, rt.counterReadyUntil - now);
      ps.combatArtCooldownMs = Math.max(0, (rt.experimentalArtReadyAt[ps.selectedArt as ExperimentalArtKind] ?? 0) - now);
      ps.selectedAbility = rt.selectedAbility;
      ps.abilityCooldownMs = Math.max(0, rt.abilityReadyAt - now);
      ps.flightFuelMs = Math.round(rt.flightFuelMs);
      ps.isFlying = rt.isFlying;
      ps.lastMoveSeq = rt.lastMoveSeq;
      ps.velocityX = rt.velocityX;
      ps.velocityY = rt.velocityY;
      ps.velocityZ = rt.velocityZ;
      ps.shockedMs = entity.shockedUntil ? Math.max(0, entity.shockedUntil - now) : 0;

      ps.furyMs = Math.max(0, rt.furyUntil - now);
      ps.ironWillMs = Math.max(0, rt.ironWillUntil - now);
      ps.swiftFeetMs = Math.max(0, rt.swiftFeetUntil - now);
      ps.tonicMs = Math.max(0, rt.tonicUntil - now);

      ps.slot0Kind = rt.belt[0].kind;
      ps.slot0Charges = rt.belt[0].charges;
      ps.slot1Kind = rt.belt[1].kind;
      ps.slot1Charges = rt.belt[1].charges;
      ps.slot2Kind = rt.belt[2].kind;
      ps.slot2Charges = rt.belt[2].charges;
    });

    // 3. Step Projectiles (Pilum, Fireball, Arcane Orb, Stun Bolt — homing, AoE, and Perfect-Deflect Reflection!)
    const removePilums: string[] = [];
    this.pilumRuntimes.forEach((pilum, id) => {
      const ps = this.state.pilums.get(id);
      if (!ps || now >= pilum.expiresAt) {
        removePilums.push(id);
        return;
      }

      const owner =
        this.playerRuntimes.get(pilum.ownerId)?.entity ??
        this.enemyRuntimes.get(pilum.ownerId)?.entity ??
        this.team3v3.getBotEntity(pilum.ownerId);

      // Gentle homing steering for Arcane Orbs
      if (pilum.homingTargetId) {
        const ht = allCombatEntities.find((e) => e.id === pilum.homingTargetId && e.alive);
        if (ht) {
          const spd = Math.hypot(pilum.vx, pilum.vy, pilum.vz) || 19;
          const dx = ht.x - pilum.x;
          const dy = (ht.y ?? 0) + 1.15 - pilum.y;
          const dz = ht.z - pilum.z;
          const d = Math.hypot(dx, dy, dz) || 1;
          const blend = Math.min(1, dtSec * 4.5);
          pilum.vx = pilum.vx * (1 - blend) + (dx / d) * spd * blend;
          pilum.vy = pilum.vy * (1 - blend) + (dy / d) * spd * blend;
          pilum.vz = pilum.vz * (1 - blend) + (dz / d) * spd * blend;
        }
      }

      const stepSpeed = Math.hypot(pilum.vx, pilum.vy, pilum.vz);
      const subSteps = Math.max(1, Math.min(12, Math.ceil((stepSpeed * dtSec) / 0.35)));
      const subDt = dtSec / subSteps;
      const gravity = pilum.kind === "fireball" ? 1.8 : 0;

      const triggerAoe = (cx: number, cy: number, cz: number) => {
        if (!pilum.aoeRadius || pilum.aoeRadius <= 0) return;
        this.broadcastCombatEvent({
          kind: "projectile_explode",
          x: cx,
          y: cy,
          z: cz,
          projectileKind: pilum.kind,
          attackerId: pilum.ownerId,
        });
        for (const t of allCombatEntities) {
          if (t.id === pilum.ownerId || !t.alive) continue;
          if (owner?.team && t.team && owner.team === t.team) continue;
          const d = Math.hypot(t.x - cx, t.z - cz);
          if (d <= pilum.aoeRadius && Math.abs((t.y ?? 0) + 1.0 - cy) <= pilum.aoeRadius + 1.2) {
            if (now < t.dodgeInvulnUntil) continue;
            const splashDmg = Math.round(pilum.hpDamage * 0.65);
            if (!t.infiniteHealth) {
              t.hp = Math.max(0, t.hp - splashDmg);
            }
            t.posture = Math.min(t.maxPosture, t.posture + Math.round(pilum.postureDamage * 0.6));
            if (t.hp <= 0) {
              t.alive = false;
              t.action = "dead";
              t.onKilled?.(owner ?? t);
            }
          }
        }
      };

      for (let s = 0; s < subSteps; s++) {
        pilum.x += pilum.vx * subDt;
        pilum.vy -= gravity * subDt;
        pilum.y += pilum.vy * subDt;
        pilum.z += pilum.vz * subDt;

        if (pilum.y <= 0.15 || Math.hypot(pilum.x, pilum.z) >= ARENA.WALL_RADIUS - 0.5) {
          triggerAoe(pilum.x, Math.max(0.2, pilum.y), pilum.z);
          removePilums.push(id);
          return;
        }
        for (const pillar of ARENA.PILLARS) {
          if (
            pilum.y <= pillar.height + 0.25 &&
            Math.hypot(pilum.x - pillar.x, pilum.z - pillar.z) <= pillar.radius + 0.25
          ) {
            triggerAoe(pilum.x, pilum.y, pilum.z);
            removePilums.push(id);
            return;
          }
        }

        for (const target of allCombatEntities) {
          if (target.id === pilum.ownerId || !target.alive) continue;
          if (owner?.team && target.team && owner.team === target.team) continue;
          const targetY = target.y ?? 0;
          const enemyRt = target.isPlayer ? undefined : this.enemyRuntimes.get(target.id);
          const scale = enemyRt ? (ENEMY_ARCHETYPES[enemyRt.kind]?.scale ?? 1.0) : 1.0;
          if (pilum.y < targetY || pilum.y > targetY + 1.95 * scale) continue;

          if (Math.hypot(pilum.x - target.x, pilum.z - target.z) <= COMBAT.PILUM_HIT_RADIUS) {
            const { events, reflected } = resolveProjectileHit(
              owner,
              target,
              pilum.x,
              pilum.y,
              pilum.z,
              pilum.vx,
              pilum.vz,
              now,
              {
                kind: pilum.kind,
                hpDamage: pilum.hpDamage,
                postureDamage: pilum.postureDamage,
                stunMs: pilum.stunMs,
              },
              pilum.ownerId
            );
            for (const ev of events) {
              this.broadcastCombatEvent(ev);
            }
            if (reflected) {
              // Sekiro Projectile Reflection: reverse back at old owner at 1.35x speed!
              const prevOwnerId = pilum.ownerId;
              pilum.ownerId = target.id;
              pilum.homingTargetId = prevOwnerId;
              pilum.vx = -pilum.vx * 1.35;
              pilum.vy = -pilum.vy * 1.35;
              pilum.vz = -pilum.vz * 1.35;
              pilum.expiresAt = now + 1500;
              ps.ownerId = target.id;
              break;
            }
            triggerAoe(pilum.x, pilum.y, pilum.z);
            removePilums.push(id);
            return;
          }
        }
      }

      ps.x = pilum.x;
      ps.y = pilum.y;
      ps.z = pilum.z;
      ps.vx = pilum.vx;
      ps.vy = pilum.vy;
      ps.vz = pilum.vz;
    });
    for (const id of removePilums) {
      this.pilumRuntimes.delete(id);
      this.state.pilums.delete(id);
    }

    // 3b. Step Experimental Combat Art hit pulses (server-authoritative, permanent friendly fire!)
    if (this.pendingArtPulses.length > 0) {
      const remainingPulses: ExperimentalArtPulse[] = [];
      for (const pulse of this.pendingArtPulses) {
        if (now >= pulse.triggerAt) {
          this.resolveExperimentalArtPulse(pulse, allCombatEntities, now);
        } else {
          remainingPulses.push(pulse);
        }
      }
      this.pendingArtPulses = remainingPulses;
    }

    // 4. Step Skeleton Gladiators & Wave Archetypes
    const toRemove: string[] = [];
    this.enemyRuntimes.forEach((rt, id) => {
      const es = this.state.enemies.get(id);
      if (!es) return;

      if (!rt.entity.alive) {
        this.knockbacks.delete(id);
        es.alive = false;
        es.action = "dead";
        es.telegraph = "none";
        es.isBlocking = false;
        if (now - rt.deadAt > 3500) {
          toRemove.push(id);
        }
        return;
      }

      const knockback = this.knockbacks.get(id);
      if (knockback) {
        const airDrag = Math.exp(-0.45 * dtSec);
        knockback.vx *= airDrag;
        knockback.vz *= airDrag;
        knockback.vy -= 30.0 * dtSec;
        knockback.y += knockback.vy * dtSec;
        const desiredX = rt.entity.x + knockback.vx * dtSec;
        const desiredZ = rt.entity.z + knockback.vz * dtSec;
        const clamped = clampToArena(
      desiredX,
      desiredZ,
      ARENA.ENTITY_RADIUS,
      false,
      this.state.arenaMap as ArenaMapKind
    );
        if (Math.hypot(clamped.x - desiredX, clamped.z - desiredZ) > 0.02) {
          // Thud cleanly off Colosseum wall or stone pillar instead of grinding along it
          knockback.vx *= 0.25;
          knockback.vz *= 0.25;
        }
        rt.entity.x = clamped.x;
        rt.entity.z = clamped.z;
        if (knockback.y <= 0 && knockback.vy < 0) {
          this.knockbacks.delete(id);
          es.y = 0;
          rt.entity.y = 0;
          rt.entity.hurtUntil = Math.max(rt.entity.hurtUntil, now + 260);
          rt.entity.action = "hurt";
          this.broadcastCombatEvent({
            kind: "special_vfx",
            x: rt.entity.x,
            y: 0.12,
            z: rt.entity.z,
            yaw: rt.entity.yaw,
            moveKind: "aerial_slam",
            heavy: false,
          });
        } else {
          es.y = Math.max(0, Math.min(6.0, knockback.y));
          rt.entity.y = es.y;
          rt.entity.action = "jump";
          rt.entity.isBlocking = false;
          rt.activeAttack = null;
          es.x = rt.entity.x;
          es.z = rt.entity.z;
          es.yaw = rt.entity.yaw;
          es.hp = Math.round(rt.entity.hp);
          es.posture = Math.round(rt.entity.posture);
          es.action = rt.entity.action;
          es.telegraph = "none";
          es.isBlocking = false;
          es.alive = rt.entity.alive;
          return;
        }
      }

      const { events, telegraph, attackKind, spawnedProjectiles } = stepSkeletonAI(
        rt,
        this.state.gameMode === "ffa" ? allCombatEntities : allPlayerEntities,
        allEnemyRuntimes,
        now,
        dtSec
      );
      for (const ev of events) {
        this.broadcastCombatEvent(ev);
      }
      for (const sp of spawnedProjectiles) {
        this.spawnProjectile({
          kind: sp.kind,
          ownerId: rt.entity.id,
          x: sp.x,
          y: sp.y,
          z: sp.z,
          yaw: sp.yaw,
          pitch: Math.atan2(sp.vy, Math.hypot(sp.vx, sp.vz) || 1),
          speed: Math.hypot(sp.vx, sp.vy, sp.vz),
          hpDamage: sp.hpDamage,
          postureDamage: sp.postureDamage,
          aoeRadius: sp.aoeRadius,
          stunMs: sp.stunMs,
          lifetimeMs: 1800,
          now,
        });
      }

      es.x = rt.entity.x;
      es.y = rt.entity.y ?? 0;
      es.z = rt.entity.z;
      es.yaw = rt.entity.yaw;
      es.hp = Math.round(rt.entity.hp);
      es.posture = Math.round(rt.entity.posture);
      es.action = rt.entity.action;
      es.attackKind = attackKind;
      es.telegraph = telegraph;
      es.isBlocking = rt.entity.isBlocking;
      es.alive = rt.entity.alive;
    });

    // 4a. Step 3v3 Team Battle Mode & AI Gladiator Bots
    this.team3v3.step(now, dtSec, allCombatEntities);

    // 4a-bis. Step Boss Rush Trial auto-advance & FFA Sacred Overdrive Ring
    if (this.state.gameMode === "boss_rush" && !this.state.waveActive && this.nextBossTrialAt > 0 && now >= this.nextBossTrialAt) {
      this.nextBossTrialAt = 0;
      const nextTrial = this.state.bossTrial + 1;
      if (nextTrial <= BOSS_RUSH_TRIALS.length) {
        this.startBossRushTrial(nextTrial, this.state.hostSessionId, "Arena", now);
      }
    }

    if (this.state.gameMode === "ffa" && !this.state.ffaWinnerName) {
      const playersInRing: PlayerRuntime[] = [];
      this.playerRuntimes.forEach((rt) => {
        if (rt.entity.alive && Math.hypot(rt.entity.x, rt.entity.z) <= FFA_CONFIG.RING_RADIUS) {
          playersInRing.push(rt);
        }
      });
      if (playersInRing.length === 1) {
        const holder = playersInRing[0];
        this.state.ffaZoneOwnerId = holder.entity.id;
        holder.ffaZoneMs += deltaMs;
        // 2x faster ability recharge inside Sacred Overdrive Ring!
        holder.abilityReadyAt = Math.max(0, holder.abilityReadyAt - deltaMs);
        this.state.ffaZoneProgress = Math.min(1, holder.ffaZoneMs / FFA_CONFIG.RING_HOLD_MS);
        if (holder.ffaZoneMs >= FFA_CONFIG.RING_HOLD_MS) {
          holder.ffaZoneMs = 0;
          this.state.ffaZoneProgress = 0;
          const ps = this.state.players.get(holder.entity.id);
          if (ps) {
            ps.ffaScore += 1;
            if (ps.ffaScore >= this.state.ffaTargetScore) {
              this.finishFfaMatch(ps.name);
            }
          }
        }
      } else {
        this.state.ffaZoneOwnerId = "";
        this.state.ffaZoneProgress = 0;
      }
    }

    // 4b. Sync wave enemy counter & handle Wave Clear rewards
    if (this.state.waveActive) {
      let remainingAlive = 0;
      this.enemyRuntimes.forEach((e) => {
        if (e.entity.alive) remainingAlive++;
      });
      this.state.enemiesRemaining = remainingAlive + this.waveQueue.length;

      if (this.waveQueue.length === 0 && remainingAlive === 0) {
        this.state.waveActive = false;
        this.state.enemiesRemaining = 0;

        // Heal all living players (Boss Rush heals +60 HP & resets cooldowns!)
        const healAmt = this.state.gameMode === "boss_rush" ? 60 : COMBAT.WAVE_CLEAR_HEAL_HP;
        this.playerRuntimes.forEach((p, pid) => {
          const ps = this.state.players.get(pid);
          if (!p.entity.alive && (this.state.respawnMode === "wave_end" || this.state.gameMode === "boss_rush") && ps) {
            this.revivePlayer(p, ps);
          }
          if (p.entity.alive) {
            p.entity.hp = Math.min(p.entity.maxHp, p.entity.hp + healAmt);
            if (ps) ps.hp = Math.round(p.entity.hp);
          }
          if (this.state.gameMode === "boss_rush") {
            p.abilityReadyAt = 0;
          }
        });

        if (this.state.gameMode === "boss_rush") {
          const isFinal = this.state.bossTrial >= BOSS_RUSH_TRIALS.length;
          this.broadcastCombatEvent({
            kind: "boss_trial_clear",
            x: 0,
            y: 2.2,
            z: 0,
            wave: this.state.bossTrial,
            waveTitle: isFinal ? "PANTHEON CONQUERED!" : `${this.state.bossTrialTitle} Cleared!`,
          });
          if (!isFinal) {
            this.nextBossTrialAt = now + 3500;
          }
        }

        // Refresh up to 2 random arena power-ups
        const targetFreeSlots = Math.max(0, this.state.pickups.size + 2 - COMBAT.MAX_ARENA_PICKUPS);
        if (targetFreeSlots > 0) {
          const existingIds = Array.from(this.state.pickups.keys()).slice(0, targetFreeSlots);
          for (const pid of existingIds) {
            this.state.pickups.delete(pid);
          }
        }
        this.spawnRandomArenaPickups(2);

        // Shorten gate cooldown for next wave challenge
        gate.cooldownMs = 1800;

        this.broadcastCombatEvent({
          kind: "wave_clear",
          x: 0,
          y: 2.0,
          z: 0,
          wave: this.state.wave,
          waveTitle: this.state.waveTitle,
        });
      }
    }

    if (
      this.state.waveActive &&
      this.state.respawnMode === "wave_end" &&
      this.playerRuntimes.size > 0 &&
      Array.from(this.playerRuntimes.values()).every((rt) => !rt.entity.alive)
    ) {
      this.resetRunAfterTeamWipe();
    }

    // 5. Solid Entity Separation (prevent players & enemies from walking through each other,
    // while allowing flash-step dodges to phase cleanly out of enemy body-blocks)
    const MIN_SEP = ARENA.ENTITY_RADIUS * 2 + 0.12; // 1.22m solid body clearance
    for (let i = 0; i < allCombatEntities.length; i++) {
      const a = allCombatEntities[i];
      if (!a.alive) continue;
      const aPlayerRt = a.isPlayer ? this.playerRuntimes.get(a.id) : undefined;
      if ((aPlayerRt && now < aPlayerRt.dodgeUntil) || now < a.dodgeInvulnUntil) continue;
      for (let j = i + 1; j < allCombatEntities.length; j++) {
        const b = allCombatEntities[j];
        if (!b.alive) continue;
        const bPlayerRt = b.isPlayer ? this.playerRuntimes.get(b.id) : undefined;
        if ((bPlayerRt && now < bPlayerRt.dodgeUntil) || now < b.dodgeInvulnUntil) continue;
        // Allow jumping or knockback flight cleanly over another entity's head
        const aY = a.y ?? 0;
        const bY = b.y ?? 0;
        if (Math.abs(aY - bY) > 1.35) continue;

        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const distSq = dx * dx + dz * dz;
        if (distSq < MIN_SEP * MIN_SEP) {
          let dist: number;
          let nx: number;
          let nz: number;
          if (distSq < 1e-8) {
            dist = 0;
            nx = 1;
            nz = 0;
          } else {
            dist = Math.sqrt(distSq);
            nx = dx / dist;
            nz = dz / dist;
          }
          const overlap = (MIN_SEP - dist) * 0.5;
          const allowAlcoveA = !a.isPlayer && Boolean(this.enemyRuntimes.get(a.id)?.emerging);
          const allowAlcoveB = !b.isPlayer && Boolean(this.enemyRuntimes.get(b.id)?.emerging);

          const nextA = clampToArena(
            a.x - nx * overlap,
            a.z - nz * overlap,
            ARENA.ENTITY_RADIUS,
            allowAlcoveA
          );
          const nextB = clampToArena(
            b.x + nx * overlap,
            b.z + nz * overlap,
            ARENA.ENTITY_RADIUS,
            allowAlcoveB
          );
          a.x = nextA.x;
          a.z = nextA.z;
          b.x = nextB.x;
          b.z = nextB.z;

          if (a.isPlayer) {
            const psA = this.state.players.get(a.id);
            if (psA) { psA.x = a.x; psA.z = a.z; }
          } else {
            const esA = this.state.enemies.get(a.id);
            if (esA) { esA.x = a.x; esA.z = a.z; }
          }
          if (b.isPlayer) {
            const psB = this.state.players.get(b.id);
            if (psB) { psB.x = b.x; psB.z = b.z; }
          } else {
            const esB = this.state.enemies.get(b.id);
            if (esB) { esB.x = b.x; esB.z = b.z; }
          }
        }
      }
    }

    for (const id of toRemove) {
      this.enemyRuntimes.delete(id);
      this.state.enemies.delete(id);
    }
  }

  private broadcastCombatEvent(payload: CombatEventPayload): void {
    let event = payload;
    if (payload.kind === "hit" && payload.targetId) {
      const target = this.playerRuntimes.get(payload.targetId);
      const attackerIsPlayer = Boolean(
        payload.attackerId && this.playerRuntimes.has(payload.attackerId)
      );
      const now = Date.now();
      const triggerChance = attackerIsPlayer ? 0.5 : 0.55;
      if (target && now >= target.memeSfxReadyAt && Math.random() < triggerChance) {
        if (!attackerIsPlayer && Math.random() < 0.5) {
          target.memeSfxReadyAt = now + 2200;
          event = { ...payload, memeSfx: "aayein" };
        }
      }
    } else if (payload.kind === "kill" && payload.targetId && this.playerRuntimes.has(payload.targetId)) {
      let alivePlayers = 0;
      this.playerRuntimes.forEach((rt) => {
        if (rt.entity.alive) alivePlayers += 1;
      });
      if (alivePlayers === 0) {
        // Last player died: 30% FAHH!, 70% Sekiro Death — heard by everyone
        const memeSfx: MemeSfxKind = Math.random() < 0.3 ? "fahh" : "sekiroDeath";
        event = { ...payload, memeSfx };
      } else if (Math.random() < 0.4) {
        // Random Roberto shout when a player dies while teammates remain — heard by everyone
        event = { ...payload, memeSfx: "roberto" };
      }
    }

    this.broadcast("combat_event", event);
  }

  private createTeam3v3Controller(): Team3v3Controller {
    const room = this;
    return new Team3v3Controller({
      get state() {
        return room.state;
      },
      getHumanPlayers: () => {
        const list: Array<{ id: string; entity: CombatEntity }> = [];
        this.playerRuntimes.forEach((rt, id) => list.push({ id, entity: rt.entity }));
        return list;
      },
      resetPlayerForRound: (playerId, x, z, yaw, team) => {
        const rt = this.playerRuntimes.get(playerId);
        const ps = this.state.players.get(playerId);
        if (!rt || !ps) return;
        this.revivePlayer(rt, ps);
        rt.entity.x = x;
        rt.entity.z = z;
        rt.entity.yaw = yaw;
        rt.entity.team = team;
        rt.whirlwindReadyAt = 0;
        rt.experimentalArtReadyAt = {};
        rt.belt.forEach((slot) => {
          slot.kind = "";
          slot.charges = 0;
        });
        ps.x = x;
        ps.z = z;
        ps.yaw = yaw;
        ps.team = team;
      },
      setPlayerTeam: (playerId, team: TeamSide | "") => {
        const rt = this.playerRuntimes.get(playerId);
        const ps = this.state.players.get(playerId);
        if (rt) rt.entity.team = team;
        if (ps) ps.team = team;
      },
      resetMatchPlayerStats: () => {
        this.state.players.forEach((ps) => {
          ps.kills = 0;
          ps.pvpKills = 0;
          ps.deaths = 0;
        });
      },
      clearTransientCombatState: () => {
        this.enemyRuntimes.forEach((_, id) => this.state.enemies.delete(id));
        this.enemyRuntimes.clear();
        this.pilumRuntimes.clear();
        this.state.pilums.clear();
        this.pendingArtPulses = [];
        this.knockbacks.clear();
      },
      refreshArenaPickups: (count: number) => {
        this.state.pickups.clear();
        this.spawnRandomArenaPickups(count);
        this.nextPickupSpawnAt = Date.now() + COMBAT.PICKUP_RESPAWN_MS;
      },
      broadcastCombatEvent: (payload) => this.broadcastCombatEvent(payload),
      castBotCombatArt: (bot: TeamBotRuntime, now: number) => {
        const pulseSpecs = EXPERIMENTAL_ART_SERVER_SPECS[bot.combatArt];
        if (!pulseSpecs) return;
        this.broadcast("experimental_art", {
          art: bot.combatArt,
          attackerId: bot.entity.id,
          attackerName: bot.entity.name,
          x: bot.entity.x,
          y: bot.entity.y ?? 0,
          z: bot.entity.z,
          yaw: bot.entity.yaw,
          preview: false,
        });
        this.pendingArtPulses = this.pendingArtPulses.filter((p) => p.attackerId !== bot.entity.id);
        for (const spec of pulseSpecs) {
          const { offsetMs, ...pulseProps } = spec;
          this.pendingArtPulses.push({
            attackerId: bot.entity.id,
            art: bot.combatArt,
            triggerAt: now + offsetMs,
            ...pulseProps,
          });
        }
      },
      isKnockedBack: (entityId) => this.knockbacks.has(entityId),
      clearKnockback: (entityId) => {
        this.knockbacks.delete(entityId);
      },
      stepKnockback: (entity, now, dtSec) => {
        const knockback = this.knockbacks.get(entity.id);
        if (!knockback) return false;
        const airDrag = Math.exp(-0.45 * dtSec);
        knockback.vx *= airDrag;
        knockback.vz *= airDrag;
        knockback.vy -= 30.0 * dtSec;
        knockback.y += knockback.vy * dtSec;
        const desiredX = entity.x + knockback.vx * dtSec;
        const desiredZ = entity.z + knockback.vz * dtSec;
        const clamped = clampToArena(
      desiredX,
      desiredZ,
      ARENA.ENTITY_RADIUS,
      false,
      this.state.arenaMap as ArenaMapKind
    );
        if (Math.hypot(clamped.x - desiredX, clamped.z - desiredZ) > 0.02) {
          knockback.vx *= 0.25;
          knockback.vz *= 0.25;
        }
        entity.x = clamped.x;
        entity.z = clamped.z;
        if (knockback.y <= 0 && knockback.vy < 0) {
          this.knockbacks.delete(entity.id);
          entity.y = 0;
          entity.hurtUntil = Math.max(entity.hurtUntil, now + 260);
          entity.action = "hurt";
          return false;
        }
        entity.y = Math.max(0, Math.min(6.0, knockback.y));
        entity.action = "jump";
        return true;
      },
    });
  }
}
