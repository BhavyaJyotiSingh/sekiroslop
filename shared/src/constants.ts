import type {
  AttackKind,
  AttackSpec,
  PlayerAbilityKind,
  PlayerAbilitySpec,
  PlayerSkinKind,
  PlayerSkinSpec,
  EnemyArchetypeSpec,
  EnemyKind,
  PlayerSlotPalette,
  PowerUpKind,
  PowerUpSpec,
  SpecialMoveKind,
  WaveDefinition,
} from "./types.js";

export const ARENA = {
  // Leave clearance for the player capsule inside the perimeter wall's inner face.
  PLAYABLE_RADIUS: 25.3,
  WALL_RADIUS: 26.2,
  ENTITY_RADIUS: 0.55,
  NORTH_GATE: {
    id: "north",
    x: 0,
    z: -26.0,
    width: 4.8,
    height: 4.4,
    leverX: 3.6,
    leverZ: -23.0,
    interactRadius: 3.5,
    spawnX: 0,
    spawnZ: -28.2,
    emergeZ: -20.5,
  },
  PILLARS: [
    { x: -9.5, z: -9.5, radius: 1.15, height: 6.4 },
    { x: 9.5, z: -9.5, radius: 1.15, height: 6.4 },
    { x: -9.5, z: 9.5, radius: 1.15, height: 6.4 },
    { x: 9.5, z: 9.5, radius: 1.15, height: 6.4 },
  ] as const,
  PLAYER_SPAWNS: [
    { x: -3.0, z: 10.0, yaw: Math.PI },
    { x: 3.0, z: 10.0, yaw: Math.PI },
    { x: -5.2, z: 13.0, yaw: Math.PI },
    { x: 5.2, z: 13.0, yaw: Math.PI },
  ] as const,
  PICKUP_SPAWNS: [
    { x: 0, z: 0 },
    { x: -15.5, z: 0 },
    { x: 15.5, z: 0 },
    { x: 0, z: -14.5 },
    { x: 0, z: 16.0 },
    { x: -13.5, z: -13.5 },
    { x: 13.5, z: -13.5 },
    { x: -13.5, z: 13.5 },
    { x: 13.5, z: 13.5 },
  ] as const,
} as const;

export const PLAYER_PALETTES: readonly PlayerSlotPalette[] = [
  { name: "Crimson", primary: "#9b1c1c", accent: "#d4af37", plume: "#dc2626" },
  { name: "Gold", primary: "#b47b17", accent: "#f3e5ab", plume: "#f59e0b" },
  { name: "Cobalt", primary: "#1d4ed8", accent: "#cbd5e1", plume: "#3b82f6" },
  { name: "Emerald", primary: "#15803d", accent: "#d4af37", plume: "#22c55e" },
] as const;

export const PLAYER_SKINS: Record<PlayerSkinKind, PlayerSkinSpec> = {
  knight: {
    kind: "knight",
    name: "Imperial Centurion",
    description: "Classic Roman Knight plate with gladius & scutum.",
    modelFile: "/assets/models/Knight.glb",
    primary: "#9b1c1c",
    accent: "#d4af37",
    plume: "#dc2626",
  },
  shadow_shinobi: {
    kind: "shadow_shinobi",
    name: "Mist Shinobi",
    description: "Stealth Ninja silhouette wielding a forged steel katana.",
    modelFile: "/assets/skins/Ninja.glb",
    primary: "#111827",
    accent: "#a78bfa",
    plume: "#e11d48",
  },
  ashina_ronin: {
    kind: "ashina_ronin",
    name: "Obsidian Warlord",
    description: "Dark Gothic Black Knight with a crimson-edged odachi.",
    modelFile: "/assets/skins/BlackKnight.glb",
    primary: "#1e293b",
    accent: "#38bdf8",
    plume: "#60a5fa",
  },
  golden_champion: {
    kind: "golden_champion",
    name: "Radiant Paladin",
    description: "Armored High-Fantasy Paladin wielding a royal claymore.",
    modelFile: "/assets/skins/Paladin_with_Helmet.glb",
    primary: "#92400e",
    accent: "#facc15",
    plume: "#ef4444",
  },
  arcane_battlemage: {
    kind: "arcane_battlemage",
    name: "Pyromancer Sage",
    description: "Arcane Battlemage with runic staff & floating spellbook.",
    modelFile: "/assets/skins/Mage.glb",
    primary: "#581c87",
    accent: "#fb923c",
    plume: "#f97316",
  },
  cyber_valkyrie: {
    kind: "cyber_valkyrie",
    name: "Sky-Ranger Valkyrie",
    description: "Sci-Fi flight-suit ranger with jet wings & stun blaster.",
    modelFile: "/assets/skins/SpaceRanger_FlightMode.glb",
    primary: "#0f766e",
    accent: "#22d3ee",
    plume: "#38bdf8",
  },
};

export const PLAYER_ABILITIES: Record<PlayerAbilityKind, PlayerAbilitySpec> = {
  fireball: {
    kind: "fireball",
    name: "Ignis Fireball",
    shortLabel: "FIRE",
    description: "Hurls an explosive magma sphere (2.8m AoE scorch).",
    color: "#ff6b1a",
    cooldownMs: 4500,
    projectileKind: "fireball",
    speed: 22,
    hpDamage: 28,
    postureDamage: 36,
    aoeRadius: 2.8,
  },
  arcane_spell: {
    kind: "arcane_spell",
    name: "Astral Frost-Storm",
    shortLabel: "SPELL",
    description: "Launches homing runic orbs that shatter posture.",
    color: "#38bdf8",
    cooldownMs: 6500,
    projectileKind: "arcane_orb",
    speed: 19,
    hpDamage: 26,
    postureDamage: 52,
    aoeRadius: 2.2,
  },
  stun_gun: {
    kind: "stun_gun",
    name: "Voltaic Stun Gun",
    shortLabel: "STUN",
    description: "Fires a high-velocity electric bolt that shocks foes (950ms stun).",
    color: "#22d3ee",
    cooldownMs: 7500,
    projectileKind: "stun_bolt",
    speed: 38,
    hpDamage: 12,
    postureDamage: 26,
    stunMs: 950,
  },
};

export const FLIGHT = {
  MAX_FUEL_MS: 1500,
  RECHARGE_PER_SEC: 280,
  MAX_Y: 6.6,
  ASCEND_SPEED: 15.5,
  THRUST_ACCEL_Y: 9.5,
  IGNITION_MIN_VY: 4.2,
  FLY_SPEED_MULT: 1.4,
  FLY_ACCEL_XZ: 11.0,
  AIR_STEER_ACCEL: 7.5,
  AIR_COAST_DRAG: 0.85,
  MAX_BURST_DISTANCE: ARENA.PLAYABLE_RADIUS,
} as const;

export const BOSS_RUSH_TRIALS: readonly { trial: number; title: string; bosses: readonly EnemyKind[] }[] = [
  { trial: 1, title: "Trial I — Murmillo Berserker", bosses: ["champion"] },
  { trial: 2, title: "Trial II — Iron Dread Knight", bosses: ["dread_knight"] },
  { trial: 3, title: "Trial III — Aegis War-Mech", bosses: ["aegis_mech"] },
  { trial: 4, title: "Trial IV — Crimson Wyvern", bosses: ["dragon"] },
  { trial: 5, title: "Trial V — Pantheon Finale", bosses: ["dread_knight", "dragon"] },
];

export const FFA_CONFIG = {
  TARGET_SCORE: 10,
  RING_RADIUS: 4.5,
  RING_HOLD_MS: 6000,
  BOT_COUNT: 5,
} as const;

export const MOVEMENT_SPEED_MULTIPLIER = 1.75;

export const ARENA_MAPS = {
  sunlit_colosseum: {
    name: "Sunlit Colosseum",
    description: "Golden-hour Roman amphitheater with crimson banners, bronze braziers, and drifting sunlit dust.",
    sky: "#d9a973",
    sand: "#e6c794",
    stone: "#d4ba92",
    paleStone: "#ede0c4",
    darkStone: "#6e553e",
    accent: "#ff9b3d",
    accentAlt: "#ffe394",
    light: "#ffebd0",
    ground: "#87633c",
  },
  moonlit_sakura: {
    name: "Moonlit Sakura Courtyard",
    description: "Luminous moonlit Ashina shrine courtyard with cherry blossom trees, stone lanterns, and swirling petals.",
    sky: "#223463",
    sand: "#9aa6c6",
    stone: "#828dad",
    paleStone: "#dde3f4",
    darkStone: "#38415e",
    accent: "#ff7ec0",
    accentAlt: "#ffd27d",
    light: "#eef5ff",
    ground: "#3b4566",
  },
  aurora_sanctuary: {
    name: "Aurora Crystal Sanctuary",
    description: "Vibrant twilight prism-jade courtyard beneath shimmering aurora curtains, floating crystal obelisks, and a celestial armillary sphere.",
    sky: "#123c52",
    sand: "#4a8c8c",
    stone: "#3d6b7d",
    paleStone: "#b8f3ff",
    darkStone: "#1b283d",
    accent: "#22d3ee",
    accentAlt: "#f472b6",
    light: "#d8fbff",
    ground: "#183347",
  },
  sunny_sakura: {
    name: "Sunlit Sakura Garden",
    description: "Warm sunlit Japanese courtyard ringed by thick cherry blossom trees, flower-carpeted stone, vermilion torii gates, and drifting petals.",
    sky: "#8ecae6",
    sand: "#c7c99e",
    stone: "#b5b0a1",
    paleStone: "#f7eee8",
    darkStone: "#5c5346",
    accent: "#ff7eb6",
    accentAlt: "#fde047",
    light: "#fff6e5",
    ground: "#5c7a47",
  },
} as const satisfies Record<
  import("./types.js").ArenaMapKind,
  {
    name: string;
    description: string;
    sky: string;
    sand: string;
    stone: string;
    paleStone: string;
    darkStone: string;
    accent: string;
    accentAlt: string;
    light: string;
    ground: string;
  }
>;

export const COMBAT = {
  SERVER_TICK_MS: 33, // 30 Hz authoritative simulation & state patch rate
  MAX_PLAYERS: 4,
  PLAYER_MAX_HP: 100,
  PLAYER_MAX_POSTURE: 100,
  ENEMY_MAX_HP: 140,
  ENEMY_MAX_POSTURE: 100,

  PLAYER_MOVE_SPEED: 9.2 * MOVEMENT_SPEED_MULTIPLIER,
  PLAYER_BLOCK_SPEED: 4.4 * MOVEMENT_SPEED_MULTIPLIER,
  PLAYER_DODGE_SPEED: 41.25, // 2.5x dash speed (~9m flash-step)
  PLAYER_JUMP_VELOCITY: 11.2,
  PLAYER_GRAVITY: 36.0,
  ENEMY_MOVE_SPEED: 5.0 * MOVEMENT_SPEED_MULTIPLIER,

  DEFLECT_WINDOW_MS: 240,
  COUNTER_WINDOW_MS: 800, // Riposte window after landing a Perfect Deflect!
  BLOCK_FACING_DOT: 0.1,
  DODGE_DURATION_MS: 320,
  DODGE_IFRAMES_MS: 280,
  DODGE_COOLDOWN_MS: 540,
  COMBO_WINDOW_MS: 480,

  POSTURE_DECAY_DELAY_MS: 1600,
  POSTURE_DECAY_PER_SEC: 18,
  POSTURE_BLOCK_DECAY_MULT: 1.65,
  STAGGER_DURATION_MS: 2500,
  STAGGER_DAMAGE_MULT: 1.5,
  HURT_STUN_MS: 160,
  RESPAWN_DELAY_MS: 4500,

  GATE_COOLDOWN_MS: 4500,
  MAX_ACTIVE_SKELETONS: 4,
  WAVE_CLEAR_HEAL_HP: 25,
  WAVE_SPAWN_INTERVAL_MS: 1300,

  // Power-Up & Pilum balance
  INVENTORY_SLOTS: 3,
  PICKUP_COLLECT_RADIUS: 1.75,
  MAX_ARENA_PICKUPS: 4,
  PICKUP_RESPAWN_MS: 16000,
  ENEMY_DROP_CHANCE: 0.7,

  HEALING_FLASK_HP: 50,
  FURY_DAMAGE_MULT: 1.25,
  FURY_POSTURE_MULT: 1.35,
  IRON_WILL_DAMAGE_MULT: 0.65,
  SWIFT_FEET_SPEED_MULT: 1.35,

  PILUM_SPEED: 25.0,
  PILUM_LIFETIME_MS: 1400,
  PILUM_HIT_RADIUS: 0.85,
  PILUM_HP_DAMAGE: 26,
  PILUM_POSTURE_DAMAGE: 36,
} as const;

export const SPECIAL_MOVES: Record<
  SpecialMoveKind,
  { key: string; label: string; shortLabel: string; color: string; cooldownMs: number }
> = {
  whirlwind: {
    key: "E",
    label: "Whirlwind Spin",
    shortLabel: "SPIN",
    color: "#f59e0b",
    cooldownMs: 6000,
  },
};

export const POWER_UPS: Record<PowerUpKind, PowerUpSpec> = {
  healing_flask: {
    kind: "healing_flask",
    label: "Healing Flask",
    shortLabel: "HEAL",
    description: "+50 Health instantly",
    color: "#ef4444",
    glowColor: "#fca5a5",
    durationMs: 0,
    charges: 1,
  },
  posture_tonic: {
    kind: "posture_tonic",
    label: "Posture Tonic",
    shortLabel: "TONIC",
    description: "Clears Posture & boosts recovery",
    color: "#eab308",
    glowColor: "#fef08a",
    durationMs: 7000,
    charges: 1,
  },
  warriors_fury: {
    kind: "warriors_fury",
    label: "Warrior's Fury",
    shortLabel: "FURY",
    description: "+25% Sword Damage (12s)",
    color: "#f97316",
    glowColor: "#fdba74",
    durationMs: 12000,
    charges: 1,
  },
  iron_will: {
    kind: "iron_will",
    label: "Iron Will",
    shortLabel: "IRON",
    description: "-35% Incoming Damage (Instant 12s)",
    color: "#38bdf8",
    glowColor: "#bae6fd",
    durationMs: 12000,
    charges: 1,
  },
  swift_feet: {
    kind: "swift_feet",
    label: "Swift Feet",
    shortLabel: "SWIFT",
    description: "+35% Movement & Dodge Speed (Instant 12s)",
    color: "#22c55e",
    glowColor: "#86efac",
    durationMs: 12000,
    charges: 1,
  },
};

export const ALL_POWERUP_KINDS: readonly PowerUpKind[] = [
  "healing_flask",
  "posture_tonic",
  "warriors_fury",
  "iron_will",
  "swift_feet",
] as const;

export const ATTACK_SPECS: Record<AttackKind, AttackSpec> = {
  punch: {
    kind: "punch",
    windupMs: 160,
    activeMs: 120,
    recoveryMs: 360,
    range: 2.5,
    arcDot: 0.3,
    hpDamage: 11,
    postureDamage: 28,
    blockPostureDamage: 20,
    blockChipHp: 0,
    deflectAttackerPosture: 24,
    deflectSelfPosture: 8,
    lungeSpeed: 3.5,
  },
  light1: {
    kind: "light1",
    windupMs: 160,
    activeMs: 150,
    recoveryMs: 210,
    range: 2.85,
    arcDot: 0.25,
    hpDamage: 12,
    postureDamage: 24,
    blockPostureDamage: 18,
    blockChipHp: 0,
    deflectAttackerPosture: 36,
    deflectSelfPosture: 6,
  },
  light2: {
    kind: "light2",
    windupMs: 150,
    activeMs: 150,
    recoveryMs: 220,
    range: 2.95,
    arcDot: 0.2,
    hpDamage: 14,
    postureDamage: 26,
    blockPostureDamage: 20,
    blockChipHp: 0,
    deflectAttackerPosture: 38,
    deflectSelfPosture: 6,
  },
  heavy: {
    kind: "heavy",
    windupMs: 340,
    activeMs: 180,
    recoveryMs: 310,
    range: 3.35,
    arcDot: 0.25,
    hpDamage: 25,
    postureDamage: 50,
    blockPostureDamage: 38,
    blockChipHp: 5,
    deflectAttackerPosture: 54,
    deflectSelfPosture: 8,
    lungeSpeed: 4.5,
  },
  whirlwind: {
    kind: "whirlwind",
    windupMs: 210,
    activeMs: 260,
    recoveryMs: 270,
    range: 3.8,
    arcDot: -1.0, // Full 360-degree spinning sword cleave!
    hpDamage: 20,
    postureDamage: 46,
    blockPostureDamage: 34,
    blockChipHp: 4,
    deflectAttackerPosture: 48,
    deflectSelfPosture: 7,
    lungeSpeed: 3.2,
    cooldownMs: SPECIAL_MOVES.whirlwind.cooldownMs,
  },
  thrust: {
    kind: "thrust",
    windupMs: 240,
    activeMs: 200,
    recoveryMs: 260,
    range: 5.5, // Long-range piercing shockwave lance line
    arcDot: 0.72,
    hpDamage: 27,
    postureDamage: 58,
    blockPostureDamage: 44,
    blockChipHp: 16, // Pierces standard blocks — deflect or dodge!
    deflectAttackerPosture: 56,
    deflectSelfPosture: 7,
    lungeSpeed: 7.5,
    cooldownMs: 5000,
  },
  aerial_slam: {
    kind: "aerial_slam",
    windupMs: 160,
    activeMs: 210,
    recoveryMs: 280,
    range: 3.5,
    arcDot: -1.0, // Shockwave AoE slam on impact!
    hpDamage: 22,
    postureDamage: 46,
    blockPostureDamage: 34,
    blockChipHp: 5,
    deflectAttackerPosture: 46,
    deflectSelfPosture: 8,
    lungeSpeed: 4.0,
  },
  counter: {
    kind: "counter",
    windupMs: 100,
    activeMs: 170,
    recoveryMs: 200,
    range: 3.3,
    arcDot: 0.15,
    hpDamage: 30,
    postureDamage: 60,
    blockPostureDamage: 40,
    blockChipHp: 8,
    deflectAttackerPosture: 42,
    deflectSelfPosture: 6,
    lungeSpeed: 8.5,
  },
  enemy_fast: {
    kind: "enemy_fast",
    windupMs: 320,
    activeMs: 140,
    recoveryMs: 300,
    range: 2.7,
    arcDot: 0.25,
    hpDamage: 9,
    postureDamage: 20,
    blockPostureDamage: 16,
    blockChipHp: 0,
    deflectAttackerPosture: 34,
    deflectSelfPosture: 5,
  },
  enemy_light: {
    kind: "enemy_light",
    windupMs: 440,
    activeMs: 160,
    recoveryMs: 380,
    range: 2.95,
    arcDot: 0.25,
    hpDamage: 13,
    postureDamage: 28,
    blockPostureDamage: 22,
    blockChipHp: 0,
    deflectAttackerPosture: 38,
    deflectSelfPosture: 6,
  },
  enemy_heavy: {
    kind: "enemy_heavy",
    windupMs: 650,
    activeMs: 180,
    recoveryMs: 520,
    range: 3.3,
    arcDot: 0.2,
    hpDamage: 24,
    postureDamage: 46,
    blockPostureDamage: 36,
    blockChipHp: 5,
    deflectAttackerPosture: 56,
    deflectSelfPosture: 8,
  },
  enemy_lunge: {
    kind: "enemy_lunge",
    windupMs: 500,
    activeMs: 170,
    recoveryMs: 440,
    range: 3.5,
    arcDot: 0.45,
    hpDamage: 18,
    postureDamage: 38,
    blockPostureDamage: 28,
    blockChipHp: 4,
    deflectAttackerPosture: 48,
    deflectSelfPosture: 7,
    lungeSpeed: 11.5,
  },
  enemy_cleave: {
    kind: "enemy_cleave",
    windupMs: 560,
    activeMs: 200,
    recoveryMs: 480,
    range: 3.8,
    arcDot: -0.2,
    hpDamage: 22,
    postureDamage: 50,
    blockPostureDamage: 36,
    blockChipHp: 6,
    deflectAttackerPosture: 50,
    deflectSelfPosture: 8,
  },
  enemy_slam: {
    kind: "enemy_slam",
    windupMs: 740,
    activeMs: 210,
    recoveryMs: 580,
    range: 4.0,
    arcDot: 0.0,
    hpDamage: 30,
    postureDamage: 64,
    blockPostureDamage: 46,
    blockChipHp: 10,
    deflectAttackerPosture: 62,
    deflectSelfPosture: 9,
  },
  enemy_dread_cleave: {
    kind: "enemy_dread_cleave",
    windupMs: 620,
    activeMs: 220,
    recoveryMs: 520,
    range: 4.35,
    arcDot: -0.35,
    hpDamage: 25,
    postureDamage: 54,
    blockPostureDamage: 40,
    blockChipHp: 8,
    deflectAttackerPosture: 56,
    deflectSelfPosture: 8,
    lungeSpeed: 3.2,
  },
  enemy_shockwave_slam: {
    kind: "enemy_shockwave_slam",
    windupMs: 820,
    activeMs: 240,
    recoveryMs: 640,
    range: 4.9,
    arcDot: -1.0, // Full 360° seismic shockwave around the Colossus
    hpDamage: 30,
    postureDamage: 72,
    blockPostureDamage: 52,
    blockChipHp: 14,
    deflectAttackerPosture: 68,
    deflectSelfPosture: 10,
    lungeSpeed: 2.2,
  },
  enemy_fire_breath: {
    kind: "enemy_fire_breath",
    windupMs: 680,
    activeMs: 280,
    recoveryMs: 540,
    range: 6.2,
    arcDot: 0.45, // Forward draconic flame cone
    hpDamage: 18,
    postureDamage: 48,
    blockPostureDamage: 38,
    blockChipHp: 12,
    deflectAttackerPosture: 54,
    deflectSelfPosture: 8,
    lungeSpeed: 1.5,
  },
  enemy_tail_whip: {
    kind: "enemy_tail_whip",
    windupMs: 580,
    activeMs: 220,
    recoveryMs: 500,
    range: 4.8,
    arcDot: -1.0, // Full 360° draconic tail sweep
    hpDamage: 24,
    postureDamage: 58,
    blockPostureDamage: 42,
    blockChipHp: 8,
    deflectAttackerPosture: 60,
    deflectSelfPosture: 8,
  },
  enemy_dive_lunge: {
    kind: "enemy_dive_lunge",
    windupMs: 640,
    activeMs: 220,
    recoveryMs: 540,
    range: 4.5,
    arcDot: 0.35,
    hpDamage: 27,
    postureDamage: 62,
    blockPostureDamage: 46,
    blockChipHp: 10,
    deflectAttackerPosture: 66,
    deflectSelfPosture: 9,
    lungeSpeed: 14.0,
  },
  enemy_fireball: {
    kind: "enemy_fireball",
    windupMs: 620,
    activeMs: 140,
    recoveryMs: 520,
    range: 16.0,
    arcDot: 0.5,
    hpDamage: 18,
    postureDamage: 34,
    blockPostureDamage: 24,
    blockChipHp: 6,
    deflectAttackerPosture: 32,
    deflectSelfPosture: 6,
  },
  enemy_stun_bolt: {
    kind: "enemy_stun_bolt",
    windupMs: 540,
    activeMs: 120,
    recoveryMs: 460,
    range: 18.0,
    arcDot: 0.5,
    hpDamage: 10,
    postureDamage: 26,
    blockPostureDamage: 18,
    blockChipHp: 4,
    deflectAttackerPosture: 30,
    deflectSelfPosture: 5,
  },
  enemy_mist_slash: {
    kind: "enemy_mist_slash",
    windupMs: 420,
    activeMs: 180,
    recoveryMs: 400,
    range: 3.4,
    arcDot: 0.1,
    hpDamage: 18,
    postureDamage: 38,
    blockPostureDamage: 28,
    blockChipHp: 5,
    deflectAttackerPosture: 44,
    deflectSelfPosture: 7,
    lungeSpeed: 7.5,
  },
  enemy_wolf_bite: {
    kind: "enemy_wolf_bite",
    windupMs: 360,
    activeMs: 150,
    recoveryMs: 340,
    range: 2.6,
    arcDot: 0.35,
    hpDamage: 12,
    postureDamage: 24,
    blockPostureDamage: 18,
    blockChipHp: 0,
    deflectAttackerPosture: 36,
    deflectSelfPosture: 6,
  },
  enemy_wolf_pounce: {
    kind: "enemy_wolf_pounce",
    windupMs: 480,
    activeMs: 200,
    recoveryMs: 420,
    range: 3.7,
    arcDot: 0.4,
    hpDamage: 19,
    postureDamage: 40,
    blockPostureDamage: 28,
    blockChipHp: 4,
    deflectAttackerPosture: 48,
    deflectSelfPosture: 7,
    lungeSpeed: 12.5,
  },
  enemy_mech_slash: {
    kind: "enemy_mech_slash",
    windupMs: 580,
    activeMs: 220,
    recoveryMs: 500,
    range: 4.2,
    arcDot: -0.25,
    hpDamage: 26,
    postureDamage: 54,
    blockPostureDamage: 40,
    blockChipHp: 8,
    deflectAttackerPosture: 58,
    deflectSelfPosture: 8,
    lungeSpeed: 3.6,
  },
  enemy_stun_volley: {
    kind: "enemy_stun_volley",
    windupMs: 680,
    activeMs: 180,
    recoveryMs: 540,
    range: 18.0,
    arcDot: 0.45,
    hpDamage: 15,
    postureDamage: 34,
    blockPostureDamage: 26,
    blockChipHp: 6,
    deflectAttackerPosture: 40,
    deflectSelfPosture: 7,
  },
};

export const ENEMY_ARCHETYPES: Record<EnemyKind, EnemyArchetypeSpec> = {
  skirmisher: {
    kind: "skirmisher",
    name: "Velite Skirmisher",
    modelFile: "/assets/models/Skeleton_Minion.glb",
    scale: 0.95,
    maxHp: 85,
    maxPosture: 65,
    moveSpeed: 6.1 * MOVEMENT_SPEED_MULTIPLIER,
    canBlock: false,
    attackRange: 2.45,
    primaryAttack: "enemy_fast",
    heavyAttack: "enemy_light",
    accentColor: "#eab308",
  },
  legionary: {
    kind: "legionary",
    name: "Skeleton Legionary",
    modelFile: "/assets/models/Skeleton_Warrior.glb",
    scale: 1.06,
    maxHp: 145,
    maxPosture: 100,
    moveSpeed: 4.9 * MOVEMENT_SPEED_MULTIPLIER,
    canBlock: true,
    attackRange: 2.7,
    primaryAttack: "enemy_light",
    heavyAttack: "enemy_heavy",
    accentColor: "#dc2626",
  },
  assassin: {
    kind: "assassin",
    name: "Arena Stalker",
    modelFile: "/assets/models/Skeleton_Rogue.glb",
    scale: 1.02,
    maxHp: 110,
    maxPosture: 80,
    moveSpeed: 6.7 * MOVEMENT_SPEED_MULTIPLIER,
    canBlock: false,
    attackRange: 3.25,
    primaryAttack: "enemy_fast",
    heavyAttack: "enemy_lunge",
    accentColor: "#a855f7",
  },
  champion: {
    kind: "champion",
    name: "Murmillo Champion",
    modelFile: "/assets/models/Barbarian.glb",
    scale: 1.28,
    maxHp: 360,
    maxPosture: 160,
    moveSpeed: 4.1 * MOVEMENT_SPEED_MULTIPLIER,
    canBlock: true,
    attackRange: 3.45,
    primaryAttack: "enemy_cleave",
    heavyAttack: "enemy_slam",
    accentColor: "#f97316",
    isBoss: true,
  },
  dread_knight: {
    kind: "dread_knight",
    name: "Iron Dread Knight",
    modelFile: "/assets/enemies/DreadKnight.glb",
    scale: 1.48,
    maxHp: 460,
    maxPosture: 200,
    moveSpeed: 3.4 * MOVEMENT_SPEED_MULTIPLIER,
    canBlock: true,
    attackRange: 3.9,
    primaryAttack: "enemy_dread_cleave",
    heavyAttack: "enemy_shockwave_slam",
    accentColor: "#ef4444",
    isBoss: true,
  },
  dragon: {
    kind: "dragon",
    name: "Crimson Wyvern",
    modelFile: "/assets/enemies/Dragon.glb",
    scale: 1.55,
    maxHp: 560,
    maxPosture: 220,
    moveSpeed: 5.4 * MOVEMENT_SPEED_MULTIPLIER,
    canBlock: false,
    attackRange: 5.6,
    primaryAttack: "enemy_fire_breath",
    heavyAttack: "enemy_tail_whip",
    accentColor: "#ff4500",
    isBoss: true,
  },
  pyromancer: {
    kind: "pyromancer",
    name: "Cinder Necromancer",
    modelFile: "/assets/enemies/Skeleton_Mage.glb",
    scale: 1.05,
    maxHp: 115,
    maxPosture: 75,
    moveSpeed: 4.2 * MOVEMENT_SPEED_MULTIPLIER,
    canBlock: false,
    attackRange: 13.5,
    primaryAttack: "enemy_fireball",
    heavyAttack: "enemy_fireball",
    accentColor: "#fb923c",
  },
  stun_drone: {
    kind: "stun_drone",
    name: "Voltaic Hover-Drone",
    modelFile: "/assets/enemies/Enemy_Flying_Gun.glb",
    scale: 1.1,
    maxHp: 105,
    maxPosture: 70,
    moveSpeed: 5.6 * MOVEMENT_SPEED_MULTIPLIER,
    canBlock: false,
    attackRange: 14.5,
    primaryAttack: "enemy_stun_bolt",
    heavyAttack: "enemy_stun_bolt",
    accentColor: "#22d3ee",
  },
  mist_shinobi: {
    kind: "mist_shinobi",
    name: "Tengu Reaper",
    modelFile: "/assets/enemies/AvianSwordsman.glb",
    scale: 1.08,
    maxHp: 155,
    maxPosture: 105,
    moveSpeed: 6.4 * MOVEMENT_SPEED_MULTIPLIER,
    canBlock: true,
    attackRange: 3.1,
    primaryAttack: "enemy_mist_slash",
    heavyAttack: "enemy_lunge",
    accentColor: "#c084fc",
  },
  dire_wolf: {
    kind: "dire_wolf",
    name: "Shadow Direwolf",
    modelFile: "/assets/enemies/Wolf.glb",
    scale: 1.15,
    maxHp: 120,
    maxPosture: 85,
    moveSpeed: 7.4 * MOVEMENT_SPEED_MULTIPLIER,
    canBlock: false,
    attackRange: 2.8,
    primaryAttack: "enemy_wolf_bite",
    heavyAttack: "enemy_wolf_pounce",
    accentColor: "#94a3b8",
  },
  aegis_mech: {
    kind: "aegis_mech",
    name: "Aegis War-Mech",
    modelFile: "/assets/enemies/AegisMech.glb",
    scale: 1.45,
    maxHp: 520,
    maxPosture: 210,
    moveSpeed: 4.0 * MOVEMENT_SPEED_MULTIPLIER,
    canBlock: true,
    attackRange: 4.1,
    primaryAttack: "enemy_mech_slash",
    heavyAttack: "enemy_stun_volley",
    accentColor: "#06b6d4",
    isBoss: true,
  },
};

export function getWavePlan(wave: number): WaveDefinition {
  const normalizedWave = Math.max(1, Math.floor(wave));

  if (normalizedWave === 1) {
    return {
      wave: 1,
      title: "Wave I — The Opening Bout",
      enemies: ["skirmisher", "skirmisher", "legionary"],
      maxConcurrent: 3,
      hpScale: 1.0,
    };
  }
  if (normalizedWave === 2) {
    return {
      wave: 2,
      title: "Wave II — Fangs & Cinders",
      enemies: ["dire_wolf", "pyromancer", "assassin", "stun_drone", "legionary"],
      maxConcurrent: 4,
      hpScale: 1.0,
    };
  }
  if (normalizedWave === 3) {
    return {
      wave: 3,
      title: "Wave III — The Iron Colossus",
      enemies: ["dread_knight", "mist_shinobi", "pyromancer", "stun_drone", "dire_wolf", "legionary"],
      maxConcurrent: 4,
      hpScale: 1.05,
    };
  }
  if (normalizedWave === 4) {
    return {
      wave: 4,
      title: "Wave IV — Trial of Blood: The Champion",
      enemies: ["champion", "mist_shinobi", "pyromancer", "stun_drone", "dire_wolf"],
      maxConcurrent: 4,
      hpScale: 1.05,
    };
  }
  if (normalizedWave === 5) {
    return {
      wave: 5,
      title: "Wave V — Wrath of the Wyvern & Aegis",
      enemies: [
        "dragon",
        "aegis_mech",
        "pyromancer",
        "mist_shinobi",
        "stun_drone",
        "dire_wolf",
        "assassin",
        "legionary",
        "skirmisher",
      ],
      maxConcurrent: 4,
      hpScale: 1.1,
    };
  }

  const count = Math.min(10, 4 + normalizedWave);
  const enemies: EnemyKind[] = [];
  const themeIdx = (normalizedWave - 6) % 3;
  let themeTitle: string;

  if (themeIdx === 0) {
    themeTitle = `Wave ${normalizedWave} — Twin Titans`;
    enemies.push("champion", "dread_knight");
  } else if (themeIdx === 1) {
    themeTitle = `Wave ${normalizedWave} — Ashen Sky`;
    enemies.push("dragon", "dread_knight", "aegis_mech");
    if (normalizedWave % 2 === 0) enemies.push("champion");
  } else {
    themeTitle = `Wave ${normalizedWave} — Imperial Pantheon`;
    enemies.push("champion", "dragon", "aegis_mech");
  }

  const pool: EnemyKind[] = [
    "mist_shinobi",
    "pyromancer",
    "stun_drone",
    "dire_wolf",
    "assassin",
    "legionary",
  ];
  let idx = (normalizedWave - 5) % pool.length;
  while (enemies.length < count) {
    enemies.push(pool[idx % pool.length]);
    idx++;
  }

  return {
    wave: normalizedWave,
    title: themeTitle,
    enemies,
    maxConcurrent: 4,
    hpScale: Number((1 + (normalizedWave - 4) * 0.1).toFixed(2)),
  };
}

/** Forward unit vector matching Three.js rotation.y = yaw (yaw=0 -> +Z, yaw=PI -> -Z). */
export function forwardFromYaw(yaw: number): { x: number; z: number } {
  return { x: Math.sin(yaw), z: Math.cos(yaw) };
}

export function yawFromDelta(dx: number, dz: number): number {
  return Math.atan2(dx, dz);
}

function pushOutsideSquareAABB(
  cx: number,
  cz: number,
  boxX: number,
  boxZ: number,
  half: number,
  entityRadius: number
): { x: number; z: number } {
  const closestX = Math.max(boxX - half, Math.min(cx, boxX + half));
  const closestZ = Math.max(boxZ - half, Math.min(cz, boxZ + half));
  const dx = cx - closestX;
  const dz = cz - closestZ;
  const distSq = dx * dx + dz * dz;

  if (distSq === 0) {
    const penLeft = cx - (boxX - half);
    const penRight = boxX + half - cx;
    const penTop = cz - (boxZ - half);
    const penBottom = boxZ + half - cz;
    const minPen = Math.min(penLeft, penRight, penTop, penBottom);
    if (minPen === penLeft) return { x: boxX - half - entityRadius, z: cz };
    if (minPen === penRight) return { x: boxX + half + entityRadius, z: cz };
    if (minPen === penTop) return { x: cx, z: boxZ - half - entityRadius };
    return { x: cx, z: boxZ + half + entityRadius };
  }
  if (distSq < entityRadius * entityRadius) {
    const dist = Math.sqrt(distSq);
    return {
      x: closestX + (dx / dist) * entityRadius,
      z: closestZ + (dz / dist) * entityRadius,
    };
  }
  return { x: cx, z: cz };
}

export const SUNLIT_HORSE_COLLIDERS = [
  { x: -6.4, z: -22.2, half: 0.95 },
  { x: 6.4, z: -22.2, half: 0.95 },
] as const;

/** Clamps an XZ position inside the circular Colosseum arena and outside all 4 square pillar plinths + gate lever (+ map-specific props). */
export function clampToArena(
  x: number,
  z: number,
  entityRadius: number = ARENA.ENTITY_RADIUS,
  allowNorthAlcove = false,
  mapKind?: import("./types.js").ArenaMapKind
): { x: number; z: number } {
  let cx = x;
  let cz = z;
  const leverHalf = 0.45;
  const leverX = ARENA.NORTH_GATE.leverX;
  const leverZ = ARENA.NORTH_GATE.leverZ;
  const maxR = ARENA.PLAYABLE_RADIUS - entityRadius;

  // Two-pass solver guarantees zero pinch traps where an obstacle and perimeter wall meet
  for (let pass = 0; pass < 2; pass++) {
    for (const pillar of ARENA.PILLARS) {
      const pushed = pushOutsideSquareAABB(
        cx,
        cz,
        pillar.x,
        pillar.z,
        pillar.radius * 1.08,
        entityRadius
      );
      cx = pushed.x;
      cz = pushed.z;
    }

    const leverPushed = pushOutsideSquareAABB(cx, cz, leverX, leverZ, leverHalf, entityRadius);
    cx = leverPushed.x;
    cz = leverPushed.z;

    if (mapKind === "sunlit_colosseum") {
      for (const horse of SUNLIT_HORSE_COLLIDERS) {
        const hp = pushOutsideSquareAABB(cx, cz, horse.x, horse.z, horse.half, entityRadius);
        cx = hp.x;
        cz = hp.z;
      }
    }

    const inNorthCorridor =
      allowNorthAlcove && Math.abs(cx) < ARENA.NORTH_GATE.width * 0.42 && cz < -20 && cz > -30;

    if (!inNorthCorridor) {
      const rSq = cx * cx + cz * cz;
      if (rSq > maxR * maxR) {
        const r = Math.sqrt(rSq);
        cx = (cx / r) * maxR;
        cz = (cz / r) * maxR;
      }
    }
  }

  return { x: cx, z: cz };
}
