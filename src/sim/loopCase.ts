import { deployments, type Domain } from '../config/content'
import { completionSpecs, type CompletionSpec } from './completionSpecs'
import { buildIes, OriginChains, type IesRecord } from './ies'
import type { Rng } from './rng'

/**
 * One trip around the loop: a capture, a method-derived claim, and
 * (after the human decides) a verification observation from a Person origin.
 */

export type HumanAction = 'accept' | 'reject' | 'modify'
export type ReasonCode = 'weather' | 'safety' | 'operator' | 'equipment' | 'other'

export interface LoopCase {
  id: string
  domain: Domain
  siteName: string
  spec: CompletionSpec
  /** Plain-language summary of what was sensed. */
  headline: string
  /** Typed task from the INTENT step. */
  task: { id: string; text: string; plannedBy: string; approvedBy: string }
  /** Scheduler choice in the SCHEDULER step. */
  schedule: { model: string; slot: number; costMs: number; value: number; skipped: number }
  capture: IesRecord
  derived: IesRecord
  verifierResults: { stage: string; result: 'pass' | 'skipped' | 'pending' }[]
  approverRole: string
  /** What settles if accepted. */
  settleLine: string
}

const uuid = (rng: Rng) => {
  const h = () => Math.floor(rng.next() * 16).toString(16)
  const s = (n: number) => Array.from({ length: n }, h).join('')
  return `${s(8)}-${s(4)}-4${s(3)}-${'89ab'[Math.floor(rng.next() * 4)]}${s(3)}-${s(12)}`
}

/** Stable placeholder ids per domain so every case of a domain shares a tenant and devices. */
const domainIds = new Map<Domain, { customer: string; device: string; method: string; scope: string; person: string }>()

function idsFor(domain: Domain, rng: Rng) {
  let ids = domainIds.get(domain)
  if (!ids) {
    ids = { customer: uuid(rng), device: uuid(rng), method: uuid(rng), scope: uuid(rng), person: uuid(rng) }
    domainIds.set(domain, ids)
  }
  return ids
}

let logPosition = 48000

export function createLoopCase(domain: Domain, rng: Rng, chains: OriginChains, now: Date): LoopCase {
  const ids = idsFor(domain, rng)
  const sites = deployments.filter((d) => d.domain === domain)
  const site = sites.length ? rng.pick(sites) : null
  const spec = completionSpecs[domain]
  const occurred = new Date(now.getTime() - rng.int(20, 90) * 1000)
  const arrived = new Date(occurred.getTime() + rng.int(800, 4000))
  const derivedAt = new Date(arrived.getTime() + rng.int(300, 1500))
  const subject = uuid(rng)

  const ingest = (at: Date) => ({
    customer_id: ids.customer,
    log_position: ++logPosition,
    observation_id: uuid(rng),
    arrived_at: at,
    believed_at: at,
  })

  const g = generators[domain](rng)

  const capture = buildIes(
    chains,
    {
      origin_id: ids.device,
      sense: { origin: ids.device, device_counter: rng.int(1000, 9000), clock_offset_s: Number(rng.range(-0.6, 0.6).toFixed(2)), ...g.sense },
      kind: g.captureKind,
      claim: { ...g.captureClaim, subject_ref: subject },
      scope_ref: ids.scope,
      occurred_at: occurred,
      lineage: null,
    },
    ingest(arrived),
  )

  const derived = buildIes(
    chains,
    {
      origin_id: ids.method,
      sense: { model: g.method },
      kind: g.derivedKind,
      claim: { ...g.derivedClaim, subject_ref: subject },
      scope_ref: ids.scope,
      occurred_at: occurred,
      lineage: { input: [capture.observation_id], method: g.method.split('@')[0], version: g.method.split('@')[1], config: g.config },
    },
    ingest(derivedAt),
  )

  return {
    id: rng.id('case'),
    domain,
    siteName: site?.name ?? '',
    spec,
    headline: g.headline,
    task: { id: rng.id('task'), text: g.task, plannedBy: 'Planner (deterministic solver)', approvedBy: g.planApprover },
    schedule: { model: g.method, slot: rng.int(1, 3), costMs: rng.int(18, 140), value: Number(rng.range(0.55, 0.97).toFixed(2)), skipped: rng.int(2, 5) },
    capture,
    derived,
    verifierResults: spec.verifierChain.map((stage, i, all) => ({
      stage,
      result: i === all.length - 1 ? 'pending' : i === all.length - 2 && rng.chance(0.5) ? 'skipped' : 'pass',
    })),
    approverRole: spec.authority.sign,
    settleLine: spec.settles,
  }
}

export function createDecision(
  c: LoopCase,
  rng: Rng,
  chains: OriginChains,
  action: HumanAction,
  reason: ReasonCode | null,
  at: Date,
): IesRecord {
  const ids = idsFor(c.domain, rng)
  return buildIes(
    chains,
    {
      origin_id: ids.person,
      sense: { method: 'approval_console', role: c.approverRole },
      kind: 'verification',
      claim: {
        action,
        reason_code: reason,
        spec: c.spec.id,
        evidence: [c.capture.observation_id, c.derived.observation_id],
        subject_ref: c.derived.subject_ref,
      },
      scope_ref: c.derived.scope_ref,
      occurred_at: at,
      lineage: { input: [c.derived.observation_id], method: 'human_review', version: 'v1', config: { role: c.approverRole } },
    },
    {
      customer_id: ids.customer,
      log_position: ++logPosition,
      observation_id: uuid(rng),
      arrived_at: at,
      believed_at: at,
    },
  )
}

interface DomainGen {
  headline: string
  task: string
  planApprover: string
  method: string
  config: Record<string, unknown>
  sense: Record<string, unknown>
  captureKind: IesRecord['kind']
  captureClaim: Record<string, unknown>
  derivedKind: IesRecord['kind']
  derivedClaim: Record<string, unknown>
}

const generators: Record<Domain, (rng: Rng) => DomainGen> = {
  road: (rng) => {
    const passes = rng.int(8, 10)
    const coverage = Number(rng.range(95.2, 99.1).toFixed(1))
    const chainage = rng.int(1, 18)
    return {
      headline: `Layer compaction, ch. ${chainage}.0–${chainage}.5 km`,
      task: `Compact base layer, ch. ${chainage}.0–${chainage}.5 km, 8 passes min.`,
      planApprover: 'Assistant Engineer',
      method: 'roller_pass_count@v2',
      config: { min_passes: 8, min_coverage_pct: 95 },
      sense: { sensor: 'roller_imu_gps' },
      captureKind: 'measurement',
      captureClaim: { quantity: 'roller_passes', track_points: rng.int(1800, 4200), duration_min: rng.int(38, 75) },
      derivedKind: 'detection',
      derivedClaim: { class: 'layer_compacted', confidence: Number(rng.range(0.91, 0.98).toFixed(2)), passes, coverage_pct: coverage, thickness_mm: rng.int(148, 156) },
    }
  },
  mine: (rng) => {
    const payload = rng.int(84, 99)
    const truck = rng.int(3, 24)
    return {
      headline: `Haul trip, Truck ${truck}`,
      task: `Move overburden, Loader 2 to Dump B, Truck ${truck}`,
      planApprover: 'Shift In-charge',
      method: 'trip_correlator@v3',
      config: { min_payload_pct: 80, max_gps_gap_s: 180, min_confidence: 0.9 },
      sense: { sensor: 'payload_gps_telemetry' },
      captureKind: 'measurement',
      captureClaim: { quantity: 'payload_pct_rated', value: payload, gps_gap_s: rng.int(4, 90) },
      derivedKind: 'detection',
      derivedClaim: { class: 'haul_trip', confidence: Number(rng.range(0.92, 0.99).toFixed(2)), load_event: true, dump_in_zone: true, payload_pct: payload, truck: `T${truck}` },
    }
  },
  water: (rng) => {
    const loss = Number(rng.range(9, 24).toFixed(1))
    return {
      headline: `Night-flow imbalance, DMA ${rng.int(2, 9)}`,
      task: 'Balance check, DMA inlet vs consumer meters, 02:00–04:00',
      planApprover: 'Zone Operator',
      method: 'dma_balance@v1',
      config: { nrw_threshold_pct: 15, baseline_window_days: 14 },
      sense: { sensor: 'bulk_flow_meter', brand_agnostic: true },
      captureKind: 'measurement',
      captureClaim: { quantity: 'inlet_flow_m3', value: Number(rng.range(310, 480).toFixed(1)) },
      derivedKind: 'detection',
      derivedClaim: { class: 'nrw_anomaly', confidence: Number(rng.range(0.9, 0.97).toFixed(2)), loss_pct: loss, suspected: 'leak' },
    }
  },
  building: (rng) => {
    const level = rng.int(2, 6)
    return {
      headline: `RCC slab, level ${level}`,
      task: `Cast level ${level} slab, M30, as per approved drawings`,
      planApprover: 'Site Engineer',
      method: 'slab_verifier@v1',
      config: { max_plumb_mm: 10, max_level_mm: 10, min_cube_margin_mpa: 4 },
      sense: { sensor: 'slab_maturity_sensor' },
      captureKind: 'measurement',
      captureClaim: { quantity: 'maturity_strength_mpa', value: Number(rng.range(22, 27).toFixed(1)) },
      derivedKind: 'detection',
      derivedClaim: {
        class: 'slab_complete',
        confidence: Number(rng.range(0.91, 0.98).toFixed(2)),
        level,
        max_plumb_mm: rng.int(3, 8),
        cube_strength_mpa: Number(rng.range(35, 39).toFixed(1)),
      },
    }
  },
  forest: (rng) => ({
    headline: `Thermal hotspot, cell ${String.fromCharCode(65 + rng.int(0, 7))}${rng.int(1, 12)}`,
    task: 'Watch canopy cells for fire and encroachment, dawn pass',
    planApprover: 'Range Officer',
    method: 'fire_detector@v2',
    config: { min_frames: 2, min_confidence: 0.85 },
    sense: { sensor: 'thermal_camera' },
    captureKind: 'detection',
    captureClaim: { class: 'thermal_anomaly', confidence: Number(rng.range(0.7, 0.85).toFixed(2)) },
    derivedKind: 'detection',
    derivedClaim: { class: 'fire', confidence: Number(rng.range(0.86, 0.95).toFixed(2)), frames: rng.int(2, 5) },
  }),
}
