import { create } from 'zustand'
import { useApp } from '../../core/store'
import { completionSpecs } from '../../sim/completionSpecs'
import { buildIes, OriginChains, type IesRecord } from '../../sim/ies'
import { Ledger, type LedgerBlock } from '../../sim/ledger'
import type { HumanAction, ReasonCode } from '../../sim/loopCase'
import { createRng, type Rng } from '../../sim/rng'
import {
  CELL,
  CELL_COUNT,
  CELL_HA,
  cellCol,
  cellIndex,
  cellName,
  cellRow,
  cellX,
  cellZ,
  clearingCells,
  insideMask,
  patrolRoute,
} from './layout'

/**
 * Forest concession director.
 * One cycle: aerial scan refreshes the canopy grid, a thermal hotspot persists
 * across frames, a clearing shows up at the boundary edge, the verifier chain
 * runs, a Forest Officer decides, and the response is recorded on a ledger.
 */

export type Phase = 'scan' | 'fire' | 'encroach' | 'verify' | 'approve' | 'respond'

export const phaseSeconds: Record<Phase, number> = {
  scan: 4.6,
  fire: 4.6,
  encroach: 3.6,
  verify: 3.2,
  approve: Infinity,
  respond: 5.4,
}

const order: Phase[] = ['scan', 'fire', 'encroach', 'verify', 'approve', 'respond']

export const spec = completionSpecs.forest
export const approverRole = spec.authority.sign

/** Time inside the current phase. Mutable and non-reactive: the Stage reads it every frame. */
export const timeline = { t: 0 }

/** When each thermal frame lands inside the fire phase, and its confidence. */
export const FRAME_AT = [0.3, 1.3, 2.3, 3.3]
const FRAME_CONF = [0.64, 0.79, 0.87, 0.91]
/** Verifier stages pass at these times inside the verify phase. */
const VERIFY_AT = [1.1, 2.4]

/** Route animation length inside the respond phase. */
export const ROUTE_S = 3.2
export const ROUTE_SAMPLES = 96

interface Scenario {
  hotspot: [number, number]
  edge: number
  u: [number, number]
  depth: number
}

/** Hand-placed so hotspot, clearing and labels never collide on screen. */
const scenarios: Scenario[] = [
  { hotspot: [6, 8], edge: 3, u: [0.3, 0.78], depth: 1.9 },
  { hotspot: [9, 16], edge: 7, u: [0.18, 0.66], depth: 1.9 },
  { hotspot: [5, 14], edge: 6, u: [0.12, 0.9], depth: 1.7 },
  { hotspot: [10, 6], edge: 1, u: [0.3, 0.86], depth: 1.8 },
]

export interface Health {
  healthyPct: number
  meanNdvi: number
  /** Share of inside cells: dense, moderate, sparse, cleared. */
  dist: [number, number, number, number]
  cells: number
}

export interface Decision {
  action: HumanAction
  reason: ReasonCode | null
  modifyId: string | null
  simulated: boolean
  record: IesRecord
}

export interface ForestPayload {
  type: 'patrol_dispatch' | 'rejection' | 'second_pass_request'
  spec: string
  incident: { cell: string; subject_ref: string | null; detection: string; confidence: number; frames: number }
  dispatch: { dispatch_id: string; from: string; to_cell: string; route_km: number; approved_by_role: string } | null
  decision: { observation_id: string; action: HumanAction; reason_code: ReasonCode | null; modify: string | null }
  observations: { observation_id: string; hash: string }[]
}

export interface LedgerEntry {
  block: LedgerBlock
  payload: ForestPayload
}

interface ForestState {
  phase: Phase
  cycle: number
  pass: number
  incidentId: string
  hotspot: number
  clearing: number[]
  frames: number
  confidence: number
  thermal: IesRecord[]
  weather: IesRecord | null
  fire: IesRecord | null
  canopyFrame: IesRecord | null
  clearingRec: IesRecord | null
  areaHa: number
  changePct: number
  verifyStep: number
  decision: Decision | null
  entry: LedgerEntry | null
  entries: LedgerEntry[]
  health: Health
  history: number[]
  tick: (dt: number) => void
  decide: (action: HumanAction, reason: ReasonCode | null, modifyId: string | null, simulated: boolean) => void
  start: () => void
}

// ---------------------------------------------------------------- simulation

const rng = createRng(5150)
const chains = new OriginChains()
export const incidentLedger = new Ledger('forest.incident-ledger')

const uuid = (r: Rng) => {
  const h = () => Math.floor(r.next() * 16).toString(16)
  const s = (n: number) => Array.from({ length: n }, h).join('')
  return `${s(8)}-${s(4)}-4${s(3)}-${'89ab'[Math.floor(r.next() * 4)]}${s(3)}-${s(12)}`
}

const ids = {
  customer: uuid(rng),
  scope: uuid(rng),
  thermalCam: uuid(rng),
  canopyCam: uuid(rng),
  weather: uuid(rng),
  fireMethod: uuid(rng),
  changeMethod: uuid(rng),
  officer: uuid(rng),
}

let logPosition = 71200

const ingest = (at: Date) => ({
  customer_id: ids.customer,
  log_position: ++logPosition,
  observation_id: uuid(rng),
  arrived_at: at,
  believed_at: at,
})

const later = (d: Date, ms: number) => new Date(d.getTime() + ms)

/** Baseline canopy index per cell, and the latest pass. */
export const baseline = new Float32Array(CELL_COUNT)
export const latest = new Float32Array(CELL_COUNT)

for (let i = 0; i < CELL_COUNT; i++) {
  const x = cellX(cellCol(i))
  const z = cellZ(cellRow(i))
  let v = 0.66 + 0.14 * Math.sin(x * 0.5 + z * 0.3) + 0.07 * Math.cos(x * 1.3 - z * 0.9) + rng.range(-0.05, 0.05)
  // A stream valley with thinner canopy.
  const stream = Math.abs(z - (1.6 * Math.sin(x * 0.36 + 0.4) + 0.6))
  if (stream < 0.7) v -= 0.26 * (1 - stream / 0.7)
  baseline[i] = Math.min(0.9, Math.max(0.3, v))
}
latest.set(baseline)

function computeHealth(values: Float32Array): Health {
  let n = 0
  let sum = 0
  const dist: [number, number, number, number] = [0, 0, 0, 0]
  for (let i = 0; i < CELL_COUNT; i++) {
    if (!insideMask[i]) continue
    const v = values[i]
    n++
    sum += v
    dist[v >= 0.7 ? 0 : v >= 0.5 ? 1 : v >= 0.3 ? 2 : 3]++
  }
  const share = dist.map((d) => d / n) as Health['dist']
  return { healthyPct: share[0] + share[1], meanNdvi: sum / n, dist: share, cells: n }
}

function seedHistory(): number[] {
  const base = computeHealth(baseline).meanNdvi
  const out: number[] = []
  let v = base + 0.012
  for (let i = 0; i < 23; i++) {
    v += rng.range(-0.006, 0.004)
    out.push(Number(v.toFixed(3)))
  }
  return out
}

function scenarioCells(cycle: number) {
  const s = scenarios[cycle % scenarios.length]
  return { hotspot: cellIndex(s.hotspot[0], s.hotspot[1]), clearing: clearingCells(s.edge, s.u[0], s.u[1], s.depth) }
}

/** Values the next aerial pass will report. */
function preparePass(clearing: number[]) {
  const cleared = new Set(clearing)
  for (let i = 0; i < CELL_COUNT; i++) {
    latest[i] = cleared.has(i) ? rng.range(0.08, 0.17) : Math.min(0.92, Math.max(0.28, baseline[i] + rng.range(-0.03, 0.025)))
  }
}

function thermalFrame(cell: number, frame: number, at: Date): IesRecord {
  return buildIes(
    chains,
    {
      origin_id: ids.thermalCam,
      sense: { origin: ids.thermalCam, sensor: 'thermal_camera', device_counter: 4000 + logPosition, frame },
      kind: 'measurement',
      claim: { quantity: 'brightness_temp_k', value: rng.int(352, 410), cell: cellName(cell), frame, subject_ref: null },
      scope_ref: ids.scope,
      occurred_at: at,
      lineage: null,
    },
    ingest(later(at, rng.int(600, 1800))),
  )
}

function weatherContext(at: Date): IesRecord {
  return buildIes(
    chains,
    {
      origin_id: ids.weather,
      sense: { origin: ids.weather, sensor: 'weather_station' },
      kind: 'measurement',
      claim: {
        quantity: 'fire_weather',
        temp_c: rng.int(31, 38),
        rh_pct: rng.int(18, 34),
        wind_ms: Number(rng.range(2, 6.5).toFixed(1)),
        subject_ref: null,
      },
      scope_ref: ids.scope,
      occurred_at: at,
      lineage: null,
    },
    ingest(later(at, rng.int(400, 1200))),
  )
}

function fireDetection(cell: number, frames: IesRecord[], weather: IesRecord, confidence: number, at: Date): IesRecord {
  return buildIes(
    chains,
    {
      origin_id: ids.fireMethod,
      sense: { model: 'fire_detector@v2' },
      kind: 'detection',
      claim: {
        class: 'fire',
        confidence,
        frames: frames.length,
        cell: cellName(cell),
        inside_boundary: insideMask[cell],
        subject_ref: uuid(rng),
      },
      scope_ref: ids.scope,
      occurred_at: frames[0] ? new Date(frames[0].occurred_at) : at,
      lineage: {
        input: [...frames.map((f) => f.observation_id), weather.observation_id],
        method: 'fire_detector',
        version: 'v2',
        config: { min_frames: 2, min_confidence: 0.85, max_frame_gap_min: 5 },
      },
    },
    ingest(at),
  )
}

function canopyFrame(pass: number, at: Date): IesRecord {
  return buildIes(
    chains,
    {
      origin_id: ids.canopyCam,
      sense: { origin: ids.canopyCam, sensor: 'canopy_camera', platform: 'aerial_pass', pass },
      kind: 'measurement',
      claim: { quantity: 'canopy_index_grid', cells: CELL_COUNT, cell_size_m: 100, subject_ref: null },
      scope_ref: ids.scope,
      occurred_at: at,
      lineage: null,
    },
    ingest(later(at, rng.int(900, 2400))),
  )
}

function clearingDetection(cells: number[], frame: IesRecord, areaHa: number, changePct: number, at: Date): IesRecord {
  return buildIes(
    chains,
    {
      origin_id: ids.changeMethod,
      sense: { model: 'canopy_change@v1' },
      kind: 'detection',
      claim: {
        class: 'canopy_loss',
        confidence: Number(rng.range(0.88, 0.95).toFixed(2)),
        area_ha: areaHa,
        change_vs_baseline_pct: changePct,
        cells: cells.map(cellName),
        at_boundary_edge: true,
        subject_ref: uuid(rng),
      },
      scope_ref: ids.scope,
      occurred_at: new Date(frame.occurred_at),
      lineage: { input: [frame.observation_id], method: 'canopy_change', version: 'v1', config: { baseline_window_days: 90, min_drop_pct: 40 } },
    },
    ingest(at),
  )
}

function verification(fire: IesRecord, action: HumanAction, reason: ReasonCode | null, at: Date): IesRecord {
  return buildIes(
    chains,
    {
      origin_id: ids.officer,
      sense: { method: 'approval_console', role: approverRole },
      kind: 'verification',
      claim: { action, reason_code: reason, spec: spec.id, evidence: [fire.observation_id, ...(fire.lineage?.input ?? [])], subject_ref: fire.subject_ref },
      scope_ref: ids.scope,
      occurred_at: at,
      lineage: { input: [fire.observation_id], method: 'human_review', version: 'v1', config: { role: approverRole } },
    },
    ingest(at),
  )
}

const routeBuf = new Float32Array(ROUTE_SAMPLES * 3)
/** Route length in km (1 world unit = 100 m / CELL). */
const routeKm = (cell: number) => Number(((patrolRoute(cell, ROUTE_SAMPLES, routeBuf) * 0.1) / CELL).toFixed(1))

function payloadFor(cell: number, fire: IesRecord, d: Decision, extra: IesRecord[]): ForestPayload {
  const claim = fire.claim as { confidence: number; frames: number }
  const type = d.action === 'accept' ? 'patrol_dispatch' : d.action === 'reject' ? 'rejection' : 'second_pass_request'
  return {
    type,
    spec: spec.id,
    incident: { cell: cellName(cell), subject_ref: fire.subject_ref, detection: fire.observation_id, confidence: claim.confidence, frames: claim.frames },
    dispatch:
      d.action === 'accept'
        ? { dispatch_id: rng.id('dsp', 10), from: 'ranger_post_1', to_cell: cellName(cell), route_km: routeKm(cell), approved_by_role: approverRole }
        : null,
    decision: { observation_id: d.record.observation_id, action: d.action, reason_code: d.reason, modify: d.modifyId },
    observations: [...extra, fire, d.record].map((r) => ({ observation_id: r.observation_id, hash: r.hash })),
  }
}

/** A few earlier incidents so the ledger has history. */
function seedLedger(): LedgerEntry[] {
  const out: LedgerEntry[] = []
  const now = Date.now()
  const past: [number, HumanAction, ReasonCode | null][] = [
    [cellIndex(7, 12), 'accept', null],
    [cellIndex(3, 9), 'reject', 'equipment'],
    [cellIndex(11, 17), 'accept', null],
  ]
  past.forEach(([cell, action, reason], k) => {
    const at = new Date(now - (52 - k * 14) * 3600_000)
    const frames = [thermalFrame(cell, 1, at), thermalFrame(cell, 2, later(at, 60_000))]
    const w = weatherContext(at)
    const fire = fireDetection(cell, frames, w, 0.9, later(at, 70_000))
    const record = verification(fire, action, reason, later(at, 400_000))
    const payload = payloadFor(cell, fire, { action, reason, modifyId: null, simulated: true, record }, [...frames, w])
    out.push({ block: incidentLedger.append(payload, later(at, 410_000)), payload })
  })
  return out
}

const ticker = (level: 'info' | 'ok' | 'alert', text: string) => useApp.getState().pushTicker({ level, text })

export const approvalCopy = {
  title: 'Confirm fire incident',
  modify: [{ id: 'second', label: 'Request second pass' }],
}

export const outcomeWord = (action: HumanAction) =>
  action === 'accept'
    ? 'Incident confirmed. Patrol dispatch recorded.'
    : action === 'reject'
      ? 'Not dispatched. Rejection recorded.'
      : 'Second pass requested. No dispatch yet.'

const first = scenarioCells(0)
preparePass(first.clearing)

export const useForest = create<ForestState>((set, get) => ({
  phase: 'scan',
  cycle: 0,
  pass: 41,
  incidentId: rng.id('inc'),
  hotspot: first.hotspot,
  clearing: first.clearing,
  frames: 0,
  confidence: 0,
  thermal: [],
  weather: null,
  fire: null,
  canopyFrame: null,
  clearingRec: null,
  areaHa: 0,
  changePct: 0,
  verifyStep: 0,
  decision: null,
  entry: null,
  entries: seedLedger(),
  health: computeHealth(baseline),
  history: seedHistory(),

  tick: (dt) => {
    const s = get()
    const t0 = timeline.t
    const t = t0 + dt
    timeline.t = t
    const crossed = (at: number) => t0 < at && t >= at

    if (s.phase === 'fire') {
      FRAME_AT.forEach((at, k) => {
        if (crossed(at)) onFrame(k + 1)
      })
    } else if (s.phase === 'verify') {
      VERIFY_AT.forEach((at, k) => {
        if (crossed(at)) onVerifyStage(k + 1)
      })
    }

    if (t >= phaseSeconds[s.phase]) enter(order[(order.indexOf(s.phase) + 1) % order.length])
  },

  decide: (action, reason, modifyId, simulated) => {
    const s = get()
    if (s.phase !== 'approve' || !s.fire) return
    const at = new Date()
    const record = verification(s.fire, action, reason, at)
    const decision: Decision = { action, reason, modifyId, simulated, record }
    const extra = [...s.thermal, ...(s.weather ? [s.weather] : [])]
    const payload = payloadFor(s.hotspot, s.fire, decision, extra)
    const block = incidentLedger.append(payload, at)
    const entry = { block, payload }
    const who = simulated ? `${approverRole} (simulated)` : approverRole
    ticker(action === 'reject' ? 'alert' : 'ok', `${who}: ${action}${reason && action === 'reject' ? ` (${reason})` : ''}`)
    set({ decision, entry, entries: [...s.entries, entry].slice(-8) })
    enter('respond')
  },

  start: () => {
    const s = get()
    if (s.phase === 'scan' && timeline.t < 0.25) return
    enter('scan')
  },
}))

function onFrame(frame: number) {
  const s = useForest.getState()
  const at = new Date()
  const rec = thermalFrame(s.hotspot, frame, at)
  const thermal = [...s.thermal, rec]
  const confidence = FRAME_CONF[frame - 1]
  const name = cellName(s.hotspot)
  if (frame === 1) {
    const weather = weatherContext(at)
    useForest.setState({ frames: frame, confidence, thermal, weather })
    ticker('alert', `Thermal anomaly, cell ${name}, frame 1`)
    return
  }
  if (frame === 2) ticker('info', `Persists 2 frames inside boundary, cell ${name}`)
  if (frame === FRAME_AT.length) {
    const fire = fireDetection(s.hotspot, thermal, s.weather ?? weatherContext(at), confidence, at)
    useForest.setState({ frames: frame, confidence, thermal, fire })
    ticker('alert', `IES detection recorded: fire, conf ${confidence.toFixed(2)}, ${frame} frames`)
    return
  }
  useForest.setState({ frames: frame, confidence, thermal })
}

function onVerifyStage(step: number) {
  useForest.setState({ verifyStep: step })
  ticker('info', step === 1 ? 'Verifier: rules pass (frames, boundary, confidence)' : `Verifier: ${spec.verifierChain[1]} agrees`)
}

function enter(phase: Phase) {
  const s = useForest.getState()
  timeline.t = 0
  switch (phase) {
    case 'scan': {
      const cycle = s.phase === 'scan' ? s.cycle : s.cycle + 1
      const next = scenarioCells(cycle)
      preparePass(next.clearing)
      useForest.setState({
        phase,
        cycle,
        pass: s.pass + 1,
        incidentId: rng.id('inc'),
        hotspot: next.hotspot,
        clearing: next.clearing,
        frames: 0,
        confidence: 0,
        thermal: [],
        weather: null,
        fire: null,
        canopyFrame: null,
        clearingRec: null,
        areaHa: 0,
        changePct: 0,
        verifyStep: 0,
        decision: null,
        entry: null,
      })
      ticker('info', `Aerial pass ${s.pass + 1}: refreshing ${CELL_COUNT} canopy cells`)
      return
    }
    case 'fire': {
      const health = computeHealth(latest)
      useForest.setState({ phase, health, history: [...s.history, Number(health.meanNdvi.toFixed(3))].slice(-24) })
      return
    }
    case 'encroach': {
      const at = new Date()
      const frame = canopyFrame(s.pass, at)
      let base = 0
      let now = 0
      for (const i of s.clearing) {
        base += baseline[i]
        now += latest[i]
      }
      const changePct = -Math.round(((base - now) / base) * 100)
      const areaHa = Number((s.clearing.length * CELL_HA * rng.range(0.86, 0.97)).toFixed(1))
      const rec = clearingDetection(s.clearing, frame, areaHa, changePct, later(at, 1200))
      useForest.setState({ phase, canopyFrame: frame, clearingRec: rec, areaHa, changePct })
      ticker('alert', `Canopy loss at boundary edge: ${areaHa} ha, ${changePct}% vs baseline`)
      return
    }
    case 'verify':
      ticker('info', `Verifier chain: ${spec.verifierChain.join(' → ')}`)
      break
    case 'approve':
      useForest.setState({ verifyStep: 2 })
      ticker('alert', `Awaiting ${approverRole}`)
      break
    case 'respond': {
      const d = s.decision
      const e = s.entry
      if (d && e) {
        const level = d.action === 'reject' ? 'alert' : 'ok'
        ticker(level, `Ledger #${e.block.seq} sealed. ${outcomeWord(d.action)}`)
        if (d.action === 'accept') ticker('ok', `Cell ${cellName(s.hotspot)} under response, route ${e.payload.dispatch?.route_km} km`)
      }
      break
    }
  }
  useForest.setState({ phase })
}

export { cellName }
