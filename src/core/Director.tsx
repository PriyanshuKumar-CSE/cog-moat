import { useEffect, useRef } from 'react'
import { resumeAfterIdleS, tour } from '../config/tour'
import { create } from 'zustand'
import { useApp } from './store'

/** Autoplay progress, exposed for the scene rail. */
export const useTour = create<{ progress: number; pausedFor: number }>(() => ({ progress: 0, pausedFor: 0 }))

/**
 * Autoplay director. Advances through `tour`, pausing on manual input and
 * resuming after a quiet period.
 */
export function Director() {
  const autoplay = useApp((s) => s.autoplay)
  const elapsed = useRef(0)
  const lastInput = useRef(-Infinity)

  useEffect(() => {
    if (!autoplay) {
      useTour.setState({ progress: 0, pausedFor: 0 })
      return
    }
    const app = useApp.getState()
    const first = tour.findIndex((t) => t.scene === app.scene)
    if (first < 0) app.goTo(tour[0].scene)
    elapsed.current = 0
    lastInput.current = -Infinity

    const onInput = (e: Event) => {
      const t = e.target as HTMLElement | null
      if (t?.closest?.('[data-tour-control]')) return
      lastInput.current = performance.now()
    }
    window.addEventListener('pointerdown', onInput, true)
    window.addEventListener('wheel', onInput, true)

    let prev = performance.now()
    const id = window.setInterval(() => {
      const now = performance.now()
      const dt = (now - prev) / 1000
      prev = now
      const s = useApp.getState()
      const idleFor = (now - lastInput.current) / 1000
      if (idleFor < resumeAfterIdleS) {
        useTour.setState({ pausedFor: Math.ceil(resumeAfterIdleS - idleFor) })
        return
      }
      if (s.pendingScene) return
      const i = Math.max(0, tour.findIndex((t) => t.scene === s.scene))
      const step = tour[i]
      elapsed.current += dt
      useTour.setState({ progress: Math.min(1, elapsed.current / step.seconds), pausedFor: 0 })
      if (elapsed.current >= step.seconds) {
        elapsed.current = 0
        s.goTo(tour[(i + 1) % tour.length].scene)
      }
    }, 100)

    // Reset the clock whenever the scene changes, whoever changed it.
    const unsub = useApp.subscribe((s, p) => {
      if (s.scene !== p.scene) elapsed.current = 0
    })

    return () => {
      window.clearInterval(id)
      window.removeEventListener('pointerdown', onInput, true)
      window.removeEventListener('wheel', onInput, true)
      unsub()
    }
  }, [autoplay])

  return null
}
