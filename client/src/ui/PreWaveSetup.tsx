import { useState, type CSSProperties } from "react";
import {
  ARENA_MAPS,
  PLAYER_SKINS,
  type ArenaMapKind,
  type CombatArtKind,
  type GameMode,
  type PlayerSkinKind,
  type RespawnMode,
} from "@sekiroslop/shared";
import {
  EXPERIMENTAL_ARTS,
  EXPERIMENTAL_ART_ORDER,
} from "../experimental/special-moves";
import type { RoomWorldSnapshot } from "../net/useColosseumRoom";

interface PreWaveSetupProps {
  open: boolean;
  onClose: () => void;
  world: RoomWorldSnapshot;
  sessionId: string;
  onSelectSkin: (skin: PlayerSkinKind) => void;
  onSelectArt: (art: CombatArtKind) => void;
  onSetRespawnMode: (mode: RespawnMode) => void;
  onSetArenaMap: (map: ArenaMapKind) => void;
  onSetGameMode?: (mode: GameMode) => void;
  initialTab?: "loadout" | "arena";
}

const SKIN_ORDER: readonly PlayerSkinKind[] = [
  "knight",
  "shadow_shinobi",
  "ashina_ronin",
  "golden_champion",
  "arcane_battlemage",
  "cyber_valkyrie",
];

type SetupTab = "loadout" | "arena";

export function PreWaveSetup({
  open,
  onClose,
  world,
  sessionId,
  onSelectSkin,
  onSelectArt,
  onSetRespawnMode,
  onSetArenaMap,
  onSetGameMode,
  initialTab,
}: PreWaveSetupProps) {
  const [tab, setTab] = useState<SetupTab>(initialTab ?? "loadout");

  if (!open) return null;

  const player = world.players.find((candidate) => candidate.id === sessionId);
  if (!player) return null;
  const isHost = world.hostSessionId === sessionId;

  return (
    <div
      className="ui-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Pre-wave setup"
      onMouseDown={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) onClose();
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <section className="prewave-setup" onMouseDown={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
        <header className="prewave-setup-header">
          <div>
            <h2>Prepare Loadout</h2>
            <span className="menu-subtitle">
              Room {world.roomCode} · {ARENA_MAPS[world.arenaMap]?.name ?? "Sunlit Colosseum"}
            </span>
          </div>
          <button
            type="button"
            className="icon-close-btn"
            onClick={onClose}
            aria-label="Close setup"
          >
            ✕
          </button>
        </header>

        <nav className="menu-tabs" role="tablist" aria-label="Setup sections">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "loadout"}
            className={`menu-tab ${tab === "loadout" ? "active" : ""}`}
            onClick={() => setTab("loadout")}
          >
            Loadout
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "arena"}
            className={`menu-tab ${tab === "arena" ? "active" : ""}`}
            onClick={() => setTab("arena")}
          >
            Arena &amp; Rules
          </button>
        </nav>

        <div className="prewave-setup-content">
          {tab === "loadout" ? (
            <>
              <section className="prewave-section">
                <div className="prewave-section-heading">
                  <h3>Armor</h3>
                </div>
                <div className="prewave-skin-grid">
                  {SKIN_ORDER.map((kind) => {
                    const skin = PLAYER_SKINS[kind];
                    const selected = player.skin === kind;
                    return (
                      <button
                        key={kind}
                        type="button"
                        className={`prewave-skin-option ${selected ? "selected" : ""}`}
                        style={{ "--skin-primary": skin.primary, "--skin-accent": skin.accent } as CSSProperties}
                        aria-pressed={selected}
                        onClick={() => onSelectSkin(kind)}
                      >
                        <span className="prewave-skin-swatch" />
                        <span className="prewave-option-name">{skin.name}</span>
                        <span className="prewave-option-description">{skin.description}</span>
                      </button>
                    );
                  })}
                </div>
              </section>

              <section className="prewave-section">
                <div className="prewave-section-heading">
                  <h3>Combat Art</h3>
                  <span>Cast with [V]</span>
                </div>
                <div className="prewave-art-grid">
                  {EXPERIMENTAL_ART_ORDER.map((kind) => {
                    const art = EXPERIMENTAL_ARTS[kind];
                    const selected = player.selectedArt === kind;
                    return (
                      <button
                        key={kind}
                        type="button"
                        className={`prewave-art-option ${selected ? "selected" : ""}`}
                        style={{ "--art-color": art.accentColor } as CSSProperties}
                        aria-pressed={selected}
                        onClick={() => onSelectArt(kind)}
                      >
                        <span className="prewave-art-icon">{art.icon}</span>
                        <span className="prewave-option-name">{art.name}</span>
                        <span className="prewave-art-tree">{art.tree}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            </>
          ) : (
            <>
              {onSetGameMode && (
                <section className="prewave-section">
                  <div className="prewave-section-heading">
                    <h3>Game Mode</h3>
                    <span>{isHost ? "Host selects" : "Set by host"}</span>
                  </div>
                  <div className="prewave-mode-options">
                    {(
                      [
                        ["waves", "Endless Waves", "Cooperative Colosseum waves & bosses."],
                        ["boss_rush", "Boss Rush", "Consecutive mythic boss trials."],
                        ["team_3v3", "3v3 Team Battle", "Red vs Blue team gladiator rounds."],
                        ["ffa", "Mythic FFA", "Free-for-all arena & sacred overdrive ring."],
                      ] as const
                    ).map(([m, title, desc]) => (
                      <button
                        key={m}
                        type="button"
                        className={world.gameMode === m ? "selected" : ""}
                        aria-pressed={world.gameMode === m}
                        disabled={!isHost}
                        onClick={() => isHost && onSetGameMode(m)}
                      >
                        <b>{title}</b>
                        <span>{desc}</span>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              <section className="prewave-section">
                <div className="prewave-section-heading">
                  <h3>Battlefield</h3>
                  <span>{isHost ? "Host selects" : "Set by host"}</span>
                </div>
                <div className="prewave-map-grid">
                  {(Object.entries(ARENA_MAPS) as [ArenaMapKind, (typeof ARENA_MAPS)[ArenaMapKind]][]).map(
                    ([kind, map]) => (
                      <button
                        key={kind}
                        type="button"
                        className={`prewave-map-option ${world.arenaMap === kind ? "selected" : ""}`}
                        style={{ "--map-accent": map.accent, "--map-sky": map.sky } as CSSProperties}
                        aria-pressed={world.arenaMap === kind}
                        disabled={!isHost}
                        onClick={() => onSetArenaMap(kind)}
                      >
                        <span className={`prewave-map-preview preview-${kind}`} aria-hidden="true" />
                        <span className="prewave-option-name">{map.name}</span>
                        <span className="prewave-option-description">{map.description}</span>
                      </button>
                    )
                  )}
                </div>
              </section>

              <section className="prewave-section">
                <div className="prewave-section-heading">
                  <h3>Respawn Rules</h3>
                  <span>{world.respawnMode === "infinite" ? "Infinite" : "Revive on Clear"}</span>
                </div>
                {isHost ? (
                  <div className="prewave-mode-options">
                    <button
                      type="button"
                      className={world.respawnMode === "infinite" ? "selected" : ""}
                      aria-pressed={world.respawnMode === "infinite"}
                      onClick={() => onSetRespawnMode("infinite")}
                    >
                      <b>Infinite respawns</b>
                      <span>Revive after a short delay during a wave.</span>
                    </button>
                    <button
                      type="button"
                      className={world.respawnMode === "wave_end" ? "selected" : ""}
                      aria-pressed={world.respawnMode === "wave_end"}
                      onClick={() => onSetRespawnMode("wave_end")}
                    >
                      <b>Revive after wave clear</b>
                      <span>Spectate teammates until the wave ends.</span>
                    </button>
                  </div>
                ) : (
                  <p className="prewave-host-note">
                    Host ({world.players.find((p) => p.id === world.hostSessionId)?.name ?? "—"}) controls respawn rules.
                  </p>
                )}
              </section>
            </>
          )}
        </div>

        <footer className="prewave-setup-footer">
          <span>Pull the north gate lever [F] to start Wave 1.</span>
          <button type="button" className="btn-primary-minimal" onClick={onClose}>
            Done
          </button>
        </footer>
      </section>
    </div>
  );
}
