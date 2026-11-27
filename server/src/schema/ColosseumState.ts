import { Schema, MapSchema, type } from "@colyseus/schema";
import { COMBAT, FLIGHT } from "@sekiroslop/shared";

export class PlayerState extends Schema {
  @type("string") id: string = "";
  @type("string") name: string = "Gladiator";
  @type("number") slot: number = 0;
  @type("string") team: string = "";
  @type("string") skin: string = "knight";
  @type("string") selectedArt: string = "ashina_cross";
  @type("number") combatArtCooldownMs: number = 0;
  @type("string") selectedAbility: string = "fireball";
  @type("number") abilityCooldownMs: number = 0;
  @type("number") flightFuelMs: number = FLIGHT.MAX_FUEL_MS;
  @type("boolean") isFlying: boolean = false;
  @type("number") lastMoveSeq: number = 0;
  @type("number") velocityX: number = 0;
  @type("number") velocityY: number = 0;
  @type("number") velocityZ: number = 0;
  @type("number") shockedMs: number = 0;
  @type("number") ffaScore: number = 0;
  @type("boolean") infiniteHealth: boolean = false;
  @type("number") pingMs: number = -1;

  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") z: number = 10;
  @type("number") yaw: number = Math.PI;
  @type("string") moveAnim: string = "idle";

  @type("number") hp: number = COMBAT.PLAYER_MAX_HP;
  @type("number") maxHp: number = COMBAT.PLAYER_MAX_HP;
  @type("number") posture: number = 0;
  @type("number") maxPosture: number = COMBAT.PLAYER_MAX_POSTURE;

  @type("string") action: string = "idle";
  @type("boolean") isBlocking: boolean = false;
  @type("boolean") alive: boolean = true;
  @type("number") respawnTimer: number = 0;

  // Special move cooldowns & riposte counter window (ms)
  @type("number") whirlwindCdMs: number = 0;
  @type("number") counterReadyMs: number = 0;

  // Active power-up buff remaining durations (ms)
  @type("number") furyMs: number = 0;
  @type("number") ironWillMs: number = 0;
  @type("number") swiftFeetMs: number = 0;
  @type("number") tonicMs: number = 0;

  // 3-slot collectible quick belt
  @type("string") slot0Kind: string = "";
  @type("number") slot0Charges: number = 0;
  @type("string") slot1Kind: string = "";
  @type("number") slot1Charges: number = 0;
  @type("string") slot2Kind: string = "";
  @type("number") slot2Charges: number = 0;

  @type("number") kills: number = 0;
  @type("number") pvpKills: number = 0;
  @type("number") deaths: number = 0;
}

export class EnemyState extends Schema {
  @type("string") id: string = "";
  @type("string") kind: string = "legionary";
  @type("string") name: string = "Skeleton Gladiator";

  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") z: number = -28;
  @type("number") yaw: number = 0;

  @type("number") hp: number = COMBAT.ENEMY_MAX_HP;
  @type("number") maxHp: number = COMBAT.ENEMY_MAX_HP;
  @type("number") posture: number = 0;
  @type("number") maxPosture: number = COMBAT.ENEMY_MAX_POSTURE;

  @type("string") action: string = "idle";
  @type("string") attackKind: string = "";
  @type("string") telegraph: string = "none";
  @type("boolean") isBlocking: boolean = false;
  @type("boolean") alive: boolean = true;
  @type("string") team: string = "";
  @type("string") combatArt: string = "";
  @type("boolean") isBot: boolean = false;
}

export class GateState extends Schema {
  @type("string") id: string = "north";
  @type("boolean") open: boolean = false;
  @type("number") openProgress: number = 0;
  @type("number") cooldownMs: number = 0;
  @type("number") activations: number = 0;
}

export class PickupState extends Schema {
  @type("string") id: string = "";
  @type("string") kind: string = "healing_flask";
  @type("number") x: number = 0;
  @type("number") z: number = 0;
}

export class PilumState extends Schema {
  @type("string") id: string = "";
  @type("string") kind: string = "pilum";
  @type("string") ownerId: string = "";
  @type("number") x: number = 0;
  @type("number") y: number = 1.4;
  @type("number") z: number = 0;
  @type("number") vx: number = 0;
  @type("number") vy: number = 0;
  @type("number") vz: number = 0;
  @type("number") yaw: number = 0;
}

export class ColosseumState extends Schema {
  @type("string") roomCode: string = "";
  @type("string") hostSessionId: string = "";
  @type("string") respawnMode: string = "infinite";
  @type("string") arenaMap: string = "sunlit_colosseum";
  @type("string") gameMode: string = "waves";
  @type("boolean") teamFillBots: boolean = true;
  @type("boolean") teamMatchActive: boolean = false;
  @type("boolean") teamRoundActive: boolean = false;
  @type("number") teamRound: number = 0;
  @type("number") teamMaxRounds: number = 5;
  @type("number") teamRedScore: number = 0;
  @type("number") teamBlueScore: number = 0;
  @type("string") teamRoundWinner: string = "";
  @type("string") teamMatchWinner: string = "";
  @type("number") teamIntermissionMs: number = 0;
  @type("number") bossTrial: number = 0;
  @type("string") bossTrialTitle: string = "";
  @type("number") ffaTargetScore: number = 10;
  @type("string") ffaZoneOwnerId: string = "";
  @type("number") ffaZoneProgress: number = 0;
  @type("string") ffaWinnerName: string = "";
  @type("number") skeletonsDefeated: number = 0;
  @type("number") wave: number = 0;
  @type("boolean") waveActive: boolean = false;
  @type("string") waveTitle: string = "";
  @type("number") enemiesRemaining: number = 0;
  @type("number") totalEnemiesInWave: number = 0;
  @type(GateState) northGate: GateState = new GateState();
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
  @type({ map: EnemyState }) enemies = new MapSchema<EnemyState>();
  @type({ map: PickupState }) pickups = new MapSchema<PickupState>();
  @type({ map: PilumState }) pilums = new MapSchema<PilumState>();
}
