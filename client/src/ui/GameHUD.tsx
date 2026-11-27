import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  ENEMY_ARCHETYPES,
  FLIGHT,
  PLAYER_ABILITIES,
  PLAYER_PALETTES,
  PLAYER_SKINS,
  POWER_UPS,
  type ArenaMapKind,
  type CombatArtKind,
  type GameMode,
  type PlayerAbilityKind,
  type PlayerSkinKind,
  type PowerUpKind,
  type RespawnMode,
  type TeamSide,
  type UseItemMessage,
} from "@sekiroslop/shared";
import type { FeedItem, RoomWorldSnapshot } from "../net/useColosseumRoom";
import type { PerfStats } from "../scene/ColosseumScene";
import { soundEngine } from "../audio/SoundEngine";
import { isTouchDevice, touchInput } from "../input/touchInput";
import { formatKeyCode, useControlsConfig } from "../input/controlsConfig";
import { TouchControls } from "./TouchControls";
import { PreWaveSetup } from "./PreWaveSetup";
import { PartyChat } from "./PartyChat";
import { GameMenuModal } from "./GameMenuModal";
import { Team3v3Panel } from "./Team3v3Panel";
import { EXPERIMENTAL_ARTS } from "../experimental/special-moves";
import type { GraphicsQualityPreset } from "../lib/graphicsQuality";

interface GameHUDProps {
  sessionId: string;
  world: RoomWorldSnapshot;
  graphicsQuality: GraphicsQualityPreset;
  onSetGraphicsQuality: (preset: GraphicsQualityPreset) => void;
  pingMs: number | null;
  feed: FeedItem[];
  deflectBanner: string | null;
  nearLever: boolean;
  lockedEnemyId: string | null;
  perf: PerfStats;
  onUseItem: (msg: UseItemMessage) => void;
  onCastSelectedArt: () => void;
  selectedAbility?: PlayerAbilityKind;
  onSelectAbility?: (ability: PlayerAbilityKind) => void;
  onCastAbility?: () => void;
  onPunch?: () => void;
  onStartFfa?: () => void;
  onToggleInfiniteHealth?: (enabled: boolean) => void;
  onSelectSkin: (skin: PlayerSkinKind) => void;
  onSelectArt: (art: CombatArtKind) => void;
  onSetRespawnMode: (mode: RespawnMode) => void;
  onSetArenaMap: (map: ArenaMapKind) => void;
  onSetGameMode: (mode: GameMode) => void;
  onJoinTeam: (team: TeamSide) => void;
  onSetFillBots: (enabled: boolean) => void;
  onStartTeamMatch: () => void;
  onRematchTeam: () => void;
  spectateTargetId: string;
  onCycleSpectator: (direction: number) => void;
  onLeave: () => void;
  chatMessages: import("@sekiroslop/shared").PartyChatMessage[];
  onSendChat: (text: string) => void;
}

const POWERUP_ICONS: Record<PowerUpKind, string> = {
  healing_flask: "+",
  posture_tonic: "◈",
  warriors_fury: "✦",
  iron_will: "⛨",
  swift_feet: "»",
};

interface ActiveBuffItem {
  id: string;
  label: string;
  remainingMs: number;
  maxMs: number;
  color: string;
}

type ActiveOverlay = "none" | "setup" | "menu" | "touch_layout";

export function GameHUD({
  sessionId,
  world,
  graphicsQuality,
  onSetGraphicsQuality,
  pingMs,
  feed,
  deflectBanner,
  nearLever,
  lockedEnemyId,
  perf,
  onUseItem,
  onCastSelectedArt,
  selectedAbility = "fireball",
  onSelectAbility,
  onCastAbility,
  onPunch,
  onStartFfa,
  onToggleInfiniteHealth,
  onSelectSkin,
  onSelectArt,
  onSetRespawnMode,
  onSetArenaMap,
  onSetGameMode,
  onJoinTeam,
  onSetFillBots,
  onStartTeamMatch,
  onRematchTeam,
  spectateTargetId,
  onCycleSpectator,
  onLeave,
  chatMessages,
  onSendChat,
}: GameHUDProps) {
  const [activeOverlay, setActiveOverlay] = useState<ActiveOverlay>("setup");
  const [setupInitialTab, setSetupInitialTab] = useState<"loadout" | "arena">("loadout");
  const [muted, setMuted] = useState(soundEngine.isMuted());
  const [showPerf, setShowPerf] = useState(false);
  const [showTouch, setShowTouch] = useState(() => isTouchDevice());

  const menuOpen = activeOverlay === "menu";
  const setupOpen = activeOverlay === "setup";
  const editingTouchLayout = activeOverlay === "touch_layout";
  const hasActiveOverlay = activeOverlay !== "none";

  const openSetup = (tab: "loadout" | "arena" = "loadout") => {
    setSetupInitialTab(tab);
    setActiveOverlay("setup");
  };
  const toggleMenu = () => {
    setActiveOverlay((prev) => (prev === "menu" ? "none" : "menu"));
  };
  const closeOverlay = () => {
    setActiveOverlay("none");
  };
  useEffect(() => {
    const syncTouch = () => {
      if (isTouchDevice()) setShowTouch(true);
    };
    window.addEventListener("resize", syncTouch);
    window.addEventListener("orientationchange", syncTouch);
    return () => {
      window.removeEventListener("resize", syncTouch);
      window.removeEventListener("orientationchange", syncTouch);
    };
  }, []);
  const lastTouchAtRef = useRef(-Infinity);
  const controls = useControlsConfig();
  const interactKeyLabel = formatKeyCode(controls.bindings.interact);
  const artKeyLabel = formatKeyCode(controls.bindings.combatArt);
  const abilityKeyLabel = formatKeyCode(controls.bindings.castAbility);
  const punchKeyLabel = formatKeyCode(controls.bindings.punch);
  const abilitySpec = PLAYER_ABILITIES[selectedAbility] ?? PLAYER_ABILITIES.fireball;
  const beltKeys = [
    formatKeyCode(controls.bindings.item1),
    formatKeyCode(controls.bindings.item2),
    formatKeyCode(controls.bindings.item3),
  ];

  const localPlayer = world.players.find((p) => p.id === sessionId);
  const liveEnemies = world.enemies.filter((e) => e.alive);
  const livingBoss = liveEnemies.find((e) => ENEMY_ARCHETYPES[e.kind]?.isBoss);
  const lockedEnemy = lockedEnemyId ? liveEnemies.find((e) => e.id === lockedEnemyId) : undefined;
  const focusedEnemy = lockedEnemy ?? livingBoss ?? liveEnemies[0];
  const isBossFocused = Boolean(focusedEnemy && ENEMY_ARCHETYPES[focusedEnemy.kind]?.isBoss);
  const isFocusedEnemyLocked = Boolean(lockedEnemy && focusedEnemy && focusedEnemy.id === lockedEnemy.id);
  const focusedArchetype = focusedEnemy ? ENEMY_ARCHETYPES[focusedEnemy.kind] : undefined;
  const selectedArt = EXPERIMENTAL_ARTS[localPlayer?.selectedArt ?? "ashina_cross"];
  const canOpenSetup = true;
  const spectating = Boolean(
    localPlayer &&
      !localPlayer.alive &&
      ((world.waveActive && world.respawnMode === "wave_end") ||
        (world.gameMode === "team_3v3" && world.teamMatchActive))
  );
  const spectatedPlayer = world.players.find((p) => p.id === spectateTargetId && p.alive);
  const teammates = world.players.filter((p) => p.id !== sessionId);

  const triggerSelectedArt = () => {
    if (!localPlayer?.alive || localPlayer.combatArtCooldownMs > 0) return;
    soundEngine.unlock();
    onCastSelectedArt();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.repeat) return;
      if (e.code === "KeyP") {
        setShowPerf((v) => !v);
      } else if (e.code === "KeyM") {
        e.preventDefault();
        toggleMenu();
      } else if (e.code === "Escape" && activeOverlay === "touch_layout") {
        e.preventDefault();
        closeOverlay();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeOverlay]);

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    soundEngine.setMuted(next);
  };

  const triggerBeltSlot = (slotIndex: number) => {
    if (!localPlayer || !localPlayer.alive) return;
    const slot = localPlayer.belt[slotIndex];
    if (!slot || !slot.kind || slot.charges <= 0) return;
    soundEngine.unlock();
    if (touchInput.handlers) {
      touchInput.handlers.useItemSlot(slotIndex);
    } else {
      onUseItem({ slotIndex, yaw: localPlayer.yaw });
    }
  };

  const activeBuffs: ActiveBuffItem[] = [];
  if (localPlayer) {
    if (localPlayer.furyMs > 0) {
      activeBuffs.push({
        id: "fury",
        label: "Fury",
        remainingMs: localPlayer.furyMs,
        maxMs: POWER_UPS.warriors_fury.durationMs,
        color: POWER_UPS.warriors_fury.color,
      });
    }
    if (localPlayer.ironWillMs > 0) {
      activeBuffs.push({
        id: "iron_will",
        label: "Iron Will",
        remainingMs: localPlayer.ironWillMs,
        maxMs: POWER_UPS.iron_will.durationMs,
        color: POWER_UPS.iron_will.color,
      });
    }
    if (localPlayer.swiftFeetMs > 0) {
      activeBuffs.push({
        id: "swift_feet",
        label: "Swift",
        remainingMs: localPlayer.swiftFeetMs,
        maxMs: POWER_UPS.swift_feet.durationMs,
        color: POWER_UPS.swift_feet.color,
      });
    }
    if (localPlayer.tonicMs > 0) {
      activeBuffs.push({
        id: "tonic",
        label: "Tonic",
        remainingMs: localPlayer.tonicMs,
        maxMs: POWER_UPS.posture_tonic.durationMs,
        color: POWER_UPS.posture_tonic.color,
      });
    }
  }

  const hpPct = localPlayer ? (localPlayer.hp / Math.max(1, localPlayer.maxHp)) * 100 : 0;
  const posturePct = localPlayer ? (localPlayer.posture / Math.max(1, localPlayer.maxPosture)) * 100 : 0;
  const hasItem = Boolean(localPlayer?.belt.some((s) => Boolean(s.kind) && s.charges > 0));

  return (
    <div className={`hud-root ${showTouch ? "touch-active" : ""} ${hasActiveOverlay ? "has-active-overlay" : ""}`}>
      {/* Top-Left: Quiet Wave Counter + Optional Telemetry */}
      <div className="hud-top-left">
        <div className="hud-wave-line">
          {world.gameMode === "team_3v3" ? (
            <>
              <span className="hud-wave-name">3v3 Team Battle</span>
              <span className="hud-dot" aria-hidden="true" />
              <span className="hud-wave-sub">
                {world.teamMatchActive
                  ? `Round ${world.teamRound}/${world.teamMaxRounds}`
                  : "5 Rounds"}
              </span>
            </>
          ) : world.gameMode === "boss_rush" ? (
            <>
              <span className="hud-wave-name">
                {world.bossTrialTitle || "Boss Rush Gauntlet"}
              </span>
              <span className="hud-dot" aria-hidden="true" />
              <span className="hud-wave-sub">
                {world.waveActive
                  ? `${world.enemiesRemaining} Boss`
                  : showTouch
                    ? "Pull North Gate"
                    : `Pull Gate [${interactKeyLabel}]`}
              </span>
            </>
          ) : world.gameMode === "ffa" ? (
            <>
              <span className="hud-wave-name">Mythic Free-For-All</span>
              <span className="hud-dot" aria-hidden="true" />
              <span className="hud-wave-sub">
                First to {world.ffaTargetScore}
              </span>
            </>
          ) : world.waveActive ? (
            <>
              <span className="hud-wave-name">{world.waveTitle || `Wave ${world.wave}`}</span>
              <span className="hud-dot" aria-hidden="true" />
              <span className="hud-wave-sub">
                {world.enemiesRemaining} / {world.totalEnemiesInWave}
              </span>
            </>
          ) : (
            <>
              <span className="hud-wave-name">Wave {world.wave + 1}</span>
              <span className="hud-dot" aria-hidden="true" />
              <span className="hud-wave-sub">
                {showTouch ? "Pull North Gate" : `Pull Gate [${interactKeyLabel}]`}
              </span>
            </>
          )}
        </div>

        {showPerf && (
          <div className="hud-perf-line" data-testid="perf-telemetry">
            <span>{perf.fps} FPS</span>
            <span>{perf.drawCalls} DC</span>
            <span>{(perf.triangles / 1000).toFixed(1)}k tris</span>
            {pingMs !== null && <span>{pingMs}ms</span>}
          </div>
        )}
      </div>

      {/* Top-Center: Minimalist Enemy / Boss Vitality Bar (hidden during 3v3 scoreboard) */}
      {focusedEnemy && world.gameMode !== "team_3v3" && (
        <div className={`hud-top-center ${isBossFocused ? "boss-active" : ""}`}>
          <div
            className={`enemy-vital ${isBossFocused ? "is-boss" : ""}`}
            style={
              focusedArchetype
                ? ({ "--enemy-accent": focusedArchetype.accentColor } as CSSProperties)
                : undefined
            }
          >
            <div className="enemy-vital-head">
              <span className="enemy-vital-name">
                {isFocusedEnemyLocked && <span className="lock-pip" title="Locked target" />}
                {focusedEnemy.name}
              </span>
              <span className="enemy-vital-meta">
                {focusedEnemy.action === "staggered"
                  ? "POSTURE BROKEN"
                  : focusedEnemy.isBlocking
                    ? "GUARD"
                    : isBossFocused
                      ? `${focusedEnemy.hp} / ${focusedEnemy.maxHp}`
                      : ""}
              </span>
            </div>
            <div className="vital-track enemy-hp-track">
              <div
                className="vital-fill hp-fill"
                style={{ width: `${(focusedEnemy.hp / Math.max(1, focusedEnemy.maxHp)) * 100}%` }}
              />
            </div>
            <div className="vital-track enemy-posture-track">
              <div
                className="vital-fill posture-fill"
                style={{ width: `${(focusedEnemy.posture / Math.max(1, focusedEnemy.maxPosture)) * 100}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Top-Right: Single Minimal Menu & Chat Bar + Subtle Teammates / Feed */}
      <div className="hud-top-right">
        <div className="hud-top-controls" onMouseDown={(e) => e.stopPropagation()}>
          {canOpenSetup && !setupOpen && (
            <button
              type="button"
              className="hud-pill-btn"
              onClick={() => openSetup("loadout")}
            >
              Loadout
            </button>
          )}
          <button
            type="button"
            className={`hud-pill-btn menu-trigger ${menuOpen ? "active" : ""}`}
            onClick={toggleMenu}
            aria-label="Open game menu"
          >
            <span className="menu-icon" aria-hidden="true">≡</span>
            Menu
          </button>
        </div>

        {teammates.length > 0 && (
          <div className="hud-teammates">
            {teammates.map((p) => {
              const palette =
                p.skin === "knight"
                  ? PLAYER_PALETTES[p.slot % PLAYER_PALETTES.length]
                  : PLAYER_SKINS[p.skin] ?? PLAYER_PALETTES[p.slot % PLAYER_PALETTES.length];
              return (
                <div key={p.id} className={`teammate-row ${!p.alive ? "is-fallen" : ""}`}>
                  <span className="teammate-dot" style={{ background: palette.plume }} />
                  <span className="teammate-name">{p.name}</span>
                  <div className="teammate-hp-track">
                    <div
                      className="teammate-hp-fill"
                      style={{ width: `${(p.hp / Math.max(1, p.maxHp)) * 100}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {feed.length > 0 && (
          <div className="combat-feed">
            {feed.slice(0, 3).map((item) => (
              <div key={item.id} className={`feed-item feed-${item.tone}`}>
                {item.text}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Center: Deflect Flash, Contextual Gate Prompt, Death */}
      <div className="hud-center">
        {deflectBanner && <div className="deflect-banner">{deflectBanner}</div>}

        {!showTouch && nearLever && localPlayer?.alive && (world.gameMode === "waves" || world.gameMode === "boss_rush") && (
          <div className="interact-prompt">
            {world.waveActive
              ? `Wave ${world.wave} · ${world.enemiesRemaining} remaining`
              : world.northGate.cooldownMs > 0
                ? `Gate resetting (${Math.ceil(world.northGate.cooldownMs / 1000)}s)`
                : `[${interactKeyLabel}] Start ${world.gameMode === "boss_rush" ? `Trial ${world.wave + 1}` : `Wave ${world.wave + 1}`}`}
          </div>
        )}

        {localPlayer && !localPlayer.alive && !spectating && (
          <div className="respawn-banner">
            <h2>FALLEN</h2>
            <p>{`Returning in ${localPlayer.respawnTimer || 1}s`}</p>
          </div>
        )}
      </div>

      {spectating && (
        <div className="spectate-overlay" aria-label="Spectator controls">
          <button type="button" aria-label="Previous gladiator" onClick={() => onCycleSpectator(-1)}>
            ‹
          </button>
          <span className="spectate-status">FALLEN ·</span>
          <span>{spectatedPlayer ? spectatedPlayer.name : "Spectating"}</span>
          <button type="button" aria-label="Next gladiator" onClick={() => onCycleSpectator(1)}>
            ›
          </button>
        </div>
      )}

      {/* Mobile Touch Controls */}
      {showTouch && localPlayer?.alive && (activeOverlay === "none" || activeOverlay === "touch_layout") && (
        <TouchControls
          nearLever={nearLever}
          waveActive={world.waveActive}
          nextWave={world.wave + 1}
          gameMode={world.gameMode}
          isBlocking={localPlayer.isBlocking}
          isLocked={Boolean(lockedEnemy)}
          gateCooldownMs={world.northGate.cooldownMs}
          combatArtCdMs={localPlayer.combatArtCooldownMs}
          combatArtShortName={selectedArt.shortName}
          abilityCdMs={localPlayer.abilityCooldownMs}
          abilityShortLabel={abilitySpec.shortLabel}
          onCastCombatArt={triggerSelectedArt}
          hasItem={hasItem}
          editingLayout={editingTouchLayout}
          onFinishEditLayout={closeOverlay}
        />
      )}

      {/* Bottom-Left: Minimal Sekiro-Style Vitality & Posture */}
      {localPlayer && (
        <div className="hud-bottom-left-wrap">
          {activeBuffs.length > 0 && (
            <div className="active-buffs-row">
              {activeBuffs.map((buff) => (
                <div
                  key={buff.id}
                  className="buff-chip"
                  style={{ "--buff-color": buff.color } as CSSProperties}
                >
                  <span className="buff-chip-dot" />
                  <span className="buff-chip-label">{buff.label}</span>
                  <span className="buff-chip-time">{(buff.remainingMs / 1000).toFixed(1)}s</span>
                </div>
              ))}
            </div>
          )}

          <div className="player-vitals">
            {showTouch && onSelectAbility && (
              <div style={{ display: "flex", justifyContent: "center", marginBottom: 4, pointerEvents: "auto" }}>
                <button
                  type="button"
                  className="hud-pill-btn"
                  style={{ height: 24, padding: "0 10px", fontSize: 10 }}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    const order: PlayerAbilityKind[] = ["fireball", "arcane_spell", "stun_gun"];
                    onSelectAbility(order[(order.indexOf(selectedAbility) + 1) % order.length]);
                  }}
                >
                  <span style={{ color: abilitySpec.color }}>
                    {selectedAbility === "fireball" ? "🜂" : selectedAbility === "arcane_spell" ? "❄" : "⚡"}
                  </span>
                  <span>{abilitySpec.shortLabel} ↻</span>
                </button>
              </div>
            )}
            <div className="vital-meta-row">
              <span className="vital-name">{localPlayer.name}</span>
              <span className="vital-status">
                {localPlayer.infiniteHealth
                  ? "∞ HP"
                  : localPlayer.action === "staggered"
                    ? "STAGGERED"
                    : localPlayer.isBlocking
                      ? "GUARD"
                      : `${localPlayer.hp}`}
              </span>
            </div>
            <div className="vital-track player-hp-track">
              <div className="vital-fill hp-fill" style={{ width: `${hpPct}%` }} />
            </div>
            <div className={`vital-track player-posture-track ${posturePct >= 80 ? "posture-danger" : ""}`}>
              <div className="vital-fill posture-fill" style={{ width: `${posturePct}%` }} />
            </div>
            {(localPlayer.isFlying || localPlayer.flightFuelMs < FLIGHT.MAX_FUEL_MS) && (
              <div className="vital-track" style={{ height: 3, marginTop: 3, background: "rgba(15,23,42,0.75)" }}>
                <div
                  className="vital-fill"
                  style={{
                    width: `${(localPlayer.flightFuelMs / FLIGHT.MAX_FUEL_MS) * 100}%`,
                    background: "#38bdf8",
                  }}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Bottom-Center: Minimal Combat Action Bar (Desktop only — Phones use PSP controls) */}
      {localPlayer && !showTouch && (
        <div
          className={`hud-action-bar-wrap ${!localPlayer.alive ? "is-dead" : ""}`}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {localPlayer.alive && localPlayer.counterReadyMs > 0 && (
            <div className="riposte-pill">RIPOSTE</div>
          )}

          <div className="hud-action-bar">
            <div className="action-group action-specials">
              <button
                type="button"
                className="action-slot ready"
                style={{ "--slot-accent": "#fb923c", touchAction: "none" } as CSSProperties}
                title={`[${punchKeyLabel}] Punch / Launch`}
                disabled={!localPlayer.alive}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onPunch?.();
                }}
              >
                <span className="slot-key">{punchKeyLabel}</span>
                <span className="slot-icon" style={{ color: "#fb923c" }}>✊</span>
                <span className="slot-label">PUNCH</span>
              </button>
            </div>

            <div className="action-group action-skill">
              <button
                type="button"
                className={`action-slot combat-art-slot ${localPlayer.combatArtCooldownMs > 0 ? "on-cooldown" : "ready"}`}
                style={{ "--slot-accent": selectedArt.accentColor, touchAction: "none" } as CSSProperties}
                title={`[${artKeyLabel}] ${selectedArt.name}`}
                disabled={!localPlayer.alive || localPlayer.combatArtCooldownMs > 0}
                onMouseDown={(event) => event.stopPropagation()}
                onTouchStart={(event) => {
                  event.stopPropagation();
                  lastTouchAtRef.current = performance.now();
                  triggerSelectedArt();
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  if (performance.now() - lastTouchAtRef.current < 450) return;
                  triggerSelectedArt();
                }}
              >
                <span className="slot-key">{artKeyLabel}</span>
                <span className="slot-icon" style={{ color: selectedArt.accentColor }}>
                  {selectedArt.icon}
                </span>
                <span className="slot-label">{selectedArt.shortName}</span>
                {localPlayer.combatArtCooldownMs > 0 && (
                  <span className="action-cd-text">
                    {(localPlayer.combatArtCooldownMs / 1000).toFixed(1)}
                  </span>
                )}
              </button>

              {/* Ranged Spell / Fireball / Stun Gun Slot */}
              <button
                type="button"
                className={`action-slot ${localPlayer.abilityCooldownMs > 0 ? "on-cooldown" : "ready"}`}
                style={{ "--slot-accent": abilitySpec.color, touchAction: "none" } as CSSProperties}
                title={`[${abilityKeyLabel}] ${abilitySpec.name} ([${formatKeyCode(controls.bindings.cycleAbility)}] cycle)`}
                disabled={!localPlayer.alive || localPlayer.abilityCooldownMs > 0}
                onMouseDown={(e) => e.stopPropagation()}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (onSelectAbility) {
                    const order: PlayerAbilityKind[] = ["fireball", "arcane_spell", "stun_gun"];
                    onSelectAbility(order[(order.indexOf(selectedAbility) + 1) % order.length]);
                  }
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  onCastAbility?.();
                }}
              >
                <span className="slot-key">{abilityKeyLabel}</span>
                <span className="slot-icon" style={{ color: abilitySpec.color }}>
                  {selectedAbility === "fireball" ? "🜂" : selectedAbility === "arcane_spell" ? "❄" : "⚡"}
                </span>
                <span className="slot-label">{abilitySpec.shortLabel}</span>
                {localPlayer.abilityCooldownMs > 0 && (
                  <span className="action-cd-text">{(localPlayer.abilityCooldownMs / 1000).toFixed(1)}</span>
                )}
              </button>
            </div>

            <div className="action-divider" aria-hidden="true" />

            <div className="action-group action-belt">
              {localPlayer.belt.map((slot, idx) => {
                const keyLabel = beltKeys[idx] ?? String(idx + 4);
                const spec = slot.kind && slot.charges > 0 ? POWER_UPS[slot.kind] : null;
                return (
                  <button
                    key={idx}
                    type="button"
                    className={`action-slot belt-slot ${spec ? "filled" : "empty"}`}
                    style={
                      spec
                        ? ({
                            "--slot-accent": spec.color,
                            touchAction: "none",
                          } as CSSProperties)
                        : { touchAction: "none" }
                    }
                    title={spec ? `[${keyLabel}] ${spec.label}` : `[${keyLabel}] Empty`}
                    disabled={!localPlayer.alive || !spec}
                    onMouseDown={(e) => e.stopPropagation()}
                    onTouchStart={(e) => {
                      e.stopPropagation();
                      lastTouchAtRef.current = performance.now();
                      if (spec) triggerBeltSlot(idx);
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (performance.now() - lastTouchAtRef.current < 450) return;
                      if (spec) triggerBeltSlot(idx);
                    }}
                  >
                    <span className="slot-key">{keyLabel}</span>
                    {spec ? (
                      <>
                        <span className="slot-icon" style={{ color: spec.color }}>
                          {POWERUP_ICONS[spec.kind]}
                        </span>
                        <span className="slot-label">{spec.shortLabel}</span>
                        {(spec.charges > 1 || slot.charges > 1) && (
                          <span className="belt-charges">×{slot.charges}</span>
                        )}
                      </>
                    ) : (
                      <span className="belt-empty-dot" aria-hidden="true" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* 3v3 Mode Switcher, Team Roster, Scoreboard & Banners */}
      <Team3v3Panel
        sessionId={sessionId}
        world={world}
        onSetGameMode={onSetGameMode}
        onJoinTeam={onJoinTeam}
        onSetFillBots={onSetFillBots}
        onStartMatch={onStartTeamMatch}
        onRematch={onRematchTeam}
        onStartFfa={onStartFfa}
        isTouchPhone={showTouch}
        hiddenByOverlay={hasActiveOverlay}
        onOpenArenaRules={() => openSetup("arena")}
      />

      {/* Modals & Drawers */}
      <PreWaveSetup
        key={setupInitialTab}
        open={setupOpen}
        onClose={closeOverlay}
        world={world}
        sessionId={sessionId}
        onSelectSkin={onSelectSkin}
        onSelectArt={onSelectArt}
        onSetRespawnMode={onSetRespawnMode}
        onSetArenaMap={onSetArenaMap}
        onSetGameMode={onSetGameMode}
        initialTab={setupInitialTab}
      />

      <PartyChat
        messages={chatMessages}
        sessionId={sessionId}
        showTouch={showTouch}
        forceClosed={hasActiveOverlay}
        onSend={onSendChat}
      />

      <GameMenuModal
        open={menuOpen}
        onClose={closeOverlay}
        sessionId={sessionId}
        world={world}
        graphicsQuality={graphicsQuality}
        onSetGraphicsQuality={onSetGraphicsQuality}
        pingMs={pingMs}
        perf={perf}
        selectedArtName={selectedArt.name}
        muted={muted}
        onToggleMute={toggleMute}
        showTouch={showTouch}
        onToggleTouch={() => setShowTouch((v) => !v)}
        onCustomizeTouchLayout={() => setActiveOverlay("touch_layout")}
        showPerf={showPerf}
        onTogglePerf={() => setShowPerf((v) => !v)}
        onOpenSetup={() => openSetup("loadout")}
        onSelectArt={onSelectArt}
        onSetArenaMap={onSetArenaMap}
        onSetRespawnMode={onSetRespawnMode}
        onSetGameMode={onSetGameMode}
        onToggleInfiniteHealth={onToggleInfiniteHealth}
        onLeave={onLeave}
      />
    </div>
  );
}
