import { describe, expect, it } from 'vitest'
import { IES_GENESIS, OriginChains, iesKeyOrder, verifyIesHash } from '../../src/sim/ies'
import { createDecision, createLoopCase } from '../../src/sim/loopCase'
import { createRng } from '../../src/sim/rng'

describe('IES records', () => {
  const rng = createRng(1)
  const chains = new OriginChains()
  const now = new Date('2026-11-14T05:00:00Z')

  it('has exactly the 16 IES keys and a valid hash', () => {
    const c = createLoopCase('road', rng, chains, now)
    for (const r of [c.capture, c.derived]) {
      expect(Object.keys(r).sort()).toEqual([...iesKeyOrder].sort())
      expect(verifyIesHash(r)).toBe(true)
      expect(r.subject_ref).toBe(r.claim.subject_ref)
    }
  })

  it('a capture has no lineage; a derived claim points at its input', () => {
    const c = createLoopCase('mine', rng, chains, now)
    expect(c.capture.lineage).toBeNull()
    expect(c.derived.lineage?.input).toEqual([c.capture.observation_id])
  })

  it('chains each origin: sequence increments, prev_hash links', () => {
    const local = new OriginChains()
    const r = createRng(9)
    const a = createLoopCase('water', r, local, now)
    const b = createLoopCase('water', r, local, now)
    expect(a.capture.origin_id).toBe(b.capture.origin_id)
    expect(b.capture.sequence).toBe(a.capture.sequence + 1)
    expect(b.capture.prev_hash).toBe(a.capture.hash)
    const first = createLoopCase('forest', createRng(3), new OriginChains(), now)
    expect(first.capture.prev_hash).toBe(IES_GENESIS)
  })

  it('records the human decision as a verification from a person origin', () => {
    const c = createLoopCase('road', rng, chains, now)
    const d = createDecision(c, rng, chains, 'reject', 'weather', now)
    expect(d.kind).toBe('verification')
    expect(d.claim.action).toBe('reject')
    expect(d.lineage?.input).toEqual([c.derived.observation_id])
    expect(verifyIesHash(d)).toBe(true)
  })

  it('tampering with a claim breaks the hash', () => {
    const c = createLoopCase('road', rng, chains, now)
    const forged = { ...c.derived, claim: { ...c.derived.claim, coverage_pct: 99.9 } }
    expect(verifyIesHash(forged)).toBe(false)
  })
})
