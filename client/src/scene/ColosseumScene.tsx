import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { PerformanceMonitor, useGLTF } from "@react-three/drei";
import {
  ARENA,
  ARENA_MAPS,
  BOSS_RUSH_TRIALS,
  ENEMY_ARCHETYPES,
  getWavePlan,
  type ArenaMapKind,
  type AttackMessage,
  type BlockMessage,
  type CastAbilityMessage,
  type DodgeMessage,
  type EnemyKind,
  type GameMode,
  type MoveMessage,
  type PlayerAbilityKind,
  type UseItemMessage,
} from "@sekiroslop/shared";
import { ArenaAtmosphereVFX } from "./ArenaAtmosphereVFX";
import { ArenaCats } from "./ArenaCats";
import { preloadArenaMapProps } from "./ArenaWorldProps";
import { ArenaSky } from "./ArenaSky";
import { ColosseumArena } from "./ColosseumArena";
import { GladiatorModel, type LivePose } from "./GladiatorModel";
import { BossEnemyModel } from "./BossEnemyModel";
import { CreatureEnemyModel } from "./CreatureEnemyModel";
import { LocalPlayerController } from "./LocalPlayerController";
import { SceneAssetBoundary } from "./SceneAssetBoundary";
import { CombatVFX, type BurstEffect } from "./CombatVFX";
import { SlashVFX, type SlashEffect } from "./SlashVFX";
import { AbilityAndSpellVFX } from "./AbilityAndSpellVFX";
import { ArenaPickups } from "./ArenaPickups";
import { PilumProjectiles } from "./PilumProjectiles";
import type { AbilityVfxEvent, ActiveExperimentalArtState, RoomWorldSnapshot } from "../net/useColosseumRoom";
import {
  getGraphicsQualityProfile,
  type GraphicsQualityPreset,
} from "../lib/graphicsQuality";
import { isTouchDevice } from "../input/touchInput";
import {
  EXPERIMENTAL_SPECIAL_MOVES,
  ExperimentalVFX,
  type ExperimentalArtKind,
  type ExperimentalVfxEvent,
  type InspectedRigStatus,
} from "../experimental/special-moves";
import {
  CombatBurstVFX,
  EXPERIMENTAL_SWORD_VFX_AND_HITBOX,
  SweptHitboxDebugOverlay,
  createSweptDebugState,
  type CombatBurstEvent,
  type SweptDebugState,
  type SweptTargetCapsule,
} from "../experimental/sword-vfx-hitbox";

export interface PerfStats {
  fps: number;
  drawCalls: number;
  triangles: number;
}

useGLTF.preload("/assets/models/Knight.glb");
useGLTF.preload("/assets/weapons/Katana.glb");

const SECONDARY_MODEL_PATHS = [
  "/assets/models/Skeleton_Minion.glb",
  "/assets/models/Skeleton_Warrior.glb",
  "/assets/models/Skeleton_Rogue.glb",
  "/assets/models/Barbarian.glb",
  "/assets/skins/Ninja.glb",
  "/assets/skins/BlackKnight.glb",
  "/assets/skins/Paladin_with_Helmet.glb",
  "/assets/skins/Mage.glb",
  "/assets/skins/SpaceRanger_FlightMode.glb",
  "/assets/enemies/Skeleton_Mage.glb",
  "/assets/enemies/AvianSwordsman.glb",
  "/assets/enemies/DreadKnight.glb",
  "/assets/enemies/Dragon.glb",
  "/assets/enemies/Enemy_Flying_Gun.glb",
  "/assets/enemies/Wolf.glb",
  "/assets/enemies/AegisMech.glb",
  "/assets/weapons/Claymore.glb",
  "/assets/weapons/Scythe.glb",
  "/assets/weapons/StunPistol.glb",
] as const;

function getUpcomingWaveModelPaths(
  gameMode: GameMode,
  wave: number,
  bossTrial: number
): string[] {
  const kinds = new Set<EnemyKind>();
  if (gameMode === "boss_rush") {
    const trialIdx = Math.max(0, Math.min(BOSS_RUSH_TRIALS.length - 1, bossTrial));
    for (const k of BOSS_RUSH_TRIALS[trialIdx]?.bosses ?? []) kinds.add(k);
  } else if (gameMode === "team_3v3") {
    kinds.add("legionary");
    kinds.add("assassin");
    kinds.add("skirmisher");
  } else if (gameMode === "waves") {
    for (const k of getWavePlan(Math.max(1, wave + 1)).enemies) kinds.add(k);
  }
  const paths = new Set<string>();
  kinds.forEach((k) => {
    const spec = ENEMY_ARCHETYPES[k];
    if (spec?.modelFile) paths.add(spec.modelFile);
    if (k === "mist_shinobi") paths.add("/assets/weapons/Scythe.glb");
    if (k === "champion") paths.add("/assets/weapons/Claymore.glb");
  });
  return [...paths];
}

function ModelPreloader({
  mapKind,
  gameMode,
  wave,
  bossTrial,
}: {
  mapKind: ArenaMapKind;
  gameMode: GameMode;
  wave: number;
  bossTrial: number;
}) {
  useEffect(() => {
    preloadArenaMapProps(mapKind);
    const touch = isTouchDevice();
    const queue = touch
      ? getUpcomingWaveModelPaths(gameMode, wave, bossTrial)
      : [...SECONDARY_MODEL_PATHS];
    if (queue.length === 0) return;

    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    let cancelled = false;
    let index = 0;
    let idleId: number | undefined;
    let timeoutId: number | undefined;

    const loadNext = () => {
      if (cancelled || index >= queue.length) return;
      useGLTF.preload(queue[index]);
      index++;
      scheduleNext();
    };
    const scheduleNext = () => {
      if (idleWindow.requestIdleCallback) {
        idleId = idleWindow.requestIdleCallback(loadNext, { timeout: 1800 });
      } else {
        timeoutId = window.setTimeout(loadNext, touch ? 320 : 250);
      }
    };

    scheduleNext();
    return () => {
      cancelled = true;
      if (idleId !== undefined) idleWindow.cancelIdleCallback?.(idleId);
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, [mapKind, gameMode, wave, bossTrial]);

  return null;
}

function ArenaFallbackFloor({ mapKind }: { mapKind: ArenaMapKind }) {
  const palette = ARENA_MAPS[mapKind] ?? ARENA_MAPS.sunlit_colosseum;
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <circleGeometry args={[ARENA.WALL_RADIUS + 2, 48]} />
      <meshStandardMaterial color={palette.sand} roughness={0.95} />
    </mesh>
  );
}

function EntityLoadFallback({ x, y, z }: { x: number; y: number; z: number }) {
  return (
    <mesh position={[x, (y ?? 0) + 0.04, z]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[0.38, 0.56, 20]} />
      <meshBasicMaterial color="#d2b37c" transparent opacity={0.45} />
    </mesh>
  );
}

function WebGLContextGuard({ onContextRestored }: { onContextRestored: () => void }) {
  const { gl } = useThree();
  useEffect(() => {
    const canvas = gl.domElement;
    const handleLost = (event: Event) => {
      event.preventDefault();
      console.warn("[ColosseumScene] WebGL context lost — awaiting automatic GPU restore.");
    };
    const handleRestored = () => {
      console.info("[ColosseumScene] WebGL context restored.");
      onContextRestored();
    };
    canvas.addEventListener("webglcontextlost", handleLost, false);
    canvas.addEventListener("webglcontextrestored", handleRestored, false);
    return () => {
      canvas.removeEventListener("webglcontextlost", handleLost, false);
      canvas.removeEventListener("webglcontextrestored", handleRestored, false);
    };
  }, [gl, onContextRestored]);
  return null;
}

interface ColosseumSceneProps {
  connected: boolean;
  sessionId: string;
  world: RoomWorldSnapshot;
  graphicsQuality: GraphicsQualityPreset;
  worldRef: React.MutableRefObject<RoomWorldSnapshot>;
  spectateTargetId: string;
  localPoseRef?: React.MutableRefObject<LivePose>;
  nearLever: boolean;
  lockedEnemyId: string | null;
  effectsRef: React.MutableRefObject<BurstEffect[]>;
  slashesRef: React.MutableRefObject<SlashEffect[]>;
  abilityVfxRef?: React.MutableRefObject<AbilityVfxEvent[]>;
  experimentalVfxRef?: React.MutableRefObject<ExperimentalVfxEvent[]>;
  combatBurstsRef?: React.MutableRefObject<CombatBurstEvent[]>;
  activeExperimentalArts?: Record<string, ActiveExperimentalArtState>;
  shakeRef: React.MutableRefObject<number>;
  selectedAbility?: PlayerAbilityKind;
  onSelectAbility?: (ability: PlayerAbilityKind) => void;
  onCastAbility?: (msg: CastAbilityMessage) => void;
  onLockChange: (enemyId: string | null) => void;
  onMove: (msg: MoveMessage) => void;
  onAttack: (msg: AttackMessage) => void;
  onUseItem: (msg: UseItemMessage) => void;
  onBlock: (msg: BlockMessage) => void;
  onDodge: (msg: DodgeMessage) => void;
  onInteractGate: () => void;
  onNearLeverChange: (near: boolean) => void;
  onExperimentalArt?: (art: ExperimentalArtKind, yaw: number) => void;
  onRigInspected?: (status: InspectedRigStatus) => void;
  onPerfSample: (stats: PerfStats) => void;
}

function LobbyCameraOrbit() {
  useFrame((state) => {
    const t = state.clock.elapsedTime * 0.14;
    state.camera.position.set(Math.sin(t) * 18, 9.5, Math.cos(t) * 18);
    state.camera.lookAt(0, 2.0, -4);
  });
  return null;
}

function PerfTracker({ onSample }: { onSample: (stats: PerfStats) => void }) {
  const { gl } = useThree();
  const framesRef = useRef(0);
  const lastSampleRef = useRef(performance.now());

  useFrame(() => {
    framesRef.current += 1;
    const now = performance.now();
    const elapsed = now - lastSampleRef.current;
    if (elapsed >= 500) {
      const fps = Math.round((framesRef.current * 1000) / elapsed);
      framesRef.current = 0;
      lastSampleRef.current = now;
      onSample({
        fps,
        drawCalls: gl.info.render.calls,
        triangles: gl.info.render.triangles,
      });
    }
  });

  return null;
}

function SweptTargetsUpdater({
  worldRef,
  localPoseRef,
  sessionId,
  targetsRef,
  debugStateRef,
}: {
  worldRef: React.MutableRefObject<RoomWorldSnapshot>;
  localPoseRef: React.MutableRefObject<LivePose>;
  sessionId: string;
  targetsRef: React.MutableRefObject<SweptTargetCapsule[]>;
  debugStateRef: React.MutableRefObject<SweptDebugState>;
}) {
  useFrame(() => {
    const world = worldRef.current;
    const pool = targetsRef.current;
    let count = 0;

    for (let i = 0; i < world.enemies.length; i++) {
      const e = world.enemies[i];
      if (!e.alive) continue;
      const scale = ENEMY_ARCHETYPES[e.kind]?.scale ?? 1.0;
      let cap = pool[count];
      if (!cap) {
        cap = { id: e.id, x: e.x, y: e.y, z: e.z, height: 1.8 * scale, radius: 0.52 * scale, alive: true };
        pool.push(cap);
      } else {
        cap.id = e.id;
        cap.x = e.x;
        cap.y = e.y;
        cap.z = e.z;
        cap.height = 1.8 * scale;
        cap.radius = 0.52 * scale;
        cap.alive = true;
      }
      count++;
    }

    for (let i = 0; i < world.players.length; i++) {
      const p = world.players[i];
      if (!p.alive) continue;
      const isSelf = p.id === sessionId;
      const px = isSelf ? localPoseRef.current.x : p.x;
      const py = isSelf ? localPoseRef.current.y : p.y;
      const pz = isSelf ? localPoseRef.current.z : p.z;
      let cap = pool[count];
      if (!cap) {
        cap = { id: p.id, x: px, y: py, z: pz, height: 1.8, radius: 0.52, alive: true };
        pool.push(cap);
      } else {
        cap.id = p.id;
        cap.x = px;
        cap.y = py;
        cap.z = pz;
        cap.height = 1.8;
        cap.radius = 0.52;
        cap.alive = true;
      }
      count++;
    }

    if (pool.length !== count) {
      pool.length = count;
    }
    debugStateRef.current.targets = pool;
  });

  return null;
}

interface MapLightingConfig {
  fogColor: string;
  fogNear: number;
  fogFar: number;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  keyPos: [number, number, number];
  keyColor: string;
  keyIntensity: number;
  fillPos: [number, number, number];
  fillColor: string;
  fillIntensity: number;
  rimPos: [number, number, number];
  rimColor: string;
  rimIntensity: number;
  points: readonly { pos: [number, number, number]; color: string; intensity: number; distance: number }[];
}

const MAP_LIGHTING: Record<ArenaMapKind, MapLightingConfig> = {
  sunlit_colosseum: {
    fogColor: "#e3c296",
    fogNear: 46,
    fogFar: 135,
    hemiSky: "#fff4db",
    hemiGround: "#9e764a",
    hemiIntensity: 1.25,
    keyPos: [28, 30, -22],
    keyColor: "#ffe8ba",
    keyIntensity: 2.7,
    fillPos: [-24, 18, 22],
    fillColor: "#9cc4f6",
    fillIntensity: 0.82,
    rimPos: [-28, 16, 22],
    rimColor: "#ffd494",
    rimIntensity: 0.55,
    points: [
      { pos: [0, 9, 25], color: "#ffae5c", intensity: 22, distance: 42 },
    ],
  },
  moonlit_sakura: {
    fogColor: "#263864",
    fogNear: 38,
    fogFar: 118,
    hemiSky: "#dceaff",
    hemiGround: "#6e7a9e",
    hemiIntensity: 1.82,
    keyPos: [18, 34, -26],
    keyColor: "#f2f7ff",
    keyIntensity: 2.95,
    fillPos: [-20, 16, 20],
    fillColor: "#ffd4eb",
    fillIntensity: 1.0,
    rimPos: [-18, 18, 26],
    rimColor: "#9dc4ff",
    rimIntensity: 0.68,
    points: [
      { pos: [18, 4.5, 16], color: "#ffc266", intensity: 22, distance: 38 },
      { pos: [-18, 4.5, -14], color: "#ffc266", intensity: 22, distance: 38 },
    ],
  },
  aurora_sanctuary: {
    fogColor: "#143d52",
    fogNear: 42,
    fogFar: 128,
    hemiSky: "#c8f7ff",
    hemiGround: "#2c3254",
    hemiIntensity: 1.55,
    keyPos: [20, 34, -24],
    keyColor: "#e6fcff",
    keyIntensity: 2.75,
    fillPos: [-22, 18, 20],
    fillColor: "#e8a8ff",
    fillIntensity: 1.05,
    rimPos: [-20, 16, 26],
    rimColor: "#4ef2d2",
    rimIntensity: 0.72,
    points: [
      { pos: [0, 8, 26], color: "#22d3ee", intensity: 22, distance: 42 },
      { pos: [0, 5, -24], color: "#f472b6", intensity: 16, distance: 34 },
    ],
  },
  sunny_sakura: {
    fogColor: "#e6d9c3",
    fogNear: 48,
    fogFar: 138,
    hemiSky: "#e6f5ff",
    hemiGround: "#87996b",
    hemiIntensity: 1.48,
    keyPos: [26, 32, -22],
    keyColor: "#fff4d9",
    keyIntensity: 2.85,
    fillPos: [-22, 18, 22],
    fillColor: "#ffd6ea",
    fillIntensity: 0.95,
    rimPos: [-24, 16, 24],
    rimColor: "#ffe0a3",
    rimIntensity: 0.6,
    points: [
      { pos: [0, 9, 26], color: "#ffd699", intensity: 18, distance: 40 },
    ],
  },
};

export function ColosseumScene({
  connected,
  sessionId,
  world,
  graphicsQuality,
  worldRef,
  spectateTargetId,
  localPoseRef: externalLocalPoseRef,
  nearLever,
  lockedEnemyId,
  effectsRef,
  slashesRef,
  abilityVfxRef,
  experimentalVfxRef,
  combatBurstsRef,
  activeExperimentalArts = {},
  shakeRef,
  selectedAbility = "fireball",
  onSelectAbility,
  onCastAbility,
  onLockChange,
  onMove,
  onAttack,
  onUseItem,
  onBlock,
  onDodge,
  onInteractGate,
  onNearLeverChange,
  onExperimentalArt,
  onRigInspected,
  onPerfSample,
}: ColosseumSceneProps) {
  const graphicsProfile = getGraphicsQualityProfile(graphicsQuality);
  const [adaptiveDpr, setAdaptiveDpr] = useState<{
    preset: GraphicsQualityPreset;
    value: number | [number, number];
  }>(() => ({ preset: graphicsQuality, value: graphicsProfile.dpr }));
  const renderDpr = adaptiveDpr.preset === graphicsQuality ? adaptiveDpr.value : graphicsProfile.dpr;
  const setRenderDpr = (value: number | [number, number]) => {
    setAdaptiveDpr({ preset: graphicsQuality, value });
  };
  const arenaTheme = ARENA_MAPS[world.arenaMap] ?? ARENA_MAPS.sunlit_colosseum;
  const lighting = MAP_LIGHTING[world.arenaMap] ?? MAP_LIGHTING.sunlit_colosseum;
  const localPlayer = connected ? world.players.find((p) => p.id === sessionId) : undefined;
  const remotePlayers = connected ? world.players.filter((p) => p.id !== sessionId) : [];
  const internalPoseRef = useRef<LivePose>({
    x: 0,
    y: 0,
    z: 10,
    yaw: Math.PI,
    moveAnim: "idle",
    speedRatio: 0,
  });
  const localPoseRef = externalLocalPoseRef ?? internalPoseRef;
  const sweptDebugRef = useRef<SweptDebugState>(createSweptDebugState());
  const sweptTargetsRef = useRef<SweptTargetCapsule[]>([]);
  const [contextGeneration, setContextGeneration] = useState(0);

  return (
    <Canvas
      key={`${graphicsQuality}-${contextGeneration}`}
      frameloop="always"
      shadows={graphicsProfile.shadowMap}
      dpr={renderDpr}
      camera={{ fov: 56, near: 0.2, far: 160, position: [0, 9.5, 18] }}
      gl={{
        antialias: graphicsProfile.antialias,
        powerPreference: isTouchDevice() ? "default" : "high-performance",
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: 1.08,
      }}
      style={{ width: "100%", height: "100%", display: "block" }}
    >
      <WebGLContextGuard onContextRestored={() => setContextGeneration((g) => g + 1)} />
      <color attach="background" args={[arenaTheme.sky]} />
      <fog attach="fog" args={[lighting.fogColor, lighting.fogNear, lighting.fogFar]} />
      <ArenaSky mapKind={world.arenaMap} />

      <hemisphereLight args={[lighting.hemiSky, lighting.hemiGround, lighting.hemiIntensity]} />
      <directionalLight
        position={lighting.keyPos}
        intensity={lighting.keyIntensity}
        color={lighting.keyColor}
        castShadow
        shadow-mapSize-width={graphicsProfile.shadowMapSize}
        shadow-mapSize-height={graphicsProfile.shadowMapSize}
        shadow-camera-near={5}
        shadow-camera-far={95}
        shadow-camera-left={-graphicsProfile.shadowFrustum}
        shadow-camera-right={graphicsProfile.shadowFrustum}
        shadow-camera-top={graphicsProfile.shadowFrustum}
        shadow-camera-bottom={-graphicsProfile.shadowFrustum}
        shadow-bias={-0.0005}
      />
      <directionalLight
        position={lighting.fillPos}
        intensity={lighting.fillIntensity}
        color={lighting.fillColor}
      />
      {graphicsQuality !== "low" && (
        <directionalLight
          position={lighting.rimPos}
          intensity={lighting.rimIntensity}
          color={lighting.rimColor}
          castShadow={false}
        />
      )}
      {graphicsProfile.pointLights && lighting.points.map((pt, idx) => (
        <pointLight
          key={`${world.arenaMap}-pt-${idx}`}
          position={pt.pos}
          color={pt.color}
          intensity={pt.intensity}
          distance={pt.distance}
          decay={2}
        />
      ))}

      <PerfTracker onSample={onPerfSample} />
      <PerformanceMonitor
        flipflops={3}
        onDecline={() => setRenderDpr(graphicsProfile.dpr[0])}
        onIncline={() => setRenderDpr(graphicsProfile.dpr)}
        onFallback={() => setRenderDpr(graphicsProfile.dpr[0])}
      />
      <ArenaAtmosphereVFX mapKind={world.arenaMap} particleScale={graphicsProfile.particleScale} />
      <ArenaCats active={connected && graphicsProfile.arenaCats} />
      <ModelPreloader
        mapKind={world.arenaMap}
        gameMode={world.gameMode}
        wave={world.wave}
        bossTrial={world.bossTrial}
      />

      <SceneAssetBoundary
        resetKey={world.arenaMap}
        fallback={<ArenaFallbackFloor mapKind={world.arenaMap} />}
      >
        <ColosseumArena
          worldRef={worldRef}
          mapKind={world.arenaMap}
          gateCooldownMs={world.northGate.cooldownMs}
          nearLever={nearLever}
          maxAnisotropy={graphicsProfile.maxAnisotropy}
        />
      </SceneAssetBoundary>

      {localPlayer && (
        <LocalPlayerController
          player={localPlayer}
          graphicsTier={graphicsProfile.tier}
          spectateTargetId={spectateTargetId}
          worldRef={worldRef}
          localPoseRef={localPoseRef}
          enemies={world.enemies}
          lockedEnemyId={lockedEnemyId}
          shakeRef={shakeRef}
          activeExperimentalArt={activeExperimentalArts[localPlayer.id] ?? null}
          selectedAbility={selectedAbility}
          onSelectAbility={onSelectAbility}
          onCastAbility={onCastAbility}
          sweptDebugRef={EXPERIMENTAL_SWORD_VFX_AND_HITBOX ? sweptDebugRef : undefined}
          sweptTargetsRef={EXPERIMENTAL_SWORD_VFX_AND_HITBOX ? sweptTargetsRef : undefined}
          onLockChange={onLockChange}
          onMove={onMove}
          onAttack={onAttack}
          onUseItem={onUseItem}
          onBlock={onBlock}
          onDodge={onDodge}
          onInteractGate={onInteractGate}
          onNearLeverChange={onNearLeverChange}
          onExperimentalArt={onExperimentalArt}
          onRigInspected={onRigInspected}
        />
      )}

      {/* Remote Players — isolated per player so skin swaps never hide the arena */}
      {remotePlayers.map((p) => (
        <SceneAssetBoundary
          key={p.id}
          resetKey={p.skin}
          fallback={p.alive ? <EntityLoadFallback x={p.x} y={p.y} z={p.z} /> : null}
        >
          <GladiatorModel
            entityId={p.id}
            kind="player"
            graphicsTier={graphicsProfile.tier}
            slot={p.slot}
            team={p.team}
            skin={p.skin}
            x={p.x}
            y={p.y}
            z={p.z}
            yaw={p.yaw}
            action={p.action}
            moveAnim={p.moveAnim}
            isBlocking={p.isBlocking}
            isFlying={p.isFlying}
            hp={p.hp}
            maxHp={p.maxHp}
            posture={p.posture}
            maxPosture={p.maxPosture}
            furyActive={p.furyMs > 0}
            ironWillActive={p.ironWillMs > 0}
            swiftFeetActive={p.swiftFeetMs > 0}
            activeExperimentalArt={activeExperimentalArts[p.id] ?? null}
            sweptTargetsRef={EXPERIMENTAL_SWORD_VFX_AND_HITBOX ? sweptTargetsRef : undefined}
            isLockedTarget={p.id === lockedEnemyId}
            worldRef={worldRef}
            alive={p.alive}
          />
        </SceneAssetBoundary>
      ))}

      {/* Arena Wave & Boss Enemies — isolated per enemy so pulling the Gate Lever NEVER hides the map */}
      {connected &&
        world.enemies.map((e) => (
          <SceneAssetBoundary
            key={e.id}
            resetKey={e.kind}
            fallback={e.alive ? <EntityLoadFallback x={e.x} y={e.y} z={e.z} /> : null}
          >
            {e.kind === "dread_knight" || e.kind === "dragon" ? (
              <BossEnemyModel
                entityId={e.id}
                graphicsTier={graphicsProfile.tier}
                enemyKind={e.kind}
                x={e.x}
                y={e.y}
                z={e.z}
                yaw={e.yaw}
                action={e.action}
                attackKind={e.attackKind}
                isBlocking={e.isBlocking}
                hp={e.hp}
                maxHp={e.maxHp}
                posture={e.posture}
                maxPosture={e.maxPosture}
                telegraph={e.telegraph}
                isLockedTarget={e.id === lockedEnemyId}
                worldRef={worldRef}
                alive={e.alive}
              />
            ) : e.kind === "stun_drone" || e.kind === "dire_wolf" || e.kind === "aegis_mech" ? (
              <CreatureEnemyModel
                entityId={e.id}
                graphicsTier={graphicsProfile.tier}
                enemyKind={e.kind}
                x={e.x}
                y={e.y}
                z={e.z}
                yaw={e.yaw}
                action={e.action}
                attackKind={e.attackKind}
                isBlocking={e.isBlocking}
                hp={e.hp}
                maxHp={e.maxHp}
                posture={e.posture}
                maxPosture={e.maxPosture}
                telegraph={e.telegraph}
                isLockedTarget={e.id === lockedEnemyId}
                worldRef={worldRef}
                alive={e.alive}
              />
            ) : (
              <GladiatorModel
                entityId={e.id}
                kind="skeleton"
                graphicsTier={graphicsProfile.tier}
                enemyKind={e.kind}
                team={e.team}
                activeExperimentalArt={activeExperimentalArts[e.id] ?? null}
                x={e.x}
                y={e.y}
                z={e.z}
                yaw={e.yaw}
                action={e.action}
                attackKind={e.attackKind}
                isBlocking={e.isBlocking}
                hp={e.hp}
                maxHp={e.maxHp}
                posture={e.posture}
                maxPosture={e.maxPosture}
                telegraph={e.telegraph}
                isLockedTarget={e.id === lockedEnemyId}
                worldRef={worldRef}
                alive={e.alive}
              />
            )}
          </SceneAssetBoundary>
        ))}

      <SceneAssetBoundary>
        {/* Shared Random Power-Up Collectibles */}
        {connected && <ArenaPickups pickups={world.pickups} />}

        {/* Live Flying Projectiles (Pilum, Fireball, Arcane Orb, Stun Bolt) */}
        {connected && <PilumProjectiles worldRef={worldRef} />}

        {/* Enemy Shadow Step, Spell Explosions & FFA Sacred Ring */}
        {abilityVfxRef && <AbilityAndSpellVFX eventsRef={abilityVfxRef} worldRef={worldRef} />}

        {/* Combat Impact & Special Sword Slash VFX */}
        <CombatVFX effectsRef={effectsRef} />
        <SlashVFX
          slashesRef={slashesRef}
          worldRef={worldRef}
          sessionId={sessionId}
          localPoseRef={localPoseRef}
        />

        {/* Isolated Experimental Combat Arts VFX (flag-guarded) */}
        {EXPERIMENTAL_SPECIAL_MOVES && experimentalVfxRef && (
          <ExperimentalVFX
            eventsRef={experimentalVfxRef}
            worldRef={worldRef}
            sessionId={sessionId}
            localPoseRef={localPoseRef}
          />
        )}

        {/* Isolated Experimental Sword Burst VFX & Swept Hitbox Targets/Overlay (flag-guarded) */}
        {EXPERIMENTAL_SWORD_VFX_AND_HITBOX && (
          <>
            <SweptTargetsUpdater
              worldRef={worldRef}
              localPoseRef={localPoseRef}
              sessionId={sessionId}
              targetsRef={sweptTargetsRef}
              debugStateRef={sweptDebugRef}
            />
            {combatBurstsRef && <CombatBurstVFX burstsRef={combatBurstsRef} />}
            <SweptHitboxDebugOverlay debugStateRef={sweptDebugRef} />
          </>
        )}
      </SceneAssetBoundary>

      {!connected && <LobbyCameraOrbit />}
    </Canvas>
  );
}
