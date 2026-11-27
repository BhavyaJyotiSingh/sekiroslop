import { useCallback, useEffect, useRef, useState } from "react";
import { ColosseumScene, type PerfStats } from "./scene/ColosseumScene";
import type { LivePose } from "./scene/GladiatorModel";
import { useColosseumRoom } from "./net/useColosseumRoom";
import { LobbyScreen } from "./ui/LobbyScreen";
import { GameHUD } from "./ui/GameHUD";
import {
  isMobileFullscreenSupported,
  isPortraitTouchDevice,
  requestMobileFullscreenLandscape,
} from "./input/mobileDisplay";
import type { ArenaMapKind, CombatArtKind, PlayerAbilityKind, PlayerSkinKind, RespawnMode } from "@sekiroslop/shared";
import { soundEngine } from "./audio/SoundEngine";
import { EXPERIMENTAL_SPECIAL_MOVES, type ExperimentalArtKind } from "./experimental/special-moves";
import {
  getGraphicsQualityPreset,
  saveGraphicsQualityPreset,
  type GraphicsQualityPreset,
} from "./lib/graphicsQuality";

export function App() {
  const room = useColosseumRoom();
  const [phoneNeedsLandscape, setPhoneNeedsLandscape] = useState(isPortraitTouchDevice);
  const [nearLever, setNearLever] = useState(false);
  const [lockedEnemyId, setLockedEnemyId] = useState<string | null>(null);
  const [perf, setPerf] = useState<PerfStats>({ fps: 0, drawCalls: 0, triangles: 0 });
  const [spectateTargetId, setSpectateTargetId] = useState("");
  const [selectedAbility, setSelectedAbility] = useState<PlayerAbilityKind>("fireball");
  const [graphicsQuality, setGraphicsQuality] = useState<GraphicsQualityPreset>(getGraphicsQualityPreset);

  const localPoseRef = useRef<LivePose>({
    x: 0,
    y: 0,
    z: 10,
    yaw: Math.PI,
    moveAnim: "idle",
    speedRatio: 0,
  });

  const localPlayer = room.connected
    ? room.world.players.find((p) => p.id === room.sessionId)
    : undefined;

  useEffect(() => {
    const is3v3Match = room.world.gameMode === "team_3v3" && room.world.teamMatchActive;
    const shouldSpectate = Boolean(
      localPlayer &&
        !localPlayer.alive &&
        ((room.world.waveActive && room.world.respawnMode === "wave_end") || is3v3Match)
    );
    if (!shouldSpectate) {
      setSpectateTargetId("");
      return;
    }
    const livingTeammates = room.world.players.filter(
      (player) =>
        player.alive &&
        player.id !== room.sessionId &&
        (!is3v3Match || !localPlayer?.team || player.team === localPlayer.team)
    );
    setSpectateTargetId((current) =>
      livingTeammates.some((player) => player.id === current) ? current : livingTeammates[0]?.id ?? ""
    );
  }, [
    localPlayer?.alive,
    localPlayer?.team,
    room.sessionId,
    room.world.gameMode,
    room.world.players,
    room.world.respawnMode,
    room.world.teamMatchActive,
    room.world.waveActive,
  ]);

  useEffect(() => {
    const isUnsafeFullscreenTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof Element)) return false;
      return Boolean(
        target.closest("input, textarea, select, button, label, .ui-modal-backdrop, .val-chat, .lobby-panel")
      );
    };
    const syncDisplayGuards = () => {
      const portrait = isPortraitTouchDevice();
      setPhoneNeedsLandscape(portrait);
    };
    const onTouchGesture = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" && !isUnsafeFullscreenTarget(event.target)) {
        requestMobileFullscreenLandscape();
      }
    };
    syncDisplayGuards();
    window.addEventListener("resize", syncDisplayGuards);
    window.addEventListener("orientationchange", syncDisplayGuards);
    window.addEventListener("pointerdown", onTouchGesture, true);
    screen.orientation?.addEventListener("change", syncDisplayGuards);
    return () => {
      window.removeEventListener("resize", syncDisplayGuards);
      window.removeEventListener("orientationchange", syncDisplayGuards);
      window.removeEventListener("pointerdown", onTouchGesture, true);
      screen.orientation?.removeEventListener("change", syncDisplayGuards);
    };
  }, []);

  const handleSelectedArtCast = useCallback(() => {
    if (!localPlayer?.alive || localPlayer.combatArtCooldownMs > 0) return;
    soundEngine.unlock();
    room.castSelectedArt({ yaw: localPoseRef.current.yaw });
  }, [localPlayer?.alive, localPlayer?.combatArtCooldownMs, room.castSelectedArt]);

  const handleSelectSkin = useCallback(
    (skin: PlayerSkinKind) => room.sendPlayerLoadout({ skin }),
    [room.sendPlayerLoadout]
  );

  const handleSelectCombatArt = useCallback(
    (combatArt: CombatArtKind) => room.sendPlayerLoadout({ combatArt }),
    [room.sendPlayerLoadout]
  );

  const handleRespawnMode = useCallback(
    (mode: RespawnMode) => room.sendRespawnMode({ mode }),
    [room.sendRespawnMode]
  );

  const handleArenaMap = useCallback(
    (map: ArenaMapKind) => room.sendArenaMap({ map }),
    [room.sendArenaMap]
  );

  const handleGraphicsQuality = useCallback((preset: GraphicsQualityPreset) => {
    saveGraphicsQualityPreset(preset);
    setGraphicsQuality(preset);
  }, []);

  const cycleSpectator = useCallback(
    (direction: number) => {
      const is3v3Match = room.world.gameMode === "team_3v3" && room.world.teamMatchActive;
      const livingTeammates = room.world.players.filter(
        (player) =>
          player.alive &&
          player.id !== room.sessionId &&
          (!is3v3Match || !localPlayer?.team || player.team === localPlayer.team)
      );
      if (livingTeammates.length === 0) return;
      const currentIndex = livingTeammates.findIndex((player) => player.id === spectateTargetId);
      const nextIndex = (currentIndex + direction + livingTeammates.length) % livingTeammates.length;
      setSpectateTargetId(livingTeammates[nextIndex].id);
    },
    [localPlayer?.team, room.sessionId, room.world.gameMode, room.world.players, room.world.teamMatchActive, spectateTargetId]
  );

  // Triggered by LocalPlayerController keydown using the player's selected combat art.
  const handleControllerExperimentalArt = useCallback(
    (art: ExperimentalArtKind, yaw: number) => {
      if (!EXPERIMENTAL_SPECIAL_MOVES) return;
      if (art !== localPlayer?.selectedArt) return;
      room.sendExperimentalArt(art, yaw, false);
    },
    [localPlayer?.selectedArt, room.sendExperimentalArt]
  );

  const handleLeave = () => {
    setLockedEnemyId(null);
    room.leaveArena();
  };

  return (
    <div className="app-shell">
      <ColosseumScene
        connected={room.connected}
        sessionId={room.sessionId}
        world={room.world}
        graphicsQuality={graphicsQuality}
        worldRef={room.worldRef}
        localPoseRef={localPoseRef}
        nearLever={nearLever}
        lockedEnemyId={lockedEnemyId}
        effectsRef={room.effectsRef}
        slashesRef={room.slashesRef}
        abilityVfxRef={room.abilityVfxRef}
        experimentalVfxRef={room.experimentalVfxRef}
        combatBurstsRef={room.combatBurstsRef}
        activeExperimentalArts={room.activeExperimentalArts}
        spectateTargetId={spectateTargetId}
        shakeRef={room.shakeRef}
        selectedAbility={selectedAbility}
        onSelectAbility={setSelectedAbility}
        onCastAbility={room.sendCastAbility}
        onLockChange={setLockedEnemyId}
        onMove={room.sendMove}
        onAttack={room.sendAttack}
        onUseItem={room.sendUseItem}
        onBlock={room.sendBlock}
        onDodge={room.sendDodge}
        onInteractGate={room.sendInteractGate}
        onNearLeverChange={setNearLever}
        onExperimentalArt={handleControllerExperimentalArt}
        onPerfSample={setPerf}
      />

      {!room.connected ? (
        <LobbyScreen
          connecting={room.connecting}
          error={room.error}
          onCreate={(playerName) => {
            requestMobileFullscreenLandscape();
            room.createArena(playerName);
          }}
          onJoin={(roomCode, playerName) => {
            requestMobileFullscreenLandscape();
            room.joinArena(roomCode, playerName);
          }}
        />
      ) : (
        <>
          <GameHUD
            sessionId={room.sessionId}
            world={room.world}
            graphicsQuality={graphicsQuality}
            onSetGraphicsQuality={handleGraphicsQuality}
            pingMs={room.pingMs}
            feed={room.feed}
            deflectBanner={room.deflectBanner}
            nearLever={nearLever}
            lockedEnemyId={lockedEnemyId}
            perf={perf}
            onUseItem={room.sendUseItem}
            onCastSelectedArt={handleSelectedArtCast}
            selectedAbility={selectedAbility}
            onSelectAbility={setSelectedAbility}
            onCastAbility={() => {
              if (!localPlayer?.alive) return;
              room.sendCastAbility({ ability: selectedAbility, yaw: localPoseRef.current.yaw, pitch: 0.02 });
            }}
            onPunch={() => {
              if (!localPlayer?.alive) return;
              room.sendAttack({ kind: "punch", yaw: localPoseRef.current.yaw });
            }}
            onStartFfa={room.sendFfaStartMatch}
            onToggleInfiniteHealth={room.sendToggleInfiniteHealth}
            onSelectSkin={handleSelectSkin}
            onSelectArt={handleSelectCombatArt}
            onSetRespawnMode={handleRespawnMode}
            onSetArenaMap={handleArenaMap}
            onSetGameMode={room.sendGameMode}
            onJoinTeam={room.sendJoinTeam}
            onSetFillBots={room.sendTeamFillBots}
            onStartTeamMatch={room.sendTeamStartMatch}
            onRematchTeam={room.sendTeamRematch}
            spectateTargetId={spectateTargetId}
            onCycleSpectator={cycleSpectator}
            onLeave={handleLeave}
            chatMessages={room.chatMessages}
            onSendChat={room.sendPartyChat}
          />
        </>
      )}
      {phoneNeedsLandscape && (
        <div className="mobile-orientation-guard" role="dialog" aria-modal="true">
          <div className="mobile-orientation-card">
            <div className="mobile-orientation-icon" aria-hidden="true">↻</div>
            <h2>Rotate Phone Horizontally</h2>
            <p>SekiroSlop plays best in horizontal landscape mode with touch controls.</p>
            {isMobileFullscreenSupported() ? (
              <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                <button type="button" onClick={requestMobileFullscreenLandscape}>
                  Enter Fullscreen Landscape
                </button>
              </div>
            ) : (
              <p style={{ opacity: 0.78, fontSize: 13 }}>Turn your phone sideways to continue.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
