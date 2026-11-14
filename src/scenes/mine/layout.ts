import * as THREE from 'three'

/**
 * Spatial layout of the Mine scene.
 * The pit floor sits at y = 0 and the benches step up and outward to the rim.
 * The haul road spirals from the floor up the pit wall and out to the dump.
 * Route distance `d` is measured from the dump (d = 0) back to a loader, so
 * both loader routes share the same trunk for d <= JUNCTION_D.
 */

export const BENCH_H = 0.85
export const BENCHES = 5
/** Horizontal step from one bench toe to the next. */
export const BENCH_STEP = 1.1
/** Horizontal width of a bench face (the rest of the step is the berm). */
export const BENCH_FACE = 0.55
export const FLOOR_RX = 6.5
export const FLOOR_RZ = 3.6
/** Offsets grow slower along z so the pit stays an ellipse. */
export const Z_K = 0.65
export const RIM_Y = BENCH_H * BENCHES
export const RIM_OFFSET = (BENCHES - 1) * BENCH_STEP + BENCH_FACE
export const PLATEAU_OFFSET = RIM_OFFSET + 4.2

export const ellipseXZ = (offset: number, theta: number): [number, number] => [
  (FLOOR_RX + offset) * Math.cos(theta),
  (FLOOR_RZ + offset * Z_K) * Math.sin(theta),
]

/** Wall offset of the mean pit slope at a given height. */
export const slopeOffset = (y: number) => (y / RIM_Y) * RIM_OFFSET

// Haul road spiral, front-left of the floor round the back to the right rim.
const SPIRAL_START = THREE.MathUtils.degToRad(100)
const SPIRAL_END = THREE.MathUtils.degToRad(330)
const ROAD_INSET = 0.18

export const DUMP_SPOT = new THREE.Vector3(14.4, RIM_Y, -6.9)
export const JUNCTION = new THREE.Vector3(-0.8, 0, 2.3)

export interface LoaderSite {
  index: 0 | 1
  name: string
  /** Where a truck stands while it is loaded. */
  spot: THREE.Vector3
  /** Excavator position. */
  digger: THREE.Vector3
  /** Bank (blasted material) behind the excavator. */
  face: THREE.Vector3
  branch: THREE.Vector3[]
}

export const loaders: LoaderSite[] = [
  {
    index: 0,
    name: 'LOADER 1',
    spot: new THREE.Vector3(-3.9, 0, -0.3),
    digger: new THREE.Vector3(-4.85, 0, -1.35),
    face: new THREE.Vector3(-6.5, 0, -0.6),
    branch: [new THREE.Vector3(-2.6, 0, 1.25)],
  },
  {
    index: 1,
    name: 'LOADER 2',
    spot: new THREE.Vector3(3.9, 0, -0.5),
    digger: new THREE.Vector3(4.9, 0, -1.45),
    face: new THREE.Vector3(6.5, 0, -0.8),
    branch: [new THREE.Vector3(1.2, 0, 1.55), new THREE.Vector3(2.95, 0, 0.55)],
  },
]

function trunkPoints(): THREE.Vector3[] {
  const pts: THREE.Vector3[] = []
  const exit = (() => {
    const [x, z] = ellipseXZ(RIM_OFFSET + ROAD_INSET, SPIRAL_END)
    return new THREE.Vector3(x, RIM_Y, z)
  })()
  const lead = new THREE.CatmullRomCurve3([DUMP_SPOT.clone(), new THREE.Vector3(12.6, RIM_Y, -5.9), new THREE.Vector3(11.3, RIM_Y, -4.7), exit], false, 'centripetal')
  pts.push(...lead.getSpacedPoints(40))
  const n = 260
  for (let i = 1; i <= n; i++) {
    const u = 1 - i / n
    const theta = SPIRAL_START + (SPIRAL_END - SPIRAL_START) * u
    const y = RIM_Y * u
    const [x, z] = ellipseXZ(slopeOffset(y) + ROAD_INSET, theta)
    pts.push(new THREE.Vector3(x, y, z))
  }
  const bottom = pts[pts.length - 1]
  const tail = new THREE.CatmullRomCurve3([bottom.clone(), bottom.clone().lerp(JUNCTION, 0.5), JUNCTION.clone()])
  pts.push(...tail.getSpacedPoints(12).slice(1))
  return pts
}

export interface Route {
  /** Uniformly resampled positions, ROUTE_DS apart. */
  pos: Float32Array
  count: number
  length: number
}

export const ROUTE_DS = 0.05

function resample(points: THREE.Vector3[]): Route {
  const cum = [0]
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + points[i].distanceTo(points[i - 1]))
  const length = cum[cum.length - 1]
  const count = Math.floor(length / ROUTE_DS) + 1
  const pos = new Float32Array(count * 3)
  let j = 0
  const tmp = new THREE.Vector3()
  for (let i = 0; i < count; i++) {
    const d = Math.min(i * ROUTE_DS, length)
    while (j < cum.length - 2 && cum[j + 1] < d) j++
    const seg = cum[j + 1] - cum[j] || 1
    tmp.lerpVectors(points[j], points[j + 1], (d - cum[j]) / seg)
    pos[i * 3] = tmp.x
    pos[i * 3 + 1] = tmp.y
    pos[i * 3 + 2] = tmp.z
  }
  return { pos, count, length }
}

const trunk = trunkPoints()
const trunkRoute = resample(trunk)
/** Distance from the dump to the junction on the pit floor. */
export const JUNCTION_D = trunkRoute.length

function branchPoints(l: LoaderSite) {
  const curve = new THREE.CatmullRomCurve3([JUNCTION.clone(), ...l.branch.map((p) => p.clone()), l.spot.clone()], false, 'centripetal')
  return curve.getSpacedPoints(60)
}

/** Full route per loader, dump (d = 0) to loading spot (d = length). */
export const routes: Route[] = loaders.map((l) => resample([...trunk, ...branchPoints(l).slice(1)]))

/** Trunk and branches as separate polylines, for drawing the road. */
export const roadPieces = {
  trunk: trunkRoute,
  branches: loaders.map((l) => resample(branchPoints(l))),
}

/** Writes the route position at distance d into out (x, y, z). */
export function routePoint(r: Route, d: number, out: THREE.Vector3) {
  const f = Math.min(Math.max(d, 0), r.length) / ROUTE_DS
  const i = Math.min(Math.floor(f), r.count - 2)
  const k = f - i
  const p = r.pos
  out.set(
    p[i * 3] + (p[i * 3 + 3] - p[i * 3]) * k,
    p[i * 3 + 1] + (p[i * 3 + 4] - p[i * 3 + 1]) * k,
    p[i * 3 + 2] + (p[i * 3 + 5] - p[i * 3 + 2]) * k,
  )
  return out
}

/** Unit tangent (direction of increasing d) at distance d. */
export function routeTangent(r: Route, d: number, out: THREE.Vector3) {
  const i = Math.min(Math.max(Math.floor(d / ROUTE_DS), 0), r.count - 3)
  const p = r.pos
  out.set(p[i * 3 + 6] - p[i * 3], p[i * 3 + 7] - p[i * 3 + 1], p[i * 3 + 8] - p[i * 3 + 2])
  return out.normalize()
}

/** Flat ribbon along a route, `half` wide each side, lifted by `lift`. */
export function routeRibbon(r: Route, half: number, lift = 0.02) {
  const pos: number[] = []
  const idx: number[] = []
  const p = r.pos
  const step = 3
  let n = 0
  for (let i = 0; i < r.count; i += step) {
    const j = Math.min(i + step, r.count - 1)
    const a = i === j ? i - step : i
    const tx = p[j * 3] - p[a * 3]
    const tz = p[j * 3 + 2] - p[a * 3 + 2]
    const len = Math.hypot(tx, tz) || 1
    const nx = (-tz / len) * half
    const nz = (tx / len) * half
    pos.push(p[i * 3] - nx, p[i * 3 + 1] + lift, p[i * 3 + 2] - nz, p[i * 3] + nx, p[i * 3 + 1] + lift, p[i * 3 + 2] + nz)
    if (n > 0) {
      const k = (n - 1) * 2
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2)
    }
    n++
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

/** Home camera. Content is framed between the left and right panel columns. */
export const mineCamera = { position: [-4.1, 37.4, 23.1] as [number, number, number], target: [-0.1, 0, -1.0] as [number, number, number] }
