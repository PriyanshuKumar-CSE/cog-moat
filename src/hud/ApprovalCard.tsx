import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useApp } from '../core/store'
import type { HumanAction, ReasonCode } from '../sim/loopCase'

export interface ModifyOption {
  id: string
  label: string
}

interface Props {
  /** Unique key for the pending decision; resets the card when it changes. */
  decisionKey: string
  title: string
  approverRole: string
  children: ReactNode
  modifyOptions?: ModifyOption[]
  /** Called once with the human decision. */
  onDecide: (action: HumanAction, reason: ReasonCode | null, modifyId: string | null, simulated: boolean) => void
}

const REASONS: ReasonCode[] = ['weather', 'safety', 'operator', 'equipment', 'other']

/**
 * Human-in-the-loop gate. Nothing moves until a person decides.
 * In timed mode a clearly labelled simulated approver accepts after a countdown,
 * so unattended demos keep moving. Any click cancels the countdown.
 */
export function ApprovalCard({ decisionKey, title, approverRole, children, modifyOptions, onDecide }: Props) {
  const mode = useApp((s) => s.approvalMode)
  const autoplay = useApp((s) => s.autoplay)
  const waitMs = autoplay ? 3200 : 9000
  const [stage, setStage] = useState<'ask' | 'reject' | 'modify'>('ask')
  const [manual, setManual] = useState(false)
  const [left, setLeft] = useState(waitMs)
  const decided = useRef(false)

  useEffect(() => {
    decided.current = false
    setStage('ask')
    setManual(false)
    setLeft(waitMs)
  }, [decisionKey, waitMs])

  const timed = mode === 'timed' && !manual

  useEffect(() => {
    if (!timed) return
    const started = performance.now()
    const id = window.setInterval(() => {
      const remaining = waitMs - (performance.now() - started)
      setLeft(Math.max(0, remaining))
      if (remaining <= 0 && !decided.current) {
        decided.current = true
        window.clearInterval(id)
        onDecide('accept', null, null, true)
      }
    }, 100)
    return () => window.clearInterval(id)
  }, [timed, waitMs, decisionKey, onDecide])

  const decide = (action: HumanAction, reason: ReasonCode | null, modifyId: string | null) => {
    if (decided.current) return
    decided.current = true
    onDecide(action, reason, modifyId, false)
  }

  return (
    <div className="approval" data-testid="approval-card" onPointerDown={() => setManual(true)}>
      <div className="approval__head">
        <span className="approval__badge">HUMAN APPROVAL REQUIRED</span>
        <span className="approval__role">Approver: {approverRole}</span>
      </div>
      <div className="approval__title">{title}</div>
      <div className="approval__body">{children}</div>

      {stage === 'ask' && (
        <div className="approval__actions">
          <button className="btn btn--ok" onClick={() => decide('accept', null, null)}>
            Accept
          </button>
          <button className="btn btn--alert" onClick={() => setStage('reject')}>
            Reject
          </button>
          {modifyOptions && modifyOptions.length > 0 && (
            <button className="btn" onClick={() => setStage('modify')}>
              Modify
            </button>
          )}
        </div>
      )}
      {stage === 'reject' && (
        <div className="approval__actions approval__actions--wrap">
          <span className="approval__prompt">Reason code</span>
          {REASONS.map((r) => (
            <button key={r} className="btn btn--small" onClick={() => decide('reject', r, null)}>
              {r}
            </button>
          ))}
        </div>
      )}
      {stage === 'modify' && (
        <div className="approval__actions approval__actions--wrap">
          {modifyOptions?.map((o) => (
            <button key={o.id} className="btn btn--small" onClick={() => decide('modify', 'other', o.id)}>
              {o.label}
            </button>
          ))}
        </div>
      )}

      <div className="approval__foot">
        {timed ? (
          <>
            <div className="approval__timer">
              <div style={{ width: `${(left / waitMs) * 100}%` }} />
            </div>
            <span>Simulated approver accepts in {Math.ceil(left / 1000)}s. Click to decide yourself.</span>
          </>
        ) : (
          <span>Waiting for {approverRole}.</span>
        )}
      </div>
    </div>
  )
}
