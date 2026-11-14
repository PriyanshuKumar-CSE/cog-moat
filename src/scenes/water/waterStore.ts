import { create } from 'zustand'
import { deployments } from '../../config/content'
import { useApp } from '../../core/store'
import { completionSpecs } from '../../sim/completionSpecs'
import { buildIes, OriginChains, type IesRecord } from '../../sim/ies'
import { Ledger, type LedgerBlock } from '../../sim/ledger'
import type { HumanAction, ReasonCode } from '../../sim/loopCase'
import { createRng, type Rng } from '../../sim/rng'
import { DMA_COUNT, brandNames, network } from './network'

/**
 * Water director. One night window per cycle: flow, balance check, a DMA
 * drifts and a leak shows, detection, human approval, Water Ledger entry.
 */

export type Phase = 'flow' | 'balance' | 'leak' | 'detect' | 'approve' | 'write' | 'reset'

export const phaseSeconds: Record<Phase, number> = {
  flow: 3.2,
  balance: 3.6,
  leak: 3.0,
  detect: 4.2,
  approve: Infinity,
  write: 3.8,
  reset: 2.2,
}

const order: Phase[] = ['flow', 'balance', 'leak', 'detect', 'approve', 'write', 'reset']

export type StepId = 'flow' | 'balance' | 'detect' | 'approve' | 'ledger'

export const steps: { id: StepId; title: string }[] = [
  { id: 'flow', title: 'FLOW' },
  { id: 'balance', title: 'BALANCE' },
  { id: 'detect', title: 'DETECT' },
  { id: 'approve', title: 'APPROVE' },
  { id: 'ledger', title: 'LEDGER' },
]

export const phaseStep: Record<Phase, StepId> = {
  flow: 'flow',
  balance: 'balance',
  leak: 'balance',
  detect: 'detect',
  approve: 'approve',
  write: 'ledger',
  reset: 'ledger',
}

export const phaseLine: Record<Phase, string> = {
  flow: 'Boson hears every inlet and consumer meter, whatever the brand.',
  balance: 'Balance check: inflow against billed consumption, per DMA, in the night window.',
  leak: 'One DMA drifts. Night flow climbs and NRW crosses the threshold.',
  detect: 'The imbalance becomes an IES detection, with lineage back to the meter readings.',
  approve: 'Nothing is written until the Utility Engineer decides.',
  write: 'The decision is sealed on the Water Ledger: hash-linked and signed.',
  reset: 'Next night window. Monitoring continues.',
}

export const spec = completionSpecs.water
export const APPROVER = spec.authority.sign
export const NRW_THRESHOLD = 0.15
export const NIGHT_WINDOW = '02:00-04:00'
export const siteName = deployments.find((d) => d.id === 'in-bhubaneswar')?.name ?? ''

/** Metered (billed) night consumption per DMA, m3/h. Simulated. */
const BILLED = [36.4, 31.8, 40.2]
const BASE_NRW = [0.112, 0.104, 0.098]
/** DMA order the leak visits on successive cycles. */
const LEAK_DMA = [1, 2, 0]
const LEAK_STREET = [1, 0, 2]

export interface WaterCase {
  id: string
  dma: number
  street: number
  side: number
  segment: number
  segmentRef: string
  peakNrw: number
  /** Minimum night flow for the leak DMA, previous 13 nights, m3/h. */
  mnfHistory: number[]
  pressureDropM: number
  confidence: number
  inlet: IesRecord
  consumers: IesRecord
  pressure: IesRecord
  detection: IesRecord
  headline: string
}

export interface Decision {
  action: HumanAction
  reason: ReasonCode | null
  modifyId: string | null
  simulated: boolean
  record: IesRecord
}

export type EntryType = 'verified-loss' | 'rejection' | 'field-check'

export interface WaterPayload {
  type: EntryType
  spec: string
  dma: string
  segment_ref: string
  night_window: string
  loss: { nrw_pct: number; threshold_pct: number; excess_inflow_m3h: number } | null
  note: string
  decision: { observation_id: string; action: HumanAction; reason_code: ReasonCode | null; modify: string | null; role: string }
  evidence: { observation_id: string; kind: string; hash: string }[]
}

export interface LedgerEntry {
  block: LedgerBlock
  payload: WaterPayload
}

export interface Sample {
  /** Phase progress 0..1. */
  u: number
  leak: number
  inflow: number[]
  billed: number[]
  nrw: number[]
  /** Night-flow series for the leak DMA, last value is tonight (live). */
  mnf: number[]
}

interface WaterState {
  phase: Phase
  cycle: number
  current: WaterCase
  decision: Decision | null
  entries: LedgerEntry[]
  sample: Sample
  tick: (dt: number) => void
  decide: (action: HumanAction, reason: ReasonCode | null, modifyId: string | null, simulated: boolean) => void
}

// Non-reactive simulation state.
const rng = createRng(6021)
const chains = new OriginChains()
export const waterLedger = new Ledger('water-ledger')

/** Phase clock. Kept out of React state so nothing re-renders per frame. */
export const clock = { t: 0, sinceSample: 0 }

const ticker = (level: 'info' | 'ok' | 'alert', text: string) => useApp.getState().pushTicker({ level, text })

const uuid = (r: Rng) => {
  const h = () => Math.floor(r.next() * 16).toString(16)
  const s = (n: number) => Array.from({ length: n }, h).join('')
  return `${s(8)}-${s(4)}-4${s(3)}-${'89ab'[Math.floor(r.next() * 4)]}${s(3)}-${s(12)}`
}

const ids = {
  customer: uuid(rng),
  scope: uuid(rng),
  method: uuid(rng),
  person: uuid(rng),
  inlet: Array.from({ length: DMA_COUNT }, () => uuid(rng)),
  collector: Array.from({ length: DMA_COUNT }, () => uuid(rng)),
  logger: Array.from({ length: DMA_COUNT }, () => uuid(rng)),
  dma: Array.from({ length: DMA_COUNT }, () => uuid(rng)),
}

let logPosition = 71200

const ingest = (at: Date) => ({
  customer_id: ids.customer,
  log_position: ++logPosition,
  observation_id: uuid(rng),
  arrived_at: at,
  believed_at: at,
})

export const inflowAt = (dma: number, nrw: number) => BILLED[dma] / (1 - nrw)

/** Inflow of a DMA relative to its own baseline, for a leak level. */
export function inflowRatio(dma: number, c: WaterCase, leak: number) {
  if (dma !== c.dma) return 1
  const nrw = BASE_NRW[dma] + (c.peakNrw - BASE_NRW[dma]) * leak
  return inflowAt(dma, nrw) / inflowAt(dma, BASE_NRW[dma])
}
const r1 = (x: number) => Number(x.toFixed(1))
const r2 = (x: number) => Number(x.toFixed(2))

export const dmaLabel = (d: number) => `DMA ${d + 1}`

function createCase(cycle: number, now: Date): WaterCase {
  const dma = LEAK_DMA[cycle % LEAK_DMA.length]
  const street = LEAK_STREET[cycle % LEAK_STREET.length]
  const side = cycle % 2
  const segment = network.streetSegments[dma][street][side]
  const segmentRef = network.segments[segment].ref
  const peakNrw = rng.range(0.215, 0.255)
  const baseInflow = inflowAt(dma, BASE_NRW[dma])
  const peakInflow = inflowAt(dma, peakNrw)
  const mnfBase = baseInflow * 0.32
  const mnfHistory = Array.from({ length: 13 }, () => r1(mnfBase * rng.range(0.94, 1.06)))
  const pressureDropM = r1(rng.range(3.2, 4.6))
  const confidence = r2(rng.range(0.91, 0.97))
  const occurred = new Date(now.getTime() - rng.int(30, 90) * 1000)
  const arrived = new Date(occurred.getTime() + rng.int(800, 3000))
  const derivedAt = new Date(arrived.getTime() + rng.int(400, 1500))

  const inlet = buildIes(
    chains,
    {
      origin_id: ids.inlet[dma],
      sense: { origin: ids.inlet[dma], sensor: 'bulk_flow_meter', brand_agnostic: true, device_counter: rng.int(1000, 9000) },
      kind: 'measurement',
      claim: { quantity: 'inlet_flow_m3h', value: r1(peakInflow), window: NIGHT_WINDOW, subject_ref: ids.dma[dma] },
      scope_ref: ids.scope,
      occurred_at: occurred,
      lineage: null,
    },
    ingest(arrived),
  )
  const consumers = buildIes(
    chains,
    {
      origin_id: ids.collector[dma],
      sense: { origin: ids.collector[dma], sensor: 'consumer_meter_reads', meters_reporting: 12, brands: [...brandNames], brand_agnostic: true },
      kind: 'measurement',
      claim: { quantity: 'billed_consumption_m3h', value: r1(BILLED[dma]), window: NIGHT_WINDOW, subject_ref: ids.dma[dma] },
      scope_ref: ids.scope,
      occurred_at: occurred,
      lineage: null,
    },
    ingest(arrived),
  )
  const pressure = buildIes(
    chains,
    {
      origin_id: ids.logger[dma],
      sense: { origin: ids.logger[dma], sensor: 'pressure_logger', interval_s: 60 },
      kind: 'measurement',
      claim: { quantity: 'pressure_drop_m', value: pressureDropM, node: `PL-${dma + 1}.${street + 1}`, subject_ref: ids.dma[dma] },
      scope_ref: ids.scope,
      occurred_at: occurred,
      lineage: null,
    },
    ingest(arrived),
  )
  const detection = buildIes(
    chains,
    {
      origin_id: ids.method,
      sense: { model: 'dma_balance@v1' },
      kind: 'detection',
      claim: {
        class: 'nrw_anomaly',
        confidence,
        dma: dmaLabel(dma),
        nrw_pct: r1(peakNrw * 100),
        threshold_pct: NRW_THRESHOLD * 100,
        excess_inflow_m3h: r1(peakInflow - baseInflow),
        suspected: 'leak',
        segment_ref: segmentRef,
        subject_ref: ids.dma[dma],
      },
      scope_ref: ids.scope,
      occurred_at: occurred,
      lineage: {
        input: [inlet.observation_id, consumers.observation_id, pressure.observation_id],
        method: 'dma_balance',
        version: 'v1',
        config: { nrw_threshold_pct: NRW_THRESHOLD * 100, baseline_window_days: 14, night_window: NIGHT_WINDOW },
      },
    },
    ingest(derivedAt),
  )

  return {
    id: rng.id('wcase'),
    dma,
    street,
    side,
    segment,
    segmentRef,
    peakNrw,
    mnfHistory,
    pressureDropM,
    confidence,
    inlet,
    consumers,
    pressure,
    detection,
    headline: `Night-flow imbalance, ${dmaLabel(dma)}`,
  }
}

function createDecision(c: WaterCase, action: HumanAction, reason: ReasonCode | null, modifyId: string | null, at: Date): IesRecord {
  return buildIes(
    chains,
    {
      origin_id: ids.person,
      sense: { method: 'approval_console', role: APPROVER },
      kind: 'verification',
      claim: {
        action,
        reason_code: reason,
        modify: modifyId,
        spec: spec.id,
        evidence: [c.detection.observation_id],
        subject_ref: c.detection.subject_ref,
      },
      scope_ref: c.detection.scope_ref,
      occurred_at: at,
      lineage: { input: [c.detection.observation_id], method: 'human_review', version: 'v1', config: { role: APPROVER } },
    },
    ingest(at),
  )
}

export const entryWord: Record<EntryType, string> = {
  'verified-loss': 'Verified loss written to Water Ledger.',
  rejection: 'Rejection recorded. No loss entry written.',
  'field-check': 'Field crew requested. Loss entry held until the crew reports.',
}

export const entryChip: Record<EntryType, { label: string; tone: 'ok' | 'warn' | 'dim' }> = {
  'verified-loss': { label: 'VERIFIED LOSS', tone: 'ok' },
  rejection: { label: 'REJECTED', tone: 'warn' },
  'field-check': { label: 'FIELD CHECK', tone: 'dim' },
}

function buildPayload(c: WaterCase, d: Decision): WaterPayload {
  const type: EntryType = d.action === 'reject' ? 'rejection' : d.action === 'modify' ? 'field-check' : 'verified-loss'
  return {
    type,
    spec: spec.id,
    dma: dmaLabel(c.dma),
    segment_ref: c.segmentRef,
    night_window: NIGHT_WINDOW,
    loss:
      type === 'verified-loss'
        ? {
            nrw_pct: r1(c.peakNrw * 100),
            threshold_pct: NRW_THRESHOLD * 100,
            excess_inflow_m3h: r1(inflowAt(c.dma, c.peakNrw) - inflowAt(c.dma, BASE_NRW[c.dma])),
          }
        : null,
    note: entryWord[type],
    decision: { observation_id: d.record.observation_id, action: d.action, reason_code: d.reason, modify: d.modifyId, role: APPROVER },
    evidence: [c.inlet, c.consumers, c.pressure, c.detection, d.record].map((r) => ({ observation_id: r.observation_id, kind: r.kind, hash: r.hash })),
  }
}

/** Earlier nights, so the chain has history. */
function seedHistory(): LedgerEntry[] {
  const out: LedgerEntry[] = []
  const now = Date.now()
  const plan: [HumanAction, ReasonCode | null, string | null][] = [
    ['accept', null, null],
    ['modify', 'other', 'crew'],
    ['accept', null, null],
    ['reject', 'equipment', null],
    ['accept', null, null],
  ]
  plan.forEach(([action, reason, modifyId], i) => {
    const at = new Date(now - (plan.length - i) * 86400_000 - rng.int(1, 5) * 3600_000)
    const c = createCase(i + 1, at)
    const record = createDecision(c, action, reason, modifyId, at)
    const payload = buildPayload(c, { action, reason, modifyId, simulated: true, record })
    out.push({ block: waterLedger.append(payload, at), payload })
  })
  return out
}

const seeded = seedHistory()

/** Leak level 0..1 for a phase and its progress. */
export function leakLevel(phase: Phase, u: number) {
  switch (phase) {
    case 'flow':
      return 0
    case 'balance':
      return 0.5 * u * u
    case 'leak':
      return 0.5 + 0.5 * Math.sin((u * Math.PI) / 2)
    case 'detect':
    case 'approve':
    case 'write':
      return 1
    case 'reset':
      return 1 - u
  }
}

export const phaseU = (phase: Phase) => {
  const d = phaseSeconds[phase]
  return Number.isFinite(d) ? Math.min(1, clock.t / d) : 0
}

function computeSample(phase: Phase, c: WaterCase, time: number): Sample {
  const u = phaseU(phase)
  const leak = leakLevel(phase, u)
  const nrw = BASE_NRW.map((b, d) => {
    const wobble = Math.sin(time * 0.9 + d * 2.1) * 0.003
    return d === c.dma ? b + (c.peakNrw - b) * leak + wobble : b + wobble
  })
  const inflow = nrw.map((n, d) => inflowAt(d, n))
  const base = inflowAt(c.dma, BASE_NRW[c.dma])
  const tonight = c.mnfHistory[c.mnfHistory.length - 1] + (inflow[c.dma] - base)
  return { u, leak, inflow, billed: [...BILLED], nrw, mnf: [...c.mnfHistory, r1(tonight)] }
}

let simTime = 0
const firstCase = createCase(0, new Date())

export const useWater = create<WaterState>((set, get) => ({
  phase: 'flow',
  cycle: 0,
  current: firstCase,
  decision: null,
  entries: seeded,
  sample: computeSample('flow', firstCase, 0),

  tick: (dt) => {
    const s = get()
    simTime += dt
    clock.t += dt
    clock.sinceSample += dt
    if (clock.t >= phaseSeconds[s.phase]) {
      enter(order[(order.indexOf(s.phase) + 1) % order.length])
      return
    }
    if (clock.sinceSample >= 0.2) {
      clock.sinceSample = 0
      set({ sample: computeSample(s.phase, s.current, simTime) })
    }
  },

  decide: (action, reason, modifyId, simulated) => {
    const s = get()
    if (s.phase !== 'approve') return
    const record = createDecision(s.current, action, reason, modifyId, new Date())
    const decision: Decision = { action, reason, modifyId, simulated, record }
    set({ decision })
    const who = simulated ? `${APPROVER} (simulated)` : APPROVER
    const what = action === 'modify' ? 'modify (send field crew first)' : action
    ticker(action === 'reject' ? 'alert' : 'ok', `${who}: ${what}${reason && action === 'reject' ? ` (${reason})` : ''}`)
    enter('write')
  },
}))

function setPhase(phase: Phase) {
  clock.t = 0
  clock.sinceSample = 0
  const s = useWater.getState()
  useWater.setState({ phase, sample: computeSample(phase, s.current, simTime) })
}

function enter(phase: Phase) {
  const s = useWater.getState()
  const c = s.current
  const dma = dmaLabel(c.dma)
  switch (phase) {
    case 'flow': {
      const cycle = s.cycle + 1
      const next = createCase(cycle, new Date())
      useWater.setState({ cycle, current: next, decision: null })
      ticker('info', 'Boson: 3 inlet meters, 36 consumer meters (brands A, B, C) reporting')
      break
    }
    case 'balance':
      ticker('info', `Balance check: inflow vs billed, ${NIGHT_WINDOW} night window`)
      break
    case 'leak':
      ticker('alert', `${dma}: night flow above baseline, NRW over the ${NRW_THRESHOLD * 100}% threshold`)
      break
    case 'detect':
      ticker('alert', `Detection: nrw_anomaly, ${dma}, conf ${c.confidence.toFixed(2)}. Pressure dip at ${c.segmentRef}`)
      break
    case 'approve':
      ticker('alert', `Awaiting ${APPROVER}`)
      break
    case 'write': {
      const d = useWater.getState().decision
      if (!d) break
      const payload = buildPayload(c, d)
      const block = waterLedger.append(payload, new Date())
      const entries = [...useWater.getState().entries, { block, payload }].slice(-12)
      useWater.setState({ entries })
      ticker(payload.type === 'rejection' ? 'alert' : 'ok', `Water Ledger #${block.seq} sealed. ${entryWord[payload.type]}`)
      break
    }
    case 'reset':
      ticker('info', 'Next night window. Monitoring continues.')
      break
  }
  setPhase(phase)
}

/** Called when the scene mounts: start the story from the top. */
export function startWater() {
  const s = useWater.getState()
  if (s.phase === 'flow' && clock.t < 0.3) {
    const top = useApp.getState().ticker[0]
    if (!top || !top.text.startsWith('Boson:')) ticker('info', 'Boson: 3 inlet meters, 36 consumer meters (brands A, B, C) reporting')
    return
  }
  enter('flow')
}
