import type { SceneId } from '../core/store'

/**
 * Autoplay demo tour. About 175 s end to end.
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
  { scene: 'building', seconds: 26 },
]

export const resumeAfterIdleS = 15
