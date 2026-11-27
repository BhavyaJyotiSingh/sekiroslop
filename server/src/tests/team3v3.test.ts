import assert from "node:assert/strict";
import { COMBAT, type CombatEventPayload } from "@sekiroslop/shared";
import { ColosseumRoom } from "../rooms/ColosseumRoom.js";
import { ColosseumState, PickupState } from "../schema/ColosseumState.js";
import {
  ALL_COMBAT_ART_KINDS,
  TEAM_3V3_INTERMISSION_MS,
  TEAM_3V3_MAX_ROUNDS,
  TEAM_3V3_SIZE,
  pickRandomCombatArt,
} from "../rooms/team3v3.js";
import { resolveMeleeSwing, type AttackRuntime } from "../combat/CombatEngine.js";

async function runTeam3v3Tests() {
  // 1. Room capacity allows 6 human players & 3v3 mode auto-balances teams
  const room = new ColosseumRoom();
  assert.equal(room.maxClients, 6, "ColosseumRoom must allow up to 6 human players for 3v3");
  room.setState(new ColosseumState());

  const broadcasted: Array<{ type: string; payload: unknown }> = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (room as any).broadcast = (type: string, payload: unknown) => {
    broadcasted.push({ type, payload });
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c1 = { sessionId: "h1" } as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c2 = { sessionId: "h2" } as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c3 = { sessionId: "h3" } as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c4 = { sessionId: "h4" } as any;

  room.onJoin(c1, { name: "HostRed" });
  room.onJoin(c2, { name: "AllyOrFoe" });

  // Non-host cannot switch game mode
  assert.equal(room.team3v3.setGameMode("h2", "team_3v3"), false, "Only host may switch game mode");
  // Host switches to 3v3
  assert.equal(room.team3v3.setGameMode("h1", "team_3v3"), true, "Host should switch to 3v3 mode");
  assert.equal(room.state.gameMode, "team_3v3");
  assert.equal(room.state.players.get("h1")?.team, "red");
  assert.equal(room.state.players.get("h2")?.team, "blue");

  // Player can switch team before match starts (max 3 per team)
  assert.equal(room.team3v3.joinTeam("h2", "red"), true, "Player should be able to join Red");
  assert.equal(room.state.players.get("h2")?.team, "red");

  // Auto-balance on join when in 3v3 mode
  room.onJoin(c3, { name: "BlueOne" });
  assert.equal(room.state.players.get("h3")?.team, "blue", "3rd player should auto-balance to Blue");
  room.onJoin(c4, { name: "BlueTwo" });
  assert.equal(room.state.players.get("h4")?.team, "blue", "4th player should auto-balance to Blue");

  // 2. AI Bot Fill up to 3v3 + random Combat Art assignment
  assert.equal(room.state.teamFillBots, true, "Fill with AI Bots defaults to true");
  assert.equal(room.team3v3.startMatch("h2"), false, "Non-host cannot start match");
  assert.equal(room.team3v3.startMatch("h1", 10000), true, "Host starts 5-round 3v3 match");
  assert.equal(room.state.teamMatchActive, true);
  assert.equal(room.state.teamRoundActive, true);
  assert.equal(room.state.teamRound, 1);
  assert.equal(room.state.teamMaxRounds, TEAM_3V3_MAX_ROUNDS);

  // 2 red humans + 1 red bot = 3; 2 blue humans + 1 blue bot = 3
  const redBots = Array.from(room.team3v3.bots.values()).filter((b) => b.team === "red");
  const blueBots = Array.from(room.team3v3.bots.values()).filter((b) => b.team === "blue");
  assert.equal(redBots.length, TEAM_3V3_SIZE - 2, "Red team should be filled with 1 AI bot");
  assert.equal(blueBots.length, TEAM_3V3_SIZE - 2, "Blue team should be filled with 1 AI bot");

  const validArts = new Set<string>(ALL_COMBAT_ART_KINDS);
  assert.equal(ALL_COMBAT_ART_KINDS.length, 9, "All 9 selectable Sekiro Combat Arts must be available for bots");
  for (const bot of room.team3v3.bots.values()) {
    assert.ok(validArts.has(bot.combatArt), `Bot combatArt '${bot.combatArt}' must be in 9-art list`);
    const es = room.state.enemies.get(bot.entity.id);
    assert.ok(es && es.isBot && es.team === bot.team && es.combatArt === bot.combatArt);
    assert.equal(bot.entity.hp, COMBAT.PLAYER_MAX_HP);
  }
  assert.ok(validArts.has(pickRandomCombatArt(() => 0.5)));

  // 3. No friendly fire on same team in 3v3, while opposing team takes damage
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rts = (room as any).playerRuntimes;
  const h1Rt = rts.get("h1");
  const h2Rt = rts.get("h2");
  const h3Rt = rts.get("h3");
  h1Rt.entity.x = 0;
  h1Rt.entity.z = 0;
  h1Rt.entity.yaw = 0;
  h2Rt.entity.x = 0;
  h2Rt.entity.z = 1.6; // same team (red)
  h3Rt.entity.x = 0.2;
  h3Rt.entity.z = 1.8; // opposing team (blue)
  const atk: AttackRuntime = { kind: "light1", startedAt: 10000, hitIds: new Set() };
  const swingEvents = resolveMeleeSwing(
    h1Rt.entity,
    atk,
    [h1Rt.entity, h2Rt.entity, h3Rt.entity],
    10200
  );
  assert.equal(h2Rt.entity.hp, COMBAT.PLAYER_MAX_HP, "Teammate on Red must take 0 friendly fire damage");
  assert.ok(h3Rt.entity.hp < COMBAT.PLAYER_MAX_HP, "Opposing team Blue player must take damage");
  assert.ok(swingEvents.some((e) => e.kind === "hit" && e.targetId === "h3"));

  // 4. Bot collects arena powerup and applies heal/buff
  const redBot = redBots[0];
  // Match setup may seed random pickups near the bot; isolate this single-item assertion.
  room.state.pickups.clear();
  redBot.entity.hp = 40;
  redBot.entity.x = 0;
  redBot.entity.z = 0;
  const flask = new PickupState();
  flask.id = "test_flask";
  flask.kind = "healing_flask";
  flask.x = 0.4;
  flask.z = 0.2;
  room.state.pickups.set(flask.id, flask);

  // Move blue fighters away so bot doesn't die during step
  const blueBot = blueBots[0];
  blueBot.entity.x = 18;
  blueBot.entity.z = 0;
  h3Rt.entity.x = 18;
  h3Rt.entity.z = 4;
  rts.get("h4").entity.x = 18;
  rts.get("h4").entity.z = -4;

  room.team3v3.step(10500, 0.033, [
    h1Rt.entity,
    h2Rt.entity,
    h3Rt.entity,
    rts.get("h4").entity,
    redBot.entity,
    blueBot.entity,
  ]);
  assert.equal(room.state.pickups.has("test_flask"), false, "Bot must collect nearby healing flask");
  assert.equal(
    redBot.entity.hp,
    40 + COMBAT.HEALING_FLASK_HP,
    "Bot must immediately heal +50 HP from collected healing flask"
  );

  // 5. Bot casts its assigned Combat Art supermove (queues pendingArtPulses + broadcasts experimental_art)
  redBot.entity.x = 15.5;
  redBot.entity.z = 0;
  redBot.combatArtReadyAt = 10000;
  redBot.nextDecisionAt = 10000;
  redBot.activeAttack = null;
  broadcasted.length = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (room as any).pendingArtPulses = [];

  room.team3v3.step(11000, 0.033, [
    h1Rt.entity,
    h2Rt.entity,
    h3Rt.entity,
    rts.get("h4").entity,
    redBot.entity,
    blueBot.entity,
  ]);
  assert.ok(
    broadcasted.some(
      (m) =>
        m.type === "experimental_art" &&
        (m.payload as { attackerId?: string; art?: string }).attackerId === redBot.entity.id &&
        (m.payload as { art?: string }).art === redBot.combatArt
    ),
    "Bot must broadcast experimental_art VFX when casting its assigned Combat Art"
  );
  assert.ok(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (room as any).pendingArtPulses.some((p: { attackerId: string }) => p.attackerId === redBot.entity.id),
    "Bot Combat Art must enqueue authoritative server hit pulses"
  );

  // 6. 5-Round Victory Flow (eliminate Blue team 3 times -> Red clinches best-of-5 match + Rematch)
  let simNow = 12000;
  for (let round = 1; round <= 3; round++) {
    assert.equal(room.state.teamRound, round);
    assert.equal(room.state.teamRoundActive, true);
    // Eliminate all Blue fighters (humans + bots)
    rts.get("h3").entity.alive = false;
    rts.get("h4").entity.alive = false;
    room.team3v3.bots.forEach((b) => {
      if (b.team === "blue") b.entity.alive = false;
    });

    room.team3v3.step(simNow, 0.033, [
      h1Rt.entity,
      h2Rt.entity,
      h3Rt.entity,
      rts.get("h4").entity,
      ...room.team3v3.getBotEntities(),
    ]);
    assert.equal(room.state.teamRoundActive, false, `Round ${round} should end when Blue is eliminated`);
    assert.equal(room.state.teamRoundWinner, "red");
    assert.equal(room.state.teamRedScore, round);

    if (round < 3) {
      assert.equal(room.state.teamMatchActive, true, "Match should continue after round " + round);
      // Advance past intermission to trigger next round automatically
      simNow += TEAM_3V3_INTERMISSION_MS + 100;
      room.team3v3.step(simNow, 0.033, [
        h1Rt.entity,
        h2Rt.entity,
        h3Rt.entity,
        rts.get("h4").entity,
        ...room.team3v3.getBotEntities(),
      ]);
      assert.equal(room.state.teamRoundActive, true, "Next round should auto-start after intermission");
      assert.equal(rts.get("h3").entity.alive, true, "Eliminated players must respawn on new round");
      assert.equal(rts.get("h3").entity.hp, COMBAT.PLAYER_MAX_HP);
    }
  }

  assert.equal(room.state.teamMatchActive, false, "Match must conclude once Red reaches 3 wins");
  assert.equal(room.state.teamMatchWinner, "red", "Red should be crowned match winner");
  assert.ok(
    broadcasted.some(
      (m) =>
        m.type === "combat_event" &&
        (m.payload as CombatEventPayload).kind === "match_end" &&
        (m.payload as CombatEventPayload).teamWinner === "red"
    ),
    "match_end combat_event must be broadcast"
  );

  // Rematch resets score and starts Round 1 cleanly
  assert.equal(room.team3v3.rematch("h1", simNow + 500), true, "Host can trigger rematch");
  assert.equal(room.state.teamMatchActive, true);
  assert.equal(room.state.teamRound, 1);
  assert.equal(room.state.teamRedScore, 0);
  assert.equal(room.state.teamBlueScore, 0);
  assert.equal(room.state.teamMatchWinner, "");

  console.log("✅ All 3v3 Team Battle & AI Bot tests passed!");
}

runTeam3v3Tests().catch((err) => {
  console.error("❌ 3v3 Team Battle test failed:", err);
  process.exit(1);
});
