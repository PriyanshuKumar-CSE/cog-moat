import { useCallback } from 'react'
import { facts } from '../../config/content'
import { useApp, usePlaceName } from '../../core/store'
import { ApprovalCard } from '../../hud/ApprovalCard'
import { Panel } from '../../hud/Panel'
import { Bar, CheckRow, Chip, Divider, Gauge, KV, Sparkline, Stat } from '../../hud/widgets'
import type { IesRecord } from '../../sim/ies'
import { SIM } from './fleet'
import { inspectRecord, inspectVerifiedTrip } from './FleetLayer'
import {
  ALT_TRUCK,
  APPROVER,
  L2_ALERT_IDLE,
  REC_TRUCK,
  flowSteps,
  fmtClock,
  phaseFlow,
  reasonNote,
  site,
  spec,
  useMine,
  type HistoryRow,
  type Metrics,
  type Snapshot,
} from './mineStore'

export function MineHud() {
  const phase = useMine((s) => s.phase)
  return (
    <>
      {/* Panels stack in two columns so they never overlap, also in projector mode. */}
      <div className="mine__col mine__col--left">
        <SitePanel />
        <ProductionPanel />
      </div>
      <div className="mine__col mine__col--right">
        <LoadersPanel />
        <DecisionPanel />
        <TripPanel />
      </div>
      {phase === 'approve' && <Approval />}
    </>
  )
}

function useCustomer() {
  const id = site.customerFact
  const override = useApp((s) => (id ? s.factOverrides[id] : undefined))
  if (!id) return null
  const f = facts[id]
  return (override ?? f.visible) ? f.text : null
}

const pct = (v: number) => `${Math.round(v * 100)}`

/** Panels inside a column flow normally instead of being absolutely placed. */
const STACKED = { position: 'relative' } as const

function SitePanel() {
  const m = useMine((s) => s.metrics)
  const place = usePlaceName(site.name)
  const customer = useCustomer()
  const idle = 1 - m.utilisation
  return (
    <Panel title="Pit · live" tag={`${15} dumpers · 2 loaders`} anchor={STACKED} width={340} testId="mine-site">
      <div className="mine__site">
        <div>
          <div className="mine__place">{place ?? 'Opencast pit'}</div>
          <div className="mine__shift mono">Shift A · 06:00-14:00</div>
        </div>
        <div className="mine__site-right">
          {customer && <Chip>{customer}</Chip>}
          <div className="mine__clock mono">{fmtClock(m.clock)}</div>
        </div>
      </div>
      <div className="mine__kpis">
        <Gauge value={m.utilisation} label="Utilisation" size={84} />
        <div className="mine__kpi-col">
          <Stat label="Idle time" value={pct(idle)} unit="% of truck time" />
          <div className="mine__note">
            {m.idleTrucks} {m.idleTrucks === 1 ? 'truck' : 'trucks'} queued now · {Math.round(idle * 15 * 60)} truck-min/h
          </div>
        </div>
      </div>
      <Divider label="Haulage cycles" />
      <div className="mine__trips">
        <Stat label="Trips this shift" value={m.trips} />
        <Stat label="Trips / hour" value={m.tph.toFixed(1)} />
      </div>
      <Sparkline values={m.spark} width={310} height={34} />
      <div className="mine__note">Trip counts only when load, haul and dump line up with payload.</div>
    </Panel>
  )
}

const fmtTonnes = (t: number) => Math.round(t).toLocaleString('en-IN')

function ProductionPanel() {
  const m = useMine((s) => s.metrics)
  const gap = m.forecast - m.target
  const miss = gap < 0
  const loads = Math.round(-gap / (0.91 * SIM.RATED_T))
  return (
    <Panel title="Production vs plan" tag="tonnes" anchor={STACKED} width={340} testId="mine-production">
      <ProductionChart m={m} />
      <KV k="Moved / plan to date" v={`${fmtTonnes(m.tonnes)} / ${fmtTonnes(m.plan)} t`} />
      <KV k="Shift target 14:00" v={`${fmtTonnes(m.target)} t`} />
      <div className={`mine__forecast ${miss ? 'is-miss' : 'is-ok'}`} data-testid="mine-forecast">
        {miss ? (
          <>
            ETA to target: miss by <b className="mono">{fmtTonnes(Math.round(-gap / 10) * 10)} t</b>
            {loads > 0 && <span> · about {loads} truckload{loads === 1 ? '' : 's'}</span>}
          </>
        ) : (
          <>
            ETA to target: on track, <b className="mono">+{fmtTonnes(Math.round(gap / 10) * 10)} t</b>
          </>
        )}
      </div>
    </Panel>
  )
}

const CW = 310
const CH = 112
const X0 = 6 * 60
const X1 = 14 * 60

function ProductionChart({ m }: { m: Metrics }) {
  const top = Math.max(m.target, m.forecast) * 1.06
  const x = (min: number) => ((min - X0) / (X1 - X0)) * (CW - 30) + 4
  const y = (t: number) => CH - 14 - (t / top) * (CH - 22)
  const actual = m.history.map((h) => `${x(h.min).toFixed(1)},${y(h.tonnes).toFixed(1)}`).join(' ') + ` ${x(m.clock).toFixed(1)},${y(m.tonnes).toFixed(1)}`
  const miss = m.forecast < m.target
  return (
    <svg className="mine__chart" width={CW} height={CH} viewBox={`0 0 ${CW} ${CH}`}>
      {[8, 10, 12, 14].map((h) => (
        <g key={h}>
          <line className="mine__chart-grid" x1={x(h * 60)} x2={x(h * 60)} y1={6} y2={CH - 14} />
          <text className="mine__chart-axis" x={x(h * 60)} y={CH - 2} textAnchor="middle">
            {`${String(h).padStart(2, '0')}:00`}
          </text>
        </g>
      ))}
      <line className="mine__chart-plan" x1={x(X0)} y1={y(0)} x2={x(X1)} y2={y(m.target)} />
      <line className="mine__chart-target" x1={x(X1) - 8} x2={x(X1) + 8} y1={y(m.target)} y2={y(m.target)} />
      <text className="mine__chart-label" x={x(X1) - 10} y={y(m.target) - 5} textAnchor="end">
        target
      </text>
      <polyline className="mine__chart-actual" points={actual} />
      <line className={`mine__chart-forecast ${miss ? 'is-miss' : 'is-ok'}`} x1={x(m.clock)} y1={y(m.tonnes)} x2={x(X1)} y2={y(m.forecast)} />
      <circle className={`mine__chart-dot ${miss ? 'is-miss' : 'is-ok'}`} cx={x(X1)} cy={y(m.forecast)} r={3} />
      <circle className="mine__chart-now" cx={x(m.clock)} cy={y(m.tonnes)} r={3} />
      <g transform="translate(6 10)">
        <line className="mine__chart-actual" x1={0} x2={14} y1={0} y2={0} />
        <text className="mine__chart-label" x={18} y={3}>
          actual
        </text>
        <line className="mine__chart-plan" x1={58} x2={72} y1={0} y2={0} />
        <text className="mine__chart-label" x={76} y={3}>
          plan
        </text>
        <line className={`mine__chart-forecast ${miss ? 'is-miss' : 'is-ok'}`} x1={106} x2={120} y1={0} y2={0} />
        <text className="mine__chart-label" x={124} y={3}>
          forecast
        </text>
      </g>
    </svg>
  )
}

function LoadersPanel() {
  const m = useMine((s) => s.metrics)
  return (
    <Panel title="Queue at each loader" tag="live" anchor={STACKED} width={360} testId="mine-loaders">
      {m.loaders.map((l, i) => {
        const alert = i === 0 ? l.queued >= 3 : l.idle > L2_ALERT_IDLE
        return (
          <div key={i} className="mine__loader">
            <div className="mine__loader-head">
              <span className="mine__loader-name">Loader {i + 1}</span>
              <span className="mine__pips" aria-label={`${l.queued} trucks queued`}>
                {Array.from({ length: Math.max(l.queued, 0) }, (_, k) => (
                  <i key={k} className={i === 0 && l.queued >= 3 ? 'is-warn' : ''} />
                ))}
              </span>
              <span className="mine__loader-trucks mono">{l.assigned} trucks</span>
            </div>
            <div className="mine__loader-stats">
              <KV k="Queue wait" v={`${l.waitMin.toFixed(1)} min`} />
              <KV k="Idle" v={`${pct(l.idle)}%`} />
            </div>
            <Bar value={1 - l.idle} tone={alert ? 'warn' : undefined} />
            <div className="mine__alert">
              {i === 1 && l.idle > L2_ALERT_IDLE ? 'Long work queue at the face. Loader waiting on trucks.' : i === 0 && l.queued >= 3 ? 'Trucks idle in queue.' : '\u00a0'}
            </div>
          </div>
        )
      })}
    </Panel>
  )
}

function DecisionPanel() {
  const phase = useMine((s) => s.phase)
  const m = useMine((s) => s.metrics)
  const decision = useMine((s) => s.decision)
  const before = useMine((s) => s.before)
  const after = useMine((s) => s.after)
  const history = useMine((s) => s.history)
  const step = phaseFlow[phase]
  return (
    <Panel title="Decision" tag="human in the loop" anchor={STACKED} width={360} testId="mine-decision">
      <div className="mine__flow">
        {flowSteps.map((s, i) => (
          <span key={s.id} className={`mine__flow-step ${i === step ? 'is-active' : i < step ? 'is-done' : ''}`}>
            {s.title}
          </span>
        ))}
      </div>
      {phase === 'situation' && (
        <div className="mine__copy" data-testid="mine-situation">
          <b className="mono">{fmtClock(m.clock)}</b> Loader 1 has {m.loaders[0].queued} {m.loaders[0].queued === 1 ? 'truck' : 'trucks'} queued. Loader 2 has a long work queue and waits on trucks {pct(m.loaders[1].idle)}% of the time.
        </div>
      )}
      {(phase === 'recommend' || phase === 'approve') && (
        <div className="mine__copy">
          <div className="mine__rec">
            Scheduler recommends: move <b>T{REC_TRUCK}</b> from Loader 1 to Loader 2.
          </div>
          <div className="mine__note">Expected: +2 trips/h, Loader 1 wait down. Recommendation only; a person decides.</div>
        </div>
      )}
      {(phase === 'outcome' || phase === 'learn') && decision && before && (
        <DecisionOutcome action={decision.action} reason={decision.reason} simulated={decision.simulated} record={decision.record} before={before} now={after ?? snap(m)} final={!!after} />
      )}
      <Divider label="Earlier decisions" />
      {history.slice(0, phase === 'outcome' || phase === 'learn' ? 2 : 3).map((h, i) => (
        <HistoryLine key={`${h.at}-${i}`} h={h} />
      ))}
      <div className="mine__note mine__note--em">Rejections teach the scheduler what its sensors cannot see.</div>
    </Panel>
  )
}

const snap = (m: Metrics): Snapshot => ({
  clock: m.clock,
  l1Wait: m.loaders[0].waitMin,
  l2Idle: m.loaders[1].idle,
  tph: m.tph,
  utilisation: m.utilisation,
  forecastGap: m.forecast - m.target,
})

function DecisionOutcome({
  action,
  reason,
  simulated,
  record,
  before,
  now,
  final,
}: {
  action: 'accept' | 'reject' | 'modify'
  reason: string | null
  simulated: boolean
  record: IesRecord
  before: Snapshot
  now: Snapshot
  final: boolean
}) {
  const label = action === 'accept' ? 'ACCEPTED' : action === 'modify' ? `MODIFIED · T${ALT_TRUCK} SENT` : `REJECTED · ${reason}`
  const sign = (v: number) => `${v >= 0 ? '+' : '-'}${Math.abs(Math.round(v / 10) * 10).toLocaleString('en-IN')} t`
  return (
    <div className="mine__outcome" data-testid="mine-outcome">
      <div className="mine__outcome-head">
        <Chip tone={action === 'reject' ? 'warn' : 'ok'}>{label}</Chip>
        <span className="mine__note">
          {APPROVER}
          {simulated ? ' (simulated)' : ''}
        </span>
        <button className="btn btn--small" onClick={() => inspectRecord('IES record · human decision', `${APPROVER}: ${action}`, record)}>
          JSON
        </button>
      </div>
      {action === 'reject' && <div className="mine__note">{reasonNote(reason as never)}. Stored with the case; no truck moved.</div>}
      <div className="mine__measure">
        <span className="mine__measure-h">{final ? `Measured ${fmtClock(before.clock)}-${fmtClock(now.clock)}` : `Measuring since ${fmtClock(before.clock)}`}</span>
        <span className="mine__measure-h">before</span>
        <span className="mine__measure-h">now</span>
        <MeasureRow k="Loader 1 wait" a={`${before.l1Wait.toFixed(1)} min`} b={`${now.l1Wait.toFixed(1)} min`} good={now.l1Wait < before.l1Wait - 0.3} />
        <MeasureRow k="Loader 2 idle" a={`${pct(before.l2Idle)}%`} b={`${pct(now.l2Idle)}%`} good={now.l2Idle < before.l2Idle - 0.03} />
        <MeasureRow k="Trips / hour" a={before.tph.toFixed(1)} b={now.tph.toFixed(1)} good={now.tph > before.tph + 0.3} />
        <MeasureRow k="vs target" a={sign(before.forecastGap)} b={sign(now.forecastGap)} good={now.forecastGap > before.forecastGap + 250} />
      </div>
    </div>
  )
}

function MeasureRow({ k, a, b, good }: { k: string; a: string; b: string; good: boolean }) {
  return (
    <>
      <span className="mine__measure-k">{k}</span>
      <span className="mono mine__measure-a">{a}</span>
      <span className={`mono mine__measure-b ${good ? 'is-good' : ''}`}>{b}</span>
    </>
  )
}

function HistoryLine({ h }: { h: HistoryRow }) {
  const tone = h.action === 'reject' ? 'warn' : 'ok'
  const word = h.action === 'accept' ? 'accepted' : h.action === 'modify' ? 'modified' : `rejected · ${h.reason}`
  return (
    <div className={`mine__hist ${h.action === 'reject' ? 'is-reject' : ''}`}>
      <span className="mono mine__hist-at">{h.at}</span>
      <span className="mine__hist-body">
        {h.rec}: <Chip tone={tone}>{word}</Chip>
        <span className="mine__hist-note">
          {h.note}. {h.outcome}
        </span>
      </span>
    </div>
  )
}

function TripPanel() {
  const v = useMine((s) => s.verified)
  return (
    <Panel title="Trip verification" tag={spec.id} anchor={STACKED} width={360} testId="mine-trip">
      {v ? (
        <>
          <div className="mine__trip-head">
            <span>
              Trip <b className="mono">#{v.trip}</b> · T{v.truck} · Loader {v.loader + 1} to dump
            </span>
            <Chip tone="ok">COUNTED</Chip>
          </div>
          <CheckRow state="pass">Load event · payload {v.payload}% ≥ 80% rated</CheckRow>
          <CheckRow state="pass">Haul GPS track · max gap {v.gpsGapS} s ≤ 3 min</CheckRow>
          <CheckRow state="pass">Dump event inside valid dump zone</CheckRow>
          <CheckRow state="pass">Confidence {v.confidence.toFixed(2)} ≥ 0.9</CheckRow>
          <div className="mine__records">
            <RecordBtn label="load" r={v.load} title="IES record · load event" />
            <RecordBtn label="track" r={v.track} title="IES record · haul GPS track" />
            <RecordBtn label="dump" r={v.dump} title="IES record · dump event" />
            <button className="btn btn--small btn--on" onClick={inspectVerifiedTrip} data-testid="mine-trip-json">
              trip record
            </button>
          </div>
          <div className="mine__note">Settles: {spec.settles}</div>
        </>
      ) : (
        <>
          <div className="mine__trip-head">
            <span>Watching the next trip</span>
            <Chip tone="dim">PENDING</Chip>
          </div>
          {spec.evidenceRequired.map((e) => (
            <CheckRow key={e} state="pending">
              {e}
            </CheckRow>
          ))}
          <CheckRow state="pending">{spec.checks[0]}</CheckRow>
          <div className="mine__note">Settles: {spec.settles}</div>
        </>
      )}
    </Panel>
  )
}

function RecordBtn({ label, r, title }: { label: string; r: IesRecord; title: string }) {
  return (
    <button className="btn btn--small" onClick={() => inspectRecord(title, `${r.kind} · ${String(r.claim.quantity ?? r.claim.class ?? '')}`, r)}>
      {label}
    </button>
  )
}

function Approval() {
  const cycle = useMine((s) => s.cycle)
  const decide = useMine((s) => s.decide)
  const m = useMine((s) => s.metrics)
  const onDecide = useCallback(
    (a: Parameters<typeof decide>[0], r: Parameters<typeof decide>[1], mod: Parameters<typeof decide>[2], sim: boolean) => decide(a, r, mod, sim),
    [decide],
  )
  return (
    <ApprovalCard
      decisionKey={`mine-${cycle}`}
      title={`Move Truck ${REC_TRUCK} from Loader 1 to Loader 2`}
      approverRole={APPROVER}
      modifyOptions={[{ id: 't9', label: `Send Truck ${ALT_TRUCK} instead` }]}
      onDecide={onDecide}
    >
      Loader 1 has {m.loaders[0].queued} trucks queued ({m.loaders[0].waitMin.toFixed(1)} min wait). Loader 2 is waiting on trucks. The scheduler recommends moving Truck {REC_TRUCK}. Reject with a reason if it should not go, for example a wet haul road.
    </ApprovalCard>
  )
}
