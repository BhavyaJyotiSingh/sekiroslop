import { useEffect, useState } from "react";
import {
  ARENA_MAPS,
  PLAYER_PALETTES,
  PLAYER_SKINS,
  type ArenaMapKind,
  type CombatArtKind,
  type GameMode,
  type RespawnMode,
} from "@sekiroslop/shared";
import {
  EXPERIMENTAL_ARTS,
  EXPERIMENTAL_ART_ORDER,
} from "../experimental/special-moves";
import type { RoomWorldSnapshot } from "../net/useColosseumRoom";
import type { PerfStats } from "../scene/ColosseumScene";
import { soundEngine } from "../audio/SoundEngine";
import { isTouchDevice } from "../input/touchInput";
import { isMobileFullscreenSupported, requestMobileFullscreenLandscape } from "../input/mobileDisplay";
import { resetTouchLayoutToDefault } from "../input/touchLayoutConfig";
import type { GraphicsQualityPreset } from "../lib/graphicsQuality";
import {
  KEY_ACTION_LABELS,
  formatKeyCode,
  resetControlsToDefault,
  setAutoLockOnAttack,
  setKeyBinding,
  setMouseSensitivity,
  useControlsConfig,
  type KeyActionId,
} from "../input/controlsConfig";

interface GameMenuModalProps {
  open: boolean;
  onClose: () => void;
  sessionId: string;
  world: RoomWorldSnapshot;
  graphicsQuality: GraphicsQualityPreset;
  onSetGraphicsQuality: (preset: GraphicsQualityPreset) => void;
  pingMs: number | null;
  perf: PerfStats;
  selectedArtName: string;
  muted: boolean;
  onToggleMute: () => void;
  showTouch: boolean;
  onToggleTouch: () => void;
  onCustomizeTouchLayout?: () => void;
  showPerf: boolean;
  onTogglePerf: () => void;
  onOpenSetup: () => void;
  onSelectArt: (art: CombatArtKind) => void;
  onSetArenaMap: (map: ArenaMapKind) => void;
  onSetRespawnMode: (mode: RespawnMode) => void;
  onSetGameMode: (mode: GameMode) => void;
  onToggleInfiniteHealth?: (enabled: boolean) => void;
  onLeave: () => void;
}

type MenuTab = "match" | "settings" | "controls";

export function GameMenuModal({
  open,
  onClose,
  sessionId,
  world,
  graphicsQuality,
  onSetGraphicsQuality,
  pingMs,
  perf,
  selectedArtName,
  muted,
  onToggleMute,
  showTouch,
  onToggleTouch,
  onCustomizeTouchLayout,
  showPerf,
  onTogglePerf,
  onOpenSetup,
  onSelectArt,
  onSetArenaMap,
  onSetRespawnMode,
  onSetGameMode,
  onToggleInfiniteHealth,
  onLeave,
}: GameMenuModalProps) {
  const [tab, setTab] = useState<MenuTab>("match");
  const [copied, setCopied] = useState(false);
  const [listeningAction, setListeningAction] = useState<KeyActionId | null>(null);
  const [masterVol, setMasterVol] = useState(() => soundEngine.getMasterVolume());
  const [footstepVol, setFootstepVol] = useState(() => soundEngine.getFootstepVolume());
  const controls = useControlsConfig();

  useEffect(() => {
    if (!open) {
      setListeningAction(null);
      return;
    }
    if (document.pointerLockElement) {
      document.exitPointerLock();
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (listeningAction) {
        e.preventDefault();
        e.stopPropagation();
        if (e.code === "Escape") {
          setListeningAction(null);
          return;
        }
        if (e.code !== "KeyM" && e.code !== "KeyP") {
          setKeyBinding(listeningAction, e.code);
        }
        setListeningAction(null);
        return;
      }

      if (e.code === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, onClose, listeningAction]);

  if (!open) return null;

  const copyCode = async () => {
    if (!world.roomCode) return;
    try {
      await navigator.clipboard.writeText(world.roomCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable in insecure contexts
    }
  };

  const isPhone = isTouchDevice();
  const pingTone =
    pingMs === null ? "unknown" : pingMs > 180 ? "high" : pingMs > 90 ? "medium" : "good";
  const maxPlayers = world.gameMode === "team_3v3" ? 6 : 4;
  const combatActions = KEY_ACTION_LABELS.filter((a) => a.group === "combat");
  const movementActions = KEY_ACTION_LABELS.filter((a) => a.group === "movement");

  return (
    <div
      className="ui-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Game Menu"
      onMouseDown={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) onClose();
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="menu-modal" onMouseDown={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
        <header className="menu-header">
          <div className="menu-title-group">
            <h2>Menu</h2>
            <span className="menu-subtitle">SekiroSlop</span>
          </div>
          <button
            type="button"
            className="icon-close-btn"
            onClick={onClose}
            aria-label="Close menu"
          >
            ✕
          </button>
        </header>

        <nav className="menu-tabs" role="tablist" aria-label="Menu sections">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "match"}
            className={`menu-tab ${tab === "match" ? "active" : ""}`}
            onClick={() => {
              setListeningAction(null);
              setTab("match");
            }}
          >
            Match
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "settings"}
            className={`menu-tab ${tab === "settings" ? "active" : ""}`}
            onClick={() => {
              setListeningAction(null);
              setTab("settings");
            }}
          >
            Settings
          </button>
          {!isPhone && (
            <button
              type="button"
              role="tab"
              aria-selected={tab === "controls"}
              className={`menu-tab ${tab === "controls" ? "active" : ""}`}
              onClick={() => setTab("controls")}
            >
              Controls
            </button>
          )}
        </nav>

        <div className="menu-body">
          {tab === "match" && (
            <div className="menu-section-stack">
              <div className="menu-room-bar">
                <div className="menu-room-meta">
                  <span className="menu-label">Room Code</span>
                  <strong className="menu-room-code">{world.roomCode || "----"}</strong>
                </div>
                <button type="button" className="btn-ghost" onClick={copyCode}>
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>

              {!isPhone && (
                <div className="menu-stats-grid">
                <div className="menu-stat-cell">
                  <span className="menu-label">
                    {world.gameMode === "team_3v3" ? "Round" : "Wave"}
                  </span>
                  <strong>
                    {world.gameMode === "team_3v3"
                      ? `${world.teamRound}/${world.teamMaxRounds}`
                      : world.wave}
                  </strong>
                </div>
                <div className="menu-stat-cell">
                  <span className="menu-label">Slain</span>
                  <strong>{world.skeletonsDefeated}</strong>
                </div>
                <div className="menu-stat-cell">
                  <span className="menu-label">Ping</span>
                  <strong className={`ping-text ${pingTone}`}>
                    {pingMs === null ? "--" : `${pingMs}ms`}
                  </strong>
                </div>
                <div className="menu-stat-cell">
                  <span className="menu-label">Mode</span>
                  <strong>{world.gameMode === "team_3v3" ? "3v3" : "Waves"}</strong>
                </div>
              </div>
              )}

              <div className="menu-roster">
                <div className="menu-section-title">
                  <span>Gladiators</span>
                  <span>
                    {world.players.length} / {maxPlayers}
                  </span>
                </div>
                <div className="menu-roster-list">
                  {world.players.map((p) => {
                    const palette =
                      p.skin === "knight"
                        ? PLAYER_PALETTES[p.slot % PLAYER_PALETTES.length]
                        : PLAYER_SKINS[p.skin] ?? PLAYER_PALETTES[p.slot % PLAYER_PALETTES.length];
                    const pPingTone =
                      p.pingMs === null
                        ? "unknown"
                        : p.pingMs > 180
                          ? "high"
                          : p.pingMs > 90
                            ? "medium"
                            : "good";
                    return (
                      <div
                        key={p.id}
                        className={`menu-roster-row ${p.id === sessionId ? "is-self" : ""}`}
                      >
                        <span className="roster-dot" style={{ background: palette.plume }} />
                        <span className="roster-name">
                          {p.name}
                          {p.id === sessionId && <em className="roster-you">You</em>}
                        </span>
                        <div className="roster-hp-track">
                          <div
                            className="roster-hp-fill"
                            style={{ width: `${(p.hp / Math.max(1, p.maxHp)) * 100}%` }}
                          />
                        </div>
                        <span className={`roster-ping ping-text ${pPingTone}`}>
                          {p.pingMs === null ? "--" : `${p.pingMs}ms`}
                        </span>
                        <span className="roster-kills">{p.kills}K</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {world.players.length === 1 && onToggleInfiniteHealth && (
                <div className="setting-row">
                  <div className="setting-copy">
                    <strong>Solo Testing: Infinite Health</strong>
                    <span>Prevent HP loss while testing solo (auto-disabled if others join)</span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={Boolean(world.players[0]?.infiniteHealth)}
                    className={`switch-pill ${world.players[0]?.infiniteHealth ? "on" : ""}`}
                    onClick={() => onToggleInfiniteHealth(!world.players[0]?.infiniteHealth)}
                  >
                    <span>{world.players[0]?.infiniteHealth ? "On" : "Off"}</span>
                  </button>
                </div>
              )}

              <div className="menu-section-stack" style={{ gap: "0.55rem" }}>
                <div className="setting-row">
                  <div className="setting-copy">
                    <strong>Combat Art</strong>
                    <span>Equip your Sekiro Combat Art</span>
                  </div>
                  <select
                    aria-label="Combat Art"
                    value={world.players.find((p) => p.id === sessionId)?.selectedArt ?? "ashina_cross"}
                    onChange={(e) => onSelectArt(e.target.value as CombatArtKind)}
                    style={{
                      background: "rgba(15, 23, 42, 0.9)",
                      color: "#f8fafc",
                      border: "1px solid rgba(148, 163, 184, 0.35)",
                      borderRadius: "6px",
                      padding: "0.35rem 0.55rem",
                    }}
                  >
                    {EXPERIMENTAL_ART_ORDER.map((artId) => (
                      <option key={artId} value={artId}>
                        {EXPERIMENTAL_ARTS[artId].name}
                      </option>
                    ))}
                  </select>
                </div>

                {world.hostSessionId === sessionId && (
                  <>
                    <div className="setting-row">
                      <div className="setting-copy">
                        <strong>Game Mode</strong>
                        <span>Host: switch mode anytime</span>
                      </div>
                      <select
                        aria-label="Game Mode"
                        value={world.gameMode}
                        onChange={(e) => onSetGameMode(e.target.value as GameMode)}
                        style={{
                          background: "rgba(15, 23, 42, 0.9)",
                          color: "#f8fafc",
                          border: "1px solid rgba(148, 163, 184, 0.35)",
                          borderRadius: "6px",
                          padding: "0.35rem 0.55rem",
                        }}
                      >
                        <option value="waves">Endless Waves</option>
                        <option value="boss_rush">Boss Rush</option>
                        <option value="team_3v3">3v3 Team Battle</option>
                        <option value="ffa">Mythic FFA</option>
                      </select>
                    </div>

                    <div className="setting-row">
                      <div className="setting-copy">
                        <strong>Arena Map</strong>
                        <span>Host: switch arena anytime</span>
                      </div>
                      <select
                        aria-label="Arena Map"
                        value={world.arenaMap}
                        onChange={(e) => onSetArenaMap(e.target.value as ArenaMapKind)}
                        style={{
                          background: "rgba(15, 23, 42, 0.9)",
                          color: "#f8fafc",
                          border: "1px solid rgba(148, 163, 184, 0.35)",
                          borderRadius: "6px",
                          padding: "0.35rem 0.55rem",
                        }}
                      >
                        {(Object.keys(ARENA_MAPS) as ArenaMapKind[]).map((mk) => (
                          <option key={mk} value={mk}>
                            {ARENA_MAPS[mk].name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="setting-row">
                      <div className="setting-copy">
                        <strong>Match Rules (Respawn)</strong>
                        <span>Host: set respawn rule anytime</span>
                      </div>
                      <select
                        aria-label="Respawn Rules"
                        value={world.respawnMode}
                        onChange={(e) => onSetRespawnMode(e.target.value as RespawnMode)}
                        style={{
                          background: "rgba(15, 23, 42, 0.9)",
                          color: "#f8fafc",
                          border: "1px solid rgba(148, 163, 184, 0.35)",
                          borderRadius: "6px",
                          padding: "0.35rem 0.55rem",
                        }}
                      >
                        <option value="infinite">Infinite Respawns</option>
                        <option value="wave_end">Respawn Between Waves</option>
                      </select>
                    </div>
                  </>
                )}

                <button
                  type="button"
                  className="btn-outline-full"
                  onClick={() => onOpenSetup()}
                >
                  Open Loadout &amp; Arena Setup
                </button>
              </div>
            </div>
          )}

          {tab === "settings" && (
            <div className="menu-settings-list">
              <div className="setting-row">
                <div className="setting-copy">
                  <strong>Graphics</strong>
                  <span>Auto adjusts quality for this device</span>
                </div>
                <select
                  className="setting-select"
                  aria-label="Graphics quality"
                  value={graphicsQuality}
                  onChange={(event) => onSetGraphicsQuality(event.target.value as GraphicsQualityPreset)}
                >
                  <option value="auto">Auto</option>
                  <option value="low">Low</option>
                  <option value="medium">Med</option>
                  <option value="high">High</option>
                </select>
              </div>

              <div className="setting-row">
                <div className="setting-copy">
                  <strong>Frame rate</strong>
                  <span>Current render rate</span>
                </div>
                <strong className="sensitivity-readout" aria-live="polite">
                  {perf.fps > 0 ? `${perf.fps} FPS` : "Measuring…"}
                </strong>
              </div>

              <div className="setting-row setting-slider-row">
                <div className="setting-slider-head">
                  <div className="setting-copy">
                    <strong>{isPhone ? "Look Sensitivity" : "Mouse Sensitivity"}</strong>
                    <span>{isPhone ? "Touch camera drag speed" : "Camera look & Sekiro target-shift sensitivity"}</span>
                  </div>
                  <strong className="sensitivity-readout">
                    {controls.mouseSensitivity.toFixed(2)}×
                  </strong>
                </div>
                <input
                  type="range"
                  className="minimal-slider"
                  min={0.25}
                  max={2.5}
                  step={0.05}
                  value={controls.mouseSensitivity}
                  aria-label="Mouse sensitivity"
                  onChange={(e) => setMouseSensitivity(Number(e.target.value))}
                />
              </div>

              <div className="setting-row">
                <div className="setting-copy">
                  <strong>Audio</strong>
                  <span>Mute or unmute all game sound</span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={!muted}
                  className={`toggle-pill ${!muted ? "on" : ""}`}
                  onClick={onToggleMute}
                >
                  <span className="toggle-knob" />
                </button>
              </div>

              <div className="setting-row setting-slider-row">
                <div className="setting-slider-head">
                  <div className="setting-copy">
                    <strong>Game Volume</strong>
                    <span>Overall volume for combat, voices &amp; arena cues</span>
                  </div>
                  <strong className="sensitivity-readout">
                    {Math.round(masterVol * 100)}%
                  </strong>
                </div>
                <input
                  type="range"
                  className="minimal-slider"
                  min={0}
                  max={1}
                  step={0.05}
                  value={masterVol}
                  aria-label="Game volume"
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    setMasterVol(next);
                    soundEngine.setMasterVolume(next);
                  }}
                />
              </div>

              <div className="setting-row setting-slider-row">
                <div className="setting-slider-head">
                  <div className="setting-copy">
                    <strong>Footstep Volume</strong>
                    <span>Running footstep volume</span>
                  </div>
                  <strong className="sensitivity-readout">
                    {Math.round(footstepVol * 100)}%
                  </strong>
                </div>
                <input
                  type="range"
                  className="minimal-slider"
                  min={0}
                  max={1}
                  step={0.05}
                  value={footstepVol}
                  aria-label="Footstep volume"
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    setFootstepVol(next);
                    soundEngine.setFootstepVolume(next);
                  }}
                />
              </div>

              <div className="setting-row">
                <div className="setting-copy">
                  <strong>Auto-Lock on Attack</strong>
                  <span>Automatically lock onto the nearest foe when attacking (PC &amp; Mobile)</span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={controls.autoLockOnAttack}
                  className={`toggle-pill ${controls.autoLockOnAttack ? "on" : ""}`}
                  onClick={() => setAutoLockOnAttack(!controls.autoLockOnAttack)}
                >
                  <span className="toggle-knob" />
                </button>
              </div>

              {showTouch && onCustomizeTouchLayout && (
                <>
                  <div className="setting-row">
                    <div className="setting-copy">
                      <strong>Button Layout</strong>
                      <span>Drag, resize &amp; set opacity on touch buttons</span>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button type="button" className="btn-ghost btn-compact" onClick={resetTouchLayoutToDefault}>
                        Reset
                      </button>
                      <button type="button" className="btn-primary-minimal btn-compact" onClick={onCustomizeTouchLayout}>
                        Customize
                      </button>
                    </div>
                  </div>
                </>
              )}

              {isPhone && isMobileFullscreenSupported() && (
                <div className="setting-row">
                  <div className="setting-copy">
                    <strong>Fullscreen Landscape</strong>
                    <span>Enter browser fullscreen mode for mobile play</span>
                  </div>
                  <button
                    type="button"
                    className="btn-ghost btn-compact"
                    onClick={requestMobileFullscreenLandscape}
                  >
                    Fullscreen
                  </button>
                </div>
              )}

              {!isPhone && (
                <>
                  <div className="setting-row">
                    <div className="setting-copy">
                      <strong>Touch Controls</strong>
                      <span>On-screen gamepad (tap enemies directly to lock on)</span>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={showTouch}
                      className={`toggle-pill ${showTouch ? "on" : ""}`}
                      onClick={onToggleTouch}
                    >
                      <span className="toggle-knob" />
                    </button>
                  </div>

                  <div className="setting-row">
                    <div className="setting-copy">
                      <strong>Performance Overlay</strong>
                      <span>
                        Show FPS, draw calls &amp; triangles (shortcut: P)
                        {showPerf ? ` · ${perf.fps} FPS` : ""}
                      </span>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={showPerf}
                      className={`toggle-pill ${showPerf ? "on" : ""}`}
                      onClick={onTogglePerf}
                    >
                      <span className="toggle-knob" />
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {!isPhone && tab === "controls" && (
            <div className="menu-section-stack">
              <div className="controls-remap-bar">
                <span className="controls-hint-text">
                  Click any key to rebind · Flick mouse while locked to shift targets
                </span>
                <button
                  type="button"
                  className="btn-ghost btn-compact"
                  onClick={() => {
                    setListeningAction(null);
                    resetControlsToDefault();
                  }}
                >
                  Reset Defaults
                </button>
              </div>

              <div className="controls-grid">
                <div className="controls-group">
                  <span className="menu-label">Combat</span>
                  {combatActions.map((item) => {
                    const isListening = listeningAction === item.id;
                    const code = controls.bindings[item.id];
                    const label = item.id === "combatArt" ? selectedArtName : item.label;
                    return (
                      <div key={item.id} className="control-row">
                        <span>
                          {label}
                          {item.mouseHint && <em className="mouse-hint"> ({item.mouseHint})</em>}
                        </span>
                        <button
                          type="button"
                          className={`keybind-btn ${isListening ? "listening" : ""}`}
                          onClick={() =>
                            setListeningAction(isListening ? null : item.id)
                          }
                        >
                          {isListening ? "Press key…" : formatKeyCode(code)}
                        </button>
                      </div>
                    );
                  })}
                </div>

                <div className="controls-group">
                  <span className="menu-label">Movement &amp; Target</span>
                  {movementActions.map((item) => {
                    const isListening = listeningAction === item.id;
                    const code = controls.bindings[item.id];
                    return (
                      <div key={item.id} className="control-row">
                        <span>
                          {item.label}
                          {item.mouseHint && <em className="mouse-hint"> ({item.mouseHint})</em>}
                        </span>
                        <button
                          type="button"
                          className={`keybind-btn ${isListening ? "listening" : ""}`}
                          onClick={() =>
                            setListeningAction(isListening ? null : item.id)
                          }
                        >
                          {isListening ? "Press key…" : formatKeyCode(code)}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        <footer className="menu-footer">
          <button type="button" className="btn-danger-ghost" onClick={onLeave}>
            Leave Arena
          </button>
          <button type="button" className="btn-primary-minimal" onClick={onClose}>
            Resume
          </button>
        </footer>
      </div>
    </div>
  );
}
