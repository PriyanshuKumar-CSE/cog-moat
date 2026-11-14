import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import * as THREE from 'three'
import { theme } from '../config/theme'
import type { SceneModule } from '../core/sceneTypes'
import type { SceneId } from '../core/store'
import { HoloGrid } from '../holo/HoloGrid'
import { HoloText } from '../holo/HoloText'
import { useHoloMesh } from '../holo/hooks'

/** Stand-in for scenes that are not built yet. */
export function placeholderScene(id: SceneId, index: number, title: string, subtitle: string): SceneModule {
  function Stage() {
    const ref = useRef<THREE.Mesh>(null)
    const mat = useHoloMesh({ color: theme.holo.blue, intensity: 1.6, opacity: 0.5 })
    useFrame((_, dt) => {
      if (ref.current) ref.current.rotation.y += dt * 0.3
    })
    return (
      <>
        <HoloGrid />
        <mesh ref={ref} position-y={3} material={mat}>
          <icosahedronGeometry args={[2.2, 1]} />
        </mesh>
        <HoloText position={[0, 6.4, 0]} fontSize={0.6} billboard>
          {title}
        </HoloText>
        <HoloText position={[0, 5.7, 0]} fontSize={0.28} variant="mono" color={theme.holo.dim} glow={2} billboard>
          scene in build queue
        </HoloText>
      </>
    )
  }
  function Hud() {
    return null
  }
  return {
    id,
    index,
    title,
    subtitle,
    Stage,
    Hud,
    camera: { position: [0, 6, 16], target: [0, 3, 0] },
    placeholder: true,
  }
}
