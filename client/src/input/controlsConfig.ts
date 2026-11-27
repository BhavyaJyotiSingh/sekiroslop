import { useEffect, useState } from "react";

export interface KeyBindings {
  moveForward: string;
  moveBack: string;
  moveLeft: string;
  moveRight: string;
  jump: string;
  dodge: string;
  lightAttack: string;
  block: string;
  punch: string;
  combatArt: string;
  castAbility: string;
  cycleAbility: string;
  item1: string;
  item2: string;
  item3: string;
  interact: string;
  lockTarget: string;
}

export type KeyActionId = keyof KeyBindings;

export interface ControlsConfig {
  mouseSensitivity: number;
  autoLockOnAttack: boolean;
  bindings: KeyBindings;
}

export const DEFAULT_KEY_BINDINGS: KeyBindings = {
  moveForward: "KeyW",
  moveBack: "KeyS",
  moveLeft: "KeyA",
  moveRight: "KeyD",
  jump: "Space",
  dodge: "ShiftLeft",
  lightAttack: "KeyJ",
  block: "KeyL",
  punch: "KeyQ",
  combatArt: "KeyV",
  castAbility: "KeyR",
  cycleAbility: "KeyC",
  item1: "Digit4",
  item2: "Digit5",
  item3: "Digit6",
  interact: "KeyF",
  lockTarget: "Tab",
};

export const KEY_ACTION_LABELS: ReadonlyArray<{
  id: KeyActionId;
  label: string;
  group: "combat" | "movement";
  mouseHint?: string;
}> = [
  { id: "lightAttack", label: "Light / Hold Heavy Attack", group: "combat", mouseHint: "LMB / Hold LMB" },
  { id: "block", label: "Deflect / Block", group: "combat", mouseHint: "RMB" },
  { id: "punch", label: "Punch / Launch", group: "combat" },
  { id: "combatArt", label: "Cast Combat Art", group: "combat" },
  { id: "castAbility", label: "Cast Spell / Stun Gun", group: "combat" },
  { id: "cycleAbility", label: "Cycle Spell / Stun Gun", group: "combat" },
  { id: "item1", label: "Belt Slot 1", group: "combat" },
  { id: "item2", label: "Belt Slot 2", group: "combat" },
  { id: "item3", label: "Belt Slot 3", group: "combat" },
  { id: "moveForward", label: "Move Forward", group: "movement" },
  { id: "moveBack", label: "Move Backward", group: "movement" },
  { id: "moveLeft", label: "Move Left", group: "movement" },
  { id: "moveRight", label: "Move Right", group: "movement" },
  { id: "jump", label: "Jump / Hold Fly", group: "movement" },
  { id: "dodge", label: "Dodge Step", group: "movement" },
  { id: "lockTarget", label: "Lock Target", group: "movement", mouseHint: "MMB" },
  { id: "interact", label: "Pull Gate Lever", group: "movement" },
];

const STORAGE_KEY = "sekiroslop_controls_v2";

function loadInitialConfig(): ControlsConfig {
  if (typeof window === "undefined") {
    return { mouseSensitivity: 1.0, autoLockOnAttack: false, bindings: { ...DEFAULT_KEY_BINDINGS } };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { mouseSensitivity: 1.0, autoLockOnAttack: false, bindings: { ...DEFAULT_KEY_BINDINGS } };
    const parsed = JSON.parse(raw) as Partial<ControlsConfig>;
    const sens =
      typeof parsed.mouseSensitivity === "number" && Number.isFinite(parsed.mouseSensitivity)
        ? Math.min(2.5, Math.max(0.25, parsed.mouseSensitivity))
        : 1.0;
    const autoLockOnAttack = typeof parsed.autoLockOnAttack === "boolean" ? parsed.autoLockOnAttack : false;
    const bindings: KeyBindings = { ...DEFAULT_KEY_BINDINGS };
    if (parsed.bindings && typeof parsed.bindings === "object") {
      for (const k of Object.keys(DEFAULT_KEY_BINDINGS) as KeyActionId[]) {
        const val = parsed.bindings[k];
        if (typeof val === "string" && val.length > 0) {
          bindings[k] = val;
        }
      }
    }
    return { mouseSensitivity: sens, autoLockOnAttack, bindings };
  } catch {
    return { mouseSensitivity: 1.0, autoLockOnAttack: false, bindings: { ...DEFAULT_KEY_BINDINGS } };
  }
}

export const controlsConfigRef: { current: ControlsConfig } = {
  current: loadInitialConfig(),
};

const listeners = new Set<(cfg: ControlsConfig) => void>();

function persistAndNotify(next: ControlsConfig): void {
  controlsConfigRef.current = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage quota errors
  }
  listeners.forEach((fn) => fn(next));
}

export function setMouseSensitivity(value: number): void {
  const clamped = Math.round(Math.min(2.5, Math.max(0.25, value)) * 100) / 100;
  persistAndNotify({
    ...controlsConfigRef.current,
    mouseSensitivity: clamped,
  });
}

export function setKeyBinding(action: KeyActionId, code: string): void {
  if (!code || code === "Escape" || code === "KeyM" || code === "KeyP") return;
  const current = controlsConfigRef.current.bindings;
  const nextBindings: KeyBindings = { ...current };

  // Swap if another action already uses this key code so bindings never collide
  for (const k of Object.keys(nextBindings) as KeyActionId[]) {
    if (k !== action && nextBindings[k] === code) {
      nextBindings[k] = current[action];
    }
  }
  nextBindings[action] = code;

  persistAndNotify({
    ...controlsConfigRef.current,
    bindings: nextBindings,
  });
}

export function setAutoLockOnAttack(enabled: boolean): void {
  persistAndNotify({
    ...controlsConfigRef.current,
    autoLockOnAttack: Boolean(enabled),
  });
}

export function resetControlsToDefault(): void {
  persistAndNotify({
    mouseSensitivity: 1.0,
    autoLockOnAttack: false,
    bindings: { ...DEFAULT_KEY_BINDINGS },
  });
}

export function useControlsConfig(): ControlsConfig {
  const [cfg, setCfg] = useState<ControlsConfig>(() => controlsConfigRef.current);
  useEffect(() => {
    const listener = (next: ControlsConfig) => setCfg(next);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return cfg;
}

export function formatKeyCode(code: string): string {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return `Num${code.slice(6)}`;
  switch (code) {
    case "ShiftLeft":
      return "L-Shift";
    case "ShiftRight":
      return "R-Shift";
    case "ControlLeft":
      return "L-Ctrl";
    case "ControlRight":
      return "R-Ctrl";
    case "AltLeft":
      return "L-Alt";
    case "AltRight":
      return "R-Alt";
    case "Space":
      return "Space";
    case "Tab":
      return "Tab";
    case "CapsLock":
      return "Caps";
    case "ArrowUp":
      return "↑";
    case "ArrowDown":
      return "↓";
    case "ArrowLeft":
      return "←";
    case "ArrowRight":
      return "→";
    case "Minus":
      return "-";
    case "Equal":
      return "=";
    case "BracketLeft":
      return "[";
    case "BracketRight":
      return "]";
    case "Semicolon":
      return ";";
    case "Quote":
      return "'";
    case "Comma":
      return ",";
    case "Period":
      return ".";
    case "Slash":
      return "/";
    case "Backquote":
      return "`";
    default:
      return code;
  }
}
