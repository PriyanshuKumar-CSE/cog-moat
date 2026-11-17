import { create } from 'zustand'
import { useApp } from '../../core/store'
import { OriginChains, type IesRecord } from '../../sim/ies'
import { Ledger, type LedgerBlock } from '../../sim/ledger'
import type { HumanAction, ReasonCode } from '../../sim/loopCase'
import { createRng } from '../../sim/rng'
import { createBuildingCase, createBuildingDecision, type BuildingCase } from './buildingCase'
import { queriedHours, sitePlan } from './control'
import { MONITORING, stageIndex, stages } from './stages'
import { FIRST_STAGE, RELEASE_AT, SEAL_AT, phaseSeconds, scanU, type Phase } from './timing'

/**
 * Building scene director. One milestone per cycle:
 * scan -> plan vs as-built -> verifier chain -> human gate -> settle -> time-lapse to the next milestone.
 * An accepted milestone moves the build on; a rejection or hold repeats it after rework.
 * After paint the building is handed over and structural health monitoring runs one cycle,
 * then a new project starts from excavation.
 */

export { FIRST_STAGE, RELEASE_AT, SCAN_END, SCAN_START, SEAL_AT, phaseSeconds, scanU, type Phase } from './timing'

const order: Phase[] = ['scan', 'plan', 'verify', 'approve', 'settle', 'reset']
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

export interface Decision {
  action: HumanAction
  reason: ReasonCode | null
  modifyId: string | null
  simulated: boolean
  record: IesRecord
}

export interface BuildingCertificate {
  certificate_id: string
  spec: string
  milestone: string
  result: 'verified'
  checks: { check: string; value: string; plan: string; ok: boolean }[]
  snags_logged: { observation_id: string; class: string; location: string; vlm_confirmed: boolean }[]
  /** Hire hours billed for the milestone, checked against hours Vision AI saw the machine working. */
  hire_check: { machine: string; billed_h: number; worked_h: number; queried_h: number } | null
  settles: string
  evidence: { observation_id: string; hash: string }[]
  approved_by_role: string
  issued_at: string
}

export interface WorkOrder {
  work_order_id: string
  spec: string
  trigger: { sensor: string; observation_id: string; reading: string; limit: string }
  action: string
  assigned_role: string
  due_within_h: number
  evidence: { observation_id: string; hash: string }[]
  raised_by_role: string
  issued_at: string
}

export interface BuildingPayload {
  type: 'settlement' | 'work_order' | 'rejection' | 'hold'
  certificate: BuildingCertificate | null
  work_order: WorkOrder | null
  decision: { observation_id: string; action: HumanAction; reason_code: ReasonCode | null; modify: string | null }
  observations: { observation_id: string; hash: string }[]
}

export interface BuildingEntry {
  block: LedgerBlock
  payload: BuildingPayload
  milestone: string
}

/** pending until settle; released = RA bill released or work order issued; held = nothing moves. */
export type Outcome = 'pending' | 'released' | 'held'

interface BuildingState {
  phase: Phase
  t: number
  /** Stage index of the milestone under verification. */
  stage: number
  /** Stage index the build moves to after this cycle. */
  next: number
  cycle: number
  current: BuildingCase
  found: number
  checked: number
  decision: Decision | null
  entry: BuildingEntry | null
  entries: BuildingEntry[]
  outcome: Outcome
  tick: (dt: number) => void
  decide: (action: HumanAction, reason: ReasonCode | null, modifyId: string | null, simulated: boolean) => void
  jump: (stage: number) => void
  restart: (stage?: number) => void
  enterScene: () => void
}

const rng = createRng(6021)
const chains = new OriginChains()
export const buildingLedger = new Ledger('building.milestone-ledger')

const ticker = (level: 'info' | 'ok' | 'alert', text: string) => useApp.getState().pushTicker({ level, text })

function evidenceOf(c: BuildingCase, d: Decision) {
  const r = c.records
  return [r.scan, r.sensor, ...c.findings.map((f) => f.record), r.plan, r.completion, r.vlm, d.record].map((x) => ({
    observation_id: x.observation_id,
    hash: x.hash,
  }))
}

function hireCheck(stage: number) {
  const p = sitePlan(stage)
  if (!p) return null
  const { machine, billed_h, worked_h } = p.hire
  return { machine: machine.toLowerCase(), billed_h, worked_h, queried_h: queriedHours(p.hire) }
}

function buildPayload(c: BuildingCase, d: Decision, at: Date): BuildingPayload {
  const observations = evidenceOf(c, d)
  const accepted = d.action === 'accept'
  const certificate: BuildingCertificate | null =
    accepted && !c.monitoring
      ? {
          certificate_id: rng.id('cert', 10),
          spec: c.spec.id,
          milestone: c.label,
          result: 'verified',
          checks: c.measures.map((m) => ({ check: m.label, value: m.value, plan: m.plan, ok: m.ok })),
          snags_logged: c.findings.map((f, i) => ({ observation_id: f.id, class: f.cls.toLowerCase(), location: f.where, vlm_confirmed: i === c.vlmIndex })),
          hire_check: hireCheck(c.index),
          settles: c.spec.settles,
          evidence: observations,
          approved_by_role: c.approverRole,
          issued_at: at.toISOString(),
        }
      : null
  const alert = c.findings[0]
  const work_order: WorkOrder | null =
    accepted && c.monitoring
      ? {
          work_order_id: rng.id('wo', 10),
          spec: c.spec.id,
          trigger: { sensor: 'CG-2', observation_id: alert.id, reading: c.measures[0].value, limit: c.measures[0].plan },
          action: 'Structural inspection of L2 facade at CG-2',
          assigned_role: c.approverRole,
          due_within_h: 72,
          evidence: observations,
          raised_by_role: c.approverRole,
          issued_at: at.toISOString(),
        }
      : null
  return {
    type: accepted ? (c.monitoring ? 'work_order' : 'settlement') : d.action === 'reject' ? 'rejection' : 'hold',
    certificate,
    work_order,
    decision: { observation_id: d.record.observation_id, action: d.action, reason_code: d.reason, modify: d.modifyId },
    observations,
  }
}

/** Earlier milestones so the chain has history: excavation, a foundation rejection, then the foundation. */
function seedHistory(): BuildingEntry[] {
  const out: BuildingEntry[] = []
  const now = Date.now()
  const plan: [number, HumanAction, ReasonCode | null][] = [
    [stageIndex('excavation'), 'accept', null],
    [stageIndex('foundation'), 'reject', 'weather'],
    [stageIndex('foundation'), 'accept', null],
  ]
  plan.forEach(([stage, action, reason], i) => {
    const at = new Date(now - (90 - i * 26) * 24 * 3600_000)
    const c = createBuildingCase(stage, rng, chains, at)
    const record = createBuildingDecision(c, rng, chains, action, reason, at)
    const payload = buildPayload(c, { action, reason, modifyId: null, simulated: true, record }, at)
    out.push({ block: buildingLedger.append(payload, at), payload, milestone: c.label })
  })
  return out
}

const seeded = seedHistory()

const fresh = (stage: number) => ({
  phase: 'scan' as Phase,
  t: 0,
  stage,
  next: stage,
  current: createBuildingCase(stage, rng, chains, new Date()),
  found: 0,
  checked: 0,
  decision: null,
  entry: null,
  outcome: 'pending' as Outcome,
})

export const useBuilding = create<BuildingState>((set, get) => ({
  ...fresh(FIRST_STAGE),
  cycle: 0,
  entries: seeded,

  tick: (dt) => {
    const s = get()
    const t = s.t + dt
    const limit = phaseSeconds[s.phase]
    if (t >= limit) {
      enter(order[(order.indexOf(s.phase) + 1) % order.length])
      return
    }
    const patch: Partial<BuildingState> = { t }
    const c = s.current
    if (s.phase === 'scan') {
      const [lo, hi] = c.stage.span
      const y = lo + (hi - lo) * scanU(t)
      const sorted = [...c.findings].sort((a, b) => a.y - b.y)
      let found = 0
      for (const f of sorted) if (y >= f.y) found++
      if (found !== s.found) {
        patch.found = found
        const f = sorted[found - 1]
        const who = c.monitoring ? 'Boson' : 'Photon'
        ticker('alert', `${who}: ${f.cls.toLowerCase()} at ${f.where}, conf ${f.confidence.toFixed(2)}`)
      }
    } else if (s.phase === 'verify') {
      const checked = Math.min(3, Math.floor((t / limit) * 3.4))
      if (checked !== s.checked) {
        patch.checked = checked
        const v = c.verifier[checked - 1]
        ticker(checked === 3 ? 'ok' : 'info', `Verify: ${v.stage}, ${v.note}`)
      }
    } else if (s.phase === 'settle') {
      if (s.t < SEAL_AT && t >= SEAL_AT && s.decision) seal(s.decision)
      if (s.t < RELEASE_AT && t >= RELEASE_AT && s.decision) {
        const outcome: Outcome = s.decision.action === 'accept' ? 'released' : 'held'
        patch.outcome = outcome
        if (c.monitoring) ticker(outcome === 'released' ? 'ok' : 'alert', outcome === 'released' ? 'Inspection work order issued to Structural Engineer' : 'No work order. Watching CG-2.')
        else ticker(outcome === 'released' ? 'ok' : 'alert', outcome === 'released' ? `RA bill released, ${c.stage.short.toLowerCase()} milestone` : `RA bill held, ${c.label}. Rework, then re-scan.`)
      }
    }
    set(patch)
  },

  decide: (action, reason, modifyId, simulated) => {
    const s = get()
    if (s.phase !== 'approve') return
    const record = createBuildingDecision(s.current, rng, chains, action, reason, new Date())
    const accepted = action === 'accept'
    // An accepted milestone moves the build on. Anything else repeats it after rework.
    const next = accepted ? (s.stage + 1) % stages.length : s.stage
    set({ decision: { action, reason, modifyId, simulated, record }, next })
    const who = simulated ? `${s.current.approverRole} (simulated)` : s.current.approverRole
    const what = action === 'modify' ? s.current.stage.modify.label.toLowerCase() : `${action}${reason ? ` (${reason})` : ''}`
    ticker(accepted ? 'ok' : 'alert', `${who}: ${what}`)
    enter('settle')
  },

  jump: (stage) => {
    if (stage === get().stage && get().phase === 'scan') return
    get().restart(stage)
  },

  restart: (stage) => {
    const s = get()
    set({ ...fresh(stage ?? s.next), cycle: s.cycle + 1 })
    announce()
  },

  enterScene: () => {
    const s = get()
    if (s.phase === 'scan' && s.t < 0.5) announce()
    else get().restart(s.phase === 'reset' ? s.next : s.stage)
  },
}))

function seal(d: Decision) {
  const s = useBuilding.getState()
  const at = new Date()
  const payload = buildPayload(s.current, d, at)
  const entry: BuildingEntry = { block: buildingLedger.append(payload, at), payload, milestone: s.current.label }
  useBuilding.setState({ entry, entries: [...s.entries, entry].slice(-8) })
  const word = {
    settlement: 'Milestone certificate minted.',
    work_order: 'Work order sealed.',
    rejection: 'Rejection recorded.',
    hold: 'Hold recorded.',
  }[payload.type]
  ticker(payload.type === 'settlement' || payload.type === 'work_order' ? 'ok' : 'alert', `Ledger #${entry.block.seq} sealed. ${word}`)
}

let announced = ''
function announce() {
  const c = useBuilding.getState().current
  if (announced === c.id) return
  announced = c.id
  ticker('info', c.monitoring ? 'Handover done. Boson watching structural health sensors.' : `Photon scanning ${c.label}`)
}

function enter(phase: Phase) {
  const s = useBuilding.getState()
  const c = s.current
  switch (phase) {
    case 'scan':
      s.restart()
      return
    case 'plan':
      ticker('info', c.monitoring ? 'Readings compared with design limits and 14-day baseline' : `Boson: ${c.stage.bosonSensor.replace(/_/g, ' ')} replayed against BIM`)
      break
    case 'verify':
      ticker('info', `Plan check: ${c.measures[0].label} ${c.measures[0].value}, ${c.measures[1].label} ${c.measures[1].value}`)
      break
    case 'approve':
      ticker('alert', `Awaiting ${c.approverRole}`)
      break
    case 'reset':
      if (s.next !== s.stage) {
        const n = stages[s.next]
        ticker('info', s.next === MONITORING ? 'Handover. Structural health monitoring starts.' : s.next === 0 ? 'Next project: excavation starts.' : `Time-lapse: ${n.short.toLowerCase()} works`)
      }
      break
  }
  useBuilding.setState({ phase, t: 0 })
}

/* ------------------------------------------------------------------ */
/* Structural health sensors                                           */
/* ------------------------------------------------------------------ */

export type SensorKind = 'piezometer' | 'settlement' | 'strain' | 'tilt' | 'crack' | 'frequency'

export interface SensorDef {
  kind: SensorKind
  label: string
  /** Tag ids of the physical sensors in this group. */
  tags: string[]
  /** Stage index from which the sensors are installed. */
  installedAt: number
  unit: string
  limit: string
  /** Formats a value for display. */
  fmt: (v: number) => string
}

export const sensorDefs: SensorDef[] = [
  { kind: 'piezometer', label: 'Groundwater', tags: ['PZ-1'], installedAt: 0, unit: 'm bgl', limit: '≥ 3.5 m', fmt: (v) => v.toFixed(2) },
  { kind: 'settlement', label: 'Settlement', tags: ['SM-1', 'SM-2', 'SM-3', 'SM-4'], installedAt: 1, unit: 'mm', limit: '≤ 25', fmt: (v) => v.toFixed(1) },
  { kind: 'strain', label: 'Column strain', tags: ['SG-1', 'SG-2'], installedAt: 2, unit: 'µε', limit: '≤ 800', fmt: (v) => Math.round(v).toString() },
  { kind: 'tilt', label: 'Tilt', tags: ['TL-1', 'TL-2'], installedAt: 2, unit: '', limit: '≤ 1/500', fmt: (v) => `1/${Math.round(1 / Math.max(v, 1e-5))}` },
  { kind: 'crack', label: 'Crack width', tags: ['CG-1', 'CG-2'], installedAt: 3, unit: 'mm', limit: '≤ 0.30', fmt: (v) => v.toFixed(2) },
  { kind: 'frequency', label: 'Natural freq.', tags: ['AC-1'], installedAt: 2, unit: 'Hz', limit: '±5% base', fmt: (v) => v.toFixed(2) },
]

const HISTORY = 40
const SAMPLE_S = 0.35

/** How far into the build the structure is, 0..1, for load-driven readings. */
function loadShare(stage: number) {
  let pct = 0
  for (let i = 0; i < stage; i++) pct += stages[i].weight
  return Math.min(1, pct / 100)
}

interface ShmState {
  /** Last HISTORY readings per sensor kind (max of the group). */
  series: Record<SensorKind, number[]>
  /** True while a reading is beyond its limit. */
  alert: Record<SensorKind, boolean>
  acc: number
  sample: (dt: number) => void
}

const shmRng = createRng(913)

/** Target reading for a sensor kind at a stage and point in the cycle. */
function target(kind: SensorKind, stage: number, drift: number) {
  const load = loadShare(stage === MONITORING ? stages.length : stage)
  switch (kind) {
    case 'piezometer':
      return 4.6 - (stage <= 1 ? 0.4 : 0) // dewatering keeps the water table down during the dig
    case 'settlement':
      return 2 + load * 9.5
    case 'strain':
      return 60 + load * 260
    case 'tilt':
      return 1 / (5200 - load * 3300)
    case 'crack':
      return stage === MONITORING ? 0.17 + drift * 0.145 : 0.06 + load * 0.08
    case 'frequency':
      return 2.6 - load * 0.17
  }
}

const noise: Record<SensorKind, number> = { piezometer: 0.03, settlement: 0.12, strain: 6, tilt: 0.000004, crack: 0.004, frequency: 0.006 }

function emptySeries(): Record<SensorKind, number[]> {
  const s = {} as Record<SensorKind, number[]>
  for (const d of sensorDefs) s[d.kind] = []
  return s
}

export const useShm = create<ShmState>((set, get) => ({
  series: emptySeries(),
  alert: { piezometer: false, settlement: false, strain: false, tilt: false, crack: false, frequency: false },
  acc: 0,
  sample: (dt) => {
    const acc = get().acc + dt
    if (acc < SAMPLE_S) {
      set({ acc })
      return
    }
    const b = useBuilding.getState()
    // In monitoring, CG-2 widens through the scan and holds above the limit afterwards.
    const drift = b.stage === MONITORING ? (b.phase === 'scan' ? scanU(b.t) : b.phase === 'reset' ? 1 - clamp01(b.t / 1.2) : 1) : 0
    const series = { ...get().series }
    const alert = { ...get().alert }
    for (const d of sensorDefs) {
      const prev = series[d.kind]
      const base = target(d.kind, b.stage, drift)
      const last = prev.length ? prev[prev.length - 1] : base
      const v = last + (base - last) * 0.35 + shmRng.range(-1, 1) * noise[d.kind]
      series[d.kind] = [...prev, v].slice(-HISTORY)
      alert[d.kind] = d.kind === 'crack' && v > 0.3
    }
    set({ series, alert, acc: 0 })
  },
}))

/** Prefill so sparklines are populated on first paint. */
for (let i = 0; i < HISTORY; i++) useShm.getState().sample(SAMPLE_S)
