import { create } from 'zustand'
import { facts, type FactId } from '../config/content'

export type SceneId = 'orbit' | 'road' | 'mine' | 'water' | 'forest' | 'building' | 'loop'

export const sceneOrder: SceneId[] = ['orbit', 'road', 'mine', 'water', 'forest', 'building', 'loop']

export interface TickerItem {
  id: string
  at: number
  level: 'info' | 'ok' | 'alert'
  text: string
}

export interface JsonInspect {
  title: string
  subtitle?: string
  data: unknown
  /** Optional verification lines shown above the JSON. */
  checks?: { label: string; ok: boolean }[]
}

interface AppState {
  scene: SceneId
  /** Scene being transitioned to, while a transition runs. */
  pendingScene: SceneId | null
  autoplay: boolean
  hudVisible: boolean
  projector: boolean
  presenterOpen: boolean
  showPlaceNames: boolean
  /** 'timed': a simulated approver acts after a countdown. 'manual': waits for a click. */
  approvalMode: 'timed' | 'manual'
  /** Runtime visibility overrides keyed by fact id. */
  factOverrides: Partial<Record<FactId, boolean>>
  ticker: TickerItem[]
  inspect: JsonInspect | null

  goTo: (scene: SceneId) => void
  commitScene: () => void
  step: (delta: 1 | -1) => void
  setAutoplay: (on: boolean) => void
  toggleHud: () => void
  toggleProjector: () => void
  togglePresenter: () => void
  setShowPlaceNames: (on: boolean) => void
  setApprovalMode: (mode: 'timed' | 'manual') => void
  setFactVisible: (id: FactId, visible: boolean) => void
  pushTicker: (item: Omit<TickerItem, 'id' | 'at'>) => void
  setInspect: (inspect: JsonInspect | null) => void
}

let tickerSeq = 0

export const useApp = create<AppState>((set, get) => ({
  scene: initialScene(),
  pendingScene: null,
  autoplay: false,
  hudVisible: true,
  projector: false,
  presenterOpen: false,
  showPlaceNames: true,
  approvalMode: 'timed',
  factOverrides: {},
  ticker: [],
  inspect: null,

  goTo: (scene) => {
    const { scene: current, pendingScene } = get()
    if (scene === current || pendingScene) return
    set({ pendingScene: scene, inspect: null })
  },
  commitScene: () => {
    const { pendingScene } = get()
    if (!pendingScene) return
    set({ scene: pendingScene, pendingScene: null })
    if (typeof window !== 'undefined') window.history.replaceState(null, '', `#${pendingScene}`)
  },
  step: (delta) => {
    const i = sceneOrder.indexOf(get().scene)
    const next = sceneOrder[(i + delta + sceneOrder.length) % sceneOrder.length]
    get().goTo(next)
  },
  setAutoplay: (autoplay) => set({ autoplay }),
  toggleHud: () => set((s) => ({ hudVisible: !s.hudVisible })),
  toggleProjector: () => set((s) => ({ projector: !s.projector })),
  togglePresenter: () => set((s) => ({ presenterOpen: !s.presenterOpen })),
  setShowPlaceNames: (showPlaceNames) => set({ showPlaceNames }),
  setApprovalMode: (approvalMode) => set({ approvalMode }),
  setFactVisible: (id, visible) => set((s) => ({ factOverrides: { ...s.factOverrides, [id]: visible } })),
  pushTicker: (item) =>
    set((s) => ({
      ticker: [{ ...item, id: `t${++tickerSeq}`, at: Date.now() }, ...s.ticker].slice(0, 30),
    })),
  setInspect: (inspect) => set({ inspect }),
}))

function initialScene(): SceneId {
  if (typeof window === 'undefined') return 'orbit'
  const hash = window.location.hash.replace('#', '') as SceneId
  return sceneOrder.includes(hash) ? hash : 'orbit'
}

/** Returns the fact text, or null when the fact is hidden. */
export function useFact(id: FactId): string | null {
  const override = useApp((s) => s.factOverrides[id])
  const f = facts[id]
  const visible = override ?? f.visible
  return visible ? f.text : null
}

/** Returns the place name, or null when place names are hidden. */
export function usePlaceName(name: string): string | null {
  const show = useApp((s) => s.showPlaceNames)
  return show ? name : null
}
