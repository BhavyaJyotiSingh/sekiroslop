# Codebase Architecture

SekiroSlop is structured as a three-workspace TypeScript monorepo (`shared`, `server`, `client`) so combat constants, types, arena geometry/colliders, and wave definitions are shared identically between client prediction and server authority.

---

## Repository File & Folder Map

```text
.
├── .gitignore                          # Git ignore rules (deps, dist, .env*, IDE, OS, caches)
├── package.json                        # Root workspace scripts (dev, build, test:server, fetch-assets)
├── package-lock.json                   # Lockfile for reproducible installs
├── railway.json                        # Railway Dockerfile build & /health deploy config
├── vercel.json                         # Vercel root build, security headers, and SPA rewrite config
├── README.md                           # User & developer documentation
├── CODEBASE.md                         # Architecture & file map (this file)
│
├── scripts/                            # Asset-fetching utilities
│   ├── fetch-assets.mjs                # Downloads 3D GLTF/GLB models, textures, and audio packs
│   └── fetch-meme-sfx.mjs              # Downloads optional meme/combat SFX clips
│
├── shared/                             # @sekiroslop/shared — shared types, constants & arena math
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts                    # Barrel export for types and constants
│       ├── types.ts                    # Network messages, snapshots, ArenaMapKind, AttackKind, etc.
│       └── constants.ts                # ARENA, ARENA_MAPS, COMBAT, FLIGHT, ATTACK_SPECS, POWER_UPS,
│                                       # ENEMY_ARCHETYPES, PLAYER_SKINS, WAVE_PLANS, clampToArena()
│
├── server/                             # @sekiroslop/server — authoritative Colyseus game server
│   ├── .env.example                    # Example PORT, HOST, CORS_ORIGIN variables
│   ├── Dockerfile                      # Production container build for Railway
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts                    # Express + HTTP + Colyseus WebSocket server (/ & /health)
│       ├── schema/
│       │   └── ColosseumState.ts       # Colyseus Schema definitions synced to clients
│       ├── rooms/
│       │   ├── roomCode.ts             # Room code generator & normalizer
│       │   ├── ColosseumRoom.ts        # Main room lifecycle, physics, combat, waves, FFA, chat
│       │   └── team3v3.ts              # 3v3 Team Battle rules, matchmaking & AI teammate/foe bots
│       ├── combat/
│       │   └── CombatEngine.ts         # Hit detection, deflect/block, posture break, projectiles, KB
│       ├── ai/
│       │   └── SkeletonAI.ts           # Enemy AI steering, strafing, telegraphing & boss attacks
│       └── tests/
│           ├── combat.test.ts          # 37 unit & integration tests for combat, waves & bugfixes
│           ├── team3v3.test.ts         # 3v3 Team Battle & AI bot tests
│           ├── expansion.test.ts       # Map/skin/combat-art expansion verification tests
│           └── multiplayer.e2e.test.ts # Multi-client WebSocket end-to-end test suite
│
└── client/                             # @sekiroslop/client — React + R3F 3D game client
    ├── .env.example                    # Example VITE_SERVER_URL variable
    ├── index.html                      # Entry HTML with SEO metadata, Open Graph & VideoGame JSON-LD
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.ts                  # Vite bundler config
    ├── vercel.json                     # Client-scoped SPA rewrite fallback
    ├── public/                         # Static assets copied to dist/
    │   ├── googleeb24ee4f7b89900a.html # Google Search Console verification file
    │   ├── manifest.webmanifest        # PWA / mobile web app manifest
    │   ├── robots.txt                  # Search crawler rules
    │   ├── sitemap.xml                 # XML sitemap
    │   └── assets/                     # 3D models (.glb), textures (.jpg), and audio (.ogg/.mp3/.wav)
    │       ├── audio/                  # Sekiro clash/blade SFX, UI click, effects
    │       ├── enemies/                # Enemy & boss 3D models
    │       ├── models/                 # Base character & skeleton 3D models
    │       ├── props/                  # Arena statues, crystals, pillars, barrels, chests
    │       ├── skins/                  # Selectable player skin 3D models
    │       ├── textures/               # Sand, marble, sandstone, stone wall textures
    │       └── weapons/                # Katana, Claymore, Scythe, StunPistol models
    └── src/
        ├── main.tsx                    # React root mount
        ├── App.tsx                     # Top-level Lobby / Scene / HUD / Orientation Guard wiring
        ├── index.css                   # Theme tokens, HUD styles, mobile claw layout & modals
        ├── vite-env.d.ts               # Vite TypeScript env types
        ├── audio/
        │   └── SoundEngine.ts          # WebAudio synthesizer + decoded SFX buffer player + limiter
        ├── input/
        │   ├── controlsConfig.ts       # Keyboard/mouse bindings, sensitivity, auto-lock config
        │   ├── mobileDisplay.ts        # Portrait guard, landscape lock & fullscreen helpers
        │   ├── touchInput.ts           # Mutable zero-re-render bridge between touch UI & R3F loop
        │   └── touchLayoutConfig.ts    # Per-button mobile HUD (dx, dy, scale, opacity) persistence
        ├── lib/
        │   ├── graphicsQuality.ts      # Auto/Low/Med/High preset detection & persistence
        │   └── hitStop.ts              # Brief hit-stop time dilation for melee impact feel
        ├── net/
        │   └── useColosseumRoom.ts     # Colyseus room connection, snapshots, events & senders
        ├── ui/
        │   ├── LobbyScreen.tsx         # Create/Join room lobby + server wake-up status
        │   ├── GameHUD.tsx             # Vitals, enemy/boss bar, combat feed, belt, action bar
        │   ├── PreWaveSetup.tsx        # Loadout (skins, combat arts) & Arena/Mode setup modal
        │   ├── GameMenuModal.tsx       # In-game menu (match, settings, keybindings, graphics)
        │   ├── TouchControls.tsx       # Mobile 3-finger claw HUD + individual button layout editor
        │   ├── Team3v3Panel.tsx        # 3v3 lobby team selection & bot fill controls
        │   └── PartyChat.tsx           # In-room party chat overlay
        ├── experimental/
        │   ├── special-moves/          # 14 Combat Arts system (config, clips, rig inspector, VFX)
        │   │   ├── index.ts
        │   │   ├── config.ts
        │   │   ├── proceduralClips.ts
        │   │   ├── rigInspector.ts
        │   │   ├── sekiroArtClips.ts
        │   │   └── ExperimentalVFX.tsx
        │   └── sword-vfx-hitbox/       # Swept blade ribbon trail, aura shader & debug overlay
        │       ├── index.ts
        │       ├── config.ts
        │       ├── sweptHitbox.ts
        │       ├── swordAuraShader.ts
        │       ├── WeaponBladeTrail.tsx
        │       ├── CombatBurstVFX.tsx
        │       └── SweptHitboxDebugOverlay.tsx
        └── scene/                      # Three.js / React Three Fiber 3D world & entities
            ├── ColosseumScene.tsx      # Main <Canvas>, lighting, camera, entity rendering & HUD bridge
            ├── LocalPlayerController.tsx # Client prediction, reconciliation, dodge, flight & input
            ├── GladiatorModel.tsx      # Player character mesh, weapon attachment & animation mixer
            ├── sekiroCombatClips.ts    # Procedural biomechanical sword/deflect/slide animation clips
            ├── BossEnemyModel.tsx      # Boss enemy 3D model & animation controller
            ├── CreatureEnemyModel.tsx  # Non-humanoid enemy (Wolf, Dragon, Mech) 3D models
            ├── ColosseumArena.tsx      # Arena floor, procedural ground textures & rim geometry
            ├── ArenaMapStructures.tsx  # Map-specific architecture (trees, flowers, obelisks, gates)
            ├── ArenaWorldProps.tsx     # GLTF prop placement & preloading per ArenaMapKind
            ├── ArenaSky.tsx            # Procedural sky domes, sun/moon/aurora & mountain ridges
            ├── OuterValleyTerrain.tsx  # Surrounding distant terrain ring per map
            ├── ArenaAtmosphereVFX.tsx  # Petals, leaves, fireflies, aurora curtains, sunbeams
            ├── ArenaCats.tsx           # Ambient patrolling arena cats
            ├── ArenaPickups.tsx        # Floating power-up crystals on the arena floor
            ├── CombatVFX.tsx           # Sparks, deflect flashes, posture-break & hit effects
            ├── SlashVFX.tsx            # Melee slash arc meshes
            ├── AbilityAndSpellVFX.tsx  # Fireball, Arcane Spell & Stun Gun projectile/impact VFX
            ├── PilumProjectiles.tsx    # Enemy thrown spear projectiles
            ├── FlightVFX.tsx           # Rocket/flight thruster particles
            └── SceneAssetBoundary.tsx  # React ErrorBoundary for safe GLTF asset loading
```

---

## How Major Systems Interact

### 1. Shared Contract (`shared`)
`shared/src/types.ts` and `shared/src/constants.ts` are the single source of truth for:
- **Combat & Movement Constants**: `COMBAT`, `FLIGHT`, `ATTACK_SPECS`, `POWER_UPS`, and `ENEMY_ARCHETYPES`.
- **Map Registry & Colliders**: `ARENA_MAPS` defines the 4 arenas (`sunlit_colosseum`, `moonlit_sakura`, `aurora_sanctuary`, `sunny_sakura`), and `clampToArena(x, z, radius, ignorePillars, mapKind)` enforces identical arena walls and prop colliders on both client and server.

### 2. Authoritative Server Loop (`server`)
- **`server/src/index.ts`** starts Express + Colyseus `WebSocketTransport` and defines the `"colosseum"` room.
- **`ColosseumRoom.ts`** runs a fixed-interval simulation loop (`COMBAT.SERVER_TICK_MS`):
  1. Processes queued player inputs (`move`, `attack`, `block`, `dodge`, `cast_ability`, `cast_selected_art`, `use_item`).
  2. Advances player movement, jump/flight fuel, and exact-duration dodge steps (`dodgeRemainingMs`).
  3. Delegates enemy AI (`SkeletonAI.ts`) or 3v3 bot AI (`team3v3.ts`).
  4. Resolves melee/ranged hit detection, timed deflects, posture damage, staggers, and knockbacks via `CombatEngine.ts`.
  5. Syncs `ColosseumState` deltas to all connected clients and broadcasts ephemeral `CombatEventPayload`s (sparks, sounds, floating damage/status).

### 3. Client Prediction, Rendering & Input (`client`)
- **`useColosseumRoom.ts`** connects via `@colyseus/sdk`, converts Colyseus schema state into lightweight React snapshots (`RoomWorldSnapshot`), and exposes typed action senders.
- **`LocalPlayerController.tsx`** runs at display framerate inside R3F's `useFrame`:
  - Applies immediate client-side prediction for movement, jumping/flight, and `0.32s` dodge slides (`localDodgeRemainingSecRef`).
  - Reconciles against authoritative `liveSelf` updates (`lastMoveSeq` + `replayPendingMoveInputs`) while skipping mid-dodge reconciliation so slides stay smooth without rubber-banding.
  - Reads keyboard/mouse (`controlsConfig.ts`) and mobile multi-touch (`touchInput.ts`) uniformly.
- **3D Scene (`client/src/scene/`)**: `ColosseumScene.tsx` composes the active arena (`ColosseumArena`, `ArenaMapStructures`, `ArenaWorldProps`, `ArenaSky`, `OuterValleyTerrain`, `ArenaAtmosphereVFX`) and renders players, enemies, projectiles, and combat VFX with dynamic quality scaling (`graphicsQuality.ts`).
