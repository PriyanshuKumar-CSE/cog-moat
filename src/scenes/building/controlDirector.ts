import { buildingControlAt } from '../../config/tour'
import { useTour } from '../../core/Director'
import { useApp } from '../../core/store'
import { useBuilding } from './buildingStore'
import { ARRIVE_AT, PPE_AT, TRUCKS, clockLabel, machineState, sitePlan, truckId, truckPhase, useControl } from './control'

/**
 * Drives the project control clock and posts what Vision AI notices to the
 * ticker while the Project control lens is open. During autoplay it opens the
 * lens part way through the Building stop of the tour.
 */

const ticker = (level: 'info' | 'ok' | 'alert', text: string) => useApp.getState().pushTicker({ level, text })

let idleSince: number | null = null

export function controlTick(dt: number) {
  const before = useControl.getState()
  before.advance(dt)
  const after = useControl.getState()
  autoplayLens()
  if (after.lens !== 'control' || after.day !== before.day) {
    if (after.day !== before.day) idleSince = null
    return
  }
  const stage = useBuilding.getState().stage
  const plan = sitePlan(stage)
  if (!plan) return
  const m0 = before.minute
  const m1 = after.minute

  // A trip is logged when a truck reaches the stockyard.
  for (let j = 0; j < TRUCKS; j++) {
    const p0 = truckPhase(stage, j, m0)
    const p1 = truckPhase(stage, j, m1)
    if (p0 !== null && p1 !== null && p0 < ARRIVE_AT && p1 >= ARRIVE_AT) {
      ticker('info', `Photon · gate cam: ${truckId(j)} inbound, ${plan.material.split(',')[0]}, challan matched`)
    }
  }

  if (m0 < PPE_AT && m1 >= PPE_AT) ticker('alert', `Photon: no helmet, ${plan.crews[0].name.toLowerCase()} crew, ${clockLabel(m1)}`)

  // An idle machine is flagged after 30 site minutes.
  const st = machineState(stage, m1, after.day)
  if (st === 'idle') {
    if (idleSince === null) idleSince = m1
    else if (m1 - idleSince >= 30 && m0 - idleSince < 30) ticker('alert', `${plan.hire.machine} idle 30 min, engine on`)
  } else idleSince = null
}

let lastScene = ''
let switched = false
function autoplayLens() {
  const app = useApp.getState()
  if (app.scene !== lastScene) {
    lastScene = app.scene
    switched = false
    if (app.autoplay && app.scene === 'building') useControl.getState().setLens('quality')
  }
  if (!app.autoplay || app.scene !== 'building' || switched) return
  if (useTour.getState().progress >= buildingControlAt) {
    switched = true
    useControl.getState().setLens('control')
    ticker('info', 'Project control view: crews, machines, hire, trips')
  }
}
