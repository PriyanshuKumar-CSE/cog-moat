import { describe, expect, it } from 'vitest'
import { canonicalJson } from '../../src/sim/canonical'
import { Ledger, merkleRoot } from '../../src/sim/ledger'

describe('Event Ledger', () => {
  it('links, hashes and signs every block', () => {
    const l = new Ledger('test')
    const p1 = { a: 1 }
    const p2 = { b: 2 }
    const b1 = l.append(p1, new Date('2026-11-13T10:00:00Z'))
    const b2 = l.append(p2, new Date('2026-11-13T11:00:00Z'))
    expect(b2.prev_hash).toBe(b1.hash)
    expect(l.verify(b1, p1)).toEqual({ payloadHashOk: true, blockHashOk: true, linkOk: true, signatureOk: true })
    expect(l.verify(b2, p2)).toEqual({ payloadHashOk: true, blockHashOk: true, linkOk: true, signatureOk: true })
  })

  it('detects a tampered payload and a tampered block', () => {
    const l = new Ledger('test')
    const b = l.append({ km: 12 }, new Date('2026-11-13T10:00:00Z'))
    expect(l.verify(b, { km: 13 }).payloadHashOk).toBe(false)
    const forged = { ...b, sealed_at: '2026-11-14T10:00:00.000Z' }
    const v = l.verify(forged, { km: 12 })
    expect(v.blockHashOk).toBe(false)
  })

  it('anchors a day with a merkle root', () => {
    const l = new Ledger('test')
    l.append({ i: 1 }, new Date('2026-11-13T01:00:00Z'))
    l.append({ i: 2 }, new Date('2026-11-13T02:00:00Z'))
    l.append({ i: 3 }, new Date('2026-11-14T02:00:00Z'))
    const a = l.dailyAnchor('2026-11-13')
    expect(a.count).toBe(2)
    expect(a.root).toBe(merkleRoot(l.all().slice(0, 2).map((b) => b.hash)))
  })

  it('canonical JSON ignores key order', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }))
  })
})
