import { Billboard } from '@react-three/drei'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef, type Ref } from 'react'
import * as THREE from 'three'
import { theme } from '../../config/theme'
import { useApp } from '../../core/store'
import { HoloText } from '../../holo/HoloText'
import { useHoloLine, useHoloMesh } from '../../holo/hooks'
import { setHoloColor } from '../../holo/materials'
import { holoUniforms } from '../../holo/uniforms'
import { inspectBlock, inspectRecord, setCursor } from './inspect'
import {
  CERT_POS,
  HALF_W,
  LEDGER_POS,
  LEDGER_SPACING,
  ROAD_Y,
  X0,
  X1,
  builtZ,
  headingAt,
  planZ,
  roadPoint,
  terrainY,
  xAt,
  DRIFT_U,
  CALLOUT_ACROSS,
} from './layout'
import { MIN_PASSES, PASS_COLS, PASS_ROWS, defectLabel, type Defect } from './roadCase'
import { RELEASE_AT, ROLL_TO, SEAL_AT, phaseSeconds, rollU, scanU, useRoad, type RoadEntry } from './roadStore'

const SEGMENTS = 160
const ROAD_LEN = X1 - X0
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

export function RoadStage() {
  useEffect(() => {
    useRoad.getState().enterScene()
    return () => setCursor(false)
  }, [])

  useFrame((_, dt) => {
    if (useApp.getState().pendingScene) return
    useRoad.getState().tick(Math.min(dt, 0.1))
  })

  return (
    <>
      <Terrain />
      <RoadBase />
      <SegMask />
      <PlanOverlay />
      <PassHeatmap />
      <Chainage />
      <Scanner />
      <Roller />
      <Defects />
      <CertificateCard />
      <LedgerRow />
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Geometry helpers                                                    */
/* ------------------------------------------------------------------ */

const tmpA = new THREE.Vector3()
const tmpB = new THREE.Vector3()
const tmpC = new THREE.Vector3()
const tmpD = new THREE.Vector3()

/** Flat ribbon over the carriageway between two `across` values, ordered along the road. */
function stripGeometry(a0: number, a1: number, y: number, n = SEGMENTS) {
  const pos = new Float32Array(n * 18)
  const nor = new Float32Array(n * 18)
  let k = 0
  const push = (v: THREE.Vector3) => {
    pos[k] = v.x
    pos[k + 1] = v.y
    pos[k + 2] = v.z
    nor[k + 1] = 1
    k += 3
  }
  for (let i = 0; i < n; i++) {
    const u0 = i / n
    const u1 = (i + 1) / n
    roadPoint(u0, a0, y, tmpA)
    roadPoint(u0, a1, y, tmpB)
    roadPoint(u1, a0, y, tmpC)
    roadPoint(u1, a1, y, tmpD)
    push(tmpA)
    push(tmpC)
    push(tmpD)
    push(tmpA)
    push(tmpD)
    push(tmpB)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
  return g
}

/** Line segments along the road at the given `across` values, interleaved per segment so drawRange reveals them together. */
function edgeGeometry(acrossList: number[], y: number, n = SEGMENTS, dash = 0) {
  const pts: number[] = []
  for (let i = 0; i < n; i++) {
    if (dash && i % dash !== 0) continue
    const u0 = i / n
    const u1 = (i + (dash ? dash * 0.5 : 1)) / n
    for (const a of acrossList) {
      roadPoint(u0, a, y, tmpA)
      roadPoint(u1, a, y, tmpB)
      pts.push(tmpA.x, tmpA.y, tmpA.z, tmpB.x, tmpB.y, tmpB.z)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
  return g
}

/* ------------------------------------------------------------------ */
/* Terrain and road                                                    */
/* ------------------------------------------------------------------ */

function Terrain() {
  const geoms = useMemo(() => {
    const bands: number[][] = [[], [], []]
    const step = 0.3
    const cell = 0.6
    const xMin = -21
    const xMax = 21
    const zMin = -17
    const zMax = 8
    const push = (x0: number, z0: number, x1: number, z1: number) => {
      const mx = (x0 + x1) / 2
      const mz = (z0 + z1) / 2
      if (Math.abs(mz - builtZ(mx)) < HALF_W + 0.12 && mx > X0 - 0.4 && mx < X1 + 0.4) return
      const r = Math.hypot(mx * 0.8, mz + 1.5)
      const b = r < 9 ? 0 : r < 14 ? 1 : 2
      bands[b].push(x0, terrainY(x0, z0), z0, x1, terrainY(x1, z1), z1)
    }
    for (let z = zMin; z <= zMax + 1e-6; z += cell) for (let x = xMin; x < xMax; x += step) push(x, z, x + step, z)
    for (let x = xMin; x <= xMax + 1e-6; x += cell) for (let z = zMin; z < zMax; z += step) push(x, z, x, z + step)
    return bands.map((pts) => {
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
      return g
    })
  }, [])
  const near = useHoloLine({ color: theme.holo.blue, intensity: 0.75, opacity: 0.5, scan: 0.5 })
  const mid = useHoloLine({ color: theme.holo.blue, intensity: 0.6, opacity: 0.28, scan: 0.5 })
  const far = useHoloLine({ color: theme.holo.blue, intensity: 0.5, opacity: 0.12, scan: 0.5 })
  return (
    <group>
      <lineSegments geometry={geoms[0]} material={near} />
      <lineSegments geometry={geoms[1]} material={mid} />
      <lineSegments geometry={geoms[2]} material={far} />
    </group>
  )
}

function RoadBase() {
  const surface = useMemo(() => stripGeometry(-1, 1, ROAD_Y - 0.01), [])
  const edges = useMemo(() => edgeGeometry([-1, 1], ROAD_Y), [])
  const centre = useMemo(() => edgeGeometry([0], ROAD_Y, SEGMENTS, 4), [])
  const fill = useHoloMesh({ color: theme.brand.primaryTo, intensity: 0.9, opacity: 0.22, rim: 0, scan: 0.4 })
  const edgeMat = useHoloLine({ color: theme.holo.dim, intensity: 1.4, opacity: 0.9, scan: 0.3 })
  const centreMat = useHoloLine({ color: theme.holo.dim, intensity: 1.2, opacity: 0.7, scan: 0 })

  useFrame(() => {
    const { phase, t } = useRoad.getState()
    // As-built edges light up once the mask has measured them.
    const lit = phase === 'scan' ? 0 : phase === 'reset' ? 1 - t / phaseSeconds.reset : 1
    setHoloColor(edgeMat, theme.holo.cyan, 0.9 + lit * 1.3)
  })

  return (
    <group>
      <mesh geometry={surface} material={fill} />
      <lineSegments geometry={edges} material={edgeMat} />
      <lineSegments geometry={centre} material={centreMat} />
    </group>
  )
}

/** SAM2-style segmentation mask that fills the carriageway behind the scanner. */
function SegMask() {
  const surface = useMemo(() => stripGeometry(-0.97, 0.97, ROAD_Y + 0.005), [])
  const edges = useMemo(() => edgeGeometry([-0.97, 0.97], ROAD_Y + 0.01), [])
  const fill = useHoloMesh({ color: theme.holo.cyan, intensity: 1, opacity: 0.3, rim: 0, scan: 0.6 })
  const edgeMat = useHoloLine({ color: theme.holo.cyan, intensity: 2.4, opacity: 1, scan: 0 })
  const okColor = useMemo(() => new THREE.Color(theme.ok), [])
  const cyan = useMemo(() => new THREE.Color(theme.holo.cyan), [])
  const mix = useMemo(() => new THREE.Color(), [])

  useFrame(() => {
    const { phase, t, funds } = useRoad.getState()
    let u = 1
    if (phase === 'scan') u = clamp01(scanU(t) + 0.95 / ROAD_LEN)
    const n = Math.floor(u * SEGMENTS)
    surface.setDrawRange(0, n * 6)
    edges.setDrawRange(0, n * 4)
    let k = phase === 'plan' || phase === 'verify' || phase === 'approve' ? 0.55 : 1
    let green = 0
    if (phase === 'settle' && funds === 'released') {
      const since = t - RELEASE_AT
      green = Math.max(0, 1 - since / 2.2) * 0.9 + 0.25
      k = 1.2
    }
    if (phase === 'reset') {
      k = Math.max(0, 1 - t / phaseSeconds.reset)
      green = 0.25 * k
    }
    mix.copy(cyan).lerp(okColor, green)
    setHoloColor(fill, mix, k)
    setHoloColor(edgeMat, mix, 2.4 * Math.max(k, 0.4))
  })

  return (
    <group>
      <mesh geometry={surface} material={fill} />
      <lineSegments geometry={edges} material={edgeMat} />
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Plan vs as-built                                                    */
/* ------------------------------------------------------------------ */

function PlanOverlay() {
  const c = useRoad((s) => s.current)
  const geom = useMemo(() => {
    const pts: number[] = []
    const n = SEGMENTS
    const y = ROAD_Y + 0.03
    const normal = (x: number) => {
      const e = 0.01
      const dz = (planZ(x + e) - planZ(x - e)) / (2 * e)
      const l = Math.hypot(dz, 1)
      return [-dz / l, 1 / l]
    }
    for (let i = 0; i < n; i += 3) {
      const xa = X0 + (ROAD_LEN * i) / n
      const xb = X0 + (ROAD_LEN * (i + 1.6)) / n
      for (const off of [-HALF_W, 0, HALF_W]) {
        const [nax, naz] = normal(xa)
        const [nbx, nbz] = normal(xb)
        pts.push(xa + nax * off, y, planZ(xa) + naz * off, xb + nbx * off, y, planZ(xb) + nbz * off)
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    return g
  }, [])
  const deltaU = DRIFT_U
  const widthU = 0.7
  const callGeom = useMemo(() => {
    const y = ROAD_Y + 0.05
    const pts: number[] = []
    const seg = (a: THREE.Vector3, b: THREE.Vector3) => pts.push(a.x, a.y, a.z, b.x, b.y, b.z)
    // Offset between the planned and as-built centrelines, then a leader to the near side.
    const dx = xAt(deltaU)
    const planC = new THREE.Vector3(dx, y, planZ(dx))
    const builtC = roadPoint(deltaU, 0, y)
    seg(planC, builtC)
    seg(builtC, roadPoint(deltaU, -CALLOUT_ACROSS + 0.35, y))
    // Width dimension line with end ticks, then a leader from the near edge.
    const a = roadPoint(widthU, -1, y)
    const b = roadPoint(widthU, 1, y)
    seg(a, b)
    for (const p of [a, b]) seg(p, new THREE.Vector3(p.x, y + 0.25, p.z))
    seg(a, roadPoint(widthU, -CALLOUT_ACROSS + 0.35, y))
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    return g
  }, [deltaU])
  const deltaAt = useMemo(() => roadPoint(deltaU, -CALLOUT_ACROSS, 0.1), [deltaU])
  const widthAt = useMemo(() => roadPoint(widthU, -CALLOUT_ACROSS, 0.1), [])

  const group = useRef<THREE.Group>(null)
  const labelA = useRef<THREE.Group>(null)
  const labelB = useRef<THREE.Group>(null)
  const labelK = useRef(0)
  const plan = useHoloLine({ color: theme.holo.white, intensity: 1.6, opacity: 0.9, scan: 0 })
  const callout = useHoloLine({ color: theme.holo.ice, intensity: 1.6, opacity: 0.9, scan: 0 })

  useFrame(() => {
    const { phase, t } = useRoad.getState()
    let k = 0
    if (phase === 'plan') k = clamp01(t / 0.6)
    else if (phase === 'verify' || phase === 'approve' || phase === 'settle') k = 1
    else if (phase === 'reset') k = 1 - clamp01(t / 0.6)
    // Callouts hide during settle so the certificate reads cleanly.
    const labels = phase === 'plan' || phase === 'verify' || phase === 'approve'
    labelK.current = THREE.MathUtils.lerp(labelK.current, labels ? k : 0, 0.15)
    setHoloColor(plan, theme.holo.white, 1.7 * k)
    setHoloColor(callout, theme.holo.ice, 1.4 * labelK.current)
    if (group.current) group.current.visible = k > 0.01
    const ls = Math.max(0.001, labelK.current)
    labelA.current?.scale.setScalar(ls)
    labelB.current?.scale.setScalar(ls)
  })

  return (
    <group ref={group} visible={false}>
      <lineSegments geometry={geom} material={plan} />
      <lineSegments geometry={callGeom} material={callout} />
      <group ref={labelA} position={deltaAt}>
        <HoloText fontSize={0.24} variant="hudBold" color={theme.holo.white} glow={1.6} billboard>
          AS-BUILT VS PLAN
        </HoloText>
        <HoloText position={[0, -0.3, 0]} fontSize={0.21} variant="mono" color={theme.holo.ice} glow={1.4} billboard>
          {`max Δ ${c.maxOffsetM.toFixed(2)} m`}
        </HoloText>
      </group>
      <group ref={labelB} position={widthAt}>
        <HoloText fontSize={0.24} variant="hudBold" color={theme.holo.white} glow={1.6} billboard>
          {`WIDTH ${c.widthM.toFixed(2)} m`}
        </HoloText>
        <HoloText position={[0, -0.3, 0]} fontSize={0.21} variant="mono" color={theme.holo.ice} glow={1.4} billboard>
          {`plan ${c.widthPlanM.toFixed(2)} m`}
        </HoloText>
      </group>
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Roller pass heatmap                                                 */
/* ------------------------------------------------------------------ */

const heatVertex = /* glsl */ `
  attribute float aPass;
  attribute float aU;
  varying float vPass;
  varying float vU;
  varying vec3 vWorldPos;
  void main() {
    vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vWorldPos = w.xyz;
    vPass = aPass;
    vU = aU;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`

const heatFragment = /* glsl */ `
  uniform float uFill;
  uniform float uFade;
  uniform float uReveal;
  uniform float uTime;
  uniform float uMinPasses;
  uniform vec3 uLow;
  uniform vec3 uMid;
  uniform vec3 uHigh;
  varying float vPass;
  varying float vU;
  varying vec3 vWorldPos;
  void main() {
    float h = mix(-8.0, 14.0, uReveal);
    if (vWorldPos.y > h) discard;
    if (vU > uFill) discard;
    float ok = step(uMinPasses - 0.5, vPass);
    vec3 c = mix(uLow, mix(uMid, uHigh, clamp((vPass - uMinPasses) / 3.0, 0.0, 1.0)), ok);
    float front = smoothstep(0.05, 0.0, uFill - vU) * step(uFill, 0.999);
    c += vec3(0.7, 1.0, 1.0) * front * 1.4;
    float scan = 0.88 + 0.12 * sin(vWorldPos.x * 30.0 - uTime * 4.0);
    float a = mix(0.3, 0.55, ok) * uFade * scan;
    gl_FragColor = vec4(c * scan, a);
  }
`

function PassHeatmap() {
  const c = useRoad((s) => s.current)
  const ref = useRef<THREE.InstancedMesh>(null)
  const count = PASS_ROWS * PASS_COLS
  const geometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(1, 1)
    g.rotateX(-Math.PI / 2)
    const u = new Float32Array(count)
    for (let r = 0; r < PASS_ROWS; r++) for (let k = 0; k < PASS_COLS; k++) u[r * PASS_COLS + k] = (r + 0.5) / PASS_ROWS
    g.setAttribute('aU', new THREE.InstancedBufferAttribute(u, 1))
    g.setAttribute('aPass', new THREE.InstancedBufferAttribute(new Float32Array(count), 1))
    return g
  }, [count])
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uFill: { value: 0 },
          uFade: { value: 0 },
          uReveal: holoUniforms.uReveal,
          uTime: holoUniforms.uTime,
          uMinPasses: { value: MIN_PASSES },
          uLow: { value: new THREE.Color(theme.holo.dim).multiplyScalar(0.7) },
          uMid: { value: new THREE.Color(theme.holo.blue).multiplyScalar(0.9) },
          uHigh: { value: new THREE.Color(theme.holo.cyan).multiplyScalar(1.05) },
        },
        vertexShader: heatVertex,
        fragmentShader: heatFragment,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    [],
  )
  useEffect(() => () => material.dispose(), [material])

  useLayoutEffect(() => {
    const m = ref.current
    if (!m) return
    const obj = new THREE.Object3D()
    const cellLen = ROAD_LEN / PASS_ROWS
    const cellW = (2 * HALF_W) / PASS_COLS
    for (let r = 0; r < PASS_ROWS; r++) {
      const u = (r + 0.5) / PASS_ROWS
      for (let k = 0; k < PASS_COLS; k++) {
        const across = -1 + ((k + 0.5) * 2) / PASS_COLS
        roadPoint(u, across, ROAD_Y + 0.02, obj.position)
        obj.rotation.set(0, headingAt(u), 0)
        obj.scale.set(cellLen * 0.84, 1, cellW * 0.8)
        obj.updateMatrix()
        m.setMatrixAt(r * PASS_COLS + k, obj.matrix)
      }
    }
    m.instanceMatrix.needsUpdate = true
  }, [])

  useEffect(() => {
    const attr = geometry.getAttribute('aPass') as THREE.InstancedBufferAttribute
    ;(attr.array as Float32Array).set(c.passes)
    attr.needsUpdate = true
  }, [c, geometry])

  useFrame(() => {
    const { phase, t } = useRoad.getState()
    let fill = 0
    let fade = 0
    if (phase === 'plan') {
      fill = rollU(t)
      fade = 1
    } else if (phase === 'verify' || phase === 'approve') {
      fill = 1
      fade = 1
    } else if (phase === 'settle') {
      fill = 1
      fade = Math.max(0.35, 1 - t / 1.2)
    } else if (phase === 'reset') {
      fill = 1
      fade = 0.35 * (1 - clamp01(t / 0.8))
    }
    material.uniforms.uFill.value = fill
    material.uniforms.uFade.value = fade
  })

  return <instancedMesh ref={ref} args={[geometry, material, count]} frustumCulled={false} />
}

/* ------------------------------------------------------------------ */
/* Chainage                                                            */
/* ------------------------------------------------------------------ */

function Chainage() {
  const chStart = useRoad((s) => s.current.chStart)
  const ticks = useMemo(() => {
    const pts: number[] = []
    for (let i = 0; i <= 10; i++) {
      const u = i / 10
      const major = i % 2 === 0
      const a = roadPoint(u, -1.08, ROAD_Y)
      const b = roadPoint(u, major ? -1.36 : -1.24, ROAD_Y)
      pts.push(a.x, a.y, a.z, b.x, b.y, b.z)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    return g
  }, [])
  const mat = useHoloLine({ color: theme.holo.cyan, intensity: 1.2, opacity: 0.85, scan: 0 })
  return (
    <group>
      <lineSegments geometry={ticks} material={mat} />
      {[0, 0.2, 0.4, 0.6, 0.8, 1].map((u, i) => {
        const p = roadPoint(u, -1.62, 0.05)
        return (
          <group key={u} position={p}>
            <HoloText fontSize={0.25} variant="mono" color={theme.holo.ice} glow={1.3} billboard>
              {`${i === 0 ? 'ch ' : ''}${(chStart + u * 0.5).toFixed(1)}${i === 5 ? ' km' : ''}`}
            </HoloText>
          </group>
        )
      })}
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Vehicles                                                            */
/* ------------------------------------------------------------------ */

function Scanner() {
  const group = useRef<THREE.Group>(null)
  const body = useHoloMesh({ color: theme.holo.blue, intensity: 1.3, opacity: 0.5, rim: 1 })
  const edgeMat = useHoloLine({ color: theme.holo.cyan, intensity: 2, opacity: 1, scan: 0 })
  const beamMat = useHoloMesh({ color: theme.holo.cyan, intensity: 1.4, opacity: 0.22, rim: 0, scan: 0.8 })
  const barMat = useHoloMesh({ color: theme.holo.white, intensity: 4, opacity: 1, rim: 0, scan: 0 })
  const bodyEdges = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(0.9, 0.36, 0.6)), [])
  const beam = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const hx = 0.22
    const hy = 0.86
    const fx = 0.95
    const w = (HALF_W * 1.02) / 1.25
    g.setAttribute('position', new THREE.Float32BufferAttribute([hx, hy, 0, fx, 0.02, -w, fx, 0.02, w, hx, hy, 0, fx + 0.35, 0.02, w, fx + 0.35, 0.02, -w], 3))
    g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3))
    return g
  }, [])

  useFrame(({ clock }) => {
    const g = group.current
    if (!g) return
    const { phase, t } = useRoad.getState()
    const show = phase === 'scan' && t < phaseSeconds.scan - 0.15
    const u = phase === 'scan' ? scanU(t) : 1
    roadPoint(u, 0, ROAD_Y, g.position)
    g.rotation.y = headingAt(u)
    const s = THREE.MathUtils.lerp(g.scale.x, show ? 1 : 0.001, 0.2)
    g.scale.setScalar(s)
    g.visible = s > 0.01
    setHoloColor(beamMat, theme.holo.cyan, 1.2 + Math.sin(clock.elapsedTime * 14) * 0.25)
  })

  return (
    <group ref={group} scale={0.001}>
      <group scale={1.25}>
        <mesh position={[0, 0.26, 0]} material={body}>
          <boxGeometry args={[0.9, 0.36, 0.6]} />
        </mesh>
        <lineSegments position={[0, 0.26, 0]} geometry={bodyEdges} material={edgeMat} />
        <mesh position={[0.18, 0.62, 0]} material={body}>
          <cylinderGeometry args={[0.03, 0.03, 0.4, 6]} />
        </mesh>
        <mesh position={[0.22, 0.86, 0]} material={edgeMat}>
          <boxGeometry args={[0.16, 0.1, 0.22]} />
        </mesh>
        <mesh geometry={beam} material={beamMat} />
        <mesh position={[0.95, 0.03, 0]} material={barMat}>
          <boxGeometry args={[0.035, 0.02, (HALF_W * 2.04) / 1.25]} />
        </mesh>
      </group>
      {/* Sits above the defect labels so the two never collide as the vehicle passes. */}
      <group position={[0, 3.45, 0]}>
        <HoloText fontSize={0.22} variant="hudBold" color={theme.holo.cyan} glow={1.8} billboard>
          PHOTON · SCANNING
        </HoloText>
      </group>
    </group>
  )
}

/** Boson: roller IMU + GPS replay that paints the pass heatmap. */
function Roller() {
  const group = useRef<THREE.Group>(null)
  const drum = useRef<THREE.Mesh>(null)
  const body = useHoloMesh({ color: theme.holo.blue, intensity: 1.3, opacity: 0.5, rim: 1 })
  const drumMat = useHoloMesh({ color: theme.holo.cyan, intensity: 1.6, opacity: 0.55, rim: 1.2 })
  const edgeMat = useHoloLine({ color: theme.holo.cyan, intensity: 2, opacity: 1, scan: 0 })
  const cabEdges = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(0.55, 0.42, 0.5)), [])
  const pulse = useHoloMesh({ color: theme.holo.cyan, intensity: 2.6, opacity: 0.9, rim: 0, scan: 0 })
  const pulseRef = useRef<THREE.Mesh>(null)

  useFrame(({ clock }, dt) => {
    const g = group.current
    if (!g) return
    const { phase, t } = useRoad.getState()
    const show = phase === 'plan' && t < ROLL_TO + 0.35
    const u = phase === 'plan' ? rollU(t) : 0
    roadPoint(u, 0, ROAD_Y, g.position)
    g.rotation.y = headingAt(u)
    const s = THREE.MathUtils.lerp(g.scale.x, show ? 1 : 0.001, 0.2)
    g.scale.setScalar(s)
    g.visible = s > 0.01
    if (drum.current) drum.current.rotation.y -= dt * 6
    if (pulseRef.current) {
      const k = (clock.elapsedTime * 1.6) % 1
      pulseRef.current.scale.setScalar(0.3 + k * 1.2)
      setHoloColor(pulse, theme.holo.cyan, 2.6 * (1 - k))
    }
  })

  return (
    <group ref={group} scale={0.001}>
      <mesh ref={drum} position={[0.45, 0.24, 0]} rotation-x={Math.PI / 2} material={drumMat}>
        <cylinderGeometry args={[0.24, 0.24, HALF_W * 1.7, 18, 1, true]} />
      </mesh>
      <mesh position={[-0.15, 0.34, 0]} material={body}>
        <boxGeometry args={[0.55, 0.42, 0.5]} />
      </mesh>
      <lineSegments position={[-0.15, 0.34, 0]} geometry={cabEdges} material={edgeMat} />
      {/* GPS antenna with a telemetry pulse */}
      <mesh position={[-0.15, 0.72, 0]} material={edgeMat}>
        <cylinderGeometry args={[0.015, 0.015, 0.36, 4]} />
      </mesh>
      <mesh ref={pulseRef} position={[-0.15, 0.92, 0]} rotation-x={-Math.PI / 2} material={pulse}>
        <ringGeometry args={[0.16, 0.19, 32]} />
      </mesh>
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Detections                                                          */
/* ------------------------------------------------------------------ */

function Defects() {
  const c = useRoad((s) => s.current)
  return (
    <group>
      {c.defects.map((d, i) => (
        <DefectMark key={d.id} d={d} index={i} vlm={i === c.vlmIndex} />
      ))}
    </group>
  )
}

const BOX = { w: 0.78, h: 0.34, d: 0.62 }

function DefectMark({ d, index, vlm }: { d: Defect; index: number; vlm: boolean }) {
  const tone = d.cls === 'pothole' ? theme.alert.red : theme.alert.amber
  const group = useRef<THREE.Group>(null)
  const label = useRef<THREE.Group>(null)
  const vlmRef = useRef<THREE.Group>(null)
  const ringRef = useRef<THREE.Mesh>(null)
  const leaderRef = useRef<THREE.LineSegments>(null)
  const hovered = useRef(false)
  const pos = useMemo(() => roadPoint(d.u, d.across, ROAD_Y), [d])
  const heading = useMemo(() => headingAt(d.u), [d])

  const boxEdges = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(BOX.w, BOX.h, BOX.d)), [])
  const boxMat = useHoloLine({ color: tone, intensity: 2.6, opacity: 1, scan: 0 }, [tone])
  const markLine = useHoloLine({ color: tone, intensity: 3, opacity: 1, scan: 0 }, [tone])
  const markFill = useHoloMesh({ color: tone, intensity: 1.8, opacity: 0.55, rim: 0, scan: 0 }, [tone])
  const ringMat = useHoloMesh({ color: theme.ok, intensity: 2.4, opacity: 0.9, rim: 0, scan: 0 })

  const mark = useMemo(() => {
    const pts: number[] = []
    if (d.cls === 'crack') {
      // Zigzag along the road with a branch.
      let x = -0.32
      let z = 0
      for (let k = 0; k < 8; k++) {
        const nx = x + 0.09
        const nz = (k % 2 ? 1 : -1) * (0.04 + (k % 3) * 0.02)
        pts.push(x, 0.01, z, nx, 0.01, nz)
        x = nx
        z = nz
      }
      pts.push(-0.05, 0.01, 0.02, 0.04, 0.01, 0.16, 0.04, 0.01, 0.16, 0.1, 0.01, 0.22)
    } else {
      const r = d.cls === 'pothole' ? 0.17 : 0.22
      const n = 28
      const arc = d.cls === 'pothole' ? Math.PI * 2 : Math.PI
      const sgn = d.across > 0 ? 1 : -1
      for (let k = 0; k < n; k++) {
        const a0 = (k / n) * arc
        const a1 = ((k + 1) / n) * arc
        const wob = (a: number) => r * (1 + 0.14 * Math.sin(a * 5 + 1))
        // edge break: semicircle bitten out of the edge, opening toward the shoulder
        const zf = (a: number) => (d.cls === 'pothole' ? Math.sin(a) * wob(a) : -sgn * Math.sin(a) * wob(a) * 0.8 + sgn * 0.12)
        pts.push(Math.cos(a0) * wob(a0), 0.01, zf(a0), Math.cos(a1) * wob(a1), 0.01, zf(a1))
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    return g
  }, [d])

  useFrame(({ clock }) => {
    const g = group.current
    if (!g) return
    const { phase, t, found, checked } = useRoad.getState()
    const shown = phase === 'scan' ? index < found : phase !== 'reset' || t < 0.6
    const target = shown ? (hovered.current ? 1.12 : 1) : 0.001
    const s = THREE.MathUtils.lerp(g.scale.x, target, shown ? 0.16 : 0.25)
    g.scale.setScalar(s)
    g.visible = s > 0.01
    const blink = phase === 'scan' ? 2.6 + Math.sin(clock.elapsedTime * 8 + index) * 0.6 : 2.2
    setHoloColor(boxMat, tone, blink)

    // Labels yield to the certificate during settle.
    if (label.current) {
      const on = phase !== 'settle' && phase !== 'reset'
      label.current.scale.setScalar(THREE.MathUtils.lerp(label.current.scale.x, on ? 1 : 0.001, 0.18))
      if (leaderRef.current) leaderRef.current.visible = label.current.scale.x > 0.3
    }
    const vlmOn = vlm && ((phase === 'verify' && checked >= 3) || phase === 'approve')
    if (vlmRef.current) vlmRef.current.scale.setScalar(THREE.MathUtils.lerp(vlmRef.current.scale.x, vlmOn ? 1 : 0.001, 0.2))
    if (ringRef.current) {
      const scanning = vlm && phase === 'verify' && checked === 2
      const k = (clock.elapsedTime * 1.4) % 1
      ringRef.current.visible = scanning || vlmOn
      ringRef.current.scale.setScalar(scanning ? 0.6 + k * 0.9 : 1.05)
      setHoloColor(ringMat, scanning ? theme.holo.cyan : theme.ok, scanning ? 2.6 * (1 - k) + 0.4 : 2.2)
    }
  })

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    inspectRecord(`IES record · ${defectLabel[d.cls].toLowerCase()} detection`, `ch ${d.chainageKm.toFixed(3)} km · conf ${d.confidence.toFixed(2)}`, d.record)
  }

  const labelY = 2.45

  return (
    <group
      ref={group}
      position={pos}
      scale={0.001}
      onClick={onClick}
      onPointerOver={() => {
        hovered.current = true
        setCursor(true)
      }}
      onPointerOut={() => {
        hovered.current = false
        setCursor(false)
      }}
    >
      <group rotation-y={heading}>
        <lineSegments geometry={mark} material={markLine} />
        {d.cls === 'pothole' && (
          <mesh rotation-x={-Math.PI / 2} position-y={0.008} material={markFill}>
            <circleGeometry args={[0.15, 24]} />
          </mesh>
        )}
        <lineSegments position-y={BOX.h / 2 + 0.01} geometry={boxEdges} material={boxMat} />
        <mesh ref={ringRef} rotation-x={-Math.PI / 2} position-y={0.03} material={ringMat} visible={false}>
          <ringGeometry args={[0.5, 0.54, 48]} />
        </mesh>
        {/* hit target */}
        <mesh position-y={BOX.h / 2}>
          <boxGeometry args={[BOX.w, BOX.h + 0.6, BOX.d]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
        </mesh>
      </group>
      <group ref={label} position-y={labelY}>
        <HoloText fontSize={0.32} variant="hudBold" color={tone} glow={1.9} billboard>
          {`${defectLabel[d.cls]} ${d.confidence.toFixed(2)}`}
        </HoloText>
        <HoloText position={[0, -0.32, 0]} fontSize={0.2} variant="mono" color={theme.holo.ice} glow={1.2} billboard>
          {`ch ${d.chainageKm.toFixed(3)} km`}
        </HoloText>
        <group ref={vlmRef} position={[0, 0.46, 0]} scale={0.001}>
          <HoloText fontSize={0.22} variant="mono" color={theme.ok} glow={1.8} billboard>
            VLM ✓ confirmed
          </HoloText>
        </group>
      </group>
      {/* leader from box to label */}
      <Leader ref={leaderRef} height={labelY - 0.36} color={tone} />
    </group>
  )
}

function Leader({ height, color, ref }: { height: number; color: string; ref: Ref<THREE.LineSegments> }) {
  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, BOX.h + 0.02, 0, 0, height, 0], 3))
    return g
  }, [height])
  const mat = useHoloLine({ color, intensity: 1.2, opacity: 0.7, scan: 0 }, [color])
  return <lineSegments ref={ref} geometry={geom} material={mat} />
}

/* ------------------------------------------------------------------ */
/* Certificate, ledger, funds                                          */
/* ------------------------------------------------------------------ */

const CARD = { w: 3.3, h: 1.7 }

/** Eases a group's scale toward shown / hidden. */
function lerp(g: THREE.Group | null, on: boolean) {
  if (!g) return
  const s = THREE.MathUtils.lerp(g.scale.x, on ? 1 : 0.001, 0.16)
  g.scale.setScalar(s)
  g.visible = s > 0.01
}

function CertificateCard() {
  const c = useRoad((s) => s.current)
  const decision = useRoad((s) => s.decision)
  const cert = useRoad((s) => s.certificate)
  const entry = useRoad((s) => s.entry)
  const funds = useRoad((s) => s.funds)
  const minted = useRef<THREE.Group>(null)
  const pending = useRef<THREE.Group>(null)
  const fundsRef = useRef<THREE.Group>(null)

  const card = useHoloMesh({ color: theme.holo.blue, intensity: 1, opacity: 0.38, rim: 0.3 })
  const frame = useHoloLine({ color: theme.holo.white, intensity: 2.4, opacity: 1, scan: 0 })
  const dashed = useHoloLine({ color: theme.alert.amber, intensity: 2, opacity: 1, scan: 0 })
  const edges = useMemo(() => new THREE.EdgesGeometry(new THREE.PlaneGeometry(CARD.w, CARD.h)), [])
  const dashGeom = useMemo(() => {
    const pts: number[] = []
    const hw = CARD.w / 2
    const hh = CARD.h / 2
    const seg = (ax: number, ay: number, bx: number, by: number, n: number) => {
      for (let i = 0; i < n; i += 2) {
        pts.push(ax + ((bx - ax) * i) / n, ay + ((by - ay) * i) / n, 0, ax + ((bx - ax) * (i + 1)) / n, ay + ((by - ay) * (i + 1)) / n, 0)
      }
    }
    seg(-hw, hh, hw, hh, 30)
    seg(hw, hh, hw, -hh, 16)
    seg(hw, -hh, -hw, -hh, 30)
    seg(-hw, -hh, -hw, hh, 16)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    return g
  }, [])
  const settled = decision?.action === 'accept'

  useFrame(({ clock }) => {
    const { phase, t } = useRoad.getState()
    lerp(pending.current, phase === 'approve')
    lerp(minted.current, (phase === 'settle' && t > SEAL_AT - 0.35) || (phase === 'reset' && t < 0.7))
    lerp(fundsRef.current, (phase === 'settle' && t > RELEASE_AT) || (phase === 'reset' && t < 0.7))
    setHoloColor(dashed, theme.alert.amber, 1.8 + Math.sin(clock.elapsedTime * 5) * 0.6)
    setHoloColor(frame, settled ? theme.holo.white : theme.alert.amber, 2.4)
  })

  const title = settled ? 'COMPLETION CERTIFICATE' : decision?.action === 'modify' ? 'ON HOLD' : 'NOT SETTLED'
  const sub = settled
    ? (cert?.certificate_id ?? '')
    : decision?.action === 'modify'
      ? 're-test thickness ordered'
      : `rejected · reason: ${decision?.reason ?? ''}`
  const tone = settled ? theme.holo.white : theme.alert.amber

  return (
    <group position={CERT_POS} scale={1.3}>
      <Billboard>
        <group ref={pending} scale={0.001}>
          <lineSegments geometry={dashGeom} material={dashed} />
          <HoloText position={[0, 0.3, 0.01]} fontSize={0.2} variant="hudBold" color={theme.alert.amber} glow={1.8}>
            CERTIFICATE NOT MINTED
          </HoloText>
          <HoloText position={[0, -0.12, 0.01]} fontSize={0.16} variant="mono" color={theme.holo.ice} glow={1.3}>
            {`awaiting ${c.approverRole}`}
          </HoloText>
        </group>
        <group
          ref={minted}
          scale={0.001}
          onClick={(e) => {
            e.stopPropagation()
            if (entry) inspectBlock(entry)
          }}
          onPointerOver={() => setCursor(true)}
          onPointerOut={() => setCursor(false)}
        >
          <mesh material={card}>
            <planeGeometry args={[CARD.w, CARD.h]} />
          </mesh>
          <lineSegments geometry={edges} material={frame} />
          <HoloText position={[0, 0.52, 0.01]} fontSize={0.24} variant="hudBold" color={tone} glow={2.2}>
            {title}
          </HoloText>
          <HoloText position={[0, 0.18, 0.01]} fontSize={0.15} variant="mono" color={theme.holo.ice} glow={1.4}>
            {sub}
          </HoloText>
          <HoloText position={[0, -0.12, 0.01]} fontSize={0.15} variant="mono" color={theme.holo.ice} glow={1.2}>
            {`${c.sectionLabel} · ${c.coveragePct}% ≥ 8 passes`}
          </HoloText>
          <HoloText position={[0, -0.42, 0.01]} fontSize={0.14} variant="mono" color={theme.holo.ice} glow={0.9}>
            {entry ? `ledger #${entry.block.seq} · ${entry.block.hash.slice(0, 16)}` : ''}
          </HoloText>
          <HoloText position={[0, -0.66, 0.01]} fontSize={0.12} variant="mono" color={theme.holo.cyan} glow={1.1}>
            click to inspect
          </HoloText>
        </group>
        <group ref={fundsRef} position={[0, -CARD.h / 2 - 0.38, 0]} scale={0.001}>
          <HoloText fontSize={0.34} variant="hudBold" color={funds === 'released' ? theme.ok : theme.alert.amber} glow={2.2}>
            {funds === 'released' ? 'FUNDS RELEASED' : 'FUNDS HELD'}
          </HoloText>
        </group>
      </Billboard>
    </group>
  )
}

function LedgerRow() {
  const entries = useRoad((s) => s.entries)
  const visible = entries.slice(-4)
  const link = useHoloLine({ color: theme.holo.cyan, intensity: 1.4, opacity: 0.8, scan: 0 })
  const linkGeom = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, LEDGER_SPACING * 3 + 0.5, 0, 0], 3))
    return g
  }, [])
  return (
    <group position={LEDGER_POS} scale={1.3}>
      <lineSegments geometry={linkGeom} material={link} />
      {visible.map((e, k) => (
        <LedgerBlockMesh key={e.block.seq} entry={e} slot={k + 4 - visible.length} newest={k === visible.length - 1} />
      ))}
      <HoloText position={[-0.42, 0.78, 0]} anchorX="left" fontSize={0.2} variant="hudBold" glow={1.6}>
        EVENT LEDGER
      </HoloText>
    </group>
  )
}

function LedgerBlockMesh({ entry, slot, newest }: { entry: RoadEntry; slot: number; newest: boolean }) {
  const ref = useRef<THREE.Group>(null)
  const hovered = useRef(false)
  const bad = entry.payload.type !== 'settlement'
  const body = useHoloMesh({ color: bad ? theme.alert.amber : theme.holo.blue, intensity: bad ? 1.2 : 1.4, opacity: 0.5, rim: 1 }, [bad])
  const edgeMat = useHoloLine({ color: bad ? theme.alert.amber : theme.holo.cyan, intensity: 2.2 }, [bad])
  const edges = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(0.5, 0.5, 0.5)), [])
  const target = useMemo(() => new THREE.Vector3(slot * LEDGER_SPACING, 0, 0), [slot])

  useFrame((_, dt) => {
    const g = ref.current
    if (!g) return
    g.position.lerp(target, Math.min(1, dt * 4))
    const s = hovered.current ? 1.18 : 1
    g.scale.setScalar(THREE.MathUtils.lerp(g.scale.x, s, 0.15))
    g.rotation.y += dt * 0.3
  })

  return (
    <group
      ref={ref}
      position={newest ? target : [(slot + 1) * LEDGER_SPACING, 0, 0]}
      scale={newest ? 0.001 : 1}
      onClick={(e) => {
        e.stopPropagation()
        inspectBlock(entry)
      }}
      onPointerOver={() => {
        hovered.current = true
        setCursor(true)
      }}
      onPointerOut={() => {
        hovered.current = false
        setCursor(false)
      }}
    >
      <mesh material={body}>
        <boxGeometry args={[0.5, 0.5, 0.5]} />
      </mesh>
      <lineSegments geometry={edges} material={edgeMat} />
      <group position={[0, -0.64, 0]}>
        <HoloText fontSize={0.15} variant="mono" color={theme.holo.ice} glow={1.4} billboard>
          {`#${entry.block.seq}`}
        </HoloText>
      </group>
    </group>
  )
}
