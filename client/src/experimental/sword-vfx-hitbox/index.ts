export {
  EXPERIMENTAL_SWORD_VFX_AND_HITBOX,
  ATTACK_VFX_THEMES,
  EXTRA_VFX_THEMES,
  ATTACK_ACTIVE_FRAMES,
  SWORD_VFX_CONSTANTS,
  resolveSwordTheme,
  isOffensiveSwordAction,
  isProgressInActiveFrames,
  isElapsedInActiveFrames,
  getBladeAuraIntensity,
  type SwordColorTheme,
  type SwordThemeKey,
  type ActiveFrameWindow,
} from "./config";

export {
  createBladeAuraMaterial,
  createRibbonTrailMaterial,
  createBladeSparkPointsMaterial,
  updateSwordShaderUniforms,
  type BladeAuraShaderOptions,
  type RibbonTrailShaderOptions,
} from "./swordAuraShader";

export {
  closestPointsSegmentToSegment,
  sweepBladeAgainstTargets,
  createSweptSwingTracker,
  createSweptDebugState,
  recordSweptDebugQuad,
  recordSweptDebugContact,
  type Vec3Like,
  type SweptTargetCapsule,
  type SweptHitResult,
  type SweepBladeOptions,
  type SweptSwingTracker,
  type SweptDebugQuad,
  type SweptDebugContact,
  type SweptDebugState,
} from "./sweptHitbox";

export {
  SweptHitboxDebugOverlay,
  type SweptHitboxDebugOverlayProps,
} from "./SweptHitboxDebugOverlay";

export {
  WeaponBladeTrail,
  type WeaponBladeTrailProps,
} from "./WeaponBladeTrail";

export {
  CombatBurstVFX,
  mapCombatEventToBurstKind,
  enqueueCombatBurst,
  type CombatBurstKind,
  type CombatBurstEvent,
  type CombatBurstVFXProps,
} from "./CombatBurstVFX";

/**
 * Ready-to-append Markdown documentation section for `EXPERIMENTAL_FEATURE_LOG.md`.
 */
export const SWORD_VFX_LOG_SECTION = `
## Experimental Sword Auras, Weapon-Tracked Ribbon Trails, Combat Burst VFX & Swept Weapon Hitboxes

- **Status:** Isolated Experimental Module (Ready for Integration)
- **Master Toggle:** \`EXPERIMENTAL_SWORD_VFX_AND_HITBOX = true\` in \`client/src/experimental/sword-vfx-hitbox/config.ts\`
- **Directory:** \`client/src/experimental/sword-vfx-hitbox/\`

### Files Added
1. \`config.ts\` — Master toggle, vivid \`ATTACK_VFX_THEMES\` colour palettes (\`light1\`, \`light2\`, \`heavy\`, \`thrust\`, \`whirlwind\`, \`aerial_slam\`, \`counter\`, \`sakura_dance\`, \`mortal_draw\`, \`mortal_draw_empowered\`, \`block\`, \`idle\`), active-frame windows (\`windupEnd\`, \`activeEnd\`) synced directly to \`@sekiroslop/shared\` \`ATTACK_SPECS\`, and Gladius geometry constants.
2. \`swordAuraShader.ts\` — Lightweight custom GLSL \`THREE.ShaderMaterial\` factories (\`createBladeAuraMaterial\`, \`createRibbonTrailMaterial\`, \`createBladeSparkPointsMaterial\`) with zero per-frame allocations and \`updateSwordShaderUniforms\` helper.
3. \`WeaponBladeTrail.tsx\` — Reads live world-space sword \`base\` and \`tip\` positions via \`Object3D.getWorldPosition\` into pre-allocated scratch \`THREE.Vector3\`s, updates an 18-sample ring-buffer \`THREE.BufferGeometry\` triangle-strip ribbon mesh in-place, wraps the Gladius in an animated Fresnel + plasma-wave Blade Aura Shell, emits 48 pooled \`THREE.Points\` blade-tip slash sparks, and optionally drives swept hit detection on the exact same live blade segment.
4. \`CombatBurstVFX.tsx\` — Pooled, zero-allocation 3-draw-call (\`InstancedMesh\`) contact burst VFX at exact hit points:
   - **Perfect Deflect:** 24 blazing golden radial spark streaks + expanding golden ring + white core flash
   - **Hit / Impact:** 18 directional impact sparks aligned to the actual attack swing direction
   - **Block:** 14 crisp amber-white steel guard sparks + ring flash
   - **Posture Break:** wide horizontal shockwave ring + 24 upward-rising energy sparks
5. \`sweptHitbox.ts\` — Pure, zero-allocation swept segment-to-capsule collision math (\`sweepBladeAgainstTargets\`, \`closestPointsSegmentToSegment\`, \`createSweptSwingTracker\`). Sub-samples 4 interpolated segments across \`(prevBase, prevTip) -> (currBase, currTip)\` against upright target capsules \`(x, y..y+1.8, z, r=0.52)\` to eliminate fast-swing tunneling and emit exact world-space contact points.
6. \`SweptHitboxDebugOverlay.tsx\` — Optional \`[H]\`-toggled wireframe debug overlay visualizing the 4 sub-sampled swept blade segments, target upright capsules, and exact hit contact markers.
7. \`index.ts\` — Clean barrel export of all public APIs and this log section.

### Dependencies
- Strictly depends only on \`@sekiroslop/shared\`, \`three\`, \`@react-three/fiber\`, and \`react\`.
- Zero edits to core \`shared/\`, \`server/\`, \`client/src/scene/\`, or \`client/src/ui/\` files.

### Known Notes / Integration Guidance
- \`WeaponBladeTrail\` portals the world-space ribbon and particles directly into \`state.scene\` and the Blade Aura Shell directly into the \`RomanGladius\` group, so it mounts cleanly inside \`GladiatorModel\` with zero double-transform artifacts.
- Swept hit detection is client-side visual/hit-verification ready and can feed exact contact points directly into \`CombatBurstVFX\` via \`enqueueCombatBurst\`, while authoritative multiplayer HP/Posture remains on the Colyseus server.

### How to Disable or Remove Cleanly
- **Instant Disable (1 line):** Set \`export const EXPERIMENTAL_SWORD_VFX_AND_HITBOX = false;\` in \`client/src/experimental/sword-vfx-hitbox/config.ts\`.
- **Full Removal:** Remove any integration imports from \`client/src/experimental/sword-vfx-hitbox\` and delete the \`client/src/experimental/sword-vfx-hitbox/\` folder.
`.trim();
