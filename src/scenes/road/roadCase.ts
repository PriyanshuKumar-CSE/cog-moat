import { completionSpecs, type CompletionSpec } from '../../sim/completionSpecs'
import { buildIes, type IesRecord, type OriginChains } from '../../sim/ies'
import type { HumanAction, ReasonCode } from '../../sim/loopCase'
import type { Rng } from '../../sim/rng'

/**
 * One road section under verification: vision scan, roller passes, plan
 * comparison and the records each step produces. All values are simulated.
 */

export type DefectClass = 'pothole' | 'crack' | 'edge_break'

export const defectLabel: Record<DefectClass, string> = {
  pothole: 'POTHOLE',
  crack: 'CRACK',
  edge_break: 'EDGE BREAK',
}

export interface Defect {
  id: string
  cls: DefectClass
  /** Position along the section, 0..1. */
  u: number
  /** Position across the carriageway, -1 (near edge) .. 1 (far edge). */
  across: number
  confidence: number
  chainageKm: number
  record: IesRecord
}

/** Roller pass grid over the section. */
export const PASS_ROWS = 64
export const PASS_COLS = 6
export const MIN_PASSES = 8
export const TARGET_COVERAGE = 95

export interface RoadCase {
  id: string
  /** Section start, km. The section is 0.5 km long. */
  chStart: number
  sectionLabel: string
  spec: CompletionSpec
  approverRole: string
  defects: Defect[]
  /** Index into `defects` of the detection the VLM re-checks. */
  vlmIndex: number
  passes: Float32Array
  coveragePct: number
  medianPasses: number
  thicknessMm: number
  thicknessPlanMm: number
  widthM: number
  widthPlanM: number
  maxOffsetM: number
  records: {
    video: IesRecord
    mask: IesRecord
    roller: IesRecord
    compaction: IesRecord
    plan: IesRecord
    vlm: IesRecord
  }
  verifier: { stage: string; note: string }[]
}

export const SECTION_KM = 0.5

const uuid = (rng: Rng) => {
  const h = () => Math.floor(rng.next() * 16).toString(16)
  const s = (n: number) => Array.from({ length: n }, h).join('')
  return `${s(8)}-${s(4)}-4${s(3)}-${'89ab'[Math.floor(rng.next() * 4)]}${s(3)}-${s(12)}`
}

let ids: {
  customer: string
  camera: string
  roller: string
  detector: string
  segmenter: string
  counter: string
  planner: string
  vlm: string
  scope: string
  person: string
} | null = null

function idsFor(rng: Rng) {
  if (!ids) {
    ids = {
      customer: uuid(rng),
      camera: uuid(rng),
      roller: uuid(rng),
      detector: uuid(rng),
      segmenter: uuid(rng),
      counter: uuid(rng),
      planner: uuid(rng),
      vlm: uuid(rng),
      scope: uuid(rng),
      person: uuid(rng),
    }
  }
  return ids
}

let logPosition = 71200

const km = (v: number) => Number(v.toFixed(3))

export function createRoadCase(rng: Rng, chains: OriginChains, now: Date): RoadCase {
  const id = idsFor(rng)
  const spec = completionSpecs.road
  const chStart = rng.int(2, 17)
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

  // Vision capture of the whole section.
  const video = buildIes(
    chains,
    {
      origin_id: id.camera,
      sense: { origin: id.camera, sensor: 'vehicle_rgb_camera', device_counter: rng.int(1000, 9000), clock_offset_s: Number(rng.range(-0.5, 0.5).toFixed(2)) },
      kind: 'measurement',
      claim: { quantity: 'video_segment', chainage_from_km: chStart, chainage_to_km: chStart + SECTION_KM, frames: rng.int(1400, 2200), subject_ref: subject },
      scope_ref: id.scope,
      occurred_at: at(0),
      lineage: null,
    },
    ingest(at(2200)),
  )

  const widthPlanM = 3.75
  const widthM = Number((widthPlanM + rng.range(-0.02, 0.04)).toFixed(2))
  const mask = buildIes(
    chains,
    {
      origin_id: id.segmenter,
      sense: { model: 'road_segmenter@v2' },
      kind: 'detection',
      claim: {
        class: 'road_surface',
        confidence: Number(rng.range(0.94, 0.99).toFixed(2)),
        mean_width_m: widthM,
        area_m2: Math.round(widthM * SECTION_KM * 1000),
        subject_ref: subject,
      },
      scope_ref: id.scope,
      occurred_at: at(0),
      lineage: { input: [video.observation_id], method: 'road_segmenter', version: 'v2', config: { prompt: 'carriageway', min_confidence: 0.9 } },
    },
    ingest(at(3100)),
  )

  // Three defects, one per third of the section, in random order.
  const classes: DefectClass[] = ['pothole', 'crack', 'edge_break']
  for (let i = classes.length - 1; i > 0; i--) {
    const j = rng.int(0, i)
    ;[classes[i], classes[j]] = [classes[j], classes[i]]
  }
  const slots = [0.2, 0.5, 0.8]
  const defects: Defect[] = classes.map((cls, k) => {
    const u = slots[k] + rng.range(-0.035, 0.035)
    const across = cls === 'edge_break' ? (rng.chance(0.5) ? -0.82 : 0.82) : rng.range(-0.45, 0.45)
    const confidence = Number(rng.range(0.86, 0.97).toFixed(2))
    const chainageKm = km(chStart + u * SECTION_KM)
    const record = buildIes(
      chains,
      {
        origin_id: id.detector,
        sense: { model: 'road_defect_detector@v4', frame: rng.int(10, 2000) },
        kind: 'detection',
        claim: {
          class: cls,
          confidence,
          chainage_km: chainageKm,
          bbox_px: [rng.int(200, 900), rng.int(300, 600), rng.int(60, 180), rng.int(40, 140)],
          subject_ref: subject,
        },
        scope_ref: id.scope,
        occurred_at: at(400 + u * 1800),
        lineage: { input: [video.observation_id], method: 'road_defect_detector', version: 'v4', config: { min_confidence: 0.5, classes } },
      },
      ingest(at(3400 + k * 40)),
    )
    return { id: record.observation_id, cls, u, across, confidence, chainageKm, record }
  })

  // Roller passes: most cells reach the minimum, a few near the edges fall short.
  const passes = new Float32Array(PASS_ROWS * PASS_COLS)
  for (let i = 0; i < passes.length; i++) passes[i] = rng.int(MIN_PASSES, 11)
  const short = rng.int(5, 13)
  for (let k = 0; k < short; k++) {
    const col = rng.chance(0.5) ? 0 : PASS_COLS - 1
    const row = rng.int(0, PASS_ROWS - 1)
    passes[row * PASS_COLS + col] = rng.int(5, MIN_PASSES - 1)
  }
  let covered = 0
  for (const p of passes) if (p >= MIN_PASSES) covered++
  const coveragePct = Number(((covered / passes.length) * 100).toFixed(1))
  const sorted = Array.from(passes).sort((a, b) => a - b)
  const medianPasses = sorted[Math.floor(sorted.length / 2)]

  const roller = buildIes(
    chains,
    {
      origin_id: id.roller,
      sense: { origin: id.roller, sensor: 'roller_imu_gps', device_counter: rng.int(1000, 9000), clock_offset_s: Number(rng.range(-0.5, 0.5).toFixed(2)) },
      kind: 'measurement',
      claim: {
        quantity: 'roller_passes',
        track_points: rng.int(1800, 4200),
        duration_min: rng.int(38, 75),
        max_gps_gap_s: rng.int(4, 60),
        subject_ref: subject,
      },
      scope_ref: id.scope,
      occurred_at: at(-3600_000),
      lineage: null,
    },
    ingest(at(-3590_000)),
  )

  const thicknessPlanMm = 150
  const thicknessMm = rng.int(150, 156)
  const compaction = buildIes(
    chains,
    {
      origin_id: id.counter,
      sense: { model: 'roller_pass_count@v2' },
      kind: 'detection',
      claim: {
        class: 'layer_compacted',
        confidence: Number(rng.range(0.91, 0.98).toFixed(2)),
        median_passes: medianPasses,
        coverage_pct: coveragePct,
        thickness_mm: thicknessMm,
        subject_ref: subject,
      },
      scope_ref: id.scope,
      occurred_at: at(-3600_000),
      lineage: {
        input: [roller.observation_id],
        method: 'roller_pass_count',
        version: 'v2',
        config: { min_passes: MIN_PASSES, min_coverage_pct: TARGET_COVERAGE },
      },
    },
    ingest(at(3600)),
  )

  const maxOffsetM = Number(rng.range(0.06, 0.14).toFixed(2))
  const plan = buildIes(
    chains,
    {
      origin_id: id.planner,
      sense: { model: 'plan_compare@v1' },
      kind: 'measurement',
      claim: {
        quantity: 'as_built_vs_plan',
        max_alignment_offset_m: maxOffsetM,
        width_m: widthM,
        plan_width_m: widthPlanM,
        thickness_mm: thicknessMm,
        plan_thickness_mm: thicknessPlanMm,
        subject_ref: subject,
      },
      scope_ref: id.scope,
      occurred_at: at(3800),
      lineage: { input: [mask.observation_id, compaction.observation_id], method: 'plan_compare', version: 'v1', config: { plan: 'approved_dpr_alignment' } },
    },
    ingest(at(3900)),
  )

  const vlmIndex = rng.int(0, defects.length - 1)
  const target = defects[vlmIndex]
  const vlm = buildIes(
    chains,
    {
      origin_id: id.vlm,
      sense: { model: 'vlm_verifier@v1' },
      kind: 'verification',
      claim: { verdict: 'confirmed', class: target.cls, target: target.id, note: 'visible in 3 consecutive frames', subject_ref: subject },
      scope_ref: id.scope,
      occurred_at: at(4200),
      lineage: { input: [target.id, video.observation_id], method: 'vlm_verifier', version: 'v1', config: { frames: 3 } },
    },
    ingest(at(4400)),
  )

  return {
    id: uuid(rng),
    chStart,
    sectionLabel: `ch ${chStart.toFixed(1)}-${(chStart + SECTION_KM).toFixed(1)} km`,
    spec,
    approverRole: spec.authority.sign,
    defects,
    vlmIndex,
    passes,
    coveragePct,
    medianPasses,
    thicknessMm,
    thicknessPlanMm,
    widthM,
    widthPlanM,
    maxOffsetM,
    records: { video, mask, roller, compaction, plan, vlm },
    verifier: [
      { stage: spec.verifierChain[0], note: `${coveragePct}% at ≥ ${MIN_PASSES} passes` },
      { stage: spec.verifierChain[1], note: 'within band' },
      { stage: spec.verifierChain[2], note: `${defectLabel[target.cls].toLowerCase()} confirmed` },
      { stage: spec.verifierChain[3], note: '' },
    ],
  }
}

export function createRoadDecision(c: RoadCase, rng: Rng, chains: OriginChains, action: HumanAction, reason: ReasonCode | null, at: Date): IesRecord {
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
        section: c.sectionLabel,
        evidence: [c.records.compaction.observation_id, c.records.plan.observation_id, c.records.vlm.observation_id],
        subject_ref: c.records.compaction.subject_ref,
      },
      scope_ref: c.records.compaction.scope_ref,
      occurred_at: at,
      lineage: {
        input: [c.records.compaction.observation_id, c.records.plan.observation_id],
        method: 'human_review',
        version: 'v1',
        config: { role: c.approverRole },
      },
    },
    { customer_id: id.customer, log_position: ++logPosition, observation_id: uuid(rng), arrived_at: at, believed_at: at },
  )
}
