import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { holoUniforms } from '../../holo/uniforms'

/**
 * Hologram material for building elements. Same look as the shared holo
 * materials, plus two controls the construction story needs:
 *  - uCut: world Y above which the element is not built yet. Raising it grows
 *    the element floor by floor (time-lapse); lowering it dissolves it.
 *  - uScanY / uScanK: a bright band where the scan plane passes.
 */

const vertex = /* glsl */ `
  uniform float uIsLine;
  varying vec3 vWorldPos;
  varying vec3 vViewNormal;
  varying vec3 vViewDir;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPos = world.xyz;
    vec4 mv = viewMatrix * world;
    vViewNormal = uIsLine > 0.5 ? vec3(0.0, 0.0, 1.0) : normalize(normalMatrix * normal);
    vViewDir = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`

const fragment = /* glsl */ `
  uniform float uTime;
  uniform float uReveal;
  uniform vec3 uColor;
  uniform vec3 uScanColor;
  uniform float uOpacity;
  uniform float uRim;
  uniform float uScan;
  uniform float uCut;
  uniform float uScanY;
  uniform float uScanK;
  uniform float uIsLine;
  varying vec3 vWorldPos;
  varying vec3 vViewNormal;
  varying vec3 vViewDir;
  void main() {
    // Scene reveal sweep, as in the shared holo material.
    float h = mix(-8.0, 14.0, uReveal);
    float d = h - vWorldPos.y;
    float edge = smoothstep(0.6, 0.0, abs(d)) * step(0.001, uReveal) * step(uReveal, 0.999);
    float visible = step(0.0, d);
    if (visible < 0.5 && edge < 0.01) discard;

    // Construction front: not built above uCut. A thin hot line marks the pour level.
    float cutD = uCut - vWorldPos.y;
    if (cutD < 0.0) discard;
    float front = smoothstep(0.12, 0.0, cutD) * step(uCut, 30.0);

    float rim = 1.0;
    if (uIsLine < 0.5) {
      rim = 1.0 - abs(dot(normalize(vViewNormal), normalize(vViewDir)));
      rim = pow(rim, 2.2) * 2.0 + 0.15;
    }
    float scan = 0.82 + 0.18 * sin(vWorldPos.y * 38.0 - uTime * 3.0);
    float band = smoothstep(0.0, 0.08, fract(vWorldPos.y * 0.18 - uTime * 0.12)) * 0.25 + 0.75;
    float flicker = 0.96 + 0.04 * sin(uTime * 37.0 + vWorldPos.x * 3.0);
    float scanTerm = mix(1.0, scan * band, uScan);

    // Scan highlight: bright just at the plane, a softer wash below it.
    float sd = uScanY - vWorldPos.y;
    float hit = (smoothstep(0.25, 0.0, abs(sd)) * 0.9 + step(0.0, sd) * smoothstep(1.6, 0.0, sd) * 0.22) * uScanK;

    vec3 col = uColor * scanTerm * flicker;
    col = mix(col, uScanColor, clamp(hit, 0.0, 1.0) * 0.5) + uScanColor * hit * 0.25;
    col += vec3(0.8, 1.0, 1.0) * front * 2.0;
    float a = uOpacity * (uIsLine > 0.5 ? 1.0 : (0.35 + rim * uRim)) * scanTerm;
    a = max(a, (hit * 0.35 + front) * uOpacity);
    col += vec3(0.6, 0.95, 1.0) * edge * 3.0;
    a = max(a * visible, edge);
    gl_FragColor = vec4(col, a);
  }
`

export interface BuildOptions {
  color: THREE.ColorRepresentation
  intensity?: number
  opacity?: number
  rim?: number
  scan?: number
  line?: boolean
}

export type BuildMaterial = THREE.ShaderMaterial & {
  uniforms: {
    uColor: { value: THREE.Color }
    uOpacity: { value: number }
    uCut: { value: number }
    uScanY: { value: number }
    uScanK: { value: number }
  }
}

export function buildMaterial(o: BuildOptions): BuildMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: holoUniforms.uTime,
      uReveal: holoUniforms.uReveal,
      uColor: { value: new THREE.Color(o.color).multiplyScalar(o.intensity ?? 1) },
      uScanColor: { value: new THREE.Color('#9ff3ff').multiplyScalar(1.6) },
      uOpacity: { value: o.opacity ?? 0.8 },
      uRim: { value: o.rim ?? 1 },
      uScan: { value: o.scan ?? 0.6 },
      uCut: { value: 100 },
      uScanY: { value: -100 },
      uScanK: { value: 0 },
      uIsLine: { value: o.line ? 1 : 0 },
    },
    vertexShader: vertex,
    fragmentShader: fragment,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  }) as BuildMaterial
}

/** Memoised build material, disposed on unmount. */
export function useBuildMaterial(o: BuildOptions, deps: unknown[] = []): BuildMaterial {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const mat = useMemo(() => buildMaterial(o), deps)
  useEffect(() => () => mat.dispose(), [mat])
  return mat
}

export function setBuildColor(mat: BuildMaterial, color: THREE.ColorRepresentation, intensity = 1) {
  mat.uniforms.uColor.value.set(color).multiplyScalar(intensity)
}
