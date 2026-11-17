import type { Domain } from '../config/content'

/**
 * Completion specs: what "done" means, turned into code.
 * Road and mine specs follow Cognecto's own notes. Water, forest and building
 * are simulation drafts in the same shape.
 */
export interface CompletionSpec {
  id: string
  domain: Domain
  title: string
  evidenceRequired: string[]
  checks: string[]
  tolerance: string[]
  verifierChain: string[]
  authority: { sign: string; dispute: string }
  settles: string
  draft: boolean
}

/**
 * Building construction, one spec per milestone from excavation to paint,
 * plus structural health monitoring after handover. All drafts: synthesised
 * for the simulation, not from Cognecto's notes. Edit here.
 */
export type BuildingStageId =
  | 'excavation'
  | 'foundation'
  | 'frame'
  | 'masonry'
  | 'plumbing'
  | 'electrical'
  | 'plaster'
  | 'flooring'
  | 'paint'
  | 'monitoring'

const building = (
  id: string,
  title: string,
  rest: Omit<CompletionSpec, 'id' | 'domain' | 'title' | 'draft'>,
): CompletionSpec => ({ id: `spec.building.${id}`, domain: 'building', title, draft: true, ...rest })

const raBill = 'Verified milestone → RA bill release'

export const buildingSpecs: Record<BuildingStageId, CompletionSpec> = {
  excavation: building('excavation_piling', 'Excavation and piling', {
    evidenceRequired: ['Drone LiDAR survey of the pit', 'Pile rig depth + torque log', 'Pile integrity test results'],
    checks: ['Formation level within ±50 mm of design', 'Every pile reaches design depth', 'Integrity test sound for every pile'],
    tolerance: ['Survey density ≥ 50 pts/m²', 'Confidence ≥ 0.9'],
    verifierChain: ['Survey rules', 'Anomaly vs similar sites', 'VLM on pit imagery', 'Engineer'],
    authority: { sign: 'Geotechnical Engineer', dispute: 'Piling contractor' },
    settles: raBill,
  }),
  foundation: building('raft_foundation', 'Raft foundation and basement walls', {
    evidenceRequired: ['Pre-pour rebar frames', 'Transit mixer batch tickets', 'Embedded maturity sensors'],
    checks: ['Rebar inspected before pour', 'Poured volume within ±3% of BOQ', 'Maturity strength ≥ 70% fck before stripping'],
    tolerance: ['Sensor gap ≤ 30 min', 'Confidence ≥ 0.9'],
    verifierChain: ['Pour rules', 'Anomaly vs similar pours', 'VLM on rebar frames', 'Engineer'],
    authority: { sign: 'Structural Engineer', dispute: 'Civil contractor' },
    settles: raBill,
  }),
  frame: building('rcc_frame', 'RCC frame, columns and slabs', {
    evidenceRequired: ['Drone scan per slab', 'Batch tickets + cube tests', 'Slab maturity sensors'],
    checks: ['Column plumb ≤ 10 mm per storey', 'Slab level within ±10 mm', 'Cube strength ≥ fck + 4 MPa'],
    tolerance: ['Scan gap ≤ 1 day per slab', 'Confidence ≥ 0.9'],
    verifierChain: ['Geometry rules', 'Anomaly vs similar frames', 'VLM on scan frames', 'Engineer'],
    authority: { sign: 'Structural Engineer', dispute: 'Civil contractor' },
    settles: raBill,
  }),
  masonry: building('masonry', 'Block masonry and lintels', {
    evidenceRequired: ['Wall segmentation from scan', 'Opening detections', 'Block delivery tickets'],
    checks: ['Wall area within ±2% of plan', 'Every opening has a lintel', 'Wall plumb ≤ 6 mm per 3 m'],
    tolerance: ['Scan coverage ≥ 95% of facade', 'Confidence ≥ 0.9'],
    verifierChain: ['Geometry rules', 'Anomaly vs similar walls', 'VLM on openings', 'Engineer'],
    authority: { sign: 'Project Engineer', dispute: 'Masonry contractor' },
    settles: raBill,
  }),
  plumbing: building('plumbing_water', 'Plumbing, water supply and drainage', {
    evidenceRequired: ['Hydrostatic test pressure log', 'Fixture point detections', 'Tank fill flow log'],
    checks: ['1.5 × working pressure held 30 min, drop ≤ 0.2 bar', 'Fixture points match drawings', 'Drain slope ≥ 1:40'],
    tolerance: ['Pressure log gap ≤ 1 min', 'Confidence ≥ 0.9'],
    verifierChain: ['Test rules', 'Anomaly vs similar tests', 'VLM on joints', 'Engineer'],
    authority: { sign: 'MEP Engineer', dispute: 'Plumbing contractor' },
    settles: raBill,
  }),
  electrical: building('electrical', 'Electrical wiring, boards and earthing', {
    evidenceRequired: ['Insulation resistance readings', 'Earth pit resistance', 'Board and conduit detections'],
    checks: ['Insulation resistance ≥ 1 MΩ per circuit', 'Earth resistance ≤ 2 Ω', 'RCD trips ≤ 40 ms'],
    tolerance: ['Every circuit tested', 'Confidence ≥ 0.9'],
    verifierChain: ['Test rules', 'Anomaly vs similar installs', 'VLM on boards', 'Engineer'],
    authority: { sign: 'MEP Engineer', dispute: 'Electrical contractor' },
    settles: raBill,
  }),
  plaster: building('plaster', 'Internal and external plaster', {
    evidenceRequired: ['Surface scan', 'Thickness probes', 'Wall moisture sensors'],
    checks: ['Thickness 12 mm ± 3 mm', 'Flatness ≤ 3 mm under 2 m', 'Area within ±2% of plan'],
    tolerance: ['Scan coverage ≥ 95%', 'Confidence ≥ 0.9'],
    verifierChain: ['Surface rules', 'Anomaly vs similar floors', 'VLM on cracks', 'Engineer'],
    authority: { sign: 'Project Engineer', dispute: 'Finishing contractor' },
    settles: raBill,
  }),
  flooring: building('flooring_waterproofing', 'Flooring and waterproofing', {
    evidenceRequired: ['Thermal scan for hollow tiles', 'Ponding test water level', 'Tile level survey'],
    checks: ['Tile level ≤ 3 mm lippage', 'Hollow tiles ≤ 1%', 'Roof ponding 48 h, no level drop'],
    tolerance: ['Level log gap ≤ 15 min', 'Confidence ≥ 0.9'],
    verifierChain: ['Test rules', 'Anomaly vs similar floors', 'VLM on thermal frames', 'Engineer'],
    authority: { sign: 'Project Engineer', dispute: 'Finishing contractor' },
    settles: raBill,
  }),
  paint: building('paint_finishes', 'Paint and finishes', {
    evidenceRequired: ['Facade photogrammetry', 'Dry film thickness gauge', 'Humidity during application'],
    checks: ['Dry film ≥ 100 µm', 'Facade coverage 100%', 'Shade ΔE ≤ 1.5'],
    tolerance: ['Humidity ≤ 85% while painting', 'Confidence ≥ 0.9'],
    verifierChain: ['Finish rules', 'Anomaly vs similar facades', 'VLM on facade', 'Engineer'],
    authority: { sign: 'Project Engineer', dispute: 'Painting contractor' },
    settles: 'Verified finishes → final RA bill + handover',
  }),
  monitoring: building('structural_health', 'Structural health after handover', {
    evidenceRequired: ['Crack, tilt and settlement sensors', 'Strain gauges and accelerometer', 'Facade camera frame'],
    checks: ['Crack width ≤ 0.3 mm', 'Tilt ≤ 1/500', 'Settlement ≤ 25 mm'],
    tolerance: ['Sensor gap ≤ 15 min', 'Confidence ≥ 0.9'],
    verifierChain: ['Threshold rules', 'Anomaly vs baseline', 'VLM on facade frame', 'Engineer'],
    authority: { sign: 'Structural Engineer', dispute: 'Facility Manager' },
    settles: 'Confirmed drift → inspection work order',
  }),
}

export const completionSpecs: Record<Domain, CompletionSpec> = {

  road: {
    id: 'spec.road.layer_compaction',
    domain: 'road',
    title: 'Layer compaction, road section',
    evidenceRequired: ['Roller IMU + GPS passes', 'Layer thickness', 'Photo / video sample'],
    checks: ['≥ 8 passes across ≥ 95% of section area', 'Thickness within spec'],
    tolerance: ['GPS gap ≤ 3 min', 'Confidence ≥ 0.9'],
    verifierChain: ['Pass-count rules', 'Anomaly vs similar roads', 'VLM on video', 'Engineer'],
    authority: { sign: 'Executive Engineer', dispute: 'Contractor, Quality Monitor' },
    settles: 'Verified km → fund release',
    draft: false,
  },
  mine: {
    id: 'spec.mine.haul_trip',
    domain: 'mine',
    title: 'Haul trip',
    evidenceRequired: ['Load event', 'Haul GPS track', 'Dump event'],
    checks: ['Payload signal ≥ 80% rated', 'Dump inside a valid dump zone'],
    tolerance: ['GPS gap ≤ 3 min', 'Confidence ≥ 0.9'],
    verifierChain: ['Rules', 'Anomaly store', 'VLM if needed', 'Human if needed'],
    authority: { sign: 'Mine Manager', dispute: 'Haulage contractor' },
    settles: 'Trip count → contractor payment / fuel reconciliation',
    draft: false,
  },
  water: {
    id: 'spec.water.zone_balance',
    domain: 'water',
    title: 'District metered area balance',
    evidenceRequired: ['Inlet bulk meter flow', 'Consumer meter totals', 'Pressure log'],
    checks: ['Inflow minus billed within NRW threshold', 'Night flow below baseline'],
    tolerance: ['Meter comms gap ≤ 15 min', 'Confidence ≥ 0.9'],
    verifierChain: ['Balance rules', 'Anomaly vs zone baseline', 'Field crew'],
    authority: { sign: 'Utility Engineer', dispute: 'Zone Operator' },
    settles: 'Verified loss → Water Ledger entry',
    draft: true,
  },
  forest: {
    id: 'spec.forest.hotspot',
    domain: 'forest',
    title: 'Fire hotspot confirmation',
    evidenceRequired: ['Thermal detection', 'Canopy camera frame', 'Weather context'],
    checks: ['Detection persists ≥ 2 frames', 'Inside concession boundary'],
    tolerance: ['Frame gap ≤ 5 min', 'Confidence ≥ 0.85'],
    verifierChain: ['Rules', 'VLM on frame', 'Forest Officer'],
    authority: { sign: 'Forest Officer', dispute: 'Concession Manager' },
    settles: 'Confirmed incident → patrol dispatch record',
    draft: true,
  },
  building: buildingSpecs.frame,
}
