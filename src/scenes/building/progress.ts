import { phaseSeconds, type Phase } from './timing'
import { MONITORING, stages } from './stages'

/**
 * How much of each milestone's work is standing at a moment in the cycle.
 * Pure, so the 3D stage and tests agree on what is built.
 */

export interface Snapshot {
  phase: Phase
  t: number
  stage: number
  next: number
}

const ease = (u: number) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2)
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** Wrap from monitoring to a new project: dissolve over this share of reset, then excavation grows. */
const DISSOLVE = 0.55

/** Highest stage index whose work stands in the steady state of a cycle. */
export const standingUpTo = (stage: number) => (stage === MONITORING ? MONITORING - 1 : stage)

/**
 * Built amount of stage `i`, 0..1, and where its construction front is.
 * `front` is a 0..1 fraction of the stage's own height span (1 = fully built).
 */
export function builtState(i: number, s: Snapshot): { amount: number; front: number } {
  if (i === MONITORING) return { amount: 0, front: 0 }
  const steady = i <= standingUpTo(s.stage) ? 1 : 0
  if (s.phase !== 'reset' || s.next === s.stage) return { amount: steady, front: steady }
  const u = clamp01(s.t / phaseSeconds.reset)
  if (s.next === 0) {
    // New project: everything standing dissolves top-down, then excavation starts.
    if (u < DISSOLVE) {
      const f = steady ? 1 - ease(u / DISSOLVE) : 0
      return { amount: f, front: f }
    }
    const g = i === 0 ? ease((u - DISSOLVE) / (1 - DISSOLVE)) : 0
    return { amount: g, front: g }
  }
  if (i === s.next) {
    const g = ease(u)
    return { amount: g, front: g }
  }
  return { amount: steady, front: steady }
}

/** World Y of the construction front for stage `i`. Above it nothing is drawn. */
export function cutY(i: number, s: Snapshot) {
  const { front } = builtState(i, s)
  if (front >= 1) return 100
  if (front <= 0) return -100
  const [lo, hi] = stages[i].span
  return lo + (hi - lo) * front
}
