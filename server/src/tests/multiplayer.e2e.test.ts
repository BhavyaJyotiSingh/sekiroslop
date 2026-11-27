import assert from "node:assert/strict";
import { Client, type Room } from "@colyseus/sdk";
import {
  ARENA,
  COMBAT,
  GAME_PROTOCOL_VERSION,
  getWavePlan,
  type CombatEventPayload,
  type PowerUpKind,
} from "@sekiroslop/shared";

interface ExperimentalArtBroadcast {
  art: string;
  attackerId: string;
  attackerName: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  preview: boolean;
}

const SERVER_URL = process.env.SERVER_URL || "ws://localhost:2567";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const moveSequences = new WeakMap<Room, number>();

function sendMove(
  room: Room,
  moveX: number,
  moveZ: number,
  yaw: number,
  jumpPressed = false,
  jumpHeld = false
): void {
  const sequence = (moveSequences.get(room) ?? 0) + 1;
  moveSequences.set(room, sequence);
  room.send("move", { sequence, moveX, moveZ, jumpPressed, jumpHeld, yaw });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getPlayer(room: Room, sessionId: string): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (room.state as any).players.get(sessionId);
}

/** Walks a player client smoothly toward (targetX, targetZ), steering gently around pillars if needed. */
async function walkTo(
  room: Room,
  targetX: number,
  targetZ: number,
  stopDist = 0.85,
  maxSteps = 120
): Promise<void> {
  const start = getPlayer(room, room.sessionId);
  let curX: number = start.x;
  let curZ: number = start.z;

  for (let i = 0; i < maxSteps; i++) {
    const p = getPlayer(room, room.sessionId);
    // Sync to server-authoritative position if clamped/pushed by a pillar or player
    if (Math.hypot(p.x - curX, p.z - curZ) > 0.65) {
      curX = p.x;
      curZ = p.z;
    }

    const dx = targetX - curX;
    const dz = targetZ - curZ;
    const dist = Math.hypot(dx, dz);
    if (dist <= stopDist) break;

    let dirX = dx / dist;
    let dirZ = dz / dist;

    // Simple obstacle slide if next point enters a pillar plinth
    for (const pillar of ARENA.PILLARS) {
      const half = pillar.radius * 1.08 + ARENA.ENTITY_RADIUS + 0.25;
      if (
        Math.abs(curX + dirX * 0.42 - pillar.x) < half &&
        Math.abs(curZ + dirZ * 0.42 - pillar.z) < half
      ) {
        // Detour perpendicular to the pillar
        const perpX = -dz / dist;
        const perpZ = dx / dist;
        dirX = perpX;
        dirZ = perpZ;
        break;
      }
    }

    curX += dirX * 0.42;
    curZ += dirZ * 0.42;
    sendMove(room, dirX, dirZ, Math.atan2(dx, dz));
    await sleep(50);
  }
  const end = getPlayer(room, room.sessionId);
  sendMove(room, 0, 0, Math.atan2(targetX - end.x, targetZ - end.z));
  await sleep(80);
}

async function runMultiplayerE2E() {
  const client1 = new Client(SERVER_URL);
  const client2 = new Client(SERVER_URL);

  // 1. Player 1 creates arena and gets Presence-allocated 4-char room code + seeded pickups
  const room1 = await client1.create("colosseum", {
    name: "Marcus",
    protocolVersion: GAME_PROTOCOL_VERSION,
  });
  const events1: CombatEventPayload[] = [];
  const artEvents1: ExperimentalArtBroadcast[] = [];
  room1.onMessage("combat_event", (ev: CombatEventPayload) => events1.push(ev));
  room1.onMessage("experimental_art", (ev: ExperimentalArtBroadcast) => artEvents1.push(ev));

  await sleep(140);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const code = (room1.state as any).roomCode || room1.roomId;
  assert.equal(code.length, 4, `Expected 4-char room code, got "${code}"`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const initialPickupCount = (room1.state as any).pickups.size;
  assert.ok(initialPickupCount >= 1, `Expected initial arena pickups, got ${initialPickupCount}`);
  console.log(`[e2e] Player 1 created room ${code} (${initialPickupCount} arena pickups seeded)`);

  // 2. Player 2 joins the exact same arena via room code
  const room2 = await client2.joinById(code, {
    name: "Brutus",
    protocolVersion: GAME_PROTOCOL_VERSION,
  });
  const events2: CombatEventPayload[] = [];
  const artEvents2: ExperimentalArtBroadcast[] = [];
  room2.onMessage("combat_event", (ev: CombatEventPayload) => events2.push(ev));
  room2.onMessage("experimental_art", (ev: ExperimentalArtBroadcast) => artEvents2.push(ev));

  await sleep(160);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assert.equal((room1.state as any).players.size, 2, "Room 1 should see 2 connected players");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assert.equal((room2.state as any).players.size, 2, "Room 2 should see 2 connected players");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assert.equal((room2.state as any).pickups.size, initialPickupCount, "Room 2 should see identical pickups");
  console.log(`[e2e] Player 2 joined room ${code}; both clients synced 2 players & ${initialPickupCount} pickups`);

  // 3. Solid Entity Separation: walk Player 2 directly into Player 1's XZ (-3, 10)
  for (let i = 0; i < 12; i += 1) {
    sendMove(room2, -1, 0, -Math.PI / 2);
    await sleep(50);
  }
  sendMove(room2, 0, 0, -Math.PI / 2);
  await sleep(160);

  const p1Sep = getPlayer(room1, room1.sessionId);
  const p2Sep = getPlayer(room1, room2.sessionId);
  const sepDist = Math.hypot(p2Sep.x - p1Sep.x, p2Sep.z - p1Sep.z);
  assert.ok(
    sepDist >= ARENA.ENTITY_RADIUS * 2 - 0.05,
    `Players must NOT overlap at same XZ (expected >= ${ARENA.ENTITY_RADIUS * 2 - 0.05}, got ${sepDist.toFixed(3)})`
  );
  console.log(`[e2e] Solid entity separation verified: dist=${sepDist.toFixed(2)}m (no overlap)`);

  // Ensure Marcus faces East (+PI/2) toward Brutus, and Brutus faces West (-PI/2) toward Marcus
  sendMove(room1, 0, 0, Math.PI / 2);
  sendMove(room2, 0, 0, -Math.PI / 2);
  await sleep(100);

  // 4. PvP Permanent Friendly Fire — Direct Hit
  room2.send("attack", { kind: "light", yaw: -Math.PI / 2 });
  await sleep(600);
  const p1AfterHit = getPlayer(room1, room1.sessionId);
  assert.ok(p1AfterHit.hp < 100, `Expected friendly fire damage on Marcus, hp=${p1AfterHit.hp}`);
  console.log(`[e2e] Friendly fire verified: Marcus HP dropped to ${p1AfterHit.hp}/100`);

  // 5. PvP Timed Deflection + Riposte Counterattack Window
  const hpBeforeDeflect = p1AfterHit.hp;
  const p2HpBeforeCounter = getPlayer(room2, room2.sessionId).hp;
  room2.send("attack", { kind: "light", yaw: -Math.PI / 2 });
  await sleep(85); // Light windup is 160ms -> raise block at +85ms so impact is ~80ms after blockStart (<= 240ms!)
  room1.send("block", { active: true, yaw: Math.PI / 2 });
  await sleep(190); // Impact has now landed inside active window; still well inside 800ms counter window!

  const deflectEv = events1.find((e) => e.kind === "deflect" && e.isPvP);
  assert.ok(deflectEv, "Expected PvP perfect deflect combat_event");
  const p1AtDeflect = getPlayer(room1, room1.sessionId);
  const p2AtDeflect = getPlayer(room2, room2.sessionId);
  assert.equal(p1AtDeflect.hp, hpBeforeDeflect, "Deflected strike must deal 0 HP damage");
  assert.ok(p2AtDeflect.posture > 20, `Deflected attacker posture should spike, got ${p2AtDeflect.posture}`);
  assert.ok(
    p1AtDeflect.counterReadyMs > 0,
    `Perfect deflect must open Riposte counterReadyMs window, got ${p1AtDeflect.counterReadyMs}`
  );

  // Release block & immediately strike back to execute Riposte Counter!
  room1.send("block", { active: false, yaw: Math.PI / 2 });
  room1.send("attack", { kind: "light", yaw: Math.PI / 2 });
  await sleep(500);

  const counterHitEv = events1.find((e) => e.kind === "hit" && e.moveKind === "counter");
  const p2AfterCounter = getPlayer(room2, room2.sessionId);
  assert.ok(counterHitEv, "Expected Riposte Counter hit event (moveKind='counter')");
  assert.ok(
    p2AfterCounter.hp < p2HpBeforeCounter,
    `Riposte Counter should damage Brutus (${p2AfterCounter.hp} < ${p2HpBeforeCounter})`
  );
  console.log(
    `[e2e] PvP Perfect Deflect + Riposte Counter verified: 0 HP lost on deflect, counter hit Brutus -> ${p2AfterCounter.hp}/100 HP`
  );

  // 6. Special Moves: Whirlwind 360° AoE, Imperial Thrust guard chip, Dash Slash
  // 6a. Whirlwind: Marcus faces AWAY (West, -PI/2) while Brutus is East — 360° AoE still hits Brutus!
  const p2HpBeforeWW = p2AfterCounter.hp;
  room1.send("special", { kind: "whirlwind", yaw: -Math.PI / 2 });
  await sleep(820);
  const p1AfterWW = getPlayer(room1, room1.sessionId);
  const p2AfterWW = getPlayer(room2, room2.sessionId);
  assert.ok(p1AfterWW.whirlwindCdMs > 0, "Whirlwind must start cooldown");
  assert.ok(
    p2AfterWW.hp < p2HpBeforeWW,
    `Whirlwind 360° AoE must hit Brutus behind Marcus (${p2AfterWW.hp} < ${p2HpBeforeWW})`
  );
  console.log(`[e2e] Whirlwind 360° AoE verified: hit behind attacker, Brutus HP -> ${p2AfterWW.hp}/100`);

  // 6b. Imperial Thrust guard chip: wait if Brutus was posture-broken by deflect+counter+whirlwind
  for (let i = 0; i < 40; i++) {
    if (getPlayer(room2, room2.sessionId).action !== "staggered") break;
    await sleep(100);
  }
  // Step Brutus slightly East so thrust lunges cleanly into Marcus's held block
  await walkTo(room2, p1AfterWW.x + 2.2, p1AfterWW.z, 0.35, 25);
  room1.send("block", { active: true, yaw: Math.PI / 2 });
  await sleep(320); // Past 240ms deflect window -> standard block
  const p1HpBeforeThrust = getPlayer(room1, room1.sessionId).hp;
  room2.send("special", { kind: "thrust", yaw: -Math.PI / 2 });
  await sleep(600);
  room1.send("block", { active: false, yaw: Math.PI / 2 });

  const thrustBlockEv = events1.find((e) => e.kind === "block" && e.moveKind === "thrust");
  const p1AfterThrust = getPlayer(room1, room1.sessionId);
  const p2AfterThrust = getPlayer(room2, room2.sessionId);
  assert.ok(p2AfterThrust.thrustCdMs > 0, "Imperial Thrust must start cooldown");
  assert.ok(thrustBlockEv && (thrustBlockEv.damage ?? 0) > 0, "Imperial Thrust must chip through standard block");
  assert.ok(
    p1AfterThrust.hp < p1HpBeforeThrust,
    `Marcus HP should drop from Thrust guard chip (${p1AfterThrust.hp} < ${p1HpBeforeThrust})`
  );
  console.log(
    `[e2e] Imperial Thrust guard chip verified: chip=${thrustBlockEv.damage}, Marcus HP -> ${p1AfterThrust.hp}/100`
  );

  // 6c. 2.5x Dodge Step range check
  await sleep(300);
  const beforeDodgeX = getPlayer(room2, room2.sessionId).x;
  room2.send("dodge", { dirX: 1, dirZ: 0, yaw: Math.PI / 2 });
  await sleep(420);
  const afterDodgeX = getPlayer(room2, room2.sessionId).x;
  const dodgeDist = Math.abs(afterDodgeX - beforeDodgeX);
  assert.ok(dodgeDist >= 5.0, `Expected long 2.5x dodge step >= 5m, got ${dodgeDist.toFixed(2)}m`);
  console.log(`[e2e] 2.5x Dodge Step verified (distance=${dodgeDist.toFixed(2)}m)`);

  // 6d. Experimental Combat Arts — broadcast sync, preview=true (0 damage) & preview=false (real PvP damage)
  for (let i = 0; i < 30; i++) {
    if (
      getPlayer(room1, room1.sessionId).action !== "staggered" &&
      getPlayer(room2, room2.sessionId).action !== "staggered"
    ) {
      break;
    }
    await sleep(100);
  }
  const p1ForArt = getPlayer(room1, room1.sessionId);
  await walkTo(room2, p1ForArt.x + 2.1, p1ForArt.z, 0.45, 50);
  room1.send("block", { active: false, yaw: Math.PI / 2 });
  room2.send("block", { active: false, yaw: -Math.PI / 2 });
  await sleep(120);

  // Preview mode: sakura_dance must sync broadcast to both clients and deal 0 HP damage
  const p2HpBeforePreview = getPlayer(room2, room2.sessionId).hp;
  const artCount1Before = artEvents1.length;
  const artCount2Before = artEvents2.length;
  room1.send("experimental_art", { art: "sakura_dance", yaw: Math.PI / 2, preview: true });
  await sleep(1250); // Past all 3 sakura_dance pulse windows [350, 720, 1100]
  const previewBroadcast1 = artEvents1.slice(artCount1Before).find((e) => e.art === "sakura_dance" && e.preview === true);
  const previewBroadcast2 = artEvents2.slice(artCount2Before).find((e) => e.art === "sakura_dance" && e.preview === true);
  assert.ok(previewBroadcast1, "Client 1 must receive experimental_art preview broadcast");
  assert.ok(previewBroadcast2, "Client 2 must receive experimental_art preview broadcast");
  assert.equal(previewBroadcast2.attackerId, room1.sessionId);
  assert.equal(
    getPlayer(room2, room2.sessionId).hp,
    p2HpBeforePreview,
    "experimental_art with preview=true must deal 0 HP damage"
  );
  console.log(`[e2e] Experimental Art preview=true verified: sakura_dance synced to both clients with 0 damage`);

  // Live mode (preview=false): sakura_dance must sync broadcast and deal real server-authoritative PvP damage
  const p2HpBeforeArtDmg = getPlayer(room2, room2.sessionId).hp;
  const liveArt1Before = artEvents1.length;
  const liveArt2Before = artEvents2.length;
  room1.send("experimental_art", { art: "sakura_dance", yaw: Math.PI / 2, preview: false });
  await sleep(600); // First pulse fires at 350ms (22 dmg, 3.8m 360° AoE)
  const liveBroadcast1 = artEvents1.slice(liveArt1Before).find((e) => e.art === "sakura_dance" && e.preview === false);
  const liveBroadcast2 = artEvents2.slice(liveArt2Before).find((e) => e.art === "sakura_dance" && e.preview === false);
  assert.ok(liveBroadcast1, "Client 1 must receive experimental_art live broadcast");
  assert.ok(liveBroadcast2, "Client 2 must receive experimental_art live broadcast");
  const p2AfterSakura = getPlayer(room2, room2.sessionId);
  assert.ok(
    p2AfterSakura.hp < p2HpBeforeArtDmg,
    `sakura_dance (preview=false) must deal real PvP damage (${p2AfterSakura.hp} < ${p2HpBeforeArtDmg})`
  );
  console.log(
    `[e2e] Experimental Art preview=false (PvP sakura_dance) verified: Brutus HP ${p2HpBeforeArtDmg} -> ${p2AfterSakura.hp}`
  );

  // Wait for remaining sakura_dance pulses to finish so they don't interfere with later steps
  await sleep(650);

  // 7. Shared Power-Up Pickup Collection & Usage synced across both clients
  // Pick the closest spawned arena pickup to Marcus
  const p1Cur = getPlayer(room1, room1.sessionId);
  let targetPickup: { id: string; kind: PowerUpKind; x: number; z: number } | null = null;
  let bestDist = Infinity;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (room1.state as any).pickups.forEach((pu: any, pid: string) => {
    const d = Math.hypot(pu.x - p1Cur.x, pu.z - p1Cur.z);
    if (d < bestDist) {
      bestDist = d;
      targetPickup = { id: pid, kind: pu.kind as PowerUpKind, x: pu.x, z: pu.z };
    }
  });
  assert.ok(targetPickup, "Expected at least one arena pickup to collect");
  const chosenPickup = targetPickup as { id: string; kind: PowerUpKind; x: number; z: number };

  await walkTo(room1, chosenPickup.x, chosenPickup.z, 0.9, 130);
  await sleep(180);

  // Verify shared removal on BOTH clients!
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assert.equal((room1.state as any).pickups.has(chosenPickup.id), false, "Collected pickup must be removed on client 1");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assert.equal((room2.state as any).pickups.has(chosenPickup.id), false, "Collected pickup must be removed on client 2");
  const p1WithItem = getPlayer(room1, room1.sessionId);
  assert.equal(p1WithItem.slot0Kind, chosenPickup.kind, "Collected item must appear in belt slot 0");
  assert.ok(p1WithItem.slot0Charges >= 1, "Collected item must have >= 1 charge");
  assert.ok(
    events2.some((e) => e.kind === "pickup_collect" && e.powerUpKind === chosenPickup.kind),
    "Client 2 must receive pickup_collect event"
  );
  console.log(`[e2e] Shared pickup collection verified: ${chosenPickup.kind} removed on both clients`);

  // Use the collected item from slot 0 and verify its authoritative effect
  const hpBeforeItem = p1WithItem.hp;
  const chargesBeforeItem = p1WithItem.slot0Charges;
  room1.send("use_item", { slotIndex: 0, yaw: 0 });
  await sleep(220);

  const p1AfterItem = getPlayer(room1, room1.sessionId);
  assert.equal(
    p1AfterItem.slot0Charges,
    chargesBeforeItem - 1,
    "Using item must consume 1 charge"
  );
  if (chosenPickup.kind === "healing_flask") {
    assert.ok(
      p1AfterItem.hp > hpBeforeItem || hpBeforeItem === COMBAT.PLAYER_MAX_HP,
      "Healing Flask must restore HP"
    );
  } else if (chosenPickup.kind === "warriors_fury") {
    assert.ok(p1AfterItem.furyMs > 0, "Warrior's Fury must activate furyMs");
  } else if (chosenPickup.kind === "iron_will") {
    assert.ok(p1AfterItem.ironWillMs > 0, "Iron Will must activate ironWillMs");
  } else if (chosenPickup.kind === "swift_feet") {
    assert.ok(p1AfterItem.swiftFeetMs > 0, "Swift Feet must activate swiftFeetMs");
  } else if (chosenPickup.kind === "posture_tonic") {
    assert.ok(p1AfterItem.tonicMs > 0 && p1AfterItem.posture === 0, "Posture Tonic must activate tonicMs & clear posture");
  } else if (chosenPickup.kind === "pilum") {
    assert.ok(
      events2.some((e) => e.kind === "pilum_throw"),
      "Throwing Pilum must broadcast pilum_throw to both clients"
    );
  }
  console.log(`[e2e] Power-up use verified for ${chosenPickup.kind}`);

  // 8. Walk Player 1 to the North Gladiator Gate Lever -> Progressive Wave 1 & staggered spawning
  await walkTo(room1, ARENA.NORTH_GATE.leverX, ARENA.NORTH_GATE.leverZ, 1.2, 160);
  room1.send("interact_gate");
  await sleep(450);

  const expectedWave1 = getWavePlan(1);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const state1 = room1.state as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const state2 = room2.state as any;

  assert.equal(state1.northGate.open, true, "North gate should open after pulling lever");
  assert.equal(state1.wave, 1, "Pulling lever must start Wave 1 on client 1");
  assert.equal(state2.wave, 1, "Wave 1 must sync to client 2");
  assert.equal(state1.waveActive, true, "waveActive must be true on client 1");
  assert.equal(state2.waveActive, true, "waveActive must be true on client 2");
  assert.equal(state1.waveTitle, expectedWave1.title, `Expected waveTitle "${expectedWave1.title}", got "${state1.waveTitle}"`);
  assert.equal(state2.waveTitle, expectedWave1.title, "waveTitle must sync to client 2");
  assert.equal(state1.totalEnemiesInWave, 3, "Wave 1 totalEnemiesInWave must be 3");
  assert.equal(state2.totalEnemiesInWave, 3, "Wave 1 totalEnemiesInWave must sync to client 2");
  assert.equal(state1.enemiesRemaining, 3, "Wave 1 enemiesRemaining must start at 3");
  assert.equal(state2.enemiesRemaining, 3, "Wave 1 enemiesRemaining must sync to client 2");
  assert.ok(
    events1.some((e) => e.kind === "wave_start" && e.wave === 1 && e.waveTitle === expectedWave1.title),
    "Client 1 must receive wave_start combat_event"
  );
  assert.ok(
    events2.some((e) => e.kind === "wave_start" && e.wave === 1 && e.waveTitle === expectedWave1.title),
    "Client 2 must receive wave_start combat_event"
  );
  assert.equal(state1.enemies.size, 1, "Wave 1 should stagger spawning (only 1st enemy spawned immediately)");
  assert.equal(state2.enemies.size, 1, "Initial Wave 1 enemy must sync to client 2");

  // Pulling lever again while Wave 1 is active must NOT start Wave 2 prematurely
  room1.send("interact_gate");
  await sleep(250);
  assert.equal(state1.wave, 1, "Pulling lever during active Wave 1 must NOT advance to Wave 2");
  assert.equal(state2.wave, 1, "Client 2 must still be on Wave 1 after duplicate lever pull");
  assert.equal(state1.northGate.activations, 1, "Gate activations must stay 1 while Wave 1 is active");
  assert.equal(state1.totalEnemiesInWave, 3, "totalEnemiesInWave must remain 3");

  // Wait for staggered Wave 1 spawns (2 Skirmishers + 1 Legionary) to finish emerging
  let wave1Kinds1: string[] = [];
  let wave1Kinds2: string[] = [];
  for (let i = 0; i < 38; i++) {
    if (state1.enemies.size >= 3 && state2.enemies.size >= 3) break;
    await sleep(100);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state1.enemies.forEach((e: any) => wave1Kinds1.push(e.kind));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state2.enemies.forEach((e: any) => wave1Kinds2.push(e.kind));
  assert.deepEqual(
    wave1Kinds1.sort(),
    ["legionary", "skirmisher", "skirmisher"],
    `Wave 1 must spawn 2 skirmishers & 1 legionary on client 1, got [${wave1Kinds1.join(", ")}]`
  );
  assert.deepEqual(
    wave1Kinds2.sort(),
    ["legionary", "skirmisher", "skirmisher"],
    `Wave 1 archetypes must sync identically to client 2, got [${wave1Kinds2.join(", ")}]`
  );
  console.log(
    `[e2e] Progressive Wave 1 verified: "${state1.waveTitle}", remaining=${state1.enemiesRemaining}/${state1.totalEnemiesInWave}, staggered [${wave1Kinds1.join(", ")}]`
  );

  // 9. Experimental Combat Art (mortal_draw, preview=false) real PvE damage & broadcast sync
  // Use whichever player is alive (or wait briefly for respawn if needed)
  let pveRoom = room1;
  if (!getPlayer(room1, room1.sessionId).alive) {
    if (getPlayer(room2, room2.sessionId).alive) {
      pveRoom = room2;
    } else {
      for (let i = 0; i < 50; i++) {
        if (getPlayer(room1, room1.sessionId).alive) {
          pveRoom = room1;
          break;
        }
        if (getPlayer(room2, room2.sessionId).alive) {
          pveRoom = room2;
          break;
        }
        await sleep(120);
      }
    }
  }
  const pvePlayer = getPlayer(pveRoom, pveRoom.sessionId);
  let targetEnemy: { id: string; kind: string; x: number; z: number; hp: number } | null = null;
  let closestEnemyDist = Infinity;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (pveRoom.state as any).enemies.forEach((e: any, eid: string) => {
    if (!e.alive) return;
    const d = Math.hypot(e.x - pvePlayer.x, e.z - pvePlayer.z);
    if (d < closestEnemyDist) {
      closestEnemyDist = d;
      targetEnemy = { id: eid, kind: e.kind, x: e.x, z: e.z, hp: e.hp };
    }
  });
  assert.ok(targetEnemy, "Expected a living Wave 1 enemy for Mortal Draw PvE test");
  const chosenEnemy = targetEnemy as { id: string; kind: string; x: number; z: number; hp: number };
  if (closestEnemyDist > 3.6) {
    await walkTo(pveRoom, chosenEnemy.x, chosenEnemy.z, 2.8, 80);
  }
  const pveNow = getPlayer(pveRoom, pveRoom.sessionId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const enemyBeforeMortal = (pveRoom.state as any).enemies.get(chosenEnemy.id);
  const enemyHpBeforeMortal = enemyBeforeMortal.hp;
  const yawToEnemy = Math.atan2(enemyBeforeMortal.x - pveNow.x, enemyBeforeMortal.z - pveNow.z);

  const md1Before = artEvents1.length;
  const md2Before = artEvents2.length;
  pveRoom.send("experimental_art", { art: "mortal_draw", yaw: yawToEnemy, preview: false });
  await sleep(650); // Mortal Draw pulse triggers at 460ms (5.2m range, 52 dmg / 14 guard chip)

  const mdBroadcast1 = artEvents1.slice(md1Before).find((e) => e.art === "mortal_draw" && e.preview === false);
  const mdBroadcast2 = artEvents2.slice(md2Before).find((e) => e.art === "mortal_draw" && e.preview === false);
  assert.ok(mdBroadcast1, "Client 1 must receive mortal_draw experimental_art broadcast");
  assert.ok(mdBroadcast2, "Client 2 must receive mortal_draw experimental_art broadcast");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const enemyAfterMortal = (pveRoom.state as any).enemies.get(chosenEnemy.id);
  assert.ok(
    !enemyAfterMortal || enemyAfterMortal.hp < enemyHpBeforeMortal,
    `mortal_draw (preview=false) must deal real PvE damage to ${chosenEnemy.kind} (${enemyAfterMortal?.hp} < ${enemyHpBeforeMortal})`
  );
  console.log(
    `[e2e] Experimental Art preview=false (PvE mortal_draw) verified: ${chosenEnemy.kind} HP ${enemyHpBeforeMortal} -> ${enemyAfterMortal?.hp ?? 0}`
  );

  await room1.leave();
  await room2.leave();
  console.log("ALL LIVE MULTIPLAYER WEBSOCKET E2E TESTS PASSED!");
}

runMultiplayerE2E().catch((err) => {
  console.error("[e2e FAIL]", err);
  process.exit(1);
});
