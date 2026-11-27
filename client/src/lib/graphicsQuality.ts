import { isTouchDevice } from "../input/touchInput";

export type GraphicsQualityPreset = "auto" | "low" | "medium" | "high";
export type GraphicsQualityTier = Exclude<GraphicsQualityPreset, "auto">;

export interface GraphicsQualityProfile {
  tier: GraphicsQualityTier;
  dpr: [number, number];
  antialias: boolean;
  shadowMap: "basic" | "percentage";
  shadowMapSize: 1024 | 2048;
  shadowFrustum: 22 | 26 | 27;
  maxAnisotropy: 1 | 2 | 4;
  pointLights: boolean;
  particleScale: number;
  arenaCats: boolean;
  bladeTrailSubSteps: 1 | 2 | 3;
}

export const GRAPHICS_QUALITY_STORAGE_KEY = "sekiroslop.graphicsQuality.v1";

const PROFILES: Record<GraphicsQualityTier, GraphicsQualityProfile> = {
  low: {
    tier: "low",
    dpr: [0.7, 1.0],
    antialias: false,
    shadowMap: "basic",
    shadowMapSize: 1024,
    shadowFrustum: 22,
    maxAnisotropy: 1,
    pointLights: false,
    particleScale: 0.4,
    arenaCats: false,
    bladeTrailSubSteps: 1,
  },
  medium: {
    tier: "medium",
    dpr: [0.85, 1.25],
    antialias: false,
    shadowMap: "percentage",
    shadowMapSize: 1024,
    shadowFrustum: 26,
    maxAnisotropy: 2,
    pointLights: true,
    particleScale: 0.7,
    arenaCats: true,
    bladeTrailSubSteps: 2,
  },
  high: {
    tier: "high",
    dpr: [1, 1.5],
    antialias: true,
    shadowMap: "percentage",
    shadowMapSize: 2048,
    shadowFrustum: 27,
    maxAnisotropy: 4,
    pointLights: true,
    particleScale: 1,
    arenaCats: true,
    bladeTrailSubSteps: 3,
  },
};

function isGraphicsQualityPreset(value: unknown): value is GraphicsQualityPreset {
  return value === "auto" || value === "low" || value === "medium" || value === "high";
}

export function getGraphicsQualityPreset(): GraphicsQualityPreset {
  if (typeof window === "undefined") return "auto";
  try {
    const saved = window.localStorage.getItem(GRAPHICS_QUALITY_STORAGE_KEY);
    return isGraphicsQualityPreset(saved) ? saved : "auto";
  } catch {
    return "auto";
  }
}

export function saveGraphicsQualityPreset(preset: GraphicsQualityPreset): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(GRAPHICS_QUALITY_STORAGE_KEY, preset);
  } catch {
    // Keep the in-memory setting usable when browser storage is unavailable.
  }
}

export function resolveGraphicsQualityTier(preset: GraphicsQualityPreset): GraphicsQualityTier {
  if (preset !== "auto") return preset;
  const cores = typeof navigator === "undefined" ? undefined : navigator.hardwareConcurrency;
  return isTouchDevice() || (typeof cores === "number" && cores <= 4) ? "low" : "high";
}

export function getGraphicsQualityProfile(preset: GraphicsQualityPreset): GraphicsQualityProfile {
  return PROFILES[resolveGraphicsQualityTier(preset)];
}
