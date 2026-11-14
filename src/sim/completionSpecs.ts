import type { Domain } from '../config/content'

/**
 * Completion specs: what "done" means, turned into code.
 * Road and mine specs follow Cognecto's own notes. Water and forest are
 * simulation drafts in the same shape.
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
}
