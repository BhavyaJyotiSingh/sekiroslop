import { useCallback, useEffect, useRef, useState } from "react";
import { Client, type Room } from "@colyseus/sdk";
import {
  ARENA_MAPS,
  ENEMY_ARCHETYPES,
  FLIGHT,
  GAME_PROTOCOL_VERSION,
  POWER_UPS,
  type CastAbilityMessage,
  type CastSelectedArtMessage,
  type CombatArtKind,
  type AttackMessage,
  type ArenaMapKind,
  type ArenaMapMessage,
  type BlockMessage,
  type CombatEventPayload,
  type DodgeMessage,
  type EnemyKind,
  type GameMode,
  type MoveMessage,
  type PlayerAbilityKind,
  type PlayerLoadoutMessage,
  type PartyChatMessage,
  type PlayerSkinKind,
  type PowerUpKind,
  type ProjectileKind,
  type RespawnMode,
  type RespawnModeMessage,
  type SpecialMessage,
  type TeamSide,
  type UseItemMessage,
} from "@sekiroslop/shared";
import { soundEngine } from "../audio/SoundEngine";
import { resetHitStop, triggerHitStop } from "../lib/hitStop";
import type { BurstEffect } from "../scene/CombatVFX";
import type { SlashEffect } from "../scene/SlashVFX";
import {
  EXPERIMENTAL_ARTS,
  EXPERIMENTAL_SPECIAL_MOVES,
  type ExperimentalArtKind,
  type ExperimentalVfxEvent,
} from "../experimental/special-moves";
import {
  EXPERIMENTAL_SWORD_VFX_AND_HITBOX,
  enqueueCombatBurst,
  mapCombatEventToBurstKind,
  type CombatBurstEvent,
} from "../experimental/sword-vfx-hitbox";

export interface ActiveExperimentalArtState {
  kind: ExperimentalArtKind;
  nonce: number;
  expiresAt: number;
}

export interface BeltSlotSnapshot {
  kind: PowerUpKind | "";
  charges: number;
}

export interface PlayerSnapshot {
  id: string;
  name: string;
  slot: number;
  team: TeamSide | "";
  skin: PlayerSkinKind;
  selectedArt: CombatArtKind;
  combatArtCooldownMs: number;
  selectedAbility: PlayerAbilityKind;
  abilityCooldownMs: number;
  flightFuelMs: number;
  isFlying: boolean;
  lastMoveSeq: number;
  velocityX: number;
  velocityY: number;
  velocityZ: number;
  shockedMs: number;
  ffaScore: number;
  infiniteHealth: boolean;
  pingMs: number | null;
  x: number;
  y: number;
  z: number;
  yaw: number;
  moveAnim: string;
  hp: number;
  maxHp: number;
  posture: number;
  maxPosture: number;
  action: string;
  isBlocking: boolean;
  alive: boolean;
  respawnTimer: number;
  whirlwindCdMs: number;
  counterReadyMs: number;
  furyMs: number;
  ironWillMs: number;
  swiftFeetMs: number;
  tonicMs: number;
  belt: [BeltSlotSnapshot, BeltSlotSnapshot, BeltSlotSnapshot];
  kills: number;
  pvpKills: number;
  deaths: number;
}

export interface EnemySnapshot {
  id: string;
  name: string;
  kind: EnemyKind;
  x: number;
  y: number;
  z: number;
  yaw: number;
  hp: number;
  maxHp: number;
  posture: number;
  maxPosture: number;
  action: string;
  attackKind: string;
  isBlocking: boolean;
  telegraph: string;
  alive: boolean;
  team: TeamSide | "";
  combatArt: string;
  isBot: boolean;
}

export interface GateSnapshot {
  open: boolean;
  openProgress: number;
  cooldownMs: number;
  activations: number;
}

export interface PickupSnapshot {
  id: string;
  kind: PowerUpKind;
  x: number;
  z: number;
}

export interface PilumSnapshot {
  id: string;
  kind: ProjectileKind;
  ownerId: string;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
}

export interface AbilityVfxEvent {
  id: number;
  kind: "shadow_step" | "fireball_explode" | "arcane_explode" | "stun_arc" | "shock_ring";
  x: number;
  y: number;
  z: number;
  targetX?: number;
  targetY?: number;
  targetZ?: number;
  createdAt: number;
}

export interface FeedItem {
  id: number;
  text: string;
  tone: "deflect" | "kill" | "pvp" | "gate" | "stagger" | "powerup";
  createdAt: number;
}

export interface RoomWorldSnapshot {
  roomCode: string;
  hostSessionId: string;
  respawnMode: RespawnMode;
  arenaMap: ArenaMapKind;
  gameMode: GameMode;
  teamFillBots: boolean;
  teamMatchActive: boolean;
  teamRoundActive: boolean;
  teamRound: number;
  teamMaxRounds: number;
  teamRedScore: number;
  teamBlueScore: number;
  teamRoundWinner: TeamSide | "draw" | "";
  teamMatchWinner: TeamSide | "draw" | "";
  teamIntermissionMs: number;
  bossTrial: number;
  bossTrialTitle: string;
  ffaTargetScore: number;
  ffaZoneOwnerId: string;
  ffaZoneProgress: number;
  ffaWinnerName: string;
  skeletonsDefeated: number;
  wave: number;
  waveActive: boolean;
  waveTitle: string;
  enemiesRemaining: number;
  totalEnemiesInWave: number;
  northGate: GateSnapshot;
  players: PlayerSnapshot[];
  enemies: EnemySnapshot[];
  pickups: PickupSnapshot[];
  pilums: PilumSnapshot[];
}

function createEmptyWorldSnapshot(): RoomWorldSnapshot {
  return {
    roomCode: "",
    hostSessionId: "",
    respawnMode: "infinite",
    arenaMap: "sunlit_colosseum",
    gameMode: "waves",
    teamFillBots: true,
    teamMatchActive: false,
    teamRoundActive: false,
    teamRound: 0,
    teamMaxRounds: 5,
    teamRedScore: 0,
    teamBlueScore: 0,
    teamRoundWinner: "",
    teamMatchWinner: "",
    teamIntermissionMs: 0,
    bossTrial: 0,
    bossTrialTitle: "",
    ffaTargetScore: 10,
    ffaZoneOwnerId: "",
    ffaZoneProgress: 0,
    ffaWinnerName: "",
    skeletonsDefeated: 0,
    wave: 0,
    waveActive: false,
    waveTitle: "",
    enemiesRemaining: 0,
    totalEnemiesInWave: 0,
    northGate: { open: false, openProgress: 0, cooldownMs: 0, activations: 0 },
    players: [],
    enemies: [],
    pickups: [],
    pilums: [],
  };
}

function formatRomanWave(wave: number): string {
  const romans: Record<number, string> = {
    1: "I",
    2: "II",
    3: "III",
    4: "IV",
  };
  return romans[wave] ?? String(wave);
}

export function getServerUrl(): string {
  const configured = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (configured && configured.trim().length > 0) {
    const trimmed = configured.trim().replace(/\/+$/, "");
    if (trimmed.startsWith("https://")) return `wss://${trimmed.slice(8)}`;
    if (trimmed.startsWith("http://")) return `ws://${trimmed.slice(7)}`;
    return trimmed;
  }
  if (window.location.protocol === "https:") {
    return "wss://sekiroslop.up.railway.app";
  }
  return `ws://${window.location.hostname}:2567`;
}

export function getServerHealthUrl(): string {
  const wsUrl = getServerUrl();
  const httpBase = wsUrl.startsWith("wss://")
    ? `https://${wsUrl.slice(6)}`
    : wsUrl.startsWith("ws://")
      ? `http://${wsUrl.slice(5)}`
      : wsUrl;
  return `${httpBase}/health`;
}

export function useColosseumRoom() {
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string>("");
  const [pingMs, setPingMs] = useState<number | null>(null);
  const [world, setWorld] = useState<RoomWorldSnapshot>(createEmptyWorldSnapshot);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [deflectBanner, setDeflectBanner] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<PartyChatMessage[]>([]);

  const roomRef = useRef<Room | null>(null);
  const pingTimerRef = useRef<number | null>(null);
  const worldRef = useRef<RoomWorldSnapshot>(createEmptyWorldSnapshot());
  const lastHudSigRef = useRef("");
  const effectsRef = useRef<BurstEffect[]>([]);
  const slashesRef = useRef<SlashEffect[]>([]);
  const abilityVfxRef = useRef<AbilityVfxEvent[]>([]);
  const experimentalVfxRef = useRef<ExperimentalVfxEvent[]>([]);
  const combatBurstsRef = useRef<CombatBurstEvent[]>([]);
  const [activeExperimentalArts, setActiveExperimentalArts] = useState<
    Record<string, ActiveExperimentalArtState>
  >({});
  const artTimeoutsRef = useRef<Map<string, number>>(new Map());
  const artNonceRef = useRef(1);
  const shakeRef = useRef<number>(0);
  const seqRef = useRef(1);
  const bannerTimeoutRef = useRef<number | null>(null);
  const prevHeavyTelegraphIdsRef = useRef<Set<string>>(new Set());

  const clearExperimentalArtTimers = useCallback(() => {
    artTimeoutsRef.current.forEach((timerId) => window.clearTimeout(timerId));
    artTimeoutsRef.current.clear();
    setActiveExperimentalArts({});
  }, []);

  const resetRoomState = useCallback(() => {
    if (pingTimerRef.current !== null) {
      window.clearInterval(pingTimerRef.current);
      pingTimerRef.current = null;
    }
    setPingMs(null);
    const empty = createEmptyWorldSnapshot();
    worldRef.current = empty;
    setWorld(empty);
    lastHudSigRef.current = "";
    effectsRef.current.length = 0;
    slashesRef.current.length = 0;
    abilityVfxRef.current.length = 0;
    experimentalVfxRef.current.length = 0;
    combatBurstsRef.current.length = 0;
    prevHeavyTelegraphIdsRef.current.clear();
    shakeRef.current = 0;
    if (bannerTimeoutRef.current !== null) {
      window.clearTimeout(bannerTimeoutRef.current);
      bannerTimeoutRef.current = null;
    }
    setDeflectBanner(null);
    setChatMessages([]);
    resetHitStop();
    clearExperimentalArtTimers();
  }, [clearExperimentalArtTimers]);

  const pushFeed = useCallback((text: string, tone: FeedItem["tone"]) => {
    const id = seqRef.current++;
    setFeed((prev) => [{ id, text, tone, createdAt: Date.now() }, ...prev].slice(0, 6));
  }, []);

  const flashBanner = useCallback((label: string, durationMs = 900) => {
    setDeflectBanner(label);
    if (bannerTimeoutRef.current !== null) {
      window.clearTimeout(bannerTimeoutRef.current);
    }
    bannerTimeoutRef.current = window.setTimeout(() => {
      bannerTimeoutRef.current = null;
      setDeflectBanner(null);
    }, durationMs);
  }, []);

  const attachRoom = useCallback(
    (room: Room) => {
      roomRef.current = room;
      prevHeavyTelegraphIdsRef.current.clear();
      setChatMessages([]);
      setSessionId(room.sessionId);
      setConnected(true);
      setConnecting(false);
      setError(null);

      const measurePing = () => {
        room.ping((ms) => {
          if (roomRef.current === room && Number.isFinite(ms)) {
            const measured = Math.round(ms);
            setPingMs(measured);
            room.send("ping_report", { pingMs: measured });
          }
        });
      };
      measurePing();
      if (pingTimerRef.current !== null) window.clearInterval(pingTimerRef.current);
      pingTimerRef.current = window.setInterval(measurePing, 2000);
      room.onMessage("party_chat", (message: PartyChatMessage) => {
        setChatMessages((previous) => [...previous, message].slice(-80));
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      room.onStateChange((state: any) => {
        const players: PlayerSnapshot[] = [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        state.players?.forEach((p: any) => {
          players.push({
            id: p.id,
            name: p.name,
            slot: p.slot,
            team: (p.team === "red" || p.team === "blue" ? p.team : "") as TeamSide | "",
            skin: (p.skin || "knight") as PlayerSkinKind,
            selectedArt: (p.selectedArt || "ashina_cross") as CombatArtKind,
            combatArtCooldownMs: Number(p.combatArtCooldownMs ?? 0),
            selectedAbility: (p.selectedAbility || "fireball") as PlayerAbilityKind,
            abilityCooldownMs: Number(p.abilityCooldownMs ?? 0),
            flightFuelMs: Number(p.flightFuelMs ?? FLIGHT.MAX_FUEL_MS),
            isFlying: Boolean(p.isFlying),
            lastMoveSeq: Number(p.lastMoveSeq ?? 0),
            velocityX: Number(p.velocityX ?? 0),
            velocityY: Number(p.velocityY ?? 0),
            velocityZ: Number(p.velocityZ ?? 0),
            shockedMs: Number(p.shockedMs ?? 0),
            ffaScore: Number(p.ffaScore ?? 0),
            infiniteHealth: Boolean(p.infiniteHealth),
            pingMs: Number(p.pingMs) >= 0 ? Number(p.pingMs) : null,
            x: p.x,
            y: p.y ?? 0,
            z: p.z,
            yaw: p.yaw,
            moveAnim: p.moveAnim ?? "idle",
            hp: p.hp,
            maxHp: p.maxHp,
            posture: p.posture,
            maxPosture: p.maxPosture,
            action: p.action,
            isBlocking: p.isBlocking,
            alive: p.alive,
            respawnTimer: p.respawnTimer,
            whirlwindCdMs: p.whirlwindCdMs ?? 0,
            counterReadyMs: p.counterReadyMs ?? 0,
            furyMs: p.furyMs ?? 0,
            ironWillMs: p.ironWillMs ?? 0,
            swiftFeetMs: p.swiftFeetMs ?? 0,
            tonicMs: p.tonicMs ?? 0,
            belt: [
              { kind: (p.slot0Kind || "") as PowerUpKind | "", charges: p.slot0Charges ?? 0 },
              { kind: (p.slot1Kind || "") as PowerUpKind | "", charges: p.slot1Charges ?? 0 },
              { kind: (p.slot2Kind || "") as PowerUpKind | "", charges: p.slot2Charges ?? 0 },
            ],
            kills: p.kills,
            pvpKills: p.pvpKills,
            deaths: p.deaths,
          });
        });

        const enemies: EnemySnapshot[] = [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        state.enemies?.forEach((e: any) => {
          const rawKind = e.kind as EnemyKind | undefined;
          const kind: EnemyKind = rawKind && rawKind in ENEMY_ARCHETYPES ? rawKind : "legionary";
          enemies.push({
            id: e.id,
            name: e.name,
            kind,
            x: e.x,
            y: e.y ?? 0,
            z: e.z,
            yaw: e.yaw,
            hp: e.hp,
            maxHp: e.maxHp,
            posture: e.posture,
            maxPosture: e.maxPosture,
            action: e.action,
            attackKind: String(e.attackKind ?? ""),
            isBlocking: Boolean(e.isBlocking),
            telegraph: e.telegraph,
            alive: e.alive,
            team: (e.team === "red" || e.team === "blue" ? e.team : "") as TeamSide | "",
            combatArt: String(e.combatArt ?? ""),
            isBot: Boolean(e.isBot),
          });
        });

        // Trigger Sekiro perilous attack sting whenever a living enemy enters a heavy telegraph
        const nextHeavyIds = new Set<string>();
        let triggeredPerilous = false;
        for (const e of enemies) {
          if (e.alive && e.telegraph === "heavy") {
            nextHeavyIds.add(e.id);
            if (!prevHeavyTelegraphIdsRef.current.has(e.id)) {
              triggeredPerilous = true;
            }
          }
        }
        prevHeavyTelegraphIdsRef.current = nextHeavyIds;
        if (triggeredPerilous) {
          soundEngine.playPerilousWarning();
        }

        const pickups: PickupSnapshot[] = [];
        state.pickups?.forEach((pu: PickupSnapshot) => {
          pickups.push({
            id: pu.id,
            kind: pu.kind as PowerUpKind,
            x: pu.x,
            z: pu.z,
          });
        });

        const pilums: PilumSnapshot[] = [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        state.pilums?.forEach((pl: any) => {
          pilums.push({
            id: pl.id,
            kind: (pl.kind || "fireball") as ProjectileKind,
            ownerId: pl.ownerId,
            x: pl.x,
            y: pl.y,
            z: pl.z,
            vx: pl.vx,
            vy: pl.vy,
            vz: pl.vz,
            yaw: pl.yaw,
          });
        });

        const snapshot: RoomWorldSnapshot = {
          roomCode: state.roomCode || room.roomId,
          hostSessionId: String(state.hostSessionId ?? ""),
          respawnMode: state.respawnMode === "wave_end" ? "wave_end" : "infinite",
          arenaMap: Object.prototype.hasOwnProperty.call(ARENA_MAPS, state.arenaMap)
            ? (state.arenaMap as ArenaMapKind)
            : "sunlit_colosseum",
          gameMode: (["waves", "team_3v3", "boss_rush", "ffa"].includes(state.gameMode)
            ? state.gameMode
            : "waves") as GameMode,
          teamFillBots: state.teamFillBots !== undefined ? Boolean(state.teamFillBots) : true,
          teamMatchActive: Boolean(state.teamMatchActive),
          teamRoundActive: Boolean(state.teamRoundActive),
          teamRound: Number(state.teamRound ?? 0),
          teamMaxRounds: Number(state.teamMaxRounds ?? 5),
          teamRedScore: Number(state.teamRedScore ?? 0),
          teamBlueScore: Number(state.teamBlueScore ?? 0),
          teamRoundWinner: (state.teamRoundWinner === "red" || state.teamRoundWinner === "blue" || state.teamRoundWinner === "draw"
            ? state.teamRoundWinner
            : "") as TeamSide | "draw" | "",
          teamMatchWinner: (state.teamMatchWinner === "red" || state.teamMatchWinner === "blue" || state.teamMatchWinner === "draw"
            ? state.teamMatchWinner
            : "") as TeamSide | "draw" | "",
          teamIntermissionMs: Number(state.teamIntermissionMs ?? 0),
          bossTrial: Number(state.bossTrial ?? 0),
          bossTrialTitle: String(state.bossTrialTitle ?? ""),
          ffaTargetScore: Number(state.ffaTargetScore ?? 10),
          ffaZoneOwnerId: String(state.ffaZoneOwnerId ?? ""),
          ffaZoneProgress: Number(state.ffaZoneProgress ?? 0),
          ffaWinnerName: String(state.ffaWinnerName ?? ""),
          skeletonsDefeated: state.skeletonsDefeated ?? 0,
          wave: Number(state.wave ?? 0),
          waveActive: Boolean(state.waveActive),
          waveTitle: String(state.waveTitle ?? ""),
          enemiesRemaining: Number(state.enemiesRemaining ?? 0),
          totalEnemiesInWave: Number(state.totalEnemiesInWave ?? 0),
          northGate: {
            open: Boolean(state.northGate?.open),
            openProgress: Number(state.northGate?.openProgress ?? 0),
            cooldownMs: Number(state.northGate?.cooldownMs ?? 0),
            activations: Number(state.northGate?.activations ?? 0),
          },
          players,
          enemies,
          pickups,
          pilums,
        };

        // Always update ref immediately at full 30Hz for zero-latency 3D useFrame reading
        worldRef.current = snapshot;

        let sig =
          `${snapshot.roomCode}|${snapshot.hostSessionId}|${snapshot.respawnMode}|${snapshot.arenaMap}|${snapshot.skeletonsDefeated}|` +
          `m:${snapshot.gameMode}:${snapshot.bossTrial}:${snapshot.bossTrialTitle}:${snapshot.ffaWinnerName}:${snapshot.ffaTargetScore}:${snapshot.ffaZoneOwnerId}:${Math.round(snapshot.ffaZoneProgress * 100)}:` +
          `${snapshot.teamFillBots ? 1 : 0}:${snapshot.teamMatchActive ? 1 : 0}:${snapshot.teamRoundActive ? 1 : 0}:${snapshot.teamRound}/${snapshot.teamMaxRounds}:` +
          `${snapshot.teamRedScore}-${snapshot.teamBlueScore}:${snapshot.teamRoundWinner}:${snapshot.teamMatchWinner}:${Math.ceil(snapshot.teamIntermissionMs / 1000)}|` +
          `w:${snapshot.wave}:${snapshot.waveActive ? 1 : 0}:${snapshot.waveTitle}:${snapshot.enemiesRemaining}/${snapshot.totalEnemiesInWave}|` +
          `g:${snapshot.northGate.open}:${Math.ceil(snapshot.northGate.openProgress * 100)}:${Math.ceil(snapshot.northGate.cooldownMs / 1000)}:${snapshot.northGate.activations}|`;

        for (const pickup of pickups) sig += `pu:${pickup.id}:${pickup.kind}|`;
        for (const p of players) {
          sig += `p:${p.id}:${p.name}:${p.slot}:${p.team}:${p.skin}:${p.selectedArt}:${Math.ceil(p.combatArtCooldownMs / 100)}:` +
            `${p.selectedAbility}:${Math.ceil(p.abilityCooldownMs / 100)}:${Math.ceil(p.flightFuelMs / 100)}:${p.isFlying ? 1 : 0}:${p.moveAnim}:${p.shockedMs > 0 ? 1 : 0}:` +
            `${p.ffaScore}:${p.infiniteHealth ? 1 : 0}:${p.pingMs}:${Math.round(p.hp)}:${Math.round((p.hp / Math.max(1, p.maxHp)) * 100)}:` +
            `${Math.round((p.posture / Math.max(1, p.maxPosture)) * 100)}:${p.action}:${p.isBlocking ? 1 : 0}:` +
            `${p.alive ? 1 : 0}:${p.respawnTimer}:${Math.ceil(p.whirlwindCdMs / 100)}:${p.counterReadyMs > 0 ? 1 : 0}:` +
            `${Math.ceil(p.furyMs / 100)}:${Math.ceil(p.ironWillMs / 100)}:${Math.ceil(p.swiftFeetMs / 100)}:${Math.ceil(p.tonicMs / 100)}:` +
            `${p.kills}:${p.pvpKills}:${p.deaths}:${p.belt[0].kind}:${p.belt[0].charges}:${p.belt[1].kind}:${p.belt[1].charges}:${p.belt[2].kind}:${p.belt[2].charges}|`;
        }
        for (const e of enemies) {
          sig += `e:${e.id}:${e.name}:${e.kind}:${Math.round((e.hp / Math.max(1, e.maxHp)) * 100)}:` +
            `${Math.round((e.posture / Math.max(1, e.maxPosture)) * 100)}:${e.action}:${e.attackKind}:` +
            `${e.isBlocking ? 1 : 0}:${e.telegraph}:${e.alive ? 1 : 0}:${e.team}:${e.combatArt}:${e.isBot ? 1 : 0}|`;
        }

        if (sig !== lastHudSigRef.current) {
          lastHudSigRef.current = sig;
          setWorld(snapshot);
        }
      });

      room.onMessage("combat_event", (ev: CombatEventPayload) => {
        const isSelfInvolved = ev.attackerId === room.sessionId || ev.targetId === room.sessionId;

        if (ev.kind === "swing") {
          soundEngine.playSwing(Boolean(ev.heavy), ev.moveKind);
          return;
        }

        if (ev.kind === "special_vfx" && ev.moveKind) {
          const delayMs =
            ev.moveKind === "heavy"
              ? 180
              : ev.moveKind === "thrust"
                ? 140
                : ev.moveKind === "punch"
                  ? 115
                  : ev.moveKind === "whirlwind"
                    ? 110
                    : ev.moveKind === "light1" || ev.moveKind === "light2"
                      ? 85
                      : 50;
          const duration =
            ev.moveKind === "whirlwind"
              ? 360
              : ev.moveKind === "thrust" || ev.moveKind === "aerial_slam"
                ? 340
                : ev.moveKind === "counter"
                  ? 340
                  : ev.moveKind === "heavy" || ev.moveKind === "punch"
                    ? 260
                    : 200;

          slashesRef.current.push({
            id: seqRef.current++,
            kind: ev.moveKind,
            attackerId: ev.attackerId,
            x: ev.x,
            y: ev.y,
            z: ev.z,
            yaw: ev.yaw ?? 0,
            createdAt: performance.now(),
            delayMs,
            durationMs: duration,
          });
          if (slashesRef.current.length > 12) slashesRef.current.shift();

          if (ev.attackerId === room.sessionId) {
            if (ev.moveKind === "counter") flashBanner("RIPOSTE!");
            else if (ev.moveKind === "aerial_slam") shakeRef.current = Math.max(shakeRef.current, 0.25);
          }
          return;
        }

        if (ev.kind === "pickup_collect") {
          if (ev.attackerId === room.sessionId) {
            soundEngine.playPickup();
          }
          const label = ev.powerUpKind ? POWER_UPS[ev.powerUpKind]?.label ?? ev.powerUpKind : "Item";
          pushFeed(`${ev.attackerName ?? "Gladiator"} collected ${label}`, "powerup");
          return;
        }

        if (ev.kind === "powerup_use") {
          soundEngine.playPowerUp(ev.powerUpKind);
          slashesRef.current.push({
            id: seqRef.current++,
            kind: "powerup",
            powerUpKind: ev.powerUpKind,
            attackerId: ev.attackerId,
            x: ev.x,
            y: ev.y,
            z: ev.z,
            yaw: ev.yaw ?? 0,
            createdAt: performance.now(),
            delayMs: 0,
            durationMs: 480,
          });
          if (slashesRef.current.length > 12) slashesRef.current.shift();
          const label = ev.powerUpKind ? POWER_UPS[ev.powerUpKind]?.label ?? ev.powerUpKind : "Power-Up";
          if (ev.attackerId === room.sessionId) flashBanner(label.toUpperCase());
          pushFeed(`${ev.attackerName ?? "Gladiator"} activated ${label}!`, "powerup");
          return;
        }

        if (ev.kind === "shadow_step") {
          soundEngine.playDodge();
          abilityVfxRef.current.push({
            id: seqRef.current++,
            kind: "shadow_step",
            x: ev.x,
            y: ev.y,
            z: ev.z,
            targetX: ev.targetX,
            targetY: ev.targetY,
            targetZ: ev.targetZ,
            createdAt: performance.now(),
          });
          if (abilityVfxRef.current.length > 24) abilityVfxRef.current.shift();
          return;
        }

        if (ev.kind === "spell_cast" || ev.kind === "stun_shot") {
          soundEngine.playPilumThrow();
          if (ev.kind === "stun_shot") {
            abilityVfxRef.current.push({
              id: seqRef.current++,
              kind: "stun_arc",
              x: ev.x,
              y: ev.y,
              z: ev.z,
              targetX: ev.x + Math.sin(ev.yaw ?? 0) * 6,
              targetY: ev.y,
              targetZ: ev.z + Math.cos(ev.yaw ?? 0) * 6,
              createdAt: performance.now(),
            });
            if (abilityVfxRef.current.length > 24) abilityVfxRef.current.shift();
          }
          return;
        }

        if (ev.kind === "projectile_explode") {
          abilityVfxRef.current.push({
            id: seqRef.current++,
            kind: ev.projectileKind === "arcane_orb" ? "arcane_explode" : "fireball_explode",
            x: ev.x,
            y: ev.y,
            z: ev.z,
            createdAt: performance.now(),
          });
          if (abilityVfxRef.current.length > 24) abilityVfxRef.current.shift();
          shakeRef.current = Math.max(shakeRef.current, 0.22);
          return;
        }

        if (ev.kind === "projectile_reflect") {
          if (ev.attackerId === room.sessionId) {
            flashBanner("SPELL REFLECTED!");
          }
          pushFeed("Projectile deflected back!", "deflect");
          return;
        }

        if (ev.kind === "shock_stun") {
          abilityVfxRef.current.push({
            id: seqRef.current++,
            kind: "shock_ring",
            x: ev.x,
            y: ev.y,
            z: ev.z,
            createdAt: performance.now(),
          });
          if (abilityVfxRef.current.length > 24) abilityVfxRef.current.shift();
          return;
        }

        if (ev.kind === "boss_trial_start") {
          soundEngine.playWaveStart(true);
          flashBanner((ev.waveTitle || `TRIAL ${ev.wave ?? 1}`).toUpperCase(), 2400);
          pushFeed(`${ev.waveTitle || "Boss Trial"} begins!`, "stagger");
          return;
        }

        if (ev.kind === "boss_trial_clear") {
          soundEngine.playWaveClear();
          flashBanner((ev.waveTitle || "TRIAL CLEARED!").toUpperCase(), 2600);
          pushFeed(`${ev.waveTitle || "Trial cleared"} (+60 HP restored)`, "powerup");
          return;
        }

        if (ev.kind === "ffa_win") {
          soundEngine.playWaveClear();
          flashBanner(`${(ev.winnerName ?? "GLADIATOR").toUpperCase()} WINS!`, 4000);
          pushFeed(`${ev.winnerName ?? "Gladiator"} reached ${ev.score ?? 10} points and won FFA!`, "powerup");
          return;
        }

        if (ev.kind === "wave_start") {
          const w = ev.wave ?? 1;
          soundEngine.playWaveStart(w >= 3);
          const title = ev.waveTitle || (ev.wave ? `Wave ${formatRomanWave(ev.wave)}` : "Wave Started");
          flashBanner(title.toUpperCase(), 2400);
          pushFeed(`${title} has begun!`, "gate");
          return;
        }

        if (ev.kind === "wave_clear") {
          soundEngine.playWaveClear();
          const waveTag = ev.wave ? `WAVE ${formatRomanWave(ev.wave)} CLEARED!` : "WAVE CLEARED!";
          const feedTitle = ev.waveTitle || (ev.wave ? `Wave ${formatRomanWave(ev.wave)}` : "Wave");
          flashBanner(waveTag, 2400);
          pushFeed(`${feedTitle} cleared! (+25 HP restored)`, "powerup");
          return;
        }

        if (ev.kind === "round_start") {
          soundEngine.playWaveStart(false);
          flashBanner(`ROUND ${ev.round ?? 1} — FIGHT!`, 1800);
          pushFeed(`3v3 Round ${ev.round ?? 1} of ${ev.maxRounds ?? 5} begins!`, "gate");
          return;
        }

        if (ev.kind === "round_end") {
          soundEngine.playWaveClear();
          const label =
            ev.teamWinner === "red"
              ? `RED WINS ROUND ${ev.round ?? 1}`
              : ev.teamWinner === "blue"
                ? `BLUE WINS ROUND ${ev.round ?? 1}`
                : `ROUND ${ev.round ?? 1} DRAW`;
          pushFeed(`${label} (${ev.redScore ?? 0}–${ev.blueScore ?? 0})`, "powerup");
          return;
        }

        if (ev.kind === "match_end") {
          soundEngine.playWaveClear();
          const label =
            ev.teamWinner === "red"
              ? "RED TEAM WINS THE MATCH!"
              : ev.teamWinner === "blue"
                ? "BLUE TEAM WINS THE MATCH!"
                : "MATCH DRAW!";
          pushFeed(`${label} (${ev.redScore ?? 0}–${ev.blueScore ?? 0})`, "powerup");
          return;
        }

        if (ev.kind === "gate_open") {
          soundEngine.playGateOpen();
          pushFeed(`${ev.attackerName ?? "A gladiator"} raised the North Gate!`, "gate");
          return;
        }

        if (ev.kind === "spawn_enemy") {
          soundEngine.playEnemySpawn();
          const spec = ev.enemyKind ? ENEMY_ARCHETYPES[ev.enemyKind] : undefined;
          const label = spec ? spec.name : "Skeleton Gladiator";
          pushFeed(
            spec?.isBoss ? `BOSS: ${label} enters the arena!` : `${label} enters the arena!`,
            spec?.isBoss ? "stagger" : "gate"
          );
          return;
        }

        if (
          ev.kind === "deflect" ||
          ev.kind === "block" ||
          ev.kind === "hit" ||
          ev.kind === "stagger" ||
          ev.kind === "evade"
        ) {
          if (!EXPERIMENTAL_SWORD_VFX_AND_HITBOX || ev.kind === "evade") {
            effectsRef.current.push({
              id: seqRef.current++,
              kind: ev.kind,
              x: ev.x,
              y: ev.y,
              z: ev.z,
              createdAt: performance.now(),
              heavy: ev.heavy,
            });
            if (effectsRef.current.length > 12) {
              effectsRef.current.shift();
            }
          }

          if (EXPERIMENTAL_SWORD_VFX_AND_HITBOX) {
            const burstKind =
              ev.kind === "hit" && ev.moveKind === "punch"
                ? "punch"
                : mapCombatEventToBurstKind(ev.kind);
            if (burstKind) {
              const yaw = ev.yaw ?? 0;
              enqueueCombatBurst(combatBurstsRef, {
                kind: burstKind,
                x: ev.x,
                y: ev.y,
                z: ev.z,
                swingDirX: Math.sin(yaw),
                swingDirZ: Math.cos(yaw),
                heavy: Boolean(ev.heavy),
                colorHex: getCombatImpactTint(ev.moveKind, worldRef.current.arenaMap),
              });
            }
          }
        }

        if (ev.kind === "deflect") {
          if (ev.targetId === room.sessionId || (ev.attackerId === room.sessionId && !ev.isPvP)) {
            soundEngine.playDeflect(Boolean(ev.heavy));
          }
          if (isSelfInvolved) {
            shakeRef.current = Math.max(shakeRef.current, ev.heavy ? 0.3 : 0.22);
            triggerHitStop(45);
            if (ev.targetId === room.sessionId) {
              flashBanner("DEFLECT! — COUNTER READY");
            }
          }
          pushFeed(
            `${ev.targetName ?? "Gladiator"} deflected ${ev.attackerName ?? "foe"}${ev.isPvP ? " (PvP)" : ""}!`,
            "deflect"
          );
        } else if (ev.kind === "block") {
          if (ev.targetId === room.sessionId || (ev.attackerId === room.sessionId && !ev.isPvP)) {
            soundEngine.playBlock();
          }
          if (isSelfInvolved) shakeRef.current = Math.max(shakeRef.current, 0.11);
        } else if (ev.kind === "evade") {
          soundEngine.playEvade();
        } else if (ev.kind === "hit") {
          soundEngine.playHit(Boolean(ev.heavy), ev.targetId === room.sessionId, ev.memeSfx);
          if (isSelfInvolved) {
            shakeRef.current = Math.max(shakeRef.current, ev.heavy ? 0.26 : 0.14);
            if (ev.heavy) triggerHitStop(35);
          }
        } else if (ev.kind === "stagger") {
          soundEngine.playStagger();
          if (isSelfInvolved) {
            shakeRef.current = Math.max(shakeRef.current, 0.34);
            triggerHitStop(55);
            flashBanner(ev.targetId === room.sessionId ? "POSTURE BROKEN!" : "STAGGERED — FINISH!");
          }
          pushFeed(`${ev.targetName ?? "Fighter"}'s posture broke!`, "stagger");
        } else if (ev.kind === "kill") {
          soundEngine.playKill(Boolean(ev.isPvP), ev.memeSfx);
          pushFeed(
            `${ev.attackerName ?? "Gladiator"} slew ${ev.targetName ?? "foe"}${ev.isPvP ? " (FRIENDLY FIRE)" : ""}`,
            ev.isPvP ? "pvp" : "kill"
          );
        }
      });

      room.onMessage(
        "experimental_art",
        (ev: {
          art: string;
          attackerId: string;
          attackerName?: string;
          x: number;
          y: number;
          z: number;
          yaw: number;
          preview?: boolean;
        }) => {
          if (!EXPERIMENTAL_SPECIAL_MOVES) return;
          if (!(ev.art in EXPERIMENTAL_ARTS)) return;
          const artKind = ev.art as ExperimentalArtKind;
          const spec = EXPERIMENTAL_ARTS[artKind];
          const nowPerf = performance.now();

          experimentalVfxRef.current.push({
            id: seqRef.current++,
            kind: artKind,
            casterId: ev.attackerId,
            x: ev.x,
            y: ev.y,
            z: ev.z,
            yaw: ev.yaw,
            createdAt: nowPerf,
          });
          if (experimentalVfxRef.current.length > 8) {
            experimentalVfxRef.current.shift();
          }

          const nonce = artNonceRef.current++;
          const expiresAt = Date.now() + spec.durationMs;
          setActiveExperimentalArts((prev) => ({
            ...prev,
            [ev.attackerId]: { kind: artKind, nonce, expiresAt },
          }));

          const prevTimer = artTimeoutsRef.current.get(ev.attackerId);
          if (prevTimer) window.clearTimeout(prevTimer);
          const nextTimer = window.setTimeout(() => {
            artTimeoutsRef.current.delete(ev.attackerId);
            setActiveExperimentalArts((prev) => {
              const cur = prev[ev.attackerId];
              if (!cur || cur.nonce !== nonce) return prev;
              const copy = { ...prev };
              delete copy[ev.attackerId];
              return copy;
            });
          }, spec.durationMs + 40);
          artTimeoutsRef.current.set(ev.attackerId, nextTimer);

          soundEngine.playCombatArt(artKind);
          if (ev.attackerId === room.sessionId) {
            shakeRef.current = Math.max(
              shakeRef.current,
              artKind === "mortal_draw_empowered" ? 0.34 : 0.24
            );
          }
        }
      );

      room.onLeave(() => {
        if (roomRef.current !== room) return;
        roomRef.current = null;
        resetRoomState();
        setConnected(false);
        setSessionId("");
      });
    },
    [flashBanner, pushFeed, resetRoomState]
  );

  const createArena = useCallback(
    async (playerName: string) => {
      soundEngine.unlock();
      setConnecting(true);
      setError(null);
      try {
        const client = new Client(getServerUrl());
        const room = await client.create("colosseum", {
          name: playerName.trim() || "Gladiator",
          protocolVersion: GAME_PROTOCOL_VERSION,
        });
        attachRoom(room);
      } catch (err) {
        setConnecting(false);
        setError(err instanceof Error ? err.message : "Failed to create arena. Is the server running?");
      }
    },
    [attachRoom]
  );

  const joinArena = useCallback(
    async (code: string, playerName: string) => {
      const clean = code.trim().toUpperCase();
      if (!clean) {
        setError("Enter a room code to join.");
        return;
      }
      soundEngine.unlock();
      setConnecting(true);
      setError(null);
      try {
        const client = new Client(getServerUrl());
        const room = await client.joinById(clean, {
          name: playerName.trim() || "Gladiator",
          protocolVersion: GAME_PROTOCOL_VERSION,
        });
        attachRoom(room);
      } catch (err) {
        setConnecting(false);
        setError(err instanceof Error ? err.message : `Could not join room "${clean}". Check the code.`);
      }
    },
    [attachRoom]
  );

  const leaveArena = useCallback(() => {
    soundEngine.stopMeme(0.1);
    const activeRoom = roomRef.current;
    roomRef.current = null;
    activeRoom?.leave();
    resetRoomState();
    setConnected(false);
    setSessionId("");
    setFeed([]);
  }, [resetRoomState]);

  const sendMove = useCallback((msg: MoveMessage) => {
    roomRef.current?.send("move", msg);
  }, []);

  const sendAttack = useCallback((msg: AttackMessage) => {
    roomRef.current?.send("attack", msg);
  }, []);

  const sendSpecial = useCallback((msg: SpecialMessage) => {
    roomRef.current?.send("special", msg);
  }, []);

  const sendUseItem = useCallback((msg: UseItemMessage) => {
    roomRef.current?.send("use_item", msg);
  }, []);

  const sendBlock = useCallback((msg: BlockMessage) => {
    roomRef.current?.send("block", msg);
  }, []);

  const sendDodge = useCallback((msg: DodgeMessage) => {
    roomRef.current?.send("dodge", msg);
  }, []);

  const sendInteractGate = useCallback(() => {
    roomRef.current?.send("interact_gate");
  }, []);

  const sendExperimentalArt = useCallback(
    (art: ExperimentalArtKind, yaw: number, preview: boolean) => {
      if (!EXPERIMENTAL_SPECIAL_MOVES) return;
      roomRef.current?.send("experimental_art", { art, yaw, preview });
    },
    []
  );

  const sendPlayerLoadout = useCallback((msg: PlayerLoadoutMessage) => {
    roomRef.current?.send("player_loadout", msg);
  }, []);

  const sendRespawnMode = useCallback((msg: RespawnModeMessage) => {
    roomRef.current?.send("respawn_mode", msg);
  }, []);

  const sendArenaMap = useCallback((msg: ArenaMapMessage) => {
    roomRef.current?.send("arena_map", msg);
  }, []);

  const sendGameMode = useCallback((mode: GameMode) => {
    roomRef.current?.send("game_mode", { mode });
  }, []);

  const sendJoinTeam = useCallback((team: TeamSide) => {
    roomRef.current?.send("join_team", { team });
  }, []);

  const sendTeamFillBots = useCallback((enabled: boolean) => {
    roomRef.current?.send("team_fill_bots", { enabled });
  }, []);

  const sendTeamStartMatch = useCallback(() => {
    roomRef.current?.send("team_start_match");
  }, []);

  const sendTeamRematch = useCallback(() => {
    roomRef.current?.send("team_rematch");
  }, []);

  const castSelectedArt = useCallback((msg: CastSelectedArtMessage) => {
    roomRef.current?.send("cast_selected_art", msg);
  }, []);

  const sendCastAbility = useCallback((msg: CastAbilityMessage) => {
    roomRef.current?.send("cast_ability", msg);
  }, []);

  const sendFfaStartMatch = useCallback(() => {
    roomRef.current?.send("ffa_start_match");
  }, []);

  const sendToggleInfiniteHealth = useCallback((enabled: boolean) => {
    roomRef.current?.send("toggle_infinite_health", { enabled });
  }, []);

  const sendPartyChat = useCallback((text: string) => {
    const cleanText = text.trim().slice(0, 220);
    if (cleanText) roomRef.current?.send("party_chat", { text: cleanText });
  }, []);

  useEffect(() => {
    return () => {
      if (bannerTimeoutRef.current !== null) {
        window.clearTimeout(bannerTimeoutRef.current);
        bannerTimeoutRef.current = null;
      }
      clearExperimentalArtTimers();
      const activeRoom = roomRef.current;
      roomRef.current = null;
      activeRoom?.leave();
    };
  }, [clearExperimentalArtTimers]);

  return {
    connected,
    connecting,
    error,
    sessionId,
    pingMs,
    world,
    worldRef,
    feed,
    deflectBanner,
    chatMessages,
    effectsRef,
    slashesRef,
    abilityVfxRef,
    experimentalVfxRef,
    combatBurstsRef,
    activeExperimentalArts,
    shakeRef,
    createArena,
    joinArena,
    leaveArena,
    sendMove,
    sendAttack,
    sendSpecial,
    sendUseItem,
    sendBlock,
    sendDodge,
    sendInteractGate,
    sendExperimentalArt,
    sendPlayerLoadout,
    sendRespawnMode,
    sendArenaMap,
    sendGameMode,
    sendJoinTeam,
    sendTeamFillBots,
    sendTeamStartMatch,
    sendTeamRematch,
    castSelectedArt,
    sendCastAbility,
    sendFfaStartMatch,
    sendToggleInfiniteHealth,
    sendPartyChat,
  };
}

function getCombatImpactTint(kind: string | undefined, map: RoomWorldSnapshot["arenaMap"]): string {
  if (kind === "punch" || kind === "one_mind") return "#ff8a3d";
  if (kind === "sakura_dance" || kind === "ashina_cross") return "#ff58bd";
  if (kind === "mortal_draw" || kind === "mortal_draw_empowered") return "#ff315e";
  if (kind === "ichimonji" || kind === "ichimonji_double" || kind === "counter") return "#ffe36e";
  if (kind === "dragon_flash" || kind === "thrust") return "#6ee7ff";
  if (kind === "whirlwind" || kind === "whirlwind_slash" || kind === "floating_passage") return "#56ffe0";
  if (kind === "nightjar_slash" || kind === "shadowrush") return "#bd82ff";
  if (kind === "aerial_slam" || kind === "high_monk") return "#9effd1";
  return ARENA_MAPS[map].accent;
}
