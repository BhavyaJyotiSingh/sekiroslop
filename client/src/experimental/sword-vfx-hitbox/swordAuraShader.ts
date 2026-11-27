import * as THREE from "three";

export interface BladeAuraShaderOptions {
  coreColor?: string;
  edgeColor?: string;
  intensity?: number;
}

export interface RibbonTrailShaderOptions {
  coreColor?: string;
  edgeColor?: string;
  intensity?: number;
}

const BLADE_AURA_VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uIntensity;

  varying vec2 vUv;
  varying vec3 vViewNormal;
  varying vec3 vViewDir;

  void main() {
    vUv = uv;

    // Subtle energetic plasma breathe along the blade surface normal
    float pulse = sin(uv.y * 14.0 - uTime * 11.0 + uv.x * 6.28318) * 0.5 + 0.5;
    float tipRamp = smoothstep(0.0, 0.25, uv.y);
    float displace = (0.004 + 0.008 * pulse) * clamp(uIntensity, 0.0, 2.0) * tipRamp;
    vec3 displaced = position + normal * displace;

    vec4 mvPos = modelViewMatrix * vec4(displaced, 1.0);
    vViewNormal = normalize(normalMatrix * normal);
    vViewDir = normalize(-mvPos.xyz);

    gl_Position = projectionMatrix * mvPos;
  }
`;

const BLADE_AURA_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform vec3 uCoreColor;
  uniform vec3 uEdgeColor;
  uniform float uIntensity;

  varying vec2 vUv;
  varying vec3 vViewNormal;
  varying vec3 vViewDir;

  void main() {
    if (uIntensity <= 0.005) discard;

    // Flowing Fresnel rim highlight wrapping the steel silhouette
    float ndotv = abs(dot(normalize(vViewNormal), normalize(vViewDir)));
    float fresnel = pow(1.0 - clamp(ndotv, 0.0, 1.0), 1.9);

    // Dual-layer plasma waves surging from guard (vUv.y = 0) toward tip (vUv.y = 1)
    float waveA = sin(vUv.y * 18.0 - uTime * 12.5 + sin(vUv.x * 9.4247 + uTime * 4.2) * 1.4);
    float waveB = cos(vUv.y * 28.0 - uTime * 19.0 - vUv.x * 12.566);
    float plasma = clamp(0.55 + 0.30 * waveA + 0.15 * waveB, 0.0, 1.0);

    // Taper cleanly near the crossguard and blaze brightest along the cutting edge & tip
    float guardFade = smoothstep(0.0, 0.14, vUv.y);
    float tipBoost = 0.75 + 0.45 * smoothstep(0.55, 1.0, vUv.y);

    float coreMask = smoothstep(0.32, 0.92, plasma * tipBoost) * (0.35 + 0.65 * fresnel);
    vec3 color = mix(uEdgeColor, uCoreColor, clamp(coreMask + (1.0 - fresnel) * 0.25, 0.0, 1.0));

    float alpha = (0.28 + 0.72 * fresnel) * (0.48 + 0.52 * plasma) * guardFade * clamp(uIntensity, 0.0, 2.2);
    alpha = clamp(alpha, 0.0, 0.95);

    gl_FragColor = vec4(color * (1.1 + 0.55 * uIntensity), alpha);
  }
`;

const RIBBON_TRAIL_VERTEX = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const RIBBON_TRAIL_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform vec3 uCoreColor;
  uniform vec3 uEdgeColor;
  uniform float uIntensity;

  varying vec2 vUv;

  // Lightweight procedural value noise for fiery/energetic ribbon shimmer
  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  void main() {
    if (uIntensity <= 0.005) discard;

    // vUv.x: 0.0 at live sword head -> 1.0 at oldest ribbon tail
    // vUv.y: 0.0 at hilt/base -> 1.0 at sword tip
    float age = clamp(vUv.x, 0.0, 1.0);
    float span = clamp(vUv.y, 0.0, 1.0);

    // Smooth decay along trail age with wisps dissolving the tail
    float ageFade = pow(1.0 - age, 1.55);

    // Energetic plasma / flame shimmer scrolling from live head toward tail
    float n1 = vnoise(vec2(age * 7.5 - uTime * 9.5, span * 5.0));
    float n2 = vnoise(vec2(age * 16.0 - uTime * 15.0, span * 11.0 + 3.1));
    float shimmer = n1 * 0.65 + n2 * 0.35;

    // Carve wispy flame erosion into the trailing half of the ribbon
    float erosion = smoothstep(age * 0.82 - 0.12, age * 0.82 + 0.38, shimmer + (1.0 - age) * 0.52);

    // Feather cleanly near the hilt base and concentrate radiant energy toward the razor tip edge
    float baseFeather = smoothstep(0.0, 0.28, span);
    float tipFeather = 1.0 - smoothstep(0.96, 1.0, span) * 0.35;
    float tipFilament = smoothstep(0.76, 0.97, span) * pow(1.0 - age, 1.1);

    // Hot white-core leading edge right behind the live blade
    float leadingEdge = exp(-age * 13.0) * baseFeather;
    float coreMix = clamp(tipFilament * 0.9 + leadingEdge * 0.8 + shimmer * 0.16 * (1.0 - age), 0.0, 1.0);

    vec3 color = mix(uEdgeColor, uCoreColor, coreMix);
    float energyBoost = 1.15 + 0.95 * tipFilament + 0.65 * leadingEdge;

    float alpha = ageFade * erosion * baseFeather * tipFeather * clamp(uIntensity, 0.0, 1.6);
    alpha = clamp(alpha + tipFilament * 0.35 * clamp(uIntensity, 0.0, 1.4), 0.0, 0.96);

    if (alpha <= 0.004) discard;
    gl_FragColor = vec4(color * energyBoost, alpha);
  }
`;

const TIP_SPARK_VERTEX = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;

  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vColor = color;
    vAlpha = aAlpha;

    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    float dist = max(0.5, -mvPosition.z);
    gl_PointSize = clamp(aSize * (240.0 / dist), 1.0, 42.0);
  }
`;

const TIP_SPARK_FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    if (vAlpha <= 0.005) discard;

    vec2 p = gl_PointCoord - vec2(0.5);
    float rSq = dot(p, p);
    if (rSq > 0.25) discard;

    // Bright hot center tapering to soft glowing halo
    float core = exp(-rSq * 24.0);
    float halo = pow(1.0 - rSq * 4.0, 1.6);
    vec3 finalColor = mix(vColor, vec3(1.0), core * 0.65);

    gl_FragColor = vec4(finalColor * (1.25 + core * 0.9), halo * vAlpha);
  }
`;

/**
 * Creates a reusable, zero-allocation custom GLSL ShaderMaterial for the flowing
 * Fresnel + plasma-wave energy aura wrapping the Roman Gladius blade.
 */
export function createBladeAuraMaterial(
  options: BladeAuraShaderOptions = {}
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: "ExperimentalBladeAuraMaterial",
    uniforms: {
      uTime: { value: 0 },
      uCoreColor: { value: new THREE.Color(options.coreColor ?? "#ffffff") },
      uEdgeColor: { value: new THREE.Color(options.edgeColor ?? "#38bdf8") },
      uIntensity: { value: options.intensity ?? 0.0 },
    },
    vertexShader: BLADE_AURA_VERTEX,
    fragmentShader: BLADE_AURA_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

/**
 * Creates a reusable, zero-allocation custom GLSL ShaderMaterial for the live
 * weapon-tracked ribbon slash trail (bright tip core fading along `vUv.x` with noise shimmer).
 */
export function createRibbonTrailMaterial(
  options: RibbonTrailShaderOptions = {}
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: "ExperimentalRibbonTrailMaterial",
    uniforms: {
      uTime: { value: 0 },
      uCoreColor: { value: new THREE.Color(options.coreColor ?? "#ffffff") },
      uEdgeColor: { value: new THREE.Color(options.edgeColor ?? "#38bdf8") },
      uIntensity: { value: options.intensity ?? 1.0 },
    },
    vertexShader: RIBBON_TRAIL_VERTEX,
    fragmentShader: RIBBON_TRAIL_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

/**
 * Creates a lightweight soft glowing particle ShaderMaterial for pooled blade-tip slash sparks.
 */
export function createBladeSparkPointsMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: "ExperimentalBladeSparkPointsMaterial",
    vertexShader: TIP_SPARK_VERTEX,
    fragmentShader: TIP_SPARK_FRAGMENT,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
}

/**
 * Zero-allocation uniform updater for `createBladeAuraMaterial` and `createRibbonTrailMaterial`.
 */
export function updateSwordShaderUniforms(
  material: THREE.ShaderMaterial,
  time: number,
  coreColorHex: string,
  edgeColorHex: string,
  intensity: number
): void {
  material.uniforms.uTime.value = time;
  (material.uniforms.uCoreColor.value as THREE.Color).set(coreColorHex);
  (material.uniforms.uEdgeColor.value as THREE.Color).set(edgeColorHex);
  material.uniforms.uIntensity.value = intensity;
}
