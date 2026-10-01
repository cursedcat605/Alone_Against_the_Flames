/**
 * 存档：localStorage + 版本迁移 + 导入导出。
 *
 * 设计要点：
 *   - **RNG 状态一起存**。读档之后骰点序列接着走，不能靠刷新页面重掷。
 *     这是「堵死 SL 大法」的核心，一旦漏存 rngState，玩家刷新就能重掷。
 *   - 存 `version`。字段结构变化时加迁移分支，而不是让旧存档把游戏弄崩。
 *   - 存档失败（配额满 / 隐私模式）必须返回结果给 UI，不能静默失败。
 */

import { STATE_VERSION } from './state'
import type { GameState } from './types'

const KEY_PREFIX = 'aaf.save.'
export const AUTO_SLOT = 0
export const MANUAL_SLOTS = [1, 2, 3]
export const ALL_SLOTS = [AUTO_SLOT, ...MANUAL_SLOTS]

const SETTINGS_KEY = 'aaf.settings.v1'

export interface SaveSlotInfo {
  slot: number
  savedAt: string
  label: string
  turn: number
  nodeId: number
  charName: string
  hp: number
  hpMax: number
  san: number
  seed: number
}

interface SaveFile {
  version: number
  savedAt: string
  state: GameState
}

function storage(): Storage | null {
  try {
    // 隐私模式下 getItem 本身可能抛错，所以这里也要 try
    const s = globalThis.localStorage
    if (!s) return null
    const probe = '__aaf_probe__'
    s.setItem(probe, '1')
    s.removeItem(probe)
    return s
  } catch {
    return null
  }
}

export function storageAvailable(): boolean {
  return storage() !== null
}

function slotKey(slot: number): string {
  return `${KEY_PREFIX}${slot}`
}

export function saveGame(slot: number, state: GameState): { ok: boolean; error?: string } {
  const store = storage()
  if (!store) return { ok: false, error: '浏览器不允许本地存储（隐私模式？），存档不可用。' }
  const file: SaveFile = {
    version: STATE_VERSION,
    savedAt: new Date().toISOString(),
    state,
  }
  try {
    store.setItem(slotKey(slot), JSON.stringify(file))
    return { ok: true }
  } catch (err) {
    return { ok: false, error: `写入存档失败：${err instanceof Error ? err.message : String(err)}` }
  }
}

/**
 * 迁移钩子。当前只有 v1，所以这里是「同版本直接过、其他版本拒绝」。
 * 以后加字段时在这里补 `if (file.version === 1) { ...改造成 v2... }`。
 */
function migrate(file: SaveFile): GameState | null {
  if (file.version !== STATE_VERSION) return null
  const state = file.state
  if (!state || typeof state.nodeId !== 'number' || !state.char) return null
  // 兼容旧字段缺失：补齐后再交给引擎
  return {
    ...state,
    version: STATE_VERSION,
    logSeq: state.logSeq ?? (state.log?.length ? state.log[state.log.length - 1].seq : 0),
    pushUsed: state.pushUsed ?? {},
    visited: state.visited ?? {},
    log: state.log ?? [],
    ended: state.ended ?? null,
  }
}

export function loadGame(slot: number): GameState | null {
  const store = storage()
  if (!store) return null
  const raw = store.getItem(slotKey(slot))
  if (!raw) return null
  try {
    const file = JSON.parse(raw) as SaveFile
    return migrate(file)
  } catch {
    return null
  }
}

export function deleteSave(slot: number): void {
  storage()?.removeItem(slotKey(slot))
}

export function readSlotInfo(slot: number): SaveSlotInfo | null {
  const store = storage()
  if (!store) return null
  const raw = store.getItem(slotKey(slot))
  if (!raw) return null
  try {
    const file = JSON.parse(raw) as SaveFile
    const state = file.state
    return {
      slot,
      savedAt: file.savedAt,
      label: slot === AUTO_SLOT ? '自动存档' : `存档 ${slot}`,
      turn: state.turn ?? 0,
      nodeId: state.nodeId,
      charName: state.char?.name ?? '?',
      hp: state.char?.hp ?? 0,
      hpMax: state.char?.hpMax ?? 0,
      san: state.char?.san ?? 0,
      seed: state.seed ?? 0,
    }
  } catch {
    return null
  }
}

export function listSaves(): (SaveSlotInfo | null)[] {
  return ALL_SLOTS.map((slot) => readSlotInfo(slot))
}

/** 导出成可复制/下载的文本。 */
export function exportSave(state: GameState): string {
  const file: SaveFile = {
    version: STATE_VERSION,
    savedAt: new Date().toISOString(),
    state,
  }
  return JSON.stringify(file, null, 2)
}

export function importSave(text: string): { state?: GameState; error?: string } {
  try {
    const file = JSON.parse(text) as SaveFile
    if (typeof file.version !== 'number' || !file.state) {
      return { error: '这不是一个有效的存档文件（缺少 version 或 state）。' }
    }
    const state = migrate(file)
    if (!state) return { error: `存档版本 ${file.version} 与当前版本 ${STATE_VERSION} 不兼容。` }
    return { state }
  } catch (err) {
    return { error: `解析存档失败：${err instanceof Error ? err.message : String(err)}` }
  }
}

// --- 设置 ----------------------------------------------------------------

export interface Settings {
  /** 正文逐字显示的延迟（毫秒/字），0 = 不用打字机效果 */
  typewriterMs: number
  /** 是否显示检定明细（骰点拆解） */
  verboseRolls: boolean
  /** 内容缺口提示：把解析器的警告显示在界面上 */
  showContentWarnings: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  typewriterMs: 12,
  verboseRolls: true,
  showContentWarnings: true,
}

export function loadSettings(): Settings {
  const store = storage()
  if (!store) return { ...DEFAULT_SETTINGS }
  try {
    const raw = store.getItem(SETTINGS_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(settings: Settings): void {
  try {
    storage()?.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    // 设置存不下不影响玩，静默忽略
  }
}
