import { useCallback, useEffect, useMemo, useRef } from 'react'
import { deployments } from '../../config/content'
import { useFact, usePlaceName } from '../../core/store'
import { ApprovalCard } from '../../hud/ApprovalCard'
import { Panel } from '../../hud/Panel'
import { CheckRow, Chip, Divider, KV, Stat } from '../../hud/widgets'
import type { IesRecord } from '../../sim/ies'
import { inspectBlock, inspectRecord } from './inspect'
import { MIN_PASSES, PASS_COLS, PASS_ROWS, TARGET_COVERAGE, defectLabel, type RoadCase } from './roadCase'
import { approvalCopy, rollU, useRoad, type Phase } from './roadStore'

/** The state shown in this scene. Hidden by the presenter "Place names" switch. */
const SITE = deployments.find((d) => d.id === 'in-mizoram')!

export function RoadHud() {
  const phase = useRoad((s) => s.phase)
  return (
    <>
      <OverviewPanel />
      <EvidencePanel />
      <CertificatePanel />
      {phase === 'approve' && <Approval />}
    </>
  )
}

/* ------------------------------------------------------------------ */

const story = [
  { title: 'SCAN', layer: 'Photon · see' },
  { title: 'PLAN VS AS-BUILT', layer: 'Boson · hear' },
  { title: 'VERIFIER CHAIN', layer: 'Cortex' },
  { title: 'HUMAN GATE', layer: 'Engineer' },
  { title: 'CERTIFICATE', layer: 'Ledger' },
  { title: 'FUNDS RELEASED', layer: 'Settle' },
]

function storyIndex(phase: Phase, released: boolean) {
  return { scan: 0, plan: 1, verify: 2, approve: 3, settle: released ? 5 : 4, reset: 5 }[phase]
}

function splitFigure(text: string) {
  const m = text.match(/^(\S+)\s+(.*)$/)
  return m ? { value: m[1], unit: m[2] } : { value: text, unit: '' }
}

function OverviewPanel() {
  const phase = useRoad((s) => s.phase)
  const funds = useRoad((s) => s.funds)
  const decision = useRoad((s) => s.decision)
  const section = useRoad((s) => s.current.sectionLabel)
  const km = useFact('roadKm')
  const pmgsy = useFact('pmgsy')
  const state = usePlaceName(SITE.name)
  const segmenter = useFact('segmenterLabel') ?? 'road segmentation'
  const detector = useFact('detectorLabel') ?? 'edge detector'
  const idx = storyIndex(phase, funds !== 'pending')
  const accepted = decision?.action === 'accept'

  const line = (() => {
    switch (phase) {
      case 'scan':
        return `Photon sees. ${segmenter} masks the carriageway; the ${detector} flags defects.`
      case 'plan':
        return 'Boson hears. Roller IMU + GPS passes are replayed and checked against the approved plan.'
      case 'verify':
        return 'Nobody self-reports. Rules, an anomaly check, then a VLM re-checks a detection.'
      case 'approve':
        return 'Nothing settles until the Executive Engineer decides.'
      default:
        if (!decision) return ''
        if (!accepted)
          return funds === 'pending' ? 'Decision recorded on the ledger. No certificate.' : 'Funds held. Nothing moves without a signed certificate.'
        return funds === 'pending' ? 'Certificate minted and sealed on the Event Ledger.' : 'Funds released against verified km.'
    }
  })()

  const fig = km ? splitFigure(km) : null

  return (
    <Panel title="Rural road" tag={pmgsy ?? undefined} anchor={{ top: 92, left: 216 }} width={330} testId="road-overview">
      {fig && <Stat label={pmgsy ? `${pmgsy} roads` : 'Roads'} value={fig.value} unit={fig.unit} />}
      <div className="road__meta">
        {state && <KV k="state" v={state} mono={false} />}
        <KV k="section" v={section} />
        <KV k="work" v="Layer compaction" mono={false} />
      </div>
      <Divider label="This section" />
      <div className="steps">
        {story.map((s, i) => {
          const failed = i >= 4 && !accepted && decision && (i === 4 || funds !== 'pending')
          const cls = i === idx ? 'is-active' : i < idx ? 'is-done' : ''
          return (
            <div key={s.title} className={`steps__row ${cls} ${failed && i <= idx ? 'road__step--held' : ''}`}>
              <span className="mono steps__n">{String(i + 1).padStart(2, '0')}</span>
              <span className="steps__title">{i === 5 && failed ? 'FUNDS HELD' : i === 4 && failed ? 'NOT SETTLED' : s.title}</span>
              <span className="mono road__layer">{s.layer}</span>
            </div>
          )
        })}
      </div>
      <div className="road__line" data-testid="road-line">
        {line}
      </div>
    </Panel>
  )
}

/* ------------------------------------------------------------------ */

/** Coverage reached after `fill` (0..1) of the section has been replayed. */
function coverageCurve(c: RoadCase) {
  const perRow = new Float32Array(PASS_ROWS + 1)
  let acc = 0
  for (let r = 0; r < PASS_ROWS; r++) {
    for (let k = 0; k < PASS_COLS; k++) if (c.passes[r * PASS_COLS + k] >= MIN_PASSES) acc++
    perRow[r + 1] = acc
  }
  return (fill: number) => (perRow[Math.floor(fill * PASS_ROWS)] / (PASS_ROWS * PASS_COLS)) * 100
}

function EvidencePanel() {
  const c = useRoad((s) => s.current)
  const phase = useRoad((s) => s.phase)
  const found = useRoad((s) => s.found)
  const checked = useRoad((s) => s.checked)
  const decision = useRoad((s) => s.decision)
  const detector = useFact('detectorLabel') ?? 'detector'
  const state = usePlaceName(SITE.name)
  const curve = useMemo(() => coverageCurve(c), [c])

  const covText = useRef<HTMLSpanElement>(null)
  const covFill = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let last = ''
    const paint = (phase: Phase, t: number) => {
      let fill = 1
      if (phase === 'scan') fill = 0
      else if (phase === 'plan') fill = rollU(t)
      const v = curve(fill)
      const text = fill === 0 ? 'awaiting replay' : `${v.toFixed(1)}%`
      if (text === last) return
      last = text
      if (covText.current) covText.current.textContent = text
      if (covFill.current) {
        covFill.current.style.width = `${v}%`
        covFill.current.classList.toggle('bar__fill--ok', v >= TARGET_COVERAGE)
      }
    }
    const s = useRoad.getState()
    paint(s.phase, s.t)
    return useRoad.subscribe((s) => paint(s.phase, s.t))
  }, [curve])

  const afterScan = phase !== 'scan'
  const measured = afterScan && phase !== 'plan'
  const shown = phase === 'scan' ? found : c.defects.length

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
    <button key={label} className="road__rec mono" disabled={!on} onClick={() => inspectRecord(title, `${c.sectionLabel}`, r)}>
      {label}
    </button>
  )
  const vlmTarget = c.defects[c.vlmIndex]

  return (
    <Panel title="Section evidence" tag={<Chip>ROAD</Chip>} anchor={{ top: 92, right: 24 }} width={380} testId="road-evidence">
      <div className="event__headline">Layer compaction, {c.sectionLabel}</div>
      {state && <div className="event__site">{state}</div>}

      <Divider label={`Photon · ${detector}`} />
      <div className="road__dets">
        {c.defects.slice(0, shown).map((d, i) => (
          <button
            key={d.id}
            className={`road__det road__det--${d.cls === 'pothole' ? 'red' : 'amber'}`}
            onClick={() =>
              inspectRecord(
                `IES record · ${defectLabel[d.cls].toLowerCase()} detection`,
                `ch ${d.chainageKm.toFixed(3)} km · conf ${d.confidence.toFixed(2)}`,
                d.record,
              )
            }
          >
            <span className="road__det-dot" />
            <span className="road__det-cls">{defectLabel[d.cls]}</span>
            <span className="mono road__det-ch">ch {d.chainageKm.toFixed(3)}</span>
            <span className="mono road__det-conf">{d.confidence.toFixed(2)}</span>
            <span className="mono road__det-vlm">{i === c.vlmIndex && measured && (phase !== 'verify' || checked >= 3) ? 'VLM ✓' : ''}</span>
            <span className="mono obs__open">JSON</span>
          </button>
        ))}
        {shown === 0 && <div className="muted road__empty">Scanning section…</div>}
      </div>

      <Divider label="Boson · roller passes" />
      <div className="bar">
        <div className="bar__row">
          <span>
            Area at ≥ {MIN_PASSES} passes <span className="muted">· target {TARGET_COVERAGE}%</span>
          </span>
          <span className="mono" ref={covText} />
        </div>
        <div className="bar__track road__track">
          <div className="bar__fill" ref={covFill} style={{ width: 0 }} />
          <i className="road__target" style={{ left: `${TARGET_COVERAGE}%` }} />
        </div>
      </div>
      <KV k="median passes" v={measured ? `${c.medianPasses}` : '-'} />
      <KV k="thickness" v={measured ? `${c.thicknessMm} mm · plan ${c.thicknessPlanMm} mm` : '-'} />
      <KV k="width" v={measured ? `${c.widthM.toFixed(2)} m · plan ${c.widthPlanM.toFixed(2)} m` : '-'} />
      <KV k="alignment" v={measured ? `max ${c.maxOffsetM.toFixed(2)} m off plan` : '-'} />

      <Divider label="Verifier chain" />
      {c.verifier.map((v, i) => {
        const st = chainState(i)
        const act = decision ? (decision.action === 'modify' ? 'hold (re-test)' : decision.action) : ''
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
        {rec('VIDEO', 'IES record · video capture', c.records.video, true)}
        {rec('MASK', 'IES record · road mask', c.records.mask, afterScan)}
        {rec('ROLLER', 'IES record · roller passes', c.records.roller, afterScan)}
        {rec('COMPACTION', 'IES record · compaction', c.records.compaction, measured)}
        {rec('PLAN', 'IES record · plan vs as-built', c.records.plan, measured)}
        {rec('VLM', `IES record · VLM on ${defectLabel[vlmTarget.cls].toLowerCase()}`, c.records.vlm, measured && (phase !== 'verify' || checked >= 3))}
        {decision && rec('HUMAN', 'IES record · human verification', decision.record, true)}
      </div>
    </Panel>
  )
}

/* ------------------------------------------------------------------ */

function CertificatePanel() {
  const entry = useRoad((s) => s.entry)
  const cert = useRoad((s) => s.certificate)
  const decision = useRoad((s) => s.decision)
  const funds = useRoad((s) => s.funds)
  const c = useRoad((s) => s.current)
  if (!entry || !decision) return null
  const ok = entry.payload.type === 'settlement'
  const statusTitle = ok
    ? funds === 'released'
      ? 'Funds released'
      : 'Certificate signed'
    : entry.payload.type === 'hold'
      ? 'On hold. Not settled.'
      : 'Rejected. Not settled.'
  return (
    <Panel
      title={ok ? 'Completion certificate' : 'Decision recorded'}
      tag={<Chip tone={ok ? 'ok' : 'warn'}>{ok ? 'SIGNED' : entry.payload.type === 'hold' ? 'HOLD' : 'REJECTED'}</Chip>}
      tone={ok ? 'ok' : 'default'}
      anchor={{ bottom: 44, right: 24 }}
      width={380}
      testId="road-cert"
    >
      {cert && <KV k="certificate" v={cert.certificate_id} />}
      <KV k="spec" v={c.spec.id} />
      <KV k="section" v={c.sectionLabel} />
      <KV k={ok ? 'signed by' : 'decided by'} v={`${c.approverRole}${decision.simulated ? ' (simulated)' : ''}`} mono={false} />
      {decision.action === 'reject' && <KV k="reason code" v={decision.reason ?? '-'} />}
      {decision.action === 'modify' && <KV k="action" v="hold, re-test thickness" mono={false} />}
      <KV k="ledger block" v={`#${entry.block.seq} · ${entry.block.hash.slice(0, 16)}…`} />
      <div className={`event__settle ${ok ? '' : 'is-reject'}`} data-testid="road-funds">
        <div className="event__settle-title">{statusTitle}</div>
        <div className="mono event__settle-id">
          {ok ? (funds === 'released' ? c.spec.settles : 'releasing against verified km') : funds === 'held' ? 'Funds held' : 'No certificate minted'}
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
  const c = useRoad((s) => s.current)
  const decide = useRoad((s) => s.decide)
  const onDecide = useCallback(
    (a: Parameters<typeof decide>[0], r: Parameters<typeof decide>[1], m: Parameters<typeof decide>[2], sim: boolean) => decide(a, r, m, sim),
    [decide],
  )
  return (
    <ApprovalCard decisionKey={c.id} title={approvalCopy.title} approverRole={c.approverRole} modifyOptions={approvalCopy.modify} onDecide={onDecide}>
      {c.sectionLabel}: {c.coveragePct}% of area at ≥ {MIN_PASSES} passes, thickness {c.thicknessMm} mm (plan {c.thicknessPlanMm}). {c.defects.length} surface
      defects logged as work orders. Sign and release funds against verified km?
    </ApprovalCard>
  )
}
