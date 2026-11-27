import type { CSSProperties } from "react";
import type { GameMode, TeamSide } from "@sekiroslop/shared";
import type { RoomWorldSnapshot } from "../net/useColosseumRoom";

interface Team3v3PanelProps {
  sessionId: string;
  world: RoomWorldSnapshot;
  onSetGameMode: (mode: GameMode) => void;
  onJoinTeam: (team: TeamSide) => void;
  onSetFillBots: (enabled: boolean) => void;
  onStartMatch: () => void;
  onRematch: () => void;
  onStartFfa?: () => void;
  onOpenArenaRules?: () => void;
  isTouchPhone?: boolean;
  hiddenByOverlay?: boolean;
}

const RED_COLOR = "#ef4444";
const BLUE_COLOR = "#3b82f6";

export function Team3v3Panel({
  sessionId,
  world,
  onSetGameMode,
  onJoinTeam,
  onSetFillBots,
  onStartMatch,
  onRematch,
  onStartFfa,
  onOpenArenaRules,
  isTouchPhone = false,
  hiddenByOverlay = false,
}: Team3v3PanelProps) {
  if (hiddenByOverlay) return null;

  const isHost = Boolean(sessionId && world.hostSessionId === sessionId);
  const canSwitchMode =
    !isTouchPhone &&
    (isHost || (world.wave === 0 && !world.waveActive && !world.teamMatchActive && world.bossTrial === 0));
  const is3v3 = world.gameMode === "team_3v3";
  const isFfa = world.gameMode === "ffa";
  const isBossRush = world.gameMode === "boss_rush";
  const localPlayer = world.players.find((p) => p.id === sessionId);

  const redHumans = world.players.filter((p) => p.team === "red");
  const blueHumans = world.players.filter((p) => p.team === "blue");

  const redAlive =
    redHumans.filter((p) => p.alive).length +
    world.enemies.filter((e) => e.isBot && e.team === "red" && e.alive).length;
  const blueAlive =
    blueHumans.filter((p) => p.alive).length +
    world.enemies.filter((e) => e.isBot && e.team === "blue" && e.alive).length;

  const redTotal =
    redHumans.length + world.enemies.filter((e) => e.isBot && e.team === "red").length;
  const blueTotal =
    blueHumans.length + world.enemies.filter((e) => e.isBot && e.team === "blue").length;

  const pillContainer: CSSProperties = {
    position: "fixed",
    top: 66,
    left: 18,
    zIndex: 22,
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 6px",
    borderRadius: 999,
    background: "rgba(12, 12, 16, 0.72)",
    border: "1px solid rgba(255, 255, 255, 0.14)",
    backdropFilter: "blur(8px)",
    pointerEvents: "auto",
  };

  const modeBtn = (active: boolean): CSSProperties => ({
    padding: "4px 10px",
    borderRadius: 999,
    border: "none",
    cursor: isHost ? "pointer" : "default",
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    background: active ? "rgba(255, 255, 255, 0.92)" : "transparent",
    color: active ? "#111827" : "rgba(255, 255, 255, 0.72)",
    transition: "all 140ms ease",
  });

  const rosterCard: CSSProperties = {
    position: "fixed",
    top: isTouchPhone ? 46 : 112,
    left: isTouchPhone ? 12 : 18,
    zIndex: 22,
    width: isTouchPhone ? "min(300px, calc(100vw - 24px))" : 300,
    maxHeight: "calc(100dvh - 58px)",
    overflowY: "auto",
    touchAction: "pan-y",
    padding: "14px 16px",
    borderRadius: 12,
    background: "rgba(10, 11, 15, 0.84)",
    border: "1px solid rgba(255, 255, 255, 0.14)",
    backdropFilter: "blur(10px)",
    color: "#f8fafc",
    pointerEvents: "auto",
    boxShadow: "0 12px 32px rgba(0, 0, 0, 0.45)",
  };

  const teamCol: CSSProperties = {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: 6,
    padding: "8px 10px",
    borderRadius: 8,
    background: "rgba(255, 255, 255, 0.04)",
  };

  const scoreboardStyle: CSSProperties = {
    position: "fixed",
    top: 14,
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: 23,
    display: "flex",
    alignItems: "center",
    gap: 14,
    padding: "7px 18px",
    borderRadius: 999,
    background: "rgba(10, 11, 16, 0.82)",
    border: "1px solid rgba(255, 255, 255, 0.16)",
    backdropFilter: "blur(10px)",
    color: "#f8fafc",
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: "0.08em",
    pointerEvents: "none",
    boxShadow: "0 8px 24px rgba(0, 0, 0, 0.4)",
  };

  const renderSlotList = (team: TeamSide, humans: typeof redHumans) => {
    const color = team === "red" ? RED_COLOR : BLUE_COLOR;
    const slots = [0, 1, 2];
    return (
      <div style={{ ...teamCol, borderTop: `2px solid ${color}` }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: "0.1em",
            color,
            textTransform: "uppercase",
          }}
        >
          <span>{team === "red" ? "Red" : "Blue"}</span>
          <span>{humans.length}/3</span>
        </div>
        {slots.map((idx) => {
          const p = humans[idx];
          return (
            <div
              key={idx}
              style={{
                fontSize: 12,
                padding: "4px 6px",
                borderRadius: 5,
                background: p ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.02)",
                color: p ? "#f8fafc" : "rgba(255,255,255,0.42)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {p
                ? `${p.name}${p.id === sessionId ? " (You)" : ""}`
                : world.teamFillBots
                  ? "AI Gladiator"
                  : "Open Slot"}
            </div>
          );
        })}
        <button
          type="button"
          disabled={localPlayer?.team === team || humans.length >= 3}
          onClick={() => onJoinTeam(team)}
          style={{
            marginTop: 4,
            padding: "5px 8px",
            borderRadius: 6,
            border: `1px solid ${color}`,
            background:
              localPlayer?.team === team ? color : "rgba(255, 255, 255, 0.06)",
            color: "#ffffff",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            cursor:
              localPlayer?.team === team || humans.length >= 3 ? "default" : "pointer",
            opacity: localPlayer?.team !== team && humans.length >= 3 ? 0.45 : 1,
          }}
        >
          {localPlayer?.team === team ? "Joined" : `Join ${team}`}
        </button>
      </div>
    );
  };

  return (
    <>
      {/* Mode Switcher Pill (pre-wave / pre-match) */}
      {canSwitchMode && (
        <div
          style={pillContainer}
          onMouseDown={(e) => e.stopPropagation()}
          aria-label="Game mode switcher"
        >
          <button
            type="button"
            style={modeBtn(world.gameMode === "waves")}
            disabled={!isHost}
            onClick={() => isHost && onSetGameMode("waves")}
          >
            Waves
          </button>
          <button
            type="button"
            style={modeBtn(is3v3)}
            disabled={!isHost}
            onClick={() => isHost && onSetGameMode("team_3v3")}
          >
            3v3
          </button>
          <button
            type="button"
            style={modeBtn(isBossRush)}
            disabled={!isHost}
            onClick={() => isHost && onSetGameMode("boss_rush")}
          >
            Boss Rush
          </button>
          <button
            type="button"
            style={modeBtn(isFfa)}
            disabled={!isHost}
            onClick={() => isHost && onSetGameMode("ffa")}
          >
            FFA
          </button>
          {isHost && onOpenArenaRules && (
            <button
              type="button"
              style={{
                ...modeBtn(false),
                borderLeft: "1px solid rgba(255, 255, 255, 0.2)",
                borderRadius: "0 999px 999px 0",
                color: "#fde047",
              }}
              onClick={onOpenArenaRules}
            >
              Arena &amp; Rules
            </button>
          )}
        </div>
      )}

      {/* FFA Lobby / Scoreboard / Winner Card */}
      {isFfa && (
        <div
          style={{
            position: "fixed",
            top: isTouchPhone ? 42 : 112,
            left: isTouchPhone ? 12 : 18,
            zIndex: 22,
            width: isTouchPhone ? 186 : 248,
            padding: isTouchPhone ? "8px 10px" : "12px 14px",
            borderRadius: 12,
            background: "rgba(10, 11, 15, 0.82)",
            border: "1px solid rgba(251, 191, 36, 0.28)",
            backdropFilter: "blur(10px)",
            color: "#f8fafc",
            pointerEvents: isTouchPhone ? "none" : "auto",
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: "#fbbf24", marginBottom: 8 }}>
            <span>Mythic FFA</span>
            <span>First to {world.ffaTargetScore}</span>
          </div>
          {world.players.map((p) => (
            <div key={p.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "3px 0" }}>
              <span>{p.name}{p.id === sessionId ? " (You)" : ""}</span>
              <strong style={{ color: "#fbbf24" }}>{p.ffaScore}</strong>
            </div>
          ))}
          {world.ffaWinnerName ? (
            <div style={{ marginTop: 8, fontSize: 12, fontWeight: 700, color: "#4ade80" }}>
              Winner: {world.ffaWinnerName}
            </div>
          ) : null}
          {isHost && onStartFfa && (
            <button
              type="button"
              onClick={onStartFfa}
              style={{
                marginTop: 10,
                width: "100%",
                padding: "7px 10px",
                borderRadius: 8,
                border: "none",
                background: "linear-gradient(90deg, #f59e0b 0%, #ef4444 100%)",
                color: "#fff",
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                cursor: "pointer",
                pointerEvents: "auto",
              }}
            >
              {world.ffaWinnerName ? "Rematch FFA" : "Start FFA Match"}
            </button>
          )}
        </div>
      )}

      {/* 3v3 Pre-Match Team Roster Card */}
      {is3v3 && !world.teamMatchActive && !world.teamMatchWinner && (
        <div
          style={rosterCard}
          onMouseDown={(e) => e.stopPropagation()}
          aria-label="3v3 Team Lobby"
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 10,
            }}
          >
            <span
              style={{
                fontSize: 12,
                fontWeight: 800,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
              }}
            >
              3v3 Team Battle
            </span>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.58)" }}>
              5 Rounds
            </span>
          </div>

          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            {renderSlotList("red", redHumans)}
            {renderSlotList("blue", blueHumans)}
          </div>

          <label
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              fontSize: 12,
              padding: "6px 8px",
              borderRadius: 6,
              background: "rgba(255,255,255,0.05)",
              marginBottom: 10,
              cursor: isHost ? "pointer" : "default",
            }}
          >
            <span>Fill Empty Slots with AI Bots</span>
            <input
              type="checkbox"
              checked={world.teamFillBots}
              disabled={!isHost}
              onChange={(e) => isHost && onSetFillBots(e.target.checked)}
            />
          </label>

          {isHost ? (
            <button
              type="button"
              onClick={onStartMatch}
              style={{
                width: "100%",
                padding: "9px 12px",
                borderRadius: 8,
                border: "none",
                background: "linear-gradient(90deg, #dc2626 0%, #2563eb 100%)",
                color: "#ffffff",
                fontSize: 12,
                fontWeight: 800,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                cursor: "pointer",
              }}
            >
              Start 5-Round Match
            </button>
          ) : (
            <div
              style={{
                textAlign: "center",
                fontSize: 11,
                color: "rgba(255,255,255,0.6)",
                padding: "4px 0",
              }}
            >
              Waiting for host to start match…
            </div>
          )}
        </div>
      )}

      {/* Top-Center 3v3 Live Scoreboard */}
      {is3v3 && (world.teamMatchActive || Boolean(world.teamMatchWinner)) && (
        <div style={scoreboardStyle} aria-label="3v3 Scoreboard">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: RED_COLOR }}>RED</span>
            <span style={{ fontSize: 16 }}>{world.teamRedScore}</span>
            {redTotal > 0 && (
              <span style={{ display: "flex", gap: 3 }}>
                {Array.from({ length: redTotal }).map((_, i) => (
                  <span
                    key={i}
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: i < redAlive ? RED_COLOR : "rgba(255,255,255,0.2)",
                    }}
                  />
                ))}
              </span>
            )}
          </div>

          <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 11 }}>
            R{Math.max(1, world.teamRound)}/{world.teamMaxRounds}
          </span>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {blueTotal > 0 && (
              <span style={{ display: "flex", gap: 3 }}>
                {Array.from({ length: blueTotal }).map((_, i) => (
                  <span
                    key={i}
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: i < blueAlive ? BLUE_COLOR : "rgba(255,255,255,0.2)",
                    }}
                  />
                ))}
              </span>
            )}
            <span style={{ fontSize: 16 }}>{world.teamBlueScore}</span>
            <span style={{ color: BLUE_COLOR }}>BLUE</span>
          </div>
        </div>
      )}

      {/* Round-Over Intermission Banner */}
      {is3v3 &&
        world.teamMatchActive &&
        !world.teamRoundActive &&
        Boolean(world.teamRoundWinner) && (
          <div
            style={{
              position: "fixed",
              top: "26%",
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 24,
              padding: "16px 32px",
              borderRadius: 12,
              background: "rgba(10, 11, 16, 0.88)",
              border: `1px solid ${
                world.teamRoundWinner === "red"
                  ? RED_COLOR
                  : world.teamRoundWinner === "blue"
                    ? BLUE_COLOR
                    : "rgba(255,255,255,0.3)"
              }`,
              textAlign: "center",
              color: "#f8fafc",
              pointerEvents: "none",
              boxShadow: "0 16px 40px rgba(0,0,0,0.55)",
            }}
          >
            <div
              style={{
                fontSize: 22,
                fontWeight: 900,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color:
                  world.teamRoundWinner === "red"
                    ? RED_COLOR
                    : world.teamRoundWinner === "blue"
                      ? BLUE_COLOR
                      : "#f8fafc",
              }}
            >
              {world.teamRoundWinner === "draw"
                ? `ROUND ${world.teamRound} DRAW`
                : `${world.teamRoundWinner.toUpperCase()} WINS ROUND ${world.teamRound}`}
            </div>
            <div style={{ marginTop: 6, fontSize: 12, color: "rgba(255,255,255,0.72)" }}>
              Next round in {Math.max(1, Math.ceil(world.teamIntermissionMs / 1000))}s…
            </div>
          </div>
        )}

      {/* Match Victory Banner + Rematch */}
      {is3v3 && Boolean(world.teamMatchWinner) && (
        <div
          style={{
            position: "fixed",
            top: "24%",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 24,
            minWidth: 300,
            padding: "22px 32px",
            borderRadius: 14,
            background: "rgba(10, 11, 16, 0.92)",
            border: `1px solid ${
              world.teamMatchWinner === "red"
                ? RED_COLOR
                : world.teamMatchWinner === "blue"
                  ? BLUE_COLOR
                  : "rgba(255,255,255,0.3)"
            }`,
            textAlign: "center",
            color: "#f8fafc",
            pointerEvents: "auto",
            boxShadow: "0 20px 50px rgba(0,0,0,0.65)",
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: "rgba(255,255,255,0.58)",
              marginBottom: 4,
            }}
          >
            3v3 Match Complete
          </div>
          <div
            style={{
              fontSize: 26,
              fontWeight: 900,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color:
                world.teamMatchWinner === "red"
                  ? RED_COLOR
                  : world.teamMatchWinner === "blue"
                    ? BLUE_COLOR
                    : "#f8fafc",
            }}
          >
            {world.teamMatchWinner === "draw"
              ? "MATCH DRAW"
              : `${world.teamMatchWinner.toUpperCase()} TEAM WINS`}
          </div>
          <div style={{ marginTop: 8, fontSize: 15, fontWeight: 700 }}>
            <span style={{ color: RED_COLOR }}>RED {world.teamRedScore}</span>
            <span style={{ margin: "0 10px", color: "rgba(255,255,255,0.4)" }}>—</span>
            <span style={{ color: BLUE_COLOR }}>{world.teamBlueScore} BLUE</span>
          </div>

          {isHost ? (
            <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 16 }}>
              <button
                type="button"
                onClick={onRematch}
                style={{
                  padding: "9px 18px",
                  borderRadius: 8,
                  border: "none",
                  background: "#f8fafc",
                  color: "#0f172a",
                  fontSize: 12,
                  fontWeight: 800,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  cursor: "pointer",
                }}
              >
                Play Again
              </button>
              <button
                type="button"
                onClick={() => onSetGameMode("waves")}
                style={{
                  padding: "9px 14px",
                  borderRadius: 8,
                  border: "1px solid rgba(255,255,255,0.22)",
                  background: "transparent",
                  color: "#f8fafc",
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  cursor: "pointer",
                }}
              >
                Waves Mode
              </button>
            </div>
          ) : (
            <div style={{ marginTop: 12, fontSize: 12, color: "rgba(255,255,255,0.6)" }}>
              Waiting for host to start rematch…
            </div>
          )}
        </div>
      )}
    </>
  );
}
