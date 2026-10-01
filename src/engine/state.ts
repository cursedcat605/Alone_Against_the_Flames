/**
 * 游戏状态机：进入节点、结算事件、组装「本节点能做什么」。
 *
 * 全程纯函数：每个导出函数接收 state，返回**新** state，不修改入参。
 * 因此自动通关测试可以在 Node 里把 state 当作可分支的游戏树来遍历。
 */

import { SCENES } from './content'
import { evalCondition, describeCondition, conditionIsKnown } from './conditions'
import { applyEffects, selectEffects } from './effects'
import { resolveCheck, type CheckResolution } from './dice'
import { resolveTarget } from './names'
import { createRng, type RngState } from './rng'
import {
  DIFFICULTY_LABELS,
  LEVEL_LABELS,
  type CheckOffer,
  type ChoiceOffer,
  type GameState,
  type Interaction,
  type LogEntry,
  type LogKind,
  type Scene,
  type SceneLink,
} from './types'

/** 存档结构版本。字段改动时 +1，并在 save.ts 里加迁移分支。 */
export const STATE_VERSION = 1

/** 原书的入口条目。 */
export const START_NODE = 1

/** 日志上限。存档要能塞进 localStorage，所以必须有上限。 */
const MAX_LOG = 400

/**
 * 跳转引导语的噪声表。
 * 解析器把「现在转到 154。」的引导语残留成了 label='现在'（见解析报告）。
 * 这些词没有信息量，UI 里显示成「继续」比显示「现在」更清楚。
 */
const NOISE_LABELS = new Set([
  '现在',
  '然后',
  '之后',
  '接着',
  '于是',
  '那么',
  '此时',
  '这时',
  '而后',
  '随后',
  '就',
  '你',
  '如果',
  '若',
])

// --- RNG 桥接 ------------------------------------------------------------

/**
 * 把 `rngState: number` 包成 RngState 对象给骰子用，用完必须 `commit` 回去。
 * 拆成两个函数是为了让「忘记写回」这件事在代码里一眼看得出来。
 */
export function rngOf(state: GameState): RngState {
  return { s: state.rngState }
}

export function commit(state: GameState, rng: RngState): GameState {
  return { ...state, rngState: rng.s }
}

export function pushKey(nodeId: number, checkIndex: number): string {
  return `${nodeId}:${checkIndex}`
}

// --- 日志 ----------------------------------------------------------------

function appendLog(state: GameState, kind: LogKind, text: string, nodeId: number | null): GameState {
  const entry: LogEntry = { seq: state.logSeq + 1, kind, nodeId, text }
  const log = [...state.log, entry]
  return {
    ...state,
    logSeq: entry.seq,
    log: log.length > MAX_LOG ? log.slice(log.length - MAX_LOG) : log,
  }
}

export function resetLog(state: GameState): GameState {
  return appendLog({ ...state, log: [], logSeq: 0 }, 'system', '—— 重新开始 ——', state.nodeId)
}

// --- 节点 ----------------------------------------------------------------

export function currentScene(state: GameState): Scene | undefined {
  return SCENES.byId.get(state.nodeId)
}

export function sceneById(id: number): Scene | undefined {
  return SCENES.byId.get(id)
}

/** 进入节点：追加场景文本、首次进入结算效果、判定结局。 */
function enter(rng: RngState, state: GameState, nodeId: number): GameState {
  const scene = SCENES.byId.get(nodeId)
  if (!scene) {
    // 解析报告里的「断链」。如实报错而不是静默吞掉，否则玩家会卡在空白页。
    // 用 interrupted 而不是 death：这是书缺页，不是角色死了。
    return appendLog(
      { ...state, ended: { kind: 'interrupted', nodeId } },
      'system',
      `⚠ 剧本里跳转到了不存在的条目 ${nodeId}。这是原始文本的内容缺口，不是你的操作失误。`,
      state.nodeId,
    )
  }

  const first = !state.visited[nodeId]
  const visited = { ...state.visited, [nodeId]: (state.visited[nodeId] ?? 0) + 1 }

  let next: GameState = { ...state, nodeId, visited, turn: state.turn + 1, ended: null }
  next = appendLog(next, 'scene', scene.display || scene.text, nodeId)

  if (first) {
    const onEnter = selectEffects(scene.effects, null)
    if (onEnter.length > 0) {
      const res = applyEffects(rng, next.char, onEnter)
      next = { ...next, char: res.char }
      for (const note of res.notes) next = appendLog(next, 'effect', note, nodeId)
    }
  }

  if (scene.kind === 'ending') {
    next = { ...next, ended: { kind: 'ending', nodeId } }
    next = appendLog(next, 'system', '【剧终】', nodeId)
  } else if (scene.kind === 'dead_end') {
    // 没有任何出口、也没有【剧终】：原书这一条在转换里被截断了（见解析报告）。
    // 不在这里收官的话，玩家会停在一块没有按钮的界面上 —— 比「死」更糟。
    next = { ...next, ended: { kind: 'interrupted', nodeId } }
    next = appendLog(
      next,
      'system',
      `⚠ 条目 ${nodeId} 在原书里没有出口（正文可能被截断）。冒险无法继续，这是原始文本的内容缺口。`,
      nodeId,
    )
  } else if (next.char.dying) {
    next = { ...next, ended: { kind: 'death', nodeId } }
    next = appendLog(next, 'system', '你倒下了。冒险到此为止。', nodeId)
  }

  return next
}

export function createGame(char: GameState['char'], seed: number): GameState {
  const base: GameState = {
    version: STATE_VERSION,
    seed,
    rngState: createRng(seed).s,
    turn: 0,
    nodeId: 0,
    char,
    visited: {},
    log: [],
    logSeq: 0,
    pushUsed: {},
    ended: null,
  }
  const rng = rngOf(base)
  return commit(enter(rng, base, START_NODE), rng)
}

// --- 选项文案 ------------------------------------------------------------

function cleanLabel(label: string | null): string | null {
  if (!label) return null
  let s = label.trim()
  s = s.replace(/^[—\-–·\s]+/, '')
  s = s.replace(/[，,、：:。；;]+$/, '')
  s = s.replace(/^(如果|若|要是)/, '')
  s = s.replace(/的话$/, '')
  if (s.length < 2) return null
  if (NOISE_LABELS.has(s)) return null
  return s
}

function defaultLabel(link: SceneLink): string {
  if (link.outcome === 'success') return '（检定成功）'
  if (link.outcome === 'failure') return '（检定失败）'
  if (link.outcome === 'push') return '（孤注一掷的后果）'
  if (link.condition) return describeCondition(link.condition)
  return '继续'
}

// --- 交互组装 ------------------------------------------------------------

/**
 * 分析当前节点能做什么。
 *
 * 这是全项目最容易过度工程的一处。M1 的策略是**只在配对无歧义时自动结算**：
 *   - 纯条件分支（原书用属性直接分叉）→ 条件成立则自动继续
 *   - 恰好 1 个检定 + 恰好 1 条 success + ≤1 条 failure → 检定结果直接决定落点
 *   - 其他情况 → 所有链接都列成按钮，让玩家自己点
 * 宁可让玩家多点一次，也不要猜错配对把剧情引到错误的分支。
 */
export function analyze(state: GameState): Interaction {
  const scene = SCENES.byId.get(state.nodeId)
  if (!scene) {
    return {
      nodeId: state.nodeId,
      kind: 'dead_end',
      continueTo: null,
      checks: [],
      choices: [],
      blockers: [`条目 ${state.nodeId} 不在剧本里。这是解析报告里的「断链」。`],
    }
  }

  const char = state.char
  const checks: CheckOffer[] = []
  const choices: ChoiceOffer[] = []
  const blockers: string[] = []
  const consumed = new Set<number>()
  let continueTo: number | null = null

  const indexOf = (link: SceneLink) => scene.links.indexOf(link)
  const condLinks = scene.links.filter((l) => l.condition)
  const outcomeLinks = scene.links.filter((l) => !l.condition && l.outcome)
  const plainLinks = scene.links.filter((l) => !l.condition && !l.outcome)

  // (1) 纯条件分支
  if (condLinks.length > 0 && plainLinks.length === 0 && outcomeLinks.length === 0) {
    const hit = condLinks.find((l) => evalCondition(char, l.condition!))
    if (hit) {
      return {
        nodeId: scene.id,
        kind: scene.kind,
        continueTo: hit.to,
        checks: [],
        choices: [],
        blockers: [],
      }
    }
    blockers.push(
      `本条目按属性分流，但没有一条条件成立：` +
        condLinks.map((l) => describeCondition(l.condition!)).join('、') +
        '。请检查角色属性，或从下面的分支里手动选择。',
    )
    for (const l of condLinks) {
      consumed.add(indexOf(l))
      choices.push({ index: indexOf(l), label: describeCondition(l.condition!), to: l.to })
    }
  }

  for (const l of condLinks) {
    if (!conditionIsKnown(l.condition!.attr)) {
      blockers.push(`条件引用了未知属性「${l.condition!.attr}」→ 无法自动判定。`)
    }
  }

  // (2) 单一检定的自动结算
  const successes = outcomeLinks.filter((l) => l.outcome === 'success')
  const failures = outcomeLinks.filter((l) => l.outcome === 'failure')
  const pushes = outcomeLinks.filter((l) => l.outcome === 'push')
  const auto = scene.checks.length === 1 && successes.length === 1 && failures.length <= 1

  for (let i = 0; i < scene.checks.length; i++) {
    const check = scene.checks[i]
    const info = resolveTarget(char, check.skill)
    const main = i === 0
    const resolvable = auto && main

    if (info.kind === 'unknown') {
      blockers.push(
        `检定用的「${check.skill}」不在技能表里，目标值按 0 计算（必失败）。` +
          `这属于内容缺口，请在 skills.json 的 aliases 里补映射。`,
      )
    }

    checks.push({
      index: i,
      label: `${info.label}｜${DIFFICULTY_LABELS[check.difficulty] ?? check.difficulty}检定`,
      targetName: info.key,
      targetLabel: info.label,
      target: info.value,
      difficulty: check.difficulty,
      successTo: resolvable ? (successes[0]?.to ?? null) : null,
      failureTo: resolvable ? (failures[0]?.to ?? null) : null,
      pushTo: main ? (pushes[0]?.to ?? null) : null,
      ambiguous: !resolvable,
    })
  }

  if (auto) {
    consumed.add(indexOf(successes[0]))
    if (failures[0]) consumed.add(indexOf(failures[0]))
  }

  // (3) 剩下的链接全部作为按钮
  for (let i = 0; i < scene.links.length; i++) {
    if (consumed.has(i)) continue
    const link = scene.links[i]
    choices.push({
      index: i,
      label: cleanLabel(link.label) ?? defaultLabel(link),
      to: link.to,
      ...(link.condition ? { conditionText: describeCondition(link.condition) } : {}),
      ...(link.outcome ? { outcome: link.outcome } : {}),
    })
  }

  if (choices.length === 0 && checks.length === 0) {
    blockers.push('本条目在原书里没有任何出口（解析报告的「无出口」）。这是原始文本的内容缺口。')
  } else if (choices.length === 1 && checks.length === 0 && !choices[0].conditionText) {
    // 唯一出口 → 收缩成一个「继续」按钮，不要玩家在一堆噪音里找
    continueTo = choices[0].to
    choices.length = 0
  }

  return {
    nodeId: scene.id,
    kind: scene.kind,
    continueTo,
    checks,
    // 同一个缺口可能在多个分支上被提到，去重后再交给 UI
    blockers: [...new Set(blockers)],
    choices,
  }
}

// --- 操作 ----------------------------------------------------------------

export interface CheckOutcome {
  state: GameState
  resolution: CheckResolution
  targetLabel: string
  /** null = 该检定在原文里没有配对的分支，玩家需要手动选 */
  destination: number | null
  pushed: boolean
  summary: string
}

/** 孤注一掷的规则限制：战斗与理智检定不能重掷（rules.json 的 quickRules.push）。 */
export function canPush(state: GameState, offer: CheckOffer): boolean {
  if (state.pushUsed[pushKey(state.nodeId, offer.index)]) return false
  if (offer.pushTo !== null) return true
  const info = resolveTarget(state.char, offer.targetName)
  if (info.key === 'SAN' || info.kind === 'derived') return false
  if (info.key.startsWith('格斗') || info.key.startsWith('射击')) return false
  return true
}

/**
 * 结算某个条目里「前提是检定成功 / 失败」的效果。
 *
 * 只能在 performCheck 里调用，不能放进 enter：判定结果只在这里存在。
 * 漏掉这一步的后果不是「少扣一点血」，而是条目 171 那种结局**一点都不扣**，
 * 或者反向的：两条分支的效果一起结算（成功扣 1 点 + 失败扣 1D4 点 = 扣 1+1D4）。
 *
 * 关于孤注一掷：本函数的入参是**最终**结果。若玩家先失败、孤注一掷后又失败，
 * 失败效果会结算两次。当前剧本里带失败前提的检定都是理智检定，而理智检定
 * 本来就禁止孤注一掷（见 canPush），所以不会发生；playthrough 测试里有一条
 * 不变量盯着这个前提，剧本一旦变化就会报警。
 */
function applyOutcomeEffects(
  rng: RngState,
  state: GameState,
  nodeId: number,
  passed: boolean,
): GameState {
  const scene = SCENES.byId.get(nodeId)
  if (!scene) return state
  const picked = selectEffects(scene.effects, passed ? 'success' : 'failure')
  if (picked.length === 0) return state
  const res = applyEffects(rng, state.char, picked)
  let next: GameState = { ...state, char: res.char }
  for (const note of res.notes) next = appendLog(next, 'effect', note, nodeId)
  return next
}

export function performCheck(
  state: GameState,
  offer: CheckOffer,
  opts: { push?: boolean; bonus?: number; penalty?: number } = {},
): CheckOutcome {
  const rng = rngOf(state)
  const resolution = resolveCheck(rng, offer.target, offer.difficulty, {
    bonus: opts.bonus,
    penalty: opts.penalty,
  })

  const bonusText =
    resolution.roll.bonus > 0
      ? `（奖励骰 ×${resolution.roll.bonus}）`
      : resolution.roll.penalty > 0
        ? `（惩罚骰 ×${resolution.roll.penalty}）`
        : ''
  const summary =
    `${opts.push ? '【孤注一掷】' : ''}${offer.targetLabel} ` +
    `${resolution.roll.value}${bonusText} / ${offer.target} → ${LEVEL_LABELS[resolution.level]}`

  let next = appendLog(state, 'check', summary, state.nodeId)

  if (opts.push) {
    next = { ...next, pushUsed: { ...next.pushUsed, [pushKey(state.nodeId, offer.index)]: true } }
  }

  let destination: number | null
  if (opts.push && !resolution.passed) {
    destination = offer.pushTo ?? offer.failureTo
  } else if (resolution.passed) {
    destination = offer.successTo
  } else {
    destination = offer.failureTo
  }

  if (destination === null) {
    next = appendLog(
      next,
      'system',
      '这次检定在原书里没有配对的分支。请从下面的选项里选一个继续 —— 属于内容缺口，请人工确认。',
      state.nodeId,
    )
    // 没有分支不代表没有后果：原书常写「如果失败，失去 1D4 点理智值」而两条路是同一条。
    next = applyOutcomeEffects(rng, next, state.nodeId, resolution.passed)
    return {
      state: commit(next, rng),
      resolution,
      targetLabel: offer.targetLabel,
      destination: null,
      pushed: Boolean(opts.push),
      summary,
    }
  }

  next = applyOutcomeEffects(rng, next, state.nodeId, resolution.passed)
  next = enter(rng, next, destination)
  return {
    state: commit(next, rng),
    resolution,
    targetLabel: offer.targetLabel,
    destination,
    pushed: Boolean(opts.push),
    summary,
  }
}

/** 点一个选项/链接前进。 */
export function chooseLink(state: GameState, index: number): GameState {
  const scene = SCENES.byId.get(state.nodeId)
  const link = scene?.links[index]
  if (!link) return state
  const rng = rngOf(state)
  const next = enter(rng, state, link.to)
  return commit(next, rng)
}

/** 「继续」按钮。 */
export function continueForward(state: GameState, interaction: Interaction): GameState {
  const target = interaction.continueTo
  if (target === null) return state
  const rng = rngOf(state)
  return commit(enter(rng, state, target), rng)
}

/**
 * 手动改角色数值。规则自动化的边界必须透明：
 * 解析器会把「黑熊的爪击造成 2D6 点伤害」误判成玩家受伤，
 * 所以面板上永远要留一个「自己改」的出口。
 */
export function patchCharacter(state: GameState, patch: Partial<GameState['char']>): GameState {
  return { ...state, char: { ...state.char, ...patch } }
}
