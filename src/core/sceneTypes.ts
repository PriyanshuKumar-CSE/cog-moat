import type { ComponentType } from 'react'
import type { CameraShot } from './cameraRig'
import type { SceneId } from './store'

export interface SceneModule {
  id: SceneId
  /** Number shown in the scene rail (1-7). */
  index: number
  title: string
  subtitle: string
  /** 3D content, rendered inside the Canvas. */
  Stage: ComponentType
  /** DOM HUD panels for this scene. */
  Hud: ComponentType
  /** Home camera shot. */
  camera: CameraShot
  /** Orbit limits while the user explores. */
  limits?: { minDistance?: number; maxDistance?: number; maxPolarAngle?: number }
  /** True until the scene is built. */
  placeholder?: boolean
}
