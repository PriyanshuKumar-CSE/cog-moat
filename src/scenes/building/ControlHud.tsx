import type { ReactNode } from 'react'
import { savingsReference } from '../../config/content'
import { useFact } from '../../core/store'
import { Panel } from '../../hud/Panel'
import { Chip, Divider, Sparkline } from '../../hud/widgets'
import { useBuilding } from './buildingStore'
import {
  PROJECT_WEEKS,
  SLIP_FLAG_DAYS,
  clockLabel,
  hourlyHeadcount,
  machineHours,
  measuredPct,
  peakHeadcount,
  plannedPct,
  productiveSoFar,
  progressAt,
  queriedHours,
  sitePlan,
  tripsSoFar,
  useControl,
  type Lens,
} from './control'
import { stages } from './stages'

/**
 * Project control lens of the Building scene: the six control levers from
 * Cognecto's Project Control brochure, measured on the simulated tower, with
 * the brochure's live-site figures shown alongside and marked as such.
 */

export function LensSwitch() {
  const lens = useControl((s) => s.lens)
  const setLens = useControl((s) => s.setLens)
  const opt = (id: Lens, label: string) => (
    <button className={`bld__lens-opt ${lens === id ? 'is-on' : ''}`} onClick={() => setLens(id)} aria-pressed={lens === id} data-tour-control>
      {label}
    </button>
  )
  return (
    <div className="bld__lens" role="group" aria-label="View" data-testid="building-lens">
      {opt('quality', 'Quality & sign-off')}
      {opt('control', 'Project control')}
    </div>
  )
}

/* ------------------------------------------------------------------ */

const pct = (v: number) => `${Math.round(v * 100)}%`
const hrs = (v: number) => `${v.toFixed(1)} h`

function Lever({ name, by, value, unit, sub, tone, viz, testId }: {
  name: string
  by: string
  value: string
  unit?: string
  sub: string
  tone?: 'warn'
  viz?: ReactNode
  testId: string
}) {
  return (
    <div className={`pc__lever ${tone === 'warn' ? 'is-warn' : ''}`} data-testid={testId}>
      <div className="pc__lever-main">
        <span className="pc__lever-name">
          {name}
          <span className="mono pc__lever-by">{by}</span>
        </span>
        <span className="pc__lever-viz">{viz}</span>
        <span className="mono pc__lever-v">
          {value}
          {unit && <span className="pc__lever-unit"> {unit}</span>}
        </span>
      </div>
      <div className="pc__lever-sub" title={sub}>
        {sub}
      </div>
    </div>
  )
}

function UptimeBar({ working, idle, parked }: { working: number; idle: number; parked: number }) {
  const all = working + idle + parked || 1
  return (
    <span className="pc__stack" aria-label="working, idle, parked">
      <span className="pc__stack-w" style={{ width: `${(working / all) * 100}%` }} />
      <span className="pc__stack-i" style={{ width: `${(idle / all) * 100}%` }} />
      <span className="pc__stack-p" style={{ width: `${(parked / all) * 100}%` }} />
    </span>
  )
}

function HireBar({ worked, billed }: { worked: number; billed: number }) {
  return (
    <span className="pc__hire">
      <span className="pc__hire-w" style={{ width: `${(worked / billed) * 100}%` }} />
    </span>
  )
}

export function LeversPanel() {
  const stage = useBuilding((s) => s.stage)
  const minute = useControl((s) => Math.floor(s.minute / 5) * 5)
  const day = useControl((s) => s.day)
  const productivityRec = useFact('pcProductivity')
  const idleRec = useFact('pcIdle')
  const machineRec = useFact('pcMachine')
  const plan = sitePlan(stage)

  if (!plan) {
    return (
      <Panel title="Project control" tag={<Chip tone="dim">HANDED OVER</Chip>} anchor={{ bottom: 150, left: 216 }} width={340} testId="building-control">
        <div className="muted pc__empty">Site works closed at handover. Crews, machines and hire bills are settled; the tower is now watched by its structural health sensors.</div>
      </Panel>
    )
  }

  const soFar = productiveSoFar(stage, minute, day)
  const series = hourlyHeadcount(stage, minute, day)
  const onSite = series[series.length - 1] ?? 0
  const peak = peakHeadcount(stage, day)
  const ghosts = plan.muster - peak
  const mh = machineHours(stage, minute, day)
  const trips = tripsSoFar(stage, minute)
  const progress = progressAt(stage)
  const behind = progress.slipDays >= SLIP_FLAG_DAYS
  const queried = queriedHours(plan.hire)
  const crewLine = plan.crews.map((c, k) => `${c.name} ${pct(soFar.byCrew[k] ?? 0)}`).join(' · ')
  const records = [productivityRec, idleRec, machineRec].filter(Boolean)

  return (
    <Panel
      title="Project control"
      tag={<Chip tone="ok">{`DAY ${day} · ${clockLabel(minute)}`}</Chip>}
      anchor={{ bottom: 150, left: 216 }}
      width={340}
      testId="building-control"
    >
      <Lever
        testId="pc-productivity"
        name="Worker productivity"
        by="PHOTON"
        value={pct(soFar.total)}
        unit="today"
        viz={<span className="pc__bar"><span style={{ width: pct(soFar.total) }} /></span>}
        sub={`Working vs idle by crew: ${crewLine}`}
      />
      <Lever
        testId="pc-attendance"
        name="Attendance"
        by="PHOTON"
        value={`${onSite}`}
        unit="on site"
        viz={<Sparkline values={series.length > 1 ? series : [0, 0]} width={56} height={16} />}
        sub={`Muster roll ${plan.muster} · peak seen ${peak} · ${ghosts} not on site`}
        tone={ghosts > 0 ? 'warn' : undefined}
      />
      <Lever
        testId="pc-uptime"
        name="Machinery uptime"
        by="BOSON"
        value={hrs(mh.working)}
        unit="run"
        viz={<UptimeBar {...mh} />}
        sub={`${plan.hire.machine} · ${hrs(mh.idle)} idle · ${hrs(mh.parked)} parked today`}
      />
      <Lever
        testId="pc-rental"
        name="Rental equipment"
        by="CORTEX"
        value={`${plan.hire.worked_h}`}
        unit={`/ ${plan.hire.billed_h} h`}
        viz={<HireBar worked={plan.hire.worked_h} billed={plan.hire.billed_h} />}
        sub={`${plan.hire.machine} · ${queried} h billed, not seen working · queried`}
        tone="warn"
      />
      <Lever
        testId="pc-material"
        name="Material & haulage"
        by="PHOTON"
        value={`${trips}`}
        unit={`/ ${plan.trips} trips`}
        viz={<span className="pc__bar"><span style={{ width: pct(trips / plan.trips) }} /></span>}
        sub={`${plan.material} · ${trips} of ${trips} matched to challans`}
      />
      <Lever
        testId="pc-progress"
        name="Progress & cost"
        by="CORTEX"
        value={behind ? `${progress.slipDays} d` : 'on plan'}
        unit={behind ? 'behind' : undefined}
        viz={<span className="pc__bar"><span style={{ width: `${progress.measured}%` }} /></span>}
        sub={`${Math.round(progress.measured)}% of BOQ vs ${Math.round(progress.planned)}% planned · cost +${(plan.costVsBoq * 100).toFixed(1)}% vs BOQ`}
        tone={behind ? 'warn' : undefined}
      />
      {records.length > 0 && (
        <div className="pc__foot" data-testid="pc-live">
          <span>
            <span className="mono pc__rec-tag">LIVE SITE</span>
            {records.join(' · ')}
          </span>
        </div>
      )}
    </Panel>
  )
}

/* ------------------------------------------------------------------ */

const CHART = { w: 348, h: 128, padL: 26, padR: 8, padT: 8, padB: 18 }

function SCurve({ week, measured, flagged, slipDays }: { week: number; measured: number; flagged: boolean; slipDays: number }) {
  const { w, h, padL, padR, padT, padB } = CHART
  const x = (wk: number) => padL + (wk / PROJECT_WEEKS) * (w - padL - padR)
  const y = (p: number) => padT + (1 - p / 100) * (h - padT - padB)
  const line = (f: (wk: number) => number, to: number) => {
    const pts: string[] = []
    for (let wk = 0; wk <= to + 1e-6; wk += 1) pts.push(`${x(wk).toFixed(1)},${y(f(wk)).toFixed(1)}`)
    pts.push(`${x(to).toFixed(1)},${y(f(to)).toFixed(1)}`)
    return pts.join(' ')
  }
  const nowX = x(week)
  const nowY = y(measured)
  // The flag reads to the right of the dot unless it would run off the chart.
  const labelLeft = nowX > w - 130
  return (
    <svg className="pc__curve" width={w} height={h} role="img" aria-label="Cumulative progress, planned and measured">
      {[0, 50, 100].map((p) => (
        <g key={p}>
          <line className="pc__grid" x1={padL} x2={w - padR} y1={y(p)} y2={y(p)} />
          <text className="pc__axis" x={padL - 5} y={y(p) + 3} textAnchor="end">
            {p}
          </text>
        </g>
      ))}
      <text className="pc__axis" x={padL + 4} y={padT + 3} dominantBaseline="hanging">
        % of BOQ
      </text>
      {[0, 26, 52, 78].map((wk) => (
        <text key={wk} className="pc__axis" x={x(wk)} y={h - 4} textAnchor="middle">
          {`W${wk}`}
        </text>
      ))}
      <polyline className="pc__planned" points={line(plannedPct, PROJECT_WEEKS)} />
      <polyline className="pc__measured" points={line(measuredPct, week)} />
      <line className="pc__now" x1={nowX} x2={nowX} y1={padT} y2={h - padB} />
      <circle className={`pc__dot ${flagged ? 'is-warn' : ''}`} cx={nowX} cy={nowY} r={3.5} />
      <text className={`pc__flag ${flagged ? 'is-warn' : ''}`} x={labelLeft ? nowX - 8 : nowX + 8} y={Math.min(h - padB - 6, nowY + 16)} textAnchor={labelLeft ? 'end' : 'start'}>
        {`Week ${Math.round(week)} · ${flagged ? `${slipDays} d behind` : 'on plan'}`}
      </text>
    </svg>
  )
}

export function ProgressPanel() {
  const stage = useBuilding((s) => s.stage)
  const savings = useFact('pcSavings')
  const boq = useFact('pcBoqVerified')
  const decision = useFact('pcDecision')
  const models = useFact('pcModels')
  const safety = useFact('pcSafety')
  const source = useFact('pcSource')
  const p = progressAt(stage)
  const plan = sitePlan(stage)
  const flagged = p.slipDays >= SLIP_FLAG_DAYS
  const record = [boq, decision, models, safety].filter(Boolean) as string[]

  return (
    <Panel
      title="Progress & cost"
      tag={<Chip tone={flagged ? 'warn' : 'ok'}>{flagged ? 'SLIPPAGE FLAGGED' : 'ON PLAN'}</Chip>}
      anchor={{ top: 92, right: 24 }}
      width={380}
      testId="building-progress"
    >
      <div className="pc__stats">
        <div>
          <span className="pc__stat-k">Planned</span>
          <span className="mono pc__stat-v">{Math.round(p.planned)}%</span>
        </div>
        <div>
          <span className="pc__stat-k">Measured by Vision AI</span>
          <span className="mono pc__stat-v">{Math.round(p.measured)}%</span>
        </div>
        <div className={flagged ? 'is-warn' : ''}>
          <span className="pc__stat-k">Slippage</span>
          <span className="mono pc__stat-v">{p.slipDays} d</span>
        </div>
      </div>
      <SCurve week={p.week} measured={p.measured} flagged={flagged} slipDays={p.slipDays} />
      <div className="pc__legend">
        <span className="pc__legend-planned">Planned</span>
        <span className="pc__legend-measured">Measured by Vision AI</span>
      </div>
      {plan && (
        <div className="pc__cost">
          <span>{stages[stage].short} · cost per {plan.unit}</span>
          <span className="mono">+{(plan.costVsBoq * 100).toFixed(1)}% vs BOQ rate</span>
        </div>
      )}

      {savings && (
        <>
          <Divider label="What it saves, every year" />
          <div className="pc__basis">Reference: {savingsReference.basis}</div>
          <div className="pc__save" data-testid="building-savings">
            {savingsReference.rows.map((r) => (
              <div key={r.lever} className="pc__save-row">
                <span className="pc__save-lever">{r.lever}</span>
                <span className="pc__save-basis">{r.basis}</span>
                <span className="mono pc__save-v">{r.value}</span>
              </div>
            ))}
            <div className="pc__save-row pc__save-total">
              <span className="pc__save-lever">Total</span>
              <span className="pc__save-basis">{savingsReference.total.line}</span>
              <span className="mono pc__save-v">{savingsReference.total.value}</span>
            </div>
          </div>
          <div className="pc__note">{savingsReference.note}</div>
        </>
      )}

      {record.length > 0 && (
        <div className="pc__record">
          <span className="mono pc__rec-tag">ON RECORD</span>
          {record.join(' · ')}
          {source && <span className="mono pc__src"> {source}</span>}
        </div>
      )}
    </Panel>
  )
}
