import { Trail } from '@react-three/drei'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { layers, loopSteps, ontologyPrimitives, phyos } from '../../config/content'
import { theme } from '../../config/theme'
import { useApp } from '../../core/store'
import { HoloGrid } from '../../holo/HoloGrid'
import { HoloRing } from '../../holo/HoloRing'
import { HoloText } from '../../holo/HoloText'
import { useHoloLine, useHoloMesh } from '../../holo/hooks'
import { setHoloColor } from '../../holo/materials'
import { iesKeyOrder, verifyIesHash } from '../../sim/ies'
import {
  BLOCK_APPEAR_U,
  CORE,
  LEDGER_SPACING,
  LEDGER_VISIBLE,
  LEDGER_Y,
  LEDGER_Z,
  NODE_Y,
  RING_R,
  ledgerSlot,
  nodePos,
  packetPose,
  stepAngle,
} from './layout'
import { announceLoop, eventLedger, phaseSeconds, phaseStep, useLoop, type LedgerEntry } from './loopStore'

const stepIndex = (id: string) => loopSteps.findIndex((s) => s.id === id)
const activeIndex = () => stepIndex(phaseStep[useLoop.getState().phase])

const C = {
  done: [theme.holo.blue, 1.3] as const,
  active: [theme.holo.cyan, 3.2] as const,
  future: [theme.holo.dim, 0.9] as const,
  amber: [theme.alert.amber, 2.6] as const,
}

function setCursor(on: boolean) {
  document.body.style.cursor = on ? 'pointer' : ''
}

/** Opens an IES record in the inspector with its hash re-checked. */
export function inspectRecord(title: string, subtitle: string, record: Parameters<typeof verifyIesHash>[0]) {
  const ordered: Record<string, unknown> = {}
  for (const k of iesKeyOrder) ordered[k] = record[k]
  useApp.getState().setInspect({
    title,
    subtitle,
    data: ordered,
    checks: [
      { label: 'IES hash recomputed', ok: verifyIesHash(record) },
      { label: record.lineage ? `Derived via ${record.lineage.method}` : 'Capture (no lineage)', ok: true },
    ],
  })
}

export function inspectBlock(entry: LedgerEntry) {
  const v = eventLedger.verify(entry.block, entry.payload)
  useApp.getState().setInspect({
    title: `Ledger block #${entry.block.seq}`,
    subtitle: entry.payload.type === 'settlement' ? 'Settlement. Certificate inside.' : 'Rejection. Recorded, not settled.',
    data: { block: entry.block, payload: entry.payload },
    checks: [
      { label: 'Payload hash matches', ok: v.payloadHashOk },
      { label: 'Block hash recomputed', ok: v.blockHashOk },
      { label: 'Linked to previous block', ok: v.linkOk },
      { label: 'Ed25519 signature valid', ok: v.signatureOk },
    ],
  })
}

export function LoopStage() {
  useFrame((_, dt) => {
    if (useApp.getState().pendingScene) return
    useLoop.getState().tick(Math.min(dt, 0.1))
  })

  useEffect(() => {
    announceLoop()
    return () => setCursor(false)
  }, [])

  return (
    <>
      <HoloGrid y={-0.02} />
      <PhyosPlate />
      {loopSteps.map((s, i) => (
        <StepNode key={s.id} i={i} />
      ))}
      {loopSteps.map((s, i) => (
        <ArcSegment key={s.id} i={i} />
      ))}
      <HumanGate />
      <Core />
      <SensorRig />
      <EdgeBox />
      <PlanCard />
      <CertificateCard />
      <DecisionStack />
      <LedgerChain />
      <Packet />
    </>
  )
}

function PhyosPlate() {
  const disc = useHoloMesh({ color: theme.brand.primaryTo, intensity: 0.9, opacity: 0.18, rim: 0, scan: 0.3 })
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position-y={0.01} material={disc}>
        <ringGeometry args={[2.4, 8.8, 6, 1]} />
      </mesh>
      <HoloRing radius={8.8} color={theme.holo.blue} intensity={1.6} />
      <HoloRing radius={9.3} color={theme.holo.blue} intensity={1.2} dash={0.5} dashCount={120} />
      <HoloRing radius={RING_R} color={theme.holo.dim} intensity={0.8} opacity={0.4} dash={0.25} dashCount={180} />
      <HoloText position={[0, 0.03, 7.7]} rotation-x={-Math.PI / 2} fontSize={0.62} variant="hudBold" glow={1.8}>
        {phyos.name}
      </HoloText>
      <HoloText position={[0, 0.03, 8.3]} rotation-x={-Math.PI / 2} fontSize={0.2} variant="mono" color={theme.holo.dim} glow={2.2}>
        base-layer data model · append-only · every event conforms to IES at creation
      </HoloText>
    </group>
  )
}

function StepNode({ i }: { i: number }) {
  const step = loopSteps[i]
  const p = nodePos(i)
  const group = useRef<THREE.Group>(null)
  const plate = useHoloMesh({ color: theme.holo.blue, intensity: 1.2, opacity: 0.4, rim: 0.8 })
  const edge = useHoloLine({ color: theme.holo.cyan, intensity: 1.5, opacity: 0.95 })
  const edges = useMemo(() => new THREE.EdgesGeometry(new THREE.CylinderGeometry(0.85, 0.85, 0.24, 6)), [])
  const drillable = step.id === 'schedule' || step.id === 'learn'

  useFrame(({ clock }) => {
    const a = activeIndex()
    const phase = useLoop.getState().phase
    const state = phase === 'approve' && i === a ? 'amber' : i === a ? 'active' : i < a ? 'done' : 'future'
    const [color, k] = C[state]
    setHoloColor(edge, color, k)
    setHoloColor(plate, color, k * 0.45)
    if (group.current) {
      const target = i === a ? 1.18 + Math.sin(clock.elapsedTime * 4) * 0.04 : 1
      group.current.scale.setScalar(THREE.MathUtils.lerp(group.current.scale.x, target, 0.12))
    }
  })

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    if (drillable) useLoop.getState().setDrill(step.id as 'schedule' | 'learn')
  }

  return (
    <group position={p}>
      <group
        ref={group}
        onClick={onClick}
        onPointerOver={() => drillable && setCursor(true)}
        onPointerOut={() => setCursor(false)}
      >
        <mesh material={plate}>
          <cylinderGeometry args={[0.85, 0.85, 0.24, 6]} />
        </mesh>
        <lineSegments geometry={edges} material={edge} />
      </group>
      <HoloText position={[0, 1.15, 0]} fontSize={0.2} variant="mono" color={theme.holo.cyan} glow={1.8} billboard>
        {String(i + 1).padStart(2, '0')}
      </HoloText>
      <HoloText position={[0, 0.82, 0]} fontSize={0.36} variant="hudBold" glow={1.6} billboard>
        {step.title}
      </HoloText>
      {drillable && (
        <HoloText position={[0, 0.5, 0]} fontSize={0.16} variant="mono" color={theme.holo.dim} glow={2.4} billboard>
          click to open
        </HoloText>
      )}
    </group>
  )
}

function ArcSegment({ i }: { i: number }) {
  const geometry = useMemo(() => {
    const a0 = stepAngle(i) + 0.14
    const a1 = stepAngle(i + 1) - 0.14
    const pts: number[] = []
    const n = 48
    for (let k = 0; k < n; k++) {
      const u0 = a0 + ((a1 - a0) * k) / n
      const u1 = a0 + ((a1 - a0) * (k + 1)) / n
      pts.push(Math.cos(u0) * RING_R, NODE_Y, Math.sin(u0) * RING_R, Math.cos(u1) * RING_R, NODE_Y, Math.sin(u1) * RING_R)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    return g
  }, [i])
  const mat = useHoloLine({ color: theme.holo.dim, intensity: 1, opacity: 0.9, scan: 0.2 })
  useFrame(() => {
    const a = activeIndex()
    const [color, k] = i === a ? C.active : i < a ? C.done : C.future
    setHoloColor(mat, color, i === a ? k * 0.7 : k)
  })
  return <lineSegments geometry={geometry} material={mat} />
}

/** Diamond marker between VERIFY and SETTLE: nothing settles without a person. */
function HumanGate() {
  const a = (stepAngle(3) + stepAngle(4)) / 2
  const pos = new THREE.Vector3(Math.cos(a) * RING_R, NODE_Y + 0.05, Math.sin(a) * RING_R)
  const ref = useRef<THREE.Mesh>(null)
  const mat = useHoloMesh({ color: theme.holo.dim, intensity: 1, opacity: 0.8, rim: 1 })
  useFrame(({ clock }) => {
    const waiting = useLoop.getState().phase === 'approve'
    setHoloColor(mat, waiting ? theme.alert.amber : theme.holo.blue, waiting ? 2.6 + Math.sin(clock.elapsedTime * 6) : 1.2)
    if (ref.current) ref.current.rotation.y += 0.02
  })
  return (
    <group position={pos}>
      <mesh ref={ref} material={mat}>
        <octahedronGeometry args={[0.32, 0]} />
      </mesh>
      <HoloText position={[0, 0.62, 0]} fontSize={0.17} variant="mono" color={theme.alert.amber} glow={1.6} billboard>
        HUMAN GATE
      </HoloText>
    </group>
  )
}

function Core() {
  const shell = useRef<THREE.LineSegments>(null)
  const ringA = useRef<THREE.Mesh>(null)
  const ringB = useRef<THREE.Mesh>(null)
  const onto = useRef<THREE.Group>(null)
  const icoEdges = useMemo(() => new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(1.15, 1)), [])
  const shellMat = useHoloLine({ color: theme.holo.cyan, intensity: 2.2, opacity: 0.9 })
  const heart = useHoloMesh({ color: theme.holo.blue, intensity: 2.4, opacity: 0.7, rim: 1.6 })
  const ringMat = useHoloMesh({ color: theme.holo.cyan, intensity: 2.2, opacity: 0.9, rim: 0.4, scan: 0 })
  const dotMat = useHoloMesh({ color: theme.holo.cyan, intensity: 3, opacity: 1, rim: 0, scan: 0 })

  useFrame(({ clock }, dt) => {
    const phase = useLoop.getState().phase
    const busy = phase === 'verify' || phase === 'approve'
    const speed = busy ? 1.6 : 0.5
    if (shell.current) {
      shell.current.rotation.y += dt * 0.4 * speed
      shell.current.rotation.x += dt * 0.15 * speed
    }
    if (ringA.current) ringA.current.rotation.z += dt * 0.7 * speed
    if (ringB.current) ringB.current.rotation.x += dt * 0.5 * speed
    if (onto.current) onto.current.rotation.y += dt * 0.08
    const pulse = 1 + Math.sin(clock.elapsedTime * (busy ? 7 : 2)) * 0.15
    setHoloColor(heart, phase === 'approve' ? theme.alert.amber : theme.holo.blue, (busy ? 3.2 : 2.2) * pulse)
  })

  return (
    <group position={CORE}>
      <lineSegments ref={shell} geometry={icoEdges} material={shellMat} />
      <mesh material={heart}>
        <sphereGeometry args={[0.62, 32, 32]} />
      </mesh>
      <mesh ref={ringA} material={ringMat} rotation-x={Math.PI / 2.4}>
        <torusGeometry args={[1.75, 0.012, 6, 160]} />
      </mesh>
      <mesh ref={ringB} material={ringMat} rotation-y={Math.PI / 3}>
        <torusGeometry args={[1.95, 0.01, 6, 160]} />
      </mesh>
      <group ref={onto}>
        {ontologyPrimitives.map((name, k) => {
          const a = (k / ontologyPrimitives.length) * Math.PI * 2
          return (
            <group key={name} position={[Math.cos(a) * 2.75, -0.55, Math.sin(a) * 2.75]}>
              <mesh material={dotMat}>
                <sphereGeometry args={[0.05, 8, 8]} />
              </mesh>
              <HoloText position={[0, 0.22, 0]} fontSize={0.17} variant="mono" color={theme.holo.ice} glow={1.2} opacity={0.85} billboard>
                {name}
              </HoloText>
            </group>
          )
        })}
      </group>
      <HoloRing radius={2.75} color={theme.holo.dim} intensity={1.2} opacity={0.5} dash={0.4} dashCount={80} />
      <HoloText position={[0, 3.3, 0]} fontSize={0.42} variant="hudBold" glow={2} billboard>
        CORTEX · act
      </HoloText>
    </group>
  )
}

/** Boson + Photon plug in at SENSE. */
function SensorRig() {
  const base = nodePos(1, 0)
  const out = base.clone().setLength(RING_R + 1.7)
  const mast = useHoloMesh({ color: theme.holo.blue, intensity: 1.4, opacity: 0.6 })
  const cone = useHoloMesh({ color: theme.holo.cyan, intensity: 1.2, opacity: 0.18, rim: 0.2 })
  const coneRef = useRef<THREE.Mesh>(null)
  useFrame(({ clock }) => {
    const sensing = useLoop.getState().phase === 'sense'
    setHoloColor(cone, theme.holo.cyan, sensing ? 2.6 + Math.sin(clock.elapsedTime * 12) * 0.6 : 0.9)
  })
  const toward = Math.atan2(-out.x, -out.z)
  const bosonLine = layers.find((l) => l.id === 'boson')!
  const photonLine = layers.find((l) => l.id === 'photon')!
  return (
    <group position={[out.x, 0, out.z]} rotation-y={toward}>
      <mesh position-y={1.1} material={mast}>
        <cylinderGeometry args={[0.05, 0.08, 2.2, 8]} />
      </mesh>
      <mesh position={[0, 2.25, 0.1]} material={mast}>
        <boxGeometry args={[0.5, 0.32, 0.42]} />
      </mesh>
      <mesh ref={coneRef} position={[0, 1.7, 1.25]} rotation-x={Math.PI / 2 + 0.45} material={cone}>
        <coneGeometry args={[0.85, 2.2, 24, 1, true]} />
      </mesh>
      <mesh position={[0.6, 0.35, 0]} material={mast}>
        <cylinderGeometry args={[0.28, 0.28, 0.5, 20]} />
      </mesh>
      <HoloText position={[0, 3.25, 0]} fontSize={0.3} variant="hudBold" glow={1.6} billboard>
        {`${bosonLine.name.toUpperCase()} · ${bosonLine.verb}`}
      </HoloText>
      <HoloText position={[0, 2.88, 0]} fontSize={0.3} variant="hudBold" glow={1.6} billboard>
        {`${photonLine.name.toUpperCase()} · ${photonLine.verb}`}
      </HoloText>
    </group>
  )
}

/** Edge box with three model slots, lit by the scheduler. */
function EdgeBox() {
  const base = nodePos(2, 0)
  const out = base.clone().setLength(RING_R + 1.6)
  const body = useHoloMesh({ color: theme.holo.blue, intensity: 1.2, opacity: 0.45 })
  const edges = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(1.5, 0.7, 1.0)), [])
  const edgeMat = useHoloLine({ color: theme.holo.cyan, intensity: 1.8 })
  const slots = [
    useHoloMesh({ color: theme.holo.dim, intensity: 1, opacity: 0.9, scan: 0 }),
    useHoloMesh({ color: theme.holo.dim, intensity: 1, opacity: 0.9, scan: 0 }),
    useHoloMesh({ color: theme.holo.dim, intensity: 1, opacity: 0.9, scan: 0 }),
  ]
  useFrame(({ clock }) => {
    const { phase, current } = useLoop.getState()
    slots.forEach((m, k) => {
      const chosen = phase === 'schedule' && k + 1 === current.schedule.slot
      const busy = Math.sin(clock.elapsedTime * (2 + k) + k * 2) > 0.2
      setHoloColor(m, chosen ? theme.holo.cyan : busy ? theme.holo.blue : theme.holo.dim, chosen ? 4 : busy ? 1.6 : 0.8)
    })
  })
  const toward = Math.atan2(-out.x, -out.z)
  return (
    <group position={[out.x, 0.6, out.z]} rotation-y={toward}>
      <mesh material={body}>
        <boxGeometry args={[1.5, 0.7, 1.0]} />
      </mesh>
      <lineSegments geometry={edges} material={edgeMat} />
      {slots.map((m, k) => (
        <mesh key={k} position={[-0.45 + k * 0.45, 0.37, 0]} material={m}>
          <boxGeometry args={[0.32, 0.04, 0.7]} />
        </mesh>
      ))}
      <HoloText position={[0, -0.95, 0]} fontSize={0.22} variant="hudBold" glow={1.6} billboard>
        EDGE · 3 MODEL SLOTS
      </HoloText>
    </group>
  )
}

/** Typed task produced at INTENT. */
function PlanCard() {
  const task = useLoop((s) => s.current.task.text)
  const pos = nodePos(0, 0).add(new THREE.Vector3(-2.6, 0, -2.2))
  const card = useHoloMesh({ color: theme.holo.blue, intensity: 0.8, opacity: 0.35, rim: 0.2 })
  const frame = useHoloLine({ color: theme.holo.cyan, intensity: 1.6 })
  const edges = useMemo(() => new THREE.EdgesGeometry(new THREE.PlaneGeometry(4.6, 1.1)), [])
  useFrame(() => {
    const on = useLoop.getState().phase === 'intent'
    setHoloColor(frame, theme.holo.cyan, on ? 3 : 1.2)
  })
  return (
    <group position={[pos.x, 2.9, pos.z]}>
      <mesh material={card}>
        <planeGeometry args={[4.6, 1.1]} />
      </mesh>
      <lineSegments geometry={edges} material={frame} />
      <HoloText position={[-2.15, 0.3, 0.01]} anchorX="left" fontSize={0.2} variant="mono" color={theme.holo.cyan} glow={1.8}>
        TYPED TASK · plan approved
      </HoloText>
      <HoloText position={[-2.15, -0.12, 0.01]} anchorX="left" maxWidth={4.3} fontSize={0.21} variant="mono" glow={1.3}>
        {task}
      </HoloText>
    </group>
  )
}

/** Certificate minted at SETTLE. */
function CertificateCard() {
  const cert = useLoop((s) => s.certificate)
  const decision = useLoop((s) => s.decision)
  const group = useRef<THREE.Group>(null)
  const pos = nodePos(4, 0).add(new THREE.Vector3(-1.5, 0, 2.6))
  const card = useHoloMesh({ color: theme.holo.blue, intensity: 1, opacity: 0.4, rim: 0.3 })
  const frame = useHoloLine({ color: theme.holo.white, intensity: 2.4 })
  const edges = useMemo(() => new THREE.EdgesGeometry(new THREE.PlaneGeometry(3.2, 1.6)), [])
  const rejected = decision?.action === 'reject'

  useFrame(() => {
    const { phase, t } = useLoop.getState()
    const show = (phase === 'settle' && t > 0.6) || phase === 'learn'
    if (group.current) {
      const target = show ? 1 : 0.001
      const s = THREE.MathUtils.lerp(group.current.scale.x, target, 0.15)
      group.current.scale.setScalar(s)
      group.current.visible = s > 0.01
    }
    setHoloColor(frame, rejected ? theme.alert.amber : theme.holo.white, 2.4)
  })

  return (
    <group ref={group} position={[pos.x, 1.3, pos.z]} rotation-x={-0.35} scale={0.001}>
      <mesh material={card}>
        <planeGeometry args={[3.2, 1.6]} />
      </mesh>
      <lineSegments geometry={edges} material={frame} />
      <HoloText position={[0, 0.48, 0.01]} fontSize={0.28} variant="hudBold" glow={2.2} color={rejected ? theme.alert.amber : theme.holo.white}>
        {rejected ? 'NOT SETTLED' : 'CERTIFICATE'}
      </HoloText>
      <HoloText position={[0, 0.1, 0.01]} fontSize={0.16} variant="mono" glow={1.4}>
        {cert?.certificate_id ?? 'rejection recorded on ledger'}
      </HoloText>
      <HoloText position={[0, -0.32, 0.01]} fontSize={0.2} variant="hud" maxWidth={3} textAlign="center" glow={1.6} color={rejected ? theme.alert.amber : theme.ok}>
        {cert ? cert.settles : `reason: ${decision?.reason ?? ''}`}
      </HoloText>
    </group>
  )
}

/** Decision log at LEARN: one plate per decision. */
function DecisionStack() {
  const count = useLoop((s) => s.decisionLog.length)
  const pos = nodePos(5, 0).setLength(RING_R + 1.5)
  const plate = useHoloMesh({ color: theme.holo.blue, intensity: 1.4, opacity: 0.5, rim: 0.6 })
  const top = useHoloMesh({ color: theme.holo.cyan, intensity: 1.6, opacity: 0.6 })
  const n = Math.min(4 + count, 14)
  return (
    <group position={[pos.x, 0.2, pos.z]}>
      {Array.from({ length: n }, (_, k) => (
        <mesh key={k} position-y={k * 0.11} material={k === n - 1 ? top : plate}>
          <boxGeometry args={[1.3, 0.05, 0.9]} />
        </mesh>
      ))}
      <HoloText position={[0, n * 0.11 + 0.45, 0]} fontSize={0.26} variant="hudBold" glow={1.6} billboard>
        DECISION LOG
      </HoloText>
    </group>
  )
}

function LedgerChain() {
  const entries = useLoop((s) => s.entries)
  const visible = entries.slice(-LEDGER_VISIBLE)
  const link = useHoloLine({ color: theme.holo.cyan, intensity: 1.8, opacity: 0.9 })
  const linkGeom = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const a = ledgerSlot(0, LEDGER_VISIBLE)
    const b = ledgerSlot(LEDGER_VISIBLE - 1, LEDGER_VISIBLE)
    g.setAttribute('position', new THREE.Float32BufferAttribute([a.x - 1, a.y, a.z, b.x, b.y, b.z], 3))
    return g
  }, [])
  const left = ledgerSlot(0, LEDGER_VISIBLE)
  return (
    <group>
      <lineSegments geometry={linkGeom} material={link} />
      {visible.map((e, k) => (
        <LedgerBlockMesh key={e.block.seq} entry={e} slot={k + LEDGER_VISIBLE - visible.length} isNewest={k === visible.length - 1} />
      ))}
      <HoloText position={[left.x - 0.6, LEDGER_Y + 1.85, LEDGER_Z]} anchorX="left" fontSize={0.3} variant="hudBold" glow={1.8}>
        EVENT LEDGER
      </HoloText>
      <HoloText position={[left.x - 0.6, LEDGER_Y + 1.45, LEDGER_Z]} anchorX="left" fontSize={0.17} variant="mono" color={theme.holo.dim} glow={2.4}>
        hash-linked · Ed25519-signed · anchored daily · click a block
      </HoloText>
      <HoloText position={[left.x + LEDGER_SPACING * (LEDGER_VISIBLE - 1) + 1.2, LEDGER_Y, LEDGER_Z]} anchorX="left" fontSize={0.2} variant="mono" color={theme.holo.dim} glow={2}>
        HEAD →
      </HoloText>
    </group>
  )
}

function LedgerBlockMesh({ entry, slot, isNewest }: { entry: LedgerEntry; slot: number; isNewest: boolean }) {
  const ref = useRef<THREE.Group>(null)
  const rejected = entry.payload.type === 'rejection'
  const body = useHoloMesh({ color: rejected ? theme.alert.amber : theme.holo.blue, intensity: rejected ? 1.2 : 1.4, opacity: 0.5, rim: 1 }, [rejected])
  const edgeMat = useHoloLine({ color: rejected ? theme.alert.amber : theme.holo.cyan, intensity: 2.2 }, [rejected])
  const edges = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(0.95, 0.95, 0.95)), [])
  const target = ledgerSlot(slot, LEDGER_VISIBLE)
  const hovered = useRef(false)

  useFrame((_, dt) => {
    const g = ref.current
    if (!g) return
    g.position.lerp(target, Math.min(1, dt * 4))
    const { phase, t } = useLoop.getState()
    const waitingForPacket = isNewest && phase === 'settle' && t / phaseSeconds.settle < BLOCK_APPEAR_U
    const s = waitingForPacket ? 0.001 : hovered.current ? 1.15 : 1
    g.scale.setScalar(THREE.MathUtils.lerp(g.scale.x, s, 0.18))
    g.rotation.y += dt * 0.25
  })

  return (
    <group
      ref={ref}
      position={isNewest ? target : ledgerSlot(slot + 1, LEDGER_VISIBLE)}
      scale={isNewest ? 0.001 : 1}
      onClick={(e) => {
        e.stopPropagation()
        inspectBlock(entry)
      }}
      onPointerOver={() => {
        hovered.current = true
        setCursor(true)
      }}
      onPointerOut={() => {
        hovered.current = false
        setCursor(false)
      }}
    >
      <mesh material={body}>
        <boxGeometry args={[0.95, 0.95, 0.95]} />
      </mesh>
      <lineSegments geometry={edges} material={edgeMat} />
      <HoloText position={[0, 0.85, 0]} fontSize={0.2} variant="mono" glow={1.6} billboard>
        {`#${entry.block.seq}`}
      </HoloText>
      <HoloText position={[0, -0.8, 0]} fontSize={0.13} variant="mono" color={theme.holo.dim} glow={2.4} billboard>
        {entry.block.hash.slice(0, 10)}
      </HoloText>
    </group>
  )
}

function Packet() {
  const ref = useRef<THREE.Mesh>(null)
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(theme.holo.white).multiplyScalar(4), toneMapped: false }), [])
  const halo = useHoloMesh({ color: theme.holo.cyan, intensity: 2.5, opacity: 0.5, rim: 2, scan: 0 })
  const haloRef = useRef<THREE.Mesh>(null)
  const tones = useMemo(
    () => ({
      cyan: new THREE.Color(theme.holo.cyan).multiplyScalar(4),
      white: new THREE.Color(theme.holo.white).multiplyScalar(5),
      amber: new THREE.Color(theme.alert.amber).multiplyScalar(4),
    }),
    [],
  )

  useFrame(({ clock }) => {
    const { phase, t, decision } = useLoop.getState()
    const pose = packetPose(phase, t, phaseSeconds[phase], decision?.action === 'reject', clock.elapsedTime)
    const m = ref.current
    if (!m) return
    m.position.copy(pose.pos)
    m.scale.setScalar(Math.max(0.001, pose.scale))
    m.visible = pose.visible
    mat.color.copy(tones[pose.tone])
    setHoloColor(halo, pose.tone === 'amber' ? theme.alert.amber : theme.holo.cyan, 2.5)
    if (haloRef.current) haloRef.current.scale.setScalar(1 + Math.sin(clock.elapsedTime * 6) * 0.15)
  })

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    const c = useLoop.getState().current
    inspectRecord('IES record · live event', c.headline, c.derived)
  }

  return (
    <Trail width={1.2} length={7} decay={1.2} color={new THREE.Color(theme.holo.cyan).multiplyScalar(2.5)} attenuation={(w) => w * w}>
      <mesh ref={ref} material={mat} onClick={onClick} onPointerOver={() => setCursor(true)} onPointerOut={() => setCursor(false)}>
        <sphereGeometry args={[0.17, 20, 20]} />
        <mesh ref={haloRef} material={halo}>
          <sphereGeometry args={[0.36, 20, 20]} />
        </mesh>
      </mesh>
    </Trail>
  )
}
