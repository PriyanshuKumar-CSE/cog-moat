import { create } from 'zustand'
import type { Domain, LoopStepId } from '../../config/content'
import { useApp } from '../../core/store'
import { OriginChains, type IesRecord } from '../../sim/ies'
import { Ledger, type LedgerBlock } from '../../sim/ledger'
import { createDecision, createLoopCase, type HumanAction, type LoopCase, type ReasonCode } from '../../sim/loopCase'
import { createRng } from '../../sim/rng'

/**
 * Loop director. Moves one event through the six steps, pausing at the
 * human approval gate between VERIFY and SETTLE.
 */

export type Phase = 'intent' | 'sense' | 'schedule' | 'verify' | 'approve' | 'settle' | 'learn'

export const phaseSeconds: Record<Phase, number> = {
  intent: 3.2,
  sense: 2.8,
  schedule: 3.2,
  verify: 3.6,
  approve: Infinity,
  settle: 3.8,
  learn: 3.4,
}

const order: Phase[] = ['intent', 'sense', 'schedule', 'verify', 'approve', 'settle', 'learn']

export const phaseStep: Record<Phase, LoopStepId> = {
  intent: 'intent',
  sense: 'sense',
  schedule: 'schedule',
  verify: 'verify',
  approve: 'verify',
  settle: 'settle',
  learn: 'learn',
}

export const domainCycle: Domain[] = ['road', 'mine', 'water', 'forest', 'building']

export interface Decision {
  action: HumanAction
  reason: ReasonCode | null
  modifyId: string | null
  simulated: boolean
  record: IesRecord
}

export interface Certificate {
  certificate_id: string
  spec: string
  subject_ref: string | null
  result: 'verified' | 'verified-modified' | 'not-settled'
  settles: string
  evidence: { observation_id: string; hash: string }[]
  approved_by_role: string
  issued_at: string
}

export interface LedgerEntry {
  block: LedgerBlock
  payload: LedgerPayload
  domain: Domain
}

export interface LedgerPayload {
  type: 'settlement' | 'rejection'
  certificate: Certificate | null
  decision: { observation_id: string; action: HumanAction; reason_code: ReasonCode | null }
  observations: { observation_id: string; hash: string }[]
}

export interface DecisionRecord {
  id: string
  site_id: string
  timestamp: string
  state_snapshot: string
  recommendation: string
  human_action: HumanAction
  reason_code: ReasonCode | null
  outcome: string
  outcome_window: string
}

interface LoopState {
  phase: Phase
  t: number
  cycle: number
  current: LoopCase
  decision: Decision | null
  certificate: Certificate | null
  entries: LedgerEntry[]
  decisionLog: DecisionRecord[]
  drill: 'schedule' | 'learn' | null
  tick: (dt: number) => void
  decide: (action: HumanAction, reason: ReasonCode | null, modifyId: string | null, simulated: boolean) => void
  setDrill: (d: 'schedule' | 'learn' | null) => void
}

// Non-reactive simulation state.
const rng = createRng(2807)
const chains = new OriginChains()
export const eventLedger = new Ledger('cortex.event-ledger')

const ticker = (level: 'info' | 'ok' | 'alert', text: string) => useApp.getState().pushTicker({ level, text })

function settleWord(domain: Domain, action: HumanAction) {
  if (action === 'reject') return 'Not settled. Rejection recorded.'
  return {
    road: 'Certificate signed. Funds released.',
    mine: 'Trip counted. Contractor payment eligible.',
    water: 'Verified loss written to Water Ledger.',
    forest: 'Incident confirmed. Patrol dispatch recorded.',
    building: 'Milestone certificate signed. RA bill released.',
  }[domain]
}

export const approvalCopy: Record<Domain, { title: string; ask: string; modify: { id: string; label: string }[] }> = {
  road: {
    title: 'Sign completion certificate',
    ask: 'Completion matches spec. Sign and release funds against verified km?',
    modify: [{ id: 'retest', label: 'Hold: re-test thickness' }],
  },
  mine: {
    title: 'Count haul trip',
    ask: 'Load, haul and dump line up with payload. Count trip for contractor payment?',
    modify: [{ id: 'partial', label: 'Count as partial load' }],
  },
  water: {
    title: 'Confirm NRW anomaly',
    ask: 'Night-flow imbalance above threshold. Write verified loss to Water Ledger?',
    modify: [{ id: 'crew', label: 'Send field crew first' }],
  },
  building: {
    title: 'Sign milestone certificate',
    ask: 'Slab geometry and cube strength meet spec. Sign and release the RA bill?',
    modify: [{ id: 'cubes', label: 'Hold: re-test cubes' }],
  },
  forest: {
    title: 'Confirm fire incident',
    ask: 'Hotspot persists across frames inside boundary. Confirm and dispatch patrol?',
    modify: [{ id: 'second', label: 'Request second pass' }],
  },
}

function buildSettlement(c: LoopCase, d: Decision, at: Date): LedgerPayload {
  const observations = [c.capture, c.derived, d.record].map((r) => ({ observation_id: r.observation_id, hash: r.hash }))
  const certificate: Certificate | null =
    d.action === 'reject'
      ? null
      : {
          certificate_id: rng.id('cert', 10),
          spec: c.spec.id,
          subject_ref: c.derived.subject_ref,
          result: d.action === 'modify' ? 'verified-modified' : 'verified',
          settles: c.spec.settles,
          evidence: observations,
          approved_by_role: c.approverRole,
          issued_at: at.toISOString(),
        }
  return {
    type: d.action === 'reject' ? 'rejection' : 'settlement',
    certificate,
    decision: { observation_id: d.record.observation_id, action: d.action, reason_code: d.reason },
    observations,
  }
}

/** Seeds the ledger with a few earlier settlements so the chain has history. */
function seedHistory(): LedgerEntry[] {
  const out: LedgerEntry[] = []
  const now = Date.now()
  for (let i = 0; i < 6; i++) {
    const domain = domainCycle[i % domainCycle.length]
    const at = new Date(now - (26 - i * 3.5) * 3600_000)
    const c = createLoopCase(domain, rng, chains, at)
    const action: HumanAction = i === 2 ? 'reject' : 'accept'
    const reason: ReasonCode | null = i === 2 ? 'weather' : null
    const record = createDecision(c, rng, chains, action, reason, at)
    const payload = buildSettlement(c, { action, reason, modifyId: null, simulated: true, record }, at)
    const block = eventLedger.append(payload, at)
    out.push({ block, payload, domain })
  }
  return out
}

const seeded = seedHistory()
let announced = false

/** Called when the Loop scene mounts, so the ticker shows the first task. */
export function announceLoop() {
  if (announced) return
  announced = true
  ticker('info', `Intent: ${useLoop.getState().current.task.text}`)
}

export const useLoop = create<LoopState>((set, get) => ({
  phase: 'intent',
  t: 0,
  cycle: 0,
  current: createLoopCase(domainCycle[0], rng, chains, new Date()),
  decision: null,
  certificate: null,
  entries: seeded,
  decisionLog: [],
  drill: null,

  tick: (dt) => {
    const s = get()
    const limit = phaseSeconds[s.phase]
    const t = s.t + dt
    if (t < limit) {
      set({ t })
      return
    }
    const next = order[(order.indexOf(s.phase) + 1) % order.length]
    enter(next)
  },

  decide: (action, reason, modifyId, simulated) => {
    const s = get()
    if (s.phase !== 'approve') return
    const at = new Date()
    const record = createDecision(s.current, rng, chains, action, reason, at)
    const decision: Decision = { action, reason, modifyId, simulated, record }
    set({ decision })
    const who = simulated ? `${s.current.approverRole} (simulated)` : s.current.approverRole
    ticker(action === 'reject' ? 'alert' : 'ok', `${who}: ${action}${reason ? ` (${reason})` : ''}`)
    enter('settle')
  },

  setDrill: (drill) => set({ drill }),
}))

function enter(phase: Phase) {
  const s = useLoop.getState()
  const c = s.current
  switch (phase) {
    case 'intent': {
      const domain = domainCycle[(s.cycle + 1) % domainCycle.length]
      const next = createLoopCase(domain, rng, chains, new Date())
      useLoop.setState({ phase, t: 0, cycle: s.cycle + 1, current: next, decision: null, certificate: null })
      ticker('info', `Intent: ${next.task.text}`)
      return
    }
    case 'sense':
      ticker('info', `Sense: ${c.capture.kind} from ${String(c.capture.sense.sensor ?? 'device')}`)
      break
    case 'schedule':
      ticker('info', `Scheduler: ${c.schedule.model} on slot ${c.schedule.slot}, ${c.schedule.skipped} idle models skipped`)
      break
    case 'verify':
      ticker('info', `Verify: ${c.headline}`)
      break
    case 'approve':
      ticker('alert', `Awaiting ${c.approverRole}`)
      break
    case 'settle': {
      const d = s.decision ?? useLoop.getState().decision
      if (!d) break
      const at = new Date()
      const payload = buildSettlement(c, d, at)
      const block = eventLedger.append(payload, at)
      const entries = [...useLoop.getState().entries, { block, payload, domain: c.domain }].slice(-12)
      useLoop.setState({ phase, t: 0, entries, certificate: payload.certificate })
      ticker(d.action === 'reject' ? 'alert' : 'ok', `Ledger #${block.seq} sealed. ${settleWord(c.domain, d.action)}`)
      return
    }
    case 'learn': {
      const d = s.decision
      if (d) {
        const rec: DecisionRecord = {
          id: rng.id('dec'),
          site_id: c.derived.scope_ref,
          timestamp: d.record.occurred_at,
          state_snapshot: c.derived.observation_id,
          recommendation: approvalCopy[c.domain].title,
          human_action: d.action,
          reason_code: d.reason,
          outcome: 'measured later',
          outcome_window: '24h',
        }
        useLoop.setState({ decisionLog: [rec, ...s.decisionLog].slice(0, 20) })
        ticker('info', `Learn: decision record ${rec.id} written`)
      }
      break
    }
  }
  useLoop.setState({ phase, t: 0 })
}

export { settleWord }
