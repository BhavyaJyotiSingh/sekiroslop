import { memo, useEffect, useMemo } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { type ArenaMapKind } from "@sekiroslop/shared";

interface ArenaSkyProps {
  mapKind: ArenaMapKind;
}

interface SkyStyle {
  top: string;
  mid: string;
  horizon: string;
  lower: string;
  sun: string;
  cloudTint: string;
  cloudStrength: number;
  celestialPos: [number, number, number];
  celestialRadius: number;
  haloScale: number;
  haloOpacity: number;
  ridgeColor: string;
}

const SKY_STYLES: Record<ArenaMapKind, SkyStyle> = {
  sunlit_colosseum: {
    top: "#295c9e",
    mid: "#d99b66",
    horizon: "#ffd99c",
    lower: "#b3744f",
    sun: "#fff0b8",
    cloudTint: "#ffe7bf",
    cloudStrength: 0.24,
    celestialPos: [38, 30, -76],
    celestialRadius: 5.8,
    haloScale: 2.1,
    haloOpacity: 0.16,
    ridgeColor: "#6e5340",
  },
  moonlit_sakura: {
    top: "#142248",
    mid: "#2b4278",
    horizon: "#7389be",
    lower: "#30416e",
    sun: "#f5f9ff",
    cloudTint: "#a2b6e3",
    cloudStrength: 0.2,
    celestialPos: [16, 36, -82],
    celestialRadius: 10.2,
    haloScale: 2.0,
    haloOpacity: 0.2,
    ridgeColor: "#243258",
  },
  aurora_sanctuary: {
    top: "#081c2e",
    mid: "#14596b",
    horizon: "#703e9e",
    lower: "#1d3154",
    sun: "#a5f3fc",
    cloudTint: "#5eead4",
    cloudStrength: 0.24,
    celestialPos: [-22, 38, -80],
    celestialRadius: 8.6,
    haloScale: 2.3,
    haloOpacity: 0.24,
    ridgeColor: "#14273d",
  },
  sunny_sakura: {
    top: "#3b82c4",
    mid: "#9ad1eb",
    horizon: "#ffe6c7",
    lower: "#c4d6a8",
    sun: "#fff6cc",
    cloudTint: "#fff5eb",
    cloudStrength: 0.28,
    celestialPos: [34, 34, -76],
    celestialRadius: 6.2,
    haloScale: 2.3,
    haloOpacity: 0.2,
    ridgeColor: "#5a7852",
  },
};

/** Maps that render as warm daytime skies (sun disc + solar horizon scattering, no stars/moon). */
const DAYTIME_MAPS: ReadonlySet<ArenaMapKind> = new Set<ArenaMapKind>(["sunlit_colosseum", "sunny_sakura"]);

function createMoonTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const grad = ctx.createRadialGradient(112, 108, 12, 128, 128, 128);
    grad.addColorStop(0, "#ffffff");
    grad.addColorStop(0.65, "#e6eeff");
    grad.addColorStop(1, "#b8c9eb");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 256);

    const craters: [number, number, number, number][] = [
      [88, 92, 26, 0.14],
      [152, 78, 20, 0.12],
      [168, 146, 30, 0.15],
      [96, 162, 22, 0.11],
      [130, 124, 15, 0.1],
      [62, 134, 18, 0.09],
      [186, 104, 14, 0.1],
    ];
    for (const [cx, cy, r, alpha] of craters) {
      const cGrad = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r);
      cGrad.addColorStop(0, `rgba(115, 132, 170, ${alpha})`);
      cGrad.addColorStop(1, "rgba(115, 132, 170, 0)");
      ctx.fillStyle = cGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function buildHorizonRidgeGeometry(mapKind: ArenaMapKind): THREE.BufferGeometry {
  const segments = 96;
  const radius = 88;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= segments; i++) {
    const u = i / segments;
    const angle = u * Math.PI * 2;
    const x = Math.sin(angle) * radius;
    const z = Math.cos(angle) * radius;

    let peakH = 12;
    if (mapKind === "sunlit_colosseum") {
      peakH =
        9 +
        Math.sin(angle * 4 + 0.5) * 3.5 +
        Math.cos(angle * 7 - 1.1) * 2.2 +
        Math.sin(angle * 13) * 1.1;
    } else if (mapKind === "aurora_sanctuary") {
      peakH =
        13 +
        Math.abs(Math.sin(angle * 4 + 0.7)) * 14 +
        Math.cos(angle * 9) * 4.5;
    } else if (mapKind === "sunny_sakura") {
      // Soft rolling spring hills with a single gentle Mt.-Fuji-like cone (centred behind the sun, north)
      const rolling =
        7 +
        Math.sin(angle * 3 + 0.9) * 2.4 +
        Math.cos(angle * 5 - 0.4) * 1.5 +
        Math.sin(angle * 9 + 1.7) * 0.6;
      // Angular distance from the north (-Z) direction where angle === PI
      let d = Math.abs(angle - Math.PI);
      if (d > Math.PI) d = Math.PI * 2 - d;
      const fujiW = 0.62;
      const fuji = d < fujiW ? Math.pow(1 - d / fujiW, 1.6) * 17 : 0;
      peakH = Math.max(rolling, 6 + fuji);
    } else {
      peakH =
        14 +
        Math.abs(Math.sin(angle * 5 + 0.3)) * 12 +
        Math.sin(angle * 11 + 1.4) * 4.5 +
        Math.cos(angle * 19) * 2.0;
    }

    // Bottom vertex
    positions.push(x, -8, z);
    uvs.push(u, 0);
    // Top vertex
    positions.push(x, peakH, z);
    uvs.push(u, 1);
  }

  for (let i = 0; i < segments; i++) {
    const a = i * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    indices.push(a, c, b);
    indices.push(b, c, d);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** Animated Aurora Borealis sky curtains for the aurora_sanctuary map. */
const AuroraCurtains = memo(function AuroraCurtains() {
  const { geo1, geo2, material } = useMemo(() => {
    const g1 = new THREE.CylinderGeometry(72, 72, 24, 72, 16, true, Math.PI * 0.55, Math.PI * 0.9);
    const g2 = new THREE.CylinderGeometry(78, 78, 24, 72, 16, true, Math.PI * 0.72, Math.PI * 0.85);

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
      uniforms: {
        uTime: { value: 0 },
      },
      vertexShader: `
        uniform float uTime;
        varying vec2 vUv;
        varying vec3 vWorldPos;
        void main() {
          vUv = uv;
          vec3 pos = position;
          // Gentle ribbon wave displacement along the arc
          float wave = sin(uv.x * 10.0 + uTime * 0.35) * 1.4 + cos(uv.x * 17.0 - uTime * 0.25) * 0.8;
          pos.xz += normalize(pos.xz) * wave * uv.y;
          vec4 worldPosition = modelMatrix * vec4(pos, 1.0);
          vWorldPos = worldPosition.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPosition;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        varying vec2 vUv;
        varying vec3 vWorldPos;

        void main() {
          float vFade = smoothstep(0.0, 0.28, vUv.y) * smoothstep(1.0, 0.22, vUv.y);
          float hFade = smoothstep(0.0, 0.15, vUv.x) * smoothstep(1.0, 0.85, vUv.x);

          float fold1 = sin(vUv.x * 18.0 + uTime * 0.45 + vWorldPos.x * 0.05) * 0.5 + 0.5;
          float fold2 = sin(vUv.x * 31.0 - uTime * 0.32 + vWorldPos.z * 0.07) * 0.5 + 0.5;
          float fold3 = sin(vUv.x * 7.0 + uTime * 0.18) * 0.5 + 0.5;
          float curtain = pow(fold1 * 0.55 + fold2 * 0.3 + fold3 * 0.15, 1.35);

          float streak = 0.7 + 0.3 * sin(vUv.x * 52.0 + uTime * 0.6);

          vec3 emerald = vec3(0.204, 0.827, 0.600);
          vec3 cyan    = vec3(0.133, 0.827, 0.933);
          vec3 magenta = vec3(0.957, 0.447, 0.714);

          float colorShift = clamp(vUv.y * 0.75 + fold3 * 0.35 - 0.1, 0.0, 1.0);
          vec3 col = mix(emerald, cyan, smoothstep(0.0, 0.5, colorShift));
          col = mix(col, magenta, smoothstep(0.45, 1.0, colorShift));

          float alpha = vFade * hFade * curtain * streak * 0.52;
          gl_FragColor = vec4(col, alpha);
        }
      `,
    });

    return { geo1: g1, geo2: g2, material: mat };
  }, []);

  useFrame((state) => {
    material.uniforms.uTime.value = state.clock.elapsedTime;
  });

  useEffect(() => {
    return () => {
      geo1.dispose();
      geo2.dispose();
      material.dispose();
    };
  }, [geo1, geo2, material]);

  return (
    <group>
      <mesh
        geometry={geo1}
        material={material}
        position={[0, 34, 0]}
        rotation={[0.06, 0, -0.04]}
        renderOrder={-995}
        frustumCulled={false}
      />
      <mesh
        geometry={geo2}
        material={material}
        position={[0, 40, 0]}
        rotation={[-0.04, 0, 0.05]}
        renderOrder={-995}
        frustumCulled={false}
      />
    </group>
  );
});

export const ArenaSky = memo(function ArenaSky({ mapKind }: ArenaSkyProps) {
  const style = SKY_STYLES[mapKind] ?? SKY_STYLES.sunlit_colosseum;

  const skyMaterial = useMemo(() => {
    const sunDir = new THREE.Vector3(...style.celestialPos).normalize();
    return new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
      uniforms: {
        topColor: { value: new THREE.Color(style.top) },
        midColor: { value: new THREE.Color(style.mid) },
        horizonColor: { value: new THREE.Color(style.horizon) },
        lowerColor: { value: new THREE.Color(style.lower) },
        sunColor: { value: new THREE.Color(style.sun) },
        cloudTint: { value: new THREE.Color(style.cloudTint) },
        cloudStrength: { value: style.cloudStrength },
        sunDirection: { value: sunDir },
        isSunlit: { value: DAYTIME_MAPS.has(mapKind) ? 1.0 : 0.0 },
        uTime: { value: 0 },
      },
      vertexShader: `
        varying vec3 vSkyDirection;
        void main() {
          vSkyDirection = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 midColor;
        uniform vec3 horizonColor;
        uniform vec3 lowerColor;
        uniform vec3 sunColor;
        uniform vec3 cloudTint;
        uniform float cloudStrength;
        uniform vec3 sunDirection;
        uniform float isSunlit;
        uniform float uTime;
        varying vec3 vSkyDirection;

        float waveNoise(vec2 p) {
          float n = sin(p.x * 1.7 + uTime * 0.04) * cos(p.y * 1.3 - uTime * 0.025);
          n += 0.5 * sin(p.x * 3.4 - uTime * 0.06 + p.y * 2.1);
          n += 0.25 * cos(p.x * 6.2 + p.y * 4.8 + uTime * 0.05);
          return n * 0.5 + 0.5;
        }

        void main() {
          vec3 direction = normalize(vSkyDirection);
          float height = direction.y;
          vec3 sky = mix(lowerColor, horizonColor, smoothstep(-0.35, 0.06, height));
          sky = mix(sky, midColor, smoothstep(0.04, 0.34, height));
          sky = mix(sky, topColor, smoothstep(0.28, 0.82, height));

          // Soft drifting cloud / mist bands
          if (height > 0.02) {
            vec2 cloudUv = direction.xz / (height + 0.22);
            float c = waveNoise(cloudUv * 1.45);
            float band = smoothstep(0.46, 0.86, c) * smoothstep(0.02, 0.22, height) * (1.0 - smoothstep(0.55, 0.92, height));
            sky = mix(sky, cloudTint, band * cloudStrength);
          }

          float sunDot = max(dot(direction, normalize(sunDirection)), 0.0);
          float disc = pow(sunDot, 320.0);
          float glow = pow(sunDot, 14.0);
          sky += sunColor * (disc * 1.45 + glow * 0.3);

          if (isSunlit > 0.5) {
            // Soft golden solar atmospheric scattering halo near the horizon
            float horizonMask = 1.0 - smoothstep(-0.08, 0.38, height);
            float scatter = pow(sunDot, 4.0) * horizonMask;
            sky += vec3(1.0, 0.82, 0.48) * scatter * 0.36;
          } else {
            // Cool silver-indigo horizon mist band on moonlit_sakura
            float mistBand = exp(-pow((height - 0.02) / 0.14, 2.0));
            float mistWave = 0.82 + 0.18 * sin(direction.x * 6.0 + direction.z * 5.0 + uTime * 0.08);
            sky = mix(sky, vec3(0.48, 0.58, 0.84), mistBand * mistWave * 0.28);
          }

          gl_FragColor = vec4(sky, 1.0);
        }
      `,
    });
  }, [mapKind, style]);

  const moonTexture = useMemo(() => {
    if (mapKind !== "moonlit_sakura") return null;
    return createMoonTexture();
  }, [mapKind]);

  const stars = useMemo(() => {
    if (mapKind !== "moonlit_sakura" && mapKind !== "aurora_sanctuary") return null;
    const count = 360;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const phases = new Float32Array(count);
    const cA = new THREE.Color("#dce8ff");
    const cB = new THREE.Color("#ffe7b8");
    const tmp = new THREE.Color();

    for (let i = 0; i < count; i++) {
      const seed = i + 101;
      const random = (value: number) => {
        const n = Math.sin(value * 127.1 + 311.7) * 43758.5453;
        return n - Math.floor(n);
      };
      const yaw = random(seed) * Math.PI * 2;
      const height = 0.14 + random(seed + 811) * 0.82;
      const radius = 112;
      const horizontal = Math.sqrt(1 - height * height) * radius;
      positions[i * 3] = Math.cos(yaw) * horizontal;
      positions[i * 3 + 1] = height * radius;
      positions[i * 3 + 2] = Math.sin(yaw) * horizontal;

      const brightness = 0.55 + random(seed + 1901) * 0.65;
      tmp.copy(i % 4 === 0 ? cB : cA).multiplyScalar(brightness);
      colors[i * 3] = tmp.r;
      colors[i * 3 + 1] = tmp.g;
      colors[i * 3 + 2] = tmp.b;
      phases[i] = random(seed + 2401) * Math.PI * 2;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
    return geometry;
  }, [mapKind]);

  const starMaterial = useMemo(() => {
    if (mapKind !== "moonlit_sakura" && mapKind !== "aurora_sanctuary") return null;
    return new THREE.ShaderMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      uniforms: {
        uTime: { value: 0 },
      },
      vertexShader: `
        attribute float aPhase;
        varying vec3 vColor;
        varying float vPhase;
        void main() {
          vColor = color;
          vPhase = aPhase;
          gl_PointSize = 1.65;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        varying vec3 vColor;
        varying float vPhase;
        void main() {
          float twinkle = 0.68 + 0.32 * sin(uTime * 1.8 + vPhase);
          gl_FragColor = vec4(vColor, twinkle * 0.9);
        }
      `,
    });
  }, [mapKind]);

  const ridgeGeometry = useMemo(() => buildHorizonRidgeGeometry(mapKind), [mapKind]);

  const ridgeMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      uniforms: {
        baseColor: { value: new THREE.Color(style.ridgeColor) },
        horizonColor: { value: new THREE.Color(style.horizon) },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 baseColor;
        uniform vec3 horizonColor;
        varying vec2 vUv;
        void main() {
          // Atmospheric horizon haze fade near base
          vec3 col = mix(horizonColor, baseColor, smoothstep(0.0, 0.55, vUv.y) * 0.75 + 0.25);
          float alpha = smoothstep(1.0, 0.88, vUv.y) * 0.94;
          gl_FragColor = vec4(col, alpha);
        }
      `,
    });
  }, [style]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    skyMaterial.uniforms.uTime.value = t;
    if (starMaterial) starMaterial.uniforms.uTime.value = t;
  });

  useEffect(() => {
    return () => {
      skyMaterial.dispose();
      moonTexture?.dispose();
      stars?.dispose();
      starMaterial?.dispose();
      ridgeGeometry.dispose();
      ridgeMaterial.dispose();
    };
  }, [skyMaterial, moonTexture, stars, starMaterial, ridgeGeometry, ridgeMaterial]);

  return (
    <group>
      {/* Procedural Sky Dome */}
      <mesh renderOrder={-1000} frustumCulled={false}>
        <sphereGeometry args={[124, 32, 24]} />
        <primitive object={skyMaterial} attach="material" />
      </mesh>

      {/* Distant Horizon Mountain / Caldera Ridge */}
      <mesh geometry={ridgeGeometry} material={ridgeMaterial} renderOrder={-992} frustumCulled={false} />

      {/* Celestial Body (Golden Sun / Giant Full Moon) */}
      <group position={style.celestialPos}>
        <mesh renderOrder={-998}>
          <sphereGeometry args={[style.celestialRadius, 24, 20]} />
          <meshBasicMaterial
            color={style.sun}
            map={moonTexture ?? undefined}
            toneMapped={false}
          />
        </mesh>
        <mesh renderOrder={-997} scale={style.haloScale}>
          <sphereGeometry args={[style.celestialRadius, 20, 16]} />
          <meshBasicMaterial
            color={style.sun}
            transparent
            opacity={style.haloOpacity}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
          />
        </mesh>
      </group>

      {/* Starfield */}
      {stars && starMaterial && (
        <points geometry={stars} material={starMaterial} renderOrder={-999} frustumCulled={false} />
      )}

      {/* Aurora Borealis Curtains */}
      {mapKind === "aurora_sanctuary" && <AuroraCurtains />}
    </group>
  );
});
