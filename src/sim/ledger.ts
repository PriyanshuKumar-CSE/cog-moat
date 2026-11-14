import * as ed from '@noble/ed25519'
import { sha256, sha512 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'
import { canonicalJson } from './canonical'

// Enable synchronous signing.
ed.hashes.sha512 = sha512

/**
 * Event Ledger: an append-only hash chain.
 * Each block commits to the previous block hash and to the payload hash,
 * and is signed with Ed25519. A daily anchor commits to all block hashes of the day.
 *
 * The cryptography is real; the key is a fixed demo key and the data is simulated.
 */

export interface LedgerBlock {
  ledger: string
  seq: number
  prev_hash: string
  payload_hash: string
  sealed_at: string
  hash: string
  signature: string
  key_id: string
}

export interface BlockVerification {
  payloadHashOk: boolean
  blockHashOk: boolean
  linkOk: boolean
  signatureOk: boolean
}

const GENESIS = '0'.repeat(64)

const demoSecret = sha256(utf8ToBytes('cognecto-living-model/demo-ledger-key/not-for-production'))
const demoPublic = ed.getPublicKey(demoSecret)

export const demoKey = {
  publicKeyHex: bytesToHex(demoPublic),
  keyId: `ed25519:${bytesToHex(demoPublic).slice(0, 16)}`,
}

export const hashHex = (s: string) => bytesToHex(sha256(utf8ToBytes(s)))

export const payloadHash = (payload: unknown) => hashHex(canonicalJson(payload))

function blockHeader(b: Omit<LedgerBlock, 'hash' | 'signature' | 'key_id'>) {
  return canonicalJson({
    ledger: b.ledger,
    seq: b.seq,
    prev_hash: b.prev_hash,
    payload_hash: b.payload_hash,
    sealed_at: b.sealed_at,
  })
}

export class Ledger {
  readonly name: string
  private blocks: LedgerBlock[] = []

  constructor(name: string) {
    this.name = name
  }

  get length() {
    return this.blocks.length
  }

  get head(): LedgerBlock | undefined {
    return this.blocks[this.blocks.length - 1]
  }

  all(): readonly LedgerBlock[] {
    return this.blocks
  }

  append(payload: unknown, sealedAt: Date): LedgerBlock {
    const base = {
      ledger: this.name,
      seq: this.blocks.length,
      prev_hash: this.head?.hash ?? GENESIS,
      payload_hash: payloadHash(payload),
      sealed_at: sealedAt.toISOString(),
    }
    const hash = hashHex(blockHeader(base))
    const signature = bytesToHex(ed.sign(hexToBytes(hash), demoSecret))
    const block: LedgerBlock = { ...base, hash, signature, key_id: demoKey.keyId }
    this.blocks.push(block)
    return block
  }

  /** Recomputes every check for one block. */
  verify(block: LedgerBlock, payload: unknown): BlockVerification {
    const prev = block.seq === 0 ? undefined : this.blocks[block.seq - 1]
    const expectedPrev = prev?.hash ?? GENESIS
    const recomputed = hashHex(blockHeader(block))
    let signatureOk = false
    try {
      signatureOk = ed.verify(hexToBytes(block.signature), hexToBytes(block.hash), demoPublic)
    } catch {
      signatureOk = false
    }
    return {
      payloadHashOk: payloadHash(payload) === block.payload_hash,
      blockHashOk: recomputed === block.hash,
      linkOk: block.prev_hash === expectedPrev,
      signatureOk,
    }
  }

  /** Merkle root over block hashes sealed on a given UTC day (YYYY-MM-DD). */
  dailyAnchor(day: string): { day: string; root: string; count: number } {
    const leaves = this.blocks.filter((b) => b.sealed_at.startsWith(day)).map((b) => b.hash)
    return { day, root: merkleRoot(leaves), count: leaves.length }
  }
}

export function merkleRoot(leaves: string[]): string {
  if (leaves.length === 0) return GENESIS
  let level = leaves
  while (level.length > 1) {
    const next: string[] = []
    for (let i = 0; i < level.length; i += 2) {
      const right = level[i + 1] ?? level[i]
      next.push(hashHex(level[i] + right))
    }
    level = next
  }
  return level[0]
}
