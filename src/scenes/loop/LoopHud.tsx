import { useCallback } from 'react'
import { loopSteps } from '../../config/content'
import { usePlaceName, useFact } from '../../core/store'
import { ApprovalCard } from '../../hud/ApprovalCard'
import { Panel } from '../../hud/Panel'
import { CheckRow, Chip, Divider, KV } from '../../hud/widgets'
import { demoKey } from '../../sim/ledger'
import { iesKinds } from '../../sim/ies'
import { LearnDrill, SchedulerDrill } from './Drills'
import { inspectBlock, inspectRecord } from './LoopStage'
import { approvalCopy, eventLedger, phaseSeconds, phaseStep, settleWord, useLoop } from './loopStore'

export function LoopHud() {
  const phase = useLoop((s) => s.phase)
  const drill = useLoop((s) => s.drill)
  return (
    <>
      <StepsPanel />
      <EventPanel />
      <LedgerPanel />
      {phase === 'approve' && <Approval />}
      {drill === 'schedule' && <SchedulerDrill />}
      {drill === 'learn' && <LearnDrill />}
    </>
  )
}

function StepsPanel() {
  const phase = useLoop((s) => s.phase)
  const setDrill = useLoop((s) => s.setDrill)
  const tagline = useFact('tagline')
  const activeId = phaseStep[phase]
  const activeIdx = loopSteps.findIndex((s) => s.id === activeId)
  const active = loopSteps[activeIdx]
  return (
    <Panel title="The loop" tag="6 steps" anchor={{ top: 92, left: 216 }} width={330} testId="loop-steps">
      <div className="steps">
        {loopSteps.map((s, i) => (
          <div key={s.id} className={`steps__row ${i === activeIdx ? 'is-active' : i < activeIdx ? 'is-done' : ''}`}>
            <span className="mono steps__n">{String(i + 1).padStart(2, '0')}</span>
            <span className="steps__title">{s.title}</span>
            {(s.id === 'schedule' || s.id === 'learn') && (
              <button className="btn btn--small steps__open" onClick={() => setDrill(s.id as 'schedule' | 'learn')}>
                open
              </button>
            )}
          </div>
        ))}
      </div>
      <Divider label={phase === 'approve' ? 'human gate' : active.title} />
      <div className="steps__line">{phase === 'approve' ? 'Nothing settles until a person decides.' : active.line}</div>
      <div className="steps__detail">{active.detail}</div>
      {tagline && <div className="steps__tagline">{tagline}</div>}
    </Panel>
  )
}

function EventPanel() {
  const c = useLoop((s) => s.current)
  const phase = useLoop((s) => s.phase)
  const t = useLoop((s) => s.t)
  const decision = useLoop((s) => s.decision)
  const certificate = useLoop((s) => s.certificate)
  const site = usePlaceName(c.siteName)

  const verifyU = phase === 'verify' ? t / phaseSeconds.verify : ['approve', 'settle', 'learn'].includes(phase) ? 1 : 0
  const chain = c.verifierResults
  const reached = Math.floor(verifyU * (chain.length - 1) + 0.0001)
  const sensed = phase !== 'intent'
  const derived = sensed && phase !== 'sense'

  return (
    <Panel title="Live event" tag={<Chip>{c.domain.toUpperCase()}</Chip>} anchor={{ top: 92, right: 24 }} width={380} testId="loop-event">
      <div className="event__headline">{c.headline}</div>
      {site && <div className="event__site">{site}</div>}

      <Divider label="IES observations" />
      <ObsRow label="Capture" sub={`${c.capture.kind} · capture`} on={sensed} onClick={() => inspectRecord('IES record · capture', c.headline, c.capture)} draft={!iesKinds[c.capture.kind].confirmed} />
      <ObsRow label="Derived" sub={`${c.derived.kind} · ${c.schedule.model}`} on={derived} onClick={() => inspectRecord('IES record · derived', c.headline, c.derived)} draft={!iesKinds[c.derived.kind].confirmed} />
      <ObsRow
        label="Human"
        sub={decision ? `verification · ${decision.action}${decision.simulated ? ' (simulated)' : ''}` : `awaiting ${c.approverRole}`}
        on={!!decision}
        onClick={() => decision && inspectRecord('IES record · human verification', c.headline, decision.record)}
        draft={!iesKinds.verification.confirmed}
      />

      <Divider label="Verifier chain" />
      {chain.map((v, i) => {
        const isHuman = i === chain.length - 1
        let state: 'pass' | 'pending' | 'skipped' | 'active' | 'fail' = 'pending'
        if (isHuman) {
          state = decision ? (decision.action === 'reject' ? 'fail' : 'pass') : phase === 'approve' ? 'active' : 'pending'
        } else if (verifyU > 0) {
          state = i < reached || verifyU >= 1 ? (v.result === 'skipped' ? 'skipped' : 'pass') : i === reached ? 'active' : 'pending'
        }
        return (
          <CheckRow key={v.stage} state={state}>
            {v.stage}
            {state === 'skipped' && <span className="muted"> · not needed</span>}
          </CheckRow>
        )
      })}

      <Divider label="Completion spec" />
      <KV k="spec" v={c.spec.id} />
      <KV k="checks" v={c.spec.checks.join('; ')} mono={false} />
      <KV k="settles" v={c.spec.settles} mono={false} />

      {(phase === 'settle' || phase === 'learn') && decision && (
        <div className={`event__settle ${decision.action === 'reject' ? 'is-reject' : ''}`}>
          <div className="event__settle-title">{settleWord(c.domain, decision.action)}</div>
          {certificate && <div className="mono event__settle-id">{certificate.certificate_id}</div>}
        </div>
      )}
    </Panel>
  )
}

function ObsRow({ label, sub, on, onClick, draft }: { label: string; sub: string; on: boolean; onClick: () => void; draft: boolean }) {
  return (
    <button className={`obs ${on ? 'is-on' : ''}`} disabled={!on} onClick={onClick}>
      <span className="obs__dot" />
      <span className="obs__label">{label}</span>
      <span className="obs__sub mono">
        {sub}
        {draft && <span className="obs__draft"> · draft</span>}
      </span>
      <span className="obs__open mono">{on ? 'JSON' : ''}</span>
    </button>
  )
}

function LedgerPanel() {
  const entries = useLoop((s) => s.entries)
  const yesterday = new Date(Date.now() - 86400_000).toISOString().slice(0, 10)
  const anchor = eventLedger.dailyAnchor(yesterday)
  return (
    <Panel title="Event ledger" tag={`${eventLedger.length} blocks`} anchor={{ bottom: 44, right: 24 }} width={380} testId="loop-ledger">
      {entries
        .slice(-5)
        .reverse()
        .map((e) => (
          <button key={e.block.seq} className="ledger-row" onClick={() => inspectBlock(e)}>
            <span className="mono ledger-row__seq">#{e.block.seq}</span>
            <span className="mono ledger-row__hash">{e.block.hash.slice(0, 18)}…</span>
            <Chip tone={e.payload.type === 'rejection' ? 'warn' : 'ok'}>{e.payload.type === 'rejection' ? 'REJECTED' : 'SETTLED'}</Chip>
          </button>
        ))}
      <Divider label="Daily anchor" />
      <KV k={anchor.day} v={`${anchor.root.slice(0, 20)}… (${anchor.count})`} />
      <KV k="signing key" v={`${demoKey.keyId} (demo)`} />
    </Panel>
  )
}

function Approval() {
  const c = useLoop((s) => s.current)
  const decide = useLoop((s) => s.decide)
  const copy = approvalCopy[c.domain]
  const onDecide = useCallback(
    (a: Parameters<typeof decide>[0], r: Parameters<typeof decide>[1], m: Parameters<typeof decide>[2], sim: boolean) => decide(a, r, m, sim),
    [decide],
  )
  return (
    <ApprovalCard decisionKey={c.id} title={copy.title} approverRole={c.approverRole} modifyOptions={copy.modify} onDecide={onDecide}>
      {copy.ask}
    </ApprovalCard>
  )
}
