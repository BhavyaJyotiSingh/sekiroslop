import { memo, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { FFA_CONFIG } from "@sekiroslop/shared";
import type { AbilityVfxEvent, RoomWorldSnapshot } from "../net/useColosseumRoom";

interface AbilityAndSpellVFXProps {
  eventsRef: React.MutableRefObject<AbilityVfxEvent[]>;
  worldRef: React.MutableRefObject<RoomWorldSnapshot>;
}

const MAX_BURSTS = 12;
const FEATHERS_PER_BURST = 28;

const FRESNEL_FIRE_VERT = /* glsl */ `
  varying vec3 vNormalW;
  varying vec3 vViewDir;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vViewDir = normalize(cameraPosition - wp.xyz);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const FRESNEL_FIRE_FRAG = /* glsl */ `
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform float uOpacity;
  varying vec3 vNormalW;
  varying vec3 vViewDir;
  void main() {
    float fresnel = pow(1.0 - max(0.0, dot(normalize(vNormalW), normalize(vViewDir))), 2.2);
    vec3 col = mix(uColorA, uColorB, fresnel);
    gl_FragColor = vec4(col * (1.2 + fresnel * 1.4), uOpacity * (0.45 + fresnel * 0.55));
  }
`;

export const AbilityAndSpellVFX = memo(function AbilityAndSpellVFX({
  eventsRef,
  worldRef,
}: AbilityAndSpellVFXProps) {
  const featherMeshRef = useRef<THREE.InstancedMesh>(null);
  const sphereRefs = useRef<(THREE.Mesh | null)[]>([]);
  const ringRefs = useRef<(THREE.Mesh | null)[]>([]);
  const ffaRingRef = useRef<THREE.Mesh>(null);
  const wasIdleRef = useRef(false);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  const { featherGeo, featherMat, sphereGeo, ringGeo, fireShaderMat, arcaneShaderMat } = useMemo(() => {
    const fGeo = new THREE.PlaneGeometry(0.16, 0.42);
    const fMat = new THREE.MeshBasicMaterial({
      color: "#c084fc",
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const sGeo = new THREE.SphereGeometry(1, 20, 16);
    const rGeo = new THREE.RingGeometry(0.65, 1.0, 32);
    const fireMat = new THREE.ShaderMaterial({
      vertexShader: FRESNEL_FIRE_VERT,
      fragmentShader: FRESNEL_FIRE_FRAG,
      uniforms: {
        uColorA: { value: new THREE.Color("#ff4500") },
        uColorB: { value: new THREE.Color("#fde047") },
        uOpacity: { value: 0 },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const arcMat = new THREE.ShaderMaterial({
      vertexShader: FRESNEL_FIRE_VERT,
      fragmentShader: FRESNEL_FIRE_FRAG,
      uniforms: {
        uColorA: { value: new THREE.Color("#0ea5e9") },
        uColorB: { value: new THREE.Color("#e0f2fe") },
        uOpacity: { value: 0 },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    return {
      featherGeo: fGeo,
      featherMat: fMat,
      sphereGeo: sGeo,
      ringGeo: rGeo,
      fireShaderMat: fireMat,
      arcaneShaderMat: arcMat,
    };
  }, []);

  useEffect(() => () => {
    featherGeo.dispose();
    featherMat.dispose();
    sphereGeo.dispose();
    ringGeo.dispose();
    fireShaderMat.dispose();
    arcaneShaderMat.dispose();
  }, [featherGeo, featherMat, sphereGeo, ringGeo, fireShaderMat, arcaneShaderMat]);

  useFrame((state) => {
    const now = performance.now();
    const list = eventsRef.current;
    while (list.length > 0 && now - list[0].createdAt > 750) {
      list.shift();
    }
    if (list.length === 0 && wasIdleRef.current) {
      if (ffaRingRef.current) {
        const isFfa = worldRef.current.gameMode === "ffa";
        ffaRingRef.current.visible = isFfa;
        if (isFfa) {
          const prog = worldRef.current.ffaZoneProgress;
          const mat = ffaRingRef.current.material as THREE.MeshBasicMaterial;
          mat.color.set(prog > 0.05 ? "#22d3ee" : "#fbbf24");
          mat.opacity = 0.35 + Math.sin(state.clock.elapsedTime * 4) * 0.12 + prog * 0.4;
        }
      }
      return;
    }
    wasIdleRef.current = list.length === 0;

    let featherIdx = 0;
    const totalFeathers = MAX_BURSTS * FEATHERS_PER_BURST;

    for (let i = 0; i < MAX_BURSTS; i++) {
      const fx = list[i];
      const sphere = sphereRefs.current[i];
      const ring = ringRefs.current[i];
      if (!sphere || !ring) continue;

      if (!fx) {
        sphere.visible = false;
        ring.visible = false;
        continue;
      }

      const age = Math.min(1, (now - fx.createdAt) / 700);
      const fade = Math.pow(1 - age, 1.4);

      if (fx.kind === "shadow_step") {
        sphere.visible = false;
        ring.visible = true;
        ring.position.set(fx.targetX ?? fx.x, (fx.targetY ?? fx.y) - 0.6, fx.targetZ ?? fx.z);
        ring.rotation.set(-Math.PI / 2, 0, age * 5);
        const rs = 0.6 + age * 2.2;
        ring.scale.set(rs, rs, 1);
        (ring.material as THREE.MeshBasicMaterial).color.set("#a855f7");
        (ring.material as THREE.MeshBasicMaterial).opacity = fade * 0.85;

        if (featherMeshRef.current) {
          for (let f = 0; f < FEATHERS_PER_BURST && featherIdx < totalFeathers; f++) {
            const originX = f < FEATHERS_PER_BURST / 2 ? fx.x : (fx.targetX ?? fx.x);
            const originY = f < FEATHERS_PER_BURST / 2 ? fx.y : (fx.targetY ?? fx.y);
            const originZ = f < FEATHERS_PER_BURST / 2 ? fx.z : (fx.targetZ ?? fx.z);
            const angle = (f * 2.39996) + age * 2.4;
            const rad = 0.35 + age * (1.8 + (f % 5) * 0.35);
            dummy.position.set(
              originX + Math.cos(angle) * rad,
              originY + Math.sin(age * Math.PI) * 1.4 + ((f % 4) - 1.5) * 0.35,
              originZ + Math.sin(angle) * rad
            );
            dummy.rotation.set(age * 6 + f, angle, age * 4);
            const sc = (1 - age * 0.55) * (0.8 + (f % 3) * 0.25);
            dummy.scale.set(sc, sc, sc);
            dummy.updateMatrix();
            featherMeshRef.current.setMatrixAt(featherIdx++, dummy.matrix);
          }
        }
      } else if (fx.kind === "fireball_explode" || fx.kind === "arcane_explode") {
        const isFire = fx.kind === "fireball_explode";
        sphere.visible = true;
        sphere.position.set(fx.x, fx.y, fx.z);
        const ss = 0.5 + Math.pow(age, 0.5) * 2.8;
        sphere.scale.set(ss, ss, ss);
        sphere.material = isFire ? fireShaderMat : arcaneShaderMat;
        (sphere.material as THREE.ShaderMaterial).uniforms.uOpacity.value = fade;

        ring.visible = true;
        ring.position.set(fx.x, Math.max(0.06, fx.y - 0.5), fx.z);
        ring.rotation.set(-Math.PI / 2, 0, age * 3);
        const rs = 0.6 + age * 3.1;
        ring.scale.set(rs, rs, 1);
        (ring.material as THREE.MeshBasicMaterial).color.set(isFire ? "#ff7b24" : "#38bdf8");
        (ring.material as THREE.MeshBasicMaterial).opacity = fade * 0.9;
      } else {
        // stun_arc or shock_ring
        sphere.visible = false;
        ring.visible = true;
        ring.position.set(fx.x, fx.y, fx.z);
        ring.rotation.set(-Math.PI / 2, 0, age * 9);
        const rs = 0.45 + age * 2.0;
        ring.scale.set(rs, rs, 1);
        (ring.material as THREE.MeshBasicMaterial).color.set("#22d3ee");
        (ring.material as THREE.MeshBasicMaterial).opacity = fade * 0.95;
      }
    }

    if (featherMeshRef.current) {
      featherMeshRef.current.count = featherIdx;
      featherMeshRef.current.instanceMatrix.needsUpdate = true;
    }

    // FFA Sacred Overdrive Ring pulse
    if (ffaRingRef.current) {
      const isFfa = worldRef.current.gameMode === "ffa";
      ffaRingRef.current.visible = isFfa;
      if (isFfa) {
        const prog = worldRef.current.ffaZoneProgress;
        const mat = ffaRingRef.current.material as THREE.MeshBasicMaterial;
        mat.color.set(prog > 0.05 ? "#22d3ee" : "#fbbf24");
        mat.opacity = 0.35 + Math.sin(state.clock.elapsedTime * 4) * 0.12 + prog * 0.4;
      }
    }
  });

  return (
    <group>
      <instancedMesh
        ref={featherMeshRef}
        args={[featherGeo, featherMat, MAX_BURSTS * FEATHERS_PER_BURST]}
        frustumCulled={false}
      />
      {Array.from({ length: MAX_BURSTS }).map((_, idx) => (
        <group key={idx}>
          <mesh
            ref={(el) => {
              sphereRefs.current[idx] = el;
            }}
            geometry={sphereGeo}
            material={fireShaderMat}
            visible={false}
          />
          <mesh
            ref={(el) => {
              ringRefs.current[idx] = el;
            }}
            geometry={ringGeo}
            visible={false}
          >
            <meshBasicMaterial
              transparent
              opacity={0}
              side={THREE.DoubleSide}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
        </group>
      ))}
      <mesh ref={ffaRingRef} visible={false} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
        <ringGeometry args={[FFA_CONFIG.RING_RADIUS - 0.28, FFA_CONFIG.RING_RADIUS, 48]} />
        <meshBasicMaterial
          color="#fbbf24"
          transparent
          opacity={0.45}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
});
