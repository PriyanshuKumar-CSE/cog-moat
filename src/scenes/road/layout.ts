import * as THREE from 'three'

/**
 * Spatial layout of the Road scene. The section runs left to right along X
 * with a gentle S-curve. Lateral sizes are exaggerated so the carriageway reads
 * at presentation distance.
 */
const X0_ = -6.2
const X1_ = 6.2
export const X0 = X0_
export const X1 = X1_
export const HALF_W = 0.95
export const ROAD_Y = 0.03

/** Planned centreline (approved alignment). */
export const planZ = (x: number) => 0.75 * Math.sin(x * 0.32 + 0.5) - 0.2

/** Where along the section the as-built alignment drifts most from plan. */
export const DRIFT_U = 0.3
const DRIFT_X = X0_ + (X1_ - X0_) * DRIFT_U

/** As-built centreline: the plan plus a small simulated drift. */
export const builtZ = (x: number) => planZ(x) + 0.14 * Math.exp(-(((x - DRIFT_X) / 1.4) ** 2))

/** How far toward the camera (in half-widths) the plan callouts sit. */
export const CALLOUT_ACROSS = 2.55

export const xAt = (u: number) => X0 + (X1 - X0) * u

/** Unit normal of the as-built centreline in the XZ plane (pointing to +Z, toward the camera). */
export function normalAt(x: number, out = new THREE.Vector2()) {
  const e = 0.01
  const dz = (builtZ(x + e) - builtZ(x - e)) / (2 * e)
  out.set(-dz, 1).normalize()
  return out
}

const n2 = new THREE.Vector2()

/**
 * Point on the as-built carriageway. `across` is -1 at the near (camera) edge
 * and +1 at the far edge.
 */
export function roadPoint(u: number, across: number, y = ROAD_Y, out = new THREE.Vector3()) {
  const x = xAt(u)
  normalAt(x, n2)
  const o = -across * HALF_W
  return out.set(x + n2.x * o, y, builtZ(x) + n2.y * o)
}

/** Heading (rotation about Y) of the road at u, for objects that face along it. */
export function headingAt(u: number) {
  const x = xAt(u)
  const e = 0.01
  const dz = (builtZ(x + e) - builtZ(x - e)) / (2 * e)
  return -Math.atan2(dz, 1)
}

/** Terrain height: flat near the road, rolling hills further out. */
export function terrainY(x: number, z: number) {
  const d = Math.abs(z - builtZ(x))
  const ramp = THREE.MathUtils.smoothstep(d, 1.5, 5.5)
  const hills = 0.55 + 0.45 * Math.sin(x * 0.36 + 1.2) * Math.cos(z * 0.31) + 0.2 * Math.sin(x * 0.8 + z * 0.55)
  const back = z < 0 ? 1 + Math.min(1.4, -z * 0.11) : 0.5
  return -0.02 + ramp * Math.max(0, hills) * back * 1.1
}

/** Certificate and ledger placement (behind the road, above the hills). */
export const CERT_POS = new THREE.Vector3(-1.5, 3.7, -3.4)
export const LEDGER_POS = new THREE.Vector3(2.4, 3.55, -3.4)
export const LEDGER_SPACING = 0.95
