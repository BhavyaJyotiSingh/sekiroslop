import { useEffect, useState } from "react";

export type TouchControlId =
  | "joystick"
  | "item"
  | "lock"
  | "combatArt"
  | "throwable"
  | "punch"
  | "deflect"
  | "attack"
  | "dodge"
  | "jump";

export interface TouchControlTransform {
  dx: number;
  dy: number;
  scale: number;
  opacity: number;
}

export type TouchLayoutConfig = Record<TouchControlId, TouchControlTransform>;

export interface TouchLayoutState {
  controls: TouchLayoutConfig;
}

export const TOUCH_CONTROL_ORDER: readonly TouchControlId[] = [
  "joystick",
  "item",
  "attack",
  "deflect",
  "dodge",
  "jump",
  "lock",
  "combatArt",
  "throwable",
  "punch",
];

export const TOUCH_CONTROL_LABELS: Record<TouchControlId, string> = {
  joystick: "Stick",
  item: "Item",
  attack: "Attack",
  deflect: "Deflect",
  dodge: "Dodge",
  jump: "Jump/Fly",
  lock: "Lock",
  combatArt: "Combat Art",
  throwable: "Fire/Throw",
  punch: "Punch",
};

const DEFAULT_ENTRY: TouchControlTransform = { dx: 0, dy: 0, scale: 1, opacity: 0.92 };

export const DEFAULT_TOUCH_LAYOUT: TouchLayoutConfig = {
  joystick: { ...DEFAULT_ENTRY },
  item: { ...DEFAULT_ENTRY },
  lock: { ...DEFAULT_ENTRY },
  combatArt: { ...DEFAULT_ENTRY },
  throwable: { ...DEFAULT_ENTRY },
  punch: { ...DEFAULT_ENTRY },
  deflect: { ...DEFAULT_ENTRY },
  attack: { ...DEFAULT_ENTRY },
  dodge: { ...DEFAULT_ENTRY },
  jump: { ...DEFAULT_ENTRY },
};

const STORAGE_KEY = "sekiroslop_touch_layout_v3";

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function maxLayoutOffsetX(): number {
  return typeof window === "undefined" ? 480 : Math.max(480, Math.ceil(window.innerWidth));
}

function maxLayoutOffsetY(): number {
  return typeof window === "undefined" ? 360 : Math.max(360, Math.ceil(window.innerHeight));
}

function cloneDefaultControls(): TouchLayoutConfig {
  return {
    joystick: { ...DEFAULT_TOUCH_LAYOUT.joystick },
    item: { ...DEFAULT_TOUCH_LAYOUT.item },
    lock: { ...DEFAULT_TOUCH_LAYOUT.lock },
    combatArt: { ...DEFAULT_TOUCH_LAYOUT.combatArt },
    throwable: { ...DEFAULT_TOUCH_LAYOUT.throwable },
    punch: { ...DEFAULT_TOUCH_LAYOUT.punch },
    deflect: { ...DEFAULT_TOUCH_LAYOUT.deflect },
    attack: { ...DEFAULT_TOUCH_LAYOUT.attack },
    dodge: { ...DEFAULT_TOUCH_LAYOUT.dodge },
    jump: { ...DEFAULT_TOUCH_LAYOUT.jump },
  };
}

function cloneDefaultState(): TouchLayoutState {
  return {
    controls: cloneDefaultControls(),
  };
}

function parseControlEntry(
  base: TouchControlTransform,
  entry: unknown
): TouchControlTransform {
  if (!entry || typeof entry !== "object") return base;
  const obj = entry as Partial<TouchControlTransform>;
  return {
    dx:
      typeof obj.dx === "number" && Number.isFinite(obj.dx)
        ? clamp(Math.round(obj.dx), -maxLayoutOffsetX(), maxLayoutOffsetX())
        : base.dx,
    dy:
      typeof obj.dy === "number" && Number.isFinite(obj.dy)
        ? clamp(Math.round(obj.dy), -maxLayoutOffsetY(), maxLayoutOffsetY())
        : base.dy,
    scale:
      typeof obj.scale === "number" && Number.isFinite(obj.scale)
        ? Math.round(clamp(obj.scale, 0.65, 1.65) * 100) / 100
        : base.scale,
    opacity:
      typeof obj.opacity === "number" && Number.isFinite(obj.opacity)
        ? Math.round(clamp(obj.opacity, 0.35, 1.0) * 100) / 100
        : base.opacity,
  };
}

function loadInitialLayoutState(): TouchLayoutState {
  const base = cloneDefaultState();
  if (typeof window === "undefined") return base;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return base;

    const rawControls =
      parsed.controls && typeof parsed.controls === "object"
        ? (parsed.controls as Record<string, unknown>)
        : parsed;

    for (const id of TOUCH_CONTROL_ORDER) {
      base.controls[id] = parseControlEntry(base.controls[id], rawControls[id]);
    }
    return base;
  } catch {
    return base;
  }
}

let currentState: TouchLayoutState = loadInitialLayoutState();
const listeners = new Set<(cfg: TouchLayoutState) => void>();

function saveAndEmit(next: TouchLayoutState): void {
  currentState = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage quota errors
  }
  listeners.forEach((fn) => fn(next));
}

export function updateTouchControlLayout(
  id: TouchControlId,
  patch: Partial<TouchControlTransform>
): void {
  const prev = currentState.controls[id];
  const next: TouchLayoutState = {
    controls: {
      ...currentState.controls,
      [id]: {
        dx:
          typeof patch.dx === "number" && Number.isFinite(patch.dx)
            ? clamp(Math.round(patch.dx), -maxLayoutOffsetX(), maxLayoutOffsetX())
            : prev.dx,
        dy:
          typeof patch.dy === "number" && Number.isFinite(patch.dy)
            ? clamp(Math.round(patch.dy), -maxLayoutOffsetY(), maxLayoutOffsetY())
            : prev.dy,
        scale:
          typeof patch.scale === "number" && Number.isFinite(patch.scale)
            ? Math.round(clamp(patch.scale, 0.65, 1.65) * 100) / 100
            : prev.scale,
        opacity:
          typeof patch.opacity === "number" && Number.isFinite(patch.opacity)
            ? Math.round(clamp(patch.opacity, 0.35, 1.0) * 100) / 100
            : prev.opacity,
      },
    },
  };
  saveAndEmit(next);
}

export function resetTouchLayoutToDefault(): void {
  saveAndEmit(cloneDefaultState());
}

export function useTouchLayoutState(): TouchLayoutState {
  const [state, setState] = useState<TouchLayoutState>(currentState);
  useEffect(() => {
    listeners.add(setState);
    return () => {
      listeners.delete(setState);
    };
  }, []);
  return state;
}

export function useTouchLayoutConfig(): TouchLayoutConfig {
  return useTouchLayoutState().controls;
}
