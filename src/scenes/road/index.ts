import type { SceneModule } from '../../core/sceneTypes'
import './road.css'
import { RoadHud } from './RoadHud'
import { RoadStage } from './RoadStage'

export const roadScene: SceneModule = {
  id: 'road',
  index: 2,
  title: 'RURAL ROAD',
  subtitle: 'Scan · Check against plan · Human sign-off · Certificate · Funds',
  Stage: RoadStage,
  Hud: RoadHud,
  camera: { position: [-0.45, 15.4, 13.2], target: [-0.45, 0.2, -1.0] },
  limits: { minDistance: 6, maxDistance: 32 },
}
