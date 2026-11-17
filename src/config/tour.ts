import type { SceneId } from '../core/store'

/**
 * Autoplay demo tour. About 190 s end to end.
 * Edit order or seconds here. Manual input pauses the tour; it resumes after
 * `resumeAfterIdleS` seconds without input.
 */
export const tour: { scene: SceneId; seconds: number }[] = [
  { scene: 'orbit', seconds: 22 },
  { scene: 'loop', seconds: 34 },
  { scene: 'road', seconds: 24 },
  { scene: 'mine', seconds: 26 },
  { scene: 'water', seconds: 22 },
  { scene: 'forest', seconds: 22 },
  { scene: 'building', seconds: 40 },
]

export const resumeAfterIdleS = 15

/** Share of the Building stop after which autoplay opens the Project control lens. */
export const buildingControlAt = 0.55
