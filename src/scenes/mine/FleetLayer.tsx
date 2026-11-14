import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { theme } from '../../config/theme'
import { useApp } from '../../core/store'
import { HoloText } from '../../holo/HoloText'
import { useHoloMesh } from '../../holo/hooks'
import { holoPointsMaterial, setHoloColor } from '../../holo/materials'
import { iesKeyOrder, verifyIesHash, type IesRecord } from '../../sim/ies'
import { DUMP_SPOT, JUNCTION_D, RIM_Y, routePoint, routeRibbon, routes, routeTangent } from './layout'
import { ALT_TRUCK, REC_TRUCK, fleet, replay, useMine } from './mineStore'

export function setCursor(on: boolean) {
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
      { label: record.lineage ? `Derived via ${record.lineage.method}@${record.lineage.version}` : 'Capture (no lineage)', ok: true },
    ],
  })
}

export function inspectVerifiedTrip() {
  const v = useMine.getState().verified
  if (!v) return
  inspectRecord(`IES record · trip #${v.trip}`, `Haul trip, T${v.truck}. Load, haul and dump line up with payload.`, v.derived)
}

const TRUCKS = 15
const LANE = 0.24
const TRUCK_SCALE = 1.25

/** Shared per-truck world positions, written by the truck layer each frame. */
export const truckPos = new Float32Array(TRUCKS * 3)

function truckGeometry() {
  const parts = [
    new THREE.BoxGeometry(0.66, 0.14, 0.32).translate(0, 0.13, 0),
    new THREE.BoxGeometry(0.17, 0.18, 0.28).translate(0.25, 0.3, 0),
    new THREE.BoxGeometry(0.44, 0.17, 0.34).translate(-0.07, 0.3, 0),
  ]
  const wheels = [-0.2, 0.2].flatMap((x) =>
    [-0.17, 0.17].map((z) => new THREE.CylinderGeometry(0.08, 0.08, 0.06, 10).rotateX(Math.PI / 2).translate(x, 0.08, z)),
  )
  const g = mergeGeometries([...parts, ...wheels].map((p) => p.toNonIndexed()))
  return g
}

const heapGeometry = () => new THREE.BoxGeometry(0.38, 0.14, 0.28).translate(-0.07, 0.07, 0)

const v = {
  p: new THREE.Vector3(),
  t: new THREE.Vector3(),
  f: new THREE.Vector3(),
  r: new THREE.Vector3(),
  u: new THREE.Vector3(),
  up: new THREE.Vector3(0, 1, 0),
  s: new THREE.Vector3(),
  m: new THREE.Matrix4(),
  h: new THREE.Matrix4(),
  hs: new THREE.Matrix4(),
}

export function FleetLayer() {
  return (
    <group>
      <Trucks />
      <TruckTag id={REC_TRUCK} />
      <TruckTag id={ALT_TRUCK} />
      <ProposedRoute />
      <DumpPulse />
      <VerifiedTrip />
    </group>
  )
}

function Trucks() {
  const body = useRef<THREE.InstancedMesh>(null)
  const heap = useRef<THREE.InstancedMesh>(null)
  const geom = useMemo(truckGeometry, [])
  const heapGeom = useMemo(heapGeometry, [])
  const bodyMat = useHoloMesh({ color: theme.holo.blue, intensity: 1.4, opacity: 0.8, rim: 1.4, scan: 0.3 })
  const heapMat = useHoloMesh({ color: theme.holo.ice, intensity: 2.6, opacity: 1, rim: 0.8, scan: 0 })
  // Smoothed heading and lane per truck so turnarounds do not snap.
  const heading = useMemo(() => new Float32Array(TRUCKS * 3), [])
  const lane = useMemo(() => new Float32Array(TRUCKS), [])
  const primed = useRef(false)

  useFrame((_, dt) => {
    const b = body.current
    const hp = heap.current
    if (!b || !hp) return
    const k = primed.current ? 1 - Math.exp(-Math.min(dt, 0.1) * 7) : 1
    primed.current = true
    const fade = replay.fade
    let heaps = 0
    for (const t of fleet.trucks) {
      const r = routes[t.loader]
      routePoint(r, t.d, v.p)
      routeTangent(r, t.d, v.t)
      const backward = t.state === 'haul' || t.state === 'transfer' || t.state === 'dump'
      if (backward) v.t.negate()
      const i = t.slot
      // Ease heading toward the travel direction.
      let hx = heading[i * 3]
      let hy = heading[i * 3 + 1]
      let hz = heading[i * 3 + 2]
      const dot = hx * v.t.x + hz * v.t.z
      if (dot < -0.8) {
        // Turning round: steer through the side, not through zero.
        hx += -v.t.z * 0.6
        hz += v.t.x * 0.6
      }
      hx += (v.t.x - hx) * k
      hy += (v.t.y - hy) * k
      hz += (v.t.z - hz) * k
      heading[i * 3] = hx
      heading[i * 3 + 1] = hy
      heading[i * 3 + 2] = hz
      v.f.set(hx, hy, hz).normalize()
      // Keep left: offset toward the left of travel.
      const targetLane = t.state === 'load' || t.state === 'dump' ? 0 : LANE
      lane[i] += (targetLane - lane[i]) * k
      v.r.crossVectors(v.f, v.up).normalize()
      v.p.addScaledVector(v.r, -lane[i])
      v.u.crossVectors(v.r, v.f).normalize()
      v.m.makeBasis(v.f, v.u, v.r)
      const s = Math.max(0.001, fade) * TRUCK_SCALE
      v.m.scale(v.s.set(s, s, s))
      v.m.setPosition(v.p)
      b.setMatrixAt(i, v.m)
      truckPos[i * 3] = v.p.x
      truckPos[i * 3 + 1] = v.p.y
      truckPos[i * 3 + 2] = v.p.z
      if (t.fill > 0.02) {
        v.h.makeTranslation(0, 0.38, 0)
        v.hs.makeScale(1, t.fill, 1)
        v.h.multiply(v.hs)
        v.h.premultiply(v.m)
        hp.setMatrixAt(heaps++, v.h)
      }
    }
    b.count = fleet.trucks.length
    hp.count = heaps
    b.instanceMatrix.needsUpdate = true
    hp.instanceMatrix.needsUpdate = true
  })

  return (
    <group>
      <instancedMesh ref={body} args={[geom, bodyMat, TRUCKS]} frustumCulled={false} />
      <instancedMesh ref={heap} args={[heapGeom, heapMat, TRUCKS]} frustumCulled={false} />
    </group>
  )
}

/** Ring and fleet number that follow a named truck once the scheduler names it. */
function TruckTag({ id }: { id: number }) {
  const group = useRef<THREE.Group>(null)
  const ring = useHoloMesh({ color: theme.holo.white, intensity: 2.6, opacity: 0.9, rim: 0, scan: 0 })
  const isRec = id === REC_TRUCK

  useFrame(({ clock }) => {
    const g = group.current
    if (!g) return
    const { phase, decision, moved } = useMine.getState()
    let show = phase !== 'situation'
    if (!isRec) show = show && (phase === 'approve' || decision?.action === 'modify')
    g.visible = show && replay.fade > 0.5
    if (!g.visible) return
    const slot = fleet.byId(id).slot
    g.position.set(truckPos[slot * 3], truckPos[slot * 3 + 1], truckPos[slot * 3 + 2])
    const active = moved === id || (isRec && (phase === 'recommend' || phase === 'approve'))
    setHoloColor(ring, active ? theme.holo.white : theme.holo.cyan, active ? 2.6 + Math.sin(clock.elapsedTime * 6) * 0.8 : 1.4)
  })

  return (
    <group ref={group} visible={false}>
      <mesh rotation-x={-Math.PI / 2} position-y={0.04} material={ring}>
        <ringGeometry args={[0.46, 0.52, 40]} />
      </mesh>
      <HoloText position={[0, 1.0, 0]} fontSize={0.4} variant="hudBold" color={theme.holo.white} glow={2} billboard>
        {`T${id}`}
      </HoloText>
    </group>
  )
}

const DOTS = 36

/** Flowing dots along the route a truck would take to Loader 2. */
function ProposedRoute() {
  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DOTS * 3), 3))
    return g
  }, [])
  const mat = useMemo(() => holoPointsMaterial({ color: theme.holo.cyan, intensity: 3, size: 3.2 }), [])
  useEffect(() => () => mat.dispose(), [mat])
  const pts = useRef<THREE.Points>(null)

  useFrame(({ clock }) => {
    const p = pts.current
    if (!p) return
    const { phase, decision, moved } = useMine.getState()
    let id: number | null = null
    if (phase === 'recommend' || phase === 'approve') id = REC_TRUCK
    else if ((phase === 'outcome' || phase === 'learn') && moved !== null) id = moved
    const t = id !== null ? fleet.byId(id) : null
    // Hide once the truck is on the Loader 2 branch or queued there.
    const arrived = t && t.loader === 1 && t.pending === -1 && (t.d > JUNCTION_D || t.state === 'queue' || t.state === 'load')
    p.visible = !!t && !arrived && decision?.action !== 'reject' && replay.fade > 0.5
    if (!p.visible || !t) return
    const pos = geom.attributes.position as THREE.BufferAttribute
    // Path: back along the truck's current route to the junction, then the Loader 2 branch.
    const onBranch = t.d > JUNCTION_D && t.loader === 0
    const a = onBranch ? t.d - JUNCTION_D : 0
    const startOnL2 = onBranch ? JUNCTION_D : t.d
    const total = a + (routes[1].length - startOnL2)
    const shift = (clock.elapsedTime * 0.9) % 1
    for (let i = 0; i < DOTS; i++) {
      const s = ((i + shift) / DOTS) * total
      if (s < a) routePoint(routes[0], t.d - s, v.p)
      else routePoint(routes[1], startOnL2 + (s - a), v.p)
      pos.setXYZ(i, v.p.x, v.p.y + 0.12, v.p.z)
    }
    pos.needsUpdate = true
    ;(mat.uniforms.uOpacity as { value: number }).value = phase === 'approve' ? 0.6 + Math.sin(clock.elapsedTime * 4) * 0.3 : 1
  })

  return <points ref={pts} geometry={geom} material={mat} frustumCulled={false} visible={false} />
}

/** A ring expands at the dump each time a trip completes. */
function DumpPulse() {
  const ring = useRef<THREE.Mesh>(null)
  const mat = useHoloMesh({ color: theme.holo.cyan, intensity: 2.6, opacity: 0.9, rim: 0, scan: 0 })
  const last = useRef(fleet.dumps)
  const age = useRef(10)
  useFrame((_, dt) => {
    if (fleet.dumps !== last.current) {
      if (fleet.dumps > last.current) age.current = 0
      last.current = fleet.dumps
    }
    age.current += dt
    const r = ring.current
    if (!r) return
    const u = age.current / 1.1
    r.visible = u < 1
    r.scale.setScalar(0.4 + u * 2.2)
    ;(mat.uniforms.uOpacity as { value: number }).value = 0.9 * (1 - u)
  })
  return (
    <mesh ref={ring} position={[DUMP_SPOT.x, RIM_Y + 0.06, DUMP_SPOT.z]} rotation-x={-Math.PI / 2} material={mat} visible={false}>
      <ringGeometry args={[0.9, 1.0, 48]} />
    </mesh>
  )
}

/** Trace of the verified trip (loader to dump) and a clickable marker above the dump. */
function VerifiedTrip() {
  const verified = useMine((s) => s.verified)
  const traces = useMemo(
    () =>
      routes.map((r) => {
        const g = routeRibbon(r, 0.13, 0.07)
        return { g, n: g.index!.count }
      }),
    [],
  )
  const traceMat = useHoloMesh({ color: theme.ok, intensity: 2.6, opacity: 1, rim: 0, scan: 0 })
  const marker = useRef<THREE.Group>(null)
  const gem = useHoloMesh({ color: theme.ok, intensity: 2.4, opacity: 0.85, rim: 1.4, scan: 0 })
  const hovered = useRef(false)
  const since = useRef(0)

  useEffect(() => {
    since.current = 0
  }, [verified])

  useFrame((_, dt) => {
    since.current += dt
    if (!verified) return
    const tr = traces[verified.loader]
    // Draw the GPS track from loader to dump over 1.4 s, hold, then settle to a faint line.
    // The ribbon runs dump (start) to loader (end), so reveal it from the end.
    const u = Math.min(1, since.current / 1.4)
    const shown = Math.floor((tr.n * u) / 6) * 6
    tr.g.setDrawRange(tr.n - shown, shown)
    const glow = since.current < 6 ? 2.4 : THREE.MathUtils.lerp(2.4, 0.5, Math.min(1, (since.current - 6) / 2))
    setHoloColor(traceMat, theme.ok, glow)
    const m = marker.current
    if (m) {
      m.rotation.y += dt * 0.8
      const s = hovered.current ? 1.2 : 1
      m.scale.setScalar(THREE.MathUtils.lerp(m.scale.x, s * Math.min(1, since.current * 2), 0.2))
    }
  })

  if (!verified) return null
  const tr = traces[verified.loader]

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    inspectVerifiedTrip()
  }
  const at: [number, number, number] = [DUMP_SPOT.x - 3.6, RIM_Y + 2.0, DUMP_SPOT.z - 2.4]

  return (
    <group>
      <mesh geometry={tr.g} material={traceMat} />
      <group position={at}>
        <group
          ref={marker}
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
          <mesh material={gem}>
            <octahedronGeometry args={[0.45, 0]} />
          </mesh>
        </group>
        <HoloText position={[0, 1.05, 0]} fontSize={0.38} variant="hudBold" color={theme.ok} glow={1.8} billboard>
          {`TRIP #${verified.trip} VERIFIED`}
        </HoloText>
        <HoloText position={[0, 0.62, 0]} fontSize={0.24} variant="mono" color={theme.holo.ice} glow={1.4} billboard>
          {`T${verified.truck} · load · haul · dump · payload ${verified.payload}%`}
        </HoloText>
        <HoloText position={[0, -0.55, 0]} fontSize={0.2} variant="mono" color={theme.holo.cyan} glow={1.2} billboard>
          click for IES record
        </HoloText>
      </group>
    </group>
  )
}
