import { deployments, facts, type Deployment } from '../../config/content'
import { useApp, useFact, usePlaceName } from '../../core/store'
import { Panel } from '../../hud/Panel'
import { Chip, Divider, KV, Stat } from '../../hud/widgets'
import { scenes } from '..'
import { domainLabel } from './OrbitStage'
import { useOrbit } from './orbitStore'

export function OrbitHud() {
  const selected = useOrbit((s) => s.selected)
  const d = deployments.find((x) => x.id === selected) ?? null
  return (
    <>
      <FootprintPanel />
      {d && <SitePanel key={d.id} d={d} />}
      <Hint />
    </>
  )
}

function FootprintPanel() {
  const mode = useOrbit((s) => s.mode)
  const setMode = useOrbit((s) => s.setMode)
  const states = useFact('indiaStates')
  const km = useFact('roadKm')
  const countries = useFact('countriesLine')
  const coming = useFact('comingUpLine')
  const tagline = useFact('tagline')
  const india = deployments.filter((d) => d.country === 'IN')
  const count = (domain: Deployment['domain']) => india.filter((d) => d.domain === domain).length
  return (
    <Panel title="Footprint" tag="live" anchor={{ top: 92, left: 216 }} width={330} testId="orbit-footprint">
      <div className="orbit__stats">
        {states && <Stat label="India" value={states.replace(/ Indian states$/, '')} unit="states" />}
        {km && <Stat label="Roads" value={km.replace(/ km monitored$/, '')} unit="km monitored" />}
      </div>
      {countries && (
        <>
          <Divider label="Also live in" />
          <div className="orbit__line">{countries}</div>
        </>
      )}
      {coming && <div className="orbit__line orbit__line--dim">{coming}</div>}

      <Divider label="Sites on this model" />
      <KV k="Roads" v={`${count('road')} states`} />
      <KV k="Water" v={`${count('water')} cities`} />
      <KV k="Mines" v={`${count('mine')} sites`} />

      <div className="orbit__modes">
        <button className={`btn btn--small ${mode === 'globe' ? 'btn--on' : ''}`} onClick={() => setMode('globe')}>
          Globe
        </button>
        <button className={`btn btn--small ${mode === 'india' ? 'btn--on' : ''}`} onClick={() => setMode('india')}>
          India
        </button>
      </div>
      {tagline && <div className="steps__tagline">{tagline}</div>}
    </Panel>
  )
}

function SitePanel({ d }: { d: Deployment }) {
  const select = useOrbit((s) => s.select)
  const goTo = useApp((s) => s.goTo)
  const setAutoplay = useApp((s) => s.setAutoplay)
  const name = usePlaceName(d.name)
  const override = useApp((s) => (d.customerFact ? s.factOverrides[d.customerFact] : undefined))
  const customer = d.customerFact && (override ?? facts[d.customerFact].visible) ? facts[d.customerFact].text : null
  const pmgsy = useFact('pmgsy')
  const target = d.domain ? scenes[d.domain] : null
  return (
    <Panel
      title={name ?? (d.country === 'IN' ? 'India site' : 'Deployment')}
      tag={<Chip tone={d.status === 'live' ? 'ok' : 'dim'}>{d.status === 'live' ? 'LIVE' : 'COMING UP'}</Chip>}
      anchor={{ top: 92, right: 24 }}
      width={340}
      onClose={() => select(null)}
      testId="orbit-site"
    >
      <KV k="domain" v={d.domain ? domainLabel[d.domain] : 'not set in config'} />
      {d.domain === 'road' && pmgsy && <KV k="programme" v={pmgsy} />}
      {customer && <KV k="customer" v={customer} />}
      <KV k="marker" v={d.country === 'IN' ? 'state / city level' : 'country level'} mono={false} />
      {target ? (
        <button
          className="btn orbit__enter"
          onClick={() => {
            setAutoplay(false)
            goTo(target.id)
          }}
        >
          Enter {target.title.toLowerCase()} →
        </button>
      ) : (
        <div className="muted small">Set a domain for this deployment in content.ts to link it to a scene.</div>
      )}
    </Panel>
  )
}

function Hint() {
  const mode = useOrbit((s) => s.mode)
  return (
    <div className="hint">
      {mode === 'globe' ? 'Click India to lift it out · drag to rotate · scroll to zoom' : 'Click a site for details · double-click to enter it'}
    </div>
  )
}
