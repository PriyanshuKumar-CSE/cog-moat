import type { SceneModule } from '../../core/sceneTypes'
import { OrbitHud } from './OrbitHud'
import { OrbitStage } from './OrbitStage'
import { globeShot } from './orbitStore'

export const orbitScene: SceneModule = {
  id: 'orbit',
  index: 1,
  title: 'ORBIT',
  subtitle: 'Live deployments',
  Stage: OrbitStage,
  Hud: OrbitHud,
  camera: globeShot,
  limits: { minDistance: 8, maxDistance: 34, maxPolarAngle: Math.PI },
}
