import { Billboard } from '@react-three/drei'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import * as THREE from 'three'
import { theme } from '../../config/theme'
import { useApp } from '../../core/store'
import { HoloGrid } from '../../holo/HoloGrid'
import { HoloText } from '../../holo/HoloText'
import { useHoloLine, useHoloMesh } from '../../holo/hooks'
import { holoPointsMaterial, setHoloColor } from '../../holo/materials'
import { holoUniforms } from '../../holo/uniforms'
import { iesKeyOrder, verifyIesHash, type IesRecord } from '../../sim/ies'
import {
  CENTER_X,
  DMA_COUNT,
  DMA_CX,
  DMA_HALF_W,
  DMA_Z0,
  DMA_Z1,
  LEDGER_SPACING,
  LEDGER_VISIBLE,
  LEDGER_Y,
  LEDGER_Z,
  MARKER_Y,
  PIPE_Y,
  TANK,
  TRUNK_Z,
  flowSegments,
  inletPos,
  leakPoint,
  ledgerSlot,
  network,
  type Building,
} from './network'
import {
  dmaLabel,
  entryChip,
  inflowRatio,
  leakLevel,
  phaseU,
  startWater,
  useWater,
  waterLedger,
  type LedgerEntry,
  type Phase,
} from './waterStore'

/** Ledger block appears when the packet arrives, at this fraction of the write phase. */
const BLOCK_APPEAR_U = 0.68

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

/** Shared per-frame read of the director state. No allocations. */
const F = { phase: 'flow' as Phase, u: 0, leak: 0, alert: 0, spray: 0 }
function readFrame() {
  const phase = useWater.getState().phase
  const u = phaseU(phase)
  F.phase = phase
  F.u = u
  F.leak = leakLevel(phase, u)
  F.spray = smooth(0.45, 0.9, F.leak)
  F.alert =
    phase === 'leak' ? smooth(0.2, 0.6, u) : phase === 'detect' || phase === 'approve' ? 1 : phase === 'write' ? 1 - smooth(0.05, 0.5, u) : 0
  return F
}

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
      { label: record.lineage ? `Derived via ${record.lineage.method}` : 'Capture (no lineage)', ok: true },
    ],
  })
}

const entrySubtitle = {
  'verified-loss': 'Verified loss. Water Ledger entry.',
  rejection: 'Rejection. Recorded, no loss written.',
  'field-check': 'Field crew first. Loss entry held.',
} as const

export function inspectBlock(entry: LedgerEntry) {
  const v = waterLedger.verify(entry.block, entry.payload)
  useApp.getState().setInspect({
    title: `Water Ledger block #${entry.block.seq}`,
    subtitle: entrySubtitle[entry.payload.type],
    data: { block: entry.block, payload: entry.payload },
    checks: [
      { label: 'Payload hash matches', ok: v.payloadHashOk },
      { label: 'Block hash recomputed', ok: v.blockHashOk },
      { label: 'Linked to previous block', ok: v.linkOk },
      { label: 'Ed25519 signature valid', ok: v.signatureOk },
    ],
  })
}

export function WaterStage() {
  useFrame((_, dt) => {
    if (useApp.getState().pendingScene) return
    useWater.getState().tick(Math.min(dt, 0.1))
  })

  useEffect(() => {
    startWater()
    return () => setCursor(false)
  }, [])

  return (
    <>
      <HoloGrid y={-0.02} opacity={0.5} />
      <City />
      <Tank />
      <DmaAreas />
      <Pipes />
      <LeakSegment />
      <ConsumerMeters />
      <InletMeters />
      <PressureLoggers />
      <FlowParticles />
      <BalanceSweep />
      <Detection />
      <LedgerChain />
      <Packet />
    </>
  )
}

/* ---------- City ---------- */

const unitBox = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)

function buildingEdges(items: Building[]) {
  const edge = new THREE.EdgesGeometry(unitBox)
  const src = edge.getAttribute('position').array as Float32Array
  const out = new Float32Array(src.length * items.length)
  items.forEach((b, i) => {
    for (let k = 0; k < src.length; k += 3) {
      const o = i * src.length + k
      out[o] = src[k] * b.size.x + b.pos.x
      out[o + 1] = src[k + 1] * b.size.y + b.pos.y
      out[o + 2] = src[k + 2] * b.size.z + b.pos.z
    }
  })
  edge.dispose()
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(out, 3))
  return g
}

function Instanced({ geometry, material, matrices }: { geometry: THREE.BufferGeometry; material: THREE.Material; matrices: THREE.Matrix4[] }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  useLayoutEffect(() => {
    const m = ref.current
    if (!m) return
    matrices.forEach((mat, i) => m.setMatrixAt(i, mat))
    m.instanceMatrix.needsUpdate = true
  }, [matrices])
  return <instancedMesh ref={ref} args={[geometry, material, matrices.length]} frustumCulled={false} />
}

function City() {
  const inside = useMemo(() => network.buildings.filter((b) => b.inside), [])
  const outside = useMemo(() => network.buildings.filter((b) => !b.inside), [])
  const mInside = useMemo(() => inside.map((b) => new THREE.Matrix4().makeScale(b.size.x, b.size.y, b.size.z).setPosition(b.pos)), [inside])
  const mOutside = useMemo(() => outside.map((b) => new THREE.Matrix4().makeScale(b.size.x, b.size.y, b.size.z).setPosition(b.pos)), [outside])
  const eInside = useMemo(() => buildingEdges(inside), [inside])
  const eOutside = useMemo(() => buildingEdges(outside), [outside])
  const faceIn = useHoloMesh({ color: theme.brand.primaryFrom, intensity: 0.8, opacity: 0.14, rim: 1.1, scan: 0.6 })
  const faceOut = useHoloMesh({ color: theme.holo.dim, intensity: 0.7, opacity: 0.07, rim: 0.8, scan: 0.4 })
  const edgeIn = useHoloLine({ color: theme.holo.blue, intensity: 0.75, opacity: 0.5, scan: 0.5 })
  const edgeOut = useHoloLine({ color: theme.holo.dim, intensity: 0.8, opacity: 0.32, scan: 0.3 })
  return (
    <group>
      <Instanced geometry={unitBox} material={faceIn} matrices={mInside} />
      <Instanced geometry={unitBox} material={faceOut} matrices={mOutside} />
      <lineSegments geometry={eInside} material={edgeIn} />
      <lineSegments geometry={eOutside} material={edgeOut} />
    </group>
  )
}

/* ---------- Reservoir ---------- */

function circleGeometry(radius: number, segments = 64) {
  const pts: number[] = []
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2
    const a1 = ((i + 1) / segments) * Math.PI * 2
    pts.push(Math.cos(a0) * radius, 0, Math.sin(a0) * radius, Math.cos(a1) * radius, 0, Math.sin(a1) * radius)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
  return g
}

const unitCircle = circleGeometry(1)

function Tank() {
  const body = useHoloMesh({ color: theme.holo.blue, intensity: 1.0, opacity: 0.3, rim: 1.4 })
  const water = useHoloMesh({ color: theme.holo.cyan, intensity: 1.2, opacity: 0.22, rim: 0.8, scan: 0.8 })
  const frame = useHoloLine({ color: theme.holo.cyan, intensity: 1.7, opacity: 0.9 })
  const legs = useMemo(() => {
    const pts: number[] = []
    const r = 0.55
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4
      pts.push(Math.cos(a) * r, 0, Math.sin(a) * r, Math.cos(a) * 0.5, 1.55, Math.sin(a) * 0.5)
    }
    // Cross bracing.
    for (let k = 0; k < 4; k++) {
      const a0 = (k / 4) * Math.PI * 2 + Math.PI / 4
      const a1 = ((k + 1) / 4) * Math.PI * 2 + Math.PI / 4
      pts.push(Math.cos(a0) * 0.53, 0.75, Math.sin(a0) * 0.53, Math.cos(a1) * 0.53, 0.75, Math.sin(a1) * 0.53)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    return g
  }, [])
  return (
    <group position={[TANK.x, 0, TANK.z]}>
      <lineSegments geometry={legs} material={frame} />
      <mesh position-y={2.1} material={body}>
        <cylinderGeometry args={[0.85, 0.7, 1.1, 32, 1, true]} />
      </mesh>
      <mesh position-y={1.95} material={water}>
        <cylinderGeometry args={[0.8, 0.68, 0.75, 32, 1]} />
      </mesh>
      <mesh position-y={2.85} material={body}>
        <coneGeometry args={[0.85, 0.4, 32, 1, true]} />
      </mesh>
      <lineSegments geometry={unitCircle} material={frame} position-y={2.65} scale={0.85} />
      <lineSegments geometry={unitCircle} material={frame} position-y={1.55} scale={0.7} />
      <HoloText position={[0, 3.55, 0]} fontSize={0.34} variant="hudBold" glow={1.7} billboard>
        ESR
      </HoloText>
      <HoloText position={[0, 3.25, 0]} fontSize={0.14} variant="mono" color={theme.holo.ice} glow={1.2} opacity={0.8} billboard>
        elevated service reservoir
      </HoloText>
      <HoloText position={[0.25, 0.03, TRUNK_Z - TANK.z - 0.32]} rotation-x={-Math.PI / 2} anchorX="left" fontSize={0.2} variant="mono" color={theme.holo.ice} glow={1.2} opacity={0.75}>
        TRUNK MAIN
      </HoloText>
    </group>
  )
}

/* ---------- DMA areas ---------- */

function dashedRect(x0: number, x1: number, z0: number, z1: number, dash = 0.2, gap = 0.13) {
  const pts: number[] = []
  const edge = (ax: number, az: number, bx: number, bz: number) => {
    const len = Math.hypot(bx - ax, bz - az)
    for (let s = 0; s < len; s += dash + gap) {
      const e = Math.min(len, s + dash)
      pts.push(ax + ((bx - ax) * s) / len, 0.02, az + ((bz - az) * s) / len, ax + ((bx - ax) * e) / len, 0.02, az + ((bz - az) * e) / len)
    }
  }
  edge(x0, z0, x1, z0)
  edge(x1, z0, x1, z1)
  edge(x1, z1, x0, z1)
  edge(x0, z1, x0, z0)
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
  return g
}

const BOUND_PAD = 0.12
const BOUND_Z0 = DMA_Z0 - 0.3

function DmaAreas() {
  return (
    <>
      {Array.from({ length: DMA_COUNT }, (_, d) => (
        <DmaArea key={d} d={d} />
      ))}
    </>
  )
}

function DmaArea({ d }: { d: number }) {
  const cx = DMA_CX[d]
  const geom = useMemo(() => dashedRect(cx - DMA_HALF_W - BOUND_PAD, cx + DMA_HALF_W + BOUND_PAD, BOUND_Z0, DMA_Z1), [cx])
  const line = useHoloLine({ color: theme.holo.blue, intensity: 1.4, opacity: 0.9, scan: 0.3 })
  const floor = useHoloMesh({ color: theme.brand.mid, intensity: 0.6, opacity: 0.1, rim: 0, scan: 0.3 })
  const w = (DMA_HALF_W + BOUND_PAD) * 2
  const h = DMA_Z1 - BOUND_Z0
  useFrame(({ clock }) => {
    const f = readFrame()
    const isLeak = useWater.getState().current.dma === d
    if (isLeak && f.alert > 0.01) {
      const pulse = 0.75 + 0.25 * Math.sin(clock.elapsedTime * 6)
      setHoloColor(line, theme.alert.amber, 1.4 + f.alert * 1.6 * pulse)
      setHoloColor(floor, theme.alert.amber, 0.25 + f.alert * 0.35 * pulse)
      return
    }
    // Balance sweep lights each DMA as it passes.
    let k = 0
    if (f.phase === 'balance') {
      const sx = sweepX(f.u)
      k = smooth(1.2, 0, Math.abs(sx - cx) - DMA_HALF_W + 1.2)
    }
    setHoloColor(line, k > 0 ? theme.holo.cyan : theme.holo.blue, 1.4 + k * 1.6)
    setHoloColor(floor, theme.brand.mid, 0.6 + k * 0.8)
  })
  return (
    <group>
      <lineSegments geometry={geom} material={line} />
      <mesh position={[cx, 0.005, (BOUND_Z0 + DMA_Z1) / 2]} rotation-x={-Math.PI / 2} material={floor}>
        <planeGeometry args={[w, h]} />
      </mesh>
    </group>
  )
}

/* ---------- Pipes ---------- */

const UP = new THREE.Vector3(0, 1, 0)
const pipeRadius = { trunk: 0.075, branch: 0.06, main: 0.038, service: 0.015 } as const

function segmentMatrix(a: THREE.Vector3, b: THREE.Vector3, r: number) {
  const dir = b.clone().sub(a)
  const len = dir.length()
  const q = new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize())
  return new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(r, len, r))
}

const unitCylinder = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true)

function Pipes() {
  const tubes = useMemo(() => flowSegments.map((s) => segmentMatrix(s.a, s.b, pipeRadius[s.kind])), [])
  const lines = useMemo(() => {
    const pts: number[] = []
    for (const s of network.segments) pts.push(s.a.x, s.a.y, s.a.z, s.b.x, s.b.y, s.b.z)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    return g
  }, [])
  const tubeMat = useHoloMesh({ color: theme.holo.blue, intensity: 0.9, opacity: 0.5, rim: 1.4, scan: 0.5 })
  const lineMat = useHoloLine({ color: theme.holo.blue, intensity: 1.5, opacity: 0.8, scan: 0.3 })
  return (
    <group>
      <Instanced geometry={unitCylinder} material={tubeMat} matrices={tubes} />
      <lineSegments geometry={lines} material={lineMat} />
    </group>
  )
}

/** Amber overlay on the leaking segment, only while the alert is live. */
function LeakSegment() {
  const seg = useWater((s) => s.current.segment)
  const ref = useRef<THREE.Mesh>(null)
  const mat = useHoloMesh({ color: theme.alert.amber, intensity: 2, opacity: 0.8, rim: 1, scan: 0.2 })
  const matrix = useMemo(() => {
    const s = network.segments[seg]
    return segmentMatrix(s.a, s.b, 0.06)
  }, [seg])
  useLayoutEffect(() => {
    const m = ref.current
    if (!m) return
    matrix.decompose(m.position, m.quaternion, m.scale)
  }, [matrix])
  useFrame(({ clock }) => {
    const f = readFrame()
    const m = ref.current
    if (!m) return
    // Only the localised segment lights, once the pressure dip has found it.
    const lit = f.phase === 'detect' ? smooth(0.55, 0.85, f.u) : f.phase === 'approve' ? 1 : f.phase === 'write' ? f.alert : 0
    m.visible = lit > 0.01
    setHoloColor(mat, theme.alert.amber, lit * (1.6 + 0.8 * Math.sin(clock.elapsedTime * 6)))
  })
  return <mesh ref={ref} geometry={unitCylinder} material={mat} visible={false} />
}

/* ---------- Meters ---------- */

const brandGeoms = [new THREE.BoxGeometry(0.15, 0.15, 0.15), new THREE.CylinderGeometry(0.085, 0.085, 0.16, 14), new THREE.OctahedronGeometry(0.11, 0)]
const brandColors = [theme.holo.cyan, theme.holo.ice, theme.holo.blue]

function ConsumerMeters() {
  const mats = [
    useHoloMesh({ color: brandColors[0], intensity: 1.8, opacity: 0.85, rim: 1, scan: 0 }),
    useHoloMesh({ color: brandColors[1], intensity: 1.5, opacity: 0.85, rim: 1, scan: 0 }),
    useHoloMesh({ color: brandColors[2], intensity: 2.4, opacity: 0.9, rim: 1, scan: 0 }),
  ]
  const byBrand = useMemo(
    () => [0, 1, 2].map((b) => network.meters.filter((m) => m.brand === b).map((m) => new THREE.Matrix4().setPosition(m.pos))),
    [],
  )
  return (
    <group>
      {byBrand.map((mats4, b) => (
        <Instanced key={b} geometry={brandGeoms[b]} material={mats[b]} matrices={mats4} />
      ))}
    </group>
  )
}

function InletMeters() {
  return (
    <>
      {Array.from({ length: DMA_COUNT }, (_, d) => (
        <InletMeter key={d} d={d} />
      ))}
    </>
  )
}

function InletMeter({ d }: { d: number }) {
  const p = inletPos(d)
  const body = useHoloMesh({ color: theme.holo.cyan, intensity: 1.6, opacity: 0.8, rim: 1.2, scan: 0 })
  const ring = useHoloLine({ color: theme.holo.cyan, intensity: 2, opacity: 0.9 })
  const ringRef = useRef<THREE.LineSegments>(null)
  useFrame(({ clock }) => {
    const f = readFrame()
    let k = 0
    if (f.phase === 'balance') k = smooth(1.0, 0, Math.abs(sweepX(f.u) - DMA_CX[d]))
    const isLeak = useWater.getState().current.dma === d
    if (isLeak && f.phase === 'detect') k = Math.max(k, smooth(0.05, 0.3, f.u) * (1 - smooth(0.5, 0.8, f.u)))
    setHoloColor(body, theme.holo.cyan, 1.6 + k * 2.4)
    if (ringRef.current) {
      const s = 0.26 + ((clock.elapsedTime * 0.6 + d * 0.33) % 1) * 0.3
      ringRef.current.scale.setScalar(s)
      setHoloColor(ring, theme.holo.cyan, 2 * (1 - (s - 0.26) / 0.3) + k)
    }
  })
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    const c = useWater.getState().current
    if (c.dma === d) inspectRecord('IES record · inlet meter', c.headline, c.inlet)
  }
  return (
    <group position={p}>
      <mesh material={body} rotation-x={Math.PI / 2} onClick={onClick}>
        <cylinderGeometry args={[0.13, 0.13, 0.34, 16]} />
      </mesh>
      <mesh material={body} position-y={0.17}>
        <boxGeometry args={[0.16, 0.12, 0.16]} />
      </mesh>
      <lineSegments ref={ringRef} geometry={unitCircle} material={ring} position-y={-0.04} />
      <HoloText position={[0, 1.0, 0]} fontSize={0.27} variant="hudBold" glow={1.7} billboard>
        {dmaLabel(d)}
      </HoloText>
      <HoloText position={[0, 0.7, 0]} fontSize={0.13} variant="mono" color={theme.holo.ice} glow={1.2} opacity={0.8} billboard>
        bulk inlet meter
      </HoloText>
    </group>
  )
}

function PressureLoggers() {
  return (
    <>
      {network.loggers.map((_, i) => (
        <Logger key={i} i={i} />
      ))}
    </>
  )
}

const LOGGER_H = 0.5

function Logger({ i }: { i: number }) {
  const l = network.loggers[i]
  const bar = useRef<THREE.Mesh>(null)
  const head = useRef<THREE.Mesh>(null)
  const mat = useHoloMesh({ color: theme.holo.ice, intensity: 1.2, opacity: 0.7, rim: 0.8, scan: 0 })
  useFrame(() => {
    const f = readFrame()
    const c = useWater.getState().current
    let dip = 0
    if (l.dma === c.dma) {
      const k = f.phase === 'detect' ? smooth(0.35, 0.75, f.u) : f.phase === 'approve' ? 1 : f.phase === 'write' ? 1 - smooth(0.2, 1, f.u) : 0
      dip = k * (l.street === c.street ? 0.62 : 0.18)
    }
    const h = LOGGER_H * (1 - dip)
    if (bar.current) {
      bar.current.scale.y = h
      bar.current.position.y = h / 2
    }
    if (head.current) head.current.position.y = h + 0.05
    const amber = dip > 0.3
    setHoloColor(mat, amber ? theme.alert.amber : theme.holo.ice, amber ? 2.4 : 1.2)
  })
  return (
    <group position={[l.pos.x, 0, l.pos.z]}>
      <mesh ref={bar} material={mat}>
        <boxGeometry args={[0.035, 1, 0.035]} />
      </mesh>
      <mesh ref={head} material={mat}>
        <tetrahedronGeometry args={[0.07, 0]} />
      </mesh>
    </group>
  )
}

/* ---------- Flow particles ---------- */

const SPRAY = 150
const SPRAY_LIFE = 1.15
const flowSpeed = { trunk: 1.5, branch: 1.15, main: 0.7, service: 0.4 } as const
const flowDensity = { trunk: 3.2, branch: 3.4, main: 3.0, service: 0 } as const

function FlowParticles() {
  const data = useMemo(() => {
    const seg: number[] = []
    const u: number[] = []
    flowSegments.forEach((s, si) => {
      const n = Math.max(2, Math.round(s.len * flowDensity[s.kind]))
      for (let k = 0; k < n; k++) {
        seg.push(si)
        u.push((k + Math.random() * 0.6) / n)
      }
    })
    const flowN = seg.length
    const total = flowN + SPRAY
    const positions = new Float32Array(total * 3)
    const colors = new Float32Array(total * 3)
    const sizes = new Float32Array(total)
    const base = new THREE.Color()
    for (let i = 0; i < flowN; i++) {
      const kind = flowSegments[seg[i]].kind
      if (kind === 'trunk') base.set(theme.holo.ice).multiplyScalar(3)
      else base.set(theme.holo.cyan).multiplyScalar(kind === 'branch' ? 3 : 2.6)
      colors.set([base.r, base.g, base.b], i * 3)
      sizes[i] = kind === 'main' ? 13 : 16
    }
    // Spray: random launch per particle, reused every life.
    const spray = new Float32Array(SPRAY * 4)
    for (let j = 0; j < SPRAY; j++) {
      spray[j * 4] = Math.random() * Math.PI * 2
      spray[j * 4 + 1] = 0.2 + Math.random() * 0.6
      spray[j * 4 + 2] = 1.2 + Math.random() * 1.1
      spray[j * 4 + 3] = (j / SPRAY) * SPRAY_LIFE
      sizes[flowN + j] = 9 + Math.random() * 5
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage))
    g.setAttribute('aColor', new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage))
    g.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(CENTER_X, 0, 0), 30)
    return { seg: Uint16Array.from(seg), u: Float32Array.from(u), flowN, positions, colors, spray, geometry: g, speed: new Float32Array(flowSegments.length) }
  }, [])
  const mat = useMemo(() => holoPointsMaterial({ color: theme.holo.cyan, intensity: 2, size: 7 }), [])
  useEffect(() => () => mat.dispose(), [mat])
  const amber = useMemo(() => new THREE.Color(theme.alert.amber), [])
  const leakAt = useMemo(() => new THREE.Vector3(), [])

  useFrame(({ clock }, delta) => {
    const dt = Math.min(delta, 0.1)
    const f = readFrame()
    const c = useWater.getState().current
    const { seg, u, flowN, positions, colors, spray, speed } = data
    // Speed per segment follows its flow.
    for (let si = 0; si < flowSegments.length; si++) {
      const s = flowSegments[si]
      let ratio = 0
      for (const d of s.carries) ratio += inflowRatio(d, c, f.leak)
      ratio /= s.carries.length
      speed[si] = (flowSpeed[s.kind] * (1 + (ratio - 1) * 2.5)) / s.len
    }
    for (let i = 0; i < flowN; i++) {
      const si = seg[i]
      let p = u[i] + speed[si] * dt
      if (p >= 1) p -= 1
      u[i] = p
      const s = flowSegments[si]
      positions[i * 3] = s.a.x + (s.b.x - s.a.x) * p
      positions[i * 3 + 1] = s.a.y + (s.b.y - s.a.y) * p + 0.03
      positions[i * 3 + 2] = s.a.z + (s.b.z - s.a.z) * p
    }
    // Leak spray: water escaping the pipe, amber only for the alert.
    leakPoint(c.segment, leakAt)
    const t = clock.elapsedTime
    for (let j = 0; j < SPRAY; j++) {
      const o = (flowN + j) * 3
      const a = spray[j * 4]
      const hs = spray[j * 4 + 1]
      const vs = spray[j * 4 + 2]
      const age = (t + spray[j * 4 + 3]) % SPRAY_LIFE
      const y = Math.max(0.02, PIPE_Y + vs * age - 2.6 * age * age)
      positions[o] = leakAt.x + Math.cos(a) * hs * age
      positions[o + 1] = y
      positions[o + 2] = leakAt.z + Math.sin(a) * hs * age
      const k = f.spray * (1 - age / SPRAY_LIFE) * 2.6 + 1e-4
      colors[o] = amber.r * k
      colors[o + 1] = amber.g * k
      colors[o + 2] = amber.b * k
    }
    data.geometry.attributes.position.needsUpdate = true
    data.geometry.attributes.aColor.needsUpdate = true
  })

  return <points geometry={data.geometry} material={mat} frustumCulled={false} />
}

/* ---------- Balance sweep ---------- */

const SWEEP_X0 = DMA_CX[0] - DMA_HALF_W - 0.6
const SWEEP_X1 = DMA_CX[2] + DMA_HALF_W + 0.6
function sweepX(u: number) {
  return SWEEP_X0 + (SWEEP_X1 - SWEEP_X0) * smooth(0.05, 0.95, u)
}

function BalanceSweep() {
  const ref = useRef<THREE.Group>(null)
  const wall = useHoloMesh({ color: theme.holo.cyan, intensity: 1.4, opacity: 0.22, rim: 0, scan: 1 })
  const edge = useHoloLine({ color: theme.holo.cyan, intensity: 3, opacity: 1 })
  const edgeGeom = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.02, BOUND_Z0, 0, 0.02, DMA_Z1, 0, 1.1, BOUND_Z0, 0, 1.1, DMA_Z1], 3))
    return g
  }, [])
  useFrame(() => {
    const f = readFrame()
    const g = ref.current
    if (!g) return
    g.visible = f.phase === 'balance'
    if (!g.visible) return
    g.position.x = sweepX(f.u)
    const fade = smooth(0, 0.08, f.u) * (1 - smooth(0.92, 1, f.u))
    setHoloColor(wall, theme.holo.cyan, 1.4 * fade)
    setHoloColor(edge, theme.holo.cyan, 3 * fade)
  })
  return (
    <group ref={ref} visible={false}>
      <mesh position={[0, 0.55, (BOUND_Z0 + DMA_Z1) / 2]} rotation-y={Math.PI / 2} material={wall}>
        <planeGeometry args={[DMA_Z1 - BOUND_Z0, 1.1]} />
      </mesh>
      <lineSegments geometry={edgeGeom} material={edge} />
    </group>
  )
}

/* ---------- Detection ---------- */

const LINEAGE_STEPS = 32

function lineGeometry(from: THREE.Vector3, to: THREE.Vector3, lift: number) {
  const pts: number[] = []
  const mid = from.clone().add(to).multiplyScalar(0.5)
  mid.y += lift
  const curve = new THREE.QuadraticBezierCurve3(from, mid, to)
  const p = curve.getPoints(LINEAGE_STEPS)
  for (let k = 0; k < LINEAGE_STEPS; k++) pts.push(p[k].x, p[k].y, p[k].z, p[k + 1].x, p[k + 1].y, p[k + 1].z)
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
  return g
}

function Detection() {
  const c = useWater((s) => s.current)
  const leak = useMemo(() => leakPoint(c.segment), [c.segment])
  const marker = useMemo(() => leak.clone().setY(MARKER_Y), [leak])
  const logger = network.loggers.find((l) => l.dma === c.dma && l.street === c.street)!
  const lineage = useMemo(
    () => [
      lineGeometry(inletPos(c.dma).setY(0.3), marker, 0.6),
      lineGeometry(new THREE.Vector3(DMA_CX[c.dma] + (c.side ? -1 : 1) * 1.0, 0.2, 1.4), marker, 0.6),
      lineGeometry(logger.pos.clone().setY(LOGGER_H), marker, 0.3),
    ],
    [c.dma, c.side, marker, logger],
  )
  useEffect(() => () => lineage.forEach((g) => g.dispose()), [lineage])

  const group = useRef<THREE.Group>(null)
  const core = useRef<THREE.Mesh>(null)
  const loc = useRef<THREE.LineSegments>(null)
  const ripples = [useRef<THREE.LineSegments>(null), useRef<THREE.LineSegments>(null)]
  const coreMat = useHoloMesh({ color: theme.alert.amber, intensity: 2.6, opacity: 0.9, rim: 1.6, scan: 0 })
  const lineMat = useHoloLine({ color: theme.alert.amber, intensity: 1.8, opacity: 0.9, scan: 0.2 })
  const locMat = useHoloLine({ color: theme.alert.amber, intensity: 2.4, opacity: 1, scan: 0 })
  const rippleMats = [
    useHoloLine({ color: theme.alert.amber, intensity: 2, opacity: 1, scan: 0 }),
    useHoloLine({ color: theme.alert.amber, intensity: 2, opacity: 1, scan: 0 }),
  ]
  const labels = useRef<THREE.Group>(null)
  const leakLabel = useRef<THREE.Group>(null)

  useFrame(({ clock }) => {
    const f = readFrame()
    const t = clock.elapsedTime
    // Marker: from early detect until the packet leaves in write.
    const show = f.phase === 'detect' ? smooth(0.0, 0.2, f.u) : f.phase === 'approve' ? 1 : f.phase === 'write' ? 1 - smooth(0.0, 0.12, f.u) : 0
    if (group.current) group.current.visible = show > 0.01
    if (core.current) {
      core.current.scale.setScalar(Math.max(0.001, show) * (1 + Math.sin(t * 5) * 0.1))
      core.current.rotation.y += 0.03
    }
    setHoloColor(coreMat, theme.alert.amber, 2.6 + Math.sin(t * 6) * 0.6)
    // Lineage lines draw in during detect.
    const draw = f.phase === 'detect' ? smooth(0.05, 0.4, f.u) : show > 0.01 ? 1 : 0
    const count = Math.floor(draw * LINEAGE_STEPS) * 2
    for (const g of lineage) g.setDrawRange(0, count)
    setHoloColor(lineMat, theme.alert.amber, 1.4 * show)
    if (labels.current) labels.current.visible = show > 0.5
    // Localisation ring shrinks onto the segment once the pressure dip is in.
    const locK = f.phase === 'detect' ? smooth(0.5, 0.85, f.u) : f.phase === 'approve' ? 1 : f.phase === 'write' ? 1 : 0
    if (loc.current) {
      loc.current.visible = (f.phase === 'detect' && f.u > 0.45) || f.phase === 'approve' || (f.phase === 'write' && f.alert > 0.05)
      loc.current.scale.setScalar(THREE.MathUtils.lerp(2.6, 0.42, locK) * (1 + Math.sin(t * 4) * 0.04 * locK))
      setHoloColor(locMat, theme.alert.amber, 2.6 * (f.phase === 'write' ? f.alert : 1))
    }
    if (leakLabel.current) leakLabel.current.visible = locK > 0.9 && f.alert > 0.3
    // Ground ripples where water escapes.
    for (let k = 0; k < ripples.length; k++) {
      const m = ripples[k].current
      if (!m) continue
      const ph = (t * 0.9 + k * 0.5) % 1
      m.visible = f.spray > 0.02
      m.scale.setScalar(0.12 + ph * 0.75)
      setHoloColor(rippleMats[k], theme.alert.amber, 2.2 * (1 - ph) * f.spray)
    }
  })

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    const s = useWater.getState().current
    inspectRecord('IES record · detection', s.headline, s.detection)
  }

  return (
    <>
      <group position={[leak.x, 0.03, leak.z]}>
        <lineSegments ref={ripples[0]} geometry={unitCircle} material={rippleMats[0]} visible={false} />
        <lineSegments ref={ripples[1]} geometry={unitCircle} material={rippleMats[1]} visible={false} />
        <lineSegments ref={loc} geometry={unitCircle} material={locMat} visible={false} />
        <group ref={leakLabel} visible={false}>
          <Callout position={[0, 0.15, 1.15]} width={3.0} height={0.4} tone={theme.alert.amber}>
            <HoloText fontSize={0.17} variant="mono" color={theme.alert.amber} glow={1.6} renderOrder={22}>
              {`${c.segmentRef} · pressure dip ${c.pressureDropM.toFixed(1)} m`}
            </HoloText>
          </Callout>
        </group>
      </group>
      <group ref={group} visible={false}>
        {lineage.map((g, k) => (
          <lineSegments key={k} geometry={g} material={lineMat} />
        ))}
        <group position={marker}>
          <mesh
            ref={core}
            material={coreMat}
            onClick={onClick}
            onPointerOver={() => setCursor(true)}
            onPointerOut={() => setCursor(false)}
          >
            <octahedronGeometry args={[0.24, 0]} />
          </mesh>
          <group ref={labels}>
            <Callout position={[0, 0, 0]} offsetX={0.4} width={2.5} height={0.8} tone={theme.alert.amber}>
              <HoloText position={[-1.1, 0.14, 0]} anchorX="left" fontSize={0.28} variant="hudBold" color={theme.alert.amber} glow={1.8} renderOrder={22}>
                NRW ANOMALY
              </HoloText>
              <HoloText position={[-1.1, -0.16, 0]} anchorX="left" fontSize={0.14} variant="mono" color={theme.holo.ice} glow={1.3} renderOrder={22}>
                {`IES detection · conf ${c.confidence.toFixed(2)}`}
              </HoloText>
            </Callout>
          </group>
        </group>
      </group>
    </>
  )
}

/* ---------- Callout ---------- */

/** Dark backing plate. Normal blending so labels stay readable over the network; fades with the reveal. */
function usePlateMaterial() {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uReveal: holoUniforms.uReveal, uColor: { value: new THREE.Color(theme.background) }, uOpacity: { value: 0.9 } },
        vertexShader: /* glsl */ `void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform float uReveal;
          uniform vec3 uColor;
          uniform float uOpacity;
          void main() { gl_FragColor = vec4(uColor, uOpacity * uReveal); }
        `,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        toneMapped: false,
      }),
    [],
  )
  useEffect(() => () => mat.dispose(), [mat])
  return mat
}

/** Screen-facing label card: dark plate, thin frame, text on top. */
function Callout({
  position,
  offsetX = 0,
  width,
  height,
  tone,
  children,
}: {
  position: [number, number, number]
  /** Screen-space offset of the card's left edge from the anchor. 0 centres the card. */
  offsetX?: number
  width: number
  height: number
  tone: string
  children: ReactNode
}) {
  const plate = usePlateMaterial()
  const frame = useHoloLine({ color: tone, intensity: 1.4, opacity: 0.85, scan: 0 }, [tone])
  const frameGeom = useMemo(() => new THREE.EdgesGeometry(new THREE.PlaneGeometry(width, height)), [width, height])
  const plateGeom = useMemo(() => new THREE.PlaneGeometry(width, height), [width, height])
  return (
    <group position={position}>
      <Billboard>
        <group position-x={offsetX ? offsetX + width / 2 : 0}>
          <mesh geometry={plateGeom} material={plate} renderOrder={20} />
          <lineSegments geometry={frameGeom} material={frame} renderOrder={21} />
          {children}
        </group>
      </Billboard>
    </group>
  )
}

/* ---------- Water Ledger ---------- */

function LedgerChain() {
  const entries = useWater((s) => s.entries)
  const visible = entries.slice(-LEDGER_VISIBLE)
  const link = useHoloLine({ color: theme.holo.cyan, intensity: 1.8, opacity: 0.9 })
  const linkGeom = useMemo(() => {
    const a = ledgerSlot(0)
    const b = ledgerSlot(LEDGER_VISIBLE - 1)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute([a.x - 0.9, a.y, a.z, b.x, b.y, b.z], 3))
    return g
  }, [])
  const left = ledgerSlot(0)
  return (
    <group>
      <lineSegments geometry={linkGeom} material={link} />
      {visible.map((e, k) => (
        <LedgerBlockMesh key={e.block.seq} entry={e} slot={k + LEDGER_VISIBLE - visible.length} isNewest={k === visible.length - 1} />
      ))}
      <HoloText position={[left.x - 0.5, LEDGER_Y + 1.6, LEDGER_Z]} anchorX="left" fontSize={0.32} variant="hudBold" glow={1.8}>
        WATER LEDGER
      </HoloText>
      <HoloText position={[left.x - 0.5, LEDGER_Y + 1.22, LEDGER_Z]} anchorX="left" fontSize={0.16} variant="mono" color={theme.holo.ice} glow={1.2} opacity={0.8}>
        hash-linked · Ed25519-signed · anchored daily · click a block
      </HoloText>
      <HoloText position={[left.x + LEDGER_SPACING * (LEDGER_VISIBLE - 1) + 0.85, LEDGER_Y, LEDGER_Z]} anchorX="left" fontSize={0.18} variant="mono" color={theme.holo.ice} glow={1.2} opacity={0.8}>
        HEAD
      </HoloText>
    </group>
  )
}

const blockTone = {
  'verified-loss': { body: theme.holo.blue, edge: theme.holo.cyan },
  rejection: { body: theme.alert.amber, edge: theme.alert.amber },
  'field-check': { body: theme.holo.dim, edge: theme.holo.ice },
} as const

const blockEdges = new THREE.EdgesGeometry(new THREE.BoxGeometry(0.9, 0.9, 0.9))
const blockBox = new THREE.BoxGeometry(0.9, 0.9, 0.9)

function LedgerBlockMesh({ entry, slot, isNewest }: { entry: LedgerEntry; slot: number; isNewest: boolean }) {
  const ref = useRef<THREE.Group>(null)
  const type = entry.payload.type
  const tone = blockTone[type]
  const body = useHoloMesh({ color: tone.body, intensity: type === 'rejection' ? 1.1 : 1.4, opacity: 0.5, rim: 1 }, [type])
  const edgeMat = useHoloLine({ color: tone.edge, intensity: 2.2 }, [type])
  const target = useMemo(() => ledgerSlot(slot), [slot])
  // Where the block mounts: in place if it is the new head, else one slot to the right so it slides left.
  const [start] = useState(() => (isNewest ? ledgerSlot(slot) : ledgerSlot(slot + 1)))
  const hovered = useRef(false)

  useFrame((_, dt) => {
    const g = ref.current
    if (!g) return
    g.position.lerp(target, Math.min(1, dt * 4))
    const { phase } = useWater.getState()
    const waiting = isNewest && phase === 'write' && phaseU(phase) < BLOCK_APPEAR_U
    const s = waiting ? 0.001 : hovered.current ? 1.15 : 1
    g.scale.setScalar(THREE.MathUtils.lerp(g.scale.x, s, 0.18))
    g.rotation.y += dt * 0.25
  })

  return (
    <group
      ref={ref}
      position={start}
      scale={isNewest ? 0.001 : 1}
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
      <mesh geometry={blockBox} material={body} />
      <lineSegments geometry={blockEdges} material={edgeMat} />
      <HoloText position={[0, 0.82, 0]} fontSize={0.2} variant="mono" glow={1.6} billboard>
        {`#${entry.block.seq}`}
      </HoloText>
      <HoloText position={[0, -0.92, 0]} fontSize={0.12} variant="mono" color={theme.holo.ice} glow={1.1} opacity={0.75} billboard>
        {entry.block.hash.slice(0, 10)}
      </HoloText>
      <HoloText position={[0, -1.12, 0]} fontSize={0.11} variant="mono" color={type === 'rejection' ? theme.alert.amber : theme.holo.cyan} glow={1.4} billboard>
        {entryChip[type].label.toLowerCase()}
      </HoloText>
    </group>
  )
}

/* ---------- Packet ---------- */

const pA = new THREE.Vector3()
const pB = new THREE.Vector3()
const pM = new THREE.Vector3()

function Packet() {
  const ref = useRef<THREE.Group>(null)
  const core = useHoloMesh({ color: theme.holo.white, intensity: 4, opacity: 1, rim: 0.5, scan: 0 })
  const halo = useHoloMesh({ color: theme.holo.cyan, intensity: 2.5, opacity: 0.5, rim: 2, scan: 0 })
  const haloRef = useRef<THREE.Mesh>(null)
  useFrame(({ clock }) => {
    const g = ref.current
    if (!g) return
    const { phase, current, decision } = useWater.getState()
    const u = phaseU(phase)
    const on = phase === 'write' && u < BLOCK_APPEAR_U
    g.visible = on
    if (!on) return
    const k = smooth(0, BLOCK_APPEAR_U, u)
    leakPoint(current.segment, pA).setY(MARKER_Y)
    ledgerSlot(LEDGER_VISIBLE - 1, pB)
    pM.copy(pA).add(pB).multiplyScalar(0.5)
    pM.y += 2.4
    const iu = 1 - k
    g.position.set(0, 0, 0).addScaledVector(pA, iu * iu).addScaledVector(pM, 2 * iu * k).addScaledVector(pB, k * k)
    const tone = decision?.action === 'reject' ? theme.alert.amber : decision?.action === 'modify' ? theme.holo.ice : theme.holo.white
    setHoloColor(core, tone, 4)
    setHoloColor(halo, decision?.action === 'reject' ? theme.alert.amber : theme.holo.cyan, 2.5)
    if (haloRef.current) haloRef.current.scale.setScalar(1 + Math.sin(clock.elapsedTime * 6) * 0.15)
  })
  return (
    <group ref={ref} visible={false}>
      <mesh material={core}>
        <sphereGeometry args={[0.16, 20, 20]} />
      </mesh>
      <mesh ref={haloRef} material={halo}>
        <sphereGeometry args={[0.34, 20, 20]} />
      </mesh>
    </group>
  )
}

