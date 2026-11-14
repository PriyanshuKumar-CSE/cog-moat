import { useCallback } from 'react'
import { useFact } from '../../core/store'
import { ApprovalCard } from '../../hud/ApprovalCard'
import { Panel } from '../../hud/Panel'
import { Bar, CheckRow, Chip, Divider, Gauge, KV, Sparkline, Stat } from '../../hud/widgets'
import { inspectBlock, inspectClearing, inspectFire } from './ForestStage'
import { approvalCopy, approverRole, cellName, outcomeWord, spec, useForest, type LedgerEntry } from './forestStore'

export function ForestHud() {
  const phase = useForest((s) => s.phase)
  return (
    <>
      <HealthPanel />
      <AlertsPanel />
      <VerifyPanel />
      {phase === 'approve' && <Approval />}
      <div className="hint">Click the hotspot or the clearing to open its IES record · drag to orbit</div>
    </>
  )
}

const distLabels = ['Dense ≥ 0.70', 'Moderate 0.50-0.70', 'Sparse 0.30-0.50', 'Cleared < 0.30']

function HealthPanel() {
  const health = useForest((s) => s.health)
  const history = useForest((s) => s.history)
  const pass = useForest((s) => s.pass)
  const prev = history[history.length - 2] ?? health.meanNdvi
  const delta = health.meanNdvi - prev
  return (
    <Panel title="Canopy health" tag={`pass ${pass}`} anchor={{ top: 92, left: 216 }} width={330} testId="forest-health">
      <div className="forest-health__top">
        <Gauge value={health.healthyPct} label="healthy" size={86} />
        <div className="forest-health__stats">
          <Stat label="Canopy index" value={health.meanNdvi.toFixed(2)} unit="NDVI-like" />
          <div className="forest-health__delta mono">
            {delta >= 0 ? '+' : ''}
            {delta.toFixed(3)} vs last pass · {health.cells} cells in boundary
          </div>
        </div>
      </div>

      <Divider label="Distribution" />
      {health.dist.map((v, k) => (
        <Bar key={k} value={v} label={distLabels[k]} right={`${Math.round(v * 100)}%`} tone={k === 3 && v > 0 ? 'alert' : undefined} />
      ))}

      <Divider label="Canopy index, last 24 passes" />
      <Sparkline values={history} width={296} height={38} />

      <div className="forest-legend">
        <span className="forest-legend__ramp" />
        <span className="forest-legend__ends mono">
          <span>sparse</span>
          <span>dense</span>
        </span>
        <span className="forest-legend__alert mono">amber / red = alerts only</span>
      </div>
    </Panel>
  )
}

function AlertsPanel() {
  const phase = useForest((s) => s.phase)
  const frames = useForest((s) => s.frames)
  const confidence = useForest((s) => s.confidence)
  const hotspot = useForest((s) => s.hotspot)
  const fire = useForest((s) => s.fire)
  const clearingRec = useForest((s) => s.clearingRec)
  const areaHa = useForest((s) => s.areaHa)
  const changePct = useForest((s) => s.changePct)
  const decision = useForest((s) => s.decision)
  const fireOn = phase !== 'scan' && frames > 0
  const count = (fireOn ? 1 : 0) + (clearingRec ? 1 : 0)

  let fireStatus = frames >= 2 ? 'persistence rule met' : 'watching next frame'
  let fireTone: 'alert' | 'ok' | 'warn' = 'alert'
  if (decision?.action === 'accept') {
    fireStatus = 'under response · patrol dispatched'
    fireTone = 'ok'
  } else if (decision?.action === 'reject') {
    fireStatus = `not dispatched · ${decision.reason}`
    fireTone = 'warn'
  } else if (decision?.action === 'modify') {
    fireStatus = 'second pass requested'
    fireTone = 'warn'
  } else if (phase === 'approve') fireStatus = `awaiting ${approverRole}`

  return (
    <Panel
      title="Alerts"
      tag={<Chip tone={count ? 'alert' : 'dim'}>{count ? `${count} ACTIVE` : 'CLEAR'}</Chip>}
      anchor={{ top: 92, right: 24 }}
      width={360}
      testId="forest-alerts"
    >
      {!fireOn && !clearingRec && <div className="forest-alerts__empty">Aerial pass in progress. No active alerts.</div>}
      {fireOn && (
        <button className="forest-alert" onClick={inspectFire} data-testid="forest-alert-fire">
          <div className="forest-alert__head">
            <Chip tone={fireTone}>FIRE</Chip>
            <span className="forest-alert__title">Thermal hotspot · cell {cellName(hotspot)}</span>
            <span className="forest-alert__json mono">JSON</span>
          </div>
          <Bar value={confidence} label={`frames ${frames} (≥ 2 needed)`} right={`conf ${confidence.toFixed(2)}`} tone={confidence >= 0.85 ? undefined : 'warn'} />
          <div className="forest-alert__sub mono">{fire ? 'IES detection · lineage → thermal frames + weather' : 'IES thermal capture · detection pending'}</div>
          <div className={`forest-alert__status forest-alert__status--${fireTone} mono`}>{fireStatus}</div>
        </button>
      )}
      {clearingRec && (
        <button className="forest-alert" onClick={inspectClearing} data-testid="forest-alert-clearing">
          <div className="forest-alert__head">
            <Chip tone="alert">ENCROACHMENT</Chip>
            <span className="forest-alert__title">Canopy loss · boundary edge</span>
            <span className="forest-alert__json mono">JSON</span>
          </div>
          <div className="forest-alert__kv">
            <KV k="area" v={`${areaHa} ha`} />
            <KV k="vs baseline" v={`${changePct}%`} />
          </div>
          <div className="forest-alert__sub mono">IES detection · lineage → canopy frame</div>
          <div className="forest-alert__status forest-alert__status--warn mono">logged for review · no action without approval</div>
        </button>
      )}
    </Panel>
  )
}

function VerifyPanel() {
  const phase = useForest((s) => s.phase)
  const verifyStep = useForest((s) => s.verifyStep)
  const decision = useForest((s) => s.decision)
  const entry = useForest((s) => s.entry)
  const entries = useForest((s) => s.entries)
  const vlm = useFact('vlmLabel')
  const started = phase === 'verify' || phase === 'approve' || phase === 'respond'

  const stages = [
    `${spec.verifierChain[0]} · ≥ 2 frames, inside boundary, conf ≥ 0.85`,
    `${spec.verifierChain[1]} · frame checked by ${vlm ?? 'VLM verifier'}`,
    spec.verifierChain[2],
  ]

  return (
    <Panel title="Verification" tag={spec.draft ? 'spec draft' : undefined} anchor={{ bottom: 44, right: 24 }} width={360} testId="forest-verify">
      {stages.map((label, i) => {
        let state: 'pass' | 'pending' | 'active' | 'fail' = 'pending'
        if (i < 2) {
          if (started) state = i < verifyStep ? 'pass' : i === verifyStep ? 'active' : 'pending'
        } else if (decision) state = decision.action === 'reject' ? 'fail' : 'pass'
        else if (phase === 'approve') state = 'active'
        return (
          <CheckRow key={i} state={state}>
            {label}
          </CheckRow>
        )
      })}

      <Divider label="Completion spec" />
      <KV k="spec" v={spec.id} />
      <KV k="settles" v={spec.settles} mono={false} />

      {decision && entry && (
        <div className={`event__settle ${decision.action === 'accept' ? '' : 'is-reject'}`} data-testid="forest-outcome">
          <div className="event__settle-title">{outcomeWord(decision.action)}</div>
          <div className="mono event__settle-id">
            {decision.simulated ? `${approverRole} (simulated)` : approverRole} · {decision.action}
            {decision.reason && decision.action === 'reject' ? ` · ${decision.reason}` : ''}
          </div>
        </div>
      )}

      <Divider label="Incident ledger" />
      {entries
        .slice(-3)
        .reverse()
        .map((e) => (
          <LedgerRow key={e.block.seq} e={e} />
        ))}
    </Panel>
  )
}

function LedgerRow({ e }: { e: LedgerEntry }) {
  const t = e.payload.type
  return (
    <button className="ledger-row" onClick={() => inspectBlock(e)}>
      <span className="mono ledger-row__seq">#{e.block.seq}</span>
      <span className="mono ledger-row__hash">{e.block.hash.slice(0, 14)}…</span>
      <Chip tone={t === 'patrol_dispatch' ? 'ok' : 'warn'}>{t === 'patrol_dispatch' ? 'DISPATCHED' : t === 'rejection' ? 'REJECTED' : 'SECOND PASS'}</Chip>
    </button>
  )
}

function Approval() {
  const id = useForest((s) => s.incidentId)
  const hotspot = useForest((s) => s.hotspot)
  const frames = useForest((s) => s.frames)
  const confidence = useForest((s) => s.confidence)
  const decide = useForest((s) => s.decide)
  const onDecide = useCallback(
    (a: Parameters<typeof decide>[0], r: Parameters<typeof decide>[1], m: Parameters<typeof decide>[2], sim: boolean) => decide(a, r, m, sim),
    [decide],
  )
  return (
    <ApprovalCard decisionKey={id} title={approvalCopy.title} approverRole={approverRole} modifyOptions={approvalCopy.modify} onDecide={onDecide}>
      Hotspot in cell {cellName(hotspot)} persists {frames} frames inside the boundary, confidence {confidence.toFixed(2)}. Confirm incident and
      dispatch patrol?
    </ApprovalCard>
  )
}
