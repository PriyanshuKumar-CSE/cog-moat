import { describe, expect, it } from 'vitest'
import { createBuildingCase, createBuildingDecision } from '../../src/scenes/building/buildingCase'
import { builtState, cutY } from '../../src/scenes/building/progress'
import { MONITORING, builtPct, stageIndex, stages } from '../../src/scenes/building/stages'
import { phaseSeconds } from '../../src/scenes/building/timing'
import { buildingSpecs } from '../../src/sim/completionSpecs'
import { OriginChains, iesKeyOrder, verifyIesHash } from '../../src/sim/ies'
import { createRng } from '../../src/sim/rng'

describe('building milestones', () => {
  it('runs foundation to paint, then monitoring, with weights summing to 100', () => {
    expect(stages.map((s) => s.id)).toEqual([
      'excavation',
      'foundation',
      'frame',
      'masonry',
      'plumbing',
      'electrical',
      'plaster',
      'flooring',
      'paint',
      'monitoring',
    ])
    expect(builtPct(MONITORING)).toBe(100)
    expect(builtPct(0)).toBe(0)
  })

  it('every spec is a draft with a four-step verifier chain ending at a person', () => {
    for (const spec of Object.values(buildingSpecs)) {
      expect(spec.draft).toBe(true)
      expect(spec.verifierChain).toHaveLength(4)
      expect(spec.verifierChain[3]).toBe('Engineer')
      expect(spec.authority.sign).toBeTruthy()
    }
  })
})

describe('building IES records', () => {
  const rng = createRng(7)
  const chains = new OriginChains()
  const now = new Date('2026-11-17T05:00:00Z')

  it('every stage produces hash-valid records with lineage back to its captures', () => {
    for (let i = 0; i < stages.length; i++) {
      const c = createBuildingCase(i, rng, chains, now)
      const all = [...Object.values(c.records), ...c.findings.map((f) => f.record)]
      for (const r of all) {
        expect(Object.keys(r).sort()).toEqual([...iesKeyOrder].sort())
        expect(verifyIesHash(r)).toBe(true)
      }
      expect(c.records.scan.lineage).toBeNull()
      expect(c.records.sensor.lineage).toBeNull()
      expect(c.records.plan.lineage?.input).toEqual([c.records.scan.observation_id, c.records.sensor.observation_id])
      expect(c.records.completion.lineage?.input).toContain(c.records.plan.observation_id)
      expect(c.findings.length).toBeGreaterThan(0)
      expect(c.approverRole).toBe(stages[i].spec.authority.sign)
    }
  })

  it('construction milestones pass every plan check; monitoring crosses a limit', () => {
    for (let i = 0; i < stages.length; i++) {
      const c = createBuildingCase(i, rng, chains, now)
      const failed = c.measures.filter((m) => !m.ok).length
      if (i === MONITORING) expect(failed).toBeGreaterThan(0)
      else expect(failed).toBe(0)
    }
  })

  it('the human decision is a verification by the signing role', () => {
    const c = createBuildingCase(stageIndex('plumbing'), rng, chains, now)
    const d = createBuildingDecision(c, rng, chains, 'reject', 'weather', now)
    expect(d.kind).toBe('verification')
    expect(d.claim.reason_code).toBe('weather')
    expect(d.sense.role).toBe('MEP Engineer')
    expect(verifyIesHash(d)).toBe(true)
  })
})

describe('what stands on site', () => {
  const frame = stageIndex('frame')
  const masonry = stageIndex('masonry')

  it('in a steady cycle, the milestone under check and everything before it stands', () => {
    const s = { phase: 'plan' as const, t: 1, stage: frame, next: frame }
    for (let i = 0; i < stages.length; i++) expect(builtState(i, s).amount).toBe(i <= frame ? 1 : 0)
    expect(cutY(frame, s)).toBe(100)
    expect(cutY(masonry, s)).toBe(-100)
  })

  it('after an accept, the next milestone grows bottom-up during reset', () => {
    const half = { phase: 'reset' as const, t: phaseSeconds.reset / 2, stage: frame, next: masonry }
    const g = builtState(masonry, half).amount
    expect(g).toBeGreaterThan(0)
    expect(g).toBeLessThan(1)
    const [lo, hi] = stages[masonry].span
    expect(cutY(masonry, half)).toBeGreaterThan(lo)
    expect(cutY(masonry, half)).toBeLessThan(hi)
    expect(builtState(frame, half).amount).toBe(1)
  })

  it('a rejection repeats the milestone: nothing new grows', () => {
    const s = { phase: 'reset' as const, t: phaseSeconds.reset / 2, stage: frame, next: frame }
    expect(builtState(masonry, s).amount).toBe(0)
  })

  it('after monitoring, the tower dissolves and the next project starts with excavation', () => {
    const early = { phase: 'reset' as const, t: phaseSeconds.reset * 0.2, stage: MONITORING, next: 0 }
    const late = { phase: 'reset' as const, t: phaseSeconds.reset * 0.95, stage: MONITORING, next: 0 }
    expect(builtState(stageIndex('paint'), early).amount).toBeLessThan(1)
    expect(builtState(stageIndex('paint'), late).amount).toBe(0)
    expect(builtState(0, late).amount).toBeGreaterThan(0.9)
  })
})
