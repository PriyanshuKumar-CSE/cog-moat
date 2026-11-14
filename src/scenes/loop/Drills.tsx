import { useEffect, useState } from 'react'
import { useFact } from '../../core/store'
import { Panel } from '../../hud/Panel'
import { Bar, Chip, Divider, KV } from '../../hud/widgets'
import { useLoop } from './loopStore'

/* ------------------------------------------------------------------ */
/* Scheduler under limits                                              */
/* ------------------------------------------------------------------ */

type Priority = 'SAFETY' | 'OPS' | 'REPORT'

interface Job {
  id: string
  name: string
  priority: Priority
  camera: string | null
  costMs: number
  value: number
}

const JOBS: Job[] = [
  { id: 'ppe', name: 'PPE / safety detector', priority: 'SAFETY', camera: 'CAM-1', costMs: 42, value: 0.62 },
  { id: 'intrusion', name: 'Zone intrusion', priority: 'SAFETY', camera: 'CAM-2', costMs: 38, value: 0.4 },
  { id: 'defects', name: 'Road defect detector', priority: 'OPS', camera: 'CAM-3', costMs: 55, value: 0.81 },
  { id: 'segment', name: 'Road segmentation', priority: 'OPS', camera: 'CAM-3', costMs: 120, value: 0.58 },
  { id: 'trucks', name: 'Truck counter', priority: 'OPS', camera: 'CAM-1', costMs: 30, value: 0.74 },
  { id: 'plates', name: 'Plate reader', priority: 'OPS', camera: 'CAM-2', costMs: 64, value: 0.35 },
  { id: 'vlm', name: 'VLM verifier', priority: 'OPS', camera: 'CAM-3', costMs: 140, value: 0.66 },
  { id: 'report', name: 'Daily report digest', priority: 'REPORT', camera: null, costMs: 90, value: 0.5 },
]

interface Scenario {
  id: string
  title: string
  line: string
  apply: (j: Job) => { job: Job; blocked?: string }
  uplink: 'online' | 'offline'
}

const SCENARIOS: Scenario[] = [
  {
    id: 'normal',
    title: 'Too little compute',
    line: '8 models want to run. The edge box has 3 slots. Best value per cost wins.',
    apply: (job) => ({ job }),
    uplink: 'online',
  },
  {
    id: 'safety',
    title: 'Clashing priorities',
    line: 'Intrusion alert on CAM-2. Safety jumps ahead of the daily report.',
    apply: (job) => (job.id === 'intrusion' ? { job: { ...job, value: 0.99 } } : { job }),
    uplink: 'online',
  },
  {
    id: 'camera',
    title: 'Failure',
    line: 'CAM-3 goes dark. Dependent models skip; work falls back to other cameras.',
    apply: (job) => (job.camera === 'CAM-3' ? { job, blocked: 'CAM-3 dark · skipped' } : { job }),
    uplink: 'online',
  },
  {
    id: 'network',
    title: 'Network drop',
    line: 'Uplink lost. Process on device, buffer evidence, upload when back.',
    apply: (job) => (job.id === 'report' ? { job, blocked: 'waits for uplink' } : job.id === 'vlm' ? { job, blocked: 'server model · queued' } : { job }),
    uplink: 'offline',
  },
  {
    id: 'motion',
    title: 'Skipping useless data',
    line: 'No movement on CAM-1. Do not run models on a static frame.',
    apply: (job) => (job.camera === 'CAM-1' ? { job, blocked: 'no motion · skipped' } : { job }),
    uplink: 'online',
  },
]

const weight: Record<Priority, number> = { SAFETY: 3, OPS: 1, REPORT: 0.6 }

/** Rules set hard limits (blocked); the scheduler ranks what is left. */
function plan(s: Scenario) {
  const rows = JOBS.map((j) => s.apply(j))
  const ranked = rows
    .filter((r) => !r.blocked)
    .map((r) => ({ id: r.job.id, score: (r.job.value * weight[r.job.priority] * 100) / r.job.costMs }))
    .sort((a, b) => b.score - a.score)
  const running = new Set(ranked.slice(0, 3).map((r) => r.id))
  return rows.map((r) => ({ ...r, running: running.has(r.job.id) }))
}

export function SchedulerDrill() {
  const close = useLoop((s) => s.setDrill)
  const sites = useFact('schedulerSites')
  const [k, setK] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setK((v) => (v + 1) % SCENARIOS.length), 5200)
    return () => window.clearInterval(id)
  }, [])
  const s = SCENARIOS[k]
  const rows = plan(s)
  const skipped = rows.filter((r) => r.blocked).length

  return (
    <Panel title="Scheduler decides" tag="under limits" anchor={{ top: 92, left: '50%', marginLeft: -290 }} width={580} onClose={() => close(null)} testId="drill-scheduler">
      <div className="drill__scenarios">
        {SCENARIOS.map((x, i) => (
          <button key={x.id} className={`chip chip--btn ${i === k ? 'is-on' : ''}`} onClick={() => setK(i)}>
            {x.title}
          </button>
        ))}
      </div>
      <div className="drill__line">{s.line}</div>
      <div className="drill__status">
        <KV k="edge slots" v="3" />
        <KV k="uplink" v={<span className={s.uplink === 'offline' ? 'text-alert' : 'text-ok'}>{s.uplink}</span>} />
        <KV k="skipped" v={String(skipped)} />
      </div>
      <div className="jobs">
        <div className="jobs__head mono">
          <span>model</span>
          <span>priority</span>
          <span>pred. cost</span>
          <span>pred. value</span>
          <span>state</span>
        </div>
        {rows.map((r) => (
          <div key={r.job.id} className={`jobs__row ${r.running ? 'is-running' : ''} ${r.blocked ? 'is-blocked' : ''}`}>
            <span>{r.job.name}</span>
            <span>
              <Chip tone={r.job.priority === 'SAFETY' ? 'warn' : r.job.priority === 'REPORT' ? 'dim' : undefined}>{r.job.priority}</Chip>
            </span>
            <span className="mono">{r.job.costMs} ms</span>
            <span>
              <Bar value={r.job.value} tone={r.job.value > 0.9 ? 'warn' : undefined} />
            </span>
            <span className="mono jobs__state">{r.blocked ?? (r.running ? 'RUNNING' : 'queued')}</span>
          </div>
        ))}
      </div>
      <Divider label="why a scheduler" />
      <div className="drill__note">
        Rules alone break when these happen at once{sites ? `, across ${sites} with different hardware and models` : ''}. Rules set the hard limits; the
        scheduler picks the best option within them. Learning predicts each model&apos;s cost on this device and which data is likely to hold an event.
      </div>
    </Panel>
  )
}

/* ------------------------------------------------------------------ */
/* Learn                                                               */
/* ------------------------------------------------------------------ */

const STAGES: [string, string, string, string, string][] = [
  ['Onboard', 'New site configured', '–', '–', 'Starting parameters from similar sites'],
  ['Plan', 'Target → tasks + shifts', 'Trips, cycle time, availability, breakdown risk', '–', 'Used until the site has its own data'],
  ['Execute', 'Dispatch, re-plan live', 'ETA to target: “miss by 400 t, 2 trucks”', 'Spots deviation, triggers re-plan; fraud detector', '–'],
  ['Verify', 'Check completion against spec', '–', 'Unusual completion escalates to a human', '–'],
  ['Settle', 'Sign certificate, release money', '–', '–', '–'],
  ['Learn', 'Write to decision log + corpus', 'Recalibrated', 'Baseline updated', 'Next-site priors improve'],
]

export function LearnDrill() {
  const close = useLoop((s) => s.setDrill)
  const log = useLoop((s) => s.decisionLog)
  const vendor = useFact('vendorModels')
  const rec = log[0]
  return (
    <Panel title="Learn" tag="decision log" anchor={{ top: 92, left: '50%', marginLeft: -300 }} width={600} onClose={() => close(null)} testId="drill-learn">
      <div className="flow mono">
        <span>Situation</span>
        <i>→</i>
        <span>Recommendation</span>
        <i>→</i>
        <span>Human decision</span>
        <i>→</i>
        <span>Measured outcome</span>
      </div>
      <div className="drill__line">Rejection is the most valuable part.</div>

      <div className="learn__grid">
        <div>
          <Divider label="Decision record" />
          {rec ? (
            <>
              <KV k="id" v={rec.id} />
              <KV k="site_id" v={rec.site_id.slice(0, 13) + '…'} />
              <KV k="timestamp" v={rec.timestamp.slice(11, 19)} />
              <KV k="state_snapshot" v={rec.state_snapshot.slice(0, 13) + '… (IES)'} />
              <KV k="recommendation" v={rec.recommendation} mono={false} />
              <KV k="human_action" v={<span className={rec.human_action === 'reject' ? 'text-warn' : 'text-ok'}>{rec.human_action}</span>} />
              <KV k="reason_code" v={rec.reason_code ?? '–'} />
              <KV k="outcome" v={rec.outcome} />
              <KV k="outcome_window" v={rec.outcome_window} />
            </>
          ) : (
            <div className="muted">First record is written when this loop reaches LEARN.</div>
          )}
          <div className="learn__out">training data + audit trail</div>
        </div>
        <div>
          <Divider label="How the data helps" />
          <div className="layer">
            <b>1 · Within one site</b>
            <span>Logs reveal real cycle time, normal fuel burn by truck and season, and which alerts operators always ignore.</span>
          </div>
          <div className="layer">
            <b>2 · Site fingerprint</b>
            <span>Fleet mix, OEMs, haul distance, pit depth, climate. A new site starts from its closest matches: global prior + site-level correction.</span>
          </div>
          <div className="layer">
            <b>3 · Event model</b>
            <span>Enough sites and loops on a standard corpus to pretrain one model that predicts the next event. Forecasts, cold-start priors, anomaly detection without labels.</span>
          </div>
          {vendor && <div className="muted small">{vendor}</div>}
        </div>
      </div>

      <Divider label="Every task runs the same six stages" />
      <div className="stages">
        <div className="stages__row stages__row--head mono">
          <span>stage</span>
          <span>what happens</span>
          <span>forecasts</span>
          <span>anomaly detection</span>
          <span>cold-start priors</span>
        </div>
        {STAGES.map((r) => (
          <div key={r[0]} className="stages__row">
            {r.map((c, i) => (
              <span key={i} className={i === 0 ? 'stages__stage' : ''}>
                {c}
              </span>
            ))}
          </div>
        ))}
      </div>
    </Panel>
  )
}
