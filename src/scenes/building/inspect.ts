import { useApp } from '../../core/store'
import { buildingLedger, type BuildingEntry } from './buildingStore'

export { inspectRecord, setCursor } from '../road/inspect'

/** Opens a ledger block (and the certificate or work order inside it) with every check recomputed. */
export function inspectBlock(entry: BuildingEntry) {
  const v = buildingLedger.verify(entry.block, entry.payload)
  const sub = {
    settlement: 'Settlement. Milestone certificate inside.',
    work_order: 'Work order. Inspection raised.',
    rejection: 'Rejection. Recorded, not settled.',
    hold: 'Hold. Recorded, not settled.',
  }[entry.payload.type]
  const title = entry.payload.certificate
    ? `Certificate · ledger block #${entry.block.seq}`
    : entry.payload.work_order
      ? `Work order · ledger block #${entry.block.seq}`
      : `Ledger block #${entry.block.seq}`
  useApp.getState().setInspect({
    title,
    subtitle: `${entry.milestone} · ${sub}`,
    data: { block: entry.block, payload: entry.payload },
    checks: [
      { label: 'Payload hash matches', ok: v.payloadHashOk },
      { label: 'Block hash recomputed', ok: v.blockHashOk },
      { label: 'Linked to previous block', ok: v.linkOk },
      { label: 'Ed25519 signature valid', ok: v.signatureOk },
    ],
  })
}
