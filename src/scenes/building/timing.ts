import { stageIndex } from './stages'

/** Building cycle timing, shared by the director, the 3D stage and tests. */

export type Phase = 'scan' | 'plan' | 'verify' | 'approve' | 'settle' | 'reset'

export const phaseSeconds: Record<Phase, number> = {
  scan: 6.0,
  plan: 4.4,
  verify: 3.8,
  approve: Infinity,
  settle: 5.0,
  reset: 2.6,
}

/** The scan sweeps the milestone's height between these fractions of the scan phase. */
export const SCAN_START = 0.08
export const SCAN_END = 0.9
/** Settle beats, in seconds from the start of settle. */
export const SEAL_AT = 1.3
export const RELEASE_AT = 2.6
/** The milestone opens on this stage: the frame makes the strongest first picture. */
export const FIRST_STAGE = stageIndex('frame')

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** Scan progress 0..1 for a scan time. */
export const scanU = (t: number) => clamp01((t / phaseSeconds.scan - SCAN_START) / (SCAN_END - SCAN_START))
