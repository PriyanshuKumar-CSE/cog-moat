import type { SceneModule } from '../../core/sceneTypes'
import { CENTER_X } from './network'
import './water.css'
import { WaterHud } from './WaterHud'
import { WaterStage } from './WaterStage'

export const waterScene: SceneModule = {
  id: 'water',
  index: 4,
  title: 'WATER',
  subtitle: 'Network balance · NRW detection · Water Ledger',
  Stage: WaterStage,
  Hud: WaterHud,
  camera: { position: [CENTER_X, 17.5, 14.6], target: [CENTER_X, 0.2, -1.0] },
  limits: { minDistance: 8, maxDistance: 40 },
}
