import type { SceneModule } from '../core/sceneTypes'
import type { SceneId } from '../core/store'
import { buildingScene } from './building'
import { forestScene } from './forest'
import { loopScene } from './loop'
import { mineScene } from './mine'
import { orbitScene } from './orbit'
import { roadScene } from './road'
import { waterScene } from './water'

/** Scene registry. One module per scene. */
export const scenes: Record<SceneId, SceneModule> = {
  orbit: orbitScene,
  road: roadScene,
  mine: mineScene,
  water: waterScene,
  forest: forestScene,
  building: buildingScene,
  loop: loopScene,
}
