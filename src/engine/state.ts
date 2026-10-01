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
  if (link.outcome === 'fumble') return '（大失败）'
  if (link.outcome === 'push') return '（孤注一掷的后果）'
  if (link.outcome === 'always') return '（检定之后继续）'
  if (link.condition) return describeCondition(link.condition)
  return '继续'
}

// --- 交互组装 ------------------------------------------------------------

/**
 * 分析当前节点能做什么。
 *
 * 策略是**只在配对无歧义时自动结算**：
 *   - 纯条件分支（原书用属性直接分叉）→ 条件成立则自动继续
 *   - 恰好 1 个检定、每组结果（成功/失败/大失败/孤注一掷/兜底）至多 1 条链接
 *     → 掷骰结果直接决定落点，不看玩家的选择
 *   - 其他情况 → 所有链接都列成按钮，让玩家自己点
 *
 * 宁可让玩家多点一次，也不要猜错配对把剧情引到错误的分支。但反过来也成立：
 * 凡是能定的就必须定下来，不能把「你自己判通没通过」这种活推给玩家。
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
  //
  // 掷完骰子就该把玩家带走，不能让他自己判「通没通过」——那是引擎的活，让玩家
  // 来判等于把规则扔了。凡是**配对无歧义**的条目一律自动结算：唯一的检定 +
  // 每组结果至多一条链接。解析器认全了原文的五种写法（成功/失败、通过/没有
  // 通过、胜出/落败、大失败、孤注一掷），外加「兜底出口」——原文只写后果、
  // 不写两条路的条目（条目 52「如果你失败了……现在转到 64」），成功失败同路。
  //
  // 仍然猜不出来的只有两种，都如实交给玩家自己点（宁可吵，不可静）：
  //   - 两个以上检定，无法判断哪条链接配哪个检定
  //   - 原书按别的量分叉（条目 262 的近身战斗按双方 HP 分叉）
  const successes = outcomeLinks.filter((l) => l.outcome === 'success')
  const failures = outcomeLinks.filter((l) => l.outcome === 'failure')
  const fumbles = outcomeLinks.filter((l) => l.outcome === 'fumble')
  const pushes = outcomeLinks.filter((l) => l.outcome === 'push')
  const always = outcomeLinks.filter((l) => l.outcome === 'always')
  const groups = [successes, failures, fumbles, pushes, always]
  const routable = scene.checks.length === 1 && groups.every((g) => g.length <= 1)

  const successTo = routable ? (successes[0]?.to ?? always[0]?.to ?? null) : null
  const failureTo = routable ? (failures[0]?.to ?? always[0]?.to ?? null) : null
  // 大失败退回普通失败：原文只在少数条目（110/208）单写了大失败的落点，
  // 其余条目掷出 96+ 就该走「没有通过」那条路。
  const fumbleTo = routable ? (fumbles[0]?.to ?? failureTo) : null
  const pushTo = routable ? (pushes[0]?.to ?? null) : null
  const alwaysTo = routable ? (always[0]?.to ?? null) : null
  // 检定摆在一条出口都没有的条目上（结局/断点）：没得选，掷骰只为结算效果。
  const nothingToPick = scene.checks.length > 0 && scene.links.length === 0

  for (let i = 0; i < scene.checks.length; i++) {
    const check = scene.checks[i]
    const info = resolveTarget(char, check.skill)

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
      successTo,
      failureTo,
      fumbleTo,
      pushTo,
      alwaysTo,
      // 一条结果都定不下来才算「歧义」。只定下成功不算：失败之后原书可能给了
      // 玩家几个去处（条目 266），那种情况掷完骰子照样自动走成功那条路，
      // 只有失败时才把原文的选项摆出来。
      ambiguous: !nothingToPick && successTo === null && failureTo === null,
    })
  }

  if (!nothingToPick && routable && successTo === null && failureTo === null) {
    blockers.push(
      '本条目摆了检定，但原文没写任何一条结果去往哪里，也没有兜底出口。' +
        '掷完骰子只能在下面的分支里手动选 —— 属于内容缺口，请核对原文。',
    )
  }

  if (routable) {
    for (const g of groups) {
      if (g[0]) consumed.add(indexOf(g[0]))
    }
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
  /**
   * 掷骰之后的落点，null = 原文没给唯一分支，需要玩家手动选。
   * 正常剧本里 null 只应当出现在解析报告「掷骰后仍需玩家自己选」列出的条目上。
   */
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
  } else if (resolution.level === 'fumble') {
    // 大失败是独立落点（原文单独写了「如果掷出大失败」），不是普通失败。
    // 条目 110/208 都是这个结构：少了这一支，玩家会走进普通失败的文案。
    destination = offer.fumbleTo ?? offer.failureTo
  } else {
    destination = offer.failureTo
  }

  if (destination === null) {
    next = appendLog(
      next,
      'system',
      '这次检定原书没有指定唯一的下一站（原书按别的条件分叉），' +
        '已按掷骰结果结算效果，请从下面的选项里选一个继续。',
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
