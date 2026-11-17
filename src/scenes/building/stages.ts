import { buildingSpecs, type BuildingStageId, type CompletionSpec } from '../../sim/completionSpecs'
import type { Rng } from '../../sim/rng'
import { BASEMENT_Y, HALF_X, HALF_Z, PIT_Z, ROOF_Y, levelY } from './layout'

/**
 * Construction milestones from the first cut to the last coat of paint, then
 * structural health monitoring after handover. Each milestone is verified the
 * same way: scan, check against plan, verifier chain, human gate, settle.
 * Every figure here is simulated.
 */

export type { BuildingStageId }

export interface Measure {
  label: string
  value: string
  plan: string
  ok: boolean
}

export interface FindingTemplate {
  cls: string
  tone: 'amber' | 'red'
  /** Position in building coordinates, on a surface. */
  at: [number, number, number]
  /** Outward direction of the surface the finding sits on. */
  out: [number, number, number]
  where: string
  /** Label position in world space. Defaults to the right of the tower at the finding's height. */
  label?: [number, number, number]
}

export interface StageDef {
  id: BuildingStageId
  title: string
  /** Short name for the stage rail. */
  short: string
  /** What the milestone covers. */
  work: string
  spec: CompletionSpec
  /** Share of contract value released at this milestone (simulated weights, sum 100). */
  weight: number
  /** What Photon sees and Boson hears in this milestone. */
  photon: string
  boson: string
  scanSensor: string
  bosonSensor: string
  bosonQuantity: string
  /** Lowest and highest y the scan sweeps. */
  span: readonly [number, number]
  findings: FindingTemplate[]
  measures: (rng: Rng) => Measure[]
  approveTitle: string
  modify: { id: string; label: string }
}

const f1 = (v: number) => v.toFixed(1)
const f2 = (v: number) => v.toFixed(2)
const front = HALF_Z + 0.04
const right = HALF_X + 0.04
const OUT_FRONT: [number, number, number] = [0, 0, 1]
const OUT_RIGHT: [number, number, number] = [1, 0, 0]
const OUT_UP: [number, number, number] = [0, 1, 0]
const mid = (k: number) => levelY(k) + 0.45

export const stages: StageDef[] = [
  {
    id: 'excavation',
    title: 'EXCAVATION & PILING',
    short: 'Excavation',
    work: 'Pit to formation level, 24 bored piles',
    spec: buildingSpecs.excavation,
    weight: 6,
    photon: 'Drone LiDAR surveys the pit; the detector flags water and unsafe cuts.',
    boson: 'Pile rig depth and torque logs replayed against the pile schedule.',
    scanSensor: 'drone_lidar',
    bosonSensor: 'pile_rig_log',
    bosonQuantity: 'pile_depth_m',
    span: [-3.0, 0.05],
    findings: [
      { cls: 'WATER INGRESS', tone: 'amber', at: [2.2, -0.75, PIT_Z], out: OUT_FRONT, where: 'pit wall, east', label: [HALF_X + 1.7, 2.1, PIT_Z] },
      { cls: 'UNSHORED CUT', tone: 'red', at: [-2.6, -0.45, PIT_Z], out: OUT_FRONT, where: 'pit wall, south-west', label: [-1.0, 3.1, PIT_Z] },
    ],
    measures: (rng) => {
      const depth = 3.2 + rng.range(-0.03, 0.04)
      return [
        { label: 'formation level', value: `-${f2(depth)} m`, plan: '-3.20 m ± 0.05', ok: true },
        { label: 'piles to depth', value: '24 / 24', plan: '24 at ≥ 12.0 m', ok: true },
        { label: 'pile integrity', value: '24 sound', plan: 'all sound', ok: true },
        { label: 'min pile length', value: `${f1(12 + rng.range(0.1, 0.6))} m`, plan: '≥ 12.0 m', ok: true },
      ]
    },
    approveTitle: 'Sign excavation and piling milestone',
    modify: { id: 'pit', label: 'Hold: repeat integrity test' },
  },
  {
    id: 'foundation',
    title: 'FOUNDATION',
    short: 'Foundation',
    work: 'Raft, pile caps and basement walls',
    spec: buildingSpecs.foundation,
    weight: 12,
    photon: 'Pre-pour frames check rebar spacing and cover blocks before concrete goes in.',
    boson: 'Maturity sensors inside the raft report strength gain; batch tickets give volume.',
    scanSensor: 'site_camera',
    bosonSensor: 'maturity_sensor',
    bosonQuantity: 'maturity_strength_mpa',
    span: [-1.3, 0.1],
    findings: [
      { cls: 'HONEYCOMB', tone: 'amber', at: [1.4, -0.5, HALF_Z + 0.02], out: OUT_FRONT, where: 'basement wall, B-4', label: [HALF_X + 1.7, 2.1, HALF_Z] },
      { cls: 'LOW COVER', tone: 'red', at: [-1.2, BASEMENT_Y + 0.02, 0.6], out: OUT_UP, where: 'raft top, C-3', label: [-1.0, 3.1, 0.6] },
    ],
    measures: (rng) => {
      const vol = 405 * (1 + rng.range(-0.012, 0.022))
      return [
        { label: 'raft thickness', value: `${Math.round(900 + rng.range(0, 12))} mm`, plan: '900 mm', ok: true },
        { label: 'concrete poured', value: `${Math.round(vol)} m³`, plan: '405 m³ ± 3%', ok: true },
        { label: 'maturity strength', value: `${f1(rng.range(25.2, 27.4))} MPa`, plan: '≥ 24.5 MPa', ok: true },
        { label: 'rebar pre-pour', value: 'inspected', plan: 'before pour', ok: true },
      ]
    },
    approveTitle: 'Sign foundation milestone',
    modify: { id: 'cubes', label: 'Hold: re-test cubes' },
  },
  {
    id: 'frame',
    title: 'RCC FRAME',
    short: 'RCC frame',
    work: 'Columns and slabs, basement to roof',
    spec: buildingSpecs.frame,
    weight: 30,
    photon: 'Drone scan per slab against the BIM frame; the detector flags honeycombing and exposed bars.',
    boson: 'Slab maturity sensors and cube results replayed per pour.',
    scanSensor: 'drone_lidar',
    bosonSensor: 'maturity_sensor',
    bosonQuantity: 'cube_strength_mpa',
    span: [BASEMENT_Y, ROOF_Y + 0.1],
    findings: [
      { cls: 'HONEYCOMB', tone: 'amber', at: [-1.8, mid(2), front], out: OUT_FRONT, where: 'L2 column, B-4' },
      { cls: 'EXPOSED REBAR', tone: 'red', at: [right, mid(4) - 0.2, 0.6], out: OUT_RIGHT, where: 'L4 column, F-3' },
      { cls: 'OUT OF PLUMB', tone: 'amber', at: [1.8, mid(5), front], out: OUT_FRONT, where: 'L5 column, E-4' },
    ],
    measures: (rng) => [
      { label: 'column plumb', value: `max ${rng.int(5, 8)} mm`, plan: '≤ 10 mm / storey', ok: true },
      { label: 'slab level', value: `±${rng.int(4, 8)} mm`, plan: '±10 mm', ok: true },
      { label: 'cube strength', value: `${f1(rng.range(35.2, 38.4))} MPa`, plan: '≥ 34 MPa (M30)', ok: true },
      { label: 'slabs cast', value: '8 / 8', plan: 'B to roof', ok: true },
    ],
    approveTitle: 'Sign RCC frame milestone',
    modify: { id: 'cubes', label: 'Hold: re-test cubes' },
  },
  {
    id: 'masonry',
    title: 'MASONRY',
    short: 'Masonry',
    work: 'Block walls, openings and lintels',
    spec: buildingSpecs.masonry,
    weight: 10,
    photon: 'Wall segmentation measures built area; every opening is checked for a lintel.',
    boson: 'Block delivery tickets reconciled against the area built.',
    scanSensor: 'drone_rgb',
    bosonSensor: 'delivery_ticket',
    bosonQuantity: 'blocks_delivered',
    span: [0, ROOF_Y],
    findings: [
      { cls: 'BULGED WALL', tone: 'red', at: [0, mid(3), front], out: OUT_FRONT, where: 'L3 wall, C-D/4' },
      { cls: 'WALL CRACK', tone: 'amber', at: [right, mid(1), -0.9], out: OUT_RIGHT, where: 'L1 wall, F/1-2' },
    ],
    measures: (rng) => {
      const area = 2200 * (1 + rng.range(-0.015, 0.008))
      return [
        { label: 'wall area', value: `${Math.round(area).toLocaleString('en-IN')} m²`, plan: '2,200 m² ± 2%', ok: true },
        { label: 'openings', value: '168 / 168', plan: 'as drawings', ok: true },
        { label: 'lintels', value: '168 / 168', plan: 'every opening', ok: true },
        { label: 'wall plumb', value: `max ${rng.int(3, 5)} mm`, plan: '≤ 6 mm / 3 m', ok: true },
      ]
    },
    approveTitle: 'Sign masonry milestone',
    modify: { id: 'rebuild', label: 'Hold: rebuild L3 panel first' },
  },
  {
    id: 'plumbing',
    title: 'PLUMBING & WATER',
    short: 'Plumbing',
    work: 'Supply risers, drainage, sump and overhead tank',
    spec: buildingSpecs.plumbing,
    weight: 8,
    photon: 'Fixture points and pipe runs detected against the drawings; joints checked for damp.',
    boson: 'Pressure transducer logs the hydrostatic test; flow meter logs the tank fill.',
    scanSensor: 'site_camera',
    bosonSensor: 'pressure_transducer',
    bosonQuantity: 'test_pressure_bar',
    span: [BASEMENT_Y, ROOF_Y + 0.6],
    findings: [
      { cls: 'DAMP JOINT', tone: 'amber', at: [right, mid(2), -1.25], out: OUT_RIGHT, where: 'L2 riser joint' },
      { cls: 'MISSING CLAMP', tone: 'amber', at: [right, mid(5), -1.25], out: OUT_RIGHT, where: 'L5 riser' },
    ],
    measures: (rng) => [
      { label: 'test pressure', value: '10.5 bar · 30 min', plan: '1.5 × 7 bar', ok: true },
      { label: 'pressure drop', value: `${f2(rng.range(0.04, 0.12))} bar`, plan: '≤ 0.20 bar', ok: true },
      { label: 'fixture points', value: '312 / 312', plan: 'as drawings', ok: true },
      { label: 'drain slope', value: `1:${rng.int(32, 38)}`, plan: '≥ 1:40', ok: true },
    ],
    approveTitle: 'Sign plumbing milestone',
    modify: { id: 'retest', label: 'Hold: repeat pressure test' },
  },
  {
    id: 'electrical',
    title: 'ELECTRICAL',
    short: 'Electrical',
    work: 'Rising main, boards, circuits and earthing',
    spec: buildingSpecs.electrical,
    weight: 8,
    photon: 'Boards and conduit runs detected per floor; open boards and loose wiring flagged.',
    boson: 'Insulation, earth and RCD test readings streamed from the test kit.',
    scanSensor: 'site_camera',
    bosonSensor: 'insulation_tester',
    bosonQuantity: 'insulation_mohm',
    span: [BASEMENT_Y, ROOF_Y],
    findings: [
      { cls: 'EXPOSED WIRING', tone: 'red', at: [-HALF_X - 0.04, mid(3), -1.25], out: [-1, 0, 0], where: 'L3 board, A-1' },
      { cls: 'BOARD COVER OFF', tone: 'amber', at: [-1.2, mid(6), front], out: OUT_FRONT, where: 'L6 lobby board' },
    ],
    measures: (rng) => [
      { label: 'insulation', value: `min ${rng.int(42, 88)} MΩ`, plan: '≥ 1 MΩ', ok: true },
      { label: 'earth resistance', value: `${f1(rng.range(0.9, 1.7))} Ω`, plan: '≤ 2 Ω', ok: true },
      { label: 'RCD trip', value: `${rng.int(18, 31)} ms`, plan: '≤ 40 ms', ok: true },
      { label: 'circuits tested', value: '286 / 286', plan: 'all', ok: true },
    ],
    approveTitle: 'Sign electrical milestone',
    modify: { id: 'retest', label: 'Hold: re-test L3 board' },
  },
  {
    id: 'plaster',
    title: 'PLASTER',
    short: 'Plaster',
    work: 'Internal and external plaster',
    spec: buildingSpecs.plaster,
    weight: 8,
    photon: 'Surface scan measures flatness; the detector flags cracks and hollow patches.',
    boson: 'Wall moisture sensors confirm curing before paint is allowed.',
    scanSensor: 'drone_lidar',
    bosonSensor: 'moisture_sensor',
    bosonQuantity: 'wall_moisture_pct',
    span: [0, ROOF_Y],
    findings: [
      { cls: 'HAIRLINE CRACK', tone: 'amber', at: [-0.6, mid(4), front], out: OUT_FRONT, where: 'L4 facade, C/4' },
      { cls: 'HOLLOW PATCH', tone: 'amber', at: [right, mid(6), 0.9], out: OUT_RIGHT, where: 'L6 facade, F/3' },
    ],
    measures: (rng) => [
      { label: 'thickness', value: `${f1(rng.range(11.6, 13.4))} mm`, plan: '12 ± 3 mm', ok: true },
      { label: 'flatness', value: `${f1(rng.range(1.6, 2.7))} mm`, plan: '≤ 3 mm / 2 m', ok: true },
      { label: 'area', value: `${Math.round(4400 * (1 + rng.range(-0.012, 0.004))).toLocaleString('en-IN')} m²`, plan: '4,400 m² ± 2%', ok: true },
      { label: 'moisture', value: `${rng.int(11, 15)}%`, plan: '≤ 16% to paint', ok: true },
    ],
    approveTitle: 'Sign plaster milestone',
    modify: { id: 'patch', label: 'Hold: patch and re-scan' },
  },
  {
    id: 'flooring',
    title: 'FLOORING & WATERPROOFING',
    short: 'Flooring',
    work: 'Tiles, wet-area and roof waterproofing',
    spec: buildingSpecs.flooring,
    weight: 9,
    photon: 'Thermal frames find hollow tiles; the level survey checks lippage.',
    boson: 'Water level sensors watch the 48 h roof ponding test.',
    scanSensor: 'thermal_camera',
    bosonSensor: 'water_level_sensor',
    bosonQuantity: 'ponding_drop_mm',
    span: [0, ROOF_Y + 0.2],
    findings: [
      { cls: 'HOLLOW TILES', tone: 'amber', at: [-1.8, levelY(3) + 0.05, 1.0], out: OUT_UP, where: 'L3 corridor' },
      { cls: 'LIPPAGE', tone: 'amber', at: [1.2, levelY(5) + 0.05, 1.0], out: OUT_UP, where: 'L5 lobby' },
    ],
    measures: (rng) => [
      { label: 'tile lippage', value: `max ${rng.int(1, 2)} mm`, plan: '≤ 3 mm', ok: true },
      { label: 'hollow tiles', value: `${f1(rng.range(0.3, 0.7))}%`, plan: '≤ 1%', ok: true },
      { label: 'roof ponding', value: '48 h · 0 mm drop', plan: 'no drop', ok: true },
      { label: 'wet areas', value: '28 / 28', plan: 'all tested', ok: true },
    ],
    approveTitle: 'Sign flooring milestone',
    modify: { id: 'relay', label: 'Hold: re-lay hollow tiles' },
  },
  {
    id: 'paint',
    title: 'PAINT & FINISHES',
    short: 'Paint',
    work: 'Primer and two coats, inside and out',
    spec: buildingSpecs.paint,
    weight: 9,
    photon: 'Facade photogrammetry checks coverage and shade; VLM re-checks patchy areas.',
    boson: 'Film thickness gauge readings and humidity while painting.',
    scanSensor: 'drone_rgb',
    bosonSensor: 'dft_gauge',
    bosonQuantity: 'dry_film_um',
    span: [0, ROOF_Y + 0.2],
    findings: [
      { cls: 'PATCHY COAT', tone: 'amber', at: [0.6, mid(2), front], out: OUT_FRONT, where: 'L2 facade, D/4' },
      { cls: 'PEELING', tone: 'amber', at: [right, mid(5), -0.3], out: OUT_RIGHT, where: 'L5 facade, F/2' },
    ],
    measures: (rng) => [
      { label: 'dry film', value: `${rng.int(108, 126)} µm`, plan: '≥ 100 µm', ok: true },
      { label: 'coverage', value: '100%', plan: '100% facade', ok: true },
      { label: 'shade ΔE', value: f1(rng.range(0.5, 1.1)), plan: '≤ 1.5', ok: true },
      { label: 'coats', value: '3 / 3', plan: 'primer + 2', ok: true },
    ],
    approveTitle: 'Sign finishes and handover',
    modify: { id: 'recoat', label: 'Hold: recoat L2 facade' },
  },
  {
    id: 'monitoring',
    title: 'STRUCTURAL HEALTH',
    short: 'Monitoring',
    work: 'Crack, tilt, settlement, strain and vibration',
    spec: buildingSpecs.monitoring,
    weight: 0,
    photon: 'A facade camera frame is pulled when a sensor drifts, for the VLM to look at.',
    boson: 'Crack gauges, tiltmeters, settlement markers, strain gauges and an accelerometer stream every 15 min.',
    scanSensor: 'facade_camera',
    bosonSensor: 'shm_array',
    bosonQuantity: 'crack_width_mm',
    span: [-1.0, ROOF_Y + 0.2],
    findings: [{ cls: 'CRACK WIDENING', tone: 'amber', at: [-1.2, mid(2), front], out: OUT_FRONT, where: 'L2 facade, CG-2' }],
    measures: (rng) => [
      { label: 'crack width CG-2', value: `${f2(0.31 + rng.range(0, 0.02))} mm`, plan: '≤ 0.30 mm', ok: false },
      { label: 'crack trend', value: `+${(0.008 + rng.range(0, 0.003)).toFixed(3)} mm/day`, plan: 'baseline flat', ok: false },
      { label: 'tilt', value: `1/${rng.int(1700, 2100)}`, plan: '≤ 1/500', ok: true },
      { label: 'settlement', value: `${f1(rng.range(9.5, 12.5))} mm`, plan: '≤ 25 mm', ok: true },
    ],
    approveTitle: 'Raise inspection work order',
    modify: { id: 'sampling', label: 'Watch: sample every 1 min' },
  },
]

export const stageIndex = (id: BuildingStageId) => stages.findIndex((s) => s.id === id)
export const MONITORING = stageIndex('monitoring')

/** Simulated share of the building complete once stages before `index` are verified. */
export function builtPct(index: number) {
  let pct = 0
  for (let i = 0; i < Math.min(index, MONITORING); i++) pct += stages[i].weight
  return pct
}
