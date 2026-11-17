import type { SceneModule } from '../../core/sceneTypes'
import './building.css'
import { BuildingHud } from './BuildingHud'
import { BuildingStage } from './BuildingStage'

export const buildingScene: SceneModule = {
  id: 'building',
  index: 6,
  title: 'BUILDING',
  subtitle: 'Foundation to paint · Project control · Check against BIM · Sign-off · RA bill · Structural health',
  Stage: BuildingStage,
  Hud: BuildingHud,
  camera: { position: [4.2, 9.6, 24.5], target: [1.2, 2.6, 0] },
  limits: { minDistance: 6, maxDistance: 34 },
}
