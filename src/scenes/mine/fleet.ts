import { JUNCTION_D, routes } from './layout'

/**
 * Discrete haul-cycle simulation: queue, load, haul, dump, return.
 * Pure data, stepped at a fixed rate, so the replayed scenario is the same
 * every cycle. Nothing here allocates per step.
 */

export type TruckState = 'queue' | 'load' | 'haul' | 'dump' | 'return' | 'transfer'

export interface Truck {
  /** Index into the instanced mesh. */
  slot: number
  /** Fleet number shown as "T<id>". */
  id: number
  loader: 0 | 1
  /** Loader to switch to at the next safe point, or -1. */
  pending: -1 | 0 | 1
  state: TruckState
  /** Route distance from the dump. */
  d: number
  timer: number
  /** Payload as % of rated, set at loading. */
  payload: number
  /** 0..1 visual fill of the tray. */
  fill: number
  /** Seconds spent queued for the current load. */
  waited: number
}

export const SIM = {
  /** Simulated minutes per real second. */
  MIN_PER_S: 1,
  V_LOADED: 3.0,
  V_EMPTY: 4.4,
  V_CREEP: 1.6,
  LOAD_S: 3.2,
  DUMP_S: 1.2,
  QUEUE_GAP: 0.85,
  RATED_T: 200,
  STEP: 1 / 60,
} as const

/** Fleet numbers. T14 and T9 are the trucks named in the scenario. */
const FLEET_IDS = [3, 4, 5, 6, 7, 8, 9, 11, 12, 14, 15, 16, 17, 18, 21]

export interface DumpEvent {
  truck: Truck
  loader: 0 | 1
  payload: number
  waitedMin: number
}

export interface LoaderStats {
  assigned: number
  queued: number
  /** Fraction of the hour the loader is loading, from trucks working it and their cycle time (smoothed). */
  busy: number
  /** EMA of trucks in the queue. */
  queueEma: number
  /** Expected wait for the next arriving truck, simulated minutes. */
  waitMin: number
}

/** Unqueued truck cycle time on a loader's route, seconds. */
export const cycleTime = (i: 0 | 1) => routes[i].length / SIM.V_LOADED + routes[i].length / SIM.V_EMPTY + SIM.LOAD_S + SIM.DUMP_S

export class Fleet {
  trucks: Truck[] = []
  lines: [Truck[], Truck[]] = [[], []]
  stats: [LoaderStats, LoaderStats] = [
    { assigned: 0, queued: 0, busy: 0, queueEma: 0, waitMin: 0 },
    { assigned: 0, queued: 0, busy: 0, queueEma: 0, waitMin: 0 },
  ]
  /** EMA of fraction of trucks not queued. */
  utilisation = 0
  dumps = 0
  tonnes = 0
  loaderTonnes: [number, number] = [0, 0]
  onDump: ((e: DumpEvent) => void) | null = null
  private acc = 0
  private seq = 0
  private payloads = [91, 88, 95, 86, 93, 97, 89, 92, 84, 94, 90, 96, 87, 93, 91, 88, 95]

  constructor() {
    this.reset()
  }

  /** Lays the fleet out in the 10:30 situation: Loader 1 over-trucked, Loader 2 short. */
  reset() {
    this.trucks = FLEET_IDS.map((id, slot) => ({ slot, id, loader: 0, pending: -1, state: 'return', d: 0, timer: 0, payload: 0, fill: 0, waited: 0 }))
    this.lines = [[], []]
    this.dumps = 0
    this.tonnes = 0
    this.loaderTonnes = [0, 0]
    this.seq = 0
    this.acc = 0
    const L = routes.map((r) => r.length)
    // Loader 1: eleven trucks. One loading, three queued, the rest spread on the road.
    const l1 = this.trucks.slice(0, 11)
    const l2 = this.trucks.slice(11)
    const place = (t: Truck, loader: 0 | 1, state: TruckState, d: number, fill = 0) => {
      t.loader = loader
      t.state = state
      t.d = d
      t.fill = fill
      t.payload = fill > 0 ? this.nextPayload() : 0
    }
    place(l1[0], 0, 'load', L[0], 0.3)
    l1[0].timer = SIM.LOAD_S * 0.7
    for (let k = 1; k <= 2; k++) place(l1[k], 0, 'queue', L[0] - SIM.QUEUE_GAP * k)
    this.lines[0].push(l1[0], l1[1], l1[2])
    const spread1: [TruckState, number][] = [
      ['haul', 0.12],
      ['return', 0.6],
      ['haul', 0.62],
      ['return', 0.55],
      ['haul', 0.28],
      ['return', 0.2],
      ['haul', 0.85],
      ['return', 0.4],
    ]
    spread1.forEach(([s, u], k) => place(l1[3 + k], 0, s, u * L[0], s === 'haul' ? 1 : 0))
    // Loader 2: four trucks, evenly spread so the loader waits on trucks.
    const spread2: [TruckState, number][] = [
      ['return', 0.45],
      ['haul', 0.3],
      ['return', 0.92],
      ['haul', 0.78],
    ]
    spread2.forEach(([s, u], k) => place(l2[k], 1, s, u * L[1], s === 'haul' ? 1 : 0))
    this.stats[0] = { assigned: 11, queued: 2, busy: 0.95, queueEma: 2.4, waitMin: 2.4 * SIM.LOAD_S * SIM.MIN_PER_S }
    this.stats[1] = { assigned: 4, queued: 0, busy: (4 * SIM.LOAD_S) / cycleTime(1), queueEma: 0, waitMin: 0 }
    this.utilisation = 0.8
  }

  private nextPayload() {
    return this.payloads[this.seq++ % this.payloads.length]
  }

  byId(id: number) {
    return this.trucks.find((t) => t.id === id)!
  }

  /** Swaps fleet numbers so the scenario names land on the right trucks. */
  swapIds(a: Truck, id: number) {
    const b = this.byId(id)
    if (a === b) return
    b.id = a.id
    a.id = id
  }

  /** Asks a truck to move to another loader. It goes as soon as it is safe to. */
  reassign(t: Truck, loader: 0 | 1) {
    if (t.loader === loader) {
      t.pending = -1
      return
    }
    t.pending = loader
    const line = this.lines[t.loader]
    if (t.state === 'queue') {
      line.splice(line.indexOf(t), 1)
      t.state = 'transfer'
    } else if (t.state === 'return' && t.d > JUNCTION_D) {
      t.state = 'transfer'
    }
  }

  advance(dt: number) {
    this.acc += Math.min(dt, 0.1)
    while (this.acc >= SIM.STEP) {
      this.acc -= SIM.STEP
      this.step(SIM.STEP)
    }
  }

  private step(dt: number) {
    let queued = 0
    const q: [number, number] = [0, 0]
    const assigned: [number, number] = [0, 0]
    const working: [number, number] = [0, 0]
    for (const t of this.trucks) {
      this.stepTruck(t, dt)
      assigned[t.pending === -1 ? t.loader : t.pending]++
      if (t.pending === -1 && t.state !== 'transfer') working[t.loader]++
      if (t.state === 'queue') {
        queued++
        q[t.loader]++
        t.waited += dt
      }
    }
    const k = 1 - Math.exp(-dt / 3)
    const kBusy = 1 - Math.exp(-dt / 2.5)
    this.utilisation += (1 - queued / this.trucks.length - this.utilisation) * k
    for (const i of [0, 1] as const) {
      const s = this.stats[i]
      s.assigned = assigned[i]
      s.queued = q[i]
      s.busy += (Math.min(1, (working[i] * SIM.LOAD_S) / cycleTime(i)) - s.busy) * kBusy
      s.queueEma += (q[i] - s.queueEma) * k
      s.waitMin = s.queueEma * SIM.LOAD_S * SIM.MIN_PER_S
    }
  }

  /** Steady-state trips per simulated hour for the current assignment. */
  modelTripsPerHour() {
    let perS = 0
    for (const i of [0, 1] as const) perS += Math.min(this.stats[i].assigned / cycleTime(i), 1 / SIM.LOAD_S)
    return (perS * 60) / SIM.MIN_PER_S
  }

  private stepTruck(t: Truck, dt: number) {
    const L = routes[t.loader].length
    switch (t.state) {
      case 'haul': {
        t.d -= SIM.V_LOADED * dt
        if (t.pending !== -1 && t.d <= JUNCTION_D) this.applyPending(t)
        if (t.d <= 0) {
          t.d = 0
          t.state = 'dump'
          t.timer = SIM.DUMP_S
        }
        break
      }
      case 'dump': {
        t.timer -= dt
        t.fill = Math.max(0, t.timer / SIM.DUMP_S)
        if (t.timer <= 0) this.finishDump(t)
        break
      }
      case 'return': {
        if (t.pending !== -1 && t.d <= JUNCTION_D) this.applyPending(t)
        const line = this.lines[t.loader]
        const joinAt = routes[t.loader].length - SIM.QUEUE_GAP * (line.length + 0.6)
        t.d += SIM.V_EMPTY * dt
        if (t.d >= joinAt) {
          line.push(t)
          t.state = 'queue'
          t.waited = 0
        }
        break
      }
      case 'queue': {
        const line = this.lines[t.loader]
        const idx = line.indexOf(t)
        const target = L - SIM.QUEUE_GAP * idx
        if (t.d < target) t.d = Math.min(target, t.d + SIM.V_CREEP * dt)
        else if (t.d > target) t.d = target
        if (idx === 0 && t.d >= L - 0.001) {
          t.state = 'load'
          t.timer = SIM.LOAD_S
          t.payload = this.nextPayload()
        }
        break
      }
      case 'load': {
        t.timer -= dt
        t.fill = 1 - Math.max(0, t.timer / SIM.LOAD_S)
        if (t.timer <= 0) {
          t.fill = 1
          this.lines[t.loader].shift()
          t.state = 'haul'
        }
        break
      }
      case 'transfer': {
        t.d -= SIM.V_EMPTY * 0.8 * dt
        if (t.d <= JUNCTION_D) {
          this.applyPending(t)
          t.state = 'return'
        }
        break
      }
    }
  }

  private applyPending(t: Truck) {
    if (t.pending === -1) return
    t.loader = t.pending
    t.pending = -1
  }

  private finishDump(t: Truck) {
    t.fill = 0
    t.state = 'return'
    this.dumps++
    const tonnes = (t.payload / 100) * SIM.RATED_T
    this.tonnes += tonnes
    this.loaderTonnes[t.loader] += tonnes
    this.onDump?.({ truck: t, loader: t.loader, payload: t.payload, waitedMin: t.waited * SIM.MIN_PER_S })
  }
}
