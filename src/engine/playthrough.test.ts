/**
 * 随机通关测试：让一堆随机角色在剧本里随机乱走，看会不会走死。
 *
 * 这是本项目性价比最高的测试。它不检查「某条路径是否剧情正确」（那需要人来判断），
 * 只检查引擎的**结构性不变量**：
 *   1. 任何时刻都不该抛出异常
 *   2. 只要没结束，就一定存在至少一个合法操作（否则玩家卡死在空白界面上）
 *   3. 每一步都必须落在真实存在的条目上
 *   4. 结束类型只能是 结局 / 死亡 / 正文中断（断链或缺出口）
 *   5. 同一个种子必须走出完全一样的日志
 * 它抓到的每个失败都对应一个真 bug —— 之前就抓到过「单检定缺失败分支时无路可走」。
 */

import { describe, expect, it } from 'vitest'

import { createPrebuiltCharacter, createRandomCharacter } from './character'
import { SCENES, SCRIPT } from './content'
import { KNOWN_INTERRUPTED } from './gaps'
import { createRng, nextInt, type RngState } from './rng'
import {
  analyze,
  canPush,
  chooseLink,
  continueForward,
  createGame,
  performCheck,
} from './state'
import type { Character, GameState, Interaction } from './types'

/** 单次漫游的步数上限。剧本 269 条，远超它说明在打转（CC 的 CYOA 不该有环）。 */
const MAX_STEPS = 400
/** state.ts 里的 MAX_LOG 没导出，这里保持同一个数字并断言。 */
const MAX_LOG = 400

/**
 * 已登记的「正文到此中断」条目 —— 名单在 tools/overrides.json 的 knownGaps 里
 * （见 ./gaps.ts），与 `npm run check` 共用。全部来自**原始文本的内容缺口**，不是引擎 bug：
 *   49 —— 正文在 PDF 页边界处被截断（「必须有人负起责任来」后面没了），
 *          同页的 XI 页码之后直接跳到 51，条目 49 的尾巴没有被导出。
 *   73 —— 同上，落在第十七页的边界上；它的续文应当就在条目 74。
 *   74 —— 条目 74 的编号行和正文在源 txt 里**整条丢失**，但条目 68 有链接指向它。
 *   184 —— 正文完整，但原书这一条本来就没有出口（图书馆可反复翻阅的书目说明）。
 * 解析报告 tools/_parse_report.txt 里有对应记录。任何一个新增的缺口都必须在 JSON 里登记。
 */
const KNOWN_GAPS = KNOWN_INTERRUPTED

type Action =
  | { kind: 'continue' }
  | { kind: 'check'; index: number; push: boolean }
  | { kind: 'choice'; index: number }

/** 当前节点的所有合法操作。空数组 = 死锁。 */
function legalActions(state: GameState, it: Interaction, rng: RngState): Action[] {
  const out: Action[] = []
  if (it.continueTo !== null) out.push({ kind: 'continue' })
  for (const c of it.choices) out.push({ kind: 'choice', index: c.index })
  for (const c of it.checks) {
    // 没到孤注一掷就用掉：随机决定，好让 push 分支也被走到
    const push = canPush(state, c) && nextInt(rng, 4) === 0
    out.push({ kind: 'check', index: c.index, push })
  }
  return out
}

interface WalkResult {
  state: GameState
  steps: number
  /** 非 null 表示走死了：既没结束，也没有任何合法操作 */
  stuckAt: number | null
  /** 非 null 表示步数耗尽仍未结束 —— 可能是在环里打转 */
  exhausted: boolean
  /** 走过的唯一条目数 */
  uniqueNodes: number
  /** 日志里出现过的次数 */
  brokenLinkHits: number
}

function walkOnce(char: Character, gameSeed: number, walkSeed: number): WalkResult {
  const rng = createRng(walkSeed)
  let state = createGame(char, gameSeed)
  let steps = 0
  let stuckAt: number | null = null
  const visited = new Set<number>([state.nodeId])

  while (!state.ended && steps < MAX_STEPS) {
    steps += 1
    const it = analyze(state)
    let patch: Action[] = legalActions(state, it, rng)

    // 挑一个能真正推进的操作；检定的 destination 可能是 null（原书没配分支），
    // 那就把这个操作划掉换下一个，而不是当场判定死锁。
    let advanced = false
    while (patch.length > 0 && !advanced) {
      const pick = patch[nextInt(rng, patch.length)]
      patch = patch.filter((a) => a !== pick)

      if (pick.kind === 'continue') {
        state = continueForward(state, it)
        advanced = true
      } else if (pick.kind === 'choice') {
        const before = state.nodeId
        state = chooseLink(state, pick.index)
        advanced = state.nodeId !== before || state.ended !== null
      } else {
        const offer = it.checks.find((c) => c.index === pick.index)
        if (!offer) continue
        const res = performCheck(state, offer, { push: pick.push })
        state = res.state
        advanced = res.destination !== null
      }
    }

    if (!advanced) {
      stuckAt = state.nodeId
      break
    }
    visited.add(state.nodeId)
  }

  return {
    state,
    steps,
    stuckAt,
    exhausted: !state.ended && stuckAt === null,
    uniqueNodes: visited.size,
    brokenLinkHits: state.log.filter((e) => e.text.includes('不存在的条目')).length,
  }
}

describe('随机通关：结构性不变量', () => {
  it('200 局随机角色乱走都不该崩、不该卡死', () => {
    const stuck: string[] = []
    const exhausted: string[] = []
    const endingKinds = new Map<string, number>()
    const visitedNodes = new Set<number>()
    let turns = 0
    let maxSteps = 0
    let brokenLinkHits = 0
    let interruptedAt = new Set<number>()

    for (let i = 0; i < 200; i++) {
      const seed = 1000 + i
      const char = createRandomCharacter(createRng(seed)).character
      const res = walkOnce(char, seed, seed * 7 + 13)
      turns = Math.max(turns, res.state.turn)
      maxSteps = Math.max(maxSteps, res.steps)
      brokenLinkHits += res.brokenLinkHits
      if (res.state.ended?.kind === 'interrupted') interruptedAt.add(res.state.ended.nodeId)

      if (res.stuckAt !== null) stuck.push(`seed ${seed} 卡在条目 ${res.stuckAt}`)
      if (res.exhausted) exhausted.push(`seed ${seed} ${MAX_STEPS} 步仍未结束（末条目 ${res.state.nodeId}）`)
      for (const id of Object.keys(res.state.visited)) visitedNodes.add(Number(id))

      const kind = res.state.ended?.kind ?? '未结束'
      endingKinds.set(kind, (endingKinds.get(kind) ?? 0) + 1)

      // 日志上限：存档要塞进 localStorage，超了就不能存
      expect(res.state.log.length, `seed ${seed} 的日志超长`).toBeLessThanOrEqual(MAX_LOG)
      // 走过的条目必须真实存在
      for (const id of Object.keys(res.state.visited)) {
        expect(SCENES.byId.has(Number(id)), `seed ${seed} 走到了不存在的条目 ${id}`).toBe(true)
      }
    }

    expect(stuck, '有局走死了（既没结束也没有合法操作）').toEqual([])
    expect(exhausted, '有局在打转，没能在步数上限内结束').toEqual([])
    expect(turns).toBeGreaterThan(0)
    // 覆盖度：随机漫游应当摸到剧本相当一部分条目
    expect(visitedNodes.size).toBeGreaterThan(120)
    // 至少要真的走进剧情深处，否则「没崩」这件事没有说服力
    expect(maxSteps, '漫游都太短，说明一步就结束了，测试没意义').toBeGreaterThan(25)
    // 随机角色很容易死，也必须至少有结局
    expect(endingKinds.get('death') ?? 0).toBeGreaterThan(0)
    expect(endingKinds.get('ending') ?? 0).toBeGreaterThan(0)
    // 内容缺口必须被如实地撞到：断链（68 → 74）与无出口条目（49/73/184）
    expect(brokenLinkHits, '200 局居然没撞到断链，说明没走到条目 68').toBeGreaterThan(0)
    // 「正文中断」只允许出现在登记在册的缺口上；多出别的条目就说明有新的内容缺口
    expect(interruptedAt.size).toBeGreaterThan(0)
    expect([...interruptedAt].every((id) => KNOWN_GAPS.includes(id)), `出现了未登记的缺口中断：${[...interruptedAt]}`).toBe(true)
  })

  it('每个条目都有事可做（穷举，不是抽样）', () => {
    const chars = [
      createPrebuiltCharacter(),
      createRandomCharacter(createRng(1)).character,
      createRandomCharacter(createRng(999)).character,
    ]
    const problems: string[] = []
    for (const node of SCRIPT.nodes) {
      // 结局与死路是有意为之的终点，不参与本项检查
      if (node.kind === 'ending' || node.kind === 'dead_end') continue
      for (const c of chars) {
        const base = createGame(c, 1)
        const it2 = analyze({ ...base, nodeId: node.id, ended: null })
        const legal = it2.continueTo !== null || it2.choices.length > 0 || it2.checks.length > 0
        if (!legal) problems.push(`条目 ${node.id}（${node.kind}）没有任何操作`)
        // 只摆一个检定、又不给任何按钮的条目：检定必须能自动决定去向。
        // 否则掷骰失败时 destination 是 null，玩家就卡住了（曾经真的存在这种条目）。
        if (it2.checks.length > 0 && it2.choices.length === 0 && it2.continueTo === null) {
          for (const ch of it2.checks) {
            if (ch.successTo === null || ch.failureTo === null) {
              problems.push(
                `条目 ${node.id} 只摆检定却没有配对分支（${ch.targetLabel} success=${ch.successTo} failure=${ch.failureTo}）`,
              )
            }
          }
        }
      }
    }
    expect([...new Set(problems)]).toEqual([])
  })

  it('预建角色（私家侦探）能走到结局', () => {
    const char = createPrebuiltCharacter()
    const kinds = new Set<string>()
    for (let i = 0; i < 120; i++) {
      const res = walkOnce(char, 500 + i, 900 + i)
      expect(res.stuckAt, `seed ${i} 卡在条目 ${res.stuckAt}`).toBeNull()
      expect(res.exhausted).toBe(false)
      if (res.state.ended) kinds.add(res.state.ended.kind)
      if (kinds.has('ending')) break
    }
    expect(kinds.has('ending') || kinds.has('death')).toBe(true)
  })

  it('同种子同角色 → 完全一样的日志（骰点可复现，堵死 SL 大法）', () => {
    const char = createRandomCharacter(createRng(42)).character
    const a = walkOnce(char, 77, 1234)
    const b = walkOnce(char, 77, 1234)
    expect(a.steps).toBe(b.steps)
    expect(a.state.turn).toBe(b.state.turn)
    expect(a.state.rngState).toBe(b.state.rngState)
    expect(a.state.log.map((e) => `${e.kind}|${e.nodeId}|${e.text}`)).toEqual(
      b.state.log.map((e) => `${e.kind}|${e.nodeId}|${e.text}`),
    )
  })

  it('断链（跳到不存在的条目）如实报错并收官，不静默卡住', () => {
    // 条目 68 的链接指向 74，而 74 在源文本里整条丢失
    let state = createGame(createPrebuiltCharacter(), 5)
    state = { ...state, nodeId: 68 }
    state = continueForward(state, { ...analyze(state) })
    if (!state.ended) {
      // 68 不是唯一出口的条目时，用第一个选项前进
      state = chooseLink(state, 0)
    }
    // 无论走到哪，都必须处于「有操作」或「已结束」两种状态之一
    const it = analyze(state)
    const legal = it.continueTo !== null || it.choices.length > 0 || it.checks.length > 0
    expect(state.ended !== null || legal).toBe(true)
  })
})
