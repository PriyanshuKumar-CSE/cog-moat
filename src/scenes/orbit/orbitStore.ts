import { create } from 'zustand'
import type { CameraShot } from '../../core/cameraRig'

export type OrbitMode = 'globe' | 'india'

interface OrbitState {
  mode: OrbitMode
  selected: string | null
  hovered: string | null
  setMode: (m: OrbitMode) => void
  select: (id: string | null) => void
  hover: (id: string | null) => void
}

export const useOrbit = create<OrbitState>((set) => ({
  mode: 'globe',
  selected: null,
  hovered: null,
  setMode: (mode) => set({ mode, selected: null }),
  select: (selected) => set({ selected }),
  hover: (hovered) => set({ hovered }),
}))

export const globeShot: CameraShot = { position: [-1.0, 3.4, 19.5], target: [-1.0, 0.2, 0] }
export const indiaShot: CameraShot = { position: [-1.3, 2.2, 23], target: [-1.3, 0.2, 6.6] }

/** India's centre, used to turn the globe so India faces the camera. */
export const INDIA_FACING = { lon: 80, lat: 22 }
