import { describe, expect, it } from 'vitest'
import { facts, savingsReference } from '../../src/config/content'
import {
  ARRIVE_AT,
  DAY_MINUTES,
  SLIP_FLAG_DAYS,
  TRUCKS,
  headcount,
  machineHours,
  measuredPct,
  peakHeadcount,
  plannedPct,
  productiveSoFar,
  progressAt,
  queriedHours,
  sitePlan,
  tripsSoFar,
  truckPhase,
} from '../../src/scenes/building/control'
import { MONITORING, stageIndex } from '../../src/scenes/building/stages'

const construction = Array.from({ length: MONITORING }, (_, i) => i)

describe('project control site plan', () => {
  it('every construction milestone has crews, a hired machine and trips; none after handover', () => {
    for (const i of construction) {
      const p = sitePlan(i)!
      expect(p.crews.length).toBeGreaterThan(0)
      expect(p.hire.worked_h).toBeLessThan(p.hire.billed_h)
      expect(queriedHours(p.hire)).toBe(p.hire.billed_h - p.hire.worked_h)
      expect(p.trips).toBeGreaterThan(0)
    }
    expect(sitePlan(MONITORING)).toBeNull()
  })

  it('head-count never exceeds the muster roll, and some names on the roll are not on site', () => {
    for (const i of construction) {
      const p = sitePlan(i)!
      for (let day = 1; day <= 3; day++) {
        const peak = peakHeadcount(i, day)
        expect(peak).toBeLessThan(p.muster)
        for (let m = 0; m < DAY_MINUTES; m += 15) expect(headcount(i, m, day).total).toBeLessThanOrEqual(peak)
      }
    }
  })

  it('productive share is a fraction and machine hours add up to the time elapsed', () => {
    const frame = stageIndex('frame')
    const share = productiveSoFar(frame, 400, 1)
    expect(share.total).toBeGreaterThan(0.2)
    expect(share.total).toBeLessThan(0.9)
    const h = machineHours(frame, 300, 1)
    expect(h.working + h.idle + h.parked).toBeCloseTo(5, 5)
  })

  it('trips are logged when a truck reaches the stockyard, up to the day plan', () => {
    const frame = stageIndex('frame')
    const plan = sitePlan(frame)!
    let prev = 0
    for (let m = 0; m <= DAY_MINUTES; m += 1) {
      const n = tripsSoFar(frame, m)
      expect(n).toBeGreaterThanOrEqual(prev)
      prev = n
    }
    expect(prev).toBe(plan.trips)
    // At the minute a truck arrives, the count steps up by one.
    for (let j = 0; j < TRUCKS; j++) {
      for (let m = 1; m < DAY_MINUTES; m++) {
        const a = truckPhase(frame, j, m - 1)
        const b = truckPhase(frame, j, m)
        if (a !== null && b !== null && a < ARRIVE_AT && b >= ARRIVE_AT) expect(tripsSoFar(frame, m)).toBeGreaterThan(tripsSoFar(frame, m - 1))
      }
    }
  })
})

describe('progress against plan', () => {
  it('the S-curve runs 0 to 100 and measured progress meets the milestone at the week shown', () => {
    expect(plannedPct(0)).toBe(0)
    expect(plannedPct(78)).toBeCloseTo(100, 6)
    let prevWeek = -1
    for (const i of construction) {
      const p = progressAt(i)
      expect(p.week).toBeGreaterThan(prevWeek)
      prevWeek = p.week
      expect(p.measured).toBeLessThanOrEqual(p.planned + 1e-6)
      if (p.week < 78) expect(measuredPct(p.week)).toBeCloseTo(p.measured, 1)
    }
    expect(progressAt(MONITORING)).toMatchObject({ measured: 100, planned: 100, slipDays: 0 })
  })

  it('slippage is flagged through the frame and masonry and recovered by paint', () => {
    expect(progressAt(stageIndex('frame')).slipDays).toBeGreaterThanOrEqual(SLIP_FLAG_DAYS)
    expect(progressAt(stageIndex('masonry')).slipDays).toBeGreaterThanOrEqual(SLIP_FLAG_DAYS)
    expect(progressAt(stageIndex('excavation')).slipDays).toBeLessThan(SLIP_FLAG_DAYS)
    expect(progressAt(stageIndex('paint')).slipDays).toBeLessThan(SLIP_FLAG_DAYS)
  })
})

describe('live-site figures', () => {
  it('quote the Project Control brochure exactly', () => {
    expect(facts.pcProductivity.text).toContain('23% productive share')
    expect(facts.pcIdle.text).toContain('31h 26m idle across 8 workers')
    expect(facts.pcMachine.text).toContain('336 min')
    expect(facts.pcBoqVerified.text).toContain('₹82 Cr')
    expect(facts.pcDecision.text).toContain('0.02 s')
    expect(facts.pcModels.text).toContain('27 models')
  })

  it('the savings table adds up to the stated total', () => {
    const lakh = savingsReference.rows.reduce((a, r) => a + Number(r.value.replace(' L', '')), 0)
    expect(lakh).toBe(130)
    expect(savingsReference.total.value).toBe('₹1.3 Cr')
  })
})
