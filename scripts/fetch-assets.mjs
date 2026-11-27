import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const texturesDir = path.join(rootDir, "client", "public", "assets", "textures");
const modelsDir = path.join(rootDir, "client", "public", "assets", "models");
const skinsDir = path.join(rootDir, "client", "public", "assets", "skins");
const weaponsDir = path.join(rootDir, "client", "public", "assets", "weapons");
const propsDir = path.join(rootDir, "client", "public", "assets", "props");
const audioDir = path.join(rootDir, "client", "public", "assets", "audio");

const UA = { "User-Agent": "SekiroSlop/1.0" };

async function downloadFile(url, destPath) {
  try {
    const stat = await fs.stat(destPath);
    if (stat.size > 512) {
      console.log(`[skip] ${path.relative(rootDir, destPath)} (${(stat.size / 1024).toFixed(1)} KB)`);
      return true;
    }
  } catch {
    // not downloaded yet
  }

  const res = await fetch(url, { headers: UA });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  await fs.writeFile(destPath, buf);
  console.log(`[ok]   ${path.relative(rootDir, destPath)} (${(buf.length / 1024).toFixed(1)} KB)`);
  return true;
}

async function fetchPolyHavenTexture(slug, outPrefix, maps = ["Diffuse", "nor_gl"]) {
  const apiUrl = `https://api.polyhaven.com/files/${slug}`;
  const res = await fetch(apiUrl, { headers: UA });
  if (!res.ok) throw new Error(`PolyHaven API ${res.status} for ${slug}`);
  const data = await res.json();

  for (const mapKey of maps) {
    const entry = data[mapKey]?.["1k"]?.jpg ?? data[mapKey]?.["1k"]?.png;
    if (!entry?.url) continue;
    const ext = entry.url.endsWith(".png") ? "png" : "jpg";
    const dest = path.join(texturesDir, `${outPrefix}_${mapKey.toLowerCase()}.${ext}`);
    await downloadFile(entry.url, dest);
  }
}

async function main() {
  await fs.mkdir(texturesDir, { recursive: true });
  await fs.mkdir(modelsDir, { recursive: true });
  await fs.mkdir(skinsDir, { recursive: true });
  await fs.mkdir(weaponsDir, { recursive: true });
  await fs.mkdir(propsDir, { recursive: true });
  await fs.mkdir(audioDir, { recursive: true });

  console.log("=== Poly Haven 1K Textures ===");
  const phTextures = [
    ["sandstone_blocks_04", "sandstone", ["Diffuse", "nor_gl"]],
    ["coast_sand_01", "arena_sand", ["Diffuse", "nor_gl"]],
    ["marble_01", "marble", ["Diffuse"]],
    ["old_stone_wall_02", "stone_wall", ["Diffuse", "nor_gl"]],
  ];
  for (const [slug, prefix, maps] of phTextures) {
    try {
      await fetchPolyHavenTexture(slug, prefix, maps);
    } catch (err) {
      console.error(`[err]  Texture ${slug}:`, err.message);
    }
  }

  console.log("\n=== Animated Character GLB Models ===");
  const baseVendor = "https://raw.githubusercontent.com/euuuuuuan/cairnfall-public/main/assets/vendor";
  for (const [url, dest] of [
    [`${baseVendor}/kaykit_adventurers/Knight.glb`, path.join(modelsDir, "Knight.glb")],
    [`${baseVendor}/kaykit_skeletons/Skeleton_Warrior.glb`, path.join(modelsDir, "Skeleton_Warrior.glb")],
    [`${baseVendor}/kaykit_skeletons/Skeleton_Minion.glb`, path.join(modelsDir, "Skeleton_Minion.glb")],
    [`${baseVendor}/kaykit_skeletons/Skeleton_Rogue.glb`, path.join(modelsDir, "Skeleton_Rogue.glb")],
    [`${baseVendor}/kaykit_adventurers/Barbarian.glb`, path.join(modelsDir, "Barbarian.glb")],
  ]) {
    try {
      await downloadFile(url, dest);
    } catch (err) {
      console.error(`[err]  Model ${path.basename(dest)}:`, err.message);
    }
  }

  console.log("\n=== Animated Boss & Enemy GLB Models (CC0 Quaternius & KayKit) ===");
  const enemiesDir = path.join(rootDir, "client", "public", "assets", "enemies");
  const baseGQ = "https://raw.githubusercontent.com/GeorgeQLe/assets-kaykit-3d-characters/main/assets/kaykit";
  const baseQuat = "https://raw.githubusercontent.com/trebeljahr/quaternius-showcase/main/public/glb";
  const baseKD = "https://raw.githubusercontent.com/KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0/main/addons/kaykit_dungeon_remastered/Assets/gltf";
  const baseCairn = "https://raw.githubusercontent.com/euuuuuuan/cairnfall-public/main";

  await fs.mkdir(enemiesDir, { recursive: true });
  for (const [url, dest] of [
    [`${baseVendor}/quaternius_monsters/Dragon.glb`, path.join(enemiesDir, "Dragon.glb")],
    [`${baseQuat}/single_knight_pack/KnightCharacter.glb`, path.join(enemiesDir, "DreadKnight.glb")],
    [`${baseVendor}/kaykit_skeletons/Skeleton_Mage.glb`, path.join(enemiesDir, "Skeleton_Mage.glb")],
    [`${baseQuat}/cyberpunk_pack/Enemy_Flying_Gun.glb`, path.join(enemiesDir, "Enemy_Flying_Gun.glb")],
    [`${baseGQ}/mystery-monthly-series-6/9%20-%20March%202026%20-%20Avian%20Swordsman/characters/AvianSwordsman.glb`, path.join(enemiesDir, "AvianSwordsman.glb")],
    [`${baseQuat}/animals_pack/Wolf.glb`, path.join(enemiesDir, "Wolf.glb")],
    [`${baseQuat}/mech_pack/George.glb`, path.join(enemiesDir, "AegisMech.glb")],
  ]) {
    try {
      await downloadFile(url, dest);
    } catch (err) {
      console.error(`[err]  Enemy Model ${path.basename(dest)}:`, err.message);
    }
  }

  console.log("\n=== Unique Playable Character Skins (CC0 KayKit 1.0/2.0) ===");
  for (const [url, dest] of [
    [`${baseGQ}/mystery-monthly-series-4/8%20-%20February%202024%20-%20Ninja/character/Ninja.glb`, path.join(skinsDir, "Ninja.glb")],
    [`${baseGQ}/mystery-monthly-series-5/3%20-%20September%202024%20-%20Black%20Knight/characters/BlackKnight.glb`, path.join(skinsDir, "BlackKnight.glb")],
    [`${baseGQ}/mystery-monthly-series-4/10%20-%20April%202024%20-%20Paladin/characters/gltf/Paladin_with_Helmet.glb`, path.join(skinsDir, "Paladin_with_Helmet.glb")],
    [`${baseVendor}/kaykit_adventurers/Mage.glb`, path.join(skinsDir, "Mage.glb")],
    [`${baseGQ}/mystery-monthly-series-4/7%20-%20January%202024%20-%20Space%20Ranger/character/SpaceRanger_FlightMode.glb`, path.join(skinsDir, "SpaceRanger_FlightMode.glb")],
  ]) {
    try {
      await downloadFile(url, dest);
    } catch (err) {
      console.error(`[err]  Skin Model ${path.basename(dest)}:`, err.message);
    }
  }

  console.log("\n=== Unique 3D Weapon Models ===");
  for (const [url, dest] of [
    [`${baseQuat}/single_knight_pack/Katana.glb`, path.join(weaponsDir, "Katana.glb")],
    [`${baseQuat}/medieval_weapons_pack/Claymore.glb`, path.join(weaponsDir, "Claymore.glb")],
    [`${baseQuat}/medieval_weapons_pack/Scythe.glb`, path.join(weaponsDir, "Scythe.glb")],
    [`${baseQuat}/modular_sci_fi_guns_pack/Pistol_1.glb`, path.join(weaponsDir, "StunPistol.glb")],
  ]) {
    try {
      await downloadFile(url, dest);
    } catch (err) {
      console.error(`[err]  Weapon Model ${path.basename(dest)}:`, err.message);
    }
  }

  console.log("\n=== Map-Exclusive Environment 3D Props ===");
  for (const [url, dest] of [
    // Sunlit Colosseum
    [`${baseQuat}/modular_dungeon_1/Statue_Horse.glb`, path.join(propsDir, "Statue_Horse.glb")],
    [`${baseQuat}/modular_dungeon_pack/Column_Broken.glb`, path.join(propsDir, "Column_Broken.glb")],
    [`${baseKD}/sword_shield_gold.gltf.glb`, path.join(propsDir, "sword_shield_gold.gltf.glb")],
    [`${baseKD}/chest_gold.glb`, path.join(propsDir, "chest_gold.glb")],
    [`${baseKD}/barrel_large_decorated.gltf.glb`, path.join(propsDir, "barrel_large_decorated.gltf.glb")],
    [`${baseKD}/torch_lit.gltf.glb`, path.join(propsDir, "torch_lit.gltf.glb")],
    // Moonlit Sakura
    [`${baseQuat}/medieval_village_pack/Gazebo.glb`, path.join(propsDir, "Gazebo.glb")],
    [`${baseQuat}/medieval_village_pack/Bell_Tower.glb`, path.join(propsDir, "Bell_Tower.glb")],
    [`${baseQuat}/nature_pack/Willow_1.glb`, path.join(propsDir, "Willow_1.glb")],
    [`${baseQuat}/nature_pack/Rock_Moss_1.glb`, path.join(propsDir, "Rock_Moss_1.glb")],
    [`${baseCairn}/assets/meshes/totem.glb`, path.join(propsDir, "totem.glb")],
    [`${baseQuat}/medieval_village_pack/Bonfire_Lit.glb`, path.join(propsDir, "Bonfire_Lit.glb")],
    // Infernal Rift
    [`${baseQuat}/ultimate_space_pack/Tree_Lava_1-transformed.glb`, path.join(propsDir, "Tree_Lava_1.glb")],
    [`${baseQuat}/ultimate_space_pack/Tree_Spikes_1-transformed.glb`, path.join(propsDir, "Tree_Spikes_1.glb")],
    [`${baseQuat}/rpg_items_pack/Crystal1.glb`, path.join(propsDir, "Crystal1.glb")],
    [`${baseQuat}/rpg_items_pack/Skull2.glb`, path.join(propsDir, "Skull2.glb")],
    [`${baseQuat}/modular_dungeon_1/Spikes.glb`, path.join(propsDir, "Spikes.glb")],
    [`${baseQuat}/modular_dungeon_pack/Candelabrum_tall.glb`, path.join(propsDir, "Candelabrum_tall.glb")],
  ]) {
    try {
      await downloadFile(url, dest);
    } catch (err) {
      console.error(`[err]  Prop Model ${path.basename(dest)}:`, err.message);
    }
  }

  console.log("\n=== Combat & Foley Audio SFX ===");
  const baseSfx = "https://raw.githubusercontent.com/euuuuuuan/cairnfall-public/main/assets/sfx";
  const sfxFiles = [
    "ui_click.wav",
  ];
  for (const file of sfxFiles) {
    try {
      await downloadFile(`${baseSfx}/${file}`, path.join(audioDir, file));
    } catch (err) {
      console.error(`[err]  SFX ${file}:`, err.message);
    }
  }

  console.log("\nDone fetching assets.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
