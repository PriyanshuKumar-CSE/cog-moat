import { create } from 'zustand'
import { useApp } from '../../core/store'
import { OriginChains, type IesRecord } from '../../sim/ies'
import { Ledger, type LedgerBlock } from '../../sim/ledger'
import type { HumanAction, ReasonCode } from '../../sim/loopCase'
import { createRng } from '../../sim/rng'
import { createRoadCase, createRoadDecision, defectLabel, type RoadCase } from './roadCase'

/**
 * Road scene director. One section per cycle:
 * scan -> plan vs as-built -> verifier chain -> human gate -> settle -> reset.
 */

export type Phase = 'scan' | 'plan' | 'verify' | 'approve' | 'settle' | 'reset'

export const phaseSeconds: Record<Phase, number> = {
  scan: 6.4,
  plan: 4.4,
  verify: 3.8,
  approve: Infinity,
  settle: 5.2,
  reset: 1.4,
}

const order: Phase[] = ['scan', 'plan', 'verify', 'approve', 'settle', 'reset']

/** Scan timing: the vehicle drives the section between these fractions of the scan phase. */
export const SCAN_START = 0.06
export const SCAN_END = 0.92
/** Settle beats, in seconds from the start of settle. */
export const SEAL_AT = 1.3
export const RELEASE_AT = 2.6
/** Roller replay window inside the plan phase, in seconds. */
export const ROLL_FROM = 0.5
export const ROLL_TO = 3.6
export const rollU = (t: number) => Math.min(1, Math.max(0, (t - ROLL_FROM) / (ROLL_TO - ROLL_FROM)))

export const approvalCopy = {
  title: 'Sign completion certificate',
  modify: [{ id: 'retest', label: 'Hold: re-test thickness' }],
}

export interface Decision {
  action: HumanAction
  reason: ReasonCode | null
  modifyId: string | null
  simulated: boolean
  record: IesRecord
}

export interface RoadCertificate {
  certificate_id: string
  spec: string
  section: string
  result: 'verified'
  checks: { coverage_pct: number; min_passes: number; thickness_mm: number; plan_thickness_mm: number; width_m: number }
  defects_logged: { observation_id: string; class: string; chainage_km: number; vlm_confirmed: boolean }[]
  settles: string
  evidence: { observation_id: string; hash: string }[]
  approved_by_role: string
  issued_at: string
}

export interface RoadPayload {
  type: 'settlement' | 'rejection' | 'hold'
  certificate: RoadCertificate | null
  decision: { observation_id: string; action: HumanAction; reason_code: ReasonCode | null; modify: string | null }
  observations: { observation_id: string; hash: string }[]
}

export interface RoadEntry {
  block: LedgerBlock
  payload: RoadPayload
}

export type Funds = 'pending' | 'released' | 'held'

interface RoadState {
  phase: Phase
  t: number
  cycle: number
  current: RoadCase
  /** Detections revealed so far in this cycle. */
  found: number
  /** Verifier stages passed so far (excluding the human). */
  checked: number
  decision: Decision | null
  certificate: RoadCertificate | null
  entry: RoadEntry | null
  entries: RoadEntry[]
  funds: Funds
  tick: (dt: number) => void
  decide: (action: HumanAction, reason: ReasonCode | null, modifyId: string | null, simulated: boolean) => void
  restart: () => void
  enterScene: () => void
}

const rng = createRng(4417)
const chains = new OriginChains()
export const roadLedger = new Ledger('road.certificate-ledger')

const ticker = (level: 'info' | 'ok' | 'alert', text: string) => useApp.getState().pushTicker({ level, text })

function evidenceOf(c: RoadCase, d: Decision) {
  const r = c.records
  return [r.video, r.mask, ...c.defects.map((x) => x.record), r.roller, r.compaction, r.plan, r.vlm, d.record].map((x) => ({
    observation_id: x.observation_id,
    hash: x.hash,
  }))
}

function buildPayload(c: RoadCase, d: Decision, at: Date): RoadPayload {
  const observations = evidenceOf(c, d)
  const certificate: RoadCertificate | null =
    d.action === 'accept'
      ? {
          certificate_id: rng.id('cert', 10),
          spec: c.spec.id,
          section: c.sectionLabel,
          result: 'verified',
          checks: {
            coverage_pct: c.coveragePct,
            min_passes: 8,
            thickness_mm: c.thicknessMm,
            plan_thickness_mm: c.thicknessPlanMm,
            width_m: c.widthM,
          },
          defects_logged: c.defects.map((x, i) => ({ observation_id: x.id, class: x.cls, chainage_km: x.chainageKm, vlm_confirmed: i === c.vlmIndex })),
          settles: c.spec.settles,
          evidence: observations,
          approved_by_role: c.approverRole,
          issued_at: at.toISOString(),
        }
      : null
  return {
    type: d.action === 'accept' ? 'settlement' : d.action === 'reject' ? 'rejection' : 'hold',
    certificate,
    decision: { observation_id: d.record.observation_id, action: d.action, reason_code: d.reason, modify: d.modifyId },
    observations,
  }
}

/** A few earlier sections so the chain has history. */
function seedHistory(): RoadEntry[] {
  const out: RoadEntry[] = []
  const now = Date.now()
  for (let i = 0; i < 4; i++) {
    const at = new Date(now - (30 - i * 6) * 3600_000)
    const c = createRoadCase(rng, chains, at)
    const action: HumanAction = i === 1 ? 'reject' : 'accept'
    const reason: ReasonCode | null = i === 1 ? 'equipment' : null
    const record = createRoadDecision(c, rng, chains, action, reason, at)
    const payload = buildPayload(c, { action, reason, modifyId: null, simulated: true, record }, at)
    out.push({ block: roadLedger.append(payload, at), payload })
  }
  return out
}

const seeded = seedHistory()

const fresh = () => ({
  phase: 'scan' as Phase,
  t: 0,
  current: createRoadCase(rng, chains, new Date()),
  found: 0,
  checked: 0,
  decision: null,
  certificate: null,
  entry: null,
  funds: 'pending' as Funds,
})

export const useRoad = create<RoadState>((set, get) => ({
  ...fresh(),
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
    const patch: Partial<RoadState> = { t }
    const c = s.current
    if (s.phase === 'scan') {
      const u = scanU(t)
      let found = 0
      for (const d of c.defects) if (u >= d.u) found++
      if (found !== s.found) {
        patch.found = found
        const d = [...c.defects].sort((a, b) => a.u - b.u)[found - 1]
        ticker('alert', `Photon: ${defectLabel[d.cls].toLowerCase()} at ch ${d.chainageKm.toFixed(3)} km, conf ${d.confidence.toFixed(2)}`)
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
        const funds: Funds = s.decision.action === 'accept' ? 'released' : 'held'
        patch.funds = funds
        ticker(funds === 'released' ? 'ok' : 'alert', funds === 'released' ? 'Funds released against verified km' : `Funds held, ${c.sectionLabel}`)
      }
    }
    set(patch)
  },

  decide: (action, reason, modifyId, simulated) => {
    const s = get()
    if (s.phase !== 'approve') return
    const record = createRoadDecision(s.current, rng, chains, action, reason, new Date())
    set({ decision: { action, reason, modifyId, simulated, record } })
    const who = simulated ? `${s.current.approverRole} (simulated)` : s.current.approverRole
    const what = action === 'modify' ? 'hold (re-test)' : `${action}${reason ? ` (${reason})` : ''}`
    ticker(action === 'accept' ? 'ok' : 'alert', `${who}: ${what}`)
    enter('settle')
  },

  restart: () => {
    set({ ...fresh(), cycle: get().cycle + 1 })
    announce()
  },

  enterScene: () => {
    // Start the story from the top, unless a fresh cycle is already running.
    const s = get()
    if (s.phase === 'scan' && s.t < 0.5) announce()
    else get().restart()
  },
}))

/** Vehicle position along the section (0..1) for a scan time. */
export function scanU(t: number) {
  const u = (t / phaseSeconds.scan - SCAN_START) / (SCAN_END - SCAN_START)
  return Math.min(1, Math.max(0, u))
}

function seal(d: Decision) {
  const s = useRoad.getState()
  const at = new Date()
  const payload = buildPayload(s.current, d, at)
  const entry: RoadEntry = { block: roadLedger.append(payload, at), payload }
  useRoad.setState({ entry, certificate: payload.certificate, entries: [...s.entries, entry].slice(-8) })
  const word = payload.type === 'settlement' ? 'Certificate minted.' : payload.type === 'rejection' ? 'Rejection recorded.' : 'Hold recorded.'
  ticker(payload.type === 'settlement' ? 'ok' : 'alert', `Ledger #${entry.block.seq} sealed. ${word}`)
}

let announced = ''
function announce() {
  const c = useRoad.getState().current
  if (announced === c.id) return
  announced = c.id
  ticker('info', `Photon scanning ${c.sectionLabel}`)
}

function enter(phase: Phase) {
  const s = useRoad.getState()
  const c = s.current
  switch (phase) {
    case 'scan':
      useRoad.getState().restart()
      return
    case 'plan':
      ticker('info', 'Boson: roller passes replayed against plan')
      break
    case 'verify':
      ticker('info', `Plan check: width ${c.widthM} m, thickness ${c.thicknessMm} mm`)
      break
    case 'approve':
      ticker('alert', `Awaiting ${c.approverRole}`)
      break
  }
  useRoad.setState({ phase, t: 0 })
}

export { announce as announceRoad }
