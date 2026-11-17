import { useEffect } from 'react'
import { sceneOrder, useApp } from './store'

/**
 * 1-7 jump to a scene, arrows step, Space toggles autoplay,
 * H hides HUD, P projector mode, ` presenter panel, Esc closes the inspector.
 */
export function useKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return
      const s = useApp.getState()
      const n = Number(e.key)
      if (n >= 1 && n <= sceneOrder.length) {
        s.setAutoplay(false)
        s.goTo(sceneOrder[n - 1])
      } else if (e.key === 'ArrowRight') {
        s.setAutoplay(false)
        s.step(1)
      } else if (e.key === 'ArrowLeft') {
        s.setAutoplay(false)
        s.step(-1)
      } else if (e.key === ' ') {
        e.preventDefault()
        s.setAutoplay(!s.autoplay)
      } else if (e.key === 'h' || e.key === 'H') {
        s.toggleHud()
      } else if (e.key === 'p' || e.key === 'P') {
        s.toggleProjector()
      } else if (e.key === '`') {
        s.togglePresenter()
      } else if (e.key === 'Escape') {
        s.setInspect(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
