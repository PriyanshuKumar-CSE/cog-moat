import type { CompletionSpec } from '../../sim/completionSpecs'
import { buildIes, type IesRecord, type OriginChains } from '../../sim/ies'
import type { HumanAction, ReasonCode } from '../../sim/loopCase'
import type { Rng } from '../../sim/rng'
import { MONITORING, stages, type FindingTemplate, type Measure, type StageDef } from './stages'

/**
 * One building milestone under verification: what was scanned, what the
 * sensors heard, the plan comparison, the findings and the records each step
 * produces. All values are simulated.
 */

export interface Finding extends FindingTemplate {
  id: string
  confidence: number
  /** Scan height at which the finding is detected. */
  y: number
  record: IesRecord
}

export interface BuildingCase {
  id: string
  index: number
  stage: StageDef
  /** "M3 · RCC frame" style label. */
  label: string
  spec: CompletionSpec
  approverRole: string
  monitoring: boolean
  findings: Finding[]
  /** Index into `findings` of the detection the VLM re-checks. */
  vlmIndex: number
  measures: Measure[]
  records: {
    scan: IesRecord
    sensor: IesRecord
    plan: IesRecord
    completion: IesRecord
    vlm: IesRecord
  }
  verifier: { stage: string; note: string }[]
}

const uuid = (rng: Rng) => {
  const h = () => Math.floor(rng.next() * 16).toString(16)
  const s = (n: number) => Array.from({ length: n }, h).join('')
  return `${s(8)}-${s(4)}-4${s(3)}-${'89ab'[Math.floor(rng.next() * 4)]}${s(3)}-${s(12)}`
}

interface Ids {
  customer: string
  scope: string
  person: string
  detector: string
  planner: string
  verifier: string
  vlm: string
  devices: Map<string, string>
}

let ids: Ids | null = null

function idsFor(rng: Rng): Ids {
  if (!ids) {
    ids = {
      customer: uuid(rng),
      scope: uuid(rng),
      person: uuid(rng),
      detector: uuid(rng),
      planner: uuid(rng),
      verifier: uuid(rng),
      vlm: uuid(rng),
      devices: new Map(),
    }
  }
  return ids
}

function device(rng: Rng, name: string) {
  const id = idsFor(rng)
  let d = id.devices.get(name)
  if (!d) {
    d = uuid(rng)
    id.devices.set(name, d)
  }
  return d
}

let logPosition = 93400

export const milestoneLabel = (index: number) =>
  index === MONITORING ? `After handover · ${stages[index].short}` : `M${index + 1} · ${stages[index].short}`

export function createBuildingCase(index: number, rng: Rng, chains: OriginChains, now: Date): BuildingCase {
  const id = idsFor(rng)
  const stage = stages[index]
  const spec = stage.spec
  const monitoring = index === MONITORING
  const subject = uuid(rng)
  const t0 = new Date(now.getTime() - rng.int(40, 120) * 1000)
  const at = (offsetMs: number) => new Date(t0.getTime() + offsetMs)
  const ingest = (when: Date) => ({
    customer_id: id.customer,
    log_position: ++logPosition,
    observation_id: uuid(rng),
    arrived_at: when,
    believed_at: when,
  })
  const capture = (origin: string) => ({
    origin,
    device_counter: rng.int(1000, 9000),
    clock_offset_s: Number(rng.range(-0.5, 0.5).toFixed(2)),
  })

  const scanOrigin = device(rng, stage.scanSensor)
  const scan = buildIes(
    chains,
    {
      origin_id: scanOrigin,
      sense: { ...capture(scanOrigin), sensor: stage.scanSensor },
      kind: 'measurement',
      claim: monitoring
        ? { quantity: 'facade_frame', resolution_px: [4096, 3072], subject_ref: subject }
        : {
            quantity: stage.scanSensor === 'drone_lidar' ? 'point_cloud' : 'image_set',
            ...(stage.scanSensor === 'drone_lidar' ? { points: rng.int(8, 22) * 1_000_000 } : { frames: rng.int(380, 1400) }),
            milestone: stage.id,
            subject_ref: subject,
          },
      scope_ref: id.scope,
      occurred_at: at(0),
      lineage: null,
    },
    ingest(at(2400)),
  )

  const measures = stage.measures(rng)

  const sensorOrigin = device(rng, stage.bosonSensor)
  const sensor = buildIes(
    chains,
    {
      origin_id: sensorOrigin,
      sense: { ...capture(sensorOrigin), sensor: stage.bosonSensor },
      kind: 'measurement',
      claim: { quantity: stage.bosonQuantity, readings: rng.int(40, 900), window_h: monitoring ? 336 : rng.int(6, 72), subject_ref: subject },
      scope_ref: id.scope,
      occurred_at: at(-3_600_000),
      lineage: null,
    },
    ingest(at(-3_590_000)),
  )

  const findings: Finding[] = stage.findings.map((tpl, k) => {
    const confidence = Number(rng.range(0.86, 0.97).toFixed(2))
    const record = buildIes(
      chains,
      {
        origin_id: id.detector,
        sense: { model: monitoring ? 'shm_threshold@v1' : 'site_defect_detector@v3' },
        kind: 'detection',
        claim: { class: tpl.cls.toLowerCase().replace(/ /g, '_'), confidence, location: tpl.where, subject_ref: subject },
        scope_ref: id.scope,
        occurred_at: at(500 + k * 700),
        lineage: {
          input: [monitoring ? sensor.observation_id : scan.observation_id],
          method: monitoring ? 'shm_threshold' : 'site_defect_detector',
          version: monitoring ? 'v1' : 'v3',
          config: { min_confidence: 0.5 },
        },
      },
      ingest(at(3000 + k * 50)),
    )
    return { ...tpl, id: record.observation_id, confidence, y: tpl.at[1], record }
  })

  const plan = buildIes(
    chains,
    {
      origin_id: id.planner,
      sense: { model: monitoring ? 'baseline_compare@v1' : 'bim_compare@v1' },
      kind: 'measurement',
      claim: {
        quantity: monitoring ? 'reading_vs_baseline' : 'as_built_vs_bim',
        checks: measures.map((m) => ({ check: m.label, value: m.value, plan: m.plan, ok: m.ok })),
        subject_ref: subject,
      },
      scope_ref: id.scope,
      occurred_at: at(3600),
      lineage: {
        input: [scan.observation_id, sensor.observation_id],
        method: monitoring ? 'baseline_compare' : 'bim_compare',
        version: 'v1',
        config: { plan: monitoring ? 'design_limits' : 'approved_bim_rev_c' },
      },
    },
    ingest(at(3700)),
  )

  const completion = buildIes(
    chains,
    {
      origin_id: id.verifier,
      sense: { model: 'milestone_verifier@v1' },
      kind: 'detection',
      claim: {
        class: monitoring ? 'crack_widening' : `${stage.id}_complete`,
        confidence: Number(rng.range(0.91, 0.98).toFixed(2)),
        spec: spec.id,
        checks_passed: measures.filter((m) => m.ok).length,
        checks_total: measures.length,
        findings: findings.length,
        subject_ref: subject,
      },
      scope_ref: id.scope,
      occurred_at: at(3900),
      lineage: {
        input: [plan.observation_id, sensor.observation_id, ...findings.map((f) => f.id)],
        method: 'milestone_verifier',
        version: 'v1',
        config: { checks: spec.checks },
      },
    },
    ingest(at(4000)),
  )

  const vlmIndex = rng.int(0, findings.length - 1)
  const target = findings[vlmIndex]
  const vlm = buildIes(
    chains,
    {
      origin_id: id.vlm,
      sense: { model: 'vlm_verifier@v1' },
      kind: 'verification',
      claim: {
        verdict: 'confirmed',
        class: target.cls.toLowerCase().replace(/ /g, '_'),
        target: target.id,
        note: monitoring ? 'crack visible on facade frame, matches gauge axis' : 'visible in 3 frames from 2 angles',
        subject_ref: subject,
      },
      scope_ref: id.scope,
      occurred_at: at(4300),
      lineage: { input: [target.id, scan.observation_id], method: 'vlm_verifier', version: 'v1', config: { frames: 3 } },
    },
    ingest(at(4500)),
  )

  const passed = measures.filter((m) => m.ok).length
  return {
    id: uuid(rng),
    index,
    stage,
    label: milestoneLabel(index),
    spec,
    approverRole: spec.authority.sign,
    monitoring,
    findings,
    vlmIndex,
    measures,
    records: { scan, sensor, plan, completion, vlm },
    verifier: [
      { stage: spec.verifierChain[0], note: monitoring ? `${measures.length - passed} limit crossed` : `${passed} / ${measures.length} checks` },
      { stage: spec.verifierChain[1], note: monitoring ? 'trend outside baseline' : 'within band' },
      { stage: spec.verifierChain[2], note: `${target.cls.toLowerCase()} confirmed` },
      { stage: spec.verifierChain[3], note: '' },
    ],
  }
}

export function createBuildingDecision(
  c: BuildingCase,
  rng: Rng,
  chains: OriginChains,
  action: HumanAction,
  reason: ReasonCode | null,
  at: Date,
): IesRecord {
  const id = idsFor(rng)
  return buildIes(
    chains,
    {
      origin_id: id.person,
      sense: { method: 'approval_console', role: c.approverRole },
      kind: 'verification',
      claim: {
        action,
        reason_code: reason,
        spec: c.spec.id,
        milestone: c.label,
        evidence: [c.records.completion.observation_id, c.records.plan.observation_id, c.records.vlm.observation_id],
        subject_ref: c.records.completion.subject_ref,
      },
      scope_ref: c.records.completion.scope_ref,
      occurred_at: at,
      lineage: {
        input: [c.records.completion.observation_id, c.records.plan.observation_id],
        method: 'human_review',
        version: 'v1',
        config: { role: c.approverRole },
      },
    },
    { customer_id: id.customer, log_position: ++logPosition, observation_id: uuid(rng), arrived_at: at, believed_at: at },
  )
}
