import { create } from 'zustand'
import { MONITORING, builtPct, stages } from './stages'

/**
 * Project control for the Building scene: crews, attendance, machines, hire
 * hours, truck trips, and progress against plan, as Vision AI would measure
 * them on this site. Everything here is simulated and pure, driven by a site
 * clock, so the HUD, the 3D site and the tests agree.
 *
 * The site clock runs a working day from 08:00 to 18:00 and then starts the
 * next day. Real figures from Cognecto's live screens live in content.ts.
 */

export type Lens = 'quality' | 'control'

/* ------------------------------------------------------------------ */
/* Site clock                                                          */
/* ------------------------------------------------------------------ */

export const DAY_START_MIN = 8 * 60
export const DAY_MINUTES = 10 * 60
/** Site minutes per real second. A working day plays in 50 s. */
export const SITE_MIN_PER_S = 12
/** Lunch break, minutes into the day. */
const LUNCH: [number, number] = [5 * 60, 5 * 60 + 45]

export const clockLabel = (minute: number) => {
  const m = DAY_START_MIN + Math.floor(minute)
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** Deterministic hash noise in [0, 1). */
function hash(...xs: number[]) {
  let h = 2166136261
  for (const x of xs) {
    h ^= Math.floor(x * 1000) | 0
    h = Math.imul(h, 16777619)
  }
  h ^= h >>> 13
  h = Math.imul(h, 0x5bd1e995)
  h ^= h >>> 15
  return (h >>> 0) / 4294967296
}

/* ------------------------------------------------------------------ */
/* Per-milestone site plan                                             */
/* ------------------------------------------------------------------ */

export interface Crew {
  name: string
  size: number
  /** Typical share of on-site time spent working, 0..1. */
  share: number
  /** Where the crew stands in the 3D site. */
  spot: 'ground' | 'front'
}

export interface Hire {
  machine: string
  billed_h: number
  worked_h: number
}

export interface SitePlan {
  crews: Crew[]
  /** Names on the contractor's muster roll for the day. */
  muster: number
  /** The hired machine billed against this milestone. */
  hire: Hire
  /** Inbound material trips planned for a day, and what they carry. */
  trips: number
  material: string
  /** Unit of work for cost per unit, and the measured rate against the BOQ rate. */
  unit: string
  costVsBoq: number
}

const plans: SitePlan[] = [
  {
    crews: [
      { name: 'Piling', size: 10, share: 0.56, spot: 'front' },
      { name: 'Earthwork', size: 6, share: 0.48, spot: 'ground' },
    ],
    muster: 19,
    hire: { machine: 'Excavator', billed_h: 96, worked_h: 81 },
    trips: 14,
    material: 'muck out, steel cages in',
    unit: 'm³ excavated',
    costVsBoq: 0.031,
  },
  {
    crews: [
      { name: 'Rebar', size: 14, share: 0.61, spot: 'front' },
      { name: 'Shuttering', size: 10, share: 0.52, spot: 'ground' },
    ],
    muster: 27,
    hire: { machine: 'Concrete pump', billed_h: 64, worked_h: 52 },
    trips: 12,
    material: 'ready-mix, steel',
    unit: 'm³ concrete',
    costVsBoq: 0.024,
  },
  {
    crews: [
      { name: 'Rebar', size: 16, share: 0.64, spot: 'front' },
      { name: 'Shuttering', size: 14, share: 0.49, spot: 'ground' },
    ],
    muster: 33,
    hire: { machine: 'Tower crane', billed_h: 212, worked_h: 168 },
    trips: 12,
    material: 'ready-mix, steel, plywood',
    unit: 'm³ concrete',
    costVsBoq: 0.038,
  },
  {
    crews: [
      { name: 'Masons', size: 18, share: 0.58, spot: 'front' },
      { name: 'Helpers', size: 12, share: 0.44, spot: 'ground' },
    ],
    muster: 34,
    hire: { machine: 'Tower crane', billed_h: 180, worked_h: 151 },
    trips: 10,
    material: 'AAC blocks, sand, cement',
    unit: 'm² wall',
    costVsBoq: 0.052,
  },
  {
    crews: [
      { name: 'Plumbers', size: 8, share: 0.6, spot: 'front' },
      { name: 'Helpers', size: 6, share: 0.47, spot: 'ground' },
    ],
    muster: 16,
    hire: { machine: 'Builder hoist', billed_h: 120, worked_h: 104 },
    trips: 6,
    material: 'CPVC, fittings, tanks',
    unit: 'point',
    costVsBoq: 0.018,
  },
  {
    crews: [
      { name: 'Electricians', size: 8, share: 0.62, spot: 'front' },
      { name: 'Helpers', size: 4, share: 0.5, spot: 'ground' },
    ],
    muster: 14,
    hire: { machine: 'Builder hoist', billed_h: 110, worked_h: 97 },
    trips: 5,
    material: 'conduit, cable, boards',
    unit: 'point',
    costVsBoq: 0.012,
  },
  {
    crews: [
      { name: 'Plasterers', size: 16, share: 0.57, spot: 'front' },
      { name: 'Helpers', size: 10, share: 0.45, spot: 'ground' },
    ],
    muster: 29,
    hire: { machine: 'Builder hoist', billed_h: 160, worked_h: 131 },
    trips: 9,
    material: 'sand, cement, mesh',
    unit: 'm² plaster',
    costVsBoq: 0.041,
  },
  {
    crews: [
      { name: 'Tilers', size: 12, share: 0.6, spot: 'front' },
      { name: 'Waterproofing', size: 6, share: 0.53, spot: 'ground' },
    ],
    muster: 20,
    hire: { machine: 'Builder hoist', billed_h: 140, worked_h: 122 },
    trips: 7,
    material: 'tiles, adhesive, membrane',
    unit: 'm² floor',
    costVsBoq: 0.027,
  },
  {
    crews: [
      { name: 'Painters', size: 14, share: 0.63, spot: 'front' },
      { name: 'Scaffold', size: 4, share: 0.42, spot: 'ground' },
    ],
    muster: 20,
    hire: { machine: 'Facade gondola', billed_h: 96, worked_h: 88 },
    trips: 4,
    material: 'paint, primer',
    unit: 'm² facade',
    costVsBoq: 0.015,
  },
]

/** Site plan for a stage, or null after handover (no site works). */
export const sitePlan = (stage: number): SitePlan | null => (stage >= 0 && stage < MONITORING ? plans[stage] : null)

/** Hire hours queried before the RA bill: billed but not seen working. */
export const queriedHours = (h: Hire) => h.billed_h - h.worked_h

/* ------------------------------------------------------------------ */
/* What Vision AI measures at a moment of the day                      */
/* ------------------------------------------------------------------ */

const inLunch = (minute: number) => minute >= LUNCH[0] && minute < LUNCH[1]

/** Share of the crew on site at a minute: arrive in the first hour, leave in the last. */
function presence(minute: number) {
  if (minute < 40) return 0.35 + (minute / 40) * 0.65
  if (minute > DAY_MINUTES - 30) return Math.max(0.2, (DAY_MINUTES - minute) / 30)
  return 1
}

/** Workers counted on site at a minute, by crew. A few names on the muster roll never show. */
export function headcount(stage: number, minute: number, day: number) {
  const p = sitePlan(stage)
  if (!p) return { byCrew: [] as number[], total: 0 }
  const byCrew = p.crews.map((c, k) => {
    const absent = 1 + Math.floor(hash(day, stage, k) * 2)
    return Math.round((c.size - absent) * presence(minute))
  })
  return { byCrew, total: byCrew.reduce((a, b) => a + b, 0) }
}

/** Peak head-count of the day, for the muster roll comparison. */
export const peakHeadcount = (stage: number, day: number) => headcount(stage, DAY_MINUTES / 2, day).total

/** Is worker `i` of crew `k` working (true) or idle (false) at this minute? Changes every 10 site minutes. */
export function isWorking(stage: number, k: number, i: number, minute: number, day: number) {
  const p = sitePlan(stage)
  if (!p || inLunch(minute)) return false
  const slot = Math.floor(minute / 10)
  return hash(day, stage, k, i, slot) < p.crews[k].share
}

/** Productive share of the crews at a minute, over the workers on site. */
export function productiveShare(stage: number, minute: number, day: number) {
  const p = sitePlan(stage)
  if (!p) return { total: 0, byCrew: [] as number[] }
  const counts = headcount(stage, minute, day).byCrew
  let work = 0
  let all = 0
  const byCrew = p.crews.map((_, k) => {
    let w = 0
    for (let i = 0; i < counts[k]; i++) if (isWorking(stage, k, i, minute, day)) w++
    work += w
    all += counts[k]
    return counts[k] ? w / counts[k] : 0
  })
  return { total: all ? work / all : 0, byCrew }
}

/** Productive share over the day so far, overall and by crew, sampled every 10 minutes outside lunch. */
export function productiveSoFar(stage: number, minute: number, day: number) {
  const p = sitePlan(stage)
  const crews = p ? p.crews.length : 0
  const work = new Array<number>(crews).fill(0)
  const seen = new Array<number>(crews).fill(0)
  for (let m = 0; m <= minute; m += 10) {
    if (inLunch(m)) continue
    const counts = headcount(stage, m, day).byCrew
    for (let k = 0; k < crews; k++) {
      for (let i = 0; i < counts[k]; i++) if (isWorking(stage, k, i, m, day)) work[k]++
      seen[k] += counts[k]
    }
  }
  const all = seen.reduce((a, b) => a + b, 0)
  return {
    total: all ? work.reduce((a, b) => a + b, 0) / all : 0,
    byCrew: work.map((w, k) => (seen[k] ? w / seen[k] : 0)),
  }
}

/** Hourly head-count from 08:00 up to this minute. */
export function hourlyHeadcount(stage: number, minute: number, day: number) {
  const out: number[] = []
  for (let m = 0; m <= minute; m += 30) out.push(inLunch(m) ? Math.round(headcount(stage, m, day).total * 0.4) : headcount(stage, m, day).total)
  return out
}

/** State of the milestone's main machine at a minute. Changes every 15 site minutes. */
export type MachineState = 'working' | 'idle' | 'parked'

export function machineState(stage: number, minute: number, day: number): MachineState {
  if (!sitePlan(stage)) return 'parked'
  if (inLunch(minute) || minute < 20) return 'parked'
  const r = hash(day, stage, 99, Math.floor(minute / 15))
  return r < 0.66 ? 'working' : r < 0.86 ? 'idle' : 'parked'
}

/** Hours working, idle and parked so far today. */
export function machineHours(stage: number, minute: number, day: number) {
  const h = { working: 0, idle: 0, parked: 0 }
  for (let m = 0; m < minute; m += 5) h[machineState(stage, m, day)] += 5 / 60
  return h
}

/* ------------------------------------------------------------------ */
/* Material trips                                                      */
/* ------------------------------------------------------------------ */

/** Two trucks share the day's trips. A trip loop takes TRIP_MIN site minutes. */
export const TRUCKS = 2
export const TRIP_MIN = 80
/** Fraction of a trip loop at which the truck reaches the stockyard and the trip is logged. */
export const ARRIVE_AT = 0.42
const truckOffset = (j: number) => 25 + (j * TRIP_MIN) / TRUCKS

/** Loop position 0..1 of truck `j` at a minute, or null while it is off site. */
export function truckPhase(stage: number, j: number, minute: number): number | null {
  const p = sitePlan(stage)
  if (!p) return null
  const since = minute - truckOffset(j)
  if (since < 0) return null
  const loop = Math.floor(since / TRIP_MIN)
  if (loop * TRUCKS + j >= p.trips) return null
  return (since % TRIP_MIN) / TRIP_MIN
}

/** Trips logged at the gate so far today (a trip counts when the truck reaches the stockyard). */
export function tripsSoFar(stage: number, minute: number) {
  const p = sitePlan(stage)
  if (!p) return 0
  let n = 0
  for (let j = 0; j < TRUCKS; j++) {
    const since = minute - truckOffset(j) - ARRIVE_AT * TRIP_MIN
    if (since < 0) continue
    n += Math.floor(since / TRIP_MIN) + 1
  }
  return Math.min(n, p.trips)
}

/** Minute of the day Photon sees a worker without a helmet, and how long the flag stays up. */
export const PPE_AT = 200
export const PPE_FOR = 30

/** Truck number shown on the tag. */
export const truckId = (j: number) => `TRK-${14 + j * 7}`

/* ------------------------------------------------------------------ */
/* Progress against plan (S-curve)                                     */
/* ------------------------------------------------------------------ */

/** Simulated programme length for the tower, in weeks. */
export const PROJECT_WEEKS = 78

/** Planned cumulative progress, % of BOQ, at a week. */
export function plannedPct(week: number) {
  const u = Math.min(1, Math.max(0, week / PROJECT_WEEKS))
  // Smootherstep: slow mobilisation, fast frame, slow finishes.
  return 100 * u * u * u * (u * (u * 6 - 15) + 10)
}

/** Slip in weeks against plan once `pct` of the work is done: it grows through the frame and masonry, then is partly recovered. */
function slipWeeks(pct: number) {
  const x = pct / 100
  return 0.15 + 1.6 * Math.exp(-Math.pow((x - 0.5) / 0.22, 2))
}

/** Week at which a progress % is planned to be reached. */
function plannedWeekOf(pct: number) {
  let lo = 0
  let hi = PROJECT_WEEKS
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (plannedPct(mid) < pct) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/** Measured cumulative progress at a week: the plan, shifted by the slip. */
export function measuredPct(week: number) {
  // Fixed point: measured(w) = planned(w - slip(measured(w))).
  let m = plannedPct(week)
  for (let i = 0; i < 8; i++) m = plannedPct(week - slipWeeks(m))
  return m
}

export interface Progress {
  /** Week of the programme now. */
  week: number
  planned: number
  measured: number
  /** Days behind plan, rounded. */
  slipDays: number
}

/** Where the project stands while milestone `stage` is under verification (its work is physically done). */
export function progressAt(stage: number): Progress {
  if (stage >= MONITORING) return { week: PROJECT_WEEKS, planned: 100, measured: 100, slipDays: 0 }
  const done = builtPct(stage) + stages[stage].weight
  const slip = slipWeeks(done)
  const week = Math.min(PROJECT_WEEKS, plannedWeekOf(done) + slip)
  return { week, planned: plannedPct(week), measured: done, slipDays: Math.round(slip * 7) }
}

/** Slippage is flagged once it passes this many days. */
export const SLIP_FLAG_DAYS = 5

/* ------------------------------------------------------------------ */
/* Store                                                               */
/* ------------------------------------------------------------------ */

interface ControlState {
  lens: Lens
  /** Minutes since 08:00 on the current site day. */
  minute: number
  day: number
  setLens: (lens: Lens) => void
  advance: (dt: number) => void
}

export const useControl = create<ControlState>((set, get) => ({
  lens: 'quality',
  minute: 150,
  day: 1,
  setLens: (lens) => set({ lens }),
  advance: (dt) => {
    const s = get()
    const minute = s.minute + dt * SITE_MIN_PER_S
    if (minute >= DAY_MINUTES) set({ minute: 0, day: s.day + 1 })
    else set({ minute })
  },
}))
