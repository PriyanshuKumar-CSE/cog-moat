import type { SceneModule } from '../../core/sceneTypes'
import { LoopHud } from './LoopHud'
import { LoopStage } from './LoopStage'

export const loopScene: SceneModule = {
  id: 'loop',
  index: 7,
  title: 'THE LOOP',
  subtitle: 'Intent · Sense · Scheduler decides · Verify · Settle · Learn',
  Stage: LoopStage,
  Hud: LoopHud,
  camera: { position: [0, 16.5, 20.5], target: [0, 1.4, -0.6] },
  limits: { minDistance: 8, maxDistance: 40 },
}
