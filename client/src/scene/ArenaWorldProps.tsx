import { memo, useMemo } from "react";
import * as THREE from "three";
import { useGLTF } from "@react-three/drei";
import { ARENA, type ArenaMapKind } from "@sekiroslop/shared";
import { SUNLIT_TORCH_ANGLES } from "./ArenaMapStructures";

interface ArenaWorldPropsProps {
  mapKind: ArenaMapKind;
}

const MAP_PROP_PATHS: Record<ArenaMapKind, readonly string[]> = {
  sunlit_colosseum: [
    "/assets/props/Statue_Horse.glb",
    "/assets/props/Column_Broken.glb",
    "/assets/props/sword_shield_gold.gltf.glb",
    "/assets/props/chest_gold.glb",
    "/assets/props/barrel_large_decorated.gltf.glb",
    "/assets/props/torch_lit.gltf.glb",
    "/assets/props/Candelabrum_tall.glb",
  ],
  moonlit_sakura: [
    "/assets/props/Gazebo.glb",
    "/assets/props/Bell_Tower.glb",
    "/assets/props/Willow_1.glb",
    "/assets/props/Rock_Moss_1.glb",
    "/assets/props/totem.glb",
    "/assets/props/Bonfire_Lit.glb",
    "/assets/props/Candelabrum_tall.glb",
    "/assets/props/Crystal1.glb",
  ],
  aurora_sanctuary: [
    "/assets/props/Crystal1.glb",
    "/assets/props/Candelabrum_tall.glb",
    "/assets/props/Gazebo.glb",
    "/assets/props/Rock_Moss_1.glb",
    "/assets/props/totem.glb",
  ],
  sunny_sakura: [
    "/assets/props/Gazebo.glb",
    "/assets/props/Bell_Tower.glb",
    "/assets/props/Willow_1.glb",
    "/assets/props/Rock_Moss_1.glb",
    "/assets/props/totem.glb",
    "/assets/props/Candelabrum_tall.glb",
  ],
};

export function preloadArenaMapProps(mapKind: ArenaMapKind): void {
  for (const path of MAP_PROP_PATHS[mapKind]) useGLTF.preload(path);
}

function PropClone({
  url,
  position,
  rotation = [0, 0, 0],
  scale = 1,
  castShadow = false,
}: {
  url: string;
  position: [number, number, number];
  rotation?: [number, number, number];
  scale?: number;
  castShadow?: boolean;
}) {
  const gltf = useGLTF(url);
  const cloned = useMemo(() => {
    const c = gltf.scene.clone(true);
    c.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const m = obj as THREE.Mesh;
        m.castShadow = castShadow;
        m.receiveShadow = true;
      }
    });
    // Normalize baked exporter offsets (e.g. Statue_Horse.glb +5.45m Z offset!) so base-center sits at local (0, 0, 0)
    c.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(c);
    if (!box.isEmpty()) {
      const center = new THREE.Vector3();
      box.getCenter(center);
      c.position.set(-center.x, -box.min.y, -center.z);
    }
    c.updateMatrix();
    c.matrixAutoUpdate = false;
    c.traverse((obj) => {
      if (obj === c) return;
      obj.updateMatrix();
      obj.matrixAutoUpdate = false;
    });
    const wrapper = new THREE.Group();
    wrapper.add(c);
    wrapper.position.set(position[0], position[1], position[2]);
    wrapper.rotation.set(rotation[0], rotation[1], rotation[2]);
    wrapper.scale.setScalar(scale);
    wrapper.updateMatrix();
    wrapper.matrixAutoUpdate = false;
    return wrapper;
  }, [gltf.scene, position, rotation, scale]);

  return <primitive object={cloned} />;
}

const WALL_R = ARENA.WALL_RADIUS;

const SunlitExclusiveProps = memo(function SunlitExclusiveProps() {
  return (
    <group>
      {/* Twin Imperial Horse Statues grounded on the Colosseum sand clear of the podium wall */}
      <PropClone url="/assets/props/Statue_Horse.glb" position={[-6.4, 0, -22.2]} rotation={[0, 0, 0]} scale={1.25} castShadow />
      <PropClone url="/assets/props/Statue_Horse.glb" position={[6.4, 0, -22.2]} rotation={[0, 0, 0]} scale={1.25} castShadow />
      {/* Broken Marble Ruins resting on the outer valley floor beyond the Colosseum facade */}
      {[-2.1, -0.9, 0.9, 2.1].map((ang, i) => (
        <PropClone
          key={`col-${i}`}
          url="/assets/props/Column_Broken.glb"
          position={[Math.sin(ang) * 40.5, -0.1, Math.cos(ang) * 40.5]}
          rotation={[0, ang, 0]}
          scale={1.55}
        />
      ))}
      {/* Golden Trophy Shields & Chests resting flush on the Emperor Dais (y = 5.15) */}
      <PropClone url="/assets/props/sword_shield_gold.gltf.glb" position={[-3.4, 5.15, WALL_R + 1.9]} rotation={[0, Math.PI, 0]} scale={1.2} />
      <PropClone url="/assets/props/sword_shield_gold.gltf.glb" position={[3.4, 5.15, WALL_R + 1.9]} rotation={[0, Math.PI, 0]} scale={1.2} />
      <PropClone url="/assets/props/chest_gold.glb" position={[-1.8, 5.15, WALL_R + 2.3]} rotation={[0, Math.PI * 0.9, 0]} scale={1.15} />
      <PropClone url="/assets/props/chest_gold.glb" position={[1.8, 5.15, WALL_R + 2.3]} rotation={[0, -Math.PI * 0.9, 0]} scale={1.15} />
      {/* Twin Tall Candelabra framing the Emperor's Dais & North Gate Alcove */}
      <PropClone url="/assets/props/Candelabrum_tall.glb" position={[-4.6, 5.15, WALL_R + 1.4]} rotation={[0, Math.PI, 0]} scale={1.15} />
      <PropClone url="/assets/props/Candelabrum_tall.glb" position={[4.6, 5.15, WALL_R + 1.4]} rotation={[0, Math.PI, 0]} scale={1.15} />
      <PropClone url="/assets/props/Candelabrum_tall.glb" position={[-8.8, 0, -WALL_R + 1.4]} rotation={[0, 0.3, 0]} scale={1.2} />
      <PropClone url="/assets/props/Candelabrum_tall.glb" position={[8.8, 0, -WALL_R + 1.4]} rotation={[0, -0.3, 0]} scale={1.2} />
      {/* Decorated Supply Barrels & Grounded Perimeter Torches inside the arena sand */}
      {[-1.4, 1.4].map((ang, i) => (
        <PropClone
          key={`brl-${i}`}
          url="/assets/props/barrel_large_decorated.gltf.glb"
          position={[Math.sin(ang) * (WALL_R - 1.55), 0, Math.cos(ang) * (WALL_R - 1.55)]}
          scale={1.1}
        />
      ))}
      {SUNLIT_TORCH_ANGLES.map((ang, i) => (
        <PropClone
          key={`tch-${i}`}
          url="/assets/props/torch_lit.gltf.glb"
          position={[Math.sin(ang) * (WALL_R - 1.35), 0, Math.cos(ang) * (WALL_R - 1.35)]}
          rotation={[0, ang + Math.PI, 0]}
          scale={1.25}
        />
      ))}
    </group>
  );
});

const SakuraExclusiveProps = memo(function SakuraExclusiveProps() {
  return (
    <group>
      {/* Moon-Viewing Gazebos & Ashina Bell Tower on flat outer valley */}
      <PropClone url="/assets/props/Gazebo.glb" position={[-31.0, -0.1, -13]} rotation={[0, 1.1, 0]} scale={1.55} />
      <PropClone url="/assets/props/Gazebo.glb" position={[31.0, -0.1, -13]} rotation={[0, -1.1, 0]} scale={1.55} />
      <PropClone url="/assets/props/Bell_Tower.glb" position={[-25.5, -0.1, 22]} rotation={[0, 0.75, 0]} scale={1.45} />
      {/* Weeping Willows & Mossy Garden Boulders */}
      {[-2.4, -0.5, 0.5, 2.4].map((ang, i) => (
        <PropClone
          key={`wil-${i}`}
          url="/assets/props/Willow_1.glb"
          position={[Math.sin(ang) * 33.0, -0.1, Math.cos(ang) * 33.0]}
          rotation={[0, ang * 2, 0]}
          scale={1.4}
        />
      ))}
      {[-2.0, -1.2, 1.2, 2.0].map((ang, i) => (
        <PropClone
          key={`rm-${i}`}
          url="/assets/props/Rock_Moss_1.glb"
          position={[Math.sin(ang) * 28.8, -0.1, Math.cos(ang) * 28.8]}
          rotation={[0, ang, 0]}
          scale={1.8}
        />
      ))}
      {/* Spirit Totems flanking the North Gate & Ceremonial Bonfires inside the courtyard */}
      <PropClone url="/assets/props/totem.glb" position={[-5.8, 0, -24.0]} scale={1.4} />
      <PropClone url="/assets/props/totem.glb" position={[5.8, 0, -24.0]} scale={1.4} />
      <PropClone url="/assets/props/Bonfire_Lit.glb" position={[-16.5, 0, 17.5]} scale={1.3} />
      <PropClone url="/assets/props/Bonfire_Lit.glb" position={[16.5, 0, 17.5]} scale={1.3} />
      {/* Twin Tall Candelabra flanking the Ashina Moon Shrine Pavilion steps */}
      <PropClone url="/assets/props/Candelabrum_tall.glb" position={[-4.2, 0.35, WALL_R + 0.4]} rotation={[0, Math.PI, 0]} scale={1.15} />
      <PropClone url="/assets/props/Candelabrum_tall.glb" position={[4.2, 0.35, WALL_R + 0.4]} rotation={[0, Math.PI, 0]} scale={1.15} />
      {/* Moonlit Spirit-Stone Clusters nestled beside the outer mossy boulders (r = 28.4 > WALL_R) */}
      {[-2.0, -1.2, 1.2, 2.0].map((ang, i) => (
        <PropClone
          key={`cry-${i}`}
          url="/assets/props/Crystal1.glb"
          position={[Math.sin(ang) * 28.4, -0.1, Math.cos(ang) * 28.4]}
          rotation={[0, ang + 0.4, 0]}
          scale={0.65}
        />
      ))}
    </group>
  );
});

const AURORA_CRYSTAL_CLUSTERS = [
  { ang: -2.25, scale: 0.92 },
  { ang: -1.55, scale: 1.12 },
  { ang: -0.85, scale: 0.88 },
  { ang: 0.85, scale: 1.05 },
  { ang: 1.55, scale: 1.15 },
  { ang: 2.25, scale: 0.85 },
] as const;

const AuroraExclusiveProps = memo(function AuroraExclusiveProps() {
  return (
    <group>
      {/* Twin Totems flanking the North Gate outside playable radius */}
      <PropClone url="/assets/props/totem.glb" position={[-6.2, 0, -25.6]} scale={1.4} />
      <PropClone url="/assets/props/totem.glb" position={[6.2, 0, -25.6]} scale={1.4} />
      {/* Twin Tall Candelabra on the South Observatory Dais (z = WALL_R + 7.2, y = 4.8) */}
      <PropClone url="/assets/props/Candelabrum_tall.glb" position={[-4.4, 4.8, WALL_R + 6.6]} rotation={[0, Math.PI, 0]} scale={1.15} />
      <PropClone url="/assets/props/Candelabrum_tall.glb" position={[4.4, 4.8, WALL_R + 6.6]} rotation={[0, Math.PI, 0]} scale={1.15} />
      {/* Outer Twilight Gazebos */}
      <PropClone url="/assets/props/Gazebo.glb" position={[-31.0, -0.1, -13]} rotation={[0, 1.1, 0]} scale={1.55} />
      <PropClone url="/assets/props/Gazebo.glb" position={[31.0, -0.1, -13]} rotation={[0, -1.1, 0]} scale={1.55} />
      {/* Outer Crystal Clusters (r = 28.6 > WALL_R) */}
      {AURORA_CRYSTAL_CLUSTERS.map(({ ang, scale }, i) => (
        <PropClone
          key={`aurora-cry-${i}`}
          url="/assets/props/Crystal1.glb"
          position={[Math.sin(ang) * 28.6, -0.1, Math.cos(ang) * 28.6]}
          rotation={[0, ang + 0.35, 0]}
          scale={scale}
        />
      ))}
      {/* Outer Mossy Boulders (r = 30.5 > WALL_R) */}
      {[-2.0, -1.2, 1.2, 2.0].map((ang, i) => (
        <PropClone
          key={`aurora-rm-${i}`}
          url="/assets/props/Rock_Moss_1.glb"
          position={[Math.sin(ang) * 30.5, -0.1, Math.cos(ang) * 30.5]}
          rotation={[0, ang, 0]}
          scale={1.75}
        />
      ))}
    </group>
  );
});

const SunnySakuraProps = memo(function SunnySakuraProps() {
  return (
    <group>
      {/* Twin Spirit Totems flanking the North Gate outside playable radius */}
      <PropClone url="/assets/props/totem.glb" position={[-6.2, 0, -25.6]} scale={1.4} />
      <PropClone url="/assets/props/totem.glb" position={[6.2, 0, -25.6]} scale={1.4} />
      {/* Twin Tall Candelabra on the South Pagoda overlook (outside WALL_R) */}
      <PropClone url="/assets/props/Candelabrum_tall.glb" position={[-4.2, 0.35, WALL_R + 0.6]} rotation={[0, Math.PI, 0]} scale={1.15} />
      <PropClone url="/assets/props/Candelabrum_tall.glb" position={[4.2, 0.35, WALL_R + 0.6]} rotation={[0, Math.PI, 0]} scale={1.15} />
      {/* Sunlit Garden Gazebos & Bell Tower in outer valley (r >= 28.8) */}
      <PropClone url="/assets/props/Gazebo.glb" position={[-31.0, -0.1, -13]} rotation={[0, 1.1, 0]} scale={1.55} />
      <PropClone url="/assets/props/Gazebo.glb" position={[31.0, -0.1, -13]} rotation={[0, -1.1, 0]} scale={1.55} />
      <PropClone url="/assets/props/Bell_Tower.glb" position={[-25.5, -0.1, 22]} rotation={[0, 0.75, 0]} scale={1.45} />
      {/* Weeping Willows & Mossy Garden Boulders (r >= 28.8) */}
      {[-2.4, -0.5, 0.5, 2.4].map((ang, i) => (
        <PropClone
          key={`sunny-wil-${i}`}
          url="/assets/props/Willow_1.glb"
          position={[Math.sin(ang) * 33.0, -0.1, Math.cos(ang) * 33.0]}
          rotation={[0, ang * 2, 0]}
          scale={1.4}
        />
      ))}
      {[-2.0, -1.2, 1.2, 2.0].map((ang, i) => (
        <PropClone
          key={`sunny-rm-${i}`}
          url="/assets/props/Rock_Moss_1.glb"
          position={[Math.sin(ang) * 28.8, -0.1, Math.cos(ang) * 28.8]}
          rotation={[0, ang, 0]}
          scale={1.8}
        />
      ))}
    </group>
  );
});

export const ArenaWorldProps = memo(function ArenaWorldProps({ mapKind }: ArenaWorldPropsProps) {
  return (
    <group>
      {mapKind === "sunlit_colosseum" && <SunlitExclusiveProps />}
      {mapKind === "moonlit_sakura" && <SakuraExclusiveProps />}
      {mapKind === "aurora_sanctuary" && <AuroraExclusiveProps />}
      {mapKind === "sunny_sakura" && <SunnySakuraProps />}
    </group>
  );
});
