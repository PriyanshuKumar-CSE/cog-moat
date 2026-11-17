import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { deployments, facts, type Deployment } from '../../config/content'
import { theme } from '../../config/theme'
import { cameraRig } from '../../core/cameraRig'
import { useApp, useFact, usePlaceName } from '../../core/store'
import { HoloText } from '../../holo/HoloText'
import { useHoloLine, useHoloMesh } from '../../holo/hooks'
import { holoPointsMaterial, setHoloColor } from '../../holo/materials'
import { holoUniforms } from '../../holo/uniforms'
import {
  GLOBE_R,
  arcPoints,
  graticulePositions,
  indiaPlateDots,
  indiaPlateOutline,
  insideIndia,
  landDots,
  lonLatToVec3,
  outlinePositions,
  plateXY,
  vec3ToLonLat,
  world,
} from './geo'
import { INDIA_FACING, globeShot, indiaShot, useOrbit } from './orbitStore'

const HQ = { lon: 77.59, lat: 12.97 }
const deg = THREE.MathUtils.degToRad

const setCursor = (on: boolean) => {
  document.body.style.cursor = on ? 'pointer' : ''
}

export const domainLabel: Record<string, string> = { road: 'ROAD', mine: 'MINE', water: 'WATER', forest: 'FOREST', building: 'BUILDING' }

/** Customer short name for a deployment, or null when hidden or not provided. */
function useCustomer(d: Deployment) {
  const override = useApp((s) => (d.customerFact ? s.factOverrides[d.customerFact] : undefined))
  if (!d.customerFact) return null
  const f = facts[d.customerFact]
  return (override ?? f.visible) ? f.text : null
}

export function OrbitStage() {
  const mode = useOrbit((s) => s.mode)
  const first = useRef(true)
  const sceneTime = useRef(0)
  const autoStep = useRef(0)

  useEffect(() => {
    useOrbit.setState({ mode: 'globe', selected: null, hovered: null })
    return () => setCursor(false)
  }, [])

  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    const c = cameraRig.controls
    if (c) c.smoothTime = 0.9
    void cameraRig.fly(mode === 'india' ? indiaShot : globeShot)
  }, [mode])

  // Autoplay beats: lift India, then highlight a road site.
  useFrame((_, dt) => {
    sceneTime.current += dt
    const { autoplay, pendingScene } = useApp.getState()
    if (!autoplay || pendingScene) return
    const o = useOrbit.getState()
    if (autoStep.current === 0 && sceneTime.current > 8) {
      autoStep.current = 1
      o.setMode('india')
    } else if (autoStep.current === 1 && sceneTime.current > 14) {
      autoStep.current = 2
      o.select('in-mizoram')
    }
  })

  return (
    <>
      <Globe />
      <IndiaPlate />
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Globe                                                               */
/* ------------------------------------------------------------------ */

function Globe() {
  const group = useRef<THREE.Group>(null)
  const spin = useRef(deg(-INDIA_FACING.lon) - 0.3)
  const indiaHover = useRef(false)

  const occluder = useMemo(
    () => new THREE.MeshBasicMaterial({ color: '#030b1c', transparent: true, opacity: 1, toneMapped: false }),
    [],
  )
  const atmosphere = useHoloMesh({ color: theme.holo.blue, intensity: 1.1, opacity: 0.22, rim: 1.6, scan: 0, side: THREE.BackSide })
  const gratMat = useHoloLine({ color: theme.holo.grid, intensity: 1.4, opacity: 0.55, scan: 0.2 })
  const worldMat = useHoloLine({ color: theme.holo.blue, intensity: 1.1, opacity: 0.7, scan: 0.3 })
  const indiaMat = useHoloLine({ color: theme.holo.cyan, intensity: 2.6, opacity: 1, scan: 0.2 })
  const dotsMat = useMemo(() => holoPointsMaterial({ color: theme.holo.blue, intensity: 1.3, size: 1.6, opacity: 0.85 }), [])
  useEffect(() => () => dotsMat.dispose(), [dotsMat])

  const grat = useMemo(() => geom(graticulePositions(GLOBE_R * 1.002)), [])
  const worldLines = useMemo(() => geom(outlinePositions(world, GLOBE_R * 1.004, (c) => c.id !== 'IND')), [])
  const indiaLines = useMemo(() => geom(outlinePositions(world, GLOBE_R * 1.006, (c) => c.id === 'IND')), [])
  const dots = useMemo(() => {
    const n = landDots.length / 3
    const pos = new Float32Array(n * 3)
    const col = new Float32Array(n * 3)
    const v = new THREE.Vector3()
    const india = new THREE.Color(theme.holo.cyan).multiplyScalar(2.2)
    const other = new THREE.Color(theme.holo.blue).multiplyScalar(1.1)
    for (let i = 0; i < n; i++) {
      lonLatToVec3(landDots[i * 3], landDots[i * 3 + 1], GLOBE_R * 1.008, v)
      pos.set([v.x, v.y, v.z], i * 3)
      const c = landDots[i * 3 + 2] ? india : other
      col.set([c.r, c.g, c.b], i * 3)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3))
    return g
  }, [])

  useFrame(({ clock }, dt) => {
    const g = group.current
    if (!g) return
    const mode = useOrbit.getState().mode
    if (mode === 'globe') {
      spin.current += dt * 0.05
      g.rotation.y = THREE.MathUtils.damp(g.rotation.y, spin.current, 2, dt)
      g.rotation.x = THREE.MathUtils.damp(g.rotation.x, 0.28, 2, dt)
      g.position.z = THREE.MathUtils.damp(g.position.z, 0, 2.5, dt)
      g.position.y = THREE.MathUtils.damp(g.position.y, 0, 2.5, dt)
    } else {
      // Turn India to face the camera, along the shortest way round.
      const target = deg(-INDIA_FACING.lon)
      const twoPi = Math.PI * 2
      const wrapped = target + Math.round((g.rotation.y - target) / twoPi) * twoPi
      g.rotation.y = THREE.MathUtils.damp(g.rotation.y, wrapped, 3, dt)
      spin.current = g.rotation.y
      g.rotation.x = THREE.MathUtils.damp(g.rotation.x, deg(INDIA_FACING.lat), 3, dt)
      g.position.z = THREE.MathUtils.damp(g.position.z, -9, 2.2, dt)
      g.position.y = THREE.MathUtils.damp(g.position.y, -1.5, 2.2, dt)
    }
    // Once the India plate is fully up, the globe behind it is hidden.
    g.visible = !(mode === 'india' && g.position.z < -8.6)
    occluder.opacity = holoUniforms.uReveal.value
    const pulse = indiaHover.current ? 3.6 + Math.sin(clock.elapsedTime * 8) * 0.6 : mode === 'india' ? 1.4 : 2.6
    setHoloColor(indiaMat, theme.holo.cyan, pulse)
  })

  const pick = (e: ThreeEvent<PointerEvent | MouseEvent>) => {
    const local = group.current!.worldToLocal(e.point.clone())
    const { lon, lat } = vec3ToLonLat(local)
    return insideIndia(lon, lat)
  }

  return (
    <group ref={group}>
      <mesh
        material={occluder}
        renderOrder={-5}
        onPointerMove={(e) => {
          const on = useOrbit.getState().mode === 'globe' && pick(e)
          if (on !== indiaHover.current) {
            indiaHover.current = on
            setCursor(on)
          }
        }}
        onPointerOut={() => {
          indiaHover.current = false
          setCursor(false)
        }}
        onClick={(e) => {
          if (useOrbit.getState().mode === 'globe' && pick(e)) {
            e.stopPropagation()
            useOrbit.getState().setMode('india')
            indiaHover.current = false
            setCursor(false)
          }
        }}
      >
        <sphereGeometry args={[GLOBE_R * 0.995, 64, 48]} />
      </mesh>
      <mesh material={atmosphere} scale={1.045}>
        <sphereGeometry args={[GLOBE_R, 64, 48]} />
      </mesh>
      <lineSegments geometry={grat} material={gratMat} />
      <lineSegments geometry={worldLines} material={worldMat} />
      <lineSegments geometry={indiaLines} material={indiaMat} />
      <points geometry={dots} material={dotsMat} />
      {deployments.map((d) => (
        <GlobeNode key={d.id} d={d} />
      ))}
      <HqNode />
      {deployments
        .filter((d) => d.country !== 'IN')
        .map((d) => (
          <Arc key={d.id} to={d} />
        ))}
    </group>
  )
}

function geom(positions: Float32Array) {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  return g
}

/** Orients a group so its +Z axis points away from the globe centre. */
function useSurfaceFrame(lon: number, lat: number, r: number) {
  return useMemo(() => {
    const p = lonLatToVec3(lon, lat, r)
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), p.clone().normalize())
    return { position: p, quaternion: q }
  }, [lon, lat, r])
}

/** Label alignment on the globe so neighbouring labels do not collide. */
const globeAnchor: Record<string, 'left' | 'right' | 'center'> = {
  mz: 'right',
  mg: 'left',
  cm: 'right',
  ga: 'right',
  sl: 'right',
  au: 'left',
}

function GlobeNode({ d }: { d: Deployment }) {
  const frame = useSurfaceFrame(d.lon, d.lat, GLOBE_R * 1.01)
  const ring = useRef<THREE.Mesh>(null)
  const coming = d.status === 'coming-up'
  const intl = d.country !== 'IN'
  const name = usePlaceName(d.name)
  const comingUp = useFact('comingUpLine')
  const ringMat = useHoloMesh({ color: coming ? theme.holo.ice : theme.holo.blue, intensity: coming ? 1.2 : 2.6, opacity: 0.9, rim: 0, scan: 0 }, [coming])
  const coreMat = useHoloMesh({ color: theme.holo.cyan, intensity: 4, opacity: 1, rim: 0, scan: 0 })
  const beamMat = useHoloLine({ color: theme.holo.cyan, intensity: 2.2, opacity: 0.9, scan: 0 })
  const beam = useMemo(() => geom(new Float32Array([0, 0, 0, 0, 0, intl ? 0.9 : 0.45])), [intl])
  const phase = useMemo(() => Math.random() * Math.PI * 2, [])
  const globeMode = useOrbit((s) => s.mode === 'globe')

  useFrame(({ clock }) => {
    const m = ring.current
    if (!m) return
    const t = (clock.elapsedTime * 0.7 + phase) % 1
    m.scale.setScalar(coming ? 1 : 1 + t * 2.2)
    ;(m.material as THREE.ShaderMaterial).uniforms.uOpacity.value = coming ? 0.8 : 0.9 * (1 - t)
  })

  if (coming && !comingUp) return null

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    const o = useOrbit.getState()
    if (d.country === 'IN') {
      o.setMode('india')
      o.select(d.id)
    } else {
      o.select(d.id)
    }
  }

  return (
    <group position={frame.position} quaternion={frame.quaternion}>
      <mesh ref={ring} material={ringMat}>
        <ringGeometry args={[intl ? 0.1 : 0.06, intl ? 0.13 : 0.08, 32]} />
      </mesh>
      {coming && (
        <mesh material={ringMat}>
          <ringGeometry args={[0.2, 0.22, 32, 1, 0, Math.PI * 1.6]} />
        </mesh>
      )}
      <mesh material={coreMat} onClick={onClick} onPointerOver={() => setCursor(true)} onPointerOut={() => setCursor(false)}>
        <sphereGeometry args={[intl ? 0.07 : 0.05, 12, 12]} />
      </mesh>
      <lineSegments geometry={beam} material={beamMat} />
      {intl && globeMode && (
        <group position={[0, 0, 1.0]}>
          <HoloText fontSize={0.2} variant="hudBold" billboard glow={1.6} anchorX={globeAnchor[d.id] ?? 'center'}>
            {name ?? '·'}
          </HoloText>
          {coming && (
            <HoloText position={[0, -0.22, 0]} fontSize={0.13} variant="mono" color={theme.holo.dim} glow={2.6} billboard anchorX={globeAnchor[d.id] ?? 'center'}>
              coming up
            </HoloText>
          )}
        </group>
      )}
    </group>
  )
}

function HqNode() {
  const hq = useFact('hq')
  const globeMode = useOrbit((s) => s.mode === 'globe')
  const frame = useSurfaceFrame(HQ.lon, HQ.lat, GLOBE_R * 1.012)
  const mat = useHoloMesh({ color: theme.holo.white, intensity: 3, opacity: 1, rim: 0, scan: 0 })
  return (
    <group position={frame.position} quaternion={frame.quaternion}>
      <mesh material={mat} rotation-x={Math.PI / 2}>
        <octahedronGeometry args={[0.09, 0]} />
      </mesh>
      {hq && globeMode && (
        <HoloText position={[0, -0.25, 0.3]} anchorX="right" fontSize={0.13} variant="mono" billboard glow={1.8}>
          {`HQ · ${hq}`}
        </HoloText>
      )}
    </group>
  )
}

/** Arc from HQ to an international deployment, with a pulse running along it. */
function Arc({ to }: { to: Deployment }) {
  const pts = useMemo(() => arcPoints([HQ.lon, HQ.lat], [to.lon, to.lat], GLOBE_R * 1.01), [to])
  const line = useMemo(() => {
    const arr: number[] = []
    for (let i = 0; i < pts.length - 1; i++) arr.push(pts[i].x, pts[i].y, pts[i].z, pts[i + 1].x, pts[i + 1].y, pts[i + 1].z)
    return geom(new Float32Array(arr))
  }, [pts])
  const coming = to.status === 'coming-up'
  const mat = useHoloLine({ color: theme.holo.blue, intensity: coming ? 0.7 : 1.4, opacity: coming ? 0.4 : 0.7, scan: 0 }, [coming])
  const dot = useRef<THREE.Mesh>(null)
  const dotMat = useHoloMesh({ color: theme.holo.ice, intensity: 4, opacity: 1, rim: 0, scan: 0 })
  const offset = useMemo(() => Math.random(), [])
  useFrame(({ clock }) => {
    if (!dot.current) return
    const t = (clock.elapsedTime * 0.22 + offset) % 1
    const i = t * (pts.length - 1)
    const a = pts[Math.floor(i)]
    const b = pts[Math.min(pts.length - 1, Math.floor(i) + 1)]
    dot.current.position.lerpVectors(a, b, i % 1)
    dot.current.visible = !coming
  })
  return (
    <>
      <lineSegments geometry={line} material={mat} />
      <mesh ref={dot} material={dotMat}>
        <sphereGeometry args={[0.04, 8, 8]} />
      </mesh>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* India plate                                                         */
/* ------------------------------------------------------------------ */

const PLATE_POS = new THREE.Vector3(0, 0.25, 6.6)
const PLATE_TILT = -0.32

/** Label offsets (plate units) that keep the north-east cluster readable. */
const labelOffset: Record<string, [number, number]> = {
  'in-ladakh': [0.95, 0.15],
  'in-up': [-1.05, 0.25],
  'in-ayodhya': [0.35, 0.65],
  'in-kerala': [-1.0, 0],
  'in-puducherry': [1.05, -0.1],
  'in-nagaland': [1.2, 0.5],
  'in-manipur': [1.35, -0.05],
  'in-mizoram': [1.0, -0.65],
  'in-tripura': [-0.35, -0.95],
  'in-sikkim': [-0.2, 0.7],
  'in-bhubaneswar': [0.8, -0.6],
  'in-barmer': [-1.05, 0.2],
  'in-nagpur': [-0.7, -0.5],
}

function IndiaPlate() {
  const group = useRef<THREE.Group>(null)
  const lift = useRef(0)
  const indiaFact = useFact('indiaStates')

  const dots = useMemo(() => geom(indiaPlateDots()), [])
  const outline = useMemo(() => geom(indiaPlateOutline()), [])
  const dotsMat = useMemo(() => holoPointsMaterial({ color: theme.holo.blue, intensity: 1.5, size: 1.3, opacity: 0.8 }), [])
  useEffect(() => () => dotsMat.dispose(), [dotsMat])
  const edgeTop = useHoloLine({ color: theme.holo.cyan, intensity: 3, opacity: 1, scan: 0.3 })
  const edgeLow = useHoloLine({ color: theme.holo.blue, intensity: 1.2, opacity: 0.5, scan: 0 })
  const base = useHoloMesh({ color: theme.brand.primaryTo, intensity: 0.8, opacity: 0.12, rim: 0, scan: 0.5 })
  const backing = useMemo(
    () => new THREE.MeshBasicMaterial({ color: '#020814', transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false }),
    [],
  )
  const frame = useHoloLine({ color: theme.holo.dim, intensity: 1.4, opacity: 0.6, scan: 0 })
  const frameGeom = useMemo(() => {
    const w = 5.2
    const h = 5.3
    const c = 0.4
    const corners = [
      [-w, h - c, -w, h, -w + c, h],
      [w - c, h, w, h, w, h - c],
      [w, -h + c, w, -h, w - c, -h],
      [-w + c, -h, -w, -h, -w, -h + c],
    ]
    const arr: number[] = []
    for (const k of corners) arr.push(k[0], k[1], 0, k[2], k[3], 0, k[2], k[3], 0, k[4], k[5], 0)
    return geom(new Float32Array(arr))
  }, [])

  useFrame((_, dt) => {
    const g = group.current
    if (!g) return
    const target = useOrbit.getState().mode === 'india' ? 1 : 0
    lift.current = THREE.MathUtils.damp(lift.current, target, 2.6, dt)
    const t = lift.current
    backing.opacity = 0.97 * t * holoUniforms.uReveal.value
    // Draw order: globe (0), then the opaque backing (1), then plate content (2).
    // Without this, transparent sorting can draw far plate labels before the backing.
    if (g.visible) g.traverse((o) => (o.renderOrder = (o as THREE.Mesh).material === backing ? 1 : 2))
    g.visible = t > 0.01
    g.position.set(0, THREE.MathUtils.lerp(-0.4, PLATE_POS.y, t), THREE.MathUtils.lerp(2.2, PLATE_POS.z, t))
    g.rotation.x = THREE.MathUtils.lerp(0, PLATE_TILT, t)
    g.scale.setScalar(THREE.MathUtils.lerp(0.25, 1, t))
  })

  return (
    <group ref={group} visible={false}>
      <mesh material={backing} position-z={-0.34}>
        <planeGeometry args={[10.6, 10.8]} />
      </mesh>
      <mesh material={base} position-z={-0.3}>
        <planeGeometry args={[10.4, 10.6]} />
      </mesh>
      <lineSegments geometry={frameGeom} material={frame} position-z={-0.3} />
      <points geometry={dots} material={dotsMat} />
      <lineSegments geometry={outline} material={edgeTop} />
      <lineSegments geometry={outline} material={edgeLow} position-z={-0.3} />
      <HoloText position={[-5, 5.05, 0]} anchorX="left" fontSize={0.42} variant="hudBold" glow={1.8}>
        INDIA
      </HoloText>
      {indiaFact && (
        <HoloText position={[-5, 4.6, 0]} anchorX="left" fontSize={0.2} variant="mono" color={theme.holo.dim} glow={2.4}>
          {indiaFact}
        </HoloText>
      )}
      {deployments
        .filter((d) => d.country === 'IN')
        .map((d) => (
          <PlateNode key={d.id} d={d} />
        ))}
      <PlateHq />
    </group>
  )
}

function PlateHq() {
  const hq = useFact('hq')
  const [x, y] = plateXY(HQ.lon, HQ.lat)
  const mat = useHoloMesh({ color: theme.holo.white, intensity: 3, opacity: 1, rim: 0, scan: 0 })
  return (
    <group position={[x, y, 0.05]}>
      <mesh material={mat}>
        <octahedronGeometry args={[0.1, 0]} />
      </mesh>
      {hq && (
        <HoloText position={[0.22, -0.02, 0]} anchorX="left" fontSize={0.15} variant="mono" glow={1.6}>
          {`HQ · ${hq}`}
        </HoloText>
      )}
    </group>
  )
}

function PlateNode({ d }: { d: Deployment }) {
  const [x, y] = plateXY(d.lon, d.lat)
  const ring = useRef<THREE.Mesh>(null)
  const core = useRef<THREE.Mesh>(null)
  const name = usePlaceName(d.name)
  const customer = useCustomer(d)
  const selected = useOrbit((s) => s.selected === d.id)
  const ringMat = useHoloMesh({ color: theme.holo.blue, intensity: 2.6, opacity: 0.9, rim: 0, scan: 0 })
  const coreMat = useHoloMesh({ color: theme.holo.cyan, intensity: 4, opacity: 1, rim: 0, scan: 0 })
  const selMat = useHoloMesh({ color: theme.holo.white, intensity: 3, opacity: 0.9, rim: 0, scan: 0 })
  const leaderMat = useHoloLine({ color: theme.holo.dim, intensity: 1.8, opacity: 0.8, scan: 0 })
  const beamMat = useHoloLine({ color: theme.holo.cyan, intensity: 2.4, opacity: 0.9, scan: 0 })
  const [ox, oy] = labelOffset[d.id] ?? [0, 0.5]
  const leader = useMemo(() => geom(new Float32Array([0, 0, 0.02, ox * 0.82, oy * 0.82, 0.02])), [ox, oy])
  const beam = useMemo(() => geom(new Float32Array([0, 0, 0, 0, 0, 0.7])), [])
  const phase = useMemo(() => Math.random(), [])

  useFrame(({ clock }) => {
    if (ring.current) {
      const t = (clock.elapsedTime * 0.75 + phase) % 1
      ring.current.scale.setScalar(1 + t * 2.4)
      ;(ring.current.material as THREE.ShaderMaterial).uniforms.uOpacity.value = 0.9 * (1 - t)
    }
    if (core.current) {
      const hovered = useOrbit.getState().hovered === d.id
      core.current.scale.setScalar(THREE.MathUtils.lerp(core.current.scale.x, hovered || selected ? 1.6 : 1, 0.2))
    }
  })

  const tag = [d.domain ? domainLabel[d.domain] : null, customer].filter(Boolean).join(' · ')
  const anchorX = ox < -0.3 ? 'right' : ox > 0.3 ? 'left' : 'center'

  return (
    <group position={[x, y, 0.02]}>
      <mesh ref={ring} material={ringMat}>
        <ringGeometry args={[0.07, 0.1, 32]} />
      </mesh>
      {selected && (
        <mesh material={selMat}>
          <ringGeometry args={[0.24, 0.27, 40]} />
        </mesh>
      )}
      <mesh
        ref={core}
        material={coreMat}
        onClick={(e) => {
          e.stopPropagation()
          useOrbit.getState().select(d.id)
        }}
        onDoubleClick={(e) => {
          e.stopPropagation()
          if (d.domain) useApp.getState().goTo(d.domain)
        }}
        onPointerOver={() => {
          useOrbit.getState().hover(d.id)
          setCursor(true)
        }}
        onPointerOut={() => {
          useOrbit.getState().hover(null)
          setCursor(false)
        }}
      >
        <sphereGeometry args={[0.09, 14, 14]} />
      </mesh>
      <lineSegments geometry={beam} material={beamMat} />
      <lineSegments geometry={leader} material={leaderMat} />
      <group position={[ox, oy, 0.02]}>
        {name && (
          <HoloText anchorX={anchorX} position={[0, 0.09, 0]} fontSize={0.2} variant="hudBold" glow={selected ? 2.4 : 1.5} color={selected ? theme.holo.white : theme.holo.ice}>
            {name}
          </HoloText>
        )}
        <HoloText anchorX={anchorX} position={[0, name ? -0.12 : 0, 0]} fontSize={0.13} variant="mono" color={theme.holo.cyan} glow={1.6}>
          {tag}
        </HoloText>
      </group>
    </group>
  )
}

export { useCustomer }
