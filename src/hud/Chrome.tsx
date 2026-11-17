import { useEffect, useState } from 'react'
import { facts, type FactId } from '../config/content'
import { useTour } from '../core/Director'
import { sceneOrder, useApp, useFact } from '../core/store'
import { scenes } from '../scenes'
import { JsonView } from './JsonView'
import { Panel } from './Panel'
import { CheckRow } from './widgets'

const base = import.meta.env.BASE_URL

export function TopBar() {
  const scene = scenes[useApp((s) => s.scene)]
  const simulated = useFact('simulatedBadge')
  const autoplay = useApp((s) => s.autoplay)
  const setAutoplay = useApp((s) => s.setAutoplay)
  const togglePresenter = useApp((s) => s.togglePresenter)
  const wordmark = useFact('wordmark')
  return (
    <header className="topbar">
      <div className="topbar__brand">
        {wordmark && <img src={`${base}brand/logo-white-cropped.svg`} alt={wordmark} className="topbar__logo" />}
        <span className="topbar__sep" />
        <span className="topbar__product">LIVING MODEL</span>
      </div>
      <div className="topbar__scene">
        <span className="topbar__index">{String(scene.index).padStart(2, '0')}</span>
        <span className="topbar__title">{scene.title}</span>
        <span className="topbar__subtitle">{scene.subtitle}</span>
      </div>
      <div className="topbar__right">
        {simulated && <span className="badge-sim">{simulated}</span>}
        <Clock />
        <button data-tour-control className={`btn btn--small ${autoplay ? 'btn--on' : ''}`} onClick={() => setAutoplay(!autoplay)}>
          {autoplay ? '❚❚ Autoplay' : '▶ Autoplay'}
        </button>
        <button className="btn btn--small btn--icon" aria-label="Presenter settings" onClick={togglePresenter}>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M1 3.5h12M1 7h12M1 10.5h12" stroke="currentColor" strokeWidth="1.2" />
            <circle cx="4" cy="3.5" r="1.6" fill="#02060f" stroke="currentColor" strokeWidth="1.2" />
            <circle cx="9.5" cy="7" r="1.6" fill="#02060f" stroke="currentColor" strokeWidth="1.2" />
            <circle cx="6" cy="10.5" r="1.6" fill="#02060f" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
      </div>
    </header>
  )
}

function Clock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [])
  const ist = now.toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour12: false })
  return <span className="clock mono">{ist} IST</span>
}

export function SceneRail() {
  const current = useApp((s) => s.scene)
  const pending = useApp((s) => s.pendingScene)
  const goTo = useApp((s) => s.goTo)
  const setAutoplay = useApp((s) => s.setAutoplay)
  const autoplay = useApp((s) => s.autoplay)
  const { progress, pausedFor } = useTour()
  return (
    <nav className="rail" aria-label="Scenes">
      {sceneOrder.map((id) => {
        const m = scenes[id]
        const active = id === (pending ?? current)
        return (
          <button
            key={id}
            className={`rail__item ${active ? 'is-active' : ''} ${m.placeholder ? 'is-placeholder' : ''}`}
            onClick={() => {
              setAutoplay(false)
              goTo(id)
            }}
          >
            <span className="rail__index mono">{String(m.index).padStart(2, '0')}</span>
            <span className="rail__name">{m.title}</span>
            {active && autoplay && <span className="rail__progress" style={{ transform: `scaleX(${progress})` }} />}
          </button>
        )
      })}
      {autoplay && pausedFor > 0 && <div className="rail__paused mono">Tour paused, resumes in {pausedFor}s</div>}
    </nav>
  )
}

export function Ticker() {
  const items = useApp((s) => s.ticker)
  return (
    <div className="ticker" aria-live="polite">
      {items.slice(0, 4).map((t, i) => (
        <div key={t.id} className={`ticker__row ticker__row--${t.level}`} style={{ opacity: 1 - i * 0.22 }}>
          <span className="mono ticker__time">{new Date(t.at).toLocaleTimeString('en-GB', { hour12: false })}</span>
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  )
}

export function KeyHints() {
  return (
    <div className="keyhints mono">
      <span>
        <b>1-{sceneOrder.length}</b> scenes
      </span>
      <span>
        <b>←→</b> step
      </span>
      <span>
        <b>space</b> autoplay
      </span>
      <span>
        <b>H</b> hide HUD
      </span>
      <span>
        <b>P</b> projector
      </span>
      <span>
        <b>`</b> presenter
      </span>
    </div>
  )
}

export function InspectPanel() {
  const inspect = useApp((s) => s.inspect)
  const close = useApp((s) => s.setInspect)
  if (!inspect) return null
  return (
    <Panel
      key={inspect.title + (inspect.subtitle ?? '')}
      title={inspect.title}
      tag="IES"
      anchor={{ top: 92, left: '50%', marginLeft: -270 }}
      width={540}
      onClose={() => close(null)}
      className="panel--inspect"
      testId="inspect-panel"
    >
      {inspect.subtitle && <div className="inspect__sub">{inspect.subtitle}</div>}
      {inspect.checks && (
        <div className="inspect__checks">
          {inspect.checks.map((c) => (
            <CheckRow key={c.label} state={c.ok ? 'pass' : 'fail'}>
              {c.label}
            </CheckRow>
          ))}
        </div>
      )}
      <div className="inspect__json">
        <JsonView data={inspect.data} />
      </div>
    </Panel>
  )
}

export function PresenterPanel() {
  const open = useApp((s) => s.presenterOpen)
  const toggle = useApp((s) => s.togglePresenter)
  const overrides = useApp((s) => s.factOverrides)
  const setFactVisible = useApp((s) => s.setFactVisible)
  const showPlaceNames = useApp((s) => s.showPlaceNames)
  const setShowPlaceNames = useApp((s) => s.setShowPlaceNames)
  const approvalMode = useApp((s) => s.approvalMode)
  const setApprovalMode = useApp((s) => s.setApprovalMode)
  const projector = useApp((s) => s.projector)
  const toggleProjector = useApp((s) => s.toggleProjector)
  if (!open) return null
  return (
    <Panel title="Presenter" tag="` to close" anchor={{ top: 92, right: 24 }} width={340} onClose={toggle} testId="presenter-panel">
      <div className="presenter">
        <div className="presenter__group">Display</div>
        <Toggle label="Place names (states, cities)" on={showPlaceNames} set={setShowPlaceNames} />
        <Toggle label="Projector mode (P)" on={projector} set={() => toggleProjector()} />
        <Toggle label="Simulated approver (countdown)" on={approvalMode === 'timed'} set={(on) => setApprovalMode(on ? 'timed' : 'manual')} />
        <div className="presenter__group">Figures and names</div>
        {(Object.keys(facts) as FactId[]).map((id) => (
          <Toggle key={id} label={facts[id].label} on={overrides[id] ?? facts[id].visible} set={(on) => setFactVisible(id, on)} />
        ))}
      </div>
    </Panel>
  )
}

function Toggle({ label, on, set }: { label: string; on: boolean; set: (on: boolean) => void }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} />
      <span className="toggle__track" />
      <span className="toggle__label">{label}</span>
    </label>
  )
}

/** Brief scanline wipe over the HUD while scenes swap. */
export function TransitionWipe() {
  const pending = useApp((s) => s.pendingScene)
  return <div className={`wipe ${pending ? 'is-on' : ''}`} />
}
