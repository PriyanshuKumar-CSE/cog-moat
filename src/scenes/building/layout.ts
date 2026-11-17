import * as THREE from 'three'

/**
 * Spatial layout of the Building scene. One B+G+6 RCC tower on a structural
 * grid of 5 x 3 bays. X runs along the long facade (facing the camera), Z is
 * depth, Y is up. Ground level is y = 0.
 */

/** Column grid lines. */
export const GRID_X = [-3, -1.8, -0.6, 0.6, 1.8, 3]
export const GRID_Z = [-1.8, -0.6, 0.6, 1.8]
export const HALF_X = 3
export const HALF_Z = 1.8

/** Storey height and level elevations. Level 0 is the ground slab, level 7 the roof. */
export const STOREY = 0.9
export const LEVELS = 7
export const levelY = (k: number) => k * STOREY
export const ROOF_Y = levelY(LEVELS)

/** Basement and foundation. */
export const BASEMENT_Y = -1.0
export const RAFT_TOP = BASEMENT_Y
export const RAFT_BOTTOM = -1.3
export const PILE_TIP = -3.0
/** Excavated pit, slightly larger than the building. */
export const PIT_X = 3.5
export const PIT_Z = 2.3

/** Column and slab sizes. */
export const COL = 0.16
export const SLAB = 0.07

/** Grid label for a column line, e.g. "C-3". */
export const gridLabel = (ix: number, iz: number) => `${'ABCDEF'[ix]}-${iz + 1}`

/** Plumbing shaft (supply and drain risers) at the back right corner bay. */
export const PLUMB_SHAFT = new THREE.Vector3(2.45, 0, -1.25)
/** Electrical rising main at the back left corner bay. */
export const ELEC_SHAFT = new THREE.Vector3(-2.45, 0, -1.25)
/** Meter room and transformer outside the building, front left. */
export const METER_ROOM = new THREE.Vector3(-4.6, 0, 1.6)

/** Tower crane base, far back left: on screen the mast stands between the left panel and the level labels. */
export const CRANE_BASE = new THREE.Vector3(-8, 0, -8)
export const CRANE_H = 8.4

/** Certificate above right of the tower; ledger on the ground, front right. Finding labels use the space between. */
export const LABEL_X = HALF_X + 1.7
export const CERT_POS = new THREE.Vector3(6.7, 7.5, -0.6)
export const LEDGER_POS = new THREE.Vector3(5.6, 0.35, 3.3)
export const LEDGER_SPACING = 0.95

