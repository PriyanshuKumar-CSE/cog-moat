import { sha256 } from '@noble/hashes/sha2.js'
import { utf8ToBytes } from '@noble/hashes/utils.js'
import { canonicalJson } from './canonical'

/**
 * IES (Infrastructure Event Schema) observation record, as defined by Cognecto.
 *
 * Who sets each key:
 *  - sender:   origin_id, sense, kind, claim, scope_ref, occurred_at, lineage,
 *              sequence, prev_hash, hash
 *  - ingest:   customer_id, log_position, observation_id, believed_at, arrived_at
 *  - database: subject_ref (copied from claim.subject_ref)
 *
 * Hash chain is per Origin: `prev_hash` is the hash of that Origin's previous
 * event, and `hash` is SHA-256 (base64) of this event, so it commits to the
 * whole history before it.
 */
export interface IesRecord {
  customer_id: string
  log_position: number
  observation_id: string
  origin_id: string
  sense: Record<string, unknown>
  kind: IesKind
  claim: Record<string, unknown> & { subject_ref?: string | null }
  scope_ref: string
  occurred_at: string
  believed_at: string
  arrived_at: string
  lineage: IesLineage | null
  sequence: number
  prev_hash: string
  hash: string
  subject_ref: string | null
}

export interface IesLineage {
  input: string[]
  method: string
  version: string
  config: Record<string, unknown>
}

/**
 * Claim kinds. IES defines 8; only "detection" has been confirmed so far.
 * The others used by the simulation are marked as drafts until the full list
 * (IES section 3) is provided. Edit here.
 */
export const iesKinds = {
  detection: { confirmed: true },
  measurement: { confirmed: false },
  verification: { confirmed: false },
} as const

export type IesKind = keyof typeof iesKinds

/** Fields the sender signs over with `hash`. */
type SenderFields = Pick<
  IesRecord,
  'origin_id' | 'sense' | 'kind' | 'claim' | 'scope_ref' | 'occurred_at' | 'lineage' | 'sequence' | 'prev_hash'
>

const toBase64 = (bytes: Uint8Array) => {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

export const iesHash = (fields: SenderFields) => toBase64(sha256(utf8ToBytes(canonicalJson(fields))))

/** Base64 of 32 zero bytes: the prev_hash of an Origin's first event. */
export const IES_GENESIS = toBase64(new Uint8Array(32))

/** Tracks per-origin counters and chain heads, like a sender would. */
export class OriginChains {
  private heads = new Map<string, { sequence: number; hash: string }>()

  next(origin: string) {
    const head = this.heads.get(origin)
    return { sequence: (head?.sequence ?? 0) + 1, prev_hash: head?.hash ?? IES_GENESIS }
  }

  commit(origin: string, sequence: number, hash: string) {
    this.heads.set(origin, { sequence, hash })
  }
}

export interface SenderInput {
  origin_id: string
  sense: Record<string, unknown>
  kind: IesKind
  claim: IesRecord['claim']
  scope_ref: string
  occurred_at: Date
  lineage: IesLineage | null
}

export interface IngestInput {
  customer_id: string
  log_position: number
  observation_id: string
  arrived_at: Date
  believed_at: Date
}

/** Builds a complete record: sender fields + chain link + ingest fields. */
export function buildIes(chains: OriginChains, s: SenderInput, i: IngestInput): IesRecord {
  const { sequence, prev_hash } = chains.next(s.origin_id)
  const sender: SenderFields = {
    origin_id: s.origin_id,
    sense: s.sense,
    kind: s.kind,
    claim: s.claim,
    scope_ref: s.scope_ref,
    occurred_at: s.occurred_at.toISOString(),
    lineage: s.lineage,
    sequence,
    prev_hash,
  }
  const hash = iesHash(sender)
  chains.commit(s.origin_id, sequence, hash)
  return {
    customer_id: i.customer_id,
    log_position: i.log_position,
    observation_id: i.observation_id,
    ...sender,
    believed_at: i.believed_at.toISOString(),
    arrived_at: i.arrived_at.toISOString(),
    hash,
    subject_ref: s.claim.subject_ref ?? null,
  }
}

/** Recomputes the sender hash of a record. */
export function verifyIesHash(r: IesRecord): boolean {
  const { origin_id, sense, kind, claim, scope_ref, occurred_at, lineage, sequence, prev_hash } = r
  return iesHash({ origin_id, sense, kind, claim, scope_ref, occurred_at, lineage, sequence, prev_hash }) === r.hash
}

/** Key order used when displaying a record, matching the IES table. */
export const iesKeyOrder: (keyof IesRecord)[] = [
  'customer_id',
  'log_position',
  'observation_id',
  'origin_id',
  'sense',
  'kind',
  'claim',
  'scope_ref',
  'occurred_at',
  'believed_at',
  'arrived_at',
  'lineage',
  'sequence',
  'prev_hash',
  'hash',
  'subject_ref',
]
