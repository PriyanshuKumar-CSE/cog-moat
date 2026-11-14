import type { SceneModule } from '../../core/sceneTypes'
import './forest.css'
import { ForestHud } from './ForestHud'
import { ForestStage } from './ForestStage'

export const forestScene: SceneModule = {
  id: 'forest',
  index: 5,
  title: 'FOREST',
  subtitle: 'Forest concession · canopy health, fire, encroachment',
  Stage: ForestStage,
  Hud: ForestHud,
  camera: { position: [-1.2, 20.6, 22.6], target: [-1.2, -0.6, 2.0] },
  limits: { minDistance: 8, maxDistance: 44 },
}
