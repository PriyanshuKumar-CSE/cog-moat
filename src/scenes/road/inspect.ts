import { useApp } from '../../core/store'
import { iesKeyOrder, verifyIesHash, type IesRecord } from '../../sim/ies'
import { roadLedger, type RoadEntry } from './roadStore'

/** Opens an IES record in the inspector with its hash re-checked. */
export function inspectRecord(title: string, subtitle: string, record: IesRecord) {
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

/** Opens a ledger block (and the certificate inside it) with every check recomputed. */
export function inspectBlock(entry: RoadEntry) {
  const v = roadLedger.verify(entry.block, entry.payload)
  const sub = {
    settlement: 'Settlement. Certificate inside.',
    rejection: 'Rejection. Recorded, not settled.',
    hold: 'Hold. Recorded, not settled.',
  }[entry.payload.type]
  useApp.getState().setInspect({
    title: entry.payload.certificate ? `Certificate · ledger block #${entry.block.seq}` : `Ledger block #${entry.block.seq}`,
    subtitle: sub,
    data: { block: entry.block, payload: entry.payload },
    checks: [
      { label: 'Payload hash matches', ok: v.payloadHashOk },
      { label: 'Block hash recomputed', ok: v.blockHashOk },
      { label: 'Linked to previous block', ok: v.linkOk },
      { label: 'Ed25519 signature valid', ok: v.signatureOk },
    ],
  })
}

export function setCursor(on: boolean) {
  document.body.style.cursor = on ? 'pointer' : ''
}
