import { memo, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { EXPERIMENTAL_SWORD_VFX_AND_HITBOX, SWORD_VFX_CONSTANTS } from "./config";
import type { SweptDebugState } from "./sweptHitbox";

export interface SweptHitboxDebugOverlayProps {
  /** Shared mutable debug ring buffer populated by WeaponBladeTrail / SweptSwingTracker. */
  debugStateRef: React.MutableRefObject<SweptDebugState>;
  /** Start visible immediately (default: false; toggle anytime with `[H]`). */
  initialVisible?: boolean;
  /** Disable keyboard `[H]` toggle if desired. */
  enableHotkey?: boolean;
}

const MAX_DEBUG_CAPSULES = 16;
const MAX_DEBUG_CONTACTS = 16;
const SUBSTEPS = SWORD_VFX_CONSTANTS.SWEEP_SUBSTEPS;
// Each quad renders: 4 substep blade segments + 2 swept edge lines (base->base, tip->tip) = 6 line segments = 12 vertices
const VERTS_PER_QUAD = (SUBSTEPS + 2) * 2;
const MAX_QUADS = 32;
const MAX_LINE_VERTS = MAX_QUADS * VERTS_PER_QUAD;
const QUAD_LINGER_MS = 450;
const CONTACT_LINGER_MS = 650;

/**
 * Optional wireframe debug visualizer (`[H]` key toggle) showing:
 * - Real swept blade sub-step quads (bright cyan during active frames, dim slate otherwise)
 * - Target upright collision capsules (`h = 1.8m, r = 0.52m`)
 * - Exact world-space hit contact markers where the sword mesh intersected a capsule
 */
export const SweptHitboxDebugOverlay = memo(function SweptHitboxDebugOverlay({
  debugStateRef,
  initialVisible = false,
  enableHotkey = true,
}: SweptHitboxDebugOverlayProps) {
  const [visible, setVisible] = useState(initialVisible);

  useEffect(() => {
    debugStateRef.current.visible = visible;
    return () => {
      debugStateRef.current.visible = false;
    };
  }, [debugStateRef, visible]);

  useEffect(() => {
    if (!EXPERIMENTAL_SWORD_VFX_AND_HITBOX || !enableHotkey) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (e.code === "KeyH") {
        setVisible((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enableHotkey]);

  const capsuleRefs = useRef<(THREE.Mesh | null)[]>([]);
  const contactRefs = useRef<(THREE.Mesh | null)[]>([]);

  const { lineGeo, lineMat, capsuleGeo, contactGeo } = useMemo(() => {
    const positions = new Float32Array(MAX_LINE_VERTS * 3);
    const colors = new Float32Array(MAX_LINE_VERTS * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.setDrawRange(0, 0);

    const mat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    // Capsule wireframe with exact default dimensions (r=0.52, cylinder length = 1.8 - 2*0.52 = 0.76)
    const r = SWORD_VFX_CONSTANTS.TARGET_CAPSULE_RADIUS;
    const cylLen = Math.max(0.05, SWORD_VFX_CONSTANTS.TARGET_CAPSULE_HEIGHT - r * 2);
    const capGeo = new THREE.CapsuleGeometry(r, cylLen, 4, 12);
    const hitGeo = new THREE.OctahedronGeometry(0.14, 0);

    return { lineGeo: geo, lineMat: mat, capsuleGeo: capGeo, contactGeo: hitGeo };
  }, []);

  useEffect(() => {
    return () => {
      lineGeo.dispose();
      lineMat.dispose();
      capsuleGeo.dispose();
      contactGeo.dispose();
    };
  }, [lineGeo, lineMat, capsuleGeo, contactGeo]);

  useFrame(() => {
    if (!visible || !EXPERIMENTAL_SWORD_VFX_AND_HITBOX) return;
    const dbg = debugStateRef.current;
    const now = performance.now();

    // 1. Update swept blade sub-step wireframe lines in-place
    const posAttr = lineGeo.getAttribute("position") as THREE.BufferAttribute;
    const colAttr = lineGeo.getAttribute("color") as THREE.BufferAttribute;
    const posArr = posAttr.array as Float32Array;
    const colArr = colAttr.array as Float32Array;

    let vertIdx = 0;
    const writeSeg = (
      ax: number,
      ay: number,
      az: number,
      bx: number,
      by: number,
      bz: number,
      r: number,
      g: number,
      b: number
    ) => {
      if (vertIdx + 2 > MAX_LINE_VERTS) return;
      const p0 = vertIdx * 3;
      posArr[p0] = ax;
      posArr[p0 + 1] = ay;
      posArr[p0 + 2] = az;
      colArr[p0] = r;
      colArr[p0 + 1] = g;
      colArr[p0 + 2] = b;

      const p1 = (vertIdx + 1) * 3;
      posArr[p1] = bx;
      posArr[p1 + 1] = by;
      posArr[p1 + 2] = bz;
      colArr[p1] = r;
      colArr[p1 + 1] = g;
      colArr[p1 + 2] = b;
      vertIdx += 2;
    };

    for (let i = 0; i < dbg.quadCount; i++) {
      const q = dbg.quads[i];
      const age = now - q.timestamp;
      if (age < 0 || age > QUAD_LINGER_MS) continue;
      const fade = 1 - age / QUAD_LINGER_MS;

      const r = q.active ? 0.1 * fade : 0.35 * fade;
      const g = q.active ? 0.95 * fade : 0.45 * fade;
      const b = q.active ? 1.0 * fade : 0.55 * fade;

      // Swept top & bottom rail edges
      writeSeg(q.prevBaseX, q.prevBaseY, q.prevBaseZ, q.currBaseX, q.currBaseY, q.currBaseZ, r, g, b);
      writeSeg(q.prevTipX, q.prevTipY, q.prevTipZ, q.currTipX, q.currTipY, q.currTipZ, r * 1.4, g, b);

      // 4 interpolated sub-step blade segments
      for (let s = 1; s <= SUBSTEPS; s++) {
        const t = s / SUBSTEPS;
        const bx = q.prevBaseX + (q.currBaseX - q.prevBaseX) * t;
        const by = q.prevBaseY + (q.currBaseY - q.prevBaseY) * t;
        const bz = q.prevBaseZ + (q.currBaseZ - q.prevBaseZ) * t;
        const tx = q.prevTipX + (q.currTipX - q.prevTipX) * t;
        const ty = q.prevTipY + (q.currTipY - q.prevTipY) * t;
        const tz = q.prevTipZ + (q.currTipZ - q.prevTipZ) * t;
        writeSeg(bx, by, bz, tx, ty, tz, r, g, b);
      }
    }

    lineGeo.setDrawRange(0, vertIdx);
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;

    // 2. Update target upright capsules
    const targets = dbg.targets;
    for (let i = 0; i < MAX_DEBUG_CAPSULES; i++) {
      const mesh = capsuleRefs.current[i];
      if (!mesh) continue;
      const t = targets[i];
      if (!t || t.alive === false) {
        mesh.visible = false;
        continue;
      }
      const h = t.height ?? SWORD_VFX_CONSTANTS.TARGET_CAPSULE_HEIGHT;
      const r = t.radius ?? SWORD_VFX_CONSTANTS.TARGET_CAPSULE_RADIUS;
      mesh.visible = true;
      mesh.position.set(t.x, t.y + h * 0.5, t.z);
      mesh.scale.set(
        r / SWORD_VFX_CONSTANTS.TARGET_CAPSULE_RADIUS,
        h / SWORD_VFX_CONSTANTS.TARGET_CAPSULE_HEIGHT,
        r / SWORD_VFX_CONSTANTS.TARGET_CAPSULE_RADIUS
      );
    }

    // 3. Update exact contact markers
    for (let i = 0; i < MAX_DEBUG_CONTACTS; i++) {
      const mesh = contactRefs.current[i];
      if (!mesh) continue;
      if (i >= dbg.contactCount) {
        mesh.visible = false;
        continue;
      }
      const c = dbg.contacts[i];
      const age = now - c.timestamp;
      if (age < 0 || age > CONTACT_LINGER_MS) {
        mesh.visible = false;
        continue;
      }
      const k = 1 - age / CONTACT_LINGER_MS;
      mesh.visible = true;
      mesh.position.set(c.x, c.y, c.z);
      const s = 0.7 + (1 - k) * 0.9;
      mesh.scale.set(s, s, s);
      (mesh.material as THREE.MeshBasicMaterial).opacity = k;
    }
  });

  if (!EXPERIMENTAL_SWORD_VFX_AND_HITBOX || !visible) {
    return null;
  }

  return (
    <group name="SweptHitboxDebugOverlay">
      <lineSegments geometry={lineGeo} material={lineMat} frustumCulled={false} renderOrder={995} />

      {Array.from({ length: MAX_DEBUG_CAPSULES }).map((_, idx) => (
        <mesh
          key={`cap-${idx}`}
          ref={(el) => {
            capsuleRefs.current[idx] = el;
          }}
          geometry={capsuleGeo}
          visible={false}
          renderOrder={994}
        >
          <meshBasicMaterial
            color="#4ade80"
            wireframe
            transparent
            opacity={0.5}
            depthWrite={false}
          />
        </mesh>
      ))}

      {Array.from({ length: MAX_DEBUG_CONTACTS }).map((_, idx) => (
        <mesh
          key={`hit-${idx}`}
          ref={(el) => {
            contactRefs.current[idx] = el;
          }}
          geometry={contactGeo}
          visible={false}
          renderOrder={999}
        >
          <meshBasicMaterial
            color="#ff2e63"
            transparent
            opacity={0.95}
            depthTest={false}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  );
});
