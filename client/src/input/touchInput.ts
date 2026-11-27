export interface TouchActionHandlers {
  smallAttack: () => void;
  bigAttack: () => void;
  punch: () => void;
  castAbility: () => void;
  cycleAbility: () => void;
  useItemSlot: (slotIndex: number) => void;
  useQuickItem: () => void;
  setBlock: (active: boolean) => void;
  jump: () => void;
  dodge: () => void;
  toggleLock: () => void;
  tapScreenToLock: (clientX: number, clientY: number) => void;
  interactGate: () => void;
}

/**
 * Zero-re-render mutable bridge between mobile touch UI and the 60+ FPS R3F LocalPlayerController.
 */
export const touchInput = {
  moveX: 0,
  moveForward: 0,
  lookDeltaX: 0,
  lookDeltaY: 0,
  jumpHeld: false,
  handlers: null as TouchActionHandlers | null,
};

export function resetTouchInputState(): void {
  touchInput.moveX = 0;
  touchInput.moveForward = 0;
  touchInput.lookDeltaX = 0;
  touchInput.lookDeltaY = 0;
  touchInput.jumpHeld = false;
}

/**
 * Reliably detects phones/tablets (including stylus Android phones & mobile browser views)
 * while staying false on desktop/laptop mouse setups.
 */
export function isTouchDevice(): boolean {
  if (typeof window === "undefined") return false;
  const hasTouch = (navigator.maxTouchPoints ?? 0) > 0 || "ontouchstart" in window;
  const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const fine = window.matchMedia?.("(any-pointer: fine)").matches ?? false;
  const smallScreen = Math.min(window.innerWidth, window.innerHeight) <= 960;
  const mobileUa = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent ?? "");
  return (coarse && !fine) || (hasTouch && (smallScreen || mobileUa));
}
