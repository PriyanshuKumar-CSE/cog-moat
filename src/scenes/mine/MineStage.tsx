import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { theme } from '../../config/theme'
import { useApp } from '../../core/store'
import { HoloGrid } from '../../holo/HoloGrid'
import { HoloText } from '../../holo/HoloText'
import { useHoloLine, useHoloMesh } from '../../holo/hooks'
import { setHoloColor } from '../../holo/materials'
import { SIM } from './fleet'
import { FleetLayer, setCursor } from './FleetLayer'
import {
  BENCHES,
  BENCH_FACE,
  BENCH_H,
  BENCH_STEP,
  DUMP_SPOT,
  PLATEAU_OFFSET,
  RIM_OFFSET,
  RIM_Y,
  ellipseXZ,
  loaders,
  roadPieces,
  routeRibbon,
  type LoaderSite,
  type Route,
} from './layout'
import { L2_ALERT_IDLE, fleet, startMine, useMine } from './mineStore'

export function MineStage() {
  useFrame((_, dt) => {
    if (useApp.getState().pendingScene) return
    useMine.getState().tick(Math.min(dt, 0.1))
  })

  useEffect(() => {
    startMine()
    return () => setCursor(false)
  }, [])

  return (
    <>
      <HoloGrid y={-0.03} size={96} opacity={0.5} />
      <PitBenches />
      <Plateau />
      <HaulRoad />
      {loaders.map((l) => (
        <Excavator key={l.index} site={l} />
      ))}
      <DumpSite />
      <FleetLayer />
      <Labels />
    </>
  )
}

const RING_SEGS = 180

function ringPoints(offset: number, y: number, out: number[]) {
  for (let i = 0; i < RING_SEGS; i++) {
    const a0 = (i / RING_SEGS) * Math.PI * 2
    const a1 = ((i + 1) / RING_SEGS) * Math.PI * 2
    const [x0, z0] = ellipseXZ(offset, a0)
    const [x1, z1] = ellipseXZ(offset, a1)
    out.push(x0, y, z0, x1, y, z1)
  }
}

/** Ribbon between two rings, for translucent bench faces. */
function ribbon(o0: number, y0: number, o1: number, y1: number) {
  const pos: number[] = []
  const idx: number[] = []
  for (let i = 0; i <= RING_SEGS; i++) {
    const a = (i / RING_SEGS) * Math.PI * 2
    const [x0, z0] = ellipseXZ(o0, a)
    const [x1, z1] = ellipseXZ(o1, a)
    pos.push(x0, y0, z0, x1, y1, z1)
    if (i < RING_SEGS) {
      const k = i * 2
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

/** Wireframe benches stepping up from the pit floor to the rim. */
function PitBenches() {
  const { crests, toes, ticks, faces, berms } = useMemo(() => {
    const crest: number[] = []
    const toe: number[] = []
    const tick: number[] = []
    const faceGeoms: THREE.BufferGeometry[] = []
    const bermGeoms: THREE.BufferGeometry[] = []
    for (let k = 0; k < BENCHES; k++) {
      const oToe = k * BENCH_STEP
      const oCrest = oToe + BENCH_FACE
      const y0 = k * BENCH_H
      const y1 = (k + 1) * BENCH_H
      ringPoints(oToe, y0, toe)
      ringPoints(oCrest, y1, crest)
      const n = 72
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + k * 0.03
        const [x0, z0] = ellipseXZ(oToe, a)
        const [x1, z1] = ellipseXZ(oCrest, a)
        tick.push(x0, y0, z0, x1, y1, z1)
      }
      faceGeoms.push(ribbon(oToe, y0, oCrest, y1))
      if (k < BENCHES - 1) bermGeoms.push(ribbon(oCrest, y1, (k + 1) * BENCH_STEP, y1))
    }
    const lines = (arr: number[]) => {
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3))
      return g
    }
    return { crests: lines(crest), toes: lines(toe), ticks: lines(tick), faces: faceGeoms, berms: bermGeoms }
  }, [])
  const floor = useMemo(() => {
    const shape = new THREE.Shape()
    for (let i = 0; i <= 96; i++) {
      const [x, z] = ellipseXZ(0, (i / 96) * Math.PI * 2)
      if (i === 0) shape.moveTo(x, -z)
      else shape.lineTo(x, -z)
    }
    return new THREE.ShapeGeometry(shape)
  }, [])
  const crestMat = useHoloLine({ color: theme.holo.cyan, intensity: 1.15, opacity: 0.75, scan: 0.4 })
  const toeMat = useHoloLine({ color: theme.holo.blue, intensity: 0.9, opacity: 0.55, scan: 0.4 })
  const tickMat = useHoloLine({ color: theme.holo.blue, intensity: 0.7, opacity: 0.28, scan: 0.3 })
  const faceMat = useHoloMesh({ color: theme.brand.primaryFrom, intensity: 0.7, opacity: 0.14, rim: 0.5, scan: 0.6 })
  const bermMat = useHoloMesh({ color: theme.brand.primaryTo, intensity: 0.6, opacity: 0.08, rim: 0, scan: 0.3 })
  const floorMat = useHoloMesh({ color: theme.brand.primaryTo, intensity: 0.7, opacity: 0.16, rim: 0, scan: 0.2 })
  return (
    <group>
      <lineSegments geometry={crests} material={crestMat} />
      <lineSegments geometry={toes} material={toeMat} />
      <lineSegments geometry={ticks} material={tickMat} />
      {faces.map((g, i) => (
        <mesh key={`f${i}`} geometry={g} material={faceMat} />
      ))}
      {berms.map((g, i) => (
        <mesh key={`b${i}`} geometry={g} material={bermMat} />
      ))}
      <mesh geometry={floor} material={floorMat} rotation-x={-Math.PI / 2} position-y={0.01} />
    </group>
  )
}

/** Flat ground ring round the rim, with a dashed outer edge. */
function Plateau() {
  const geometry = useMemo(() => ribbon(RIM_OFFSET, RIM_Y, PLATEAU_OFFSET, RIM_Y), [])
  const edge = useMemo(() => {
    const pts: number[] = []
    const n = 140
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2
      const a1 = a0 + (Math.PI * 2 * 0.55) / n
      const [x0, z0] = ellipseXZ(PLATEAU_OFFSET, a0)
      const [x1, z1] = ellipseXZ(PLATEAU_OFFSET, a1)
      pts.push(x0, RIM_Y, z0, x1, RIM_Y, z1)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    return g
  }, [])
  const mat = useHoloMesh({ color: theme.brand.primaryTo, intensity: 0.6, opacity: 0.07, rim: 0, scan: 0.3 })
  const edgeMat = useHoloLine({ color: theme.holo.dim, intensity: 1.2, opacity: 0.5, scan: 0.3 })
  return (
    <group>
      <mesh geometry={geometry} material={mat} />
      <lineSegments geometry={edge} material={edgeMat} />
    </group>
  )
}

/** Line pairs along a route offset sideways by `side` (world units). */
function routeEdge(r: Route, side: number, lift = 0.04, dash = 0) {
  const pts: number[] = []
  const p = r.pos
  const step = 2
  for (let i = 0; i + step < r.count; i += step) {
    if (dash > 0 && Math.floor(i / dash) % 2 === 1) continue
    const j = i + step
    const tx = p[j * 3] - p[i * 3]
    const tz = p[j * 3 + 2] - p[i * 3 + 2]
    const len = Math.hypot(tx, tz) || 1
    const nx = -tz / len
    const nz = tx / len
    const k = Math.min(j + step, r.count - 1)
    const tx2 = p[k * 3] - p[j * 3]
    const tz2 = p[k * 3 + 2] - p[j * 3 + 2]
    const len2 = Math.hypot(tx2, tz2) || 1
    const nx2 = -tz2 / len2
    const nz2 = tx2 / len2
    pts.push(p[i * 3] + nx * side, p[i * 3 + 1] + lift, p[i * 3 + 2] + nz * side, p[j * 3] + nx2 * side, p[j * 3 + 1] + lift, p[j * 3 + 2] + nz2 * side)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
  return g
}

const ROAD_HALF = 0.5

/** Two-lane haul road: trunk up the wall and a branch to each loader. */
function HaulRoad() {
  const pieces = useMemo(() => {
    const all = [roadPieces.trunk, ...roadPieces.branches]
    return all.map((r) => ({
      left: routeEdge(r, ROAD_HALF),
      right: routeEdge(r, -ROAD_HALF),
      centre: routeEdge(r, 0, 0.05, 6),
      strip: routeRibbon(r, ROAD_HALF),
    }))
  }, [])
  const edge = useHoloLine({ color: theme.holo.cyan, intensity: 1.6, opacity: 0.85, scan: 0.2 })
  const centre = useHoloLine({ color: theme.holo.ice, intensity: 0.9, opacity: 0.5, scan: 0 })
  const strip = useHoloMesh({ color: theme.holo.blue, intensity: 0.9, opacity: 0.2, rim: 0, scan: 0.2 })
  const wetEdge = useHoloLine({ color: theme.holo.cyan, intensity: 1.6, opacity: 0.85, scan: 0.2 })
  const wetStrip = useHoloMesh({ color: theme.holo.blue, intensity: 0.9, opacity: 0.2, rim: 0, scan: 0.2 })

  useFrame(({ clock }) => {
    const wet = useMine.getState().wetRoad
    const pulse = 1 + Math.sin(clock.elapsedTime * 5) * 0.25
    setHoloColor(wetEdge, wet ? theme.alert.amber : theme.holo.cyan, wet ? 2.2 * pulse : 1.6)
    setHoloColor(wetStrip, wet ? theme.alert.amber : theme.holo.blue, wet ? 0.8 : 0.9)
  })

  return (
    <group>
      {pieces.map((p, i) => {
        const isL2 = i === 2
        return (
          <group key={i}>
            <mesh geometry={p.strip} material={isL2 ? wetStrip : strip} />
            <lineSegments geometry={p.left} material={isL2 ? wetEdge : edge} />
            <lineSegments geometry={p.right} material={isL2 ? wetEdge : edge} />
            <lineSegments geometry={p.centre} material={centre} />
          </group>
        )
      })}
    </group>
  )
}

const tmpV = new THREE.Vector3()

/** Hydraulic excavator. The house swings between the bank and the truck while loading. */
function Excavator({ site }: { site: LoaderSite }) {
  const house = useRef<THREE.Group>(null)
  const boom = useRef<THREE.Group>(null)
  const body = useHoloMesh({ color: theme.holo.blue, intensity: 1.5, opacity: 0.55, rim: 1.2 })
  const arm = useHoloMesh({ color: theme.holo.cyan, intensity: 1.5, opacity: 0.6, rim: 1 })
  const pile = useHoloMesh({ color: theme.holo.blue, intensity: 1.1, opacity: 0.35, rim: 1.4 })
  const pileEdge = useHoloLine({ color: theme.holo.cyan, intensity: 1.2, opacity: 0.5 })
  const pileGeom = useMemo(() => new THREE.SphereGeometry(1, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2), [])
  const pileWire = useMemo(() => new THREE.WireframeGeometry(new THREE.SphereGeometry(1, 12, 4, 0, Math.PI * 2, 0, Math.PI / 2)), [])
  const houseEdges = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(1.0, 0.5, 0.75)), [])
  const edgeMat = useHoloLine({ color: theme.holo.cyan, intensity: 1.8, opacity: 0.9 })

  // Yaw that points the house at the truck and at the bank.
  const toTruck = Math.atan2(-(site.spot.z - site.digger.z), site.spot.x - site.digger.x)
  const toFace = Math.atan2(-(site.face.z - site.digger.z), site.face.x - site.digger.x)
  const sweep = Math.atan2(Math.sin(toTruck - toFace), Math.cos(toTruck - toFace))

  useFrame(({ clock }) => {
    const line = fleet.lines[site.index]
    const head = line[0]
    const loading = head?.state === 'load'
    const time = clock.elapsedTime
    let yaw: number
    let lift: number
    if (loading) {
      // Two passes per load: dig, swing, dump, swing back.
      const u = (1 - head.timer / SIM.LOAD_S) * 2
      const f = u % 1
      const swing = f < 0.5 ? THREE.MathUtils.smoothstep(f, 0.1, 0.45) : 1 - THREE.MathUtils.smoothstep(f, 0.6, 0.95)
      yaw = toFace + sweep * swing
      lift = swing
    } else {
      yaw = toFace + Math.sin(time * 0.6 + site.index) * 0.12
      lift = 0.15
    }
    if (house.current) house.current.rotation.y = THREE.MathUtils.lerp(house.current.rotation.y, yaw, 0.2)
    if (boom.current) boom.current.rotation.z = THREE.MathUtils.lerp(boom.current.rotation.z, 0.15 + lift * 0.45, 0.2)
    // The bank glows amber while this loader waits on trucks (an alert), blue otherwise.
    const m = useMine.getState().metrics.loaders[site.index]
    const alert = site.index === 1 && m.idle > L2_ALERT_IDLE
    const pulse = 1 + Math.sin(time * 4) * 0.2
    setHoloColor(pile, alert ? theme.alert.amber : theme.holo.blue, alert ? 1.3 * pulse : 1.1)
    setHoloColor(pileEdge, alert ? theme.alert.amber : theme.holo.cyan, alert ? 1.6 * pulse : 1.1)
  })

  tmpV.copy(site.face)
  return (
    <group>
      <group position={site.digger}>
        {/* Tracks */}
        <mesh position={[0, 0.14, 0.32]} material={body}>
          <boxGeometry args={[1.25, 0.28, 0.26]} />
        </mesh>
        <mesh position={[0, 0.14, -0.32]} material={body}>
          <boxGeometry args={[1.25, 0.28, 0.26]} />
        </mesh>
        <group ref={house} position-y={0.32}>
          <mesh position={[-0.1, 0.25, 0]} material={body}>
            <boxGeometry args={[1.0, 0.5, 0.75]} />
          </mesh>
          <lineSegments position={[-0.1, 0.25, 0]} geometry={houseEdges} material={edgeMat} />
          <mesh position={[0.22, 0.62, 0.22]} material={arm}>
            <boxGeometry args={[0.3, 0.26, 0.28]} />
          </mesh>
          <group ref={boom} position={[0.35, 0.4, 0]}>
            <mesh position={[0.55, 0.0, 0]} rotation-z={0.55} material={arm}>
              <boxGeometry args={[1.2, 0.14, 0.16]} />
            </mesh>
            <group position={[1.05, 0.33, 0]} rotation-z={-1.7}>
              <mesh position={[0.45, 0, 0]} material={arm}>
                <boxGeometry args={[0.9, 0.11, 0.13]} />
              </mesh>
              <mesh position={[0.92, 0.04, 0]} material={arm}>
                <boxGeometry args={[0.22, 0.24, 0.34]} />
              </mesh>
            </group>
          </group>
        </group>
      </group>
      <group position={[tmpV.x, 0, tmpV.z]} scale={[1.0, site.index === 1 ? 0.75 : 0.55, 0.8]}>
        <mesh geometry={pileGeom} material={pile} />
        <lineSegments geometry={pileWire} material={pileEdge} />
      </group>
    </group>
  )
}

/** Dump zone with a crusher hopper on the rim. */
function DumpSite() {
  const zone = useMemo(() => {
    const pts: number[] = []
    const w = 3.0
    const d = 2.2
    const corners = [
      [-w / 2, -d / 2],
      [w / 2, -d / 2],
      [w / 2, d / 2],
      [-w / 2, d / 2],
    ]
    for (let i = 0; i < 4; i++) {
      const [x0, z0] = corners[i]
      const [x1, z1] = corners[(i + 1) % 4]
      const n = 10
      for (let k = 0; k < n; k += 2) {
        pts.push(x0 + ((x1 - x0) * k) / n, 0.05, z0 + ((z1 - z0) * k) / n, x0 + ((x1 - x0) * (k + 1)) / n, 0.05, z0 + ((z1 - z0) * (k + 1)) / n)
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    return g
  }, [])
  const zoneMat = useHoloLine({ color: theme.ok, intensity: 1.4, opacity: 0.9, scan: 0 })
  const padMat = useHoloMesh({ color: theme.ok, intensity: 0.5, opacity: 0.1, rim: 0, scan: 0.2 })
  const hopper = useHoloMesh({ color: theme.holo.blue, intensity: 1.4, opacity: 0.5, rim: 1.2 })
  const hopperEdges = useMemo(() => new THREE.EdgesGeometry(new THREE.CylinderGeometry(1.0, 0.45, 1.1, 4, 1, true)), [])
  const edgeMat = useHoloLine({ color: theme.holo.cyan, intensity: 1.8, opacity: 0.9 })
  const belt = useHoloMesh({ color: theme.holo.blue, intensity: 1.0, opacity: 0.4, rim: 0.4 })
  return (
    <group position={DUMP_SPOT}>
      <group rotation-y={0.62}>
        <lineSegments geometry={zone} material={zoneMat} />
        <mesh rotation-x={-Math.PI / 2} position-y={0.03} material={padMat}>
          <planeGeometry args={[3.0, 2.2]} />
        </mesh>
      </group>
      <group position={[1.9, 0, -1.5]}>
        <mesh position-y={1.0} rotation-y={Math.PI / 4} material={hopper}>
          <cylinderGeometry args={[1.0, 0.45, 1.1, 4, 1, true]} />
        </mesh>
        <lineSegments position-y={1.0} rotation-y={Math.PI / 4} geometry={hopperEdges} material={edgeMat} />
        <mesh position={[1.6, 0.6, -0.9]} rotation={[0, 0.55, 0.18]} material={belt}>
          <boxGeometry args={[3.0, 0.08, 0.35]} />
        </mesh>
      </group>
    </group>
  )
}

/** World-anchored labels for the loaders, the dump and the road. */
function Labels() {
  const m = useMine((s) => s.metrics)
  const wet = useMine((s) => s.wetRoad)
  const l1 = m.loaders[0]
  const l2 = m.loaders[1]
  const l2Alert = l2.idle > L2_ALERT_IDLE
  const L1 = loaders[0].digger
  const L2 = loaders[1].digger
  return (
    <group>
      <Tag at={[L1.x, 2.6, L1.z]} title="LOADER 1" sub={`${l1.queued} queued · wait ${l1.waitMin.toFixed(1)} min`} />
      <Tag
        at={[L2.x, 2.6, L2.z]}
        title="LOADER 2"
        sub={l2Alert ? `long work queue · idle ${Math.round(l2.idle * 100)}%` : `loader idle ${Math.round(l2.idle * 100)}%`}
        subColor={l2Alert ? theme.alert.amber : theme.holo.cyan}
      />
      <Tag at={[DUMP_SPOT.x + 1.9, RIM_Y + 3.0, DUMP_SPOT.z - 1.5]} title="DUMP · CRUSHER" sub="valid dump zone" subColor={theme.ok} />
      <group position={[0, 4.3, -6.1]}>
        <HoloText fontSize={0.24} variant="mono" color={theme.holo.cyan} glow={1.1} billboard>
          haul road · 2 lanes · 4.2 km
        </HoloText>
      </group>
      {wet && (
        <group position={[2.6, 1.9, 1.6]}>
          <HoloText fontSize={0.26} variant="mono" color={theme.alert.amber} glow={1.8} billboard>
            road wet · reported by Shift In-charge
          </HoloText>
        </group>
      )}
    </group>
  )
}

function Tag({ at, title, sub, subColor = theme.holo.cyan }: { at: [number, number, number]; title: string; sub: string; subColor?: string }) {
  return (
    <group position={at}>
      <HoloText position={[0, 0.3, 0]} fontSize={0.46} variant="hudBold" glow={1.7} billboard>
        {title}
      </HoloText>
      <HoloText position={[0, -0.1, 0]} fontSize={0.24} variant="mono" color={subColor} glow={1.6} billboard>
        {sub}
      </HoloText>
    </group>
  )
}
