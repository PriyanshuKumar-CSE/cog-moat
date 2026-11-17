import { Billboard } from '@react-three/drei'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { theme } from '../../config/theme'
import { useApp } from '../../core/store'
import { HoloText } from '../../holo/HoloText'
import { useHoloLine, useHoloMesh } from '../../holo/hooks'
import { setHoloColor } from '../../holo/materials'
import type { Finding } from './buildingCase'
import { RELEASE_AT, SEAL_AT, phaseSeconds, scanU, useBuilding, useShm, type BuildingEntry } from './buildingStore'
import { setBuildColor, useBuildMaterial, type BuildOptions } from './buildMaterial'
import { envelopeGeometry, stageGeometry } from './geometry'
import { inspectBlock, inspectRecord, setCursor } from './inspect'
import {
  BASEMENT_Y,
  CERT_POS,
  CRANE_BASE,
  CRANE_H,
  HALF_X,
  HALF_Z,
  LEDGER_POS,
  LEDGER_SPACING,
  LABEL_X,
  LEVELS,
  PIT_X,
  PIT_Z,
  ELEC_SHAFT,
  METER_ROOM,
  PLUMB_SHAFT,
  ROOF_Y,
  levelY,
} from './layout'
import { builtState, cutY, standingUpTo } from './progress'
import { MONITORING, stageIndex, stages, type BuildingStageId } from './stages'

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const focusPhases = new Set(['plan', 'verify', 'approve'])

export function BuildingStage() {
  useEffect(() => {
    useBuilding.getState().enterScene()
    return () => setCursor(false)
  }, [])

  useFrame((_, dt) => {
    if (useApp.getState().pendingScene) return
    const d = Math.min(dt, 0.1)
    useBuilding.getState().tick(d)
    useShm.getState().sample(d)
  })

  return (
    <>
      <Ground />
      <Envelope />
      {stages.map((s, i) => (s.id === 'monitoring' ? null : <StageGroup key={s.id} id={s.id} index={i} />))}
      <WaterFlow />
      <PowerFlow />
      <Crane />
      <LevelLabels />
      <ScanRig />
      <Title />
      <PlanCallouts />
      <Findings />
      <Sensors />
      <CertificateCard />
      <LedgerRow />
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Ground and site                                                     */
/* ------------------------------------------------------------------ */

function Ground() {
  const geoms = useMemo(() => {
    const bands: number[][] = [[], [], []]
    const step = 0.3
    const cell = 0.6
    const push = (x0: number, z0: number, x1: number, z1: number) => {
      const mx = (x0 + x1) / 2
      const mz = (z0 + z1) / 2
      if (Math.abs(mx) < PIT_X + 0.02 && Math.abs(mz) < PIT_Z + 0.02) return
      const r = Math.hypot(mx * 0.7, mz)
      const b = r < 7 ? 0 : r < 12 ? 1 : 2
      bands[b].push(x0, 0, z0, x1, 0, z1)
    }
    for (let z = -16; z <= 8 + 1e-6; z += cell) for (let x = -22; x < 22; x += step) push(x, z, x + step, z)
    for (let x = -22; x <= 22 + 1e-6; x += cell) for (let z = -16; z < 8; z += step) push(x, z, x, z + step)
    return bands.map((pts) => {
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
      return g
    })
  }, [])
  const hoarding = useMemo(() => {
    const pts: number[] = []
    // Wide enough that finding labels and the ledger sit inside the site, clear of the fence.
    const x0 = -7.4
    const x1 = 10.6
    const z0 = -4.8
    const z1 = 5.6
    const dash = (ax: number, az: number, bx: number, bz: number) => {
      const n = Math.round(Math.hypot(bx - ax, bz - az) / 0.25)
      for (let i = 0; i < n; i += 2) pts.push(ax + ((bx - ax) * i) / n, 0.01, az + ((bz - az) * i) / n, ax + ((bx - ax) * (i + 1)) / n, 0.01, az + ((bz - az) * (i + 1)) / n)
    }
    dash(x0, z0, x1, z0)
    dash(x1, z0, x1, z1)
    dash(x1, z1, 1.4, z1)
    dash(-0.6, z1, x0, z1)
    dash(x0, z1, x0, z0)
    // Gate posts.
    for (const gx of [-0.6, 1.4]) pts.push(gx, 0, z1, gx, 0.45, z1)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    return g
  }, [])
  const near = useHoloLine({ color: theme.holo.blue, intensity: 0.75, opacity: 0.45, scan: 0.5 })
  const mid = useHoloLine({ color: theme.holo.blue, intensity: 0.6, opacity: 0.25, scan: 0.5 })
  const far = useHoloLine({ color: theme.holo.blue, intensity: 0.5, opacity: 0.1, scan: 0.5 })
  const fence = useHoloLine({ color: theme.holo.cyan, intensity: 1.1, opacity: 0.7, scan: 0 })
  return (
    <group>
      <lineSegments geometry={geoms[0]} material={near} />
      <lineSegments geometry={geoms[1]} material={mid} />
      <lineSegments geometry={geoms[2]} material={far} />
      <lineSegments geometry={hoarding} material={fence} />
    </group>
  )
}

/** Planned envelope of the whole tower (BIM), always faint so the plan is visible before anything is built. */
function Envelope() {
  const geom = useMemo(() => envelopeGeometry(), [])
  const mat = useHoloLine({ color: theme.holo.white, intensity: 0.7, opacity: 0.22, scan: 0 })
  useFrame(() => {
    const { phase, stage } = useBuilding.getState()
    const k = focusPhases.has(phase) && stage !== MONITORING ? 1.4 : 0.7
    setHoloColor(mat, theme.holo.white, k)
  })
  return <lineSegments geometry={geom} material={mat} />
}

/* ------------------------------------------------------------------ */
/* Construction milestones                                             */
/* ------------------------------------------------------------------ */

const looks: Record<Exclude<BuildingStageId, 'monitoring'>, { fill: BuildOptions; line: BuildOptions }> = {
  excavation: {
    fill: { color: theme.holo.dim, intensity: 1, opacity: 0.16, rim: 0.4 },
    line: { color: theme.holo.blue, intensity: 1.1, opacity: 0.6, line: true },
  },
  foundation: {
    fill: { color: theme.holo.blue, intensity: 0.8, opacity: 0.28, rim: 0.8 },
    line: { color: theme.holo.cyan, intensity: 1, opacity: 0.5, line: true },
  },
  frame: {
    fill: { color: theme.brand.primaryFrom, intensity: 1, opacity: 0.2, rim: 0.7 },
    line: { color: theme.holo.cyan, intensity: 1.2, opacity: 0.65, line: true },
  },
  masonry: {
    fill: { color: theme.holo.blue, intensity: 0.55, opacity: 0.15, rim: 0.3 },
    line: { color: theme.holo.blue, intensity: 1.1, opacity: 0.5, line: true },
  },
  plumbing: {
    fill: { color: theme.holo.cyan, intensity: 1.5, opacity: 0.55, rim: 1 },
    line: { color: theme.holo.cyan, intensity: 2.1, opacity: 0.95, line: true },
  },
  electrical: {
    fill: { color: theme.holo.ice, intensity: 1.3, opacity: 0.5, rim: 1 },
    line: { color: theme.holo.ice, intensity: 1.7, opacity: 0.85, line: true },
  },
  plaster: {
    fill: { color: theme.holo.ice, intensity: 0.45, opacity: 0.14, rim: 0.2 },
    line: { color: theme.holo.ice, intensity: 0.9, opacity: 0.4, line: true },
  },
  flooring: {
    fill: { color: theme.holo.cyan, intensity: 0.55, opacity: 0.16, rim: 0.2 },
    line: { color: theme.holo.cyan, intensity: 0.75, opacity: 0.3, line: true },
  },
  paint: {
    fill: { color: '#3d8bff', intensity: 1.3, opacity: 0.3, rim: 0.6 },
    line: { color: theme.holo.ice, intensity: 1.3, opacity: 0.65, line: true },
  },
}

/** Later work that covers earlier work: the covered layer fades to an X-ray. */
const coveredBy: Partial<Record<BuildingStageId, { by: BuildingStageId; to: number }>> = {
  excavation: { by: 'foundation', to: 0.45 },
  masonry: { by: 'plaster', to: 0.3 },
  plumbing: { by: 'plaster', to: 0.45 },
  electrical: { by: 'plaster', to: 0.45 },
  plaster: { by: 'paint', to: 0.3 },
}

function StageGroup({ id, index }: { id: Exclude<BuildingStageId, 'monitoring'>; index: number }) {
  const geom = useMemo(() => stageGeometry(id), [id])
  const look = looks[id]
  const fill = useBuildMaterial(look.fill)
  const line = useBuildMaterial(look.line)
  const plan = useBuildMaterial({ color: theme.holo.white, intensity: 1.6, opacity: 0.9, line: true, scan: 0 })
  const planRef = useRef<THREE.LineSegments>(null)
  const ok = useMemo(() => new THREE.Color(theme.ok), [])
  const mixFill = useMemo(() => new THREE.Color(), [])
  const mixLine = useMemo(() => new THREE.Color(), [])
  const baseFill = useMemo(() => new THREE.Color(look.fill.color), [look])
  const baseLine = useMemo(() => new THREE.Color(look.line.color), [look])
  const cover = coveredBy[id]
  const coverIndex = cover ? stageIndex(cover.by) : -1

  useEffect(
    () => () => {
      geom.fill?.dispose()
      geom.lines?.dispose()
    },
    [geom],
  )

  useFrame(() => {
    const s = useBuilding.getState()
    const snap = { phase: s.phase, t: s.t, stage: s.stage, next: s.next }
    const cut = cutY(index, snap)
    const current = index === s.stage
    const [lo, hi] = stages[s.stage].span
    for (const m of [fill, line]) {
      m.uniforms.uCut.value = cut
      m.uniforms.uScanY.value = lo + (hi - lo) * scanU(s.t)
      m.uniforms.uScanK.value = current && s.phase === 'scan' ? 1 : 0
    }
    let k = 1
    if (focusPhases.has(s.phase) && s.stage !== MONITORING) k = current ? 1.35 : 0.5
    else if (s.phase === 'scan' && s.stage !== MONITORING) k = current ? 1.1 : 0.7
    if (cover) k *= THREE.MathUtils.lerp(1, cover.to, builtState(coverIndex, snap).amount)
    // Green wash on the milestone when its bill is released.
    let green = 0
    if (current && s.phase === 'settle' && s.outcome === 'released' && s.stage !== MONITORING) green = Math.max(0, 1 - (s.t - RELEASE_AT) / 2.2) * 0.85
    mixFill.copy(baseFill).lerp(ok, green)
    mixLine.copy(baseLine).lerp(ok, green)
    setBuildColor(fill, mixFill, (look.fill.intensity ?? 1) * k)
    setBuildColor(line, mixLine, (look.line.intensity ?? 1) * k)

    // BIM overlay of this milestone while it is checked against plan.
    const pl = planRef.current
    if (pl) {
      let p = 0
      if (current && s.stage !== MONITORING) {
        if (s.phase === 'plan') p = clamp01(s.t / 0.6)
        else if (s.phase === 'verify' || s.phase === 'approve') p = 1
        else if (s.phase === 'settle') p = 1 - clamp01(s.t / 0.8)
      }
      pl.visible = p > 0.01
      setBuildColor(plan, theme.holo.white, 0.9 * p)
    }
  })

  return (
    <group>
      {geom.fill && <mesh geometry={geom.fill} material={fill} />}
      {geom.lines && <lineSegments geometry={geom.lines} material={line} />}
      {geom.lines && <lineSegments ref={planRef} geometry={geom.lines} material={plan} visible={false} />}
    </group>
  )
}

/** Built amount of a stage, read each frame. */
function amountOf(id: BuildingStageId) {
  const s = useBuilding.getState()
  return builtState(stageIndex(id), { phase: s.phase, t: s.t, stage: s.stage, next: s.next }).amount
}

/** Points that travel along a path, used for water and power flow. */
function useFlow(path: THREE.Vector3[], count: number) {
  const curve = useMemo(() => new THREE.CurvePath<THREE.Vector3>(), [])
  useMemo(() => {
    curve.curves.length = 0
    for (let i = 0; i < path.length - 1; i++) curve.add(new THREE.LineCurve3(path[i], path[i + 1]))
  }, [curve, path])
  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3))
    return g
  }, [count])
  return { curve, geom }
}

function WaterFlow() {
  const path = useMemo(() => {
    const { x, z } = PLUMB_SHAFT
    const pts = [new THREE.Vector3(2.2, BASEMENT_Y + 0.42, -0.6), new THREE.Vector3(x, BASEMENT_Y + 0.42, z), new THREE.Vector3(x, ROOF_Y + 0.35, z), new THREE.Vector3(1.6, ROOF_Y + 0.35, z), new THREE.Vector3(1.6, ROOF_Y + 0.35, -1.0)]
    return pts
  }, [])
  const N = 26
  const { curve, geom } = useFlow(path, N)
  const ref = useRef<THREE.Points>(null)
  const mat = useMemo(
    () =>
      new THREE.PointsMaterial({ color: new THREE.Color(theme.holo.cyan).multiplyScalar(2.4), size: 0.11, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
    [],
  )
  useEffect(() => () => mat.dispose(), [mat])
  const tmp = useMemo(() => new THREE.Vector3(), [])
  useFrame(({ clock }) => {
    const a = amountOf('plumbing')
    const pts = ref.current
    if (!pts) return
    pts.visible = a > 0.99
    if (!pts.visible) return
    const s = useBuilding.getState()
    const testing = s.stage === stageIndex('plumbing') && focusPhases.has(s.phase)
    const speed = testing ? 0.05 : 0.12
    const arr = geom.getAttribute('position') as THREE.BufferAttribute
    for (let i = 0; i < N; i++) {
      const u = (i / N + clock.elapsedTime * speed) % 1
      curve.getPointAt(u, tmp)
      arr.setXYZ(i, tmp.x, tmp.y, tmp.z)
    }
    arr.needsUpdate = true
    mat.opacity = testing ? 1 : 0.7 * (1 - 0.5 * amountOf('plaster'))
  })
  return <points ref={ref} geometry={geom} material={mat} frustumCulled={false} />
}

function PowerFlow() {
  const path = useMemo(() => {
    const { x, z } = ELEC_SHAFT
    return [new THREE.Vector3(METER_ROOM.x + 0.45, 0.05, METER_ROOM.z), new THREE.Vector3(x, 0.05, METER_ROOM.z), new THREE.Vector3(x, 0.05, z), new THREE.Vector3(x, ROOF_Y, z)]
  }, [])
  const N = 22
  const { curve, geom } = useFlow(path, N)
  const ref = useRef<THREE.Points>(null)
  const mat = useMemo(
    () => new THREE.PointsMaterial({ color: new THREE.Color(theme.holo.white).multiplyScalar(2.6), size: 0.09, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
    [],
  )
  useEffect(() => () => mat.dispose(), [mat])
  const tmp = useMemo(() => new THREE.Vector3(), [])
  useFrame(({ clock }) => {
    const pts = ref.current
    if (!pts) return
    pts.visible = amountOf('electrical') > 0.99
    if (!pts.visible) return
    const arr = geom.getAttribute('position') as THREE.BufferAttribute
    for (let i = 0; i < N; i++) {
      const u = (i / N + clock.elapsedTime * 0.2) % 1
      curve.getPointAt(u, tmp)
      arr.setXYZ(i, tmp.x, tmp.y, tmp.z)
    }
    arr.needsUpdate = true
    mat.opacity = 0.8 * (1 - 0.5 * amountOf('plaster'))
  })
  return <points ref={ref} geometry={geom} material={mat} frustumCulled={false} />
}

/* ------------------------------------------------------------------ */
/* Tower crane                                                         */
/* ------------------------------------------------------------------ */

const JIB = 12.5
const COUNTER = 2.4

function Crane() {
  const root = useRef<THREE.Group>(null)
  const jib = useRef<THREE.Group>(null)
  const trolley = useRef<THREE.Group>(null)
  const mast = useMemo(() => {
    const pts: number[] = []
    const w = 0.18
    const corners: [number, number][] = [
      [-w, -w],
      [w, -w],
      [w, w],
      [-w, w],
    ]
    for (const [x, z] of corners) pts.push(x, 0, z, x, CRANE_H, z)
    for (let y = 0; y < CRANE_H; y += 0.5) {
      for (let i = 0; i < 4; i++) {
        const [ax, az] = corners[i]
        const [bx, bz] = corners[(i + 1) % 4]
        pts.push(ax, y, az, bx, y + 0.5, bz)
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    return g
  }, [])
  const arm = useMemo(() => {
    const pts: number[] = []
    const y = CRANE_H
    pts.push(-COUNTER, y, 0, JIB, y, 0, -COUNTER, y + 0.3, 0, JIB, y + 0.3, 0)
    for (let x = -COUNTER; x < JIB; x += 0.5) pts.push(x, y, 0, x + 0.5, y + 0.3, 0)
    // Tower top and ties.
    pts.push(0, y, 0, 0, y + 1.2, 0, 0, y + 1.2, 0, JIB * 0.6, y + 0.3, 0, 0, y + 1.2, 0, -COUNTER, y + 0.3, 0)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    return g
  }, [])
  const cable = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, -3.2, 0], 3))
    return g
  }, [])
  const lineMat = useHoloLine({ color: theme.holo.blue, intensity: 1.2, opacity: 0.7, scan: 0.4 })
  const hot = useHoloLine({ color: theme.holo.cyan, intensity: 1.6, opacity: 0.9, scan: 0 })
  const body = useHoloMesh({ color: theme.holo.blue, intensity: 1.1, opacity: 0.45, rim: 1 })

  useFrame(({ clock }) => {
    const r = root.current
    if (!r) return
    const s = useBuilding.getState()
    // The crane stands from excavation until masonry is done, and comes down as plaster starts.
    const on = s.stage !== MONITORING && standingUpTo(s.stage) <= stageIndex('masonry') ? 1 - amountOf('plaster') : 0
    const k = s.phase === 'reset' && s.next === 0 ? on * (1 - clamp01(s.t / 1.2)) : on
    const sc = THREE.MathUtils.lerp(r.scale.y, k > 0.5 ? 1 : 0.001, 0.08)
    r.scale.set(1, sc, 1)
    r.visible = sc > 0.01
    // Swings over the tower, from the back half of the site, clear of the certificate.
    if (jib.current) jib.current.rotation.y = -0.8 + Math.sin(clock.elapsedTime * 0.12) * 0.22
    if (trolley.current) trolley.current.position.x = 10.2 + Math.sin(clock.elapsedTime * 0.21) * 1.8
  })

  return (
    <group ref={root} position={CRANE_BASE}>
      <lineSegments geometry={mast} material={lineMat} />
      <group ref={jib}>
        <lineSegments geometry={arm} material={lineMat} />
        <mesh position={[-COUNTER + 0.35, CRANE_H - 0.15, 0]} material={body}>
          <boxGeometry args={[0.6, 0.4, 0.5]} />
        </mesh>
        <mesh position={[0.35, CRANE_H - 0.2, 0]} material={body}>
          <boxGeometry args={[0.36, 0.32, 0.32]} />
        </mesh>
        <group ref={trolley} position={[10.2, CRANE_H, 0]}>
          <lineSegments geometry={cable} material={hot} />
          <mesh position={[0, -3.25, 0]} material={body}>
            <boxGeometry args={[0.18, 0.12, 0.18]} />
          </mesh>
        </group>
      </group>
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Labels                                                              */
/* ------------------------------------------------------------------ */

function LevelLabels() {
  const levels = useMemo(() => {
    const out: { y: number; text: string }[] = [{ y: BASEMENT_Y + 0.45, text: 'B' }]
    for (let k = 0; k < LEVELS; k++) out.push({ y: levelY(k) + 0.45, text: k === 0 ? 'G' : `L${k}` })
    out.push({ y: ROOF_Y + 0.2, text: 'ROOF' })
    return out
  }, [])
  return (
    <group position={[-HALF_X - 0.55, 0, HALF_Z + 0.2]}>
      {levels.map((l) => (
        <group key={l.text} position={[0, l.y, 0]}>
          <HoloText fontSize={0.17} variant="mono" color={theme.holo.ice} glow={0.9} opacity={0.75} billboard>
            {l.text}
          </HoloText>
        </group>
      ))}
    </group>
  )
}

function Title() {
  const current = useBuilding((s) => s.current)
  const ref = useRef<THREE.Group>(null)
  useFrame(() => {
    const g = ref.current
    if (!g) return
    const { phase, t, current } = useBuilding.getState()
    // Steps aside while the drone flies over the roof.
    const droneHigh = phase === 'scan' && !current.monitoring && scanU(t) > 0.62 && scanU(t) < 1
    const on = phase !== 'settle' && phase !== 'reset' && !droneHigh
    const s = THREE.MathUtils.lerp(g.scale.x, on ? 1 : 0.001, 0.12)
    g.scale.setScalar(s)
    g.visible = s > 0.01
  })
  const monitoring = current.monitoring
  return (
    <group ref={ref} position={[0, ROOF_Y + 1.15, 0]}>
      <HoloText fontSize={0.42} variant="hudBold" color={monitoring ? theme.holo.cyan : theme.holo.white} glow={1.8} billboard>
        {current.stage.title}
      </HoloText>
      <HoloText position={[0, -0.4, 0]} fontSize={0.2} variant="mono" color={theme.holo.ice} glow={1.2} billboard>
        {monitoring ? 'after handover · sensors live' : `milestone ${current.index + 1} of ${MONITORING} · under verification`}
      </HoloText>
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Scan: drone and scan plane                                          */
/* ------------------------------------------------------------------ */

function ScanRig() {
  const ring = useRef<THREE.Group>(null)
  const drone = useRef<THREE.Group>(null)
  const beam = useRef<THREE.LineSegments>(null)
  const ringLine = useHoloLine({ color: theme.holo.cyan, intensity: 2.6, opacity: 1, scan: 0 })
  const ringFill = useHoloMesh({ color: theme.holo.cyan, intensity: 1, opacity: 0.12, rim: 0, scan: 0.6 })
  const body = useHoloMesh({ color: theme.holo.blue, intensity: 1.4, opacity: 0.6, rim: 1 })
  const edge = useHoloLine({ color: theme.holo.cyan, intensity: 2.2, opacity: 1, scan: 0 })
  const beamMat = useHoloLine({ color: theme.holo.cyan, intensity: 1.4, opacity: 0.7, scan: 0 })
  const ringGeom = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const x = 1
    const z = 1
    g.setAttribute('position', new THREE.Float32BufferAttribute([-x, 0, -z, x, 0, -z, x, 0, -z, x, 0, z, x, 0, z, -x, 0, z, -x, 0, z, -x, 0, -z], 3))
    return g
  }, [])
  const beamGeom = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(12), 3))
    return g
  }, [])
  const rotors = useMemo(() => {
    const pts: number[] = []
    for (const [x, z] of [
      [-0.2, -0.2],
      [0.2, -0.2],
      [0.2, 0.2],
      [-0.2, 0.2],
    ]) {
      for (let i = 0; i < 16; i++) {
        const a0 = (i / 16) * Math.PI * 2
        const a1 = ((i + 1) / 16) * Math.PI * 2
        pts.push(x + Math.cos(a0) * 0.12, 0.05, z + Math.sin(a0) * 0.12, x + Math.cos(a1) * 0.12, 0.05, z + Math.sin(a1) * 0.12)
      }
      pts.push(0, 0, 0, x, 0.05, z)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    return g
  }, [])

  useFrame(({ clock }) => {
    const s = useBuilding.getState()
    const c = s.current
    const on = s.phase === 'scan' && !c.monitoring && s.t < phaseSeconds.scan - 0.1
    const [lo, hi] = c.stage.span
    const y = lo + (hi - lo) * scanU(s.t)
    const pit = c.stage.id === 'excavation' || c.stage.id === 'foundation'
    const hx = pit ? PIT_X + 0.15 : HALF_X + 0.35
    const hz = pit ? PIT_Z + 0.15 : HALF_Z + 0.35
    const r = ring.current
    if (r) {
      r.position.set(0, y, 0)
      r.scale.set(hx, 1, hz)
      const k = THREE.MathUtils.lerp(r.userData.k ?? 0, on ? 1 : 0, 0.15)
      r.userData.k = k
      r.visible = k > 0.02
      setHoloColor(ringLine, theme.holo.cyan, 2.6 * k)
      setHoloColor(ringFill, theme.holo.cyan, 1 * k)
    }
    const d = drone.current
    if (d) {
      const a = 0.6 + s.t * 0.55
      const R = 6.2
      d.position.set(Math.sin(a) * R, Math.max(y + 1.3, 1.2), Math.cos(a) * R * 0.85)
      d.rotation.y = a
      const sc = THREE.MathUtils.lerp(d.scale.x, on ? 1 : 0.001, 0.15)
      d.scale.setScalar(sc)
      d.visible = sc > 0.02
      const bm = beam.current
      if (bm) {
        // Two sight lines from the drone to the near corners of the scan ring.
        const arr = beamGeom.getAttribute('position') as THREE.BufferAttribute
        const toLocal = (wx: number, wy: number, wz: number) => d.worldToLocal(new THREE.Vector3(wx, wy, wz))
        const cx = Math.sign(d.position.x) * hx
        const cz = Math.sign(d.position.z) * hz
        const p1 = toLocal(cx, y, -cz)
        const p2 = toLocal(-cx, y, cz)
        arr.setXYZ(0, 0, 0, 0)
        arr.setXYZ(1, p1.x, p1.y, p1.z)
        arr.setXYZ(2, 0, 0, 0)
        arr.setXYZ(3, p2.x, p2.y, p2.z)
        arr.needsUpdate = true
        setHoloColor(beamMat, theme.holo.cyan, 1.2 + Math.sin(clock.elapsedTime * 14) * 0.3)
      }
    }
  })

  return (
    <>
      <group ref={ring} visible={false}>
        <lineSegments geometry={ringGeom} material={ringLine} />
        <mesh rotation-x={-Math.PI / 2} material={ringFill}>
          <planeGeometry args={[2, 2]} />
        </mesh>
      </group>
      <group ref={drone} scale={0.001}>
        <mesh material={body}>
          <boxGeometry args={[0.26, 0.09, 0.26]} />
        </mesh>
        <lineSegments geometry={rotors} material={edge} />
        <lineSegments ref={beam} geometry={beamGeom} material={beamMat} frustumCulled={false} />
        <group position={[0, 0.55, 0]}>
          <HoloText fontSize={0.2} variant="hudBold" color={theme.holo.cyan} glow={1.8} billboard>
            PHOTON · DRONE SCAN
          </HoloText>
        </group>
      </group>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Plan vs as-built callouts                                           */
/* ------------------------------------------------------------------ */

/** Plan callouts stand on the ground in front of the tower, each with a leader up to what it measures. */
const CALLOUTS = [
  { x: -1.3, z: HALF_Z + 4.4 },
  { x: 2.7, z: HALF_Z + 4.4 },
]
/** In the pit milestones the piles reach toward the camera on screen, so the callouts stand further forward. */
const PIT_PUSH = 3.0
const calloutZ = (i: number, id: BuildingStageId) => CALLOUTS[i].z + (id === 'excavation' || id === 'foundation' ? PIT_PUSH : 0)

function PlanCallouts() {
  const c = useBuilding((s) => s.current)
  const group = useRef<THREE.Group>(null)
  const [lo, hi] = c.stage.span
  const leader = useMemo(() => {
    const pts: number[] = []
    const top = Math.min(hi, ROOF_Y)
    const face = c.stage.id === 'excavation' ? PIT_Z : HALF_Z + 0.05
    CALLOUTS.forEach((p, i) => {
      const y = lo + (top - lo) * (i === 0 ? 0.3 : 0.72)
      const x = i === 0 ? -1.8 : 1.8
      // Tick on the facade, a drop to the ground, then out to just behind the label.
      pts.push(x - 0.15, y, face, x + 0.15, y, face)
      pts.push(x, y, face, x, 0.02, face)
      pts.push(x, 0.02, face, p.x, 0.02, calloutZ(i, c.stage.id) - 1.0)
    })
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    return g
  }, [lo, hi, c.stage.id])
  const mat = useHoloLine({ color: theme.holo.ice, intensity: 1.4, opacity: 0.9, scan: 0 })

  useFrame(() => {
    const g = group.current
    if (!g) return
    const { phase, t } = useBuilding.getState()
    let k = 0
    if (phase === 'plan') k = clamp01((t - 0.3) / 0.5)
    else if (phase === 'verify' || phase === 'approve') k = 1
    const prev = (g.userData.k as number | undefined) ?? 0
    const v = THREE.MathUtils.lerp(prev, k, 0.15)
    g.userData.k = v
    g.visible = v > 0.02
    setHoloColor(mat, theme.holo.ice, 1.4 * v)
    for (const child of g.children) if (child.userData.label) child.scale.setScalar(Math.max(0.001, v))
  })

  const alert = c.monitoring
  return (
    <group ref={group} visible={false}>
      <lineSegments geometry={leader} material={mat} />
      {c.measures.slice(0, 2).map((m, i) => (
        <group key={m.label} position={[CALLOUTS[i].x, 0.35, calloutZ(i, c.stage.id)]} userData={{ label: true }}>
          <HoloText fontSize={0.24} variant="hudBold" color={alert && !m.ok ? theme.alert.amber : theme.holo.white} glow={1.7} billboard>
            {`${m.label.toUpperCase()} ${m.value}`}
          </HoloText>
          <HoloText position={[0, -0.3, 0]} fontSize={0.18} variant="mono" color={theme.holo.ice} glow={1.3} billboard>
            {`${alert ? 'limit' : 'plan'} ${m.plan}`}
          </HoloText>
        </group>
      ))}
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Findings                                                            */
/* ------------------------------------------------------------------ */

function Findings() {
  const c = useBuilding((s) => s.current)
  const order = useMemo(() => [...c.findings].sort((a, b) => a.y - b.y).map((f) => f.id), [c])
  return (
    <group>
      {c.findings.map((f, i) => (
        <FindingMark key={f.id} f={f} rank={order.indexOf(f.id)} vlm={i === c.vlmIndex} />
      ))}
    </group>
  )
}

const MARK = { w: 0.5, h: 0.42 }

function FindingMark({ f, rank, vlm }: { f: Finding; rank: number; vlm: boolean }) {
  const tone = f.tone === 'red' ? theme.alert.red : theme.alert.amber
  const group = useRef<THREE.Group>(null)
  const label = useRef<THREE.Group>(null)
  const vlmRef = useRef<THREE.Group>(null)
  const ringRef = useRef<THREE.Mesh>(null)
  const leaderRef = useRef<THREE.LineSegments>(null)
  const hovered = useRef(false)
  const out = useMemo(() => new THREE.Vector3(...f.out), [f])
  const up = f.out[1] > 0.5
  // Box faces outward from the surface it sits on.
  const rot = useMemo(() => {
    if (up) return new THREE.Euler(-Math.PI / 2, 0, 0)
    return new THREE.Euler(0, Math.atan2(out.x, out.z), 0)
  }, [out, up])
  // Labels sit outside the tower silhouette: to the right by default, or where the stage says.
  const side = !f.label || f.label[0] >= HALF_X
  const labelPos = useMemo(() => {
    const w = f.label ? new THREE.Vector3(...f.label) : new THREE.Vector3(LABEL_X, f.at[1] + 0.1, Math.min(f.at[2], HALF_Z))
    return w.sub(new THREE.Vector3(...f.at))
  }, [f])
  const frame = useMemo(() => new THREE.EdgesGeometry(new THREE.PlaneGeometry(MARK.w, MARK.h)), [])
  const leaderGeom = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const a = new THREE.Vector3(0, up ? 0.02 : MARK.h / 2, 0).addScaledVector(out, 0.03)
    const b = labelPos.clone().add(new THREE.Vector3(side ? -0.12 : 0, side ? 0 : -0.24, 0))
    g.setAttribute('position', new THREE.Float32BufferAttribute([a.x, a.y, a.z, b.x, b.y, b.z], 3))
    return g
  }, [out, labelPos, up, side])
  const boxMat = useHoloLine({ color: tone, intensity: 2.6, opacity: 1, scan: 0 }, [tone])
  const fillMat = useHoloMesh({ color: tone, intensity: 1.2, opacity: 0.22, rim: 0, scan: 0 }, [tone])
  const leaderMat = useHoloLine({ color: tone, intensity: 1.2, opacity: 0.7, scan: 0 }, [tone])
  const ringMat = useHoloMesh({ color: theme.ok, intensity: 2.4, opacity: 0.9, rim: 0, scan: 0 })

  useFrame(({ clock }) => {
    const g = group.current
    if (!g) return
    const { phase, t, found, checked, current } = useBuilding.getState()
    const shown = phase === 'scan' ? rank < found : phase !== 'reset' || t < 0.6
    const s = THREE.MathUtils.lerp(g.scale.x, shown ? (hovered.current ? 1.12 : 1) : 0.001, shown ? 0.16 : 0.25)
    g.scale.setScalar(s)
    g.visible = s > 0.01
    const blink = phase === 'scan' || current.monitoring ? 2.6 + Math.sin(clock.elapsedTime * 8 + rank) * 0.6 : 2.2
    setHoloColor(boxMat, tone, blink)
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
    inspectRecord(`IES record · ${f.cls.toLowerCase()} detection`, `${f.where} · conf ${f.confidence.toFixed(2)}`, f.record)
  }

  return (
    <group
      ref={group}
      position={f.at}
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
      <group rotation={rot} position={up ? [0, 0.01, 0] : [0, MARK.h / 2, 0]}>
        <lineSegments geometry={frame} material={boxMat} />
        <mesh material={fillMat}>
          <planeGeometry args={[MARK.w, MARK.h]} />
        </mesh>
        <mesh ref={ringRef} material={ringMat} visible={false}>
          <ringGeometry args={[0.42, 0.46, 48]} />
        </mesh>
      </group>
      <lineSegments ref={leaderRef} geometry={leaderGeom} material={leaderMat} />
      <group ref={label} position={labelPos}>
        <HoloText fontSize={0.3} variant="hudBold" color={tone} glow={1.9} anchorX={side ? 'left' : 'center'} billboard>
          {`${f.cls} ${f.confidence.toFixed(2)}`}
        </HoloText>
        <HoloText position={[0, -0.3, 0]} fontSize={0.2} variant="mono" color={theme.holo.ice} glow={1.2} anchorX={side ? 'left' : 'center'} billboard>
          {f.where}
        </HoloText>
        <group ref={vlmRef} position={[0, 0.36, 0]} scale={0.001}>
          <HoloText fontSize={0.2} variant="mono" color={theme.ok} glow={1.8} anchorX={side ? 'left' : 'center'} billboard>
            VLM ✓ confirmed
          </HoloText>
        </group>
      </group>
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Structural health sensors                                           */
/* ------------------------------------------------------------------ */

interface SensorNode {
  tag: string
  kind: 'piezometer' | 'settlement' | 'strain' | 'tilt' | 'crack' | 'frequency'
  at: [number, number, number]
  installedAt: number
}

const sensorNodes: SensorNode[] = [
  { tag: 'PZ-1', kind: 'piezometer', at: [PIT_X + 0.5, 0.05, PIT_Z + 0.3], installedAt: 0 },
  { tag: 'SM-1', kind: 'settlement', at: [-HALF_X - 0.14, 0.06, HALF_Z + 0.14], installedAt: 1 },
  { tag: 'SM-2', kind: 'settlement', at: [HALF_X + 0.14, 0.06, HALF_Z + 0.14], installedAt: 1 },
  { tag: 'SM-3', kind: 'settlement', at: [HALF_X + 0.14, 0.06, -HALF_Z - 0.14], installedAt: 1 },
  { tag: 'SM-4', kind: 'settlement', at: [-HALF_X - 0.14, 0.06, -HALF_Z - 0.14], installedAt: 1 },
  { tag: 'SG-1', kind: 'strain', at: [-0.6, levelY(1) + 0.4, HALF_Z + 0.1], installedAt: 2 },
  { tag: 'SG-2', kind: 'strain', at: [0.6, levelY(1) + 0.4, HALF_Z + 0.1], installedAt: 2 },
  { tag: 'TL-1', kind: 'tilt', at: [-HALF_X + 0.2, ROOF_Y + 0.12, HALF_Z - 0.2], installedAt: 2 },
  { tag: 'TL-2', kind: 'tilt', at: [HALF_X - 0.2, ROOF_Y + 0.12, -HALF_Z + 0.2], installedAt: 2 },
  { tag: 'AC-1', kind: 'frequency', at: [0, ROOF_Y + 0.12, 0.4], installedAt: 2 },
  { tag: 'CG-1', kind: 'crack', at: [HALF_X + 0.1, levelY(3) + 0.45, -0.3], installedAt: 3 },
  { tag: 'CG-2', kind: 'crack', at: [-1.2, levelY(2) + 0.12, HALF_Z + 0.1], installedAt: 3 },
]

function Sensors() {
  return (
    <group>
      {sensorNodes.map((n) => (
        <SensorMark key={n.tag} n={n} />
      ))}
    </group>
  )
}

function SensorMark({ n }: { n: SensorNode }) {
  const group = useRef<THREE.Group>(null)
  const ring = useRef<THREE.Mesh>(null)
  const tag = useRef<THREE.Group>(null)
  const core = useHoloMesh({ color: theme.holo.cyan, intensity: 2.2, opacity: 0.9, rim: 1 })
  const ringMat = useHoloMesh({ color: theme.holo.cyan, intensity: 2, opacity: 0.8, rim: 0, scan: 0 })
  const watched = n.tag === 'CG-2'

  useFrame(({ clock }) => {
    const g = group.current
    if (!g) return
    const s = useBuilding.getState()
    const installed = n.installedAt <= standingUpTo(s.stage) && !(s.phase === 'reset' && s.next === 0 && s.t > 0.6)
    const sc = THREE.MathUtils.lerp(g.scale.x, installed ? 1 : 0.001, 0.12)
    g.scale.setScalar(sc)
    g.visible = sc > 0.02
    const monitoring = s.stage === MONITORING
    const alert = watched && monitoring && useShm.getState().alert.crack
    const tone = alert ? theme.alert.amber : theme.holo.cyan
    setHoloColor(core, tone, alert ? 3 : 2.2)
    if (ring.current) {
      const speed = alert ? 1.6 : monitoring ? 0.8 : 0.45
      const k = (clock.elapsedTime * speed + n.at[0] * 0.13) % 1
      ring.current.scale.setScalar(alert ? 0.4 + k * 2.2 : 0.4 + k * 0.9)
      setHoloColor(ringMat, tone, (alert ? 2.8 : 1.6) * (1 - k))
    }
    if (tag.current) {
      const on = monitoring && s.phase !== 'reset'
      tag.current.scale.setScalar(THREE.MathUtils.lerp(tag.current.scale.x, on ? 1 : 0.001, 0.15))
    }
  })

  return (
    <group ref={group} position={n.at} scale={0.001}>
      <mesh material={core}>
        <octahedronGeometry args={[0.07, 0]} />
      </mesh>
      <Billboard>
        <mesh ref={ring} material={ringMat}>
          <ringGeometry args={[0.1, 0.12, 32]} />
        </mesh>
      </Billboard>
      {!watched && (
        <group ref={tag} position={[0, 0.24, 0]} scale={0.001}>
          <HoloText fontSize={0.13} variant="mono" color={theme.holo.ice} glow={1.1} billboard>
            {n.tag}
          </HoloText>
        </group>
      )}
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Certificate and ledger                                              */
/* ------------------------------------------------------------------ */

const CARD = { w: 3.3, h: 1.7 }

function lerpShow(g: THREE.Group | null, on: boolean) {
  if (!g) return
  const s = THREE.MathUtils.lerp(g.scale.x, on ? 1 : 0.001, 0.16)
  g.scale.setScalar(s)
  g.visible = s > 0.01
}

function CertificateCard() {
  const c = useBuilding((s) => s.current)
  const decision = useBuilding((s) => s.decision)
  const entry = useBuilding((s) => s.entry)
  const outcome = useBuilding((s) => s.outcome)
  const minted = useRef<THREE.Group>(null)
  const pending = useRef<THREE.Group>(null)
  const outcomeRef = useRef<THREE.Group>(null)
  const card = useHoloMesh({ color: theme.holo.blue, intensity: 1, opacity: 0.38, rim: 0.3 })
  const frame = useHoloLine({ color: theme.holo.white, intensity: 2.4, opacity: 1, scan: 0 })
  const dashed = useHoloLine({ color: theme.alert.amber, intensity: 2, opacity: 1, scan: 0 })
  const edges = useMemo(() => new THREE.EdgesGeometry(new THREE.PlaneGeometry(CARD.w, CARD.h)), [])
  const dashGeom = useMemo(() => {
    const pts: number[] = []
    const hw = CARD.w / 2
    const hh = CARD.h / 2
    const seg = (ax: number, ay: number, bx: number, by: number, n: number) => {
      for (let i = 0; i < n; i += 2) pts.push(ax + ((bx - ax) * i) / n, ay + ((by - ay) * i) / n, 0, ax + ((bx - ax) * (i + 1)) / n, ay + ((by - ay) * (i + 1)) / n, 0)
    }
    seg(-hw, hh, hw, hh, 30)
    seg(hw, hh, hw, -hh, 16)
    seg(hw, -hh, -hw, -hh, 30)
    seg(-hw, -hh, -hw, hh, 16)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    return g
  }, [])
  const accepted = decision?.action === 'accept'

  useFrame(({ clock }) => {
    const { phase, t } = useBuilding.getState()
    lerpShow(pending.current, phase === 'approve')
    lerpShow(minted.current, (phase === 'settle' && t > SEAL_AT - 0.35) || (phase === 'reset' && t < 0.7))
    lerpShow(outcomeRef.current, (phase === 'settle' && t > RELEASE_AT) || (phase === 'reset' && t < 0.7))
    setHoloColor(dashed, theme.alert.amber, 1.8 + Math.sin(clock.elapsedTime * 5) * 0.6)
    setHoloColor(frame, accepted ? theme.holo.white : theme.alert.amber, 2.4)
  })

  const monitoring = c.monitoring
  const title = accepted ? (monitoring ? 'INSPECTION WORK ORDER' : 'MILESTONE CERTIFICATE') : decision?.action === 'modify' ? 'ON HOLD' : 'NOT SETTLED'
  const idText = entry?.payload.certificate?.certificate_id ?? entry?.payload.work_order?.work_order_id ?? ''
  const sub = accepted ? idText : decision?.action === 'modify' ? c.stage.modify.label.toLowerCase() : `rejected · reason: ${decision?.reason ?? ''}`
  const tone = accepted ? theme.holo.white : theme.alert.amber
  const outcomeText = monitoring
    ? outcome === 'released'
      ? 'INSPECTION ORDERED'
      : 'WATCHING, NO ORDER'
    : outcome === 'released'
      ? 'RA BILL RELEASED'
      : 'RA BILL HELD'

  return (
    <group position={CERT_POS} scale={1.15}>
      <Billboard>
        <group ref={pending} scale={0.001}>
          <lineSegments geometry={dashGeom} material={dashed} />
          <HoloText position={[0, 0.3, 0.01]} fontSize={0.2} variant="hudBold" color={theme.alert.amber} glow={1.8}>
            {monitoring ? 'WORK ORDER NOT RAISED' : 'CERTIFICATE NOT MINTED'}
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
          <HoloText position={[0, 0.52, 0.01]} fontSize={0.23} variant="hudBold" color={tone} glow={2.2}>
            {title}
          </HoloText>
          <HoloText position={[0, 0.18, 0.01]} fontSize={0.15} variant="mono" color={theme.holo.ice} glow={1.4}>
            {sub}
          </HoloText>
          <HoloText position={[0, -0.12, 0.01]} fontSize={0.15} variant="mono" color={theme.holo.ice} glow={1.2}>
            {c.label}
          </HoloText>
          <HoloText position={[0, -0.42, 0.01]} fontSize={0.14} variant="mono" color={theme.holo.ice} glow={0.9}>
            {entry ? `ledger #${entry.block.seq} · ${entry.block.hash.slice(0, 16)}` : ''}
          </HoloText>
          <HoloText position={[0, -0.66, 0.01]} fontSize={0.12} variant="mono" color={theme.holo.cyan} glow={1.1}>
            click to inspect
          </HoloText>
        </group>
        <group ref={outcomeRef} position={[0, -CARD.h / 2 - 0.38, 0]} scale={0.001}>
          <HoloText fontSize={0.32} variant="hudBold" color={outcome === 'released' ? theme.ok : theme.alert.amber} glow={2.2}>
            {outcomeText}
          </HoloText>
        </group>
      </Billboard>
    </group>
  )
}

function LedgerRow() {
  const entries = useBuilding((s) => s.entries)
  const visible = entries.slice(-4)
  const link = useHoloLine({ color: theme.holo.cyan, intensity: 1.4, opacity: 0.8, scan: 0 })
  const linkGeom = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, LEDGER_SPACING * 3 + 0.5, 0, 0], 3))
    return g
  }, [])
  return (
    <group position={LEDGER_POS} scale={1.15}>
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

function LedgerBlockMesh({ entry, slot, newest }: { entry: BuildingEntry; slot: number; newest: boolean }) {
  const ref = useRef<THREE.Group>(null)
  const hovered = useRef(false)
  const bad = entry.payload.type === 'rejection' || entry.payload.type === 'hold'
  const body = useHoloMesh({ color: bad ? theme.alert.amber : theme.holo.blue, intensity: bad ? 1.2 : 1.4, opacity: 0.5, rim: 1 }, [bad])
  const edgeMat = useHoloLine({ color: bad ? theme.alert.amber : theme.holo.cyan, intensity: 2.2 }, [bad])
  const edges = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(0.5, 0.5, 0.5)), [])
  const target = useMemo(() => new THREE.Vector3(slot * LEDGER_SPACING, 0, 0), [slot])

  useFrame((_, dt) => {
    const g = ref.current
    if (!g) return
    g.position.lerp(target, Math.min(1, dt * 4))
    g.scale.setScalar(THREE.MathUtils.lerp(g.scale.x, hovered.current ? 1.18 : 1, 0.15))
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
