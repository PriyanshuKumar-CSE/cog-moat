import { Text } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef, type ComponentProps } from 'react'
import * as THREE from 'three'
import { theme } from '../../config/theme'
import { fonts } from '../../holo/fonts'
import { holoUniforms } from '../../holo/uniforms'

type TextProps = ComponentProps<typeof Text>

interface Props extends Omit<TextProps, 'font' | 'color'> {
  variant?: keyof typeof fonts
  color?: string
  /** Colour multiplier. Above 1 blooms. */
  glow?: number
}

/**
 * 3D label with a soft dark halo, so it stays readable over the glowing
 * canopy and boundary lines. Fill and halo both fade with the scene reveal.
 */
export function Tag({ variant = 'hud', color = theme.holo.ice, glow = 1.4, children, ...rest }: Props) {
  const ref = useRef<THREE.Mesh & { fillOpacity: number; outlineOpacity: number }>(null)
  const tint = useMemo(() => new THREE.Color(color).multiplyScalar(glow), [color, glow])
  useFrame(() => {
    const t = ref.current
    if (!t) return
    const k = THREE.MathUtils.smoothstep(holoUniforms.uReveal.value, 0.35, 0.9)
    t.fillOpacity = k
    t.outlineOpacity = 0.72 * k
  })
  return (
    <Text
      ref={ref}
      font={fonts[variant]}
      color={tint}
      anchorX="center"
      anchorY="middle"
      letterSpacing={variant.startsWith('hud') ? 0.08 : 0}
      outlineWidth="14%"
      outlineBlur="45%"
      outlineColor={theme.background}
      material-toneMapped={false}
      material-depthWrite={false}
      material-transparent
      {...rest}
    >
      {children}
    </Text>
  )
}
