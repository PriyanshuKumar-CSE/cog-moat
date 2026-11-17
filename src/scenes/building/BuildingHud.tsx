import { useCallback } from 'react'
import { useApp, useFact } from '../../core/store'
import { ApprovalCard } from '../../hud/ApprovalCard'
import { Panel } from '../../hud/Panel'
import { CheckRow, Chip, Divider, KV, Sparkline, Stat } from '../../hud/widgets'
import type { IesRecord } from '../../sim/ies'
import { sensorDefs, useBuilding, useShm, type Phase } from './buildingStore'
import { inspectBlock, inspectRecord } from './inspect'
import { MONITORING, builtPct, stages } from './stages'

export function BuildingHud() {
  const phase = useBuilding((s) => s.phase)
  return (
    <>
      <OverviewPanel />
      <HealthPanel />
      <EvidencePanel />
      <CertificatePanel />
      {phase === 'approve' && <Approval />}
    </>
  )
}

/* ------------------------------------------------------------------ */

const steps = ['Scan', 'Plan', 'Verify', 'Sign', 'Ledger', 'Settle']
const monitoringSteps = ['Sense', 'Limits', 'Verify', 'Decide', 'Ledger', 'Order']

function stepIndex(phase: Phase, settled: boolean) {
  return { scan: 0, plan: 1, verify: 2, approve: 3, settle: settled ? 5 : 4, reset: 5 }[phase]
}

function OverviewPanel() {
  const stage = useBuilding((s) => s.stage)
  const phase = useBuilding((s) => s.phase)
  const outcome = useBuilding((s) => s.outcome)
  const decision = useBuilding((s) => s.decision)
  const c = useBuilding((s) => s.current)
  const jump = useBuilding((s) => s.jump)
  const project = useFact('buildingProject')
  const monitoring = stage === MONITORING
  const released = outcome === 'released'
  const pct = builtPct(stage) + (released && !monitoring ? stages[stage].weight : 0)
  const idx = stepIndex(phase, outcome !== 'pending')
  const held = decision && decision.action !== 'accept'

  const line = (() => {
    switch (phase) {
      case 'scan':
        return monitoring ? `Boson hears. ${c.stage.boson}` : `Photon sees. ${c.stage.photon}`
      case 'plan':
        return monitoring ? 'Readings checked against design limits and a 14-day baseline.' : `Boson hears. ${c.stage.boson}`
      case 'verify':
        return 'Nobody self-reports. Rules, an anomaly check, then a VLM re-checks a finding.'
      case 'approve':
        return `Nothing ${monitoring ? 'is ordered' : 'settles'} until the ${c.approverRole} decides.`
      default:
        if (!decision) return ''
        if (held) return outcome === 'pending' ? 'Decision recorded on the ledger. No certificate.' : monitoring ? 'No work order. The gauge stays on watch.' : 'RA bill held. Rework, then the milestone is scanned again.'
        if (monitoring) return outcome === 'pending' ? 'Work order sealed on the Event Ledger.' : 'Inspection ordered. The record shows why, with the readings behind it.'
        return outcome === 'pending' ? 'Milestone certificate minted and sealed on the Event Ledger.' : 'RA bill released against the verified milestone.'
    }
  })()

  return (
    <Panel title="Building" tag={project ?? undefined} anchor={{ top: 92, left: 216 }} width={340} testId="building-overview">
      <div className="bld__head">
        <Stat label="Built, verified" value={`${pct}`} unit="%" tone={pct === 100 ? 'ok' : undefined} />
        <div className="bld__meta">
          <KV k="milestone" v={c.label} mono={false} />
          <KV k="sign-off" v={c.approverRole} mono={false} />
        </div>
      </div>
      <Divider label="Foundation to paint, then monitoring" />
      <div className="bld__stages" data-testid="building-stages">
        {stages.map((s, i) => {
          const done = i < stage || (i === stage && released && !monitoring)
          const active = i === stage
          const cls = active ? 'is-active' : done ? 'is-done' : ''
          return (
            <button
              key={s.id}
              className={`bld__stage ${cls} ${active && held ? 'is-held' : ''} ${i === MONITORING ? 'bld__stage--shm' : ''}`}
              onClick={() => {
                useApp.getState().setAutoplay(false)
                jump(i)
              }}
              title={`Jump to ${s.short.toLowerCase()}`}
            >
              <span className="mono bld__stage-n">{i === MONITORING ? '··' : String(i + 1).padStart(2, '0')}</span>
              <span className="bld__stage-title">{s.short}</span>
              <span className="mono bld__stage-tag">{done ? '✓' : i === MONITORING ? 'SHM' : `${s.weight}%`}</span>
            </button>
          )
        })}
      </div>
      <div className="bld__chips" aria-label="This milestone">
        {(monitoring ? monitoringSteps : steps).map((label, i) => (
          <span key={label} className={`bld__chip ${i === idx ? 'is-active' : i < idx ? 'is-done' : ''} ${held && i >= 4 && i <= idx ? 'is-held' : ''}`}>
            {label}
          </span>
        ))}
      </div>
      <div className="bld__line" data-testid="building-line">
        {line}
      </div>
    </Panel>
  )
}

/* ------------------------------------------------------------------ */

function HealthPanel() {
  const stage = useBuilding((s) => s.stage)
  const series = useShm((s) => s.series)
  const alert = useShm((s) => s.alert)
  const monitoring = stage === MONITORING
  const standing = monitoring ? MONITORING - 1 : stage
  const anyAlert = monitoring && alert.crack
  return (
    <Panel
      title="Structural health"
      tag={<Chip tone={anyAlert ? 'warn' : monitoring ? 'ok' : 'dim'}>{anyAlert ? 'CG-2 ABOVE LIMIT' : monitoring ? 'LIVE' : 'DURING BUILD'}</Chip>}
      tone={anyAlert ? 'alert' : 'default'}
      anchor={{ bottom: 150, left: 216 }}
      width={340}
      testId="building-health"
    >
      {sensorDefs.map((d) => {
        const installed = d.installedAt <= standing
        const values = series[d.kind]
        const v = values[values.length - 1] ?? 0
        const hot = monitoring && alert[d.kind]
        return (
          <div key={d.kind} className={`bld__shm ${installed ? '' : 'is-off'} ${hot ? 'is-alert' : ''}`} data-testid={`shm-${d.kind}`}>
            <span className="bld__shm-label">
              {d.label}
              <span className="mono bld__shm-tags">{d.tags.length > 2 ? `${d.tags[0]}…${d.tags[d.tags.length - 1].split('-')[1]}` : d.tags.join(' ')}</span>
            </span>
            {installed ? (
              <>
                <Sparkline values={values} width={74} height={20} tone={hot ? 'alert' : undefined} />
                <span className="mono bld__shm-v">
                  {d.fmt(v)}
                  {d.unit && <span className="bld__shm-unit"> {d.unit}</span>}
                </span>
                <span className="mono bld__shm-limit">{d.limit}</span>
              </>
            ) : (
              <span className="mono bld__shm-off">installed at {stages[d.installedAt].short.toLowerCase()}</span>
            )}
          </div>
        )
      })}
    </Panel>
  )
}

/* ------------------------------------------------------------------ */

function EvidencePanel() {
  const c = useBuilding((s) => s.current)
  const phase = useBuilding((s) => s.phase)
  // Plan checks appear one by one during the plan phase.
  const shownMeasures = useBuilding((s) =>
    s.phase === 'scan' ? 0 : s.phase === 'plan' ? Math.min(s.current.measures.length, Math.floor(s.t / 0.8)) : s.current.measures.length,
  )
  const found = useBuilding((s) => s.found)
  const checked = useBuilding((s) => s.checked)
  const decision = useBuilding((s) => s.decision)
  const detector = useFact('detectorLabel') ?? 'detector'

  const afterScan = phase !== 'scan'
  const measured = afterScan && phase !== 'plan'
  const sorted = [...c.findings].sort((a, b) => a.y - b.y)
  const shown = phase === 'scan' ? sorted.slice(0, found) : sorted
  const vlmDone = measured && (phase !== 'verify' || checked >= 3)

  const chainState = (i: number): 'pass' | 'pending' | 'active' | 'fail' => {
    if (i === 3) {
      if (decision) return decision.action === 'accept' ? 'pass' : 'fail'
      return phase === 'approve' ? 'active' : 'pending'
    }
    if (phase === 'scan' || phase === 'plan') return 'pending'
    if (phase === 'verify') return i < checked ? 'pass' : i === checked ? 'active' : 'pending'
    return 'pass'
  }

  const rec = (label: string, title: string, r: IesRecord, on: boolean) => (
    <button key={label} className="road__rec mono" disabled={!on} onClick={() => inspectRecord(title, c.label, r)}>
      {label}
    </button>
  )
  const vlmTarget = c.findings[c.vlmIndex]
  const sensorName = c.stage.bosonSensor.replace(/_/g, ' ')

  return (
    <Panel
      title={c.monitoring ? 'Sensor evidence' : 'Milestone evidence'}
      tag={<Chip tone="dim">DRAFT SPEC</Chip>}
      anchor={{ top: 92, right: 24 }}
      width={380}
      testId="building-evidence"
    >
      <div className="event__headline">{c.stage.spec.title}</div>
      <div className="event__site">{c.stage.work}</div>

      <Divider label={c.monitoring ? `Boson · ${sensorName}` : `Photon · ${detector}`} />
      <div className="bld__finds">
        {shown.map((f) => (
          <button
            key={f.id}
            className={`road__det road__det--${f.tone} bld__find`}
            onClick={() => inspectRecord(`IES record · ${f.cls.toLowerCase()} detection`, `${f.where} · conf ${f.confidence.toFixed(2)}`, f.record)}
          >
            <span className="road__det-dot" />
            <span className="road__det-cls">{f.cls}</span>
            <span className="mono road__det-ch">{f.where}</span>
            <span className="mono road__det-conf">{f.confidence.toFixed(2)}</span>
            <span className="mono road__det-vlm">{f.id === vlmTarget.id && vlmDone ? 'VLM ✓' : ''}</span>
            <span className="mono obs__open">JSON</span>
          </button>
        ))}
        {shown.length === 0 && <div className="muted road__empty">{c.monitoring ? 'Listening to sensors…' : 'Scanning milestone…'}</div>}
      </div>

      <Divider label={c.monitoring ? 'Readings vs limits' : `Plan vs as-built · ${sensorName}`} />
      <div className="bld__measures">
        {c.measures.map((m, i) => {
          const on = i < shownMeasures
          return (
            <div key={m.label} className={`bld__measure ${on ? '' : 'is-off'} ${on && !m.ok ? 'is-bad' : ''}`}>
              <span className="bld__measure-glyph">{on ? (m.ok ? '✓' : '!') : '○'}</span>
              <span className="bld__measure-k">{m.label}</span>
              <span className="mono bld__measure-v">{on ? m.value : '-'}</span>
              <span className="mono bld__measure-p">{m.plan}</span>
            </div>
          )
        })}
      </div>

      <Divider label="Verifier chain" />
      {c.verifier.map((v, i) => {
        const st = chainState(i)
        const act = decision ? (decision.action === 'modify' ? 'hold' : decision.action) : ''
        const note = i === 3 ? (decision ? `${act}${decision.simulated ? ' (simulated)' : ''}` : c.approverRole) : st === 'pass' ? v.note : ''
        return (
          <CheckRow key={v.stage} state={st}>
            {v.stage}
            {note && <span className="muted road__note"> · {note}</span>}
          </CheckRow>
        )
      })}

      <Divider label="IES records" />
      <div className="road__recs">
        {rec('SCAN', 'IES record · scan capture', c.records.scan, true)}
        {rec('SENSOR', `IES record · ${sensorName}`, c.records.sensor, afterScan)}
        {rec(c.monitoring ? 'BASELINE' : 'BIM', c.monitoring ? 'IES record · readings vs baseline' : 'IES record · as-built vs BIM', c.records.plan, measured)}
        {rec(c.monitoring ? 'ANOMALY' : 'COMPLETION', c.monitoring ? 'IES record · anomaly' : 'IES record · milestone completion', c.records.completion, measured)}
        {rec('VLM', `IES record · VLM on ${vlmTarget.cls.toLowerCase()}`, c.records.vlm, vlmDone)}
        {decision && rec('HUMAN', 'IES record · human verification', decision.record, true)}
      </div>
    </Panel>
  )
}

/* ------------------------------------------------------------------ */

function CertificatePanel() {
  const entry = useBuilding((s) => s.entry)
  const decision = useBuilding((s) => s.decision)
  const outcome = useBuilding((s) => s.outcome)
  const c = useBuilding((s) => s.current)
  if (!entry || !decision) return null
  const type = entry.payload.type
  const ok = type === 'settlement' || type === 'work_order'
  const statusTitle = ok
    ? c.monitoring
      ? outcome === 'released'
        ? 'Inspection ordered'
        : 'Work order raised'
      : outcome === 'released'
        ? 'RA bill released'
        : 'Certificate signed'
    : type === 'hold'
      ? 'On hold. Not settled.'
      : 'Rejected. Not settled.'
  const idValue = entry.payload.certificate?.certificate_id ?? entry.payload.work_order?.work_order_id
  return (
    <Panel
      title={ok ? (c.monitoring ? 'Inspection work order' : 'Milestone certificate') : 'Decision recorded'}
      tag={<Chip tone={ok ? 'ok' : 'warn'}>{ok ? (c.monitoring ? 'ISSUED' : 'SIGNED') : type === 'hold' ? 'HOLD' : 'REJECTED'}</Chip>}
      tone={ok ? 'ok' : 'default'}
      anchor={{ bottom: 44, right: 24 }}
      width={380}
      testId="building-cert"
    >
      {idValue && <KV k={c.monitoring ? 'work order' : 'certificate'} v={idValue} />}
      <KV k="spec" v={c.spec.id} />
      <KV k="milestone" v={c.label} mono={false} />
      <KV k={ok ? 'signed by' : 'decided by'} v={`${c.approverRole}${decision.simulated ? ' (simulated)' : ''}`} mono={false} />
      {decision.action === 'reject' && <KV k="reason code" v={decision.reason ?? '-'} />}
      {decision.action === 'modify' && <KV k="action" v={c.stage.modify.label.toLowerCase()} mono={false} />}
      <KV k="ledger block" v={`#${entry.block.seq} · ${entry.block.hash.slice(0, 16)}…`} />
      <div className={`event__settle ${ok ? '' : 'is-reject'}`} data-testid="building-outcome">
        <div className="event__settle-title">{statusTitle}</div>
        <div className="mono event__settle-id">
          {ok
            ? outcome === 'released'
              ? c.spec.settles
              : c.monitoring
                ? 'assigning to Structural Engineer'
                : 'releasing against verified milestone'
            : outcome === 'held'
              ? c.monitoring
                ? 'No work order. CG-2 stays on watch.'
                : 'RA bill held. Rework, then re-scan.'
              : 'No certificate minted'}
        </div>
      </div>
      <button className="btn btn--small road__inspect" onClick={() => inspectBlock(entry)}>
        Inspect block
      </button>
    </Panel>
  )
}

/* ------------------------------------------------------------------ */

function Approval() {
  const c = useBuilding((s) => s.current)
  const decide = useBuilding((s) => s.decide)
  const onDecide = useCallback(
    (a: Parameters<typeof decide>[0], r: Parameters<typeof decide>[1], m: Parameters<typeof decide>[2], sim: boolean) => decide(a, r, m, sim),
    [decide],
  )
  const checks = c.measures.filter((m) => m.ok).length
  return (
    <ApprovalCard decisionKey={c.id} title={c.stage.approveTitle} approverRole={c.approverRole} modifyOptions={[c.stage.modify]} onDecide={onDecide}>
      {c.monitoring ? (
        <>
          CG-2 on the L2 facade reads {c.measures[0].value} against a {c.measures[0].plan.replace('≤ ', '')} limit and is widening {c.measures[1].value}. Tilt
          and settlement are inside limits. The VLM sees the crack on the facade frame. Raise a structural inspection within 72 h?
        </>
      ) : (
        <>
          {c.label}: {checks} of {c.measures.length} plan checks pass ({c.measures[0].label} {c.measures[0].value}, {c.measures[1].label} {c.measures[1].value}).{' '}
          {c.findings.length} snags logged as work orders. Sign the milestone and release the RA bill?
        </>
      )}
    </ApprovalCard>
  )
}
