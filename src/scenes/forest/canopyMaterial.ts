import * as THREE from 'three'
import { holoUniforms } from '../../holo/uniforms'

/**
 * Hologram shader for the instanced canopy columns.
 * Per-cell colour comes from `instanceColor` (values above 1 bloom).
 * `uSweepX` lights up the columns the aerial scan is passing over.
 * Respects the shared reveal sweep so the scene dissolves like the rest.
 */
export function canopyMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: holoUniforms.uTime,
      uReveal: holoUniforms.uReveal,
      uSweepX: { value: -999 },
      uSweepGlow: { value: 0 },
      uOpacity: { value: 0.42 },
      uRevealLow: { value: -8 },
      uRevealHigh: { value: 14 },
    },
    vertexShader: /* glsl */ `
      uniform float uSweepX;
      uniform float uSweepGlow;
      varying vec3 vColor;
      varying vec3 vWorldPos;
      varying vec3 vViewNormal;
      varying vec3 vViewDir;
      varying float vTop;
      varying float vSweep;
      void main() {
        mat4 m = modelMatrix;
        #ifdef USE_INSTANCING
          m = modelMatrix * instanceMatrix;
        #endif
        vec4 world = m * vec4(position, 1.0);
        vWorldPos = world.xyz;
        vec4 mv = viewMatrix * world;
        vViewNormal = normalize(mat3(viewMatrix) * mat3(m) * normal);
        vViewDir = normalize(-mv.xyz);
        vTop = step(0.5, normal.y);
        float cx = (m * vec4(0.0, 0.0, 0.0, 1.0)).x;
        float d = (cx - uSweepX) / 0.55;
        vSweep = exp(-d * d) * uSweepGlow;
        vColor = vec3(1.0);
        #ifdef USE_INSTANCING_COLOR
          vColor = instanceColor;
        #endif
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uReveal;
      uniform float uOpacity;
      uniform float uRevealLow;
      uniform float uRevealHigh;
      varying vec3 vColor;
      varying vec3 vWorldPos;
      varying vec3 vViewNormal;
      varying vec3 vViewDir;
      varying float vTop;
      varying float vSweep;
      void main() {
        float h = mix(uRevealLow, uRevealHigh, uReveal);
        float dh = h - vWorldPos.y;
        float edge = smoothstep(0.6, 0.0, abs(dh)) * step(0.001, uReveal) * step(uReveal, 0.999);
        float visible = step(0.0, dh);
        if (visible < 0.5 && edge < 0.01) discard;
        float rim = pow(1.0 - abs(dot(normalize(vViewNormal), normalize(vViewDir))), 2.0);
        float scan = 0.88 + 0.12 * sin(vWorldPos.y * 40.0 - uTime * 3.0);
        vec3 col = vColor * (0.45 + rim * 1.1 + vTop * 0.7) * scan;
        col += vec3(0.45, 0.85, 1.0) * vSweep * (0.5 + vTop * 0.9);
        float a = uOpacity * (0.25 + rim * 0.8 + vTop * 0.4) + vSweep * 0.2;
        col += vec3(0.6, 0.95, 1.0) * edge * 3.0;
        a = max(a * visible, edge);
        gl_FragColor = vec4(col, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  })
}
