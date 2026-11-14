import { Billboard } from '@react-three/drei'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { theme } from '../../config/theme'
import { useApp } from '../../core/store'
import { HoloGrid } from '../../holo/HoloGrid'
import { useHoloLine, useHoloMesh } from '../../holo/hooks'
import { holoPointsMaterial, setHoloColor } from '../../holo/materials'
import { iesKeyOrder, verifyIesHash, type IesRecord } from '../../sim/ies'
import { canopyMaterial } from './canopyMaterial'
import { Tag } from './Tag'
import {
  boundary,
  boundarySegments,
  CELL,
  CELL_COUNT,
  canopyHeight,
  cellCol,
  cellName,
  cellRow,
  cellX,
  cellZ,
  COLS,
  drapeDashed,
  HALF_D,
  HALF_W,
  insideMask,
  outlineOf,
  patrolRoute,
  RANGER_POST,
  ROWS,
  SWEEP_FROM,
  SWEEP_TO,
  terrainY,
} from './layout'
import {
  incidentLedger,
  latest,
  phaseSeconds,
  ROUTE_S,
  ROUTE_SAMPLES,
  timeline,
  useForest,
  type LedgerEntry,
  type Phase,
} from './forestStore'

function setCursor(on: boolean) {
  document.body.style.cursor = on ? 'pointer' : ''
}

/** Opens an IES record in the inspector with its hash re-checked. */
export function inspectRecord(title: string, subtitle: string, record: IesRecord) {
  const ordered: Record<string, unknown> = {}
  for (const k of iesKeyOrder) ordered[k] = record[k]
  useApp.getState().setInspect({
    title,
    subtitle,
    data: ordered,
    checks: [
      { label: 'IES hash recomputed', ok: verifyIesHash(record) },
      { label: record.lineage ? `Derived via ${record.lineage.method} from ${record.lineage.input.length} inputs` : 'Capture (no lineage)', ok: true },
    ],
  })
}

export function inspectBlock(entry: LedgerEntry) {
  const v = incidentLedger.verify(entry.block, entry.payload)
  const sub = {
    patrol_dispatch: 'Patrol dispatch. Approved by a person.',
    rejection: 'Rejection. Recorded, nothing dispatched.',
    second_pass_request: 'Second pass requested. Nothing dispatched.',
  }[entry.payload.type]
  useApp.getState().setInspect({
    title: `Incident ledger block #${entry.block.seq}`,
    subtitle: sub,
    data: { block: entry.block, payload: entry.payload },
    checks: [
      { label: 'Payload hash matches', ok: v.payloadHashOk },
      { label: 'Block hash recomputed', ok: v.blockHashOk },
      { label: 'Linked to previous block', ok: v.linkOk },
      { label: 'Ed25519 signature valid', ok: v.signatureOk },
    ],
  })
}

export function inspectFire() {
  const s = useForest.getState()
  const name = cellName(s.hotspot)
  if (s.fire) inspectRecord('IES record · fire detection', `Cell ${name}, ${s.frames} thermal frames`, s.fire)
  else if (s.thermal.length) inspectRecord('IES record · thermal capture', `Cell ${name}, frame ${s.thermal.length}`, s.thermal[s.thermal.length - 1])
}

export function inspectClearing() {
  const s = useForest.getState()
  if (s.clearingRec) inspectRecord('IES record · canopy loss', `${s.areaHa} ha at boundary edge`, s.clearingRec)
}

const after = (phase: Phase, list: Phase[]) => list.includes(phase)
const ALERT_PHASES: Phase[] = ['fire', 'encroach', 'verify', 'approve', 'respond']
const CLEARING_PHASES: Phase[] = ['encroach', 'verify', 'approve', 'respond']

export function ForestStage() {
  useFrame((_, dt) => {
    if (useApp.getState().pendingScene) return
    useForest.getState().tick(Math.min(dt, 0.1))
  })

  useEffect(() => {
    useForest.getState().start()
    return () => setCursor(false)
  }, [])

  return (
    <>
      <HoloGrid y={-1.5} opacity={0.35} />
      <Terrain />
      <Canopy />
      <Boundary />
      <ScanSweep />
      <Clearing />
      <Hotspot />
      <RangerPost />
      <PatrolRoute />
    </>
  )
}

// ---------------------------------------------------------------- terrain

function Terrain() {
  const geometry = useMemo(() => {
    const pts: number[] = []
    const pad = 3
    const step = CELL
    const x0 = -HALF_W - pad * step
    const x1 = HALF_W + pad * step
    const z0 = -HALF_D - pad * step
    const z1 = HALF_D + pad * step
    const sub = 4
    for (let z = z0; z <= z1 + 1e-4; z += step) {
      for (let x = x0; x < x1 - 1e-4; x += step / sub) {
        const xb = x + step / sub
        pts.push(x, terrainY(x, z), z, xb, terrainY(xb, z), z)
      }
    }
    for (let x = x0; x <= x1 + 1e-4; x += step) {
      for (let z = z0; z < z1 - 1e-4; z += step / sub) {
        const zb = z + step / sub
        pts.push(x, terrainY(x, z), z, x, terrainY(x, zb), zb)
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    return g
  }, [])
  const mat = useHoloLine({ color: theme.brand.mid, intensity: 1.1, opacity: 0.5, scan: 0.3 })
  return <lineSegments geometry={geometry} material={mat} />
}

// ---------------------------------------------------------------- canopy

const healthStops: [number, THREE.Color][] = [
  [0.1, new THREE.Color('#081634')],
  [0.32, new THREE.Color('#0d3478')],
  [0.5, new THREE.Color(theme.brand.primaryFrom)],
  [0.68, new THREE.Color(theme.holo.blue)],
  [0.88, new THREE.Color(theme.holo.cyan)],
]

/** Cool scale for canopy health. Amber and red are kept for alerts. */
export function healthColor(v: number, out: THREE.Color) {
  if (v <= healthStops[0][0]) return out.copy(healthStops[0][1])
  for (let k = 1; k < healthStops.length; k++) {
    const [b, cb] = healthStops[k]
    if (v <= b) {
      const [a, ca] = healthStops[k - 1]
      return out.copy(ca).lerp(cb, (v - a) / (b - a))
    }
  }
  return out.copy(healthStops[healthStops.length - 1][1])
}

/** Values currently drawn. Persist across remounts so a return visit does not flash. */
const shown = new Float32Array(latest)

const AMBER = new THREE.Color(theme.alert.amber)
const RED = new THREE.Color(theme.alert.red)

function Canopy() {
  const mesh = useMemo(() => {
    const geo = new THREE.BoxGeometry(1, 1, 1)
    geo.translate(0, 0.5, 0)
    const m = new THREE.InstancedMesh(geo, canopyMaterial(), CELL_COUNT)
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CELL_COUNT * 3), 3)
    m.instanceColor.setUsage(THREE.DynamicDrawUsage)
    m.frustumCulled = false
    return m
  }, [])

  useEffect(
    () => () => {
      mesh.geometry.dispose()
      ;(mesh.material as THREE.Material).dispose()
      mesh.dispose()
    },
    [mesh],
  )

  const scratch = useMemo(
    () => ({ m: new THREE.Matrix4(), p: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3(), c: new THREE.Color() }),
    [],
  )
  const state = useRef({ sweepCol: COLS, flags: '' })
  const clearingSet = useRef(new Set<number>())

  const paint = (i: number, flags: { hot: number; hotTone: number; clearing: boolean }) => {
    const v = shown[i]
    const { m, p, q, s, c } = scratch
    const x = cellX(cellCol(i))
    const z = cellZ(cellRow(i))
    const h = canopyHeight(v)
    p.set(x, terrainY(x, z), z)
    s.set(CELL * 0.6, h, CELL * 0.6)
    m.compose(p, q, s)
    mesh.setMatrixAt(i, m)
    if (i === flags.hot) {
      c.copy(AMBER).lerp(RED, 0.35).multiplyScalar(flags.hotTone)
    } else if (flags.clearing && clearingSet.current.has(i)) {
      c.copy(RED).multiplyScalar(0.7)
    } else {
      healthColor(v, c).multiplyScalar((0.5 + v * 0.75) * (insideMask[i] ? 1 : 0.3))
    }
    mesh.setColorAt(i, c)
  }

  const flagsNow = () => {
    const s = useForest.getState()
    const hotOn = after(s.phase, ALERT_PHASES) && s.frames > 0
    const tone = !hotOn ? 0 : s.decision?.action === 'accept' ? 1.6 : s.decision ? 1.1 : 2.4
    return { hot: hotOn ? s.hotspot : -1, hotTone: tone, clearing: after(s.phase, CLEARING_PHASES) }
  }

  const repaintAll = () => {
    const f = flagsNow()
    clearingSet.current = new Set(useForest.getState().clearing)
    for (let i = 0; i < CELL_COUNT; i++) paint(i, f)
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }

  // First paint before the first frame, so instanceColor exists when the shader compiles.
  useMemo(repaintAll, []) // eslint-disable-line react-hooks/exhaustive-deps

  useFrame(() => {
    const s = useForest.getState()
    const mat = mesh.material as THREE.ShaderMaterial
    const st = state.current
    let sweepX = -999
    if (s.phase === 'scan') {
      sweepX = THREE.MathUtils.lerp(SWEEP_FROM, SWEEP_TO, Math.min(1, timeline.t / (phaseSeconds.scan * 0.92)))
      if (timeline.t < 0.05) st.sweepCol = 0
    } else if (s.phase === 'respond' && s.decision?.action === 'modify') {
      const hx = cellX(cellCol(s.hotspot))
      sweepX = THREE.MathUtils.lerp(hx - 3, hx + 3, Math.min(1, timeline.t / 2.6))
    }
    mat.uniforms.uSweepX.value = sweepX
    mat.uniforms.uSweepGlow.value = sweepX > -900 ? 1 : 0

    const f = flagsNow()
    const key = `${f.hot}|${f.hotTone}|${f.clearing}|${s.clearing.length}|${s.clearing[0] ?? -1}`
    let dirty = false
    if (key !== st.flags) {
      st.flags = key
      repaintAll()
      dirty = true
    }
    // Refresh columns as the scan line passes them.
    if (s.phase === 'scan') {
      while (st.sweepCol < COLS && cellX(st.sweepCol) < sweepX) {
        for (let r = 0; r < ROWS; r++) {
          const i = r * COLS + st.sweepCol
          shown[i] = latest[i]
          paint(i, f)
        }
        st.sweepCol++
        dirty = true
      }
    }
    if (dirty) {
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  })

  return <primitive object={mesh} />
}

// ---------------------------------------------------------------- boundary

const LABEL_X = -0.8
const LABEL_Z = 6.75
const LABEL_Y = Math.max(terrainY(LABEL_X - 2.5, LABEL_Z), terrainY(LABEL_X, LABEL_Z), terrainY(LABEL_X + 2.5, LABEL_Z)) + 0.08

function Boundary() {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(drapeDashed(boundarySegments(), 0.06, 0.32, 0.18), 3))
    return g
  }, [])
  const mat = useHoloLine({ color: theme.holo.ice, intensity: 1.7, opacity: 0.95, scan: 0.2 })
  const posts = useMemo(() => {
    const pts: number[] = []
    for (const [x, z] of boundary) {
      const y = terrainY(x, z)
      pts.push(x, y, z, x, y + 0.9, z)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    return g
  }, [])
  const postMat = useHoloLine({ color: theme.holo.cyan, intensity: 1.4, opacity: 0.7 })
  return (
    <group>
      <lineSegments geometry={geometry} material={mat} />
      <lineSegments geometry={posts} material={postMat} />
      <group position={[LABEL_X, LABEL_Y, LABEL_Z]} rotation-x={-Math.PI / 2}>
        <Tag position={[0, 0.2, 0]} fontSize={0.42} variant="hudBold" glow={1.6}>
          CONCESSION BOUNDARY
        </Tag>
        <Tag position={[0, -0.25, 0]} fontSize={0.22} variant="mono" color={theme.holo.dim} glow={2.6}>
          canopy grid · 1 cell = 1 ha · simulated readings
        </Tag>
      </group>
    </group>
  )
}

// ---------------------------------------------------------------- scan sweep

function ScanSweep() {
  const group = useRef<THREE.Group>(null)
  const plane = useHoloMesh({ color: theme.holo.cyan, intensity: 1.4, opacity: 0.14, rim: 0, scan: 0.6 })
  const top = useHoloLine({ color: theme.holo.white, intensity: 2.6, opacity: 1 })
  const topGeom = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -HALF_D - 0.6, 0, 0, HALF_D + 0.6], 3))
    return g
  }, [])
  useFrame(() => {
    const g = group.current
    if (!g) return
    const s = useForest.getState()
    let x = -999
    if (s.phase === 'scan') x = THREE.MathUtils.lerp(SWEEP_FROM, SWEEP_TO, Math.min(1, timeline.t / (phaseSeconds.scan * 0.92)))
    else if (s.phase === 'respond' && s.decision?.action === 'modify') {
      const hx = cellX(cellCol(s.hotspot))
      x = THREE.MathUtils.lerp(hx - 3, hx + 3, Math.min(1, timeline.t / 2.6))
    }
    g.visible = x > -900 && x < SWEEP_TO - 0.05
    g.position.x = x
  })
  return (
    <group ref={group} visible={false}>
      <mesh position-y={0.9} rotation-y={Math.PI / 2} material={plane}>
        <planeGeometry args={[HALF_D * 2 + 1.2, 4.2]} />
      </mesh>
      <lineSegments geometry={topGeom} position-y={3} material={top} />
    </group>
  )
}

// ---------------------------------------------------------------- fire hotspot

const EMBERS = 46

function Hotspot() {
  const hotspot = useForest((s) => s.hotspot)
  const frames = useForest((s) => s.frames)
  const confidence = useForest((s) => s.confidence)
  const decision = useForest((s) => s.decision)
  const phase = useForest((s) => s.phase)
  const root = useRef<THREE.Group>(null)
  const ring = useRef<THREE.Mesh>(null)
  const bracket = useRef<THREE.LineSegments>(null)

  const x = cellX(cellCol(hotspot))
  const z = cellZ(cellRow(hotspot))
  const base = terrainY(x, z)
  const top = base + canopyHeight(latest[hotspot])

  const beamMat = useHoloMesh({ color: theme.alert.amber, intensity: 2.6, opacity: 0.55, rim: 1.2, scan: 0.6 })
  const ringMat = useHoloMesh({ color: theme.alert.amber, intensity: 3, opacity: 0.85, rim: 0, scan: 0 })
  const discMat = useHoloMesh({ color: theme.alert.red, intensity: 1.2, opacity: 0.16, rim: 0, scan: 0 })
  const bracketMat = useHoloLine({ color: theme.alert.amber, intensity: 3, opacity: 1 })
  const bracketGeom = useMemo(() => {
    const h = CELL * 0.62
    const k = CELL * 0.26
    const pts: number[] = []
    for (const [sx, sz] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      pts.push(sx * h, 0, sz * h, sx * h - sx * k, 0, sz * h, sx * h, 0, sz * h, sx * h, 0, sz * h - sz * k)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    return g
  }, [])

  const embers = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const pos = new Float32Array(EMBERS * 3)
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage))
    const seed = new Float32Array(EMBERS * 3)
    for (let k = 0; k < EMBERS; k++) {
      seed[k * 3] = Math.random()
      seed[k * 3 + 1] = Math.random() * Math.PI * 2
      seed[k * 3 + 2] = 0.4 + Math.random() * 0.6
    }
    const mat = holoPointsMaterial({ color: theme.alert.amber, intensity: 3.2, size: 2.6 })
    const pts = new THREE.Points(g, mat)
    pts.frustumCulled = false
    return { pts, pos, seed, g, mat }
  }, [])
  useEffect(
    () => () => {
      embers.g.dispose()
      embers.mat.dispose()
    },
    [embers],
  )

  const lastFrame = useRef(0)
  const flash = useRef(0)

  useFrame(({ clock }, dt) => {
    const s = useForest.getState()
    const g = root.current
    if (!g) return
    const on = after(s.phase, ALERT_PHASES) && s.frames > 0
    g.visible = on
    if (!on) return
    const time = clock.elapsedTime
    const responding = s.decision?.action === 'accept'
    const held = !!s.decision && !responding

    if (s.frames !== lastFrame.current) {
      lastFrame.current = s.frames
      flash.current = 1
    }
    flash.current = Math.max(0, flash.current - dt * 2.2)
    setHoloColor(bracketMat, theme.alert.amber, 1.6 + flash.current * 4)
    if (bracket.current) bracket.current.scale.setScalar(1 + flash.current * 0.35)

    const pulse = 0.5 + 0.5 * Math.sin(time * (responding ? 3 : 6))
    if (ring.current) ring.current.scale.setScalar(1 + ((time * 0.9) % 1) * 1.4)
    setHoloColor(ringMat, responding ? theme.holo.white : theme.alert.amber, (responding ? 2.2 : 3) * (1 - ((time * 0.9) % 1)))
    setHoloColor(beamMat, held ? theme.alert.amber : theme.alert.amber, held ? 1.2 : 1.8 + pulse * 1.4)

    const rate = held ? 0.45 : responding ? 0.6 : 1
    for (let k = 0; k < EMBERS; k++) {
      const u = (embers.seed[k * 3] + time * 0.35 * embers.seed[k * 3 + 2] * rate) % 1
      const a = embers.seed[k * 3 + 1] + time * 0.8
      const r = 0.12 + u * 0.35
      embers.pos[k * 3] = Math.cos(a) * r
      embers.pos[k * 3 + 1] = u * 2.2 * (held ? 0.5 : 1)
      embers.pos[k * 3 + 2] = Math.sin(a) * r
    }
    ;(embers.g.attributes.position as THREE.BufferAttribute).needsUpdate = true
    embers.mat.uniforms.uOpacity.value = held ? 0.45 : 1
  })

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    inspectFire()
  }
  const hover = {
    onPointerOver: () => setCursor(true),
    onPointerOut: () => setCursor(false),
  }

  const name = cellName(hotspot)
  let status = `frame ${frames} · conf ${confidence.toFixed(2)}`
  let tone: string = theme.alert.amber
  if (decision?.action === 'accept') {
    status = 'UNDER RESPONSE · patrol dispatched'
    tone = theme.ok
  } else if (decision?.action === 'reject') {
    status = `NOT DISPATCHED · ${decision.reason}`
  } else if (decision?.action === 'modify') {
    status = 'SECOND PASS REQUESTED'
  } else if (phase === 'approve') {
    status = `awaiting Forest Officer · conf ${confidence.toFixed(2)}`
  } else if (frames >= 2) {
    status = `persists ${frames} frames · conf ${confidence.toFixed(2)}`
  }

  return (
    <group ref={root} position={[x, 0, z]} visible={false}>
      <mesh position-y={base + 0.04} rotation-x={-Math.PI / 2} material={discMat} onClick={onClick} {...hover}>
        <circleGeometry args={[0.75, 40]} />
      </mesh>
      <mesh ref={ring} position-y={top + 0.03} rotation-x={-Math.PI / 2} material={ringMat}>
        <ringGeometry args={[0.42, 0.48, 48]} />
      </mesh>
      <lineSegments ref={bracket} geometry={bracketGeom} position-y={top + 0.05} material={bracketMat} />
      <mesh position-y={top + 1.1} material={beamMat} onClick={onClick} {...hover}>
        <cylinderGeometry args={[0.07, 0.16, 2.2, 12, 1, true]} />
      </mesh>
      <primitive object={embers.pts} position-y={top} />
      <Billboard position={[0, top + 2.9, 0]}>
        <Tag position={[0, 0.42, 0]} fontSize={0.42} variant="hudBold" color={theme.alert.amber} glow={2}>
          {`THERMAL HOTSPOT · ${name}`}
        </Tag>
        <Tag position={[0, 0, 0]} fontSize={0.27} variant="mono" color={tone} glow={2}>
          {status}
        </Tag>
      </Billboard>
    </group>
  )
}

// ---------------------------------------------------------------- encroachment

function Clearing() {
  const cells = useForest((s) => s.clearing)
  const areaHa = useForest((s) => s.areaHa)
  const changePct = useForest((s) => s.changePct)
  const root = useRef<THREE.Group>(null)

  const outline = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const pts = drapeDashed(outlineOf(cells), 0.1, 0.16, 0.1)
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    return { g, count: pts.length / 3 }
  }, [cells])
  const fill = useMemo(() => {
    const pts: number[] = []
    const h = CELL / 2
    for (const i of cells) {
      const x = cellX(cellCol(i))
      const z = cellZ(cellRow(i))
      const corner = (dx: number, dz: number) => [x + dx, terrainY(x + dx, z + dz) + 0.07, z + dz]
      const a = corner(-h, -h)
      const b = corner(h, -h)
      const c = corner(h, h)
      const d = corner(-h, h)
      pts.push(...a, ...d, ...c, ...a, ...c, ...b)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    g.computeVertexNormals()
    return g
  }, [cells])
  useEffect(
    () => () => {
      outline.g.dispose()
      fill.dispose()
    },
    [outline, fill],
  )

  const label = useMemo(() => {
    let x = 0
    let z = 0
    for (const i of cells) {
      x += cellX(cellCol(i))
      z += cellZ(cellRow(i))
    }
    const n = Math.max(1, cells.length)
    x /= n
    z /= n
    // Pull the label a little toward the middle so it stays clear of the side panels.
    const lx = x * 0.88
    const lz = z * 0.9
    return new THREE.Vector3(lx, terrainY(x, z) + 2.4, lz)
  }, [cells])

  const lineMat = useHoloLine({ color: theme.alert.red, intensity: 2.6, opacity: 1, scan: 0 })
  const fillMat = useHoloMesh({ color: theme.alert.red, intensity: 1.2, opacity: 0.22, rim: 0, scan: 0.4 })
  const stem = useMemo(() => {
    const g = new THREE.BufferGeometry()
    return g
  }, [])
  useEffect(() => {
    let x = 0
    let z = 0
    for (const i of cells) {
      x += cellX(cellCol(i))
      z += cellZ(cellRow(i))
    }
    const n = Math.max(1, cells.length)
    x /= n
    z /= n
    stem.setAttribute('position', new THREE.Float32BufferAttribute([x, terrainY(x, z) + 0.12, z, label.x, label.y - 0.55, label.z], 3))
  }, [cells, label, stem])
  useEffect(() => () => stem.dispose(), [stem])
  const stemMat = useHoloLine({ color: theme.alert.red, intensity: 1.6, opacity: 0.7 })

  useFrame(({ clock }) => {
    const g = root.current
    if (!g) return
    const s = useForest.getState()
    const on = after(s.phase, CLEARING_PHASES)
    g.visible = on
    if (!on) return
    const u = s.phase === 'encroach' ? Math.min(1, timeline.t / 1.4) : 1
    outline.g.setDrawRange(0, Math.floor((outline.count * u) / 2) * 2)
    setHoloColor(lineMat, theme.alert.red, 2 + Math.sin(clock.elapsedTime * 4) * 0.6)
  })

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    inspectClearing()
  }

  return (
    <group ref={root} visible={false}>
      <lineSegments geometry={outline.g} material={lineMat} />
      <mesh geometry={fill} material={fillMat} onClick={onClick} onPointerOver={() => setCursor(true)} onPointerOut={() => setCursor(false)} />
      <lineSegments geometry={stem} material={stemMat} />
      <Billboard position={label}>
        <Tag position={[0, 0.42, 0]} fontSize={0.4} variant="hudBold" color={theme.alert.red} glow={2}>
          {`ENCROACHMENT · ${areaHa} ha`}
        </Tag>
        <Tag position={[0, 0, 0]} fontSize={0.27} variant="mono" color={theme.alert.amber} glow={1.8}>
          {`${changePct}% canopy vs baseline`}
        </Tag>
      </Billboard>
    </group>
  )
}

// ---------------------------------------------------------------- patrol

function RangerPost() {
  const mast = useHoloMesh({ color: theme.holo.blue, intensity: 1.5, opacity: 0.6 })
  const cabin = useHoloMesh({ color: theme.holo.cyan, intensity: 1.4, opacity: 0.5 })
  const edges = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(0.55, 0.36, 0.55)), [])
  const edgeMat = useHoloLine({ color: theme.holo.cyan, intensity: 2 })
  const { x, y, z } = RANGER_POST
  return (
    <group position={[x, y, z]}>
      <mesh position-y={0.7} material={mast}>
        <cylinderGeometry args={[0.04, 0.07, 1.4, 8]} />
      </mesh>
      <mesh position-y={1.55} material={cabin}>
        <boxGeometry args={[0.55, 0.36, 0.55]} />
      </mesh>
      <lineSegments geometry={edges} position-y={1.55} material={edgeMat} />
      <Billboard position={[0, 2.3, 0]}>
        <Tag fontSize={0.34} variant="hudBold" glow={1.6}>
          RANGER POST
        </Tag>
      </Billboard>
    </group>
  )
}

function PatrolRoute() {
  const hotspot = useForest((s) => s.hotspot)
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ROUTE_SAMPLES * 3), 3))
    return g
  }, [])
  useEffect(() => {
    patrolRoute(hotspot, ROUTE_SAMPLES, geometry.attributes.position.array as Float32Array)
    geometry.attributes.position.needsUpdate = true
    geometry.computeBoundingSphere()
  }, [hotspot, geometry])
  const mat = useHoloLine({ color: theme.holo.white, intensity: 2.6, opacity: 1, scan: 0 })
  const line = useMemo(() => {
    const l = new THREE.Line(geometry, mat)
    l.frustumCulled = false
    return l
  }, [geometry, mat])
  useEffect(() => () => geometry.dispose(), [geometry])

  const dot = useRef<THREE.Mesh>(null)
  const dotMat = useHoloMesh({ color: theme.holo.white, intensity: 4, opacity: 1, rim: 0.5, scan: 0 })
  const group = useRef<THREE.Group>(null)

  useFrame(({ clock }) => {
    const s = useForest.getState()
    const g = group.current
    if (!g) return
    const on = s.phase === 'respond' && s.decision?.action === 'accept'
    g.visible = on
    if (!on) return
    const u = Math.min(1, timeline.t / ROUTE_S)
    const eased = 1 - Math.pow(1 - u, 2)
    const n = Math.max(2, Math.floor(eased * ROUTE_SAMPLES))
    geometry.setDrawRange(0, n)
    const arr = geometry.attributes.position.array as Float32Array
    const k = (n - 1) * 3
    if (dot.current) {
      dot.current.position.set(arr[k], arr[k + 1] + 0.08, arr[k + 2])
      dot.current.scale.setScalar(1 + Math.sin(clock.elapsedTime * 8) * 0.15)
    }
    setHoloColor(mat, theme.holo.white, 2 + Math.sin(clock.elapsedTime * 3) * 0.4)
  })

  return (
    <group ref={group} visible={false}>
      <primitive object={line} />
      <mesh ref={dot} material={dotMat}>
        <sphereGeometry args={[0.13, 16, 16]} />
      </mesh>
    </group>
  )
}

