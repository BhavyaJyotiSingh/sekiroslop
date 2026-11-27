/**
 * Lightweight client-side visual hit-stop (2–3 frame animation freeze on heavy hits,
 * perfect deflects, and posture breaks). Applies strictly to AnimationMixer deltas
 * so movement, camera, and 30 Hz Colyseus networking remain frame-rate independent.
 */
let hitStopUntilMs = 0;

export function triggerHitStop(durationMs: number): void {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return;
  const clamped = Math.min(60, Math.max(0, durationMs));
  const target = performance.now() + clamped;
  if (target > hitStopUntilMs) {
    hitStopUntilMs = target;
  }
}

export function getHitStopAnimationDelta(rawDeltaSec: number): number {
  if (rawDeltaSec <= 0) return 0;
  if (performance.now() < hitStopUntilMs) {
    return rawDeltaSec * 0.08;
  }
  return rawDeltaSec;
}

export function resetHitStop(): void {
  hitStopUntilMs = 0;
}
