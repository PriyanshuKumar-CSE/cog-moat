import { useCallback } from 'react'
import { usePlaceName } from '../../core/store'
import { ApprovalCard } from '../../hud/ApprovalCard'
import { Panel } from '../../hud/Panel'
import { Bar, CheckRow, Chip, Divider, KV, Sparkline, Stat } from '../../hud/widgets'
import { iesKinds } from '../../sim/ies'
import { demoKey } from '../../sim/ledger'
import { DMA_COUNT, brandNames, network } from './network'
import { inspectBlock, inspectRecord } from './WaterStage'
import {
  APPROVER,
  NIGHT_WINDOW,
  NRW_THRESHOLD,
  dmaLabel,
  entryChip,
  entryWord,
  phaseLine,
  phaseStep,
  siteName,
  spec,
  steps,
  useWater,
  waterLedger,
  type Phase,
} from './waterStore'

const phaseOrder: Phase[] = ['flow', 'balance', 'leak', 'detect', 'approve', 'write', 'reset']
const atLeast = (phase: Phase, ref: Phase) => phaseOrder.indexOf(phase) >= phaseOrder.indexOf(ref)
const pct = (x: number) => `${(x * 100).toFixed(1)}%`
const brandCounts = [0, 1, 2].map((b) => network.meters.filter((m) => m.brand === b).length)

export function WaterHud() {
  const phase = useWater((s) => s.phase)
  return (
    <>
      <NetworkPanel />
      <AnomalyPanel />
      <LedgerPanel />
      {phase === 'approve' && <Approval />}
    </>
  )
}

function NetworkPanel() {
  const phase = useWater((s) => s.phase)
  const sample = useWater((s) => s.sample)
  const c = useWater((s) => s.current)
  const site = usePlaceName(siteName)
  const activeStep = steps.findIndex((s) => s.id === phaseStep[phase])
  const inflow = sample.inflow.reduce((a, b) => a + b, 0)
  const billed = sample.billed.reduce((a, b) => a + b, 0)
  const nrw = (inflow - billed) / inflow
  const leakNrw = sample.nrw[c.dma]
  const over = leakNrw > NRW_THRESHOLD
  const tonight = sample.mnf[sample.mnf.length - 1]
  const baseline = sample.mnf.slice(0, -1).reduce((a, b) => a + b, 0) / (sample.mnf.length - 1)

  return (
    <Panel title="Water network" tag="3 DMAs · live" anchor={{ top: 92, left: 216 }} width={340} testId="water-network">
      {site && <div className="event__site">{site}</div>}
      <div className="wsteps">
        {steps.map((s, i) => (
          <div key={s.id} className={`wsteps__item ${i === activeStep ? 'is-active' : i < activeStep ? 'is-done' : ''} ${s.id === 'approve' && phase === 'approve' ? 'is-gate' : ''}`}>
            <span className="wsteps__bar" />
            <span className="wsteps__label">{s.title}</span>
          </div>
        ))}
      </div>
      <div className="wline">{phaseLine[phase]}</div>

      <div className="wstats">
        <Stat label="Inflow" value={inflow.toFixed(1)} unit="m³/h" />
        <Stat label="Billed" value={billed.toFixed(1)} unit="m³/h" />
        <Stat label="NRW" value={(nrw * 100).toFixed(1)} unit="%" tone={nrw > NRW_THRESHOLD ? 'alert' : undefined} />
      </div>

      <Divider label={`Night flow · ${dmaLabel(c.dma)} · 14 nights`} />
      <div className="wspark">
        <Sparkline values={sample.mnf} width={308} height={40} tone={tonight > baseline * 1.25 ? 'alert' : undefined} />
      </div>
      <div className="wspark__legend mono">
        <span>baseline {baseline.toFixed(1)} m³/h</span>
        <span className={tonight > baseline * 1.25 ? 'text-warn' : ''}>tonight {tonight.toFixed(1)} m³/h</span>
      </div>

      <Divider label={`DMA balance · ${NIGHT_WINDOW}`} />
      {Array.from({ length: DMA_COUNT }, (_, d) => {
        const n = sample.nrw[d]
        const alert = d === c.dma && n > NRW_THRESHOLD
        return (
          <div key={d} className="wbal">
            <Bar
              value={n / 0.3}
              tone={alert ? 'alert' : undefined}
              label={`${dmaLabel(d)} · in ${sample.inflow[d].toFixed(1)} / billed ${sample.billed[d].toFixed(1)}`}
              right={<span className={alert ? 'text-warn' : ''}>NRW {pct(n)}</span>}
            />
            <i className="wbal__mark" style={{ left: `${(NRW_THRESHOLD / 0.3) * 100}%` }} />
          </div>
        )
      })}
      <div className="wbal__note mono">
        threshold {NRW_THRESHOLD * 100}% {over ? <span className="text-warn">· {dmaLabel(c.dma)} over</span> : '· all within'}
      </div>

      <Divider label="Meters · Boson hears any brand" />
      <div className="wlegend">
        {brandNames.map((b, k) => (
          <div key={b} className="wlegend__row">
            <i className={`wglyph wglyph--${k}`} />
            <span>Meter ({b})</span>
            <span className="mono wlegend__n">{brandCounts[k]}</span>
          </div>
        ))}
        <div className="wlegend__row">
          <i className="wglyph wglyph--inlet" />
          <span>Bulk inlet meter</span>
          <span className="mono wlegend__n">{DMA_COUNT}</span>
        </div>
        <div className="wlegend__row">
          <i className="wglyph wglyph--logger" />
          <span>Pressure logger</span>
          <span className="mono wlegend__n">{network.loggers.length}</span>
        </div>
      </div>
    </Panel>
  )
}

function AnomalyPanel() {
  const phase = useWater((s) => s.phase)
  const u = useWater((s) => s.sample.u)
  const c = useWater((s) => s.current)
  const decision = useWater((s) => s.decision)
  const entries = useWater((s) => s.entries)
  const alert = phase === 'leak' || phase === 'detect' || phase === 'approve'
  const written = (phase === 'write' || phase === 'reset') && decision ? entries[entries.length - 1] : null
  const detectU = phase === 'detect' ? u : atLeast(phase, 'approve') ? 1 : 0

  const headline =
    phase === 'flow'
      ? 'All DMAs within NRW threshold'
      : phase === 'balance'
        ? 'Balance check running'
        : phase === 'leak'
          ? `${dmaLabel(c.dma)} drifting above threshold`
          : c.headline

  const tag = alert ? (
    <Chip tone="alert">ALERT</Chip>
  ) : written ? (
    <Chip tone={entryChip[written.payload.type].tone}>{entryChip[written.payload.type].label}</Chip>
  ) : (
    <Chip tone="dim">MONITORING</Chip>
  )

  const stage = (from: number, to: number): 'pass' | 'active' | 'pending' => (detectU >= to ? 'pass' : detectU >= from ? 'active' : 'pending')
  const crew: 'active' | 'skipped' | 'pending' = decision?.action === 'modify' ? 'active' : decision ? 'skipped' : 'pending'
  const human: 'pass' | 'fail' | 'active' | 'pending' = decision ? (decision.action === 'reject' ? 'fail' : 'pass') : phase === 'approve' ? 'active' : 'pending'

  return (
    <Panel title="Anomaly" tag={tag} tone={alert ? 'alert' : 'default'} anchor={{ top: 92, right: 24 }} width={360} testId="water-anomaly">
      <div className="event__headline">{headline}</div>
      <div className="event__site">{spec.title} · spec draft</div>

      <Divider label="IES observations" />
      <ObsRow label="Inlet" sub="measurement · bulk meter" on={atLeast(phase, 'balance')} onClick={() => inspectRecord('IES record · inlet meter', c.headline, c.inlet)} draft={!iesKinds.measurement.confirmed} />
      <ObsRow label="Billed" sub="measurement · 12 meters" on={atLeast(phase, 'balance')} onClick={() => inspectRecord('IES record · consumer meters', c.headline, c.consumers)} draft={!iesKinds.measurement.confirmed} />
      <ObsRow label="Pressure" sub={`measurement · PL-${c.dma + 1}.${c.street + 1}`} on={atLeast(phase, 'detect')} onClick={() => inspectRecord('IES record · pressure log', c.headline, c.pressure)} draft={!iesKinds.measurement.confirmed} />
      <ObsRow label="Detect" sub="detection · dma_balance@v1" on={detectU > 0.1} onClick={() => inspectRecord('IES record · detection', c.headline, c.detection)} draft={!iesKinds.detection.confirmed} />
      <ObsRow
        label="Human"
        sub={decision ? `verification · ${decision.action}${decision.simulated ? ' (simulated)' : ''}` : `awaiting ${APPROVER}`}
        on={!!decision}
        onClick={() => decision && inspectRecord('IES record · human verification', c.headline, decision.record)}
        draft={!iesKinds.verification.confirmed}
      />

      <Divider label="Verifier chain" />
      <CheckRow state={stage(0.02, 0.25)}>{spec.verifierChain[0]}</CheckRow>
      <CheckRow state={stage(0.25, 0.5)}>{spec.verifierChain[1]}</CheckRow>
      <CheckRow state={stage(0.5, 0.85)}>
        Pressure dip localises segment
        {detectU >= 0.85 && <span className="muted"> · {c.segmentRef}</span>}
      </CheckRow>
      <CheckRow state={crew}>
        {spec.verifierChain[2]}
        {crew === 'skipped' && <span className="muted"> · not requested</span>}
        {crew === 'active' && <span className="muted"> · requested</span>}
      </CheckRow>
      <CheckRow state={human}>{APPROVER} approval</CheckRow>

      {written && (
        <div className={`event__settle ${written.payload.type === 'rejection' ? 'is-reject' : ''} ${written.payload.type === 'field-check' ? 'is-hold' : ''}`}>
          <div className="event__settle-title">{entryWord[written.payload.type]}</div>
          <div className="mono event__settle-id">
            Water Ledger #{written.block.seq} · {written.block.hash.slice(0, 16)}…
          </div>
        </div>
      )}
    </Panel>
  )
}

function ObsRow({ label, sub, on, onClick, draft }: { label: string; sub: string; on: boolean; onClick: () => void; draft: boolean }) {
  return (
    <button className={`obs wobs ${on ? 'is-on' : ''}`} disabled={!on} onClick={onClick}>
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
  const entries = useWater((s) => s.entries)
  const yesterday = new Date(Date.now() - 86400_000).toISOString().slice(0, 10)
  const anchor = waterLedger.dailyAnchor(yesterday)
  return (
    <Panel title="Water ledger" tag={`${waterLedger.length} blocks`} anchor={{ bottom: 44, right: 24 }} width={360} testId="water-ledger">
      {entries
        .slice(-4)
        .reverse()
        .map((e) => (
          <button key={e.block.seq} className="ledger-row" onClick={() => inspectBlock(e)}>
            <span className="mono ledger-row__seq">#{e.block.seq}</span>
            <span className="mono ledger-row__hash">{e.block.hash.slice(0, 16)}…</span>
            <Chip tone={entryChip[e.payload.type].tone}>{entryChip[e.payload.type].label}</Chip>
          </button>
        ))}
      <Divider label="Daily anchor" />
      <KV k={anchor.day} v={`${anchor.root.slice(0, 18)}… (${anchor.count})`} />
      <KV k="key" v={`${demoKey.keyId} (demo)`} />
    </Panel>
  )
}

function Approval() {
  const c = useWater((s) => s.current)
  const decide = useWater((s) => s.decide)
  const onDecide = useCallback(
    (a: Parameters<typeof decide>[0], r: Parameters<typeof decide>[1], m: Parameters<typeof decide>[2], sim: boolean) => decide(a, r, m, sim),
    [decide],
  )
  return (
    <ApprovalCard
      decisionKey={c.id}
      title="Confirm NRW anomaly"
      approverRole={APPROVER}
      modifyOptions={[{ id: 'crew', label: 'Send field crew first' }]}
      onDecide={onDecide}
    >
      {`${dmaLabel(c.dma)} night-flow imbalance is above the ${NRW_THRESHOLD * 100}% NRW threshold, and a pressure dip localises segment ${c.segmentRef}. Write the verified loss to the Water Ledger?`}
    </ApprovalCard>
  )
}
