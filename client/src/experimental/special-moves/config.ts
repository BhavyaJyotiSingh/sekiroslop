/**
 * Experimental Combat Arts — Feature Flag & Static Specification
 *
 * Completely isolated experimental module for all 14 Sekiro-inspired Combat Arts:
 *   Mortal Blade: Sakura Dance, Mortal Draw, Empowered Mortal Draw
 *   Ashina Arts:  Ichimonji, Ichimonji Double, Ashina Cross, Dragon Flash
 *   Shinobi Arts: Whirlwind Slash, Nightjar Slash, Floating Passage, Shadowrush
 *   Mushin Arts:  Spiral Cloud Passage, One Mind
 *   Temple Arts:  High Monk
 *
 * To disable cleanly without removing files, flip EXPERIMENTAL_SPECIAL_MOVES to false.
 */

import type { CombatArtKind } from "@sekiroslop/shared";

export const EXPERIMENTAL_SPECIAL_MOVES = true;

export type ExperimentalArtTree = "mortal" | "ashina" | "shinobi" | "mushin" | "temple";

export type ExperimentalArtKind =
  | CombatArtKind
  | "mortal_draw_empowered"
  | "ichimonji"
  | "nightjar_slash"
  | "floating_passage"
  | "high_monk";

export interface ExperimentalArtHitWindow {
  readonly id: string;
  readonly label: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly damage: number;
  readonly postureDamage: number;
  readonly range: number;
  readonly arcRadians: number;
  readonly verticalOffset: number;
  readonly knockback: number;
}

export interface ExperimentalArtSpec {
  readonly kind: ExperimentalArtKind;
  readonly tree: ExperimentalArtTree;
  readonly icon: string;
  readonly name: string;
  readonly shortName: string;
  readonly subtitle: string;
  readonly primaryKey: string;
  readonly primaryCode: string;
  readonly altKey: string;
  readonly altCode: string;
  readonly durationMs: number;
  readonly cooldownMs: number;
  readonly clipName: string;
  readonly accentColor: string;
  readonly secondaryColor: string;
  readonly bladeGlowColor: string;
  readonly bladeGlowIntensity: number;
  readonly forwardLunge: number;
  readonly apexHeight: number;
  readonly hitWindows: readonly ExperimentalArtHitWindow[];
}

export const EXPERIMENTAL_PANEL_TOGGLE_KEY = "0";
export const EXPERIMENTAL_PANEL_TOGGLE_CODE = "Digit0";
export const EXPERIMENTAL_CYCLE_PREV_CODE = "BracketLeft";
export const EXPERIMENTAL_CYCLE_NEXT_CODE = "BracketRight";
export const EXPERIMENTAL_CAST_SELECTED_CODE = "Backslash";

export const EXPERIMENTAL_ART_TREES: readonly {
  readonly id: ExperimentalArtTree | "all";
  readonly label: string;
  readonly color: string;
}[] = [
  { id: "all", label: "ALL", color: "#fde047" },
  { id: "ashina", label: "ASHINA", color: "#38bdf8" },
  { id: "shinobi", label: "SHINOBI", color: "#a7f3d0" },
  { id: "mushin", label: "MUSHIN", color: "#c084fc" },
  { id: "mortal", label: "MORTAL", color: "#f43f5e" },
  { id: "temple", label: "TEMPLE", color: "#fbbf24" },
];

export const EXPERIMENTAL_ARTS: Record<ExperimentalArtKind, ExperimentalArtSpec> = {
  sakura_dance: {
    kind: "sakura_dance",
    tree: "mortal",
    icon: "✿",
    name: "Sakura Dance",
    shortName: "Sakura Dance",
    subtitle: "3-Stage Leaping Aerial Blossom Slash",
    primaryKey: "7",
    primaryCode: "Digit7",
    altKey: "",
    altCode: "",
    durationMs: 1650,
    cooldownMs: 7500,
    clipName: "Experimental_Sakura_Dance",
    accentColor: "#f472b6",
    secondaryColor: "#fbcfe8",
    bladeGlowColor: "#f9a8d4",
    bladeGlowIntensity: 1.75,
    forwardLunge: 2.2,
    apexHeight: 1.55,
    hitWindows: [
      { id: "sakura_1", label: "Rising Diagonal", startMs: 280, endMs: 460, damage: 7, postureDamage: 13, range: 3.1, arcRadians: Math.PI * 0.85, verticalOffset: 1.05, knockback: 0.6 },
      { id: "sakura_2", label: "Inverted Cross", startMs: 620, endMs: 820, damage: 8, postureDamage: 14, range: 3.35, arcRadians: Math.PI * 1.05, verticalOffset: 1.75, knockback: 0.8 },
      { id: "sakura_3", label: "Descending Crescent", startMs: 1000, endMs: 1240, damage: 11, postureDamage: 20, range: 3.65, arcRadians: Math.PI * 1.15, verticalOffset: 1.1, knockback: 1.4 },
    ],
  },
  mortal_draw: {
    kind: "mortal_draw",
    tree: "mortal",
    icon: "⚔",
    name: "Mortal Draw",
    shortName: "Mortal Draw",
    subtitle: "Combined Twin Crimson-Shadow Blade Waves",
    primaryKey: "8",
    primaryCode: "Digit8",
    altKey: "N",
    altCode: "KeyN",
    durationMs: 1950,
    cooldownMs: 10000,
    clipName: "Experimental_Mortal_Draw",
    accentColor: "#ef4444",
    secondaryColor: "#090103",
    bladeGlowColor: "#ff1e3c",
    bladeGlowIntensity: 2.55,
    forwardLunge: 2.35,
    apexHeight: 0,
    hitWindows: [
      { id: "emp_mortal_1", label: "First Mortal Wave", startMs: 480, endMs: 720, damage: 17, postureDamage: 30, range: 5.8, arcRadians: Math.PI * 0.95, verticalOffset: 1.12, knockback: 1.6 },
      { id: "emp_mortal_2", label: "Second Reversed Wave", startMs: 1060, endMs: 1360, damage: 25, postureDamage: 45, range: 6.3, arcRadians: Math.PI * 1.12, verticalOffset: 1.2, knockback: 3.1 },
    ],
  },
  mortal_draw_empowered: {
    kind: "mortal_draw_empowered",
    tree: "mortal",
    icon: "✦",
    name: "Empowered Mortal Draw",
    shortName: "Emp. Mortal",
    subtitle: "Twin Colossal Mortal Blade Waves",
    primaryKey: "9",
    primaryCode: "Digit9",
    altKey: "M",
    altCode: "KeyM",
    durationMs: 1950,
    cooldownMs: 12000,
    clipName: "Experimental_Mortal_Draw_Empowered",
    accentColor: "#ef4444",
    secondaryColor: "#090103",
    bladeGlowColor: "#ff1e3c",
    bladeGlowIntensity: 2.55,
    forwardLunge: 2.35,
    apexHeight: 0,
    hitWindows: [
      { id: "emp_mortal_1", label: "First Mortal Wave", startMs: 480, endMs: 720, damage: 17, postureDamage: 30, range: 5.8, arcRadians: Math.PI * 0.95, verticalOffset: 1.12, knockback: 1.6 },
      { id: "emp_mortal_2", label: "Second Reversed Wave", startMs: 1060, endMs: 1360, damage: 25, postureDamage: 45, range: 6.3, arcRadians: Math.PI * 1.12, verticalOffset: 1.2, knockback: 3.1 },
    ],
  },
  ichimonji: {
    kind: "ichimonji",
    tree: "ashina",
    icon: "丨",
    name: "Ichimonji",
    shortName: "Ichimonji",
    subtitle: "Overhead Split • Restores Posture",
    primaryKey: "Y",
    primaryCode: "KeyY",
    altKey: "",
    altCode: "",
    durationMs: 950,
    cooldownMs: 5500,
    clipName: "Experimental_Ichimonji",
    accentColor: "#38bdf8",
    secondaryColor: "#e0f2fe",
    bladeGlowColor: "#7dd3fc",
    bladeGlowIntensity: 1.75,
    forwardLunge: 1.1,
    apexHeight: 0,
    hitWindows: [
      { id: "ichimonji_1", label: "Overhead Cleave", startMs: 360, endMs: 540, damage: 16, postureDamage: 40, range: 3.5, arcRadians: Math.PI * 0.52, verticalOffset: 1.15, knockback: 1.8 },
    ],
  },
  ichimonji_double: {
    kind: "ichimonji_double",
    tree: "ashina",
    icon: "‖",
    name: "Ichimonji",
    shortName: "Ichimonji",
    subtitle: "Combined Twin Overhead Splits • Posture Crush",
    primaryKey: "3",
    primaryCode: "Digit3",
    altKey: "T",
    altCode: "KeyT",
    durationMs: 1450,
    cooldownMs: 7500,
    clipName: "Experimental_Ichimonji_Double",
    accentColor: "#0ea5e9",
    secondaryColor: "#bae6fd",
    bladeGlowColor: "#38bdf8",
    bladeGlowIntensity: 1.95,
    forwardLunge: 1.65,
    apexHeight: 0,
    hitWindows: [
      { id: "ichi2_1", label: "First Split", startMs: 340, endMs: 500, damage: 11, postureDamage: 30, range: 3.5, arcRadians: Math.PI * 0.52, verticalOffset: 1.15, knockback: 1.1 },
      { id: "ichi2_2", label: "Second Split", startMs: 880, endMs: 1080, damage: 16, postureDamage: 42, range: 3.75, arcRadians: Math.PI * 0.58, verticalOffset: 1.12, knockback: 2.2 },
    ],
  },
  ashina_cross: {
    kind: "ashina_cross",
    tree: "ashina",
    icon: "✕",
    name: "Ashina Cross",
    shortName: "Ashina Cross",
    subtitle: "Sheathed Iaijutsu Twin Cross Slash",
    primaryKey: "U",
    primaryCode: "KeyU",
    altKey: "",
    altCode: "",
    durationMs: 950,
    cooldownMs: 6500,
    clipName: "Experimental_Ashina_Cross",
    accentColor: "#60a5fa",
    secondaryColor: "#ffffff",
    bladeGlowColor: "#93c5fd",
    bladeGlowIntensity: 2.05,
    forwardLunge: 2.8,
    apexHeight: 0,
    hitWindows: [
      { id: "across_1", label: "Iai Draw X-Cut 1", startMs: 340, endMs: 460, damage: 12, postureDamage: 23, range: 4.1, arcRadians: Math.PI * 0.85, verticalOffset: 1.05, knockback: 0.7 },
      { id: "across_2", label: "Iai Draw X-Cut 2", startMs: 460, endMs: 620, damage: 15, postureDamage: 27, range: 4.2, arcRadians: Math.PI * 0.85, verticalOffset: 1.1, knockback: 1.5 },
    ],
  },
  dragon_flash: {
    kind: "dragon_flash",
    tree: "ashina",
    icon: "⚡",
    name: "Dragon Flash",
    shortName: "Dragon Flash",
    subtitle: "Sword-Saint Gale Beam + Shockwave",
    primaryKey: "I",
    primaryCode: "KeyI",
    altKey: "",
    altCode: "",
    durationMs: 1300,
    cooldownMs: 9000,
    clipName: "Experimental_Dragon_Flash",
    accentColor: "#22d3ee",
    secondaryColor: "#fef08a",
    bladeGlowColor: "#67e8f9",
    bladeGlowIntensity: 2.35,
    forwardLunge: 1.3,
    apexHeight: 0,
    hitWindows: [
      { id: "dflash_1", label: "Initial Gale Cut", startMs: 390, endMs: 560, damage: 12, postureDamage: 26, range: 5.5, arcRadians: Math.PI * 0.65, verticalOffset: 1.1, knockback: 1.2 },
      { id: "dflash_2", label: "Shockwave Beam", startMs: 760, endMs: 1020, damage: 20, postureDamage: 42, range: 7.2, arcRadians: Math.PI * 0.45, verticalOffset: 1.15, knockback: 2.9 },
    ],
  },
  whirlwind_slash: {
    kind: "whirlwind_slash",
    tree: "shinobi",
    icon: "◎",
    name: "Whirlwind Slash",
    shortName: "Whirlwind",
    subtitle: "360° Twin Chip-Damage Spinning Cuts",
    primaryKey: ",",
    primaryCode: "Comma",
    altKey: "",
    altCode: "",
    durationMs: 1050,
    cooldownMs: 5500,
    clipName: "Experimental_Whirlwind_Slash",
    accentColor: "#34d399",
    secondaryColor: "#ecfdf5",
    bladeGlowColor: "#6ee7b7",
    bladeGlowIntensity: 1.7,
    forwardLunge: 1.8,
    apexHeight: 0,
    hitWindows: [
      { id: "whirl_1", label: "First Spin Cut", startMs: 220, endMs: 420, damage: 9, postureDamage: 17, range: 3.9, arcRadians: Math.PI * 2, verticalOffset: 1.0, knockback: 0.7 },
      { id: "whirl_2", label: "Second Spin Cut", startMs: 520, endMs: 740, damage: 11, postureDamage: 22, range: 4.1, arcRadians: Math.PI * 2, verticalOffset: 1.0, knockback: 1.5 },
    ],
  },
  nightjar_slash: {
    kind: "nightjar_slash",
    tree: "shinobi",
    icon: "🦅",
    name: "Nightjar Slash",
    shortName: "Nightjar",
    subtitle: "Acrobatic Leaping Somersault Cleave",
    primaryKey: ".",
    primaryCode: "Period",
    altKey: "",
    altCode: "",
    durationMs: 1050,
    cooldownMs: 5500,
    clipName: "Experimental_Nightjar_Slash",
    accentColor: "#a7f3d0",
    secondaryColor: "#38bdf8",
    bladeGlowColor: "#6ee7b7",
    bladeGlowIntensity: 1.8,
    forwardLunge: 3.4,
    apexHeight: 1.35,
    hitWindows: [
      { id: "nightjar_1", label: "Flipping Dive Cleave", startMs: 440, endMs: 680, damage: 16, postureDamage: 32, range: 3.6, arcRadians: Math.PI * 0.72, verticalOffset: 1.1, knockback: 2.0 },
    ],
  },
  floating_passage: {
    kind: "floating_passage",
    tree: "shinobi",
    icon: "〰",
    name: "Floating Passage",
    shortName: "Float Passage",
    subtitle: "Tomoe 5-Stroke Flowing Flurry",
    primaryKey: "-",
    primaryCode: "Minus",
    altKey: "",
    altCode: "",
    durationMs: 1380,
    cooldownMs: 7000,
    clipName: "Experimental_Floating_Passage",
    accentColor: "#2dd4bf",
    secondaryColor: "#e0f2fe",
    bladeGlowColor: "#5eead4",
    bladeGlowIntensity: 1.75,
    forwardLunge: 2.1,
    apexHeight: 0,
    hitWindows: [
      { id: "fp_1", label: "Stroke I", startMs: 160, endMs: 280, damage: 5, postureDamage: 10, range: 3.3, arcRadians: Math.PI * 0.85, verticalOffset: 1.0, knockback: 0.4 },
      { id: "fp_2", label: "Stroke II", startMs: 360, endMs: 480, damage: 5, postureDamage: 10, range: 3.3, arcRadians: Math.PI * 0.85, verticalOffset: 1.05, knockback: 0.4 },
      { id: "fp_3", label: "Stroke III Spin", startMs: 560, endMs: 690, damage: 6, postureDamage: 12, range: 3.6, arcRadians: Math.PI * 1.4, verticalOffset: 1.0, knockback: 0.5 },
      { id: "fp_4", label: "Stroke IV Cross", startMs: 760, endMs: 890, damage: 6, postureDamage: 12, range: 3.4, arcRadians: Math.PI * 0.9, verticalOffset: 1.1, knockback: 0.5 },
      { id: "fp_5", label: "Rising Tomoe Finisher", startMs: 960, endMs: 1140, damage: 10, postureDamage: 19, range: 3.7, arcRadians: Math.PI * 0.95, verticalOffset: 1.2, knockback: 1.6 },
    ],
  },
  shadowrush: {
    kind: "shadowrush",
    tree: "shinobi",
    icon: "➤",
    name: "Shadowfall",
    shortName: "Shadowfall",
    subtitle: "Combined Shadow Pierce → Owl Vault → Falcon Plunge",
    primaryKey: "=",
    primaryCode: "Equal",
    altKey: "",
    altCode: "",
    durationMs: 1350,
    cooldownMs: 8500,
    clipName: "Experimental_Shadowrush",
    accentColor: "#4ade80",
    secondaryColor: "#fde047",
    bladeGlowColor: "#86efac",
    bladeGlowIntensity: 1.95,
    forwardLunge: 3.8,
    apexHeight: 1.6,
    hitWindows: [
      { id: "srush_1", label: "Shadow Pierce", startMs: 260, endMs: 440, damage: 13, postureDamage: 27, range: 5.2, arcRadians: Math.PI * 0.45, verticalOffset: 1.0, knockback: 0.9 },
      { id: "srush_2", label: "Descending Falcon Cut", startMs: 880, endMs: 1100, damage: 16, postureDamage: 30, range: 3.6, arcRadians: Math.PI * 0.9, verticalOffset: 1.2, knockback: 2.1 },
    ],
  },
  spiral_cloud_passage: {
    kind: "spiral_cloud_passage",
    tree: "mushin",
    icon: "🌀",
    name: "Cloud Passage",
    shortName: "Cloud Passage",
    subtitle: "Combined Tomoe & Mushin Cyclone Sword Dance",
    primaryKey: "/",
    primaryCode: "Slash",
    altKey: "",
    altCode: "",
    durationMs: 1500,
    cooldownMs: 10000,
    clipName: "Experimental_Spiral_Cloud_Passage",
    accentColor: "#a855f7",
    secondaryColor: "#e0f2fe",
    bladeGlowColor: "#c084fc",
    bladeGlowIntensity: 2.2,
    forwardLunge: 2.6,
    apexHeight: 0.45,
    hitWindows: [
      { id: "scp_1", label: "Gale I", startMs: 180, endMs: 320, damage: 6, postureDamage: 12, range: 3.8, arcRadians: Math.PI * 1.4, verticalOffset: 1.0, knockback: 0.4 },
      { id: "scp_2", label: "Gale II", startMs: 390, endMs: 530, damage: 7, postureDamage: 13, range: 3.9, arcRadians: Math.PI * 1.6, verticalOffset: 1.1, knockback: 0.5 },
      { id: "scp_3", label: "Gale III", startMs: 600, endMs: 740, damage: 7, postureDamage: 13, range: 4.1, arcRadians: Math.PI * 1.8, verticalOffset: 1.1, knockback: 0.6 },
      { id: "scp_4", label: "Gale IV Finisher", startMs: 860, endMs: 1140, damage: 12, postureDamage: 26, range: 4.4, arcRadians: Math.PI * 2, verticalOffset: 1.15, knockback: 2.2 },
    ],
  },
  one_mind: {
    kind: "one_mind",
    tree: "mushin",
    icon: "☽",
    name: "One Mind",
    shortName: "One Mind",
    subtitle: "Sheathed Flash • Judgements of Ashina",
    primaryKey: "O",
    primaryCode: "KeyO",
    altKey: "",
    altCode: "",
    durationMs: 1550,
    cooldownMs: 11500,
    clipName: "Experimental_One_Mind",
    accentColor: "#e879f9",
    secondaryColor: "#ffffff",
    bladeGlowColor: "#f0abfc",
    bladeGlowIntensity: 2.45,
    forwardLunge: 2.4,
    apexHeight: 0,
    hitWindows: [
      { id: "om_1", label: "First Sheathe Flash", startMs: 280, endMs: 420, damage: 11, postureDamage: 22, range: 4.4, arcRadians: Math.PI * 0.85, verticalOffset: 1.05, knockback: 0.6 },
      { id: "om_2", label: "Phantom Flurry I", startMs: 560, endMs: 720, damage: 8, postureDamage: 16, range: 4.8, arcRadians: Math.PI * 1.4, verticalOffset: 1.15, knockback: 0.4 },
      { id: "om_3", label: "Phantom Flurry II", startMs: 780, endMs: 940, damage: 8, postureDamage: 16, range: 4.8, arcRadians: Math.PI * 1.4, verticalOffset: 1.15, knockback: 0.4 },
      { id: "om_4", label: "Decisive Crimson Cut", startMs: 1080, endMs: 1280, damage: 16, postureDamage: 32, range: 5.0, arcRadians: Math.PI * 1.1, verticalOffset: 1.1, knockback: 2.4 },
    ],
  },
  high_monk: {
    kind: "high_monk",
    tree: "temple",
    icon: "☸",
    name: "High Monk",
    shortName: "High Monk",
    subtitle: "Senpou Sweep Counter → Cascading Flurry",
    primaryKey: ";",
    primaryCode: "Semicolon",
    altKey: "",
    altCode: "",
    durationMs: 1280,
    cooldownMs: 7000,
    clipName: "Experimental_High_Monk",
    accentColor: "#fbbf24",
    secondaryColor: "#fef3c7",
    bladeGlowColor: "#fde047",
    bladeGlowIntensity: 1.9,
    forwardLunge: 2.0,
    apexHeight: 1.2,
    hitWindows: [
      { id: "hm_1", label: "Sweep Counter Leap", startMs: 240, endMs: 420, damage: 10, postureDamage: 32, range: 3.4, arcRadians: Math.PI * 0.9, verticalOffset: 1.35, knockback: 0.7 },
      { id: "hm_2", label: "Monk Flurry I", startMs: 560, endMs: 730, damage: 8, postureDamage: 17, range: 3.5, arcRadians: Math.PI * 0.95, verticalOffset: 1.05, knockback: 0.7 },
      { id: "hm_3", label: "Monk Finisher", startMs: 820, endMs: 1020, damage: 11, postureDamage: 23, range: 3.7, arcRadians: Math.PI * 1.0, verticalOffset: 1.05, knockback: 1.7 },
    ],
  },
};

export const EXPERIMENTAL_ART_ORDER: readonly CombatArtKind[] = [
  "whirlwind_slash",
  "ichimonji_double",
  "ashina_cross",
  "dragon_flash",
  "shadowrush",
  "spiral_cloud_passage",
  "one_mind",
  "sakura_dance",
  "mortal_draw",
];

/**
 * Matches a KeyboardEvent.code against all experimental combat art hotkeys.
 */
export function matchExperimentalArtKey(code: string): CombatArtKind | null {
  for (const kind of EXPERIMENTAL_ART_ORDER) {
    const spec = EXPERIMENTAL_ARTS[kind];
    if (code === spec.primaryCode || (spec.altCode && code === spec.altCode)) {
      return kind;
    }
  }
  return null;
}

