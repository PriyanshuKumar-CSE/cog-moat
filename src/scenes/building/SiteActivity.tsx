import { useFrame } from '@react-three/fiber'
import { useMemo, useRef, type ReactNode } from 'react'
import * as THREE from 'three'
import { theme } from '../../config/theme'
import { HoloText } from '../../holo/HoloText'
import { useHoloLine, useHoloMesh } from '../../holo/hooks'
import { setHoloColor } from '../../holo/materials'
import { useBuilding } from './buildingStore'
import {
  ARRIVE_AT,
  PPE_AT,
  PPE_FOR,
  TRUCKS,
  headcount,
  isWorking,
  machineHours,
  machineState,
  productiveShare,
  sitePlan,
  truckId,
  truckPhase,
  useControl,
  type MachineState,
} from './control'
import { CRANE_BASE, CRANE_H, HALF_X, HALF_Z, ROOF_Y, SLAB, levelY } from './layout'
import { MONITORING, stageIndex } from './stages'

/**
 * Site life for project control: crews, machines and trucks, tagged with what
 * Vision AI measures. The actors are always on site; their tags show only in
 * the Project control lens, where the quality overlays step aside.
 */

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** Lens weight, eased: 0 in Quality, 1 in Project control. */
const lensK = { v: 0 }

export function SiteActivity() {
  useFrame(() => {
    const target = useControl.getState().lens === 'control' ? 1 : 0
    lensK.v = THREE.MathUtils.lerp(lensK.v, target, 0.12)
  })
  return (
    <>
      <Crews />
      <Excavator />
      <Hoist />
      <Gondola />
      <Trucks />
      <GateCamera />
      <CraneTag />
    </>
  )
}

/** Re-renders on a coarse site clock, for tag text. */
function useSiteMinute(step = 5) {
  return useControl((s) => Math.floor(s.minute / step) * step)
}

/** A billboard tag that fades in with the Project control lens. */
function Tag({ position, title, sub, tone, children }: { position: [number, number, number]; title: string; sub?: string; tone?: 'warn'; children?: ReactNode }) {
  const ref = useRef<THREE.Group>(null)
  useFrame(() => {
    const g = ref.current
    if (!g) return
    const k = Math.max(0.001, lensK.v)
    g.scale.setScalar(k)
    g.visible = lensK.v > 0.02
  })
  const color = tone === 'warn' ? theme.alert.amber : theme.holo.white
  return (
    <group ref={ref} position={position} visible={false}>
      <HoloText fontSize={0.2} variant="hudBold" color={color} glow={1.6} billboard>
        {title}
      </HoloText>
      {sub && (
        <HoloText position={[0, -0.25, 0]} fontSize={0.15} variant="mono" color={tone === 'warn' ? theme.alert.amber : theme.holo.ice} glow={1.2} billboard>
          {sub}
        </HoloText>
      )}
      {children}
    </group>
  )
}

const stateWord: Record<MachineState, string> = { working: 'working', idle: 'idle, engine on', parked: 'parked' }

/* ------------------------------------------------------------------ */
/* Crews                                                               */
/* ------------------------------------------------------------------ */

const MAX_PER_CREW = 9
const PERSON_H = 0.34

/** Where crew `k` works during a stage: [x, y, z] of the cluster centre and its spread in x. */
function crewSpot(k: number): { at: [number, number, number]; spread: number } {
  const id = useBuilding.getState().current.stage.id
  // The second crew works on the ground at the front right, or in the back of the pit while it is open.
  if (k === 1) return id === 'excavation' ? { at: [-1.6, -1.3, -1.2], spread: 1.6 } : { at: [3.2, 0, 3.0], spread: 1.4 }
  switch (id) {
    case 'excavation':
      return { at: [-1.2, -1.3, 1.5], spread: 2.4 }
    case 'foundation':
      return { at: [-0.8, -1.0 + SLAB, 1.3], spread: 2.6 }
    case 'frame':
      return { at: [-0.4, ROOF_Y + SLAB / 2, 1.2], spread: 3.2 }
    case 'paint':
      return { at: [-0.6, levelY(3) + 0.12, HALF_Z + 0.42], spread: 1.2 }
    default:
      return { at: [-0.6, levelY(2) + SLAB / 2, 1.2], spread: 3.2 }
  }
}

function Crews() {
  const minute = useSiteMinute(10)
  const day = useControl((s) => s.day)
  const stage = useBuilding((s) => s.stage)
  const plan = sitePlan(stage)
  if (!plan) return null
  const counts = headcount(stage, minute, day).byCrew
  const share = productiveShare(stage, minute, day).byCrew
  const ppe = minute >= PPE_AT && minute < PPE_AT + PPE_FOR
  return (
    <>
      {plan.crews.map((c, k) => {
        const spot = crewSpot(k)
        const working = Math.round((share[k] ?? 0) * counts[k])
        return (
          <group key={`${stage}-${k}`}>
            <CrewFigures stage={stage} k={k} at={spot.at} spread={spot.spread} ppe={k === 0 && ppe} />
            <Tag
              // The work-front crew is tagged beside its cluster, clear of the milestone title above the roof.
              position={k === 0 ? [spot.at[0] + spot.spread / 2 + 1.0, spot.at[1] + PERSON_H + 0.25, spot.at[2]] : [spot.at[0], spot.at[1] + PERSON_H + 0.75, spot.at[2]]}
              title={`${c.name.toUpperCase()} CREW`}
              sub={counts[k] ? `${working} of ${counts[k]} working` : 'off site'}
            />
            {k === 0 && ppe && <Tag position={[spot.at[0] - spot.spread / 2 - 0.55, spot.at[1] + PERSON_H + 0.12, spot.at[2] + 0.2]} title="NO HELMET" tone="warn" />}
          </group>
        )
      })}
    </>
  )
}

function CrewFigures({ stage, k, at, spread, ppe }: { stage: number; k: number; at: [number, number, number]; spread: number; ppe: boolean }) {
  const refs = useRef<(THREE.Group | null)[]>([])
  const work = useHoloMesh({ color: theme.holo.cyan, intensity: 1.6, opacity: 0.85, rim: 1 })
  const idle = useHoloMesh({ color: theme.holo.blue, intensity: 0.7, opacity: 0.45, rim: 1 })
  const alert = useHoloMesh({ color: theme.alert.amber, intensity: 2, opacity: 0.95, rim: 1 })
  // Fixed places in the cluster: two loose rows.
  const places = useMemo(
    () =>
      Array.from({ length: MAX_PER_CREW }, (_, i) => {
        const row = i % 2
        const col = Math.floor(i / 2)
        const x = -spread / 2 + (col / Math.max(1, Math.ceil(MAX_PER_CREW / 2) - 1)) * spread + (row ? 0.18 : 0)
        return new THREE.Vector3(x, 0, row ? -0.28 : 0.05)
      }),
    [spread],
  )

  useFrame(({ clock }) => {
    const { minute, day } = useControl.getState()
    const count = Math.min(MAX_PER_CREW, headcount(stage, minute, day).byCrew[k] ?? 0)
    const dim = 0.55 + 0.45 * lensK.v
    setHoloColor(work, theme.holo.cyan, 1.6 * dim)
    setHoloColor(idle, theme.holo.blue, 0.7 * dim)
    refs.current.forEach((g, i) => {
      if (!g) return
      g.visible = i < count
      if (!g.visible) return
      const on = isWorking(stage, k, i, minute, day)
      const mat = ppe && i === 0 ? alert : on ? work : idle
      for (const child of g.children) (child as THREE.Mesh).material = mat
      // Working figures bend to the job; idle ones stand still.
      g.rotation.x = on ? 0.18 + Math.sin(clock.elapsedTime * 3 + i * 1.7) * 0.16 : 0
      g.position.copy(places[i])
    })
  })

  return (
    <group position={at}>
      {places.map((_, i) => (
        <group key={i} ref={(g) => void (refs.current[i] = g)}>
          <mesh position={[0, PERSON_H * 0.4, 0]} material={work}>
            <boxGeometry args={[0.07, PERSON_H * 0.8, 0.05]} />
          </mesh>
          <mesh position={[0, PERSON_H * 0.92, 0]} material={work}>
            <sphereGeometry args={[0.045, 10, 8]} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Machines                                                            */
/* ------------------------------------------------------------------ */

function useMachineTag(stage: number) {
  const minute = useSiteMinute()
  const day = useControl((s) => s.day)
  const st = machineState(stage, minute, day)
  const h = machineHours(stage, minute, day)
  return { st, sub: `${h.working.toFixed(1)} h working today`, warn: st === 'idle' }
}

/** Excavator at the pit edge during excavation; the boom digs while it works. */
function Excavator() {
  const stage = useBuilding((s) => s.stage)
  const on = stage === stageIndex('excavation')
  const root = useRef<THREE.Group>(null)
  const boom = useRef<THREE.Group>(null)
  const arm = useRef<THREE.Group>(null)
  const body = useHoloMesh({ color: theme.holo.blue, intensity: 1.3, opacity: 0.55, rim: 1 })
  const edge = useHoloLine({ color: theme.holo.cyan, intensity: 1.8, opacity: 0.95, scan: 0 })
  const boomGeom = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0.5, -0.9, 0.06, 0, 0, 0.06, 0.5, -0.9], 3))
    return g
  }, [])
  const armGeom = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, -0.8, -0.35, 0, -0.8, -0.35, 0, -0.95, -0.15, 0, -0.95, -0.15, 0, -0.8, -0.05], 3))
    return g
  }, [])
  const tag = useMachineTag(stage)

  useFrame(({ clock }) => {
    const r = root.current
    if (!r) return
    r.visible = on
    if (!on) return
    const { minute, day } = useControl.getState()
    const working = machineState(stage, minute, day) === 'working'
    const t = clock.elapsedTime
    if (boom.current) boom.current.rotation.x = working ? -0.15 + Math.sin(t * 1.3) * 0.22 : 0.25
    if (arm.current) arm.current.rotation.x = working ? Math.sin(t * 1.3 + 1.2) * 0.35 : 0.5
    r.rotation.y = working ? Math.sin(t * 0.4) * 0.35 : 0
  })

  return (
    <group ref={root} position={[2.2, 0, 3.4]}>
      <mesh position={[0, 0.07, 0]} material={body}>
        <boxGeometry args={[0.55, 0.14, 0.7]} />
      </mesh>
      <mesh position={[0.08, 0.27, 0.12]} material={body}>
        <boxGeometry args={[0.42, 0.26, 0.42]} />
      </mesh>
      <group ref={boom} position={[-0.1, 0.3, -0.08]}>
        <lineSegments geometry={boomGeom} material={edge} />
        <group ref={arm} position={[0, 0.5, -0.9]}>
          <lineSegments geometry={armGeom} material={edge} />
        </group>
      </group>
      {on && <Tag position={[0.1, 1.45, 0]} title={`EXCAVATOR · ${stateWord[tag.st].toUpperCase()}`} sub={tag.sub} tone={tag.warn ? 'warn' : undefined} />}
    </group>
  )
}

/** Builder hoist on the right flank of the tower, from plumbing to flooring. The cage rides while it works. */
function Hoist() {
  const stage = useBuilding((s) => s.stage)
  const on = stage >= stageIndex('plumbing') && stage <= stageIndex('flooring')
  const root = useRef<THREE.Group>(null)
  const cage = useRef<THREE.Group>(null)
  const mast = useMemo(() => {
    const pts: number[] = []
    const w = 0.12
    for (const [x, z] of [
      [-w, -w],
      [w, -w],
      [w, w],
      [-w, w],
    ])
      pts.push(x, 0, z, x, ROOF_Y + 0.5, z)
    for (let y = 0; y < ROOF_Y + 0.5; y += 0.45) pts.push(-w, y, -w, w, y + 0.45, w, w, y, -w, -w, y + 0.45, w)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    return g
  }, [])
  const line = useHoloLine({ color: theme.holo.blue, intensity: 1.2, opacity: 0.7, scan: 0.4 })
  const body = useHoloMesh({ color: theme.holo.cyan, intensity: 1.3, opacity: 0.55, rim: 1 })
  const tag = useMachineTag(stage)

  useFrame(({ clock }) => {
    const r = root.current
    if (!r) return
    r.visible = on
    if (!on || !cage.current) return
    const { minute, day } = useControl.getState()
    const working = machineState(stage, minute, day) === 'working'
    const y = working ? (0.5 - 0.5 * Math.cos(clock.elapsedTime * 0.7)) * (ROOF_Y - 0.6) : cage.current.position.y
    cage.current.position.y = THREE.MathUtils.lerp(cage.current.position.y, y, 0.2)
  })

  return (
    <group ref={root} position={[HALF_X + 0.45, 0, 0.9]}>
      <lineSegments geometry={mast} material={line} />
      <group ref={cage}>
        <mesh position={[0.32, 0.2, 0]} material={body}>
          <boxGeometry args={[0.36, 0.38, 0.4]} />
        </mesh>
      </group>
      {on && <Tag position={[0.9, ROOF_Y + 0.75, 0]} title={`HOIST · ${stateWord[tag.st].toUpperCase()}`} sub={tag.sub} tone={tag.warn ? 'warn' : undefined} />}
    </group>
  )
}

/** Facade gondola for paint, hung from the roof on two cables. */
function Gondola() {
  const stage = useBuilding((s) => s.stage)
  const on = stage === stageIndex('paint')
  const root = useRef<THREE.Group>(null)
  const deck = useRef<THREE.Group>(null)
  const cables = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(12), 3))
    return g
  }, [])
  const line = useHoloLine({ color: theme.holo.ice, intensity: 1.2, opacity: 0.8, scan: 0 })
  const body = useHoloMesh({ color: theme.holo.cyan, intensity: 1.3, opacity: 0.55, rim: 1 })
  const tag = useMachineTag(stage)

  useFrame(({ clock }) => {
    const r = root.current
    if (!r) return
    r.visible = on
    if (!on || !deck.current) return
    const { minute, day } = useControl.getState()
    const working = machineState(stage, minute, day) === 'working'
    const target = working ? levelY(1) + (0.5 + 0.5 * Math.sin(clock.elapsedTime * 0.25)) * levelY(4) : deck.current.position.y
    const y = THREE.MathUtils.lerp(deck.current.position.y, target, 0.1)
    deck.current.position.y = y
    const a = cables.getAttribute('position') as THREE.BufferAttribute
    a.setXYZ(0, -0.75, ROOF_Y + 0.2, 0)
    a.setXYZ(1, -0.75, y + 0.1, 0)
    a.setXYZ(2, 0.75, ROOF_Y + 0.2, 0)
    a.setXYZ(3, 0.75, y + 0.1, 0)
    a.needsUpdate = true
  })

  return (
    <group ref={root} position={[-0.6, 0, HALF_Z + 0.42]}>
      <lineSegments geometry={cables} material={line} frustumCulled={false} />
      <group ref={deck} position={[0, levelY(3), 0]}>
        <mesh material={body}>
          <boxGeometry args={[1.7, 0.1, 0.28]} />
        </mesh>
      </group>
      {on && <Tag position={[HALF_X + 1.9, levelY(4), 0]} title={`GONDOLA · ${stateWord[tag.st].toUpperCase()}`} sub={tag.sub} tone={tag.warn ? 'warn' : undefined} />}
    </group>
  )
}

/** Tag for the tower crane while it is the milestone's hired machine. */
function CraneTag() {
  const stage = useBuilding((s) => s.stage)
  const hired = sitePlan(stage)?.hire.machine === 'Tower crane'
  const tag = useMachineTag(stage)
  if (!hired) return null
  return <Tag position={[CRANE_BASE.x + 2.2, CRANE_H + 1.2, CRANE_BASE.z]} title={`TOWER CRANE · ${stateWord[tag.st].toUpperCase()}`} sub={tag.sub} tone={tag.warn ? 'warn' : undefined} />
}

/* ------------------------------------------------------------------ */
/* Trucks and the gate camera                                          */
/* ------------------------------------------------------------------ */

const GATE = new THREE.Vector3(0.4, 0, 5.6)
/** Road in from beyond the gate, through it, then left along the front to the stockyard. */
const ROUTE = [new THREE.Vector3(0.4, 0, 9), GATE.clone(), new THREE.Vector3(0.4, 0, 4.4), new THREE.Vector3(-2.7, 0, 4.4)]
/** Share of the inbound leg spent on each segment, by length. */
const routeCurve = (() => {
  const c = new THREE.CurvePath<THREE.Vector3>()
  for (let i = 0; i < ROUTE.length - 1; i++) c.add(new THREE.LineCurve3(ROUTE[i], ROUTE[i + 1]))
  return c
})()
const UNLOAD_END = 0.6

/** Route position 0..1 (0 = off site, 1 = stockyard) and leg for a trip-loop position. */
function routeAt(u: number): { s: number; leg: 'in' | 'unload' | 'out' } {
  const ease = (x: number) => x * x * (3 - 2 * x)
  if (u < ARRIVE_AT) return { s: ease(u / ARRIVE_AT), leg: 'in' }
  if (u < UNLOAD_END) return { s: 1, leg: 'unload' }
  return { s: 1 - ease((u - UNLOAD_END) / (1 - UNLOAD_END)), leg: 'out' }
}

function Trucks() {
  return (
    <>
      {Array.from({ length: TRUCKS }, (_, j) => (
        <Truck key={j} j={j} />
      ))}
    </>
  )
}

function Truck({ j }: { j: number }) {
  const stage = useBuilding((s) => s.stage)
  const root = useRef<THREE.Group>(null)
  const bed = useRef<THREE.Group>(null)
  const body = useHoloMesh({ color: theme.holo.blue, intensity: 1.3, opacity: 0.55, rim: 1 })
  const cab = useHoloMesh({ color: theme.holo.cyan, intensity: 1.4, opacity: 0.6, rim: 1 })
  const minute = useSiteMinute(2)
  const u = truckPhase(stage, j, minute)
  const leg = u === null ? null : routeAt(u).leg
  const p = useMemo(() => new THREE.Vector3(), [])
  const ahead = useMemo(() => new THREE.Vector3(), [])

  useFrame(() => {
    const r = root.current
    if (!r) return
    const { minute } = useControl.getState()
    const st = useBuilding.getState().stage
    const phase = st === MONITORING ? null : truckPhase(st, j, minute)
    r.visible = phase !== null
    if (phase === null) return
    const { s, leg } = routeAt(phase)
    routeCurve.getPointAt(clamp01(s), p)
    routeCurve.getPointAt(clamp01(s + (leg === 'out' ? -0.01 : 0.01)), ahead)
    r.position.copy(p)
    // Grows in as it enters the site road and shrinks away as it leaves.
    r.scale.setScalar(Math.max(0.001, clamp01(s / 0.1)))
    // Nose along the route; a second truck waits a little behind on the stockyard apron.
    if (ahead.distanceToSquared(p) > 1e-6) r.rotation.y = Math.atan2(ahead.x - p.x, ahead.z - p.z) + (leg === 'out' ? Math.PI : 0)
    if (bed.current) bed.current.rotation.x = leg === 'unload' ? -Math.sin(((phase - ARRIVE_AT) / (UNLOAD_END - ARRIVE_AT)) * Math.PI) * 0.6 : 0
  })

  // Only the inbound leg and unloading are tagged, so the two trucks' tags never stack at the gate.
  const title = leg === 'in' ? 'TRUCK · INBOUND TRIP' : 'TRUCK · UNLOADING'
  return (
    <group ref={root} visible={false}>
      {/* Local +z is forward. */}
      <mesh position={[0, 0.1, 0]} material={body}>
        <boxGeometry args={[0.36, 0.08, 1.3]} />
      </mesh>
      <mesh position={[0, 0.27, 0.48]} material={cab}>
        <boxGeometry args={[0.36, 0.26, 0.3]} />
      </mesh>
      <group ref={bed} position={[0, 0.15, -0.62]}>
        <mesh position={[0, 0.12, 0.42]} material={body}>
          <boxGeometry args={[0.38, 0.22, 0.82]} />
        </mesh>
      </group>
      {(leg === 'in' || leg === 'unload') && <Tag position={[0, 1.05, 0]} title={title} sub={`${truckId(j)} · gate cam photo + time`} />}
    </group>
  )
}

/** Photon camera on the gate post, looking in at the site. Its sight cone brightens in the Project control lens. */
function GateCamera() {
  const frustum = useMemo(() => {
    const o = new THREE.Vector3(0, 0, 0)
    const far = [new THREE.Vector3(-1.6, -0.95, -2.2), new THREE.Vector3(1.2, -0.95, -2.2)]
    const pts = [o, far[0], o, far[1], far[0], far[1]].flatMap((v) => [v.x, v.y, v.z])
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    return g
  }, [])
  const post = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 1.0, 0], 3))
    return g
  }, [])
  const line = useHoloLine({ color: theme.holo.blue, intensity: 1.2, opacity: 0.8, scan: 0 })
  const cone = useHoloLine({ color: theme.holo.cyan, intensity: 1.4, opacity: 0.6, scan: 0 })
  const body = useHoloMesh({ color: theme.holo.cyan, intensity: 1.6, opacity: 0.7, rim: 1 })
  const ref = useRef<THREE.Group>(null)
  useFrame(() => {
    setHoloColor(cone, theme.holo.cyan, 0.3 + 1.2 * lensK.v)
    const g = ref.current
    if (g) g.visible = lensK.v > 0.02
  })
  return (
    <group position={[GATE.x - 1.3, 0, GATE.z]}>
      <lineSegments geometry={post} material={line} />
      <mesh position={[0, 1.0, -0.05]} material={body}>
        <boxGeometry args={[0.16, 0.12, 0.24]} />
      </mesh>
      <group ref={ref} position={[0, 1.0, 0]}>
        <lineSegments geometry={frustum} material={cone} />
      </group>
    </group>
  )
}

