/**
 * 检定分支的落点契约。
 *
 * 盯的是一件事：**掷完骰子能不能自动把玩家带走。**
 *
 * 曾经的真实故障：条目 134 原文写的是「如果你通过了"敏捷"检定 → 261 /
 * 如果你没有通过"敏捷"检定 → 59」，而解析器只认「成功/失败」两种措辞，两条链接
 * 都没被标记，引擎于是判定配对不唯一，弹出「本条目有多个检定或分支配对不唯一……
 * 请自己选」，再摆两个按钮让玩家点。玩家得替引擎判通没通过 —— 等于把规则扔了。
 *
 * 所以这里做两件事：
 *   1. 把原文的五种措辞逐个钉死（措辞认漏一种，那一处就退化成手点）
 *   2. 把「全书不该再出现需要玩家自己判的检定」写成全局不变量
 */

import { describe, expect, it } from 'vitest'

import { createPrebuiltCharacter } from './character'
import { SCRIPT } from './content'
import { KNOWN_MANUAL_ROUTE } from './gaps'
import { analyze, createGame } from './state'
import type { CheckOffer } from './types'

/** 用同一副牌面看所有条目：本文件只关心分支结构，不关心属性值。 */
function offers(nodeId: number): CheckOffer[] {
  const base = createGame(createPrebuiltCharacter(), 7)
  return analyze({ ...base, nodeId, ended: null }).checks
}

/** 把一次检定压成「四条路各自去哪」。 */
function route(nodeId: number): Array<{
  success: number | null
  failure: number | null
  fumble: number | null
  push: number | null
}> {
  return offers(nodeId).map((c) => ({
    success: c.successTo,
    failure: c.failureTo,
    fumble: c.fumbleTo,
    push: c.pushTo,
  }))
}

describe('原文的五种分支措辞都要认出来', () => {
  it('成功 / 失败 —— 最标准的写法（条目 17）', () => {
    expect(route(17)).toEqual([{ success: 30, failure: 37, fumble: 37, push: null }])
  })

  it('通过 / 没有通过 —— 条目 134，本次修复的起点', () => {
    expect(route(134)).toEqual([{ success: 261, failure: 59, fumble: 59, push: null }])
  })

  it('胜出 / 落败 —— 对抗检定（条目 150、155）', () => {
    expect(route(150)).toEqual([{ success: 172, failure: 87, fumble: 87, push: null }])
    expect(route(155)).toEqual([{ success: 161, failure: 167, fumble: 167, push: null }])
  })

  it('否则 —— 最常见的普通失败写法（条目 34、57、133）', () => {
    expect(route(34)).toEqual([{ success: 46, failure: 25, fumble: 25, push: null }])
    expect(route(57)).toEqual([{ success: 69, failure: 25, fumble: 25, push: null }])
    expect(route(133)).toEqual([{ success: 147, failure: 140, fumble: 140, push: null }])
  })

  it('孤注一掷 —— 重掷失败的落点与首次失败不同（条目 165）', () => {
    expect(route(165)).toEqual([
      { success: 177, failure: 184, fumble: 184, push: 190 },
    ])
  })
})

describe('大失败是独立落点，不是普通失败', () => {
  it('条目 110：成功 143 / 失败 129 / 大失败 149', () => {
    expect(route(110)).toEqual([{ success: 143, failure: 129, fumble: 149, push: null }])
  })

  it('条目 208：原书只写了大失败和「否则」', () => {
    expect(route(208)).toEqual([{ success: 228, failure: 228, fumble: 222, push: null }])
  })

  it('没有单写大失败的条目，大失败退回普通失败', () => {
    // 条目 134 只写了通过/没有通过，掷出 96+ 应当走「没有通过」那条。
    expect(offers(134)[0].fumbleTo).toBe(offers(134)[0].failureTo)
  })
})

describe('兜底出口 —— 原书只写后果、不写两条路', () => {
  /**
   * 「如果你失败了，今天你的技能检定获得一颗惩罚骰。现在转到 64。」（条目 52）
   * 成功和失败都走 64，所以两条链接本来就没有 success/failure 标记。
   * 这类条目以前全部退化成「请自己选一个」。
   */
  const ALWAYS: Array<[number, number]> = [
    [52, 64],
    [97, 79],
    [141, 63],
    [191, 199],
    [201, 79],
    [250, 256],
  ]

  for (const [nodeId, to] of ALWAYS) {
    it(`条目 ${nodeId} 检定之后无条件去 ${to}`, () => {
      expect(route(nodeId)).toEqual([{ success: to, failure: to, fumble: to, push: null }])
    })
  }

  it('条目 173：失败走 193，三轮之后没倒下走 201', () => {
    expect(route(173)).toEqual([
      { success: 201, failure: 193, fumble: 193, push: null },
    ])
  })
})

describe('真正需要玩家选的，只有原书自己就分叉的那些', () => {
  it('条目 266：「你也可以……」是给玩家的三个选择，不能被当成兜底出口吞掉', () => {
    const it2 = analyze({
      ...createGame(createPrebuiltCharacter(), 7),
      nodeId: 266,
      ended: null,
    })
    // 成功唯一 → 自动去 76；失败时把原文的三个去处摆出来
    expect(it2.checks[0].successTo).toBe(76)
    expect(it2.checks[0].failureTo).toBeNull()
    expect(it2.choices.map((c) => c.to)).toEqual([58, 52, 26])
    // 「掷骰结果不会自动带你去任何地方」不该出现 —— 成功那条路是定死的
    expect(it2.checks[0].ambiguous).toBe(false)
  })

  it('条目 262：近身战斗按 HP 分叉，掷骰结果决定不了', () => {
    const it2 = analyze({
      ...createGame(createPrebuiltCharacter(), 7),
      nodeId: 262,
      ended: null,
    })
    expect(it2.checks[0].successTo).toBe(12)
    expect(it2.checks[0].failureTo).toBeNull()
    expect(it2.choices.map((c) => c.to)).toEqual([268, 2])
  })
})

/**
 * 掷骰之后仍然要把选择权交还给玩家的条目 —— 名单在 tools/overrides.json 的
 * knownGaps.manualRoute 里（见 ./gaps.ts），与 `npm run check` 共用。
 *
 * 这不是缺陷名单，是**原书本身**就没有唯一分支的地方：
 *   262 —— 近身战斗按双方 HP 阈值分叉，跟掷骰结果无关
 *   266 —— 失败之后原书给了三个去处（扑灭炉火 / 彻夜不眠 / 吸一口烟气），成功才唯一
 *
 * 这张表变长 = 有检定悄悄退化成「请玩家自己判通没通过」，必须停下来看一眼。
 */
const MANUAL_ROUTE: number[] = KNOWN_MANUAL_ROUTE

describe('全局不变量：不该再有需要玩家自己判的检定', () => {
  it('没有任何检定会提示「请自己选通没通过」', () => {
    const bad: string[] = []
    for (const node of SCRIPT.nodes) {
      // 结局/断点上的检定没有下一站可去，掷骰只为结算效果，不算歧义
      if (node.kind === 'ending' || node.kind === 'dead_end') continue
      for (const c of offers(node.id)) {
        if (c.ambiguous) bad.push(`条目 ${node.id}（${node.kind}）${c.targetLabel}`)
      }
    }
    expect(bad).toEqual([])
  })

  it('定不下落点的条目只有登记在册的那几个', () => {
    const found: number[] = []
    for (const node of SCRIPT.nodes) {
      if (node.checks.length === 0) continue
      if (node.kind === 'ending' || node.kind === 'dead_end') continue
      const stuck = offers(node.id).some(
        (c) => c.successTo === null || c.failureTo === null,
      )
      if (stuck) found.push(node.id)
    }
    expect(found).toEqual(MANUAL_ROUTE)
  })

  it('每个定不下落点的条目，都必须留了能点的选项（否则玩家会卡死）', () => {
    for (const nodeId of MANUAL_ROUTE) {
      const it2 = analyze({
        ...createGame(createPrebuiltCharacter(), 7),
        nodeId,
        ended: null,
      })
      expect(it2.choices.length, `条目 ${nodeId} 没有可点的选项`).toBeGreaterThan(0)
    }
  })

  it('结局条目上摆的检定不需要落点，也不该提示「请自己选」', () => {
    // 条目 171 是全书唯一「有检定但没有出口」的条目，而且是结局：
    // 掷骰只为结算理智损失，没有下一站可去。
    const c = offers(171)
    expect(c).toHaveLength(1)
    expect(c[0].ambiguous).toBe(false)
    expect(c[0].successTo).toBeNull()
    expect(c[0].failureTo).toBeNull()
  })
})
