import type { SceneModule } from '../../core/sceneTypes'
import { mineCamera } from './layout'
import { MineHud } from './MineHud'
import { MineStage } from './MineStage'
import './mine.css'

export const mineScene: SceneModule = {
  id: 'mine',
  index: 3,
  title: 'MINE',
  subtitle: 'Haulage · utilisation · production against plan',
  Stage: MineStage,
  Hud: MineHud,
  camera: mineCamera,
  limits: { minDistance: 10, maxDistance: 60 },
}
