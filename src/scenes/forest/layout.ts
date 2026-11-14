import * as THREE from 'three'

/**
 * Spatial layout of the Forest concession scene.
 * World X runs left to right, Z runs back (negative) to front (positive).
 * One canopy cell is a simulated 100 m x 100 m tile, so 1 cell = 1 ha.
 */

export const COLS = 24
export const ROWS = 16
export const CELL = 0.8
export const CELL_COUNT = COLS * ROWS
export const CELL_HA = 1
export const HALF_W = (COLS * CELL) / 2
export const HALF_D = (ROWS * CELL) / 2

const rowLetters = 'ABCDEFGHIJKLMNOP'

export const cellIndex = (r: number, c: number) => r * COLS + c
export const cellRow = (i: number) => Math.floor(i / COLS)
export const cellCol = (i: number) => i % COLS
export const cellX = (c: number) => (c - (COLS - 1) / 2) * CELL
export const cellZ = (r: number) => (r - (ROWS - 1) / 2) * CELL
export const cellName = (i: number) => `${rowLetters[cellRow(i)]}${cellCol(i) + 1}`

/** Rolling terrain height. */
export function terrainY(x: number, z: number) {
  return (
    0.55 * Math.sin(x * 0.33 + 0.6) * Math.cos(z * 0.4) +
    0.3 * Math.sin(x * 0.75 + z * 0.5 + 1.3) +
    0.22 * Math.cos(z * 0.85 - x * 0.2)
  )
}

/** Column height for a canopy density (NDVI-like 0..1). */
export const canopyHeight = (ndvi: number) => 0.08 + Math.max(0, ndvi) * 1.25

/** Concession boundary, clockwise as seen from above. */
export const boundary: [number, number][] = [
  [-8.6, -5.2],
  [-2.0, -5.85],
  [5.5, -5.6],
  [8.9, -3.4],
  [8.7, 4.0],
  [3.0, 5.7],
  [-4.5, 5.5],
  [-8.9, 2.6],
]

export function insideBoundary(x: number, z: number) {
  let inside = false
  for (let i = 0, j = boundary.length - 1; i < boundary.length; j = i++) {
    const [xi, zi] = boundary[i]
    const [xj, zj] = boundary[j]
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}

function distToEdge(x: number, z: number, e: number) {
  const [ax, az] = boundary[e]
  const [bx, bz] = boundary[(e + 1) % boundary.length]
  const dx = bx - ax
  const dz = bz - az
  const len2 = dx * dx + dz * dz
  const u = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2))
  return { d: Math.hypot(x - (ax + dx * u), z - (az + dz * u)), u }
}

/** Whether each cell centre lies inside the concession. */
export const insideMask: boolean[] = Array.from({ length: CELL_COUNT }, (_, i) => insideBoundary(cellX(cellCol(i)), cellZ(cellRow(i))))

/** Cleared cells along part of one boundary edge, with a ragged inner edge. */
export function clearingCells(edge: number, u0: number, u1: number, depth: number): number[] {
  const out: number[] = []
  for (let i = 0; i < CELL_COUNT; i++) {
    if (!insideMask[i]) continue
    const x = cellX(cellCol(i))
    const z = cellZ(cellRow(i))
    const { d, u } = distToEdge(x, z, edge)
    if (u < u0 || u > u1) continue
    const ragged = depth - (((cellRow(i) * 7 + cellCol(i) * 13) % 5) / 5) * CELL * 0.9
    if (d < ragged) out.push(i)
  }
  return out
}

/** Outline segments (pairs of [x, z]) around a set of cells: edges not shared with another cell in the set. */
export function outlineOf(cells: number[]): [number, number, number, number][] {
  const set = new Set(cells)
  const h = CELL / 2
  const segs: [number, number, number, number][] = []
  for (const i of cells) {
    const r = cellRow(i)
    const c = cellCol(i)
    const x = cellX(c)
    const z = cellZ(r)
    if (r === 0 || !set.has(cellIndex(r - 1, c))) segs.push([x - h, z - h, x + h, z - h])
    if (r === ROWS - 1 || !set.has(cellIndex(r + 1, c))) segs.push([x - h, z + h, x + h, z + h])
    if (c === 0 || !set.has(cellIndex(r, c - 1))) segs.push([x - h, z - h, x - h, z + h])
    if (c === COLS - 1 || !set.has(cellIndex(r, c + 1))) segs.push([x + h, z - h, x + h, z + h])
  }
  return segs
}

/** Turns [x, z] segments into dashed 3D segments draped over the terrain. */
export function drapeDashed(segs: [number, number, number, number][], lift: number, dash = 0.22, gap = 0.12): number[] {
  const pts: number[] = []
  for (const [ax, az, bx, bz] of segs) {
    const len = Math.hypot(bx - ax, bz - az)
    for (let s = 0; s < len - 1e-4; s += dash + gap) {
      const e = Math.min(len, s + dash)
      const sub = 3
      for (let k = 0; k < sub; k++) {
        const t0 = (s + ((e - s) * k) / sub) / len
        const t1 = (s + ((e - s) * (k + 1)) / sub) / len
        const x0 = ax + (bx - ax) * t0
        const z0 = az + (bz - az) * t0
        const x1 = ax + (bx - ax) * t1
        const z1 = az + (bz - az) * t1
        pts.push(x0, terrainY(x0, z0) + lift, z0, x1, terrainY(x1, z1) + lift, z1)
      }
    }
  }
  return pts
}

export const boundarySegments = (): [number, number, number, number][] =>
  boundary.map(([ax, az], i) => {
    const [bx, bz] = boundary[(i + 1) % boundary.length]
    return [ax, az, bx, bz]
  })

/** Ranger post, outside the boundary at the front-left corner. */
export const RANGER_POST = new THREE.Vector3(-9.5, 0, 5.5)
RANGER_POST.y = terrainY(RANGER_POST.x, RANGER_POST.z)

/** Ground route from the ranger post to a cell, sampled as a polyline. */
export function patrolRoute(target: number, samples: number, out: Float32Array) {
  const tx = cellX(cellCol(target))
  const tz = cellZ(cellRow(target))
  const a = new THREE.Vector3(RANGER_POST.x, 0, RANGER_POST.z)
  const b = new THREE.Vector3(tx, 0, tz)
  const m1 = a.clone().lerp(b, 0.33).add(new THREE.Vector3(-0.6, 0, -0.9))
  const m2 = a.clone().lerp(b, 0.7).add(new THREE.Vector3(0.7, 0, 0.5))
  const curve = new THREE.CatmullRomCurve3([a, m1, m2, b])
  const p = new THREE.Vector3()
  for (let k = 0; k < samples; k++) {
    curve.getPoint(k / (samples - 1), p)
    out[k * 3] = p.x
    out[k * 3 + 1] = terrainY(p.x, p.z) + 0.12
    out[k * 3 + 2] = p.z
  }
  return curve.getLength()
}

/** Scan sweep travels from just left of the grid to just right of it. */
export const SWEEP_FROM = -HALF_W - 0.8
export const SWEEP_TO = HALF_W + 0.8
