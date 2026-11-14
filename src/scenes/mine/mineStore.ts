import { create } from 'zustand'
import { deployments } from '../../config/content'
import { useApp } from '../../core/store'
import { completionSpecs } from '../../sim/completionSpecs'
import { buildIes, OriginChains, type IesRecord } from '../../sim/ies'
import type { HumanAction, ReasonCode } from '../../sim/loopCase'
import { createRng } from '../../sim/rng'
import { Fleet, SIM, type DumpEvent, type Truck } from './fleet'
import { JUNCTION_D } from './layout'

/**
 * Mine director. Replays the 10:40 dispatch case from Cognecto's notes:
 * Situation, Recommendation, Human decision, Measured outcome.
 * The scheduler only recommends; nothing moves until a person decides.
 */

export type Phase = 'situation' | 'recommend' | 'approve' | 'outcome' | 'learn'

export const phaseSeconds: Record<Phase, number> = {
  situation: 6,
  recommend: 3.5,
  approve: Infinity,
  outcome: 10,
  learn: 3.5,
}

const order: Phase[] = ['situation', 'recommend', 'approve', 'outcome', 'learn']

/** Flow steps shown in the Decision panel. */
export const flowSteps = [
  { id: 'situation', title: 'Situation' },
  { id: 'recommend', title: 'Recommendation' },
  { id: 'approve', title: 'Human decision' },
  { id: 'outcome', title: 'Measured outcome' },
] as const

export const phaseFlow: Record<Phase, number> = { situation: 0, recommend: 1, approve: 2, outcome: 3, learn: 3 }

export const site = deployments.find((d) => d.id === 'in-nagpur')!
export const spec = completionSpecs.mine
export const APPROVER = 'Shift In-charge'
export const REC_TRUCK = 14
export const ALT_TRUCK = 9
export const loaderName = (i: 0 | 1) => `Loader ${i + 1}`
/** Loader 2 idle share above which its work queue is flagged (amber). */
export const L2_ALERT_IDLE = 0.5

/** Simulated clock: minutes after midnight. */
const START_MIN = 10 * 60 + 34
const SHIFT_START = 6 * 60
const SHIFT_END = 14 * 60
/** Average payload across the payload table, as a fraction of rated. */
const AVG_LOAD_T = 0.91 * SIM.RATED_T
const BASE_TRIPS = 132
const BASE_TONNES = 24020
/** Calibrated against the replay so the gap reads about 400 t at 10:40. */
const TARGET_MARGIN = 300

export const fmtClock = (min: number) => {
  const m = Math.floor(min) % (24 * 60)
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

export interface LoaderMetrics {
  assigned: number
  queued: number
  waitMin: number
  /** Fraction of time the loader waits on trucks. */
  idle: number
}

export interface Metrics {
  clock: number
  utilisation: number
  /** Trucks queued right now. */
  idleTrucks: number
  loaders: [LoaderMetrics, LoaderMetrics]
  trips: number
  tph: number
  tonnes: number
  plan: number
  target: number
  forecast: number
  /** Tonnes moved per sample, for the production chart (one sample per sim minute). */
  history: { min: number; tonnes: number }[]
  spark: number[]
}

export interface Snapshot {
  clock: number
  l1Wait: number
  l2Idle: number
  tph: number
  utilisation: number
  forecastGap: number
}

export interface Decision {
  action: HumanAction
  reason: ReasonCode | null
  modifyId: string | null
  simulated: boolean
  at: number
  record: IesRecord
}

export interface VerifiedTrip {
  trip: number
  truck: number
  loader: 0 | 1
  payload: number
  gpsGapS: number
  confidence: number
  at: number
  load: IesRecord
  track: IesRecord
  dump: IesRecord
  derived: IesRecord
}

export interface HistoryRow {
  at: string
  rec: string
  action: HumanAction
  reason: ReasonCode | null
  note: string
  outcome: string
}

interface MineState {
  phase: Phase
  t: number
  cycle: number
  metrics: Metrics
  before: Snapshot | null
  after: Snapshot | null
  decision: Decision | null
  verified: VerifiedTrip | null
  /** Truck that actually moved this cycle, if any. */
  moved: number | null
  wetRoad: boolean
  history: HistoryRow[]
  tick: (dt: number) => void
  decide: (action: HumanAction, reason: ReasonCode | null, modifyId: string | null, simulated: boolean) => void
}

// Non-reactive simulation state.
export const fleet = new Fleet()
const rng = createRng(4021)
const chains = new OriginChains()
let logPosition = 91200

const uuid = () => {
  const h = () => Math.floor(rng.next() * 16).toString(16)
  const s = (n: number) => Array.from({ length: n }, h).join('')
  return `${s(8)}-${s(4)}-4${s(3)}-${'89ab'[Math.floor(rng.next() * 4)]}${s(3)}-${s(12)}`
}

const ids = {
  customer: uuid(),
  pit: uuid(),
  correlator: uuid(),
  dumpFence: uuid(),
  person: uuid(),
  scheduler: uuid(),
  trucks: new Map<number, string>(),
}
const truckOrigin = (id: number) => {
  let o = ids.trucks.get(id)
  if (!o) {
    o = uuid()
    ids.trucks.set(id, o)
  }
  return o
}

/** Visual fade used when the scenario restarts (0 hidden, 1 shown). */
export const replay = { fade: 1 }

const ticker = (level: 'info' | 'ok' | 'alert', text: string) => useApp.getState().pushTicker({ level, text })

// Smoothed values updated every frame, published to the store a few times a second.
const live = {
  clock: START_MIN,
  tph: 0,
  /** Trip rate from actual dumps (8 s kernel), for the sparkline. */
  measured: 0,
  target: 0,
  publishIn: 0,
  sparkIn: 0,
  historyIn: 0,
  spark: [] as number[],
  history: [] as { min: number; tonnes: number }[],
  verifyArmed: true,
}

const tonnesNow = () => BASE_TONNES + fleet.tonnes
const hoursLeft = (clock: number) => Math.max(0, (SHIFT_END - clock) / 60)
const planAt = (clock: number, target: number) => (target * (clock - SHIFT_START)) / (SHIFT_END - SHIFT_START)

function seedHistory(): { min: number; tonnes: number }[] {
  const out: { min: number; tonnes: number }[] = []
  const perMin = BASE_TONNES / (START_MIN - SHIFT_START)
  for (let m = SHIFT_START; m <= START_MIN; m += 6) {
    const k = (m - SHIFT_START) / (START_MIN - SHIFT_START)
    // Slow start after shift change, then steady.
    const wobble = Math.sin(k * 9) * 160 + (k < 0.15 ? -k * 900 : -135)
    out.push({ min: m, tonnes: Math.max(0, perMin * (m - SHIFT_START) + wobble * Math.min(1, k * 4) * (1 - k)) })
  }
  out[out.length - 1].tonnes = BASE_TONNES
  return out
}

function computeMetrics(): Metrics {
  const s = fleet.stats
  const tonnes = tonnesNow()
  const forecast = tonnes + live.tph * AVG_LOAD_T * hoursLeft(live.clock)
  return {
    clock: live.clock,
    utilisation: fleet.utilisation,
    idleTrucks: s[0].queued + s[1].queued,
    loaders: [
      { assigned: s[0].assigned, queued: s[0].queued, waitMin: s[0].waitMin, idle: 1 - s[0].busy },
      { assigned: s[1].assigned, queued: s[1].queued, waitMin: s[1].waitMin, idle: 1 - s[1].busy },
    ],
    trips: BASE_TRIPS + fleet.dumps,
    tph: live.tph,
    tonnes,
    plan: planAt(live.clock, live.target),
    target: live.target,
    forecast,
    history: live.history,
    spark: live.spark,
  }
}

function snapshot(m: Metrics): Snapshot {
  return {
    clock: m.clock,
    l1Wait: m.loaders[0].waitMin,
    l2Idle: m.loaders[1].idle,
    tph: m.tph,
    utilisation: m.utilisation,
    forecastGap: m.forecast - m.target,
  }
}

/** Puts the replay back to 10:34 with Loader 1 over-trucked. */
function resetScenario() {
  fleet.reset()
  live.clock = START_MIN
  live.tph = fleet.modelTripsPerHour()
  live.measured = live.tph
  // Plan for the shift, set so the 10:40 forecast misses it by about 400 t (Cognecto's example).
  live.target = Math.round((BASE_TONNES + live.tph * AVG_LOAD_T * hoursLeft(START_MIN) + TARGET_MARGIN) / 100) * 100
  live.history = seedHistory()
  live.spark = Array.from({ length: 24 }, (_, i) => live.tph + Math.sin(i * 1.7) * 0.6 - 0.4)
  live.publishIn = 0
  live.sparkIn = 1
  live.historyIn = 3
  live.verifyArmed = true
}

fleet.onDump = (e) => onDump(e)

function onDump(e: DumpEvent) {
  live.measured += 60 / 8
  const s = useMine.getState()
  if (!live.verifyArmed || s.phase !== 'situation' || s.t < 2.2) return
  live.verifyArmed = false
  const v = buildVerifiedTrip(e)
  useMine.setState({ verified: v })
  ticker('ok', `Trip #${v.trip} verified: load, haul, dump, payload ${v.payload}%. Counted.`)
}

const seededHistory: HistoryRow[] = [
  {
    at: '09:12',
    rec: 'Move T6 to Loader 2',
    action: 'reject',
    reason: 'weather',
    note: 'Haul road to Loader 2 wet',
    outcome: 'Road flagged wet in the scheduler until cleared',
  },
  {
    at: '08:05',
    rec: 'Move T3 to Loader 2',
    action: 'modify',
    reason: 'other',
    note: 'Sent T11 instead',
    outcome: 'Trips/h +1.9, queue -2.4 min',
  },
]

function initialMetrics() {
  resetScenario()
  return computeMetrics()
}

export const useMine = create<MineState>((set, get) => ({
  phase: 'situation',
  t: 0,
  cycle: 0,
  metrics: initialMetrics(),
  before: null,
  after: null,
  decision: null,
  verified: null,
  moved: null,
  wetRoad: false,
  history: seededHistory,

  tick: (dt) => {
    stepSim(dt)
    const s = get()
    const limit = phaseSeconds[s.phase]
    const t = s.t + dt
    if (t < limit) {
      set({ t })
      return
    }
    enter(order[(order.indexOf(s.phase) + 1) % order.length])
  },

  decide: (action, reason, modifyId, simulated) => {
    const s = get()
    if (s.phase !== 'approve') return
    const at = live.clock
    const record = decisionRecord(action, reason, modifyId, at)
    const before = snapshot(computeMetrics())
    let moved: number | null = null
    if (action === 'accept') moved = REC_TRUCK
    if (action === 'modify') moved = ALT_TRUCK
    if (moved !== null) fleet.reassign(fleet.byId(moved), 1)
    set({ decision: { action, reason, modifyId, simulated, at, record }, before, moved, wetRoad: action === 'reject' && reason === 'weather' })
    const who = simulated ? `${APPROVER} (simulated)` : APPROVER
    const what = action === 'accept' ? 'accept' : action === 'modify' ? 'modify, send T9 instead' : `reject (${reason})`
    ticker(action === 'reject' ? 'alert' : 'ok', `${who}: ${what}`)
    enter('outcome')
  },
}))

function stepSim(dt: number) {
  const d = Math.min(dt, 0.1)
  fleet.advance(d)
  live.clock += d * SIM.MIN_PER_S
  const k = 1 - Math.exp(-d / 2.5)
  live.tph += (fleet.modelTripsPerHour() - live.tph) * k
  live.measured *= Math.exp(-d / 8)

  live.sparkIn -= d
  if (live.sparkIn <= 0) {
    live.sparkIn = 1
    live.spark = [...live.spark.slice(-23), live.measured]
  }
  live.historyIn -= d
  if (live.historyIn <= 0) {
    live.historyIn = 3
    live.history = [...live.history, { min: live.clock, tonnes: tonnesNow() }]
  }
  live.publishIn -= d
  if (live.publishIn <= 0) {
    live.publishIn = 0.25
    useMine.setState({ metrics: computeMetrics() })
  }

  // Replay fade: trucks dissolve at the end of a cycle and return at the start.
  const { phase, t } = useMine.getState()
  if (phase === 'learn') replay.fade = Math.max(0, Math.min(1, (phaseSeconds.learn - t) / 0.6))
  else if (phase === 'situation') replay.fade = Math.min(1, t / 0.6)
  else replay.fade = 1
}

/** Picks which physical trucks carry the scenario's names this cycle. */
function castTrucks() {
  const line = fleet.lines[0]
  const queued = line.filter((t) => t.state === 'queue')
  const rec: Truck | undefined = queued[queued.length - 1] ?? line[line.length - 1]
  if (rec) fleet.swapIds(rec, REC_TRUCK)
  const l1 = fleet.trucks.filter((t) => t.loader === 0 && t.id !== REC_TRUCK && t.pending === -1)
  // Truck 9 is one already heading back empty, well clear of the Loader 1 queue.
  const alt =
    l1.filter((t) => t.state === 'return' && t.d < JUNCTION_D * 0.8).sort((a, b) => b.d - a.d)[0] ??
    l1.filter((t) => t.state === 'haul').sort((a, b) => a.d - b.d)[0] ??
    l1.find((t) => t.state !== 'load')
  if (alt) fleet.swapIds(alt, ALT_TRUCK)
}

function enter(phase: Phase) {
  const s = useMine.getState()
  switch (phase) {
    case 'situation': {
      resetScenario()
      useMine.setState({ phase, t: 0, cycle: s.cycle + 1, before: null, after: null, decision: null, moved: null, wetRoad: false, history: seededHistory, metrics: computeMetrics() })
      ticker('info', `${fmtClock(live.clock)} Pit replay: ${fleet.trucks.length} trucks on 2 loaders, payload and GPS streaming`)
      return
    }
    case 'recommend': {
      castTrucks()
      const m = computeMetrics()
      ticker('alert', `${fmtClock(m.clock)} Loader 1: ${m.loaders[0].queued} trucks queued. Loader 2 waiting on trucks.`)
      ticker('info', `Scheduler recommends T${REC_TRUCK} to Loader 2. Recommendation only.`)
      useMine.setState({ phase, t: 0, metrics: m })
      return
    }
    case 'approve':
      ticker('alert', `Awaiting ${APPROVER}`)
      break
    case 'outcome': {
      const d = s.decision
      if (d?.action === 'accept') ticker('info', `T${REC_TRUCK} leaves the Loader 1 queue for Loader 2`)
      if (d?.action === 'modify') ticker('info', `T${ALT_TRUCK} re-routed to Loader 2 on its way back. T${REC_TRUCK} stays.`)
      if (d?.action === 'reject') ticker('alert', `Rejected (${d.reason}): ${reasonNote(d.reason)}. Stored.`)
      break
    }
    case 'learn': {
      const after = snapshot(computeMetrics())
      const d = s.decision
      const b = s.before
      if (d && b) {
        const row: HistoryRow = {
          at: fmtClock(d.at),
          rec: `Move T${REC_TRUCK} to Loader 2`,
          action: d.action,
          reason: d.reason,
          note: d.action === 'modify' ? `Sent T${ALT_TRUCK} instead` : d.action === 'reject' ? reasonNote(d.reason) : 'Moved as recommended',
          outcome: outcomeLine(b, after, d.action),
        }
        useMine.setState({ phase, t: 0, after, history: [row, ...s.history].slice(0, 4) })
        ticker(d.action === 'reject' ? 'info' : 'ok', `Measured: L1 wait ${b.l1Wait.toFixed(1)} → ${after.l1Wait.toFixed(1)} min, trips/h ${b.tph.toFixed(1)} → ${after.tph.toFixed(1)}`)
        return
      }
      useMine.setState({ phase, t: 0, after })
      return
    }
  }
  useMine.setState({ phase, t: 0 })
}

export function reasonNote(r: ReasonCode | null) {
  if (r === 'weather') return 'Haul road to Loader 2 wet'
  if (r === 'safety') return 'Safety hold on Loader 2 bench'
  if (r === 'operator') return 'Operator change due'
  if (r === 'equipment') return 'Loader 2 service due'
  return 'Other, see note'
}

export function outcomeLine(b: Snapshot, a: Snapshot, action: HumanAction) {
  const q = `Loader 1 queue ${b.l1Wait.toFixed(1)} → ${a.l1Wait.toFixed(1)} min`
  const tr = `trips/h ${b.tph.toFixed(1)} → ${a.tph.toFixed(1)}`
  if (action === 'reject') return `${q}, ${tr}. No truck moved.`
  return `${q}, ${tr}`
}

/** Called when the scene mounts, so a visit always starts at the top of the story. */
let lastStart = -Infinity
export function startMine() {
  // React StrictMode mounts twice in development; start the story once.
  const now = performance.now()
  if (now - lastStart < 500) return
  lastStart = now
  enter('situation')
}

function decisionRecord(action: HumanAction, reason: ReasonCode | null, modifyId: string | null, clock: number): IesRecord {
  const at = simDate(clock)
  return buildIes(
    chains,
    {
      origin_id: ids.person,
      sense: { method: 'approval_console', role: APPROVER },
      kind: 'verification',
      claim: {
        action,
        reason_code: reason,
        recommendation: { truck: `T${REC_TRUCK}`, from: 'loader_1', to: 'loader_2', by: 'scheduler' },
        modify: modifyId === 't9' ? { truck: `T${ALT_TRUCK}`, to: 'loader_2' } : null,
        subject_ref: ids.pit,
      },
      scope_ref: ids.pit,
      occurred_at: at,
      lineage: { input: [uuid()], method: 'human_review', version: 'v1', config: { role: APPROVER } },
    },
    ingest(at),
  )
}

function ingest(at: Date) {
  return { customer_id: ids.customer, log_position: ++logPosition, observation_id: uuid(), arrived_at: new Date(at.getTime() + 1200), believed_at: new Date(at.getTime() + 1200) }
}

/** Simulated wall time for a clock value, on today's date (IST). */
function simDate(clock: number) {
  const d = new Date()
  const utcMin = clock - 330
  d.setUTCHours(0, 0, 0, 0)
  return new Date(d.getTime() + utcMin * 60_000 + Math.floor(rng.next() * 59_000))
}

function buildVerifiedTrip(e: DumpEvent): VerifiedTrip {
  const truck = `T${e.truck.id}`
  const origin = truckOrigin(e.truck.id)
  const trip = BASE_TRIPS + fleet.dumps
  const subject = uuid()
  const gpsGapS = rng.int(18, 74)
  const confidence = Number(rng.range(0.93, 0.98).toFixed(2))
  const dumpAt = simDate(live.clock)
  const loadAt = new Date(dumpAt.getTime() - rng.int(15, 19) * 60_000)
  const loader = e.loader === 0 ? 'loader_1' : 'loader_2'
  const load = buildIes(
    chains,
    {
      origin_id: origin,
      sense: { sensor: 'payload_strut_pressure', truck },
      kind: 'measurement',
      claim: { quantity: 'payload_pct_rated', value: e.payload, rated_t: SIM.RATED_T, event: 'load', at: loader, subject_ref: subject },
      scope_ref: ids.pit,
      occurred_at: loadAt,
      lineage: null,
    },
    ingest(loadAt),
  )
  const track = buildIes(
    chains,
    {
      origin_id: origin,
      sense: { sensor: 'gnss', truck, rate_hz: 0.5 },
      kind: 'measurement',
      claim: { quantity: 'gps_track', points: rng.int(380, 470), max_gap_s: gpsGapS, distance_km: 4.2, subject_ref: subject },
      scope_ref: ids.pit,
      occurred_at: new Date(dumpAt.getTime() - 20_000),
      lineage: null,
    },
    ingest(dumpAt),
  )
  const dump = buildIes(
    chains,
    {
      origin_id: ids.dumpFence,
      sense: { sensor: 'dump_zone_geofence', truck },
      kind: 'detection',
      claim: { class: 'dump_event', zone: 'dump_b', in_zone: true, confidence: Number(rng.range(0.95, 0.99).toFixed(2)), subject_ref: subject },
      scope_ref: ids.pit,
      occurred_at: dumpAt,
      lineage: null,
    },
    ingest(dumpAt),
  )
  const derivedAt = new Date(dumpAt.getTime() + 4000)
  const derived = buildIes(
    chains,
    {
      origin_id: ids.correlator,
      sense: { model: 'trip_correlator@v3' },
      kind: 'detection',
      claim: {
        class: 'haul_trip',
        confidence,
        truck,
        load_event: true,
        dump_in_zone: true,
        payload_pct: e.payload,
        gps_gap_s: gpsGapS,
        spec: spec.id,
        subject_ref: subject,
      },
      scope_ref: ids.pit,
      occurred_at: dumpAt,
      lineage: {
        input: [load.observation_id, track.observation_id, dump.observation_id],
        method: 'trip_correlator',
        version: 'v3',
        config: { min_payload_pct: 80, max_gps_gap_s: 180, min_confidence: 0.9 },
      },
    },
    ingest(derivedAt),
  )
  return { trip, truck: e.truck.id, loader: e.loader, payload: e.payload, gpsGapS, confidence, at: live.clock, load, track, dump, derived }
}
