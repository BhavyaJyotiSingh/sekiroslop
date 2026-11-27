import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import type { GraphicsQualityTier } from "../lib/graphicsQuality";

interface FlightVFXProps {
  active: boolean;
  activeRef?: React.MutableRefObject<boolean>;
  graphicsTier: GraphicsQualityTier;
}

const SPARK_STRIDE = 9; // x, y, z, vx, vy, vz, life, maxLife, nozzleSign
const TAIL_FADE_SECONDS = 0.28;
const BURST_SECONDS = 0.42;

const _dummy = new THREE.Object3D();
const _color = new THREE.Color();
const _colorBirth = new THREE.Color("#ffe680");
const _colorMid = new THREE.Color("#ff6218");
const _colorEnd = new THREE.Color("#b82908");

function createExhaustHaloTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const half = size / 2;
    const grad = ctx.createRadialGradient(half, half, 0, half, half, half);
    grad.addColorStop(0, "rgba(255, 240, 190, 1)");
    grad.addColorStop(0.28, "rgba(255, 136, 40, 0.82)");
    grad.addColorStop(0.65, "rgba(255, 72, 16, 0.22)");
    grad.addColorStop(1, "rgba(255, 40, 0, 0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/** San Andreas-style twin-nozzle fire propulsion rig for local and remote flight. */
export function FlightVFX({ active, activeRef, graphicsTier }: FlightVFXProps) {
  const groupRef = useRef<THREE.Group>(null);
  const outerConesRef = useRef<Array<THREE.Mesh | null>>([]);
  const innerConesRef = useRef<Array<THREE.Mesh | null>>([]);
  const haloRef = useRef<THREE.Mesh>(null);
  const sparksRef = useRef<THREE.InstancedMesh>(null);

  const wasActiveRef = useRef(active);
  const burstUntilRef = useRef(0);
  const tailUntilRef = useRef(0);
  const nextNozzleRef = useRef(1);
  const spawnAccumRef = useRef(0);

  const lowQuality = graphicsTier === "low";
  const sparkCount = lowQuality ? 10 : 20;

  const resources = useMemo(() => {
    const outerGeo = new THREE.ConeGeometry(0.14, 0.95, 10, 1, true);
    outerGeo.rotateX(Math.PI);
    outerGeo.translate(0, -0.95 / 2, 0);

    const innerGeo = new THREE.ConeGeometry(0.075, 0.62, 8, 1, true);
    innerGeo.rotateX(Math.PI);
    innerGeo.translate(0, -0.62 / 2, 0);

    const haloGeo = new THREE.PlaneGeometry(1.15, 1.15);

    const sparkGeo = new THREE.OctahedronGeometry(0.055, 0);
    sparkGeo.scale(0.85, 1.85, 0.85);

    const haloTex = createExhaustHaloTexture();

    const outerMat = new THREE.MeshBasicMaterial({
      color: "#ff5a14",
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });

    const innerMat = new THREE.MeshBasicMaterial({
      color: "#fff3b0",
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });

    const haloMat = new THREE.MeshBasicMaterial({
      color: "#ff7a1f",
      map: haloTex,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });

    const sparkMat = new THREE.MeshBasicMaterial({
      color: "#ffffff",
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });

    return {
      outerGeo,
      innerGeo,
      haloGeo,
      sparkGeo,
      haloTex,
      outerMat,
      innerMat,
      haloMat,
      sparkMat,
    };
  }, []);

  const sparkState = useMemo(() => new Float32Array(sparkCount * SPARK_STRIDE), [sparkCount]);

  useEffect(() => {
    return () => {
      resources.outerGeo.dispose();
      resources.innerGeo.dispose();
      resources.haloGeo.dispose();
      resources.sparkGeo.dispose();
      resources.haloTex.dispose();
      resources.outerMat.dispose();
      resources.innerMat.dispose();
      resources.haloMat.dispose();
      resources.sparkMat.dispose();
    };
  }, [resources]);

  useFrame(({ clock, camera }, delta) => {
    const group = groupRef.current;
    if (!group) return;

    const dt = Math.min(0.05, Math.max(0.001, delta));
    const isActive = activeRef?.current ?? active;
    const now = clock.elapsedTime;

    if (isActive && !wasActiveRef.current) {
      burstUntilRef.current = now + BURST_SECONDS;
    } else if (!isActive && wasActiveRef.current) {
      tailUntilRef.current = now + TAIL_FADE_SECONDS;
    }
    wasActiveRef.current = isActive;

    const burst = Math.max(0, Math.min(1, (burstUntilRef.current - now) / BURST_SECONDS));
    const tail = isActive ? 1 : Math.max(0, Math.min(1, (tailUntilRef.current - now) / TAIL_FADE_SECONDS));

    group.visible = isActive || burst > 0 || tail > 0;
    if (!group.visible) return;

    const thrust = isActive ? 1 : tail * 0.65;
    const flickerA = 0.86 + Math.sin(now * 46) * 0.1 + Math.cos(now * 73) * 0.06;
    const flickerB = 0.86 + Math.sin(now * 51 + 1.9) * 0.1 + Math.cos(now * 67 + 0.7) * 0.06;
    const burstBoost = 1 + burst * 0.55;

    for (let i = 0; i < 2; i += 1) {
      const f = i === 0 ? flickerA : flickerB;
      const outerCone = outerConesRef.current[i];
      if (outerCone) {
        const lenScale = (0.72 + thrust * 0.42) * f * burstBoost;
        const radScale = (0.85 + thrust * 0.25) * (0.94 + f * 0.08) * (1 + burst * 0.35);
        outerCone.scale.set(radScale, lenScale, radScale);
      }
      const innerCone = innerConesRef.current[i];
      if (innerCone) {
        const lenScale = (0.68 + thrust * 0.45) * (0.9 + f * 0.12) * burstBoost;
        const radScale = (0.85 + thrust * 0.22) * (1 + burst * 0.3);
        innerCone.scale.set(radScale, lenScale, radScale);
      }
    }

    resources.outerMat.opacity = (isActive ? 0.72 : tail * 0.68) * (0.88 + Math.sin(now * 38) * 0.12);
    resources.innerMat.opacity = (isActive ? 0.9 : tail * 0.75) * (0.9 + Math.cos(now * 44) * 0.1);

    const halo = haloRef.current;
    if (halo) {
      const haloScale = (0.82 + thrust * 0.28 + burst * 0.65) * (0.94 + Math.sin(now * 31) * 0.06);
      halo.scale.set(haloScale, haloScale, 1);
      halo.lookAt(camera.position);
      resources.haloMat.opacity = isActive
        ? 0.42 + burst * 0.42 + Math.sin(now * 28) * 0.05
        : tail * 0.4;
    }

    const sparksMesh = sparksRef.current;
    if (sparksMesh) {
      let spawnBudget = 0;
      if (isActive) {
        spawnAccumRef.current += dt * (lowQuality ? 34 : 68);
        spawnBudget = Math.floor(spawnAccumRef.current);
        spawnAccumRef.current -= spawnBudget;
      } else {
        spawnAccumRef.current = 0;
      }

      for (let i = 0; i < sparkCount; i += 1) {
        const base = i * SPARK_STRIDE;
        let life = sparkState[base + 6];
        let maxLife = sparkState[base + 7];

        if (life >= maxLife || maxLife <= 0) {
          if (isActive && spawnBudget > 0) {
            spawnBudget -= 1;
            const sign = nextNozzleRef.current;
            nextNozzleRef.current = -sign;

            sparkState[base] = sign * 0.2 + (Math.random() - 0.5) * 0.08;
            sparkState[base + 1] = 0.88 + (Math.random() - 0.5) * 0.06;
            sparkState[base + 2] = -0.26 + (Math.random() - 0.5) * 0.06;
            sparkState[base + 3] = (Math.random() - 0.5) * 0.9;
            sparkState[base + 4] = -(4.5 + Math.random() * 3.0);
            sparkState[base + 5] = -(1.8 + Math.random() * 1.4);
            life = 0;
            maxLife = 0.16 + Math.random() * 0.11;
            sparkState[base + 6] = life;
            sparkState[base + 7] = maxLife;
            sparkState[base + 8] = sign;
          } else {
            _dummy.position.set(0, -100, 0);
            _dummy.scale.setScalar(0);
            _dummy.updateMatrix();
            sparksMesh.setMatrixAt(i, _dummy.matrix);
            continue;
          }
        }

        life += dt;
        sparkState[base + 6] = life;

        if (life >= maxLife) {
          _dummy.position.set(0, -100, 0);
          _dummy.scale.setScalar(0);
          _dummy.updateMatrix();
          sparksMesh.setMatrixAt(i, _dummy.matrix);
          continue;
        }

        const x = sparkState[base] + sparkState[base + 3] * dt;
        const y = sparkState[base + 1] + sparkState[base + 4] * dt;
        const z = sparkState[base + 2] + sparkState[base + 5] * dt;
        sparkState[base] = x;
        sparkState[base + 1] = y;
        sparkState[base + 2] = z;

        const t = life / maxLife;
        const scale = (1 - t) * (0.75 + (1 - t) * 0.45) * (isActive ? 1 : tail);

        _dummy.position.set(x, y, z);
        _dummy.rotation.set(0.22, 0, 0);
        _dummy.scale.set(scale, scale, scale);
        _dummy.updateMatrix();
        sparksMesh.setMatrixAt(i, _dummy.matrix);

        if (t < 0.45) {
          _color.copy(_colorBirth).lerp(_colorMid, t / 0.45);
        } else {
          _color.copy(_colorMid).lerp(_colorEnd, (t - 0.45) / 0.55);
        }
        if (!isActive) {
          _color.multiplyScalar(tail);
        }
        sparksMesh.setColorAt(i, _color);
      }

      sparksMesh.instanceMatrix.needsUpdate = true;
      if (sparksMesh.instanceColor) {
        sparksMesh.instanceColor.needsUpdate = true;
      }
    }
  });

  return (
    <group ref={groupRef} visible={false}>
      {[-1, 1].map((sign, index) => (
        <group
          key={sign}
          position={[sign * 0.2, 0.96, -0.24]}
          rotation={[0.22, 0, 0]}
        >
          <mesh
            ref={(mesh) => { outerConesRef.current[index] = mesh; }}
            geometry={resources.outerGeo}
            material={resources.outerMat}
            castShadow={false}
            receiveShadow={false}
          />
          <mesh
            ref={(mesh) => { innerConesRef.current[index] = mesh; }}
            geometry={resources.innerGeo}
            material={resources.innerMat}
            castShadow={false}
            receiveShadow={false}
          />
        </group>
      ))}

      <mesh
        ref={haloRef}
        position={[0, 0.78, -0.32]}
        geometry={resources.haloGeo}
        material={resources.haloMat}
        castShadow={false}
        receiveShadow={false}
      />

      <instancedMesh
        key={sparkCount}
        ref={sparksRef}
        args={[resources.sparkGeo, resources.sparkMat, sparkCount]}
        frustumCulled={false}
        castShadow={false}
        receiveShadow={false}
      />
    </group>
  );
}
