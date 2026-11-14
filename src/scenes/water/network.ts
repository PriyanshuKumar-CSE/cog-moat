import * as THREE from 'three'
import { createRng } from '../../sim/rng'

/**
 * Spatial layout of the Water scene: an elevated service reservoir (ESR)
 * feeds a trunk main, which branches into three District Metered Areas.
 * Each DMA has a bulk inlet meter, a spine main, three streets with
 * consumer meters (mixed brands) and pressure loggers at the junctions.
 *
 * World units. Ground is y = 0, pipes run at PIPE_Y.
 */

export const PIPE_Y = 0.06
export const DMA_COUNT = 3
export const DMA_CX = [-4.1, 0, 4.1] as const
export const DMA_HALF_W = 1.8
export const DMA_Z0 = -2.0
export const DMA_Z1 = 3.15
export const TRUNK_Z = -3.4
export const INLET_Z = -2.75
export const STREET_Z = [-1.0, 0.6, 2.2] as const
export const STREET_HALF = 1.6
export const METER_X = [0.55, 1.2] as const
export const SERVICE_DZ = 0.3
export const TANK = new THREE.Vector3(-6.5, 0, -5.9)
export const TANK_RISER_TOP = 1.55

/** Centre x of the whole composition; the camera and ledger centre on it. */
export const CENTER_X = -0.9

export type PipeKind = 'trunk' | 'branch' | 'main' | 'service'

export interface Segment {
  index: number
  a: THREE.Vector3
  b: THREE.Vector3
  kind: PipeKind
  /** DMA the segment belongs to, -1 for the shared trunk. */
  dma: number
  /** DMAs whose water passes through this segment. */
  carries: number[]
  len: number
  /** Asset reference shown in records, e.g. "S-2.3". */
  ref: string
}

export interface ConsumerMeter {
  pos: THREE.Vector3
  dma: number
  brand: 0 | 1 | 2
}

export interface PressureLogger {
  pos: THREE.Vector3
  dma: number
  street: number
}

export interface Building {
  pos: THREE.Vector3
  size: THREE.Vector3
  /** Inside a DMA (brighter) or the ghost city around it. */
  inside: boolean
}

export const brandNames = ['brand A', 'brand B', 'brand C'] as const

const v = (x: number, z: number, y = PIPE_Y) => new THREE.Vector3(x, y, z)

function build() {
  const segments: Segment[] = []
  const add = (a: THREE.Vector3, b: THREE.Vector3, kind: PipeKind, dma: number, carries: number[], ref: string) => {
    segments.push({ index: segments.length, a, b, kind, dma, carries, len: a.distanceTo(b), ref })
    return segments.length - 1
  }

  // Riser from the tank, a run forward to the trunk line, then the trunk main,
  // split at each branch so flow drops after every take-off.
  add(v(TANK.x, TANK.z, TANK_RISER_TOP), v(TANK.x, TANK.z), 'trunk', -1, [0, 1, 2], 'RS-1')
  add(v(TANK.x, TANK.z), v(TANK.x, TRUNK_Z), 'trunk', -1, [0, 1, 2], 'TM-0')
  add(v(TANK.x, TRUNK_Z), v(DMA_CX[0], TRUNK_Z), 'trunk', -1, [0, 1, 2], 'TM-1')
  add(v(DMA_CX[0], TRUNK_Z), v(DMA_CX[1], TRUNK_Z), 'trunk', -1, [1, 2], 'TM-2')
  add(v(DMA_CX[1], TRUNK_Z), v(DMA_CX[2], TRUNK_Z), 'trunk', -1, [2], 'TM-3')

  /** streetSegments[dma][street][side] -> segment index. */
  const streetSegments: number[][][] = []
  const meters: ConsumerMeter[] = []
  const loggers: PressureLogger[] = []
  const buildings: Building[] = []
  const rng = createRng(4417)

  for (let d = 0; d < DMA_COUNT; d++) {
    const cx = DMA_CX[d]
    add(v(cx, TRUNK_Z), v(cx, DMA_Z0), 'branch', d, [d], `BR-${d + 1}`)
    let z0 = DMA_Z0
    STREET_Z.forEach((z, s) => {
      add(v(cx, z0), v(cx, z), 'main', d, [d], `SP-${d + 1}.${s + 1}`)
      z0 = z
    })
    streetSegments[d] = []
    STREET_Z.forEach((z, s) => {
      streetSegments[d][s] = []
      for (const side of [-1, 1]) {
        const k = s * 2 + (side < 0 ? 0 : 1)
        streetSegments[d][s].push(add(v(cx, z), v(cx + side * STREET_HALF, z), 'main', d, [d], `S-${d + 1}.${k + 1}`))
        METER_X.forEach((mx, j) => {
          const x = cx + side * mx
          add(v(x, z), v(x, z + SERVICE_DZ), 'service', d, [d], `SV-${d + 1}.${k + 1}.${j + 1}`)
          meters.push({ pos: v(x, z + SERVICE_DZ, 0.12), dma: d, brand: ((s * 4 + k + j + d) % 3) as 0 | 1 | 2 })
          buildings.push({ pos: v(x, z + 0.64, 0), size: new THREE.Vector3(0.46, rng.range(0.28, 0.85), 0.42), inside: true })
        })
      }
      loggers.push({ pos: v(cx + 0.2, z - 0.2, 0), dma: d, street: s })
    })
    // Back row of the first street: buildings without consumer meters.
    for (const side of [-1, 1]) {
      METER_X.forEach((mx) => {
        buildings.push({ pos: v(cx + side * mx, STREET_Z[0] - 0.52, 0), size: new THREE.Vector3(0.46, rng.range(0.3, 0.7), 0.4), inside: true })
      })
    }
  }

  // Ghost city around the network.
  for (let gx = -11.5; gx <= 9.5; gx += 1.1) {
    for (let gz = -7.5; gz <= 6.0; gz += 1.1) {
      const inNetwork = gx > -6.3 && gx < 6.3 && gz > -3.95 && gz < 3.6
      const inTank = gx > -8.0 && gx < -5.0 && gz > -7.4 && gz < -2.8
      if (inNetwork || inTank || rng.chance(0.45)) continue
      const h = rng.range(0.2, 1.2) * (1 - Math.min(1, Math.hypot(gx - CENTER_X, gz) / 16) * 0.5)
      buildings.push({ pos: v(gx + rng.range(-0.15, 0.15), gz + rng.range(-0.15, 0.15), 0), size: new THREE.Vector3(rng.range(0.4, 0.75), h, rng.range(0.4, 0.75)), inside: false })
    }
  }

  return { segments, streetSegments, meters, loggers, buildings }
}

export const network = build()

/** Flow segments get particles; service stubs are drawn as lines only. */
export const flowSegments = network.segments.filter((s) => s.kind !== 'service')

/** Position of the leak along its street segment, from the spine outward. */
export const LEAK_U = 0.58

export function leakPoint(segIndex: number, out = new THREE.Vector3()) {
  const s = network.segments[segIndex]
  return out.copy(s.a).lerp(s.b, LEAK_U)
}

export const inletPos = (dma: number) => v(DMA_CX[dma], INLET_Z, PIPE_Y)

/** Ledger chain: a row of blocks floating behind the network. Newest on the right. */
export const LEDGER_Y = 2.5
export const LEDGER_Z = -7.4
export const LEDGER_X = CENTER_X + 0.9
export const LEDGER_SPACING = 1.6
export const LEDGER_VISIBLE = 6

export const ledgerSlot = (k: number, out = new THREE.Vector3()) =>
  out.set(LEDGER_X + (k - (LEDGER_VISIBLE - 1) / 2) * LEDGER_SPACING, LEDGER_Y, LEDGER_Z)

/** Height of the anomaly marker above the leak. */
export const MARKER_Y = 2.3
