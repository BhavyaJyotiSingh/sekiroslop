import { ATTACK_SPECS, type AttackKind } from "@sekiroslop/shared";

/**
 * Master independent feature toggle for Experimental Sword Auras,
 * Real Weapon-Tracked Ribbon Trails, Combat Burst VFX & Swept Weapon Hitboxes.
 * Set to `false` to cleanly disable all visual and swept-hitbox features at once.
 */
export const EXPERIMENTAL_SWORD_VFX_AND_HITBOX = true;

export type SwordColorTheme = {
  /** Bright inner filament / hottest center color */
  core: string;
  /** Primary vivid slash edge color */
  edge: string;
  /** Flowing blade aura envelope color */
  aura: string;
  /** Emitted tip sparks and impact burst color */
  spark: string;
};

export type SwordThemeKey =
  | "light1"
  | "light2"
  | "heavy"
  | "thrust"
  | "whirlwind"
  | "aerial_slam"
  | "counter"
  | "sakura_dance"
  | "mortal_draw"
  | "mortal_draw_empowered"
  | "ichimonji"
  | "ichimonji_double"
  | "ashina_cross"
  | "dragon_flash"
  | "whirlwind_slash"
  | "nightjar_slash"
  | "floating_passage"
  | "shadowrush"
  | "spiral_cloud_passage"
  | "one_mind"
  | "high_monk"
  | "block"
  | "idle";

/**
 * Distinct vivid colour palettes for every player attack, experimental Combat Art,
 * defensive stance, and idle blade state.
 */
export const ATTACK_VFX_THEMES: Record<SwordThemeKey, SwordColorTheme> = {
  light1: {
    core: "#f8fafc",
    edge: "#38bdf8",
    aura: "#7dd3fc",
    spark: "#bae6fd",
  },
  light2: {
    core: "#ffffff",
    edge: "#60a5fa",
    aura: "#3b82f6",
    spark: "#dbeafe",
  },
  heavy: {
    core: "#fef9c3",
    edge: "#f59e0b",
    aura: "#ea580c",
    spark: "#fde047",
  },
  thrust: {
    core: "#ffffff",
    edge: "#facc15",
    aura: "#f59e0b",
    spark: "#fef08a",
  },
  whirlwind: {
    core: "#fffbeb",
    edge: "#f97316",
    aura: "#ef4444",
    spark: "#fdba74",
  },
  aerial_slam: {
    core: "#fef3c7",
    edge: "#ea580c",
    aura: "#dc2626",
    spark: "#fb923c",
  },
  counter: {
    core: "#ffffff",
    edge: "#fde047",
    aura: "#fbbf24",
    spark: "#ffffff",
  },
  sakura_dance: {
    core: "#fff1f2",
    edge: "#f472b6",
    aura: "#ec4899",
    spark: "#fbcfe8",
  },
  mortal_draw: {
    core: "#ffe4e6",
    edge: "#dc2626",
    aura: "#7f1d1d",
    spark: "#f43f5e",
  },
  mortal_draw_empowered: {
    core: "#fff1f2",
    edge: "#e11d48",
    aura: "#9333ea",
    spark: "#fb7185",
  },
  ichimonji: {
    core: "#f0f9ff",
    edge: "#38bdf8",
    aura: "#0284c7",
    spark: "#bae6fd",
  },
  ichimonji_double: {
    core: "#ffffff",
    edge: "#0ea5e9",
    aura: "#0369a1",
    spark: "#7dd3fc",
  },
  ashina_cross: {
    core: "#ffffff",
    edge: "#60a5fa",
    aura: "#2563eb",
    spark: "#dbeafe",
  },
  dragon_flash: {
    core: "#fefce8",
    edge: "#22d3ee",
    aura: "#0891b2",
    spark: "#fef08a",
  },
  whirlwind_slash: {
    core: "#ecfdf5",
    edge: "#34d399",
    aura: "#059669",
    spark: "#a7f3d0",
  },
  nightjar_slash: {
    core: "#f0fdfa",
    edge: "#6ee7b7",
    aura: "#0284c7",
    spark: "#a7f3d0",
  },
  floating_passage: {
    core: "#f0f9ff",
    edge: "#2dd4bf",
    aura: "#0d9488",
    spark: "#99f6e4",
  },
  shadowrush: {
    core: "#fefce8",
    edge: "#4ade80",
    aura: "#15803d",
    spark: "#fde047",
  },
  spiral_cloud_passage: {
    core: "#f5f3ff",
    edge: "#a855f7",
    aura: "#7e22ce",
    spark: "#c084fc",
  },
  one_mind: {
    core: "#ffffff",
    edge: "#e879f9",
    aura: "#a21caf",
    spark: "#f5d0fe",
  },
  high_monk: {
    core: "#fffbeb",
    edge: "#fbbf24",
    aura: "#d97706",
    spark: "#fef3c7",
  },
  block: {
    core: "#e0f2fe",
    edge: "#3b82f6",
    aura: "#1d4ed8",
    spark: "#93c5fd",
  },
  idle: {
    core: "#e2e8f0",
    edge: "#94a3b8",
    aura: "#64748b",
    spark: "#cbd5e1",
  },
};

/** Optional extra palettes for enemy attacks & Warrior's Fury buff state. */
export const EXTRA_VFX_THEMES: Record<string, SwordColorTheme> = {
  fury: {
    core: "#fef3c7",
    edge: "#ef4444",
    aura: "#dc2626",
    spark: "#fb923c",
  },
  attack_light: {
    core: "#fef2f2",
    edge: "#f87171",
    aura: "#dc2626",
    spark: "#fca5a5",
  },
  attack_heavy: {
    core: "#fef3c7",
    edge: "#ea580c",
    aura: "#b91c1c",
    spark: "#fdba74",
  },
  enemy_fast: {
    core: "#fefce8",
    edge: "#eab308",
    aura: "#ca8a04",
    spark: "#fde047",
  },
  enemy_light: {
    core: "#fef2f2",
    edge: "#ef4444",
    aura: "#b91c1c",
    spark: "#fca5a5",
  },
  enemy_heavy: {
    core: "#fff7ed",
    edge: "#f97316",
    aura: "#9a3412",
    spark: "#fdba74",
  },
  enemy_lunge: {
    core: "#faf5ff",
    edge: "#a855f7",
    aura: "#7e22ce",
    spark: "#d8b4fe",
  },
  enemy_cleave: {
    core: "#fff7ed",
    edge: "#ea580c",
    aura: "#c2410c",
    spark: "#fb923c",
  },
  enemy_slam: {
    core: "#fef2f2",
    edge: "#dc2626",
    aura: "#991b1b",
    spark: "#f97316",
  },
};

/**
 * Resolves the appropriate SwordColorTheme for any combat action, defensive stance,
 * or active Warrior's Fury buff without allocating new objects.
 */
export function resolveSwordTheme(
  action: string,
  furyActive = false,
  isBlocking = false
): SwordColorTheme {
  if (action in ATTACK_VFX_THEMES) {
    const base = ATTACK_VFX_THEMES[action as SwordThemeKey];
    if (action === "idle") {
      if (isBlocking) return ATTACK_VFX_THEMES.block;
      if (furyActive) return EXTRA_VFX_THEMES.fury;
    }
    return base;
  }
  if (action in EXTRA_VFX_THEMES) {
    return EXTRA_VFX_THEMES[action];
  }
  if (isBlocking) {
    return ATTACK_VFX_THEMES.block;
  }
  if (furyActive) {
    return EXTRA_VFX_THEMES.fury;
  }
  return ATTACK_VFX_THEMES.idle;
}

export interface ActiveFrameWindow {
  /** Normalized progress [0..1] when windup ends and active hit frames begin */
  windupEnd: number;
  /** Normalized progress [0..1] when active hit frames end and recovery begins */
  activeEnd: number;
  windupMs: number;
  activeMs: number;
  recoveryMs: number;
  totalMs: number;
}

function fromTimings(windupMs: number, activeMs: number, recoveryMs: number): ActiveFrameWindow {
  const totalMs = Math.max(1, windupMs + activeMs + recoveryMs);
  return {
    windupEnd: windupMs / totalMs,
    activeEnd: (windupMs + activeMs) / totalMs,
    windupMs,
    activeMs,
    recoveryMs,
    totalMs,
  };
}

function buildActiveFrameTable(): Record<string, ActiveFrameWindow> {
  const table: Record<string, ActiveFrameWindow> = {};

  // Strictly mirror every attack timing from @sekiroslop/shared ATTACK_SPECS
  for (const key of Object.keys(ATTACK_SPECS) as AttackKind[]) {
    const spec = ATTACK_SPECS[key];
    table[key] = fromTimings(spec.windupMs, spec.activeMs, spec.recoveryMs);
  }

  // Alias enemy generic actions used by GladiatorModel state machine
  table.attack_light = table.enemy_light;
  table.attack_heavy = table.enemy_heavy;

  // Experimental Sekiro-inspired Combat Arts (synced with server experimental_art slash windows)
  table.sakura_dance = fromTimings(280, 960, 410); // 3 swirling slashes across 280..1240ms
  table.mortal_draw = fromTimings(480, 880, 590); // Combined twin crimson waves 480..1360ms
  table.mortal_draw_empowered = fromTimings(480, 880, 590); // Dual crimson sweep 480..1360ms
  table.ichimonji = fromTimings(360, 180, 410); // Overhead posture-crushing split
  table.ichimonji_double = fromTimings(340, 740, 370); // Twin overhead vertical splits
  table.ashina_cross = fromTimings(340, 280, 330); // Rapid iaijutsu twin X-slash
  table.dragon_flash = fromTimings(390, 630, 280); // Initial gale cut + delayed shockwave beam
  table.whirlwind_slash = fromTimings(220, 520, 310); // Twin 360-degree spinning cuts
  table.nightjar_slash = fromTimings(440, 240, 370); // Somersault diving cleave
  table.floating_passage = fromTimings(160, 980, 240); // Tomoe 5-stroke flowing flurry
  table.shadowrush = fromTimings(260, 840, 250); // Shadow pierce + owl vault + plunge cut
  table.spiral_cloud_passage = fromTimings(180, 960, 360); // Mushin cyclone 4-stage flurry
  table.one_mind = fromTimings(280, 1000, 270); // Sheathe flash + phantom flurry + crimson finisher
  table.high_monk = fromTimings(240, 780, 260); // Senpou sweep-counter leap + cascading flurry

  return table;
}

/**
 * Active-frame ratios (`windupEnd`, `activeEnd`) matching `@sekiroslop/shared` `ATTACK_SPECS`
 * plus experimental Combat Arts so swept hit detection strictly matches real animation active frames.
 */
export const ATTACK_ACTIVE_FRAMES: Readonly<Record<string, ActiveFrameWindow>> =
  buildActiveFrameTable();

/** Returns true if `action` is an offensive sword attack/art that tracks active hit frames. */
export function isOffensiveSwordAction(action: string): boolean {
  return action !== "punch" && action in ATTACK_ACTIVE_FRAMES;
}

/**
 * Checks whether a normalized animation progress `t` in `[0, 1]` falls within the
 * real active hit window `[windupEnd, activeEnd]` for the given attack action.
 */
export function isProgressInActiveFrames(action: string, normalizedProgress: number): boolean {
  const window = ATTACK_ACTIVE_FRAMES[action];
  if (!window) return false;
  return normalizedProgress >= window.windupEnd && normalizedProgress <= window.activeEnd;
}

/**
 * Checks whether elapsed attack time in milliseconds falls inside the active hit window.
 */
export function isElapsedInActiveFrames(action: string, elapsedMs: number): boolean {
  const window = ATTACK_ACTIVE_FRAMES[action];
  if (!window) return false;
  return elapsedMs >= window.windupMs && elapsedMs <= window.windupMs + window.activeMs;
}

/**
 * Computes desired blade aura glow intensity [0..2.2] for the current combat state.
 */
export function getBladeAuraIntensity(
  action: string,
  inActiveFrames: boolean,
  furyActive = false,
  isBlocking = false
): number {
  if (action === "mortal_draw_empowered" || action === "one_mind" || action === "dragon_flash") {
    return inActiveFrames ? 2.1 : 1.45;
  }
  if (
    action === "mortal_draw" ||
    action === "sakura_dance" ||
    action === "spiral_cloud_passage" ||
    action === "ashina_cross" ||
    action === "ichimonji_double" ||
    action === "shadowrush" ||
    action === "high_monk"
  ) {
    return inActiveFrames ? 1.85 : 1.25;
  }
  if (
    action === "ichimonji" ||
    action === "whirlwind_slash" ||
    action === "nightjar_slash" ||
    action === "floating_passage"
  ) {
    return inActiveFrames ? 1.7 : 1.1;
  }
  if (action === "counter") return inActiveFrames ? 1.9 : 1.1;
  if (action === "whirlwind" || action === "thrust" || action === "aerial_slam") {
    return inActiveFrames ? 1.65 : 0.95;
  }
  if (action === "heavy" || action === "attack_heavy" || action === "enemy_heavy" || action === "enemy_slam") {
    return inActiveFrames ? 1.45 : 0.78;
  }
  if (action === "windup_heavy") return 0.65;
  if (isOffensiveSwordAction(action)) {
    return inActiveFrames ? 1.15 : 0.45;
  }
  if (furyActive) return 0.95;
  if (isBlocking) return 0.52;
  return 0.0;
}

/** Geometry & buffer tuning constants matching GladiatorModel's RomanGladius mesh. */
export const SWORD_VFX_CONSTANTS = {
  /** Local Y of the blade root just above the gladius crossguard (`guard.y = 0.19`). */
  GLADIUS_LOCAL_BASE_Y: 0.22,
  /** Local Y of the gladius cone apex (`tip.y = 1.22`, height `0.22`). */
  GLADIUS_LOCAL_TIP_Y: 1.33,
  /** Ring buffer capacity of live (base, tip) world-space blade samples. */
  TRAIL_RING_SAMPLES: 18,
  /** Pre-allocated pooled blade-tip slash particles per weapon. */
  TIP_PARTICLE_POOL_SIZE: 48,
  /** Swept quad sub-sampling segments between consecutive frames to prevent tunneling. */
  SWEEP_SUBSTEPS: 4,
  /** Default upright gladiator capsule height (meters). */
  TARGET_CAPSULE_HEIGHT: 1.8,
  /** Default upright gladiator capsule radius (meters). */
  TARGET_CAPSULE_RADIUS: 0.52,
  /** Effective steel blade half-thickness radius added to capsule hit test (meters). */
  BLADE_COLLISION_RADIUS: 0.06,
  /** Squared distance jump threshold beyond which the trail resets (respawn/teleport guard). */
  TELEPORT_RESET_DIST_SQ: 9.0,
} as const;
