export type PlayerAction =
  | "idle"
  | "move"
  | "jump"
  | "fly"
  | "light1"
  | "light2"
  | "heavy"
  | "thrust"
  | "whirlwind"
  | "aerial_slam"
  | "counter"
  | "punch"
  | "throw_pilum"
  | "cast_fireball"
  | "cast_arcane"
  | "shoot_stun"
  | "shocked"
  | "use_item"
  | "block"
  | "dodge"
  | "staggered"
  | "hurt"
  | "dead";

export type LocomotionAnim =
  | "idle"
  | "run"
  | "strafe_left"
  | "strafe_right"
  | "backpedal"
  | "jump"
  | "fly";

export type EnemyKind =
  | "skirmisher"
  | "legionary"
  | "assassin"
  | "pyromancer"
  | "stun_drone"
  | "mist_shinobi"
  | "dire_wolf"
  | "champion"
  | "dread_knight"
  | "aegis_mech"
  | "dragon";

export type EnemyAction =
  | "idle"
  | "chase"
  | "strafe"
  | "block"
  | "windup_light"
  | "attack_light"
  | "windup_heavy"
  | "attack_heavy"
  | "shocked"
  | "staggered"
  | "hurt"
  | "dead";

export type SpecialMoveKind = "whirlwind";

export type CombatArtKind =
  | "sakura_dance"
  | "mortal_draw"
  | "ichimonji_double"
  | "ashina_cross"
  | "dragon_flash"
  | "whirlwind_slash"
  | "shadowrush"
  | "spiral_cloud_passage"
  | "one_mind";

export type PlayerSkinKind =
  | "knight"
  | "ashina_ronin"
  | "golden_champion"
  | "shadow_shinobi"
  | "arcane_battlemage"
  | "cyber_valkyrie";
export type RespawnMode = "infinite" | "wave_end";
export type ArenaMapKind = "sunlit_colosseum" | "moonlit_sakura" | "aurora_sanctuary" | "sunny_sakura";
export type GameMode = "waves" | "team_3v3" | "boss_rush" | "ffa";
export type TeamSide = "red" | "blue";
export type PlayerAbilityKind = "fireball" | "arcane_spell" | "stun_gun";
export type ProjectileKind = "fireball" | "arcane_orb" | "stun_bolt";

export type AttackKind =
  | "light1"
  | "light2"
  | "heavy"
  | "thrust"
  | "whirlwind"
  | "aerial_slam"
  | "counter"
  | "punch"
  | "enemy_fast"
  | "enemy_light"
  | "enemy_heavy"
  | "enemy_lunge"
  | "enemy_cleave"
  | "enemy_slam"
  | "enemy_dread_cleave"
  | "enemy_shockwave_slam"
  | "enemy_fire_breath"
  | "enemy_tail_whip"
  | "enemy_dive_lunge"
  | "enemy_fireball"
  | "enemy_stun_bolt"
  | "enemy_mist_slash"
  | "enemy_wolf_bite"
  | "enemy_wolf_pounce"
  | "enemy_mech_slash"
  | "enemy_stun_volley";

export interface EnemyArchetypeSpec {
  kind: EnemyKind;
  name: string;
  modelFile: string;
  scale: number;
  maxHp: number;
  maxPosture: number;
  moveSpeed: number;
  canBlock: boolean;
  attackRange: number;
  primaryAttack: AttackKind;
  heavyAttack: AttackKind;
  accentColor: string;
  isBoss?: boolean;
}

export interface WaveDefinition {
  wave: number;
  title: string;
  enemies: EnemyKind[];
  maxConcurrent: number;
  hpScale: number;
}

export interface AttackSpec {
  kind: AttackKind;
  windupMs: number;
  activeMs: number;
  recoveryMs: number;
  range: number;
  arcDot: number; // -1 for full 360° AoE
  hpDamage: number;
  postureDamage: number;
  blockPostureDamage: number;
  blockChipHp: number;
  deflectAttackerPosture: number;
  deflectSelfPosture: number;
  lungeSpeed?: number; // forward burst m/s during active frames
  cooldownMs?: number;
}

export type PowerUpKind =
  | "healing_flask"
  | "posture_tonic"
  | "warriors_fury"
  | "iron_will"
  | "swift_feet";

export interface PowerUpSpec {
  kind: PowerUpKind;
  label: string;
  shortLabel: string;
  description: string;
  color: string;
  glowColor: string;
  durationMs: number; // 0 for instant/throwable
  charges: number;
}

export type CombatEventKind =
  | "swing"
  | "special_vfx"
  | "hit"
  | "block"
  | "deflect"
  | "stagger"
  | "evade"
  | "kill"
  | "gate_open"
  | "spawn_enemy"
  | "pickup_collect"
  | "powerup_use"
  | "shadow_step"
  | "spell_cast"
  | "stun_shot"
  | "projectile_explode"
  | "projectile_reflect"
  | "shock_stun"
  | "wave_start"
  | "wave_clear"
  | "round_start"
  | "round_end"
  | "match_end"
  | "boss_trial_start"
  | "boss_trial_clear"
  | "ffa_win";

export type MemeSfxKind = "aayein" | "roberto" | "fahh" | "sekiroDeath";

export interface CombatEventPayload {
  kind: CombatEventKind;
  x: number;
  y: number;
  z: number;
  yaw?: number;
  attackerId?: string;
  attackerName?: string;
  targetId?: string;
  targetName?: string;
  isPvP?: boolean;
  damage?: number;
  heavy?: boolean;
  moveKind?: AttackKind;
  powerUpKind?: PowerUpKind;
  abilityKind?: PlayerAbilityKind;
  projectileKind?: ProjectileKind;
  targetX?: number;
  targetY?: number;
  targetZ?: number;
  wave?: number;
  waveTitle?: string;
  enemyKind?: EnemyKind;
  memeSfx?: MemeSfxKind;
  round?: number;
  maxRounds?: number;
  teamWinner?: TeamSide | "draw";
  redScore?: number;
  blueScore?: number;
  winnerName?: string;
  score?: number;
}

export interface MoveMessage {
  sequence: number;
  moveX: number;
  moveZ: number;
  jumpPressed: boolean;
  jumpHeld: boolean;
  yaw: number;
}

export const GAME_PROTOCOL_VERSION = 2;

export interface CastAbilityMessage {
  ability: PlayerAbilityKind;
  yaw: number;
  pitch?: number;
}

export interface AttackMessage {
  kind: "light" | "heavy" | "aerial" | "punch";
  yaw: number;
}

export interface PartyChatMessage {
  senderId: string;
  senderName: string;
  text: string;
  sentAt: number;
}

export interface SpecialMessage {
  kind: SpecialMoveKind;
  yaw: number;
}

export interface PlayerLoadoutMessage {
  skin?: PlayerSkinKind;
  combatArt?: CombatArtKind;
}

export interface RespawnModeMessage {
  mode: RespawnMode;
}

export interface ArenaMapMessage {
  map: ArenaMapKind;
}

export interface GameModeMessage {
  mode: GameMode;
}

export interface InfiniteHealthMessage {
  enabled: boolean;
}

export interface JoinTeamMessage {
  team: TeamSide;
}

export interface TeamFillBotsMessage {
  enabled: boolean;
}

export interface CastSelectedArtMessage {
  yaw: number;
}

export interface UseItemMessage {
  slotIndex: number; // 0, 1, or 2
  yaw: number;
  pitch?: number;
}

export interface BlockMessage {
  active: boolean;
  yaw: number;
}

export interface DodgeMessage {
  dirX: number;
  dirZ: number;
  yaw: number;
}

export interface PlayerSlotPalette {
  name: string;
  primary: string;
  accent: string;
  plume: string;
}

export interface PlayerSkinSpec {
  kind: PlayerSkinKind;
  name: string;
  description: string;
  modelFile: string;
  primary: string;
  accent: string;
  plume: string;
}

export interface PlayerAbilitySpec {
  kind: PlayerAbilityKind;
  name: string;
  shortLabel: string;
  description: string;
  color: string;
  cooldownMs: number;
  projectileKind: ProjectileKind;
  speed: number;
  hpDamage: number;
  postureDamage: number;
  aoeRadius?: number;
  stunMs?: number;
}
