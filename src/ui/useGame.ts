/**
 * 把引擎接到 React 上。
 *
 * 唯一的状态源是 `GameState`；UI 不缓存引擎的派生结果，
 * 每次 `state` 变化都重新 `analyze()`。这样「自动结算/手动选择」的判定
 * 只有一份实现（在 engine/state.ts 里），UI 不可能和引擎不一致。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { createPrebuiltCharacter, createRandomCharacter } from '../engine/character'
import { createRng } from '../engine/rng'
import {
  AUTO_SLOT,
  DEFAULT_SETTINGS,
  exportSave,
  importSave,
  loadGame,
  loadSettings,
  saveGame,
  saveSettings,
  type Settings,
} from '../engine/save'
import {
  analyze,
  canPush,
  chooseLink,
  continueForward,
  createGame,
  patchCharacter,
  performCheck,
  type CheckOutcome,
} from '../engine/state'
import type { CheckOffer, GameState, Interaction } from '../engine/types'

export type Screen = 'menu' | 'create' | 'play'

/** 给新开局用的随机种子。存进存档后可以据此复现整局骰点。 */
export function freshSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff) || 1
}

export interface CreateOptions {
  mode: 'prebuilt' | 'random'
  seed: number
  name?: string
  age?: number
  occupationId?: number
}

export interface GameApi {
  screen: Screen
  state: GameState | null
  interaction: Interaction | null
  settings: Settings
  /** 建卡过程的明细（掷了什么属性、点数怎么分的），开局后也要能回看 */
  creationNotes: string[]
  toast: string | null
  lastCheck: CheckOutcome | null
  autosaveError: string | null

  goMenu: () => void
  goCreate: () => void
  start: (opts: CreateOptions) => void
  loadFromSlot: (slot: number) => void
  clearToast: () => void

  roll: (offer: CheckOffer, opts?: { push?: boolean; bonus?: number; penalty?: number }) => void
  choose: (index: number) => void
  next: () => void
  editCharacter: (patch: Partial<GameState['char']>) => void
  pushable: (offer: CheckOffer) => boolean

  saveToSlot: (slot: number, manual?: boolean) => void
  readExport: () => string
  loadFromText: (text: string) => void
  updateSettings: (patch: Partial<Settings>) => void
}

export function useGame(): GameApi {
  const [screen, setScreen] = useState<Screen>('menu')
  const [state, setState] = useState<GameState | null>(null)
  const [settings, setSettings] = useState<Settings>(() => ({ ...DEFAULT_SETTINGS, ...loadSettings() }))
  const [creationNotes, setCreationNotes] = useState<string[]>([])
  const [toast, setToast] = useState<string | null>(null)
  const [lastCheck, setLastCheck] = useState<CheckOutcome | null>(null)
  const [autosaveError, setAutosaveError] = useState<string | null>(null)

  const interaction = useMemo(() => (state ? analyze(state) : null), [state])

  const stateRef = useRef<GameState | null>(null)
  stateRef.current = state

  // 自动存档。放在 effect 里而不是每个操作里，避免漏挂点。
  useEffect(() => {
    if (!state || screen !== 'play') return
    const res = saveGame(AUTO_SLOT, state)
    setAutosaveError(res.ok ? null : (res.error ?? '自动存档失败'))
  }, [state, screen])

  const start = useCallback((opts: CreateOptions) => {
    if (opts.mode === 'prebuilt') {
      const char = createPrebuiltCharacter()
      setCreationNotes(['使用规则书里的预生成调查员：夏洛特·范德米尔（私家侦探）'])
      setState(createGame(char, opts.seed))
      setLastCheck(null)
      setScreen('play')
      return
    }

    const rng = createRng(opts.seed)
    const { character, notes } = createRandomCharacter(rng, {
      ...(opts.name ? { name: opts.name } : {}),
      ...(opts.age ? { age: opts.age } : {}),
      ...(opts.occupationId ? { occupationId: opts.occupationId } : {}),
    })
    setCreationNotes(notes)
    setState(createGame(character, opts.seed))
    setLastCheck(null)
    setScreen('play')
  }, [])

  const loadFromSlot = useCallback((slot: number) => {
    const loaded = loadGame(slot)
    if (!loaded) {
      setToast('这个存档位是空的，或者版本不兼容。')
      return
    }
    setState(loaded)
    setLastCheck(null)
    setCreationNotes([`从存档位 ${slot} 读取。种子 ${loaded.seed} —— 之后每次掷骰都和当时一致。`])
    setScreen('play')
  }, [])

  const goMenu = useCallback(() => {
    setState(null)
    setLastCheck(null)
    setScreen('menu')
  }, [])

  const goCreate = useCallback(() => setScreen('create'), [])

  const roll = useCallback(
    (offer: CheckOffer, opts: { push?: boolean; bonus?: number; penalty?: number } = {}) => {
      const current = stateRef.current
      if (!current) return
      const outcome = performCheck(current, offer, opts)
      setState(outcome.state)
      setLastCheck(outcome)
      if (outcome.destination === null) {
        setToast('这个检定在原文里没有配对的分支，请手动选择下面的选项。')
      }
    },
    [],
  )

  const choose = useCallback((index: number) => {
    const current = stateRef.current
    if (!current) return
    setState(chooseLink(current, index))
    setLastCheck(null)
  }, [])

  const next = useCallback(() => {
    const current = stateRef.current
    if (!current) return
    const info = analyze(current)
    if (info.continueTo === null) {
      setToast('这里没有唯一的出口，请从选项里选一个。')
      return
    }
    setState(continueForward(current, info))
    setLastCheck(null)
  }, [])

  const editCharacter = useCallback((patch: Partial<GameState['char']>) => {
    const current = stateRef.current
    if (!current) return
    setState(patchCharacter(current, patch))
  }, [])

  const pushable = useCallback(
    (offer: CheckOffer) => {
      const current = stateRef.current
      return current ? canPush(current, offer) : false
    },
    [],
  )

  const saveToSlot = useCallback((slot: number, manual = true) => {
    const current = stateRef.current
    if (!current) return
    const res = saveGame(slot, current)
    setToast(res.ok ? (manual ? `已存入存档位 ${slot}。` : '已自动存档。') : (res.error ?? '存档失败'))
  }, [])

  const readExport = useCallback(() => {
    const current = stateRef.current
    return current ? exportSave(current) : ''
  }, [])

  const loadFromText = useCallback((text: string) => {
    const res = importSave(text)
    if (res.error || !res.state) {
      setToast(res.error ?? '导入失败。')
      return
    }
    setState(res.state)
    setLastCheck(null)
    setScreen('play')
    setToast('存档导入成功。')
  }, [])

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const merged = { ...prev, ...patch }
      saveSettings(merged)
      return merged
    })
  }, [])

  return {
    screen,
    state,
    interaction,
    settings,
    creationNotes,
    toast,
    lastCheck,
    autosaveError,
    goMenu,
    goCreate,
    start,
    loadFromSlot,
    clearToast: () => setToast(null),
    roll,
    choose,
    next,
    editCharacter,
    pushable,
    saveToSlot,
    readExport,
    loadFromText,
    updateSettings,
  }
}
