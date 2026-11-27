import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { GameMode } from "@sekiroslop/shared";
import { resetTouchInputState, touchInput } from "../input/touchInput";
import { soundEngine } from "../audio/SoundEngine";
import {
  TOUCH_CONTROL_LABELS,
  TOUCH_CONTROL_ORDER,
  resetTouchLayoutToDefault,
  updateTouchControlLayout,
  useTouchLayoutConfig,
  type TouchControlId,
} from "../input/touchLayoutConfig";

interface TouchControlsProps {
  nearLever: boolean;
  waveActive: boolean;
  nextWave: number;
  gameMode: GameMode;
  isBlocking: boolean;
  isLocked: boolean;
  gateCooldownMs: number;
  combatArtCdMs: number;
  combatArtShortName: string;
  abilityCdMs: number;
  abilityShortLabel: string;
  onCastCombatArt: () => void;
  hasItem: boolean;
  editingLayout?: boolean;
  onFinishEditLayout?: () => void;
}

const JOYSTICK_RADIUS = 44;

function isTouchIdActive(touches: React.TouchList, id: number | null): boolean {
  if (id === null) return false;
  for (let i = 0; i < touches.length; i++) {
    if (touches[i].identifier === id) return true;
  }
  return false;
}

/**
 * PUBG-inspired customizable mobile touch HUD:
 * - Analog Stick on left (or mirrored right in Left-Handed mode)
 * - Compact 8-button Combat Cluster on right (with 1-tap LOCK toggle)
 * - Center Screen: Drag to orbit camera, tap enemy to Lock / Unlock
 * - Self-healing multitouch IDs & pointer-cancel guards prevent stuck inputs
 */
export function TouchControls({
  nearLever,
  waveActive,
  nextWave,
  gameMode,
  isBlocking,
  isLocked,
  gateCooldownMs,
  combatArtCdMs,
  combatArtShortName,
  abilityCdMs,
  abilityShortLabel,
  onCastCombatArt,
  hasItem,
  editingLayout = false,
  onFinishEditLayout,
}: TouchControlsProps) {
  const layout = useTouchLayoutConfig();
  const [selectedControl, setSelectedControl] = useState<TouchControlId>("attack");
  const dragControlRef = useRef<{
    id: TouchControlId;
    pointerId: number;
    startX: number;
    startY: number;
    origDx: number;
    origDy: number;
    minDeltaX: number;
    maxDeltaX: number;
    minDeltaY: number;
    maxDeltaY: number;
  } | null>(null);
  const [joystickActive, setJoystickActive] = useState(false);
  const joyKnobRef = useRef<HTMLDivElement>(null);
  const joyTouchIdRef = useRef<number | null>(null);
  const joyOriginRef = useRef({ x: 0, y: 0 });
  const camTouchIdRef = useRef<number | null>(null);
  const camLastRef = useRef({ x: 0, y: 0 });
  const camStartRef = useRef({ x: 0, y: 0, time: 0, moved: 0 });
  const joyBaseRef = useRef<HTMLDivElement>(null);
  const blockPointerIdRef = useRef<number | null>(null);
  const jumpPointerIdRef = useRef<number | null>(null);
  const attackPointerIdRef = useRef<number | null>(null);
  const attackHoldTimerRef = useRef<number | null>(null);
  const attackBecameHeavyRef = useRef(false);

  const clearAllTouchHolds = () => {
    joyTouchIdRef.current = null;
    camTouchIdRef.current = null;
    if (joyKnobRef.current) {
      joyKnobRef.current.style.transform = "translate3d(0px, 0px, 0px)";
    }
    setJoystickActive(false);
    resetTouchInputState();
    if (blockPointerIdRef.current !== null) {
      blockPointerIdRef.current = null;
      touchInput.handlers?.setBlock(false);
    }
    jumpPointerIdRef.current = null;
    attackPointerIdRef.current = null;
    if (attackHoldTimerRef.current !== null) {
      window.clearTimeout(attackHoldTimerRef.current);
      attackHoldTimerRef.current = null;
    }
  };

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) clearAllTouchHolds();
    };
    window.addEventListener("blur", clearAllTouchHolds);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", clearAllTouchHolds);
      document.removeEventListener("visibilitychange", onVisibility);
      clearAllTouchHolds();
    };
  }, []);

  const resetJoystick = () => {
    joyTouchIdRef.current = null;
    touchInput.moveX = 0;
    touchInput.moveForward = 0;
    if (joyKnobRef.current) {
      joyKnobRef.current.style.transform = "translate3d(0px, 0px, 0px)";
    }
    setJoystickActive(false);
  };

  const handleJoyStart = (e: React.TouchEvent) => {
    e.stopPropagation();
    soundEngine.unlock();
    if (joyTouchIdRef.current !== null && !isTouchIdActive(e.touches, joyTouchIdRef.current)) {
      resetJoystick();
    }
    if (joyTouchIdRef.current !== null) return;
    const t = e.changedTouches[0];
    if (!t || !joyBaseRef.current) return;
    const rect = joyBaseRef.current.getBoundingClientRect();
    joyTouchIdRef.current = t.identifier;
    joyOriginRef.current = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    setJoystickActive(true);
    updateJoystick(t.clientX, t.clientY);
  };

  const handleJoyMove = (e: React.TouchEvent) => {
    e.stopPropagation();
    if (joyTouchIdRef.current === null) return;
    if (!isTouchIdActive(e.touches, joyTouchIdRef.current)) {
      resetJoystick();
      return;
    }
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier === joyTouchIdRef.current) {
        updateJoystick(t.clientX, t.clientY);
        break;
      }
    }
  };

  const handleJoyEnd = (e: React.TouchEvent) => {
    e.stopPropagation();
    if (joyTouchIdRef.current === null) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === joyTouchIdRef.current) {
        resetJoystick();
        break;
      }
    }
  };

  const updateJoystick = (clientX: number, clientY: number) => {
    const scale = layout.joystick.scale || 1;
    const dx = (clientX - joyOriginRef.current.x) / scale;
    const dy = (clientY - joyOriginRef.current.y) / scale;
    const dist = Math.hypot(dx, dy);
    const clamped = Math.min(JOYSTICK_RADIUS, dist);
    const nx = dist > 6 ? (dx / dist) * (clamped / JOYSTICK_RADIUS) : 0;
    const ny = dist > 6 ? (dy / dist) * (clamped / JOYSTICK_RADIUS) : 0;

    touchInput.moveX = nx;
    touchInput.moveForward = -ny;
    if (joyKnobRef.current) {
      const x = dist > 0.1 ? (dx / dist) * clamped : 0;
      const y = dist > 0.1 ? (dy / dist) * clamped : 0;
      joyKnobRef.current.style.transform = `translate3d(${x}px, ${y}px, 0px)`;
    }
  };

  const handleCamStart = (e: React.TouchEvent) => {
    soundEngine.unlock();
    if (camTouchIdRef.current !== null && !isTouchIdActive(e.touches, camTouchIdRef.current)) {
      camTouchIdRef.current = null;
    }
    if (camTouchIdRef.current !== null) return;
    const t = e.changedTouches[0];
    if (!t) return;
    camTouchIdRef.current = t.identifier;
    camLastRef.current = { x: t.clientX, y: t.clientY };
    camStartRef.current = { x: t.clientX, y: t.clientY, time: performance.now(), moved: 0 };
  };

  const handleCamMove = (e: React.TouchEvent) => {
    if (camTouchIdRef.current === null) return;
    if (!isTouchIdActive(e.touches, camTouchIdRef.current)) {
      camTouchIdRef.current = null;
      return;
    }
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier === camTouchIdRef.current) {
        const dx = t.clientX - camLastRef.current.x;
        const dy = t.clientY - camLastRef.current.y;
        camLastRef.current = { x: t.clientX, y: t.clientY };
        camStartRef.current.moved += Math.hypot(dx, dy);
        touchInput.lookDeltaX += dx;
        touchInput.lookDeltaY += dy;
        break;
      }
    }
  };

  const handleCamEnd = (e: React.TouchEvent) => {
    if (camTouchIdRef.current === null) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier === camTouchIdRef.current) {
        camTouchIdRef.current = null;
        if (e.type === "touchend") {
          const elapsed = performance.now() - camStartRef.current.time;
          if (camStartRef.current.moved < 14 && elapsed < 320) {
            touchInput.handlers?.tapScreenToLock(t.clientX, t.clientY);
          }
        }
        break;
      }
    }
  };

  const fire = (fn: () => void) => (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.stopPropagation();
    soundEngine.unlock();
    fn();
  };

  const handleBlockStart = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.stopPropagation();
    soundEngine.unlock();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore pointer capture errors
    }
    blockPointerIdRef.current = e.pointerId;
    touchInput.handlers?.setBlock(true);
  };

  const handleBlockEnd = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (blockPointerIdRef.current !== null && blockPointerIdRef.current !== e.pointerId) return;
    blockPointerIdRef.current = null;
    touchInput.handlers?.setBlock(false);
  };

  const handleJumpStart = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.stopPropagation();
    soundEngine.unlock();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore pointer capture errors
    }
    jumpPointerIdRef.current = e.pointerId;
    touchInput.jumpHeld = true;
    touchInput.handlers?.jump();
  };

  const handleJumpEnd = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (jumpPointerIdRef.current !== null && jumpPointerIdRef.current !== e.pointerId) return;
    jumpPointerIdRef.current = null;
    touchInput.jumpHeld = false;
  };

  const handleAttackStart = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.stopPropagation();
    soundEngine.unlock();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore capture errors
    }
    attackPointerIdRef.current = e.pointerId;
    attackBecameHeavyRef.current = false;
    if (attackHoldTimerRef.current !== null) {
      window.clearTimeout(attackHoldTimerRef.current);
    }
    attackHoldTimerRef.current = window.setTimeout(() => {
      attackHoldTimerRef.current = null;
      attackBecameHeavyRef.current = true;
      touchInput.handlers?.bigAttack();
    }, 320);
  };

  const handleAttackEnd = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (attackPointerIdRef.current !== e.pointerId) return;
    attackPointerIdRef.current = null;
    if (attackHoldTimerRef.current !== null) {
      window.clearTimeout(attackHoldTimerRef.current);
      attackHoldTimerRef.current = null;
    }
    if (!attackBecameHeavyRef.current) touchInput.handlers?.smallAttack();
  };

  const handleAttackCancel = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (attackPointerIdRef.current !== e.pointerId) return;
    attackPointerIdRef.current = null;
    if (attackHoldTimerRef.current !== null) {
      window.clearTimeout(attackHoldTimerRef.current);
      attackHoldTimerRef.current = null;
    }
  };

  const showGatePrompt =
    (gameMode === "waves" || gameMode === "boss_rush") &&
    nearLever &&
    !waveActive &&
    !editingLayout;
  const gateResetting = gateCooldownMs > 0;

  const controlStyle = (id: TouchControlId): CSSProperties => {
    const t = layout[id];
    return {
      transform: `translate(${t.dx}px, ${t.dy}px) scale(${t.scale})`,
      opacity: editingLayout ? 1 : t.opacity,
    };
  };

  const startDragControl = (id: TouchControlId) => (e: React.PointerEvent<HTMLElement>) => {
    if (!editingLayout) return;
    e.stopPropagation();
    e.preventDefault();
    setSelectedControl(id);
    const bounds = e.currentTarget.getBoundingClientRect();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore pointer capture errors
    }
    dragControlRef.current = {
      id,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      origDx: layout[id].dx,
      origDy: layout[id].dy,
      minDeltaX: -bounds.left,
      maxDeltaX: window.innerWidth - bounds.right,
      minDeltaY: -bounds.top,
      maxDeltaY: window.innerHeight - bounds.bottom,
    };
  };

  const moveDragControl = (e: React.PointerEvent<HTMLElement>) => {
    const d = dragControlRef.current;
    if (!editingLayout || !d || d.pointerId !== e.pointerId) return;
    e.stopPropagation();
    e.preventDefault();
    const deltaX = Math.max(d.minDeltaX, Math.min(d.maxDeltaX, e.clientX - d.startX));
    const deltaY = Math.max(d.minDeltaY, Math.min(d.maxDeltaY, e.clientY - d.startY));
    updateTouchControlLayout(d.id, {
      dx: d.origDx + deltaX,
      dy: d.origDy + deltaY,
    });
  };

  const endDragControl = (e: React.PointerEvent<HTMLElement>) => {
    const d = dragControlRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    e.stopPropagation();
    dragControlRef.current = null;
  };

  const editClass = (id: TouchControlId) =>
    editingLayout ? `psp-edit-target ${selectedControl === id ? "is-selected" : ""}` : "";

  return (
    <div
      className={`touch-layer ${editingLayout ? "is-editing-layout" : ""}`}
    >
      {editingLayout && (
        <div
          className="touch-layout-editor-bar"
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <span className="touch-editor-title">
            Drag · <b>{TOUCH_CONTROL_LABELS[selectedControl]}</b>
          </span>
          <div className="touch-editor-groups">
            {TOUCH_CONTROL_ORDER.map((id) => (
              <button
                key={id}
                type="button"
                className={`btn-ghost btn-compact ${selectedControl === id ? "active" : ""}`}
                onClick={() => setSelectedControl(id)}
              >
                {TOUCH_CONTROL_LABELS[id]}
              </button>
            ))}
          </div>
          <label className="touch-editor-scale">
            <span>Size {Math.round(layout[selectedControl].scale * 100)}%</span>
            <input
              type="range"
              min={0.65}
              max={1.65}
              step={0.05}
              value={layout[selectedControl].scale}
              onChange={(e) =>
                updateTouchControlLayout(selectedControl, { scale: Number(e.target.value) })
              }
            />
          </label>
          <label className="touch-editor-scale">
            <span>Alpha {Math.round(layout[selectedControl].opacity * 100)}%</span>
            <input
              type="range"
              min={0.35}
              max={1.0}
              step={0.05}
              value={layout[selectedControl].opacity}
              onChange={(e) =>
                updateTouchControlLayout(selectedControl, { opacity: Number(e.target.value) })
              }
            />
          </label>
          <div className="touch-editor-actions">
            <button type="button" className="btn-ghost btn-compact" onClick={resetTouchLayoutToDefault}>
              Reset
            </button>
            <button type="button" className="btn-primary-minimal btn-compact" onClick={onFinishEditLayout}>
              Save
            </button>
          </div>
        </div>
      )}

      {/* Background multi-touch camera drag + tap-on-enemy lock zone */}
      <div
        className="touch-cam-zone"
        onTouchStart={editingLayout ? undefined : handleCamStart}
        onTouchMove={editingLayout ? undefined : handleCamMove}
        onTouchEnd={editingLayout ? undefined : handleCamEnd}
        onTouchCancel={editingLayout ? undefined : handleCamEnd}
      />

      <button
        type="button"
        className={`touch-item-btn ${!hasItem ? "cooling" : ""} ${editClass("item")}`}
        style={controlStyle("item")}
        disabled={!editingLayout && !hasItem}
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={editingLayout ? startDragControl("item") : fire(() => touchInput.handlers?.useQuickItem())}
        onPointerMove={editingLayout ? moveDragControl : undefined}
        onPointerUp={editingLayout ? endDragControl : undefined}
        onPointerCancel={editingLayout ? endDragControl : undefined}
        onLostPointerCapture={editingLayout ? endDragControl : undefined}
      >
        <b>＋</b><small>ITEM</small>
      </button>

      {/* === LOWER-LEFT ANALOG STICK === */}
      <div
        ref={joyBaseRef}
        className={`touch-joystick-base ${joystickActive ? "active" : ""} ${editClass("joystick")}`}
        style={controlStyle("joystick")}
        onPointerDown={editingLayout ? startDragControl("joystick") : undefined}
        onPointerMove={editingLayout ? moveDragControl : undefined}
        onPointerUp={editingLayout ? endDragControl : undefined}
        onPointerCancel={editingLayout ? endDragControl : undefined}
        onLostPointerCapture={editingLayout ? endDragControl : undefined}
        onTouchStart={editingLayout ? undefined : handleJoyStart}
        onTouchMove={editingLayout ? undefined : handleJoyMove}
        onTouchEnd={editingLayout ? undefined : handleJoyEnd}
        onTouchCancel={editingLayout ? undefined : handleJoyEnd}
      >
        <div
          ref={joyKnobRef}
          className="touch-joystick-knob"
          style={{ transform: "translate3d(0px, 0px, 0px)" }}
        />
      </div>

      {/* Contextual Gate Lever Prompt (top-center, clear of vitals & combat buttons) */}
      {showGatePrompt && (
        gateResetting ? (
          <div className="touch-gate-btn is-resetting" role="status">
            GATE RESETTING · {Math.ceil(gateCooldownMs / 1000)}s
          </div>
        ) : (
          <button
            type="button"
            className="touch-gate-btn"
            style={{ touchAction: "none" }}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={fire(() => touchInput.handlers?.interactGate())}
          >
            <span className="touch-gate-glyph" aria-hidden="true">⛨</span>
            <span>
              PULL GATE · {gameMode === "boss_rush" ? `Trial ${nextWave}` : `Wave ${nextWave}`}
            </span>
          </button>
        )
      )}

      {/* === INDIVIDUAL RIGHT-SIDE BUTTONS (Upper Square + Lower Diamond) === */}
      <button
        type="button"
        className={`psp-face psp-lock ${isLocked ? "active" : ""} ${editClass("lock")}`}
        style={controlStyle("lock")}
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={editingLayout ? startDragControl("lock") : fire(() => touchInput.handlers?.toggleLock())}
        onPointerMove={editingLayout ? moveDragControl : undefined}
        onPointerUp={editingLayout ? endDragControl : undefined}
        onPointerCancel={editingLayout ? endDragControl : undefined}
        onLostPointerCapture={editingLayout ? endDragControl : undefined}
      >
        <b>◎</b><small>{isLocked ? "LOCKED" : "LOCK"}</small>
      </button>
      <button
        type="button"
        className={`psp-face psp-combat-art ${combatArtCdMs > 0 ? "cooling" : ""} ${editClass("combatArt")}`}
        style={controlStyle("combatArt")}
        disabled={!editingLayout && combatArtCdMs > 0}
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={editingLayout ? startDragControl("combatArt") : fire(onCastCombatArt)}
        onPointerMove={editingLayout ? moveDragControl : undefined}
        onPointerUp={editingLayout ? endDragControl : undefined}
        onPointerCancel={editingLayout ? endDragControl : undefined}
        onLostPointerCapture={editingLayout ? endDragControl : undefined}
      >
        <b>✧</b><small>{combatArtCdMs > 0 ? `${Math.ceil(combatArtCdMs / 1000)}s` : combatArtShortName}</small>
      </button>
      <button
        type="button"
        className={`psp-face psp-throwable ${abilityCdMs > 0 ? "cooling" : ""} ${editClass("throwable")}`}
        style={controlStyle("throwable")}
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={editingLayout ? startDragControl("throwable") : fire(() => touchInput.handlers?.castAbility())}
        onPointerMove={editingLayout ? moveDragControl : undefined}
        onPointerUp={editingLayout ? endDragControl : undefined}
        onPointerCancel={editingLayout ? endDragControl : undefined}
        onLostPointerCapture={editingLayout ? endDragControl : undefined}
      >
        <b>➤</b><small>{abilityCdMs > 0 ? `${Math.ceil(abilityCdMs / 1000)}s` : abilityShortLabel || "FIRE"}</small>
      </button>
      <button
        type="button"
        className={`psp-face psp-punch ${editClass("punch")}`}
        style={controlStyle("punch")}
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={editingLayout ? startDragControl("punch") : fire(() => touchInput.handlers?.punch())}
        onPointerMove={editingLayout ? moveDragControl : undefined}
        onPointerUp={editingLayout ? endDragControl : undefined}
        onPointerCancel={editingLayout ? endDragControl : undefined}
        onLostPointerCapture={editingLayout ? endDragControl : undefined}
      >
        <b>✊</b><small>PUNCH</small>
      </button>

      <button
        type="button"
        className={`psp-face psp-deflect ${isBlocking ? "active" : ""} ${editClass("deflect")}`}
        style={controlStyle("deflect")}
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={editingLayout ? startDragControl("deflect") : handleBlockStart}
        onPointerMove={editingLayout ? moveDragControl : undefined}
        onPointerUp={editingLayout ? endDragControl : handleBlockEnd}
        onPointerCancel={editingLayout ? endDragControl : handleBlockEnd}
        onLostPointerCapture={editingLayout ? endDragControl : handleBlockEnd}
      >
        <b>◉</b><small>DEFLECT</small>
      </button>
      <button
        type="button"
        className={`psp-face psp-attack ${editClass("attack")}`}
        style={controlStyle("attack")}
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={editingLayout ? startDragControl("attack") : handleAttackStart}
        onPointerMove={editingLayout ? moveDragControl : undefined}
        onPointerUp={editingLayout ? endDragControl : handleAttackEnd}
        onPointerCancel={editingLayout ? endDragControl : handleAttackCancel}
        onLostPointerCapture={editingLayout ? endDragControl : handleAttackCancel}
      >
        <b>⚔</b><small>ATK / HOLD</small>
      </button>
      <button
        type="button"
        className={`psp-face psp-dodge ${editClass("dodge")}`}
        style={controlStyle("dodge")}
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={editingLayout ? startDragControl("dodge") : fire(() => touchInput.handlers?.dodge())}
        onPointerMove={editingLayout ? moveDragControl : undefined}
        onPointerUp={editingLayout ? endDragControl : undefined}
        onPointerCancel={editingLayout ? endDragControl : undefined}
        onLostPointerCapture={editingLayout ? endDragControl : undefined}
      >
        <b>◉</b><small>DODGE</small>
      </button>
      <button
        type="button"
        className={`psp-face psp-jump ${editClass("jump")}`}
        style={controlStyle("jump")}
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={editingLayout ? startDragControl("jump") : handleJumpStart}
        onPointerMove={editingLayout ? moveDragControl : undefined}
        onPointerUp={editingLayout ? endDragControl : handleJumpEnd}
        onPointerCancel={editingLayout ? endDragControl : handleJumpEnd}
        onLostPointerCapture={editingLayout ? endDragControl : handleJumpEnd}
      >
        <b>↑</b><small>FLY/JMP</small>
      </button>
    </div>
  );
}
