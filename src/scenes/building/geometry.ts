import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import {
  BASEMENT_Y,
  COL,
  ELEC_SHAFT,
  GRID_X,
  GRID_Z,
  HALF_X,
  HALF_Z,
  LEVELS,
  METER_ROOM,
  PILE_TIP,
  PIT_X,
  PIT_Z,
  PLUMB_SHAFT,
  RAFT_BOTTOM,
  RAFT_TOP,
  ROOF_Y,
  SLAB,
  levelY,
} from './layout'
import type { BuildingStageId } from './stages'

/**
 * Procedural geometry for every construction milestone. Each milestone is one
 * merged fill mesh and one merged line set, so the whole tower is ~20 draw calls.
 */

export interface StageGeometry {
  fill: THREE.BufferGeometry | null
  lines: THREE.BufferGeometry | null
}

class Builder {
  private fills: THREE.BufferGeometry[] = []
  private pts: number[] = []

  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number) {
    const g = new THREE.BoxGeometry(sx, sy, sz)
    g.translate(cx, cy, cz)
    this.fills.push(g)
    return this
  }

  cylinder(cx: number, y0: number, y1: number, cz: number, r: number, seg = 10) {
    const g = new THREE.CylinderGeometry(r, r, y1 - y0, seg, 1, true)
    g.translate(cx, (y0 + y1) / 2, cz)
    this.fills.push(g)
    return this
  }

  /** Axis-aligned rectangle in a vertical plane. `axis` x: plane faces Z; z: plane faces X. */
  quad(axis: 'x' | 'z', a0: number, a1: number, y0: number, y1: number, at: number) {
    if (a1 - a0 < 1e-4 || y1 - y0 < 1e-4) return this
    const g = new THREE.PlaneGeometry(a1 - a0, y1 - y0)
    if (axis === 'z') g.rotateY(Math.PI / 2)
    const c = (a0 + a1) / 2
    if (axis === 'x') g.translate(c, (y0 + y1) / 2, at)
    else g.translate(at, (y0 + y1) / 2, c)
    this.fills.push(g)
    return this
  }

  /** Horizontal rectangle at height y. */
  flat(x0: number, x1: number, z0: number, z1: number, y: number) {
    const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0)
    g.rotateX(-Math.PI / 2)
    g.translate((x0 + x1) / 2, y, (z0 + z1) / 2)
    this.fills.push(g)
    return this
  }

  seg(ax: number, ay: number, az: number, bx: number, by: number, bz: number) {
    this.pts.push(ax, ay, az, bx, by, bz)
    return this
  }

  /** Polyline through points. */
  path(p: [number, number, number][]) {
    for (let i = 0; i < p.length - 1; i++) this.seg(...p[i], ...p[i + 1])
    return this
  }

  rect(x0: number, x1: number, z0: number, z1: number, y: number) {
    return this.path([
      [x0, y, z0],
      [x1, y, z0],
      [x1, y, z1],
      [x0, y, z1],
      [x0, y, z0],
    ])
  }

  /** Rectangle outline in a vertical plane, matching `quad`. */
  vrect(axis: 'x' | 'z', a0: number, a1: number, y0: number, y1: number, at: number) {
    const p = (a: number, y: number): [number, number, number] => (axis === 'x' ? [a, y, at] : [at, y, a])
    return this.path([p(a0, y0), p(a1, y0), p(a1, y1), p(a0, y1), p(a0, y0)])
  }

  boxEdges(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number) {
    const x0 = cx - sx / 2
    const x1 = cx + sx / 2
    const y0 = cy - sy / 2
    const y1 = cy + sy / 2
    const z0 = cz - sz / 2
    const z1 = cz + sz / 2
    this.rect(x0, x1, z0, z1, y0).rect(x0, x1, z0, z1, y1)
    for (const [x, z] of [
      [x0, z0],
      [x1, z0],
      [x1, z1],
      [x0, z1],
    ])
      this.seg(x, y0, z, x, y1, z)
    return this
  }

  circle(cx: number, y: number, cz: number, r: number, n = 20) {
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2
      const a1 = ((i + 1) / n) * Math.PI * 2
      this.seg(cx + Math.cos(a0) * r, y, cz + Math.sin(a0) * r, cx + Math.cos(a1) * r, y, cz + Math.sin(a1) * r)
    }
    return this
  }

  done(): StageGeometry {
    const fill = this.fills.length ? mergeGeometries(this.fills) : null
    for (const g of this.fills) g.dispose()
    let lines: THREE.BufferGeometry | null = null
    if (this.pts.length) {
      lines = new THREE.BufferGeometry()
      lines.setAttribute('position', new THREE.Float32BufferAttribute(this.pts, 3))
    }
    return { fill, lines }
  }
}

/* ------------------------------------------------------------------ */

function excavation() {
  const b = new Builder()
  const y0 = RAFT_BOTTOM
  // Pit floor and battered walls.
  b.flat(-PIT_X, PIT_X, -PIT_Z, PIT_Z, y0)
  b.quad('x', -PIT_X, PIT_X, y0, 0, -PIT_Z).quad('x', -PIT_X, PIT_X, y0, 0, PIT_Z)
  b.quad('z', -PIT_Z, PIT_Z, y0, 0, -PIT_X).quad('z', -PIT_Z, PIT_Z, y0, 0, PIT_X)
  b.rect(-PIT_X, PIT_X, -PIT_Z, PIT_Z, 0).rect(-PIT_X, PIT_X, -PIT_Z, PIT_Z, y0)
  for (const x of [-PIT_X, PIT_X]) for (const z of [-PIT_Z, PIT_Z]) b.seg(x, 0, z, x, y0, z)
  // Survey hatch on the walls.
  for (let x = -PIT_X + 0.5; x < PIT_X; x += 0.5) {
    b.seg(x, 0, PIT_Z, x, y0, PIT_Z).seg(x, 0, -PIT_Z, x, y0, -PIT_Z)
  }
  for (let z = -PIT_Z + 0.5; z < PIT_Z; z += 0.5) {
    b.seg(PIT_X, 0, z, PIT_X, y0, z).seg(-PIT_X, 0, z, -PIT_X, y0, z)
  }
  // Bored piles under every column.
  for (const x of GRID_X)
    for (const z of GRID_Z) {
      b.cylinder(x, PILE_TIP, y0, z, 0.11, 10)
      b.circle(x, y0, z, 0.11, 12).circle(x, PILE_TIP, z, 0.11, 12)
      b.seg(x - 0.11, PILE_TIP, z, x - 0.11, y0, z).seg(x + 0.11, PILE_TIP, z, x + 0.11, y0, z)
    }
  return b.done()
}

function foundation() {
  const b = new Builder()
  const rx = HALF_X + 0.3
  const rz = HALF_Z + 0.3
  const rh = RAFT_TOP - RAFT_BOTTOM
  b.box(0, (RAFT_TOP + RAFT_BOTTOM) / 2, 0, rx * 2, rh, rz * 2).boxEdges(0, (RAFT_TOP + RAFT_BOTTOM) / 2, 0, rx * 2, rh, rz * 2)
  // Rebar mesh on the raft top.
  for (let x = -rx + 0.3; x < rx; x += 0.3) b.seg(x, RAFT_TOP + 0.01, -rz, x, RAFT_TOP + 0.01, rz)
  for (let z = -rz + 0.3; z < rz; z += 0.3) b.seg(-rx, RAFT_TOP + 0.01, z, rx, RAFT_TOP + 0.01, z)
  // Pile caps.
  for (const x of GRID_X) for (const z of GRID_Z) b.rect(x - 0.24, x + 0.24, z - 0.24, z + 0.24, RAFT_TOP + 0.02)
  // Basement retaining walls.
  const t = 0.1
  b.box(0, BASEMENT_Y / 2, HALF_Z + 0.08, HALF_X * 2 + 0.26, -BASEMENT_Y, t)
  b.box(0, BASEMENT_Y / 2, -HALF_Z - 0.08, HALF_X * 2 + 0.26, -BASEMENT_Y, t)
  b.box(HALF_X + 0.08, BASEMENT_Y / 2, 0, t, -BASEMENT_Y, HALF_Z * 2 + 0.26)
  b.box(-HALF_X - 0.08, BASEMENT_Y / 2, 0, t, -BASEMENT_Y, HALF_Z * 2 + 0.26)
  b.rect(-HALF_X - 0.13, HALF_X + 0.13, -HALF_Z - 0.13, HALF_Z + 0.13, 0)
  return b.done()
}

function frame() {
  const b = new Builder()
  // Columns, basement to roof.
  for (let k = -1; k < LEVELS; k++) {
    const y0 = k < 0 ? BASEMENT_Y : levelY(k)
    const y1 = levelY(k + 1)
    for (const x of GRID_X)
      for (const z of GRID_Z) {
        b.box(x, (y0 + y1) / 2, z, COL, y1 - y0, COL)
        const perimeter = x === GRID_X[0] || x === GRID_X[GRID_X.length - 1] || z === GRID_Z[0] || z === GRID_Z[GRID_Z.length - 1]
        if (perimeter) b.seg(x, y0, z, x, y1, z)
      }
  }
  // Slabs and beams, ground to roof.
  for (let k = 0; k <= LEVELS; k++) {
    const y = levelY(k)
    b.box(0, y, 0, HALF_X * 2 + 0.24, SLAB, HALF_Z * 2 + 0.24)
    b.rect(-HALF_X - 0.12, HALF_X + 0.12, -HALF_Z - 0.12, HALF_Z + 0.12, y + SLAB / 2)
    const by = y - SLAB / 2 - 0.02
    for (const z of GRID_Z) b.seg(-HALF_X, by, z, HALF_X, by, z)
    for (const x of GRID_X) b.seg(x, by, -HALF_Z, x, by, HALF_Z)
  }
  // Lift and stair core, middle back bay.
  b.boxEdges(0, (BASEMENT_Y + ROOF_Y + 0.6) / 2, -1.2, 1.0, ROOF_Y + 0.6 - BASEMENT_Y, 0.95)
  b.box(0, ROOF_Y + 0.3, -1.2, 1.0, 0.6, 0.95)
  return b.done()
}

/** One perimeter bay panel per storey with a window (or the entrance door). */
interface Bay {
  axis: 'x' | 'z'
  a0: number
  a1: number
  y0: number
  y1: number
  at: number
  /** Window opening: [a0, a1, y0, y1], or null. */
  win: [number, number, number, number] | null
}

function bays(offset: number): Bay[] {
  const out: Bay[] = []
  for (let k = 0; k < LEVELS; k++) {
    const y0 = levelY(k) + SLAB / 2
    const y1 = levelY(k + 1) - SLAB / 2
    const winY: [number, number] = [y0 + 0.26, y0 + 0.64]
    const along = (axis: 'x' | 'z', lines: number[], at: number) => {
      for (let i = 0; i < lines.length - 1; i++) {
        const a0 = lines[i] + COL / 2
        const a1 = lines[i + 1] - COL / 2
        const c = (a0 + a1) / 2
        const door = k === 0 && axis === 'x' && at > 0 && i === 2
        const w = door ? 0.34 : 0.26
        const win: Bay['win'] = door ? [c - w, c + w, y0, y0 + 0.62] : [c - w, c + w, winY[0], winY[1]]
        out.push({ axis, a0, a1, y0, y1, at, win })
      }
    }
    along('x', GRID_X, HALF_Z + offset)
    along('x', GRID_X, -HALF_Z - offset)
    along('z', GRID_Z, HALF_X + offset)
    along('z', GRID_Z, -HALF_X - offset)
  }
  return out
}

function panelFill(b: Builder, p: Bay) {
  if (!p.win) {
    b.quad(p.axis, p.a0, p.a1, p.y0, p.y1, p.at)
    return
  }
  const [w0, w1, h0, h1] = p.win
  b.quad(p.axis, p.a0, p.a1, p.y0, h0, p.at)
  b.quad(p.axis, p.a0, p.a1, h1, p.y1, p.at)
  b.quad(p.axis, p.a0, w0, h0, h1, p.at)
  b.quad(p.axis, w1, p.a1, h0, h1, p.at)
}

function masonry() {
  const b = new Builder()
  for (const p of bays(0)) {
    panelFill(b, p)
    b.vrect(p.axis, p.a0, p.a1, p.y0, p.y1, p.at)
    if (p.win) {
      const [w0, w1, h0, h1] = p.win
      b.vrect(p.axis, w0, w1, h0, h1, p.at)
      // Lintel over the opening.
      b.vrect(p.axis, w0 - 0.08, w1 + 0.08, h1, h1 + 0.06, p.at)
      // Block courses, split around the opening.
      for (let y = p.y0 + 0.13; y < p.y1 - 0.02; y += 0.13) {
        const inWin = y > h0 && y < h1 + 0.06
        const runs: [number, number][] = inWin ? [[p.a0, w0 - (y > h1 ? 0.08 : 0)], [w1 + (y > h1 ? 0.08 : 0), p.a1]] : [[p.a0, p.a1]]
        for (const [a, c] of runs) {
          if (c - a < 0.02) continue
          if (p.axis === 'x') b.seg(a, y, p.at, c, y, p.at)
          else b.seg(p.at, y, a, p.at, y, c)
        }
      }
    }
  }
  return b.done()
}

function plaster() {
  const b = new Builder()
  for (const p of bays(0.025)) {
    panelFill(b, p)
    if (p.win) b.vrect(p.axis, ...p.win, p.at)
  }
  return b.done()
}

function paint() {
  const b = new Builder()
  for (const p of bays(0.045)) {
    panelFill(b, p)
    if (p.win) b.vrect(p.axis, ...p.win, p.at)
  }
  // Floor bands and corner trims.
  for (let k = 1; k <= LEVELS; k++) b.rect(-HALF_X - 0.17, HALF_X + 0.17, -HALF_Z - 0.17, HALF_Z + 0.17, levelY(k))
  for (const x of [-HALF_X - 0.17, HALF_X + 0.17]) for (const z of [-HALF_Z - 0.17, HALF_Z + 0.17]) b.seg(x, 0, z, x, ROOF_Y, z)
  return b.done()
}

function flooring() {
  const b = new Builder()
  const s = 0.3
  for (let k = 0; k < LEVELS; k++) {
    const y = levelY(k) + SLAB / 2 + 0.008
    for (let x = -HALF_X + s; x < HALF_X - 1e-3; x += s) b.seg(x, y, -HALF_Z, x, y, HALF_Z)
    for (let z = -HALF_Z + s; z < HALF_Z - 1e-3; z += s) b.seg(-HALF_X, y, z, HALF_X, y, z)
  }
  // Roof waterproofing membrane and parapet.
  const ry = ROOF_Y + SLAB / 2 + 0.01
  b.flat(-HALF_X - 0.1, HALF_X + 0.1, -HALF_Z - 0.1, HALF_Z + 0.1, ry)
  const ph = 0.22
  b.quad('x', -HALF_X - 0.12, HALF_X + 0.12, ry, ry + ph, HALF_Z + 0.12).quad('x', -HALF_X - 0.12, HALF_X + 0.12, ry, ry + ph, -HALF_Z - 0.12)
  b.quad('z', -HALF_Z - 0.12, HALF_Z + 0.12, ry, ry + ph, HALF_X + 0.12).quad('z', -HALF_Z - 0.12, HALF_Z + 0.12, ry, ry + ph, -HALF_X - 0.12)
  b.rect(-HALF_X - 0.12, HALF_X + 0.12, -HALF_Z - 0.12, HALF_Z + 0.12, ry + ph)
  for (let x = -HALF_X + 0.6; x < HALF_X; x += 0.6) b.seg(x, ry, -HALF_Z, x, ry, HALF_Z)
  return b.done()
}

function plumbing() {
  const b = new Builder()
  const { x, z } = PLUMB_SHAFT
  const top = ROOF_Y + 0.35
  // Supply and drain risers.
  b.cylinder(x, BASEMENT_Y + 0.3, top, z, 0.05, 8)
  b.cylinder(x + 0.16, BASEMENT_Y, ROOF_Y, z, 0.06, 8)
  b.seg(x, BASEMENT_Y + 0.3, z, x, top, z).seg(x + 0.16, BASEMENT_Y, z, x + 0.16, ROOF_Y, z)
  // Underground sump and overhead tank.
  b.box(2.2, BASEMENT_Y + 0.15, -0.6, 0.9, 0.3, 0.7).boxEdges(2.2, BASEMENT_Y + 0.15, -0.6, 0.9, 0.3, 0.7)
  b.path([
    [2.2, BASEMENT_Y + 0.3, -0.6],
    [2.2, BASEMENT_Y + 0.42, -0.6],
    [x, BASEMENT_Y + 0.42, z],
  ])
  b.cylinder(1.6, ROOF_Y + 0.15, ROOF_Y + 0.7, -1.0, 0.36, 18)
  b.circle(1.6, ROOF_Y + 0.15, -1.0, 0.36, 24).circle(1.6, ROOF_Y + 0.7, -1.0, 0.36, 24)
  b.path([
    [x, top, z],
    [1.6, top, z],
    [1.6, top, -1.0],
  ])
  // Branches per floor to the wet areas.
  for (let k = 0; k < LEVELS; k++) {
    const y = levelY(k) + 0.72
    b.path([
      [x, y, z],
      [x, y, 1.2],
      [-1.8, y, 1.2],
    ])
    b.path([
      [x, y, z],
      [-1.8, y, z],
    ])
    for (const [fx, fz] of [
      [x, 1.2],
      [0.6, 1.2],
      [-1.8, 1.2],
      [-1.8, z],
    ]) {
      b.box(fx, levelY(k) + 0.15, fz, 0.12, 0.16, 0.12)
      b.seg(fx, y, fz, fx, levelY(k) + 0.23, fz)
    }
  }
  return b.done()
}

function electrical() {
  const b = new Builder()
  const { x, z } = ELEC_SHAFT
  // Meter room, transformer and the incoming cable.
  b.box(METER_ROOM.x, 0.3, METER_ROOM.z, 0.9, 0.6, 0.7).boxEdges(METER_ROOM.x, 0.3, METER_ROOM.z, 0.9, 0.6, 0.7)
  b.boxEdges(METER_ROOM.x, 0.22, METER_ROOM.z + 0.75, 0.5, 0.44, 0.4)
  b.path([
    [METER_ROOM.x + 0.45, 0.04, METER_ROOM.z],
    [x, 0.04, METER_ROOM.z],
    [x, 0.04, z],
  ])
  // Earth pits.
  for (const ex of [-4.2, -5.1]) b.circle(ex, 0.02, 2.75, 0.14, 16).circle(ex, 0.02, 2.75, 0.06, 10).seg(ex, 0.02, 2.75, METER_ROOM.x, 0.02, METER_ROOM.z + 0.35)
  // Rising main.
  b.box(x, (BASEMENT_Y + ROOF_Y) / 2, z, 0.1, ROOF_Y - BASEMENT_Y, 0.1).boxEdges(x, (BASEMENT_Y + ROOF_Y) / 2, z, 0.1, ROOF_Y - BASEMENT_Y, 0.1)
  // Per floor: board, then conduit runs to the light points.
  for (let k = 0; k < LEVELS; k++) {
    const y = levelY(k + 1) - SLAB / 2 - 0.05
    b.box(x, levelY(k) + 0.5, z + 0.18, 0.18, 0.24, 0.05)
    b.seg(x, levelY(k) + 0.62, z + 0.18, x, y, z + 0.18)
    for (const lz of [-0.6, 0.6]) {
      b.path([
        [x, y, z + 0.18],
        [x, y, lz],
        [HALF_X - 0.6, y, lz],
      ])
      for (let lx = -1.8; lx < HALF_X; lx += 1.2) b.rect(lx - 0.05, lx + 0.05, lz - 0.05, lz + 0.05, y - 0.01)
    }
  }
  // Lightning protection on the roof.
  b.rect(-HALF_X, HALF_X, -HALF_Z, HALF_Z, ROOF_Y + 0.3)
  b.seg(-HALF_X, ROOF_Y + 0.3, HALF_Z, -HALF_X, 0, HALF_Z)
  return b.done()
}

const builders: Record<Exclude<BuildingStageId, 'monitoring'>, () => StageGeometry> = {
  excavation,
  foundation,
  frame,
  masonry,
  plumbing,
  electrical,
  plaster,
  flooring,
  paint,
}

export function stageGeometry(id: BuildingStageId): StageGeometry {
  return id === 'monitoring' ? { fill: null, lines: null } : builders[id]()
}

/** Planned envelope of the whole tower: level outlines and corner lines, drawn faint as the BIM ghost. */
export function envelopeGeometry() {
  const b = new Builder()
  for (let k = 0; k <= LEVELS; k++) b.rect(-HALF_X, HALF_X, -HALF_Z, HALF_Z, levelY(k))
  b.rect(-HALF_X, HALF_X, -HALF_Z, HALF_Z, BASEMENT_Y)
  for (const x of [-HALF_X, HALF_X]) for (const z of [-HALF_Z, HALF_Z]) b.seg(x, BASEMENT_Y, z, x, ROOF_Y, z)
  return b.done().lines!
}

