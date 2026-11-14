import * as THREE from 'three'
import type { Certificate, LedgerEntry, Phase } from './loopStore'

/** Spatial layout of the Loop scene. */
export const RING_R = 6.0
export const NODE_Y = 0.9
export const CORE = new THREE.Vector3(0, 2.6, 0)

/**
 * Step angles: INTENT back-left, then clockwise as seen from the camera.
 * No node sits directly behind or in front of the core, and the human gate
 * (between VERIFY and SETTLE) lands front-centre.
 */
export const stepAngle = (i: number) => THREE.MathUtils.degToRad(-120 + 60 * i)

export const nodePos = (i: number, y = NODE_Y) =>
  new THREE.Vector3(Math.cos(stepAngle(i)) * RING_R, y, Math.sin(stepAngle(i)) * RING_R)

/** Ledger chain: a row of blocks floating behind the core. Newest on the right. */
export const LEDGER_Y = 4.4
export const LEDGER_Z = -10
export const LEDGER_SPACING = 1.75
export const LEDGER_VISIBLE = 7

export const ledgerSlot = (k: number, count: number) => {
  // k = index within visible window, rightmost is newest.
  const offset = k - (count - 1)
  return new THREE.Vector3(((LEDGER_VISIBLE - 1) / 2) * LEDGER_SPACING + offset * LEDGER_SPACING, LEDGER_Y, LEDGER_Z)
}

const tmp = new THREE.Vector3()

function arcOnRing(fromIdx: number, toIdx: number, u: number, y = NODE_Y + 0.35) {
  let a0 = stepAngle(fromIdx)
  let a1 = stepAngle(toIdx)
  if (a1 < a0) a1 += Math.PI * 2
  const a = THREE.MathUtils.lerp(a0, a1, u)
  a0 = a
  return tmp.set(Math.cos(a0) * RING_R, y, Math.sin(a0) * RING_R).clone()
}

function bezier(a: THREE.Vector3, b: THREE.Vector3, lift: number, u: number) {
  const mid = a.clone().add(b).multiplyScalar(0.5)
  mid.y += lift
  const p = new THREE.Vector3()
  const iu = 1 - u
  p.copy(a).multiplyScalar(iu * iu)
  p.addScaledVector(mid, 2 * iu * u)
  p.addScaledVector(b, u * u)
  return p
}

const ease = (u: number) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2)
const clamp01 = (u: number) => Math.min(1, Math.max(0, u))

export interface PacketPose {
  pos: THREE.Vector3
  visible: boolean
  scale: number
  tone: 'cyan' | 'amber' | 'white'
}

/** Where the event packet is for a given phase and time. */
export function packetPose(phase: Phase, t: number, dur: number, rejected: boolean, time: number): PacketPose {
  const u = clamp01(t / (Number.isFinite(dur) ? dur : 1))
  const orbit = (r: number, speed: number) =>
    CORE.clone().add(new THREE.Vector3(Math.cos(time * speed) * r, Math.sin(time * speed * 1.3) * 0.25, Math.sin(time * speed) * r))
  switch (phase) {
    case 'intent':
      return { pos: nodePos(0, NODE_Y + 0.6), visible: false, scale: 0, tone: 'cyan' }
    case 'sense': {
      const p = nodePos(1, NODE_Y + 0.2 + ease(clamp01(u * 1.6)) * 0.9)
      return { pos: p, visible: true, scale: ease(clamp01(u * 2.5)), tone: 'white' }
    }
    case 'schedule': {
      const p = u < 0.55 ? arcOnRing(1, 2, ease(u / 0.55), NODE_Y + 1.1) : nodePos(2, NODE_Y + 1.1)
      return { pos: p, visible: true, scale: 1, tone: 'cyan' }
    }
    case 'verify': {
      if (u < 0.35) return { pos: bezier(nodePos(2, NODE_Y + 1.1), CORE, 2.2, ease(u / 0.35)), visible: true, scale: 1, tone: 'cyan' }
      const k = (u - 0.35) / 0.65
      return { pos: orbit(1.7 - k * 0.2, 2.4), visible: true, scale: 1, tone: 'cyan' }
    }
    case 'approve':
      return { pos: orbit(1.5, 1.2), visible: true, scale: 1 + Math.sin(time * 5) * 0.12, tone: 'amber' }
    case 'settle': {
      const tone = rejected ? 'amber' : 'white'
      if (u < 0.32) return { pos: bezier(CORE, nodePos(4, NODE_Y + 1.1), 1.6, ease(u / 0.32)), visible: true, scale: 1, tone }
      if (u < 0.72) {
        const head = ledgerSlot(LEDGER_VISIBLE - 1, LEDGER_VISIBLE)
        return { pos: bezier(nodePos(4, NODE_Y + 1.1), head, 4.5, ease((u - 0.32) / 0.4)), visible: true, scale: 1, tone }
      }
      return { pos: ledgerSlot(LEDGER_VISIBLE - 1, LEDGER_VISIBLE), visible: false, scale: 0, tone }
    }
    case 'learn': {
      if (u < 0.85) {
        const k = ease(u / 0.85)
        const p = k < 0.5 ? arcOnRing(4, 5, k * 2) : arcOnRing(5, 6, (k - 0.5) * 2)
        return { pos: p, visible: true, scale: 0.7, tone: 'cyan' }
      }
      return { pos: nodePos(0, NODE_Y + 0.35), visible: true, scale: 0.7 * (1 - (u - 0.85) / 0.15), tone: 'cyan' }
    }
  }
}

/** How far the settle animation is (0..1) when the new block should appear. */
export const BLOCK_APPEAR_U = 0.72

export type { Certificate, LedgerEntry }
